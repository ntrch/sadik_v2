#!/usr/bin/env python3
"""
SADIK Color Codec — Round-trip self-test
Encodes a clip, decodes the result, compares frame-by-frame for bit-exact match.

Usage:
  python test_roundtrip.py [clip.mp4] [--keyframe-interval 48]
  Default clip: ../../assets/mp4/blink.mp4  (smallest available)
"""
import argparse
import sys
import tempfile
from pathlib import Path
from typing import List

import imageio.v3 as iio
import numpy as np
from PIL import Image as PILImage

# Local imports
sys.path.insert(0, str(Path(__file__).parent))
from encode import encode, rgb888_to_rgb565_le, WIDTH, HEIGHT
from decode import decode

ASSETS_DIR = Path(__file__).parent.parent.parent / 'assets' / 'mp4'


def extract_reference_frames(mp4_path: str) -> List[np.ndarray]:
    """Re-extract frames the same way encode.py does, for comparison."""
    frames_rgb = list(iio.imiter(mp4_path))
    result = []
    for frame in frames_rgb:
        img = PILImage.fromarray(frame, 'RGB')
        if img.size != (WIDTH, HEIGHT):
            img = img.resize((WIDTH, HEIGHT), PILImage.LANCZOS)
        arr = np.array(img, dtype=np.uint8)
        result.append(rgb888_to_rgb565_le(arr))
    return result


def run_roundtrip(mp4_path: str, keyframe_interval: int = 48) -> bool:
    mp4_p = Path(mp4_path)
    if not mp4_p.exists():
        print(f"FAIL: clip not found: {mp4_path}")
        return False

    print(f"\n{'='*60}")
    print(f"Round-trip test: {mp4_p.name}")
    print(f"{'='*60}")

    with tempfile.NamedTemporaryFile(suffix='.bin', delete=False) as tf:
        bin_path = tf.name

    try:
        # Step 1: Encode
        print("\n[1/3] Encoding...")
        encode(mp4_path, bin_path, keyframe_interval)

        # Step 2: Decode
        print("\n[2/3] Decoding...")
        decoded_frames = decode(bin_path)
        print(f"  Decoded {len(decoded_frames)} frames")

        # Step 3: Extract reference and compare
        print("\n[3/3] Extracting reference frames for comparison...")
        ref_frames = extract_reference_frames(mp4_path)
        print(f"  Reference frames: {len(ref_frames)}")

        if len(decoded_frames) != len(ref_frames):
            print(f"FAIL: frame count mismatch: decoded={len(decoded_frames)}, ref={len(ref_frames)}")
            return False

        # Bit-exact comparison
        mismatches = 0
        mismatch_details = []
        for i, (dec, ref) in enumerate(zip(decoded_frames, ref_frames)):
            if not np.array_equal(dec, ref):
                mismatches += 1
                diff = np.sum(dec != ref)
                mismatch_details.append((i, int(diff)))

        # Stats table
        bin_size = Path(bin_path).stat().st_size
        total_raw = len(ref_frames) * WIDTH * HEIGHT * 2
        ratio = total_raw / bin_size if bin_size else 0

        print(f"\n  --- Round-trip Stats -----------------------------------------")
        print(f"  Clip              : {mp4_p.name}")
        print(f"  Frames            : {len(ref_frames)}")
        print(f"  .bin size         : {bin_size:,} bytes")
        print(f"  Raw equivalent    : {total_raw:,} bytes")
        print(f"  Compression ratio : {ratio:.2f}x")
        print(f"  Frame mismatches  : {mismatches} / {len(ref_frames)}")

        if mismatches == 0:
            print(f"\n  PASS - bit-exact round-trip ({len(ref_frames)} frames)")
            return True
        else:
            print(f"\n  FAIL - {mismatches} frames differ")
            for fi, diff_px in mismatch_details[:10]:
                print(f"    frame {fi}: {diff_px} pixel(s) differ")
            if len(mismatch_details) > 10:
                print(f"    ... and {len(mismatch_details)-10} more")
            return False

    finally:
        Path(bin_path).unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='SADIK codec round-trip test')
    parser.add_argument('clip', nargs='?',
                        default=str(ASSETS_DIR / 'blink.mp4'),
                        help='mp4 clip to test (default: blink.mp4)')
    parser.add_argument('--keyframe-interval', type=int, default=48)
    args = parser.parse_args()

    passed = run_roundtrip(args.clip, args.keyframe_interval)
    sys.exit(0 if passed else 1)
