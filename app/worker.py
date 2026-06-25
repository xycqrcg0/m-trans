from __future__ import annotations

import asyncio
import concurrent.futures
import logging
from pathlib import Path
from queue import Queue
from typing import Optional

import numpy as np
from PIL import Image

from app.models import Page, ProgressEvent, Task, TaskStatus, TextBlockResult
from app.pipeline import run_pipeline, warmup
from config.settings import settings

logger = logging.getLogger("worker")

_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=1)

task_store: dict[str, Task] = {}
progress_queues: dict[str, Queue] = {}
last_progress: dict[str, "ProgressEvent"] = {}
_task_queue: Queue[Task] = Queue()
_runner_task: Optional[asyncio.Task] = None

_PROGRESS_MAP: dict[str, tuple[int, str, Optional[TaskStatus]]] = {
    "running_pre_translation_hooks": (5, "准备中", None),
    "detection": (15, "检测文字区域", TaskStatus.detecting),
    "ocr": (30, "识别文字内容", TaskStatus.ocr),
    "textline_merge": (38, "合并文本行", None),
    "translating": (50, "翻译中", TaskStatus.translating),
    "after-translating": (55, "翻译完成", None),
    "polishing": (65, "润色译文", TaskStatus.polishing),
    "mask-generation": (72, "生成文字掩码", None),
    "inpainting": (80, "修复图像", TaskStatus.inpainting),
    "rendering": (95, "渲染文字", TaskStatus.rendering),
    "finished": (100, "完成", TaskStatus.done),
}


def save_task(task: Task) -> None:
    (settings.task_dir / f"{task.id}.json").write_text(task.model_dump_json(), encoding="utf-8")


def load_task(task_id: str) -> Optional[Task]:
    path = settings.task_dir / f"{task_id}.json"
    if not path.exists():
        return None
    return Task.model_validate_json(path.read_text(encoding="utf-8"))


def load_all_tasks() -> list[Task]:
    tasks: list[Task] = []
    for p in settings.task_dir.glob("*.json"):
        try:
            tasks.append(Task.model_validate_json(p.read_text(encoding="utf-8")))
        except Exception:
            logger.warning("Failed to load task from %s", p)
    return sorted(tasks, key=lambda t: t.created_at, reverse=True)


def delete_task_files(task: Task) -> None:
    (settings.task_dir / f"{task.id}.json").unlink(missing_ok=True)
    for page in task.pages:
        Path(page.upload_path).unlink(missing_ok=True)
        if page.result_path:
            Path(page.result_path).unlink(missing_ok=True)
        if page.inpainted_path:
            Path(page.inpainted_path).unlink(missing_ok=True)
    for subdir in (settings.upload_dir / task.id, settings.result_dir / task.id):
        try:
            subdir.rmdir()
        except OSError:
            pass


def _make_inline_hook(task_id: str):
    """Return a coroutine function for progress. Callable from any thread's event loop."""

    async def hook(state: str, finished: bool) -> None:
        if state.startswith("rendering_folder:") or state.startswith("final_ready:"):
            return
        pct, msg, status = _PROGRESS_MAP.get(state, (None, None, None))
        if pct is None:
            return

        task = task_store.get(task_id)
        if task is not None and status is not None:
            task.status = status
            save_task(task)
        q = progress_queues.get(task_id)
        if q is not None:
            ev = ProgressEvent(
                state=status.value if status else state,
                progress_pct=pct,
                message_cn=msg,
                done=finished,
            )
            last_progress[task_id] = ev
            q.put_nowait(ev)

    return hook


def _extract_text_blocks(text_regions: list) -> list[TextBlockResult]:
    blocks: list[TextBlockResult] = []
    for region in text_regions:
        xyxy = [0, 0, 0, 0]
        try:
            pts = np.asarray(region.xyxy).tolist()
            if isinstance(pts, list) and len(pts) == 4:
                xyxy = [int(v) for v in pts]
        except Exception:
            pass
        translated = getattr(region, "raw_translation", None)
        if translated is None:
            # No polish ran; raw == final
            translated = getattr(region, "translation", "") or ""
        polished = getattr(region, "translation", "") or ""
        blocks.append(
            TextBlockResult(
                xyxy=xyxy,
                original_text=getattr(region, "text", "") or "",
                translated_text=translated,
                polished_text=polished,
            )
        )
    return blocks


def _execute_task_blocking(task: Task) -> None:
    """Run the full task pipeline synchronously (called from a worker thread).
    Processes all pages sequentially.
    """
    def _persist(status: TaskStatus) -> None:
        task.status = status
        task_store[task.id] = task
        save_task(task)

    try:
        _persist(TaskStatus.detecting)
        result_dir = settings.result_dir / task.id
        result_dir.mkdir(parents=True, exist_ok=True)

        for page_idx, page in enumerate(task.pages):
            image = Image.open(page.upload_path).convert("RGB")

            async def _run() -> None:
                return await run_pipeline(
                    image=image,
                    task_cfg=task.config,
                    on_progress=_make_inline_hook(task.id),
                )

            ctx = asyncio.run(_run())

            result_path = result_dir / f"page_{page_idx:04d}_result.png"
            inpainted_path = result_dir / f"page_{page_idx:04d}_inpainted.png"

            # Save inpainted (text-erased only, before rendering wrote text on it)
            inpainted_data = ctx.get("img_inpainted_pre_render")
            if inpainted_data is None:
                inpainted_data = ctx.get("img_inpainted")
            if inpainted_data is not None:
                Image.fromarray(inpainted_data).save(inpainted_path)
            # Save result (final with rendered text)
            if ctx.get("result") is not None:
                ctx["result"].save(result_path, format="PNG")
            elif inpainted_data is not None:
                Image.fromarray(inpainted_data).save(result_path, format="PNG")
            else:
                image.save(result_path, format="PNG")

            page.result_path = str(result_path)
            page.inpainted_path = str(inpainted_path) if inpainted_path.exists() else ""
            page.text_blocks = _extract_text_blocks(ctx.get("text_regions") or [])
            task.pages[page_idx] = page
            _persist(task.status)

        _persist(TaskStatus.done)
    except Exception as exc:
        logger.exception("Task %s failed", task.id)
        task.error = str(exc)
        _persist(TaskStatus.failed)
    finally:
        q = progress_queues.get(task.id)
        if q is not None:
            ev = ProgressEvent(
                state=task.status.value,
                progress_pct=100 if task.status == TaskStatus.done else 0,
                message_cn="完成" if task.status == TaskStatus.done else f"失败：{task.error}",
                done=True,
            )
            last_progress[task.id] = ev
            q.put_nowait(ev)


async def task_runner() -> None:
    """Consume tasks from the thread-safe queue and run them on a background thread."""
    loop = asyncio.get_running_loop()
    logger.info("Task runner started (thread-pool mode)")

    while True:
        task = await asyncio.to_thread(_task_queue.get)
        try:
            progress_queues[task.id] = Queue()
            await loop.run_in_executor(_EXECUTOR, _execute_task_blocking, task)
        except Exception:
            logger.exception("Unhandled error in task runner")
        finally:
            _task_queue.task_done()


async def enqueue_task(task: Task) -> None:
    task_store[task.id] = task
    save_task(task)
    _task_queue.put_nowait(task)


async def startup() -> None:
    global _runner_task
    await warmup()
    for task in load_all_tasks():
        task_store[task.id] = task
    if _runner_task is None or _runner_task.done():
        _runner_task = asyncio.create_task(task_runner())
    logger.info("Worker startup complete")
