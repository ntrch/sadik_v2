"""ESP32 baudrate stress-test receiver.

Pairs with tools/baud-test/esp32_send.ino. Counts how many sequenced lines
arrive intact over a 30-second window and prints missed/corrupted counts.

Usage (Windows, bash):
    pip install pyserial
    python baud_test.py COM5 2000000

The ESP32 sketch must be flashed with TEST_BAUD == the rate passed here.
Zero missed + zero corrupted over 30 s = that baudrate is safe.
"""
from __future__ import annotations

import sys
import time

import serial  # type: ignore  # requires `pip install pyserial`


DURATION_S = 30


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: python baud_test.py <port> <baud>")
        print("Example: python baud_test.py COM5 2000000")
        return 2

    port = sys.argv[1]
    baud = int(sys.argv[2])

    try:
        s = serial.Serial(port, baud, timeout=1)
    except serial.SerialException as exc:
        print(f"[open] FAILED: {exc}")
        return 1

    print(f"[open] {port} @ {baud} — reading for {DURATION_S} s...")

    lines = missed = corrupted = 0
    last_seq = -1
    bytes_read = 0
    last_debug = 0.0
    start = time.monotonic()
    s.reset_input_buffer()

    while time.monotonic() - start < DURATION_S:
        raw = s.readline()
        now = time.monotonic()
        if now - last_debug >= 2.0:
            print(f"  [debug t={now-start:4.1f}s] bytes={bytes_read} lines={lines} missed={missed} corrupted={corrupted} last_raw={raw[:40]!r}", flush=True)
            last_debug = now
        if not raw:
            continue
        bytes_read += len(raw)
        try:
            line = raw.decode("ascii").strip()
        except UnicodeDecodeError:
            corrupted += 1
            continue

        if not line.startswith("SEQ="):
            corrupted += 1
            continue
        try:
            seq = int(line[4:12])
        except ValueError:
            corrupted += 1
            continue

        if last_seq >= 0:
            gap = seq - last_seq - 1
            if gap > 0:
                missed += gap
            elif gap < 0:
                corrupted += 1  # out-of-order or wraparound glitch
        last_seq = seq
        lines += 1

    s.close()
    elapsed = time.monotonic() - start
    throughput_kb = bytes_read / 1024 / elapsed
    status = "OK" if (missed == 0 and corrupted == 0) else "FAIL"

    print(f"[result] baud={baud}  {status}")
    print(f"         lines={lines}  missed={missed}  corrupted={corrupted}")
    print(f"         throughput={throughput_kb:.1f} KB/s over {elapsed:.1f} s")
    return 0 if status == "OK" else 1


if __name__ == "__main__":
    sys.exit(main())
