import logging
import asyncio
import json
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, Query
from typing import Optional, AsyncIterator
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from app.database import get_session
from app.models.setting import Setting
from app.models.chat_message import ChatMessage
from app.services.voice_service import (
    voice_service,
    clean_text_for_tts,
    DEFAULT_EDGE_VOICE,
    DEFAULT_OPENAI_VOICE,
)
from app.services.chat_service import chat_service

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
    # Farewell / social-filler hallucinations (Whisper loops on silence)
    "hoşçakalın", "hoscakalin", "hoşça kalın", "hosca kalin",
    "güle güle", "gule gule",
    "afiyet olsun",
    "kolay gelsin",
    "iyi günler", "iyi gunler",
    "iyi akşamlar", "iyi aksamlar",
    "hayırlı olsun", "hayirli olsun",
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
    fast: int = Query(0, description="Set to 1 for wake-word path: disables OpenAI retries"),
    session: AsyncSession = Depends(get_session),
):
    """Transcribe uploaded audio with Whisper.

    Returns ``{"text": ""}`` (empty string) for silent chunks and
    hallucinated outputs so callers always receive a well-formed response.

    Pass *prompt* to bias Whisper toward expected vocabulary — e.g. the wake
    word name.  Omit for normal conversational transcription.

    Hallucination filtering is only applied for wake-word detection chunks
    (filename starts with "wake").  Conversation recordings ("recording.*")
    skip the filter because phrases like "teşekkür ederim" are legitimate
    speech that happens to also appear in the hallucination list.
    """
    settings = await get_settings_map(session)
    api_key  = settings.get("openai_api_key", "")
    if not api_key:
        raise HTTPException(status_code=400, detail="OpenAI API key not configured")

    audio_bytes = await audio.read()
    filename = audio.filename or ""
    logger.info(
        "STT upload: filename=%r, content_type=%r, size=%d bytes",
        filename, audio.content_type, len(audio_bytes),
    )

    if len(audio_bytes) <= 512:
        logger.warning("STT: upload too small (%d bytes), returning empty", len(audio_bytes))
        return {"text": ""}

    try:
        text = await voice_service.stt(audio_bytes, api_key, prompt=prompt, fast=bool(fast))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Hallucination filter — ONLY for wake-word detection chunks.
    # Conversation recordings skip the filter; the frontend has its own
    # guards (G1-G3) that handle noise without discarding real speech.
    is_wake_word_chunk = filename.startswith("wake")
    if is_wake_word_chunk and _is_hallucination(text):
        logger.warning("STT: hallucination filtered (wake): %r", text)
        return {"text": ""}

    logger.info("STT result (%s): %r", "wake" if is_wake_word_chunk else "conv", text)
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


class VoiceChatRequest(BaseModel):
    text: str
    history: list[dict] = []


@router.post("/voice-chat-stream")
async def voice_chat_stream(
    body: VoiceChatRequest,
    session: AsyncSession = Depends(get_session),
):
    """Streaming voice-chat endpoint: LLM tokens → TTS per sentence → audio chunks.

    Returns a `multipart/mixed` stream where each part is an audio/mpeg chunk
    for one sentence.  The frontend plays each chunk as it arrives so the user
    hears the first sentence while the LLM is still generating the rest.

    Wire format: each audio chunk is preceded by a 4-byte big-endian length
    header so the client can frame chunks without a multipart parser.

    Frame layout:
        [4 bytes big-endian uint32: chunk_length][chunk_length bytes: MP3 data]

    Repeated until the stream ends.
    """
    settings            = await get_settings_map(session)
    api_key             = settings.get("openai_api_key", "")
    model               = settings.get("llm_model", "gpt-4o-mini")
    user_name           = settings.get("user_name", "")
    greeting_style      = settings.get("greeting_style", "")
    # Use the user's configured TTS provider — same as the /tts endpoint.
    provider            = settings.get("tts_provider", "elevenlabs")
    openai_voice        = settings.get("tts_openai_voice", DEFAULT_OPENAI_VOICE)
    edge_voice          = settings.get("tts_voice", DEFAULT_EDGE_VOICE)
    elevenlabs_api_key  = settings.get("elevenlabs_api_key", "")
    elevenlabs_voice_id = settings.get("elevenlabs_voice_id", "")
    elevenlabs_model_id = settings.get("elevenlabs_model_id", "eleven_multilingual_v2")

    if not api_key:
        raise HTTPException(status_code=400, detail="OpenAI API key not configured")

    # Fetch conversation history for context (last 20 messages).
    result = await session.execute(
        select(ChatMessage).order_by(ChatMessage.created_at.asc()).limit(40)
    )
    db_history = [
        {"role": m.role, "content": m.content}
        for m in result.scalars().all()
    ]

    # Persist user message before streaming so history is consistent.
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    user_msg = ChatMessage(role="user", content=body.text, created_at=now)
    session.add(user_msg)
    await session.commit()

    async def generate() -> AsyncIterator[bytes]:
        """Yield typed length-prefixed frames.

        Frame format:
            [1 byte type][4 bytes big-endian uint32 length][length bytes payload]

        Types:
            0x00  JSON metadata  — {"text": "<full_reply>", "tool_calls_used": [...]}  last frame
            0x01  MP3 audio      — one sentence worth of audio
            0x02  JSON tool_status — {"type":"tool_status","tool_name":str,"phase":"executing"|"completed"}
        """
        full_reply_parts: list[str] = []

        # Async queue for tool events — allows the tool_event callback (sync context
        # inside run_tool_loop) to push events that generate() drains before the
        # next TTS frame.  Because generate() is a single coroutine, we use a simple
        # list as a thread-safe queue (asyncio is single-threaded).
        pending_tool_frames: list[bytes] = []

        async def on_tool_event(event: dict) -> None:
            """Serialize event to a 0x02 frame and enqueue it for the stream."""
            payload = json.dumps(event, ensure_ascii=False).encode("utf-8")
            pending_tool_frames.append(b"\x02" + len(payload).to_bytes(4, "big") + payload)
            logger.info(f"[VoiceChatStream] tool_event queued: {event}")

        async def flush_tool_frames() -> AsyncIterator[bytes]:
            """Yield and clear any queued tool_status frames."""
            while pending_tool_frames:
                yield pending_tool_frames.pop(0)

        response_gen = chat_service.stream_voice_response(
            user_content=body.text,
            history=db_history,
            api_key=api_key,
            model=model,
            user_name=user_name,
            greeting_style=greeting_style,
            session=session,
            use_tools=True,
            on_tool_event=on_tool_event,
        )

        async for sentence in response_gen:
            # Flush any queued tool_status frames before the next audio frame.
            async for frame in flush_tool_frames():
                yield frame

            cleaned = clean_text_for_tts(sentence)
            if not cleaned:
                continue
            full_reply_parts.append(sentence)

            # Synthesise this sentence using the user-configured TTS provider.
            # Fallback chain mirrors the /tts endpoint: configured provider first,
            # then OpenAI, then edge-tts as last resort.
            audio_chunks: list[bytes] = []

            async def _try_elevenlabs() -> bool:
                nonlocal audio_chunks
                if not (elevenlabs_api_key and elevenlabs_voice_id):
                    return False
                try:
                    async for chunk in voice_service._elevenlabs_tts(
                        cleaned, elevenlabs_api_key, elevenlabs_voice_id, elevenlabs_model_id
                    ):
                        audio_chunks.append(chunk)
                    return True
                except Exception as e:
                    logger.warning(f"[VoiceChatStream] ElevenLabs failed: {e}")
                    audio_chunks = []
                    return False

            async def _try_openai() -> bool:
                nonlocal audio_chunks
                if not api_key:
                    return False
                try:
                    async for chunk in voice_service._openai_tts(cleaned, api_key, openai_voice):
                        audio_chunks.append(chunk)
                    return True
                except Exception as e:
                    logger.warning(f"[VoiceChatStream] OpenAI TTS failed: {e}")
                    audio_chunks = []
                    return False

            async def _try_edge() -> bool:
                nonlocal audio_chunks
                try:
                    async for chunk in voice_service._edge_tts(cleaned, edge_voice):
                        audio_chunks.append(chunk)
                    return True
                except Exception as e:
                    logger.error(f"[VoiceChatStream] edge-tts failed: {e}")
                    audio_chunks = []
                    return False

            if provider == "elevenlabs":
                await _try_elevenlabs() or await _try_openai() or await _try_edge()
            elif provider == "openai":
                await _try_openai() or await _try_elevenlabs() or await _try_edge()
            else:  # edge or unknown
                await _try_edge() or await _try_openai() or await _try_elevenlabs()

            if audio_chunks:
                audio_data = b"".join(audio_chunks)
                # type=0x01 (audio) + 4-byte big-endian length + payload
                yield b"\x01" + len(audio_data).to_bytes(4, "big") + audio_data

        # Drain any remaining tool_status frames (e.g. completed after last sentence).
        async for frame in flush_tool_frames():
            yield frame

        # Persist assistant message and send reply text as final metadata frame.
        full_reply = " ".join(full_reply_parts)
        if full_reply:
            now2 = datetime.now(timezone.utc).replace(tzinfo=None)
            assistant_msg = ChatMessage(role="assistant", content=full_reply, created_at=now2)
            session.add(assistant_msg)
            await session.commit()

        # Collect tool_calls_used from the generator (set on chat_service instance).
        tool_calls_used = getattr(chat_service, "_last_tool_calls_used", [])
        logger.info(f"[VoiceChatStream] tool_calls_used: {tool_calls_used}")

        # Send text metadata frame (type=0x00) as the last frame in the stream.
        meta = json.dumps(
            {"text": full_reply, "tool_calls_used": tool_calls_used},
            ensure_ascii=False,
        ).encode("utf-8")
        yield b"\x00" + len(meta).to_bytes(4, "big") + meta

    return StreamingResponse(
        generate(),
        media_type="application/octet-stream",
        headers={"X-Content-Type-Options": "nosniff"},
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


class ToolDebugRequest(BaseModel):
    tool_name: str
    args: dict = {}


@router.post("/tools/debug")
async def debug_tool(
    body: ToolDebugRequest,
    session: AsyncSession = Depends(get_session),
):
    """Manual tool execution endpoint for testing.

    POST /api/voice/tools/debug
    {"tool_name": "list_tasks", "args": {"filter": "open"}}
    Returns {"result": "<natural language output>", "duration_ms": 42.3}
    """
    import time
    from app.services.voice_tools import execute_tool, TOOLS

    if body.tool_name not in TOOLS:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=404,
            detail=f"Unknown tool '{body.tool_name}'. Available: {list(TOOLS.keys())}",
        )

    t0 = time.monotonic()
    result = await execute_tool(body.tool_name, body.args, session)
    duration_ms = (time.monotonic() - t0) * 1000

    return {"result": result, "duration_ms": round(duration_ms, 1)}


@router.get("/tools/list")
async def list_tools():
    """Return all registered tool names and descriptions."""
    from app.services.voice_tools import TOOLS
    return [
        {"name": t.name, "description": t.description}
        for t in TOOLS.values()
    ]
