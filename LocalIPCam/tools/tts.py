"""
tts.py - Jarvis's voice, sent straight to the phone's speaker.

    text -> Windows' built-in voice (one PowerShell process kept running, the same
            System.Speech code as say-helper.ps1) -> 16 kHz PCM -> POST /talk

Why not just use /say and say-helper.ps1? Because then nothing on the PC knows when
the phone has actually finished talking, so the mic has to guess when to listen again.
The phone answers each /talk POST only once it has played that audio, so here the
moment the last POST returns is the moment Jarvis stops talking.
"""

import base64, os, queue, subprocess, sys, threading, time

RATE  = 16000
CHUNK = 32000           # bytes per POST, ~1 s of audio; smaller pieces start playing sooner

PS_SCRIPT = r'''
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
if ($env:JV_VOICE) { try { $synth.SelectVoice($env:JV_VOICE) } catch { } }
$synth.Rate = [Math]::Max(-10, [Math]::Min(10, [int]$env:JV_SPEED))
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,
    [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
    [System.Speech.AudioFormat.AudioChannel]::Mono)
[Console]::Out.WriteLine("READY " + $synth.Voice.Name)
[Console]::Out.Flush()
while ($true) {
    $line = [Console]::In.ReadLine()
    if ($line -eq $null) { break }
    $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line))
    $ms = New-Object System.IO.MemoryStream
    $synth.SetOutputToAudioStream($ms, $format)
    $synth.Speak($text)
    $synth.SetOutputToNull()
    [Console]::Out.WriteLine([Convert]::ToBase64String($ms.ToArray()))
    [Console]::Out.Flush()
    $ms.Dispose()
}
'''


def _powershell_cmd():
    encoded = base64.b64encode(PS_SCRIPT.encode("utf-16-le")).decode()
    return ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
            "-EncodedCommand", encoded]


class Speaker:
    """Say sentences in order. Synthesis of the next sentence overlaps playback of the
    current one, so there are no gaps.

    busy        True while anything is waiting to be synthesised or played
    finished_at time.time() when the phone finished playing the last audio
    """

    def __init__(self, phone, auth, voice="", speed=0, on_error=None, cmd=None):
        self.phone, self.auth = phone.rstrip("/"), auth
        self.voice, self.speed = voice, speed
        self.on_error = on_error or (lambda e: None)
        self.cmd = cmd or _powershell_cmd()
        self.proc = None
        self.voice_name = ""
        self.texts = queue.Queue()
        self.audio = queue.Queue()
        self.pending = 0
        self.lock = threading.Lock()
        self.finished_at = 0.0

    @property
    def busy(self):
        return self.pending > 0

    def start(self):
        """Starts the voice. Raises if it can't (not Windows, PowerShell broken...)."""
        env = dict(os.environ, JV_VOICE=self.voice or "", JV_SPEED=str(int(self.speed)))
        flags = 0x08000000 if sys.platform == "win32" else 0      # no console window
        self.proc = subprocess.Popen(self.cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, env=env, creationflags=flags)
        ready = self.proc.stdout.readline().decode(errors="replace").strip()
        if not ready.startswith("READY"):
            err = self.proc.stderr.read().decode(errors="replace").strip() if self.proc.poll() is not None else ""
            raise RuntimeError(err or ready or "the voice process didn't start")
        self.voice_name = ready[6:]
        threading.Thread(target=self._synth_loop, daemon=True).start()
        threading.Thread(target=self._play_loop, daemon=True).start()

    def say(self, text):
        text = " ".join(text.split())
        if not text:
            return
        with self.lock:
            self.pending += 1
        self.texts.put(text)

    def _done_one(self):
        with self.lock:
            self.pending -= 1
            if self.pending == 0:
                self.finished_at = time.time()

    def _synth_loop(self):
        while True:
            text = self.texts.get()
            try:
                self.proc.stdin.write(base64.b64encode(text.encode("utf-8")) + b"\n")
                self.proc.stdin.flush()
                pcm = base64.b64decode(self.proc.stdout.readline().strip())
            except Exception as e:
                self.on_error(f"voice failed: {e}")
                self._done_one()
                continue
            self.audio.put(pcm)

    def _play_loop(self):
        import requests
        warned = False
        while True:
            pcm = self.audio.get()
            try:
                for i in range(0, len(pcm), CHUNK):
                    r = requests.post(f"{self.phone}/talk?rate={RATE}", data=pcm[i:i + CHUNK],
                                      auth=self.auth, timeout=15,
                                      headers={"Content-Type": "application/octet-stream"})
                    if r.status_code == 403:
                        raise RuntimeError("talkback is switched off in the phone app")
                    r.raise_for_status()
                warned = False
            except Exception as e:
                if not warned:
                    self.on_error(f"couldn't play on the phone: {e}")
                    warned = True
            self._done_one()

    def close(self):
        if self.proc is not None:
            try:
                self.proc.stdin.close(); self.proc.kill()
            except Exception:
                pass
