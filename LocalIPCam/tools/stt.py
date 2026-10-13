"""
stt.py - speech to text for jarvis_app.py. Everything local.

    mic -> 32 ms blocks -> speech detector decides when you start and finish talking
        -> Whisper turns the whole thing into text -> on_text(text)

It's turn-based, like a walkie-talkie: once you finish talking the mic stops listening
while Whisper transcribes, while Jarvis thinks, and while the phone speaks his reply.
Then it listens again.

When you've finished: a gap of END_SILENCE seconds (the app's "pause before sending"
slider). Breaths and short pauses mid-sentence don't count.

Speech detector:
    Silero VAD (ships with faster-whisper) - a small neural net that knows speech from
    fans, breathing, clicks and music. Used whenever faster-whisper is installed.
    Loudness - fallback if it isn't.

Two mics:
    PhoneMic   the phone's own mic, streamed from its /audio.pcm (default). Needs audio
               switched on in the phone app.
    the PC's default recording device, through sounddevice.

Two engines:
    "faster-whisper"  (default) runs on the CPU, so it works on any PC and leaves the
                      GPU to Ollama.  py -m pip install faster-whisper sounddevice numpy
    "whispercpp"      whisper.cpp's whisper-server.exe, which can run on the RX 6800 XT
                      through Vulkan. You start the server yourself; this just posts audio
                      to it.  whisper-server.exe -m ggml-large-v3-turbo.bin --port 8178
"""

import io, queue, threading, time, wave
from collections import deque

RATE  = 16000                 # Whisper wants 16 kHz mono
BLOCK = 512                   # 32 ms per block (what Silero wants)
BLOCK_S = BLOCK / RATE

# Things Whisper likes to "hear" in silence or noise. A whole utterance that is
# just one of these gets dropped.
HALLUCINATIONS = {
    "", "you", "thank you", "thanks", "thank you for watching", "thanks for watching",
    "bye", "okay", "ok", "so", "uh", "um", "hmm", "mm", "oh",
    "subtitles by the amaraorg community", "please subscribe",
}


def _norm(text):
    return "".join(c for c in text.lower() if c.isalnum() or c == " ").strip()


# ------------------------------------------------------------------ transcribers

class Transcriber:
    def __init__(self, engine="faster-whisper", model="large-v3-turbo",
                 url="http://127.0.0.1:8178", language="en"):
        self.engine, self.model_name, self.url = engine, model, url.rstrip("/")
        self.language = language or None          # None = auto-detect
        self.model = None

    def load(self):
        """Slow the first time: faster-whisper downloads the model (~1.6 GB for turbo)."""
        if self.engine == "faster-whisper":
            from faster_whisper import WhisperModel
            self.model = WhisperModel(self.model_name, device="cpu", compute_type="int8")
        elif self.engine == "whispercpp":
            import requests
            requests.get(self.url, timeout=5)     # just checks the server is up
        else:
            raise ValueError(f"unknown STT engine {self.engine!r}")

    def transcribe(self, audio):
        """audio: float32 numpy array, 16 kHz mono. Returns cleaned text, or ''."""
        if self.engine == "faster-whisper":
            segments, _ = self.model.transcribe(
                audio, language=self.language, beam_size=5, vad_filter=True,
                condition_on_previous_text=False)
            text = " ".join(s.text.strip() for s in segments if s.no_speech_prob < 0.6)
        else:
            import requests
            r = requests.post(f"{self.url}/inference",
                              files={"file": ("speech.wav", _wav_bytes(audio), "audio/wav")},
                              data={"response_format": "json", "temperature": "0.0",
                                    "language": self.language or "auto"},
                              timeout=60)
            r.raise_for_status()
            text = r.json().get("text", "")
        text = " ".join(text.split())
        return "" if _norm(text) in HALLUCINATIONS else text


def _wav_bytes(audio):
    import numpy as np
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(pcm)
    return buf.getvalue()



# ------------------------------------------------------------------ speech detectors

class SileroVAD:
    """Chance (0..1) that a block is speech. Looks at the last quarter second each time
    so a single block has some context."""
    name = "Silero VAD"

    def __init__(self):
        import numpy as np
        from faster_whisper.vad import get_vad_model
        self.np = np
        self.model = get_vad_model()
        self.window = np.zeros(BLOCK * 8, dtype="float32")
        self.model(self.window)                       # fail now, not mid-sentence

    def reset(self):
        self.window[:] = 0

    def __call__(self, block, level):
        self.window = self.np.concatenate([self.window[BLOCK:], block])
        return float(self.np.ravel(self.model(self.window))[-1])


class EnergyVAD:
    """Fallback: loud = speech. Learns the room's background noise so a fan or the PC
    hum doesn't count."""
    name = "loudness"

    def __init__(self, start_ratio=3.0, min_level=0.008):
        self.start_ratio, self.min_level = start_ratio, min_level
        self.floor = 0.004
        self.warmup = []                              # first half second: measure the room

    def reset(self):
        pass

    def __call__(self, block, level):
        if self.warmup is not None:
            self.warmup.append(level)
            if len(self.warmup) >= 15:
                self.floor = max(1e-4, sorted(self.warmup)[len(self.warmup) // 2])
                self.warmup = None
            return 0.0
        thr = max(self.min_level, self.floor * self.start_ratio)
        if level < thr:
            self.floor = 0.95 * self.floor + 0.05 * level
            return 0.0 if level < thr * 0.6 else 0.4  # 0.4: quiet tail of a word
        return 1.0


def make_vad():
    try:
        return SileroVAD()
    except Exception:
        return EnergyVAD()


# ------------------------------------------------------------------ utterance cutter

class Segmenter:
    """Feed it blocks; it hands back the whole utterance once you've stopped talking
    for end_silence seconds."""

    START, KEEP = 0.5, 0.35                           # speech chance to start / to carry on

    def __init__(self, vad, end_silence=1.2, preroll=0.3, min_speech=0.25, max_len=30.0):
        self.vad = vad
        self.end_silence = end_silence                # can be changed while running
        self.min_voiced = int(min_speech / BLOCK_S)
        self.max_blocks = int(max_len / BLOCK_S)
        self.pre = deque(maxlen=int(preroll / BLOCK_S))
        self.reset()

    def reset(self):
        self.buf, self.loud, self.quiet, self.voiced = None, 0, 0, 0
        self.pre.clear()
        self.vad.reset()

    @property
    def talking(self):
        return self.buf is not None

    def feed(self, block):
        """Returns (level, utterance or None)."""
        import numpy as np
        level = float(np.sqrt(np.mean(block * block)))
        if level == 0.0 and self.buf is None:
            # exact digital silence: the phone mutes its mic while it is talking.
            return level, None
        p = self.vad(block, level)

        if self.buf is None:
            self.pre.append(block)
            self.loud = self.loud + 1 if p >= self.START else 0
            if self.loud >= 3:                        # ~100 ms of speech: you've started
                self.buf, self.voiced, self.quiet = list(self.pre), self.loud, 0
            return level, None

        self.buf.append(block)
        if p >= self.KEEP:
            self.quiet = 0; self.voiced += 1
        else:
            self.quiet += 1
        if self.quiet * BLOCK_S >= self.end_silence or len(self.buf) >= self.max_blocks:
            keep = len(self.buf) - max(0, self.quiet - 10)   # trim the trailing silence
            out = np.concatenate(self.buf[:keep]) if self.voiced >= self.min_voiced else None
            self.reset()
            return level, out
        return level, None


# ------------------------------------------------------------------ phone mic

class PhoneMic:
    """Reads the phone's /audio.pcm stream and hands out 30 ms blocks, like a
    sounddevice InputStream would. Reconnects if the stream drops."""

    def __init__(self, url, auth, callback, on_error):
        self.url, self.auth, self.cb, self.on_error = url.rstrip("/"), auth, callback, on_error
        self.on = False

    def start(self):
        import requests
        r = requests.get(f"{self.url}/audio.pcm", auth=self.auth, stream=True, timeout=(5, 10))
        if r.status_code == 401:
            raise RuntimeError("the phone says wrong password")
        if r.status_code == 503:
            raise RuntimeError("the phone's mic is off. Turn audio on in the phone app.")
        r.raise_for_status()
        self.on = True
        threading.Thread(target=self._run, args=(r,), daemon=True).start()

    def _rate(self, r):
        ctype = r.headers.get("Content-Type", "")
        if "rate=" in ctype:
            try:
                return int(ctype.split("rate=")[1].split(";")[0])
            except ValueError:
                pass
        return RATE

    def _run(self, r):
        import numpy as np, requests
        warned = False
        while self.on:
            try:
                rate = self._rate(r)
                left = np.zeros(0, dtype="float32")
                carry = b""
                for chunk in r.iter_content(chunk_size=2048):
                    if not self.on:
                        break
                    data = carry + chunk
                    cut = len(data) - len(data) % 2
                    data, carry = data[:cut], data[cut:]
                    pcm = np.frombuffer(data, dtype="<i2").astype("float32") / 32768.0
                    if rate != RATE and len(pcm):            # phone set to another rate
                        n = int(round(len(pcm) * RATE / rate))
                        pcm = np.interp(np.linspace(0, len(pcm) - 1, n),
                                        np.arange(len(pcm)), pcm).astype("float32")
                    left = np.concatenate([left, pcm])
                    while len(left) >= BLOCK:
                        self.cb(left[:BLOCK].reshape(-1, 1), BLOCK, None, None)
                        left = left[BLOCK:]
                warned = False
            except Exception as e:
                if self.on and not warned:
                    self.on_error(f"lost the phone's mic ({e}), reconnecting...")
                    warned = True
            finally:
                r.close()
            while self.on:                                     # reconnect
                try:
                    r = requests.get(f"{self.url}/audio.pcm", auth=self.auth,
                                     stream=True, timeout=(5, 10))
                    if r.status_code == 200:
                        break
                    r.close()
                except Exception:
                    pass
                time.sleep(3)

    def stop(self):
        self.on = False

    def close(self):
        pass


# ------------------------------------------------------------------ mic listener

class Listener:
    """Owns the mic. The mic is only open while the listener is on, so Windows'
    mic-in-use icon tells the truth.

    Turn-based: as soon as an utterance is cut, listening holds until release() is
    called (the app calls it once Jarvis has finished answering). If Whisper hears
    nothing worth sending, it releases itself.

    on_text(str)    something you said, already transcribed
    on_level(float) mic level 0..1, for the meter
    on_state(str)   'listening', 'hearing you', 'transcribing', 'waiting', 'muted', 'off'
    on_error(str)
    """

    def __init__(self, transcriber, on_text, on_level=None, on_state=None, on_error=None,
                 phone=None, auth=None, end_silence=1.2):
        """phone: the phone's address to use its mic, or None for the PC's mic."""
        self.t = transcriber
        self.phone, self.auth = phone, auth
        self.on_text = on_text
        self.on_level = on_level or (lambda v: None)
        self.on_state = on_state or (lambda s: None)
        self.on_error = on_error or (lambda e: None)
        self.vad = make_vad()
        self.seg = Segmenter(self.vad, end_silence)
        self.blocks = queue.Queue()
        self.utterances = queue.Queue()
        self.stream = None
        self.running = False
        self.held = False                 # not listening: transcribing / Jarvis thinking
        self.mute_until = 0.0             # time.time() before which the mic is ignored,
                                          # e.g. while the phone speaks, so Jarvis
                                          # doesn't hear himself
        self.busy = False                 # Whisper is working on something
        self._state = "off"
        threading.Thread(target=self._transcribe_loop, daemon=True).start()

    @property
    def end_silence(self):
        return self.seg.end_silence

    @end_silence.setter
    def end_silence(self, seconds):
        self.seg.end_silence = seconds

    def hold(self):
        """Stop listening until release()."""
        self.held = True

    def release(self, at=0.0):
        """Listen again, from time.time() == at (now if it's in the past)."""
        self.mute_until = max(self.mute_until, at)
        self.held = False

    def _set(self, state):
        if state != self._state:
            self._state = state
            self.on_state(state)

    def start(self):
        if self.running:
            return
        self.seg.reset()
        if isinstance(self.vad, EnergyVAD):
            self.vad = self.seg.vad = EnergyVAD()      # re-measure the room each time
        self.held = False
        if self.phone:
            self.stream = PhoneMic(self.phone, self.auth, self._callback, self.on_error)
        else:
            import sounddevice as sd
            self.stream = sd.InputStream(samplerate=RATE, channels=1, dtype="float32",
                                         blocksize=BLOCK, callback=self._callback)
        self.stream.start()
        self.running = True
        threading.Thread(target=self._segment_loop, daemon=True).start()
        self._set("listening")

    def stop(self):
        self.running = False
        if self.stream is not None:
            try:
                self.stream.stop(); self.stream.close()
            except Exception:
                pass
            self.stream = None
        self.blocks.put(None)
        self.on_level(0.0)
        self._set("off")

    def _callback(self, indata, frames, when, status):
        self.blocks.put(indata[:, 0].copy())

    def _segment_loop(self):
        while self.running:
            block = self.blocks.get()
            if block is None:
                break
            if self.held or self.busy or time.time() < self.mute_until:
                if self.seg.talking or self.seg.pre:
                    self.seg.reset()
                self.on_level(0.0)
                self._set("transcribing" if self.busy else "waiting" if self.held else "muted")
                continue
            level, utt = self.seg.feed(block)
            self.on_level(min(1.0, level * 8))
            if utt is not None:
                self.held = True                       # turn over: stop listening
                self.busy = True
                self.utterances.put(utt)
                self._set("transcribing")
                continue
            self._set("hearing you" if self.seg.talking else "listening")
        while not self.blocks.empty():                # drop anything left over
            self.blocks.get_nowait()

    def _transcribe_loop(self):
        while True:
            audio = self.utterances.get()
            self.busy = True
            try:
                text = self.t.transcribe(audio)
            except Exception as e:
                self.on_error(f"transcription failed: {e}")
                text = ""
            if text and self.running:
                self.on_text(text)                     # stays held until the app releases
            else:
                self.held = False                      # nothing to send: listen again
            self.busy = False
