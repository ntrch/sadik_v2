import secrets
import time
from datetime import datetime, date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from pydantic import BaseModel

from app.database import get_session, Base, AsyncSessionLocal
from app.services.privacy_flags import apply_tier_to_flags, get_privacy_tier, get_privacy_flags
from app.models import (  # noqa: F401 — ensure all models are registered on Base.metadata
    Task, ModeLog, ChatMessage, Setting, AppUsageSession,
    ClipboardItem, BrainstormNote, Workspace, WorkspaceAction,
    Habit, Event, Integration, ExternalEvent,
)

router = APIRouter(prefix="/api/privacy", tags=["privacy"])

_pending_purge_tokens: dict[str, float] = {}

_SKIP_TABLES = {"alembic_version"}

DEFAULT_SETTINGS = {
    "openai_api_key": "",
    "connection_method": "serial",
    "serial_port": "auto",
    "serial_baudrate": "115200",
    "wifi_device_ip": "",
    "pomodoro_work_minutes": "25",
    "pomodoro_break_minutes": "5",
    "pomodoro_long_break_minutes": "15",
    "pomodoro_sessions_before_long_break": "4",
    "microphone_device": "default",
    "speaker_device": "default",
    "audio_input_device_id": "default",
    "audio_output_device_id": "default",
    "wake_word_enabled": "true",
    "tts_voice": "tr-TR-EmelNeural",
    "tts_provider": "elevenlabs",
    "tts_openai_voice": "onyx",
    "elevenlabs_api_key": "",
    "elevenlabs_voice_id": "",
    "elevenlabs_model_id": "eleven_v3",
    "llm_model": "gpt-4o-mini",
    "continuous_conversation": "false",
    "user_name": "",
    "greeting_style": "dostum",
    "oled_brightness_percent": "70",
    "oled_sleep_timeout_minutes": "10",
    "close_to_tray": "true",
    "proactive_suggestions_enabled": "true",
    "proactive_quiet_hours_start": "23:00",
    "proactive_quiet_hours_end": "08:00",
    "proactive_daily_limit": "3",
    "proactive_cooldown_minutes": "60",
    "spoken_proactive_enabled": "true",
    "spoken_proactive_daily_limit": "3",
    "weather_enabled": "false",
    "weather_api_key": "",
    "weather_city": "",
    "weather_location_label": "",
    "weather_lat": "",
    "weather_lon": "",
    "persona_slug": "sadik",
    "wake_model_path": "",
    "google_client_id": "",
    "google_client_secret": "",
    "google_oauth_state": "",
    "privacy_behavioral_learning": "false",
    "privacy_calendar_push": "false",
    "privacy_notion_push": "false",
    "privacy_voice_memory": "false",
}


def _serialize(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def _row_to_dict(row) -> dict:
    return {col.name: _serialize(getattr(row, col.name)) for col in row.__table__.columns}


@router.get("/export")
async def export_data(session: AsyncSession = Depends(get_session)):
    tables: dict[str, list] = {}
    for model in [
        Task, ModeLog, ChatMessage, Setting, AppUsageSession,
        ClipboardItem, BrainstormNote, Workspace, WorkspaceAction,
        Habit, Event, Integration, ExternalEvent,
    ]:
        result = await session.execute(__import__("sqlalchemy").select(model))
        tables[model.__tablename__] = [_row_to_dict(r) for r in result.scalars().all()]
    return {"exported_at": datetime.utcnow().isoformat(), "tables": tables}


@router.post("/purge/request")
async def purge_request():
    now = time.time()
    expired = [t for t, exp in _pending_purge_tokens.items() if exp <= now]
    for t in expired:
        del _pending_purge_tokens[t]
    token = secrets.token_urlsafe(6)
    _pending_purge_tokens[token] = now + 60
    return {"token": token, "expires_in": 60}


@router.delete("/purge")
async def purge_data(token: str = Query(...)):
    now = time.time()
    if token not in _pending_purge_tokens or _pending_purge_tokens[token] <= now:
        _pending_purge_tokens.pop(token, None)
        raise HTTPException(status_code=400, detail="Token invalid or expired")

    tables_cleared = 0
    async with AsyncSessionLocal() as session:
        async with session.begin():
            await session.execute(text("PRAGMA foreign_keys=OFF"))
            for table in reversed(Base.metadata.sorted_tables):
                if table.name in _SKIP_TABLES:
                    continue
                await session.execute(table.delete())
                tables_cleared += 1
            await session.execute(text("PRAGMA foreign_keys=ON"))

        for key, value in DEFAULT_SETTINGS.items():
            session.add(Setting(key=key, value=value))
        await session.commit()

    del _pending_purge_tokens[token]
    return {"purged": True, "tables_cleared": tables_cleared, "re_seeded_settings": True}


class TierUpdate(BaseModel):
    tier: str


@router.get("/tier")
async def get_tier(session: AsyncSession = Depends(get_session)):
    tier = await get_privacy_tier(session)
    flags = await get_privacy_flags(session)
    return {"tier": tier, "flags": flags}


@router.put("/tier")
async def set_tier(body: TierUpdate, session: AsyncSession = Depends(get_session)):
    if body.tier not in ("full", "hybrid", "local"):
        raise HTTPException(
            status_code=400,
            detail="Invalid tier. Must be 'full', 'hybrid', or 'local'.",
        )
    await apply_tier_to_flags(session, body.tier)
    flags = await get_privacy_flags(session)
    return {"tier": body.tier, "flags": flags}
