#!/usr/bin/env python3
"""
encode_all.py — SADIK Color MJPEG encoder
Converts assets/mp4/*.mp4 → sadik-firmware/data/clips/*.mjpeg

ffmpeg command per clip:
  ffmpeg -y -i in.mp4 -vf "fps=24,scale=160:128:flags=lanczos" -q:v 5 -bsf:v mjpeg2jpeg -f mjpeg out.mjpeg

Usage:
  python tools/mjpeg/encode_all.py
  (run from sadik_color/ directory, or adjust ASSETS_DIR / OUTPUT_DIR below)

Requirements: ffmpeg must be in PATH.
"""

import subprocess
import sys
import os
from pathlib import Path

# Paths relative to sadik_color/ root
SCRIPT_DIR  = Path(__file__).parent
SADIK_COLOR = SCRIPT_DIR.parent.parent  # sadik_color/
ASSETS_DIR  = SADIK_COLOR / "assets" / "mp4"
OUTPUT_DIR  = SADIK_COLOR / "sadik-firmware" / "data" / "clips"


def check_ffmpeg():
    try:
        result = subprocess.run(
            ["ffmpeg", "-version"],
            capture_output=True, text=True
        )
        if result.returncode == 0:
            ver_line = result.stdout.splitlines()[0] if result.stdout else "unknown"
            print(f"[encode_all] ffmpeg found: {ver_line}")
            return True
    except FileNotFoundError:
        pass
    print("[encode_all] ERROR: ffmpeg not found in PATH.")
    print("  Install ffmpeg and ensure it is on your PATH.")
    print("  Windows: winget install ffmpeg  OR  choco install ffmpeg")
    print("  macOS:   brew install ffmpeg")
    print("  Linux:   apt install ffmpeg")
    return False


def count_input_frames(mp4_path: Path) -> int:
    """Use ffprobe to count frames. Returns -1 on failure."""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-count_frames",
                "-show_entries", "stream=nb_read_frames",
                "-of", "csv=p=0",
                str(mp4_path),
            ],
            capture_output=True, text=True, timeout=60
        )
        lines = result.stdout.strip().splitlines()
        if lines and lines[0].strip().isdigit():
            return int(lines[0].strip())
    except Exception:
        pass
    return -1


def encode_clip(mp4_path: Path, out_path: Path) -> bool:
    """Encode one .mp4 to .mjpeg. Returns True on success."""
    cmd = [
        "ffmpeg", "-y",
        "-i", str(mp4_path),
        "-vf", "fps=24,scale=160:128:flags=lanczos",
        "-q:v", "5",
        "-bsf:v", "mjpeg2jpeg",
        "-f", "mjpeg",
        str(out_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        print(f"  ERROR: ffmpeg failed for {mp4_path.name}")
        print(result.stderr[-800:] if result.stderr else "(no stderr)")
        return False
    return True


def main():
    if not check_ffmpeg():
        sys.exit(1)

    mp4_files = sorted(ASSETS_DIR.glob("*.mp4"))
    if not mp4_files:
        print(f"[encode_all] No .mp4 files found in {ASSETS_DIR}")
        sys.exit(1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"[encode_all] Input:  {ASSETS_DIR}")
    print(f"[encode_all] Output: {OUTPUT_DIR}")
    print(f"[encode_all] Clips to encode: {len(mp4_files)}")
    print()

    total_bytes = 0
    ok_count    = 0
    fail_count  = 0

    for mp4 in mp4_files:
        stem     = mp4.stem          # e.g. "idle"
        out_path = OUTPUT_DIR / f"{stem}.mjpeg"

        # Count input frames (best-effort)
        in_frames = count_input_frames(mp4)
        frame_str = str(in_frames) if in_frames >= 0 else "?"

        print(f"  {stem:<30} input_frames={frame_str:<6}", end=" ", flush=True)

        success = encode_clip(mp4, out_path)
        if success and out_path.exists():
            size = out_path.stat().st_size
            total_bytes += size
            ok_count    += 1
            print(f"-> {size:>9,} bytes  OK")
        else:
            fail_count += 1
            print(f"-> FAILED")

    total_kb = total_bytes / 1024
    total_mb = total_bytes / (1024 * 1024)
    print()
    print(f"[encode_all] Done: {ok_count} OK, {fail_count} failed")
    print(f"[encode_all] Total output size: {total_bytes:,} bytes  ({total_kb:.1f} KB / {total_mb:.2f} MB)")
    print()

    # LittleFS S3 N16R8 partition check
    # partitions_s3_n16r8.csv — typical spiffs/littlefs partition is ~1-3 MB on 16 MB flash
    # Warn if total clips exceed 3 MB (conservative estimate)
    LITTLEFS_BUDGET_MB = 3.0
    if total_mb > LITTLEFS_BUDGET_MB:
        print(f"[encode_all] WARNING: {total_mb:.2f} MB exceeds LittleFS budget estimate of {LITTLEFS_BUDGET_MB} MB.")
        print(f"             Consider reducing -q:v (higher = worse quality, smaller file).")
        print(f"             Or drop -q:v to 8-10 for text/still clips.")
    else:
        print(f"[encode_all] LittleFS budget check: {total_mb:.2f} MB < {LITTLEFS_BUDGET_MB} MB  OK")

    if fail_count:
        sys.exit(1)


if __name__ == "__main__":
    main()
