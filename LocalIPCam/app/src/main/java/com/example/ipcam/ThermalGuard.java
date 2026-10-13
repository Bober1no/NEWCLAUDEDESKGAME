package com.example.ipcam;

/**
 * Decides when to shed load and when to give it back, from a stream of
 * temperature readings.
 *
 * Kept free of any Android dependency on purpose: this is the logic that
 * decides whether a 24/7 camera cooks its own battery, and it is worth being
 * able to test it directly rather than inferring it from behaviour on a warm
 * phone.
 *
 * Three bands, with the recovery point deliberately well below the throttle
 * point. A single threshold would sit the device right on the boundary and
 * flap between resolutions every few seconds, which is worse than either
 * state. Readings must also repeat before anything happens, so one spurious
 * sample cannot drop the stream.
 */
public final class ThermalGuard {

    public enum Action {
        /** Carry on. */
        NONE,
        /** Drop to the reduced resolution and frame rate. */
        THROTTLE,
        /** Cool enough: restore the configured settings. */
        RECOVER,
        /** Too hot to keep going at all. */
        SHUTDOWN
    }

    private final float throttleAt;
    private final float shutdownAt;
    private final float recoverAt;
    private final int confirmations;
    private final int recoverConfirmations;

    private int hot = 0;
    private int critical = 0;
    private int cool = 0;
    private boolean throttled = false;

    public ThermalGuard() {
        this(Settings.THERMAL_THROTTLE_C, Settings.THERMAL_SHUTDOWN_C,
                Settings.THERMAL_RECOVER_C, 2, 3);
    }

    public ThermalGuard(float throttleAt, float shutdownAt, float recoverAt,
                        int confirmations, int recoverConfirmations) {
        this.throttleAt = throttleAt;
        this.shutdownAt = shutdownAt;
        this.recoverAt = recoverAt;
        this.confirmations = confirmations;
        this.recoverConfirmations = recoverConfirmations;
    }

    public boolean isThrottled() { return throttled; }

    public void reset() {
        hot = 0;
        critical = 0;
        cool = 0;
        throttled = false;
    }

    /**
     * Feed one reading and get back what should happen.
     *
     * A temperature of zero or below means the device did not report one;
     * that is treated as no information rather than as "cold", because
     * guessing cold is the dangerous direction to be wrong in.
     */
    public Action step(float tempC) {
        if (tempC <= 0f) return Action.NONE;

        if (tempC >= shutdownAt) {
            critical++;
            hot++;
            cool = 0;
        } else if (tempC >= throttleAt) {
            critical = 0;
            hot++;
            cool = 0;
        } else if (tempC <= recoverAt) {
            critical = 0;
            hot = 0;
            cool++;
        } else {
            // Between the recovery and throttle points: no opinion either way,
            // so hold whatever state we are already in and reset the counters.
            critical = 0;
            hot = 0;
            cool = 0;
        }

        if (critical >= confirmations) {
            critical = 0;
            return Action.SHUTDOWN;
        }
        if (!throttled && hot >= confirmations) {
            throttled = true;
            hot = 0;
            return Action.THROTTLE;
        }
        if (throttled && cool >= recoverConfirmations) {
            throttled = false;
            cool = 0;
            return Action.RECOVER;
        }
        return Action.NONE;
    }
}
