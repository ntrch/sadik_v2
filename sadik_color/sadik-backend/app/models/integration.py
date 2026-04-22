from sqlalchemy import Integer, String, DateTime, Index, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from datetime import datetime
from typing import Optional


class Integration(Base):
    __tablename__ = "integrations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # One row per provider — unique constraint enforces this.
    provider: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)

    # Human-readable label shown in the UI (e.g. user's Google email).
    account_email: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # TODO: encrypt these at rest before shipping to end-users.
    # For now they are stored as plain-text strings.
    access_token: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    refresh_token: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # UTC datetime after which the access_token is no longer valid.
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Space-separated OAuth scopes that were granted.
    scopes: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # One of: 'connected' | 'disconnected' | 'error'
    status: Mapped[str] = mapped_column(String, nullable=False, default="disconnected")

    # Last error message (if status == 'error').
    last_error: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # UTC timestamp of the last successful data pull.
    last_sync_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # UTC timestamp when the user first connected this provider.
    connected_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())
