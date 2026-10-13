package com.example.ipcam;

import androidx.annotation.Nullable;

import java.util.ArrayDeque;
import java.util.Deque;

/**
 * A mailbox of text waiting to be spoken.
 *
 * WHY THE PHONE DOES NOT SYNTHESISE
 * ---------------------------------
 * Text-to-speech on the phone would be the obvious implementation, and it is
 * deliberately not what happens. The phone holds the string and nothing else;
 * a helper on the PC polls for it, synthesises there, and posts the resulting
 * audio back to /talk like any other talkback. The phone's only cost is a few
 * bytes of memory and playing the audio it is sent.
 *
 * The browser cannot do the synthesis itself: speechSynthesis plays out of the
 * machine's own speakers and its output cannot be captured into a buffer, so
 * there is no path from a web page to "synthesised audio I can forward". A
 * small polling helper is the way round that, and polling (rather than the
 * page calling a local server) avoids cross-origin rules, firewall prompts and
 * listener permissions entirely.
 *
 * Everything here is synchronised: text arrives on HTTP threads and leaves on
 * a different one.
 */
public class SayQueue {

    /** Enough for a burst of typing, small enough that a dead helper cannot grow it. */
    private static final int MAX_ITEMS = 32;
    /** One utterance, not an essay. */
    public static final int MAX_TEXT_LENGTH = 1000;
    /** A helper polling within this window counts as online. */
    private static final long HELPER_ALIVE_MS = 10_000L;

    private final Deque<String> pending = new ArrayDeque<>();
    private long lastPolledAt = 0L;
    private long lastSpokeAt = 0L;
    private int totalQueued = 0;

    /**
     * Queue some text. Returns false if the queue is full, which in practice
     * means no helper is collecting and the backlog should not keep growing.
     */
    public synchronized boolean offer(String text) {
        if (text == null) return false;
        String trimmed = text.trim();
        if (trimmed.isEmpty()) return false;
        if (trimmed.length() > MAX_TEXT_LENGTH) {
            trimmed = trimmed.substring(0, MAX_TEXT_LENGTH);
        }
        if (pending.size() >= MAX_ITEMS) return false;
        pending.addLast(trimmed);
        totalQueued++;
        return true;
    }

    /**
     * Take the next item, oldest first, or null when there is nothing.
     *
     * Calling this is what marks a helper as alive, including when the queue
     * is empty — an idle helper is still a working helper, and the UI needs to
     * tell "nobody is listening" apart from "nothing to say".
     */
    @Nullable
    public synchronized String poll() {
        lastPolledAt = System.currentTimeMillis();
        String next = pending.pollFirst();
        if (next != null) lastSpokeAt = lastPolledAt;
        return next;
    }

    public synchronized int size() { return pending.size(); }

    public synchronized int getTotalQueued() { return totalQueued; }

    public synchronized void clear() { pending.clear(); }

    /** True if a helper has polled recently enough to be considered running. */
    public synchronized boolean helperOnline() {
        return lastPolledAt > 0
                && System.currentTimeMillis() - lastPolledAt < HELPER_ALIVE_MS;
    }

    /** Milliseconds since a helper last polled, or -1 if one never has. */
    public synchronized long sinceLastPollMs() {
        if (lastPolledAt == 0) return -1L;
        return System.currentTimeMillis() - lastPolledAt;
    }

    public synchronized long getLastSpokeAt() { return lastSpokeAt; }
}
