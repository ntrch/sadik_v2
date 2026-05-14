import logging
import asyncio
import json
import time
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, Query, WebSocket, WebSocketDisconnect
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from app.database import get_session
from app.models.setting import Setting
from app.services.voice_service import voice_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/voice", tags=["voice"])


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
#   {"type": "ready"}                                          — session open, mic stream can start
#   {"type": "audio", "data": "<base64 PCM>"}                 — 24 kHz PCM chunk from Gemini
#   {"type": "transcript", "text": "...", "finished": bool}   — T9.5.2: user input transcription
#   {"type": "turn_complete"}                                  — Gemini finished speaking this turn
#   {"type": "error", "detail": "..."}                        — fatal error, connection will close
#   {"type": "latency", ...}                                   — telemetry snapshot at turn_complete
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

    T9.5.3 additions:
      - 8s idle timeout: if no audio from client for 8s, session is closed.
      - 30s per-turn audio cap: if mic audio > 30s in one turn, error + force end_of_turn.
      - Cost telemetry: per-session summary logged at session end.

    Latency telemetry is logged at turn_complete with four timestamps:
      t_wake (set by client via {"type":"wake_ts","ts":<monotonic float>})
      t_open, t_ready, t_first (set internally by GeminiLiveService).

    T9.5.2 Adım 3 — LiveRouter integration:
      - LiveRouter instance shared between send/receive loops via _LiveContext.
      - receive_loop gates audio forwarding via router.is_muted().
      - turn_complete triggers router.on_turn_complete() → LLM routing.
      - tool_result sent to client; mute cleared after each turn.
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
    from app.services.live_router import LiveRouter
    telemetry = LatencyTelemetry()
    router = LiveRouter()

    # ── Cost / session telemetry state (T9.5.3) ────────────────────────────────
    # Shared mutable container between send_loop and this scope for cost tracking.
    # Using a dict so send_loop can mutate values via reference.
    _cost: dict = {
        "input_audio_chunks": 0,    # total mic chunks received this session
        "output_audio_chunks": 0,   # total Gemini audio chunks forwarded this session
        "router_calls": 0,          # how many times LLM router was called
    }

    logger.info("[VoiceLive] WS connected — opening Gemini Live session (voice=%s)", voice)

    t_session_start = time.perf_counter()

    try:
        service = build_service(gemini_api_key)
        async with service.session(telemetry=telemetry, voice_name=voice) as live:
            # Signal client that session is ready
            await websocket.send_text(json.dumps({"type": "ready"}))

            # Run receive (Gemini → client) and send (client → Gemini) concurrently.
            send_task    = asyncio.create_task(
                _live_send_loop(websocket, live, telemetry, _cost)
            )
            receive_task = asyncio.create_task(
                _live_receive_loop(websocket, live, router, session, settings, _cost)
            )

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

        # ── Cost telemetry summary (T9.5.3) ───────────────────────────────────
        # Chunk size assumptions:
        #   input  chunk = CHUNK_FRAMES / MIC_RATE   = 1600 / 16000 = 0.1s (100ms)
        #   output chunk ≈ 50ms @ 24 kHz (Gemini Live default frame ~1200 samples)
        session_secs = time.perf_counter() - t_session_start
        input_audio_s  = _cost["input_audio_chunks"]  * 0.1    # 100ms / chunk
        output_audio_s = _cost["output_audio_chunks"] * 0.05   # ~50ms / chunk estimate
        logger.info(
            "[VoiceLive] SESSION COST SUMMARY | "
            "session_duration=%.1fs | "
            "input_audio=%.1fs (%d chunks) | "
            "output_audio=~%.1fs (%d chunks) | "
            "router_llm_calls=%d",
            session_secs,
            input_audio_s, _cost["input_audio_chunks"],
            output_audio_s, _cost["output_audio_chunks"],
            _cost["router_calls"],
        )


# ── Session lifecycle constants (T9.5.3) ──────────────────────────────────────
_IDLE_TIMEOUT_SECS   = 8    # close session after 8s of no mic audio from client
_TURN_MAX_SECS       = 30   # force end_of_turn after 30s of continuous mic audio
_MIC_CHUNK_SECS      = 0.1  # one mic chunk = 100ms (1600 frames @ 16 kHz)


async def _live_send_loop(
    websocket: WebSocket,
    live,
    telemetry: "LatencyTelemetry",
    _cost: dict,
) -> None:
    """Read messages from the client WS and forward audio/control to Gemini.

    T9.5.3 additions:
      - Tracks last_audio_ts; raises IdleTimeout after _IDLE_TIMEOUT_SECS.
      - Tracks per-turn audio duration; sends error + forces end_of_turn after
        _TURN_MAX_SECS of continuous mic audio.
    """
    last_audio_ts: float = time.monotonic()   # updated on every audio chunk
    turn_audio_chunks: int = 0                # chunks in current turn (reset at end_of_turn)
    turn_cap_exceeded: bool = False           # avoid double-firing cap error

    async def _idle_watchdog() -> None:
        """Raise asyncio.CancelledError (propagating as IdleTimeout) when idle."""
        nonlocal last_audio_ts
        while True:
            await asyncio.sleep(1.0)
            if time.monotonic() - last_audio_ts >= _IDLE_TIMEOUT_SECS:
                logger.info("[VoiceLive] idle timeout %ds, closing session", _IDLE_TIMEOUT_SECS)
                raise asyncio.CancelledError("idle_timeout")

    watchdog_task = asyncio.create_task(_idle_watchdog())

    try:
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)
            msg_type = msg.get("type", "")

            if msg_type == "audio":
                # Client sends base64-encoded PCM (16 kHz, 16-bit LE, mono)
                pcm = _base64.b64decode(msg["data"])
                last_audio_ts = time.monotonic()
                _cost["input_audio_chunks"] += 1
                turn_audio_chunks += 1

                # Per-turn 30s audio cap check
                turn_audio_secs = turn_audio_chunks * _MIC_CHUNK_SECS
                if turn_audio_secs > _TURN_MAX_SECS and not turn_cap_exceeded:
                    turn_cap_exceeded = True
                    logger.warning(
                        "[VoiceLive] turn audio cap exceeded (%.0fs > %ds) — forcing end_of_turn",
                        turn_audio_secs, _TURN_MAX_SECS,
                    )
                    try:
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "detail": "turn too long, max 30s",
                        }))
                    except Exception:
                        pass
                    # Force end_of_turn to Gemini
                    await live.signal_end_of_turn()
                    # Don't forward the audio chunk that triggered this
                    continue

                if not turn_cap_exceeded:
                    await live.send_audio(pcm)

            elif msg_type == "end_of_turn":
                # User stopped speaking — signal Gemini to generate response
                await live.signal_end_of_turn()
                # Reset per-turn counters
                turn_audio_chunks = 0
                turn_cap_exceeded = False

            elif msg_type == "wake_ts":
                # Client reports the monotonic timestamp when wakeword fired.
                # Used to compute wake→first_audio latency.
                telemetry.t_wake = float(msg.get("ts", 0))

            elif msg_type == "ping":
                pass  # keepalive, no-op

            else:
                logger.warning("[VoiceLive] Unknown client message type: %s", msg_type)

    except WebSocketDisconnect:
        watchdog_task.cancel()
        raise
    except asyncio.CancelledError as ce:
        watchdog_task.cancel()
        if "idle_timeout" in str(ce):
            logger.info("[VoiceLive] send_loop: idle_timeout fired, closing WS")
            try:
                await websocket.close(code=1000)
            except Exception:
                pass
        raise
    except Exception as e:
        watchdog_task.cancel()
        logger.error("[VoiceLive] send_loop error: %s", e)
        raise
    finally:
        watchdog_task.cancel()
        try:
            await watchdog_task
        except (asyncio.CancelledError, Exception):
            pass


async def _live_receive_loop(
    websocket: WebSocket,
    live,
    router: "LiveRouter",
    session: "AsyncSession",
    settings: dict,
    _cost: dict,
) -> None:
    """Stream events from Gemini back to the client over WebSocket.

    T9.5.3 — A-path audio buffer until router decision:
      Audio chunks arriving before turn_complete are buffered (not forwarded).
      After router decision:
        - ("chat", ...) → flush buffer to client, then forward directly.
        - ("tool", ...) → drop buffer, set mute (existing behaviour).

    Wire protocol (server → client):
      {"type": "audio",        "data": "<b64>", "mime": "audio/pcm;rate=24000"}
      {"type": "transcript",   "text": "...", "finished": bool}
      {"type": "turn_complete"}
      {"type": "tool_result",  "tool_name": str, "status": "ok"|"error",
                               "data": {...}, "error": str|null}
      {"type": "error",        "detail": "turn too long, max 30s"}
    """
    from app.services.live_router import LiveRouter  # import for type reference
    from collections import deque

    # ── A-path audio buffer (T9.5.3) ──────────────────────────────────────────
    # Audio chunks are buffered here until the router makes its decision after
    # turn_complete.  Max 100 chunks (~2s @ 50ms/chunk).  Overflow → drop + warn.
    _AUDIO_BUFFER_MAX = 100
    audio_buffer: deque[bytes] = deque()
    turn_decided = False   # True after router returns for this turn

    # Timestamp tracking for A-path latency telemetry
    t_turn_complete: float | None = None
    t_router_started: float | None = None

    # T9.5.3 fix: router LLM çağrısını turn_complete'de DEĞİL, ilk transcript geldiği
    # an background task olarak başlat. `gemini-3.1-flash-live-preview` modelinde
    # transcript tek shot olarak geliyor (finished flag yok) → ilk transcript = final.
    # turn_complete (Gemini audio stream sonu) 5-15s sürebilir; o ana kadar
    # beklemek A-path latency'sini patlatıyor. Erken başlatmak ~1s LLM roundtrip'i
    # Gemini audio stream süresinin içine saklar.
    router_task: "asyncio.Task | None" = None

    async def _apply_router_decision(result):
        """Router decision geldi — buffer'ı flush et veya drop et, turn_decided set et."""
        nonlocal turn_decided
        kind_r = result[0]
        turn_decided = True
        if kind_r == "tool":
            _, tool_name, status, data, error = result
            logger.info(
                "[VoiceLive] tool_result tool=%s status=%s | dropping %d buffered audio chunks (early)",
                tool_name, status, len(audio_buffer),
            )
            audio_buffer.clear()
            await websocket.send_text(json.dumps({
                "type":      "tool_result",
                "tool_name": tool_name,
                "status":    status,
                "data":      data,
                "error":     error,
            }))
        else:
            # Chat — buffer'daki tüm chunk'ları flush et
            flushed = 0
            t_first_sent: float | None = None
            while audio_buffer:
                chunk = audio_buffer.popleft()
                payload = json.dumps({
                    "type": "audio",
                    "data": _base64.b64encode(chunk).decode("ascii"),
                    "mime": "audio/pcm;rate=24000",
                })
                await websocket.send_text(payload)
                _cost["output_audio_chunks"] += 1
                if t_first_sent is None:
                    t_first_sent = time.perf_counter()
                flushed += 1
            if t_router_started is not None and t_first_sent is not None:
                latency_ms = (t_first_sent - t_router_started) * 1000
                logger.info(
                    "[VoiceLive] A-path EARLY flush: %d chunks, router_started→first_audio_client=%.0f ms",
                    flushed, latency_ms,
                )

    try:
        async for event in live.receive_messages():
            kind = event[0]

            # T9.5.3 fix: her audio event'inde router_task'ın done olup olmadığını kontrol et.
            # turn_complete beklemeden flush/drop kararını uygula → A-path latency düşer.
            if router_task is not None and router_task.done() and not turn_decided:
                try:
                    _result = router_task.result()
                    await _apply_router_decision(_result)
                except Exception as e:
                    logger.error("[VoiceLive] router_task error: %s", e)
                    turn_decided = True  # don't keep buffering

            if kind == "audio":
                if router.is_muted():
                    # Tool path confirmed — drop audio
                    logger.debug("[VoiceLive] audio chunk DROPPED (muted/tool path)")
                elif turn_decided:
                    # Chat path confirmed, router already flushed the buffer —
                    # forward subsequent chunks directly
                    payload = json.dumps({
                        "type": "audio",
                        "data": _base64.b64encode(event[1]).decode("ascii"),
                        "mime": "audio/pcm;rate=24000",
                    })
                    await websocket.send_text(payload)
                    _cost["output_audio_chunks"] += 1
                else:
                    # Waiting for router decision — buffer the chunk
                    if len(audio_buffer) >= _AUDIO_BUFFER_MAX:
                        logger.warning(
                            "[VoiceLive] audio_buffer overflow (%d chunks), dropping oldest",
                            _AUDIO_BUFFER_MAX,
                        )
                        audio_buffer.popleft()  # drop oldest to make room
                    audio_buffer.append(event[1])

            elif kind == "transcript":
                _, text, finished = event
                label = "FINAL" if finished else "incr"
                logger.info("[VoiceLive] transcript (%s): %r", label, text[:120])
                # Accumulate in router buffer
                router.on_transcript(text, finished)
                # Also forward to client for real-time display
                await websocket.send_text(json.dumps({
                    "type": "transcript",
                    "text": text,
                    "finished": finished,
                }))

                # T9.5.3 fix: router'ı transcript geldiği an başlat (turn_complete bekleme)
                if router_task is None and text.strip():
                    t_router_started = time.perf_counter()
                    _cost["router_calls"] += 1
                    logger.info("[VoiceLive] starting B-path LLM router (early, on transcript)")
                    router_task = asyncio.create_task(
                        router.on_turn_complete(session, settings)
                    )

            elif kind == "turn_complete":
                t_turn_complete = time.perf_counter()
                await websocket.send_text(json.dumps({"type": "turn_complete"}))

                # Router henüz dönmediyse burada bekle (edge: çok hızlı turn veya OpenAI yavaş)
                if not turn_decided:
                    if router_task is None:
                        logger.warning("[VoiceLive] no transcript before turn_complete — starting router late")
                        _cost["router_calls"] += 1
                        router_task = asyncio.create_task(
                            router.on_turn_complete(session, settings)
                        )
                    result = await router_task
                    if t_router_started is not None:
                        router_ms = (time.perf_counter() - t_router_started) * 1000
                        logger.info("[VoiceLive] router decided in %.0fms (from start, late)", router_ms)
                    await _apply_router_decision(result)

                router.reset_turn()
                break

    except WebSocketDisconnect:
        raise
    except Exception as e:
        logger.error("[VoiceLive] receive_loop error: %s", e)
        raise
