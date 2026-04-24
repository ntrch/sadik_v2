import asyncio
import json
import logging
from pathlib import Path
from typing import Optional
from app.services.serial_service import serial_service
from app.services.wifi_device_service import wifi_device_service

logger = logging.getLogger(__name__)

# ── Clip registry ─────────────────────────────────────────────────────────────
# .bin files live at <repo>/sadik_color/assets/codec/<filename>.bin
# Path chain from this file:
#   device_manager.py → [0]=services → [1]=app → [2]=sadik-backend → [3]=sadik_color
_ASSETS_CODEC_DIR = (
    Path(__file__).resolve()          # …/sadik_color/sadik-backend/app/services/device_manager.py
    .parents[3]                       # …/sadik_color/
    / "assets" / "codec"
)

if not _ASSETS_CODEC_DIR.exists():
    logger.warning(f"_ASSETS_CODEC_DIR not found at startup: {_ASSETS_CODEC_DIR}")

# Manifest lives in sadik-app/public/animations/personas/sadik/clips-manifest.json
# It maps each clip's logical `name` to its actual `codecSource` filename.
_MANIFEST_PATH = (
    Path(__file__).resolve()
    .parents[3]                       # …/sadik_color/
    / "sadik-app" / "public" / "animations" / "personas" / "sadik" / "clips-manifest.json"
)

# name → absolute Path, built once at import time
_CLIP_MAP: dict[str, Path] = {}

def _build_clip_map() -> dict[str, Path]:
    if not _MANIFEST_PATH.exists():
        logger.warning(f"clips-manifest.json not found: {_MANIFEST_PATH}")
        return {}
    try:
        with open(_MANIFEST_PATH, encoding="utf-8") as fh:
            entries = json.load(fh)
    except Exception as exc:
        logger.warning(f"Failed to load clips-manifest.json: {exc}")
        return {}

    mapping: dict[str, Path] = {}
    for entry in entries:
        name = entry.get("name")
        codec_src = entry.get("codecSource")  # e.g. "codec/idle.bin"
        if not name or not codec_src:
            continue
        # Strip the "codec/" prefix to get just the filename, then join with dir
        filename = Path(codec_src).name
        abs_path = _ASSETS_CODEC_DIR / filename
        mapping[name] = abs_path

    logger.info(f"Clip manifest loaded: {len(mapping)} clips mapped from {_MANIFEST_PATH}")
    return mapping

_CLIP_MAP = _build_clip_map()


def resolve_clip_bin(name: str) -> Optional[Path]:
    """Resolve clip name → absolute .bin path.  Returns None if not found.

    First tries the manifest-based map (handles name/filename mismatches).
    Falls back to <_ASSETS_CODEC_DIR>/<name>.bin for resilience.
    """
    # 1. Manifest lookup
    p = _CLIP_MAP.get(name)
    if p is not None:
        if p.exists():
            return p
        logger.warning(f"Clip mapped in manifest but .bin missing on disk: {p}")
        return None

    # 2. Fallback: direct name → filename
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
        task = self._active_stream_task
        if task and not task.done():
            try:
                await asyncio.wait_for(task, timeout=1.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                if not task.done():
                    task.cancel()
        self._active_stream_task = None
        # After host-side abort, tell firmware to drop any half-parsed packet
        # bytes. Without this, the next stream's IFRAME lands on a stale parser
        # state → TIMEOUT seq=0 → 7-8s freeze. 0.2s timeout is intentional.
        aborted = await serial_service.send_abort_stream(timeout=0.2)
        if aborted:
            logger.info("stop_clip: firmware ABORTED")
        else:
            logger.warning("stop_clip: no OK:ABORTED within 200ms (continuing)")


device_manager = DeviceManager()
