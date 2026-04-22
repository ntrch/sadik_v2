from sqlalchemy import Integer, String, Text, DateTime, Boolean, Index, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from datetime import datetime
from typing import Optional


class ExternalEvent(Base):
    __tablename__ = "external_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Source integration identifier, e.g. 'google_calendar'
    source: Mapped[str] = mapped_column(String, nullable=False, index=True)

    # Provider's own event id
    source_id: Mapped[str] = mapped_column(String, nullable=False, index=True)

    # Which calendar within the provider
    calendar_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    location: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # All times stored as UTC naive datetimes
    start_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    end_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    all_day: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    organizer: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # JSON string — list of {email, responseStatus}
    attendees: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # hangoutLink or first video conferenceData entry point
    meeting_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    html_link: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # confirmed | tentative | cancelled
    status: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # Provider's own 'updated' timestamp
    updated_at_source: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # When we last fetched this event
    fetched_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    # Tombstone: event was removed from the provider's response for its time window
    deleted_in_source: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("source", "source_id", name="uq_external_event_source_source_id"),
    )
