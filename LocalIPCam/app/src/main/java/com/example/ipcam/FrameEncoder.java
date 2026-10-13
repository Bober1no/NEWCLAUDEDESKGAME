package com.example.ipcam;

import android.graphics.ImageFormat;
import android.graphics.Rect;
import android.graphics.YuvImage;

import androidx.annotation.NonNull;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

/**
 * Turns each CameraX frame into a JPEG and hands it to the server.
 *
 * Also does two side jobs:
 *   1. Throttles output to the configured fps (night mode lowers this).
 *   2. Measures average scene brightness so the service can decide whether
 *      it is dark enough to switch into low-light mode.
 */
public class FrameEncoder implements ImageAnalysis.Analyzer {

    /** Receives the average luminance (0..255) of each processed frame. */
    public interface LumaListener {
        void onLuma(int averageLuma);
    }

    /**
     * How often a frame is still encoded when nobody is watching.
     *
     * Not zero: /shot.jpg should return something recent rather than a frame
     * from whenever the last viewer left, and a brand new viewer gets a
     * picture immediately instead of waiting.
     */
    private static final int IDLE_FPS = 1;

    private final MjpegServer server;
    private final Settings settings;
    private final LumaListener lumaListener;

    private long lastEmitNanos = 0L;
    private final ByteArrayOutputStream jpegBuffer = new ByteArrayOutputStream(128 * 1024);

    // Scratch buffers, reused across frames.
    //
    // Allocating these per frame was throwing roughly 45MB a second of garbage
    // at 1080p15 — two full-size arrays every frame — which costs real CPU in
    // collection alone, quite apart from the zeroing. They are only ever
    // touched from the single analysis thread.
    private byte[] nv21Scratch = null;
    private byte[] rotateScratch = null;

    private byte[] nv21Buffer(int size) {
        if (nv21Scratch == null || nv21Scratch.length < size) {
            nv21Scratch = new byte[size];
        }
        return nv21Scratch;
    }

    private byte[] rotateBuffer(int size) {
        if (rotateScratch == null || rotateScratch.length < size) {
            rotateScratch = new byte[size];
        }
        return rotateScratch;
    }

    public FrameEncoder(MjpegServer server, Settings settings, LumaListener lumaListener) {
        this.server = server;
        this.settings = settings;
        this.lumaListener = lumaListener;
    }

    @Override
    public void analyze(@NonNull ImageProxy image) {
        try {
            // --- how fast should we be encoding right now? --------------------
            //
            // An always-on camera spends almost all its life with nobody
            // watching, so with no viewers this drops to a trickle.
            //
            // Worth knowing what this does and does not buy, because it is
            // less than it looks: it stops the ENCODE and nothing else. The
            // camera, the image signal processor and the link between them
            // carry on producing full-rate frames that are then thrown away,
            // and on a small frame that pipeline costs more than the JPEG
            // encode does. Slowing the sensor itself is what actually reduces
            // the draw, and that lives in CameraController.setCaptureIdle.
            boolean watched = server.getViewerCount() > 0;
            int fps = watched
                    ? Math.max(1, settings.effectiveFps())
                    : (settings.idleThrottle ? IDLE_FPS : Math.max(1, settings.effectiveFps()));

            long minIntervalNanos = 1_000_000_000L / fps;
            long now = System.nanoTime();
            boolean due = (now - lastEmitNanos) >= minIntervalNanos;

            // Brightness is sampled on every frame regardless, including
            // skipped ones: it is about a thousand byte reads and it is what
            // night mode and the status readout run on.
            int luma = averageLuma(image);
            if (lumaListener != null) lumaListener.onLuma(luma);

            if (!due) return;
            lastEmitNanos = now;

            // --- encode -------------------------------------------------------
            int width = image.getWidth();
            int height = image.getHeight();
            byte[] nv21 = yuv420ToNv21(image, nv21Buffer(width * height * 3 / 2));

            int rotation = effectiveRotation(image);
            if (rotation != 0) {
                int size = width * height * 3 / 2;
                nv21 = rotateNv21(nv21, width, height, rotation, rotateBuffer(size));
                if (rotation == 90 || rotation == 270) {
                    int tmp = width;
                    width = height;
                    height = tmp;
                }
            }

            YuvImage yuv = new YuvImage(nv21, ImageFormat.NV21, width, height, null);
            jpegBuffer.reset();
            yuv.compressToJpeg(new Rect(0, 0, width, height),
                    Settings.clamp(settings.jpegQuality, 10, 95), jpegBuffer);
            server.pushFrame(jpegBuffer.toByteArray());

        } catch (Exception ignored) {
            // Drop this frame; the next one will be along shortly.
        } finally {
            image.close();
        }
    }

    /**
     * Rotation to apply, honouring the user's override.
     *
     * Rotating NV21 is per-pixel work and at 1080p it is the most expensive
     * thing in this method — more than the JPEG encode. A camera bolted to a
     * wall in one orientation forever does not need it recomputed from the
     * device's orientation on every single frame, so NONE skips it entirely
     * and a fixed angle pins it.
     */
    private int effectiveRotation(ImageProxy image) {
        switch (settings.rotationMode) {
            case NONE: return 0;
            case FIXED_90: return 90;
            case FIXED_180: return 180;
            case FIXED_270: return 270;
            default: return image.getImageInfo().getRotationDegrees();
        }
    }

    // --- helpers -----------------------------------------------------------

    /**
     * Average of the Y (luminance) plane, sampled on a grid rather than every
     * pixel so it stays cheap at 1080p. 0 = black, 255 = white.
     */
    private static int averageLuma(ImageProxy image) {
        ByteBuffer y = image.getPlanes()[0].getBuffer().duplicate();
        int rowStride = image.getPlanes()[0].getRowStride();
        int width = image.getWidth();
        int height = image.getHeight();

        int stepX = Math.max(1, width / 32);
        int stepY = Math.max(1, height / 32);

        long sum = 0;
        int count = 0;
        for (int row = 0; row < height; row += stepY) {
            int base = row * rowStride;
            for (int col = 0; col < width; col += stepX) {
                int idx = base + col;
                if (idx >= y.limit()) continue;
                sum += (y.get(idx) & 0xFF);
                count++;
            }
        }
        return count == 0 ? 0 : (int) (sum / count);
    }

    /** Pack a YUV_420_888 ImageProxy into a caller-supplied NV21 buffer. */
    private static byte[] yuv420ToNv21(ImageProxy image, byte[] nv21) {
        ImageProxy.PlaneProxy[] planes = image.getPlanes();
        int width = image.getWidth();
        int height = image.getHeight();
        int ySize = width * height;

        ByteBuffer yBuffer = planes[0].getBuffer().duplicate();
        ByteBuffer uBuffer = planes[1].getBuffer().duplicate();
        ByteBuffer vBuffer = planes[2].getBuffer().duplicate();

        int yRowStride = planes[0].getRowStride();
        int pos = 0;
        if (yRowStride == width) {
            yBuffer.position(0);
            yBuffer.get(nv21, 0, ySize);
            pos = ySize;
        } else {
            for (int row = 0; row < height; row++) {
                yBuffer.position(row * yRowStride);
                yBuffer.get(nv21, pos, width);
                pos += width;
            }
        }

        // NV21 interleaves V then U at half resolution.
        int uvRowStride = planes[1].getRowStride();
        int uvPixelStride = planes[1].getPixelStride();
        for (int row = 0; row < height / 2; row++) {
            for (int col = 0; col < width / 2; col++) {
                int offset = row * uvRowStride + col * uvPixelStride;
                if (offset >= vBuffer.limit() || offset >= uBuffer.limit()) continue;
                nv21[pos++] = vBuffer.get(offset);
                nv21[pos++] = uBuffer.get(offset);
            }
        }
        return nv21;
    }

    /**
     * Rotate an NV21 buffer by 90/180/270 degrees.
     * This is per-pixel work, so at 1080p it costs real CPU. If you only ever
     * mount the phone one way, you can skip rotation entirely for more fps.
     */
    static byte[] rotateNv21(byte[] input, int width, int height, int rotation,
                             byte[] output) {
        if (rotation == 0) return input;
        int frameSize = width * height;
        boolean swap = rotation % 180 != 0;
        boolean xflip = rotation % 270 != 0;
        boolean yflip = rotation >= 180;

        for (int j = 0; j < height; j++) {
            for (int i = 0; i < width; i++) {
                int yIn = j * width + i;
                int uIn = frameSize + (j >> 1) * width + (i & ~1);
                int vIn = uIn + 1;

                int wOut = swap ? height : width;
                int hOut = swap ? width : height;
                int iSwapped = swap ? j : i;
                int jSwapped = swap ? i : j;
                int iOut = xflip ? wOut - iSwapped - 1 : iSwapped;
                int jOut = yflip ? hOut - jSwapped - 1 : jSwapped;

                int yOut = jOut * wOut + iOut;
                int uOut = frameSize + (jOut >> 1) * wOut + (iOut & ~1);
                int vOut = uOut + 1;

                output[yOut] = input[yIn];
                output[uOut] = input[uIn];
                output[vOut] = input[vIn];
            }
        }
        return output;
    }
}
