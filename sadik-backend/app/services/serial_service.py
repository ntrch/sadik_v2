import asyncio
import logging
from typing import Optional
import serial
import serial.tools.list_ports

logger = logging.getLogger(__name__)

class SerialService:
    def __init__(self):
        self._serial: Optional[serial.Serial] = None
        self._lock = asyncio.Lock()

    @property
    def is_connected(self) -> bool:
        return self._serial is not None and self._serial.is_open

    def list_ports(self) -> list[dict]:
        ports = []
        for p in serial.tools.list_ports.comports():
            ports.append({"port": p.device, "description": p.description, "hwid": p.hwid})
        return ports

    def _find_esp32_port(self) -> Optional[str]:
        for p in serial.tools.list_ports.comports():
            desc = (p.description or "").lower()
            hwid = (p.hwid or "").lower()
            if any(kw in desc or kw in hwid for kw in ["ch340", "cp210", "esp32", "esp", "usb serial", "uart"]):
                return p.device
        ports = serial.tools.list_ports.comports()
        if ports:
            return ports[0].device
        return None

    async def open(self, port: str, baudrate: int = 115200) -> bool:
        loop = asyncio.get_event_loop()
        try:
            if port == "auto":
                port = self._find_esp32_port()
                if not port:
                    logger.error("No serial port found for auto detection")
                    return False
            def _open():
                s = serial.Serial(port, baudrate, timeout=1)
                return s
            self._serial = await loop.run_in_executor(None, _open)
            logger.info(f"Serial opened on {port} at {baudrate}")
            return True
        except Exception as e:
            logger.error(f"Failed to open serial: {e}")
            self._serial = None
            return False

    async def close(self):
        if self._serial and self._serial.is_open:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self._serial.close)
            self._serial = None
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

serial_service = SerialService()
