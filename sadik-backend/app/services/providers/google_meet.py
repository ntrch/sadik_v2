"""Google Meet active-conference detection.

Piggy-backs on the `google_calendar` Integration row (shared OAuth token) —
no separate connect/disconnect flow. When the calendar scheduler runs the
calendar sync, the end of that sync calls :func:`poll_active_meeting`, which:

1. Finds ExternalEvent rows overlapping a short window around `now` that
   carry a Meet URL.
2. For each, extracts the meeting code and calls the Meet REST API
   `GET v2/spaces/{meetingCode}`.
3. If the response contains `activeConference`, persists the state to the
   `google_meet_state` Setting row as JSON.

State shape (stored as JSON string under the `google_meet_state` setting):
    {
      "in_meeting": bool,
      "event_id": int | null,
      "event_title": str | null,
      "meeting_code": str | null,
      "meeting_url": str | null,
      "starts_at": ISO8601 | null,
      "ends_at": ISO8601 | null,
      "detected_at": ISO8601
    }
"""

import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.external_event import ExternalEvent
from app.models.integration import Integration
from app.models.setting import Setting
from app.services.privacy_flags import get_privacy_flags

logger = logging.getLogger(__name__)

MEET_API = "https://meet.googleapis.com/v2"
REQUIRED_SCOPE = "meetings.space.readonly"
STATE_SETTING_KEY = "google_meet_state"

# Event is considered "current" if its window overlaps [now-5m, now+15m]
_LOOKBACK = timedelta(minutes=5)
_LOOKAHEAD = timedelta(minutes=15)

_HTTP_TIMEOUT = 8.0

# meet.google.com/abc-defg-hij — three-letter dashed groups
_MEET_CODE_RE = re.compile(r"meet\.google\.com/([a-z]{3}-[a-z]{4}-[a-z]{3})", re.I)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _extract_meeting_code(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    m = _MEET_CODE_RE.search(url)
    return m.group(1).lower() if m else None


async def _get_setting(session: AsyncSession, key: str) -> Optional[str]:
    result = await session.execute(select(Setting).where(Setting.key == key))
    row = result.scalar_one_or_none()
    return row.value if row else None


async def _set_setting(session: AsyncSession, key: str, value: str) -> None:
    result = await session.execute(select(Setting).where(Setting.key == key))
    row = result.scalar_one_or_none()
    if row is None:
        row = Setting(key=key, value=value)
        session.add(row)
    else:
        row.value = value
    await session.commit()


def _empty_state(detected_at: datetime) -> dict:
    return {
        "in_meeting": False,
        "event_id": None,
        "event_title": None,
        "meeting_code": None,
        "meeting_url": None,
        "starts_at": None,
        "ends_at": None,
        "detected_at": detected_at.isoformat(),
    }


async def _write_state(session: AsyncSession, state: dict) -> None:
    await _set_setting(session, STATE_SETTING_KEY, json.dumps(state))


async def get_meet_state(session: AsyncSession) -> dict:
    """Return the last persisted Meet state, or an empty/off state."""
    raw = await _get_setting(session, STATE_SETTING_KEY)
    if not raw:
        return _empty_state(_utcnow())
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return _empty_state(_utcnow())


async def poll_active_meeting(
    session: AsyncSession,
    integration: Integration,
    access_token: str,
) -> None:
    """Check each imminent/current Meet event and update Meet state setting.

    Silent no-op when:
      - The integration's granted scopes don't include meetings.space.readonly
        (user connected before T4.2 ship — needs reconnect).
      - `privacy_calendar_push` is False (user opted out of calendar data).
    """
    flags = await get_privacy_flags(session)
    if not flags.get("privacy_calendar_push"):
        logger.debug("[google_meet] skipped — privacy_calendar_push=False")
        return

    if not integration.scopes or REQUIRED_SCOPE not in integration.scopes:
        logger.debug(
            "[google_meet] skipped — integration lacks %s scope (reconnect needed)",
            REQUIRED_SCOPE,
        )
        return

    now = _utcnow()
    window_start = now - _LOOKAHEAD  # events starting within next 15m
    window_end = now + _LOOKBACK    # events ending within last 5m

    # Event is "current" if: start_at <= now + LOOKAHEAD AND end_at >= now - LOOKBACK
    q = (
        select(ExternalEvent)
        .where(
            ExternalEvent.source == "google_calendar",
            ExternalEvent.deleted_in_source == False,  # noqa: E712
            ExternalEvent.meeting_url.isnot(None),
            ExternalEvent.start_at <= now + _LOOKAHEAD,
            ExternalEvent.end_at >= now - _LOOKBACK,
        )
        .order_by(ExternalEvent.start_at.asc())
    )
    result = await session.execute(q)
    events = list(result.scalars().all())

    if not events:
        await _write_state(session, _empty_state(now))
        return

    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        for event in events:
            code = _extract_meeting_code(event.meeting_url)
            if not code:
                continue

            try:
                resp = await client.get(
                    f"{MEET_API}/spaces/{code}",
                    headers=headers,
                )
            except Exception as exc:
                logger.warning("[google_meet] spaces.get network error: %s", exc)
                continue

            if resp.status_code == 403:
                # Scope/ACL — user hasn't granted or isn't authorized for this space
                logger.debug("[google_meet] 403 for space %s (skip)", code)
                continue
            if resp.status_code == 404:
                # Space not found — meeting never started or code invalid
                continue
            if resp.status_code >= 400:
                logger.warning(
                    "[google_meet] spaces.get %s → %s",
                    code,
                    resp.status_code,
                )
                continue

            data = resp.json() or {}
            active = data.get("activeConference")
            if active:
                state = {
                    "in_meeting": True,
                    "event_id": event.id,
                    "event_title": event.title,
                    "meeting_code": code,
                    "meeting_url": event.meeting_url,
                    "starts_at": event.start_at.isoformat() if event.start_at else None,
                    "ends_at": event.end_at.isoformat() if event.end_at else None,
                    "detected_at": now.isoformat(),
                }
                await _write_state(session, state)
                logger.info(
                    "[google_meet] active conference detected for '%s' (%s)",
                    event.title,
                    code,
                )
                return

    # No event had an active conference
    await _write_state(session, _empty_state(now))
