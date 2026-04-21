"""Google Calendar provider — read-only sync via OAuth 2 "Installed App" flow."""

import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
from urllib.parse import urlencode

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import Integration
from app.models.external_event import ExternalEvent
from app.services.integration_service import BaseProvider, mark_error

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
CALENDAR_API = "https://www.googleapis.com/calendar/v3"
USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
SCOPES = (
    "openid email "
    "https://www.googleapis.com/auth/calendar.readonly "
    "https://www.googleapis.com/auth/meetings.space.readonly"
)
REDIRECT_URI = "http://localhost:8000/api/integrations/google_calendar/callback"

_HTTP_TIMEOUT = 10.0  # seconds


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    """Parse an ISO-8601 string (with or without timezone) to a naive UTC datetime."""
    if not s:
        return None
    try:
        # Python 3.11+ handles Z natively; earlier need replace
        s2 = s.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s2)
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except Exception:
        return None


# ---------------------------------------------------------------------------
# GoogleCalendarProvider
# ---------------------------------------------------------------------------


class GoogleCalendarProvider(BaseProvider):
    provider_name = "google_calendar"

    # ------------------------------------------------------------------ auth (PKCE)

    @classmethod
    async def build_auth_url(
        cls, client_id: str, state: str, code_challenge: str
    ) -> str:
        params = {
            "client_id": client_id,
            "redirect_uri": REDIRECT_URI,
            "response_type": "code",
            "scope": SCOPES,
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        return f"{AUTH_URL}?{urlencode(params)}"

    @classmethod
    async def exchange_code(
        cls, client_id: str, client_secret: str, code: str, code_verifier: str
    ) -> dict:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.post(
                TOKEN_URL,
                data={
                    "code": code,
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "redirect_uri": REDIRECT_URI,
                    "grant_type": "authorization_code",
                    "code_verifier": code_verifier,
                },
            )
            resp.raise_for_status()
            return resp.json()

    @classmethod
    async def fetch_userinfo(cls, access_token: str) -> dict:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get(
                USERINFO_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            resp.raise_for_status()
            return resp.json()

    # ------------------------------------------------------------------ token refresh

    async def refresh_token(self, integration: Integration) -> None:
        """Refresh the access_token using the stored refresh_token.

        Uses embedded Desktop OAuth credentials. Google's Desktop+PKCE flow
        still requires client_secret for the token endpoint even though it
        is not treated as confidential. Updates `integration` in-place.
        """
        from app.config import settings

        cid = settings.google_client_id
        csec = settings.google_client_secret
        if not cid or not csec:
            raise RuntimeError("google_client_id / google_client_secret not configured")

        if not integration.refresh_token:
            raise RuntimeError("No refresh_token stored for google_calendar integration")

        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.post(
                TOKEN_URL,
                data={
                    "client_id": cid,
                    "client_secret": csec,
                    "refresh_token": integration.refresh_token,
                    "grant_type": "refresh_token",
                },
            )
            resp.raise_for_status()
            data = resp.json()

        integration.access_token = data["access_token"]
        expires_in = int(data.get("expires_in", 3600))
        integration.expires_at = _utcnow().replace(tzinfo=None)
        integration.expires_at = datetime.utcnow() + timedelta(seconds=expires_in)
        # Google may return a new refresh_token; preserve it if present
        if "refresh_token" in data:
            integration.refresh_token = data["refresh_token"]

    # ------------------------------------------------------------------ sync

    async def sync(self, session: AsyncSession, integration: Integration) -> None:
        """Full-refresh sync: fetch all events in [now-7d, now+60d] and upsert."""
        # ---- token freshness check ----------------------------------------
        now = _utcnow()
        if integration.expires_at and (
            integration.expires_at - now < timedelta(minutes=5)
        ):
            logger.info("[google_calendar] Access token expiring — refreshing")
            await self.refresh_token(integration)
            await session.commit()

        access_token = integration.access_token
        if not access_token:
            raise RuntimeError("No access_token available after refresh attempt")

        time_min = (now - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
        time_max = (now + timedelta(days=60)).strftime("%Y-%m-%dT%H:%M:%SZ")

        headers = {"Authorization": f"Bearer {access_token}"}

        # ---- paginate through calendar events --------------------------------
        fetched_ids: set[str] = set()
        page_token: Optional[str] = None

        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            while True:
                params: dict = {
                    "timeMin": time_min,
                    "timeMax": time_max,
                    "singleEvents": "true",
                    "orderBy": "startTime",
                    "maxResults": 250,
                }
                if page_token:
                    params["pageToken"] = page_token

                resp = await client.get(
                    f"{CALENDAR_API}/calendars/primary/events",
                    headers=headers,
                    params=params,
                )
                resp.raise_for_status()
                data = resp.json()
                items = data.get("items", [])

                for ev in items:
                    ev_id = ev.get("id")
                    if not ev_id:
                        continue
                    fetched_ids.add(ev_id)
                    await self._upsert_event(session, ev)

                page_token = data.get("nextPageToken")
                if not page_token:
                    break

        # ---- tombstone stale rows inside the sync window --------------------
        time_min_dt = datetime.strptime(time_min, "%Y-%m-%dT%H:%M:%SZ")
        time_max_dt = datetime.strptime(time_max, "%Y-%m-%dT%H:%M:%SZ")

        stale_q = select(ExternalEvent).where(
            ExternalEvent.source == "google_calendar",
            ExternalEvent.deleted_in_source == False,  # noqa: E712
            ExternalEvent.start_at >= time_min_dt,
            ExternalEvent.start_at <= time_max_dt,
        )
        stale_result = await session.execute(stale_q)
        for stale in stale_result.scalars().all():
            if stale.source_id not in fetched_ids:
                stale.deleted_in_source = True

        integration.last_sync_at = now
        await session.commit()
        logger.info(
            "[google_calendar] Sync complete — %d events fetched", len(fetched_ids)
        )

        # ---- poll Google Meet active-conference state ----------------------
        try:
            from app.services.providers.google_meet import poll_active_meeting

            await poll_active_meeting(session, integration, access_token)
        except Exception as exc:
            # Meet polling must never break calendar sync
            logger.warning("[google_meet] poll failed: %s", exc)

    async def _upsert_event(self, session: AsyncSession, ev: dict) -> None:
        """Map a Google Calendar event dict → ExternalEvent row (upsert)."""
        source_id = ev["id"]

        result = await session.execute(
            select(ExternalEvent).where(
                ExternalEvent.source == "google_calendar",
                ExternalEvent.source_id == source_id,
            )
        )
        row = result.scalar_one_or_none()
        if row is None:
            row = ExternalEvent(source="google_calendar", source_id=source_id)
            session.add(row)

        # title
        row.title = ev.get("summary") or "(Başlıksız)"

        # description, location, html_link
        row.description = ev.get("description")
        row.location = ev.get("location")
        row.html_link = ev.get("htmlLink")

        # start / end / all_day
        start = ev.get("start", {})
        end = ev.get("end", {})
        if "date" in start:
            # All-day event — use 00:00 UTC
            row.all_day = True
            row.start_at = datetime.strptime(start["date"], "%Y-%m-%d")
            if "date" in end:
                row.end_at = datetime.strptime(end["date"], "%Y-%m-%d")
            else:
                row.end_at = _parse_iso(end.get("dateTime"))
        else:
            row.all_day = False
            row.start_at = _parse_iso(start.get("dateTime")) or _utcnow()
            row.end_at = _parse_iso(end.get("dateTime"))

        # organizer
        row.organizer = (ev.get("organizer") or {}).get("email")

        # attendees — list of {email, responseStatus}
        raw_attendees = ev.get("attendees", [])
        if raw_attendees:
            row.attendees = json.dumps(
                [
                    {
                        "email": a.get("email", ""),
                        "responseStatus": a.get("responseStatus", ""),
                    }
                    for a in raw_attendees
                ]
            )
        else:
            row.attendees = None

        # meeting_url — prefer hangoutLink, then first video entry point
        meeting_url: Optional[str] = ev.get("hangoutLink")
        if not meeting_url:
            conf = ev.get("conferenceData") or {}
            for entry in conf.get("entryPoints", []):
                if entry.get("entryPointType") == "video":
                    meeting_url = entry.get("uri")
                    break
        row.meeting_url = meeting_url

        # status
        row.status = ev.get("status")

        # updated_at_source
        row.updated_at_source = _parse_iso(ev.get("updated"))

        # fetched_at
        row.fetched_at = _utcnow()

        # undelete if it reappears
        row.deleted_in_source = False

        # calendar_id — for primary calendar this is always 'primary'
        row.calendar_id = "primary"


# ---------------------------------------------------------------------------
# Self-register into the provider registry
# ---------------------------------------------------------------------------

from app.services.integration_service import PROVIDERS  # noqa: E402

PROVIDERS["google_calendar"] = GoogleCalendarProvider
