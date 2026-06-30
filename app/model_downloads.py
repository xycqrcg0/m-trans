"""Background model download manager.

Wraps :class:`manga_translator.utils.inference.ModelWrapper` downloads with
in-process progress tracking so the frontend can show per-model status and
download progress over SSE without monkey-patching the library's tqdm output.

Design notes
------------
- Each model class is instantiated lazily; ``ModelWrapper()`` only sets up
  ``_MODEL_DIR``/``_MODEL_MAPPING`` and checks the filesystem — it does NOT
  load weights or touch torch until ``download()``/``load()`` is called.
- Downloads run in a dedicated single-thread executor so they never block the
  FastAPI event loop and never run two downloads for the same model at once.
- Progress is estimated by scanning ``model_dir`` for the largest expected
  output file (or its ``.part`` companion) and comparing to the total size
  reported by a HEAD request against the model's URL. This is intentionally
  coarse: it avoids coupling to tqdm internals while still giving useful UI
  feedback (0% → 100%).
"""
from __future__ import annotations

import asyncio
import concurrent.futures
import logging
import os
from dataclasses import dataclass, field
from typing import Optional

import requests

logger = logging.getLogger("models_dl")

# Single-thread executor: downloads are sequential to avoid hammering GitHub
# releases and to keep model files consistent (some share URLs).
_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="model-dl")


@dataclass
class DownloadState:
    category: str
    id: str
    display_name: str
    status: str = "idle"  # idle | queued | downloading | done | error
    progress: float = 0.0  # 0..1
    error: str = ""
    # internal bookkeeping
    _future: Optional[concurrent.futures.Future] = field(default=None, repr=False)
    _loop: Optional[asyncio.AbstractEventLoop] = field(default=None, repr=False)
    # cached total bytes (from HEAD) for progress estimation
    _total_bytes: int = 0
    # resolved model_dir to scan for partial files
    _watch_dir: str = ""
    _watch_files: list[str] = field(default_factory=list, repr=False)
    # download destination shown to the user (absolute model_dir)
    path: str = ""

    def to_dict(self) -> dict:
        return {
            "category": self.category,
            "id": self.id,
            "display_name": self.display_name,
            "status": self.status,
            "progress": round(self.progress, 4),
            "error": self.error,
            "path": self.path,
        }


# (category, key_class, display_name)
# Kept consistent with the list in get_model_status().
_DOWNLOAD_CATALOG: list[tuple[str, str, str]] = [
    ("detector", "default", "默认检测器 (DBNet)"),
    ("detector", "ctd", "Comic Text Detector"),
    ("ocr", "48px", "OCR 48px"),
    ("ocr", "32px", "OCR 32px"),
    ("ocr", "mocr", "mOCR (manga-ocr)"),
    ("inpainter", "default", "AOT 修复器"),
    ("inpainter", "lama_large", "LaMa Large"),
    ("inpainter", "lama_mpe", "LaMa MPE"),
    ("inpainter", "sd", "Stable Diffusion"),
    ("inpainter", "none", "无修复（占位）"),
    ("inpainter", "original", "原图保留（占位）"),
]

_states: dict[str, DownloadState] = {}
_states_lock = asyncio.Lock()


def _state_key(category: str, model_id: str) -> str:
    return f"{category}/{model_id}"


async def get_or_create_states() -> dict[str, DownloadState]:
    async with _states_lock:
        if not _states:
            for cat, mid, name in _DOWNLOAD_CATALOG:
                k = _state_key(cat, mid)
                _states[k] = DownloadState(category=cat, id=mid, display_name=name)
                # initialise from disk
                await _refresh_disk_status(_states[k])
        return _states


def _resolve_model_obj(category: str, model_id: str):
    """Instantiate the model wrapper class for ``model_id``. Returns the
    instance (a ``ModelWrapper``) or ``None`` if there's nothing to download
    (e.g. ``none``/``original`` placeholders)."""
    from manga_translator.detection import DETECTORS
    from manga_translator.ocr import OCRS
    from manga_translator.inpainting import INPAINTERS
    from manga_translator.config import Detector, Ocr, Inpainter
    from manga_translator.utils.inference import ModelWrapper

    try:
        if category == "detector":
            key = next((d for d in Detector if d.value == model_id), None)
            cls = DETECTORS.get(key) if key else None
        elif category == "ocr":
            key = next((d for d in Ocr if d.value == model_id), None)
            cls = OCRS.get(key) if key else None
        elif category == "inpainter":
            key = next((d for d in Inpainter if d.value == model_id), None)
            cls = INPAINTERS.get(key) if key else None
        else:
            return None
    except Exception as e:
        logger.warning("resolve %s/%s failed: %s", category, model_id, e)
        return None
    if cls is None:
        return None
    # Redirect model storage to the writable data dir (frozen-aware).
    try:
        from config.settings import settings as _s
        ModelWrapper._MODEL_DIR = str(_s.model_dir)
        _s.model_dir.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    try:
        obj = cls()
    except Exception as e:
        logger.warning("instantiate %s/%s failed: %s", category, model_id, e)
        return None
    return obj if isinstance(obj, ModelWrapper) else None


async def _refresh_disk_status(state: DownloadState) -> None:
    """Mark ``done`` if files already present on disk. Called on first load."""
    obj = await asyncio.get_event_loop().run_in_executor(_EXECUTOR, _resolve_model_obj, state.category, state.id)
    if obj is None:
        state.status = "done"  # placeholder (e.g. inpainter=none)
        return
    state.path = obj.model_dir
    if obj.is_downloaded():
        state.status = "done"
        state.progress = 1.0


def _head_total_bytes(url: str) -> int:
    try:
        r = requests.head(url, allow_redirects=True, timeout=15)
        if r.ok:
            cl = r.headers.get("content-length")
            if cl:
                return int(cl)
    except Exception as e:
        logger.debug("HEAD %s failed: %s", url, e)
    return 0

def _prepare_watch(state: DownloadState, obj) -> None:
    """Record the model_dir and the set of expected output files so the
    progress poller can find ``.part`` files quickly."""
    state._watch_dir = obj.model_dir
    state.path = obj.model_dir
    files: list[str] = []
    totals = 0
    for map_key, mapping in obj._MODEL_MAPPING.items():
        url = mapping.get("url", "")
        total = _head_total_bytes(url)
        state._total_bytes += total
        if "file" in mapping:
            f = mapping["file"]
            if os.path.basename(f) in (".", ""):
                f = os.path.join(f, os.path.basename(url) or map_key)
            files.append(os.path.join(state._watch_dir, f))
            files.append(os.path.join(state._watch_dir, f + ".part"))
        elif "archive" in mapping:
            # archive download lives in a temp dir; we can't easily watch it,
            # so fall back to the final extracted files presence check only.
            for _orig, dest in mapping["archive"].items():
                d = dest
                if os.path.basename(d) in (".", ""):
                    d = os.path.join(d, os.path.basename(_orig.rstrip("/")))
                files.append(os.path.join(state._watch_dir, d))
    state._watch_files = files


def _run_download(category: str, model_id: str) -> None:
    """Blocking download executed in the executor thread."""
    import asyncio as _aio
    obj = _resolve_model_obj(category, model_id)
    if obj is None:
        return
    state = _states.get(_state_key(category, model_id))
    if state is None:
        return
    _prepare_watch(state, obj)
    loop = state._loop

    def _update(status: str, progress: float, err: str = ""):
        state.status = status
        state.progress = progress
        state.error = err

    try:
        _update("downloading", 0.0)
        # ModelWrapper.download is async; run it in a private event loop in
        # this worker thread so it doesn't collide with the app's loop.
        _aio.run(obj.download(force=False))
        _update("done", 1.0)
    except Exception as e:
        logger.exception("download %s/%s failed", category, model_id)
        _update("error", state.progress, str(e)[:300])
    finally:
        if loop is not None:
            # wake any SSE pollers
            pass


def _estimate_progress(state: DownloadState) -> float:
    """Estimate download progress in [0, 1] by scanning for ``.part``/final
    files vs the HEAD-reported total. Returns the stored progress if no
    partial files are found yet (download may be between steps)."""
    if state._total_bytes <= 0 or not state._watch_files:
        return state.progress
    have = 0
    for f in state._watch_files:
        if f.endswith(".part") and os.path.isfile(f):
            have += os.path.getsize(f)
            break
    else:
        # no .part — either not started or already extracted; keep stored
        return state.progress
    return min(0.99, have / state._total_bytes) if state._total_bytes else state.progress


async def start_download(category: str, model_id: str) -> dict:
    states = await get_or_create_states()
    key = _state_key(category, model_id)
    state = states.get(key)
    if state is None:
        return {"ok": False, "error": "unknown model"}
    if state.status in ("downloading", "queued"):
        return {"ok": True, "status": state.status, "message": "already running"}
    obj = await asyncio.get_event_loop().run_in_executor(_EXECUTOR, _resolve_model_obj, category, model_id)
    if obj is None:
        state.status = "done"
        state.progress = 1.0
        return {"ok": True, "status": "done", "message": "nothing to download"}
    if obj.is_downloaded():
        state.status = "done"
        state.progress = 1.0
        return {"ok": True, "status": "done", "message": "already downloaded"}
    state.status = "queued"
    state.progress = 0.0
    state.error = ""
    state._loop = asyncio.get_event_loop()
    state._future = _EXECUTOR.submit(_run_download, category, model_id)
    return {"ok": True, "status": "queued"}


async def list_states() -> list[dict]:
    states = await get_or_create_states()
    out = []
    for state in states.values():
        if state.status == "downloading":
            state.progress = _estimate_progress(state)
        out.append(state.to_dict())
    return out


async def cancel_download(category: str, model_id: str) -> dict:
    """Best-effort cancel. ThreadPoolExecutor doesn't support killing a running
    future, so we mark the state cancelled; the actual download thread will
    finish on its own. The partially-downloaded ``.part`` file can be reused
    on the next attempt (Range header support)."""
    key = _state_key(category, model_id)
    state = _states.get(key)
    if state is None:
        return {"ok": False, "error": "unknown model"}
    if state.status not in ("downloading", "queued"):
        return {"ok": True, "status": state.status, "message": "not running"}
    state.status = "cancelled"
    state.error = "cancelled by user"
    if state._future is not None and not state._future.done():
        state._future.cancel()
    return {"ok": True, "status": "cancelled"}
