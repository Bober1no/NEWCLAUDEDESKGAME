# Local IP Cam

An open IP-Webcam-style Android app. It streams **this device's** camera over your
**local network** as MJPEG, viewable in any browser on the same Wi-Fi/LAN.

Nothing about this app is hidden: a persistent notification is shown the entire
time the camera is running, the stream address is displayed on screen, and the
source is all here to read.

---

## ⚠ Before you use it

- The stream is **plain HTTP — not encrypted**. Anyone who can see your network
  traffic can see the video, and the password too.
- Basic auth is **on by default**, but the default password is `changeme`.
  Change it in the app before you start.
- Only point this at spaces **you own or have permission to record**. Recording
  people without consent is illegal in a lot of places, Australia included, and
  the rules differ by state.
- **Do not port-forward this to the internet.** It is built for a LAN you trust.
- Android requires a visible ongoing notification for any camera foreground
  service. Don't try to remove it; it is there so the person holding the phone
  always knows the camera is live.

---

## The IPv6 exposure problem

This is the one that actually bites people, and it's why IP Webcam has had the
same complaint for years.

Binding a socket without naming an address binds the **wildcard**. On a dual
stack phone that means every interface, including the globally routable IPv6
address your ISP hands out (`2001:8004:...` on Telstra, similar elsewhere).
Unlike IPv4, there's no NAT in front of it — plenty of consumer routers pass
inbound IPv6 straight through by default. A wildcard bind can therefore put
your camera on the public internet with nothing in front of it but HTTP Basic
auth sent in cleartext.

**LAN-only mode is on by default** and does two things:

1. **Binds only the device's LAN IPv4 address.** Nothing is listening on the
   public IPv6 address at all, so there is no socket to reach.
2. **Rejects any accepted connection from a non-local source** with a 403,
   before reading the request.

Turning it off shows you the phone's actual public addresses on screen, because
an abstract warning is easy to scroll past and a real `2001:...` address is not.

### A gotcha if you write this check yourself

The obvious one-liner doesn't do what it looks like:

```java
// INCOMPLETE — do not rely on this for IPv6
if (!(a.isSiteLocalAddress() || a.isLoopbackAddress() || a.isLinkLocalAddress())) reject();
```

`isSiteLocalAddress()` on IPv6 only matches `fec0::/10`, which was deprecated in
2004 and is effectively unused. It does **not** match `fd00::/8` — Unique Local
Addresses, which is what private IPv6 actually uses today. So that check quietly
rejects legitimate local IPv6 clients while leaving you believing IPv6 is
handled. `NetworkUtils.isPrivate()` adds the `fc00::/7` test explicitly, and
`isSameIpv6Prefix()` allows same-`/64` clients so IPv6 on your own LAN still
works if you ever switch off LAN-only.

### The cost: a pinned address can go stale

Binding one specific address trades "exposed on IPv6" for "bound to an address
the phone might lose". If the router hands out a new lease, the socket is left
on an address the device no longer has and quietly stops accepting.

So the app watches for it. A `ConnectivityManager` callback fires on
`onLinkPropertiesChanged` — which is what a DHCP renewal with a new lease
triggers — and a 15-second watchdog polls as a backstop in case the callback
doesn't arrive. Either way it compares the bound address against the current
one and moves the listener without touching the camera. The URL in the app and
in the notification updates itself.

**Viewers connected at the moment of the change get dropped** and have to
reload. Their TCP connections died with the old address; nothing can be done
about that.

**Set a DHCP reservation for the phone anyway.** It keeps the URL stable so you
aren't chasing it, and you need a fixed address to write the inbound-IPv6 block
rule against. The auto-rebind just means forgetting to set one is an
inconvenience rather than a camera that silently stopped working three days ago.

Implementation notes, since the ordering is deliberate:

- The new socket is bound *before* the old one is closed, so a failed rebind
  leaves you still serving on the previous address.
- If the two binds overlap (old socket on the wildcard, or the same address)
  that ordering throws `BindException` — `SO_REUSEADDR` permits rebinding a
  `TIME_WAIT` address, not two live listeners. It then falls back to closing
  the old socket first, waiting for the accept thread to unwind, and retrying
  with backoff. The kernel can hold the port for a moment while a thread is
  still blocked in `accept()`.
- Rebinding to the address you are already on is a no-op, so nothing churns.
- All of it runs off the main thread, because binding can block.

### This is not a substitute for your router

App-level filtering drops the connection *after* the packet has reached your
phone. A firewall stops it arriving. **Block inbound IPv6 at the router as
well.** Belt and braces.

---

## Features

| | |
|---|---|
| Live MJPEG stream | `/stream`, viewable in any browser |
| Still snapshot | `/shot.jpg` |
| JSON state | `/status` |
| Remote control | `/control?fps=10&zoom=0.4&...` |
| Frame rate | 1–30 fps, adjustable live |
| JPEG quality | 10–95, adjustable live |
| Resolution | 320x240 / 640x480 / 1280x720 / 1920x1080 |
| Exposure mode | Auto or Manual; Manual pins shutter + ISO and overrides night mode |
| Manual shutter | logarithmic slider across the sensor's real exposure range |
| Night mode | Auto / always-on / off, manual exposure + ISO when the sensor allows |
| Night ISO | 50–6400, clamped to the sensor's own range |
| Night snapshot | one long-exposure still, in-memory only |
| Live sensor readout | actual exposure time and ISO, per frame |
| Phone battery | percent, charging, temperature, with a hot warning |
| Thermal guard | throttles at 42C, stops at 43.5C, restores settings once cool |
| Mic gain | 1x to 20x with a level meter and clip counter |
| Listen | phone microphone, scheduled through Web Audio for low latency |
| Talk back | audio posted to the phone and played out of its speaker |
| Type to speak | text typed in the viewer, synthesised on your PC, played by the phone |
| Zoom | continuous, 0–100% |
| Torch | if the camera has a flash |
| Lens selection | every camera the device exposes: ultra-wide, main, telephoto, front |
| Zoom presets | 0.5x / 1x / 3x etc., via a real lens where one exists, zoom ratio otherwise |
| Auth | HTTP Basic, toggleable |
| LAN-only binding | on by default; binds LAN IPv4 only + rejects non-local clients |
| Survives DHCP changes | re-binds automatically when the phone's IP changes |
| Port | configurable |
| Background streaming | keeps running with the screen off (optional wake lock) |

### Endpoints

```
http://<device-ip>:<port>/            viewer page with controls
http://<device-ip>:<port>/stream      live MJPEG
http://<device-ip>:<port>/shot.jpg    one current frame from the stream
http://<device-ip>:<port>/shot.jpg?night=1   a fresh long-exposure still
http://<device-ip>:<port>/status      JSON state
http://<device-ip>:<port>/audio.pcm   live microphone, raw 16-bit PCM (low latency)
http://<device-ip>:<port>/audio.wav   same audio as WAV, for VLC and friends (laggy)
POST http://<device-ip>:<port>/talk   16-bit PCM or a WAV, out of the phone's speaker
POST http://<device-ip>:<port>/say    queue text for a PC helper to speak
GET  http://<device-ip>:<port>/say/next   a helper collecting the next utterance
http://<device-ip>:<port>/control?... change settings remotely
```

Control keys: `audio` (`on|off`), `talkback`, `audiorate`, `gain` (1-20),
`talkgain` (1-20), `loudspeaker`, `halfduplex`, `idlethrottle`,
`idlecapturefps` (1-15),
`rotation` (`auto|none|fixed_90|fixed_180|fixed_270`), `lens` (camera2 id), `zoomfactor` (e.g. `0.5`, `3`),
`exposuremode` (`auto|manual`), `exposure` (ns, `1/30`, `0.5s` or `20ms`),
`iso`, `manualiso`, `nightiso`, `fps`, `quality`, `resolution` (0–3), `night`
(`auto|on|off`), `nightfps`, `zoom` (0.0–1.0 linear), `torch`
(`on|off|toggle`), `camera` (`front|back|toggle`), `lanonly` (next start).

`iso` applies to whichever ISO is live: `manualIso` in MANUAL, `nightIso` in
AUTO. Use `manualiso` / `nightiso` when you want to be explicit. Example:

```
curl -u cam:yourpassword "http://192.168.1.42:8080/control?exposuremode=manual&exposure=1/30&iso=800"
curl -u cam:yourpassword "http://192.168.1.42:8080/control?exposuremode=auto"
```

---

## Type to speak

Type a sentence in the viewer and the phone says it — **with none of the
synthesis happening on the phone**.

### Why it is built this way

The obvious implementation is Android's text-to-speech on the phone. That is
deliberately not what happens, because the point is to keep the work off the
battery.

The next obvious idea is to synthesise in the browser with `speechSynthesis`
and send the audio. **That is not possible.** The Web Speech API plays out of
the machine's own speakers and gives no way to capture its output into a
buffer; routing it into a MediaStream was proposed years ago and never shipped
in any browser. There is no path from a web page to "synthesised audio I can
forward".

So the phone is a **mailbox**:

```
viewer text box  ──POST /say──>  phone holds the string
                                        │
PC helper  ──GET /say/next──────────────┘   (polls ~every 700ms)
    │
    ├─ synthesises with Windows' own speech engine
    └──POST /talk──>  phone plays the audio
```

The phone stores a few bytes and plays a short clip. Everything else is the
PC. Polling rather than the page calling a local server avoids cross-origin
rules, firewall prompts and HTTP listener permissions entirely.

### Running the helper

```
.\tools\say-helper.ps1 -Phone http://10.0.0.78:8080 -User cam -Pass yourpassword
```

Leave it running in a window. The viewer tells you whether a helper is
actually polling — otherwise typing into the box looks identical to it working
while the text piles up in a queue nobody is collecting.

```
.\tools\say-helper.ps1 -ListVoices                      # what's installed
.\tools\say-helper.ps1 -Voice "Microsoft Zira Desktop"  # pick one
.\tools\say-helper.ps1 -Speed -2 -Volume 80             # slower, quieter
.\tools\say-helper.ps1 -Once "dinner is ready"          # say one thing and exit
```

It asks the speech engine for 16kHz mono 16-bit directly, so nothing in the
chain resamples or strips headers. Match `-Rate` to the phone's sample rate or
the pitch comes out wrong.

Any other tool works too, since `/say` just takes text:

```
curl -u cam:pw --data "the back gate is open" http://10.0.0.78:8080/say
```

### /talk now takes WAV as well

Useful because most things that synthesise or record audio emit WAV. The
chunks are walked rather than assuming the canonical 44-byte layout — plenty
of encoders put a LIST or fact chunk between `fmt ` and `data`, and skipping a
fixed 44 bytes plays a burst of noise instead. Stereo is downmixed, and the
sample rate is taken from the file rather than the query string.

```
# anything that can produce a WAV can talk through the phone
ffmpeg -i doorbell.mp3 -ar 16000 -ac 1 -f wav - | \
  curl -u cam:pw --data-binary @- http://10.0.0.78:8080/talk
```

## Power

### Measuring it

`/status` reports `currentMa` and `averageMa` from
`BATTERY_PROPERTY_CURRENT_NOW` and `CURRENT_AVERAGE`, and the app shows them
in a Power section. **Measure before and after any change rather than trusting
an estimate** — including the ones below.

Three caveats, all real:

- The framework documents microamps and a few vendors report milliamps, so a
  reading can be out by 1000x. The code falls back if the division rounds to
  zero, but sanity-check the magnitude against something known.
- The sign convention is inconsistent between devices. The absolute value is
  reported and charging state separately.
- **On a charger this measures net flow into the battery, not what the phone
  is drawing.** Unplug before comparing anything.

### Idle throttling (on by default)

An always-on camera is unwatched almost all of the time, and encoding JPEGs
into a void is wasteful. With no viewers the encoder drops to **one frame per
second**.

**This saved almost nothing, and it is worth understanding why.** It stops the
app *encoding*. It does nothing to the camera: the sensor, the image signal
processor and the MIPI link between them carried on producing full-rate frames
that were then thrown away. On a small frame that pipeline costs considerably
more than the JPEG encode it was replacing, so switching off the cheap half of
the work measured as approximately zero. If you tested the old idle throttle
at 480p and concluded it did nothing, you were right.

### Idle capture rate (this is the one that works)

The fix is to slow the **sensor**, not the encoder. With nothing connected the
app pushes a `CONTROL_AE_TARGET_FPS_RANGE` into the running capture session
asking for `idleCaptureFps` frames a second, default **2**. That shuts down the
whole pipeline, not just the last step of it.

Three things about it:

- It is applied **live**, through the same Camera2 interop path that manual
  exposure uses, so going from idle to watched does not rebind the camera and
  therefore does not black the stream out at the exact moment somebody looks
  at it.
- It only requests frame-rate ranges the camera **advertises**. Asking for one
  the hardware never listed can stop the camera opening at all, which is a far
  worse outcome than a phone that keeps capturing fast. On a device that offers
  nothing slow, the app leaves the rate alone and says so — `captureIdle` in
  `/status` stays `false`, so the app never claims a saving it is not making.
- In **manual exposure** it works through `SENSOR_FRAME_DURATION` instead,
  because auto-exposure is switched off in that mode and the AE range means
  nothing. Your chosen shutter and ISO are not altered.

There is exactly one function composing the live capture options
(`applyLiveCaptureOptions`), and that is deliberate:
`setCaptureRequestOptions` **replaces** everything previously set through
that API rather than merging, so two features each pushing their own subset
would silently delete each other's keys — manual exposure would wipe the idle
frame rate, and the next idle transition would wipe AE-off and hand exposure
back to auto.

Brightness sampling continues on every frame regardless, so night mode still
reacts normally while idle.

### Rotation

Rotating NV21 is per-pixel work and at 1080p it costs **more than the JPEG
encode**. The default follows the device orientation and recomputes every
frame.

If the phone is bolted to a wall in one orientation forever, set a fixed angle
or **None** and the whole pass disappears. This is the single biggest CPU
saving available without changing codec.

### Per-frame allocation

The encoder used to allocate two full-size byte arrays every frame — roughly
**45 MB a second of garbage at 1080p15**. Both are now reused scratch buffers,
grown on demand and only touched from the analysis thread. Collection pressure
costs real CPU quite apart from the zeroing.

### Smaller things

- The viewer stops polling `/status` when its tab is hidden, and resumes on
  return. The stream itself is unaffected.
- Lower resolution scales CPU with pixel count: 720p is about 2.25x cheaper
  than 1080p for very little loss on a monitoring feed.

### Ranked, if battery is the goal

1. **Idle capture rate** (above). Attacks the thing that actually dominates.
2. **A fixed rotation** instead of auto. Removes a whole per-pixel pass.
3. **Lower resolution.** Scales almost everything with pixel count.
4. **Codec.** Last, which is the opposite of what it feels like it should be.

On the fourth: H.264 through `MediaCodec` was built and then removed from this
project, which is worth recording so it does not get re-litigated as a battery
idea. It delivered what it promised — roughly 6-8x less data on the wire, and
RTSP, which is the only thing real NVR software (Frigate, Home Assistant, Blue
Iris) will accept. What it did **not** deliver was battery life: the hardware
encoder is cheaper than software JPEG, but at 480p the JPEG encode was never
the expensive part, and the camera pipeline underneath is unaffected by which
codec runs after it.

So if the goal is ever **compatibility with NVR software**, H.264 and RTSP are
the answer and they are a few hundred lines each. If the goal is **battery**,
they are not, and items 1 to 3 are where the wins are.

## Thermal guard

A phone streaming around the clock never gets a chance to cool down, and
sustained heat — not peak heat — is what degrades a lithium battery. This is
the most common way an always-on phone camera dies.

Three bands, driven off the battery temperature that was already being read:

| Battery temp | What happens |
|---|---|
| below 40.0C | normal running, and the point throttling is released at |
| 42.0C and above | drop to 640x480 at 10 fps, torch off |
| 43.5C and above | stop streaming entirely and post an alert |

**Your settings are never rewritten.** The guard overrides `resolution()` and
`effectiveFps()` while hot and the stored values are untouched, so recovery is
just a matter of clearing a flag — and if you change the resolution while it
is throttled, your new choice is what comes back.

Recovery waits for 40.0C rather than 42.0C. A single threshold would leave the
phone sitting exactly on the boundary, rebinding the camera every few seconds,
which is worse than either state. Readings must also repeat before anything
happens, so one spurious sample cannot drop a stream, and an unreadable
temperature is treated as no information rather than as cold.

Heat outranks everything, including a manual exposure — but it only ever
*lowers* the frame rate, so a 4fps night stays at 4fps rather than being
raised to the throttle ceiling.

The shutdown is recorded to preferences as well as posted as a notification,
so the app can still tell you what happened hours later when you pick the
phone up.

Battery temperature lags the SoC by several degrees. By the time the battery
reads 42C the chip has been hotter for a while, which is why the thresholds
are where they are rather than higher.

## Two-way audio

**Both directions are off by default and that is deliberate.** A live
microphone is more intrusive than a camera, and in several Australian states
recording a private conversation is a separate and stricter offence than
filming one — the rules differ by state and consent requirements are not the
same as for video. The notification reads "Camera and microphone are live" and
carries MIC LIVE whenever the mic is on.

Audio is unencrypted exactly like the video. Anyone on the network who can see
the stream can listen to the room.

### Listening (phone → you)

16-bit PCM, mono, no codec and so no extra dependency. 16kHz costs 32 KB/s,
which on a LAN is nothing.

### Gain, and why it was quiet

Two separate things make a raw phone mic stream sound distant.

**The capture source.** `VOICE_COMMUNICATION` routes through the phone-call
chain — echo cancellation, noise suppression and automatic gain control tuned
to hold a voice steady against a handset. For room monitoring that AGC works
against you. The app now only uses it when talkback is on and there is
genuinely an echo to cancel; otherwise it opens `VOICE_RECOGNITION`, which has
no AGC and is noticeably hotter. The source in use is shown in the status line.

**No automatic gain at all in this path**, unlike a call. So there is a
software gain, 1x to 20x, defaulting to 4x.

Set it by the **level meter**, not by ear: aim for peaks around 70–90% on
normal sound. The bar turns amber near the ceiling and red when samples clip,
and a clip counter tells you how many hit the ceiling. Clipping is hard rather
than soft-kneed on purpose — a limiter would hide the fact that the gain is
set too high, and for monitoring it is more useful to hear it break up than to
be quietly squashed.

Turning talkback on switches back to the quieter echo-cancelled path, so
expect to need more gain there.

### Talkback is amplified separately, and routed to the loudspeaker

Audio arriving at the phone — typed speech, or someone talking through the
browser — has its own **Talkback gain**, defaulting to 3x. Nothing else
amplifies it: synthesised speech and browser microphone audio both arrive well
below full scale.

The bigger factor is routing. `USAGE_VOICE_COMMUNICATION` looks like the
correct audio usage for speech and is the wrong one here: it sends playback to
the **call stream**, which on most phones means the earpiece rather than the
loudspeaker, at the in-call volume rather than the media volume. Across a room
that is close to inaudible. Playback now uses `USAGE_MEDIA`, so it comes out
of the loudspeaker at media volume like anything else.

The trade-off is that the echo canceller loses its reference, so two-way talk
can echo more. Half-duplex gating still covers it, and headphones on the phone
end remove the problem entirely. **Play talkback through the loudspeaker** can
be switched off to go back to the quiet-but-echo-free route.

**The viewer uses `/audio.pcm`, not `/audio.wav`, and that is the whole
latency story.** An `<audio>` tag buffers for its own smoothness and never
gives that buffer back, so the lag only grows the longer you listen. Instead
the page reads raw PCM and schedules each chunk itself through the Web Audio
API, keeping a running cursor about 50ms ahead of the audio clock: enough lead
to avoid gaps, little enough to stay near live. If playback stalls the cursor
resets to just ahead of now rather than trying to catch up through stale
audio, and anything more than 250ms behind live is dropped outright.

The capture side matches: 20ms chunks instead of 64ms, and a listener that
falls behind has its whole backlog thrown away rather than one frame shed per
overflow — shedding one frame leaves the queue full, so the lag it represents
never actually goes away.

`/audio.wav` still works and is the right address for VLC, ffplay or anything
else external. It serves a 44-byte WAV header declaring an open-ended length
followed by never-ending PCM. **Expect it to lag by a second or more**: media
players buffer ahead by design and there is no way to ask them not to. Use it
for convenience, not for listening live.

### Talking (you → phone)

`POST /talk` with raw 16-bit mono PCM and a `Content-Length`. Short finite
chunks rather than one endless upload — browsers restrict streaming request
bodies, while a plain Content-Length POST works everywhere. The viewer sends
roughly 250ms per request.

```
# straight from a terminal, no browser involved
arecord -f S16_LE -r 16000 -c 1 -t raw | \
  curl -u cam:pw -H 'Content-Type: application/octet-stream' \
       --data-binary @- "http://192.168.1.42:8080/talk?rate=16000"
```

### The browser will block the Talk button, and cannot be talked out of it

`getUserMedia` is only available in a **secure context**. A plain `http://`
LAN address is not one, so Chrome and Firefox refuse to hand the page a
microphone. This is a browser rule; no amount of code in the page changes it.
The viewer detects this and explains rather than failing with an undefined
error.

Two ways round it, both real:

1. **Use localhost**, which counts as secure even over http:
   ```
   adb forward tcp:8080 tcp:8080
   ```
   then open `http://localhost:8080`.
2. **Tell Chrome to trust the origin**: `chrome://flags/#unsafely-treat-insecure-origin-as-secure`,
   add `http://192.168.1.42:8080`, relaunch.

Listening is unaffected — `<audio>` needs no permission and works over plain
http.

### Feedback

A phone playing talkback through its speaker while its own microphone listens
will howl. Three defences:

- the platform echo canceller and noise suppressor, where the device has them
  (`echoCancel` in `/status` says whether it engaged);
- **half-duplex gating**, on by default, which feeds listeners silence while
  talkback is playing. Crude, but it is the one that always works;
- headphones on the phone end, which sidestep it entirely.

## Lenses: 0.5x and 3x

A phone with three rear lenses can present them to apps in two quite different
ways, and which one you get is up to the vendor and the firmware.

**Separate physical cameras.** Each lens is its own camera2 ID and an app binds
the one it wants. Most Samsung firmware does this for the rear cameras.

**One logical camera.** A single ID covers all the glass and switches
internally as the zoom ratio crosses thresholds. The app never picks a lens; it
asks for 0.5x and the camera decides. You can spot this because the zoom range
runs below 1.0.

Some devices do both, and some expose the aux lenses only to the stock camera
app. So the app does not hard-code camera IDs. It enumerates what the device
reports and handles both routes:

- The **Lens** dropdown lists every camera found, labelled with its real zoom
  factor.
- The **preset buttons** (0.5x, 1x, 3x…) prefer a physical lens at that factor
  — real glass beats cropping — and fall back to the zoom ratio when no
  separate lens exists.
- Factors the device cannot reach either way are not offered at all.

### Where the labels come from

Each lens's factor is worked out from its optics rather than guessed from the
camera ID, because ID ordering is not standardised:

```
equiv35 = focalLength_mm × 43.27 / sensorDiagonal_mm
factor  = equiv35(lens) / equiv35(main camera)
```

The raw focal length means nothing on its own — 5.4mm is normal on a phone
sensor and a fisheye on full frame — so scaling by the sensor diagonal is what
makes the numbers comparable. An ultra-wide at 13mm-equivalent against a
26mm-equivalent main lens comes out at 0.5x, which is the number the stock
camera app prints.

The factor shown is the **true** one, so a telephoto whose optics work out to
2.4x is labelled 2.4x rather than rounded up to the marketing 3x. Preset
matching uses a proportional tolerance (25%) so that lens still answers the
"3x" button, while 0.5x and 1x are never confused for one another.

### When a lens will not start

Aux lenses often support fewer resolutions and use-case combinations than the
main sensor — a telephoto that cannot do 1080p analysis plus stills will refuse
the whole bind. Rather than leaving a dead camera, the app falls back to the
default lens and says which one failed. Dropping the resolution usually fixes
it.

## Exposure mode

Two modes, and `Manual` wins outright.

**Auto** is the previous behaviour: auto-exposure runs, and the night logic
takes over when the scene darkens.

**Manual** pins `SENSOR_EXPOSURE_TIME` and `SENSOR_SENSITIVITY` to exactly what
you set, with AE off. The night logic is suppressed entirely while it's on —
auto-switching cannot override you, night mode controls grey out, and night
mode no longer slows the stream fps. The brightness meter keeps running for
the readout, it just doesn't touch the sensor.

The decision in `CameraController.rebind` is a strict order:

```
exposureMode == MANUAL && manualSensor  ->  the user's values
lowLightCapture() && manualSensor       ->  night's values
otherwise                               ->  auto-exposure
```

If the camera reports no `MANUAL_SENSOR` capability, Manual falls through to
auto-exposure and the app says so rather than pretending.

### Frame duration

`SENSOR_FRAME_DURATION` is `max(exposure, 1/targetFps)` — a frame can't be
shorter than its own exposure — and then capped at
`SENSOR_INFO_MAX_FRAME_DURATION`. That cap matters: at 1 fps the naive value
would be a full second, and some sensors reject the entire capture request
rather than clamping it for you.

### Live updates

Dragging a slider doesn't rebind. A rebind tears down and rebuilds the capture
session, which blacks out the stream for a moment. Instead
`Camera2CameraControl.setCaptureRequestOptions` pushes the same keys into the
running repeating request, so the change lands on the next frame.

Note that `setCaptureRequestOptions` *replaces* whatever that API set before,
so all four keys — including `CONTROL_AE_MODE = OFF` — are resent every time.
Send only the exposure and auto-exposure quietly switches back on and fights
your value.

Only switching Auto↔Manual forces a real rebind, because AE on/off is baked
into the use case at build time. Going back to Auto also clears the live
options first, or the session would keep AE switched off.

### Sliders follow the sensor

Every slider is scaled from what the camera actually reports, not from
hard-coded numbers:

- **Shutter** is geometric between `SENSOR_INFO_EXPOSURE_TIME_RANGE`'s bounds:
  `ns = min × (max/min)^(p/1000)`. Exposure is logarithmic to the eye — the
  step from 1/8000s to 1/4000s matters as much as 1/4s to 1/2s — so a linear
  slider would spend almost all its travel in exposures too short to tell
  apart. Equal travel means equal ratio.
- **ISO** sliders (both manual and night) span `SENSOR_INFO_SENSITIVITY_RANGE`
  exactly. The old hard-coded 50–6400 is gone; most phones stop well below it.
- **Night fps** can't go below `ceil(1e9 / maxExposureNs)`. If the sensor tops
  out at 125ms, 8 fps is already the longest exposure available and anything
  slower is a promise it can't keep. A hint explains why when the floor bites.

When you switch Auto → Manual the sliders are pre-filled from the camera's
*current* live exposure and ISO, so the picture doesn't jump.

## How night mode actually works

Worth being clear, because "lower the fps for night vision" only works for a
specific reason.

Sending fewer frames per second does not brighten anything on its own. What
makes a dark scene usable is a **longer exposure per frame** — and the sensor
can only expose for longer if it's allowed to run slowly. At a 30fps target
each frame is capped at about 33ms of light. At 4fps it can gather around
250ms. Roughly three stops.

There are two ways to get there, and the app picks based on what the hardware
reports in `REQUEST_AVAILABLE_CAPABILITIES`.

### Manual path (preferred)

If the camera advertises `MANUAL_SENSOR`, auto-exposure is switched **off** and
the sensor is driven directly:

```
exposure = 1 / nightFps          clamped to SENSOR_INFO_EXPOSURE_TIME_RANGE
                                 and SENSOR_INFO_MAX_FRAME_DURATION
ISO      = nightIso              clamped to SENSOR_INFO_SENSITIVITY_RANGE
```

via `SENSOR_EXPOSURE_TIME`, `SENSOR_FRAME_DURATION` and `SENSOR_SENSITIVITY`,
plus high-quality noise reduction. This is deterministic: ask for 250ms at
ISO 1600 and that is what the sensor does, whatever AE would have preferred.

Exposure compensation and the AE frame-rate range are **not** applied here.
Both only mean something while auto-exposure is running, and setting them
alongside `CONTROL_AE_MODE_OFF` would be noise.

### Fallback path

Without manual sensor support, AE stays on but is told its target frame-rate
range is low (`CONTROL_AE_TARGET_FPS_RANGE`), which frees it to choose long
exposures. The app picks the advertised range with the **lowest lower bound**,
breaking ties on the lowest upper bound — the lower bound is the floor AE may
drop to, and therefore how long one exposure can be.

Exposure compensation is also nudged up. Note that
`setExposureCompensationIndex` takes an *index*, not EV: the device reports a
step (commonly 1/6 or 1/3 EV) and the index counts those steps, so +2 EV on a
1/6-step device is index 12. The app divides by the reported step rather than
passing EV straight through.

Only ranges the hardware lists are ever requested — asking for one it doesn't
advertise can stop the camera opening at all.

### Auto switching

`Auto` watches average frame brightness (0–255, shown in the status line). It
engages below ~45 for about a second and releases above ~75 for several
seconds. Two thresholds rather than one, so it doesn't flip back and forth in
borderline light, with a 3-second minimum between switches.

### The trade-off

Motion blur. At 250ms anything moving smears. That's inherent to low-light
capture, not a bug. Raise night fps if catching motion matters more than
seeing detail.

## Live sensor readout

Every frame reports back what the sensor actually did, via a Camera2 session
capture callback reading `SENSOR_EXPOSURE_TIME` and `SENSOR_SENSITIVITY` off
the `TotalCaptureResult`. Shown in the app, the notification, `/status` and
the web viewer, formatted as `1/60s` under a second and `2.5s` above it.

This is the real measured value, not what was requested — useful for telling
whether the manual settings actually took, or whether AE quietly overrode them.
The sensor's own limits are shown alongside it, so you can see when a request
is being clamped.

## Night snapshot

One long-exposure still at full sensor resolution.

In **Manual** it uses your exposure and ISO exactly. In **Auto** it uses the
sensor's longest available exposure at the night ISO.

`ImageCapture`'s Camera2 options are fixed when the use case is built, so a
per-shot override isn't possible. Instead the app temporarily binds a *second*
`ImageCapture` configured for the long exposure, fires it, then restores the
normal configuration.

**The live stream pauses for one to three seconds during the shot.** That's
expected. Viewers see the stream stall and resume.

- Web viewer: the **Night snapshot** button, or `GET /shot.jpg?night=1`
- App: the **Night snapshot** button, shown in a dialog
- Only one at a time — a second request gets `409 Conflict`
- Capture that doesn't finish within 15s gets `504 Gateway Timeout`
- **The image is never written to phone storage.** It exists in memory and goes
  straight to the socket or the dialog.

## Phone battery

Read on demand from the sticky `ACTION_BATTERY_CHANGED` broadcast — passing a
null receiver returns the last value immediately, so there's no running
receiver and no extra permission. Percent, charging state and temperature
appear in the app, the notification and `/status`; the web viewer shows a red
warning above 40°C.

Worth watching: long exposures with the screen on and Wi-Fi busy will warm a
phone up, and sustained heat is how you degrade a battery.

## Building with your `B:\android-build` toolchain

From the project root:

**1. Nothing to generate — the wrapper is included.** `gradlew`, `gradlew.bat`
and `gradle/wrapper/gradle-wrapper.jar` ship in this zip, taken from the
official Gradle `v8.9.0` tag, so `.\gradlew.bat assembleDebug` works directly.

**2. Point the build at your SDK** — create `local.properties` in the root:

```
sdk.dir=B:\\android-build\\sdk
```

**3. Set JAVA_HOME:**

```
set JAVA_HOME=B:\android-build\jdk17
```

**4. Build:**

```
gradlew.bat assembleDebug
```

Output lands at `app/build/outputs/apk/debug/app-debug.apk`.

**5. Install:**

```
B:\android-build\sdk\platform-tools\adb.exe install -r app\build\outputs\apk\debug\app-debug.apk
```

Make sure the SDK 34 platform and build-tools are present under
`B:\android-build\sdk\platforms` and `...\build-tools`.

---

## /status fields

| Field | Meaning |
|---|---|
| `streaming`, `viewers` | whether the camera is live, and how many are watching |
| `resolution`, `targetFps`, `effectiveFps`, `quality` | stream settings |
| `nightMode`, `nightActive`, `nightFps`, `nightIso` | night-mode configuration |
| `luma` | average frame brightness, 0–255, what auto mode watches |
| `camera`, `torch` | lens in use, torch state |
| `lanOnly`, `boundTo` | binding policy and the address actually bound |
| `exposureNs`, `exposureLabel`, `iso` | what the sensor actually did on the last frame |
| `manualSensor` | whether manual exposure is available on this camera |
| `exposureMinNs`, `exposureMaxNs`, `exposureMinLabel`, `exposureMaxLabel` | sensor exposure limits |
| `isoMin`, `isoMax` | sensor sensitivity limits |
| `nightShotRunning` | a long-exposure still is in progress |
| `previewDropped` | preview was dropped because the 3-way bind failed |
| `exposureMode` | `AUTO` or `MANUAL` |
| `manualExposureNs`, `manualExposureLabel`, `manualIso` | the manual values in use |
| `manualUnsupported` | Manual was asked for but the sensor can't do it |
| `minNightFps` | lowest night fps this sensor can use |
| `lenses` | array of `{id, label, short, factor, front, selected}` |
| `cameraId` | camera2 id in use, empty for the facing default |
| `lensFallback` | a requested lens would not bind |
| `zoomRatio`, `zoomMin`, `zoomMax` | current and available zoom range |
| `audioEnabled`, `micRunning`, `audioSampleRate` | microphone state |
| `audioListeners`, `talkbackEnabled`, `talkbackPlaying` | who is listening, and whether talkback is live |
| `halfDuplex`, `echoCancel`, `micPermission`, `audioError` | feedback handling and faults |
| `audioGain`, `audioPeak`, `audioSource`, `audioClipped` | gain, live level 0-1, capture source, clip count |
| `talkbackGain`, `talkbackPeak`, `loudspeaker` | incoming audio gain, its level, and the output route |
| `sayQueued`, `sayHelperOnline`, `sayHelperAgoMs` | text waiting, and whether a PC helper is collecting it |
| `currentMa`, `averageMa` | battery draw, magnitude only, see the caveats |
| `idleThrottle`, `encoding`, `rotationMode` | power settings and whether frames are being encoded |
| `tempC`, `thermalThrottled`, `thermalNote` | battery temperature and guard state |
| `thermalThrottleAt`, `thermalShutdownAt` | the thresholds in use |
| `batteryPct`, `charging`, `batteryTempC` | phone battery |

## Notes and gotchas

- **Preview may be dropped on some devices.** Binding preview + analysis +
  capture at once isn't supported everywhere. If the 3-way bind fails the app
  retries without the preview and shows a banner; streaming is unaffected.
- **The preview only appears while streaming.** The camera is owned by the
  foreground service, not the Activity, so that the stream survives you leaving
  the app. Two separate CameraX bindings would fight each other, so there's no
  idle preview.
- **Rotation costs CPU.** Frames are rotated in NV21 before JPEG encoding, which
  is per-pixel work. At 1080p this is the most expensive thing the app does. If
  you always mount the phone the same way, deleting the rotation call in
  `FrameEncoder.analyze` will buy you noticeable fps.
- **Port and LAN-only changes apply on the next start**, since the socket is
  bound when the server starts.
- **If there's no Wi-Fi, LAN-only mode refuses to start** rather than silently
  falling back to a wildcard bind. The error appears under the address line.
- **If the network drops while streaming**, the camera keeps running and the
  status line says the stream is unreachable. It re-binds when Wi-Fi returns.
- `usesCleartextTraffic="true"` is required because the stream is plain HTTP.
- The wake lock is optional and user-toggleable. With it off, Android may
  suspend the CPU and stall the stream when the screen goes off.
- Settings persist in SharedPreferences and survive restarts.

## File map

```
Settings.java          all tunables + persistence
NetworkUtils.java      address classification, LAN IPv4 lookup, IPv6 prefix match
CameraLens.java        lens discovery, 35mm-equivalent maths, per-id selectors
AudioHub.java          microphone capture, gain and metering, fanout, talkback, WAV header
ThermalGuard.java      the throttle/shutdown/recover state machine, no Android deps
SayQueue.java          the text mailbox a PC helper polls, no Android deps
tools/say-helper.ps1   PC-side speech: polls, synthesises, posts the audio back
CrashLog.java          records the last crash so the next launch can show it
CameraController.java  CameraX binding, manual night exposure, night snapshot, sensor limits
MjpegServer.java       HTTP server, auth, MJPEG multipart, viewer page
FrameEncoder.java      YUV->NV21->JPEG, rotation, fps throttle, brightness metering
StreamService.java     foreground service, owns camera + server, night hysteresis
MainActivity.java      UI and controls
```

---

## Jarvis (PC-side AI)

`tools/` holds everything that runs on the Windows PC:

- `start-jarvis.bat` — one-click launcher. Checks Python, Ollama, the model and the
  phone, then opens the voice window, the live view, and the chat. Edit the
  settings block at the top (phone address, login, model, voice) first.
  Run `start-jarvis.bat tenant` for the horror personality.
- `jarvis.py` — grabs `/shot.jpg` from the phone, asks a local Ollama vision model
  about it, and streams each sentence to the phone's `/say`.
- `say-helper.ps1` — polls `/say/next`, synthesises with Windows speech, and posts
  the audio to `/talk` so it plays from the phone.

All three must sit in the same folder.
