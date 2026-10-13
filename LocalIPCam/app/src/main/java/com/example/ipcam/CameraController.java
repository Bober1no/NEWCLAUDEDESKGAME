package com.example.ipcam;

import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.CaptureResult;
import android.hardware.camera2.TotalCaptureResult;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.util.Range;
import android.util.Rational;
import android.util.Size;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.camera.camera2.interop.Camera2CameraControl;
import androidx.camera.camera2.interop.Camera2CameraInfo;
import androidx.camera.camera2.interop.CaptureRequestOptions;
import androidx.camera.camera2.interop.Camera2Interop;
import androidx.camera.camera2.interop.ExperimentalCamera2Interop;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraInfo;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.core.resolutionselector.ResolutionSelector;
import androidx.camera.core.resolutionselector.ResolutionStrategy;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.lifecycle.LifecycleOwner;

import java.nio.ByteBuffer;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/**
 * Owns the CameraX binding.
 *
 * HOW NIGHT MODE WORKS
 * --------------------
 * Sending fewer frames per second does not brighten anything by itself. What
 * makes a dark scene usable is a LONGER EXPOSURE per frame, and a sensor can
 * only expose for longer if it is allowed to run slowly: a 30fps target caps
 * exposure at ~33ms, while 4fps allows ~250ms.
 *
 * There are two ways to get there, and this class picks based on hardware:
 *
 *   MANUAL (device reports REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR)
 *     Auto-exposure is switched OFF and the exposure time and ISO are set
 *     directly: exposure = 1/nightFps, clamped to what the sensor advertises.
 *     This is deterministic — you ask for 250ms at ISO 1600 and that is what
 *     the sensor does, regardless of what AE would have preferred.
 *
 *   FALLBACK (no manual sensor support)
 *     Auto-exposure stays on but is told its target frame-rate range is low
 *     (CONTROL_AE_TARGET_FPS_RANGE), which frees it to choose long exposures,
 *     plus exposure compensation is nudged up. AE still decides, so results
 *     vary by device and scene.
 *
 * The trade-off either way is motion blur: anything moving smears at 250ms.
 * That is inherent to low-light capture, not a bug.
 */
public class CameraController {

    private static final String TAG = "CameraController";

    private final ProcessCameraProvider provider;
    private final LifecycleOwner lifecycleOwner;
    private final Executor analysisExecutor;
    private final Handler main = new Handler(Looper.getMainLooper());

    @Nullable private Camera camera;
    @Nullable private Preview.SurfaceProvider surfaceProvider;
    @Nullable private ImageAnalysis.Analyzer analyzer;
    @Nullable private ImageCapture imageCapture;

    private boolean torchOn = false;
    private float linearZoom = 0f;

    /** Set to true when the three-way bind fails and preview had to be dropped. */
    private volatile boolean previewDropped = false;
    /** Set when a requested lens would not bind and the default was used. */
    private volatile boolean lensFallback = false;
    /** Guards the one retry after a lens-specific bind failure. */
    private boolean retryingWithDefaultLens = false;

    /** Every lens the device exposes, discovered on first use. */
    private volatile List<CameraLens> lenses = java.util.Collections.emptyList();

    // --- live values, written from a camera thread, read by the server ------
    private volatile long lastExposureNs = -1L;
    private volatile int lastIso = -1;

    // --- sensor limits, read once per bind ----------------------------------
    @Nullable private volatile Range<Long> exposureRange;
    @Nullable private volatile Range<Integer> isoRange;
    @Nullable private volatile Long maxFrameDuration;
    private volatile boolean manualSensor = false;

    /**
     * Every CONTROL_AE_TARGET_FPS_RANGE the hardware advertises, read once per
     * bind. Requesting a range the device does not list can stop the camera
     * opening at all, so these are the only ones ever asked for.
     */
    @Nullable private volatile Range<Integer>[] aeRanges;

    /**
     * Whether the capture pipeline is currently being held at the idle rate.
     *
     * This is the one that matters for battery. The old idle throttle only
     * stopped JPEG encoding; the sensor, the ISP and the MIPI link carried on
     * producing 30 frames a second into a bin, which is the expensive part.
     * Slowing the capture itself is what actually reduces the draw.
     */
    private volatile boolean captureIdle = false;

    private final AtomicBoolean nightShotRunning = new AtomicBoolean(false);

    public CameraController(ProcessCameraProvider provider,
                            LifecycleOwner lifecycleOwner,
                            Executor analysisExecutor) {
        this.provider = provider;
        this.lifecycleOwner = lifecycleOwner;
        this.analysisExecutor = analysisExecutor;
    }

    public void setAnalyzer(@Nullable ImageAnalysis.Analyzer analyzer) {
        this.analyzer = analyzer;
    }

    /** Attach or detach the on-screen preview. Pass null when the UI goes away. */
    public void setSurfaceProvider(@Nullable Preview.SurfaceProvider sp) {
        this.surfaceProvider = sp;
    }

    public boolean hasFlashUnit() {
        return camera != null && camera.getCameraInfo().hasFlashUnit();
    }

    public boolean isTorchOn() { return torchOn; }

    public void setTorch(boolean on) {
        if (camera == null || !camera.getCameraInfo().hasFlashUnit()) return;
        torchOn = on;
        camera.getCameraControl().enableTorch(on);
    }

    /** 0.0 = widest, 1.0 = maximum zoom. */
    public void setLinearZoom(float z) {
        linearZoom = Math.max(0f, Math.min(1f, z));
        if (camera != null) camera.getCameraControl().setLinearZoom(linearZoom);
    }

    public float getLinearZoom() { return linearZoom; }

    // --- live readout --------------------------------------------------------

    public long getLastExposureNs() { return lastExposureNs; }
    public int getLastIso() { return lastIso; }
    public boolean isManualSensorSupported() { return manualSensor; }
    public boolean isPreviewDropped() { return previewDropped; }
    public boolean isNightShotRunning() { return nightShotRunning.get(); }

    public long getExposureMinNs() {
        Range<Long> r = exposureRange;
        return r == null ? -1L : r.getLower();
    }

    public long getExposureMaxNs() {
        Range<Long> r = exposureRange;
        return r == null ? -1L : r.getUpper();
    }

    public int getIsoMin() {
        Range<Integer> r = isoRange;
        return r == null ? -1 : r.getLower();
    }

    public int getIsoMax() {
        Range<Integer> r = isoRange;
        return r == null ? -1 : r.getUpper();
    }

    /** "1/60s" for anything under a second, "2.5s" above it. */
    public static String formatExposure(long ns) {
        if (ns <= 0) return "-";
        if (ns < 1_000_000_000L) return "1/" + Math.round(1e9 / ns) + "s";
        return String.format(Locale.US, "%.1fs", ns / 1e9);
    }

    // --- binding -------------------------------------------------------------

    // --- lenses ---------------------------------------------------------------

    /** All selectable lenses, wide to long, rear first. Cached after the first call. */
    public List<CameraLens> getLenses() {
        if (lenses.isEmpty()) lenses = CameraLens.enumerate(provider);
        return lenses;
    }

    @Nullable
    public CameraLens findLens(@Nullable String cameraId) {
        if (cameraId == null || cameraId.isEmpty()) return null;
        for (CameraLens l : getLenses()) {
            if (l.cameraId.equals(cameraId)) return l;
        }
        return null;
    }

    /** The lens currently configured, or null when running on the facing default. */
    @Nullable
    public CameraLens currentLens(Settings settings) {
        return findLens(settings.cameraId);
    }

    public boolean didLensFallBack() { return lensFallback; }

    /**
     * The selector for the configured lens, or the plain facing default when
     * no specific lens is set or the saved one has gone away (the camera list
     * can change, for instance when a USB camera is unplugged).
     */
    private CameraSelector selectorFor(Settings settings) {
        CameraLens lens = findLens(settings.cameraId);
        if (lens != null) return lens.selector();
        return settings.frontCamera
                ? CameraSelector.DEFAULT_FRONT_CAMERA
                : CameraSelector.DEFAULT_BACK_CAMERA;
    }

    // --- optical zoom ----------------------------------------------------------

    public float getZoomRatio() {
        Camera c = camera;
        if (c == null || c.getCameraInfo().getZoomState().getValue() == null) return 1f;
        return c.getCameraInfo().getZoomState().getValue().getZoomRatio();
    }

    public float getMinZoomRatio() {
        Camera c = camera;
        if (c == null || c.getCameraInfo().getZoomState().getValue() == null) return 1f;
        return c.getCameraInfo().getZoomState().getValue().getMinZoomRatio();
    }

    public float getMaxZoomRatio() {
        Camera c = camera;
        if (c == null || c.getCameraInfo().getZoomState().getValue() == null) return 1f;
        return c.getCameraInfo().getZoomState().getValue().getMaxZoomRatio();
    }

    /**
     * Ask for an absolute zoom factor.
     *
     * On a logical multi-camera this is how you reach the other glass: a
     * minimum ratio below 1.0 means the ultra-wide is behind this same camera
     * ID, and crossing the threshold makes the camera switch lenses itself.
     * Returns false when the factor is outside what this camera offers, which
     * is the caller's cue to look for a separate physical lens instead.
     */
    public boolean setZoomRatio(float ratio) {
        Camera c = camera;
        if (c == null) return false;
        float min = getMinZoomRatio();
        float max = getMaxZoomRatio();
        if (ratio < min - 0.001f || ratio > max + 0.001f) return false;
        try {
            c.getCameraControl().setZoomRatio(Math.max(min, Math.min(max, ratio)));
            return true;
        } catch (Exception e) {
            Log.w(TAG, "setZoomRatio failed", e);
            return false;
        }
    }

    /**
     * (Re)bind the camera with the current settings.
     * MUST be called on the main thread.
     */
    public void rebind(Settings settings) {
        // Nothing in here may escape: rebind runs from main-thread posts, and
        // an exception there kills the whole app instead of just this lens.
        try {
            rebindInner(settings);
        } catch (Exception e) {
            Log.e(TAG, "rebind failed unexpectedly", e);
            camera = null;
            imageCapture = null;
            if (settings.cameraId != null && !settings.cameraId.isEmpty()
                    && !retryingWithDefaultLens) {
                retryingWithDefaultLens = true;
                try {
                    settings.cameraId = "";
                    rebindInner(settings);
                } catch (Exception again) {
                    Log.e(TAG, "default lens failed too", again);
                    camera = null;
                } finally {
                    retryingWithDefaultLens = false;
                }
                lensFallback = true;
            }
        }
    }

    @OptIn(markerClass = ExperimentalCamera2Interop.class)
    private void rebindInner(Settings settings) {
        provider.unbindAll();
        previewDropped = false;

        lensFallback = false;
        CameraSelector selector = selectorFor(settings);

        readSensorLimits(selector);

        Size target = settings.resolution();
        ResolutionSelector resolutionSelector = new ResolutionSelector.Builder()
                .setResolutionStrategy(new ResolutionStrategy(
                        target, ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER))
                .build();

        ImageAnalysis.Builder analysisBuilder = new ImageAnalysis.Builder()
                .setResolutionSelector(resolutionSelector)
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST);

        boolean lowLight = settings.lowLightCapture();
        // Decision order matters: an explicit MANUAL choice outranks the night
        // logic, which in turn outranks plain auto-exposure.
        boolean userManual = settings.manualExposure() && manualSensor;
        boolean manualNight = !userManual && lowLight && manualSensor;
        boolean anyManual = userManual || manualNight;

        Camera2Interop.Extender<ImageAnalysis> ext =
                new Camera2Interop.Extender<>(analysisBuilder);

        // Report back what the sensor actually did with each frame.
        ext.setSessionCaptureCallback(new CameraCaptureSession.CaptureCallback() {
            @Override
            public void onCaptureCompleted(@NonNull CameraCaptureSession session,
                                           @NonNull CaptureRequest request,
                                           @NonNull TotalCaptureResult result) {
                Long e = result.get(CaptureResult.SENSOR_EXPOSURE_TIME);
                Integer i = result.get(CaptureResult.SENSOR_SENSITIVITY);
                if (e != null) lastExposureNs = e;
                if (i != null) lastIso = i;
            }
        });

        if (userManual) {
            // The user is driving. Exactly their values, whatever the scene or
            // the night setting says.
            long exposureNs = clampExposure(settings.manualExposureNs);
            int iso = clampIso(settings.manualIso);
            long frameNs = frameDurationFor(exposureNs, settings.targetFps);
            Log.i(TAG, "Exposure MANUAL: " + formatExposure(exposureNs)
                    + " (" + exposureNs + "ns) iso " + iso
                    + " frameDuration " + frameNs + "ns");
            ext.setCaptureRequestOption(CaptureRequest.CONTROL_AE_MODE,
                    CaptureRequest.CONTROL_AE_MODE_OFF);
            ext.setCaptureRequestOption(CaptureRequest.SENSOR_EXPOSURE_TIME, exposureNs);
            ext.setCaptureRequestOption(CaptureRequest.SENSOR_FRAME_DURATION, frameNs);
            ext.setCaptureRequestOption(CaptureRequest.SENSOR_SENSITIVITY, iso);
        } else if (manualNight) {
            // Night logic drives the sensor directly.
            long exposureNs = manualExposureFor(settings.nightFps);
            int iso = clampIso(settings.nightIso);
            Log.i(TAG, "Night mode MANUAL: exposure " + formatExposure(exposureNs)
                    + " (" + exposureNs + "ns) iso " + iso);
            ext.setCaptureRequestOption(CaptureRequest.CONTROL_AE_MODE,
                    CaptureRequest.CONTROL_AE_MODE_OFF);
            ext.setCaptureRequestOption(CaptureRequest.SENSOR_EXPOSURE_TIME, exposureNs);
            ext.setCaptureRequestOption(CaptureRequest.SENSOR_FRAME_DURATION, exposureNs);
            ext.setCaptureRequestOption(CaptureRequest.SENSOR_SENSITIVITY, iso);
            ext.setCaptureRequestOption(CaptureRequest.NOISE_REDUCTION_MODE,
                    CaptureRequest.NOISE_REDUCTION_MODE_HIGH_QUALITY);
        } else {
            ext.setCaptureRequestOption(CaptureRequest.CONTROL_AE_MODE,
                    CaptureRequest.CONTROL_AE_MODE_ON);
            if (lowLight) {
                // No manual sensor control: all we can do is let AE run slow.
                Range<Integer> aeRange = pickAeRange(selector);
                if (aeRange != null) {
                    Log.i(TAG, "Night mode AUTO fallback: AE fps range " + aeRange);
                    ext.setCaptureRequestOption(
                            CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, aeRange);
                }
                ext.setCaptureRequestOption(CaptureRequest.NOISE_REDUCTION_MODE,
                        CaptureRequest.NOISE_REDUCTION_MODE_HIGH_QUALITY);
                ext.setCaptureRequestOption(CaptureRequest.EDGE_MODE,
                        CaptureRequest.EDGE_MODE_HIGH_QUALITY);
            }
        }

        ImageAnalysis analysis = analysisBuilder.build();
        if (analyzer != null) analysis.setAnalyzer(analysisExecutor, analyzer);

        imageCapture = new ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                .build();

        try {
            if (surfaceProvider != null) {
                Preview preview = new Preview.Builder()
                        .setResolutionSelector(resolutionSelector)
                        .build();
                preview.setSurfaceProvider(surfaceProvider);
                try {
                    camera = provider.bindToLifecycle(
                            lifecycleOwner, selector, preview, analysis, imageCapture);
                } catch (Exception threeWayFailed) {
                    // Not every device can run preview + analysis + capture at
                    // once. Streaming matters more than the on-screen preview.
                    Log.w(TAG, "preview+analysis+capture bind failed, dropping preview",
                            threeWayFailed);
                    provider.unbindAll();
                    previewDropped = true;
                    camera = provider.bindToLifecycle(
                            lifecycleOwner, selector, analysis, imageCapture);
                }
            } else {
                camera = provider.bindToLifecycle(
                        lifecycleOwner, selector, analysis, imageCapture);
            }
        } catch (Exception e) {
            Log.e(TAG, "bindToLifecycle failed", e);
            camera = null;
            imageCapture = null;

            // Last try on THIS lens before giving up on it: streaming only.
            // Ultra-wides are often LIMITED hardware and refuse a full-quality
            // still capture alongside analysis, but stream fine on their own.
            // Losing the still use case only affects the HQ snapshot.
            try {
                provider.unbindAll();
                camera = provider.bindToLifecycle(lifecycleOwner, selector, analysis);
                previewDropped = surfaceProvider != null;
                Log.w(TAG, "bound analysis only on this lens (no preview / stills)");
            } catch (Exception analysisOnlyFailed) {
                Log.e(TAG, "analysis-only bind failed too", analysisOnlyFailed);
                camera = null;
            }
        }

        if (camera == null) {
            // An aux lens often supports fewer resolutions and use-case
            // combinations than the main sensor — a telephoto that cannot do
            // 1080p analysis plus stills will refuse the whole bind. Rather
            // than leaving a dead camera, drop back to the facing default and
            // tell the user which lens failed.
            if (settings.cameraId != null && !settings.cameraId.isEmpty()
                    && !retryingWithDefaultLens) {
                String failed = settings.cameraId;
                retryingWithDefaultLens = true;
                try {
                    Log.w(TAG, "lens " + failed + " would not bind; using the default");
                    settings.cameraId = "";
                    rebind(settings);
                } finally {
                    retryingWithDefaultLens = false;
                }
                // Set after the retry: the nested call resets this at its top.
                lensFallback = true;
            }
            return;
        }

        // Things that live on CameraControl rather than on the binding.
        camera.getCameraControl().setLinearZoom(linearZoom);
        if (settings.zoomRatio > 0f && Math.abs(settings.zoomRatio - 1f) > 0.001f) {
            setZoomRatio(settings.zoomRatio);
        }
        if (torchOn && camera.getCameraInfo().hasFlashUnit()) {
            camera.getCameraControl().enableTorch(true);
        }
        // Exposure compensation only means anything while AE is running.
        if (!anyManual) {
            applyExposureCompensation(lowLight ? settings.nightExposureBoost : 0);
        }
    }

    public void unbind() {
        provider.unbindAll();
        camera = null;
        imageCapture = null;
    }

    // --- night snapshot --------------------------------------------------------

    /**
     * Take one long-exposure still.
     *
     * ImageCapture's Camera2 options are fixed when the use case is built, so a
     * per-shot override is not possible. Instead this binds a SECOND
     * ImageCapture configured for a long manual exposure, fires it, then puts
     * the normal configuration back. The stream pauses for the duration —
     * typically one to three seconds.
     *
     * MUST be called on the main thread.
     */
    @OptIn(markerClass = ExperimentalCamera2Interop.class)
    public void takeNightShot(Settings settings,
                              Consumer<byte[]> onJpeg,
                              Consumer<String> onError) {
        if (!nightShotRunning.compareAndSet(false, true)) {
            onError.accept("A night snapshot is already in progress.");
            return;
        }

        CameraSelector selector = selectorFor(settings);

        ImageCapture.Builder builder = new ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                .setResolutionSelector(new ResolutionSelector.Builder()
                        .setResolutionStrategy(ResolutionStrategy.HIGHEST_AVAILABLE_STRATEGY)
                        .build());

        long exposureNs = -1L;
        int iso = -1;
        if (manualSensor) {
            if (settings.manualExposure()) {
                // The user has picked an exposure; honour it exactly rather
                // than overriding them with a long one they did not ask for.
                exposureNs = clampExposure(settings.manualExposureNs);
                iso = clampIso(settings.manualIso);
            } else {
                // AUTO: go as long as the sensor allows, at the night ISO.
                exposureNs = clampExposure(Long.MAX_VALUE);
                iso = clampIso(settings.nightIso);
            }
            Camera2Interop.Extender<ImageCapture> ext =
                    new Camera2Interop.Extender<>(builder);
            ext.setCaptureRequestOption(CaptureRequest.CONTROL_AE_MODE,
                    CaptureRequest.CONTROL_AE_MODE_OFF);
            ext.setCaptureRequestOption(CaptureRequest.SENSOR_EXPOSURE_TIME, exposureNs);
            ext.setCaptureRequestOption(CaptureRequest.SENSOR_FRAME_DURATION, exposureNs);
            ext.setCaptureRequestOption(CaptureRequest.SENSOR_SENSITIVITY, iso);
            ext.setCaptureRequestOption(CaptureRequest.NOISE_REDUCTION_MODE,
                    CaptureRequest.NOISE_REDUCTION_MODE_HIGH_QUALITY);
            Log.i(TAG, "Night shot (" + (settings.manualExposure() ? "manual" : "auto")
                    + "): " + formatExposure(exposureNs) + " at ISO " + iso);
        } else {
            // No manual sensor: this is just a high-quality auto capture.
            Log.w(TAG, "Night shot without manual sensor support — auto exposure only");
        }

        final ImageCapture nightCapture = builder.build();

        try {
            provider.unbindAll();
            camera = provider.bindToLifecycle(lifecycleOwner, selector, nightCapture);
        } catch (Exception e) {
            Log.e(TAG, "could not bind the night capture", e);
            finishNightShot(settings);
            nightShotRunning.set(false);
            onError.accept("Could not bind the camera for a night shot: " + e.getMessage());
            return;
        }

        try {
            nightCapture.takePicture(analysisExecutor,
                    new ImageCapture.OnImageCapturedCallback() {
                        @Override
                        public void onCaptureSuccess(@NonNull ImageProxy image) {
                            byte[] jpeg;
                            try {
                                jpeg = toJpegBytes(image);
                            } finally {
                                image.close();
                            }
                            main.post(() -> {
                                finishNightShot(settings);
                                nightShotRunning.set(false);
                                onJpeg.accept(jpeg);
                            });
                        }

                        @Override
                        public void onError(@NonNull ImageCaptureException exception) {
                            Log.e(TAG, "night shot failed", exception);
                            main.post(() -> {
                                finishNightShot(settings);
                                nightShotRunning.set(false);
                                onError.accept("Capture failed: " + exception.getMessage());
                            });
                        }
                    });
        } catch (Exception e) {
            finishNightShot(settings);
            nightShotRunning.set(false);
            onError.accept("Could not start the capture: " + e.getMessage());
        }
    }

    /** Put the normal streaming configuration back. Main thread. */
    private void finishNightShot(Settings settings) {
        try {
            rebind(settings);
        } catch (Exception e) {
            Log.e(TAG, "could not restore the stream after a night shot", e);
        }
    }

    private static byte[] toJpegBytes(ImageProxy image) {
        ByteBuffer buf = image.getPlanes()[0].getBuffer();
        byte[] out = new byte[buf.remaining()];
        buf.get(out);
        return out;
    }

    // --- sensor limits ---------------------------------------------------------

    @OptIn(markerClass = ExperimentalCamera2Interop.class)
    private void readSensorLimits(CameraSelector selector) {
        exposureRange = null;
        isoRange = null;
        maxFrameDuration = null;
        manualSensor = false;
        aeRanges = null;
        try {
            List<CameraInfo> infos = selector.filter(provider.getAvailableCameraInfos());
            if (infos.isEmpty()) return;
            Camera2CameraInfo c2 = Camera2CameraInfo.from(infos.get(0));
            exposureRange = c2.getCameraCharacteristic(
                    CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE);
            isoRange = c2.getCameraCharacteristic(
                    CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE);
            maxFrameDuration = c2.getCameraCharacteristic(
                    CameraCharacteristics.SENSOR_INFO_MAX_FRAME_DURATION);
            int[] caps = c2.getCameraCharacteristic(
                    CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES);
            manualSensor = contains(caps,
                    CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR);
            aeRanges = c2.getCameraCharacteristic(
                    CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES);
            Log.i(TAG, "exposure " + exposureRange + " iso " + isoRange
                    + " maxFrame " + maxFrameDuration + " manual " + manualSensor
                    + " aeRanges " + java.util.Arrays.toString(aeRanges));
        } catch (Exception e) {
            Log.w(TAG, "could not read sensor characteristics", e);
        }
    }

    private static boolean contains(@Nullable int[] values, int wanted) {
        if (values == null) return false;
        for (int v : values) if (v == wanted) return true;
        return false;
    }

    /** Is the capture pipeline currently held down at the idle rate? */
    public boolean isCaptureIdle() { return captureIdle; }

    /**
     * Ask the SENSOR to slow down, or let it back up to speed.
     *
     * This is the lever that actually moves the battery needle, and it is
     * separate from the encoder-side idle throttle. Dropping the number of
     * JPEGs produced saves only the JPEG work; the camera stack carries on
     * capturing, debayering, 3A-ing and shuffling full-rate frames across the
     * MIPI link regardless, and on a small frame that pipeline dwarfs the
     * encode. Telling the sensor itself to produce two frames a second
     * instead of thirty is what shuts that down.
     *
     * Applied live rather than by rebinding, so going from idle to watched
     * does not black the stream out at the exact moment somebody looks at it.
     *
     * Returns false if it could not be applied at all.
     */
    public boolean setCaptureIdle(Settings settings, boolean idle) {
        if (captureIdle == idle && camera != null) return true;
        captureIdle = idle;
        if (applyLiveCaptureOptions(settings)) return true;
        // The request did not land — no camera bound, or the hardware refused.
        // Clearing the flag matters more than it looks: isCaptureIdle() drives
        // the status readout, so leaving it set would have the app reporting a
        // power saving that is definitely not happening. Given the whole point
        // of this feature is a number the user can verify on a meter, claiming
        // it falsely is worse than not having it.
        captureIdle = false;
        return false;
    }

    /**
     * Push new exposure/ISO values to a running session WITHOUT rebinding.
     *
     * Rebinding tears down and rebuilds the capture session, which blacks the
     * stream out for a moment — unacceptable for dragging a slider. The
     * Camera2 interop control pushes the same keys into the repeating request
     * instead, so the change lands on the next frame.
     *
     * Returns false if it could not be applied, in which case the caller
     * should fall back to a rebind.
     */
    public boolean applyManualExposureLive(Settings settings) {
        if (camera == null || !manualSensor || !settings.manualExposure()) return false;
        return applyLiveCaptureOptions(settings);
    }

    /**
     * Compose and push the COMPLETE set of live capture-request options.
     *
     * There is exactly one of these on purpose. setCaptureRequestOptions
     * REPLACES everything previously set through that API rather than merging,
     * so two features that each push their own subset will silently delete
     * each other's keys — manual exposure would wipe the idle frame rate, the
     * next idle transition would wipe AE-off and hand exposure back to auto.
     * Every key that should be live goes in here, together, every time.
     *
     * Returns false if the push failed, in which case the caller should fall
     * back to a rebind.
     */
    @OptIn(markerClass = ExperimentalCamera2Interop.class)
    public boolean applyLiveCaptureOptions(Settings settings) {
        Camera c = camera;
        if (c == null) return false;

        boolean idle = captureIdle;
        int idleFps = Math.max(1, settings.idleCaptureFps);
        boolean userManual = settings.manualExposure() && manualSensor;

        CaptureRequestOptions.Builder b = new CaptureRequestOptions.Builder();
        try {
            if (userManual) {
                // AE is off, so the frame rate is governed by
                // SENSOR_FRAME_DURATION and nothing else. Stretching that is
                // how capture slows down here; the exposure itself stays put
                // because the user picked it and a darker idle picture is not
                // what they asked for.
                long exposureNs = clampExposure(settings.manualExposureNs);
                int iso = clampIso(settings.manualIso);
                int fps = idle ? Math.min(idleFps, settings.targetFps) : settings.targetFps;
                long frameNs = frameDurationFor(exposureNs, fps);
                b.setCaptureRequestOption(CaptureRequest.CONTROL_AE_MODE,
                                CaptureRequest.CONTROL_AE_MODE_OFF)
                        .setCaptureRequestOption(CaptureRequest.SENSOR_EXPOSURE_TIME, exposureNs)
                        .setCaptureRequestOption(CaptureRequest.SENSOR_FRAME_DURATION, frameNs)
                        .setCaptureRequestOption(CaptureRequest.SENSOR_SENSITIVITY, iso);
            } else if (idle) {
                // AE is running. Hand it the slowest range the hardware
                // advertises that still tops out at or below the idle rate,
                // which both slows capture and lets it expose for longer.
                Range<Integer> range = pickAeRangeFor(idleFps);
                if (range == null) {
                    // Nothing suitable advertised: there is no safe way to ask
                    // for a slower capture on this device, so leave it alone
                    // rather than requesting a range it never listed.
                    captureIdle = false;
                    Camera2CameraControl.from(c.getCameraControl())
                            .setCaptureRequestOptions(
                                    new CaptureRequestOptions.Builder().build());
                    Log.i(TAG, "no slow AE range advertised; capture stays at full rate");
                    return false;
                }
                Log.i(TAG, "capture idle: AE fps range " + range);
                b.setCaptureRequestOption(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, range);
            }
            // else: watched and on auto — nothing to pin. An empty option set
            // is the correct thing to send, because it clears any idle range
            // or stale AE-off left behind by a previous state.

            Camera2CameraControl.from(c.getCameraControl())
                    .setCaptureRequestOptions(b.build());
            return true;
        } catch (Exception e) {
            Log.w(TAG, "live capture options failed, a rebind is needed", e);
            return false;
        }
    }

    /**
     * Clear anything the live path pushed, so a later AUTO bind is not left
     * with a stale AE-off sitting in the repeating request.
     */
    @OptIn(markerClass = ExperimentalCamera2Interop.class)
    public void clearLiveCaptureOptions() {
        Camera c = camera;
        captureIdle = false;
        if (c == null) return;
        try {
            Camera2CameraControl.from(c.getCameraControl())
                    .setCaptureRequestOptions(new CaptureRequestOptions.Builder().build());
        } catch (Exception e) {
            Log.w(TAG, "could not clear live capture options", e);
        }
    }

    /** Exposure for a given target fps, clamped to what the sensor allows. */
    private long manualExposureFor(int fps) {
        return longestExposure(1_000_000_000L / Math.max(1, fps));
    }

    /** Clamp a requested exposure into the sensor's advertised window. */
    public long clampExposure(long desiredNs) {
        long lo = 1L;
        long hi = Long.MAX_VALUE;
        Range<Long> range = exposureRange;
        if (range != null) {
            lo = range.getLower();
            hi = range.getUpper();
        }
        Long maxFrame = maxFrameDuration;
        if (maxFrame != null) hi = Math.min(hi, maxFrame);
        if (hi < lo) hi = lo;
        return Settings.clampLong(desiredNs, lo, hi);
    }

    /**
     * A frame can never be shorter than its own exposure, so the frame
     * duration is the longer of the exposure and the streaming interval — and
     * then capped at what the sensor accepts. Requesting a frame duration
     * above SENSOR_INFO_MAX_FRAME_DURATION is an invalid request, and some
     * devices reject the whole capture rather than clamping it for you.
     */
    public long frameDurationFor(long exposureNs, int targetFps) {
        long streamInterval = 1_000_000_000L / Math.max(1, targetFps);
        long frame = Math.max(exposureNs, streamInterval);
        Long maxFrame = maxFrameDuration;
        if (maxFrame != null) frame = Math.min(frame, maxFrame);
        // clampExposure already keeps exposureNs under maxFrame, so this only
        // matters if an unclamped value reaches here: a frame shorter than its
        // own exposure is an invalid request.
        return Math.max(frame, exposureNs);
    }

    /** Lowest night fps this sensor can actually make use of. */
    public int minUsefulNightFps() {
        return Settings.minUsefulNightFps(getExposureMaxNs());
    }

    /** Clamp a desired exposure to the sensor's range and max frame duration. */
    private long longestExposure(long desiredNs) {
        long ns = desiredNs;
        Range<Long> range = exposureRange;
        if (range != null) {
            ns = Math.min(ns, range.getUpper());
            // Below the sensor minimum the request is simply invalid.
            ns = Math.max(ns, range.getLower());
        }
        Long maxFrame = maxFrameDuration;
        if (maxFrame != null) ns = Math.min(ns, maxFrame);
        return ns;
    }

    /** Clamp to the sensor's own sensitivity range; the rails are only a guard. */
    public int clampIso(int desired) {
        int iso = Settings.clamp(desired, Settings.ISO_ABS_MIN, Settings.ISO_ABS_MAX);
        Range<Integer> range = isoRange;
        if (range != null) iso = Settings.clamp(iso, range.getLower(), range.getUpper());
        return iso;
    }

    // --- auto-exposure fallback helpers -----------------------------------------

    /**
     * Push auto-exposure brighter by a whole number of EV.
     *
     * setExposureCompensationIndex takes an INDEX, not EV — the device reports a
     * step (commonly 1/6 or 1/3 EV) and the index is counted in those steps. So
     * +2 EV on a 1/6-step device is index 12, not index 2.
     */
    private void applyExposureCompensation(int ev) {
        if (camera == null) return;
        try {
            Rational step = camera.getCameraInfo().getExposureState()
                    .getExposureCompensationStep();
            float stepEv = step == null ? 0f : step.floatValue();
            if (stepEv <= 0f) return;          // device does not support it
            int wanted = Math.round(ev / stepEv);
            Range<Integer> range = camera.getCameraInfo().getExposureState()
                    .getExposureCompensationRange();
            int clamped = Math.max(range.getLower(), Math.min(range.getUpper(), wanted));
            camera.getCameraControl().setExposureCompensationIndex(clamped);
            Log.i(TAG, "exposure compensation " + ev + "EV -> index " + clamped
                    + " (step " + stepEv + "EV)");
        } catch (Exception e) {
            Log.w(TAG, "exposure compensation unsupported", e);
        }
    }

    /**
     * Pick the advertised AE frame-rate range that permits the slowest capture,
     * i.e. the lowest lower bound, breaking ties on the lowest upper bound.
     *
     * The lower bound is what matters: it is the floor AE is allowed to drop to,
     * and therefore how long a single exposure can be. Only ranges the hardware
     * lists are ever requested — asking for one it does not advertise can stop
     * the camera opening at all.
     */
    @Nullable
    private Range<Integer> pickAeRange(CameraSelector selector) {
        Range<Integer>[] ranges = aeRanges;
        if (ranges == null || ranges.length == 0) return null;
        Range<Integer> best = null;
        for (Range<Integer> r : ranges) {
            if (r == null) continue;
            if (best == null
                    || r.getLower() < best.getLower()
                    || (r.getLower().equals(best.getLower())
                        && r.getUpper() < best.getUpper())) {
                best = r;
            }
        }
        return best;
    }

    /**
     * The advertised AE range best suited to capturing at about `fps`.
     *
     * Preference order: a range whose UPPER bound is at or below fps, because
     * the upper bound is the ceiling AE is allowed to run at and is therefore
     * what actually caps the capture rate — a [15,30] range would happily keep
     * running at 30. Among those, the one with the highest upper bound, so a
     * request for 2fps lands on [1,2] rather than needlessly on [1,1].
     *
     * Ties on the upper bound go to the WIDER range. Both cap the rate at the
     * same place, so neither is worse for power, but the wider one leaves
     * auto-exposure free to drop further and expose for longer — which is
     * exactly what is wanted from a camera sitting idle in a dark room.
     *
     * If nothing is that slow, returns null rather than inventing a range: a
     * CONTROL_AE_TARGET_FPS_RANGE the hardware never listed can stop the
     * camera opening at all, which is a far worse outcome than a phone that
     * keeps capturing at full speed.
     */
    @Nullable
    Range<Integer> pickAeRangeFor(int fps) {
        Range<Integer>[] ranges = aeRanges;
        if (ranges == null || ranges.length == 0) return null;
        Range<Integer> best = null;
        for (Range<Integer> r : ranges) {
            if (r == null || r.getUpper() > fps) continue;
            if (best == null
                    || r.getUpper() > best.getUpper()
                    || (r.getUpper().equals(best.getUpper())
                        && r.getLower() < best.getLower())) {
                best = r;
            }
        }
        return best;
    }

    /** Test seam: pretend the hardware advertised these AE ranges. */
    void setAeRangesForTest(@Nullable Range<Integer>[] ranges) {
        this.aeRanges = ranges;
    }
}
