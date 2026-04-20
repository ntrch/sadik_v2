"""behavioral_insight.py — Sprint 3 T3.3

Proactive insight category: "behavioral".

Evaluates whether the user is in a time-block where they habitually use a
specific mode AND the current mode differs from that expectation AND at
least one open task is due soon.  Returns a single insight dict compatible
with the AppInsight shape returned by GET /api/stats/app-usage/insights,
or None when no trigger fires.

Integration: called from the stats router's /app-usage/insights endpoint so
the frontend receives it via its existing poll — no new endpoint needed.

Gate:  privacy_flags["privacy_behavioral_learning"] must be True.
       Returns None immediately (with a debug log) if flag is off.
Anti-spam: Setting key "proactive_behavioral_last_fired_at" stores the ISO
           timestamp of the last delivery; skip if within 24 h.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.setting import Setting
from app.models.task import Task
from app.models.workspace import Workspace
from app.services.behavioral_patterns import (
    _BLOCKS,
    _DOW_NAMES,
    _DOW_TR,
    _MODE_TR,
    _MIN_SESSIONS_PER_BLOCK,
    get_cached_patterns,
)
from app.services.mode_tracker import mode_tracker
from app.services.privacy_flags import get_privacy_flags

logger = logging.getLogger(__name__)

# Re-export for tests / callers that want a single import
_ANTI_SPAM_KEY = "proactive_behavioral_last_fired_at"
_ANTI_SPAM_HOURS = 24
_TRUST_MIN_SESSIONS = _MIN_SESSIONS_PER_BLOCK  # == 3


def _block_label(h_start: int, h_end: int) -> str:
    """Return "HH-HH" label matching behavioral_patterns.py summary_tr convention."""
    return f"{h_start:02d}-{h_end:02d}"


def _current_block_idx(now: datetime) -> int:
    """Return the 3-hour block index (0-7) for the current hour."""
    return min(now.hour // 3, 7)


async def _get_anti_spam_ts(session: AsyncSession) -> Optional[datetime]:
    """Read the last-fired timestamp from settings, or None."""
    result = await session.execute(
        select(Setting).where(Setting.key == _ANTI_SPAM_KEY)
    )
    row = result.scalar_one_or_none()
    if not row or not row.value:
        return None
    try:
        return datetime.fromisoformat(row.value)
    except ValueError:
        return None


async def _set_anti_spam_ts(session: AsyncSession, ts: datetime) -> None:
    """Write/update the last-fired timestamp in settings."""
    result = await session.execute(
        select(Setting).where(Setting.key == _ANTI_SPAM_KEY)
    )
    row = result.scalar_one_or_none()
    iso = ts.isoformat()
    if row:
        row.value = iso
    else:
        session.add(Setting(key=_ANTI_SPAM_KEY, value=iso))
    await session.commit()


async def _earliest_open_task(session: AsyncSession) -> Optional[Task]:
    """Return the earliest-due open task (status todo/in_progress).

    Preference order:
      1. Tasks with due_date within next 24 h (soonest first)
      2. If none, the earliest-due task regardless of due_date (or any open task
         with no due_date as fallback)
    """
    now = datetime.now()
    window_end = now + timedelta(hours=24)

    # Try tasks due in next 24h first
    result = await session.execute(
        select(Task)
        .where(Task.status.in_(["todo", "in_progress"]))
        .where(Task.due_date.isnot(None))
        .where(Task.due_date <= window_end)
        .order_by(Task.due_date.asc())
        .limit(1)
    )
    task = result.scalar_one_or_none()
    if task:
        return task

    # Fallback: any open task (earliest due_date, nulls last)
    result = await session.execute(
        select(Task)
        .where(Task.status.in_(["todo", "in_progress"]))
        .order_by(Task.due_date.asc().nulls_last())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def evaluate_behavioral_insight(session: AsyncSession) -> Optional[dict]:
    """Evaluate the behavioral proactive insight trigger.

    Returns a dict in AppInsight shape (has_insight=True, source='behavioral',
    level, message, action) if all conditions hold, else None.

    The caller is responsible for *not* calling _set_anti_spam_ts — this
    function only evaluates.  Call mark_behavioral_insight_fired() after the
    insight is actually delivered to the frontend.
    """
    # ── Gate: privacy flag ───────────────────────────────────────────────────
    flags = await get_privacy_flags(session)
    if not flags.get("privacy_behavioral_learning"):
        # Flag off — skip immediately.  No behavioral data should be used.
        logger.debug(
            "[behavioral_insight] privacy_behavioral_learning=False — skipping insight evaluation"  # noqa: E501
        )
        return None

    # ── Anti-spam: last fired within 24 h? ──────────────────────────────────
    last_fired = await _get_anti_spam_ts(session)
    now_utc = datetime.now(timezone.utc)
    now_local = datetime.now()  # naive local, matches ModeLog/Task convention

    if last_fired is not None:
        # last_fired may be tz-aware or naive depending on who wrote it; normalise.
        if last_fired.tzinfo is None:
            last_fired = last_fired.replace(tzinfo=timezone.utc)
        if (now_utc - last_fired) < timedelta(hours=_ANTI_SPAM_HOURS):
            logger.debug(
                "[behavioral_insight] Anti-spam: last fired %s — skipping", last_fired.isoformat()
            )
            return None

    # ── Load cached patterns ─────────────────────────────────────────────────
    patterns = await get_cached_patterns(session)
    if not patterns:
        logger.debug("[behavioral_insight] No cached patterns yet — skipping")
        return None

    # ── Identify current (dow, block) cell ──────────────────────────────────
    dow_iso = now_local.weekday()  # 0=Monday … 6=Sunday (ISO, matches _DOW_NAMES)
    blk_idx = _current_block_idx(now_local)
    dow_name = _DOW_NAMES[dow_iso]  # e.g. "monday"

    day_blocks: list[dict] = patterns.get("weekly", {}).get(dow_name, [])
    if blk_idx >= len(day_blocks):
        logger.debug("[behavioral_insight] Block index %d out of range for %s", blk_idx, dow_name)
        return None

    cell = day_blocks[blk_idx]
    dominant_mode: Optional[str] = cell.get("dominant_mode")
    session_count: int = cell.get("session_count", 0)

    # Trust threshold: need >= 3 logged sessions in this cell
    if not dominant_mode or session_count < _TRUST_MIN_SESSIONS:
        logger.debug(
            "[behavioral_insight] Cell %s/%d: dominant_mode=%r session_count=%d — below threshold",
            dow_name, blk_idx, dominant_mode, session_count,
        )
        return None

    # ── Current mode ─────────────────────────────────────────────────────────
    current_log = await mode_tracker.get_current()
    current_mode: Optional[str] = current_log.mode if current_log else None

    if current_mode == dominant_mode:
        logger.debug(
            "[behavioral_insight] Current mode '%s' already matches dominant '%s' — no trigger",
            current_mode, dominant_mode,
        )
        return None

    # ── Open task within 24 h (or any open task) ────────────────────────────
    task = await _earliest_open_task(session)
    if not task:
        logger.debug("[behavioral_insight] No open tasks — skipping")
        return None

    # ── Workspace preference (T3.5) ─────────────────────────────────────────
    # If a workspace exists with mode_sync == dominant_mode, prefer the
    # "open_workspace" action — it activates the mode AND launches the user's
    # configured apps/URLs in one tap.  Otherwise fall back to bare mode switch.
    ws_result = await session.execute(
        select(Workspace).where(Workspace.mode_sync == dominant_mode).limit(1)
    )
    workspace: Optional[Workspace] = ws_result.scalar_one_or_none()

    # ── Build message ────────────────────────────────────────────────────────
    h_start, h_end = _BLOCKS[blk_idx]
    block_label = _block_label(h_start, h_end)
    dow_tr = _DOW_TR[dow_iso]
    mode_tr = _MODE_TR.get(dominant_mode, dominant_mode)

    if workspace:
        message = (
            f"Normalde {dow_tr} {block_label} {mode_tr} yapardın, bugün henüz başlamadın. "
            f"'{task.title}' görevin seni bekliyor. "
            f"'{workspace.name}' çalışma alanını açalım mı?"
        )
    else:
        message = (
            f"Normalde {dow_tr} {block_label} {mode_tr} yapardın, bugün henüz başlamadın. "
            f"'{task.title}' görevin seni bekliyor. "
            f"{mode_tr.capitalize()} moduna geçelim mi?"
        )

    # ── Determine level ───────────────────────────────────────────────────────
    level = "soft"
    if task.due_date is not None:
        delta = task.due_date - now_local
        # "strong" if overdue or within 2 h
        if delta.total_seconds() <= 2 * 3600:
            level = "strong"
        else:
            level = "soft"
    # Note: AppInsight type uses 'gentle' | 'strong'; map 'soft' → 'gentle'
    # so the frontend's existing level handling works correctly.
    if level == "soft":
        level = "gentle"

    # ── Action ────────────────────────────────────────────────────────────────
    if workspace:
        action = {
            "type": "open_workspace",
            "workspace_id": workspace.id,
            "workspace_name": workspace.name,
            "mode": dominant_mode,
        }
    else:
        action = {"type": "switch_mode", "mode": dominant_mode}

    return {
        "has_insight": True,
        "source": "behavioral",
        "level": level,
        "message": message,
        "action": action,
    }


async def mark_behavioral_insight_fired(session: AsyncSession) -> None:
    """Record that a behavioral insight was delivered now (anti-spam update)."""
    await _set_anti_spam_ts(session, datetime.now(timezone.utc))
