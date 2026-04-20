import logging
import io
import re
import struct
from typing import AsyncIterator, Optional
from openai import AsyncOpenAI
import edge_tts
import httpx

logger = logging.getLogger(__name__)

# ── Defaults ───────────────────────────────────────────────────────────────────

DEFAULT_EDGE_VOICE        = "tr-TR-EmelNeural"
DEFAULT_OPENAI_VOICE      = "onyx"                  # deep male voice
DEFAULT_ELEVENLABS_MODEL  = "eleven_v3"

# ── Text cleaning ──────────────────────────────────────────────────────────────

_EMOJI_RE = re.compile(
    "["
    "\U0001F600-\U0001F64F"
    "\U0001F300-\U0001F5FF"
    "\U0001F680-\U0001F6FF"
    "\U0001F1E0-\U0001F1FF"
    "\U00002702-\U000027B0"
    "\U000024C2-\U0001F251"
    "\U0001f926-\U0001f937"
    "\U00010000-\U0010ffff"
    "\u2640-\u2642"
    "\u2600-\u2B55"
    "\u200d"
    "\u23cf"
    "\u23e9"
    "\u231a"
    "\ufe0f"
    "\u3030"
    "]+",
    flags=re.UNICODE,
)


def strip_emojis(text: str) -> str:
    """Remove all emoji / pictograph characters from *text*."""
    return _EMOJI_RE.sub("", text).strip()


def clean_text_for_tts(text: str) -> str:
    """Strip emojis, markdown noise, and normalise whitespace for TTS."""
    text = strip_emojis(text)
    text = text.replace("\n", " ")
    text = re.sub(r"[*#\-_`~|>]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


# ── Whisper STT hallucination defence ─────────────────────────────────────────
#
# Common Whisper hallucinations in Turkish, produced on near-silence or
# background-noise-only audio.  Normalised substring match (lower, no punct).
# List covers subscribe-bait phrases, ghost filler, and copyright footers that
# Whisper was trained on and reproduces on silence.

_HALLUCINATION_PHRASES: list[str] = [
    # YouTube/podcast filler
    "abone olmayı unutmayın",
    "beğenmeyi unutmayın",
    "bu videoyu beğendiyseniz",
    "yorumlara yazın",
    "görüşmek üzere",
    "görüşürüz",
    "teşekkür ederim",
    "teşekkürler",
    "iyi seyirler",
    "iyi dinlemeler",
    "iyi günler",
    # Subtitle/caption artefacts
    "altyazı",
    "telif hakkı",
    "telifi altyazı",
    "subtitled by",
    "subtitle",
    "çeviri",
    # Common ghost phrases Whisper generates on ambient noise
    "bir sonraki videoda görüşmek üzere",
    "beğenip abone olursanız",
    "kanalıma abone olun",
    "desteklerinizi bekliyorum",
]

# Pre-compiled normalised phrases (lower, letters/spaces only)
def _norm(s: str) -> str:
    return re.sub(r"[^a-z\u00c0-\u024f\u011e\u011f\u0130\u0131\u015e\u015f\u00fc\u00fb\u00f6\u00e7\s]", "", s.lower()).strip()

_HALLUCINATION_NORMS: list[str] = [_norm(p) for p in _HALLUCINATION_PHRASES]


def _is_hallucination(text: str) -> bool:
    """Return True if *text* appears to be a Whisper silence-hallucination."""
    n = _norm(text)
    if not n:
        return True
    for phrase in _HALLUCINATION_NORMS:
        if phrase and phrase in n:
            return True
    return False


def _rms_from_audio_bytes(audio_bytes: bytes) -> float:
    """Estimate RMS energy from raw PCM/WAV bytes.

    Tries to parse as WAV first (strips 44-byte header).  Falls back to
    treating the entire buffer as raw int16 little-endian PCM.  Returns 0.0
    on any parse error — callers treat 0 as silence.
    """
    try:
        import math
        data = audio_bytes
        # Skip WAV header if present (RIFF magic)
        if data[:4] == b"RIFF" and len(data) > 44:
            data = data[44:]
        if len(data) < 2:
            return 0.0
        # Truncate to even number of bytes for int16 unpacking
        n_samples = len(data) // 2
        if n_samples == 0:
            return 0.0
        samples = struct.unpack(f"<{n_samples}h", data[: n_samples * 2])
        sum_sq = sum(s * s for s in samples)
        # Normalise to float range [-1, 1] (int16 max = 32768)
        rms_int16 = math.sqrt(sum_sq / n_samples)
        return rms_int16 / 32768.0
    except Exception:
        return 0.0


# RMS gate threshold — audio below this is treated as silence and Whisper is
# skipped entirely.  Value in normalised float [0, 1].  0.005 ≈ very quiet
# ambient room noise; genuine speech is typically 0.02+.
_RMS_GATE_THRESHOLD = 0.005


# ── Service ────────────────────────────────────────────────────────────────────


class VoiceService:
    # ── STT ───────────────────────────────────────────────────────────────────

    async def stt(
        self,
        audio_bytes: bytes,
        api_key: str,
        prompt: Optional[str] = None,
        fast: bool = False,
    ) -> str:
        """Transcribe *audio_bytes* via Whisper (Turkish).

        Pass *prompt* to bias Whisper toward expected vocabulary (e.g. the
        wake word name).  When None the call behaves exactly as before.

        Pass *fast=True* for wake-word chunks: disables OpenAI SDK retries
        (max_retries=0) to avoid the 2-3× latency overhead seen in production
        logs.  Normal conversation transcription keeps full retry resilience.
        """
        if not api_key:
            return ""

        if len(audio_bytes) <= 512:
            logger.warning("STT: audio_bytes too small (%d bytes), skipping Whisper", len(audio_bytes))
            return ""

        # ── Pre-flight RMS gate ────────────────────────────────────────────────
        # Skip Whisper entirely on near-silence — it hallucinates on low-energy
        # audio more than on genuine speech.  Only applied to non-webm/compressed
        # formats that carry raw PCM; for opaque container formats the gate may
        # return 0 (treated as "silent") conservatively, but webm blobs from
        # MediaRecorder always exceed 1 kB for real speech so the byte-size guard
        # above catches those first.
        rms = _rms_from_audio_bytes(audio_bytes)
        if 0.0 < rms < _RMS_GATE_THRESHOLD:
            logger.warning(
                "STT rejected: reason=rms_gate, rms=%.5f (threshold=%.5f), bytes=%d",
                rms, _RMS_GATE_THRESHOLD, len(audio_bytes),
            )
            return ""

        try:
            client = AsyncOpenAI(api_key=api_key, max_retries=0 if fast else 2)
            audio_file = io.BytesIO(audio_bytes)
            audio_file.name = "audio.webm"
            kwargs: dict = dict(
                model="whisper-1",
                file=audio_file,
                language="tr",
                # temperature=0 → deterministic output, avoids creative/random
                # hallucinations on near-silence.  OpenAI SDK whisper-1 accepts
                # temperature in [0, 1]; condition_on_previous_text and
                # no_speech_threshold are local-Whisper-only and not in the API.
                temperature=0.0,
            )
            if prompt:
                kwargs["prompt"] = prompt
            transcript = await client.audio.transcriptions.create(**kwargs)
            text = transcript.text

            # ── Post-process hallucination blacklist ───────────────────────────
            if text and _is_hallucination(text):
                logger.warning(
                    "STT rejected: reason=hallucination_blacklist, text=%s",
                    text[:120],
                )
                return ""

            return text
        except Exception as e:
            err_str = str(e).lower()
            if "could not be decoded" in err_str or "format is not supported" in err_str:
                logger.warning("STT: invalid/undecodable audio, returning empty: %s", e)
                return ""
            logger.error(f"STT error: {e}")
            raise

    # ── TTS ───────────────────────────────────────────────────────────────────

    async def tts_stream(
        self,
        text: str,
        api_key: str = "",
        provider: str = "elevenlabs",
        openai_voice: str = DEFAULT_OPENAI_VOICE,
        edge_voice: str = DEFAULT_EDGE_VOICE,
        elevenlabs_api_key: str = "",
        elevenlabs_voice_id: str = "",
        elevenlabs_model_id: str = DEFAULT_ELEVENLABS_MODEL,
    ) -> AsyncIterator[bytes]:
        """Yield MP3 audio chunks for *text*.

        Provider priority: ElevenLabs → OpenAI tts-1-hd → edge-tts.
        Automatic fallback — each provider failure is logged and the next is tried.
        Text is cleaned before synthesis.
        """
        cleaned = clean_text_for_tts(text)
        if not cleaned:
            return

        # ── ElevenLabs (primary) ───────────────────────────────────────────────
        if provider == "elevenlabs" and elevenlabs_api_key and elevenlabs_voice_id:
            try:
                async for chunk in self._elevenlabs_tts(
                    cleaned, elevenlabs_api_key, elevenlabs_voice_id, elevenlabs_model_id
                ):
                    yield chunk
                return
            except Exception as e:
                logger.warning(f"ElevenLabs TTS failed, falling back to OpenAI: {e}")

        # ── OpenAI TTS HD (fallback 1) ────────────────────────────────────────
        if api_key:
            try:
                async for chunk in self._openai_tts(cleaned, api_key, openai_voice):
                    yield chunk
                return
            except Exception as e:
                logger.warning(f"OpenAI TTS failed, falling back to edge-tts: {e}")

        # ── edge-tts (fallback 2 / explicit choice) ───────────────────────────
        async for chunk in self._edge_tts(cleaned, edge_voice):
            yield chunk

    async def _elevenlabs_tts(
        self, text: str, api_key: str, voice_id: str, model_id: str
    ) -> AsyncIterator[bytes]:
        """Stream MP3 from ElevenLabs TTS API."""
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
        headers = {
            "xi-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        }
        body = {
            "text": text,
            "model_id": model_id,
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.75,
                "style": 0.0,
                "use_speaker_boost": True,
            },
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            async with client.stream("POST", url, headers=headers, json=body) as response:
                if response.status_code != 200:
                    body_text = await response.aread()
                    raise Exception(
                        f"ElevenLabs API error {response.status_code}: {body_text.decode(errors='replace')}"
                    )
                async for chunk in response.aiter_bytes(chunk_size=4096):
                    yield chunk

    async def _openai_tts(
        self, text: str, api_key: str, voice: str
    ) -> AsyncIterator[bytes]:
        """Stream MP3 from OpenAI TTS API (tts-1-hd for highest quality)."""
        client = AsyncOpenAI(api_key=api_key)
        response = await client.audio.speech.create(
            model="tts-1-hd",       # HD model — noticeably more natural
            voice=voice,            # type: ignore[arg-type]
            input=text,
            response_format="mp3",
            speed=1.0,
        )
        content    = response.content
        chunk_size = 4096
        for i in range(0, len(content), chunk_size):
            yield content[i : i + chunk_size]

    async def _edge_tts(
        self, text: str, voice: str = DEFAULT_EDGE_VOICE
    ) -> AsyncIterator[bytes]:
        """Stream MP3 from Microsoft edge-tts (free fallback)."""
        try:
            communicate = edge_tts.Communicate(text, voice)
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    yield chunk["data"]
        except Exception as e:
            logger.error(f"Edge-TTS error: {e}")
            raise


voice_service = VoiceService()
