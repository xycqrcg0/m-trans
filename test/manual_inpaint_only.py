from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

import numpy as np
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


def _save_mask(path: Path, mask: np.ndarray | None) -> None:
    if mask is None:
        return
    Image.fromarray(mask).save(path)


async def run_inpaint_only(
    input_path: Path,
    output_dir: Path,
    detector_key: Detector,
    ocr_key: Ocr,
    detection_size: int,
) -> None:
    if not input_path.exists():
        raise FileNotFoundError(f"Input image not found: {input_path}")

    output_dir.mkdir(parents=True, exist_ok=True)

    translator = MangaTranslator(
        {
            "kernel_size": 7,
        }
    )

    config = Config(
        translator=TranslatorConfig(translator=Translator.none, target_lang="CHS"),
        detector=DetectorConfig(detector=detector_key, detection_size=detection_size),
        ocr=OcrConfig(ocr=ocr_key),
        inpainter=InpainterConfig(inpainter=Inpainter.lama_mpe),
        renderer=RenderConfig(renderer=Renderer.none),
    )
    # Make the erase region slightly larger to remove more text residue.
    config.mask_dilation_offset = 28

    image = Image.open(input_path)
    ctx = await translator.translate(image, config)

    textlines = ctx.get("textlines", []) if isinstance(ctx, dict) else []
    text_regions = ctx.get("text_regions", []) if isinstance(ctx, dict) else []
    mask_raw = ctx.get("mask_raw") if isinstance(ctx, dict) else None
    mask_final = ctx.get("mask") if isinstance(ctx, dict) else None
    img_inpainted = ctx.get("img_inpainted") if isinstance(ctx, dict) else None
    result = ctx.get("result") if isinstance(ctx, dict) else None

    _save_mask(output_dir / "mask_raw.png", mask_raw)
    _save_mask(output_dir / "mask_final.png", mask_final)

    if img_inpainted is not None:
        Image.fromarray(img_inpainted).save(output_dir / "inpainted.png")
    elif result is not None:
        result.save(output_dir / "inpainted.png")

    summary = {
        "input": str(input_path),
        "detector": str(detector_key),
        "ocr": str(ocr_key),
        "detection_size": detection_size,
        "mask_dilation_offset": config.mask_dilation_offset,
        "kernel_size": translator.kernel_size,
        "textline_count": len(textlines),
        "text_region_count": len(text_regions),
        "outputs": {
            "mask_raw": str(output_dir / "mask_raw.png") if mask_raw is not None else None,
            "mask_final": str(output_dir / "mask_final.png") if mask_final is not None else None,
            "inpainted": str(output_dir / "inpainted.png"),
        },
        "regions": [
            {
                "text": getattr(region, "text", ""),
                "translation": getattr(region, "translation", ""),
            }
            for region in text_regions
        ],
    }

    with (output_dir / "summary.json").open("w", encoding="utf-8") as fp:
        json.dump(summary, fp, ensure_ascii=False, indent=2)

    print(json.dumps(summary, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description="Run inpaint-only test (erase text without writing translations back)")
    parser.add_argument("input", type=Path, help="Input manga image path")
    parser.add_argument("--output-dir", type=Path, default=Path("/tmp/inpaint-only-out"))
    parser.add_argument("--detector", choices=["ctd", "default"], default="ctd")
    parser.add_argument("--ocr", choices=["ocr32px", "ocr48px_ctc"], default="ocr32px")
    parser.add_argument("--detection-size", type=int, default=1024)
    args = parser.parse_args()

    detector_key = Detector.ctd if args.detector == "ctd" else Detector.default
    ocr_key = Ocr.ocr48px_ctc if args.ocr == "ocr48px_ctc" else Ocr.ocr32px

    asyncio.run(
        run_inpaint_only(
            input_path=args.input,
            output_dir=args.output_dir,
            detector_key=detector_key,
            ocr_key=ocr_key,
            detection_size=args.detection_size,
        )
    )


if __name__ == "__main__":
    main()
