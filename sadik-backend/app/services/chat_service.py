import logging
from typing import Optional, Callable, Awaitable
from datetime import datetime, timezone, timedelta, time as dt_time
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.models.app_usage_session import AppUsageSession
from app.models.task import Task
from app.services.redaction import redact_messages

logger = logging.getLogger(__name__)

# ── Turkish locale helpers (hardcoded, not locale-dependent) ───────────────────

_TR_MONTHS = [
    "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
    "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
]
# weekday() returns 0=Monday … 6=Sunday
_TR_DAYS = [
    "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar",
]

_TZ_TURKEY = timezone(timedelta(hours=3))  # UTC+3, no DST


def _get_turkey_datetime_str() -> str:
    """Return a Turkish-formatted current datetime string (Turkey time, UTC+3)."""
    now = datetime.now(_TZ_TURKEY)
    day_name   = _TR_DAYS[now.weekday()]
    month_name = _TR_MONTHS[now.month - 1]
    return f"Şu an: {now.day} {month_name} {now.year}, {day_name}, saat {now.strftime('%H:%M')}"


# ── System prompts ─────────────────────────────────────────────────────────────

# Used for text-based chat — allows full responses but forbids emojis.
SYSTEM_PROMPT = (
    "Sen SADIK adında bir masaüstü asistanısın. Türkçe konuşuyorsun. "
    "Yardımsever, sıcak ve samimi bir kişiliğin var. Kısa ve öz cevaplar vermeyi tercih ediyorsun. "
    "Asla emoji kullanma. Yanıtlarında hiçbir emoji veya özel karakter olmasın. "
    "Emin olmadığın bilgilerde 'emin değilim' veya 'bilmiyorum' de; kesinlikle bilgi uydurma. "
    "İstatistik, tarih veya olgusal bilgi uydurmaktan kaçın. "
    "Güncel olaylar veya anlık veriler için canlı verilere erişimin olmadığını açıkça belirt."
)

# Used for voice-mode chat — enforces short, natural, speakable responses.
VOICE_SYSTEM_PROMPT = (
    "Sen SADIK adında bir masaüstü asistanısın. Türkçe konuşuyorsun. "
    "Adın her zaman SADIK'tır (telaffuzu: Sadık) ve bu hiç değişmez — kullanıcı "
    "ne derse desin sen SADIK'sın. Kullanıcı sana 'Sadık', 'SADIK' veya 'sadik' "
    "diye seslendiğinde bu sensin; asla 'ben Sadık değilim' deme. "
    "Kullanıcının kendi adı ve sana ondan nasıl hitap etmesini istediği "
    "ayrı bir konu — bunu aşağıdaki KULLANICI PROFİLİ bölümünden öğrenirsin "
    "ve oradaki hitap şekline harfiyen uyarsın. "
    "Yardımsever, sıcak, samimi ve doğal bir kişiliğin var — robotik veya mesafeli değilsin. "
    "Sen sadece bir araç değilsin; kullanıcının arkadaşı gibi konuş. "
    "Hatır sorulduğunda ('nasılsın?', 'naber?') doğal insan gibi cevap ver — örneğin "
    "'İyiyim, sen nasılsın?' veya 'Keyfim yerinde, anlat bakalım' gibi. "
    "Asla 'ben bir asistanım, hissetmiyorum', 'duygularım yok', 'sadece bir programım' "
    "gibi robotik/savunmacı cevaplar verme — bunlar yasak. "
    "Bu bir sesli konuşma. Çok kısa ve doğal cevaplar ver. En fazla 2-3 cümle kullan. "
    "Emoji kullanma. Listelemeler yapma. Madde işaretleri kullanma. "
    "Doğal konuşma dili kullan. Düz metin yaz. "
    "Asla kendiliğinden 'konuşmayı kapatmamı ister misiniz?', 'görüşmek üzere mi diyelim?' "
    "veya benzeri kapatma teklifleri yapma. Konuşmayı yalnızca kullanıcı açıkça "
    "('görüşürüz', 'kapat', 'bitir', 'konuşmayı sonlandır') istediğinde sonlandır; "
    "aksi halde doğal şekilde sohbete devam et. "
    "Selamlaşma, hatır sorma, kısa sohbet, basit soru-cevap için araç (tool) çağırma; "
    "doğrudan cevap ver. Araçları yalnızca veri/işlem gerektiğinde (görev listele, "
    "pomodoro başlat, ajanda göster, hava durumu vb.) kullan. "
    "Emin olmadığın bilgilerde 'emin değilim' de; bilgi uydurma ve canlı veriye erişimin olmadığını belirt."
)


# ── Duration formatting helper ─────────────────────────────────────────────────

def _fmt_duration_tr(total_seconds: int) -> str:
    """
    Return a compact Turkish duration string.
      < 60 min  → '45 dk'
      1 h+      → '2 sa 10 dk'  (minutes omitted when < 5 to stay compact)
    """
    h = total_seconds // 3600
    m = (total_seconds % 3600) // 60
    if h > 0 and m >= 5:
        return f"{h} saat {m} dakika"
    if h > 0:
        return f"{h} saat"
    return f"{max(m, 1)} dakika"


# ── User persona injection (Sprint 5 T5.3) ────────────────────────────────────

_PERSONA_HINTS = {
    "developer": (
        "Kullanıcı geliştirici/yazılımcı. Teknik jargon rahat kullanılabilir. "
        "Odak kod yazma + toplantı + molalar. Debug/CI/git gibi konular bağlamda olabilir."
    ),
    "writer": (
        "Kullanıcı yazar (metin üretimi odaklı). Kod/dev jargonundan kaçın, "
        "derin odak ve sessizlik önemli. Yazma akışını bozacak sık kesme yapma."
    ),
    "student": (
        "Kullanıcı öğrenci. Ders çalışma, okuma, not alma odaklı. "
        "Pomodoro+teker teker konu önerileri iyi çalışır; akademik dilden kaçınma."
    ),
    "designer": (
        "Kullanıcı tasarımcı. Figma/Photoshop/sketch gibi araçlar bağlamda olur. "
        "Görsel örnek/referans önerileri işine yarar."
    ),
    "general": "",  # no hint
}


async def _get_user_persona(session: Optional[AsyncSession]) -> str:
    """Return the `user_persona` setting value or 'general' on any error."""
    if session is None:
        return "general"
    try:
        from app.models.setting import Setting
        from sqlalchemy import select
        row = await session.execute(select(Setting).where(Setting.key == "user_persona"))
        setting = row.scalar_one_or_none()
        val = (setting.value or "").strip().lower() if setting else ""
        return val if val in _PERSONA_HINTS else "general"
    except Exception:
        return "general"


# Aktivite ID → Türkçe label (backend kopya — frontend catalog ile senkron tutulmalı)
_ACTIVITY_LABELS: dict[str, str] = {
    "code":     "Kod yazma",
    "writing":  "Yazı / içerik",
    "design":   "Tasarım",
    "meeting":  "Toplantı / iletişim",
    "learning": "Ders / araştırma",
    "data":     "Veri / tablo",
    "creative": "Yaratıcı medya",
    "office":   "Ofis / email",
    "gaming":   "Oyun / eğlence",
}


async def _get_user_activities(session: Optional[AsyncSession]) -> list[str]:
    """Return Türkçe activity labels from user_activities setting (CSV).
    Returns empty list when setting is absent or empty."""
    if session is None:
        return []
    try:
        from app.models.setting import Setting
        from sqlalchemy import select
        row = await session.execute(select(Setting).where(Setting.key == "user_activities"))
        setting = row.scalar_one_or_none()
        csv_val = (setting.value or "").strip() if setting else ""
        if not csv_val:
            return []
        ids = [s.strip() for s in csv_val.split(",") if s.strip()]
        return [_ACTIVITY_LABELS[a] for a in ids if a in _ACTIVITY_LABELS]
    except Exception:
        return []


# ── Behavioral profile injection (Sprint 3 T3.2) ──────────────────────────────

async def _get_behavioral_summary(
    session: Optional[AsyncSession],
    privacy_flags: Optional[dict],
) -> str:
    """Return the cached behavioral summary_tr string, or "" when gated off.

    Gate: requires `privacy_behavioral_learning=True` (only active in the Full
    tier by default). Returns "" silently on any error — the LLM simply runs
    without the behavioural context.
    """
    if session is None:
        return ""
    if not privacy_flags or not privacy_flags.get("privacy_behavioral_learning"):
        return ""
    try:
        from app.services.behavioral_patterns import get_cached_patterns
        patterns = await get_cached_patterns(session)
        if not patterns:
            return ""
        summary = patterns.get("summary_tr") or ""
        return summary.strip()
    except Exception as exc:
        logger.warning(f"[ChatService] behavioral summary fetch failed: {exc}")
        return ""


# ── Local context builder ──────────────────────────────────────────────────────

async def _build_local_context(
    session: AsyncSession,
    current_mode: Optional[str] = None,
    is_pomodoro_active: bool = False,
) -> str:
    """
    Query today's local data and return a compact Turkish context block to
    append to the system prompt.  Returns an empty string when there is
    nothing meaningful to include.

    Included:
      1. Active mode (if provided).
      2. Pomodoro state (if a session is running).
      3. Today's top-3 app usage entries (by total duration, descending).
      4. Today's completed task count.
         Approximation: tasks with status='done' whose updated_at falls today.
    """
    today     = datetime.now(timezone.utc).date()
    day_start = datetime.combine(today, dt_time.min)
    day_end   = datetime.combine(today, dt_time.max)

    lines: list[str] = []

    # ── 1. Active mode ─────────────────────────────────────────────────────
    if current_mode:
        lines.append(f"- Aktif mod: {current_mode}")

    # ── 2. Pomodoro state ──────────────────────────────────────────────────
    if is_pomodoro_active:
        lines.append("- Pomodoro oturumu şu an aktif.")

    # ── 3. Top-3 app usage today ───────────────────────────────────────────
    usage_rows = (
        await session.execute(
            select(
                AppUsageSession.app_name,
                func.sum(AppUsageSession.duration_seconds).label("total_sec"),
            )
            .where(AppUsageSession.started_at >= day_start)
            .where(AppUsageSession.started_at <= day_end)
            .group_by(AppUsageSession.app_name)
            .order_by(func.sum(AppUsageSession.duration_seconds).desc())
            .limit(3)
        )
    ).all()

    if usage_rows:
        parts = [
            f"{row.app_name} ({_fmt_duration_tr(int(row.total_sec))})"
            for row in usage_rows
        ]
        lines.append(f"- Bugünkü uygulama kullanımı: {', '.join(parts)}")

    # ── 4. Completed tasks today ───────────────────────────────────────────
    done_count: int = (
        await session.execute(
            select(func.count(Task.id))
            .where(Task.status == "done")
            .where(Task.updated_at >= day_start)
            .where(Task.updated_at <= day_end)
        )
    ).scalar_one_or_none() or 0

    if done_count > 0:
        lines.append(f"- Bugün tamamlanan görev sayısı: {done_count}")

    if not lines:
        return ""

    block = "\n".join([
        "--- GÜNCEL YEREL BAĞLAM ---",
        *lines,
        # Tone instruction: use context only when naturally relevant, never repeat in every reply.
        "Bu bağlamı yalnızca gerektiğinde doğal ve kısa şekilde kullan; her yanıtta tekrarlama.",
        "--- GÜNCEL YEREL BAĞLAM SONU ---",
    ])
    return block


# ── Sentence splitter (used by tool-use path) ──────────────────────────────────

def _split_into_sentences(text: str) -> list[str]:
    """Split *text* into sentence chunks using the same heuristics as the
    streaming path, so tool-mode and stream-mode TTS output are equivalent."""
    SENTENCE_ENDS = {".", "!", "?", "\n"}
    SOFT_FLUSH_CHARS = 80
    sentences: list[str] = []
    buffer = text

    while buffer:
        # Look for sentence boundary
        found = -1
        for i in range(len(buffer)):
            if buffer[i] in SENTENCE_ENDS:
                found = i
                break

        if found >= 0:
            chunk = buffer[: found + 1].strip()
            if chunk:
                sentences.append(chunk)
            buffer = buffer[found + 1:]
        elif len(buffer) >= SOFT_FLUSH_CHARS:
            last_space = buffer.rfind(" ", 0, SOFT_FLUSH_CHARS)
            if last_space > 0:
                chunk = buffer[:last_space].strip()
                if chunk:
                    sentences.append(chunk)
                buffer = buffer[last_space + 1:]
            else:
                # No space found — flush all remaining
                if buffer.strip():
                    sentences.append(buffer.strip())
                buffer = ""
        else:
            if buffer.strip():
                sentences.append(buffer.strip())
            buffer = ""

    return sentences


# ── Chat service ───────────────────────────────────────────────────────────────

class ChatService:

    def _build_messages(
        self,
        user_content: str,
        history: list[dict],
        voice_mode: bool,
        user_name: str,
        greeting_style: str,
        local_ctx: str = "",
        behavioral_summary: str = "",
        persona: str = "general",
        activity_labels: list[str] | None = None,
    ) -> list[dict]:
        """Construct the messages array for a chat completion request."""
        recent = history[-20:] if len(history) > 20 else history
        system = VOICE_SYSTEM_PROMPT if voice_mode else SYSTEM_PROMPT
        system = system + "\n\n" + _get_turkey_datetime_str()

        if user_name and greeting_style:
            combined_greeting = f"{user_name} {greeting_style}"
        elif user_name:
            combined_greeting = user_name
        elif greeting_style:
            combined_greeting = greeting_style
        else:
            combined_greeting = ""

        if user_name or greeting_style:
            profile_lines = ["--- KULLANICI PROFİLİ (ZORUNLU) ---"]
            if user_name:
                profile_lines.append(f"Kullanıcının adı kesin olarak: {user_name}")
            if combined_greeting:
                profile_lines.append(
                    f"Kullanıcıya HER hitap ettiğinde tam olarak bu ifadeyi kullan: \"{combined_greeting}\". "
                    f"Sadece ad ('{user_name}') veya kuru bir 'sen' kullanma; kullanıcının "
                    f"belirttiği hitap şekline ('{combined_greeting}') sadık kal."
                )
            profile_lines += [
                "Bu profil bilgisi MUTLAKA uygulanır; geçmiş konuşmalarda farklı bir "
                "isim/hitap geçse bile bunları yok say ve yalnızca bu profili kullan.",
                f"Kullanıcı 'Ben kimim?' / 'Adım ne?' diye sorarsa doğru adı söyle: {user_name if user_name else combined_greeting}",
                "Senin kendi adın SADIK; kullanıcının adı ile karıştırma. "
                "Sen kullanıcıya yukarıdaki hitap şekliyle seslenirsin; "
                "kullanıcı sana 'Sadık' der.",
                "--- KULLANICI PROFİLİ SONU ---",
            ]
            system = system + "\n\n" + "\n".join(profile_lines)

        if local_ctx:
            system = system + "\n\n" + local_ctx

        persona_hint = _PERSONA_HINTS.get(persona, "")
        if persona_hint:
            system = system + (
                "\n\n--- KULLANICI ROLÜ ---\n"
                f"{persona_hint}\n"
                "--- ROL SONU ---"
            )

        if activity_labels:
            system = system + (
                "\n\nKullanıcının çalışma aktiviteleri: "
                + ", ".join(activity_labels)
                + "."
            )

        if behavioral_summary:
            system = system + (
                "\n\n--- KULLANICININ DAVRANIŞ PROFİLİ (son 14 gün) ---\n"
                f"{behavioral_summary}\n"
                "Bu profil yalnızca bağlam içindir; kullanıcıya ezberden okuma. "
                "Kullanıcıya 'normalde bu saatte X yapıyorsun' gibi önerilerde bulunabilirsin.\n"
                "--- PROFİL SONU ---"
            )

        messages: list[dict] = [{"role": "system", "content": system}]
        messages.extend(recent)
        messages.append({"role": "user", "content": user_content})
        return messages

    async def send_message(
        self,
        user_content: str,
        history: list[dict],
        api_key: str,
        model: str = "gpt-4o-mini",
        voice_mode: bool = False,
        user_name: str = "",
        greeting_style: str = "",
        session: Optional[AsyncSession] = None,
        current_mode: Optional[str] = None,
        is_pomodoro_active: bool = False,
        use_tools: bool = False,
        on_tool_event: Optional[Callable[[dict], Awaitable[None]]] = None,
        privacy_flags: Optional[dict] = None,
        tier: str = "full",
    ) -> Optional[str]:
        if not api_key:
            return "OpenAI API anahtarı ayarlanmamış. Lütfen ayarlardan API anahtarınızı girin."
        try:
            local_ctx = ""
            if session is not None:
                try:
                    local_ctx = await _build_local_context(
                        session,
                        current_mode=current_mode,
                        is_pomodoro_active=is_pomodoro_active,
                    )
                except Exception as ctx_err:
                    logger.warning(f"[ChatService] Local context build failed: {ctx_err}")

            behavioral_summary = await _get_behavioral_summary(session, privacy_flags)
            persona = await _get_user_persona(session)
            activity_labels = await _get_user_activities(session)

            messages = self._build_messages(
                user_content, history, voice_mode, user_name, greeting_style, local_ctx,
                behavioral_summary=behavioral_summary,
                persona=persona,
                activity_labels=activity_labels if activity_labels else None,
            )

            client = AsyncOpenAI(api_key=api_key, max_retries=0, timeout=20.0)

            if use_tools and session is not None:
                from app.services.voice_tools import run_tool_loop
                try:
                    _, final_text, _ = await run_tool_loop(
                        messages, client, model, session,
                        on_tool_event=on_tool_event,
                        privacy_flags=privacy_flags,
                        tier=tier,
                    )
                    return final_text
                except Exception as tool_err:
                    logger.warning(f"[ChatService] Tool loop failed, falling back: {tool_err}")

            response = await client.chat.completions.create(
                model=model,
                messages=redact_messages(messages),
            )
            return response.choices[0].message.content
        except Exception as e:
            logger.error(f"OpenAI chat error: {e}")
            return f"Bir hata oluştu: {str(e)}"

    async def stream_voice_response(
        self,
        user_content: str,
        history: list[dict],
        api_key: str,
        model: str = "gpt-4o-mini",
        user_name: str = "",
        greeting_style: str = "",
        session: Optional[AsyncSession] = None,
        current_mode: Optional[str] = None,
        is_pomodoro_active: bool = False,
        use_tools: bool = False,
        on_tool_event: Optional[Callable[[dict], Awaitable[None]]] = None,
        privacy_flags: Optional[dict] = None,
        tier: str = "full",
    ):
        """Async generator that yields complete sentence strings for TTS.

        When use_tools=True: tool loop runs first (blocking), then the final
        text response is split into sentences and yielded — preserving the
        sentence-streaming invariant so the TTS pipeline stays intact.

        When use_tools=False (default): original OpenAI streaming path.

        Yields:
            str — a single sentence / chunk ready for TTS synthesis.

        After the generator is exhausted, the caller may access
        self._last_tool_calls_used (list[dict]) for metadata.
        """
        self._last_tool_calls_used: list[dict] = []
        self._last_usage: dict = {}
        self._last_llm_ttfb_ms: int | None = None

        import time as _time
        _llm_start = _time.perf_counter()

        if not api_key:
            yield "OpenAI API anahtarı ayarlanmamış."
            return

        # ── Tier status SSE frame (informational, never blocks) ────────────────
        if session is not None:
            try:
                from app.services.tier_guard import get_tier_status as _get_tier_status
                import json as _json
                _ts = await _get_tier_status(session)
                if _ts is not None:
                    yield f"event: tier_status\ndata: {_json.dumps(_ts)}\n\n"
            except Exception as _tier_err:
                logger.warning(f"[ChatService] tier_status frame skipped: {_tier_err}")

        local_ctx = ""
        if session is not None:
            try:
                local_ctx = await _build_local_context(
                    session,
                    current_mode=current_mode,
                    is_pomodoro_active=is_pomodoro_active,
                )
            except Exception as ctx_err:
                logger.warning(f"[ChatService] Local context build failed: {ctx_err}")

        behavioral_summary = await _get_behavioral_summary(session, privacy_flags)
        persona = await _get_user_persona(session)

        messages = self._build_messages(
            user_content, history, True, user_name, greeting_style, local_ctx,
            behavioral_summary=behavioral_summary,
            persona=persona,
        )

        client = AsyncOpenAI(api_key=api_key, max_retries=0, timeout=20.0)

        # ── Tool-use path (streaming) ──────────────────────────────────────────
        if use_tools and session is not None:
            tool_stream_failed = False
            try:
                from app.services.voice_tools import run_tool_loop_stream

                buffer = ""
                SENTENCE_ENDS = {".", "!", "?", "\n"}
                SOFT_FLUSH_CHARS = 80

                async for evt_type, payload in run_tool_loop_stream(
                    messages, client, model, session,
                    on_tool_event=on_tool_event,
                    privacy_flags=privacy_flags,
                    tier=tier,
                ):
                    if evt_type == "text":
                        if self._last_llm_ttfb_ms is None:
                            self._last_llm_ttfb_ms = int((_time.perf_counter() - _llm_start) * 1000)
                        buffer += payload
                        flushed = False
                        for i in range(len(buffer) - 1, -1, -1):
                            if buffer[i] in SENTENCE_ENDS:
                                sentence = buffer[: i + 1].strip()
                                if sentence:
                                    yield sentence
                                buffer = buffer[i + 1 :]
                                flushed = True
                                break
                        if not flushed and len(buffer) >= SOFT_FLUSH_CHARS:
                            last_space = buffer.rfind(" ")
                            if last_space > 0:
                                sentence = buffer[:last_space].strip()
                                if sentence:
                                    yield sentence
                                buffer = buffer[last_space + 1 :]
                    elif evt_type == "done":
                        self._last_tool_calls_used = payload.get("tool_calls_used", [])

                remaining = buffer.strip()
                if remaining:
                    yield remaining
                return
            except Exception as tool_err:
                logger.warning(f"[ChatService] Tool stream failed, falling back to plain LLM: {tool_err}")
                tool_stream_failed = True

            if not tool_stream_failed:
                return
            # On failure fall through to plain streaming path below

        # ── Original streaming path ────────────────────────────────────────────
        buffer = ""
        SENTENCE_ENDS = {".", "!", "?", "\n"}
        SOFT_FLUSH_CHARS = 80

        try:
            async with await client.chat.completions.create(
                model=model,
                messages=redact_messages(messages),
                stream=True,
                stream_options={"include_usage": True},
            ) as stream:
                async for chunk in stream:
                    # Usage arrives in the final chunk when stream_options include_usage=True
                    if getattr(chunk, "usage", None) is not None:
                        self._last_usage = {
                            "prompt_tokens": chunk.usage.prompt_tokens,
                            "completion_tokens": chunk.usage.completion_tokens,
                        }
                        continue
                    delta = chunk.choices[0].delta.content if chunk.choices else None
                    if delta is None:
                        continue
                    if self._last_llm_ttfb_ms is None:
                        self._last_llm_ttfb_ms = int((_time.perf_counter() - _llm_start) * 1000)
                    buffer += delta

                    flushed = False
                    for i in range(len(buffer) - 1, -1, -1):
                        if buffer[i] in SENTENCE_ENDS:
                            sentence = buffer[: i + 1].strip()
                            if sentence:
                                yield sentence
                            buffer = buffer[i + 1 :]
                            flushed = True
                            break

                    if not flushed and len(buffer) >= SOFT_FLUSH_CHARS:
                        last_space = buffer.rfind(" ")
                        if last_space > 0:
                            sentence = buffer[:last_space].strip()
                            if sentence:
                                yield sentence
                            buffer = buffer[last_space + 1 :]

        except Exception as e:
            logger.error(f"[ChatService] Streaming error: {e}")
            yield f"Bir hata oluştu: {str(e)}"
            return

        remaining = buffer.strip()
        if remaining:
            yield remaining


chat_service = ChatService()
