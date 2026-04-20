"""
privacy_flags.py — SADIK privacy flag helper

Reads the 4 privacy toggles from the Setting table and returns a typed dict.
All callers should use get_privacy_flags(session) instead of reading Setting
directly so enforcement logic stays in one place.

Flag semantics:
  privacy_calendar_push    — False → ExternalEvent (Google Calendar) data MUST NOT
                             reach the LLM. Native Event table data is always allowed.
  privacy_notion_push      — False → Notion-sourced ExternalEvents blocked (hook for
                             Sprint 4; no Notion provider yet).
  privacy_voice_memory     — False → conversation history MUST NOT be prepended to
                             the LLM prompt; each voice turn is stateless. Also
                             suppresses DB persistence of voice turns.
  privacy_behavioral_learning — False → behavioral pattern data MUST NOT be injected
                             into the system prompt (Sprint 3 hook; no-op until T3.2).

Value normalisation: "true" / "1" → True; anything else → False.
"""
from __future__ import annotations

import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

logger = logging.getLogger(__name__)

_PRIVACY_KEYS = (
    "privacy_calendar_push",
    "privacy_notion_push",
    "privacy_voice_memory",
    "privacy_behavioral_learning",
)

# Safe default: all flags OFF (most restrictive).
_DEFAULT_FLAGS: dict[str, bool] = {k: False for k in _PRIVACY_KEYS}


def _to_bool(value: str | None) -> bool:
    """Normalise a Setting.value string to a Python bool."""
    if value is None:
        return False
    return value.strip().lower() in ("true", "1", "yes")


async def get_privacy_flags(session: AsyncSession) -> dict[str, bool]:
    """Return all 4 privacy flags read live from the Setting table.

    Falls back to the safest defaults (all False) on any DB error so a
    transient failure never accidentally enables data sharing.
    """
    from app.models.setting import Setting

    try:
        result = await session.execute(
            select(Setting).where(Setting.key.in_(_PRIVACY_KEYS))
        )
        rows = result.scalars().all()
        flags = dict(_DEFAULT_FLAGS)  # start from safe defaults
        for row in rows:
            if row.key in flags:
                flags[row.key] = _to_bool(row.value)
        return flags
    except Exception as exc:
        logger.error(f"[privacy_flags] Failed to read privacy flags: {exc}; defaulting all to False")
        return dict(_DEFAULT_FLAGS)
