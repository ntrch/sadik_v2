from sqlalchemy import Integer, String, DateTime, ForeignKey, Index, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from datetime import datetime
from typing import Optional


class NotionSyncedPage(Base):
    """Tracks every Notion page imported during sync.

    One row per Notion page — keyed on notion_page_id which is globally unique
    within the Notion API.  internal_task_id is a soft FK to tasks.id so we
    can correlate back without an ORM relationship (avoids cascade complexity).
    """

    __tablename__ = "notion_synced_pages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Notion's own page UUID (e.g. "a1b2c3d4-...") — unique per workspace.
    notion_page_id: Mapped[str] = mapped_column(
        String, nullable=False, unique=True, index=True
    )

    # Which database this page came from (the user-selected database).
    database_id: Mapped[str] = mapped_column(String, nullable=False, index=True)

    title: Mapped[str] = mapped_column(String, nullable=False, default="(Başlıksız)")

    # Raw value of the status property detected in the page.
    status: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # Due date parsed from "Due" / "Tarih" property.
    due_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Notion's last_edited_time for the page — used for change detection.
    last_edited_time: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # When we last wrote this row during a sync run.
    synced_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=func.now())

    # Soft FK → tasks.id.  Null until a Task is created / matched for this page.
    internal_task_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("ix_notion_synced_pages_database_id", "database_id"),
    )
