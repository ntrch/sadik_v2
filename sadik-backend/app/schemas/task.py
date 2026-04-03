from pydantic import BaseModel
from datetime import datetime
from typing import Optional

ALLOWED_STATUSES = {"todo", "in_progress", "done", "cancelled", "planned", "archived"}

class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    notes: Optional[str] = None
    due_date: Optional[datetime] = None
    priority: int = 0

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None
    due_date: Optional[datetime] = None
    priority: Optional[int] = None
    status: Optional[str] = None

class TaskStatusUpdate(BaseModel):
    status: str

class TaskResponse(BaseModel):
    id: int
    title: str
    description: Optional[str]
    notes: Optional[str]
    status: str
    priority: int
    created_at: datetime
    updated_at: datetime
    due_date: Optional[datetime]
    pomodoro_count: int

    class Config:
        from_attributes = True
