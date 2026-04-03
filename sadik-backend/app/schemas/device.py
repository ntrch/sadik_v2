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
