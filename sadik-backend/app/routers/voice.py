import logging
import asyncio
import json
import time
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, Query, WebSocket, WebSocketDisconnect
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
        # Return empty text on transient failures (timeout, 5xx, network) so
        # the frontend can recover gracefully (handleDidntHear) instead of
        # surfacing a 500 to the user.
        logger.warning(f"STT failed transiently, returning empty: {e}")
        return {"text": ""}

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
    stt_ms: Optional[int] = None
    audio_seconds: Optional[float] = None


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

    t0 = time.perf_counter()

    # Read privacy flags once; passed to tool loop and history gate.
    from app.services.privacy_flags import get_privacy_flags, get_privacy_tier
    privacy_flags = await get_privacy_flags(session)
    tier = await get_privacy_tier(session)
    voice_memory_enabled = privacy_flags.get("privacy_voice_memory", False)

    # Fetch conversation history for context (last 20 messages).
    # Gate: if privacy_voice_memory=false, pass an empty history so the LLM
    # sees no prior turns (stateless turn).
    if voice_memory_enabled:
        result = await session.execute(
            select(ChatMessage).order_by(ChatMessage.created_at.asc()).limit(40)
        )
        db_history = [
            {"role": m.role, "content": m.content}
            for m in result.scalars().all()
        ]
    else:
        db_history = []

    # Persist user message only when voice memory is enabled.
    from datetime import datetime, timezone
    if voice_memory_enabled:
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
        tts_ms_recorded: Optional[int] = None   # TTFB for first TTS chunk
        tts_char_total: int = 0                 # cumulative chars sent to TTS

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
            privacy_flags=privacy_flags,
            tier=tier,
        )

        async for sentence in response_gen:
            # Flush any queued tool_status frames before the next audio frame.
            async for frame in flush_tool_frames():
                yield frame

            cleaned = clean_text_for_tts(sentence)
            if not cleaned:
                continue
            full_reply_parts.append(sentence)
            tts_char_total += len(cleaned)

            # Synthesise this sentence using the user-configured TTS provider.
            # Fallback chain mirrors the /tts endpoint: configured provider first,
            # then OpenAI, then edge-tts as last resort.
            audio_chunks: list[bytes] = []
            _tts_sentence_start = time.perf_counter()

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
                if tts_ms_recorded is None:
                    tts_ms_recorded = int((time.perf_counter() - _tts_sentence_start) * 1000)
                audio_data = b"".join(audio_chunks)
                # type=0x01 (audio) + 4-byte big-endian length + payload
                yield b"\x01" + len(audio_data).to_bytes(4, "big") + audio_data

        # Drain any remaining tool_status frames (e.g. completed after last sentence).
        async for frame in flush_tool_frames():
            yield frame

        # Persist assistant message only when voice memory is enabled.
        full_reply = " ".join(full_reply_parts)
        if full_reply and voice_memory_enabled:
            now2 = datetime.now(timezone.utc).replace(tzinfo=None)
            assistant_msg = ChatMessage(role="assistant", content=full_reply, created_at=now2)
            session.add(assistant_msg)
            await session.commit()

        # Collect tool_calls_used from the generator (set on chat_service instance).
        tool_calls_used = getattr(chat_service, "_last_tool_calls_used", [])
        logger.info(f"[VoiceChatStream] tool_calls_used: {tool_calls_used}")

        # ── Usage tracking DB insert (best-effort, never breaks voice flow) ──
        try:
            from app.models.voice_turn_event import VoiceTurnEvent
            total_ms = int((time.perf_counter() - t0) * 1000)
            usage_meta = getattr(chat_service, "_last_usage", {})
            llm_ttfb = getattr(chat_service, "_last_llm_ttfb_ms", None)
            tool_names_csv = ",".join(tc["name"] for tc in tool_calls_used) if tool_calls_used else None
            event = VoiceTurnEvent(
                stt_ms=body.stt_ms,
                llm_ms=llm_ttfb,
                tts_ms=tts_ms_recorded,
                total_ms=total_ms,
                prompt_tokens=usage_meta.get("prompt_tokens"),
                completion_tokens=usage_meta.get("completion_tokens"),
                tool_names=tool_names_csv,
                tool_count=len(tool_calls_used),
                user_audio_seconds=body.audio_seconds,
                tts_audio_chars=tts_char_total if tts_char_total > 0 else None,
                tts_provider=provider,
                llm_model=model,
            )
            session.add(event)
            await session.commit()
            logger.info(f"[VoiceChatStream] usage recorded: total_ms={total_ms} tools={len(tool_calls_used)}")
        except Exception as _ue:
            logger.warning(f"[VoiceChatStream] usage insert failed (non-fatal): {_ue}")

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


# ── Voice V2 — Gemini Live proxy (Sprint 9.5, T9.5.1) ─────────────────────────
#
# Flag-gated: voice_v2_enabled must be "true" in settings to activate.
# Default: false — V1 pipeline (above) keeps working unchanged.
#
# WebSocket wire protocol (server → client):
#   {"type": "ready"}                          — session open, mic stream can start
#   {"type": "audio", "data": "<base64 PCM>"}  — 24 kHz PCM chunk from Gemini
#   {"type": "turn_complete"}                  — Gemini finished speaking this turn
#   {"type": "error", "detail": "..."}         — fatal error, connection will close
#   {"type": "latency", ...}                   — telemetry snapshot at turn_complete
#
# WebSocket wire protocol (client → server):
#   {"type": "audio", "data": "<base64 PCM>"}  — 16 kHz PCM from mic (post-RMS gate)
#   {"type": "end_of_turn"}                    — user stopped speaking (manual VAD)
#   {"type": "ping"}                           — keepalive (server ignores, WS layer handles)

import base64 as _base64


@router.websocket("/live")
async def voice_live_ws(
    websocket: WebSocket,
    voice: str = Query(default="Charon", description="Gemini prebuilt voice name (e.g. Charon, Fenrir, Orus)"),
    session: AsyncSession = Depends(get_session),
):
    """Gemini Live audio proxy WebSocket.

    Gated behind voice_v2_enabled setting (default "false").
    Connect ONLY after wakeword fires — cold sessions are never opened.
    Session is opened here and closed when the client disconnects or on error.

    Latency telemetry is logged at turn_complete with four timestamps:
      t_wake (set by client via {"type":"wake_ts","ts":<monotonic float>})
      t_open, t_ready, t_first (set internally by GeminiLiveService).
    """
    await websocket.accept()

    # ── Feature flag check ─────────────────────────────────────────────────────
    settings = await get_settings_map(session)
    voice_v2_enabled = settings.get("voice_v2_enabled", "false").lower() == "true"
    if not voice_v2_enabled:
        await websocket.send_text(json.dumps({
            "type": "error",
            "detail": "voice_v2_enabled is false — enable in settings to use Gemini Live",
        }))
        await websocket.close(code=1008)
        logger.warning("[VoiceLive] Connection rejected: voice_v2_enabled=false")
        return

    # ── API key ────────────────────────────────────────────────────────────────
    gemini_api_key = settings.get("gemini_api_key", "").strip()
    if not gemini_api_key:
        await websocket.send_text(json.dumps({
            "type": "error",
            "detail": "gemini_api_key not configured in settings",
        }))
        await websocket.close(code=1008)
        logger.error("[VoiceLive] Connection rejected: no gemini_api_key")
        return

    # ── Telemetry init ─────────────────────────────────────────────────────────
    from app.services.gemini_live_service import GeminiLiveService, LatencyTelemetry, build_service
    telemetry = LatencyTelemetry()

    logger.info("[VoiceLive] WS connected — opening Gemini Live session (voice=%s)", voice)

    try:
        service = build_service(gemini_api_key)
        async with service.session(telemetry=telemetry, voice_name=voice) as live:
            # Signal client that session is ready
            await websocket.send_text(json.dumps({"type": "ready"}))

            # Run receive (Gemini → client) and send (client → Gemini) concurrently.
            send_task    = asyncio.create_task(_live_send_loop(websocket, live, telemetry))
            receive_task = asyncio.create_task(_live_receive_loop(websocket, live))

            done, pending = await asyncio.wait(
                [send_task, receive_task],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for t in pending:
                t.cancel()
                try:
                    await t
                except (asyncio.CancelledError, Exception):
                    pass

    except WebSocketDisconnect:
        logger.info("[VoiceLive] WS disconnected cleanly")
    except Exception as e:
        logger.error("[VoiceLive] Session error: %s", e)
        try:
            await websocket.send_text(json.dumps({"type": "error", "detail": str(e)}))
        except Exception:
            pass
    finally:
        telemetry.log()


async def _live_send_loop(
    websocket: WebSocket,
    live,
    telemetry: "LatencyTelemetry",
) -> None:
    """Read messages from the client WS and forward audio/control to Gemini."""
    try:
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)
            msg_type = msg.get("type", "")

            if msg_type == "audio":
                # Client sends base64-encoded PCM (16 kHz, 16-bit LE, mono)
                pcm = _base64.b64decode(msg["data"])
                await live.send_audio(pcm)

            elif msg_type == "end_of_turn":
                # User stopped speaking — signal Gemini to generate response
                await live.signal_end_of_turn()

            elif msg_type == "wake_ts":
                # Client reports the monotonic timestamp when wakeword fired.
                # Used to compute wake→first_audio latency.
                telemetry.t_wake = float(msg.get("ts", 0))

            elif msg_type == "ping":
                pass  # keepalive, no-op

            else:
                logger.warning("[VoiceLive] Unknown client message type: %s", msg_type)

    except WebSocketDisconnect:
        raise
    except Exception as e:
        logger.error("[VoiceLive] send_loop error: %s", e)
        raise


async def _live_receive_loop(websocket: WebSocket, live) -> None:
    """Stream audio chunks from Gemini back to the client over WebSocket."""
    try:
        async for chunk in live.receive_audio():
            # Forward raw PCM as base64 JSON frame
            payload = json.dumps({
                "type": "audio",
                "data": _base64.b64encode(chunk).decode("ascii"),
                "mime": "audio/pcm;rate=24000",
            })
            await websocket.send_text(payload)

        # Turn complete
        await websocket.send_text(json.dumps({"type": "turn_complete"}))

    except WebSocketDisconnect:
        raise
    except Exception as e:
        logger.error("[VoiceLive] receive_loop error: %s", e)
        raise
