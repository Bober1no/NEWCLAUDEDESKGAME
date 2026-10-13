"""
stt.py - speech to text for jarvis_app.py. Everything local.

    mic -> 30 ms blocks -> energy detector cuts out each thing you say
        -> Whisper turns it into text -> on_text(text)

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
BLOCK = 480                   # 30 ms per block
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


# ------------------------------------------------------------------ utterance cutter

class Segmenter:
    """Feed it 30 ms blocks; it hands back a whole utterance once you stop talking.
    Tracks the room's background noise so a fan or the PC hum doesn't count as speech."""

    def __init__(self, start_ratio=3.0, min_level=0.008, end_silence=0.8,
                 preroll=0.3, min_speech=0.3, max_len=20.0):
        self.start_ratio, self.min_level = start_ratio, min_level
        self.end_blocks = int(end_silence / BLOCK_S)
        self.min_voiced = int(min_speech / BLOCK_S)
        self.max_blocks = int(max_len / BLOCK_S)
        self.pre = deque(maxlen=int(preroll / BLOCK_S))
        self.floor = 0.004
        self.warmup = []                  # first half second: just measure the room
        self.reset()

    def reset(self):
        self.buf, self.loud, self.quiet, self.voiced = None, 0, 0, 0
        self.levels = []
        self.pre.clear()

    @property
    def talking(self):
        return self.buf is not None

    def threshold(self):
        return max(self.min_level, self.floor * self.start_ratio)

    def feed(self, block):
        """Returns (level, utterance or None)."""
        import numpy as np
        level = float(np.sqrt(np.mean(block * block)))
        if level == 0.0 and self.buf is None:
            # exact digital silence: the phone mutes its mic while it is talking.
            # Don't let that teach the detector the room is dead quiet.
            return level, None
        if self.warmup is not None:
            self.warmup.append(level)
            if len(self.warmup) >= 15:
                self.floor = max(1e-4, float(np.median(self.warmup)))
                self.warmup = None
            return level, None
        thr = self.threshold()

        if self.buf is None:
            if level < thr:
                self.floor = 0.95 * self.floor + 0.05 * level    # learn the room
                self.loud = 0
            else:
                self.loud += 1
            self.pre.append(block)
            if self.loud >= 3:                                   # 90 ms of sound = speech
                self.buf, self.voiced, self.quiet = list(self.pre), self.loud, 0
            return level, None

        self.buf.append(block)
        self.levels.append(level)
        if level >= thr * 0.6:
            self.quiet = 0; self.voiced += 1
        else:
            self.quiet += 1
        if self.quiet >= self.end_blocks or len(self.buf) >= self.max_blocks:
            out = np.concatenate(self.buf) if self.voiced >= self.min_voiced else None
            if len(self.buf) >= self.max_blocks:
                # 20 s without a pause is usually new background noise (a fan, music),
                # not a speech. Treat its quietest part as the new normal.
                self.floor = max(self.floor, float(np.percentile(self.levels, 20)))
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

    on_text(str)    something you said, already transcribed
    on_level(float) mic level 0..1, for the meter
    on_state(str)   'listening', 'hearing you', 'transcribing', 'muted', 'off'
    on_error(str)
    """

    def __init__(self, transcriber, on_text, on_level=None, on_state=None, on_error=None,
                 phone=None, auth=None):
        """phone: the phone's address to use its mic, or None for the PC's mic."""
        self.t = transcriber
        self.phone, self.auth = phone, auth
        self.on_text = on_text
        self.on_level = on_level or (lambda v: None)
        self.on_state = on_state or (lambda s: None)
        self.on_error = on_error or (lambda e: None)
        self.seg = Segmenter()
        self.blocks = queue.Queue()
        self.utterances = queue.Queue()
        self.stream = None
        self.running = False
        self.mute_until = 0.0             # time.time() before which the mic is ignored,
                                          # e.g. while the phone speaks, so Jarvis
                                          # doesn't hear himself and reply to himself
        self.busy = False                 # Whisper is working on something
        self._state = "off"
        threading.Thread(target=self._transcribe_loop, daemon=True).start()

    def _set(self, state):
        if state != self._state:
            self._state = state
            self.on_state(state)

    def start(self):
        if self.running:
            return
        self.seg = Segmenter()                     # re-measure the room each time
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
            if time.time() < self.mute_until:
                self.seg.reset()
                self.on_level(0.0)
                self._set("muted")
                continue
            level, utt = self.seg.feed(block)
            self.on_level(min(1.0, level * 8))
            if utt is not None:
                self.utterances.put(utt)
            self._set("hearing you" if self.seg.talking
                      else "transcribing" if self.busy else "listening")
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
            finally:
                self.busy = False
            if text and self.running:
                self.on_text(text)
