from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse

from app import worker
from app.models import (
    CreateTaskResponse,
    Glossary,
    GlossaryEntry,
    GlossaryMeta,
    OptionItem,
    OptionsResponse,
    Page,
    Task,
    TaskConfig,
    TaskStatus,
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


@app.post("/api/tasks", response_model=CreateTaskResponse, summary="创建翻译任务")
async def create_task(
    image: UploadFile = File(..., description="漫画图片（JPG/PNG/WebP）"),
    config: str = Form(default="{}", description="TaskConfig JSON 字符串"),
):
    content_type = image.content_type or ""
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="仅支持图片文件")

    try:
        cfg = TaskConfig.model_validate(json.loads(config))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"config 解析失败：{exc}")

    task = Task(config=cfg)
    upload_dir = settings.upload_dir / task.id
    upload_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(image.filename or "image.jpg").suffix or ".jpg"
    upload_path = upload_dir / f"original{suffix}"

    content = await image.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="图片大小不得超过 20 MB")
    upload_path.write_bytes(content)

    task.pages = [Page(filename=image.filename or upload_path.name, upload_path=str(upload_path))]
    await worker.enqueue_task(task)
    return CreateTaskResponse(task_id=task.id)


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
    if not q:
        raise HTTPException(status_code=404, detail="进度队列不存在")

    async def _event_stream():
        loop = asyncio.get_running_loop()
        while True:
            event = await loop.run_in_executor(None, q.get)
            yield f"data: {event.model_dump_json()}\n\n"
            if event.done:
                break


@app.get("/api/tasks/{task_id}/result", summary="下载结果图 PNG")
async def get_result(task_id: str):
    task = worker.task_store.get(task_id) or worker.load_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.status != TaskStatus.done:
        raise HTTPException(status_code=202, detail=f"任务尚未完成，当前状态：{task.status.value}")
    if not task.pages or not task.pages[0].result_path:
        raise HTTPException(status_code=404, detail="结果文件不存在")

    result_path = Path(task.pages[0].result_path)
    if not result_path.exists():
        raise HTTPException(status_code=404, detail="结果文件已被删除")
    return FileResponse(path=str(result_path), media_type="image/png", filename=f"translated_{task_id}.png")


@app.delete("/api/tasks/{task_id}", summary="删除任务")
async def delete_task(task_id: str):
    task = worker.task_store.pop(task_id, None) or worker.load_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    worker.progress_queues.pop(task_id, None)
    worker.delete_task_files(task)
    return {"deleted": task_id}


@app.get("/api/options", response_model=OptionsResponse, summary="获取配置选项")
async def get_options():
    def item_list(values: dict[str, str]) -> list[OptionItem]:
        return [OptionItem(id=k, name=v) for k, v in values.items()]

    translators = [
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
