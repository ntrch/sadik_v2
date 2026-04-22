import re
from pydantic import BaseModel, ConfigDict, field_validator, model_validator
from typing import Optional, List
from datetime import datetime

TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class HabitCreate(BaseModel):
    name: str
    description: Optional[str] = None
    days_of_week: List[int]
    time: str
    minutes_before: int = 5
    enabled: bool = True
    respect_dnd: bool = True

    @field_validator("time")
    @classmethod
    def validate_time(cls, v: str) -> str:
        if not TIME_RE.match(v):
            raise ValueError("time must be HH:MM in 24-hour format")
        return v

    @field_validator("days_of_week")
    @classmethod
    def validate_days(cls, v: List[int]) -> List[int]:
        if not v:
            raise ValueError("days_of_week must contain at least one day")
        for d in v:
            if d < 0 or d > 6:
                raise ValueError(f"Invalid day {d}: must be 0 (Mon) … 6 (Sun)")
        return sorted(set(v))

    @field_validator("minutes_before")
    @classmethod
    def validate_minutes_before(cls, v: int) -> int:
        if v < 0 or v > 120:
            raise ValueError("minutes_before must be 0–120")
        return v


class HabitUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    days_of_week: Optional[List[int]] = None
    time: Optional[str] = None
    minutes_before: Optional[int] = None
    enabled: Optional[bool] = None
    respect_dnd: Optional[bool] = None

    @field_validator("time")
    @classmethod
    def validate_time(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not TIME_RE.match(v):
            raise ValueError("time must be HH:MM in 24-hour format")
        return v

    @field_validator("days_of_week")
    @classmethod
    def validate_days(cls, v: Optional[List[int]]) -> Optional[List[int]]:
        if v is None:
            return v
        if not v:
            raise ValueError("days_of_week must contain at least one day")
        for d in v:
            if d < 0 or d > 6:
                raise ValueError(f"Invalid day {d}: must be 0 (Mon) … 6 (Sun)")
        return sorted(set(v))

    @field_validator("minutes_before")
    @classmethod
    def validate_minutes_before(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and (v < 0 or v > 120):
            raise ValueError("minutes_before must be 0–120")
        return v


class HabitResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: Optional[str] = None
    days_of_week: List[int]
    time: str
    minutes_before: int
    enabled: bool
    respect_dnd: bool
    last_triggered_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_orm_habit(cls, habit) -> "HabitResponse":
        return cls(
            id=habit.id,
            name=habit.name,
            description=habit.description,
            days_of_week=habit.get_days(),
            time=habit.time,
            minutes_before=habit.minutes_before,
            enabled=habit.enabled,
            respect_dnd=habit.respect_dnd,
            last_triggered_at=habit.last_triggered_at,
            created_at=habit.created_at,
            updated_at=habit.updated_at,
        )
