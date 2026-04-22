"""Minimal byte probe: 10 saniye boyunca her saniye gelen byte miktarını ve ilk 60 byte'ı yazar."""
import sys
import time

import serial  # type: ignore


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: python byte_probe.py <port> <baud>")
        return 2

    port = sys.argv[1]
    baud = int(sys.argv[2])

    s = serial.Serial(port, baud, timeout=0.1)
    print(f"[open] {port} @ {baud}", flush=True)
    s.reset_input_buffer()

    start = time.monotonic()
    total = 0
    tick = start
    buf = b""
    while time.monotonic() - start < 10.0:
        chunk = s.read(4096)
        if chunk:
            total += len(chunk)
            if len(buf) < 60:
                buf += chunk[: 60 - len(buf)]
        now = time.monotonic()
        if now - tick >= 1.0:
            print(f"  t={now-start:4.1f}s  total={total} bytes  sample={buf!r}", flush=True)
            tick = now

    s.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
