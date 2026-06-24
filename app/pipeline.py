from __future__ import annotations

import asyncio
import os
from pathlib import Path
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

# Built-in dict files shipped with m-trans
_DICT_DIR = Path(__file__).resolve().parent.parent / "dict"
_PRE_DICT = _DICT_DIR / "pre_dict.txt"
_POST_DICT = _DICT_DIR / "post_dict.txt"


async def get_translator() -> MangaTranslator:
    global _translator
    async with _translator_lock:
        if _translator is None:
            _translator = MangaTranslator(
                {
                    "use_gpu": settings.use_gpu,
                    "kernel_size": 3,
                    "ignore_errors": True,
                    "pre_dict": str(_PRE_DICT),
                    "post_dict": str(_POST_DICT),
                }
            )
    return _translator


def _pick_enum(enum_cls, value: str, default):
    try:
        return enum_cls(value)
    except Exception:
        return default


def _export_glossary_for_gpt(task_cfg: TaskConfig) -> Optional[str]:
    """Export JSON glossary to MIT-format txt for GPT translators.

    GPT translators (chatgpt/deepseek/gemini/groq) read OPENAI_GLOSSARY_PATH
    and do fuzzy matching + system-message injection internally.
    This function bridges our JSON glossary to that mechanism.
    """
    if not task_cfg.glossary_id:
        return None
    mapping = load_glossary_mapping(task_cfg.glossary_id)
    if not mapping:
        return None

    # Write MIT-format txt: source\TTtarget  (# comment)
    path = settings.glossary_dir / f"{task_cfg.glossary_id}_gpt.txt"
    with open(path, "w", encoding="utf-8") as f:
        f.write("# Auto-exported from glossary.py JSON\n")
        for src, tgt in mapping.items():
            f.write(f"{src}\t{tgt}\n")
    return str(path)


def _build_config(task_cfg: TaskConfig) -> Config:
    translator_key = _pick_enum(Translator, task_cfg.translator, Translator.youdao)
    detector_key = _pick_enum(Detector, task_cfg.detector, Detector.default)
    ocr_key = _pick_enum(Ocr, task_cfg.ocr, Ocr.ocr48px)
    inpainter_key = _pick_enum(Inpainter, task_cfg.inpainter, Inpainter.lama_large)
    renderer_key = Renderer.default if task_cfg.render_translated_text else Renderer.none

    return Config(
        detector=DetectorConfig(detector=detector_key, detection_size=task_cfg.detection_size),
        ocr=OcrConfig(ocr=ocr_key),
        translator=TranslatorConfig(translator=translator_key, target_lang=task_cfg.target_lang),
        inpainter=InpainterConfig(inpainter=inpainter_key),
        render=RenderConfig(
            renderer=renderer_key,
            font_size_offset=task_cfg.font_size_offset,
            font_size_minimum=task_cfg.font_size_minimum,
            line_spacing=task_cfg.line_spacing if task_cfg.line_spacing is not None else 0,
            disable_font_border=task_cfg.disable_font_border,
        ),
    )


def _make_polish_fn(task_cfg: TaskConfig):
    """Create polish callback for non-GPT translators (e.g. Google).

    For GPT translators, glossary is injected via system message — polish
    only adds LLM refinement on top.
    For non-GPT translators, polish also applies glossary via regex.
    """
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

    # ── Layer 3: Cross-page context ──
    # context_size > 0 means GPT translator will use previous pages' translations
    # as context for the current page, improving consistency.
    translator.context_size = task_cfg.context_size

    polish_fn = _make_polish_fn(task_cfg)

    # ── Glossary injection for GPT translators ──
    # GPT translators read OPENAI_GLOSSARY_PATH and do fuzzy matching internally.
    # Non-GPT translators (Google, Youdao, etc.) get glossary via polish_fn regex.
    gpt_translators = {"chatgpt", "chatgpt_2stage", "deepseek", "groq", "gemini",
                       "gemini_2stage", "custom_openai"}
    old_glossary_path = os.environ.get("OPENAI_GLOSSARY_PATH")
    if task_cfg.translator in gpt_translators and task_cfg.glossary_id:
        gpt_path = _export_glossary_for_gpt(task_cfg)
        if gpt_path:
            os.environ["OPENAI_GLOSSARY_PATH"] = gpt_path
    else:
        # Fall back to built-in mit_glossary.txt
        os.environ["OPENAI_GLOSSARY_PATH"] = str(_DICT_DIR / "mit_glossary.txt")

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
        # Restore original glossary path
        if old_glossary_path is not None:
            os.environ["OPENAI_GLOSSARY_PATH"] = old_glossary_path
        else:
            os.environ.pop("OPENAI_GLOSSARY_PATH", None)

    return ctx


async def warmup() -> None:
    set_glossary_dir(settings.glossary_dir)
    await get_translator()
