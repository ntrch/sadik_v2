# Baudrate stress test

Two-part tool to find the maximum reliable baudrate on the current ESP32 + USB-C + CP2102N hardware before committing to `feature/sadik-color`.

## Steps (PlatformIO — VS Code)

1. **Open** `tools/baud-test/pio/` as a PlatformIO project (VS Code → PIO → Open Project).
2. **Edit** `TEST_BAUD` in `pio/src/main.cpp` (default: 2000000).
3. **Upload** (PIO toolbar → →). Wait for `SUCCESS`.
4. **Close** the PIO serial monitor if it auto-opens (it will hog the port).
5. **Run** the Python receiver in a separate terminal:
   ```bash
   pip install pyserial
   python tools/baud-test/baud_test.py COM5 2000000
   ```
   (Replace `COM5` with your actual port — check Device Manager.)
6. After 30 s it prints `OK` or `FAIL` with `missed` and `corrupted` counts.

### Arduino IDE alternative
If you prefer Arduino IDE, use `esp32_send.ino` instead of the `pio/` project — same logic.

## What to try

| Step | TEST_BAUD (sketch) | `baud_test.py` arg | Expectation |
|---|---|---|---|
| 1 | 921600 | 921600 | sanity — should pass |
| 2 | 1500000 | 1500000 | should pass |
| 3 | 2000000 | 2000000 | target default |
| 4 | 3000000 | 3000000 | stretch goal |

**First baudrate that reports missed > 0 or corrupted > 0 = fail threshold.**
Use one step below that as the production default.

## Notes

- Short USB cable (< 1 m) gives the best results. Cheap 2 m cables fail early.
- Close everything else touching the COM port (PlatformIO, Arduino IDE monitor, etc.).
- Re-flash the sketch each time you change `TEST_BAUD`.
