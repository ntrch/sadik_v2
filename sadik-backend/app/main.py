from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
import logging

from app.database import engine, Base, AsyncSessionLocal
from app.models import Task, ModeLog, ChatMessage, Setting
from app.routers import tasks, modes, stats, pomodoro, device, chat, voice, settings, ws

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

@app.get("/")
async def root():
    return {"status": "ok", "service": "SADIK Backend", "version": "1.0.0"}
