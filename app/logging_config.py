"""Centralized logging configuration with file rotation.

Logs are written to storage/logs/ with daily rotation. Old logs beyond
the retention period are cleaned up on startup.
"""
from __future__ import annotations

import logging
import logging.handlers
from datetime import datetime, timedelta
from pathlib import Path

from config.settings import settings

_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


def setup_logging() -> None:
    """Configure root logger with console + rotating file handlers."""
    log_dir = settings.log_dir
    log_dir.mkdir(parents=True, exist_ok=True)

    # Main log file — rotates daily, keeps N days
    file_handler = logging.handlers.TimedRotatingFileHandler(
        filename=log_dir / "app.log",
        when="midnight",
        interval=1,
        backupCount=settings.log_retention_days,
        encoding="utf-8",
        utc=False,
    )
    file_handler.suffix = "%Y-%m-%d"
    file_handler.setFormatter(logging.Formatter(_FORMAT, _DATE_FORMAT))

    # Console handler for uvicorn/dev
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(logging.Formatter(_FORMAT, _DATE_FORMAT))

    # Apply to root logger
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    # Remove existing handlers to avoid duplicate output
    root.handlers.clear()
    root.addHandler(file_handler)
    root.addHandler(console_handler)

    # Reduce noise from libraries
    for name in ("urllib3", "httpx", "httpcore", "openai", "matplotlib",
                  "uvicorn.access", "asyncio"):
        logging.getLogger(name).setLevel(logging.WARNING)

    # OCR prints one line per text block (prob, fg/bg colors) — too verbose
    logging.getLogger("manga-translator.Model48pxOCR").setLevel(logging.WARNING)
    logging.getLogger("manga-translator.Model32pxOCR").setLevel(logging.WARNING)
    logging.getLogger("manga-translator.MangaOCR").setLevel(logging.WARNING)

    # manga_translator library — keep stage progress but suppress per-block detail
    logging.getLogger("manga_translator").setLevel(logging.INFO)
    logging.getLogger("manga-translator").setLevel(logging.INFO)

def cleanup_old_logs() -> None:
    """Remove log files older than the retention period."""
    log_dir = settings.log_dir
    if not log_dir.exists():
        return
    cutoff = datetime.now() - timedelta(days=settings.log_retention_days)
    for f in log_dir.glob("app.log*"):
        try:
            mtime = datetime.fromtimestamp(f.stat().st_mtime)
            if mtime < cutoff:
                f.unlink()
        except Exception:
            pass


def list_log_files() -> list[dict]:
    """Return list of log files with metadata, newest first."""
    log_dir = settings.log_dir
    if not log_dir.exists():
        return []
    files = []
    for f in sorted(log_dir.glob("app.log*"), key=lambda x: x.stat().st_mtime, reverse=True):
        stat = f.stat()
        files.append({
            "name": f.name,
            "size": stat.st_size,
            "size_human": _human_size(stat.st_size),
            "modified": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
        })
    return files


def read_log_file(name: str, tail: int = 500) -> str:
    """Read the last *tail* lines of a log file. Returns empty string on error."""
    log_dir = settings.log_dir
    path = log_dir / name
    # Prevent path traversal
    if not path.resolve().parent.samefile(log_dir.resolve()):
        return ""
    if not path.exists() or not path.is_file():
        return ""
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        if tail > 0 and len(lines) > tail:
            lines = lines[-tail:]
        return "\n".join(lines)
    except Exception:
        return ""


def delete_log_file(name: str) -> bool:
    """Delete a specific log file. Returns True if deleted."""
    log_dir = settings.log_dir
    path = log_dir / name
    if not path.resolve().parent.samefile(log_dir.resolve()):
        return False
    if not path.exists():
        return False
    try:
        path.unlink()
        return True
    except Exception:
        return False


def _human_size(size: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024:
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"
