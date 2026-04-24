import asyncio
import logging
from pathlib import Path
from typing import Optional
from app.services.serial_service import serial_service
from app.services.wifi_device_service import wifi_device_service

logger = logging.getLogger(__name__)

# ── Clip registry ─────────────────────────────────────────────────────────────
# .bin files live in sadik-backend/../assets/codec/<name>.bin
# This mirrors the webpack CopyPlugin convention: assets/codec/ is served as
# /animations/personas/sadik/codec/ by the Electron/webpack frontend.
# Backend resolves to the same source tree directory; no duplication.
_ASSETS_CODEC_DIR = (
    Path(__file__).resolve()          # device_manager.py
    .parent.parent.parent             # sadik_color/
    / "assets" / "codec"
)


def resolve_clip_bin(name: str) -> Optional[Path]:
    """Resolve clip name → absolute .bin path.  Returns None if not found."""
    p = _ASSETS_CODEC_DIR / f"{name}.bin"
    if p.exists():
        return p
    logger.warning(f"Clip not found: {p}")
    return None

class DeviceManager:
    def __init__(self):
        self._method: Optional[str] = None
        self._port: Optional[str] = None
        self._ip: Optional[str] = None
        self._active_stream_task: Optional[asyncio.Task] = None

    async def connect(self, method: str, port: Optional[str] = None, ip: Optional[str] = None, baudrate: int = 921600) -> bool:
        await self.disconnect()
        if method == "serial":
            success = await serial_service.open(port or "auto", baudrate)
            if success:
                self._method = "serial"
                self._port = port
            return success
        elif method == "wifi":
            if not ip:
                return False
            reachable = await wifi_device_service.ping(ip)
            if reachable:
                self._method = "wifi"
                self._ip = ip
            return reachable
        return False

    async def auto_connect(
        self,
        baudrate: int = 921600,
        retries: int = 1,
        retry_delay: float = 2.0,
    ) -> dict:
        """Auto-detect SADIK device via serial protocol verification and connect."""
        # If already connected via WiFi, return success immediately
        if self._method == "wifi":
            return {
                "connected": True,
                "port": None,
                "method": "auto",
                "message": "SADIK cihazı WiFi üzerinden zaten bağlı.",
                "scanned_ports": 0,
                "matched_ports": [],
                "error": None,
            }

        result = await serial_service.auto_detect_and_connect(
            baudrate, retries=retries, retry_delay=retry_delay
        )

        if result["connected"]:
            self._method = "serial"
            self._port = result["port"]
        else:
            # Clear stale state if the connection we thought we had is gone
            if self._method == "serial" and not serial_service.is_connected:
                self._method = None
                self._port = None

        return result

    async def disconnect(self):
        if self._method == "serial":
            await serial_service.close()
        self._method = None
        self._port = None
        self._ip = None

    async def send_command(self, command: str) -> tuple[bool, Optional[str]]:
        if not self._method:
            return False, "Not connected"
        if self._method == "serial":
            ok = await serial_service.send(command)
            return ok, None if ok else "Serial send failed"
        elif self._method == "wifi":
            ok = await wifi_device_service.send_command(self._ip, command)
            return ok, None if ok else "WiFi send failed"
        return False, "Unknown method"

    async def send_frame_acked(self, frame_bytes: bytes, timeout: float = 0.25) -> tuple[bool, Optional[str]]:
        """Send FRAME:<40960 binary bytes>\n and wait for firmware's OK:FRAME ack.

        Returns (ok, error). When timeout elapses without ack we return
        (False, "timeout") so the caller can drop the frame rather than
        block the next one.
        """
        if not self._method:
            return False, "Not connected"
        if self._method == "serial":
            ok, response = await serial_service.send_frame_binary(
                frame_bytes, read_timeout=timeout,
            )
            if not ok:
                return False, "Serial send failed"
            if response is None:
                return False, "timeout"
            return True, None
        # WiFi path: fire-and-forget binary frame
        ok = await wifi_device_service.send_command(self._ip, b"FRAME:" + frame_bytes + b"\n")
        return ok, None if ok else "WiFi send failed"

    async def send_command_and_read(self, command: str) -> tuple[bool, Optional[str], Optional[str]]:
        """Send a command and read back the firmware's OK:/ERR: response line.
        Returns (sent_ok, response_line_or_None, error_message_or_None).
        """
        if not self._method:
            return False, None, "Not connected"
        if self._method == "serial":
            ok, response = await serial_service.send_and_read(command)
            return ok, response, None if ok else "Serial send failed"
        elif self._method == "wifi":
            # WiFi path does not support synchronous read-back
            ok = await wifi_device_service.send_command(self._ip, command)
            return ok, None, None if ok else "WiFi send failed"
        return False, None, "Unknown method"

    def get_status(self) -> dict:
        connected = False
        if self._method == "serial":
            connected = serial_service.is_connected
        elif self._method == "wifi":
            connected = True
        return {
            "connected": connected,
            "method": self._method,
            "port": self._port,
            "ip": self._ip,
        }

    # ── Codec clip streaming ──────────────────────────────────────────────────

    async def play_clip(self, name: str, loop: bool = False) -> dict:
        """
        Start streaming a .bin clip to the device (serial only for now).

        Resolves the clip name to a .bin path, cancels any in-flight stream,
        then fires the new stream in a background asyncio.Task so this method
        returns immediately.  The caller can await the task if it needs to know
        when the clip finishes.

        Returns a status dict so the HTTP layer can respond synchronously.
        """
        if self._method != "serial":
            return {"success": False, "error": "play_clip requires serial connection"}

        bin_path = resolve_clip_bin(name)
        if bin_path is None:
            return {"success": False, "error": f"Clip not found: {name}"}

        # Stop any running stream first
        await self.stop_clip()

        logger.info(f"play_clip: starting {name} (loop={loop})")
        self._active_stream_task = asyncio.create_task(
            serial_service.streamCodec(str(bin_path), loop=loop),
            name=f"codec_stream_{name}",
        )
        return {"success": True, "clip": name, "loop": loop}

    async def stop_clip(self) -> None:
        """Abort an in-flight codec stream (no-op if nothing is streaming)."""
        serial_service.stopCodec()
        if self._active_stream_task and not self._active_stream_task.done():
            logger.info("stop_clip: waiting for stream task to exit")
            try:
                await asyncio.wait_for(self._active_stream_task, timeout=3.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._active_stream_task.cancel()
        self._active_stream_task = None


device_manager = DeviceManager()
