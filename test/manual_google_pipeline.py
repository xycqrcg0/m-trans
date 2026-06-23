from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from urllib.parse import quote

import httpx
from PIL import Image

from manga_translator import Config, MangaTranslator
from manga_translator.config import (
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
from manga_translator.rendering import dispatch as dispatch_rendering


GOOGLE_ENDPOINT = "https://translate.googleapis.com/translate_a/single"


async def google_translate_batch(texts: list[str], target_lang: str = "zh-CN") -> list[str]:
    """Translate each text using the public Google Translate endpoint.

    No API key required. Network access to translate.googleapis.com is required.
    """
    results: list[str] = []
    async with httpx.AsyncClient(timeout=30.0) as client:
        for text in texts:
            if not text.strip():
                results.append("")
                continue
            url = (
                f"{GOOGLE_ENDPOINT}?client=gtx&sl=auto&tl={quote(target_lang)}"
                f"&dt=t&q={quote(text)}"
            )
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
            translated = "".join(part[0] for part in data[0] if part and part[0])
            results.append(translated)
    return results


async def run_pipeline(input_path: Path, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    translator = MangaTranslator()
    config = Config(
        translator=TranslatorConfig(translator=Translator.original, target_lang="CHS"),
        detector=DetectorConfig(detector=Detector.default, detection_size=512),
        ocr=OcrConfig(ocr=Ocr.ocr32px),
        inpainter=InpainterConfig(inpainter=Inpainter.lama_mpe),
        renderer=RenderConfig(renderer=Renderer.none),
    )

    image = Image.open(input_path)
    ctx = await translator.translate(image, config)

    texts = [region.text for region in ctx["text_regions"]]
    translations = await google_translate_batch(texts, target_lang="zh-CN")

    for region, translated in zip(ctx["text_regions"], translations):
        region.translation = translated
        region.target_lang = "CHS"

    rendered = await dispatch_rendering(ctx["img_inpainted"].copy(), ctx["text_regions"])

    # Save artifacts
    Image.fromarray(ctx["img_inpainted"]).save(output_dir / "inpainted.png")
    Image.fromarray(rendered).save(output_dir / "rendered.png")

    summary = {
        "input": str(input_path),
        "outputs": {
            "inpainted": str(output_dir / "inpainted.png"),
            "rendered": str(output_dir / "rendered.png"),
        },
        "regions": [
            {
                "text": region.text,
                "translation": region.translation,
            }
            for region in ctx["text_regions"]
        ],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description="Run end-to-end OCR -> Google Translate -> inpaint -> render test")
    parser.add_argument("input", type=Path, help="Input manga image path")
    parser.add_argument("--output-dir", type=Path, default=Path("/tmp/google-pipeline-out"))
    args = parser.parse_args()
    asyncio.run(run_pipeline(args.input, args.output_dir))


if __name__ == "__main__":
    main()
