import logging
from typing import Optional
from app.services.serial_service import serial_service
from app.services.wifi_device_service import wifi_device_service

logger = logging.getLogger(__name__)

class DeviceManager:
    def __init__(self):
        self._method: Optional[str] = None
        self._port: Optional[str] = None
        self._ip: Optional[str] = None

    async def connect(self, method: str, port: Optional[str] = None, ip: Optional[str] = None, baudrate: int = 115200) -> bool:
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

device_manager = DeviceManager()
