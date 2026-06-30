# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the m-trans desktop application.

Produces a one-dir distribution ``dist/m-trans/`` containing:
    - the launcher executable (``m-trans`` / ``m-trans.exe``)
    - the Python runtime + all dependencies (torch CPU by default)
    - the built frontend (``frontend_dist/``)
    - bundled fonts, dictionaries, glossaries

User-writable data (``storage/``, ``models/``) is created at runtime next to
the executable via ``config.settings._resolve_base_dir()`` (frozen-aware).

Build variants
--------------
CPU (default, small ~1.2 GB):
    pyinstaller m-trans.spec

CUDA (large ~3 GB, requires a CUDA-enabled torch in the build env):
    M_TRANS_BUILD_CUDA=1 pyinstaller m-trans.spec

The CUDA build keeps ``nvidia.*`` and ``torch/lib/*.so`` CUDA libs; the CPU
build excludes them to shrink the bundle. Set ``M_TRANS_BUILD_NO_FONTS=1`` to
strip the large bundled CJK fonts (~58 MB) — users can add their own via the
font manager.
"""
import os
import sys
from pathlib import Path
from PyInstaller.utils.hooks import (
    collect_all,
    collect_data_files,
    collect_submodules,
    copy_metadata,
)

BLOCK_CIPHER = None  # noqa: N816 (PyInstaller variable name)

PROJECT_ROOT = Path.cwd()
BUILD_CUDA = os.environ.get("M_TRANS_BUILD_CUDA") == "1"
NO_FONTS = os.environ.get("M_TRANS_BUILD_NO_FONTS") == "1"

# ── Hidden imports: manga_translator's many dynamic modules ──────────────────
hidden_imports = []

# Pull in every submodule of the heavy libs so PyInstaller doesn't miss a
# delayed import inside torch/transformers/etc.
for pkg in (
    "manga_translator",
    "manga_translator.detection",
    "manga_translator.ocr",
    "manga_translator.inpainting",
    "manga_translator.rendering",
    "manga_translator.translators",
    "manga_translator.utils",
    "manga_translator.mask_refinement",
    "manga_translator.textline_merge",
    "manga_translator.colorization",
    "manga_translator.upscaling",
):
    hidden_imports += collect_submodules(pkg)

# Torch / CV / inference stack — collect everything (data + submodules + binaries).
datas = []
binaries = []
for pkg in (
    "torch",
    "torchvision",
    "transformers",
    "huggingface_hub",
    "onnxruntime",
    "cv2",
    "numpy",
    "scipy",
    "skimage",
    "PIL",
    "kornia",
    "timm",
    "open_clip_torch",
    "safetensors",
    "sentencepiece",
    "pyclipper",
    "shapely",
    "py3langid",
    "pydensecrf",
    "fontTools",
    "webview",
    "fastapi",
    "uvicorn",
    "pydantic",
    "pydantic_settings",
):
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hidden_imports += h
    except Exception:
        # collect_all raises if the package isn't installed; skip silently —
        # optional deps (e.g. cuda-only packages) may be absent.
        pass

# Package metadata (some libs read their own version from installed metadata.
# uv-managed installs may lack the dist-info; skip missing ones gracefully.
def _safe_copy_metadata(pkg_name):
    try:
        return copy_metadata(pkg_name)
    except Exception:
        return []

datas += _safe_copy_metadata("torch")
datas += _safe_copy_metadata("transformers")
datas += _safe_copy_metadata("onnxruntime")
datas += _safe_copy_metadata("fastapi")
datas += _safe_copy_metadata("pydantic")

# ── Application code + data ───────────────────────────────────────────────────
# app/, config/, manga_translator/ are packages — collect their non-.py data.
datas += collect_data_files("app")
datas += collect_data_files("config")
datas += collect_data_files("manga_translator")

# Dictionaries (small, required at runtime). Glossaries dir is optional —
# default.json is generated at runtime; the dir may be absent in CI.
datas += [(str(PROJECT_ROOT / "dict"), "dict")]
_glossaries_dir = PROJECT_ROOT / "glossaries"
if _glossaries_dir.is_dir():
    datas += [(str(_glossaries_dir), "glossaries")]

# Frontend build → frontend_dist/ (matches _resolve_frontend_dir() frozen path).
frontend_dist = PROJECT_ROOT / "frontend" / "dist"
if frontend_dist.is_dir():
    datas += [(str(frontend_dist), "frontend_dist")]

# Fonts (large). Allow stripping the heavy CJK fonts for a minimal build.
fonts_dir = PROJECT_ROOT / "fonts"
if fonts_dir.is_dir() and not NO_FONTS:
    datas += [(str(fonts_dir), "fonts")]

# ── CUDA exclusion for CPU builds ────────────────────────────────────────────
# torch ships ~1 GB of nvidia CUDA wheels; drop them when building CPU-only.
if not BUILD_CUDA:
    _cuda_prefixes = ("nvidia", "torch.cuda", "cupy")
    binaries = [
        (b, dest) for (b, dest) in binaries
        if not any(p in b or p in dest for p in _cuda_prefixes)
    ]
    # Also exclude the bundled nvidia.* subpackages.
    hidden_imports = [
        h for h in hidden_imports
        if not h.startswith("nvidia") and not h.startswith("cupy")
    ]

# ── Analysis ─────────────────────────────────────────────────────────────────
a = Analysis(
    [str(PROJECT_ROOT / "app" / "launcher.py")],
    pathex=[str(PROJECT_ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Heavy / unused libs we never ship.
        "matplotlib",
        "tensorboard",
        "tensorboardX",
        "IPython",
        "jupyter",
        "notebook",
        "pytest",
        "tkinter",
        "test",
        "tests",
        # NOTE: do NOT exclude `unittest` — torch.utils._config_module imports
        # it at runtime, and excluding it makes the frozen app crash on boot.
        # NOTE: do NOT exclude `torch.distributed` — torch.utils.data.dataloader
        # imports it unconditionally, so it must be present even in CPU builds.
        # `torch.testing` is safe to drop (only used by torch's own test suite).
        *([] if BUILD_CUDA else ["torch.testing"]),
    ],
    cipher=BLOCK_CIPHER,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=BLOCK_CIPHER)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="m-trans",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    runtime_tmpdir=None,
    console=False,  # GUI app: no console window on Windows
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="m-trans",
)
