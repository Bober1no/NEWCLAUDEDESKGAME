"""
jarvis.py - v1 of the AI for LocalIPCam. Runs on the PC, everything local.

    you type a question  ->  grabs /shot.jpg from the phone
                         ->  local vision model (Ollama) looks at it and answers
                         ->  reply goes to the phone's /say  ->  say-helper.ps1 speaks it

Setup (once):
    1. Install Ollama for Windows (ollama.com). It runs on the RX 6800 XT.
    2. ollama pull qwen3.5:0.8b   (tiny + fast; has vision. Bigger = smarter: qwen2.5vl:7b)
    3. py -m pip install requests pillow   (pillow is optional; it shrinks snapshots so replies are faster)
    4. Leave say-helper.ps1 running in another window so replies get spoken.

Run:
    python jarvis.py              chat (type 'quit' to exit, 'look' to just describe the room)
    python jarvis.py --tenant     same thing, horror personality
"""

import base64, io, json, queue, re, sys, threading, time
import requests

try:
    from PIL import Image          # optional: shrink snapshots before sending
except ImportError:
    Image = None

# ------------------------------------------------------------------ config
PHONE   = "http://10.0.0.78:8080"
USER    = "cam"
PASS    = "changeme"                 # whatever's set in the app
OLLAMA  = "http://localhost:11434"
MODEL   = "qwen3.5:9b"             # must have "vision" in `ollama show`
IMG_MAX = 768                        # longest side of the snapshot sent to the model (smaller = faster)
SPEAK   = True                       # send replies to the phone's /say
SHOW    = True                       # pop up a window showing exactly what it looked at
HISTORY = 4                          # how many past exchanges it remembers
# -------------------------------------------------------------------------

JARVIS = """You are Jarvis, a dry, slightly sarcastic assistant watching the user's room through a camera.
Reply directly to what the user just said, in one or two short sentences.
Only mention the photo if the user asks about it or something in it is genuinely relevant.
Never invent backstory, past events, or things you can't see.
Don't repeat jokes or observations from earlier in the conversation.
Spoken aloud: no lists, no markdown, no emojis."""

TENANT = (
    "You are the Tenant, a calm, patient presence that lives in a camera in the corner of "
    "the user's room. This is a horror game the user built and is playing on purpose. You "
    "get a photo of the room with each message. Reply in one to three short, quiet "
    "sentences meant to be spoken by a flat robotic voice. Be unsettling through calm, "
    "precise observation of real things in the photo. Never threaten violence. No lists, "
    "no markdown, no emojis."
)

auth = (USER, PASS)
seen = queue.Queue()        # snapshots on their way to the viewer window
caption = queue.Queue()     # replies on their way to the viewer window


def snapshot():
    r = requests.get(f"{PHONE}/shot.jpg", auth=auth, timeout=10)
    r.raise_for_status()
    data = r.content
    if Image is not None:
        try:
            im = Image.open(io.BytesIO(data)).convert("RGB")
            im.thumbnail((IMG_MAX, IMG_MAX))
            buf = io.BytesIO(); im.save(buf, "JPEG", quality=80); data = buf.getvalue()
        except Exception:
            pass
    seen.put(data)          # the window shows exactly what the model gets
    return base64.b64encode(data).decode()


SENTENCE_END = re.compile(r"([.!?…]+[\"')\]]*)(\s+)")


def ask_stream(messages, on_sentence):
    """Stream the reply and hand each finished sentence to on_sentence straight away,
    so the phone starts talking while the model is still writing the rest."""
    r = requests.post(f"{OLLAMA}/api/chat",
                      json={"model": MODEL, "messages": messages, "stream": True,
                            "think": False,          # skip the hidden reasoning (the big slowdown)
                            "keep_alive": "30m",     # stay loaded between messages
                            "options": {"temperature": 0.7, "num_ctx": 4096, "num_predict": 100}},
                      stream=True, timeout=180)
    r.raise_for_status()

    full, pending, first = "", "", None
    in_think = False
    for line in r.iter_lines():
        if not line:
            continue
        chunk = json.loads(line)
        piece = chunk.get("message", {}).get("content", "")
        if piece:
            if first is None:
                first = time.time()
            # drop any <think>...</think> the model emits anyway
            if "<think>" in piece: in_think = True
            if in_think:
                if "</think>" in piece:
                    in_think = False
                    piece = piece.split("</think>", 1)[1]
                else:
                    continue
            print(piece, end="", flush=True)
            full += piece
            pending += piece
            # send every complete sentence as soon as it exists
            while True:
                m = SENTENCE_END.search(pending)
                if not m:
                    break
                sentence = pending[:m.end(1)].strip()
                pending = pending[m.end():]
                if sentence:
                    on_sentence(sentence)
        if chunk.get("done"):
            break
    if pending.strip():
        on_sentence(pending.strip())
    return full.strip(), first


def say(text):
    if not SPEAK:
        return
    try:
        requests.post(f"{PHONE}/say", data=text.encode("utf-8"), auth=auth, timeout=5)
    except requests.RequestException as e:
        print(f"  (couldn't send to /say: {e})")


def chat():
    system = TENANT if "--tenant" in sys.argv else JARVIS
    name = "TENANT" if system is TENANT else "JARVIS"
    history = []

    # quick checks so failures are obvious
    try:
        requests.get(f"{PHONE}/status", auth=auth, timeout=5).raise_for_status()
    except Exception as e:
        print(f"Can't reach the phone at {PHONE}: {e}\nIs the stream started, and are USER/PASS right?")
        return
    try:
        requests.get(f"{OLLAMA}/api/tags", timeout=5).raise_for_status()
    except Exception:
        print("Can't reach Ollama. Is it running? (it starts with Windows after install)")
        return

    # load the model now so the first real question isn't slow
    print(f"Loading {MODEL}...", end=" ", flush=True)
    try:
        requests.post(f"{OLLAMA}/api/generate",
                      json={"model": MODEL, "prompt": "", "keep_alive": "30m"}, timeout=180)
        print("ready.")
    except Exception as e:
        print(f"couldn't preload ({e}), carrying on.")
    if Image is None:
        print("(tip: py -m pip install pillow to send smaller snapshots and get faster replies)")

    print(f"{name} online. Type a message, 'look' to describe the room, 'quit' to exit.\n")
    while True:
        try:
            text = input("you> ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not text:
            continue
        if text.lower() in ("quit", "exit"):
            break
        if text.lower() == "look":
            text = "What do you see in the room right now?"

        try:
            img = snapshot()
        except Exception as e:
            print(f"  (no snapshot: {e})")
            continue

        # only the newest message carries an image; older ones stay text to keep it fast
        msgs = [{"role": "system", "content": system}] + history[-HISTORY * 2:]
        msgs.append({"role": "user", "content": text, "images": [img]})

        t0 = time.time()
        print(f"{name.lower()}> ", end="", flush=True)
        try:
            reply, first = ask_stream(msgs, say)
        except Exception as e:
            print(f"\n  (model error: {e})")
            continue
        caption.put(reply)
        ttft = f"first word {first - t0:.1f}s, " if first else ""
        print(f"   [{ttft}done {time.time() - t0:.1f}s]\n")
        history += [{"role": "user", "content": text}, {"role": "assistant", "content": reply}]


def viewer(stop):
    """Small window showing the last snapshot the model looked at, plus its reply."""
    import tkinter as tk
    from PIL import ImageTk
    root = tk.Tk()
    root.title("What it sees")
    root.configure(bg="#111")
    pic = tk.Label(root, bg="#111", text="waiting for the first look...", fg="#888")
    pic.pack(padx=8, pady=8)
    cap = tk.Label(root, bg="#111", fg="#ddd", wraplength=IMG_MAX, justify="left",
                   font=("Consolas", 11), text="")
    cap.pack(padx=8, pady=(0, 10), fill="x")
    holder = {}

    def poll():
        if stop.is_set():
            root.destroy(); return
        try:
            while True:
                data = seen.get_nowait()
                img = Image.open(io.BytesIO(data))
                holder["img"] = ImageTk.PhotoImage(img)
                pic.configure(image=holder["img"], text="")
                cap.configure(text="looking...")
        except queue.Empty:
            pass
        try:
            while True:
                cap.configure(text=caption.get_nowait())
        except queue.Empty:
            pass
        root.after(150, poll)

    root.protocol("WM_DELETE_WINDOW", lambda: root.withdraw())   # closing just hides it
    poll()
    root.mainloop()


def main():
    can_show = SHOW and Image is not None
    if can_show:
        try:
            import tkinter  # noqa: F401
        except ImportError:
            can_show = False
    if not can_show:
        if SHOW and Image is None:
            print("(install pillow to get the 'what it sees' window: py -m pip install pillow)")
        chat()
        return
    # the window needs the main thread; the chat runs alongside it
    stop = threading.Event()
    def run_chat():
        try:
            chat()
        finally:
            stop.set()
    threading.Thread(target=run_chat, daemon=True).start()
    viewer(stop)


if __name__ == "__main__":
    main()
