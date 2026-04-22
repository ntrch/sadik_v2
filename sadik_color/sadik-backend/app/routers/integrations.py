import base64
import hashlib
import secrets
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings as app_settings
from app.database import get_session
from app.models.setting import Setting
from app.services import integration_service


def _pkce_pair() -> tuple[str, str]:
    """Return (code_verifier, code_challenge_S256) for a fresh OAuth attempt."""
    verifier = secrets.token_urlsafe(64)[:128]
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge

router = APIRouter(prefix="/api/integrations", tags=["integrations"])

# ---------------------------------------------------------------------------
# Known providers — order determines UI display order.
# ---------------------------------------------------------------------------

_KNOWN_PROVIDERS = ["google_calendar", "notion", "slack", "zoom"]

_PROVIDER_META = [
    {
        "id": "google_calendar",
        "display_name": "Google Takvim",
        "description": "Etkinlikleri Ajanda sayfasına çek",
        "icon_key": "Calendar",
        "color": "cyan",
    },
    {
        "id": "notion",
        "display_name": "Notion",
        "description": "Veritabanlarını görevlere dönüştür",
        "icon_key": "StickyNote",
        "color": "purple",
    },
    {
        "id": "slack",
        "display_name": "Slack",
        "description": "Aktif kanal aktivitesini takip et",
        "icon_key": "MessageSquare",
        "color": "pink",
    },
    {
        "id": "zoom",
        "display_name": "Zoom",
        "description": "Aktif toplantıyı modu tetikle",
        "icon_key": "Video",
        "color": "orange",
    },
]

# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


class IntegrationStatusResponse(BaseModel):
    provider: str
    status: str  # 'connected' | 'disconnected' | 'error'
    account_email: Optional[str]
    last_sync_at: Optional[datetime]
    last_error: Optional[str]
    scopes: Optional[str]
    connected_at: Optional[datetime]

    class Config:
        from_attributes = True


class ProviderMetaResponse(BaseModel):
    id: str
    display_name: str
    description: str
    icon_key: str
    color: str


class SyncNowResponse(BaseModel):
    ok: bool
    last_sync_at: Optional[datetime]
    event_count: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


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


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ---------------------------------------------------------------------------
# Existing endpoints
# ---------------------------------------------------------------------------


@router.get("/providers", response_model=List[ProviderMetaResponse])
async def list_providers():
    """Return static metadata for all supported integration providers."""
    return _PROVIDER_META


@router.get("", response_model=List[IntegrationStatusResponse])
async def list_integrations(session: AsyncSession = Depends(get_session)):
    """Return one row per known provider, even if no DB entry exists yet."""
    db_rows = await integration_service.list_integrations(session)
    db_map = {row.provider: row for row in db_rows}

    result = []
    for provider_id in _KNOWN_PROVIDERS:
        row = db_map.get(provider_id)
        if row:
            result.append(
                IntegrationStatusResponse(
                    provider=row.provider,
                    status=row.status,
                    account_email=row.account_email,
                    last_sync_at=row.last_sync_at,
                    last_error=row.last_error,
                    scopes=row.scopes,
                    connected_at=row.connected_at,
                )
            )
        else:
            result.append(
                IntegrationStatusResponse(
                    provider=provider_id,
                    status="disconnected",
                    account_email=None,
                    last_sync_at=None,
                    last_error=None,
                    scopes=None,
                    connected_at=None,
                )
            )
    return result


@router.post("/{provider}/disconnect")
async def disconnect_provider(
    provider: str, session: AsyncSession = Depends(get_session)
):
    """Disconnect a provider — clears tokens but keeps the row for audit.

    For google_calendar, also purges all ExternalEvent rows so stale events
    don't linger in the Agenda view.
    """
    if provider not in _KNOWN_PROVIDERS:
        raise HTTPException(status_code=404, detail=f"Unknown provider: {provider}")

    await integration_service.disconnect(session, provider)

    if provider == "google_calendar":
        from app.models.external_event import ExternalEvent
        from sqlalchemy import delete as sa_delete

        await session.execute(
            sa_delete(ExternalEvent).where(ExternalEvent.source == "google_calendar")
        )
        await session.commit()

        # Clear Meet-related settings too — they're tied to this Google account
        for key in ("google_account_sub", "google_meet_state"):
            await _set_setting(session, key, "")

    return {"ok": True, "provider": provider}


# ---------------------------------------------------------------------------
# Notion-specific endpoints
# IMPORTANT: these must be registered BEFORE the parametric /{provider}/...
# routes below so FastAPI's path matcher prefers the literal "/notion/..." path.
# ---------------------------------------------------------------------------


class NotionDatabaseSelectRequest(BaseModel):
    database_id: str
    database_name: str


@router.get("/notion/start")
async def notion_oauth_start(session: AsyncSession = Depends(get_session)):
    """Generate Notion OAuth authorization URL.

    NOTE: Notion does not support PKCE — only state CSRF token is generated.
    Token exchange uses HTTP Basic Auth with client_id:client_secret.
    """
    cid = app_settings.notion_client_id
    if not cid or not cid.strip():
        raise HTTPException(status_code=500, detail="notion_client_id_not_configured")

    state = secrets.token_urlsafe(32)
    await _set_setting(session, "notion_oauth_state", state)

    from app.services.providers.notion import NotionProvider

    auth_url = NotionProvider.build_auth_url(cid.strip(), state)
    return {"auth_url": auth_url}


@router.get("/notion/callback", response_class=HTMLResponse)
async def notion_oauth_callback(
    session: AsyncSession = Depends(get_session),
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
):
    """Landing page after Notion OAuth redirect. Exchanges code for token."""
    _close_html = """<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>SADIK</title></head>
<body style="font-family:system-ui;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px">
{body}
<script>setTimeout(()=>window.close(),2000)</script>
</body>
</html>"""

    if error:
        return HTMLResponse(
            _close_html.format(body=f"<h2>Hata ✗</h2><p>{error}</p>"),
            status_code=400,
        )

    if not code:
        return HTMLResponse(
            _close_html.format(body="<h2>Hata ✗</h2><p>Kod alınamadı.</p>"),
            status_code=400,
        )

    stored_state = await _get_setting(session, "notion_oauth_state")
    if not stored_state or stored_state != state:
        return HTMLResponse(
            _close_html.format(body="<h2>Hata ✗</h2><p>Geçersiz state parametresi.</p>"),
            status_code=400,
        )

    # Clear state — single-use
    await _set_setting(session, "notion_oauth_state", "")

    cid = app_settings.notion_client_id
    csec = app_settings.notion_client_secret
    if not cid or not csec:
        return HTMLResponse(
            _close_html.format(
                body="<h2>Hata ✗</h2><p>Notion client credentials eksik — .env dosyasını kontrol edin.</p>"
            ),
            status_code=500,
        )

    try:
        from app.services.providers.notion import NotionProvider

        tokens = await NotionProvider.exchange_code(cid.strip(), csec.strip(), code)

        access_token = tokens.get("access_token")
        bot_id = tokens.get("bot_id", "")
        workspace_id = tokens.get("workspace_id", "")
        workspace_name = tokens.get("workspace_name", "")

        if not access_token:
            raise ValueError("Notion token yanıtında access_token yok")

        # Persist tokens in both Integration table and Settings for easy lookup
        await integration_service.upsert_integration(
            session,
            "notion",
            status="connected",
            access_token=access_token,
            refresh_token=None,  # Notion has no refresh token
            expires_at=None,     # Notion tokens never expire
            scopes="",
            account_email=workspace_name,
            connected_at=_utcnow(),
            last_error=None,
        )

        # Store extra Notion-specific fields in Settings
        await _set_setting(session, "notion_access_token", access_token)
        await _set_setting(session, "notion_bot_id", bot_id)
        await _set_setting(session, "notion_workspace_id", workspace_id)
        await _set_setting(session, "notion_workspace_name", workspace_name)

    except Exception as exc:
        return HTMLResponse(
            _close_html.format(body=f"<h2>Hata ✗</h2><p>{exc}</p>"),
            status_code=500,
        )

    return HTMLResponse(
        _close_html.format(
            body=f"<h2>Bağlandı ✓</h2><p>{workspace_name} çalışma alanı bağlandı. Bu sekmeyi kapatabilirsiniz.</p>"
        )
    )


@router.get("/notion/status")
async def notion_status(session: AsyncSession = Depends(get_session)):
    """Return connection status and workspace name."""
    integration = await integration_service.get_integration(session, "notion")
    if integration and integration.status == "connected":
        workspace_name = await _get_setting(session, "notion_workspace_name") or ""
        return {"connected": True, "workspace_name": workspace_name}
    return {"connected": False, "workspace_name": None}


@router.post("/notion/disconnect")
async def notion_disconnect(session: AsyncSession = Depends(get_session)):
    """Disconnect Notion — clear tokens and settings."""
    await integration_service.disconnect(session, "notion")

    # Clear Notion-specific settings
    for key in (
        "notion_access_token",
        "notion_bot_id",
        "notion_workspace_id",
        "notion_workspace_name",
        "notion_selected_database_id",
        "notion_selected_database_name",
        "notion_oauth_state",
    ):
        await _set_setting(session, key, "")

    return {"ok": True}


@router.get("/notion/databases")
async def notion_list_databases(session: AsyncSession = Depends(get_session)):
    """Return databases accessible by the connected integration."""
    integration = await integration_service.get_integration(session, "notion")
    if not integration or integration.status != "connected":
        raise HTTPException(status_code=400, detail="notion_not_connected")

    access_token = integration.access_token
    if not access_token:
        raise HTTPException(status_code=400, detail="notion_no_token")

    try:
        from app.services.providers.notion import NotionProvider

        databases = await NotionProvider.list_accessible_databases(access_token)
        return {"databases": databases}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/notion/database")
async def notion_select_database(
    body: NotionDatabaseSelectRequest,
    session: AsyncSession = Depends(get_session),
):
    """Save the user's selected Notion database for sync."""
    integration = await integration_service.get_integration(session, "notion")
    if not integration or integration.status != "connected":
        raise HTTPException(status_code=400, detail="notion_not_connected")

    await _set_setting(session, "notion_selected_database_id", body.database_id)
    await _set_setting(session, "notion_selected_database_name", body.database_name)

    return {
        "ok": True,
        "database_id": body.database_id,
        "database_name": body.database_name,
    }


# ---------------------------------------------------------------------------
# Google Meet — active-conference state (read-only; piggybacks on google_calendar)
# ---------------------------------------------------------------------------


@router.get("/google_meet/state")
async def google_meet_state(session: AsyncSession = Depends(get_session)):
    """Return the last polled Google Meet active-conference state.

    The state is refreshed every 60s by the calendar sync scheduler. Returns
    an empty/off state when Meet scope is not granted or no meeting is live.
    """
    from app.services.providers.google_meet import (
        REQUIRED_SCOPE,
        get_meet_state,
    )

    integration = await integration_service.get_integration(session, "google_calendar")
    state = await get_meet_state(session)

    scope_granted = bool(
        integration
        and integration.status == "connected"
        and integration.scopes
        and REQUIRED_SCOPE in integration.scopes
    )

    return {
        "scope_granted": scope_granted,
        "state": state,
    }


# ---------------------------------------------------------------------------
# Google Calendar OAuth (parametric routes — must come AFTER literal /notion/...)
# ---------------------------------------------------------------------------


@router.get("/{provider}/connect")
async def start_oauth(provider: str, session: AsyncSession = Depends(get_session)):
    """Generate an OAuth authorization URL (Desktop + PKCE flow).

    No client credentials are requested from the user — the embedded Desktop
    client_id is used; PKCE code_challenge protects the token exchange.
    """
    if provider != "google_calendar":
        raise HTTPException(status_code=404, detail="oauth_not_supported")

    cid = app_settings.google_client_id
    if not cid or not cid.strip():
        raise HTTPException(status_code=500, detail="embedded_client_id_missing")

    state = secrets.token_urlsafe(16)
    verifier, challenge = _pkce_pair()
    await _set_setting(session, "google_oauth_state", state)
    await _set_setting(session, "google_oauth_code_verifier", verifier)

    from app.services.providers.google_calendar import GoogleCalendarProvider

    auth_url = await GoogleCalendarProvider.build_auth_url(cid.strip(), state, challenge)
    return {"auth_url": auth_url}


@router.get("/{provider}/callback", response_class=HTMLResponse)
async def oauth_callback(
    provider: str,
    session: AsyncSession = Depends(get_session),
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
):
    """Landing page after Google OAuth redirect.  Exchanges code for tokens."""
    if provider != "google_calendar":
        raise HTTPException(status_code=404, detail="callback_not_supported")

    _close_html = """<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>SADIK</title></head>
<body style="font-family:system-ui;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px">
{body}
<script>setTimeout(()=>window.close(),2000)</script>
</body>
</html>"""

    if error:
        return HTMLResponse(
            _close_html.format(body=f"<h2>Hata ✗</h2><p>{error}</p>"),
            status_code=400,
        )

    if not code:
        return HTMLResponse(
            _close_html.format(body="<h2>Hata ✗</h2><p>Kod alınamadı.</p>"),
            status_code=400,
        )

    # Validate state
    stored_state = await _get_setting(session, "google_oauth_state")
    if not stored_state or stored_state != state:
        return HTMLResponse(
            _close_html.format(body="<h2>Hata ✗</h2><p>Geçersiz state parametresi.</p>"),
            status_code=400,
        )

    # Clear state immediately (single-use)
    await _set_setting(session, "google_oauth_state", "")

    cid = app_settings.google_client_id
    csec = app_settings.google_client_secret
    verifier = await _get_setting(session, "google_oauth_code_verifier")
    # Clear verifier — single-use
    await _set_setting(session, "google_oauth_code_verifier", "")

    if not cid or not csec or not verifier:
        return HTMLResponse(
            _close_html.format(
                body="<h2>Hata ✗</h2><p>OAuth oturumu bulunamadı — tekrar deneyin.</p>"
            ),
            status_code=400,
        )

    try:
        from app.services.providers.google_calendar import GoogleCalendarProvider
        from datetime import timedelta

        tokens = await GoogleCalendarProvider.exchange_code(
            cid.strip(), csec.strip(), code, verifier
        )
        access_token = tokens["access_token"]
        refresh_token_val = tokens.get("refresh_token")
        expires_in = int(tokens.get("expires_in", 3600))
        expires_at = _utcnow() + timedelta(seconds=expires_in)
        scopes = tokens.get("scope", "")

        userinfo = await GoogleCalendarProvider.fetch_userinfo(access_token)
        account_email = userinfo.get("email", "")
        account_sub = userinfo.get("sub", "")
        if account_sub:
            # Used by google_meet provider to identify the user among
            # conference participants (participant list returns `sub`, not email).
            await _set_setting(session, "google_account_sub", account_sub)

        await integration_service.upsert_integration(
            session,
            "google_calendar",
            status="connected",
            access_token=access_token,
            refresh_token=refresh_token_val,
            expires_at=expires_at,
            scopes=scopes,
            account_email=account_email,
            connected_at=_utcnow(),
            last_error=None,
        )
    except Exception as exc:
        return HTMLResponse(
            _close_html.format(body=f"<h2>Hata ✗</h2><p>{exc}</p>"),
            status_code=500,
        )

    return HTMLResponse(
        _close_html.format(
            body="<h2>Bağlandı ✓</h2><p>Bu sekmeyi kapatabilirsiniz.</p>"
        )
    )


@router.post("/{provider}/sync-now", response_model=SyncNowResponse)
async def sync_now(provider: str, session: AsyncSession = Depends(get_session)):
    """Trigger an immediate sync for a specific provider."""
    if provider not in _KNOWN_PROVIDERS:
        raise HTTPException(status_code=404, detail=f"Unknown provider: {provider}")

    from app.services.integration_service import PROVIDERS, get_integration

    provider_cls = PROVIDERS.get(provider)
    if provider_cls is None:
        raise HTTPException(status_code=400, detail="provider_not_implemented")

    integration = await get_integration(session, provider)
    if integration is None or integration.status != "connected":
        raise HTTPException(status_code=400, detail="provider_not_connected")

    try:
        instance = provider_cls()
        await instance.sync(session, integration)
        await session.commit()
    except Exception as exc:
        await integration_service.mark_error(session, provider, str(exc))
        raise HTTPException(status_code=500, detail=str(exc))

    # Count synced events
    from app.models.external_event import ExternalEvent
    from sqlalchemy import func as sqlfunc

    count_result = await session.execute(
        select(sqlfunc.count()).select_from(ExternalEvent).where(
            ExternalEvent.source == provider,
            ExternalEvent.deleted_in_source == False,  # noqa: E712
        )
    )
    event_count = count_result.scalar_one() or 0

    await session.refresh(integration)
    return SyncNowResponse(
        ok=True,
        last_sync_at=integration.last_sync_at,
        event_count=event_count,
    )
