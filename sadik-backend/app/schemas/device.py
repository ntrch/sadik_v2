from pydantic import BaseModel
from typing import Optional

class DeviceConnect(BaseModel):
    method: str  # "serial" or "wifi"
    port: Optional[str] = None
    ip: Optional[str] = None

class DeviceCommand(BaseModel):
    command: str

class DeviceStatusResponse(BaseModel):
    connected: bool
    method: Optional[str]
    port: Optional[str]
    ip: Optional[str]
    # Raw DEVICE: handshake line (e.g. "DEVICE:variant=mini hw=esp32-wroom32 ...").
    # Included so a late-connecting WS client can recover the device profile via
    # GET /api/device/status when the live device_profile broadcast was missed.
    device_line: Optional[str] = None

class AutoConnectResult(BaseModel):
    connected: bool
    port: Optional[str]
    method: Optional[str]
    message: str
    scanned_ports: int
    matched_ports: list[str]
    error: Optional[str]

class BrightnessRequest(BaseModel):
    percent: int

class SleepTimeoutRequest(BaseModel):
    minutes: int
