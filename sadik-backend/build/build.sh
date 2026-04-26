#!/usr/bin/env bash
# build.sh — macOS/Linux build script for SADIK backend PyInstaller bundle
# Usage: cd sadik-backend && bash build/build.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

if [ ! -f ".venv/bin/activate" ]; then
  echo "ERROR: venv not found. Run: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
  exit 1
fi

source .venv/bin/activate

echo "Installing PyInstaller..."
pip install pyinstaller --quiet

echo "Building sadik-backend onedir bundle..."
pyinstaller build/sadik-backend.spec --noconfirm --clean

echo ""
echo "Build OK -> dist/sadik-backend/sadik-backend"
