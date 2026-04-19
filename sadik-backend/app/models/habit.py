import json
from sqlalchemy import Integer, String, Text, Boolean, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from datetime import datetime
from typing import Optional


class Habit(Base):
    __tablename__ = "habits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # JSON-encoded list of ints, e.g. "[0,4]" (Mon=0 … Sun=6)
    days_of_week: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    # HH:MM 24-hour user local time
    time: Mapped[str] = mapped_column(String(5), nullable=False)
    minutes_before: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    respect_dnd: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_triggered_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())

    def get_days(self) -> list[int]:
        try:
            return json.loads(self.days_of_week)
        except Exception:
            return []

    def set_days(self, days: list[int]):
        self.days_of_week = json.dumps(sorted(set(days)))
