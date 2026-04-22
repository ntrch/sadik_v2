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
