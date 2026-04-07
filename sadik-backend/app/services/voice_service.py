import logging
import io
import re
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


# ── Service ────────────────────────────────────────────────────────────────────


class VoiceService:
    # ── STT ───────────────────────────────────────────────────────────────────

    async def stt(self, audio_bytes: bytes, api_key: str, prompt: Optional[str] = None) -> str:
        """Transcribe *audio_bytes* via Whisper (Turkish).

        Pass *prompt* to bias Whisper toward expected vocabulary (e.g. the
        wake word name).  When None the call behaves exactly as before.
        """
        if not api_key:
            return ""

        if len(audio_bytes) <= 512:
            logger.warning("STT: audio_bytes too small (%d bytes), skipping Whisper", len(audio_bytes))
            return ""

        try:
            client = AsyncOpenAI(api_key=api_key)
            audio_file = io.BytesIO(audio_bytes)
            audio_file.name = "audio.webm"
            kwargs: dict = dict(model="whisper-1", file=audio_file, language="tr")
            if prompt:
                kwargs["prompt"] = prompt
            transcript = await client.audio.transcriptions.create(**kwargs)
            return transcript.text
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
