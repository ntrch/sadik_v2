from fastapi import APIRouter, HTTPException
from app.schemas.device import DeviceConnect, DeviceCommand, DeviceStatusResponse
from app.services.device_manager import device_manager
from app.services.serial_service import serial_service
from app.services.ws_manager import ws_manager
from app.models.setting import Setting
from app.database import AsyncSessionLocal
from sqlalchemy import select

router = APIRouter(prefix="/api/device", tags=["device"])

@router.get("/status", response_model=DeviceStatusResponse)
async def get_status():
    return device_manager.get_status()

@router.post("/connect")
async def connect_device(body: DeviceConnect):
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Setting).where(Setting.key == "serial_baudrate"))
        s = result.scalar_one_or_none()
        baudrate = int(s.value) if s else 115200

    ok = await device_manager.connect(body.method, port=body.port, ip=body.ip, baudrate=baudrate)
    status = device_manager.get_status()
    await ws_manager.broadcast({"type": "device_status", "data": status})
    if not ok:
        raise HTTPException(status_code=400, detail="Could not connect to device")
    return status

@router.post("/disconnect")
async def disconnect_device():
    await device_manager.disconnect()
    status = device_manager.get_status()
    await ws_manager.broadcast({"type": "device_status", "data": status})
    return status

@router.get("/ports")
async def list_ports():
    return serial_service.list_ports()

@router.post("/command")
async def send_command(body: DeviceCommand):
    ok, error = await device_manager.send_command(body.command)
    await ws_manager.broadcast({"type": "device_command", "data": {"command": body.command}})
    if not ok:
        return {"success": False, "error": error or "Failed to send command"}
    return {"success": True}
