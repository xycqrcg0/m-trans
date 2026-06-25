from __future__ import annotations
import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse

from app import worker
from app.models import (
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
    set_glossary_dir(settings.glossary_dir)
    if load_glossary("default") is None:
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


@app.post("/api/tasks", response_model=CreateTaskResponse, summary="创建翻译任务（支持多图）")
async def create_task(
    images: List[UploadFile] = File(..., description="漫画图片列表（JPG/PNG/WebP）"),
    config: str = Form(default="{}", description="TaskConfig JSON 字符串"),
):
    if not images:
        raise HTTPException(status_code=400, detail="至少上传一张图片")

    try:
        cfg = TaskConfig.model_validate(json.loads(config))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"config 解析失败：{exc}")

    task = Task(config=cfg)
    upload_dir = settings.upload_dir / task.id
    upload_dir.mkdir(parents=True, exist_ok=True)

    pages: list[Page] = []
    for idx, img in enumerate(images):
        content_type = img.content_type or ""
        if not content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail=f"文件 {img.filename} 不是图片")
        content = await img.read()
        if len(content) > 20 * 1024 * 1024:
            raise HTTPException(status_code=413, detail=f"图片 {img.filename} 超过 20MB 限制")
        suffix = Path(img.filename or f"image_{idx}.jpg").suffix or ".jpg"
        upload_path = upload_dir / f"page_{idx:04d}{suffix}"
        upload_path.write_bytes(content)
        pages.append(Page(filename=img.filename or upload_path.name, upload_path=str(upload_path)))

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
    if task.status != TaskStatus.done:
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
    if task.status != TaskStatus.done:
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


@app.delete("/api/tasks/{task_id}", summary="删除任务")
async def delete_task(task_id: str):
    task = worker.task_store.pop(task_id, None) or worker.load_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    worker.progress_queues.pop(task_id, None)
    worker.last_progress.pop(task_id, None)
    worker.delete_task_files(task)
    return {"deleted": task_id}


@app.get("/api/options", response_model=OptionsResponse, summary="获取配置选项")
async def get_options():
    def item_list(values: dict[str, str]) -> list[OptionItem]:
        return [OptionItem(id=k, name=v) for k, v in values.items()]

    translators = [
        TranslatorOption(id=Translator.google.value, name="Google (web)", requires_key=False),
        TranslatorOption(id=Translator.youdao.value, name="Youdao", requires_key=True),
        TranslatorOption(id=Translator.baidu.value, name="Baidu", requires_key=True),
        TranslatorOption(id=Translator.deepl.value, name="DeepL", requires_key=True),
        TranslatorOption(id=Translator.papago.value, name="Papago", requires_key=True),
        TranslatorOption(id=Translator.none.value, name="None", requires_key=False),
        TranslatorOption(id=Translator.original.value, name="Original", requires_key=False),
        TranslatorOption(id=Translator.sakura.value, name="Sakura", requires_key=False),
        TranslatorOption(id=Translator.deepseek.value, name="DeepSeek", requires_key=True),
        TranslatorOption(id=Translator.groq.value, name="Groq", requires_key=True),
        TranslatorOption(id=Translator.gemini.value, name="Gemini", requires_key=True),
        TranslatorOption(id=Translator.custom_openai.value, name="Custom OpenAI", requires_key=True),
        TranslatorOption(id=Translator.sugoi.value, name="Sugoi", requires_key=False),
        TranslatorOption(id=Translator.jparacrawl.value, name="JParaCrawl", requires_key=False),
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

# In-memory store for translator configs (persisted to .env)
_TRANSLATOR_ENV_MAP = {
    "deepseek": ("DEEPSEEK_API_KEY", "DEEPSEEK_API_BASE", "DEEPSEEK_MODEL"),
    "chatgpt": ("OPENAI_API_KEY", "OPENAI_API_BASE", "OPENAI_MODEL"),
    "gemini": ("GEMINI_API_KEY", "", "GEMINI_MODEL"),
    "groq": ("GROQ_API_KEY", "", "GROQ_MODEL"),
    "custom_openai": ("CUSTOM_OPENAI_API_KEY", "CUSTOM_OPENAI_API_BASE", "CUSTOM_OPENAI_MODEL"),
    "youdao": ("YOUDAO_APP_KEY", "", ""),
    "baidu": ("BAIDU_APP_ID", "", ""),
    "deepl": ("DEEPL_AUTH_KEY", "", ""),
}


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
    for tid, (key_env, base_env, model_env) in _TRANSLATOR_ENV_MAP.items():
        api_key = os.environ.get(key_env, "")
        api_base = os.environ.get(base_env, "") if base_env else ""
        model = os.environ.get(model_env, "") if model_env else ""
        result.append(TranslatorConfigItem(
            translator=tid,
            api_key=api_key[:8] + "***" if len(api_key) > 8 else ("***" if api_key else ""),
            api_base=api_base,
            model=model,
            configured=bool(api_key),
        ))
    return result


@app.post("/api/config/translator", summary="保存翻译器配置")
async def save_translator_config(payload: dict):
    tid = (payload or {}).get("translator", "").strip()
    if tid not in _TRANSLATOR_ENV_MAP:
        raise HTTPException(status_code=422, detail=f"不支持的翻译器：{tid}")

    key_env, base_env, model_env = _TRANSLATOR_ENV_MAP[tid]
    env_path = settings.glossary_dir.parent / ".env"

    # Read existing .env
    env_lines: list[str] = []
    if env_path.exists():
        env_lines = env_path.read_text(encoding="utf-8").splitlines()

    def _update_env(key: str, value: str):
        nonlocal env_lines
        if not key:
            return
        found = False
        for i, line in enumerate(env_lines):
            if line.startswith(f"{key}="):
                env_lines[i] = f"{key}={value}"
                found = True
                break
        if not found:
            env_lines.append(f"{key}={value}")
        os.environ[key] = value

    api_key = payload.get("api_key", "").strip()
    api_base = payload.get("api_base", "").strip()
    model = payload.get("model", "").strip()

    if api_key:
        _update_env(key_env, api_key)
    if api_base and base_env:
        _update_env(base_env, api_base)
    if model and model_env:
        _update_env(model_env, model)

    env_path.write_text("\n".join(env_lines) + "\n", encoding="utf-8")
    return {"status": "saved", "translator": tid}