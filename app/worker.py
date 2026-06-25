from __future__ import annotations

import asyncio
import concurrent.futures
import logging
import pickle
from pathlib import Path
from queue import Queue
from typing import Optional

import numpy as np
from PIL import Image

from app.models import Page, ProgressEvent, Task, TaskStatus, TextBlockResult
from app.pipeline import render_pipeline, run_pipeline, warmup
from config.settings import settings
logger = logging.getLogger("worker")


class TaskCancelled(Exception):
    """Raised inside a worker thread when the task has been cancelled."""

_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=1)

task_store: dict[str, Task] = {}
progress_queues: dict[str, Queue] = {}
last_progress: dict[str, "ProgressEvent"] = {}
_cancelled: set[str] = set()  # task IDs marked for cancellation
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
    "awaiting-edit": (82, "等待编辑", TaskStatus.awaiting_edit),
    "rendering": (95, "渲染文字", TaskStatus.rendering),
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
    result_dir = settings.result_dir / task.id
    for page in task.pages:
        Path(page.upload_path).unlink(missing_ok=True)
        if page.result_path:
            Path(page.result_path).unlink(missing_ok=True)
        if page.inpainted_path:
            Path(page.inpainted_path).unlink(missing_ok=True)
    # Clean up interactive-edit ctx pickles
    if result_dir.exists():
        for ctx_file in result_dir.glob("*_ctx.pkl"):
            ctx_file.unlink(missing_ok=True)
    for subdir in (settings.upload_dir / task.id, result_dir):
        try:
            subdir.rmdir()
        except OSError:
            pass

def _make_inline_hook(task_id: str):
    """Return a coroutine function for progress. Callable from any thread's event loop."""

    async def hook(state: str, finished: bool) -> None:
        if task_id in _cancelled:
            raise TaskCancelled(task_id)
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

    When task.config.interactive_edit is True, stops after inpainting for each
    page, persists the ctx (pickle) so translations can be edited later, and
    sets the task to awaiting_edit. The caller (API) can then invoke
    render_edited_task() to finish rendering with the user's edited text.
    """
    def _persist(status: TaskStatus) -> None:
        task.status = status
        task_store[task.id] = task
        save_task(task)

    try:
        _persist(TaskStatus.detecting)
        result_dir = settings.result_dir / task.id
        result_dir.mkdir(parents=True, exist_ok=True)

        interactive = task.config.interactive_edit

        for page_idx, page in enumerate(task.pages):
            image = Image.open(page.upload_path).convert("RGB")

            async def _run() -> None:
                return await run_pipeline(
                    image=image,
                    task_cfg=task.config,
                    on_progress=_make_inline_hook(task.id),
                    stop_before_render=interactive,
                )

            ctx = asyncio.run(_run())

            inpainted_path = result_dir / f"page_{page_idx:04d}_inpainted.png"
            result_path = result_dir / f"page_{page_idx:04d}_result.png"

            # Save inpainted (text-erased only, before rendering wrote text on it)
            inpainted_data = ctx.get("img_inpainted_pre_render")
            if inpainted_data is None:
                inpainted_data = ctx.get("img_inpainted")
            if inpainted_data is not None:
                Image.fromarray(inpainted_data).save(inpainted_path)

            page.inpainted_path = str(inpainted_path) if inpainted_path.exists() else ""
            page.text_blocks = _extract_text_blocks(ctx.get("text_regions") or [])

            if interactive:
                # Persist ctx for later rendering; save inpainted as placeholder result
                ctx_path = result_dir / f"page_{page_idx:04d}_ctx.pkl"
                with open(ctx_path, "wb") as f:
                    pickle.dump(ctx, f)
                # Use inpainted image as temporary result so the user can preview
                if inpainted_data is not None:
                    Image.fromarray(inpainted_data).save(result_path, format="PNG")
                else:
                    image.save(result_path, format="PNG")
                page.result_path = str(result_path)
            else:
                # Normal flow: save final rendered result
                if ctx.get("result") is not None:
                    ctx["result"].save(result_path, format="PNG")
                elif inpainted_data is not None:
                    Image.fromarray(inpainted_data).save(result_path, format="PNG")
                else:
                    image.save(result_path, format="PNG")
                page.result_path = str(result_path)

            task.pages[page_idx] = page
            _persist(task.status)

        if interactive:
            _persist(TaskStatus.awaiting_edit)
            # Send a terminal event for the await phase so SSE consumers
            # know the task is now waiting for user input.
            q = progress_queues.get(task.id)
            if q is not None:
                ev = ProgressEvent(
                    state=TaskStatus.awaiting_edit.value,
                    progress_pct=82,
                    message_cn="等待编辑翻译",
                    done=True,
                )
                last_progress[task.id] = ev
                q.put_nowait(ev)
        else:
            _persist(TaskStatus.done)
    except TaskCancelled:
        logger.info("Task %s cancelled", task.id)
        task.error = "任务已取消"
        _persist(TaskStatus.cancelled)
    except Exception as exc:
        logger.exception("Task %s failed", task.id)
        task.error = str(exc)
        _persist(TaskStatus.failed)
    finally:
        _cancelled.discard(task.id)
        if task.status not in (TaskStatus.awaiting_edit,):
            q = progress_queues.get(task.id)
            if q is not None:
                ev = ProgressEvent(
                    state=task.status.value,
                    progress_pct=100 if task.status == TaskStatus.done else 0,
                    message_cn=("完成" if task.status == TaskStatus.done
                                else "已取消" if task.status == TaskStatus.cancelled
                                else f"失败：{task.error}"),
                    done=True,
                )
                last_progress[task.id] = ev
                q.put_nowait(ev)


def render_edited_task(task: Task, edited_texts: dict[int, list[str]]) -> None:
    """Render translations onto inpainted images after user editing.

    Called from a worker thread. *edited_texts* maps page index to a list of
    edited translation strings (one per text block, in order).
    """
    def _persist(status: TaskStatus) -> None:
        task.status = status
        task_store[task.id] = task
        save_task(task)

    try:
        _persist(TaskStatus.rendering)
        result_dir = settings.result_dir / task.id

        for page_idx, page in enumerate(task.pages):
            ctx_path = result_dir / f"page_{page_idx:04d}_ctx.pkl"
            if not ctx_path.exists():
                raise FileNotFoundError(f"Context file not found: {ctx_path}")

            with open(ctx_path, "rb") as f:
                ctx = pickle.load(f)

            # Apply edited translations back to text_regions
            text_regions = ctx.get("text_regions") or []
            edits = edited_texts.get(page_idx, [])
            for i, region in enumerate(text_regions):
                if i < len(edits) and edits[i]:
                    region.translation = edits[i]
                # Update text_blocks model too
                if i < len(page.text_blocks):
                    page.text_blocks[i].polished_text = getattr(region, "translation", "") or ""

            async def _render() -> None:
                return await render_pipeline(ctx, task.config)

            ctx = asyncio.run(_render())

            result_path = result_dir / f"page_{page_idx:04d}_result.png"
            if ctx.get("result") is not None:
                ctx["result"].save(result_path, format="PNG")
            page.result_path = str(result_path)

            # Clean up pickle
            ctx_path.unlink(missing_ok=True)

            task.pages[page_idx] = page
            _persist(task.status)

        _persist(TaskStatus.done)
    except Exception as exc:
        logger.exception("Task %s render failed", task.id)
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


def cancel_task(task_id: str) -> bool:
    """Mark a running task for cancellation. Returns True if the task was
    running and will be cancelled, False if it's not running."""
    task = task_store.get(task_id)
    if task is None:
        return False
    if task.is_terminal() or task.status == TaskStatus.awaiting_edit:
        return False
    _cancelled.add(task_id)
    return True


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
