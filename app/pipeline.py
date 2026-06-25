from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Awaitable, Callable, Optional

from PIL import Image

from app.models import TaskConfig
from config.settings import settings
from manga_translator import MangaTranslator, apply_glossary, load_glossary_mapping, polish_translations, set_glossary_dir
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

logger = logging.getLogger("pipeline")

_translator: Optional[MangaTranslator] = None
_translator_lock = asyncio.Lock()
_pipeline_lock = asyncio.Lock()

_DICT_DIR = Path(__file__).resolve().parent.parent / "dict"
_PRE_DICT = _DICT_DIR / "pre_dict.txt"
_POST_DICT = _DICT_DIR / "post_dict.txt"


async def get_translator() -> MangaTranslator:
    global _translator
    async with _translator_lock:
        if _translator is None:
            # Redirect the library's intermediate result output away from
            # the project root into our storage area.
            import manga_translator.utils.generic as _generic
            _generic.BASE_PATH = str(settings.BASE_DIR / "storage" / "mt_debug")
            (settings.BASE_DIR / "storage" / "mt_debug").mkdir(parents=True, exist_ok=True)

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
    if not task_cfg.glossary_id:
        return None
    mapping = load_glossary_mapping(task_cfg.glossary_id)
    if not mapping:
        return None
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
        inpainter=InpainterConfig(inpainter=inpainter_key, inpainting_size=task_cfg.inpainting_size),
        render=RenderConfig(
            renderer=renderer_key,
            font_size_offset=task_cfg.font_size_offset,
            font_size_minimum=task_cfg.font_size_minimum,
            line_spacing=task_cfg.line_spacing if task_cfg.line_spacing is not None else 0,
            disable_font_border=task_cfg.disable_font_border,
        ),
        mask_dilation_offset=task_cfg.mask_dilation_offset,
        kernel_size=task_cfg.mask_kernel_size,
    )


def _make_polish_fn(task_cfg: TaskConfig):
    if not task_cfg.polish:
        return None

    # LLM translators already produce natural, context-aware output; running a
    # second LLM (Claude) polish on top is redundant work and can cause style
    # conflicts. Skip polish for those and let the raw translation stand.
    if task_cfg.translator in _GPT_TRANSLATORS:
        logger.info(
            "Polish disabled: translator '%s' is already LLM-based, skipping "
            "redundant Claude polish",
            task_cfg.translator,
        )
        return None

    set_glossary_dir(settings.glossary_dir)
    glossary = load_glossary_mapping(task_cfg.glossary_id) if task_cfg.glossary_id else None

    async def _polish(text_regions: list) -> None:
        await polish_translations(
            text_regions,
            api_key=settings.anthropic_api_key,
            glossary=glossary,
        )

    return _polish


_GPT_TRANSLATORS = {"chatgpt", "chatgpt_2stage", "deepseek", "groq", "gemini",
                     "gemini_2stage", "custom_openai", "sakura"}


async def run_pipeline(
    image: Image.Image,
    task_cfg: TaskConfig,
    on_progress: Optional[ProgressHook] = None,
    stop_before_render: bool = False,
) -> Context:
    async with _pipeline_lock:
        translator = await get_translator()
        config = _build_config(task_cfg)

        translator.context_size = task_cfg.context_size

        polish_fn = _make_polish_fn(task_cfg)

        old_glossary_path = os.environ.get("OPENAI_GLOSSARY_PATH")
        old_sakura_dict_path = os.environ.get("SAKURA_DICT_PATH")
        try:
            if task_cfg.translator in _GPT_TRANSLATORS and task_cfg.glossary_id:
                gpt_path = _export_glossary_for_gpt(task_cfg)
                if gpt_path:
                    os.environ["OPENAI_GLOSSARY_PATH"] = gpt_path
                    os.environ["SAKURA_DICT_PATH"] = gpt_path
            else:
                mit_path = str(_DICT_DIR / "mit_glossary.txt")
                os.environ["OPENAI_GLOSSARY_PATH"] = mit_path
                os.environ["SAKURA_DICT_PATH"] = mit_path
            if on_progress:
                translator.add_progress_hook(on_progress)
            if polish_fn:
                translator.set_polish_fn(polish_fn)
            translator._stop_before_render = stop_before_render

            ctx = await translator.translate(image, config)
        finally:
            if polish_fn:
                translator.set_polish_fn(None)
            translator._stop_before_render = False
            if on_progress:
                translator._progress_hooks = [
                    ph for ph in translator._progress_hooks if ph is not on_progress
                ]
                if not translator._progress_hooks:
                    translator._add_logger_hook()
            if old_glossary_path is not None:
                os.environ["OPENAI_GLOSSARY_PATH"] = old_glossary_path
            else:
                os.environ.pop("OPENAI_GLOSSARY_PATH", None)
            if old_sakura_dict_path is not None:
                os.environ["SAKURA_DICT_PATH"] = old_sakura_dict_path
            else:
                os.environ.pop("SAKURA_DICT_PATH", None)

        # Fallback glossary application: if the user selected a glossary but
        # it wasn't applied during translation, apply it now.
        # - chatgpt/sakura read OPENAI_GLOSSARY_PATH/SAKURA_DICT_PATH during
        #   translation (fixed above to read the env var live), so they're
        #   covered and must NOT get a second pass here.
        # - deepseek/gemini/groq/custom_openai and all non-LLM translators
        #   never load the glossary, so apply it as a post-translation step.
        # - When polish ran, it already applied the glossary internally.
        _GLOSSARY_AWARE_GPT = {"chatgpt", "chatgpt_2stage", "sakura"}
        glossary_already_applied = polish_fn is not None or task_cfg.translator in _GLOSSARY_AWARE_GPT
        if task_cfg.glossary_id and not glossary_already_applied:
            mapping = load_glossary_mapping(task_cfg.glossary_id)
            if mapping and ctx.text_regions:
                for region in ctx.text_regions:
                    raw = getattr(region, "translation", "") or ""
                    region.translation = apply_glossary(raw, mapping)
                logger.info("Applied glossary (%d terms) post-translation", len(mapping))

    return ctx

async def render_pipeline(ctx: Context, task_cfg: TaskConfig) -> Context:
    """Render text onto an already-inpainted image.

    Called after ``run_pipeline(..., stop_before_render=True)`` once the
    caller has optionally edited ``ctx.text_regions[].translation``.
    """
    async with _pipeline_lock:
        translator = await get_translator()
        config = _build_config(task_cfg)
        translator.context_size = task_cfg.context_size
        ctx = await translator.render_translations(config, ctx)
    return ctx


async def warmup() -> None:
    set_glossary_dir(settings.glossary_dir)
    await get_translator()
