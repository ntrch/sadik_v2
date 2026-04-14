import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.schemas.device import DeviceConnect, DeviceCommand, DeviceStatusResponse, AutoConnectResult, BrightnessRequest, SleepTimeoutRequest
from app.services.device_manager import device_manager
from app.services.serial_service import serial_service
from app.services.ws_manager import ws_manager
from app.models.setting import Setting
from app.database import AsyncSessionLocal
from sqlalchemy import select

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/device", tags=["device"])

@router.get("/status", response_model=DeviceStatusResponse)
async def get_status():
    return device_manager.get_status()

@router.post("/connect")
async def connect_device(body: DeviceConnect):
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Setting).where(Setting.key == "serial_baudrate"))
        s = result.scalar_one_or_none()
        baudrate = int(s.value) if s else 460800

    ok = await device_manager.connect(body.method, port=body.port, ip=body.ip, baudrate=baudrate)
    status = device_manager.get_status()
    await ws_manager.broadcast({"type": "device_status", "data": status})
    if not ok:
        raise HTTPException(status_code=400, detail="Could not connect to device")
    return status

@router.post("/disconnect")
async def disconnect_device():
    # Notify firmware before closing the port so it can resume autonomous idle.
    # Best-effort — ignore errors if the link is already unstable.
    try:
        await device_manager.send_command("APP_DISCONNECTED")
    except Exception:
        pass
    await device_manager.disconnect()
    status = device_manager.get_status()
    await ws_manager.broadcast({"type": "device_status", "data": status})
    return status

@router.post("/auto-connect", response_model=AutoConnectResult)
async def auto_connect_device():
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Setting).where(Setting.key == "serial_baudrate"))
        s = result.scalar_one_or_none()
        baudrate = int(s.value) if s else 460800

    result = await device_manager.auto_connect(baudrate=baudrate)
    if result["connected"]:
        status = device_manager.get_status()
        await ws_manager.broadcast({"type": "device_status", "data": status})
    return result

@router.get("/ports")
async def list_ports():
    return serial_service.list_ports()

@router.post("/brightness")
async def set_brightness(body: BrightnessRequest):
    if body.percent < 0 or body.percent > 100:
        raise HTTPException(status_code=400, detail="Percent must be between 0 and 100")
    device_value = round(body.percent * 255 / 100)
    command = f"SET_BRIGHTNESS:{device_value}"
    logger.info(f"Brightness command sent: {command}")
    ok, response, error = await device_manager.send_command_and_read(command)
    if response:
        logger.info(f"Brightness firmware response: {response!r}")
    else:
        logger.warning("Brightness firmware response: (none received)")
    if not ok:
        return {
            "success": False,
            "percent": body.percent,
            "device_value": device_value,
            "response": None,
            "message": error or "Device not connected",
        }
    return {
        "success": True,
        "percent": body.percent,
        "device_value": device_value,
        "response": response,
        "message": "Brightness updated.",
    }

@router.post("/sleep-timeout")
async def set_sleep_timeout(body: SleepTimeoutRequest):
    if body.minutes < 0:
        raise HTTPException(status_code=400, detail="minutes must be >= 0 (0 = disabled)")
    device_value_ms = body.minutes * 60 * 1000
    command = f"SET_SLEEP_TIMEOUT_MS:{device_value_ms}"
    logger.info(f"Sleep timeout command sent: {command}")
    ok, response, error = await device_manager.send_command_and_read(command)
    if response:
        logger.info(f"Sleep timeout firmware response: {response!r}")
    if not ok:
        return {
            "success": False,
            "minutes": body.minutes,
            "device_value_ms": device_value_ms,
            "response": None,
            "message": error or "Device not connected",
        }
    return {
        "success": True,
        "minutes": body.minutes,
        "device_value_ms": device_value_ms,
        "response": response,
        "message": "Sleep timeout updated." if body.minutes > 0 else "Sleep disabled.",
    }

class FrameData(BaseModel):
    data: str  # hex-encoded 1024-byte frame (2048 hex chars)

_frame_count = 0

@router.post("/frame")
async def send_frame(body: FrameData):
    """Send raw frame buffer to device as FRAME:<hex>. Fire-and-forget."""
    global _frame_count
    _frame_count += 1
    if len(body.data) != 2048:
        logger.warning(f"Frame #{_frame_count}: bad length {len(body.data)}")
        raise HTTPException(status_code=400, detail=f"Expected 2048 hex chars, got {len(body.data)}")
    ok, error = await device_manager.send_frame_acked(body.data)
    if _frame_count <= 5 or _frame_count % 60 == 0:
        logger.info(f"Frame #{_frame_count}: sent={'ok' if ok else 'fail'} err={error} first8={body.data[:8]}")
    if not ok:
        return {"success": False, "error": error or "Failed to send frame"}
    return {"success": True}

@router.post("/command")
async def send_command(body: DeviceCommand):
    ok, error = await device_manager.send_command(body.command)
    await ws_manager.broadcast({"type": "device_command", "data": {"command": body.command}})
    if not ok:
        return {"success": False, "error": error or "Failed to send command"}
    return {"success": True}
