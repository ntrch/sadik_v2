#!/usr/bin/env python3
"""
encode_all.py — SADIK v3 (T-Display-S3) MJPEG encoder
Converts assets/mp4/*.mp4 → sadik-firmware/data/clips/*.mjpeg

Target display: ST7789 320×170, landscape orientation.

ffmpeg command per clip:
  ffmpeg -y -i in.mp4
    -vf "fps=24,scale=320:170:force_original_aspect_ratio=decrease:flags=lanczos,
         pad=320:170:(ow-iw)/2:(oh-ih)/2:black,format=yuvj420p"
    -q:v 2 -bsf:v mjpeg2jpeg -f mjpeg out.mjpeg

  NOTE: -q:v 2 corresponds to JPEG quality ~Q85 (ffmpeg scale: 1=best, 31=worst).

Filter chain rationale:
  * scale with force_original_aspect_ratio=decrease -- preserves source aspect,
    shrinks to fit inside 320x170 without stretching.
  * pad=320:170 centered -- fills remaining pixels with black.
  * -q:v 2 -- JPEG quality ~Q85; balance between file size and TFT fidelity.

Dimensions: 320×170 (was 160×128 in sadik_color; updated for T-Display-S3).
Quality:    Q=85 (~-q:v 2). Adjust TARGET_QUALITY constant or --quality CLI arg.

Usage:
  python scripts/encode_all.py                    # default paths
  python scripts/encode_all.py --quality 3        # lower quality, smaller files
  python scripts/encode_all.py --sync-ts ../../sadik-app/src/assets/colorClipManifest.ts
  (run from sadik_v3/ directory, or adjust ASSETS_DIR / OUTPUT_DIR below)

  --sync-ts <path>  After encoding, write a TS colorClipManifest from the manifest.json.

Requirements: ffmpeg + ffprobe must be in PATH.
"""

import argparse
import json
import subprocess
import sys
import os
from datetime import datetime, timezone
from pathlib import Path

# ── Encoding parameters (320×170, Q=85) ────────────────────────────────────
TARGET_W   = 320   # output frame width  (T-Display-S3 landscape)
TARGET_H   = 170   # output frame height (T-Display-S3 landscape)
TARGET_FPS = 24    # output frame rate
# ffmpeg -q:v scale: 1=best quality, 31=worst. Q=85 ≈ -q:v 2.
TARGET_QUALITY = 2  # -q:v value (approx JPEG Q=85)

# Paths relative to sadik_v3/ root (two levels up from this script)
SCRIPT_DIR = Path(__file__).parent
SADIK_V3   = SCRIPT_DIR.parent          # sadik_v3/sadik-firmware/
SADIK_V3_ROOT = SADIK_V3.parent         # sadik_v3/
ASSETS_DIR = SADIK_V3_ROOT / "assets" / "mp4"
OUTPUT_DIR = SADIK_V3 / "data" / "clips"


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


def encode_clip(mp4_path: Path, out_path: Path, quality: int) -> bool:
    """Encode one .mp4 to .mjpeg at TARGET_W x TARGET_H. Returns True on success."""
    vf = (
        f"fps={TARGET_FPS},"
        f"scale={TARGET_W}:{TARGET_H}:force_original_aspect_ratio=decrease:flags=lanczos,"
        f"pad={TARGET_W}:{TARGET_H}:(ow-iw)/2:(oh-ih)/2:black,"
        "format=yuvj420p"
    )
    cmd = [
        "ffmpeg", "-y",
        "-i", str(mp4_path),
        "-vf", vf,
        # -q:v 2 ≈ JPEG Q=85; increase value (3-5) to reduce file size at lower quality.
        "-q:v", str(quality),
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


def write_ts_manifest(manifest_data: dict, ts_path: Path) -> None:
    """
    Write a colorClipManifest.ts from manifest_data (clips-manifest.json schema).
    Output matches the object-literal export format used by sadik-app.
    Duration = round(frames / fps * 1000) ms.
    """
    clips = manifest_data.get("clips", [])
    generated = manifest_data.get("generated", "unknown")

    lines = []
    lines.append("/**")
    lines.append(f" * Color clip duration map — auto-generated by encode_all.py --sync-ts")
    lines.append(f" * Generated: {generated}")
    lines.append(f" * Source: sadik_v3/sadik-firmware/data/clips/*.mjpeg @ {TARGET_FPS}fps")
    lines.append(" *")
    lines.append(" * Usage: import { COLOR_CLIP_DURATION_MS, COLOR_CLIP_FALLBACK_MS } from './colorClipManifest';")
    lines.append(" *        const gap = COLOR_CLIP_DURATION_MS[clipName] ?? COLOR_CLIP_FALLBACK_MS;")
    lines.append(" */")
    lines.append("")
    lines.append("/** Fallback gap (ms) when clip name is not in the map. */")
    lines.append("export const COLOR_CLIP_FALLBACK_MS = 1500;")
    lines.append("")
    lines.append("/**")
    lines.append(" * LittleFS clip name -> duration in milliseconds.")
    lines.append(f" * Derived from actual frame count parsed from each .mjpeg at {TARGET_FPS} fps.")
    lines.append(" */")
    lines.append("export const COLOR_CLIP_DURATION_MS: Record<string, number> = {")

    # compute max name length for alignment
    max_len = max((len(c["name"]) for c in clips), default=10)

    for clip in clips:
        name   = clip["name"]
        frames = clip.get("frames", 0)
        fps    = clip.get("fps", TARGET_FPS) or TARGET_FPS
        dur_ms = round(frames / fps * 1000) if frames else 0
        pad    = " " * (max_len - len(name) + 1)
        lines.append(f"  {name}{pad}: {dur_ms},")

    lines.append("};")
    lines.append("")

    ts_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"[encode_all] colorClipManifest.ts written -> {ts_path}")


def main():
    parser = argparse.ArgumentParser(description="SADIK v3 MJPEG encoder (320x170 Q=85)")
    parser.add_argument(
        "--quality", type=int, default=TARGET_QUALITY,
        help=f"ffmpeg -q:v value (1=best/~Q98, 2=~Q85, 3=~Q75, ...). Default: {TARGET_QUALITY}"
    )
    parser.add_argument(
        "--sync-ts", metavar="TS_PATH", default=None,
        help="After encoding, write colorClipManifest.ts to this path."
    )
    args = parser.parse_args()

    if not check_ffmpeg():
        sys.exit(1)

    mp4_files = sorted(ASSETS_DIR.glob("*.mp4"))
    if not mp4_files:
        print(f"[encode_all] No .mp4 files found in {ASSETS_DIR}")
        sys.exit(1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"[encode_all] Target:  {TARGET_W}x{TARGET_H} @ {TARGET_FPS}fps, JPEG -q:v {args.quality} (~Q85)")
    print(f"[encode_all] Input:   {ASSETS_DIR}")
    print(f"[encode_all] Output:  {OUTPUT_DIR}")
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

        success = encode_clip(mp4, out_path, args.quality)
        if success and out_path.exists():
            size      = out_path.stat().st_size
            out_count = count_mjpeg_frames(out_path)
            out_str   = f"{out_count}f@{TARGET_FPS}fps" if out_count >= 0 else "?"
            total_bytes += size
            ok_count    += 1
            print(f"-> {out_str:<12}  {size:>9,} bytes  OK")
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
    # partitions_s3_n16r8.csv: spiffs offset=0x610000 size=0x9F0000 -> 9.9375 MB usable.
    # LittleFS overhead ~2%, effective ~9.74 MB. Warn threshold = 9.2 MB.
    LITTLEFS_BUDGET_MB = 9.2
    if total_mb > LITTLEFS_BUDGET_MB:
        print(f"[encode_all] WARNING: {total_mb:.2f} MB exceeds LittleFS budget of {LITTLEFS_BUDGET_MB} MB.")
        print(f"             Partition capacity ~9.74 MB (0x9F0000 raw).")
        print(f"             Options: raise -q:v to 3-4 (lower quality, smaller files)")
        print(f"             or extend littlefs partition to 0xBF0000 (12 MB).")
    else:
        print(f"[encode_all] LittleFS budget check: {total_mb:.2f} MB < {LITTLEFS_BUDGET_MB} MB  OK")
        print(f"             (partition capacity ~9.74 MB; headroom = {9.74 - total_mb:.2f} MB)")

    if fail_count:
        sys.exit(1)

    # ── Manifest auto-regen ──────────────────────────────────────────────────
    # Re-generate data/clips-manifest.json from the actual .mjpeg files produced.
    # Preserves existing "loop" values; new clips default to false.
    manifest_path = OUTPUT_DIR / "clips-manifest.json"

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
        name   = mf.stem
        frames = count_mjpeg_frames(mf)
        clips_list.append({
            "name":   name,
            "bytes":  mf.stat().st_size,
            "frames": frames if frames >= 0 else 0,
            "fps":    TARGET_FPS,
            "loop":   existing_loop.get(name, False),
        })

    manifest_data = {
        "version":   1,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
        "target":    {"width": TARGET_W, "height": TARGET_H, "fps": TARGET_FPS, "quality_qv": args.quality},
        "clips":     clips_list,
    }
    manifest_path.write_text(
        json.dumps(manifest_data, indent=2) + "\n",
        encoding="utf-8",
    )
    names = [c["name"] for c in clips_list]
    print(f"[encode_all] clips-manifest.json regenerated: {len(clips_list)} clips -> {manifest_path}")
    print(f"             {names}")

    # ── Optional TS sync ────────────────────────────────────────────────────
    if args.sync_ts:
        ts_path = Path(args.sync_ts)
        ts_path.parent.mkdir(parents=True, exist_ok=True)
        write_ts_manifest(manifest_data, ts_path)


if __name__ == "__main__":
    main()
