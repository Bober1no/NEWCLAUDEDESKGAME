"""
jarvis_app.py - the Jarvis window. Chat, voice input, and what Jarvis sees, in one app.

The brain is still jarvis.py: this imports its settings, prompts, snapshot(), ask_stream()
and say(), so edit those there and the app picks them up.

Setup (once, on top of what jarvis.py needs):
    py -m pip install faster-whisper sounddevice numpy

Run:
    py jarvis_app.py            (or start-jarvis.bat, which checks everything first)
    py jarvis_app.py --tenant   horror personality

Mic button (or Ctrl+M) turns voice input on and off. Typing always works.
"""

import io, queue, sys, threading, time
import tkinter as tk
from tkinter import ttk

import jarvis
import stt

try:
    from PIL import Image, ImageTk
except ImportError:
    Image = ImageTk = None

# ------------------------------------------------------------------ config
MIC_SOURCE   = "phone"                   # "phone" = the phone's mic (turn audio on in the app), "pc" = this PC's mic
STT_ENGINE   = "faster-whisper"          # or "whispercpp" to use whisper-server.exe on the GPU
STT_MODEL    = "large-v3-turbo"          # faster-whisper model. Lighter: "distil-large-v3", "small.en"
STT_URL      = "http://127.0.0.1:8178"   # whisper-server address, for "whispercpp"
STT_LANGUAGE = "en"                      # "" to auto-detect
AUTO_SEND    = True                      # send what you said straight away (untick in the app to edit first)
WORDS_PER_S  = 2.5                       # how fast the phone talks; used to mute the mic meanwhile
VIEW_MAX     = 520                       # width of the "what Jarvis sees" picture
# -------------------------------------------------------------------------

BG, PANEL, FG, DIM = "#111316", "#1a1d22", "#e6e6e6", "#7d8590"
YOU, BOT, SYS, OK, BAD, MIC = "#7cc4ff", "#ffd479", "#9aa4b2", "#3fb950", "#f85149", "#e5534b"
MONO = ("Consolas", 11)
UI = ("Segoe UI", 10)


class Brain:
    """Runs one message at a time on its own thread so the window never freezes."""

    def __init__(self, post):
        self.post = post
        self.inbox = queue.Queue()
        self.history = []
        self.pending = 0
        self.system = jarvis.TENANT if "--tenant" in sys.argv else jarvis.JARVIS
        self.on_sentence = lambda s: None
        threading.Thread(target=self._loop, daemon=True).start()

    @property
    def name(self):
        return "Tenant" if self.system is jarvis.TENANT else "Jarvis"

    def set_mode(self, tenant):
        self.system = jarvis.TENANT if tenant else jarvis.JARVIS
        self.history = []

    def send(self, text, spoken=False):
        self.pending += 1
        self.inbox.put((text, spoken))

    def busy(self):
        return self.pending > 0

    def _loop(self):
        while True:
            text, spoken = self.inbox.get()
            self.post("you", text, spoken)
            try:
                self._handle(text)
            except Exception as e:
                self.post("sys", f"something broke: {e}")
            finally:
                self.pending -= 1

    def _handle(self, text):
        if text.lower() == "look":
            text = "What do you see in the room right now?"
        try:
            img = jarvis.snapshot()
        except Exception as e:
            self.post("sys", f"no snapshot: {e}")
            return

        msgs = [{"role": "system", "content": self.system}] + self.history[-jarvis.HISTORY * 2:]
        msgs.append({"role": "user", "content": text, "images": [img]})

        t0 = time.time()
        self.post("bot_start", self.name.lower())

        def sentence(s):
            jarvis.say(s)
            self.on_sentence(s)
            self.post("bot_text", s)

        try:
            reply, first = jarvis.ask_stream(msgs, sentence)
        except Exception as e:
            self.post("bot_end", "")
            self.post("sys", f"model error: {e}")
            return
        ttft = f"first word {first - t0:.1f}s, " if first else ""
        self.post("bot_end", f"{ttft}done {time.time() - t0:.1f}s")
        self.post("caption", reply)
        self.history += [{"role": "user", "content": text}, {"role": "assistant", "content": reply}]


class App:
    def __init__(self, root):
        self.root = root
        self.events = queue.Queue()
        self.brain = Brain(self.post)
        self.brain.on_sentence = self._mute_while_speaking
        self.transcriber = stt.Transcriber(STT_ENGINE, STT_MODEL, STT_URL, STT_LANGUAGE)
        self.listener = None
        self.stt_ready = False
        self.stt_loading = False
        self.mic_on = False
        self.speak_until = 0.0
        self._photo = None

        root.title(f"{self.brain.name} - LocalIPCam")
        root.configure(bg=BG)
        root.geometry("1180x720")
        root.minsize(900, 560)
        self._style()
        self._build()

        root.bind("<Control-m>", lambda e: self.toggle_mic())
        root.protocol("WM_DELETE_WINDOW", self.close)
        threading.Thread(target=self._startup_checks, daemon=True).start()
        self._pump()

    # ---------------------------------------------------------------- layout
    def _style(self):
        s = ttk.Style()
        try:
            s.theme_use("clam")
        except tk.TclError:
            pass
        s.configure(".", background=BG, foreground=FG, font=UI)
        s.configure("Panel.TFrame", background=PANEL)
        s.configure("TFrame", background=BG)
        s.configure("TLabel", background=BG, foreground=FG)
        s.configure("Panel.TLabel", background=PANEL, foreground=FG)
        s.configure("Dim.TLabel", background=BG, foreground=DIM)
        s.configure("Head.TLabel", background=PANEL, foreground=DIM, font=("Segoe UI", 9, "bold"))
        s.configure("TCheckbutton", background=BG, foreground=FG)
        s.map("TCheckbutton", background=[("active", BG)])
        s.configure("TButton", background="#2a2f37", foreground=FG, borderwidth=0, padding=(12, 6))
        s.map("TButton", background=[("active", "#353b45")])
        s.configure("TCombobox", fieldbackground="#2a2f37", background="#2a2f37", foreground=FG)
        s.map("TCombobox", fieldbackground=[("readonly", "#2a2f37")],
              foreground=[("readonly", FG)], selectbackground=[("readonly", "#2a2f37")],
              selectforeground=[("readonly", FG)])

    def _build(self):
        root = self.root
        root.columnconfigure(0, weight=0)
        root.columnconfigure(1, weight=1)
        root.rowconfigure(1, weight=1)

        # status bar
        bar = ttk.Frame(root, padding=(12, 8))
        bar.grid(row=0, column=0, columnspan=2, sticky="ew")
        self.status = {}
        for key, label in (("phone", "phone"), ("ollama", "ollama"), ("model", jarvis.MODEL),
                           ("stt", "voice input")):
            dot = tk.Label(bar, text="●", fg=DIM, bg=BG, font=("Segoe UI", 11))
            dot.pack(side="left")
            txt = ttk.Label(bar, text=label, style="Dim.TLabel")
            txt.pack(side="left", padx=(2, 16))
            self.status[key] = (dot, txt)
        self.mode = tk.StringVar(value=self.brain.name)
        mode = ttk.Combobox(bar, textvariable=self.mode, values=("Jarvis", "Tenant"),
                            state="readonly", width=8)
        mode.pack(side="right")
        mode.bind("<<ComboboxSelected>>", self._mode_changed)
        ttk.Label(bar, text="personality", style="Dim.TLabel").pack(side="right", padx=6)

        # left: what it sees
        left = ttk.Frame(root, style="Panel.TFrame", padding=10)
        left.grid(row=1, column=0, sticky="ns", padx=(12, 6), pady=(0, 12))
        ttk.Label(left, text="WHAT JARVIS SEES", style="Head.TLabel").pack(anchor="w")
        self.view = tk.Label(left, bg="#0b0c0e", fg=DIM, text="nothing yet\n\nsay something, or press Look",
                             width=VIEW_MAX // 8, height=VIEW_MAX // 24, font=UI)
        self.view.pack(pady=(8, 8))
        self.caption = tk.Label(left, bg=PANEL, fg=FG, font=MONO, wraplength=VIEW_MAX,
                                justify="left", anchor="w", text="")
        self.caption.pack(fill="x")
        ttk.Button(left, text="Look", command=lambda: self.send("look")).pack(anchor="w", pady=(10, 0))

        # right: chat + input
        right = ttk.Frame(root)
        right.grid(row=1, column=1, sticky="nsew", padx=(6, 12), pady=(0, 12))
        right.rowconfigure(0, weight=1)
        right.columnconfigure(0, weight=1)

        log_frame = ttk.Frame(right, style="Panel.TFrame")
        log_frame.grid(row=0, column=0, sticky="nsew")
        log_frame.rowconfigure(0, weight=1)
        log_frame.columnconfigure(0, weight=1)
        self.log = tk.Text(log_frame, bg=PANEL, fg=FG, font=MONO, wrap="word", bd=0,
                           padx=12, pady=10, insertbackground=FG, state="disabled")
        self.log.grid(row=0, column=0, sticky="nsew")
        sb = ttk.Scrollbar(log_frame, command=self.log.yview)
        sb.grid(row=0, column=1, sticky="ns")
        self.log.configure(yscrollcommand=sb.set)
        for tag, color in (("you", YOU), ("bot", BOT), ("sys", SYS), ("dim", DIM)):
            self.log.tag_configure(tag, foreground=color)

        # mic row
        microw = ttk.Frame(right, padding=(0, 10, 0, 6))
        microw.grid(row=1, column=0, sticky="ew")
        self.mic_btn = tk.Button(microw, text="Mic off", width=10, command=self.toggle_mic,
                                 bg="#2a2f37", fg=FG, activebackground="#353b45",
                                 activeforeground=FG, bd=0, font=("Segoe UI", 10, "bold"),
                                 padx=10, pady=6, cursor="hand2")
        self.mic_btn.pack(side="left")
        self.meter = tk.Canvas(microw, width=140, height=10, bg="#0b0c0e", highlightthickness=0)
        self.meter.pack(side="left", padx=12)
        self.meter_bar = self.meter.create_rectangle(0, 0, 0, 10, fill=OK, width=0)
        self.mic_state = ttk.Label(microw, text="off  (Ctrl+M)", style="Dim.TLabel")
        self.mic_state.pack(side="left")
        self.auto_send = tk.BooleanVar(value=AUTO_SEND)
        ttk.Checkbutton(microw, text="send what I say straight away",
                        variable=self.auto_send).pack(side="right")

        # input row
        inrow = ttk.Frame(right)
        inrow.grid(row=2, column=0, sticky="ew")
        inrow.columnconfigure(0, weight=1)
        self.entry = tk.Entry(inrow, bg="#2a2f37", fg=FG, insertbackground=FG, bd=0,
                              font=("Segoe UI", 11), relief="flat")
        self.entry.grid(row=0, column=0, sticky="ew", ipady=8, padx=(0, 8))
        self.entry.bind("<Return>", lambda e: self._send_entry())
        self.entry.focus_set()
        ttk.Button(inrow, text="Send", command=self._send_entry).grid(row=0, column=1)

    # ---------------------------------------------------------------- events
    def post(self, kind, *args):
        """Thread-safe: worker threads call this, the UI thread acts on it."""
        self.events.put((kind, args))

    def _pump(self):
        try:
            while True:
                kind, args = self.events.get_nowait()
                getattr(self, f"_on_{kind}")(*args)
        except queue.Empty:
            pass
        try:
            while True:
                self._show_image(jarvis.seen.get_nowait())
        except queue.Empty:
            pass
        self.root.after(40, self._pump)

    def _write(self, text, tag=None):
        self.log.configure(state="normal")
        self.log.insert("end", text, tag)
        self.log.configure(state="disabled")
        self.log.see("end")

    def _on_sys(self, text):
        self._write(f"  {text}\n", "sys")

    def _on_you(self, text, spoken):
        self._write("you (said)> " if spoken else "you> ", "you")
        self._write(text + "\n")

    def _on_bot_start(self, name):
        self._write(f"{name}> ", "bot")
        self.caption.configure(text="thinking...")

    def _on_bot_text(self, text):
        self._write(text + " ")

    def _on_bot_end(self, timing):
        self._write(f"  [{timing}]\n\n" if timing else "\n", "dim")

    def _on_caption(self, text):
        self.caption.configure(text=text)

    def _on_status(self, key, ok, text=None):
        dot, label = self.status[key]
        dot.configure(fg={True: OK, False: BAD, None: DIM}[ok])
        if text:
            label.configure(text=text)

    def _on_heard(self, text):
        if self.auto_send.get():
            self.send(text, spoken=True)
        else:
            self.entry.delete(0, "end")
            self.entry.insert(0, text)
            self.entry.focus_set()

    def _on_level(self, v):
        self.meter.coords(self.meter_bar, 0, 0, int(140 * v), 10)
        self.meter.itemconfigure(self.meter_bar, fill=MIC if v > 0.6 else OK)

    def _on_micstate(self, state):
        if not self.mic_on:
            state = "off"
        hint = {"listening": "listening...", "hearing you": "hearing you",
                "transcribing": "transcribing...", "muted": "paused while Jarvis talks",
                "off": "off  (Ctrl+M)"}.get(state, state)
        self.mic_state.configure(text=hint, foreground=MIC if state == "hearing you" else DIM)

    def _on_stt_loaded(self, ok, msg):
        self.stt_loading = False
        self.stt_ready = ok
        self._on_status("stt", ok, "voice input" if ok else "voice input (failed)")
        if ok:
            if self.mic_on:
                self._start_listener()
        else:
            self._on_sys(msg)
            self._set_mic(False)

    # ---------------------------------------------------------------- actions
    def _send_entry(self):
        text = self.entry.get().strip()
        if text:
            self.entry.delete(0, "end")
            self.send(text)

    def send(self, text, spoken=False):
        if text.lower() in ("quit", "exit"):
            self.close(); return
        if self.brain.busy():
            self.caption.configure(text=f"(queued: {text})")
        self.brain.send(text, spoken)

    def _mode_changed(self, _e=None):
        tenant = self.mode.get() == "Tenant"
        self.brain.set_mode(tenant)
        self.root.title(f"{self.brain.name} - LocalIPCam")
        self._on_sys(f"switched to {self.brain.name}, memory of this chat cleared")

    def _mute_while_speaking(self, sentence):
        """The phone speaks out loud in the same room as the mic. Without this,
        Jarvis hears himself and starts replying to his own voice."""
        now = time.time()
        talk = len(sentence.split()) / WORDS_PER_S
        start = max(now + 0.8, self.speak_until)        # synth + upload before it starts playing
        self.speak_until = start + talk
        if self.listener is not None:
            self.listener.mute_until = max(self.listener.mute_until, self.speak_until + 0.6)

    def toggle_mic(self):
        self._set_mic(not self.mic_on)

    def _set_mic(self, on):
        self.mic_on = on
        self.mic_btn.configure(text="Mic on" if on else "Mic off",
                               bg=MIC if on else "#2a2f37",
                               activebackground=MIC if on else "#353b45")
        if not on:
            if self.listener is not None:
                self.listener.stop()
            self._on_micstate("off")
            self._on_level(0)
            return
        if self.stt_ready:
            self._start_listener()
        elif not self.stt_loading:
            self.stt_loading = True
            self._on_status("stt", None, "voice input (loading...)")
            self.mic_state.configure(text="loading Whisper (first time downloads ~1.6 GB)...")
            threading.Thread(target=self._load_stt, daemon=True).start()

    def _load_stt(self):
        try:
            import numpy        # noqa: F401
            if MIC_SOURCE == "pc":
                import sounddevice  # noqa: F401
        except ImportError:
            self.post("stt_loaded", False,
                      "voice input needs: py -m pip install faster-whisper sounddevice numpy")
            return
        try:
            self.transcriber.load()
        except ImportError:
            self.post("stt_loaded", False, "voice input needs: py -m pip install faster-whisper")
            return
        except Exception as e:
            where = f" at {STT_URL}" if STT_ENGINE == "whispercpp" else ""
            self.post("stt_loaded", False, f"couldn't load speech model{where}: {e}")
            return
        self.post("stt_loaded", True, "")

    def _start_listener(self):
        if self.listener is None:
            self.listener = stt.Listener(
                self.transcriber,
                on_text=lambda t: self.post("heard", t),
                on_level=lambda v: self.post("level", v),
                on_state=lambda s: self.post("micstate", s),
                on_error=lambda e: self.post("sys", e),
                phone=jarvis.PHONE if MIC_SOURCE == "phone" else None, auth=jarvis.auth)
        self.listener.mute_until = max(self.listener.mute_until, self.speak_until + 0.6)
        try:
            self.listener.start()
        except Exception as e:
            where = "the phone's mic" if MIC_SOURCE == "phone" else "the microphone"
            self._on_sys(f"couldn't open {where}: {e}")
            self._set_mic(False)

    def _show_image(self, data):
        if Image is None:
            self.view.configure(text="(py -m pip install pillow to see the picture)")
            return
        try:
            im = Image.open(io.BytesIO(data))
            im.thumbnail((VIEW_MAX, VIEW_MAX))
            self._photo = ImageTk.PhotoImage(im)
            self.view.configure(image=self._photo, text="", width=im.width, height=im.height)
        except Exception as e:
            self._on_sys(f"couldn't show snapshot: {e}")

    def _startup_checks(self):
        import requests
        try:
            requests.get(f"{jarvis.PHONE}/status", auth=jarvis.auth, timeout=5).raise_for_status()
            self.post("status", "phone", True)
        except Exception as e:
            self.post("status", "phone", False)
            self.post("sys", f"can't reach the phone at {jarvis.PHONE}: {e}")
        try:
            requests.get(f"{jarvis.OLLAMA}/api/tags", timeout=5).raise_for_status()
            self.post("status", "ollama", True)
        except Exception:
            self.post("status", "ollama", False)
            self.post("sys", "can't reach Ollama. Is it running?")
            return
        self.post("status", "model", None, f"{jarvis.MODEL} (loading...)")
        try:
            requests.post(f"{jarvis.OLLAMA}/api/generate",
                          json={"model": jarvis.MODEL, "prompt": "", "keep_alive": "30m"},
                          timeout=180).raise_for_status()
            self.post("status", "model", True, jarvis.MODEL)
        except Exception as e:
            self.post("status", "model", False, jarvis.MODEL)
            self.post("sys", f"couldn't load {jarvis.MODEL}: {e}")

    def close(self):
        if self.listener is not None:
            self.listener.stop()
        self.root.destroy()


def main():
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
