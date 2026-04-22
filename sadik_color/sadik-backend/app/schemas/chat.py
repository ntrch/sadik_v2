from pydantic import BaseModel
from datetime import datetime


class ChatMessageCreate(BaseModel):
    content: str
    voice_mode: bool = False


class ChatMessageResponse(BaseModel):
    id: int
    role: str
    content: str
    created_at: datetime

    class Config:
        from_attributes = True


class ChatResponse(BaseModel):
    response: str
    message: ChatMessageResponse
