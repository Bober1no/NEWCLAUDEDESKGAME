package com.example.ipcam;

import android.util.Base64;
import android.util.Log;

import androidx.annotation.Nullable;

import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.BindException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Small HTTP server serving the camera over the LOCAL NETWORK.
 *
 *   GET /            viewer page with controls
 *   GET /stream      multipart/x-mixed-replace MJPEG stream
 *   GET /shot.jpg    single current frame
 *   GET /status      JSON state
 *   GET /control?... change settings at runtime (see Host.onControl)
 *
 * Security notes, deliberately plain:
 *  - Traffic is plain HTTP. It is NOT encrypted. Anyone sniffing the network
 *    can read the video and the Basic-auth credentials.
 *  - HTTP Basic auth is supported and ON by default, but over cleartext it only
 *    keeps out casual passers-by on your own LAN. It is not real security.
 *  - Do not expose this port to the internet. Keep it on a network you trust.
 */
public class MjpegServer {

    private static final String TAG = "MjpegServer";
    private static final String BOUNDARY = "ipcamframe";
    private static final String REALM = "Local IP Cam";

    /** Hooks back into the service that owns the camera. */
    public interface Host {
        Settings settings();
        /** Apply control-panel changes. Called off the main thread. */
        void onControl(Map<String, String> params);
        String statusJson();
        /**
         * Begin a long-exposure still. Returns false if one is already running,
         * in which case neither callback fires. Callbacks arrive on some other
         * thread, so the caller must hand off safely.
         */
        boolean startNightShot(java.util.function.Consumer<byte[]> onJpeg,
                               java.util.function.Consumer<String> onError);
        /** The audio engine, or null when audio is switched off entirely. */
        @Nullable AudioHub audio();
        /** Whether listeners are allowed to send audio back to the speaker. */
        boolean talkbackAllowed();
        /** Text waiting for a PC helper to speak, or null when unavailable. */
        @Nullable SayQueue sayQueue();

        /**
         * A client connected or disconnected.
         *
         * Lets the service re-decide whether the sensor should be running at
         * its idle rate, which has to happen the instant somebody opens the
         * stream rather than on the next scheduled review — otherwise the
         * first second of every session is a slideshow.
         */
        void onViewersChanged(int viewers);
    }

    private static final class Frame {
        final byte[] data;
        final long seq;
        Frame(byte[] data, long seq) { this.data = data; this.seq = seq; }
    }

    private final Host host;
    private final int port;

    private volatile boolean running = false;
    private ServerSocket serverSocket;
    private Thread acceptThread;
    private InetAddress boundAddress = null;

    private final Object frameLock = new Object();
    private byte[] latestFrame = null;
    private long frameSeq = 0;

    private final CopyOnWriteArrayList<Socket> clients = new CopyOnWriteArrayList<>();
    private final AtomicInteger viewers = new AtomicInteger(0);
    private final AtomicInteger audioListeners = new AtomicInteger(0);
    private final AtomicInteger talkChunks = new AtomicInteger(0);

    /** One POST should be a fraction of a second of audio, not a file upload. */
    private static final int MAX_TALK_BYTES = 512 * 1024;

    public MjpegServer(Host host, int port) {
        this.host = host;
        this.port = port;
    }

    public int getPort() { return port; }

    /** The address actually bound, or null if listening on all interfaces. */
    public InetAddress getBoundAddress() { return boundAddress; }
    public int getViewerCount() { return viewers.get(); }
    public int getAudioListenerCount() { return audioListeners.get(); }
    public int getTalkChunkCount() { return talkChunks.get(); }

    // --- frame plumbing ----------------------------------------------------

    /** Called by the encoder whenever a new JPEG is ready. */
    public void pushFrame(byte[] jpeg) {
        synchronized (frameLock) {
            latestFrame = jpeg;
            frameSeq++;
            frameLock.notifyAll();
        }
    }

    private Frame currentFrame() {
        synchronized (frameLock) {
            return latestFrame == null ? null : new Frame(latestFrame, frameSeq);
        }
    }

    /** Block until a frame newer than lastSeq arrives, or the timeout expires. */
    private Frame awaitFrame(long lastSeq, long timeoutMs) throws InterruptedException {
        synchronized (frameLock) {
            long deadline = System.currentTimeMillis() + timeoutMs;
            while (running && frameSeq == lastSeq) {
                long wait = deadline - System.currentTimeMillis();
                if (wait <= 0) return null;
                frameLock.wait(wait);
            }
            if (!running || latestFrame == null) return null;
            return new Frame(latestFrame, frameSeq);
        }
    }

    // --- lifecycle ---------------------------------------------------------

    public synchronized void start() throws IOException {
        if (running) return;

        // Decide what to listen on BEFORE opening the socket. A wildcard bind
        // would also listen on the device's public IPv6 address, so in LAN-only
        // mode we bind the single LAN IPv4 address and nothing else.
        InetAddress bindTo = null;
        if (host.settings().lanOnly) {
            bindTo = NetworkUtils.getLanIpv4();
            if (bindTo == null) {
                throw new IOException("No local network address found. Connect to Wi-Fi, "
                        + "or turn off LAN-only mode if you really mean to listen "
                        + "on every interface.");
            }
        }

        serverSocket = new ServerSocket();
        serverSocket.setReuseAddress(true);
        // A null address means the wildcard, i.e. every interface.
        serverSocket.bind(new InetSocketAddress(bindTo, port));
        boundAddress = bindTo;
        running = true;
        startAcceptThread(serverSocket);
        Log.i(TAG, "Listening on " + (bindTo == null ? "ALL INTERFACES" : bindTo.getHostAddress())
                + ":" + port);
        if (bindTo == null) {
            for (String pub : NetworkUtils.publicAddresses()) {
                Log.w(TAG, "REACHABLE ON PUBLIC ADDRESS: " + pub + ":" + port);
            }
        }
    }

    public synchronized void stop() {
        running = false;
        synchronized (frameLock) { frameLock.notifyAll(); }
        for (Socket s : clients) {
            try { s.close(); } catch (IOException ignored) { }
        }
        clients.clear();
        viewers.set(0);
        try { if (serverSocket != null) serverSocket.close(); } catch (IOException ignored) { }
        boundAddress = null;
        Log.i(TAG, "Stopped");
    }

    private void startAcceptThread(ServerSocket socket) {
        acceptThread = new Thread(() -> acceptLoop(socket), "mjpeg-accept");
        acceptThread.setDaemon(true);
        acceptThread.start();
    }

    /**
     * Accepts on ONE specific socket. The socket is passed in rather than read
     * from the field so that a rebind can retire this thread cleanly: closing
     * the old socket makes accept() throw, the loop sees it is closed, and the
     * thread exits instead of racing the new one.
     */
    private void acceptLoop(ServerSocket socket) {
        while (running && !socket.isClosed()) {
            try {
                Socket client = socket.accept();
                client.setTcpNoDelay(true);
                Thread t = new Thread(() -> handle(client), "mjpeg-client");
                t.setDaemon(true);
                t.start();
            } catch (IOException e) {
                if (running && !socket.isClosed()) Log.w(TAG, "accept failed", e);
            }
        }
        Log.i(TAG, "accept thread finished");
    }

    private ServerSocket openBound(InetAddress address) throws IOException {
        ServerSocket ss = new ServerSocket();
        ss.setReuseAddress(true);
        try {
            ss.bind(new InetSocketAddress(address, port));
        } catch (IOException e) {
            try { ss.close(); } catch (IOException ignored) { }
            throw e;
        }
        return ss;
    }

    /** Retry a bind a few times; port release after a close is not instant. */
    private ServerSocket openBoundWithRetry(InetAddress address, int attempts, long delayMs)
            throws IOException {
        IOException last = null;
        for (int i = 0; i < attempts; i++) {
            try {
                return openBound(address);
            } catch (IOException e) {
                last = e;
                if (i == attempts - 1) break;
                try {
                    Thread.sleep(delayMs);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
        throw last != null ? last : new IOException("could not bind " + address);
    }

    /**
     * Drop the current listener. Existing client connections are untouched;
     * only new connections stop being accepted. boundAddress is cleared so a
     * later retry does not believe it is still bound somewhere.
     */
    private void closeListener() {
        ServerSocket old = serverSocket;
        serverSocket = null;
        boundAddress = null;
        if (old != null) {
            try { old.close(); } catch (IOException ignored) { }
        }
    }

    /**
     * Move the listening socket to a new address without tearing down the
     * camera. Needed because binding one specific address means a DHCP lease
     * change leaves us bound to an address the device no longer has, and the
     * stream would silently stop accepting until restarted.
     *
     * Viewers connected to the old address are dropped — their TCP connections
     * died with it — and have to reload.
     */
    public synchronized void rebindTo(InetAddress newAddress) throws IOException {
        if (!running) return;

        // Already there: do nothing rather than churn the socket and drop
        // viewers for no reason.
        if (newAddress.equals(boundAddress)) return;

        ServerSocket fresh;
        try {
            // Preferred order: bind the new socket FIRST, so if it fails we are
            // still listening on the old address and nothing is lost.
            fresh = openBound(newAddress);
        } catch (BindException conflict) {
            // The two binds overlap — the old socket is on the wildcard, or on
            // this very address. SO_REUSEADDR does not help here; it permits
            // rebinding a TIME_WAIT address, not two live listeners. Give up
            // the old socket first and then take the new address.
            Log.w(TAG, "bind conflict (" + conflict.getMessage()
                    + "), releasing the old socket before retrying");
            Thread oldAccept = acceptThread;
            closeListener();
            // The kernel can hold the port for a moment while a thread is still
            // blocked in accept() on the socket we just closed, so wait for that
            // thread to unwind before trying to take the address.
            if (oldAccept != null) {
                try {
                    oldAccept.join(500);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                }
            }
            fresh = openBoundWithRetry(newAddress, 5, 100);
        }

        ServerSocket old = serverSocket;
        serverSocket = fresh;
        boundAddress = newAddress;

        if (old != null) {
            try { old.close(); } catch (IOException ignored) { }
        }
        // Clients on the dead address will never recover; free their threads.
        for (Socket c : clients) {
            try { c.close(); } catch (IOException ignored) { }
        }
        clients.clear();

        startAcceptThread(fresh);
        Log.i(TAG, "Rebound to " + newAddress.getHostAddress() + ":" + port);
    }

    // --- request handling --------------------------------------------------

    /**
     * Read one CRLF-terminated line straight off the socket.
     *
     * Deliberately NOT a BufferedReader: that reads ahead by thousands of
     * bytes, so the start of a POST body would vanish into its buffer and the
     * body read would then block forever waiting for bytes it had already
     * swallowed. Byte-at-a-time is slower, but request headers are small and
     * this keeps the body boundary exact.
     */
    @Nullable
    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream(128);
        int b;
        while ((b = in.read()) != -1) {
            if (b == '\n') break;
            if (b != '\r') buf.write(b);
            if (buf.size() > 8192) throw new IOException("header line too long");
        }
        if (b == -1 && buf.size() == 0) return null;
        return new String(buf.toByteArray(), StandardCharsets.UTF_8);
    }

    /** Read exactly n bytes, or throw if the client hangs up early. */
    private static byte[] readExactly(InputStream in, int n) throws IOException {
        byte[] out = new byte[n];
        int got = 0;
        while (got < n) {
            int r = in.read(out, got, n - got);
            if (r < 0) throw new IOException("client closed mid-body");
            got += r;
        }
        return out;
    }

    private void handle(Socket client) {
        clients.add(client);
        try {
            // Second layer: even if something is listening where we did not
            // expect, only serve callers that are actually on a local network.
            if (host.settings().lanOnly
                    && !NetworkUtils.isLocalClient(client.getInetAddress())) {
                Log.w(TAG, "Refused non-local client " + client.getInetAddress());
                sendForbidden(client.getOutputStream());
                return;
            }

            InputStream in = client.getInputStream();
            String requestLine = readLine(in);
            if (requestLine == null || requestLine.isEmpty()) return;

            String authHeader = null;
            int contentLength = 0;
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int c = line.indexOf(':');
                if (c <= 0) continue;
                String name = line.substring(0, c).trim();
                String value = line.substring(c + 1).trim();
                if (name.equalsIgnoreCase("Authorization")) {
                    authHeader = value;
                } else if (name.equalsIgnoreCase("Content-Length")) {
                    try {
                        contentLength = Integer.parseInt(value);
                    } catch (NumberFormatException ignored) { }
                }
            }

            String[] parts = requestLine.split(" ");
            String method = parts.length >= 1 ? parts[0].toUpperCase() : "GET";
            String target = parts.length >= 2 ? parts[1] : "/";

            String path = target;
            String query = "";
            int q = target.indexOf('?');
            if (q >= 0) {
                path = target.substring(0, q);
                query = target.substring(q + 1);
            }

            OutputStream raw = client.getOutputStream();
            BufferedOutputStream out = new BufferedOutputStream(raw, 64 * 1024);

            if (!authorized(authHeader)) {
                sendUnauthorized(out);
                return;
            }

            switch (path) {
                case "/stream":
                    serveStream(out);
                    break;
                case "/shot.jpg":
                    Map<String, String> shotParams = parseQuery(query);
                    if ("1".equals(shotParams.get("night"))
                            || "true".equalsIgnoreCase(shotParams.get("night"))) {
                        serveNightSnapshot(out);
                    } else {
                        serveSnapshot(out);
                    }
                    break;
                case "/audio.wav":
                    serveAudio(out, true);
                    break;
                case "/audio.pcm":
                    serveAudio(out, false);
                    break;
                case "/say":
                    serveSay(in, out, method, contentLength);
                    break;
                case "/say/next":
                    serveSayNext(out);
                    break;
                case "/talk":
                    serveTalk(in, out, method, parseQuery(query), contentLength);
                    break;
                case "/status":
                    sendText(out, 200, "application/json", host.statusJson());
                    break;
                case "/control":
                    host.onControl(parseQuery(query));
                    sendText(out, 200, "application/json", host.statusJson());
                    break;
                case "/":
                case "/index.html":
                    sendText(out, 200, "text/html; charset=utf-8", viewerPage());
                    break;
                default:
                    sendText(out, 404, "text/plain", "Not found");
            }
        } catch (IOException e) {
            // Client hung up. Normal for a long-lived stream.
        } finally {
            clients.remove(client);
            try { client.close(); } catch (IOException ignored) { }
        }
    }

    private static Map<String, String> parseQuery(String query) {
        Map<String, String> map = new LinkedHashMap<>();
        if (query == null || query.isEmpty()) return map;
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            try {
                if (eq < 0) {
                    map.put(URLDecoder.decode(pair, "UTF-8"), "");
                } else {
                    map.put(URLDecoder.decode(pair.substring(0, eq), "UTF-8"),
                            URLDecoder.decode(pair.substring(eq + 1), "UTF-8"));
                }
            } catch (Exception ignored) { }
        }
        return map;
    }

    // --- auth --------------------------------------------------------------

    private boolean authorized(String authHeader) {
        Settings s = host.settings();
        if (!s.authEnabled) return true;
        if (authHeader == null || !authHeader.regionMatches(true, 0, "Basic ", 0, 6)) return false;
        try {
            byte[] decoded = Base64.decode(authHeader.substring(6).trim(), Base64.DEFAULT);
            String creds = new String(decoded, StandardCharsets.UTF_8);
            String expected = s.username + ":" + s.password;
            // Constant-time compare so timing doesn't leak the password.
            return MessageDigest.isEqual(
                    creds.getBytes(StandardCharsets.UTF_8),
                    expected.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            return false;
        }
    }

    private void sendForbidden(OutputStream out) throws IOException {
        byte[] body = ("This camera only serves clients on the local network.\n")
                .getBytes(StandardCharsets.UTF_8);
        String headers = "HTTP/1.1 403 Forbidden\r\n"
                + "Content-Type: text/plain; charset=utf-8\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Connection: close\r\n\r\n";
        out.write(headers.getBytes(StandardCharsets.UTF_8));
        out.write(body);
        out.flush();
    }

    private void sendUnauthorized(OutputStream out) throws IOException {
        byte[] body = "Authentication required.".getBytes(StandardCharsets.UTF_8);
        String headers = "HTTP/1.1 401 Unauthorized\r\n"
                + "WWW-Authenticate: Basic realm=\"" + REALM + "\", charset=\"UTF-8\"\r\n"
                + "Content-Type: text/plain; charset=utf-8\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Connection: close\r\n\r\n";
        out.write(headers.getBytes(StandardCharsets.UTF_8));
        out.write(body);
        out.flush();
    }

    // --- responses ---------------------------------------------------------

    private void sendText(OutputStream out, int code, String contentType, String body)
            throws IOException {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        String reason = reasonPhrase(code);
        String headers = "HTTP/1.1 " + code + " " + reason + "\r\n"
                + "Content-Type: " + contentType + "\r\n"
                + "Content-Length: " + b.length + "\r\n"
                + "Cache-Control: no-store\r\n"
                + "Connection: close\r\n\r\n";
        out.write(headers.getBytes(StandardCharsets.UTF_8));
        out.write(b);
        out.flush();
    }

    private static String reasonPhrase(int code) {
        switch (code) {
            case 200: return "OK";
            case 202: return "Accepted";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 405: return "Method Not Allowed";
            case 409: return "Conflict";
            case 411: return "Length Required";
            case 413: return "Payload Too Large";
            case 415: return "Unsupported Media Type";
            case 429: return "Too Many Requests";
            case 500: return "Internal Server Error";
            case 503: return "Service Unavailable";
            case 504: return "Gateway Timeout";
            default:  return "Error";
        }
    }

    private void serveSnapshot(OutputStream out) throws IOException {
        Frame f = currentFrame();
        if (f == null) {
            sendText(out, 503, "text/plain", "No frame yet. Is the stream started?");
            return;
        }
        String headers = "HTTP/1.1 200 OK\r\n"
                + "Content-Type: image/jpeg\r\n"
                + "Content-Length: " + f.data.length + "\r\n"
                + "Cache-Control: no-store\r\n"
                + "Connection: close\r\n\r\n";
        out.write(headers.getBytes(StandardCharsets.UTF_8));
        out.write(f.data);
        out.flush();
    }

    /**
     * Take a fresh long-exposure still and send it.
     *
     * This blocks the client thread while the camera rebinds, exposes and
     * rebinds back — typically one to three seconds, and the live stream is
     * paused for that whole time. The image is only ever held in memory and
     * written to this socket; nothing touches phone storage.
     */
    private void serveNightSnapshot(OutputStream out) throws IOException {
        final CountDownLatch done = new CountDownLatch(1);
        final AtomicReference<byte[]> jpeg = new AtomicReference<>(null);
        final AtomicReference<String> error = new AtomicReference<>(null);

        boolean started = host.startNightShot(
                bytes -> { jpeg.set(bytes); done.countDown(); },
                message -> { error.set(message); done.countDown(); });

        if (!started) {
            sendText(out, 409, "text/plain",
                    "A night snapshot is already in progress. Try again in a moment.");
            return;
        }

        boolean finished;
        try {
            finished = done.await(15, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            sendText(out, 503, "text/plain", "Interrupted while waiting for the capture.");
            return;
        }

        if (!finished) {
            sendText(out, 504, "text/plain",
                    "The night snapshot did not complete within 15 seconds.");
            return;
        }
        byte[] data = jpeg.get();
        if (data == null) {
            String why = error.get();
            sendText(out, 500, "text/plain",
                    "Night snapshot failed: " + (why == null ? "unknown error" : why));
            return;
        }

        String headers = "HTTP/1.1 200 OK\r\n"
                + "Content-Type: image/jpeg\r\n"
                + "Content-Length: " + data.length + "\r\n"
                + "Content-Disposition: inline; filename=\"nightshot.jpg\"\r\n"
                + "Cache-Control: no-store\r\n"
                + "Connection: close\r\n\r\n";
        out.write(headers.getBytes(StandardCharsets.UTF_8));
        out.write(data);
        out.flush();
    }

    /**
     * Stream the microphone.
     *
     * As WAV this plays in a plain <audio> tag with no JavaScript at all: the
     * 44-byte header declares an open-ended length and the PCM simply keeps
     * coming. As raw PCM it suits scripts and the Web Audio API, which want
     * the samples without a container.
     */
    private void serveAudio(OutputStream out, boolean wav) throws IOException {
        AudioHub audio = host.audio();
        if (audio == null || !audio.isCapturing()) {
            sendText(out, 503, "text/plain",
                    "The microphone is off. Turn on audio in the app first.");
            return;
        }

        int rate = audio.getSampleRate();
        String headers = "HTTP/1.1 200 OK\r\n"
                + "Content-Type: " + (wav ? "audio/wav" : "audio/L16;rate=" + rate) + "\r\n"
                + "Cache-Control: no-store, no-cache\r\n"
                + "Pragma: no-cache\r\n"
                + "Connection: close\r\n\r\n";
        out.write(headers.getBytes(StandardCharsets.UTF_8));
        if (wav) out.write(AudioHub.wavHeader(rate, 1, 16));
        out.flush();

        AudioHub.Subscription sub = audio.subscribe();
        audioListeners.incrementAndGet();
        try {
            while (running && audio.isCapturing()) {
                byte[] chunk = audio.take(sub, 2000);
                if (chunk == null) continue;      // timeout: re-check and carry on
                out.write(chunk);
                out.flush();
            }
        } finally {
            audio.unsubscribe(sub);
            audioListeners.decrementAndGet();
        }
    }

    /**
     * Accept audio from a listener and play it out of the phone's speaker.
     *
     * Bodies are short and finite — a few hundred milliseconds each — rather
     * than one endless upload. Streaming request bodies need HTTP/2 or a
     * secure context in most browsers, whereas a plain Content-Length POST
     * works everywhere, and the latency cost is roughly one chunk.
     */
    private void serveTalk(InputStream in, OutputStream out, String method,
                           Map<String, String> params, int contentLength)
            throws IOException {
        if (!"POST".equals(method) && !"PUT".equals(method)) {
            sendText(out, 405, "text/plain", "POST raw 16-bit PCM to this address.");
            return;
        }
        if (!host.talkbackAllowed()) {
            sendText(out, 403, "text/plain",
                    "Talkback is switched off. Enable it in the app first.");
            return;
        }
        AudioHub audio = host.audio();
        if (audio == null) {
            sendText(out, 503, "text/plain", "Audio is not running.");
            return;
        }
        if (contentLength <= 0) {
            sendText(out, 411, "text/plain", "Send a Content-Length with the PCM body.");
            return;
        }
        if (contentLength > MAX_TALK_BYTES) {
            sendText(out, 413, "text/plain",
                    "Chunk too large; send at most " + MAX_TALK_BYTES + " bytes at a time.");
            return;
        }

        int rate = audio.getSampleRate();
        String rateParam = params.get("rate");
        if (rateParam != null) {
            try {
                rate = Settings.clamp(Integer.parseInt(rateParam), 4000, 48000);
            } catch (NumberFormatException ignored) { }
        }

        byte[] pcm = readExactly(in, contentLength);
        int offset = 0;
        int length = pcm.length;

        // Accept a WAV as readily as raw PCM: most things that can synthesise
        // or record audio emit WAV, and making the caller strip the header is
        // a pointless trap.
        AudioHub.WavInfo wav = AudioHub.parseWav(pcm, pcm.length);
        if (wav != null) {
            if (wav.bitsPerSample != 16) {
                sendText(out, 415, "text/plain",
                        "Only 16-bit PCM is supported; this WAV is "
                                + wav.bitsPerSample + "-bit.");
                return;
            }
            offset = wav.dataOffset;
            length = wav.dataLength;
            rate = wav.sampleRate;      // the file knows better than the query
            if (wav.channels == 2) {
                length = AudioHub.downmixToMono(pcm, offset, length);
            } else if (wav.channels != 1) {
                sendText(out, 415, "text/plain",
                        "Only mono or stereo is supported; this WAV has "
                                + wav.channels + " channels.");
                return;
            }
        }

        boolean played = audio.play(pcm, offset, length, rate);
        if (played) talkChunks.incrementAndGet();
        sendText(out, played ? 200 : 500, "text/plain",
                played ? "ok" : "The speaker would not accept that audio.");
    }

    /**
     * Queue some text for a PC helper to speak.
     *
     * The phone does no synthesis: it holds the string until a helper collects
     * it. That keeps text-to-speech entirely off the phone's battery, which is
     * the whole point of doing it this way.
     */
    private void serveSay(InputStream in, OutputStream out, String method,
                          int contentLength) throws IOException {
        if (!"POST".equals(method) && !"PUT".equals(method)) {
            sendText(out, 405, "text/plain", "POST the text to speak to this address.");
            return;
        }
        if (!host.talkbackAllowed()) {
            sendText(out, 403, "text/plain",
                    "Talkback is switched off, so nothing can be spoken.");
            return;
        }
        SayQueue queue = host.sayQueue();
        if (queue == null) {
            sendText(out, 503, "text/plain", "Audio is not running.");
            return;
        }
        if (contentLength <= 0) {
            sendText(out, 411, "text/plain", "Send the text as the request body.");
            return;
        }
        if (contentLength > SayQueue.MAX_TEXT_LENGTH * 4) {
            sendText(out, 413, "text/plain", "That is too much text for one utterance.");
            return;
        }

        String text = new String(readExactly(in, contentLength), StandardCharsets.UTF_8);
        if (!queue.offer(text)) {
            sendText(out, 429, "text/plain",
                    "The speech queue is full. Is the PC helper running?");
            return;
        }
        // Tell the caller whether anything is actually going to pick this up,
        // otherwise typing into the void looks identical to it working.
        sendText(out, 202, "text/plain", queue.helperOnline()
                ? "queued" : "queued, but no PC helper has polled recently");
    }

    /** A PC helper collecting the next utterance. 204 when there is nothing. */
    private void serveSayNext(OutputStream out) throws IOException {
        SayQueue queue = host.sayQueue();
        if (queue == null) {
            sendText(out, 503, "text/plain", "Audio is not running.");
            return;
        }
        String next = queue.poll();     // also marks the helper as alive
        if (next == null) {
            String headers = "HTTP/1.1 204 No Content\r\n"
                    + "Cache-Control: no-store\r\n"
                    + "Connection: close\r\n\r\n";
            out.write(headers.getBytes(StandardCharsets.UTF_8));
            out.flush();
            return;
        }
        sendText(out, 200, "text/plain; charset=utf-8", next);
    }

    private void serveStream(OutputStream out) throws IOException {
        host.onViewersChanged(viewers.incrementAndGet());
        try {
            String headers = "HTTP/1.1 200 OK\r\n"
                    + "Cache-Control: no-store, no-cache, private\r\n"
                    + "Pragma: no-cache\r\n"
                    + "Connection: close\r\n"
                    + "Content-Type: multipart/x-mixed-replace; boundary=" + BOUNDARY + "\r\n"
                    + "\r\n";
            out.write(headers.getBytes(StandardCharsets.UTF_8));
            out.flush();

            // Start at 0 (the initial frameSeq) so the first iteration blocks in
            // awaitFrame until a real frame exists, instead of spinning on null.
            long lastSeq = 0;
            while (running) {
                Frame f;
                try {
                    // The encoder already throttles to the target fps, so we just
                    // forward frames as they appear rather than sleeping blindly.
                    f = awaitFrame(lastSeq, 5000);
                } catch (InterruptedException e) {
                    break;
                }
                if (f == null) continue;   // timeout: loop and re-check `running`
                lastSeq = f.seq;

                String part = "--" + BOUNDARY + "\r\n"
                        + "Content-Type: image/jpeg\r\n"
                        + "Content-Length: " + f.data.length + "\r\n\r\n";
                out.write(part.getBytes(StandardCharsets.UTF_8));
                out.write(f.data);
                out.write("\r\n".getBytes(StandardCharsets.UTF_8));
                out.flush();
            }
        } finally {
            host.onViewersChanged(viewers.decrementAndGet());
        }
    }

    // --- viewer page -------------------------------------------------------

    private String viewerPage() {
        Settings s = host.settings();
        return "<!doctype html><html><head><meta charset='utf-8'>"
                + "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                + "<title>Local IP Cam</title><style>"
                + "body{margin:0;background:#101114;color:#e8e8ea;font:14px/1.45 system-ui,sans-serif}"
                + "header{padding:10px 14px;background:#191b20;border-bottom:1px solid #2a2d35}"
                + "h1{margin:0;font-size:15px;font-weight:600}"
                + ".warn{background:#3a2d12;color:#ffd87a;padding:8px 14px;font-size:12px;"
                + "border-bottom:1px solid #4a3a18}"
                + "main{padding:12px;max-width:900px;margin:0 auto}"
                + "img{width:100%;height:auto;background:#000;border-radius:6px;display:block}"
                + ".row{display:flex;align-items:center;gap:10px;margin:10px 0;flex-wrap:wrap}"
                + "label{min-width:92px;font-size:12px;opacity:.85}"
                + "input[type=range]{flex:1;min-width:140px}"
                + "button,select{background:#262a33;color:#e8e8ea;border:1px solid #3a3f4b;"
                + "border-radius:5px;padding:6px 11px;font-size:13px;cursor:pointer}"
                + "button:hover{background:#30353f}"
                + "button:disabled,.dim{opacity:.4}"
                + ".dim input,.dim select{pointer-events:none}"
                + "fieldset{border:1px solid #2a2d35;border-radius:6px;margin:14px 0;padding:4px 12px 10px}"
                + "legend{font-size:11px;text-transform:uppercase;opacity:.6;padding:0 6px}"
                + "#status{font-size:12px;opacity:.75;margin-top:10px;white-space:pre-wrap;line-height:1.6}"
                + "#hot,#manualwarn{display:none;background:#4a1d1d;color:#ff9a9a;padding:8px 10px;"
                + "border-radius:5px;margin-top:8px;font-size:12px;font-weight:600}"
                + "#shotmsg{font-size:12px;opacity:.8;margin-top:6px}"
                + "</style></head><body>"
                + "<header><h1>Local IP Cam</h1></header>"
                + "<div class='warn'>Unencrypted stream on your local network. "
                + "Only use on a network you trust, and only for spaces you own or have "
                + "permission to record. Stop the stream when you are done.</div>"
                + "<main>"
                + "<img id='v' src='/stream' alt='live stream'>"
                + "<div id='hot'></div>"
                + "<div id='manualwarn'></div>"

                + "<div id='thermal' style='display:none;background:#4a1d1d;color:#ff9a9a;"
                + "padding:8px 10px;border-radius:5px;margin-top:8px;font-size:12px;"
                + "font-weight:600'></div>"

                + "<fieldset><legend>Audio</legend>"
                + "<div class='row'><label>Mic gain</label>"
                + "<input type='range' id='gain' min='10' max='200' value='40' "
                + "oninput=\"lbl('gainv',(this.value/10).toFixed(1)+'x')\" "
                + "onchange=\"ctl('gain',this.value/10)\">"
                + "<span id='gainv'>4.0x</span></div>"
                + "<div class='row'><label>Level</label>"
                + "<div style='flex:1;height:10px;background:#20242c;border-radius:5px;"
                + "overflow:hidden;min-width:140px'>"
                + "<div id='meter' style='height:100%;width:0%;background:#4caf50;"
                + "transition:width .1s'></div></div>"
                + "<span id='meterv' style='font-size:11px;opacity:.7'></span></div>"
                + "<div class='row'>"
                + "<button id='listenbtn' onclick='toggleListen()'>Listen</button>"
                + "<button id='talkbtn'>Hold to talk</button>"
                + "<span id='audiostate' style='font-size:12px;opacity:.8'></span>"
                + "</div>"
                + "<div id='talkwarn' style='display:none;background:#3a2d12;color:#ffd87a;"
                + "padding:8px 10px;border-radius:5px;font-size:12px;margin-top:6px'></div>"
                + "<div class='row'><label>Say</label>"
                + "<input type='text' id='saytext' placeholder='type something to speak' "
                + "style='flex:1;min-width:160px;background:#20242c;color:#e8e8ea;"
                + "border:1px solid #3a3f4b;border-radius:5px;padding:6px 9px;font-size:13px'>"
                + "<button id='saybtn' onclick='sendSay()'>Send</button></div>"
                + "<div id='saystate' style='font-size:11px;opacity:.75;margin-top:4px'></div>"
                + "</fieldset>"

                + "<fieldset><legend>Lens</legend>"
                + "<div class='row' id='lensrow'></div>"
                + "<div class='row'><span id='lenshint' style='font-size:11px;opacity:.7'></span></div>"
                + "</fieldset>"

                + "<fieldset><legend>Exposure</legend>"
                + "<div class='row'><label>Mode</label>"
                + "<select id='expmode' onchange=\"setMode(this.value)\">"
                + "<option value='AUTO'>Auto</option>"
                + "<option value='MANUAL'>Manual</option>"
                + "</select>"
                + "<span id='livexp' style='font-size:12px;opacity:.8'></span></div>"
                + "<div id='manualrow' style='display:none'>"
                + "<div class='row'><label>Shutter</label>"
                + "<input type='range' id='exp' min='0' max='" + Settings.EXPOSURE_SLIDER_STEPS
                + "' value='0' oninput='expPreview(this.value)' "
                + "onchange='expCommit(this.value)'>"
                + "<span id='expv'>-</span></div>"
                + "<div class='row'><label>ISO</label>"
                + "<input type='range' id='miso' min='50' max='3200' value='" + s.manualIso + "' "
                + "oninput=\"lbl('misov',this.value)\" onchange=\"ctl('manualiso',this.value)\">"
                + "<span id='misov'>" + s.manualIso + "</span></div>"
                + "</div></fieldset>"

                + "<fieldset id='nightset'><legend>Night mode</legend>"
                + "<div class='row'><label>Mode</label>"
                + "<select id='nmode' onchange=\"ctl('night',this.value)\">"
                + opt("AUTO", s.nightMode) + opt("ON", s.nightMode) + opt("OFF", s.nightMode)
                + "</select></div>"
                + "<div class='row'><label>Night fps</label>"
                + "<input type='range' id='nf' min='1' max='15' value='" + s.nightFps + "' "
                + "oninput=\"lbl('nfv',this.value)\" onchange=\"ctl('nightfps',this.value)\">"
                + "<span id='nfv'>" + s.nightFps + "</span></div>"
                + "<div class='row'><label>Night ISO</label>"
                + "<input type='range' id='niso' min='50' max='3200' value='" + s.nightIso + "' "
                + "oninput=\"lbl('nisov',this.value)\" onchange=\"ctl('nightiso',this.value)\">"
                + "<span id='nisov'>" + s.nightIso + "</span></div>"
                + "<div class='row'><span id='nfhint' style='font-size:11px;opacity:.7'></span></div>"
                + "</fieldset>"

                + "<fieldset><legend>Stream</legend>"
                + "<div class='row'><label>Zoom</label>"
                + "<input type='range' id='zoom' min='0' max='100' value='0' "
                + "onchange=\"ctl('zoom',this.value/100)\"></div>"
                + "<div class='row'><label>FPS</label>"
                + "<input type='range' id='fps' min='1' max='30' value='" + s.targetFps + "' "
                + "oninput=\"lbl('fpsv',this.value)\" onchange=\"ctl('fps',this.value)\">"
                + "<span id='fpsv'>" + s.targetFps + "</span></div>"
                + "<div class='row'><label>Quality</label>"
                + "<input type='range' id='q' min='10' max='95' value='" + s.jpegQuality + "' "
                + "oninput=\"lbl('qv',this.value)\" onchange=\"ctl('quality',this.value)\">"
                + "<span id='qv'>" + s.jpegQuality + "</span></div>"
                + "</fieldset>"

                + "<div class='row'>"
                + "<button onclick=\"ctl('torch','toggle')\">Torch</button>"
                + "<button onclick=\"ctl('camera','toggle')\">Flip camera</button>"
                + "<button onclick=\"window.open('/shot.jpg','_blank')\">Snapshot</button>"
                + "<button id='nsbtn' onclick='nightShot()'>Night snapshot</button>"
                + "<button onclick=\"document.getElementById('v').src='/stream?'+Date.now()\">"
                + "Reload</button>"
                + "</div>"
                + "<div id='shotmsg'></div>"
                + "<div id='status'>loading status...</div>"
                + "</main><script>"
                + "var LIM={expMin:0,expMax:0},limitsReady=false,touching=false;"
                + "function lbl(i,v){document.getElementById(i).textContent=v}"
                + "function ctl(k,v){fetch('/control?'+k+'='+encodeURIComponent(v))"
                + ".then(r=>r.json()).then(show).catch(()=>{})}"
                // exposure is geometric: equal slider travel = equal stops
                + "function pos2ns(p){if(!(LIM.expMin>0&&LIM.expMax>LIM.expMin))return 0;"
                + "return Math.round(LIM.expMin*Math.pow(LIM.expMax/LIM.expMin,"
                + "p/" + Settings.EXPOSURE_SLIDER_STEPS + "));}"
                + "function ns2pos(ns){if(!(LIM.expMin>0&&LIM.expMax>LIM.expMin))return 0;"
                + "var c=Math.min(LIM.expMax,Math.max(LIM.expMin,ns));"
                + "return Math.round(Math.log(c/LIM.expMin)/Math.log(LIM.expMax/LIM.expMin)*"
                + Settings.EXPOSURE_SLIDER_STEPS + ");}"
                + "function fmt(ns){if(!ns||ns<=0)return '-';"
                + "return ns<1e9?('1/'+Math.round(1e9/ns)+'s'):((ns/1e9).toFixed(1)+'s');}"
                + "function expPreview(p){touching=true;lbl('expv',fmt(pos2ns(p)));}"
                + "function expCommit(p){touching=false;ctl('exposure',pos2ns(p));}"
                + "function setMode(m){ctl('exposuremode',m.toLowerCase());}"
                + "function nightShot(){"
                + "var b=document.getElementById('nsbtn'),m=document.getElementById('shotmsg');"
                + "b.disabled=true;m.textContent='Taking night snapshot - the stream pauses "
                + "for a few seconds...';"
                + "window.open('/shot.jpg?night=1','_blank');"
                + "setTimeout(function(){b.disabled=false;m.textContent='';"
                + "document.getElementById('v').src='/stream?'+Date.now();},6000);}"
                + "var listening=false,lCtx=null,lAbort=null,lNext=0,"
                + "talkCtx=null,talkStream=null,talkNode=null,"
                + "talkBuf=[],talkRate=16000,talkTimer=null;"
                // An <audio> tag buffers for its own smoothness and the lag only
                // grows, so the viewer reads raw PCM and schedules it itself.
                // Each chunk is queued at lNext, a running cursor just ahead of
                // the context clock: enough lead to avoid gaps, little enough
                // to stay close to live. Falling behind is corrected by
                // skipping rather than by playing stale audio faster.
                + "function toggleListen(){"
                + "var b=document.getElementById('listenbtn');"
                + "if(listening){listening=false;if(lAbort)lAbort.abort();"
                + "if(lCtx)lCtx.close();lCtx=null;b.textContent='Listen';return;}"
                + "var rate=talkRate||16000;"
                + "lCtx=new (window.AudioContext||window.webkitAudioContext)();"
                + "lAbort=new AbortController();listening=true;lNext=0;"
                + "b.textContent='Stop listening';"
                + "fetch('/audio.pcm?'+Date.now(),{signal:lAbort.signal}).then(function(r){"
                + "if(!r.ok)throw new Error('HTTP '+r.status+' (is the mic on in the app?)');"
                + "var rd=r.body.getReader(),left=null;"
                + "function pump(){return rd.read().then(function(x){"
                + "if(x.done||!listening)return;"
                + "var bytes=x.value;"
                // a chunk can split a 16-bit sample, so carry the odd byte over
                + "if(left){var m=new Uint8Array(left.length+bytes.length);m.set(left);"
                + "m.set(bytes,left.length);bytes=m;left=null;}"
                + "var n=bytes.length>>1;"
                + "if(bytes.length&1)left=bytes.slice(bytes.length-1);"
                + "if(n===0)return pump();"
                + "var now=lCtx.currentTime;"
                + "if(lNext<now)lNext=now+0.05;"
                + "if(lNext-now>0.25)return pump();"
                + "var dv=new DataView(bytes.buffer,bytes.byteOffset,n*2);"
                + "var buf=lCtx.createBuffer(1,n,rate),ch=buf.getChannelData(0);"
                + "for(var i=0;i<n;i++)ch[i]=dv.getInt16(i*2,true)/32768;"
                + "var s=lCtx.createBufferSource();s.buffer=buf;s.connect(lCtx.destination);"
                + "s.start(lNext);lNext+=buf.duration;"
                + "return pump();});}"
                + "return pump();"
                + "}).catch(function(e){if(listening){alert('Audio failed: '+e.message);"
                + "toggleListen();}});}"
                // --- talkback -------------------------------------------------
                // getUserMedia is gated behind a secure context. Plain HTTP on a
                // LAN address is not one, so this is blocked by the browser no
                // matter what the page does. Say so plainly instead of failing
                // with a cryptic undefined error.
                + "function talkAvailable(){return window.isSecureContext&&"
                + "navigator.mediaDevices&&navigator.mediaDevices.getUserMedia;}"
                + "function showTalkWarning(j){var w=document.getElementById('talkwarn'),"
                + "b=document.getElementById('talkbtn');"
                + "if(!j.talkbackEnabled){b.disabled=true;w.style.display='block';"
                + "w.textContent='Talkback is switched off in the app.';return;}"
                + "if(!talkAvailable()){b.disabled=true;w.style.display='block';"
                + "w.innerHTML='Your browser will not give a page microphone access over "
                + "plain http. Two ways round it:<br>1. Open this page as "
                + "<b>http://localhost:'+location.port+'</b> after running "
                + "<b>adb forward tcp:'+location.port+' tcp:'+location.port+'</b> "
                + "(localhost counts as secure).<br>2. In Chrome, add "
                + "<b>'+location.origin+'</b> to "
                + "<b>chrome://flags/#unsafely-treat-insecure-origin-as-secure</b>.<br>"
                + "Either way, <b>curl --data-binary @- '+location.origin+"
                + "'/talk?rate=16000</b> works right now from a terminal.';return;}"
                + "b.disabled=false;w.style.display='none';}"
                + "function floatToPcm16(f32){var out=new DataView(new ArrayBuffer(f32.length*2));"
                + "for(var i=0;i<f32.length;i++){var v=Math.max(-1,Math.min(1,f32[i]));"
                + "out.setInt16(i*2,v<0?v*0x8000:v*0x7FFF,true);}return out.buffer;}"
                // The browser records at its own rate (usually 48k); drop it to
                // the phone's rate with simple linear interpolation. Voice does
                // not need a windowed resampler.
                + "function resample(f32,from,to){if(from===to)return f32;"
                + "var ratio=from/to,n=Math.round(f32.length/ratio),out=new Float32Array(n);"
                + "for(var i=0;i<n;i++){var p=i*ratio,i0=Math.floor(p),i1=Math.min(i0+1,f32.length-1);"
                + "out[i]=f32[i0]+(f32[i1]-f32[i0])*(p-i0);}return out;}"
                + "function flushTalk(){if(!talkBuf.length)return;"
                + "var total=0;talkBuf.forEach(function(b){total+=b.byteLength;});"
                + "var merged=new Uint8Array(total),off=0;"
                + "talkBuf.forEach(function(b){merged.set(new Uint8Array(b),off);off+=b.byteLength;});"
                + "talkBuf=[];"
                + "fetch('/talk?rate='+talkRate,{method:'POST',body:merged,"
                + "headers:{'Content-Type':'application/octet-stream'}}).catch(function(){});}"
                + "function startTalk(){if(!talkAvailable())return;"
                + "navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,"
                + "noiseSuppression:true}}).then(function(stream){"
                + "talkStream=stream;talkCtx=new (window.AudioContext||window.webkitAudioContext)();"
                + "var src=talkCtx.createMediaStreamSource(stream);"
                + "talkNode=talkCtx.createScriptProcessor(4096,1,1);"
                + "talkNode.onaudioprocess=function(e){"
                + "var d=e.inputBuffer.getChannelData(0);"
                + "talkBuf.push(floatToPcm16(resample(d,talkCtx.sampleRate,talkRate)));};"
                + "src.connect(talkNode);talkNode.connect(talkCtx.destination);"
                // ~250ms per POST: short enough to feel live, long enough that
                // the request overhead stays irrelevant.
                + "talkTimer=setInterval(flushTalk,250);"
                + "document.getElementById('talkbtn').textContent='Talking...';"
                + "}).catch(function(e){alert('Microphone refused: '+e.message);});}"
                + "function stopTalk(){if(talkTimer){clearInterval(talkTimer);talkTimer=null;}"
                + "flushTalk();"
                + "if(talkNode){talkNode.disconnect();talkNode=null;}"
                + "if(talkCtx){talkCtx.close();talkCtx=null;}"
                + "if(talkStream){talkStream.getTracks().forEach(function(t){t.stop();});talkStream=null;}"
                + "document.getElementById('talkbtn').textContent='Hold to talk';}"
                + "(function(){var b=document.getElementById('talkbtn');"
                + "b.addEventListener('mousedown',startTalk);"
                + "b.addEventListener('touchstart',function(e){e.preventDefault();startTalk();});"
                + "['mouseup','mouseleave','touchend','touchcancel'].forEach(function(ev){"
                + "b.addEventListener(ev,stopTalk);});})();"
                // The phone only stores the text. A helper on the PC collects it,
                // synthesises there and posts the audio back, so no synthesis
                // ever runs on the phone's battery.
                + "function sendSay(){var i=document.getElementById('saytext');"
                + "var t=i.value.trim();if(!t)return;"
                + "var b=document.getElementById('saybtn');b.disabled=true;"
                + "fetch('/say',{method:'POST',body:new Blob([t],{type:'text/plain'})})"
                + ".then(function(r){return r.text().then(function(m){"
                + "b.disabled=false;"
                + "if(r.ok){i.value='';setSayState(m,r.status===202&&/no PC helper/.test(m));}"
                + "else{setSayState(m,true);}});})"
                + ".catch(function(e){b.disabled=false;setSayState(e.message,true);});}"
                + "function setSayState(msg,warn){var e=document.getElementById('saystate');"
                + "e.textContent=msg;e.style.color=warn?'#ffb74d':'';}"
                + "document.addEventListener('keydown',function(e){"
                + "if(e.key==='Enter'&&e.target&&e.target.id==='saytext')sendSay();});"
                + "var lensSig='';"
                + "function pickLens(id){fetch('/control?lens='+encodeURIComponent(id))"
                + ".then(r=>r.json()).then(show).catch(()=>{});}"
                + "function pickZoom(f){fetch('/control?zoomfactor='+f)"
                + ".then(r=>r.json()).then(show).catch(()=>{});}"
                + "function renderLenses(j){"
                // rebuild only when the set or the selection actually changes
                + "var sig=JSON.stringify(j.lenses)+'|'+j.cameraId+'|'+j.zoomRatio;"
                + "if(sig===lensSig)return;lensSig=sig;"
                + "var row=document.getElementById('lensrow');row.innerHTML='';"
                + "var any=false;"
                + "j.lenses.forEach(function(L){"
                + "var b=document.createElement('button');"
                + "b.textContent=L.short+(L.front?' front':'');"
                + "b.title=L.label;"
                + "if(L.selected)b.style.borderColor='#6aa9ff';"
                + "b.onclick=function(){pickLens(L.id);};"
                + "row.appendChild(b);any=true;});"
                // where the device hides its aux glass, offer zoom factors instead
                + "if(j.zoomMin<0.95||j.zoomMax>1.5){"
                + "[0.5,2,3,5].forEach(function(f){"
                + "if(f<j.zoomMin-0.01||f>j.zoomMax+0.01)return;"
                + "var covered=false;j.lenses.forEach(function(L){"
                + "if(Math.abs(L.factor-f)/Math.max(0.1,f)<=0.25)covered=true;});"
                + "if(covered)return;"
                + "var b=document.createElement('button');"
                + "b.textContent=f+'x zoom';"
                + "if(Math.abs(j.zoomRatio-f)<0.05)b.style.borderColor='#6aa9ff';"
                + "b.onclick=function(){pickZoom(f);};"
                + "row.appendChild(b);any=true;});}"
                + "var h=document.getElementById('lenshint');"
                + "if(!any){h.textContent='This device exposes only one camera to apps.';}"
                + "else if(j.lensFallback){h.textContent='That lens would not start with the "
                + "current settings, so the default camera is in use. Try a lower resolution.';}"
                + "else{h.textContent='Zoom range on this camera: '+j.zoomMin+'x to '+j.zoomMax+'x.';}}"
                + "function show(j){"
                + "renderLenses(j);"
                + "talkRate=j.audioSampleRate||16000;"
                // level meter: green, amber near the ceiling, red when clipping
                + "var pk=j.audioPeak||0,m=document.getElementById('meter');"
                + "m.style.width=Math.round(Math.min(1,pk)*100)+'%';"
                + "m.style.background=pk>0.98?'#f44336':(pk>0.85?'#ff9800':'#4caf50');"
                + "document.getElementById('meterv').textContent="
                + "j.micRunning?(Math.round(pk*100)+'%'+(j.audioClipped>0?"
                + "(' clipped '+j.audioClipped):'')):'';"
                + "var gs=document.getElementById('gain');"
                + "if(document.activeElement!==gs){gs.value=Math.round((j.audioGain||4)*10);"
                + "lbl('gainv',(j.audioGain||4).toFixed(1)+'x');}"
                // thermal banner
                + "var th=document.getElementById('thermal');"
                + "if(j.thermalNote&&j.thermalNote.length){th.style.display='block';"
                + "th.textContent=j.thermalNote;}"
                + "else if(j.tempC>=j.thermalThrottleAt-2){th.style.display='block';"
                + "th.textContent='Battery '+j.tempC.toFixed(1)+' C - close to the '+"
                + "j.thermalThrottleAt+' C throttle point.';}"
                + "else{th.style.display='none';}"
                + "showTalkWarning(j);"
                + "document.getElementById('audiostate').textContent="
                + "(j.micRunning?('mic live at '+j.audioSampleRate+'Hz via '+j.audioSource+"
                + "', '+j.audioListeners+' listening'+(j.echoCancel?', echo cancel on':'')):"
                + "(j.audioError?('audio error: '+j.audioError):'mic off'))+"
                + "(j.talkbackPlaying?'  |  TALKBACK PLAYING':'');"
                + "document.getElementById('listenbtn').disabled=!j.micRunning;"
                + "var sb=document.getElementById('saybtn'),si=document.getElementById('saytext');"
                + "var canSay=j.talkbackEnabled&&j.micRunning;"
                + "sb.disabled=!canSay;si.disabled=!canSay;"
                + "if(!j.talkbackEnabled){setSayState('Turn on talkback in the app to use this.',true);}"
                + "else if(!j.sayHelperOnline){setSayState('No PC helper is polling - run "
                + "say-helper.ps1 on your computer, or typed text will just sit in the queue'+"
                + "(j.sayQueued?(' ('+j.sayQueued+' waiting)'):'')+'.',true);}"
                + "else{setSayState('PC helper connected'+(j.sayQueued?(', '+j.sayQueued+"
                + "' queued'):', idle')+'.',false);}"
                // drive every slider from the sensor's real limits, once
                + "if(!limitsReady&&j.exposureMinNs>0&&j.exposureMaxNs>j.exposureMinNs){"
                + "LIM.expMin=j.exposureMinNs;LIM.expMax=j.exposureMaxNs;limitsReady=true;"
                + "document.getElementById('exp').value=ns2pos(j.manualExposureNs);"
                + "lbl('expv',fmt(j.manualExposureNs));}"
                + "if(j.isoMin>0&&j.isoMax>j.isoMin){"
                + "['miso','niso'].forEach(function(id){var e=document.getElementById(id);"
                + "e.min=j.isoMin;e.max=j.isoMax;});}"
                + "var nf=document.getElementById('nf');"
                + "if(j.minNightFps>0&&nf.min!=j.minNightFps){nf.min=j.minNightFps;"
                + "document.getElementById('nfhint').textContent=j.minNightFps>1?"
                + "('This sensor maxes out at '+fmt(j.exposureMaxNs)+', so below '+"
                + "j.minNightFps+' fps gains no extra light.'):'';}"
                // manual controls only when manual is selected
                + "document.getElementById('expmode').value=j.exposureMode;"
                + "document.getElementById('manualrow').style.display="
                + "(j.exposureMode=='MANUAL')?'block':'none';"
                + "document.getElementById('nightset').className="
                + "(j.exposureMode=='MANUAL')?'dim':'';"
                + "if(!touching&&j.exposureMode=='MANUAL'){"
                + "document.getElementById('exp').value=ns2pos(j.manualExposureNs);"
                + "lbl('expv',fmt(j.manualExposureNs));"
                + "document.getElementById('miso').value=j.manualIso;lbl('misov',j.manualIso);}"
                + "var mw=document.getElementById('manualwarn');"
                + "if(j.manualUnsupported){mw.style.display='block';"
                + "mw.textContent='This camera has no manual sensor control, so Manual falls "
                + "back to auto exposure.';}else{mw.style.display='none';}"
                + "document.getElementById('livexp').textContent="
                + "'now: '+j.exposureLabel+' at ISO '+j.iso;"
                + "var hot=document.getElementById('hot');"
                + "if(j.batteryTempC>40){hot.style.display='block';"
                + "hot.textContent='Battery is '+j.batteryTempC.toFixed(1)+"
                + "' C - hot. Consider stopping the stream or improving airflow.';}"
                + "else{hot.style.display='none';}"
                + "document.getElementById('status').textContent="
                + "'exposure '+j.exposureLabel+' at ISO '+j.iso+"
                + "' ('+(j.exposureMode=='MANUAL'?'manual':'auto')+')\\n'+"
                + "'resolution '+j.resolution+'  |  fps '+j.effectiveFps+' of '+j.targetFps+"
                + "'  |  viewers '+j.viewers+'\\n'+"
                + "'lens '+(function(){var n='default';j.lenses.forEach(function(L){"
                + "if(L.selected)n=L.label;});return n;})()+' at '+j.zoomRatio+'x\\n'+"
                + "'night '+j.nightMode+(j.nightActive?' (ACTIVE)':'')+"
                + "(j.manualSensor?' [manual sensor]':' [auto exposure only]')+"
                + "'  |  brightness '+j.luma+'\\n'+"
                + "'battery '+j.batteryPct+'%'+(j.charging?' charging':'')+"
                + "' at '+j.batteryTempC.toFixed(1)+' C'+"
                + "(j.currentMa?('  |  '+j.currentMa+'mA now'+"
                + "(j.averageMa?(', '+j.averageMa+'mA avg'):'')):'')+"
                + "(j.thermalThrottled?'  |  THROTTLED':'')+"
                + "(j.encoding?'':'  |  IDLE (not encoding, nobody watching)')+'\\n'+"
                + "'sensor limits: exposure '+j.exposureMinLabel+' to '+j.exposureMaxLabel+"
                + "', ISO '+j.isoMin+' to '+j.isoMax;}"
                // Polling a tab nobody is looking at wakes both machines for
                // nothing. The stream itself keeps running; only the status
                // chatter stops.
                + "function poll(){if(document.hidden)return;"
                + "fetch('/status').then(r=>r.json()).then(show).catch(()=>{})}"
                + "poll();setInterval(poll,2000);"
                + "document.addEventListener('visibilitychange',function(){"
                + "if(!document.hidden)poll();});"
                
                + "</script></body></html>";
    }

    private static String opt(String value, Settings.NightMode current) {
        boolean sel = current.name().equals(value);
        return "<option value='" + value + "'" + (sel ? " selected" : "") + ">"
                + value.charAt(0) + value.substring(1).toLowerCase() + "</option>";
    }
}
