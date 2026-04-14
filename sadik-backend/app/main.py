import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
import logging

from app.database import engine, Base, AsyncSessionLocal
from app.models import Task, ModeLog, ChatMessage, Setting, AppUsageSession
from app.routers import tasks, modes, stats, pomodoro, device, chat, voice, settings, ws, memory

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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
    "llm_model": "gpt-4o",
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
    "spoken_proactive_daily_limit": "1",
}

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables created")

    async with AsyncSessionLocal() as session:
        for key, value in DEFAULT_SETTINGS.items():
            result = await session.execute(select(Setting).where(Setting.key == key))
            if not result.scalar_one_or_none():
                session.add(Setting(key=key, value=value))
        await session.commit()
    logger.info("Default settings seeded")

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

    await pomodoro_service.stop()
    await device_manager.disconnect()
    await mode_tracker.end_current()
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

@app.get("/")
async def root():
    return {"status": "ok", "service": "SADIK Backend", "version": "1.0.0"}
