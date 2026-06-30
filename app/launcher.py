"""Desktop launcher: boot the FastAPI backend in a background thread, open a
native window, and shut down when the window closes.

Designed to be the PyInstaller entry point (``pyinstaller ... launcher.py``).
When frozen, ``config.settings`` anchors writable data (storage, models,
fonts, glossaries) next to the executable automatically via ``sys.frozen``.

Architecture
------------
Runs uvicorn **in-process in a daemon thread** (no re-exec of the frozen exe).
The GUI thread owns the window; the uvicorn thread serves HTTP. When the
window closes, the daemon thread dies with the process.

Runtime deps:
    - pywebview (system WebView2 on Windows, WKWebView on macOS, GTK on Linux)
"""
from __future__ import annotations

import logging
import os
import socket
import sys
import threading
import time
from pathlib import Path

logger = logging.getLogger("launcher")


def _free_port(default: int = 8000) -> int:
    """Return ``default`` if free, else find any free port."""
    env_port = os.environ.get("M_TRANS_PORT")
    if env_port:
        try:
            return int(env_port)
        except ValueError:
            pass
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", default))
            return default
        except OSError:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]


def _port_is_open(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        try:
            s.connect((host, port))
            return True
        except OSError:
            return False


def _run_uvicorn(port: int, error: list) -> None:
    """Run uvicorn (blocking). On exception, append to ``error``."""
    try:

        import uvicorn
        # Import the app object directly — frozen builds can't resolve the
        # string "app.main:app" because the package lives inside _internal/.
        from app.main import app as _app

        uvicorn.run(
            _app,
            host="127.0.0.1",
            port=port,
            log_level="warning",
            access_log=False,
        )
    except Exception as e:
        error.append(e)
        logger.exception("Backend thread crashed")


def main() -> int:
    # Frozen GUI builds (console=False) have sys.stdout/stderr == None,
    # which crashes logging.StreamHandler / uvicorn's formatter. Redirect
    # before any logging is configured.
    if getattr(sys, "frozen", False):
        if sys.stdout is None:
            sys.stdout = open(os.devnull, "w", encoding="utf-8", errors="ignore")
        if sys.stderr is None:
            sys.stderr = open(os.devnull, "w", encoding="utf-8", errors="ignore")
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    # When frozen, anchor writable data next to the executable.
    if getattr(sys, "frozen", False):
        os.environ.setdefault(
            "M_TRANS_DATA_DIR",
            str(Path(sys.executable).resolve().parent),
        )

    port = _free_port()

    # Start uvicorn in a daemon thread.
    error: list = []
    t = threading.Thread(target=_run_uvicorn, args=(port, error), daemon=True, name="uvicorn")
    logger.info("Starting backend on port %d", port)
    t.start()

    # Wait for backend readiness, or early exit if the thread crashed.
    deadline = time.monotonic() + 90.0
    while time.monotonic() < deadline:
        if error:
            logger.error("Backend crashed: %s", error[0])
            return 1
        if _port_is_open("127.0.0.1", port):
            break
        time.sleep(0.3)
    else:
        logger.error("Backend failed to start on port %d within 90s", port)
        return 1

    if error:
        logger.error("Backend crashed: %s", error[0])
        return 1

    logger.info("Backend ready on http://127.0.0.1:%d", port)

    try:
        import webview

        url = f"http://127.0.0.1:{port}"
        logger.info("Opening window at %s", url)
        webview.create_window(
            title="MangaTrans",
            url=url,
            width=1280,
            height=860,
            min_size=(960, 640),
            text_select=True,
        )
        webview.start()
        # Window closed. Force-exit the whole process: uvicorn + the worker
        # ThreadPoolExecutors run non-daemon threads that keep the interpreter
        # alive past main() returning, leaving a zombie process on Windows.
        # os._exit skips atexit/thread-join cleanup — exactly what we want for
        # a desktop app whose window just closed.
        os._exit(0)
    except Exception as e:
        logger.exception("GUI failed: %s", e)
        os._exit(1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
