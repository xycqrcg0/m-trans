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


async def run_pipeline(
    input_path: Path,
    output_dir: Path,
    detector_key: Detector,
    ocr_key: Ocr,
    detection_size: int,
) -> None:
    if not input_path.exists():
        raise FileNotFoundError(f"Input image not found: {input_path}")

    output_dir.mkdir(parents=True, exist_ok=True)

    translator = MangaTranslator({"kernel_size": 7})
    config = Config(
        translator=TranslatorConfig(translator=Translator.original, target_lang="CHS"),
        detector=DetectorConfig(detector=detector_key, detection_size=detection_size),
        ocr=OcrConfig(ocr=ocr_key),
        inpainter=InpainterConfig(inpainter=Inpainter.lama_mpe),
        renderer=RenderConfig(renderer=Renderer.none),
    )
    config.mask_dilation_offset = 28

    image = Image.open(input_path)
    ctx = await translator.translate(image, config)

    regions = ctx.get("text_regions") if isinstance(ctx, dict) else None
    if not regions:
        payload = {
            "input": str(input_path),
            "message": "No text regions detected. Nothing to translate/render.",
            "context_keys": sorted(list(ctx.keys())) if isinstance(ctx, dict) else [],
        }
        result = ctx.get("result") if isinstance(ctx, dict) else None
        if result is not None:
            result_path = output_dir / "result-no-text.png"
            result.save(result_path)
            payload["result_image"] = str(result_path)
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return

    texts = [region.text for region in regions]
    translations = await google_translate_batch(texts, target_lang="zh-CN")

    for region, translated in zip(regions, translations):
        region.translation = translated
        region.target_lang = "CHS"

    inpainted = ctx.get("img_inpainted")
    if inpainted is None:
        raise RuntimeError("Pipeline completed without img_inpainted in context")

    rendered = await dispatch_rendering(inpainted.copy(), regions)

    # Save artifacts
    Image.fromarray(inpainted).save(output_dir / "inpainted.png")
    Image.fromarray(rendered).save(output_dir / "rendered.png")

    summary = {
        "input": str(input_path),
        "detector": str(detector_key),
        "ocr": str(ocr_key),
        "detection_size": detection_size,
        "mask_dilation_offset": config.mask_dilation_offset,
        "kernel_size": translator.kernel_size,
        "outputs": {
            "inpainted": str(output_dir / "inpainted.png"),
            "rendered": str(output_dir / "rendered.png"),
        },
        "regions": [
            {
                "text": region.text,
                "translation": region.translation,
            }
            for region in regions
        ],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))

def main() -> None:
    parser = argparse.ArgumentParser(description="Run end-to-end OCR -> Google Translate -> inpaint -> render test")
    parser.add_argument("input", type=Path, help="Input manga image path")
    parser.add_argument("--output-dir", type=Path, default=Path("/tmp/google-pipeline-out"))
    parser.add_argument("--detector", choices=["default", "ctd"], default="ctd")
    parser.add_argument("--ocr", choices=["ocr32px", "ocr48px_ctc"], default="ocr32px")
    parser.add_argument("--detection-size", type=int, default=1024)
    args = parser.parse_args()
    detector_key = Detector.ctd if args.detector == "ctd" else Detector.default
    ocr_key = Ocr.ocr48px_ctc if args.ocr == "ocr48px_ctc" else Ocr.ocr32px
    asyncio.run(run_pipeline(args.input, args.output_dir, detector_key, ocr_key, args.detection_size))


if __name__ == "__main__":
    main()
