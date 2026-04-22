import httpx
import logging

logger = logging.getLogger(__name__)

TIMEOUT = 2.0

class WiFiDeviceService:
    async def ping(self, ip: str) -> bool:
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                r = await client.get(f"http://{ip}/ping")
                return r.status_code == 200
        except Exception as e:
            logger.error(f"WiFi ping failed for {ip}: {e}")
            return False

    async def send_command(self, ip: str, command: str) -> bool:
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                r = await client.post(f"http://{ip}/command", content=command,
                                       headers={"Content-Type": "text/plain"})
                return r.status_code == 200
        except Exception as e:
            logger.error(f"WiFi send_command failed for {ip}: {e}")
            return False

wifi_device_service = WiFiDeviceService()
