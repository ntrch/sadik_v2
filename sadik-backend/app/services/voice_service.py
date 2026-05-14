import logging
import io
import re
import struct
from typing import Optional
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)


# ── Whisper STT hallucination defence ─────────────────────────────────────────
#
# Common Whisper hallucinations in Turkish, produced on near-silence or
# background-noise-only audio.  Normalised substring match (lower, no punct).
# List covers subscribe-bait phrases, ghost filler, and copyright footers that
# Whisper was trained on and reproduces on silence.

# Substring triggers: any transcript CONTAINING one of these is a hallucination.
# Must be specific enough that legit speech never contains them.
_HALLUCINATION_PHRASES: list[str] = [
    # YouTube/podcast filler (specific multi-word phrases)
    "abone olmayı unutmayın",
    "beğenmeyi unutmayın",
    "bu videoyu beğendiyseniz",
    "yorumlara yazın",
    "görüşmek üzere",
    "iyi seyirler",
    "iyi dinlemeler",
    # Subtitle/caption artefacts
    "altyazı",
    "telif hakkı",
    "telifi altyazı",
    "subtitled by",
    "subtitle",
    # Common ghost phrases Whisper generates on ambient noise
    "bir sonraki videoda",
    "beğenip abone",
    "kanalıma abone",
    "desteklerinizi bekliyorum",
    # YouTube fragment triggers — user observed full hallucination:
    # "Kanalıma abone olmayı, yorum yapmayı ve beğen butonuna tıklamayı unutmayın"
    "abone olmayı",
    "beğen butonu",
    "beğen butonuna",
    "tıklamayı unutmayın",
]

# Standalone-only triggers: reject ONLY if the entire transcript (normalised) == phrase.
# These words can appear inside legit speech ("hayır teşekkürler", "seninle görüşürüz"),
# so substring match would cause false-positive rejection.
_HALLUCINATION_STANDALONE: list[str] = [
    "teşekkür ederim",
    "teşekkürler",
    "çeviri",
    # Note: "görüşürüz" / "iyi günler" NOT listed — user may legitimately
    # say just these words to end the conversation. RMS gate already blocks
    # most silence cases; accept the small false-positive trade for UX.
]

# Pre-compiled normalised phrases (lower, letters/spaces only)
def _norm(s: str) -> str:
    return re.sub(r"[^a-z\u00c0-\u024f\u011e\u011f\u0130\u0131\u015e\u015f\u00fc\u00fb\u00f6\u00e7\s]", "", s.lower()).strip()

_HALLUCINATION_NORMS: list[str] = [_norm(p) for p in _HALLUCINATION_PHRASES]
_HALLUCINATION_STANDALONE_NORMS: list[str] = [_norm(p) for p in _HALLUCINATION_STANDALONE]


def _is_hallucination(text: str) -> bool:
    """Return True if *text* appears to be a Whisper silence-hallucination."""
    n = _norm(text)
    if not n:
        return True
    # Standalone match — reject only if whole transcript equals a known
    # silence-hallucination phrase (or collapsed whitespace equals it).
    collapsed = " ".join(n.split())
    for phrase in _HALLUCINATION_STANDALONE_NORMS:
        if phrase and collapsed == phrase:
            return True
    # Substring match — unambiguous phrases never appearing in legit speech.
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
            client = AsyncOpenAI(
                api_key=api_key,
                max_retries=0 if fast else 2,
                timeout=30.0,
            )
            audio_file = io.BytesIO(audio_bytes)
            audio_file.name = "audio.webm"
            kwargs: dict = dict(
                model="whisper-1",
                file=audio_file,
                language="tr",
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



voice_service = VoiceService()
