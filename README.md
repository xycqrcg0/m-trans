# m-trans — Manga Translation Desktop App

A desktop application for translating text in manga/comic images: detection → OCR → translation → inpainting → typesetting. Forked from [manga-image-translator](https://github.com/zyddnys/manga-image-translator) with a FastAPI backend + React UI bundled into a single click-to-run app.

> **Status:** early/fork. Models are downloaded on first use (~1–2 GB total, depending on which detectors/OCR/inpainter you pick).

---

## Download & Run

Prebuilt bundles are attached to each [GitHub Release](../../releases). Pick the one matching your OS and whether you want GPU acceleration.

| Bundle | OS | GPU | Size | Notes |
|---|---|---|---|---|
| `m-trans-windows-cpu.zip` | Windows 10/11 x64 | — | ~1.2 GB | No CUDA needed. |
| `m-trans-windows-cuda.zip` | Windows 10/11 x64 | NVIDIA CUDA | ~3 GB | Needs matching NVIDIA driver. |
| `m-trans-linux-cpu.tar.gz` | Linux x64 (glibc) | — | ~1.2 GB | Needs GTK3 (see below). |
| `m-trans-linux-cuda.tar.gz` | Linux x64 (glibc) | NVIDIA CUDA | ~3 GB | Needs NVIDIA driver + CUDA runtime. |

### Windows

1. Download `m-trans-windows-*.zip` and extract it (right-click → **Extract All…**).
2. Double-click `m-trans.exe`.
3. On first launch: Windows SmartScreen may warn "unrecognised app" → **More info** → **Run anyway** (the app is unsigned).
4. Models download automatically the first time you run a translation; you can also trigger downloads from the in-app **Models** panel.

### Linux

```bash
# 1. Install GTK3 (required by the native window).
sudo apt-get install -y libgtk-3-0 libglib2.0-0 libgirepository1.0-1

# 2. Extract.
tar xzf m-trans-linux-cpu.tar.gz

# 3. Run.
./m-trans/m-trans
```

For the CUDA bundle you also need an NVIDIA driver matching the bundled CUDA runtime.

### macOS

Not currently provided. Build from source (see below); note that an unsigned build will show "app is damaged" — run `xattr -dr com.apple.quarantine /path/to/m-trans.app` to clear the quarantine flag.

---

## Configuration

Settings are read from a `.env` file placed **next to the executable** (or from real environment variables). Copy `.env.example` to `.env` and fill in only the keys for translators you use:

```bash
cp .env.example .env
```

| Variable | Purpose |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek translator |
| `OPENAI_API_KEY` | OpenAI / GPT translator |
| `GEMINI_API_KEY` | Google Gemini translator |
| `GROQ_API_KEY` | Groq translator |
| `DEEPL_AUTH_KEY` | DeepL translator |
| `BAIDU_APP_ID` / `BAIDU_SECRET_KEY` | Baidu translator |
| `YOUDAO_APP_KEY` / `YOUDAO_APP_SECRET` | Youdao translator |
| `ANTHROPIC_API_KEY` | LLM polish (Claude) |
| `USE_GPU` | `true` to enable CUDA inference (CUDA bundle only) |
| `M_TRANS_DATA_DIR` | Override writable data dir (storage/models/fonts). Defaults to the exe directory. |

API keys can also be entered in-app via the **Settings** page.

---

## Where data lives

At runtime the app creates the following next to the executable:

```
storage/        # uploads, results, per-task data, logs, cache
models/         # downloaded model weights (on demand)
fonts/          # user-added fonts + notes
glossaries/     # translation glossaries
.env            # your config (optional)
```

Set `M_TRANS_DATA_DIR` to relocate all of the above (e.g. to keep data on a different drive).

---

## Build from source

Requires: Python 3.10–3.11, [Node.js 20+](https://nodejs.org/), [uv](https://docs.astral.sh/uv/).

### Windows (PowerShell 7)

```powershell
./build.ps1                 # CPU bundle (~1.2 GB)
./build.ps1 -Cuda          # CUDA bundle (~3 GB; needs CUDA torch reachable)
./build.ps1 -NoFonts       # strip bundled CJK fonts (~58 MB smaller)
./build.ps1 -SkipFrontend  # reuse existing frontend/dist
```

Output: `dist/m-trans/m-trans.exe`

### Linux

```bash
# GTK headers are required for pywebview at build + run time.
sudo apt-get install -y libgtk-3-dev libglib2.0-dev libgirepository1.0-dev

./build.sh              # CPU bundle
./build.sh --cuda       # CUDA bundle
./build.sh --no-fonts   # strip bundled CJK fonts
./build.sh --skip-frontend
```

Output: `dist/m-trans/m-trans`

### Dev mode (no packaging)

```bash
uv venv --python 3.10 .venv
source .venv/bin/activate
uv pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
uv pip install -r requirements.txt
uv pip install -e .

# Backend
python -m uvicorn app.main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend && npm install && npm run dev
```

Then open the Vite dev URL (frontend talks to the backend on port 8000).

---

## Bundled fonts

The repo ships CJK fonts (`fonts/msyh.ttc`, `fonts/msgothic.ttc`, …) so translated text renders out of the box. Strip them with `--no-fonts`/`-NoFonts` to shrink the bundle; users can then add their own via the in-app font manager.

---

## License

GPL-3.0-only. Forked from [manga-image-translator](https://github.com/zyddnys/manga-image-translator).
