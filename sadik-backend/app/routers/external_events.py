from datetime import datetime, timezone
from typing import List, Optional


def _as_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """Attach UTC tzinfo to a naive-UTC datetime so Pydantic emits +00:00."""
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.external_event import ExternalEvent

router = APIRouter(prefix="/api/external-events", tags=["external-events"])


# ---------------------------------------------------------------------------
# Pydantic response schema
# ---------------------------------------------------------------------------


class ExternalEventResponse(BaseModel):
    id: int
    source: str
    source_id: str
    calendar_id: Optional[str]
    title: str
    description: Optional[str]
    location: Optional[str]
    start_at: datetime
    end_at: Optional[datetime]
    all_day: bool
    organizer: Optional[str]
    attendees: Optional[str]  # raw JSON string
    meeting_url: Optional[str]
    html_link: Optional[str]
    status: Optional[str]
    updated_at_source: Optional[datetime]
    fetched_at: datetime
    deleted_in_source: bool

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("", response_model=List[ExternalEventResponse])
async def list_external_events(
    source: Optional[str] = None,
    from_: Optional[datetime] = None,
    to: Optional[datetime] = None,
    session: AsyncSession = Depends(get_session),
):
    """List external events with optional filters.  Excludes deleted rows."""
    q = (
        select(ExternalEvent)
        .where(ExternalEvent.deleted_in_source == False)  # noqa: E712
        .order_by(ExternalEvent.start_at)
    )
    if source:
        q = q.where(ExternalEvent.source == source)
    if from_ is not None:
        q = q.where(ExternalEvent.start_at >= from_)
    if to is not None:
        q = q.where(ExternalEvent.start_at <= to)

    result = await session.execute(q)
    rows = result.scalars().all()
    # External events are stored as naive UTC — re-attach UTC tz so the
    # ISO serialization carries an explicit offset (otherwise browsers parse
    # the naive string as local time and events drift by the TZ offset).
    for row in rows:
        row.start_at = _as_utc(row.start_at)
        row.end_at = _as_utc(row.end_at)
        row.updated_at_source = _as_utc(row.updated_at_source)
        row.fetched_at = _as_utc(row.fetched_at)
    return rows


@router.delete("/{event_id}")
async def delete_external_event(
    event_id: int, session: AsyncSession = Depends(get_session)
):
    """Delete an external event row (for testing/cleanup)."""
    ev = await session.get(ExternalEvent, event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="external_event_not_found")
    await session.delete(ev)
    await session.commit()
    return {"ok": True}
