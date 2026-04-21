from sqlalchemy import Integer, String, DateTime, Index, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from datetime import datetime
from typing import Optional


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="todo")
    priority: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())
    due_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    pomodoro_count: Mapped[int] = mapped_column(Integer, default=0)

    # Notion sync — populated when this task was imported from a Notion page.
    # Indexed for reverse lookup during upsert. Nullable for non-Notion tasks.
    notion_page_id: Mapped[Optional[str]] = mapped_column(
        String, nullable=True, index=True, unique=True
    )

    # Icon fields — optional visual customization.
    # icon: Lucide icon key (e.g. "target", "rocket") for preset icons.
    # icon_image: base64 data URL or external URL for custom images (e.g. Notion page icon).
    icon: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    icon_image: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    __table_args__ = (
        Index("ix_tasks_notion_page_id", "notion_page_id"),
    )
