import logging
from typing import Optional
from datetime import datetime, timezone, timedelta, time as dt_time
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.models.app_usage_session import AppUsageSession
from app.models.task import Task

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
    "Bu bir sesli konuşma. Çok kısa ve doğal cevaplar ver. En fazla 2-3 cümle kullan. "
    "Emoji kullanma. Listelemeler yapma. Madde işaretleri kullanma. "
    "Doğal konuşma dili kullan. Düz metin yaz. "
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


# ── Chat service ───────────────────────────────────────────────────────────────

class ChatService:
    async def send_message(
        self,
        user_content: str,
        history: list[dict],
        api_key: str,
        model: str = "gpt-4o",
        voice_mode: bool = False,
        user_name: str = "",
        greeting_style: str = "",
        session: Optional[AsyncSession] = None,
        current_mode: Optional[str] = None,
        is_pomodoro_active: bool = False,
    ) -> Optional[str]:
        if not api_key:
            return "OpenAI API anahtarı ayarlanmamış. Lütfen ayarlardan API anahtarınızı girin."
        try:
            client = AsyncOpenAI(api_key=api_key)
            recent = history[-20:] if len(history) > 20 else history
            system = VOICE_SYSTEM_PROMPT if voice_mode else SYSTEM_PROMPT

            # Inject current Turkey date/time so the model can give time-aware answers.
            system = system + "\n\n" + _get_turkey_datetime_str()

            # Compute combined greeting explicitly — never rely on the model to combine parts.
            if user_name and greeting_style:
                combined_greeting = f"{user_name} {greeting_style}"
            elif user_name:
                combined_greeting = user_name
            elif greeting_style:
                combined_greeting = greeting_style
            else:
                combined_greeting = ""

            # Inject a strong, authoritative profile block that overrides any stale history.
            if user_name or greeting_style:
                profile_lines = [
                    "--- GÜNCEL KULLANICI PROFİLİ ---",
                ]
                if user_name:
                    profile_lines.append(f"Kullanıcının adı kesin olarak: {user_name}")
                if combined_greeting:
                    profile_lines.append(
                        f"Kullanıcıya hitap ederken kullanman gereken ifade: {combined_greeting}"
                    )
                profile_lines += [
                    "Önceki konuşmalarda geçen farklı isimler veya hitaplar geçersizdir.",
                    f"Kullanıcı 'Ben kimim?' diye sorarsa doğru adı söyle: {user_name if user_name else combined_greeting}",
                    "Bu profil bilgisi önceki konuşma bağlamına göre daima önceliklidir.",
                    "Eğer önceki mesajlarda farklı bir isim veya hitap geçtiyse, bunları yok say ve yalnızca güncel profili kullan.",
                    "--- GÜNCEL KULLANICI PROFİLİ SONU ---",
                ]
                system = system + "\n\n" + "\n".join(profile_lines)

            # Append local context block when a DB session is available.
            # The block is empty-string if there is no data worth including.
            if session is not None:
                try:
                    local_ctx = await _build_local_context(
                        session,
                        current_mode=current_mode,
                        is_pomodoro_active=is_pomodoro_active,
                    )
                    if local_ctx:
                        system = system + "\n\n" + local_ctx
                except Exception as ctx_err:
                    # Context enrichment is best-effort — never block the reply.
                    logger.warning(f"[ChatService] Local context build failed: {ctx_err}")

            messages = [{"role": "system", "content": system}]
            messages.extend(recent)
            messages.append({"role": "user", "content": user_content})

            response = await client.chat.completions.create(
                model=model,
                messages=messages,
            )
            return response.choices[0].message.content
        except Exception as e:
            logger.error(f"OpenAI chat error: {e}")
            return f"Bir hata oluştu: {str(e)}"


chat_service = ChatService()
