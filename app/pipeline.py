from __future__ import annotations

import asyncio
from typing import Awaitable, Callable, Optional

from PIL import Image

from app.models import TaskConfig
from config.settings import settings
from manga_translator import MangaTranslator, load_glossary_mapping, polish_translations, set_glossary_dir
from manga_translator.config import (
    Config,
    Detector,
    DetectorConfig,
    Inpainter,
    InpainterConfig,
    Ocr,
    OcrConfig,
    RenderConfig,
    Renderer,
    Translator,
    TranslatorConfig,
)
from manga_translator.utils import Context

ProgressHook = Callable[[str, bool], Awaitable[None]]

_translator: Optional[MangaTranslator] = None
_translator_lock = asyncio.Lock()


async def get_translator() -> MangaTranslator:
    global _translator
    async with _translator_lock:
        if _translator is None:
            _translator = MangaTranslator(
                {
                    "use_gpu": settings.use_gpu,
                    "kernel_size": 3,
                    "ignore_errors": True,
                }
            )
    return _translator


def _pick_enum(enum_cls, value: str, default):
    try:
        return enum_cls(value)
    except Exception:
        return default


def _build_config(task_cfg: TaskConfig) -> Config:
    translator_key = _pick_enum(Translator, task_cfg.translator, Translator.youdao)
    detector_key = _pick_enum(Detector, task_cfg.detector, Detector.ctd)
    ocr_key = _pick_enum(Ocr, task_cfg.ocr, Ocr.ocr48px)
    inpainter_key = _pick_enum(Inpainter, task_cfg.inpainter, Inpainter.lama_large)
    renderer_key = Renderer.default if task_cfg.render_translated_text else Renderer.none

    return Config(
        detector=DetectorConfig(detector=detector_key, detection_size=task_cfg.detection_size),
        ocr=OcrConfig(ocr=ocr_key),
        translator=TranslatorConfig(translator=translator_key, target_lang=task_cfg.target_lang),
        inpainter=InpainterConfig(inpainter=inpainter_key),
        render=RenderConfig(renderer=renderer_key),
    )


def _make_polish_fn(task_cfg: TaskConfig):
    set_glossary_dir(settings.glossary_dir)
    glossary = load_glossary_mapping(task_cfg.glossary_id) if task_cfg.glossary_id else None
    if not task_cfg.polish and not glossary:
        return None

    async def _polish(text_regions: list) -> None:
        await polish_translations(
            text_regions,
            api_key=settings.anthropic_api_key,
            glossary=glossary,
        )

    return _polish


async def run_pipeline(
    image: Image.Image,
    task_cfg: TaskConfig,
    on_progress: Optional[ProgressHook] = None,
) -> Context:
    translator = await get_translator()
    config = _build_config(task_cfg)
    polish_fn = _make_polish_fn(task_cfg)

    if on_progress:
        translator.add_progress_hook(on_progress)
    if polish_fn:
        translator.set_polish_fn(polish_fn)

    try:
        ctx = await translator.translate(image, config)
    finally:
        if polish_fn:
            translator.set_polish_fn(None)
        if on_progress:
            translator._progress_hooks = [ph for ph in translator._progress_hooks if ph is not on_progress]
            if not any(getattr(ph, "__name__", "") == "ph" for ph in translator._progress_hooks):
                translator._add_logger_hook()

    return ctx


async def warmup() -> None:
    set_glossary_dir(settings.glossary_dir)
    await get_translator()
