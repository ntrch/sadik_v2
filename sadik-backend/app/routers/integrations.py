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

    return {"ok": True, "provider": provider}


# ---------------------------------------------------------------------------
# New endpoints
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
