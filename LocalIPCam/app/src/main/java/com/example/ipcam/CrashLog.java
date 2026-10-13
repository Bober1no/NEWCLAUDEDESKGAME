package com.example.ipcam;

import android.content.Context;

import java.io.File;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;

/**
 * Records the stack trace of any crash to the app's private storage, so the
 * next launch can show what went wrong without needing adb.
 *
 * The file lives in getFilesDir(), which only this app can read. Nothing is
 * sent anywhere.
 */
public final class CrashLog {

    private static final String FILE = "last_crash.txt";
    private static volatile boolean installed = false;

    private CrashLog() { }

    /** Safe to call more than once; only the first call installs the handler. */
    public static synchronized void install(Context ctx) {
        if (installed) return;
        installed = true;
        final Context app = ctx.getApplicationContext();
        final Thread.UncaughtExceptionHandler previous =
                Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            try {
                StringWriter sw = new StringWriter();
                PrintWriter pw = new PrintWriter(sw);
                pw.println("Thread: " + thread.getName());
                pw.println("Time: " + new java.util.Date());
                pw.println();
                error.printStackTrace(pw);
                pw.flush();
                try (FileOutputStream out = new FileOutputStream(new File(app.getFilesDir(), FILE))) {
                    out.write(sw.toString().getBytes(StandardCharsets.UTF_8));
                }
            } catch (Throwable ignored) {
                // Never let the crash logger itself hide the original crash.
            }
            if (previous != null) previous.uncaughtException(thread, error);
        });
    }

    /** The last recorded crash, or null if there isn't one. */
    public static String read(Context ctx) {
        File f = new File(ctx.getFilesDir(), FILE);
        if (!f.exists()) return null;
        // java.nio.file needs API 26; minSdk is 24, so read it the old way.
        try (java.io.FileInputStream in = new java.io.FileInputStream(f)) {
            java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int n;
            while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
            return new String(buf.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }

    public static void clear(Context ctx) {
        //noinspection ResultOfMethodCallIgnored
        new File(ctx.getFilesDir(), FILE).delete();
    }
}
