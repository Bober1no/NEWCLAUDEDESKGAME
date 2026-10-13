package com.example.ipcam;

import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraMetadata;
import android.util.Log;
import android.util.SizeF;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.camera.camera2.interop.Camera2CameraInfo;
import androidx.camera.camera2.interop.ExperimentalCamera2Interop;
import androidx.camera.core.CameraFilter;
import androidx.camera.core.CameraInfo;
import androidx.camera.core.CameraSelector;
import androidx.camera.lifecycle.ProcessCameraProvider;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * One selectable lens, and the logic for finding them.
 *
 * WHY THIS IS NOT JUST "PICK CAMERA 2"
 * ------------------------------------
 * A phone with 0.5x / 1x / 3x lenses can present them to apps in two very
 * different ways, and which one you get is up to the vendor and the firmware:
 *
 *   SEPARATE PHYSICAL CAMERAS
 *     Each lens is its own camera2 ID, and an app binds the one it wants.
 *     This is what most Samsung firmware does for the rear cameras.
 *
 *   ONE LOGICAL CAMERA
 *     A single camera ID covers all the glass and switches between lenses
 *     internally as the zoom ratio crosses thresholds. The app never picks a
 *     lens; it asks for 0.5x or 3x and the camera decides. You can spot this
 *     because the zoom range runs below 1.0.
 *
 * Some devices do both, and some expose the aux lenses only to the system
 * camera app. So rather than hard-coding IDs, this enumerates what the device
 * actually reports and works out each lens's zoom factor from its optics.
 *
 * The factor comes from the 35mm-equivalent focal length:
 *     equiv35 = focalLength_mm * 43.27 / sensorDiagonal_mm
 * and then each lens is expressed relative to the main camera, which is the
 * one CameraX would have given you by default. An ultra-wide at 13mm-equiv
 * against a 26mm-equiv main lens comes out at 0.5x, which is exactly the
 * number printed in the stock camera app.
 */
public final class CameraLens {

    private static final String TAG = "CameraLens";

    public final String cameraId;
    public final boolean front;
    /** Zoom relative to the main camera of the same facing. 1.0 = main. */
    public final float zoomFactor;
    /** 35mm-equivalent focal length in mm, or -1 when it could not be worked out. */
    public final float equiv35mm;
    public final String label;

    CameraLens(String cameraId, boolean front, float zoomFactor,
               float equiv35mm, String label) {
        this.cameraId = cameraId;
        this.front = front;
        this.zoomFactor = zoomFactor;
        this.equiv35mm = equiv35mm;
        this.label = label;
    }

    /** A selector that resolves to exactly this physical camera. */
    public CameraSelector selector() {
        return byId(cameraId);
    }

    @NonNull
    @Override
    public String toString() { return label; }

    // --- selectors -----------------------------------------------------------

    /** Selector matching one camera2 ID. */
    @OptIn(markerClass = ExperimentalCamera2Interop.class)
    public static CameraSelector byId(final String id) {
        return new CameraSelector.Builder()
                .addCameraFilter(new CameraFilter() {
                    @NonNull
                    @Override
                    public List<CameraInfo> filter(@NonNull List<CameraInfo> infos) {
                        List<CameraInfo> out = new ArrayList<>();
                        for (CameraInfo info : infos) {
                            try {
                                if (id.equals(Camera2CameraInfo.from(info).getCameraId())) {
                                    out.add(info);
                                }
                            } catch (Exception ignored) { }
                        }
                        return out;
                    }
                })
                .build();
    }

    // --- enumeration ---------------------------------------------------------

    /**
     * Every camera the device exposes to us, labelled with its zoom factor and
     * sorted wide-to-long, back cameras first.
     */
    @OptIn(markerClass = ExperimentalCamera2Interop.class)
    public static List<CameraLens> enumerate(ProcessCameraProvider provider) {
        List<CameraLens> lenses = new ArrayList<>();
        try {
            List<CameraInfo> all = provider.getAvailableCameraInfos();

            // The main camera of each facing is whatever CameraX would pick by
            // default; everything else is expressed relative to it.
            String mainBackId = resolveId(CameraSelector.DEFAULT_BACK_CAMERA, all);
            String mainFrontId = resolveId(CameraSelector.DEFAULT_FRONT_CAMERA, all);
            float backRef = equiv35For(all, mainBackId);
            float frontRef = equiv35For(all, mainFrontId);

            for (CameraInfo info : all) {
                String id;
                Integer facing;
                try {
                    Camera2CameraInfo c2 = Camera2CameraInfo.from(info);
                    id = c2.getCameraId();
                    facing = c2.getCameraCharacteristic(CameraCharacteristics.LENS_FACING);
                } catch (Exception e) {
                    continue;
                }
                boolean isFront = facing != null && facing == CameraMetadata.LENS_FACING_FRONT;
                // External / unknown facing cameras are not useful here.
                if (facing != null
                        && facing != CameraMetadata.LENS_FACING_FRONT
                        && facing != CameraMetadata.LENS_FACING_BACK) {
                    continue;
                }

                float equiv = equiv35(info);
                float ref = isFront ? frontRef : backRef;
                float factor = (equiv > 0 && ref > 0) ? equiv / ref : 1f;
                boolean isMain = id.equals(isFront ? mainFrontId : mainBackId);
                if (isMain) factor = 1f;

                lenses.add(new CameraLens(id, isFront, factor, equiv,
                        describe(factor, isFront, equiv)));
            }

            // Wide to long, rear cameras before the selfie camera.
            Collections.sort(lenses, (a, b) -> {
                if (a.front != b.front) return a.front ? 1 : -1;
                return Float.compare(a.zoomFactor, b.zoomFactor);
            });

            for (CameraLens l : lenses) {
                Log.i(TAG, "lens id=" + l.cameraId + " " + l.label
                        + " equiv35=" + l.equiv35mm + "mm factor=" + l.zoomFactor);
            }
        } catch (Exception e) {
            Log.w(TAG, "could not enumerate cameras", e);
        }
        return lenses;
    }

    @OptIn(markerClass = ExperimentalCamera2Interop.class)
    @Nullable
    private static String resolveId(CameraSelector selector, List<CameraInfo> all) {
        try {
            List<CameraInfo> matched = selector.filter(all);
            if (matched.isEmpty()) return null;
            return Camera2CameraInfo.from(matched.get(0)).getCameraId();
        } catch (Exception e) {
            return null;
        }
    }

    @OptIn(markerClass = ExperimentalCamera2Interop.class)
    private static float equiv35For(List<CameraInfo> all, @Nullable String id) {
        if (id == null) return -1f;
        for (CameraInfo info : all) {
            try {
                if (id.equals(Camera2CameraInfo.from(info).getCameraId())) {
                    return equiv35(info);
                }
            } catch (Exception ignored) { }
        }
        return -1f;
    }

    /**
     * 35mm-equivalent focal length, or -1 if the device does not report the
     * optics. Short focal length on a small sensor is still wide, which is why
     * the physical sensor size has to come into it.
     */
    @OptIn(markerClass = ExperimentalCamera2Interop.class)
    static float equiv35(CameraInfo info) {
        try {
            Camera2CameraInfo c2 = Camera2CameraInfo.from(info);
            float[] focals = c2.getCameraCharacteristic(
                    CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS);
            SizeF size = c2.getCameraCharacteristic(
                    CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE);
            if (focals == null || focals.length == 0 || size == null) return -1f;
            // focals[0] is the native focal length on a fixed-focal lens.
            return Settings.equiv35mm(focals[0], size.getWidth(), size.getHeight());
        } catch (Exception e) {
            return -1f;
        }
    }

    private static String describe(float factor, boolean front, float equiv) {
        if (front) return "Front";
        String x = formatFactor(factor);
        String kind;
        if (factor < 0.8f) kind = "ultra-wide";
        else if (factor <= 1.2f) kind = "main";
        else kind = "telephoto";
        if (equiv > 0) {
            return String.format(Locale.US, "%s %s (%.0fmm)", x, kind, equiv);
        }
        return x + " " + kind;
    }

    /** "0.5x", "1x", "3x" — no trailing zeros on whole numbers. */
    public static String formatFactor(float factor) {
        if (Math.abs(factor - Math.round(factor)) < 0.05f) {
            return Math.round(factor) + "x";
        }
        return String.format(Locale.US, "%.1fx", factor);
    }
}
