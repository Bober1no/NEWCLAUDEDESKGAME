package com.example.ipcam;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.Manifest;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.BatteryManager;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.wifi.WifiManager;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.text.format.Formatter;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.LifecycleService;

import com.google.common.util.concurrent.ListenableFuture;

import java.io.IOException;
import java.net.InetAddress;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Holds the camera and the HTTP server for as long as streaming is on.
 *
 * The camera lives here rather than in the Activity so the stream survives the
 * app being backgrounded or the screen going off. Android requires a visible
 * ongoing notification for a camera foreground service, so this can never run
 * hidden from whoever is holding the phone.
 */
public class StreamService extends LifecycleService
        implements MjpegServer.Host, FrameEncoder.LumaListener {

    private static final String TAG = "StreamService";
    private static final String CHANNEL_ID = "ipcam_stream";
    private static final String ALERT_CHANNEL_ID = "ipcam_alerts";
    private static final int NOTIF_ID = 1;
    /** Separate id so the heat alert survives the foreground notification going away. */
    private static final int ALERT_NOTIF_ID = 2;

    /** How often the battery temperature is checked while streaming. */
    private static final long THERMAL_CHECK_MS = 5_000L;


    public static final String ACTION_START = "com.example.ipcam.START";
    public static final String ACTION_STOP = "com.example.ipcam.STOP";

    /** Callback so the UI can refresh when state changes underneath it. */
    public interface StateListener {
        void onStateChanged();
    }

    public class LocalBinder extends Binder {
        public StreamService getService() { return StreamService.this; }
    }

    private final IBinder binder = new LocalBinder();
    private final Handler main = new Handler(Looper.getMainLooper());

    private Settings settings;
    private MjpegServer server;
    private CameraController cameraController;
    private ExecutorService analysisExecutor;
    private PowerManager.WakeLock wakeLock;
    @Nullable private ConnectivityManager.NetworkCallback netCallback;
    @Nullable private AudioHub audioHub;
    private final SayQueue sayQueue = new SayQueue();

    private final ThermalGuard thermalGuard = new ThermalGuard();
    private volatile float lastTempC = -1f;
    @Nullable private volatile String thermalNote = null;

    private final Runnable thermalWatchdog = new Runnable() {
        @Override public void run() {
            checkTemperature();
            // Piggybacked on the same tick rather than given a timer of its
            // own: a second repeating alarm would wake the CPU twice as often
            // for no benefit, which on a battery-sensitive app would be a
            // silly way to spend the savings.
            applyCaptureIdle();
            if (streaming) main.postDelayed(this, THERMAL_CHECK_MS);
        }
    };
    private final java.util.concurrent.atomic.AtomicBoolean rebindInFlight =
            new java.util.concurrent.atomic.AtomicBoolean(false);
    private final java.util.concurrent.atomic.AtomicBoolean nightShotInFlight =
            new java.util.concurrent.atomic.AtomicBoolean(false);
    /** Frees the night-shot guard if a capture never calls back at all. */
    private static final long NIGHT_SHOT_TIMEOUT_MS = 20_000L;

    /** Belt-and-braces poll in case the network callback never fires. */
    private static final long ADDRESS_CHECK_MS = 15_000L;
    private final Runnable addressWatchdog = new Runnable() {
        @Override public void run() {
            checkBinding();
            if (streaming) main.postDelayed(this, ADDRESS_CHECK_MS);
        }
    };

    @Nullable private StateListener stateListener;

    private boolean streaming = false;
    private boolean cameraReady = false;
    @Nullable private String lastError = null;
    @Nullable private String audioError = null;

    // Night-mode hysteresis counters.
    private int darkFrames = 0;
    private int brightFrames = 0;
    private long lastRebindAt = 0L;

    // --- lifecycle ---------------------------------------------------------

    @Override
    public void onCreate() {
        super.onCreate();
        CrashLog.install(this);
        settings = Settings.load(this);
        analysisExecutor = Executors.newSingleThreadExecutor();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        super.onStartCommand(intent, flags, startId);

        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            stopStreaming();
            stopSelf();
            return START_NOT_STICKY;
        }

        startInForeground();
        startStreaming();
        return START_NOT_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        super.onBind(intent);
        return binder;
    }

    @Override
    public void onDestroy() {
        stopStreaming();
        if (analysisExecutor != null) analysisExecutor.shutdown();
        super.onDestroy();
    }

    // --- streaming control -------------------------------------------------

    /**
     * Declare what this service is doing. From Android 14 the type must match
     * what the service actually uses and the matching permission must be
     * held, so the microphone type is only claimed once audio is on AND
     * RECORD_AUDIO has been granted — claiming it otherwise throws.
     */
    private void startInForeground() {
        int type = 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            type = ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                    && settings.audioEnabled && hasMicPermission()) {
                type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
            }
        }
        try {
            ServiceCompat.startForeground(this, NOTIF_ID, buildNotification(), type);
        } catch (Exception e) {
            // If the microphone type is refused, carry on with camera only
            // rather than letting the whole service die.
            Log.e(TAG, "startForeground with type " + type + " failed", e);
            try {
                ServiceCompat.startForeground(this, NOTIF_ID, buildNotification(),
                        Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                                ? ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA : 0);
            } catch (Exception fatal) {
                Log.e(TAG, "startForeground failed outright", fatal);
            }
        }
    }

    private void startStreaming() {
        if (streaming) return;
        streaming = true;

        acquireWakeLock();

        lastError = null;
        server = new MjpegServer(this, settings.port);
        try {
            server.start();
        } catch (Exception e) {
            Log.e(TAG, "Server failed to start on port " + settings.port, e);
            lastError = e.getMessage() != null ? e.getMessage()
                    : "Could not open port " + settings.port;
            streaming = false;
            server = null;
            releaseWakeLock();
            notifyState();
            stopSelf();
            return;
        }

        ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(this);
        future.addListener(() -> {
            try {
                ProcessCameraProvider provider = future.get();
                cameraController = new CameraController(provider, this, analysisExecutor);
                cameraController.setAnalyzer(new FrameEncoder(server, settings, this));
                cameraController.rebind(settings);
                cameraReady = true;
                syncAudio();
                thermalGuard.reset();
                main.postDelayed(thermalWatchdog, THERMAL_CHECK_MS);
                registerNetworkWatch();
                main.postDelayed(addressWatchdog, ADDRESS_CHECK_MS);
                notifyState();
                updateNotification();
            } catch (Exception e) {
                Log.e(TAG, "Camera setup failed", e);
                stopStreaming();
                stopSelf();
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private void stopStreaming() {
        if (!streaming) return;
        streaming = false;
        cameraReady = false;
        main.removeCallbacks(addressWatchdog);
        main.removeCallbacks(thermalWatchdog);
        // Leave thermalNote in place so the UI can still explain why.
        settings.thermalThrottled = false;
        unregisterNetworkWatch();
        if (audioHub != null) {
            audioHub.shutdown();
            audioHub = null;
        }
        // Anything still queued belongs to a session that is over; speaking it
        // the next time the stream starts would be surprising.
        sayQueue.clear();
        audioError = null;
        if (cameraController != null) {
            cameraController.unbind();
            cameraController = null;
        }
        if (server != null) {
            server.stop();
            server = null;
        }
        releaseWakeLock();
        notifyState();
    }

    public boolean isStreaming() { return streaming && cameraReady; }

    @Nullable public String getLastError() { return lastError; }

    /** Human-readable description of what the socket is actually bound to. */
    public String bindingLabel() {
        if (server == null) return "not listening";
        java.net.InetAddress a = server.getBoundAddress();
        if (a != null) return a.getHostAddress() + " only";
        int pub = NetworkUtils.publicAddresses().size();
        return pub > 0
                ? "ALL interfaces, incl. " + pub + " public address(es)"
                : "all interfaces";
    }

    public Settings getSettings() { return settings; }

    public int getViewerCount() { return server == null ? 0 : server.getViewerCount(); }

    public void setStateListener(@Nullable StateListener l) { this.stateListener = l; }

    private void notifyState() {
        main.post(() -> {
            if (stateListener != null) stateListener.onStateChanged();
        });
    }

    // --- preview attach/detach from the Activity ---------------------------

    public void attachPreview(Preview.SurfaceProvider sp) {
        if (cameraController == null) return;
        cameraController.setSurfaceProvider(sp);
        main.post(() -> {
            if (cameraController != null) cameraController.rebind(settings);
        });
    }

    public void detachPreview() {
        if (cameraController == null) return;
        cameraController.setSurfaceProvider(null);
        main.post(() -> {
            if (cameraController != null) cameraController.rebind(settings);
        });
    }

    // --- settings changes from the UI --------------------------------------

    /** Apply settings that need no camera rebind (fps, quality, auth...). */
    public void applySettingsLight() {
        settings.save(this);
        updateNotification();
        notifyState();
    }

    /** Apply settings that need the camera restarted (resolution, night, lens). */
    public void applySettingsWithRebind() {
        settings.save(this);
        main.post(() -> {
            if (cameraController != null) cameraController.rebind(settings);
            updateNotification();
            notifyState();
        });
    }

    /**
     * Apply a changed manual exposure or ISO. Tries the live path first so a
     * slider drag does not black the stream out; falls back to a rebind only
     * if the camera refuses.
     */
    public void applyManualExposure() {
        settings.save(this);
        main.post(() -> {
            CameraController cc = cameraController;
            if (cc == null) return;
            if (!cc.applyManualExposureLive(settings)) {
                cc.rebind(settings);
            }
            updateNotification();
            notifyState();
        });
    }

    /**
     * Switch between AUTO and MANUAL. This one genuinely needs a rebind: the
     * capture request is built with the use case, and the live options have to
     * be cleared on the way back to AUTO or AE would stay switched off.
     */
    public void applyExposureMode() {
        settings.save(this);
        main.post(() -> {
            CameraController cc = cameraController;
            if (cc == null) return;
            if (!settings.manualExposure()) cc.clearLiveCaptureOptions();
            cc.rebind(settings);
            updateNotification();
            notifyState();
        });
    }

    public void setZoom(float linear) {
        if (cameraController != null) cameraController.setLinearZoom(linear);
    }

    public float getZoom() {
        return cameraController == null ? 0f : cameraController.getLinearZoom();
    }

    public void setTorch(boolean on) {
        if (cameraController != null) cameraController.setTorch(on);
    }

    public boolean isTorchOn() {
        return cameraController != null && cameraController.isTorchOn();
    }

    public boolean hasFlash() {
        return cameraController != null && cameraController.hasFlashUnit();
    }

    // --- surviving a DHCP lease change --------------------------------------

    /**
     * LAN-only mode binds one specific address, so if the router hands the
     * phone a different IP the socket is left on an address the device no
     * longer owns and quietly stops serving. Watch for that and move the
     * listener instead of making the user notice and restart.
     *
     * A DHCP reservation on the router is still worth setting — it keeps the
     * URL stable, and you need a fixed address for the inbound-IPv6 block rule
     * anyway. This just means forgetting to do it is not a silent failure.
     */
    private void registerNetworkWatch() {
        if (netCallback != null) return;
        ConnectivityManager cm = getSystemService(ConnectivityManager.class);
        if (cm == null) return;
        netCallback = new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(@NonNull Network n) {
                main.post(StreamService.this::checkBinding);
            }
            @Override public void onLost(@NonNull Network n) {
                main.post(StreamService.this::checkBinding);
            }
            @Override public void onLinkPropertiesChanged(@NonNull Network n,
                                                          @NonNull LinkProperties lp) {
                // This is the one that fires on a DHCP renewal with a new lease.
                main.post(StreamService.this::checkBinding);
            }
        };
        try {
            cm.registerDefaultNetworkCallback(netCallback);
        } catch (Exception e) {
            Log.w(TAG, "could not register network callback", e);
            netCallback = null;
        }
    }

    private void unregisterNetworkWatch() {
        if (netCallback == null) return;
        try {
            ConnectivityManager cm = getSystemService(ConnectivityManager.class);
            if (cm != null) cm.unregisterNetworkCallback(netCallback);
        } catch (Exception ignored) { }
        netCallback = null;
    }

    /** Compare the address we are bound to against the one we now have. */
    private void checkBinding() {
        if (!streaming || server == null || !settings.lanOnly) return;
        // Enumerating interfaces and binding a socket can both block briefly,
        // and rebinding waits on the old accept thread. None of that belongs on
        // the main thread, so hand it to a worker. The flag stops the network
        // callback and the watchdog from piling up on each other.
        if (!rebindInFlight.compareAndSet(false, true)) return;
        new Thread(() -> {
            try {
                doCheckBinding();
            } finally {
                rebindInFlight.set(false);
            }
        }, "ipcam-rebind").start();
    }

    private void doCheckBinding() {
        if (!streaming || server == null || !settings.lanOnly) return;

        InetAddress bound = server.getBoundAddress();
        InetAddress current = NetworkUtils.getLanIpv4();

        if (current == null) {
            lastError = "Local network unavailable — stream is unreachable until Wi-Fi returns.";
            notifyState();
            return;
        }
        if (bound != null && bound.equals(current)) {
            if (lastError != null) { lastError = null; notifyState(); }
            return;
        }

        try {
            server.rebindTo(current);
            lastError = null;
            Log.i(TAG, "Address changed, now serving on " + current.getHostAddress());
            main.post(this::updateNotification);
            notifyState();
        } catch (IOException e) {
            lastError = "Address changed to " + current.getHostAddress()
                    + " but could not rebind: " + e.getMessage();
            Log.e(TAG, lastError, e);
            notifyState();
        }
    }

    // --- capture-rate idling ------------------------------------------------

    /** Called by the HTTP server when a stream client comes or goes. */
    @Override
    public void onViewersChanged(int viewers) {
        applyCaptureIdle();
        notifyState();
    }

    /**
     * Decide whether the SENSOR should be running slowly, and tell it.
     *
     * This is the one that actually reduces battery draw. The older idle
     * throttle only stopped the app encoding frames; the camera stack kept
     * capturing at the full rate into a bin, which on a small frame is the
     * bigger cost by a wide margin and is why switching the encoder off
     * measured as approximately nothing.
     */
    private void applyCaptureIdle() {
        if (!streaming) return;
        final boolean idle = shouldCaptureIdle();
        main.post(() -> {
            CameraController cc = cameraController;
            if (cc == null) return;
            cc.setCaptureIdle(settings, idle);
        });
    }

    private boolean shouldCaptureIdle() {
        if (!settings.idleThrottle) return false;
        if (!streaming || !cameraReady) return false;
        // A long-exposure still needs the sensor under its own control.
        if (nightShotInFlight.get()) return false;
        return server == null || server.getViewerCount() == 0;
    }

    /** True while the capture rate is actually being held down. */
    public boolean isCaptureIdle() {
        CameraController cc = cameraController;
        return cc != null && cc.isCaptureIdle();
    }

    // --- night mode detection ----------------------------------------------

    @Override
    public void onLuma(int luma) {
        settings.lastLuma = luma;
        // Keep measuring brightness for the readout, but never let the night
        // logic touch the sensor while the user is driving it by hand.
        if (settings.manualExposure()) return;
        if (settings.nightMode != Settings.NightMode.AUTO) return;

        if (luma < settings.nightEnterLuma) {
            darkFrames++;
            brightFrames = 0;
        } else if (luma > settings.nightExitLuma) {
            brightFrames++;
            darkFrames = 0;
        } else {
            // Between the two thresholds: no opinion, let the counters decay.
            if (darkFrames > 0) darkFrames--;
            if (brightFrames > 0) brightFrames--;
        }

        boolean want = settings.nightActive;
        if (!settings.nightActive && darkFrames >= 15) want = true;
        else if (settings.nightActive && brightFrames >= 30) want = false;

        if (want != settings.nightActive) {
            long now = System.currentTimeMillis();
            // Don't thrash the camera if the light is flickering.
            if (now - lastRebindAt < 3000) return;
            lastRebindAt = now;
            settings.nightActive = want;
            darkFrames = 0;
            brightFrames = 0;
            Log.i(TAG, "Night mode " + (want ? "engaged" : "released") + " (luma " + luma + ")");
            main.post(() -> {
                if (cameraController != null) cameraController.rebind(settings);
                updateNotification();
                notifyState();
            });
        }
    }

    // --- thermal guard ------------------------------------------------------

    public float getLastTempC() { return lastTempC; }
    public boolean isThermalThrottled() { return settings.thermalThrottled; }
    @Nullable public String getThermalNote() { return thermalNote; }

    /**
     * Shed load before the phone cooks itself.
     *
     * Sustained heat, not peak heat, is what kills a battery, and a phone
     * streaming around the clock has no duty cycle to recover in. Battery
     * temperature lags the SoC by several degrees, so 42C at the battery
     * means the chip has been considerably hotter for a while already.
     *
     * Two stages: throttle to 480p and 10fps first, and if that is not enough
     * stop altogether. Recovery waits for a lower temperature than the one
     * that triggered throttling, so it cannot oscillate on a borderline
     * reading, and it restores the user's settings rather than a guess —
     * the guard overrides the values, it never rewrites them.
     */
    private void checkTemperature() {
        if (!streaming) return;
        Battery bat = readBattery();
        float t = bat.temperatureC;
        lastTempC = t;

        switch (thermalGuard.step(t)) {
            case THROTTLE:
                engageThrottle(t);
                break;
            case RECOVER:
                releaseThrottle(t);
                break;
            case SHUTDOWN:
                thermalShutdown(t);
                break;
            default:
                break;
        }
    }

    private void engageThrottle(float t) {
        settings.thermalThrottled = true;
        thermalNote = String.format(Locale.US,
                "Hot (%.1f C): dropped to 480p at %d fps until it cools to %.0f C.",
                t, Settings.THERMAL_FPS, Settings.THERMAL_RECOVER_C);
        Log.w(TAG, thermalNote);
        // The torch is a heater as much as a light.
        if (isTorchOn()) setTorch(false);
        if (cameraController != null) cameraController.rebind(settings);
        updateNotification();
        notifyState();
    }

    private void releaseThrottle(float t) {
        settings.thermalThrottled = false;
        thermalNote = String.format(Locale.US,
                "Cooled to %.1f C: back to the configured resolution and frame rate.", t);
        Log.i(TAG, thermalNote);
        if (cameraController != null) cameraController.rebind(settings);
        updateNotification();
        notifyState();
        // Clear the note after a while so it does not sit there forever.
        main.postDelayed(() -> {
            if (!settings.thermalThrottled) {
                thermalNote = null;
                notifyState();
            }
        }, 60_000L);
    }

    private void thermalShutdown(float t) {
        String why = String.format(Locale.US,
                "Stopped at %.1f C to protect the battery.", t);
        Log.e(TAG, why);
        thermalNote = why;
        lastError = why;
        // Record it so the app can explain itself hours later, long after the
        // service has gone.
        getSharedPreferences(Settings.PREFS, Context.MODE_PRIVATE).edit()
                .putString("lastThermalShutdown", why)
                .putLong("lastThermalShutdownAt", System.currentTimeMillis())
                .apply();
        postThermalAlert(why);
        stopStreaming();
        stopSelf();
    }

    private void postThermalAlert(String why) {
        try {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm == null) return;
            Intent openIntent = new Intent(this, MainActivity.class)
                    .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }
            Notification n = new NotificationCompat.Builder(this, ALERT_CHANNEL_ID)
                    .setContentTitle("Streaming stopped: phone too hot")
                    .setContentText(why)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(
                            why + "\nLet it cool before starting again. Charging while "
                                + "streaming, direct sun and an enclosed case all make "
                                + "this much more likely."))
                    .setSmallIcon(android.R.drawable.stat_notify_error)
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setAutoCancel(true)
                    .setContentIntent(PendingIntent.getActivity(this, 2, openIntent, flags))
                    .build();
            nm.notify(ALERT_NOTIF_ID, n);
        } catch (Exception e) {
            Log.w(TAG, "could not post the heat alert", e);
        }
    }

    // --- audio ------------------------------------------------------------------

    @Override
    @Nullable
    public AudioHub audio() { return audioHub; }

    @Override
    @Nullable
    public SayQueue sayQueue() {
        return audioHub == null ? null : sayQueue;
    }

    public int getSayQueueSize() { return sayQueue.size(); }
    public boolean isSayHelperOnline() { return sayQueue.helperOnline(); }

    @Override
    public boolean talkbackAllowed() {
        return settings.talkbackEnabled && audioHub != null;
    }

    public boolean hasMicPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED;
    }

    public boolean isMicRunning() {
        AudioHub a = audioHub;
        return a != null && a.isCapturing();
    }

    public boolean isEchoCancelActive() {
        AudioHub a = audioHub;
        return a != null && a.isEchoCancelActive();
    }

    public float getTalkbackPeak() {
        AudioHub a = audioHub;
        return a == null ? 0f : a.getPlaybackPeak();
    }

    public float getAudioPeak() {
        AudioHub a = audioHub;
        return a == null ? 0f : a.getPeakLevel();
    }

    public String getAudioSourceName() {
        AudioHub a = audioHub;
        return a == null ? "none" : a.getSourceName();
    }

    public int getAudioClippedCount() {
        AudioHub a = audioHub;
        return a == null ? 0 : a.getClippedCount();
    }

    public boolean isTalkbackPlaying() {
        AudioHub a = audioHub;
        return a != null && a.isTalking();
    }

    public int getAudioListenerCount() {
        return server == null ? 0 : server.getAudioListenerCount();
    }

    /** Why audio is not running, or null when it is (or is simply switched off). */
    @Nullable
    public String getAudioError() { return audioError; }

    /**
     * Bring the microphone up or down to match the settings. Also re-declares
     * the foreground service type, because a service that captures audio on
     * Android 14+ must say so and must hold the matching permission.
     */
    private void syncAudio() {
        if (!streaming) return;
        boolean want = settings.audioEnabled;

        if (want && !hasMicPermission()) {
            audioError = "Microphone permission has not been granted.";
            settings.audioEnabled = false;
            settings.save(this);
            notifyState();
            return;
        }

        if (want) {
            if (audioHub == null) audioHub = new AudioHub();
            audioHub.setHalfDuplex(settings.halfDuplex);
            audioHub.setGain(settings.audioGain);
            audioHub.setPlaybackGain(settings.talkbackGain);
            audioHub.setLoudspeaker(settings.talkbackLoudspeaker);
            if (!audioHub.isCapturing()) {
                // Declare the microphone type BEFORE opening the mic: on
                // Android 14+ capturing without the declared type is a
                // SecurityException, not a warning.
                startInForeground();
                // Only take the echo-cancelled (and quieter) capture path when
                // talkback can actually cause an echo.
                if (audioHub.startCapture(settings.audioSampleRate, settings.talkbackEnabled)) {
                    audioError = null;
                } else {
                    audioError = "The microphone could not be opened at "
                            + settings.audioSampleRate + "Hz.";
                    settings.audioEnabled = false;
                    settings.save(this);
                    startInForeground();
                }
            }
        } else if (audioHub != null) {
            audioHub.shutdown();
            audioHub = null;
            audioError = null;
            startInForeground();   // drop the microphone type again
        }
        updateNotification();
        notifyState();
    }

    /** Apply an audio settings change from the UI or the control endpoint. */
    public void applyAudioSettings() {
        settings.save(this);
        main.post(() -> {
            AudioHub a = audioHub;
            if (a != null) {
                a.setHalfDuplex(settings.halfDuplex);
                a.setGain(settings.audioGain);
                a.setPlaybackGain(settings.talkbackGain);
                a.setLoudspeaker(settings.talkbackLoudspeaker);
            }
            // A rate change needs the microphone reopened.
            boolean sourceWouldChange = a != null && a.isCapturing()
                    && settings.talkbackEnabled != a.getSourceName().startsWith("voice call");
            if (a != null && a.isCapturing()
                    && (a.getSampleRate() != settings.audioSampleRate || sourceWouldChange)) {
                a.stopCapture();
            }
            syncAudio();
        });
    }

    // --- battery -------------------------------------------------------------

    /**
     * Battery state, read on demand from the sticky ACTION_BATTERY_CHANGED
     * broadcast. Passing a null receiver returns the last value immediately
     * without registering anything, so there is no running receiver to leak
     * and no permission needed.
     */
    public static final class Battery {
        public final int percent;        // -1 when unknown
        public final boolean charging;
        public final float temperatureC; // -1 when unknown
        /** Instantaneous draw in mA, positive = discharging. 0 when unknown. */
        public final int currentMa;
        /** Averaged draw in mA over the device's own window. 0 when unknown. */
        public final int averageMa;

        Battery(int percent, boolean charging, float temperatureC,
                int currentMa, int averageMa) {
            this.percent = percent;
            this.charging = charging;
            this.temperatureC = temperatureC;
            this.currentMa = currentMa;
            this.averageMa = averageMa;
        }
    }

    public Battery readBattery() {
        try {
            Intent b = registerReceiver(null,
                    new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            if (b == null) return new Battery(-1, false, -1f, 0, 0);
            int level = b.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = b.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
            int pct = (level < 0 || scale <= 0) ? -1 : level * 100 / scale;
            int status = b.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
            boolean charging = status == BatteryManager.BATTERY_STATUS_CHARGING
                    || status == BatteryManager.BATTERY_STATUS_FULL;
            float tempC = b.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) / 10f;
            return new Battery(pct, charging, tempC, readCurrentMa(false), readCurrentMa(true));
        } catch (Exception e) {
            Log.w(TAG, "could not read battery state", e);
            return new Battery(-1, false, -1f, 0, 0);
        }
    }

    /**
     * Battery current in mA, as a positive number meaning "being consumed".
     *
     * This is the number to watch when judging whether a change actually saved
     * power, but treat it with some suspicion:
     *   - the framework documents microamps, and a few vendors report
     *     milliamps instead, so a reading of 300 might be 300mA or 0.3mA;
     *   - the sign convention is not consistent either. Most devices report
     *     negative while discharging, some the reverse, so the magnitude is
     *     the trustworthy part;
     *   - on a charger it measures net flow into the battery, not what the
     *     phone is using, so comparisons have to be made unplugged.
     * The absolute value is taken and the charging state reported separately.
     */
    private int readCurrentMa(boolean averaged) {
        try {
            BatteryManager bm = (BatteryManager) getSystemService(Context.BATTERY_SERVICE);
            if (bm == null) return 0;
            int property = averaged
                    ? BatteryManager.BATTERY_PROPERTY_CURRENT_AVERAGE
                    : BatteryManager.BATTERY_PROPERTY_CURRENT_NOW;
            int micro = bm.getIntProperty(property);
            if (micro == Integer.MIN_VALUE || micro == 0) return 0;
            int ma = Math.abs(micro) / 1000;
            // A vendor reporting milliamps already would give an absurd number
            // once divided; if it rounds to zero but the raw value was not,
            // the raw value was probably already mA.
            if (ma == 0) ma = Math.abs(micro);
            return ma;
        } catch (Exception e) {
            return 0;
        }
    }

    // --- night snapshot ---------------------------------------------------------

    public boolean isNightShotRunning() { return nightShotInFlight.get(); }

    /**
     * Kick off a long-exposure still. Returns false if one is already running
     * so the caller can answer 409 rather than queueing captures.
     *
     * The camera must be rebound on the main thread, and the callbacks arrive
     * from a camera thread, so everything is marshalled through the handler.
     */
    @Override
    public boolean startNightShot(java.util.function.Consumer<byte[]> onJpeg,
                                  java.util.function.Consumer<String> onError) {
        if (!isStreaming() || cameraController == null) {
            onError.accept("The camera is not streaming.");
            return true;   // handled: a real error, not a busy signal
        }
        if (!nightShotInFlight.compareAndSet(false, true)) return false;

        notifyState();

        // If the capture never calls back the guard would stick on forever.
        final Runnable release = new Runnable() {
            @Override public void run() {
                if (nightShotInFlight.compareAndSet(true, false)) {
                    Log.w(TAG, "night shot timed out, releasing the guard");
                    notifyState();
                    onError.accept("The capture timed out.");
                }
            }
        };
        main.postDelayed(release, NIGHT_SHOT_TIMEOUT_MS);

        main.post(() -> {
            CameraController cc = cameraController;
            if (cc == null) {
                main.removeCallbacks(release);
                nightShotInFlight.set(false);
                onError.accept("The camera went away before the capture started.");
                return;
            }
            cc.takeNightShot(settings,
                    jpeg -> {
                        main.removeCallbacks(release);
                        nightShotInFlight.set(false);
                        notifyState();
                        onJpeg.accept(jpeg);
                    },
                    message -> {
                        main.removeCallbacks(release);
                        nightShotInFlight.set(false);
                        notifyState();
                        onError.accept(message);
                    });
        });
        return true;
    }

    // --- live camera readout -----------------------------------------------------

    public long getExposureNs() {
        CameraController cc = cameraController;
        return cc == null ? -1L : cc.getLastExposureNs();
    }

    public String getExposureLabel() {
        return CameraController.formatExposure(getExposureNs());
    }

    public int getIso() {
        CameraController cc = cameraController;
        return cc == null ? -1 : cc.getLastIso();
    }

    public boolean isManualSensorSupported() {
        CameraController cc = cameraController;
        return cc != null && cc.isManualSensorSupported();
    }

    public boolean isPreviewDropped() {
        CameraController cc = cameraController;
        return cc != null && cc.isPreviewDropped();
    }

    public long getExposureMinNs() {
        CameraController cc = cameraController;
        return cc == null ? -1L : cc.getExposureMinNs();
    }

    public long getExposureMaxNs() {
        CameraController cc = cameraController;
        return cc == null ? -1L : cc.getExposureMaxNs();
    }

    public int getIsoMin() {
        CameraController cc = cameraController;
        return cc == null ? -1 : cc.getIsoMin();
    }

    public int getIsoMax() {
        CameraController cc = cameraController;
        return cc == null ? -1 : cc.getIsoMax();
    }

    public java.util.List<CameraLens> getLenses() {
        CameraController cc = cameraController;
        return cc == null ? java.util.Collections.emptyList() : cc.getLenses();
    }

    public String getCameraId() { return settings.cameraId; }

    public boolean didLensFallBack() {
        CameraController cc = cameraController;
        return cc != null && cc.didLensFallBack();
    }

    public float getZoomRatio() {
        CameraController cc = cameraController;
        return cc == null ? 1f : cc.getZoomRatio();
    }

    public float getMinZoomRatio() {
        CameraController cc = cameraController;
        return cc == null ? 1f : cc.getMinZoomRatio();
    }

    public float getMaxZoomRatio() {
        CameraController cc = cameraController;
        return cc == null ? 1f : cc.getMaxZoomRatio();
    }

    /**
     * Switch to a lens by its camera2 ID. Needs a rebind: a different physical
     * camera means a whole new capture session.
     */
    public void selectLens(String cameraId) {
        CameraController cc = cameraController;
        CameraLens lens = cc == null ? null : cc.findLens(cameraId);
        settings.cameraId = lens == null ? "" : lens.cameraId;
        if (lens != null) settings.frontCamera = lens.front;
        settings.zoomRatio = 1f;      // the new lens starts at its own 1x
        settings.save(this);
        main.post(() -> {
            if (cameraController != null) cameraController.rebind(settings);
            updateNotification();
            notifyState();
        });
    }

    /**
     * Ask for a zoom factor such as 0.5x or 3x.
     *
     * Prefers a separate physical lens at that factor, because real glass
     * beats cropping. Falls back to the zoom ratio on the current camera,
     * which on a logical multi-camera is itself how the device switches
     * lenses. Returns false when neither route can reach the factor.
     */
    public boolean selectZoomFactor(float factor) {
        CameraController cc = cameraController;
        if (cc == null) return false;

        // Tolerance has to be proportional. A telephoto whose optics work out
        // to 2.4x is still the lens you want when asking for 3x, but 0.5x and
        // 1x are only 0.5 apart and must never be confused for each other.
        CameraLens best = null;
        for (CameraLens l : cc.getLenses()) {
            if (l.front != settings.frontCamera) continue;
            if (Math.abs(l.zoomFactor - factor) / Math.max(0.1f, factor) > 0.25f) continue;
            if (best == null || Math.abs(l.zoomFactor - factor)
                    < Math.abs(best.zoomFactor - factor)) {
                best = l;
            }
        }
        if (best != null && !best.cameraId.equals(settings.cameraId)) {
            selectLens(best.cameraId);
            return true;
        }
        if (best != null) return true;   // already on it

        // No separate lens: try the logical camera's own zoom range.
        if (cc.setZoomRatio(factor)) {
            settings.zoomRatio = factor;
            settings.save(this);
            notifyState();
            return true;
        }
        return false;
    }

    /** Lowest night fps that buys any extra light on this sensor. */
    public int getMinUsefulNightFps() {
        CameraController cc = cameraController;
        return cc == null ? 1 : cc.minUsefulNightFps();
    }

    /** True when MANUAL was asked for but the sensor cannot honour it. */
    public boolean isManualRequestedButUnsupported() {
        return settings.manualExposure() && !isManualSensorSupported();
    }

    // --- MjpegServer.Host ---------------------------------------------------

    @Override
    public Settings settings() { return settings; }

    @Override
    public void onControl(Map<String, String> params) {
        boolean needsRebind = false;
        boolean liveExposureChange = false;
        boolean switchedExposureMode = false;
        String pendingLensId = null;
        Float pendingZoomFactor = null;
        boolean audioChanged = false;
        boolean captureIdleChanged = false;

        for (Map.Entry<String, String> e : params.entrySet()) {
            String k = e.getKey().toLowerCase();
            String v = e.getValue();
            try {
                switch (k) {
                    case "fps":
                        settings.targetFps = Settings.clamp(Integer.parseInt(v), 1, 30);
                        break;
                    case "quality":
                        settings.jpegQuality = Settings.clamp(Integer.parseInt(v), 10, 95);
                        break;
                    case "nightfps":
                        settings.nightFps = Settings.clamp(Integer.parseInt(v), 1, 15);
                        needsRebind = settings.lowLightCapture();
                        break;
                    case "night":
                        settings.nightMode = Settings.NightMode.valueOf(v.toUpperCase());
                        if (settings.nightMode != Settings.NightMode.AUTO) {
                            settings.nightActive = settings.nightMode == Settings.NightMode.ON;
                        }
                        needsRebind = true;
                        break;
                    case "lanonly":
                        // Takes effect on the next start: the socket is already bound.
                        settings.lanOnly = "1".equals(v) || "on".equalsIgnoreCase(v)
                                || "true".equalsIgnoreCase(v);
                        break;
                    case "exposuremode":
                        settings.exposureMode = "manual".equalsIgnoreCase(v)
                                ? Settings.ExposureMode.MANUAL
                                : Settings.ExposureMode.AUTO;
                        if (settings.manualExposure()) {
                            // Start from whatever the camera is doing now, so
                            // the picture does not jump on the switch.
                            long liveExp = getExposureNs();
                            int liveIso = getIso();
                            if (liveExp > 0) settings.manualExposureNs = liveExp;
                            if (liveIso > 0) settings.manualIso = liveIso;
                        }
                        switchedExposureMode = true;
                        break;
                    case "exposure":
                        settings.manualExposureNs = Settings.parseExposureNs(v);
                        liveExposureChange = true;
                        break;
                    case "iso":
                        // Whichever ISO is actually in play right now.
                        if (settings.manualExposure()) {
                            settings.manualIso = Settings.clamp(Integer.parseInt(v),
                                    Settings.ISO_ABS_MIN, Settings.ISO_ABS_MAX);
                            liveExposureChange = true;
                        } else {
                            settings.nightIso = Settings.clamp(Integer.parseInt(v),
                                    Settings.ISO_ABS_MIN, Settings.ISO_ABS_MAX);
                            needsRebind = settings.lowLightCapture();
                        }
                        break;
                    case "manualiso":
                        settings.manualIso = Settings.clamp(Integer.parseInt(v),
                                Settings.ISO_ABS_MIN, Settings.ISO_ABS_MAX);
                        liveExposureChange = settings.manualExposure();
                        break;
                    case "nightiso":
                        settings.nightIso = Settings.clamp(Integer.parseInt(v),
                                Settings.ISO_ABS_MIN, Settings.ISO_ABS_MAX);
                        needsRebind = settings.lowLightCapture();
                        break;
                    case "resolution":
                        settings.resolutionIndex = Settings.clamp(
                                Integer.parseInt(v), 0, Settings.RESOLUTIONS.length - 1);
                        needsRebind = true;
                        break;
                    case "camera":
                        if ("toggle".equalsIgnoreCase(v)) settings.frontCamera = !settings.frontCamera;
                        else settings.frontCamera = "front".equalsIgnoreCase(v);
                        // Facing changed, so a lens id for the old side is stale.
                        settings.cameraId = "";
                        settings.zoomRatio = 1f;
                        needsRebind = true;
                        break;
                    case "audio":
                        settings.audioEnabled = truthy(v);
                        audioChanged = true;
                        break;
                    case "talkback":
                        settings.talkbackEnabled = truthy(v);
                        audioChanged = true;
                        break;
                    case "audiorate":
                        settings.audioSampleRate = Settings.clamp(
                                Integer.parseInt(v), 4000, 48000);
                        audioChanged = true;
                        break;
                    case "gain":
                        settings.audioGain = Settings.clampFloat(Float.parseFloat(v),
                                Settings.AUDIO_GAIN_MIN, Settings.AUDIO_GAIN_MAX);
                        audioChanged = true;
                        break;
                    case "talkgain":
                        settings.talkbackGain = Settings.clampFloat(Float.parseFloat(v),
                                Settings.AUDIO_GAIN_MIN, Settings.AUDIO_GAIN_MAX);
                        audioChanged = true;
                        break;
                    case "loudspeaker":
                        settings.talkbackLoudspeaker = truthy(v);
                        audioChanged = true;
                        break;
                    case "idlethrottle":
                        settings.idleThrottle = truthy(v);
                        // Now governs the sensor's capture rate as well as the
                        // encoder, so the camera has to be told immediately.
                        captureIdleChanged = true;
                        break;
                    case "rotation":
                        settings.rotationMode = Settings.RotationMode.valueOf(v.toUpperCase());
                        break;
                    case "halfduplex":
                        settings.halfDuplex = truthy(v);
                        audioChanged = true;
                        break;
                    case "lens":
                        pendingLensId = v;
                        break;
                    case "zoomfactor":
                        pendingZoomFactor = Float.parseFloat(v);
                        break;
                    case "zoom":
                        setZoom(Float.parseFloat(v));
                        break;
                    case "idlecapturefps":
                        settings.idleCaptureFps = Settings.clamp(Integer.parseInt(v),
                                Settings.IDLE_CAPTURE_FPS_MIN,
                                Settings.IDLE_CAPTURE_FPS_MAX);
                        captureIdleChanged = true;
                        break;
                    case "torch":
                        if ("toggle".equalsIgnoreCase(v)) setTorch(!isTorchOn());
                        else setTorch("1".equals(v) || "on".equalsIgnoreCase(v)
                                || "true".equalsIgnoreCase(v));
                        break;
                    default:
                        // Unknown key: ignore rather than fail the whole request.
                        break;
                }
            } catch (Exception ex) {
                Log.w(TAG, "bad control value for " + k + ": " + v);
            }
        }

        settings.save(this);
        if (audioChanged) applyAudioSettings();
        if (captureIdleChanged) applyCaptureIdle();
        if (pendingLensId != null) {
            selectLens(pendingLensId);
        } else if (pendingZoomFactor != null) {
            selectZoomFactor(pendingZoomFactor);
        } else if (switchedExposureMode) {
            applyExposureMode();            // rebind: AE on/off changes
        } else if (liveExposureChange) {
            applyManualExposure();          // live: no stream interruption
        } else if (needsRebind) {
            main.post(() -> {
                if (cameraController != null) cameraController.rebind(settings);
                updateNotification();
            });
        }
        notifyState();
    }

    private static boolean truthy(String v) {
        return "1".equals(v) || "on".equalsIgnoreCase(v) || "true".equalsIgnoreCase(v)
                || "yes".equalsIgnoreCase(v);
    }

    @Override
    public String statusJson() {
        Battery bat = readBattery();
        CameraController cc = cameraController;
        long expNs = getExposureNs();
        long expMin = cc == null ? -1L : cc.getExposureMinNs();
        long expMax = cc == null ? -1L : cc.getExposureMaxNs();
        int isoMin = cc == null ? -1 : cc.getIsoMin();
        int isoMax = cc == null ? -1 : cc.getIsoMax();

        return "{"
                + "\"streaming\":" + isStreaming()
                + ",\"resolution\":\"" + settings.resolution().getWidth()
                + "x" + settings.resolution().getHeight() + "\""
                + ",\"targetFps\":" + settings.targetFps
                + ",\"effectiveFps\":" + settings.effectiveFps()
                + ",\"quality\":" + settings.jpegQuality
                + ",\"nightMode\":\"" + settings.nightMode.name() + "\""
                + ",\"nightActive\":" + settings.lowLightCapture()
                + ",\"nightFps\":" + settings.nightFps
                + ",\"nightIso\":" + settings.nightIso
                + ",\"luma\":" + settings.lastLuma
                + ",\"camera\":\"" + (settings.frontCamera ? "front" : "back") + "\""
                + ",\"torch\":" + isTorchOn()
                + ",\"viewers\":" + getViewerCount()
                + ",\"lanOnly\":" + settings.lanOnly
                + ",\"boundTo\":\"" + bindingLabel() + "\""
                // live sensor readout
                + ",\"exposureNs\":" + expNs
                + ",\"exposureLabel\":\"" + CameraController.formatExposure(expNs) + "\""
                + ",\"iso\":" + getIso()
                + ",\"manualSensor\":" + isManualSensorSupported()
                + ",\"previewDropped\":" + isPreviewDropped()
                + ",\"nightShotRunning\":" + isNightShotRunning()
                // exposure mode
                + ",\"exposureMode\":\"" + settings.exposureMode.name() + "\""
                + ",\"manualExposureNs\":" + settings.manualExposureNs
                + ",\"manualExposureLabel\":\""
                + CameraController.formatExposure(settings.manualExposureNs) + "\""
                + ",\"manualIso\":" + settings.manualIso
                + ",\"manualUnsupported\":" + isManualRequestedButUnsupported()
                + ",\"minNightFps\":" + getMinUsefulNightFps()
                // lenses
                + ",\"cameraId\":\"" + settings.cameraId + "\""
                + ",\"lensFallback\":" + didLensFallBack()
                + ",\"zoomRatio\":" + String.format(Locale.US, "%.2f", getZoomRatio())
                + ",\"zoomMin\":" + String.format(Locale.US, "%.2f", getMinZoomRatio())
                + ",\"zoomMax\":" + String.format(Locale.US, "%.2f", getMaxZoomRatio())
                + ",\"lenses\":" + lensesJson()
                // audio
                + ",\"audioEnabled\":" + settings.audioEnabled
                + ",\"micRunning\":" + isMicRunning()
                + ",\"audioSampleRate\":" + settings.audioSampleRate
                + ",\"audioListeners\":" + getAudioListenerCount()
                + ",\"talkbackEnabled\":" + settings.talkbackEnabled
                + ",\"talkbackPlaying\":" + isTalkbackPlaying()
                + ",\"halfDuplex\":" + settings.halfDuplex
                + ",\"echoCancel\":" + isEchoCancelActive()
                + ",\"micPermission\":" + hasMicPermission()
                + ",\"audioError\":\"" + (audioError == null ? "" : audioError) + "\""
                + ",\"audioGain\":" + String.format(Locale.US, "%.1f", settings.audioGain)
                + ",\"audioPeak\":" + String.format(Locale.US, "%.3f", getAudioPeak())
                + ",\"audioSource\":\"" + getAudioSourceName() + "\""
                + ",\"audioClipped\":" + getAudioClippedCount()
                + ",\"talkbackGain\":" + String.format(Locale.US, "%.1f", settings.talkbackGain)
                + ",\"talkbackPeak\":" + String.format(Locale.US, "%.3f", getTalkbackPeak())
                + ",\"loudspeaker\":" + settings.talkbackLoudspeaker
                + ",\"sayQueued\":" + sayQueue.size()
                + ",\"sayHelperOnline\":" + sayQueue.helperOnline()
                + ",\"sayHelperAgoMs\":" + sayQueue.sinceLastPollMs()
                // thermal
                + ",\"tempC\":" + String.format(Locale.US, "%.1f", lastTempC)
                + ",\"thermalThrottled\":" + settings.thermalThrottled
                + ",\"thermalNote\":\"" + (thermalNote == null ? "" : thermalNote) + "\""
                + ",\"thermalThrottleAt\":" + Settings.THERMAL_THROTTLE_C
                + ",\"thermalShutdownAt\":" + Settings.THERMAL_SHUTDOWN_C
                // sensor limits
                + ",\"exposureMinNs\":" + expMin
                + ",\"exposureMaxNs\":" + expMax
                + ",\"exposureMinLabel\":\"" + CameraController.formatExposure(expMin) + "\""
                + ",\"exposureMaxLabel\":\"" + CameraController.formatExposure(expMax) + "\""
                + ",\"isoMin\":" + isoMin
                + ",\"isoMax\":" + isoMax
                // phone health
                + ",\"batteryPct\":" + bat.percent
                + ",\"charging\":" + bat.charging
                + ",\"batteryTempC\":" + String.format(Locale.US, "%.1f", bat.temperatureC)
                + ",\"currentMa\":" + bat.currentMa
                + ",\"averageMa\":" + bat.averageMa
                + ",\"idleThrottle\":" + settings.idleThrottle
                + ",\"rotationMode\":\"" + settings.rotationMode.name() + "\""
                + ",\"encoding\":" + (getViewerCount() > 0 || !settings.idleThrottle)
                // capture-rate idling, which is the part that saves power
                + ",\"captureIdle\":" + isCaptureIdle()
                + ",\"idleCaptureFps\":" + settings.idleCaptureFps
                + "}";
    }

    /** The lens list, so both UIs can build their buttons from what exists. */
    private String lensesJson() {
        StringBuilder b = new StringBuilder("[");
        boolean first = true;
        for (CameraLens l : getLenses()) {
            if (!first) b.append(",");
            first = false;
            b.append("{\"id\":\"").append(l.cameraId).append("\"")
             .append(",\"label\":\"").append(l.label.replace("\"", "")).append("\"")
             .append(",\"short\":\"").append(CameraLens.formatFactor(l.zoomFactor)).append("\"")
             .append(",\"factor\":").append(String.format(Locale.US, "%.2f", l.zoomFactor))
             .append(",\"front\":").append(l.front)
             .append(",\"selected\":").append(l.cameraId.equals(settings.cameraId))
             .append("}");
        }
        return b.append("]").toString();
    }

    // --- notification -------------------------------------------------------

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "Camera streaming", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown the whole time the camera is streaming over the network.");
            ch.setShowBadge(true);
            NotificationChannel alerts = new NotificationChannel(
                    ALERT_CHANNEL_ID, "Overheating alerts",
                    NotificationManager.IMPORTANCE_HIGH);
            alerts.setDescription("Shown if streaming is stopped to protect the battery.");
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) {
                nm.createNotificationChannel(ch);
                nm.createNotificationChannel(alerts);
            }
        }
    }

    private Notification buildNotification() {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }

        Intent openIntent = new Intent(this, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPi = PendingIntent.getActivity(this, 0, openIntent, flags);

        Intent stopIntent = new Intent(this, StreamService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 1, stopIntent, flags);

        String url = "http://" + deviceIp() + ":" + settings.port + "/";
        String night = settings.lowLightCapture()
                ? "  ·  night " + settings.effectiveFps() + "fps" : "";
        Battery bat = readBattery();
        String battery = bat.percent < 0 ? ""
                : "  ·  battery " + bat.percent + "%" + (bat.charging ? " charging" : "")
                  + (bat.currentMa > 0 ? "  ·  " + bat.currentMa + "mA" : "");
        String thermal = settings.thermalThrottled
                ? String.format(Locale.US, "  ·  HOT %.1f C, throttled", lastTempC) : "";
        String mic = isMicRunning()
                ? "  ·  MIC LIVE" + (settings.talkbackEnabled ? " + talkback" : "") : "";
        String exposure = "  ·  " + getExposureLabel()
                + (getIso() > 0 ? " ISO " + getIso() : "")
                + (settings.manualExposure() ? " (manual)" : " (auto)");

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(isNightShotRunning()
                        ? "Taking a night snapshot…"
                        : (isMicRunning() ? "Camera and microphone are live"
                                          : "Camera is streaming"))
                .setContentText(url + night + mic + thermal)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(
                        "This device is broadcasting its camera on the local network.\n"
                                + url + night + exposure + mic + thermal
                                + "\nViewers: " + getViewerCount() + battery
                                + (bat.temperatureC > 40f
                                   ? String.format(Locale.US,
                                       "\nBattery is warm: %.1f C", bat.temperatureC)
                                   : "")))
                .setSmallIcon(android.R.drawable.presence_video_online)
                .setOngoing(true)
                .setContentIntent(openPi)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stopPi)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build();
    }

    private void updateNotification() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null && streaming) nm.notify(NOTIF_ID, buildNotification());
    }

    // --- misc ---------------------------------------------------------------

    private void acquireWakeLock() {
        if (!settings.keepAwake || wakeLock != null) return;
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm == null) return;
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ipcam:stream");
        wakeLock.acquire();
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }

    @SuppressWarnings("deprecation")
    public String deviceIp() {
        // If we bound one specific address, that is the only one that works.
        if (server != null && server.getBoundAddress() != null) {
            return server.getBoundAddress().getHostAddress();
        }
        java.net.InetAddress lan = NetworkUtils.getLanIpv4();
        if (lan != null) return lan.getHostAddress();
        try {
            WifiManager wm = (WifiManager) getApplicationContext()
                    .getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                int ip = wm.getConnectionInfo().getIpAddress();
                if (ip != 0) return Formatter.formatIpAddress(ip);
            }
        } catch (Exception ignored) { }
        return "device-ip";
    }
}
