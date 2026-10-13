package com.example.ipcam;

import android.annotation.SuppressLint;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.MediaRecorder;
import android.media.audiofx.AcousticEchoCanceler;
import android.media.audiofx.NoiseSuppressor;
import android.util.Log;

import androidx.annotation.Nullable;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Two-way audio: the phone's microphone out to listeners, and audio posted by
 * a listener back out of the phone's speaker.
 *
 * Everything here is 16-bit signed PCM, mono, little-endian — the format
 * AudioRecord and AudioTrack both speak natively, and the one a WAV header can
 * describe without any encoding step. No codec, no extra dependency; it costs
 * bandwidth (16kHz mono is 32 KB/s) which on a LAN does not matter.
 *
 * FEEDBACK
 * --------
 * A phone whose speaker is playing what its own microphone can hear will howl.
 * Two defences, both on by default:
 *   - the platform echo canceller and noise suppressor, where the device has
 *     them (most do, quality varies);
 *   - half-duplex gating, which feeds silence to listeners while talkback is
 *     actually playing. Crude, but it is the one that always works.
 * Headphones on the phone end sidestep the whole problem.
 */
public class AudioHub {

    private static final String TAG = "AudioHub";

    /** Capture buffer handed to listeners, in bytes. 20ms at 16kHz mono. */
    private static final int CHUNK_BYTES = 640;
    /** Per-listener backlog before the slowest get dropped. ~240ms at 20ms a chunk. */
    private static final int QUEUE_DEPTH = 12;
    /** Silence listeners for this long after the last talkback byte arrives. */
    private static final long HALF_DUPLEX_TAIL_MS = 300L;

    /** One HTTP listener's view of the microphone. */
    public static final class Subscription {
        final BlockingQueue<byte[]> queue = new ArrayBlockingQueue<>(QUEUE_DEPTH);
        volatile boolean open = true;
        final AtomicInteger dropped = new AtomicInteger(0);
    }

    private final CopyOnWriteArrayList<Subscription> subscribers = new CopyOnWriteArrayList<>();

    private volatile boolean capturing = false;
    private volatile int sampleRate = 16000;
    private volatile boolean halfDuplex = true;
    @Nullable private Thread captureThread;
    @Nullable private AudioRecord record;
    @Nullable private AcousticEchoCanceler echoCanceller;
    @Nullable private NoiseSuppressor noiseSuppressor;
    private volatile boolean echoCancelActive = false;
    private volatile String sourceName = "none";
    private volatile float gain = 4.0f;
    /** Peak of the last chunk, 0..1, after gain. Drives the level meter. */
    private volatile float peakLevel = 0f;
    /** Samples that hit the ceiling since capture started: gain is too high. */
    private final AtomicInteger clipped = new AtomicInteger(0);

    // playback
    @Nullable private AudioTrack track;
    private int trackRate = 0;
    private final Object trackLock = new Object();
    private volatile long lastPlaybackAtMs = 0L;
    private volatile float playbackGain = 3.0f;
    private volatile boolean loudspeaker = true;
    /** Peak of the last talkback chunk, 0..1, after gain. */
    private volatile float playbackPeak = 0f;
    private final AtomicInteger playbackClipped = new AtomicInteger(0);
    private volatile long totalTalkBytes = 0L;

    // --- capture -------------------------------------------------------------

    public boolean isCapturing() { return capturing; }
    public int getSampleRate() { return sampleRate; }
    public int getListenerCount() { return subscribers.size(); }
    public boolean isEchoCancelActive() { return echoCancelActive; }
    public long getTalkBytes() { return totalTalkBytes; }
    public void setHalfDuplex(boolean on) { halfDuplex = on; }
    public String getSourceName() { return sourceName; }
    public float getPeakLevel() { return peakLevel; }
    public int getClippedCount() { return clipped.get(); }
    public float getGain() { return gain; }

    public void setGain(float g) {
        gain = Settings.clampFloat(g, Settings.AUDIO_GAIN_MIN, Settings.AUDIO_GAIN_MAX);
    }

    public float getPlaybackGain() { return playbackGain; }
    public float getPlaybackPeak() { return playbackPeak; }
    public int getPlaybackClippedCount() { return playbackClipped.get(); }
    public boolean isLoudspeaker() { return loudspeaker; }

    public void setPlaybackGain(float g) {
        playbackGain = Settings.clampFloat(g,
                Settings.AUDIO_GAIN_MIN, Settings.AUDIO_GAIN_MAX);
    }

    /**
     * Choose the output route. Changing it rebuilds the track, because the
     * audio attributes are fixed when an AudioTrack is built.
     */
    public void setLoudspeaker(boolean on) {
        if (loudspeaker == on) return;
        loudspeaker = on;
        synchronized (trackLock) { releaseTrack(); }
    }

    /** True while talkback audio is playing (or just finished). */
    public boolean isTalking() {
        return System.currentTimeMillis() - lastPlaybackAtMs < HALF_DUPLEX_TAIL_MS;
    }

    /**
     * Start capturing. The caller MUST have checked RECORD_AUDIO first;
     * without it the AudioRecord constructor throws.
     *
     * @return false if the microphone could not be opened.
     */
    @SuppressLint("MissingPermission")
    public synchronized boolean startCapture(int requestedRate, boolean wantEchoCancellation) {
        if (capturing) return true;
        int rate = requestedRate > 0 ? requestedRate : 16000;

        int minBuf = AudioRecord.getMinBufferSize(rate,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        if (minBuf <= 0) {
            Log.e(TAG, "sample rate " + rate + " not supported by this device");
            return false;
        }

        // Source choice is the single biggest factor in how loud this sounds.
        //
        // VOICE_COMMUNICATION routes through the phone-call chain: echo
        // cancellation, noise suppression and automatic gain control, tuned to
        // hold a voice at a steady level against a handset. For room
        // monitoring that AGC works against you — it pulls quiet rooms down
        // and sounds muffled and distant.
        //
        // VOICE_RECOGNITION is the opposite: no AGC, minimal processing, the
        // closest thing to the raw capsule that Android reliably exposes. It
        // is noticeably hotter.
        //
        // So the echo-cancelled path is only used when talkback is on and
        // something actually needs cancelling.
        int[] sources = wantEchoCancellation
                ? new int[]{MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                            MediaRecorder.AudioSource.MIC}
                : new int[]{MediaRecorder.AudioSource.VOICE_RECOGNITION,
                            MediaRecorder.AudioSource.MIC,
                            MediaRecorder.AudioSource.VOICE_COMMUNICATION};

        AudioRecord rec = null;
        for (int source : sources) {
            try {
                AudioRecord candidate = new AudioRecord(source, rate,
                        AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
                        Math.max(minBuf * 4, CHUNK_BYTES * 4));
                if (candidate.getState() == AudioRecord.STATE_INITIALIZED) {
                    rec = candidate;
                    sourceName = sourceLabel(source);
                    break;
                }
                candidate.release();
            } catch (Exception e) {
                Log.w(TAG, "audio source " + source + " refused", e);
            }
        }
        if (rec == null) {
            Log.e(TAG, "no usable audio source");
            return false;
        }

        if (rec.getState() != AudioRecord.STATE_INITIALIZED) {
            Log.e(TAG, "AudioRecord would not initialise");
            rec.release();
            return false;
        }

        if (wantEchoCancellation) attachEffects(rec.getAudioSessionId());

        try {
            rec.startRecording();
        } catch (Exception e) {
            Log.e(TAG, "startRecording failed", e);
            releaseEffects();
            rec.release();
            return false;
        }

        record = rec;
        sampleRate = rate;
        capturing = true;

        captureThread = new Thread(this::captureLoop, "audio-capture");
        captureThread.setDaemon(true);
        captureThread.start();
        Log.i(TAG, "microphone started at " + rate + "Hz via " + sourceName
                + ", echo cancel " + echoCancelActive + ", gain " + gain + "x");
        return true;
    }

    public synchronized void stopCapture() {
        capturing = false;
        Thread t = captureThread;
        captureThread = null;
        if (t != null) {
            try { t.join(500); } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
        }
        AudioRecord rec = record;
        record = null;
        if (rec != null) {
            try { rec.stop(); } catch (Exception ignored) { }
            rec.release();
        }
        releaseEffects();
        sourceName = "none";
        peakLevel = 0f;
        clipped.set(0);
        playbackPeak = 0f;
        // Wake anything blocked waiting for audio.
        for (Subscription s : subscribers) s.open = false;
        subscribers.clear();
        Log.i(TAG, "microphone stopped");
    }

    private static String sourceLabel(int source) {
        if (source == MediaRecorder.AudioSource.VOICE_RECOGNITION) return "voice recognition";
        if (source == MediaRecorder.AudioSource.VOICE_COMMUNICATION) return "voice call (AGC)";
        if (source == MediaRecorder.AudioSource.MIC) return "mic";
        return "source " + source;
    }

    private void attachEffects(int sessionId) {
        try {
            if (AcousticEchoCanceler.isAvailable()) {
                echoCanceller = AcousticEchoCanceler.create(sessionId);
                if (echoCanceller != null) {
                    echoCanceller.setEnabled(true);
                    echoCancelActive = echoCanceller.getEnabled();
                }
            }
            if (NoiseSuppressor.isAvailable()) {
                noiseSuppressor = NoiseSuppressor.create(sessionId);
                if (noiseSuppressor != null) noiseSuppressor.setEnabled(true);
            }
        } catch (Exception e) {
            Log.w(TAG, "audio effects unavailable", e);
        }
    }

    private void releaseEffects() {
        try { if (echoCanceller != null) echoCanceller.release(); } catch (Exception ignored) { }
        try { if (noiseSuppressor != null) noiseSuppressor.release(); } catch (Exception ignored) { }
        echoCanceller = null;
        noiseSuppressor = null;
        echoCancelActive = false;
    }

    private void captureLoop() {
        byte[] buffer = new byte[CHUNK_BYTES];
        byte[] silence = new byte[CHUNK_BYTES];
        while (capturing) {
            AudioRecord rec = record;
            if (rec == null) break;
            int read;
            try {
                read = rec.read(buffer, 0, buffer.length);
            } catch (Exception e) {
                Log.w(TAG, "microphone read failed", e);
                break;
            }
            if (read <= 0) continue;

            // Keep reading even while gated, or the hardware buffer overruns
            // and the audio arrives late and broken once the gate lifts.
            boolean gated = halfDuplex && isTalking();
            byte[] chunk = new byte[read];
            System.arraycopy(gated ? silence : buffer, 0, chunk, 0, read);
            if (!gated) {
                applyGainAndMeter(chunk, read);
            } else {
                peakLevel = 0f;
            }

            for (Subscription s : subscribers) {
                if (!s.open) { subscribers.remove(s); continue; }
                if (!s.queue.offer(chunk)) {
                    // This listener has fallen behind. Throw the whole backlog
                    // away and jump to live rather than dropping one frame at a
                    // time: shedding a single frame per overflow leaves the
                    // queue full, so the lag it represents never goes away.
                    s.queue.clear();
                    s.queue.offer(chunk);
                    s.dropped.incrementAndGet();
                }
            }
        }
    }

    /**
     * Multiply the samples and record the peak, in place.
     *
     * Clipping is hard rather than soft-kneed: a limiter would hide the fact
     * that the gain is set too high, and for monitoring it is more useful to
     * hear it break up and see the clip counter climb than to be quietly
     * squashed. The meter is what the gain should be set by.
     */
    private void applyGainAndMeter(byte[] buf, int len) {
        float g = gain;
        int peak = 0;
        int clips = 0;
        for (int i = 0; i + 1 < len; i += 2) {
            // Little-endian 16-bit signed.
            int sample = (short) ((buf[i] & 0xFF) | (buf[i + 1] << 8));
            int v = Math.round(sample * g);
            if (v > 32767) { v = 32767; clips++; }
            else if (v < -32768) { v = -32768; clips++; }
            buf[i] = (byte) (v & 0xFF);
            buf[i + 1] = (byte) ((v >> 8) & 0xFF);
            int mag = v < 0 ? -v : v;
            if (mag > peak) peak = mag;
        }
        peakLevel = peak / 32768f;
        if (clips > 0) clipped.addAndGet(clips);
    }

    // --- listener plumbing -----------------------------------------------------

    public Subscription subscribe() {
        Subscription s = new Subscription();
        subscribers.add(s);
        return s;
    }

    public void unsubscribe(Subscription s) {
        s.open = false;
        subscribers.remove(s);
    }

    /** Next chunk for this listener, or null on timeout or shutdown. */
    @Nullable
    public byte[] take(Subscription s, long timeoutMs) {
        if (!s.open || !capturing) return null;
        try {
            return s.queue.poll(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        }
    }

    // --- playback (talkback) -----------------------------------------------------

    /**
     * Play PCM that arrived from a listener.
     *
     * The track is created lazily at whatever rate the sender used and rebuilt
     * if that changes, which avoids writing a resampler: the browser decides
     * the rate and the hardware follows.
     */
    public boolean play(byte[] data, int offset, int length, int rate) {
        if (length <= 0) return false;
        synchronized (trackLock) {
            if (track == null || trackRate != rate) {
                releaseTrack();
                if (!createTrack(rate)) return false;
            }
            AudioTrack t = track;
            if (t == null) return false;
            // Nothing upstream amplifies this. Synthesised speech and browser
            // microphone audio both arrive well below full scale, so without
            // a gain here talkback is barely audible even at full volume.
            applyPlaybackGain(data, offset, length);
            try {
                int written = t.write(data, offset, length);
                if (written > 0) {
                    lastPlaybackAtMs = System.currentTimeMillis();
                    totalTalkBytes += written;
                }
                return written > 0;
            } catch (Exception e) {
                Log.w(TAG, "playback write failed", e);
                return false;
            }
        }
    }

    private void applyPlaybackGain(byte[] buf, int offset, int length) {
        float g = playbackGain;
        int peak = 0;
        int clips = 0;
        for (int i = offset; i + 1 < offset + length; i += 2) {
            int sample = (short) ((buf[i] & 0xFF) | (buf[i + 1] << 8));
            int v = g == 1f ? sample : Math.round(sample * g);
            if (v > 32767) { v = 32767; clips++; }
            else if (v < -32768) { v = -32768; clips++; }
            buf[i] = (byte) (v & 0xFF);
            buf[i + 1] = (byte) ((v >> 8) & 0xFF);
            int mag = v < 0 ? -v : v;
            if (mag > peak) peak = mag;
        }
        playbackPeak = peak / 32768f;
        if (clips > 0) playbackClipped.addAndGet(clips);
    }

    private boolean createTrack(int rate) {
        int minBuf = AudioTrack.getMinBufferSize(rate,
                AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
        if (minBuf <= 0) {
            Log.e(TAG, "playback rate " + rate + " not supported");
            return false;
        }
        try {
            // USAGE_VOICE_COMMUNICATION sounds like the right choice for
            // speech, and it is the wrong one here: it routes to the call
            // stream, which on most phones means the earpiece rather than the
            // loudspeaker, governed by the in-call volume rather than the
            // media slider. The result is talkback that is almost inaudible
            // across a room. USAGE_MEDIA puts it out of the loudspeaker at
            // media volume, which is what anyone expects from an intercom.
            //
            // The cost is that the echo canceller loses its reference, so
            // two-way audio can echo more. Half-duplex gating still covers
            // that, and headphones on the phone end remove the issue.
            int usage = loudspeaker
                    ? AudioAttributes.USAGE_MEDIA
                    : AudioAttributes.USAGE_VOICE_COMMUNICATION;
            AudioTrack t = new AudioTrack.Builder()
                    .setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(usage)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build())
                    .setAudioFormat(new AudioFormat.Builder()
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setSampleRate(rate)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                            .build())
                    .setBufferSizeInBytes(minBuf * 2)
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .build();
            t.setVolume(1.0f);          // be explicit rather than trusting the default
            t.play();
            track = t;
            trackRate = rate;
            Log.i(TAG, "talkback track created at " + rate + "Hz, "
                    + (loudspeaker ? "loudspeaker/media" : "earpiece/call")
                    + ", gain " + playbackGain + "x");
            return true;
        } catch (Exception e) {
            Log.e(TAG, "could not create the playback track", e);
            return false;
        }
    }

    private void releaseTrack() {
        AudioTrack t = track;
        track = null;
        trackRate = 0;
        if (t != null) {
            try { t.stop(); } catch (Exception ignored) { }
            try { t.release(); } catch (Exception ignored) { }
        }
    }

    public void shutdown() {
        stopCapture();
        synchronized (trackLock) { releaseTrack(); }
    }

    // --- WAV ---------------------------------------------------------------------

    /**
     * A 44-byte WAV header for a stream of unknown length.
     *
     * The sizes are set to the largest value that still looks sane rather than
     * a real length, because the length is not knowable until the stream ends.
     * Browsers and media players accept this and simply keep playing; it is
     * the same trick every webcam server uses.
     */
    public static byte[] wavHeader(int sampleRate, int channels, int bitsPerSample) {
        final int dataSize = 0x7FFFFFFF - 36;   // "as long as it needs to be"
        int byteRate = sampleRate * channels * bitsPerSample / 8;
        int blockAlign = channels * bitsPerSample / 8;
        byte[] h = new byte[44];
        int i = 0;
        i = putAscii(h, i, "RIFF");
        i = putIntLE(h, i, dataSize + 36);
        i = putAscii(h, i, "WAVE");
        i = putAscii(h, i, "fmt ");
        i = putIntLE(h, i, 16);                 // PCM chunk size
        i = putShortLE(h, i, (short) 1);        // format 1 = uncompressed PCM
        i = putShortLE(h, i, (short) channels);
        i = putIntLE(h, i, sampleRate);
        i = putIntLE(h, i, byteRate);
        i = putShortLE(h, i, (short) blockAlign);
        i = putShortLE(h, i, (short) bitsPerSample);
        i = putAscii(h, i, "data");
        putIntLE(h, i, dataSize);
        return h;
    }

    /** What a parsed WAV turned out to contain. */
    public static final class WavInfo {
        public final int dataOffset;
        public final int dataLength;
        public final int sampleRate;
        public final int channels;
        public final int bitsPerSample;

        WavInfo(int dataOffset, int dataLength, int sampleRate,
                int channels, int bitsPerSample) {
            this.dataOffset = dataOffset;
            this.dataLength = dataLength;
            this.sampleRate = sampleRate;
            this.channels = channels;
            this.bitsPerSample = bitsPerSample;
        }
    }

    /**
     * Read a WAV header, or return null if this is not one.
     *
     * The chunks are walked rather than assuming the canonical 44-byte layout,
     * because plenty of encoders put a LIST or fact chunk between fmt and
     * data. Skipping a fixed 44 bytes works until the first tool that does
     * that, and then it plays a burst of noise instead.
     */
    @Nullable
    public static WavInfo parseWav(byte[] b, int length) {
        if (b == null || length < 44) return null;
        if (!matches(b, 0, "RIFF") || !matches(b, 8, "WAVE")) return null;

        int sampleRate = 0, channels = 0, bits = 0;
        int pos = 12;
        while (pos + 8 <= length) {
            String id = new String(b, pos, 4, java.nio.charset.StandardCharsets.US_ASCII);
            int size = intLE(b, pos + 4);
            int body = pos + 8;
            if (size < 0 || body > length) break;

            if ("fmt ".equals(id) && body + 16 <= length) {
                int format = shortLE(b, body);
                channels = shortLE(b, body + 2);
                sampleRate = intLE(b, body + 4);
                bits = shortLE(b, body + 14);
                // 1 = uncompressed PCM. 0xFFFE is extensible, which is still
                // PCM for our purposes when the bit depth is 16.
                if (format != 1 && format != 0xFFFE) return null;
            } else if ("data".equals(id)) {
                int available = Math.min(size, length - body);
                if (available <= 0 || sampleRate <= 0 || channels <= 0) return null;
                return new WavInfo(body, available, sampleRate, channels, bits);
            }

            // Chunks are word-aligned: an odd size is followed by a pad byte.
            pos = body + size + (size & 1);
        }
        return null;
    }

    private static boolean matches(byte[] b, int at, String ascii) {
        if (at + ascii.length() > b.length) return false;
        for (int i = 0; i < ascii.length(); i++) {
            if (b[at + i] != (byte) ascii.charAt(i)) return false;
        }
        return true;
    }

    private static int intLE(byte[] b, int at) {
        return (b[at] & 0xFF) | ((b[at + 1] & 0xFF) << 8)
                | ((b[at + 2] & 0xFF) << 16) | ((b[at + 3] & 0xFF) << 24);
    }

    private static int shortLE(byte[] b, int at) {
        return (b[at] & 0xFF) | ((b[at + 1] & 0xFF) << 8);
    }

    /** Average stereo down to mono in place, returning the new length. */
    public static int downmixToMono(byte[] b, int offset, int length) {
        int frames = length / 4;          // two 16-bit samples per frame
        for (int i = 0; i < frames; i++) {
            int l = (short) ((b[offset + i * 4] & 0xFF) | (b[offset + i * 4 + 1] << 8));
            int r = (short) ((b[offset + i * 4 + 2] & 0xFF) | (b[offset + i * 4 + 3] << 8));
            int m = (l + r) / 2;
            b[offset + i * 2] = (byte) (m & 0xFF);
            b[offset + i * 2 + 1] = (byte) ((m >> 8) & 0xFF);
        }
        return frames * 2;
    }

    private static int putAscii(byte[] out, int at, String s) {
        for (int i = 0; i < s.length(); i++) out[at + i] = (byte) s.charAt(i);
        return at + s.length();
    }

    private static int putIntLE(byte[] out, int at, int v) {
        out[at] = (byte) (v & 0xFF);
        out[at + 1] = (byte) ((v >> 8) & 0xFF);
        out[at + 2] = (byte) ((v >> 16) & 0xFF);
        out[at + 3] = (byte) ((v >> 24) & 0xFF);
        return at + 4;
    }

    private static int putShortLE(byte[] out, int at, short v) {
        out[at] = (byte) (v & 0xFF);
        out[at + 1] = (byte) ((v >> 8) & 0xFF);
        return at + 2;
    }
}
