from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone


def _as_utc_iso(dt: Optional[datetime]) -> Optional[str]:
    """Serialize a naive-UTC datetime as an ISO string with explicit +00:00
    offset so the browser's `new Date(..)` parses it as UTC rather than local."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()

from app.database import get_session
from app.models.event import Event
from app.models.external_event import ExternalEvent
from app.schemas.event import EventCreate, EventUpdate, EventResponse

router = APIRouter(prefix="/api/events", tags=["events"])


@router.get("", response_model=List[EventResponse])
async def list_events(
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    session: AsyncSession = Depends(get_session),
):
    q = select(Event).order_by(Event.starts_at)
    if start is not None:
        q = q.where(Event.starts_at >= start)
    if end is not None:
        q = q.where(Event.starts_at <= end)
    rows = await session.execute(q)
    return rows.scalars().all()


@router.post("", response_model=EventResponse, status_code=201)
async def create_event(body: EventCreate, session: AsyncSession = Depends(get_session)):
    ev = Event(
        title=body.title,
        description=body.description,
        guests=body.guests,
        color=body.color,
        starts_at=body.starts_at,
        ends_at=body.ends_at,
    )
    session.add(ev)
    await session.commit()
    await session.refresh(ev)
    return ev


@router.patch("/{event_id}", response_model=EventResponse)
async def update_event(event_id: int, body: EventUpdate, session: AsyncSession = Depends(get_session)):
    ev = await session.get(Event, event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="event_not_found")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(ev, k, v)
    await session.commit()
    await session.refresh(ev)
    return ev


@router.delete("/{event_id}")
async def delete_event(event_id: int, session: AsyncSession = Depends(get_session)):
    ev = await session.get(Event, event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="event_not_found")
    await session.delete(ev)
    await session.commit()
    return {"ok": True}


@router.get("/unified")
async def unified_events(
    from_: Optional[datetime] = None,
    to: Optional[datetime] = None,
    session: AsyncSession = Depends(get_session),
) -> List[Dict[str, Any]]:
    """Merge native Event rows and ExternalEvent rows into one sorted list.

    Each entry includes a 'source' key: 'native' | 'google_calendar' | etc.
    """
    # Native events
    native_q = select(Event).order_by(Event.starts_at)
    if from_ is not None:
        native_q = native_q.where(Event.starts_at >= from_)
    if to is not None:
        native_q = native_q.where(Event.starts_at <= to)
    native_rows = (await session.execute(native_q)).scalars().all()

    # External events
    ext_q = (
        select(ExternalEvent)
        .where(ExternalEvent.deleted_in_source == False)  # noqa: E712
        .order_by(ExternalEvent.start_at)
    )
    if from_ is not None:
        ext_q = ext_q.where(ExternalEvent.start_at >= from_)
    if to is not None:
        ext_q = ext_q.where(ExternalEvent.start_at <= to)
    ext_rows = (await session.execute(ext_q)).scalars().all()

    items: List[Dict[str, Any]] = []

    for ev in native_rows:
        items.append(
            {
                "source": "native",
                "id": ev.id,
                "title": ev.title,
                "description": ev.description,
                "starts_at": ev.starts_at.isoformat() if ev.starts_at else None,
                "ends_at": ev.ends_at.isoformat() if ev.ends_at else None,
                "all_day": False,
                "color": ev.color,
                "html_link": None,
                "meeting_url": None,
                "location": None,
                "organizer": None,
                "attendees": None,
                "status": None,
                "source_id": None,
            }
        )

    for ev in ext_rows:
        items.append(
            {
                "source": ev.source,
                "id": ev.id,
                "title": ev.title,
                "description": ev.description,
                "starts_at": _as_utc_iso(ev.start_at),
                "ends_at": _as_utc_iso(ev.end_at),
                "all_day": ev.all_day,
                "color": "cyan",  # Google Calendar events get cyan tint
                "html_link": ev.html_link,
                "meeting_url": ev.meeting_url,
                "location": ev.location,
                "organizer": ev.organizer,
                "attendees": ev.attendees,
                "status": ev.status,
                "source_id": ev.source_id,
            }
        )

    # Sort by starts_at ascending
    items.sort(key=lambda x: x["starts_at"] or "")
    return items
