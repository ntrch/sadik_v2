import asyncio
import logging
import time
from typing import Optional
import serial
import serial.tools.list_ports

logger = logging.getLogger(__name__)

# Keywords indicating likely USB-serial adapters / dev boards
_SADIK_KEYWORDS = [
    "cp210", "cp2102", "ch340", "ch9102", "silicon labs",
    "usb serial", "usb uart", "uart bridge", "esp32", "esp",
    "devkit", "ftdi", "prolific",
]


class SerialService:
    def __init__(self):
        self._serial: Optional[serial.Serial] = None
        self._lock = asyncio.Lock()
        self._active_port: Optional[str] = None
        # Last DEVICE: line received at connect time — Multi-device Sprint-1
        self.last_device_line: Optional[str] = None

    @property
    def is_connected(self) -> bool:
        return self._serial is not None and self._serial.is_open

    def list_ports(self) -> list[dict]:
        ports = []
        for p in serial.tools.list_ports.comports():
            ports.append({"port": p.device, "description": p.description, "hwid": p.hwid})
        return ports

    def _rank_ports(self) -> tuple[list, list]:
        """Return (preferred_ports, other_ports) where preferred match SADIK keyword heuristics."""
        all_ports = list(serial.tools.list_ports.comports())
        preferred = []
        others = []
        for p in all_ports:
            desc = (p.description or "").lower()
            hwid = (p.hwid or "").lower()
            if any(kw in desc or kw in hwid for kw in _SADIK_KEYWORDS):
                preferred.append(p.device)
            else:
                others.append(p.device)
        return preferred, others

    def _find_esp32_port(self) -> Optional[str]:
        preferred, others = self._rank_ports()
        if preferred:
            return preferred[0]
        if others:
            return others[0]
        return None

    def _try_open_and_verify_sync(self, port: str, baudrate: int) -> Optional[serial.Serial]:
        """Open port, send PING, wait for PONG/SADIK:READY, then query DEVICE?.
        Returns an open serial.Serial if verified, None otherwise.
        Caller owns the returned object and must close it when done.

        Handshake sequence (Bug 1 + Bug 2 fix):
        1. Open port, settle 0.2 s, flush RX buffer.
        2. Send PING — verify the device is a SADIK firmware.
        3. After PONG/SADIK:READY: flush buffer again (discard stale PONG/boot noise),
           then send DEVICE?\n to request device profile deterministically.
        4. Capture the DEVICE: response in a tight 1.0 s window.
        5. Store in self.last_device_line; discard trailing RX noise.

        Hard budget: ~2.5 s total (0.2 s settle + 1.0 s PING window + 0.2 s flush
        + 1.0 s DEVICE? window).  write_timeout ensures writes never block forever.
        """
        s = None
        captured_device_line: Optional[str] = None
        try:
            logger.debug(f"Trying port {port}")
            s = serial.Serial(port, baudrate, timeout=1.0, write_timeout=1.0)
            logger.debug(f"Opened port {port}")
            time.sleep(0.2)  # brief settle — DTR reset on Windows may trigger reboot
            s.reset_input_buffer()

            # ── Phase 1: PING verification ────────────────────────────────────
            logger.debug(f"Sending PING to {port}")
            s.write(b"PING\n")
            s.flush()
            deadline = time.monotonic() + 1.0
            verified = False
            while time.monotonic() < deadline:
                if s.in_waiting > 0:
                    line = s.readline().decode("utf-8", errors="replace").strip()
                    if not line:
                        continue
                    # Skip boot-time noise that may arrive before PONG
                    if (line.startswith("DEVICE:") or
                            line.startswith("MANIFEST:") or
                            line.startswith("DEBUG:") or
                            line.startswith("STATUS:")):
                        logger.debug(f"Handshake skip during PING phase: {line!r}")
                        continue
                    if line in ("PONG", "SADIK:READY"):
                        logger.info(f"Verification success on {port}: got '{line}'")
                        verified = True
                        break
                time.sleep(0.02)

            if not verified:
                logger.debug(f"Verification fail on {port}: no SADIK response within deadline")
                try:
                    if s and s.is_open:
                        s.close()
                except Exception:
                    pass
                return None

            # ── Phase 2: DEVICE? query — deterministic device profile ─────────
            # Flush any remaining bytes (stale PONG copies, SADIK:READY, noise)
            # so the DEVICE? response arrives clean.
            time.sleep(0.05)
            s.reset_input_buffer()
            logger.debug(f"Sending DEVICE? to {port}")
            s.write(b"DEVICE?\n")
            s.flush()
            deadline = time.monotonic() + 1.0
            while time.monotonic() < deadline:
                if s.in_waiting > 0:
                    line = s.readline().decode("utf-8", errors="replace").strip()
                    if not line:
                        continue
                    if line.startswith("DEVICE:"):
                        captured_device_line = line
                        logger.info(f"Device profile on {port}: {line}")
                        break
                    # Skip other noise (MANIFEST:, DEBUG:, STATUS:)
                    logger.debug(f"Handshake skip during DEVICE? phase: {line!r}")
                time.sleep(0.02)

            # Flush trailing RX noise so normal operation starts clean
            time.sleep(0.05)
            s.reset_input_buffer()

            self.last_device_line = captured_device_line
            if not captured_device_line:
                logger.info(f"No DEVICE: line on {port} — will use fallback profile")
            return s  # verified — caller takes ownership
        except Exception as e:
            logger.debug(f"Port {port} open/verify failed: {e}")
        # Verification failed — close cleanly
        logger.debug(f"Closing failed port {port}")
        try:
            if s and s.is_open:
                s.close()
        except Exception:
            pass
        return None

    async def auto_detect_and_connect(self, baudrate: int = 460800) -> dict:
        """Scan all serial ports, verify SADIK device via PING/PONG protocol,
        and keep the connection open on first match.

        Returns a dict with: connected, port, method, message, scanned_ports,
        matched_ports, error.
        """
        async with self._lock:
            # Already connected and healthy — skip redundant scan
            if self.is_connected:
                port = self._active_port or "unknown"
                logger.info(f"Auto-detect: already connected on {port}")
                return {
                    "connected": True,
                    "port": port,
                    "method": "auto",
                    "message": f"SADIK cihazı zaten bağlı ({port}).",
                    "scanned_ports": 0,
                    "matched_ports": [],
                    "error": None,
                }

            loop = asyncio.get_event_loop()
            preferred, others = await loop.run_in_executor(None, self._rank_ports)
            all_candidates = preferred + others
            scanned = len(all_candidates)

            logger.info(
                f"Auto-detect: scanning {scanned} port(s). "
                f"Preferred: {preferred}, Fallback: {others}"
            )

            for port in all_candidates:
                # Hard per-port timeout: if the executor thread stalls (e.g. on a
                # Bluetooth COM port or ghost port whose Serial() constructor blocks),
                # we time out from the async side and move on.  The stalled thread
                # will eventually complete on its own and its result is discarded.
                try:
                    verified_serial = await asyncio.wait_for(
                        loop.run_in_executor(
                            None, self._try_open_and_verify_sync, port, baudrate
                        ),
                        timeout=2.0,
                    )
                except asyncio.TimeoutError:
                    logger.warning(f"Auto-detect: port {port} verification timed out — skipping")
                    verified_serial = None
                if verified_serial is not None:
                    self._serial = verified_serial
                    self._active_port = port
                    logger.info(f"Auto-connect success: {port}")
                    return {
                        "connected": True,
                        "port": port,
                        "method": "auto",
                        "message": f"SADIK cihazı otomatik bağlandı ({port}).",
                        "scanned_ports": scanned,
                        "matched_ports": [port],
                        "error": None,
                    }

            logger.info("Auto-detect: no SADIK device found on any port")
            return {
                "connected": False,
                "port": None,
                "method": "auto",
                "message": "SADIK cihazı otomatik olarak algılanamadı.",
                "scanned_ports": scanned,
                "matched_ports": [],
                "error": "No SADIK device responded to PING on any available port.",
            }

    async def open(self, port: str, baudrate: int = 460800) -> bool:
        """Open serial port for manual (non-auto-detect) connection.

        Bug 1 fix: adds settle + reset_input_buffer so boot-time noise (DEVICE:,
        SADIK:READY) is not left in the RX buffer to confuse the frame writer.
        Bug 2 fix: sends DEVICE?\n after open to capture device profile the same
        way auto-detect does, enabling device_profile WS broadcast on manual connect.
        """
        loop = asyncio.get_event_loop()
        try:
            if port == "auto":
                port = self._find_esp32_port()
                if not port:
                    logger.error("No serial port found for auto detection")
                    return False

            def _open_and_query() -> bool:
                s = serial.Serial(port, baudrate, timeout=1.0, write_timeout=1.0)
                time.sleep(0.2)       # settle — DTR may reset the ESP32 on Windows
                s.reset_input_buffer()  # discard boot-time DEVICE: / SADIK:READY noise

                # Query device profile so device_profile WS broadcast works on manual connect
                captured: Optional[str] = None
                try:
                    s.write(b"DEVICE?\n")
                    s.flush()
                    deadline = time.monotonic() + 1.0
                    while time.monotonic() < deadline:
                        if s.in_waiting > 0:
                            raw = s.readline().decode("utf-8", errors="replace").strip()
                            if raw.startswith("DEVICE:"):
                                captured = raw
                                logger.info(f"Device profile on {port}: {raw}")
                                break
                            logger.debug(f"Manual open DEVICE? skip: {raw!r}")
                        time.sleep(0.02)
                except Exception as eq:
                    logger.debug(f"DEVICE? query failed on {port}: {eq}")

                # Flush any remaining noise before normal operation
                s.reset_input_buffer()
                self.last_device_line = captured
                self._serial = s
                return True

            ok = await loop.run_in_executor(None, _open_and_query)
            if ok:
                self._active_port = port
                logger.info(f"Serial opened on {port} at {baudrate}")
            return ok
        except Exception as e:
            logger.error(f"Failed to open serial: {e}")
            self._serial = None
            self._active_port = None
            return False

    async def close(self):
        if self._serial and self._serial.is_open:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self._serial.close)
            self._serial = None
            self._active_port = None
            logger.info("Serial closed")

    async def send(self, command: str) -> bool:
        if not self.is_connected:
            return False
        loop = asyncio.get_event_loop()
        try:
            data = (command + "\n").encode("utf-8")
            await loop.run_in_executor(None, self._serial.write, data)
            return True
        except Exception as e:
            logger.error(f"Serial send error: {e}")
            return False

    async def read_line(self) -> Optional[str]:
        if not self.is_connected:
            return None
        loop = asyncio.get_event_loop()
        try:
            def _read():
                if self._serial.in_waiting > 0:
                    return self._serial.readline().decode("utf-8", errors="replace").strip()
                return None
            return await loop.run_in_executor(None, _read)
        except Exception as e:
            logger.error(f"Serial read error: {e}")
            return None

    async def send_and_read(self, command: str, read_timeout: float = 2.0) -> tuple[bool, Optional[str]]:
        """Send a command and wait for the first meaningful response line.

        Acquires the instance lock so commands are fully serialised — no two
        exchanges can overlap.  This prevents mixed responses when brightness
        and sleep-timeout commands are applied in quick succession.

        Per-exchange flow:
          1. Reset the RX buffer to discard stale bytes (EVENT: lines, etc.)
          2. Write the command and flush the TX buffer.
          3. Read lines one at a time; skip DEBUG: / EVENT: / empty lines.
          4. Return the first OK: / ERR: / STATUS: / PONG line, or None on timeout.
        """
        if not self.is_connected:
            return False, None

        async with self._lock:
            loop = asyncio.get_event_loop()

            def _exchange() -> Optional[str]:
                # 1. Drain any stale input that arrived since the last command.
                self._serial.reset_input_buffer()
                # 2. Write command and flush the OS TX buffer immediately.
                self._serial.write((command + "\n").encode("utf-8"))
                self._serial.flush()

                deadline = time.monotonic() + read_timeout
                while time.monotonic() < deadline:
                    try:
                        raw = self._serial.readline()
                    except Exception as e:
                        logger.error(f"Serial readline error: {e}")
                        return None
                    # readline() returns b"" when the per-character timeout
                    # elapses without a newline — just retry until deadline.
                    if not raw:
                        continue
                    line = raw.decode("utf-8", errors="replace").strip()
                    if not line:
                        continue
                    # Skip async firmware noise — these are never command responses.
                    # DEVICE: and MANIFEST: can appear if firmware resets mid-session;
                    # treat them the same as DEBUG:/EVENT: to avoid eating the ACK window.
                    if (line.startswith("DEBUG:") or
                            line.startswith("EVENT:") or
                            line.startswith("DEVICE:") or
                            line.startswith("MANIFEST:")):
                        logger.debug("Serial skipped line: %r", line)
                        continue
                    # Accept the first proper response token.
                    if (line.startswith("OK:") or
                            line.startswith("ERR:") or
                            line.startswith("STATUS:") or
                            line == "PONG"):
                        logger.debug("Serial response: %r", line)
                        return line
                    # Unrecognised line — log and keep reading.
                    logger.debug("Serial unknown line: %r", line)
                return None

            try:
                response = await loop.run_in_executor(None, _exchange)
                return True, response
            except Exception as e:
                logger.error(f"Serial send_and_read error: {e}")
                return True, None


serial_service = SerialService()
