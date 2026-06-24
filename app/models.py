from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class TaskStatus(str, Enum):
    pending = "pending"
    detecting = "detecting"
    ocr = "ocr"
    translating = "translating"
    polishing = "polishing"
    inpainting = "inpainting"
    rendering = "rendering"
    done = "done"
    failed = "failed"


class TaskConfig(BaseModel):
    target_lang: str = "CHS"
    translator: str = "youdao"
    polish: bool = False
    glossary_id: Optional[str] = None
    detector: str = "default"
    ocr: str = "ocr48px"
    inpainter: str = "lama_large"
    render_translated_text: bool = True
    detection_size: int = 2048
    context_size: int = 0


class TextBlockResult(BaseModel):
    xyxy: list[int] = Field(default_factory=lambda: [0, 0, 0, 0], min_length=4, max_length=4)
    original_text: str = ""
    translated_text: str = ""
    polished_text: str = ""


class Page(BaseModel):
    filename: str
    upload_path: str
    result_path: str = ""
    inpainted_path: str = ""
    text_blocks: list[TextBlockResult] = Field(default_factory=list)


class Task(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    status: TaskStatus = TaskStatus.pending
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    config: TaskConfig = Field(default_factory=TaskConfig)
    pages: list[Page] = Field(default_factory=list)
    error: Optional[str] = None

    def is_terminal(self) -> bool:
        return self.status in (TaskStatus.done, TaskStatus.failed)


class GlossaryEntry(BaseModel):
    source: str
    target: str
    note: str = ""


class GlossaryMeta(BaseModel):
    id: str
    name: str
    created_at: datetime
    entry_count: int = 0


class Glossary(GlossaryMeta):
    entries: list[GlossaryEntry] = Field(default_factory=list)


class CreateTaskResponse(BaseModel):
    task_id: str


class ProgressEvent(BaseModel):
    state: str
    progress_pct: int
    message_cn: str
    done: bool = False


class OptionItem(BaseModel):
    id: str
    name: str


class TranslatorOption(OptionItem):
    requires_key: bool = True


class OptionsResponse(BaseModel):
    languages: list[OptionItem]
    translators: list[TranslatorOption]
    detectors: list[OptionItem]
    ocr: list[OptionItem]
    inpainters: list[OptionItem]
