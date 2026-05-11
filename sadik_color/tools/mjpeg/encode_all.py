#!/usr/bin/env python3
"""
encode_all.py — SADIK Color MJPEG encoder
Converts assets/mp4/*.mp4 → sadik-firmware/data/clips/*.mjpeg

ffmpeg command per clip:
  ffmpeg -y -i in.mp4
    -vf "fps=24,scale=160:128:force_original_aspect_ratio=decrease:flags=lanczos,
         pad=160:128:(ow-iw)/2:(oh-ih)/2:black,format=yuvj420p"
    -q:v 1 -bsf:v mjpeg2jpeg -f mjpeg out.mjpeg

Filter chain rationale:
  * scale with force_original_aspect_ratio=decrease -- preserves source aspect (no stretch
    for 160x126 sources); shrinks to fit inside 160x128 if needed.
  * pad=160:128 centered -- fills remaining pixels with black (for 160x126 -> adds 1px top
    + 1px bottom instead of stretching 2px).
  * -q:v 1 -- maximum JPEG quality (~98%); was 2 (~95%).  Files grow ~30% but tone
    fidelity on the TFT improves noticeably.

Usage:
  python tools/mjpeg/encode_all.py
  (run from sadik_color/ directory, or adjust ASSETS_DIR / OUTPUT_DIR below)

Requirements: ffmpeg must be in PATH.
"""

import json
import subprocess
import sys
import os
from datetime import datetime, timezone
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


def probe_source_fps(mp4_path: Path) -> float:
    """Return source MP4 avg fps via ffprobe, or -1.0 on failure."""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=avg_frame_rate",
                "-of", "csv=p=0",
                str(mp4_path),
            ],
            capture_output=True, text=True, timeout=30
        )
        s = result.stdout.strip()
        if "/" in s:
            num, den = s.split("/", 1)
            num, den = int(num), int(den)
            if den > 0:
                return num / den
    except Exception:
        pass
    return -1.0


def count_mjpeg_frames(mjpeg_path: Path) -> int:
    """Count JPEG SOI markers (0xFFD8) in the encoded .mjpeg → output frame count."""
    try:
        data = mjpeg_path.read_bytes()
        count = 0
        i = 0
        while i < len(data) - 1:
            if data[i] == 0xFF and data[i + 1] == 0xD8:
                count += 1
                i += 2
            else:
                i += 1
        return count
    except Exception:
        return -1


def encode_clip(mp4_path: Path, out_path: Path) -> bool:
    """Encode one .mp4 to .mjpeg. Returns True on success."""
    cmd = [
        "ffmpeg", "-y",
        "-i", str(mp4_path),
        # Scale preserving aspect ratio (no stretch for 160x126 sources),
        # then pad to exact 160x128 centered with black -> yuvj420p
        # (full-range JPEG colour space, no clipping on TFT).
        "-vf", (
            "fps=24,"
            "scale=160:128:force_original_aspect_ratio=decrease:flags=lanczos,"
            "pad=160:128:(ow-iw)/2:(oh-ih)/2:black,"
            "format=yuvj420p"
        ),
        # -q:v 1 = maximum JPEG quality (~98%); previously 2 (~95%).
        # Files are ~30% larger but mid-tone fidelity improves on TFT.
        "-q:v", "1",
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

        in_frames = count_input_frames(mp4)
        src_fps   = probe_source_fps(mp4)
        src_str   = (f"{in_frames}f@{src_fps:.0f}fps"
                     if in_frames >= 0 and src_fps > 0 else "?")

        print(f"  {stem:<30} src={src_str:<14}", end=" ", flush=True)

        success = encode_clip(mp4, out_path)
        if success and out_path.exists():
            size      = out_path.stat().st_size
            out_count = count_mjpeg_frames(out_path)
            out_str   = f"{out_count}f@24fps" if out_count >= 0 else "?"
            total_bytes += size
            ok_count    += 1
            print(f"-> {out_str:<10}  {size:>9,} bytes  OK")
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
    # partitions_s3_n16r8.csv: spiffs offset=0x610000 size=0x9F0000 → 9.9375 MB usable.
    # LittleFS overhead ~2%, effective ≈ 9.74 MB. Leave 0.5 MB headroom for manifest.json
    # and future clip additions → warn threshold = 9.2 MB.
    LITTLEFS_BUDGET_MB = 9.2
    if total_mb > LITTLEFS_BUDGET_MB:
        print(f"[encode_all] WARNING: {total_mb:.2f} MB exceeds LittleFS budget of {LITTLEFS_BUDGET_MB} MB.")
        print(f"             Partition capacity ≈ 9.74 MB (0x9F0000 raw).")
        print(f"             Options: raise -q:v to 3-4 (slightly lower quality, smaller files)")
        print(f"             or ask Eren to extend littlefs partition to 0xBF0000 (12 MB).")
    else:
        print(f"[encode_all] LittleFS budget check: {total_mb:.2f} MB < {LITTLEFS_BUDGET_MB} MB  OK")
        print(f"             (partition capacity ≈ 9.74 MB; headroom = {9.74 - total_mb:.2f} MB)")

    if fail_count:
        sys.exit(1)

    # ── Manifest auto-regen ──────────────────────────────────────────────────
    # Re-generate data/manifest.json from the actual .mjpeg files produced above.
    # Preserves existing "loop" values where available; new clips default to false.
    # dancing.mjpeg is picked up even if absent from the previous manifest.
    manifest_path = OUTPUT_DIR.parent / "manifest.json"

    # Load existing manifest for loop values (best-effort)
    existing_loop: dict = {}
    if manifest_path.exists():
        try:
            existing = json.loads(manifest_path.read_text(encoding="utf-8"))
            for entry in existing.get("clips", []):
                existing_loop[entry["name"]] = bool(entry.get("loop", False))
        except Exception:
            pass  # Start fresh if corrupt

    mjpeg_files = sorted(OUTPUT_DIR.glob("*.mjpeg"))
    clips_list = []
    for mf in mjpeg_files:
        name = mf.stem
        clips_list.append({
            "name":  name,
            "bytes": mf.stat().st_size,
            "loop":  existing_loop.get(name, False),
            "fps":   24,
        })

    manifest_data = {
        "version":   1,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
        "clips":     clips_list,
    }
    manifest_path.write_text(
        json.dumps(manifest_data, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"[encode_all] manifest.json regenerated: {len(clips_list)} clips -> {manifest_path}")
    dancing_note = " (dancing included)" if any(c["name"] == "dancing" for c in clips_list) else ""
    print(f"             {[c['name'] for c in clips_list]}{dancing_note}")


if __name__ == "__main__":
    main()
