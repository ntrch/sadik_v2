import re
from pydantic import BaseModel, ConfigDict, field_validator, model_validator
from typing import Optional, List, Literal
from datetime import datetime

TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
HEX_RE  = re.compile(r"^#[0-9a-fA-F]{6,8}$")
ICON_RE = re.compile(r"^[a-z0-9\-]+$")


class HabitCreate(BaseModel):
    name: str
    description: Optional[str] = None
    days_of_week: List[int] = []
    time: str = "00:00"
    minutes_before: int = 5
    enabled: bool = True
    respect_dnd: bool = True
    # S3.5 new fields
    color: str = "#fdba74"
    icon: str = "repeat"
    target_days: int = 66
    frequency_type: str = "daily"
    interval_minutes: Optional[int] = None

    @field_validator("time")
    @classmethod
    def validate_time(cls, v: str) -> str:
        if not TIME_RE.match(v):
            raise ValueError("time must be HH:MM in 24-hour format")
        return v

    @field_validator("days_of_week")
    @classmethod
    def validate_days(cls, v: List[int]) -> List[int]:
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

    @field_validator("color")
    @classmethod
    def validate_color(cls, v: str) -> str:
        if not HEX_RE.match(v):
            raise ValueError("color must be a hex string like #rrggbb")
        return v

    @field_validator("icon")
    @classmethod
    def validate_icon(cls, v: str) -> str:
        if not ICON_RE.match(v):
            raise ValueError("icon must be a lowercase lucide key (a-z, 0-9, -)")
        return v

    @field_validator("target_days")
    @classmethod
    def validate_target_days(cls, v: int) -> int:
        if v < 1 or v > 1000:
            raise ValueError("target_days must be 1–1000")
        return v

    @field_validator("frequency_type")
    @classmethod
    def validate_frequency_type(cls, v: str) -> str:
        if v not in ("daily", "interval"):
            raise ValueError("frequency_type must be 'daily' or 'interval'")
        return v

    @field_validator("interval_minutes")
    @classmethod
    def validate_interval_minutes(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and (v < 5 or v > 720):
            raise ValueError("interval_minutes must be 5–720")
        return v

    @model_validator(mode="after")
    def cross_validate(self) -> "HabitCreate":
        if self.frequency_type == "interval":
            if self.interval_minutes is None:
                raise ValueError("interval_minutes is required when frequency_type='interval'")
        else:
            # daily: require at least one day
            if not self.days_of_week:
                raise ValueError("days_of_week must contain at least one day for daily habits")
        return self


class HabitUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    days_of_week: Optional[List[int]] = None
    time: Optional[str] = None
    minutes_before: Optional[int] = None
    enabled: Optional[bool] = None
    respect_dnd: Optional[bool] = None
    # S3.5 new fields
    color: Optional[str] = None
    icon: Optional[str] = None
    target_days: Optional[int] = None
    frequency_type: Optional[str] = None
    interval_minutes: Optional[int] = None

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

    @field_validator("color")
    @classmethod
    def validate_color(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not HEX_RE.match(v):
            raise ValueError("color must be a hex string like #rrggbb")
        return v

    @field_validator("icon")
    @classmethod
    def validate_icon(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not ICON_RE.match(v):
            raise ValueError("icon must be a lowercase lucide key (a-z, 0-9, -)")
        return v

    @field_validator("target_days")
    @classmethod
    def validate_target_days(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and (v < 1 or v > 1000):
            raise ValueError("target_days must be 1–1000")
        return v

    @field_validator("frequency_type")
    @classmethod
    def validate_frequency_type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ("daily", "interval"):
            raise ValueError("frequency_type must be 'daily' or 'interval'")
        return v

    @field_validator("interval_minutes")
    @classmethod
    def validate_interval_minutes(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and (v < 5 or v > 720):
            raise ValueError("interval_minutes must be 5–720")
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
    # S3.5 new fields
    color: str
    icon: str
    target_days: int
    frequency_type: str
    interval_minutes: Optional[int] = None

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
            color=getattr(habit, "color", "#fdba74"),
            icon=getattr(habit, "icon", "repeat"),
            target_days=getattr(habit, "target_days", 66),
            frequency_type=getattr(habit, "frequency_type", "daily"),
            interval_minutes=getattr(habit, "interval_minutes", None),
        )


# ── Log schemas ────────────────────────────────────────────────────────────────

class HabitLogCreate(BaseModel):
    status: Literal["done", "skipped", "snoozed"]
    snoozed_until: Optional[datetime] = None
    log_date: Optional[str] = None  # default: today (server-side, user TZ)


class HabitLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    habit_id: int
    log_date: str
    status: str
    completed_at: Optional[datetime] = None
    snoozed_until: Optional[datetime] = None
    created_at: datetime


class HabitDueResponse(BaseModel):
    habit: HabitResponse
    is_due_now: bool
    next_trigger_at: Optional[datetime] = None
    today_status: Optional[str] = None  # 'done' | 'skipped' | 'snoozed' | None
