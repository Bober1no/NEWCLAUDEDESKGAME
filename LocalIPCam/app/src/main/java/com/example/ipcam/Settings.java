package com.example.ipcam;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Size;

/**
 * All user-tunable settings, persisted to SharedPreferences.
 *
 * Fields are read live by the encoder/server on every frame, so changing fps or
 * quality takes effect immediately. Changing resolution, camera or night mode
 * requires a camera rebind (see CameraController.rebind).
 */
public class Settings {

    public static final String PREFS = "ipcam_settings";

    // --- Night mode behaviour ---------------------------------------------
    public enum NightMode {
        OFF,    // never slow down
        AUTO,   // slow down when the scene is dark
        ON      // always run in low-light mode
    }

    /** Who decides exposure: the camera, or the user. */
    public enum ExposureMode {
        AUTO,    // auto-exposure, plus the night logic when it engages
        MANUAL   // fixed exposure time and ISO, night logic suppressed
    }

    // --- Network -----------------------------------------------------------
    public int port = 8080;
    /**
     * When true (the default) the server binds ONLY to this device's LAN IPv4
     * address and refuses connections from anything that is not a local
     * address. Turning it off binds the wildcard, which includes the public
     * IPv6 address the ISP assigns — see NetworkUtils for why that matters.
     */
    public boolean lanOnly = true;
    public boolean authEnabled = true;
    public String username = "cam";
    public String password = "changeme";

    // --- Image -------------------------------------------------------------
    public int targetFps = 15;        // 1..30
    public int jpegQuality = 55;      // 10..95
    public int resolutionIndex = 1;   // index into RESOLUTIONS
    public boolean frontCamera = false;
    /**
     * camera2 ID of the chosen lens, or empty for the facing default. Lets
     * the ultra-wide and telephoto be picked where the device exposes them as
     * separate cameras.
     */
    public String cameraId = "";
    /** Optical/digital zoom factor; 0.5 reaches the ultra-wide on a logical camera. */
    public float zoomRatio = 1f;

    // --- Night mode --------------------------------------------------------
    /**
     * Sanity rails only, for parsing a value before the sensor's real
     * SENSOR_INFO_SENSITIVITY_RANGE is applied on top. The UI drives its
     * sliders from the sensor range, never from these.
     */
    public static final int ISO_ABS_MIN = 1;
    public static final int ISO_ABS_MAX = 102400;

    /** Exposure sliders run over this many logarithmic steps. */
    public static final int EXPOSURE_SLIDER_STEPS = 1000;

    // --- Exposure ----------------------------------------------------------
    public ExposureMode exposureMode = ExposureMode.AUTO;
    /** Used only in MANUAL. Default is 1/30s. */
    public long manualExposureNs = 33_333_333L;
    /** Used only in MANUAL. Clamped to the sensor's range when applied. */
    public int manualIso = 400;

    public NightMode nightMode = NightMode.AUTO;
    public int nightFps = 4;          // 1..15, the slow fps used in the dark
    /** Sensor gain used when night mode drives the sensor manually. */
    public int nightIso = 1600;       // clamped to the sensor range when applied
    public int nightEnterLuma = 45;   // avg Y below this => dark  (0..255)
    public int nightExitLuma = 75;    // avg Y above this => bright again
    public int nightExposureBoost = 2;// extra EV steps applied in night mode

    // --- Audio ---------------------------------------------------------------
    /** Off by default: a live microphone is more intrusive than a camera. */
    public boolean audioEnabled = false;
    /** Off by default: lets anyone who can reach the stream speak out of the phone. */
    public boolean talkbackEnabled = false;
    /** 8000 / 16000 / 44100. 16k is plenty for voice and a quarter the bandwidth. */
    public int audioSampleRate = 16000;
    /** Mute the microphone while talkback is playing, to stop feedback howl. */
    public boolean halfDuplex = true;

    /**
     * Software gain on the captured audio, 1.0 to 20.0.
     *
     * Phone microphones feeding a raw PCM stream are quiet: there is no
     * automatic gain in this path, unlike a voice call. 4x is a reasonable
     * starting point for a room; the level meter is there so it can be set by
     * looking rather than by guessing.
     */
    public float audioGain = 4.0f;
    public static final float AUDIO_GAIN_MIN = 1.0f;
    public static final float AUDIO_GAIN_MAX = 20.0f;

    /**
     * Gain applied to incoming talkback before it reaches the speaker,
     * 1.0 to 20.0. Synthesised speech and browser mic audio both arrive well
     * below full scale and nothing else amplifies them.
     */
    public float talkbackGain = 3.0f;

    /**
     * Play talkback through the loudspeaker at media volume rather than the
     * call stream. Off routes to the earpiece at in-call volume, which is
     * much quieter but keeps the echo canceller's reference intact.
     */
    public boolean talkbackLoudspeaker = true;

    public static final int[] AUDIO_RATES = {8000, 16000, 44100};
    public static final String[] AUDIO_RATE_LABELS = {
            "8 kHz (narrow, smallest)",
            "16 kHz (voice, recommended)",
            "44.1 kHz (full band, 88 KB/s)",
    };

    public static int audioRateIndex(int rate) {
        for (int i = 0; i < AUDIO_RATES.length; i++) if (AUDIO_RATES[i] == rate) return i;
        return 1;
    }

    // --- Battery -------------------------------------------------------------
    /**
     * Drop to a trickle of frames when nobody is watching the stream.
     *
     * An always-on camera is unwatched almost all the time, and encoding JPEGs
     * into a void is the most wasteful thing it can do. The camera itself
     * keeps running so a new viewer gets a picture straight away.
     */
    public boolean idleThrottle = true;

    /**
     * Frames per second the SENSOR is asked for while nobody is watching.
     *
     * Distinct from idleThrottle's effect on encoding, and much more
     * important. Encoding fewer frames saves the encode; asking the sensor
     * for fewer frames saves the capture, which on a small frame is most of
     * the cost. Only ranges the hardware advertises are ever requested, so on
     * a device that lists nothing slow this has no effect.
     */
    public int idleCaptureFps = 2;
    public static final int IDLE_CAPTURE_FPS_MIN = 1;
    public static final int IDLE_CAPTURE_FPS_MAX = 15;

    /** How the captured frame is rotated before encoding. */
    public enum RotationMode {
        AUTO,       // follow the device orientation, recomputed per frame
        NONE,       // no rotation at all: cheapest, for a fixed mount
        FIXED_90,
        FIXED_180,
        FIXED_270
    }

    public RotationMode rotationMode = RotationMode.AUTO;

    public static final String[] ROTATION_LABELS = {
            "Auto (follow device)",
            "None (cheapest)",
            "90\u00b0",
            "180\u00b0",
            "270\u00b0",
    };

    public static int rotationIndex(RotationMode m) {
        switch (m) {
            case NONE: return 1;
            case FIXED_90: return 2;
            case FIXED_180: return 3;
            case FIXED_270: return 4;
            default: return 0;
        }
    }

    public static RotationMode rotationFromIndex(int i) {
        switch (i) {
            case 1: return RotationMode.NONE;
            case 2: return RotationMode.FIXED_90;
            case 3: return RotationMode.FIXED_180;
            case 4: return RotationMode.FIXED_270;
            default: return RotationMode.AUTO;
        }
    }

    // --- Thermal guard -------------------------------------------------------
    //
    // A phone streaming 24/7 cooks itself, and sustained heat is what actually
    // kills the battery. These are battery temperatures, which lag the SoC by
    // a few degrees, so by the time the battery reads 42C the chip has been
    // hotter for a while.
    /** Start shedding load at this battery temperature. */
    public static final float THERMAL_THROTTLE_C = 42.0f;
    /** Stop streaming entirely at this one. */
    public static final float THERMAL_SHUTDOWN_C = 43.5f;
    /** Only recover once it has fallen back to here, so it cannot flap. */
    public static final float THERMAL_RECOVER_C = 40.0f;
    /** Resolution forced while throttled. */
    public static final int THERMAL_RESOLUTION_INDEX = 1;   // 640x480
    /** Frame rate ceiling while throttled. */
    public static final int THERMAL_FPS = 10;

    /** Runtime-only: true while the thermal guard is holding things back. */
    public volatile boolean thermalThrottled = false;

    // --- Misc --------------------------------------------------------------
    public boolean keepAwake = true;

    /** Runtime-only: true while the dark-scene logic is actually engaged. */
    public volatile boolean nightActive = false;
    /** Runtime-only: most recent average luminance, for the UI/status. */
    public volatile int lastLuma = -1;

    public static final Size[] RESOLUTIONS = {
            new Size(320, 240),
            new Size(640, 480),
            new Size(1280, 720),
            new Size(1920, 1080),
    };

    public static final String[] RESOLUTION_LABELS = {
            "320x240 (tiny)",
            "640x480 (default)",
            "1280x720 (HD)",
            "1920x1080 (full HD)",
    };

    /**
     * The resolution actually being streamed. The thermal guard overrides the
     * configured value rather than rewriting it, so recovery is just a matter
     * of clearing the flag and the user's own choice is never lost — even if
     * they change it while throttled.
     */
    public Size resolution() {
        if (thermalThrottled) return RESOLUTIONS[THERMAL_RESOLUTION_INDEX];
        return configuredResolution();
    }

    /** What the user picked, ignoring any thermal override. */
    public Size configuredResolution() {
        int i = Math.max(0, Math.min(RESOLUTIONS.length - 1, resolutionIndex));
        return RESOLUTIONS[i];
    }

    public boolean manualExposure() { return exposureMode == ExposureMode.MANUAL; }

    /** The fps the stream should actually run at right now. */
    public int effectiveFps() {
        int fps = exposureDrivenFps();
        // Heat outranks everything else, including a manual exposure.
        if (thermalThrottled) fps = Math.min(fps, THERMAL_FPS);
        return fps;
    }

    private int exposureDrivenFps() {
        // In MANUAL the user owns the exposure, so night mode does not get to
        // slow the stream down behind their back.
        if (manualExposure()) return targetFps;
        if (nightMode == Settings.NightMode.OFF) return targetFps;
        if (nightMode == Settings.NightMode.ON) return Math.min(nightFps, targetFps);
        return nightActive ? Math.min(nightFps, targetFps) : targetFps;
    }

    /** True if the NIGHT logic should be driving the sensor right now. */
    public boolean lowLightCapture() {
        if (manualExposure()) return false;   // manual wins outright
        if (nightMode == NightMode.OFF) return false;
        if (nightMode == NightMode.ON) return true;
        return nightActive;
    }

    // --- Persistence -------------------------------------------------------

    public static Settings load(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        Settings s = new Settings();
        s.port = p.getInt("port", s.port);
        s.lanOnly = p.getBoolean("lanOnly", s.lanOnly);
        s.authEnabled = p.getBoolean("authEnabled", s.authEnabled);
        s.username = p.getString("username", s.username);
        s.password = p.getString("password", s.password);
        s.targetFps = p.getInt("targetFps", s.targetFps);
        s.jpegQuality = p.getInt("jpegQuality", s.jpegQuality);
        s.resolutionIndex = p.getInt("resolutionIndex", s.resolutionIndex);
        s.frontCamera = p.getBoolean("frontCamera", s.frontCamera);
        s.cameraId = p.getString("cameraId", s.cameraId);
        s.zoomRatio = p.getFloat("zoomRatio", s.zoomRatio);
        s.nightMode = NightMode.valueOf(p.getString("nightMode", s.nightMode.name()));
        s.nightFps = p.getInt("nightFps", s.nightFps);
        s.nightIso = clamp(p.getInt("nightIso", s.nightIso), ISO_ABS_MIN, ISO_ABS_MAX);
        s.exposureMode = ExposureMode.valueOf(
                p.getString("exposureMode", s.exposureMode.name()));
        s.manualExposureNs = p.getLong("manualExposureNs", s.manualExposureNs);
        s.manualIso = clamp(p.getInt("manualIso", s.manualIso), ISO_ABS_MIN, ISO_ABS_MAX);
        s.nightEnterLuma = p.getInt("nightEnterLuma", s.nightEnterLuma);
        s.nightExitLuma = p.getInt("nightExitLuma", s.nightExitLuma);
        s.nightExposureBoost = p.getInt("nightExposureBoost", s.nightExposureBoost);
        s.keepAwake = p.getBoolean("keepAwake", s.keepAwake);
        s.idleThrottle = p.getBoolean("idleThrottle", s.idleThrottle);
        s.idleCaptureFps = clamp(p.getInt("idleCaptureFps", s.idleCaptureFps),
                IDLE_CAPTURE_FPS_MIN, IDLE_CAPTURE_FPS_MAX);

        s.rotationMode = RotationMode.valueOf(
                p.getString("rotationMode", s.rotationMode.name()));
        s.audioEnabled = p.getBoolean("audioEnabled", s.audioEnabled);
        s.talkbackEnabled = p.getBoolean("talkbackEnabled", s.talkbackEnabled);
        s.audioSampleRate = p.getInt("audioSampleRate", s.audioSampleRate);
        s.halfDuplex = p.getBoolean("halfDuplex", s.halfDuplex);
        s.audioGain = clampFloat(p.getFloat("audioGain", s.audioGain),
                AUDIO_GAIN_MIN, AUDIO_GAIN_MAX);
        s.talkbackGain = clampFloat(p.getFloat("talkbackGain", s.talkbackGain),
                AUDIO_GAIN_MIN, AUDIO_GAIN_MAX);
        s.talkbackLoudspeaker = p.getBoolean("talkbackLoudspeaker", s.talkbackLoudspeaker);
        return s;
    }

    public void save(Context ctx) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putInt("port", port)
                .putBoolean("lanOnly", lanOnly)
                .putBoolean("authEnabled", authEnabled)
                .putString("username", username)
                .putString("password", password)
                .putInt("targetFps", targetFps)
                .putInt("jpegQuality", jpegQuality)
                .putInt("resolutionIndex", resolutionIndex)
                .putBoolean("frontCamera", frontCamera)
                .putString("cameraId", cameraId == null ? "" : cameraId)
                .putFloat("zoomRatio", zoomRatio)
                .putString("nightMode", nightMode.name())
                .putInt("nightFps", nightFps)
                .putInt("nightIso", nightIso)
                .putString("exposureMode", exposureMode.name())
                .putLong("manualExposureNs", manualExposureNs)
                .putInt("manualIso", manualIso)
                .putInt("nightEnterLuma", nightEnterLuma)
                .putInt("nightExitLuma", nightExitLuma)
                .putInt("nightExposureBoost", nightExposureBoost)
                .putBoolean("keepAwake", keepAwake)
                .putBoolean("idleThrottle", idleThrottle)
                .putInt("idleCaptureFps", idleCaptureFps)

                .putString("rotationMode", rotationMode.name())
                .putBoolean("audioEnabled", audioEnabled)
                .putBoolean("talkbackEnabled", talkbackEnabled)
                .putInt("audioSampleRate", audioSampleRate)
                .putBoolean("halfDuplex", halfDuplex)
                .putFloat("audioGain", audioGain)
                .putFloat("talkbackGain", talkbackGain)
                .putBoolean("talkbackLoudspeaker", talkbackLoudspeaker)
                .apply();
    }

    public static int clamp(int v, int lo, int hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    }

    public static float clampFloat(float v, float lo, float hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    }

    public static long clampLong(long v, long lo, long hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    }

    // --- exposure slider scale ------------------------------------------------
    //
    // Exposure is logarithmic to the eye: the step from 1/8000s to 1/4000s
    // matters as much as 1/4s to 1/2s. A linear slider over a range like
    // 85,000ns..100,000,000ns would spend 99% of its travel in exposures too
    // short to see any difference in, so the scale is geometric instead.

    /** Slider position (0..EXPOSURE_SLIDER_STEPS) to an exposure in nanoseconds. */
    public static long sliderToExposureNs(int position, long minNs, long maxNs) {
        if (minNs <= 0 || maxNs <= minNs) return minNs > 0 ? minNs : 33_333_333L;
        double frac = clamp(position, 0, EXPOSURE_SLIDER_STEPS)
                / (double) EXPOSURE_SLIDER_STEPS;
        double ns = minNs * Math.pow((double) maxNs / (double) minNs, frac);
        return clampLong(Math.round(ns), minNs, maxNs);
    }

    /** Inverse of sliderToExposureNs. */
    public static int exposureNsToSlider(long ns, long minNs, long maxNs) {
        if (minNs <= 0 || maxNs <= minNs) return 0;
        long clamped = clampLong(ns, minNs, maxNs);
        double frac = Math.log((double) clamped / (double) minNs)
                / Math.log((double) maxNs / (double) minNs);
        return clamp((int) Math.round(frac * EXPOSURE_SLIDER_STEPS),
                0, EXPOSURE_SLIDER_STEPS);
    }

    /**
     * Lowest night fps worth offering: below this the sensor cannot expose any
     * longer anyway, so the slider would promise light it can't deliver.
     */
    public static int minUsefulNightFps(long maxExposureNs) {
        if (maxExposureNs <= 0) return 1;
        return Math.max(1, (int) Math.ceil(1_000_000_000.0 / maxExposureNs));
    }

    // --- optics ----------------------------------------------------------------

    /** 35mm full-frame diagonal, the reference for "equivalent" focal lengths. */
    public static final double FULL_FRAME_DIAGONAL_MM = 43.2666;

    /**
     * 35mm-equivalent focal length from a lens's real focal length and the
     * physical size of the sensor behind it.
     *
     * The raw focal length says nothing on its own: 5.4mm is a normal lens on
     * a phone sensor and an extreme fisheye on full frame. Scaling by the
     * sensor diagonal is what makes the numbers comparable, and it is what
     * turns "1.8mm on a 1/3-inch sensor" into the 13mm-equivalent that the
     * stock camera app prints as 0.5x.
     *
     * Returns -1 when the inputs are not usable.
     */
    public static float equiv35mm(float focalMm, float sensorWidthMm, float sensorHeightMm) {
        if (focalMm <= 0 || sensorWidthMm <= 0 || sensorHeightMm <= 0) return -1f;
        double diagonal = Math.hypot(sensorWidthMm, sensorHeightMm);
        if (diagonal <= 0) return -1f;
        return (float) (focalMm * FULL_FRAME_DIAGONAL_MM / diagonal);
    }

    /**
     * Parse an exposure written as raw nanoseconds ("33333333"), a shutter
     * fraction ("1/30", "3/1000") or seconds ("0.5s").
     */
    public static long parseExposureNs(String raw) {
        String t = raw == null ? "" : raw.trim().toLowerCase();
        if (t.isEmpty()) throw new NumberFormatException("empty exposure");
        if (t.contains("/")) {
            String[] parts = t.split("/", 2);
            double num = parts[0].isEmpty() ? 1.0 : Double.parseDouble(parts[0].trim());
            double den = Double.parseDouble(parts[1].trim().replace("s", ""));
            if (den <= 0) throw new NumberFormatException("bad shutter fraction: " + raw);
            return Math.round(1_000_000_000.0 * num / den);
        }
        if (t.endsWith("ms")) {
            return Math.round(Double.parseDouble(t.substring(0, t.length() - 2)) * 1_000_000.0);
        }
        if (t.endsWith("s")) {
            return Math.round(Double.parseDouble(t.substring(0, t.length() - 1)) * 1_000_000_000.0);
        }
        return Long.parseLong(t);
    }
}
