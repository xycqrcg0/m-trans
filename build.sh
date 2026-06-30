#!/usr/bin/env bash
# Build the m-trans desktop application into dist/m-trans/.
#
# Produces a one-dir PyInstaller bundle:
#   dist/m-trans/m-trans            (launcher executable)
#   dist/m-trans/frontend_dist/      (built React frontend)
#   dist/m-trans/fonts/ dict/ glossaries/
#   (+ Python runtime, torch CPU, all deps)
#
# User-writable data (storage/, models/) is created at runtime next to the exe.
#
# Variants:
#   ./build.sh              # CPU build (default, ~1.2 GB)
#   ./build.sh --cuda       # CUDA build (large, ~3 GB; needs cuda torch in env)
#   ./build.sh --no-fonts   # strip bundled CJK fonts (smaller, ~1.1 GB)
#   ./build.sh --skip-frontend  # don't rebuild frontend (use existing dist)
#
# Requirements: uv, node/npm.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

BUILD_CUDA=0
NO_FONTS=0
SKIP_FRONTEND=0
for arg in "$@"; do
  case "$arg" in
    --cuda) BUILD_CUDA=1 ;;
    --no-fonts) NO_FONTS=1 ;;
    --skip-frontend) SKIP_FRONTEND=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

export M_TRANS_BUILD_CUDA="$BUILD_CUDA"
export M_TRANS_BUILD_NO_FONTS="$NO_FONTS"

echo "==> Build variant: $([ $BUILD_CUDA = 1 ] && echo CUDA || echo CPU)$([ $NO_FONTS = 1 ] && echo ', no fonts')"

# ── 1. Frontend ──────────────────────────────────────────────────────────────
if [ "$SKIP_FRONTEND" = 0 ]; then
  echo "==> Building frontend"
  ( cd frontend && npm install --silent && npm run build )
else
  echo "==> Skipping frontend build (using existing frontend/dist)"
fi
[ -f frontend/dist/index.html ] || { echo "ERROR: frontend/dist/index.html missing"; exit 1; }

# ── 2. Build venv (isolated, CPU torch by default) ───────────────────────────
BUILD_VENV="$ROOT/.build-venv"
echo "==> Preparing build venv at $BUILD_VENV"
if [ ! -d "$BUILD_VENV" ]; then
  uv venv --python 3.10 "$BUILD_VENV"
fi

# uv venvs ship without pip; use `uv pip install --python <venv>` to install
# into them. For CPU builds we force the CPU torch wheel index so we don't
# pull the 1.5 GB CUDA build.
VENV_PY="$BUILD_VENV/bin/python"
if [ "$BUILD_CUDA" = 0 ]; then
  # torch/torchvision from the CPU index first, then the rest from PyPI.
  uv pip install --python "$VENV_PY" torch torchvision --index-url https://download.pytorch.org/whl/cpu
  uv pip install --python "$VENV_PY" -r requirements.txt
else
  uv pip install --python "$VENV_PY" -r requirements.txt
fi
# Project itself (editable so PyInstaller sees the local packages).
uv pip install --python "$VENV_PY" -e .
uv pip install --python "$VENV_PY" pyinstaller

echo "==> Installed torch:"
"$BUILD_VENV/bin/python" -c "import torch; print(torch.__version__, '| cuda:', torch.cuda.is_available())"

# ── 3. PyInstaller ───────────────────────────────────────────────────────────
echo "==> Running PyInstaller"
PYINSTALLER=( "$BUILD_VENV/bin/python" -m PyInstaller )
"${PYINSTALLER[@]}" --noconfirm --clean --log-level WARN m-trans.spec

# ── 4. Report ────────────────────────────────────────────────────────────────
OUT="$ROOT/dist/m-trans"
if [ -d "$OUT" ]; then
  echo
  echo "==> Build complete: $OUT"
  du -sh "$OUT"
  echo "    launcher: $OUT/m-trans"
  echo "    Run it: ./$OUT/m-trans"
else
  echo "ERROR: build did not produce $OUT" >&2
  exit 1
fi
