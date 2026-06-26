from __future__ import annotations
import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List

from app.logging_config import setup_logging, cleanup_old_logs, list_log_files, read_log_file, delete_log_file

setup_logging()

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse

from app import worker
from app.models import (
    ConfigField,
    CreateTaskResponse,
    Glossary,
    GlossaryEntry,
    GlossaryMeta,
    HealthResponse,
    OptionItem,
    OptionsResponse,
    Page,
    Task,
    TaskConfig,
    TaskStatus,
    TranslatorConfigItem,
    TranslatorOption,
)
from config.settings import settings
from manga_translator.config import Detector, Inpainter, Ocr, Translator
from manga_translator.glossary import (
    create_default_glossary,
    create_glossary,
    delete_entry,
    delete_glossary,
    list_glossaries,
    load_glossary,
    set_glossary_dir,
    update_entries,
)
from manga_translator.translators.common import VALID_LANGUAGES

logger = logging.getLogger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Re-apply our logging config — uvicorn may have overridden it
    setup_logging()
    set_glossary_dir(settings.glossary_dir)
    cleanup_old_logs()
    create_default_glossary()
    await worker.startup()
    yield


app = FastAPI(title="m-trans API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


import zipfile as _zipfile

_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tiff"}
_ARCHIVE_EXTS = {".cbz", ".zip", ".7z", ".cbr", ".rar"}
_RAR_EXTS = {".cbr", ".rar"}


def _extract_images_from_archive(content: bytes, filename: str) -> list[tuple[str, bytes]]:
    """Extract image files from a comic archive.

    Supports .cbz/.zip (stdlib), .7z (py7zr), and .cbr/.rar (best-effort
    via rarfile if unrar is installed).  No hard dependency on unrar — if
    it's missing the user gets a clear message asking them to convert to
    .cbz, which works without any system tools.
    """
    ext = Path(filename).suffix.lower()
    images: list[tuple[str, bytes]] = []

    if ext in (".cbz", ".zip"):
        import io
        with _zipfile.ZipFile(io.BytesIO(content)) as zf:
            names = sorted(
                n for n in zf.namelist()
                if not n.startswith("__MACOSX") and not n.startswith(".")
                and Path(n).suffix.lower() in _IMAGE_EXTS
                and not n.endswith("/")
            )
            for name in names:
                images.append((name, zf.read(name)))

    elif ext == ".7z":
        import io as _io
        import py7zr
        with py7zr.SevenZipFile(_io.BytesIO(content), mode="r") as sz:
            for name, bio in sz.readall().items():
                if Path(name).suffix.lower() in _IMAGE_EXTS:
                    images.append((name, bio.read()))
        images.sort(key=lambda x: x[0])

    elif ext in _RAR_EXTS:
        try:
            import rarfile
            import io
            with rarfile.RarFile(io.BytesIO(content)) as rf:
                names = sorted(
                    n for n in rf.namelist()
                    if not n.startswith("__MACOSX") and not n.startswith(".")
                    and Path(n).suffix.lower() in _IMAGE_EXTS
                    and not n.endswith("/")
                )
                for name in names:
                    images.append((name, rf.read(name)))
        except ImportError:
            raise HTTPException(
                status_code=400,
                detail=".cbr/.rar 需要额外依赖。请将文件转换为 .cbz（重命名 .cbr 为 .zip 并解压后重新打包为 .cbz），或安装 unrar 命令行工具。",
            )
        except Exception:
            raise HTTPException(
                status_code=400,
                detail="无法解压 .cbr/.rar 文件。请将其转换为 .cbz 格式后重新上传。",
            )

    return images


@app.post("/api/tasks", response_model=CreateTaskResponse, summary="创建翻译任务（支持多图或漫画压缩包）")
async def create_task(
    images: List[UploadFile] = File(..., description="漫画图片或压缩包（JPG/PNG/WebP/CBZ/CBR/ZIP/RAR）"),
    config: str = Form(default="{}", description="TaskConfig JSON 字符串"),
):
    if not images:
        raise HTTPException(status_code=400, detail="至少上传一张图片或一个压缩包")

    try:
        cfg = TaskConfig.model_validate(json.loads(config))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"config 解析失败：{exc}")

    task = Task(config=cfg)
    upload_dir = settings.upload_dir / task.id
    upload_dir.mkdir(parents=True, exist_ok=True)

    pages: list[Page] = []
    page_idx = 0

    for upload in images:
        content = await upload.read()
        filename = upload.filename or f"file_{page_idx}"
        ext = Path(filename).suffix.lower()

        if ext in _ARCHIVE_EXTS:
            # Extract images from comic archive
            if len(content) > 200 * 1024 * 1024:
                raise HTTPException(status_code=413, detail=f"压缩包 {filename} 超过 200MB 限制")
            extracted = _extract_images_from_archive(content, filename)
            if not extracted:
                raise HTTPException(status_code=400, detail=f"压缩包 {filename} 中没有找到图片文件")
            for arcname, img_bytes in extracted:
                suffix = Path(arcname).suffix or ".jpg"
                upload_path = upload_dir / f"page_{page_idx:04d}{suffix}"
                upload_path.write_bytes(img_bytes)
                pages.append(Page(filename=arcname, upload_path=str(upload_path)))
                page_idx += 1
        elif ext in _IMAGE_EXTS or (upload.content_type or "").startswith("image/"):
            if len(content) > 20 * 1024 * 1024:
                raise HTTPException(status_code=413, detail=f"图片 {filename} 超过 20MB 限制")
            suffix = ext or ".jpg"
            upload_path = upload_dir / f"page_{page_idx:04d}{suffix}"
            upload_path.write_bytes(content)
            pages.append(Page(filename=filename, upload_path=str(upload_path)))
            page_idx += 1
        else:
            raise HTTPException(status_code=400, detail=f"不支持的文件类型：{filename}（支持 JPG/PNG/WebP/CBZ/CBR/ZIP/RAR）")

    if not pages:
        raise HTTPException(status_code=400, detail="没有有效的图片文件")

    task.pages = pages
    await worker.enqueue_task(task)
    return CreateTaskResponse(task_id=task.id, page_count=len(pages))


@app.get("/api/tasks", summary="任务列表")
async def list_tasks(page: int = 1, limit: int = 20):
    all_tasks = sorted(worker.task_store.values(), key=lambda t: t.created_at, reverse=True)
    start = max(0, (page - 1) * limit)
    return {
        "total": len(all_tasks),
        "page": page,
        "limit": limit,
        "items": [t.model_dump() for t in all_tasks[start : start + limit]],
    }


@app.get("/api/tasks/{task_id}", summary="任务详情")
async def get_task(task_id: str):
    task = worker.task_store.get(task_id) or worker.load_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    return task.model_dump()


@app.get("/api/tasks/{task_id}/progress", summary="SSE 实时进度")
async def task_progress(task_id: str):
    task = worker.task_store.get(task_id) or worker.load_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    if task.is_terminal():
        pct = 100 if task.status == TaskStatus.done else 0
        msg = "完成" if task.status == TaskStatus.done else f"失败：{task.error}"

        async def _done_stream():
            yield f'data: {{"state":"{task.status.value}","progress_pct":{pct},"message_cn":"{msg}","done":true}}\n\n'

        return StreamingResponse(_done_stream(), media_type="text/event-stream")

    q = worker.progress_queues.get(task_id)
    last = worker.last_progress.get(task_id)

    async def _event_stream():
        loop = asyncio.get_running_loop()
        # Replay the last known progress so reconnects don't show 0%.
        if last is not None:
            yield f"data: {last.model_dump_json()}\n\n"
            if last.done:
                return
        if q is None:
            # Task isn't terminal but has no live queue (e.g. server restarted
            # mid-flight): emit its current persisted status and stop.
            return
        while True:
            event = await loop.run_in_executor(None, q.get)
            yield f"data: {event.model_dump_json()}\n\n"
            if event.done:
                break

    return StreamingResponse(_event_stream(), media_type="text/event-stream")
@app.get("/api/tasks/{task_id}/result", summary="下载结果图 PNG（按页码）")
async def get_result(task_id: str, page: int = 1):
    task = worker.task_store.get(task_id) or worker.load_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.status not in (TaskStatus.done, TaskStatus.awaiting_edit, TaskStatus.rendering):
        raise HTTPException(status_code=202, detail=f"任务尚未完成，当前状态：{task.status.value}")
    if page < 1 or page > len(task.pages):
        raise HTTPException(status_code=404, detail=f"页码超出范围（1-{len(task.pages)}）")

    pg = task.pages[page - 1]
    if not pg.result_path:
        raise HTTPException(status_code=404, detail="结果文件不存在")
    result_path = Path(pg.result_path)
    if not result_path.exists():
        raise HTTPException(status_code=404, detail="结果文件已被删除")
    return FileResponse(path=str(result_path), media_type="image/png", filename=f"translated_{task_id}_p{page}.png")


@app.get("/api/tasks/{task_id}/inpainted", summary="下载擦字图 PNG（按页码）")
async def get_inpainted(task_id: str, page: int = 1):
    task = worker.task_store.get(task_id) or worker.load_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.status not in (TaskStatus.done, TaskStatus.awaiting_edit):
        raise HTTPException(status_code=202, detail=f"任务尚未完成，当前状态：{task.status.value}")
    if page < 1 or page > len(task.pages):
        raise HTTPException(status_code=404, detail=f"页码超出范围（1-{len(task.pages)}）")

    pg = task.pages[page - 1]
    if not pg.inpainted_path:
        raise HTTPException(status_code=404, detail="擦字图不存在")
    inpainted_path = Path(pg.inpainted_path)
    if not inpainted_path.exists():
        raise HTTPException(status_code=404, detail="擦字图已被删除")
    return FileResponse(path=str(inpainted_path), media_type="image/png", filename=f"inpainted_{task_id}_p{page}.png")


@app.get("/api/tasks/{task_id}/download", summary="打包下载全部结果图 (ZIP/CBZ)")
async def download_all_results(task_id: str, format: str = "zip"):
    """Download all result images as a ZIP or CBZ archive.
    CBZ is just a ZIP with .cbz extension — supported by all comic readers.
    """
    task = worker.task_store.get(task_id) or worker.load_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.status != TaskStatus.done:
        raise HTTPException(status_code=202, detail=f"任务尚未完成，当前状态：{task.status.value}")

    fmt = format.lower()
    if fmt not in ("zip", "cbz"):
        fmt = "zip"

    import io
    import zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as zf:
        for i, pg in enumerate(task.pages):
            if pg.result_path and Path(pg.result_path).exists():
                ext = Path(pg.result_path).suffix or ".png"
                name = pg.filename if pg.filename else f"page_{i+1:04d}"
                if not name.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                    name = name + ext
                zf.write(pg.result_path, arcname=name)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="translated_{task_id}.{fmt}"'},
    )

@app.get("/api/tasks/{task_id}/edit", summary="获取可编辑的翻译文本块")
async def get_editable_blocks(task_id: str):
    task = worker.task_store.get(task_id) or worker.load_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.status != TaskStatus.awaiting_edit:
        raise HTTPException(status_code=400, detail=f"任务不在可编辑状态（当前：{task.status.value}）")
    return {
        "task_id": task.id,
        "pages": [
            {
                "page_index": i,
                "filename": pg.filename,
                "text_blocks": [
                    {
                        "index": j,
                        "original_text": b.original_text,
                        "translated_text": b.translated_text,
                        "polished_text": b.polished_text,
                        "xyxy": b.xyxy,
                        "center": b.center,
                        "size": b.size,
                        "font_size": b.font_size,
                        "fg_color": b.fg_color,
                        "bg_color": b.bg_color,
                        "horizontal": b.horizontal,
                    }
                    for j, b in enumerate(pg.text_blocks)
                ],
            }
            for i, pg in enumerate(task.pages)
        ],
    }

@app.post("/api/tasks/{task_id}/edit", summary="提交编辑后的翻译并渲染")
async def submit_edits(task_id: str, edits: dict):
    """Submit edited translations and optional position offsets, then render.

    Request body: {
        "pages": {"0": ["text1", "text2", ...], "1": [...]},
        "offsets": {"0": [[dx,dy], [dx,dy], ...], "1": [...]}
    }
    """
    task = worker.task_store.get(task_id) or worker.load_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.status != TaskStatus.awaiting_edit:
        raise HTTPException(status_code=400, detail=f"任务不在可编辑状态（当前：{task.status.value}）")

    # Parse the pages dict into {page_index: [texts]}
    pages_data = edits.get("pages", edits)
    edited_texts: dict[int, list[str]] = {}
    for k, v in pages_data.items():
        try:
            idx = int(k)
        except (ValueError, TypeError):
            continue
        if isinstance(v, list):
            edited_texts[idx] = [str(t) if t else "" for t in v]

    # Parse optional position offsets: {page_index: [[dx, dy], ...]}
    offsets_data = edits.get("offsets", {})
    position_offsets: dict[int, list[list[int]]] = {}
    for k, v in offsets_data.items():
        try:
            idx = int(k)
        except (ValueError, TypeError):
            continue
        if isinstance(v, list):
            position_offsets[idx] = [
                [int(x) for x in (o if isinstance(o, list) else [0, 0])][:2]
                for o in v
            ]

    # Run rendering on the worker thread
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(
        worker._EXECUTOR, worker.render_edited_task,
        task, edited_texts, position_offsets,
    )
    return {"task_id": task.id, "status": task.status.value}


@app.post("/api/tasks/{task_id}/cancel", summary="终止运行中的任务")
async def cancel_task(task_id: str):
    task = worker.task_store.get(task_id) or worker.load_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.is_terminal() or task.status == TaskStatus.awaiting_edit:
        # Already done/failed/cancelled — just return current status
        return {"task_id": task_id, "status": task.status.value}
    cancelled = worker.cancel_task(task_id)
    if not cancelled:
        raise HTTPException(status_code=400, detail=f"任务无法取消（当前状态：{task.status.value}）")
    return {"task_id": task_id, "status": "cancelling"}


@app.delete("/api/tasks/{task_id}", summary="删除任务")
async def delete_task(task_id: str):
    task = worker.task_store.get(task_id) or worker.load_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    # If the task is running, mark it for cancellation first
    if not task.is_terminal() and task.status != TaskStatus.awaiting_edit:
        worker.cancel_task(task_id)
    worker.task_store.pop(task_id, None)
    worker.progress_queues.pop(task_id, None)
    worker.last_progress.pop(task_id, None)
    worker.delete_task_files(task)
    return {"deleted": task_id}


@app.get("/api/options", response_model=OptionsResponse, summary="获取配置选项")
async def get_options():
    def item_list(values: dict[str, str]) -> list[OptionItem]:
        return [OptionItem(id=k, name=v) for k, v in values.items()]

    def _is_configured(tid: str) -> bool:
        if tid in _NO_CONFIG_TRANSLATORS:
            return True
        if tid in _TRANSLATOR_ENV_MAP:
            key_env = _TRANSLATOR_ENV_MAP[tid][0]
            return bool(os.environ.get(key_env, ""))
        return True  # unknown translators default to configured

    # Translators with restricted language support
    _LANG_RESTRICTED = {
        "sugoi": ["JPN", "ENG"],
        "jparacrawl": ["JPN", "ENG"],
        "jparacrawl_big": ["JPN", "ENG"],
    }
    translators = [
        TranslatorOption(id=Translator.google.value, name="Google (web)", requires_key=False, configured=True),
        TranslatorOption(id=Translator.youdao.value, name="Youdao", requires_key=True, configured=_is_configured("youdao")),
        TranslatorOption(id=Translator.baidu.value, name="Baidu", requires_key=True, configured=_is_configured("baidu")),
        TranslatorOption(id=Translator.deepl.value, name="DeepL", requires_key=True, configured=_is_configured("deepl")),
        TranslatorOption(id=Translator.papago.value, name="Papago", requires_key=True, configured=_is_configured("papago")),
        TranslatorOption(id=Translator.caiyun.value, name="Caiyun", requires_key=True, configured=_is_configured("caiyun")),
        TranslatorOption(id=Translator.chatgpt.value, name="ChatGPT", requires_key=True, configured=_is_configured("chatgpt")),
        TranslatorOption(id=Translator.chatgpt_2stage.value, name="ChatGPT (2-stage)", requires_key=True, configured=_is_configured("chatgpt_2stage")),
        TranslatorOption(id=Translator.none.value, name="None", requires_key=False, configured=True),
        TranslatorOption(id=Translator.original.value, name="Original", requires_key=False, configured=True),
        TranslatorOption(id=Translator.sakura.value, name="Sakura", requires_key=False, configured=True),
        TranslatorOption(id=Translator.deepseek.value, name="DeepSeek", requires_key=True, configured=_is_configured("deepseek")),
        TranslatorOption(id=Translator.groq.value, name="Groq", requires_key=True, configured=_is_configured("groq")),
        TranslatorOption(id=Translator.gemini.value, name="Gemini", requires_key=True, configured=_is_configured("gemini")),
        TranslatorOption(id=Translator.gemini_2stage.value, name="Gemini (2-stage)", requires_key=True, configured=_is_configured("gemini_2stage")),
        TranslatorOption(id=Translator.custom_openai.value, name="Custom OpenAI", requires_key=True, configured=_is_configured("custom_openai")),
        TranslatorOption(id=Translator.sugoi.value, name="Sugoi", requires_key=False, configured=True, supported_langs=_LANG_RESTRICTED["sugoi"]),
        TranslatorOption(id=Translator.jparacrawl.value, name="JParaCrawl", requires_key=False, configured=True, supported_langs=_LANG_RESTRICTED["jparacrawl"]),
        TranslatorOption(id=Translator.jparacrawl_big.value, name="JParaCrawl (Big)", requires_key=False, configured=True, supported_langs=_LANG_RESTRICTED["jparacrawl_big"]),
    ]
    detectors = [
        OptionItem(id=Detector.ctd.value, name="CTD"),
        OptionItem(id=Detector.default.value, name="Default"),
    ]
    ocr = [
        OptionItem(id=Ocr.ocr32px.value, name="OCR 32px"),
        OptionItem(id=Ocr.ocr48px_ctc.value, name="OCR 48px CTC"),
        OptionItem(id=Ocr.mocr.value, name="Manga OCR"),
    ]
    inpainters = [
        OptionItem(id=Inpainter.lama_mpe.value, name="LaMa MPE"),
        OptionItem(id=Inpainter.none.value, name="None"),
    ]
    return OptionsResponse(
        languages=item_list(VALID_LANGUAGES),
        translators=translators,
        detectors=detectors,
        ocr=ocr,
        inpainters=inpainters,
    )


@app.get("/api/glossaries", response_model=list[GlossaryMeta], summary="术语库列表")
async def get_glossaries():
    items = []
    for item in list_glossaries():
        items.append(GlossaryMeta.model_validate(item))
    return items


@app.get("/api/glossaries/{glossary_id}", response_model=Glossary, summary="术语库详情")
async def get_glossary(glossary_id: str):
    glossary = load_glossary(glossary_id)
    if glossary is None:
        raise HTTPException(status_code=404, detail="术语库不存在")
    return Glossary.model_validate(glossary.to_dict())


@app.post("/api/glossaries", response_model=GlossaryMeta, summary="创建术语库")
async def create_glossary_api(payload: dict):
    name = (payload or {}).get("name", "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="name 不能为空")
    glossary = create_glossary(name)
    return GlossaryMeta.model_validate({
        "id": glossary.id,
        "name": glossary.name,
        "created_at": glossary.created_at,
        "entry_count": len(glossary.entries),
    })


@app.put("/api/glossaries/{glossary_id}", response_model=Glossary, summary="更新术语库词条")
async def update_glossary_api(glossary_id: str, payload: dict):
    entries = (payload or {}).get("entries", [])
    glossary = update_entries(glossary_id, entries)
    return Glossary.model_validate(glossary.to_dict())


@app.delete("/api/glossaries/{glossary_id}", summary="删除术语库")
async def delete_glossary_api(glossary_id: str):
    if load_glossary(glossary_id) is None:
        raise HTTPException(status_code=404, detail="术语库不存在")
    delete_glossary(glossary_id)
    return {"deleted": glossary_id}


@app.delete("/api/glossaries/{glossary_id}/entries/{source}", response_model=Glossary, summary="删除术语条目")
async def delete_glossary_entry_api(glossary_id: str, source: str):
    glossary = delete_entry(glossary_id, source)
    return Glossary.model_validate(glossary.to_dict())



# ── Translator configuration ──

# Metadata: what fields each translator needs for configuration.
# Each entry: (display_name, [(env_var, field_label, field_type, required), ...])
_TRANSLATOR_CONFIG_META: dict[str, tuple[str, list[tuple[str, str, str, bool]]]] = {
    "deepseek": ("DeepSeek", [
        ("DEEPSEEK_API_KEY", "API Key", "password", True),
        ("DEEPSEEK_API_BASE", "API Base URL", "text", False),
        ("DEEPSEEK_MODEL", "模型名称", "text", False),
    ]),
    "chatgpt": ("ChatGPT (OpenAI)", [
        ("OPENAI_API_KEY", "API Key", "password", True),
        ("OPENAI_API_BASE", "API Base URL", "text", False),
        ("OPENAI_MODEL", "模型名称", "text", False),
    ]),
    "chatgpt_2stage": ("ChatGPT 2-stage (OpenAI)", [
        ("OPENAI_API_KEY", "API Key", "password", True),
        ("OPENAI_API_BASE", "API Base URL", "text", False),
        ("OPENAI_MODEL", "模型名称", "text", False),
    ]),
    "gemini": ("Gemini", [
        ("GEMINI_API_KEY", "API Key", "password", True),
        ("GEMINI_MODEL", "模型名称", "text", False),
    ]),
    "gemini_2stage": ("Gemini 2-stage", [
        ("GEMINI_API_KEY", "API Key", "password", True),
        ("GEMINI_MODEL", "模型名称", "text", False),
    ]),
    "groq": ("Groq", [
        ("GROQ_API_KEY", "API Key", "password", True),
        ("GROQ_MODEL", "模型名称", "text", False),
    ]),
    "custom_openai": ("Custom OpenAI (Ollama etc.)", [
        ("CUSTOM_OPENAI_API_KEY", "API Key", "password", False),
        ("CUSTOM_OPENAI_API_BASE", "API Base URL", "text", True),
        ("CUSTOM_OPENAI_MODEL", "模型名称", "text", False),
    ]),
    "youdao": ("有道翻译", [
        ("YOUDAO_APP_KEY", "应用 ID", "text", True),
        ("YOUDAO_SECRET_KEY", "应用密钥", "password", True),
    ]),
    "baidu": ("百度翻译", [
        ("BAIDU_APP_ID", "APP ID", "text", True),
        ("BAIDU_SECRET_KEY", "密钥", "password", True),
    ]),
    "deepl": ("DeepL", [
        ("DEEPL_AUTH_KEY", "Auth Key", "password", True),
    ]),
    "caiyun": ("彩云小译", [
        ("CAIYUN_TOKEN", "访问令牌", "password", True),
    ]),
    "papago": ("Papago", [
        ("PAPAGO_API_KEY", "API Key", "password", True),
    ]),
    "sakura": ("Sakura (本地 LLM)", [
        ("SAKURA_API_BASE", "API Base URL", "text", False),
        ("SAKURA_VERSION", "版本（0.9 或 0.10）", "text", False),
    ]),
}

# Backwards-compatible env map (derived from metadata)
_TRANSLATOR_ENV_MAP = {
    tid: (fields[0][0],
          next((f[0] for f in fields if "BASE" in f[0] or "URL" in f[0]), ""),
          next((f[0] for f in fields if "MODEL" in f[0]), ""))
    for tid, (name, fields) in _TRANSLATOR_CONFIG_META.items()
}

# LLM polish config (supports any OpenAI-compatible API)
_POLISH_CONFIG_META = {
    "polish": ("LLM 润色（自定义）", [
        ("POLISH_API_KEY", "API Key", "password", True),
        ("POLISH_API_BASE", "API Base URL", "text", False),
        ("POLISH_MODEL", "模型名称", "text", False),
    ]),
}

_NO_CONFIG_TRANSLATORS = {"google", "none", "original", "sugoi", "jparacrawl", "jparacrawl_big"}


@app.get("/api/health", response_model=HealthResponse, summary="健康检查")
async def health_check():
    import torch
    return HealthResponse(
        status="ok",
        gpu=torch.cuda.is_available() if hasattr(torch, "cuda") else False,
        version="0.1.0",
    )


@app.get("/api/config/translator", response_model=list[TranslatorConfigItem], summary="获取翻译器配置状态")
async def get_translator_configs():
    result: list[TranslatorConfigItem] = []
    for tid, (display_name, fields_meta) in _TRANSLATOR_CONFIG_META.items():
        fields = []
        all_required_set = True
        for env_var, label, ftype, required in fields_meta:
            val = os.environ.get(env_var, "")
            if required and not val:
                all_required_set = False
            if val and ftype == "password":
                val_display = val[:4] + "***" if len(val) > 4 else ("***" if val else "")
            else:
                val_display = val
            fields.append(ConfigField(
                env_var=env_var, label=label, field_type=ftype,
                required=required, value=val_display,
            ))
        result.append(TranslatorConfigItem(
            translator=tid, display_name=display_name,
            fields=fields, configured=all_required_set,
        ))
    # Also include polish LLM config
    for tid, (display_name, fields_meta) in _POLISH_CONFIG_META.items():
        fields = []
        all_required_set = True
        for env_var, label, ftype, required in fields_meta:
            val = os.environ.get(env_var, "")
            if required and not val:
                all_required_set = False
            if val and ftype == "password":
                val_display = val[:4] + "***" if len(val) > 4 else ("***" if val else "")
            else:
                val_display = val
            fields.append(ConfigField(
                env_var=env_var, label=label, field_type=ftype,
                required=required, value=val_display,
            ))
        result.append(TranslatorConfigItem(
            translator=tid, display_name=display_name,
            fields=fields, configured=all_required_set,
        ))
    return result


@app.post("/api/config/translator", summary="保存翻译器配置")
async def save_translator_config(payload: dict):
    tid = (payload or {}).get("translator", "").strip()
    if tid not in _TRANSLATOR_CONFIG_META and tid not in _POLISH_CONFIG_META:
        raise HTTPException(status_code=422, detail=f"不支持的配置项：{tid}")

    _display_name, fields_meta = (_TRANSLATOR_CONFIG_META.get(tid) or _POLISH_CONFIG_META.get(tid))
    env_path = settings.glossary_dir.parent / ".env"
    env_lines: list[str] = []
    if env_path.exists():
        env_lines = env_path.read_text(encoding="utf-8").splitlines()

    def _update_env(key: str, value: str):
        nonlocal env_lines
        if not key:
            return
        os.environ[key] = value
        for i, line in enumerate(env_lines):
            if line.startswith(f"{key}="):
                env_lines[i] = f"{key}={value}"
                return
        env_lines.append(f"{key}={value}")

    values = (payload or {}).get("values", {})
    for env_var, _label, _ftype, _required in fields_meta:
        val = str(values.get(env_var, "")).strip()
        if val:
            _update_env(env_var, val)

    env_path.write_text("\n".join(env_lines) + "\n", encoding="utf-8")
    return {"status": "saved", "translator": tid}


@app.get("/api/models/status", summary="检查模型下载状态")
async def get_model_status():
    """Check whether OCR/detection/inpainting models are downloaded."""
    from manga_translator.detection import DETECTORS as _DETECTORS
    from manga_translator.ocr import OCRS as _OCRS
    from manga_translator.inpainting import INPAINTERS as _INPAINTERS
    from manga_translator.config import Detector as _Det, Ocr as _Ocr, Inpainter as _Inp
    from manga_translator.utils.inference import ModelWrapper

    statuses = []

    def _check(category: str, key, registry: dict) -> dict:
        cls = registry.get(key)
        if cls is None:
            return {"category": category, "id": key.value, "downloaded": True}
        try:
            obj = cls()
            if isinstance(obj, ModelWrapper):
                return {"category": category, "id": key.value, "downloaded": obj.is_downloaded()}
            return {"category": category, "id": key.value, "downloaded": True}
        except Exception as e:
            return {"category": category, "id": key.value, "downloaded": False, "error": str(e)[:200]}

    for det_key in [_Det.default, _Det.ctd]:
        statuses.append(_check("detector", det_key, _DETECTORS))
    for ocr_key in [_Ocr.ocr48px, _Ocr.ocr32px, _Ocr.mocr]:
        statuses.append(_check("ocr", ocr_key, _OCRS))
    for inp_key in [_Inp.lama_large, _Inp.lama_mpe, _Inp.none]:
        statuses.append(_check("inpainter", inp_key, _INPAINTERS))

    return {"models": statuses}

@app.get("/api/logs", summary="日志文件列表")
async def get_logs():
    return {"files": list_log_files()}


@app.get("/api/logs/{filename}", summary="读取日志内容")
async def get_log_content(filename: str, tail: int = 500):
    content = read_log_file(filename, tail)
    if content is None and not (settings.log_dir / filename).exists():
        raise HTTPException(status_code=404, detail="日志文件不存在")
    return {"filename": filename, "content": content, "tail": tail}


@app.delete("/api/logs/{filename}", summary="删除日志文件")
async def delete_log(filename: str):
    if not delete_log_file(filename):
        raise HTTPException(status_code=404, detail="日志文件不存在或无法删除")
    return {"deleted": filename}