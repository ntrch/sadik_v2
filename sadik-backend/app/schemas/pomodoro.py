from pydantic import BaseModel
from typing import Optional

class PomodoroStart(BaseModel):
    task_id: Optional[int] = None
    work_minutes: Optional[int] = None
    break_minutes: Optional[int] = None

class PomodoroStateResponse(BaseModel):
    is_running: bool
    is_paused: bool
    remaining_seconds: int
    total_seconds: int
    current_session: int
    task_id: Optional[int]
    phase: str  # "work", "break", "long_break", "idle"
