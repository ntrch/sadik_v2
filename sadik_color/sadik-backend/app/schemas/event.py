from pydantic import BaseModel, ConfigDict, field_validator
from typing import Optional
from datetime import datetime

_ALLOWED_COLORS = {"purple", "cyan", "orange", "yellow", "red", "green", "pink"}


class EventCreate(BaseModel):
    title: str
    description: Optional[str] = None
    guests: Optional[str] = None
    color: str = "purple"
    starts_at: datetime
    ends_at: Optional[datetime] = None

    @field_validator("color")
    @classmethod
    def validate_color(cls, v: str) -> str:
        if v not in _ALLOWED_COLORS:
            raise ValueError(f"color must be one of {sorted(_ALLOWED_COLORS)}")
        return v


class EventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    guests: Optional[str] = None
    color: Optional[str] = None
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None

    @field_validator("color")
    @classmethod
    def validate_color(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in _ALLOWED_COLORS:
            raise ValueError(f"color must be one of {sorted(_ALLOWED_COLORS)}")
        return v


class EventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: Optional[str] = None
    guests: Optional[str] = None
    color: str
    starts_at: datetime
    ends_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
