import logging
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from typing import Optional
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from app.database import get_session
from app.models.setting import Setting
from app.services.voice_service import (
    voice_service,
    DEFAULT_EDGE_VOICE,
    DEFAULT_OPENAI_VOICE,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/voice", tags=["voice"])


class TTSRequest(BaseModel):
    text: str


# ── Hallucination filter ───────────────────────────────────────────────────────
# Whisper sometimes generates plausible-sounding but fabricated text when the
# input is silent or very low energy.  These patterns are reliable indicators
# of hallucinations in Turkish-language transcription sessions.

_HALLUCINATION_PATTERNS = [
    # Subtitle / caption noise
    "altyazı", "altyazi", "alt yazı", "alt yazi",
    "altyazılar", "altyazilar",
    "m.k.", " mk ",
    "subtitles", "subtitle",
    # YouTube / social media
    "thanks for watching", "thank you for watching",
    "abone ol", "like and subscribe",
    "lütfen abone olun", "lutfen abone olun",
    "beğen", "begen", "yorumlar",
    "bir sonraki video", "izlemeye devam",
    # Gratitude hallucinations (very common in Turkish)
    "teşekkürler", "tesekkurler",
    "teşekkür ederim", "tesekkur ederim",
    "izlediğiniz için", "izlediginiz icin",
    "dinlediğiniz için", "dinlediginiz icin",
    # URL / domain
    "www.", "http", ".com", ".net",
    # Music / noise symbols
    "♪", "♫", "....",
    # Common ambient / TV hallucinations
    "sesli kitap", "devam ediyor",
    "hoş geldiniz", "hos geldiniz",
    "merhaba arkadaşlar", "merhaba arkadaslar",
    "bu videoda", "bu bölümde", "bu bolumde",
    "bir dahaki", "sonraki bölüm",
]


def _is_hallucination(text: str) -> bool:
    """Return True when *text* looks like a Whisper hallucination."""
    stripped = text.strip()
    if len(stripped) < 3:
        return True
    lower = stripped.lower()
    for pattern in _HALLUCINATION_PATTERNS:
        if pattern in lower:
            return True
    # Repetitive patterns — Whisper often loops the same short phrase
    words = stripped.split()
    if len(words) >= 4:
        unique = set(w.lower() for w in words)
        if len(unique) <= 2:
            return True
    return False


# ── Helpers ────────────────────────────────────────────────────────────────────


async def get_settings_map(session: AsyncSession) -> dict:
    result = await session.execute(select(Setting))
    return {s.key: s.value for s in result.scalars().all()}


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("/stt")
async def speech_to_text(
    audio: UploadFile = File(...),
    prompt: Optional[str] = Form(None),
    session: AsyncSession = Depends(get_session),
):
    """Transcribe uploaded audio with Whisper.

    Returns ``{"text": ""}`` (empty string) for silent chunks and
    hallucinated outputs so callers always receive a well-formed response.

    Pass *prompt* to bias Whisper toward expected vocabulary — e.g. the wake
    word name.  Omit for normal conversational transcription.
    """
    settings = await get_settings_map(session)
    api_key  = settings.get("openai_api_key", "")
    if not api_key:
        raise HTTPException(status_code=400, detail="OpenAI API key not configured")

    audio_bytes = await audio.read()
    logger.info(
        "STT upload: filename=%r, content_type=%r, size=%d bytes",
        audio.filename, audio.content_type, len(audio_bytes),
    )

    if len(audio_bytes) <= 512:
        logger.warning("STT: upload too small (%d bytes), returning empty", len(audio_bytes))
        return {"text": ""}

    try:
        text = await voice_service.stt(audio_bytes, api_key, prompt=prompt)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Filter Whisper hallucinations — return empty string so the caller
    # treats this the same as silence (didnt_hear / skip wake-word check).
    if _is_hallucination(text):
        return {"text": ""}

    return {"text": text}


@router.post("/tts")
async def text_to_speech(
    body: TTSRequest,
    session: AsyncSession = Depends(get_session),
):
    """Stream TTS audio using the configured provider with automatic fallback.

    Priority: ElevenLabs → OpenAI tts-1-hd → edge-tts.
    """
    settings            = await get_settings_map(session)
    api_key             = settings.get("openai_api_key", "")
    provider            = settings.get("tts_provider", "elevenlabs")
    openai_voice        = settings.get("tts_openai_voice", DEFAULT_OPENAI_VOICE)
    edge_voice          = settings.get("tts_voice", DEFAULT_EDGE_VOICE)
    elevenlabs_api_key  = settings.get("elevenlabs_api_key", "")
    elevenlabs_voice_id = settings.get("elevenlabs_voice_id", "")
    elevenlabs_model_id = settings.get("elevenlabs_model_id", "eleven_multilingual_v2")

    return StreamingResponse(
        voice_service.tts_stream(
            body.text,
            api_key=api_key,
            provider=provider,
            openai_voice=openai_voice,
            edge_voice=edge_voice,
            elevenlabs_api_key=elevenlabs_api_key,
            elevenlabs_voice_id=elevenlabs_voice_id,
            elevenlabs_model_id=elevenlabs_model_id,
        ),
        media_type="audio/mpeg",
        headers={"Content-Disposition": "inline"},
    )


@router.get("/devices")
async def list_audio_devices():
    try:
        import sounddevice as sd
        devices = sd.query_devices()
        return [
            {
                "index": i,
                "name": d["name"],
                "max_input_channels": d["max_input_channels"],
                "max_output_channels": d["max_output_channels"],
            }
            for i, d in enumerate(devices)
        ]
    except Exception:
        return []
