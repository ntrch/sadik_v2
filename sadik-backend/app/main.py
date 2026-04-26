import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text
import logging

from app.database import engine, Base, AsyncSessionLocal
from app.models import Task, ModeLog, ChatMessage, Setting, AppUsageSession, Workspace, WorkspaceAction, Habit, Event, Integration, ExternalEvent, NotionSyncedPage
from app.routers import tasks, modes, stats, pomodoro, device, chat, voice, settings, ws, memory, workspace as workspace_router_mod
from app.routers import habits as habits_router_mod
from app.routers import weather as weather_router_mod
from app.routers import events as events_router_mod
from app.routers import wake as wake_router_mod
from app.routers import integrations as integrations_router_mod
from app.routers import external_events as external_events_router_mod
from app.routers import privacy as privacy_router_mod
from app.services.providers import google_calendar  # noqa: F401 — self-registers PROVIDERS
from app.services.providers import notion as _notion_provider  # noqa: F401 — self-registers PROVIDERS

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class _FrameFilter(logging.Filter):
    """Suppress uvicorn access-log lines for high-frequency frame POSTs."""
    def filter(self, record: logging.LogRecord) -> bool:
        return "/api/device/frame" not in record.getMessage()


logging.getLogger("uvicorn.access").addFilter(_FrameFilter())

DEFAULT_SETTINGS = {
    "openai_api_key": "",
    "connection_method": "serial",
    "serial_port": "auto",
    "serial_baudrate": "460800",
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
    # Device profile — chosen at order time. Swap model/assets by changing these
    # two keys; the code paths never hard-code a persona.
    "persona_slug": "sadik",
    "wake_model_path": "",  # empty → fallback to built-in "hey_jarvis"
    # Google Calendar OAuth credentials (user-supplied)
    "google_client_id": "",
    "google_client_secret": "",
    "google_oauth_state": "",  # short-lived, cleared after callback
    # Notion OAuth (set by callback, not user-entered)
    "notion_oauth_state": "",
    "notion_access_token": "",
    "notion_bot_id": "",
    "notion_workspace_id": "",
    "notion_workspace_name": "",
    "notion_selected_database_id": "",
    "notion_selected_database_name": "",
    "privacy_behavioral_learning": "false",
    "privacy_calendar_push": "false",
    "privacy_notion_push": "false",
    "privacy_voice_memory": "false",
    "privacy_tier": "hybrid",
    "onboarding_completed": "false",
    "tutorial_completed": "false",
    "user_profile_patterns": "",
    "user_persona": "general",
}

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables created")

    # Idempotent ALTER TABLE migrations — add columns that may be missing from
    # older DB files. Pattern: check PRAGMA table_info, add only if absent.
    async with engine.begin() as conn:
        result = await conn.execute(text("PRAGMA table_info(tasks)"))
        existing_cols = {row[1] for row in result.fetchall()}
        if "notion_page_id" not in existing_cols:
            await conn.execute(text("ALTER TABLE tasks ADD COLUMN notion_page_id VARCHAR"))
            logger.info("tasks: added notion_page_id column")
        if "icon" not in existing_cols:
            await conn.execute(text("ALTER TABLE tasks ADD COLUMN icon VARCHAR"))
            logger.info("tasks: added icon column")
        if "icon_image" not in existing_cols:
            await conn.execute(text("ALTER TABLE tasks ADD COLUMN icon_image TEXT"))
            logger.info("tasks: added icon_image column")

    async with engine.begin() as conn:
        await conn.execute(text("DELETE FROM workspace_actions WHERE workspace_id NOT IN (SELECT id FROM workspaces)"))
    print("[startup] orphan action cleanup done")

    async with AsyncSessionLocal() as session:
        for key, value in DEFAULT_SETTINGS.items():
            result = await session.execute(select(Setting).where(Setting.key == key))
            if not result.scalar_one_or_none():
                session.add(Setting(key=key, value=value))
        await session.commit()
    logger.info("Default settings seeded")

    # Preload openWakeWord model — uses persona-specific model if settings
    # provide a valid path, otherwise falls back to pretrained hey_jarvis.
    try:
        from app.services.wake_word_service import detector as _ww_detector
        import asyncio as _asyncio
        import os as _os
        async with AsyncSessionLocal() as session:
            _wp = await session.execute(select(Setting).where(Setting.key == "wake_model_path"))
            _wp_row = _wp.scalar_one_or_none()
            _wake_path = _wp_row.value if _wp_row else ""
        # Resolve relative paths against the backend package root
        if _wake_path and not _os.path.isabs(_wake_path):
            _wake_path = _os.path.join(_os.path.dirname(__file__), _wake_path)
        await _asyncio.get_event_loop().run_in_executor(None, _ww_detector.load, _wake_path)
    except Exception as _ww_err:
        logger.warning("openWakeWord model yüklenemedi: %s", _ww_err)

    # Start habit reminder scheduler
    from app.services import habits_service
    _habits_task = habits_service.create_scheduler_task()

    # Start integration sync scheduler (no-op until providers are registered)
    from app.services import integration_service
    _integrations_task = integration_service.create_scheduler_task()

    # Behavioral pattern mining (Sprint 3). Writes user_profile_patterns setting
    # every 6h; LLM injection + Dashboard "Profil" card both read from it.
    from app.services import behavioral_patterns
    _patterns_task = behavioral_patterns.create_scheduler_task()

    # Best-effort auto-connect on startup — must never block indefinitely.
    # Each port gets a 2 s internal timeout; the whole scan gets a 10 s outer
    # guard so startup always completes even if a port stalls in the OS layer.
    try:
        from app.services.device_manager import device_manager as _dm
        async with AsyncSessionLocal() as session:
            baud_result = await session.execute(select(Setting).where(Setting.key == "serial_baudrate"))
            baud_setting = baud_result.scalar_one_or_none()
            baudrate = int(baud_setting.value) if baud_setting else 115200
        conn_result = await asyncio.wait_for(
            _dm.auto_connect(baudrate=baudrate),
            timeout=10.0,
        )
        if conn_result["connected"]:
            logger.info(f"Startup auto-connect: connected to {conn_result['port']}")
        else:
            logger.info(f"Startup auto-connect: no device found ({conn_result['message']})")
    except asyncio.TimeoutError:
        logger.warning("Startup auto-connect timed out after 10 s — continuing without device")
    except Exception as e:
        logger.warning(f"Startup auto-connect skipped: {e}")

    yield

    # Shutdown
    from app.services.pomodoro_service import pomodoro_service
    from app.services.device_manager import device_manager
    from app.services.mode_tracker import mode_tracker
    from app.services import habits_service as _hs

    from app.services import integration_service as _is
    await pomodoro_service.stop()
    await device_manager.disconnect()
    await mode_tracker.end_current()
    from app.services import behavioral_patterns as _bp
    await _hs.stop_scheduler()
    await _is.stop_scheduler()
    await _bp.stop_scheduler()
    logger.info("SADIK backend shutdown complete")

app = FastAPI(title="SADIK Backend", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tasks.router)
app.include_router(modes.router)
app.include_router(stats.router)
app.include_router(pomodoro.router)
app.include_router(device.router)
app.include_router(chat.router)
app.include_router(voice.router)
app.include_router(settings.router)
app.include_router(ws.router)
app.include_router(memory.router)
app.include_router(workspace_router_mod.router)
app.include_router(habits_router_mod.router)
app.include_router(weather_router_mod.router)
app.include_router(events_router_mod.router)
app.include_router(wake_router_mod.router)
app.include_router(integrations_router_mod.router)
app.include_router(external_events_router_mod.router)
app.include_router(privacy_router_mod.router)

@app.get("/")
async def root():
    return {"status": "ok", "service": "SADIK Backend", "version": "1.0.0"}


@app.get("/api/health")
async def health():
    """Startup health probe — Electron polls this until the backend is ready."""
    return {"status": "ok", "version": "2.0.0"}
