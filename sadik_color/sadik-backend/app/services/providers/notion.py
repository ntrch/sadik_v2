"""Notion provider — OAuth 2.0 public-integration flow + database → task sync.

Key differences from Google Calendar:
  - No PKCE: Notion public integrations use auth-code + client_secret only.
    Token exchange uses HTTP Basic Auth (client_id:client_secret as username:password).
  - Token never expires: Notion access tokens are permanent until the user
    revokes the integration in Notion settings. No refresh flow needed.
  - Property names are dynamic: each database can have arbitrary column names.
    We probe for common status/due-date property names at sync time.
  - API-Version header: every request must include "Notion-Version: 2022-06-28".
"""

import base64
import logging
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlencode

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import Integration
from app.models.notion_synced_page import NotionSyncedPage
from app.models.task import Task
from app.services.integration_service import BaseProvider

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

NOTION_VERSION = "2022-06-28"
NOTION_AUTH_URL = "https://api.notion.com/v1/oauth/authorize"
NOTION_TOKEN_URL = "https://api.notion.com/v1/oauth/token"
NOTION_API_BASE = "https://api.notion.com/v1"
REDIRECT_URI = "http://localhost:8000/api/integrations/notion/callback"

_HTTP_TIMEOUT = 15.0

# Status values that map to Task.status = "done"
_DONE_STATUSES = {"done", "completed", "tamamlandı", "tamamlandi", "bitti"}

# Property name probing — first match wins (case-insensitive)
_STATUS_PROP_NAMES = ["status", "durum", "state"]
_DUE_PROP_NAMES = ["due", "tarih", "due date", "bitiş", "bitis", "deadline"]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _notion_headers(access_token: str) -> dict:
    return {
        "Authorization": f"Bearer {access_token}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }


def _parse_notion_datetime(s: Optional[str]) -> Optional[datetime]:
    """Parse Notion ISO datetime string to naive UTC datetime."""
    if not s:
        return None
    try:
        s2 = s.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s2)
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except Exception:
        return None


# ---------------------------------------------------------------------------
# NotionProvider
# ---------------------------------------------------------------------------


class NotionProvider(BaseProvider):
    provider_name = "notion"

    # ------------------------------------------------------------------ auth

    @classmethod
    def build_auth_url(cls, client_id: str, state: str) -> str:
        """Build Notion OAuth authorization URL.

        NOTE: No PKCE parameters — Notion does not support code_challenge.
        The state parameter is still used for CSRF protection.
        """
        params = {
            "client_id": client_id,
            "redirect_uri": REDIRECT_URI,
            "response_type": "code",
            "owner": "user",
            "state": state,
        }
        return f"{NOTION_AUTH_URL}?{urlencode(params)}"

    @classmethod
    async def exchange_code(
        cls, client_id: str, client_secret: str, code: str
    ) -> dict:
        """Exchange auth code for access token using HTTP Basic Auth.

        Notion requires credentials as Basic Auth header (not in POST body).
        Returns full token response including workspace_id, workspace_name,
        bot_id, and optionally duplicated_template_id.
        """
        credentials = f"{client_id}:{client_secret}"
        encoded = base64.b64encode(credentials.encode("utf-8")).decode("ascii")

        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.post(
                NOTION_TOKEN_URL,
                headers={
                    "Authorization": f"Basic {encoded}",
                    "Content-Type": "application/json",
                    "Notion-Version": NOTION_VERSION,
                },
                json={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": REDIRECT_URI,
                },
            )
            resp.raise_for_status()
            return resp.json()

    # ------------------------------------------------------------------ API calls

    @classmethod
    async def list_accessible_databases(cls, access_token: str) -> list[dict]:
        """Search for all databases the integration can access.

        Uses POST /v1/search with filter type=database.
        Returns list of {id, title} dicts.
        """
        databases = []
        start_cursor: Optional[str] = None

        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            while True:
                body: dict = {
                    "filter": {"value": "database", "property": "object"},
                    "page_size": 100,
                }
                if start_cursor:
                    body["start_cursor"] = start_cursor

                resp = await client.post(
                    f"{NOTION_API_BASE}/search",
                    headers=_notion_headers(access_token),
                    json=body,
                )
                resp.raise_for_status()
                data = resp.json()

                for item in data.get("results", []):
                    title_list = (
                        item.get("title") or []
                    )  # database title is an array of rich-text
                    title_str = "".join(
                        t.get("plain_text", "") for t in title_list
                    ) or "(Başlıksız)"
                    databases.append({"id": item["id"], "title": title_str})

                if data.get("has_more"):
                    start_cursor = data.get("next_cursor")
                else:
                    break

        return databases

    @classmethod
    async def query_database(
        cls,
        access_token: str,
        database_id: str,
        since: Optional[datetime] = None,
    ) -> list[dict]:
        """Query a Notion database, returning all pages (with pagination).

        since: if provided, only pages with last_edited_time >= since.
        Returns raw Notion page objects.
        """
        pages: list[dict] = []
        start_cursor: Optional[str] = None

        # Build filter for incremental sync
        body: dict = {"page_size": 100}
        if since:
            # Notion filter by last_edited_time requires ISO string
            since_str = since.strftime("%Y-%m-%dT%H:%M:%S.000Z")
            body["filter"] = {
                "timestamp": "last_edited_time",
                "last_edited_time": {"on_or_after": since_str},
            }

        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            while True:
                if start_cursor:
                    body["start_cursor"] = start_cursor

                resp = await client.post(
                    f"{NOTION_API_BASE}/databases/{database_id}/query",
                    headers=_notion_headers(access_token),
                    json=body,
                )
                resp.raise_for_status()
                data = resp.json()
                pages.extend(data.get("results", []))

                if data.get("has_more"):
                    start_cursor = data.get("next_cursor")
                else:
                    break

        return pages

    @classmethod
    async def get_page(cls, access_token: str, page_id: str) -> dict:
        """Retrieve a single Notion page by id."""
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get(
                f"{NOTION_API_BASE}/pages/{page_id}",
                headers=_notion_headers(access_token),
            )
            resp.raise_for_status()
            return resp.json()

    # ------------------------------------------------------------------ property helpers

    @classmethod
    def _extract_icon_image(cls, page: dict) -> Optional[str]:
        """Extract a usable image URL from a Notion page icon.

        Decision: emoji icons are skipped (they are not images and look out
        of place alongside custom visuals). Only file/external icons — which
        are real image URLs — are returned.

        Returns the URL string, or None if there is no icon or it is an emoji.
        """
        icon = page.get("icon")
        if not icon:
            return None
        icon_type = icon.get("type")
        if icon_type == "file":
            return icon.get("file", {}).get("url")
        if icon_type == "external":
            return icon.get("external", {}).get("url")
        # emoji → skip
        return None

    @classmethod
    def _extract_title(cls, page: dict) -> str:
        """Extract the page title from Notion properties."""
        properties = page.get("properties", {})
        for prop in properties.values():
            if prop.get("type") == "title":
                parts = prop.get("title", [])
                return "".join(p.get("plain_text", "") for p in parts).strip() or "(Başlıksız)"
        return "(Başlıksız)"

    @classmethod
    def _extract_status(cls, page: dict) -> Optional[str]:
        """Probe for a status-like property; return its string value or None."""
        properties = page.get("properties", {})
        for name, prop in properties.items():
            if name.lower() in _STATUS_PROP_NAMES:
                ptype = prop.get("type")
                if ptype == "select":
                    sel = prop.get("select") or {}
                    return sel.get("name")
                elif ptype == "status":
                    st = prop.get("status") or {}
                    return st.get("name")
        return None

    @classmethod
    def _extract_due_date(cls, page: dict) -> Optional[datetime]:
        """Probe for a due-date property; return a naive UTC datetime or None."""
        properties = page.get("properties", {})
        for name, prop in properties.items():
            if name.lower() in _DUE_PROP_NAMES:
                if prop.get("type") == "date":
                    date_obj = prop.get("date") or {}
                    raw = date_obj.get("start")
                    if raw:
                        return _parse_notion_datetime(raw)
        return None

    # ------------------------------------------------------------------ sync (BaseProvider)

    async def refresh_token(self, integration: Integration) -> None:
        """No-op: Notion access tokens do not expire."""
        pass

    async def sync(self, session: AsyncSession, integration: Integration) -> None:
        """Pull pages from the selected Notion database and upsert into Task table."""
        from app.models.setting import Setting

        # Read selected database from settings
        db_result = await session.execute(
            select(Setting).where(Setting.key == "notion_selected_database_id")
        )
        db_row = db_result.scalar_one_or_none()
        database_id = db_row.value if db_row and db_row.value else None

        access_token = integration.access_token
        if not access_token or not database_id:
            logger.debug("[notion_sync] Skipping — no token or no database selected")
            return

        pages = await self.query_database(access_token, database_id)

        new_count = 0
        updated_count = 0

        for page in pages:
            try:
                page_id = page.get("id")
                if not page_id:
                    continue

                title = self._extract_title(page)
                status_val = self._extract_status(page)
                due_date = self._extract_due_date(page)
                icon_image = self._extract_icon_image(page)
                last_edited_str = page.get("last_edited_time")
                last_edited = _parse_notion_datetime(last_edited_str)
                is_done = status_val and status_val.lower() in _DONE_STATUSES

                # Upsert NotionSyncedPage
                nsp_result = await session.execute(
                    select(NotionSyncedPage).where(
                        NotionSyncedPage.notion_page_id == page_id
                    )
                )
                nsp = nsp_result.scalar_one_or_none()

                if nsp is None:
                    # New page — create Task + NotionSyncedPage
                    task = Task(
                        title=title,
                        status="done" if is_done else "todo",
                        due_date=due_date,
                        notion_page_id=page_id,
                        icon_image=icon_image,
                    )
                    session.add(task)
                    await session.flush()  # get task.id

                    nsp = NotionSyncedPage(
                        notion_page_id=page_id,
                        database_id=database_id,
                        title=title,
                        status=status_val,
                        due_date=due_date,
                        last_edited_time=last_edited,
                        synced_at=_utcnow(),
                        internal_task_id=task.id,
                    )
                    session.add(nsp)
                    new_count += 1

                else:
                    # Existing page — update if changed
                    changed = False

                    if last_edited and nsp.last_edited_time and last_edited <= nsp.last_edited_time:
                        # No changes since last sync
                        continue

                    nsp.title = title
                    nsp.status = status_val
                    nsp.due_date = due_date
                    nsp.last_edited_time = last_edited
                    nsp.synced_at = _utcnow()

                    # Update linked Task if it exists
                    if nsp.internal_task_id:
                        task_result = await session.execute(
                            select(Task).where(Task.id == nsp.internal_task_id)
                        )
                        task = task_result.scalar_one_or_none()
                        if task:
                            task.title = title
                            task.due_date = due_date
                            task.icon_image = icon_image
                            if is_done:
                                task.status = "done"
                            changed = True

                    if changed or last_edited != nsp.last_edited_time:
                        updated_count += 1

            except Exception as exc:
                logger.warning("[notion_sync] Page %s failed: %s", page.get("id"), exc)
                continue

        integration.last_sync_at = _utcnow()
        await session.commit()
        logger.info(
            "[notion_sync] synced %d pages, %d new, %d updated",
            len(pages),
            new_count,
            updated_count,
        )


# ---------------------------------------------------------------------------
# Self-register into the provider registry
# ---------------------------------------------------------------------------

from app.services.integration_service import PROVIDERS  # noqa: E402

PROVIDERS["notion"] = NotionProvider
