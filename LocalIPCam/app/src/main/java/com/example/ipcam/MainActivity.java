package com.example.ipcam;

import android.Manifest;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.widget.ImageView;
import android.widget.LinearLayout;
import androidx.appcompat.app.AlertDialog;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.SeekBar;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.widget.SwitchCompat;
import androidx.camera.view.PreviewView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

public class MainActivity extends AppCompatActivity
        implements StreamService.StateListener {

    private static final int REQ_PERMS = 42;
    private static final int REQ_MIC = 43;

    private PreviewView previewView;
    private TextView urlText, statusText, previewHint;
    private Button toggleButton;

    private SeekBar fpsBar, qualityBar, nightFpsBar, zoomBar, isoBar;
    private SeekBar shutterBar, manualIsoBar;
    private Spinner exposureModeSpinner;
    private View manualExposureGroup;
    private TextView shutterLabel, manualIsoLabel, exposureLiveText,
            manualUnsupportedText, nightFpsHint;
    /** Sensor limits last seen, so the sliders can be scaled to them. */
    private long sensorExpMin = -1L, sensorExpMax = -1L;
    private int sensorIsoMin = -1, sensorIsoMax = -1;
    private boolean slidersScaled = false;
    private boolean draggingExposure = false;
    private TextView fpsLabel, qualityLabel, nightFpsLabel, isoLabel;
    private TextView exposureText, sensorText, previewDroppedText;
    private Button nightShotButton;
    private Spinner resolutionSpinner, nightSpinner;
    private SwitchCompat torchSwitch, authSwitch, awakeSwitch, lanOnlySwitch;
    private SwitchCompat audioSwitch, talkbackSwitch, halfDuplexSwitch;
    private Spinner audioRateSpinner;
    private SeekBar gainBar, talkGainBar;
    private SwitchCompat loudspeakerSwitch, idleThrottleSwitch;
    private Spinner rotationSpinner;
    private TextView powerText;

    private SeekBar idleCaptureFpsSeek;
    private TextView idleCaptureFpsValue;
    private android.widget.ProgressBar levelBar;
    private TextView gainLabel, levelLabel, talkGainLabel,
            thermalExplainer, thermalStatusText, thermalNoteText;
    private TextView audioStatusText;
    private Spinner lensSpinner;
    private LinearLayout zoomPresetRow;
    private TextView lensHint;
    private java.util.List<CameraLens> lensList = new java.util.ArrayList<>();
    private String lensSignature = "";
    private TextView exposureWarning;
    private EditText userField, passField, portField;

    private Settings settings;
    private StreamService service;
    private boolean bound = false;
    /** bindService() was called; we must unbind even if it never connected. */
    private boolean bindRequested = false;
    private boolean previewAttached = false;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Runnable refreshTick = new Runnable() {
        @Override public void run() {
            refreshStatus();
            // Retry the preview hookup in case the camera opened after the
            // one-shot attempt in startStreaming().
            attachPreviewIfStreaming();
            ui.postDelayed(this, 1500);
        }
    };

    /** Guards against the spinner/seekbar listeners firing while we populate them. */
    private boolean populating = false;
    /**
     * Position the lens spinner was last set to in code. Spinner delivers
     * onItemSelected asynchronously after setAdapter/setSelection, i.e. AFTER
     * `populating` has been reset, so that flag alone cannot tell a rebuild
     * from a real tap. Without this, every list rebuild could fire a lens
     * switch on its own — to position 0 (the ultra-wide) when nothing matched.
     */
    private int lensSpinnerShownPos = -1;

    private final ServiceConnection connection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder binder) {
            service = ((StreamService.LocalBinder) binder).getService();
            service.setStateListener(MainActivity.this);
            bound = true;
            settings = service.getSettings();
            populateFromSettings();
            attachPreviewIfStreaming();
            refreshStatus();
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            service = null;
            bound = false;
            refreshStatus();
        }
    };

    // --- lifecycle ---------------------------------------------------------

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        CrashLog.install(this);
        setContentView(R.layout.activity_main);

        settings = Settings.load(this);
        showLastCrashIfAny();

        previewView = findViewById(R.id.previewView);
        previewHint = findViewById(R.id.previewHint);
        urlText = findViewById(R.id.urlText);
        statusText = findViewById(R.id.statusText);
        toggleButton = findViewById(R.id.toggleButton);

        fpsBar = findViewById(R.id.fpsBar);
        qualityBar = findViewById(R.id.qualityBar);
        nightFpsBar = findViewById(R.id.nightFpsBar);
        zoomBar = findViewById(R.id.zoomBar);
        fpsLabel = findViewById(R.id.fpsLabel);
        qualityLabel = findViewById(R.id.qualityLabel);
        nightFpsLabel = findViewById(R.id.nightFpsLabel);
        isoBar = findViewById(R.id.isoBar);
        isoLabel = findViewById(R.id.isoLabel);
        exposureText = findViewById(R.id.exposureText);
        sensorText = findViewById(R.id.sensorText);
        previewDroppedText = findViewById(R.id.previewDroppedText);
        nightShotButton = findViewById(R.id.nightShotButton);
        exposureModeSpinner = findViewById(R.id.exposureModeSpinner);
        manualExposureGroup = findViewById(R.id.manualExposureGroup);
        shutterBar = findViewById(R.id.shutterBar);
        shutterLabel = findViewById(R.id.shutterLabel);
        manualIsoBar = findViewById(R.id.manualIsoBar);
        manualIsoLabel = findViewById(R.id.manualIsoLabel);
        exposureLiveText = findViewById(R.id.exposureLiveText);
        manualUnsupportedText = findViewById(R.id.manualUnsupportedText);
        nightFpsHint = findViewById(R.id.nightFpsHint);
        resolutionSpinner = findViewById(R.id.resolutionSpinner);
        nightSpinner = findViewById(R.id.nightSpinner);
        torchSwitch = findViewById(R.id.torchSwitch);
        lensSpinner = findViewById(R.id.lensSpinner);
        zoomPresetRow = findViewById(R.id.zoomPresetRow);
        lensHint = findViewById(R.id.lensHint);
        authSwitch = findViewById(R.id.authSwitch);
        awakeSwitch = findViewById(R.id.awakeSwitch);
        lanOnlySwitch = findViewById(R.id.lanOnlySwitch);
        audioSwitch = findViewById(R.id.audioSwitch);
        talkbackSwitch = findViewById(R.id.talkbackSwitch);
        halfDuplexSwitch = findViewById(R.id.halfDuplexSwitch);
        audioRateSpinner = findViewById(R.id.audioRateSpinner);
        audioStatusText = findViewById(R.id.audioStatusText);
        gainBar = findViewById(R.id.gainBar);
        gainLabel = findViewById(R.id.gainLabel);
        talkGainBar = findViewById(R.id.talkGainBar);
        talkGainLabel = findViewById(R.id.talkGainLabel);
        loudspeakerSwitch = findViewById(R.id.loudspeakerSwitch);
        idleThrottleSwitch = findViewById(R.id.idleThrottleSwitch);
        rotationSpinner = findViewById(R.id.rotationSpinner);
        powerText = findViewById(R.id.powerText);

        idleCaptureFpsSeek = findViewById(R.id.idleCaptureFpsSeek);
        idleCaptureFpsValue = findViewById(R.id.idleCaptureFpsValue);
        levelBar = findViewById(R.id.levelBar);
        levelLabel = findViewById(R.id.levelLabel);
        thermalExplainer = findViewById(R.id.thermalExplainer);
        thermalStatusText = findViewById(R.id.thermalStatusText);
        thermalNoteText = findViewById(R.id.thermalNoteText);

        thermalExplainer.setText(getString(R.string.thermal_explainer,
                Settings.THERMAL_THROTTLE_C, Settings.THERMAL_FPS,
                Settings.THERMAL_SHUTDOWN_C, Settings.THERMAL_RECOVER_C));
        showLastThermalShutdown();
        exposureWarning = findViewById(R.id.exposureWarning);
        userField = findViewById(R.id.userField);
        passField = findViewById(R.id.passField);
        portField = findViewById(R.id.portField);

        setupAdapters();
        setupListeners();
        populateFromSettings();

        toggleButton.setOnClickListener(v -> {
            if (isStreaming()) stopStreaming();
            else startStreaming();
        });

        nightShotButton.setOnClickListener(v -> takeNightShot());

        ensurePermissions();
    }

    @Override
    protected void onStart() {
        super.onStart();
        bindToService();
        ui.post(refreshTick);
    }

    @Override
    protected void onStop() {
        super.onStop();
        // Let the stream keep running headless, just drop the preview.
        if (service != null) {
            service.setStateListener(null);
            service.detachPreview();
        }
        if (bindRequested) {
            try {
                unbindService(connection);
            } catch (IllegalArgumentException ignored) { }
            bindRequested = false;
        }
        bound = false;
        previewAttached = false;
        ui.removeCallbacks(refreshTick);
    }

    private void bindToService() {
        if (bindRequested) return;
        // Flag 0: attach to the service only if it is already running. We never
        // want binding alone to spin up the camera.
        bindRequested = bindService(new Intent(this, StreamService.class), connection, 0);
    }

    // --- permissions -------------------------------------------------------

    private void ensurePermissions() {
        String[] perms = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                ? new String[]{Manifest.permission.CAMERA, Manifest.permission.POST_NOTIFICATIONS}
                : new String[]{Manifest.permission.CAMERA};

        for (String p : perms) {
            if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, perms, REQ_PERMS);
                return;
            }
        }
    }

    private boolean hasCameraPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions,
                                           @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_MIC) {
            if (hasMicPermission()) {
                settings.audioEnabled = true;
                audio();
                populateFromSettings();
            } else {
                Toast.makeText(this, R.string.audio_permission_needed,
                        Toast.LENGTH_LONG).show();
            }
            return;
        }
        if (requestCode == REQ_PERMS && !hasCameraPermission()) {
            Toast.makeText(this,
                    "Camera permission is required for this app to do anything.",
                    Toast.LENGTH_LONG).show();
        }
    }

    // --- start / stop ------------------------------------------------------

    private boolean isStreaming() {
        return bound && service != null && service.isStreaming();
    }

    private void startStreaming() {
        if (!hasCameraPermission()) {
            ensurePermissions();
            return;
        }
        commitTextFields();
        settings.save(this);

        Intent svc = new Intent(this, StreamService.class).setAction(StreamService.ACTION_START);
        ContextCompat.startForegroundService(this, svc);
        bindToService();

        // Give the service a beat to open the camera, then hook up the preview.
        // The 1.5s status tick also retries, so a slow camera still gets picked up.
        ui.postDelayed(this::attachPreviewIfStreaming, 700);
    }

    private void stopStreaming() {
        Intent svc = new Intent(this, StreamService.class).setAction(StreamService.ACTION_STOP);
        startService(svc);
        ui.postDelayed(this::refreshStatus, 300);
    }

    private void attachPreviewIfStreaming() {
        if (bound && service != null && service.isStreaming()) {
            if (!previewAttached) {
                service.attachPreview(previewView.getSurfaceProvider());
                previewAttached = true;
            }
            previewHint.setVisibility(View.GONE);
            previewView.setVisibility(View.VISIBLE);
        } else {
            previewAttached = false;
            previewHint.setVisibility(View.VISIBLE);
            previewView.setVisibility(View.INVISIBLE);
        }
    }

    // --- UI wiring ---------------------------------------------------------

    private void setupAdapters() {
        ArrayAdapter<String> resAdapter = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_item, Settings.RESOLUTION_LABELS);
        resAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        resolutionSpinner.setAdapter(resAdapter);

        ArrayAdapter<String> expAdapter = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_item, new String[]{"Auto", "Manual"});
        expAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        exposureModeSpinner.setAdapter(expAdapter);

        ArrayAdapter<String> rateAdapter = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_item, Settings.AUDIO_RATE_LABELS);
        rateAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        audioRateSpinner.setAdapter(rateAdapter);

        ArrayAdapter<String> rotAdapter = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_item, Settings.ROTATION_LABELS);
        rotAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        rotationSpinner.setAdapter(rotAdapter);

        ArrayAdapter<String> nightAdapter = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_item,
                new String[]{"Auto (detect darkness)", "Always on", "Off"});
        nightAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        nightSpinner.setAdapter(nightAdapter);
    }

    private void setupListeners() {
        fpsBar.setOnSeekBarChangeListener(simpleSeek(value -> {
            settings.targetFps = Settings.clamp(value + 1, 1, 30);   // bar is 0..29
            fpsLabel.setText(getString(R.string.fps_value, settings.targetFps));
            light();
        }));

        qualityBar.setOnSeekBarChangeListener(simpleSeek(value -> {
            settings.jpegQuality = Settings.clamp(value + 10, 10, 95); // bar is 0..85
            qualityLabel.setText(getString(R.string.quality_value, settings.jpegQuality));
            light();
        }));

        nightFpsBar.setOnSeekBarChangeListener(simpleSeek(value -> {
            // The bar starts at the sensor's usable floor, not always at 1.
            int floor = (bound && service != null) ? service.getMinUsefulNightFps() : 1;
            settings.nightFps = Settings.clamp(value + floor, 1, 15);
            nightFpsLabel.setText(getString(R.string.night_fps_value, settings.nightFps));
            if (settings.lowLightCapture()) rebind(); else light();
        }));

        isoBar.setOnSeekBarChangeListener(simpleSeek(value -> {
            settings.nightIso = isoFromBar(value);
            isoLabel.setText(getString(R.string.iso_value, settings.nightIso));
            // Only the night manual path uses this, so only rebind if it is live.
            if (settings.lowLightCapture()) rebind(); else light();
        }));

        exposureModeSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int pos, long id) {
                if (populating) return;
                Settings.ExposureMode want = pos == 1
                        ? Settings.ExposureMode.MANUAL : Settings.ExposureMode.AUTO;
                if (want == settings.exposureMode) return;

                if (want == Settings.ExposureMode.MANUAL && bound && service != null) {
                    // Seed from what the camera is doing right now so the
                    // picture does not jump the instant we take over.
                    long liveExp = service.getExposureNs();
                    int liveIso = service.getIso();
                    if (liveExp > 0) settings.manualExposureNs = liveExp;
                    if (liveIso > 0) settings.manualIso = liveIso;
                }
                settings.exposureMode = want;
                settings.save(MainActivity.this);
                if (bound && service != null) service.applyExposureMode();
                populateExposureControls();
                refreshStatus();
            }
            @Override public void onNothingSelected(AdapterView<?> parent) { }
        });

        shutterBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar bar, int progress, boolean fromUser) {
                if (populating || !fromUser) return;
                long ns = Settings.sliderToExposureNs(progress, sensorExpMin, sensorExpMax);
                shutterLabel.setText(CameraController.formatExposure(ns));
            }
            @Override public void onStartTrackingTouch(SeekBar bar) {
                draggingExposure = true;
            }
            @Override public void onStopTrackingTouch(SeekBar bar) {
                draggingExposure = false;
                // Commit on release: one capture update per gesture, not fifty.
                settings.manualExposureNs = Settings.sliderToExposureNs(
                        bar.getProgress(), sensorExpMin, sensorExpMax);
                settings.save(MainActivity.this);
                if (bound && service != null) service.applyManualExposure();
            }
        });

        manualIsoBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar bar, int progress, boolean fromUser) {
                if (populating || !fromUser) return;
                manualIsoLabel.setText(getString(R.string.iso_value, isoFromBar(progress)));
            }
            @Override public void onStartTrackingTouch(SeekBar bar) { }
            @Override public void onStopTrackingTouch(SeekBar bar) {
                settings.manualIso = isoFromBar(bar.getProgress());
                settings.save(MainActivity.this);
                if (bound && service != null) service.applyManualExposure();
            }
        });

        zoomBar.setOnSeekBarChangeListener(simpleSeek(value -> {
            if (bound && service != null) service.setZoom(value / 100f);
        }));

        resolutionSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int pos, long id) {
                if (populating) return;
                settings.resolutionIndex = pos;
                rebind();
            }
            @Override public void onNothingSelected(AdapterView<?> parent) { }
        });

        nightSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int pos, long id) {
                if (populating) return;
                settings.nightMode = pos == 0 ? Settings.NightMode.AUTO
                        : pos == 1 ? Settings.NightMode.ON : Settings.NightMode.OFF;
                if (settings.nightMode != Settings.NightMode.AUTO) {
                    settings.nightActive = settings.nightMode == Settings.NightMode.ON;
                }
                rebind();
            }
            @Override public void onNothingSelected(AdapterView<?> parent) { }
        });

        torchSwitch.setOnCheckedChangeListener((b, checked) -> {
            if (populating) return;
            if (bound && service != null) {
                if (checked && !service.hasFlash()) {
                    Toast.makeText(this, "No flash on this camera.", Toast.LENGTH_SHORT).show();
                    torchSwitch.setChecked(false);
                    return;
                }
                service.setTorch(checked);
            }
        });

        lensSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int pos, long id) {
                if (populating || pos < 0 || pos >= lensList.size()) return;
                if (pos == lensSpinnerShownPos) return;   // our own setSelection echoing back
                lensSpinnerShownPos = pos;
                CameraLens chosen = lensList.get(pos);
                if (chosen.cameraId.equals(settings.cameraId)) return;
                if (bound && service != null) service.selectLens(chosen.cameraId);
            }
            @Override public void onNothingSelected(AdapterView<?> parent) { }
        });

        authSwitch.setOnCheckedChangeListener((b, checked) -> {
            if (populating) return;
            settings.authEnabled = checked;
            userField.setEnabled(checked);
            passField.setEnabled(checked);
            light();
        });

        lanOnlySwitch.setOnCheckedChangeListener((b, checked) -> {
            if (populating) return;
            settings.lanOnly = checked;
            light();
            updateExposureWarning();
            if (!checked) {
                Toast.makeText(this,
                        "Now listening on every interface, including public IPv6. "
                                + "Block inbound IPv6 at your router.",
                        Toast.LENGTH_LONG).show();
            }
        });

        audioSwitch.setOnCheckedChangeListener((b, checked) -> {
            if (populating) return;
            if (checked && !hasMicPermission()) {
                // Ask first; the switch is re-synced from the real state after.
                audioSwitch.setChecked(false);
                requestMicPermission();
                return;
            }
            settings.audioEnabled = checked;
            audio();
        });

        talkbackSwitch.setOnCheckedChangeListener((b, checked) -> {
            if (populating) return;
            settings.talkbackEnabled = checked;
            audio();
        });

        halfDuplexSwitch.setOnCheckedChangeListener((b, checked) -> {
            if (populating) return;
            settings.halfDuplex = checked;
            audio();
        });

        gainBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar bar, int progress, boolean fromUser) {
                if (populating || !fromUser) return;
                gainLabel.setText(getString(R.string.gain_value, gainFromBar(progress)));
            }
            @Override public void onStartTrackingTouch(SeekBar bar) { }
            @Override public void onStopTrackingTouch(SeekBar bar) {
                settings.audioGain = gainFromBar(bar.getProgress());
                audio();
            }
        });

        talkGainBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar bar, int progress, boolean fromUser) {
                if (populating || !fromUser) return;
                talkGainLabel.setText(getString(R.string.gain_value, gainFromBar(progress)));
            }
            @Override public void onStartTrackingTouch(SeekBar bar) { }
            @Override public void onStopTrackingTouch(SeekBar bar) {
                settings.talkbackGain = gainFromBar(bar.getProgress());
                audio();
            }
        });

        loudspeakerSwitch.setOnCheckedChangeListener((b, checked) -> {
            if (populating) return;
            settings.talkbackLoudspeaker = checked;
            audio();
        });

        audioRateSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int pos, long id) {
                if (populating || pos < 0 || pos >= Settings.AUDIO_RATES.length) return;
                if (settings.audioSampleRate == Settings.AUDIO_RATES[pos]) return;
                settings.audioSampleRate = Settings.AUDIO_RATES[pos];
                audio();
            }
            @Override public void onNothingSelected(AdapterView<?> parent) { }
        });

        idleThrottleSwitch.setOnCheckedChangeListener((b, checked) -> {
            if (populating) return;
            settings.idleThrottle = checked;
            // This now governs the sensor's capture rate as well as the
            // encoder, so it has to reach the camera, not just the encoder.
            captureSettingsChanged();
            refreshCaptureControls();
        });

        idleCaptureFpsSeek.setMax(
                Settings.IDLE_CAPTURE_FPS_MAX - Settings.IDLE_CAPTURE_FPS_MIN);
        idleCaptureFpsSeek.setOnSeekBarChangeListener(simpleSeek(value -> {
            settings.idleCaptureFps = Settings.clamp(
                    value + Settings.IDLE_CAPTURE_FPS_MIN,
                    Settings.IDLE_CAPTURE_FPS_MIN, Settings.IDLE_CAPTURE_FPS_MAX);
            idleCaptureFpsValue.setText(getString(R.string.idle_capture_fps_value,
                    settings.idleCaptureFps));
            captureSettingsChanged();
        }));

        rotationSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int pos, long id) {
                if (populating) return;
                Settings.RotationMode want = Settings.rotationFromIndex(pos);
                if (want == settings.rotationMode) return;
                settings.rotationMode = want;
                light();   // the encoder reads this per frame; no rebind needed
            }
            @Override public void onNothingSelected(AdapterView<?> parent) { }
        });

        awakeSwitch.setOnCheckedChangeListener((b, checked) -> {
            if (populating) return;
            settings.keepAwake = checked;
            light();
        });

        TextWatcher watcher = new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) { }
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) { }
            @Override public void afterTextChanged(Editable e) {
                if (populating) return;
                commitTextFields();
            }
        };
        userField.addTextChangedListener(watcher);
        passField.addTextChangedListener(watcher);
        portField.addTextChangedListener(watcher);
    }

    private interface SeekAction { void apply(int value); }

    private SeekBar.OnSeekBarChangeListener simpleSeek(SeekAction action) {
        return new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar bar, int progress, boolean fromUser) {
                if (populating || !fromUser) return;
                action.apply(progress);
            }
            @Override public void onStartTrackingTouch(SeekBar bar) { }
            @Override public void onStopTrackingTouch(SeekBar bar) { }
        };
    }

    private void commitTextFields() {
        settings.username = userField.getText().toString().trim();
        settings.password = passField.getText().toString();
        try {
            int p = Integer.parseInt(portField.getText().toString().trim());
            settings.port = Settings.clamp(p, 1024, 65535);
        } catch (NumberFormatException ignored) { }
        light();
    }

    /** Settings that take effect without restarting the camera. */
    private void light() {
        settings.save(this);
        if (bound && service != null) service.applySettingsLight();
        refreshStatus();
    }

    /**
     * Push a change that the camera has to act on rather than just the
     * encoder, which is what the capture-rate settings are.
     */
    private void captureSettingsChanged() {
        settings.save(this);
        if (bound && service != null) service.applySettingsLight();
        refreshStatus();
    }

    /** The idle rate means nothing with idle throttling switched off. */
    private void refreshCaptureControls() {
        idleCaptureFpsSeek.setEnabled(settings.idleThrottle);
    }

    /** Audio settings: applied without touching the camera. */
    private void audio() {
        settings.save(this);
        if (bound && service != null) service.applyAudioSettings();
        refreshStatus();
    }

    /** The bar counts tenths of a multiplier, offset so position 0 is 1.0x. */
    private static float gainFromBar(int progress) {
        return Settings.clampFloat((progress + 10) / 10f,
                Settings.AUDIO_GAIN_MIN, Settings.AUDIO_GAIN_MAX);
    }

    private static int gainToBar(float gain) {
        return Math.max(0, Math.round(gain * 10f) - 10);
    }

    /** Explain a heat shutdown that happened while nobody was watching. */
    private void showLastThermalShutdown() {
        android.content.SharedPreferences p =
                getSharedPreferences(Settings.PREFS, MODE_PRIVATE);
        String why = p.getString("lastThermalShutdown", null);
        if (why == null) return;
        thermalNoteText.setText(getString(R.string.thermal_last_shutdown, why));
        thermalNoteText.setVisibility(View.VISIBLE);
        p.edit().remove("lastThermalShutdown").remove("lastThermalShutdownAt").apply();
    }

    private boolean hasMicPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED;
    }

    private void requestMicPermission() {
        ActivityCompat.requestPermissions(this,
                new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
    }

    /** Settings that need the camera rebound. */
    private void rebind() {
        settings.save(this);
        if (bound && service != null) service.applySettingsWithRebind();
        refreshStatus();
    }

    private void populateFromSettings() {
        populating = true;

        fpsBar.setMax(29);
        fpsBar.setProgress(settings.targetFps - 1);
        fpsLabel.setText(getString(R.string.fps_value, settings.targetFps));

        qualityBar.setMax(85);
        qualityBar.setProgress(settings.jpegQuality - 10);
        qualityLabel.setText(getString(R.string.quality_value, settings.jpegQuality));

        nightFpsBar.setMax(14);
        nightFpsBar.setProgress(Math.max(0, settings.nightFps - 1));
        nightFpsLabel.setText(getString(R.string.night_fps_value, settings.nightFps));
        // applySensorLimits() rescales this once the camera reports its limits.

        populateExposureControls();

        zoomBar.setMax(100);
        zoomBar.setProgress(Math.round((bound && service != null ? service.getZoom() : 0f) * 100));

        resolutionSpinner.setSelection(settings.resolutionIndex);
        nightSpinner.setSelection(settings.nightMode == Settings.NightMode.AUTO ? 0
                : settings.nightMode == Settings.NightMode.ON ? 1 : 2);


        authSwitch.setChecked(settings.authEnabled);
        awakeSwitch.setChecked(settings.keepAwake);
        idleThrottleSwitch.setChecked(settings.idleThrottle);
        rotationSpinner.setSelection(Settings.rotationIndex(settings.rotationMode));

        idleCaptureFpsSeek.setProgress(
                settings.idleCaptureFps - Settings.IDLE_CAPTURE_FPS_MIN);
        idleCaptureFpsValue.setText(getString(R.string.idle_capture_fps_value,
                settings.idleCaptureFps));
        refreshCaptureControls();
        audioSwitch.setChecked(settings.audioEnabled);
        talkbackSwitch.setChecked(settings.talkbackEnabled);
        halfDuplexSwitch.setChecked(settings.halfDuplex);
        audioRateSpinner.setSelection(Settings.audioRateIndex(settings.audioSampleRate));
        gainBar.setMax(gainToBar(Settings.AUDIO_GAIN_MAX));
        gainBar.setProgress(gainToBar(settings.audioGain));
        gainLabel.setText(getString(R.string.gain_value, settings.audioGain));
        talkGainBar.setMax(gainToBar(Settings.AUDIO_GAIN_MAX));
        talkGainBar.setProgress(gainToBar(settings.talkbackGain));
        talkGainLabel.setText(getString(R.string.gain_value, settings.talkbackGain));
        loudspeakerSwitch.setChecked(settings.talkbackLoudspeaker);
        lanOnlySwitch.setChecked(settings.lanOnly);
        torchSwitch.setChecked(bound && service != null && service.isTorchOn());

        userField.setText(settings.username);
        passField.setText(settings.password);
        portField.setText(String.valueOf(settings.port));
        userField.setEnabled(settings.authEnabled);
        passField.setEnabled(settings.authEnabled);

        populating = false;
        updateExposureWarning();
    }

    // --- sensor-scaled controls -------------------------------------------

    /**
     * SeekBar has no setMin before API 26, so ranged bars are offset: the bar
     * runs 0..(max-min) and the value is min+progress.
     */
    private int isoFromBar(int progress) {
        int lo = sensorIsoMin > 0 ? sensorIsoMin : 50;
        int hi = sensorIsoMax > lo ? sensorIsoMax : 3200;
        return Settings.clamp(lo + progress, lo, hi);
    }

    private int isoToBar(int iso) {
        int lo = sensorIsoMin > 0 ? sensorIsoMin : 50;
        int hi = sensorIsoMax > lo ? sensorIsoMax : 3200;
        return Settings.clamp(iso, lo, hi) - lo;
    }

    /**
     * Rescale the sliders to the camera's real limits. Runs once per set of
     * limits: there is no point offering a 2-second shutter on a sensor that
     * stops at 100ms, and no point offering ISO 6400 on one that stops at 800.
     */
    private void applySensorLimits() {
        if (!bound || service == null) return;
        long expMin = service.getExposureMinNs();
        long expMax = service.getExposureMaxNs();
        int isoMin = service.getIsoMin();
        int isoMax = service.getIsoMax();
        boolean changed = expMin != sensorExpMin || expMax != sensorExpMax
                || isoMin != sensorIsoMin || isoMax != sensorIsoMax;
        if (!changed && slidersScaled) return;

        sensorExpMin = expMin;
        sensorExpMax = expMax;
        sensorIsoMin = isoMin;
        sensorIsoMax = isoMax;

        boolean wasPopulating = populating;
        populating = true;

        shutterBar.setMax(Settings.EXPOSURE_SLIDER_STEPS);
        if (expMin > 0 && expMax > expMin) {
            shutterBar.setEnabled(true);
            shutterBar.setProgress(Settings.exposureNsToSlider(
                    settings.manualExposureNs, expMin, expMax));
        } else {
            shutterBar.setEnabled(false);
        }
        shutterLabel.setText(CameraController.formatExposure(settings.manualExposureNs));

        if (isoMin > 0 && isoMax > isoMin) {
            manualIsoBar.setEnabled(true);
            isoBar.setEnabled(true);
            manualIsoBar.setMax(isoMax - isoMin);
            isoBar.setMax(isoMax - isoMin);
            manualIsoBar.setProgress(isoToBar(settings.manualIso));
            isoBar.setProgress(isoToBar(settings.nightIso));
        }
        manualIsoLabel.setText(getString(R.string.iso_value, settings.manualIso));
        isoLabel.setText(getString(R.string.iso_value, settings.nightIso));

        // Night fps cannot usefully go below what the sensor can expose for.
        int floor = service.getMinUsefulNightFps();
        nightFpsBar.setMax(Math.max(1, 15 - floor));
        nightFpsBar.setProgress(Math.max(0, settings.nightFps - floor));
        if (floor > 1) {
            nightFpsHint.setText(getString(R.string.night_fps_floor,
                    CameraController.formatExposure(expMax), floor));
            nightFpsHint.setVisibility(View.VISIBLE);
            if (settings.nightFps < floor) {
                settings.nightFps = floor;
                settings.save(this);
            }
        } else {
            nightFpsHint.setVisibility(View.GONE);
        }
        nightFpsLabel.setText(getString(R.string.night_fps_value, settings.nightFps));

        populating = wasPopulating;
        slidersScaled = true;
    }

    /**
     * Rebuild the lens picker and the zoom-preset buttons from what the camera
     * actually reports. Rebuilt only when the set or the selection changes,
     * since this runs on the 1.5s status tick.
     */
    private void refreshLenses() {
        if (!bound || service == null) return;
        java.util.List<CameraLens> found = service.getLenses();
        String sig = found.size() + "|" + settings.cameraId + "|"
                + String.format(java.util.Locale.US, "%.2f", service.getZoomRatio());
        if (sig.equals(lensSignature)) return;
        lensSignature = sig;

        boolean wasPopulating = populating;
        populating = true;

        lensList = new java.util.ArrayList<>(found);
        String[] labels = new String[lensList.size()];
        int selected = -1;
        for (int i = 0; i < lensList.size(); i++) {
            CameraLens l = lensList.get(i);
            labels[i] = l.label;
            if (l.cameraId.equals(settings.cameraId)) selected = i;
            // With no explicit lens we are on the facing default, so highlight it.
            if (selected < 0 && settings.cameraId.isEmpty()
                    && l.front == settings.frontCamera
                    && Math.abs(l.zoomFactor - 1f) < 0.05f) {
                selected = i;
            }
        }
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_item, labels);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        // Never leave the spinner unset: setAdapter alone silently selects
        // item 0, which is the widest lens, and that would then fire a switch.
        if (selected < 0) {
            for (int i = 0; i < lensList.size(); i++) {
                CameraLens l = lensList.get(i);
                if (l.front == settings.frontCamera && Math.abs(l.zoomFactor - 1f) < 0.05f) {
                    selected = i;
                    break;
                }
            }
        }
        if (selected < 0 && !lensList.isEmpty()) selected = 0;
        lensSpinnerShownPos = selected;
        lensSpinner.setAdapter(adapter);
        if (selected >= 0) lensSpinner.setSelection(selected, false);
        lensSpinner.setEnabled(lensList.size() > 1);

        buildZoomPresets();

        float zMin = service.getMinZoomRatio();
        float zMax = service.getMaxZoomRatio();
        if (service.didLensFallBack()) {
            lensHint.setText(R.string.lens_fallback);
        } else if (lensList.size() <= 1 && zMax <= 1.05f) {
            lensHint.setText(R.string.lens_single);
        } else {
            lensHint.setText(getString(R.string.lens_zoom_range,
                    CameraLens.formatFactor(zMin), CameraLens.formatFactor(zMax)));
        }

        populating = wasPopulating;
    }

    /**
     * Buttons for the usual factors. Each one prefers a real lens at that
     * factor and falls back to the zoom ratio, so on a phone that hides its
     * aux cameras these still get you to 0.5x and 3x.
     */
    private void buildZoomPresets() {
        zoomPresetRow.removeAllViews();
        if (!bound || service == null) return;
        float zMin = service.getMinZoomRatio();
        float zMax = service.getMaxZoomRatio();

        // One button per lens that actually exists, labelled with the factor
        // its optics really work out to. A telephoto is whatever it is —
        // 2.4x, 2.7x, 3x — and showing the true number beats rounding it to a
        // marketing figure the lens does not match.
        for (CameraLens l : lensList) {
            if (l.front != settings.frontCamera) continue;
            addPresetButton(CameraLens.formatFactor(l.zoomFactor), l.zoomFactor,
                    l.cameraId.equals(settings.cameraId));
        }

        // Then the factors only digital/logical zoom can reach, skipping any a
        // real lens already covers.
        for (final float factor : new float[]{0.5f, 2f, 3f, 5f, 10f}) {
            if (factor < zMin - 0.01f || factor > zMax + 0.01f) continue;
            boolean covered = false;
            for (CameraLens l : lensList) {
                if (l.front == settings.frontCamera
                        && Math.abs(l.zoomFactor - factor) / Math.max(0.1f, factor) <= 0.25f) {
                    covered = true;
                    break;
                }
            }
            if (covered) continue;
            addPresetButton(CameraLens.formatFactor(factor) + "\u2009zoom", factor, false);
        }
    }

    private void addPresetButton(String text, final float factor, boolean active) {
        Button b = new Button(this);
        b.setText(text);
        b.setTextSize(12f);
        b.setMinWidth(0);
        b.setMinimumWidth(0);
        if (active) b.setTypeface(null, android.graphics.Typeface.BOLD);
        b.setOnClickListener(v -> {
            if (bound && service != null && !service.selectZoomFactor(factor)) {
                Toast.makeText(MainActivity.this,
                        "This camera can't reach " + CameraLens.formatFactor(factor),
                        Toast.LENGTH_SHORT).show();
            }
            lensSignature = "";   // force a rebuild so the highlight moves
        });
        zoomPresetRow.addView(b);
    }

    /** Show or hide the manual controls and keep them in step with settings. */
    private void populateExposureControls() {
        boolean wasPopulating = populating;
        populating = true;

        boolean manual = settings.manualExposure();
        exposureModeSpinner.setSelection(manual ? 1 : 0);
        manualExposureGroup.setVisibility(manual ? View.VISIBLE : View.GONE);

        if (!draggingExposure && sensorExpMin > 0 && sensorExpMax > sensorExpMin) {
            shutterBar.setProgress(Settings.exposureNsToSlider(
                    settings.manualExposureNs, sensorExpMin, sensorExpMax));
        }
        shutterLabel.setText(CameraController.formatExposure(settings.manualExposureNs));
        manualIsoLabel.setText(getString(R.string.iso_value, settings.manualIso));
        isoLabel.setText(getString(R.string.iso_value, settings.nightIso));

        // Night mode is greyed out while the user owns the exposure.
        boolean nightUsable = !manual;
        nightSpinner.setEnabled(nightUsable);
        nightFpsBar.setEnabled(nightUsable);
        isoBar.setEnabled(nightUsable && sensorIsoMax > 0);

        populating = wasPopulating;
    }

    /**
     * Show, in plain terms, which globally routable addresses this phone has
     * while LAN-only is off. Abstract warnings get ignored; an actual
     * 2001:... address on screen does not.
     */
    private void updateExposureWarning() {
        if (settings.lanOnly) {
            exposureWarning.setVisibility(View.GONE);
            return;
        }
        java.util.List<String> pub = NetworkUtils.publicAddresses();
        String list = pub.isEmpty() ? "none detected right now" : android.text.TextUtils.join(", ", pub);
        exposureWarning.setText(getString(R.string.lan_only_off_warning, list));
        exposureWarning.setVisibility(View.VISIBLE);
    }

    /**
     * If the app crashed last time, show the stack trace once, with a button
     * to copy it. Then forget it.
     */
    private void showLastCrashIfAny() {
        final String crash = CrashLog.read(this);
        if (crash == null || crash.trim().isEmpty()) return;
        CrashLog.clear(this);

        TextView text = new TextView(this);
        text.setText(crash);
        text.setTextIsSelectable(true);
        text.setTextSize(10f);
        int pad = Math.round(12 * getResources().getDisplayMetrics().density);
        text.setPadding(pad, pad, pad, pad);
        android.widget.ScrollView scroll = new android.widget.ScrollView(this);
        scroll.addView(text);

        new AlertDialog.Builder(this)
                .setTitle("The app crashed last time")
                .setView(scroll)
                .setPositiveButton("Copy", (d, w) -> {
                    android.content.ClipboardManager cm = (android.content.ClipboardManager)
                            getSystemService(Context.CLIPBOARD_SERVICE);
                    if (cm != null) {
                        cm.setPrimaryClip(android.content.ClipData.newPlainText("crash", crash));
                        Toast.makeText(this, "Copied", Toast.LENGTH_SHORT).show();
                    }
                })
                .setNegativeButton(R.string.close, null)
                .show();
    }

    // --- status -------------------------------------------------------------

    @Override
    public void onStateChanged() {
        ui.post(() -> {
            refreshStatus();
            attachPreviewIfStreaming();
        });
    }

    /**
     * Take a long-exposure still and show it in a dialog. The bytes stay in
     * memory; nothing is written to storage.
     */
    private void takeNightShot() {
        if (!isStreaming()) {
            Toast.makeText(this, "Start the stream first.", Toast.LENGTH_SHORT).show();
            return;
        }
        nightShotButton.setEnabled(false);
        Toast.makeText(this, R.string.night_snapshot_running, Toast.LENGTH_LONG).show();

        boolean started = service.startNightShot(
                jpeg -> ui.post(() -> {
                    nightShotButton.setEnabled(true);
                    showNightShot(jpeg);
                }),
                message -> ui.post(() -> {
                    nightShotButton.setEnabled(true);
                    Toast.makeText(this,
                            getString(R.string.night_snapshot_failed, message),
                            Toast.LENGTH_LONG).show();
                }));

        if (!started) {
            nightShotButton.setEnabled(true);
            Toast.makeText(this, "A night snapshot is already running.",
                    Toast.LENGTH_SHORT).show();
        }
    }

    private void showNightShot(byte[] jpeg) {
        Bitmap bmp = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.length);
        if (bmp == null) {
            Toast.makeText(this, getString(R.string.night_snapshot_failed,
                    "could not decode the image"), Toast.LENGTH_LONG).show();
            return;
        }
        ImageView view = new ImageView(this);
        view.setImageBitmap(bmp);
        view.setAdjustViewBounds(true);
        new AlertDialog.Builder(this)
                .setTitle(R.string.night_snapshot_title)
                .setView(view)
                .setPositiveButton(R.string.close, null)
                .show();
    }

    private String batteryLabel(StreamService.Battery bat) {
        if (bat == null || bat.percent < 0) return getString(R.string.battery_unknown);
        return getString(R.string.battery_fmt, bat.percent,
                bat.charging ? getString(R.string.battery_charging) : "",
                bat.temperatureC);
    }

    private void refreshStatus() {
        boolean streaming = isStreaming();
        toggleButton.setText(streaming ? R.string.stop_stream : R.string.start_stream);

        if (streaming) {
            String ip = service.deviceIp();
            urlText.setText(getString(R.string.stream_url, ip, settings.port));

            Settings s = service.getSettings();
            String night;
            if (s.manualExposure()) {
                night = "off (manual exposure)";
            } else switch (s.nightMode) {
                case ON:   night = "on"; break;
                case OFF:  night = "off"; break;
                default:   night = s.nightActive ? "auto (engaged)" : "auto (daylight)";
            }
            urlText.append("\n" + getString(R.string.bound_to, service.bindingLabel()));
            statusText.setText(getString(R.string.status_line,
                    s.effectiveFps(), s.targetFps,
                    s.resolution().getWidth(), s.resolution().getHeight(),
                    night,
                    s.lastLuma < 0 ? "-" : String.valueOf(s.lastLuma),
                    service.getViewerCount()));

            applySensorLimits();
            populateExposureControls();
            refreshLenses();

            exposureText.setText(getString(R.string.exposure_line,
                    service.getExposureLabel(),
                    service.getIso(),
                    batteryLabel(service.readBattery())));

            exposureLiveText.setText(getString(R.string.exposure_live,
                    service.getExposureLabel(),
                    service.getIso(),
                    getString(s.manualExposure()
                            ? R.string.mode_manual : R.string.mode_auto)));

            manualUnsupportedText.setVisibility(
                    service.isManualRequestedButUnsupported() ? View.VISIBLE : View.GONE);

            CameraLens active = null;
            for (CameraLens l : lensList) {
                if (l.cameraId.equals(settings.cameraId)) { active = l; break; }
            }
            urlText.append("\n" + getString(R.string.lens_line,
                    active == null ? "default" : active.label,
                    CameraLens.formatFactor(service.getZoomRatio())));

            sensorText.setText(getString(R.string.sensor_line,
                    CameraController.formatExposure(service.getExposureMinNs()),
                    CameraController.formatExposure(service.getExposureMaxNs()),
                    service.getIsoMin(), service.getIsoMax(),
                    getString(service.isManualSensorSupported()
                            ? R.string.sensor_manual : R.string.sensor_auto_only)));

            String audioErr = service.getAudioError();
            if (audioErr != null && !audioErr.isEmpty()) {
                audioStatusText.setText(getString(R.string.audio_error, audioErr));
            } else if (service.isMicRunning()) {
                audioStatusText.setText(getString(R.string.audio_status_on,
                        settings.audioSampleRate,
                        service.getAudioListenerCount(),
                        service.isEchoCancelActive()
                                ? getString(R.string.audio_echo_on) : ""));
            } else {
                audioStatusText.setText(R.string.audio_status_off);
            }

            int pct = Math.round(service.getAudioPeak() * 100f);
            levelBar.setProgress(Math.min(100, pct));
            int clips = service.getAudioClippedCount();
            levelLabel.setText(service.isMicRunning()
                    ? getString(R.string.level_value, pct,
                        clips > 0 ? getString(R.string.level_clipped, clips) : "")
                    : "");

            StreamService.Battery pb = service.readBattery();
            if (pb.currentMa > 0) {
                boolean idle = settings.idleThrottle && service.getViewerCount() == 0;
                powerText.setText(getString(R.string.power_line, pb.currentMa, pb.averageMa,
                        idle ? getString(R.string.power_idle) : ""));
            } else {
                powerText.setText(R.string.power_unknown);
            }


            float t = service.getLastTempC();
            if (service.isThermalThrottled()) {
                thermalStatusText.setText(getString(R.string.thermal_status_throttled,
                        t, Settings.THERMAL_FPS));
                thermalStatusText.setBackgroundColor(0x33F44336);
            } else if (t <= 0f) {
                thermalStatusText.setText(R.string.thermal_status_unknown);
                thermalStatusText.setBackgroundColor(0x00000000);
            } else if (t >= Settings.THERMAL_THROTTLE_C - 2f) {
                thermalStatusText.setText(getString(R.string.thermal_status_warm, t));
                thermalStatusText.setBackgroundColor(0x33FF9800);
            } else {
                thermalStatusText.setText(getString(R.string.thermal_status_ok, t));
                thermalStatusText.setBackgroundColor(0x00000000);
            }
            String note = service.getThermalNote();
            if (note != null && !note.isEmpty()) {
                thermalNoteText.setText(note);
                thermalNoteText.setVisibility(View.VISIBLE);
            }

            previewDroppedText.setVisibility(
                    service.isPreviewDropped() ? View.VISIBLE : View.GONE);
            nightShotButton.setEnabled(!service.isNightShotRunning());
        } else {
            urlText.setText(R.string.not_streaming);
            String err = service != null ? service.getLastError() : null;
            statusText.setText(err != null
                    ? getString(R.string.start_failed, err)
                    : getString(R.string.idle_hint));
            exposureText.setText("");
            sensorText.setText("");
            exposureLiveText.setText("");
            manualUnsupportedText.setVisibility(View.GONE);
            audioStatusText.setText(R.string.audio_status_off);
            levelBar.setProgress(0);
            levelLabel.setText("");
            thermalStatusText.setText(R.string.thermal_status_unknown);
            thermalStatusText.setBackgroundColor(0x00000000);
            powerText.setText("");
            previewDroppedText.setVisibility(View.GONE);
            nightShotButton.setEnabled(false);
        }
    }
}
