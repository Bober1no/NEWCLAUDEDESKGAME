package com.example.ipcam;

import android.util.Log;

import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Address helpers for keeping the server on the local network.
 *
 * WHY THIS EXISTS
 * ---------------
 * Binding a ServerSocket with no address binds the wildcard, which on a dual
 * stack device means every interface INCLUDING the globally routable IPv6
 * address the ISP hands out (e.g. 2001:8004:...). Many home routers pass
 * inbound IPv6 straight through, so a wildcard bind can put the camera on the
 * public internet with nothing in front of it but Basic auth over cleartext.
 *
 * Two layers are used against that:
 *   1. Bind to the device's LAN IPv4 address specifically, so nothing is
 *      listening on the public IPv6 address at all.
 *   2. Reject any accepted connection whose source is not a private address.
 *
 * Neither replaces blocking inbound IPv6 at the router. A firewall stops the
 * packet before it reaches the phone; this only stops it after.
 */
public final class NetworkUtils {

    private static final String TAG = "NetworkUtils";

    private NetworkUtils() { }

    /**
     * True if the address is one that can only come from a local network.
     *
     * Note that InetAddress.isSiteLocalAddress() is NOT sufficient on its own:
     * for IPv6 it only matches the deprecated fec0::/10 range, not fd00::/8
     * (Unique Local Addresses), which is what private IPv6 actually uses.
     */
    public static boolean isPrivate(InetAddress a) {
        if (a == null) return false;
        if (a.isLoopbackAddress()) return true;      // 127.0.0.0/8, ::1
        if (a.isLinkLocalAddress()) return true;     // 169.254.0.0/16, fe80::/10
        if (a.isSiteLocalAddress()) return true;     // RFC1918 v4, fec0::/10 v6

        byte[] b = a.getAddress();
        if (b.length == 16) {
            // fc00::/7 — Unique Local Addresses, the real private IPv6 range.
            if ((b[0] & 0xFE) == 0xFC) return true;
        }
        return false;
    }

    /**
     * True if the address shares a /64 with one of this device's own global
     * IPv6 addresses — i.e. it is on the same LAN segment, even though both
     * ends have globally routable addresses.
     *
     * This is what makes IPv6 usable on a home network without also opening
     * the door to the whole internet. It is not airtight: anything inside your
     * ISP-delegated prefix passes. Treat it as a convenience, not a firewall.
     */
    public static boolean isSameIpv6Prefix(InetAddress a) {
        if (!(a instanceof Inet6Address)) return false;
        byte[] remote = a.getAddress();
        for (InetAddress local : localAddresses()) {
            if (!(local instanceof Inet6Address)) continue;
            if (local.isLoopbackAddress() || local.isLinkLocalAddress()) continue;
            byte[] mine = local.getAddress();
            boolean match = true;
            for (int i = 0; i < 8; i++) {       // compare the /64 prefix
                if (mine[i] != remote[i]) { match = false; break; }
            }
            if (match) return true;
        }
        return false;
    }

    /** The check applied to every accepted connection when LAN-only is on. */
    public static boolean isLocalClient(InetAddress a) {
        return isPrivate(a) || isSameIpv6Prefix(a);
    }

    /**
     * The device's LAN IPv4 address, preferring Wi-Fi. Returns null if there
     * isn't one, which means we are not on a local network and should refuse
     * to start rather than quietly binding the wildcard.
     */
    public static Inet4Address getLanIpv4() {
        Inet4Address fallback = null;
        try {
            List<NetworkInterface> nics =
                    Collections.list(NetworkInterface.getNetworkInterfaces());
            for (NetworkInterface nic : nics) {
                if (!nic.isUp() || nic.isLoopback()) continue;
                String name = nic.getName() == null ? "" : nic.getName().toLowerCase();
                for (InetAddress addr : Collections.list(nic.getInetAddresses())) {
                    if (!(addr instanceof Inet4Address)) continue;
                    if (addr.isLoopbackAddress() || addr.isLinkLocalAddress()) continue;
                    if (!addr.isSiteLocalAddress()) continue;
                    if (name.startsWith("wlan")) return (Inet4Address) addr;
                    if (fallback == null) fallback = (Inet4Address) addr;
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "could not enumerate interfaces", e);
        }
        return fallback;   // ethernet / USB tether / null
    }

    /** Every address on every live interface, for display and prefix matching. */
    public static List<InetAddress> localAddresses() {
        List<InetAddress> out = new ArrayList<>();
        try {
            for (NetworkInterface nic :
                    Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!nic.isUp() || nic.isLoopback()) continue;
                out.addAll(Collections.list(nic.getInetAddresses()));
            }
        } catch (Exception e) {
            Log.w(TAG, "could not enumerate interfaces", e);
        }
        return out;
    }

    /**
     * Globally routable addresses this device currently has. Shown in the UI so
     * it is obvious when the phone has a public IPv6 address that a wildcard
     * bind would expose.
     */
    public static List<String> publicAddresses() {
        List<String> out = new ArrayList<>();
        for (InetAddress a : localAddresses()) {
            if (isPrivate(a)) continue;
            out.add(a.getHostAddress());
        }
        return out;
    }
}
