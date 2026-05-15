"""
Gemini Live API service — SADIK v2 Sprint 9.5 (T9.5.1 spike).

Architecture notes:
- Backend proxy ONLY. App never touches Gemini directly; API key stays server-side.
- Session lifecycle: opened ONLY after wakeword fires, never cold.
- native_interrupt / automatic_activity_detection is DISABLED intentionally.
  Our RMS+VAD gate (voice_service.py _rms_gate) handles silence detection locally.
  Letting Gemini's own VAD control the turn boundary would conflict with our B-first
  router logic and cost-gating in T9.5.3. Decision: keep full control on our side.

Dependencies:
    pip install google-genai  (google-generativeai ≥ 0.8 ships the Live client)

Latency telemetry points (all monotonic, seconds):
    T_WAKE   — wakeword fires (set by caller, passed in)
    T_OPEN   — send_start_session() enters the API call
    T_READY  — session object returned from connect
    T_FIRST  — first audio chunk received from Gemini
    T_PLAY   — caller begins playback (outside this service)
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import AsyncIterator, Callable, Optional, Tuple, Union

logger = logging.getLogger(__name__)


# ── Latency telemetry ──────────────────────────────────────────────────────────

@dataclass
class LatencyTelemetry:
    """Timestamps (monotonic seconds) for one Live session turn."""
    t_wake:  Optional[float] = None   # wakeword detected
    t_open:  Optional[float] = None   # connect() called
    t_ready: Optional[float] = None   # session ready
    t_first: Optional[float] = None   # first audio chunk received

    def log(self) -> None:
        if self.t_wake and self.t_open:
            logger.info(
                "[LiveLatency] wake→open=%.0fms  open→ready=%.0fms  open→first_audio=%.0fms",
                (self.t_open  - self.t_wake)  * 1000,
                (self.t_ready - self.t_open)  * 1000 if self.t_ready else -1,
                (self.t_first - self.t_open)  * 1000 if self.t_first else -1,
            )
        else:
            logger.info("[LiveLatency] incomplete telemetry: %s", self)


# ── Session config ─────────────────────────────────────────────────────────────

# Default system prompt for the Gemini Live A-path (conversation, no tools).
# Tool execution happens on the B-path via Whisper+LLM; Live is audio-only A-path.
_DEFAULT_SYSTEM_PROMPT = (
    "Sen SADIK'sın — kullanıcının kişisel masaüstü asistanısın. "
    "Türkçe konuş, samimi ve kısa cevaplar ver. "
    "Araç çalıştırma veya takvim/görev gibi işlemler için 'bunu bir bakıyorum' de ve dur — "
    "bu konuşma hattında araç yok. Sadece sohbet et."
)

# Audio format sent TO Gemini (from microphone after RMS gate).
# PCM 16-bit LE, mono, 16 kHz — same as wakeword pipeline capture rate.
_INPUT_AUDIO_FORMAT  = "audio/pcm;rate=16000"

# Audio format received FROM Gemini (for speaker playback).
# PCM 24 kHz is Gemini Live default; 16 kHz also supported.
_OUTPUT_AUDIO_FORMAT = "audio/pcm;rate=24000"


# ── Service ────────────────────────────────────────────────────────────────────

class GeminiLiveService:
    """Thin async wrapper around the Gemini Live (Multimodal Live) API.

    Usage pattern (called from /api/voice/live WebSocket handler):

        service = GeminiLiveService(api_key)
        telemetry = LatencyTelemetry(t_wake=time.monotonic())
        async with service.session(system_prompt=..., telemetry=telemetry) as sess:
            # send PCM audio from mic
            await sess.send_audio(pcm_bytes)
            # receive PCM audio chunks from Gemini
            async for chunk in sess.receive_audio():
                yield chunk  # forward to client over WS
        telemetry.log()
    """

    def __init__(self, api_key: str) -> None:
        if not api_key:
            raise ValueError("Gemini API key is required")
        self._api_key = api_key

    def session(
        self,
        system_prompt: str = _DEFAULT_SYSTEM_PROMPT,
        telemetry: Optional[LatencyTelemetry] = None,
        voice_name: str = "Charon",
        input_transcription: bool = True,
    ) -> "_LiveSession":
        return _LiveSession(self._api_key, system_prompt, telemetry, voice_name, input_transcription)


class _LiveSession:
    """Async context manager for a single Gemini Live audio session."""

    def __init__(
        self,
        api_key: str,
        system_prompt: str,
        telemetry: Optional[LatencyTelemetry],
        voice_name: str = "Charon",
        input_transcription: bool = True,
    ) -> None:
        self._api_key            = api_key
        self._system_prompt      = system_prompt
        self._telemetry          = telemetry or LatencyTelemetry()
        self._voice_name         = voice_name
        self._input_transcription = input_transcription
        self._session            = None   # google.genai Live session
        self._client             = None   # google.genai.Client
        self._activity_started   = False  # manual VAD: tracks whether activity_start was sent

    async def __aenter__(self) -> "_LiveSession":
        self._telemetry.t_open = time.monotonic()
        try:
            from google import genai
            from google.genai import types as genai_types
        except ImportError as exc:
            raise RuntimeError(
                "google-genai package not installed. Run: pip install google-genai"
            ) from exc

        self._client = genai.Client(api_key=self._api_key)

        # ── Session config ─────────────────────────────────────────────────────
        # IMPORTANT: automatic_activity_detection (native VAD / interrupt) is
        # intentionally DISABLED. Our RMS gate + future Silero VAD (T9.5.3) control
        # turn boundaries. Enabling Gemini's own VAD would cause premature cutoffs
        # and interfere with B-first routing logic. Decision locked in T9.5.1.
        config = genai_types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            system_instruction=genai_types.Content(
                parts=[genai_types.Part(text=self._system_prompt)],
                role="user",
            ),
            speech_config=genai_types.SpeechConfig(
                voice_config=genai_types.VoiceConfig(
                    prebuilt_voice_config=genai_types.PrebuiltVoiceConfig(
                        voice_name=self._voice_name
                    )
                )
            ),
            # Disable automatic activity detection — we gate via RMS+VAD ourselves.
            # This prevents Gemini from interrupting mid-sentence based on its own VAD.
            realtime_input_config=genai_types.RealtimeInputConfig(
                automatic_activity_detection=genai_types.AutomaticActivityDetection(
                    disabled=True
                )
            ),
            # T9.5.2 — Request user-speech transcription from Gemini.
            # Enabled by default; set input_transcription=False to skip (legacy path).
            # Wire: inputAudioTranscription: {} → server sends inputTranscription events.
            # Transcripts arrive independently of model audio turns (see notes/T9_5_2_router_design.md).
            **({"input_audio_transcription": genai_types.AudioTranscriptionConfig()} if self._input_transcription else {}),
        )

        # Live API model selection (2026-05, key listesinden doğrulandı):
        #   PRIMARY  : gemini-3.1-flash-live-preview  ← Eren'in seçimi, yeni nesil
        #   ALT-1    : gemini-2.5-flash-native-audio-latest
        #   ALT-2    : gemini-2.5-flash-native-audio-preview-12-2025
        #   ALT-3    : gemini-2.5-flash-native-audio-preview-09-2025
        # Ref: https://ai.google.dev/gemini-api/docs/models#live-api
        model = "models/gemini-3.1-flash-live-preview"
        logger.info("[GeminiLive] Connecting to %s (voice=%s)", model, self._voice_name)

        # Connect — the async context manager yields the live session
        self._session_ctx = self._client.aio.live.connect(model=model, config=config)
        self._session = await self._session_ctx.__aenter__()
        self._telemetry.t_ready = time.monotonic()
        logger.info(
            "[GeminiLive] Session ready (open→ready=%.0fms)",
            (self._telemetry.t_ready - self._telemetry.t_open) * 1000,
        )
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        if self._session_ctx is not None:
            try:
                await self._session_ctx.__aexit__(exc_type, exc, tb)
            except Exception as e:
                logger.warning("[GeminiLive] Session close error: %s", e)
        self._session = None
        logger.info("[GeminiLive] Session closed")

    # ── Audio I/O ──────────────────────────────────────────────────────────────

    async def send_audio(self, pcm_bytes: bytes) -> None:
        """Send raw PCM audio bytes to Gemini (16-bit LE, mono, 16 kHz).

        Call this in a loop for every mic chunk after wakeword fires.
        The RMS gate should already have filtered silence before calling here.

        NOTE (2026-05): Gemini Live 3.1 yeni schema — realtime_input.audio
        (media_chunks / media= deprecated → 1007 close kodu ile reddedilir).
        SDK'da send_realtime_input(media=...) → wire'da mediaChunks gönderir → red.
        send_realtime_input(audio=...) → wire'da audio{} gönderir → kabul edilir.

        Manual VAD (automatic_activity_detection=disabled): activity_start is sent
        automatically on the first audio chunk of each turn so Gemini knows a new
        speech segment has begun. activity_end + audio_stream_end are sent by
        signal_end_of_turn() to close the turn.
        """
        if self._session is None:
            raise RuntimeError("Session not open")
        from google.genai import types as genai_types

        # Manual VAD: send activity_start before the first audio chunk of each turn.
        if not self._activity_started:
            await self._session.send_realtime_input(
                activity_start=genai_types.ActivityStart()
            )
            self._activity_started = True
            logger.debug("[GeminiLive] activity_start sent")

        await self._session.send_realtime_input(
            audio=genai_types.Blob(data=pcm_bytes, mime_type=_INPUT_AUDIO_FORMAT)
        )

    async def signal_end_of_turn(self) -> None:
        """Signal that the user has finished speaking (manual VAD boundary).

        Because automatic_activity_detection is disabled, we must explicitly
        signal the end of the user's turn via activity_end + audio_stream_end.
        Call this after the RMS drops below the silence threshold.

        activity_end tells Gemini the speech segment is over and it should
        generate a response. audio_stream_end is also sent for compatibility.
        The _activity_started flag is reset so the next send_audio call will
        send a fresh activity_start for the following turn.
        """
        if self._session is None:
            raise RuntimeError("Session not open")
        from google.genai import types as genai_types

        # Only send activity_end if we actually started an activity.
        if self._activity_started:
            await self._session.send_realtime_input(
                activity_end=genai_types.ActivityEnd()
            )
            logger.debug("[GeminiLive] activity_end sent")
            self._activity_started = False

        await self._session.send_realtime_input(audio_stream_end=True)
        logger.debug("[GeminiLive] audio_stream_end sent")

    async def receive_messages(self):
        """Async generator that yields typed event tuples from Gemini.

        T9.5.2 — replaces receive_audio(); multiplex audio + transcripts + turn_complete.

        Yields:
            ("audio",         bytes)                    — raw PCM audio chunk (24 kHz)
            ("transcript",    str,   bool)              — user input transcript; bool=finished
            ("turn_complete", None)                     — Gemini finished this turn

        The generator exits after yielding ("turn_complete", None).
        Callers must handle all three tuple forms; unrecognised tuples can be ignored.

        Notes:
        - t_first is recorded on the first audio chunk (latency telemetry).
        - Transcript events are independent of audio turns (may interleave freely).
        - finished=False → incremental / partial; finished=True → final for this segment.
        """
        if self._session is None:
            raise RuntimeError("Session not open")

        first_received = False
        async for response in self._session.receive():
            sc = response.server_content

            # ── Turn complete ─────────────────────────────────────────────────────
            if sc and sc.turn_complete:
                logger.info("[GeminiLive] Turn complete received")
                yield ("turn_complete", None)
                break

            # ── Input transcription (T9.5.2) ─────────────────────────────────────
            if sc and sc.input_transcription is not None:
                tr = sc.input_transcription
                text     = tr.text     or ""
                finished = bool(tr.finished)
                if text:
                    logger.debug(
                        "[GeminiLive] input_transcription finished=%s text=%r",
                        finished, text[:120],
                    )
                    yield ("transcript", text, finished)

            # ── Audio data ────────────────────────────────────────────────────────
            if response.data:
                if not first_received:
                    self._telemetry.t_first = time.monotonic()
                    first_received = True
                    logger.info(
                        "[GeminiLive] First audio chunk (open→first=%.0fms)",
                        (self._telemetry.t_first - self._telemetry.t_open) * 1000,
                    )
                yield ("audio", response.data)

            # ── Model text (informational, not forwarded to client) ───────────────
            if response.text:
                logger.debug("[GeminiLive] model text: %s", response.text[:80])

    # ── Narration (T9.5.7) ────────────────────────────────────────────────────

    async def send_narration(self, text: str) -> None:
        """Send a text prompt to Gemini Live so it speaks the result aloud.

        Used by the tool-result path (B-path) to narrate tool results via Live
        instead of going silent after tool execution.  The session must already
        be open (called from within an active `async with service.session():`
        block).

        The caller is responsible for NOT calling this when the session has
        already been closed or when privacy Local-only mode is active.
        """
        if self._session is None:
            raise RuntimeError("Session not open")
        from google.genai import types as genai_types
        await self._session.send_client_content(
            turns=genai_types.Content(
                role="user",
                parts=[genai_types.Part(text=text)],
            ),
            turn_complete=True,
        )
        logger.info("[GeminiLive] send_narration sent (%d chars)", len(text))

    # ── Echo test ──────────────────────────────────────────────────────────────

    async def echo_test(self, prompt_text: str = "Merhaba, beni duyuyor musun?") -> bytes:
        """Send a text prompt and collect the first audio response.

        Used for smoke-testing the Live connection without a real mic.
        Returns the concatenated PCM bytes from Gemini.
        """
        if self._session is None:
            raise RuntimeError("Session not open")
        from google.genai import types as genai_types
        # Send a text turn (simulating user speech as text for the spike test)
        await self._session.send_client_content(
            turns=genai_types.Content(
                role="user",
                parts=[genai_types.Part(text=prompt_text)],
            ),
            turn_complete=True,
        )
        chunks: list[bytes] = []
        async for event in self.receive_messages():
            if event[0] == "audio":
                chunks.append(event[1])
            elif event[0] == "turn_complete":
                break
        return b"".join(chunks)


# ── Module-level helper ────────────────────────────────────────────────────────

def build_service(api_key: str) -> GeminiLiveService:
    """Convenience factory used by the voice router."""
    return GeminiLiveService(api_key=api_key)
