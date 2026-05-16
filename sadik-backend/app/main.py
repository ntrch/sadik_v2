import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text
import logging

from app.database import engine, Base, AsyncSessionLocal
from app.models import Task, ModeLog, ChatMessage, Setting, AppUsageSession, Workspace, WorkspaceAction, Habit, HabitLog, Event, Integration, ExternalEvent, NotionSyncedPage, FeedbackSubmission, VoiceTurnEvent, CrashReport  # noqa: F401
from app.routers import tasks, modes, stats, pomodoro, device, chat, voice, settings, ws, memory, workspace as workspace_router_mod
from app.routers import habits as habits_router_mod
from app.routers import weather as weather_router_mod
from app.routers import events as events_router_mod
from app.routers import wake as wake_router_mod
from app.routers import integrations as integrations_router_mod
from app.routers import external_events as external_events_router_mod
from app.routers import privacy as privacy_router_mod
from app.routers import feedback as feedback_router_mod
from app.routers import usage as usage_router_mod
from app.routers import telemetry as telemetry_router_mod
from app.routers import billing as billing_router_mod
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
    "serial_baudrate": "921600",
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
    "llm_model": "gpt-4o-mini",
    "continuous_conversation": "false",
    "user_name": "",
    "greeting_style": "dostum",
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
    "wake_threshold": "0.35",
    "wake_input_gain": "1.9",
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
    "telemetry_consent": "false",
    "telemetry_consent_asked": "false",
    # User tier — Free / Pro
    "user_tier": "free",
    "pro_expires_at": "",  # ISO 8601; empty = no expiry; set to enable Pro
    # Stripe billing (shadow — feature flag controls frontend visibility)
    "stripe_customer_id": "",
    "stripe_subscription_id": "",
    "billing_enabled": "false",  # "true" → frontend shows Upgrade/Manage buttons
    "onboarding_completed": "false",
    "tutorial_completed": "false",
    "user_profile_patterns": "",
    "user_persona": "general",
    "user_activities": "",          # CSV: "code,writing,learning"
    "user_preset_modes": "",        # CSV: "coding,writing,break,working"
    # ── Voice V2 — Gemini Live (Sprint 9.5) ──────────────────────────────────
    "gemini_api_key": "",           # Google AI Studio key — never sent to client
}

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup — DB schema bootstrap.
    # Per-table create with checkfirst, each in its own transaction so a single
    # collision (e.g. PyInstaller-bundled SQLite quirk where an index reports
    # missing but actually exists) doesn't roll back the whole batch.
    logger.info(f"DB URL: {engine.url}")
    for table in Base.metadata.sorted_tables:
        try:
            async with engine.begin() as conn:
                await conn.run_sync(lambda c, t=table: t.create(c, checkfirst=True))
        except Exception as e:
            if "already exists" in str(e).lower():
                logger.warning(f"table {table.name} skip: {e}")
            else:
                raise
    logger.info("Database tables ensured")

    # Idempotent ALTER TABLE migrations — add columns that may be missing from
    # older DB files. Pattern: check PRAGMA table_info, add only if absent.
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text("PRAGMA table_info(tasks)"))
            existing_cols = {row[1] for row in result.fetchall()}
            if existing_cols:  # tasks table exists
                if "notion_page_id" not in existing_cols:
                    await conn.execute(text("ALTER TABLE tasks ADD COLUMN notion_page_id VARCHAR"))
                    logger.info("tasks: added notion_page_id column")
                if "icon" not in existing_cols:
                    await conn.execute(text("ALTER TABLE tasks ADD COLUMN icon VARCHAR"))
                    logger.info("tasks: added icon column")
                if "icon_image" not in existing_cols:
                    await conn.execute(text("ALTER TABLE tasks ADD COLUMN icon_image TEXT"))
                    logger.info("tasks: added icon_image column")
    except Exception as e:
        logger.warning(f"tasks migration skip: {e}")

    # S3.5 habit column migration — add new columns to existing habits table
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text("PRAGMA table_info(habits)"))
            existing_habit_cols = {row[1] for row in result.fetchall()}
            if existing_habit_cols:
                new_habit_cols = [
                    ("color",            "TEXT NOT NULL DEFAULT '#fdba74'"),
                    ("icon",             "TEXT NOT NULL DEFAULT 'repeat'"),
                    ("target_days",      "INTEGER NOT NULL DEFAULT 66"),
                    ("frequency_type",   "TEXT NOT NULL DEFAULT 'daily'"),
                    ("interval_minutes", "INTEGER"),
                ]
                for col, defn in new_habit_cols:
                    if col not in existing_habit_cols:
                        await conn.execute(text(f"ALTER TABLE habits ADD COLUMN {col} {defn}"))
                        logger.info(f"habits: added column {col}")
    except Exception as e:
        logger.warning(f"habits migration skip: {e}")

    try:
        async with engine.begin() as conn:
            await conn.execute(text("DELETE FROM workspace_actions WHERE workspace_id NOT IN (SELECT id FROM workspaces)"))
        print("[startup] orphan action cleanup done")
    except Exception as e:
        logger.warning(f"orphan cleanup skip: {e}")

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

    # Bug 3 fix: USB disconnect monitor — polls every 2 s; when serial port
    # disappears (SerialException / OSError / port closed unexpectedly), emits
    # device_status and device_profile WS events so the app clears connection UI.
    from app.services.device_manager import device_manager as _dm_monitor
    from app.services.serial_service import serial_service as _ss_monitor
    from app.services.ws_manager import ws_manager as _ws_monitor

    async def _usb_disconnect_monitor():
        import serial
        # A2.3 backpressure fix: require N consecutive probe failures before
        # declaring a disconnect.  A single write timeout during a frame burst
        # can transiently close the port; one bad probe must not trigger a
        # full disconnect broadcast and UI reset.
        _PROBE_FAIL_THRESHOLD = 3
        _probe_fail_streak = 0
        while True:
            try:
                await asyncio.sleep(2.0)
                # Only check when we believe a serial connection is active
                if _dm_monitor._method != "serial":
                    _probe_fail_streak = 0
                    continue
                if not _ss_monitor.is_connected:
                    # Port already closed — state mismatch.
                    # Require 3 consecutive "not connected" polls before declaring disconnect
                    # to guard against transient backoff-induced closure races.
                    _probe_fail_streak += 1
                    if _probe_fail_streak < _PROBE_FAIL_THRESHOLD:
                        logger.debug(
                            f"USB disconnect monitor: port not connected "
                            f"(streak={_probe_fail_streak}/{_PROBE_FAIL_THRESHOLD}) — waiting"
                        )
                        continue
                    logger.warning(
                        f"USB disconnect monitor: serial port closed unexpectedly "
                        f"(confirmed after {_probe_fail_streak} consecutive checks)"
                    )
                    _probe_fail_streak = 0
                    _dm_monitor._method = None
                    _dm_monitor._port = None
                    _ss_monitor._serial = None
                    _ss_monitor._active_port = None
                    _ss_monitor.last_device_line = None
                    await _ws_monitor.broadcast({"type": "device_status", "data": {
                        "connected": False, "method": None, "port": None, "ip": None
                    }})
                    await _ws_monitor.broadcast({"type": "device_profile", "data": {"line": None}})
                    continue
                # Port looks connected — probe liveness via in_waiting.
                # SerialException/OSError = USB physically disconnected.
                # Bug 7 fix: also catch TypeError/AttributeError — Windows pyserial raises
                # TypeError("byref() argument must be a ctypes instance, not 'NoneType'")
                # when in_waiting is probed on an already-closed NULL handle.
                loop = asyncio.get_event_loop()
                try:
                    def _probe():
                        s = _ss_monitor._serial
                        if s is None or not s.is_open:
                            raise serial.SerialException("port not open")
                        _ = s.in_waiting  # raises OSError/SerialException/TypeError if USB pulled
                    await loop.run_in_executor(None, _probe)
                    # Successful probe — reset streak counter
                    _probe_fail_streak = 0
                except (serial.SerialException, OSError, TypeError, AttributeError) as exc:
                    _probe_fail_streak += 1
                    if _probe_fail_streak < _PROBE_FAIL_THRESHOLD:
                        logger.debug(
                            f"USB probe failed (streak={_probe_fail_streak}/{_PROBE_FAIL_THRESHOLD}): {exc}"
                        )
                        continue
                    logger.warning(
                        f"USB disconnect detected after {_probe_fail_streak} consecutive probe failures: {exc}"
                    )
                    _probe_fail_streak = 0
                    # Clean up state
                    try:
                        if _ss_monitor._serial and _ss_monitor._serial.is_open:
                            _ss_monitor._serial.close()
                    except Exception:
                        pass
                    _ss_monitor._serial = None
                    _ss_monitor._active_port = None
                    _ss_monitor.last_device_line = None
                    _dm_monitor._method = None
                    _dm_monitor._port = None
                    # Notify app
                    await _ws_monitor.broadcast({"type": "device_status", "data": {
                        "connected": False, "method": None, "port": None, "ip": None
                    }})
                    await _ws_monitor.broadcast({"type": "device_profile", "data": {"line": None}})
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.debug(f"USB disconnect monitor error: {e}")

    _monitor_task = asyncio.create_task(_usb_disconnect_monitor())

    # Serial event reader — polls firmware-emitted unsolicited lines (EVENT:*)
    # and broadcasts them to WebSocket clients.
    # Runs independently from the disconnect monitor so EVENT: lines are not
    # swallowed by send_and_read's skip-list.
    from app.services.serial_service import serial_service as _ss_events
    from app.services.ws_manager import ws_manager as _ws_events

    async def _serial_event_reader():
        while True:
            try:
                await asyncio.sleep(0.05)  # 50 ms poll
                line = await _ss_events.read_line()
                if not line:
                    continue
                if line == "EVENT:LOCAL_CLIP_FINISHED":
                    logger.debug("Serial event: LOCAL_CLIP_FINISHED — broadcasting WS")
                    await _ws_events.broadcast({"type": "local_clip_finished", "data": {}})
                # Future EVENT: lines can be dispatched here in the same pattern
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.debug(f"Serial event reader error: {e}")

    _event_task = asyncio.create_task(_serial_event_reader())

    yield

    # Shutdown
    _event_task.cancel()
    try:
        await _event_task
    except asyncio.CancelledError:
        pass
    _monitor_task.cancel()
    try:
        await _monitor_task
    except asyncio.CancelledError:
        pass
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
app.include_router(feedback_router_mod.router)
app.include_router(usage_router_mod.router)
app.include_router(telemetry_router_mod.router)
app.include_router(billing_router_mod.router)

@app.get("/")
async def root():
    return {"status": "ok", "service": "SADIK Backend", "version": "1.0.0"}


@app.get("/api/health")
async def health():
    """Startup health probe — Electron polls this until the backend is ready."""
    return {"status": "ok", "version": "2.0.0"}
