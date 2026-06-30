#requires -Version 7
<#
.SYNOPSIS
  Build the m-trans desktop app into dist\m-trans\ (Windows / pwsh).

.DESCRIPTION
  PowerShell-native equivalent of build.sh. Produces a one-dir PyInstaller
  bundle with CPU torch by default.

  Variants:
    .\build.ps1                 # CPU build (default, ~1.2 GB)
    .\build.ps1 -Cuda           # CUDA build (large; needs cuda torch reachable)
    .\build.ps1 -NoFonts        # strip bundled CJK fonts
    .\build.ps1 -SkipFrontend   # reuse existing frontend\dist

  Prerequisites: pwsh 7, Node.js 20.19+, uv (winget install astral-sh.uv).
#>
[CmdletBinding()]
param(
  [switch]$Cuda,
  [switch]$NoFonts,
  [switch]$SkipFrontend
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path "$PSScriptRoot"
Set-Location $Root

$env:M_TRANS_BUILD_CUDA    = if ($Cuda)  { '1' } else { '0' }
$env:M_TRANS_BUILD_NO_FONTS = if ($NoFonts) { '1' } else { '0' }

$variant = if ($Cuda) { 'CUDA' } else { 'CPU' }
if ($NoFonts) { $variant += ', no fonts' }
Write-Host "==> Build variant: $variant" -ForegroundColor Cyan

# ── 1. Frontend ──────────────────────────────────────────────────────────────
if (-not $SkipFrontend) {
  Write-Host "==> Building frontend" -ForegroundColor Cyan
  Push-Location frontend
  npm install --silent
  npm run build
  Pop-Location
} else {
  Write-Host "==> Skipping frontend build (using existing frontend\dist)" -ForegroundColor Yellow
}
if (-not (Test-Path "frontend\dist\index.html")) {
  throw "ERROR: frontend\dist\index.html missing"
}

# ── 2. Build venv (isolated, CPU torch by default) ───────────────────────────
$BuildVenv = Join-Path $Root ".build-venv"
Write-Host "==> Preparing build venv at $BuildVenv" -ForegroundColor Cyan
if (-not (Test-Path $BuildVenv)) {
  uv venv --python 3.10 $BuildVenv
}

$py = Join-Path $BuildVenv "Scripts\python.exe"
$uvArgs = @('--python', $py)

# uv venvs ship without pip; use `uv pip install --python <venv>` to install
# into them. For CPU builds we force the CPU torch wheel index (saves ~1 GB).
if (-not $Cuda) {
  Write-Host "==> Installing torch (CPU)..." -ForegroundColor Cyan
  uv pip install @uvArgs torch torchvision --index-url https://download.pytorch.org/whl/cpu
  if ($LASTEXITCODE -ne 0) { throw "torch install failed" }
} else {
  # CUDA build: torch comes from requirements.txt (default index).
}

# requirements.txt has rusty-manga-image-translator commented out (its wheels
# are corrupt); no filtering needed.
Write-Host "==> Installing requirements..." -ForegroundColor Cyan
uv pip install @uvArgs -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw "requirements install failed" }

# Verify torch actually installed — it's the one big dep that silently fails.
& $py -c "import torch" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "torch not found after install; retrying from default PyPI..." -ForegroundColor Yellow
  uv pip install @uvArgs torch torchvision
  if ($LASTEXITCODE -ne 0) { throw "torch failed to install" }
}

# Project itself (editable) + PyInstaller.
Write-Host "==> Installing project + PyInstaller..." -ForegroundColor Cyan
uv pip install @uvArgs -e .
if ($LASTEXITCODE -ne 0) { throw "project install failed" }
uv pip install @uvArgs pyinstaller
if ($LASTEXITCODE -ne 0) { throw "pyinstaller install failed" }

Write-Host "==> Installed torch:" -ForegroundColor Cyan
& $py -c "import torch; print(torch.__version__, '| cuda:', torch.cuda.is_available())"

# ── 3. PyInstaller ───────────────────────────────────────────────────────────
Write-Host "==> Running PyInstaller" -ForegroundColor Cyan
$env:PYTHONPATH = $Root
& $py -m PyInstaller --noconfirm --clean --log-level WARN m-trans.spec
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed (exit $LASTEXITCODE)" }

# ── 4. Report ────────────────────────────────────────────────────────────────
$Out = Join-Path $Root "dist\m-trans"
if (Test-Path $Out) {
  $size = (Get-ChildItem -Recurse $Out | Measure-Object -Property Length -Sum).Sum / 1MB
  Write-Host ""
  Write-Host "==> Build complete: $Out" -ForegroundColor Green
  Write-Host ("    size: {0:N1} MB" -f $size)
  Write-Host "    launcher: $Out\m-trans.exe"
  Write-Host "    Run it: .\dist\m-trans\m-trans.exe" -ForegroundColor Green
} else {
  throw "ERROR: build did not produce $Out"
}
