#!/usr/bin/env python3
"""
End-to-end API validation: upload → SSE progress → task detail → download result.

Usage:
    cd ~/code/project/m-trans

    # Start server in another terminal:
    uv run uvicorn app.main:app --host 127.0.0.1 --port 8000

    # Run test with Google translator:
    uv run python3 test/test_api_e2e.py --translator google --image ./tmp/test-manga.jpg

    # Run test with original (no network needed):
    uv run python3 test/test_api_e2e.py --translator original

    # Keep task files after test:
    uv run python3 test/test_api_e2e.py --translator google --keep
"""
from __future__ import annotations

import argparse
import json
import threading
import time
import urllib.request
from pathlib import Path
from queue import Empty, Queue
from typing import Optional

BASE = "http://127.0.0.1:8000"


def api_options() -> dict:
    with urllib.request.urlopen(f"{BASE}/api/options", timeout=5) as r:
        return json.loads(r.read().decode())


def api_upload(image_path: str, config: dict) -> str:
    import subprocess

    proc = subprocess.run(
        [
            "curl", "-sS", "-X", "POST", f"{BASE}/api/tasks",
            "-F", f"image=@{image_path}",
            "-F", f"config={json.dumps(config)}",
        ],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"Upload failed: {proc.stderr}")
    return json.loads(proc.stdout)["task_id"]


def api_task(task_id: str) -> dict:
    with urllib.request.urlopen(f"{BASE}/api/tasks/{task_id}", timeout=5) as r:
        return json.loads(r.read().decode())


def api_delete(task_id: str) -> None:
    req = urllib.request.Request(f"{BASE}/api/tasks/{task_id}", method="DELETE")
    urllib.request.urlopen(req, timeout=5)


def _sse_collector(task_id: str, event_queue: Queue, stop_event: threading.Event) -> None:
    import http.client as http_client

    try:
        conn = http_client.HTTPConnection("127.0.0.1", 8000, timeout=300)
        conn.request("GET", f"/api/tasks/{task_id}/progress")
        resp = conn.getresponse()
        buf = b""
        while not stop_event.is_set():
            chunk = resp.read(1)
            if not chunk:
                break
            buf += chunk
            if b"\n\n" in buf:
                parts = buf.split(b"\n\n")
                buf = parts.pop()
                for part in parts:
                    part = part.strip()
                    if part.startswith(b"data: "):
                        try:
                            event_queue.put(json.loads(part[6:]))
                        except json.JSONDecodeError:
                            pass
    except Exception as e:
        event_queue.put({"error": str(e)})


def test(options_only: bool = False, translator: str = "original",
         image: Optional[str] = None, keep: bool = False,
         target_lang: str = "CHS"):
    # ── 1. options ──
    try:
        opts = api_options()
        print(f"[1/5] GET /api/options → {len(opts['translators'])} translators, {len(opts['languages'])} langs")
    except Exception as e:
        print(f"[1/5] FAIL: {e}"); return

    if options_only:
        return

    # ── 2. glossaries ──
    try:
        with urllib.request.urlopen(f"{BASE}/api/glossaries", timeout=5) as r:
            gl = json.loads(r.read().decode())
        print(f"[2/5] GET /api/glossaries → {len(gl)} glossaries")
    except Exception as e:
        print(f"[2/5] FAIL: {e}"); return

    # ── 3. upload ──
    img = image or "./tmp/test-manga.jpg"
    config = {
        "target_lang": target_lang, "translator": translator, "polish": False,
        "detector": "ctd", "ocr": "ocr32px", "inpainter": "lama_mpe",
        "render_translated_text": True, "detection_size": 1024,
    }
    try:
        task_id = api_upload(img, config)
        print(f"[3/5] POST /api/tasks → {task_id}")
    except Exception as e:
        print(f"[3/5] FAIL: {e}"); return

    # ── 4. SSE progress ──
    event_queue: Queue = Queue()
    stop_event = threading.Event()
    t = threading.Thread(target=_sse_collector, args=(task_id, event_queue, stop_event), daemon=True)
    t.start()
    time.sleep(0.5)  # let SSE connection establish

    events: list[dict] = []
    last_pct = -1
    print("[4/5] SSE progress:")

    while True:
        try:
            data = api_task(task_id)
            status = data["status"]
        except Exception as e:
            status = f"ERR:{e}"

        while True:
            try:
                ev = event_queue.get_nowait()
                events.append(ev)
                pct = ev.get("progress_pct", 0)
                if pct != last_pct:
                    print(f"   SSE {pct:3d}%  {ev.get('message_cn','')}")
                    last_pct = pct
                if ev.get("done"):
                    stop_event.set()
                    break
            except Empty:
                break

        if status in ("done", "failed"):
            break
        time.sleep(0.5)

    t.join(timeout=5)
    print(f"   SSE events: {len(events)}")

    # ── 5. result ──
    try:
        task = api_task(task_id)
        page = task["pages"][0]
        blocks = page["text_blocks"]
        print(f"[5/5] status={task['status']}, blocks={len(blocks)}")
        for b in blocks[:5]:
            print(f"   [{b['original_text']}] → [{b['translated_text']}]")
        if Path(page["result_path"]).exists():
            sz = Path(page["result_path"]).stat().st_size
            print(f"   result: {page['result_path']} ({sz//1024}KB)")
    except Exception as e:
        print(f"[5/5] FAIL: {e}")

    if not keep:
        api_delete(task_id)
        print("   task deleted")
    else:
        print(f"   task kept (id={task_id})")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="API e2e test")
    p.add_argument("--options-only", action="store_true")
    p.add_argument("--translator", default="original")
    p.add_argument("--target-lang", default="CHS", help="Target language code (CHS/ENG/JPN/KOR...)")
    p.add_argument("--image")
    p.add_argument("--keep", action="store_true")
    args = p.parse_args()
    test(options_only=args.options_only, translator=args.translator,
         image=args.image, keep=args.keep, target_lang=args.target_lang)
