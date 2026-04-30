from pydantic import BaseModel, Field
from typing import Optional


class FeedbackSubmit(BaseModel):
    type: str = Field(..., pattern="^(bug|feature|other)$")
    body: str = Field(..., min_length=10, max_length=2000)
    screenshot_base64: Optional[str] = None
    app_version: Optional[str] = None
    os_info: Optional[str] = None
    current_page: Optional[str] = None


class FeedbackResponse(BaseModel):
    id: int
    ok: bool
