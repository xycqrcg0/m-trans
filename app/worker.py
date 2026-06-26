from __future__ import annotations

import asyncio
import concurrent.futures
import logging
import pickle
import shutil
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
    """Delete all files associated with a task: uploads, results, task json,
    ctx pickles, and any glossary exports."""
    # Task metadata
    (settings.task_dir / f"{task.id}.json").unlink(missing_ok=True)

    # Upload and result directories (organized by task ID)
    upload_dir = settings.upload_dir / task.id
    result_dir = settings.result_dir / task.id
    for d in (upload_dir, result_dir):
        if d.exists():
            shutil.rmtree(d, ignore_errors=True)

    # Glossary export temp files
    if task.config and task.config.glossary_id:
        gpt_export = settings.glossary_dir / f"{task.config.glossary_id}_gpt.txt"
        gpt_export.unlink(missing_ok=True)


def cleanup_task_temp_files(task: Task) -> None:
    """Remove intermediate files after a task completes successfully.

    Keeps result images and inpainted previews; removes:
    - ctx pickles (only needed for interactive edit, cleaned after render)
    - glossary GPT export temp files
    """
    result_dir = settings.result_dir / task.id
    if result_dir.exists():
        for ctx_file in result_dir.glob("*_ctx.pkl"):
            ctx_file.unlink(missing_ok=True)
    if task.config and task.config.glossary_id:
        gpt_export = settings.glossary_dir / f"{task.config.glossary_id}_gpt.txt"
        gpt_export.unlink(missing_ok=True)


def cleanup_orphaned_files() -> None:
    """Remove orphaned files on startup: temp files whose tasks no longer exist.

    - Old manga_translator result/ directory (library artifact)
    - Orphaned _gpt.txt exports in glossary dir
    """
    # Clean up old manga_translator result/ directory at project root
    from config.settings import BASE_DIR
    mt_result = BASE_DIR / "result"
    if mt_result.exists():
        shutil.rmtree(mt_result, ignore_errors=True)

    # Clean up orphaned _gpt.txt exports (shouldn't persist between runs)
    for f in settings.glossary_dir.glob("*_gpt.txt"):
        f.unlink(missing_ok=True)

def _make_inline_hook(task_id: str, page_idx: int = 0, total_pages: int = 1):
    """Return a coroutine function for progress. Callable from any thread's event loop.

    When *total_pages* > 1, the stage percentage is mapped into the slice
    [page_idx/total, (page_idx+1)/total] so the overall progress bar reflects
    multi-page progress (e.g. "3/5 页 — 翻译中").
    """
    page_start = page_idx / total_pages * 100
    page_span = 100 / total_pages

    async def hook(state: str, finished: bool) -> None:
        if task_id in _cancelled:
            raise TaskCancelled(task_id)
        if state.startswith("rendering_folder:") or state.startswith("final_ready:"):
            return
        pct, msg, status = _PROGRESS_MAP.get(state, (None, None, None))
        if pct is None:
            return

        # Scale the stage percentage into this page's slice
        scaled_pct = int(page_start + pct * page_span / 100)
        if total_pages > 1:
            msg = f"{page_idx + 1}/{total_pages} 页 — {msg}"

        task = task_store.get(task_id)
        if task is not None and status is not None:
            task.status = status
            save_task(task)
        q = progress_queues.get(task_id)
        if q is not None:
            ev = ProgressEvent(
                state=status.value if status else state,
                progress_pct=scaled_pct,
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
        # Extract center and size for position editing
        center = [0.0, 0.0]
        size = [0.0, 0.0]
        try:
            c = np.asarray(region.center).tolist()
            if isinstance(c, list) and len(c) == 2:
                center = [float(v) for v in c]
            # unrotated_size gives (width, height)
            us = np.asarray(region.unrotated_size).tolist()
            if isinstance(us, list) and len(us) == 2:
                size = [float(v) for v in us]
        except Exception:
            pass
        translated = getattr(region, "raw_translation", None)
        if translated is None:
            translated = getattr(region, "translation", "") or ""
        polished = getattr(region, "translation", "") or ""
        blocks.append(
            TextBlockResult(
                xyxy=xyxy,
                original_text=getattr(region, "text", "") or "",
                translated_text=translated,
                polished_text=polished,
                center=center,
                size=size,
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
        total_pages = len(task.pages)

        for page_idx, page in enumerate(task.pages):
            image = Image.open(page.upload_path).convert("RGB")

            async def _run() -> None:
                return await run_pipeline(
                    image=image,
                    task_cfg=task.config,
                    on_progress=_make_inline_hook(task.id, page_idx, total_pages),
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
                page.inpainted_path = str(inpainted_path)
            else:
                page.inpainted_path = ""

            # Validate: if text was detected but all translations are empty,
            # the translation failed (e.g. API timeout). Don't mark as done.
            if not interactive and page.text_blocks:
                has_translation = any(b.polished_text or b.translated_text for b in page.text_blocks)
                if not has_translation:
                    raise RuntimeError(
                        f"第 {page_idx + 1} 页翻译失败：所有文本块译文为空（可能是 API 超时或配置错误）"
                    )

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
            cleanup_task_temp_files(task)
    except TaskCancelled:
        logger.info("Task %s cancelled", task.id)
        task.error = "任务已取消"
        _persist(TaskStatus.cancelled)
    except Exception as exc:
        logger.error("Task %s failed: %s", task.id, exc)
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


def render_edited_task(
    task: Task,
    edited_texts: dict[int, list[str]],
    position_offsets: dict[int, list[list[int]]] | None = None,
) -> None:
    """Render translations onto inpainted images after user editing.

    Called from a worker thread.
    *edited_texts* maps page index to a list of edited translation strings.
    *position_offsets* maps page index to a list of [dx, dy] pixel offsets
    per text block. None or [0, 0] means no change.
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

            # Apply edited translations and position offsets back to text_regions
            text_regions = ctx.get("text_regions") or []
            edits = edited_texts.get(page_idx, [])
            offsets = (position_offsets or {}).get(page_idx, [])
            for i, region in enumerate(text_regions):
                if i < len(edits) and edits[i]:
                    region.translation = edits[i]
                # Apply position offset by shifting lines and center
                if i < len(offsets) and len(offsets[i]) >= 2:
                    dx, dy = int(offsets[i][0]), int(offsets[i][1])
                    if dx != 0 or dy != 0:
                        region.lines = np.array(region.lines, dtype=np.int32)
                        region.lines[:, :, 0] += dx  # x coords
                        region.lines[:, :, 1] += dy  # y coords
                        region.center = np.array(region.center, dtype=np.float64)
                        region.center[0] += dx
                        region.center[1] += dy
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
        cleanup_task_temp_files(task)
    except Exception as exc:
        logger.error("Task %s render failed: %s", task.id, exc)
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
        except Exception as e:
            logger.error("Unhandled error in task runner: %s", e)
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
    cleanup_orphaned_files()
    for task in load_all_tasks():
        task_store[task.id] = task
    if _runner_task is None or _runner_task.done():
        _runner_task = asyncio.create_task(task_runner())
    logger.info("Worker startup complete")
