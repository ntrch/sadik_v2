from pydantic import BaseModel
from typing import Optional


class ClipboardItemCreate(BaseModel):
    content_type: str  # 'text' | 'image'
    content: str
    content_hash: Optional[str] = None


class ClipboardItemResponse(BaseModel):
    id: int
    content_type: str
    content: str
    content_hash: Optional[str]
    created_at: str


class BrainstormNoteCreate(BaseModel):
    content_type: str  # 'text' | 'image'
    content: str
    title: Optional[str] = None
    source_clipboard_id: Optional[int] = None


class BrainstormNoteUpdate(BaseModel):
    content_type: Optional[str] = None
    content: Optional[str] = None
    title: Optional[str] = None


class BrainstormNoteResponse(BaseModel):
    id: int
    content_type: str
    content: str
    title: Optional[str]
    source_clipboard_id: Optional[int]
    created_at: str
    updated_at: str


class PushNoteToTaskRequest(BaseModel):
    task_id: int
    # If true and the task already has a description, append with a separator
    # instead of overwriting.
    append: bool = True
