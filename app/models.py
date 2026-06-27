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
    awaiting_edit = "awaiting_edit"
    done = "done"
    failed = "failed"
    cancelled = "cancelled"

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
    context_size: int = 2
    font_size_offset: int = 0
    font_size_minimum: int = 10
    line_spacing: Optional[int] = None
    disable_font_border: bool = False
    mask_dilation_offset: int = 20
    mask_kernel_size: int = 3
    inpainting_size: int = 2048
    interactive_edit: bool = False
    font_path: str = ""  # Custom font path for rendering

class TextBlockResult(BaseModel):
    xyxy: list[int] = Field(default_factory=lambda: [0, 0, 0, 0], min_length=4, max_length=4)
    original_text: str = ""
    translated_text: str = ""
    polished_text: str = ""
    # Center coordinates for position adjustment in interactive edit
    center: list[float] = Field(default_factory=lambda: [0.0, 0.0], min_length=2, max_length=2)
    # Original bounding box size (width, height) for display
    size: list[float] = Field(default_factory=lambda: [0.0, 0.0], min_length=2, max_length=2)
    # Font size (OCR-detected, before shrink-to-fit) for preview rendering
    font_size: int = 0
    # Text foreground and background colors [r, g, b] for preview rendering
    fg_color: list[int] = Field(default_factory=lambda: [0, 0, 0], min_length=3, max_length=3)
    bg_color: list[int] = Field(default_factory=lambda: [255, 255, 255], min_length=3, max_length=3)
    # Whether text is horizontal or vertical
    horizontal: bool = True

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
        return self.status in (TaskStatus.done, TaskStatus.failed, TaskStatus.cancelled)


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
    page_count: int = 1


class ConfigField(BaseModel):
    env_var: str
    label: str
    field_type: str = "text"  # text, password
    required: bool = True
    value: str = ""  # masked value from env


class TranslatorConfigItem(BaseModel):
    translator: str
    display_name: str = ""
    fields: list[ConfigField] = []
    configured: bool = False

class HealthResponse(BaseModel):
    status: str = "ok"
    gpu: bool = False
    version: str = "0.1.0"


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
    configured: bool = True
    supported_langs: list[str] | None = None  # None = all languages supported

class OptionsResponse(BaseModel):
    languages: list[OptionItem]
    translators: list[TranslatorOption]
    detectors: list[OptionItem]
    ocr: list[OptionItem]
    inpainters: list[OptionItem]
