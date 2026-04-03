from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class ModeSet(BaseModel):
    mode: str

class ModeLogResponse(BaseModel):
    id: int
    mode: str
    started_at: datetime
    ended_at: Optional[datetime]
    duration_seconds: Optional[int]

    class Config:
        from_attributes = True

class CurrentModeResponse(BaseModel):
    mode: Optional[str]
    started_at: Optional[datetime] = None
