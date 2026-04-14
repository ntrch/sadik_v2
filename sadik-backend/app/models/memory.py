from sqlalchemy import Integer, String, Text, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from datetime import datetime


class ClipboardItem(Base):
    __tablename__ = "clipboard_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 'text' or 'image'
    content_type: Mapped[str] = mapped_column(String, nullable=False, default="text")
    # Text payload, or data URL (data:image/png;base64,...) for images.
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # SHA-1 of content — used to suppress dupes when the user re-copies the
    # same value. Kept as a plain indexed column, not a unique constraint,
    # so legitimate re-copies after time can still be re-inserted if we ever
    # relax the window.
    content_hash: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())


class BrainstormNote(Base):
    __tablename__ = "brainstorm_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 'text' or 'image'
    content_type: Mapped[str] = mapped_column(String, nullable=False, default="text")
    content: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    # Optional link back to the clipboard item the note was spawned from
    source_clipboard_id: Mapped[int | None] = mapped_column(
        ForeignKey("clipboard_items.id", ondelete="SET NULL"), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())
