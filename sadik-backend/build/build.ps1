# build.ps1 — Windows build script for SADIK backend PyInstaller bundle
# Usage: cd sadik-backend; .\build\build.ps1
# Output: dist\sadik-backend\sadik-backend.exe

$ErrorActionPreference = "Stop"
Set-Location "$PSScriptRoot\.."

if (-not (Test-Path ".venv\Scripts\Activate.ps1")) {
    Write-Error "venv not found. Run: python -m venv .venv; .venv\Scripts\pip install -r requirements.txt"
    exit 1
}

. ".venv\Scripts\Activate.ps1"

Write-Host "Installing PyInstaller..." -ForegroundColor Cyan
pip install pyinstaller --quiet

Write-Host "Building sadik-backend onedir bundle..." -ForegroundColor Cyan
pyinstaller build/sadik-backend.spec --noconfirm --clean

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Build OK -> dist\sadik-backend\sadik-backend.exe" -ForegroundColor Green
} else {
    Write-Error "PyInstaller build failed (exit $LASTEXITCODE)"
    exit $LASTEXITCODE
}
