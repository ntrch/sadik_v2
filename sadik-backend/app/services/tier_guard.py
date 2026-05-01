"""Tier guard service — informational only, never blocks AI flow.

Reads user_tier / pro_expires_at from settings and compares against daily
turn count + monthly completion tokens to emit a soft warning signal.

All DB / parse errors are swallowed; callers receive None on any failure so
the upstream AI call always continues unimpeded.
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Literal, Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.setting import Setting
from app.models.voice_turn_event import VoiceTurnEvent

logger = logging.getLogger(__name__)

# ── Tier limits ────────────────────────────────────────────────────────────────
FREE_DAILY_TURNS: int = 50
FREE_MONTHLY_COMPLETION_TOKENS: int = 100_000
WARN_THRESHOLD: float = 0.8  # ≥80% usage → soft warning


# ── Tier resolution ────────────────────────────────────────────────────────────

def get_effective_tier(settings: dict) -> Literal["free", "pro"]:
    """Return 'pro' only if user_tier == 'pro' AND pro_expires_at is in the future.

    Any parse / value error silently falls back to 'free'.
    """
    if settings.get("user_tier", "free") != "pro":
        return "free"
    expires_raw = settings.get("pro_expires_at", "")
    if not expires_raw:
        return "free"
    try:
        expires_dt = datetime.fromisoformat(expires_raw)
        # Make timezone-aware if naive (assume UTC)
        if expires_dt.tzinfo is None:
            expires_dt = expires_dt.replace(tzinfo=timezone.utc)
        if expires_dt > datetime.now(timezone.utc):
            return "pro"
    except Exception as exc:
        logger.warning(f"[tier_guard] pro_expires_at parse error ({expires_raw!r}): {exc}")
    return "free"


# ── Status query ───────────────────────────────────────────────────────────────

async def get_tier_status(session: AsyncSession) -> Optional[dict]:
    """Return a tier status dict, or None on any failure.

    Never raises — all errors are caught and None is returned so callers
    never block on tier logic.
    """
    try:
        result = await session.execute(select(Setting))
        settings = {s.key: s.value for s in result.scalars().all()}

        tier = get_effective_tier(settings)

        if tier == "pro":
            return {"tier": "pro"}

        # ── Free tier: count daily turns + monthly completion tokens ──────────
        now = datetime.now(timezone.utc).replace(tzinfo=None)

        # Last 24 h turn count
        since_24h = now - timedelta(hours=24)
        daily_result = await session.execute(
            select(func.count(VoiceTurnEvent.id)).where(
                VoiceTurnEvent.started_at >= since_24h
            )
        )
        daily_turns: int = daily_result.scalar() or 0

        # Month-to-date completion tokens
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        tokens_result = await session.execute(
            select(func.sum(VoiceTurnEvent.completion_tokens)).where(
                VoiceTurnEvent.started_at >= month_start
            )
        )
        monthly_tokens: int = tokens_result.scalar() or 0

        # ── Warn checks ───────────────────────────────────────────────────────
        if daily_turns >= FREE_DAILY_TURNS * WARN_THRESHOLD:
            return {
                "tier": "free",
                "level": "warn",
                "metric": "daily_turns",
                "used": daily_turns,
                "limit": FREE_DAILY_TURNS,
                "message": (
                    f"Günlük {FREE_DAILY_TURNS} dönüş limitinin "
                    f"%{int(daily_turns / FREE_DAILY_TURNS * 100)}'ine ulaştın."
                ),
            }

        if monthly_tokens >= FREE_MONTHLY_COMPLETION_TOKENS * WARN_THRESHOLD:
            return {
                "tier": "free",
                "level": "warn",
                "metric": "monthly_tokens",
                "used": monthly_tokens,
                "limit": FREE_MONTHLY_COMPLETION_TOKENS,
                "message": (
                    f"Aylık {FREE_MONTHLY_COMPLETION_TOKENS:,} token limitinin "
                    f"%{int(monthly_tokens / FREE_MONTHLY_COMPLETION_TOKENS * 100)}'ine ulaştın."
                ),
            }

        return {
            "tier": "free",
            "level": "ok",
            "daily_turns": daily_turns,
            "monthly_tokens": monthly_tokens,
        }

    except Exception as exc:
        logger.warning(f"[tier_guard] get_tier_status failed (returning None): {exc}")
        return None
