"""Behavioral pattern mining — Sprint 3 T3.1.

Analyses the last 14 days of ModeLog entries, clusters them by (day-of-week,
3-hour time block), and writes a weekly profile JSON to the `user_profile_patterns`
setting.  The LLM system prompt injection path (T3.2) reads `summary_tr` from
this JSON when `privacy_behavioral_learning=true`.

Output schema (pinned, consumed by frontend Dashboard "Profil" card):

    {
      "version": 1,
      "generated_at": "2026-04-20T03:00:00Z",
      "days_analyzed": 14,
      "weekly": {
        "monday":    [{"hour_start": 9, "hour_end": 12,
                        "dominant_mode": "coding", "session_count": 8}, ...],
        ...
        "sunday":    []
      },
      "summary_tr": "Pazartesi 09-12 coding yoğun; ..."
    }

dominant_mode ∈ {coding, meeting, writing, learning, creative, gaming, break, null}
null = insufficient data (<3 logs in that block).

The job is idempotent and safe to re-run.  Runs once every 6 hours from the
scheduler; on first startup runs after a 60-second grace period so boot isn't
blocked.
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.mode_log import ModeLog
from app.models.setting import Setting

logger = logging.getLogger(__name__)

_scheduler_task: Optional[asyncio.Task] = None
_INTERVAL_SECONDS = 6 * 60 * 60  # 6 hours
_FIRST_RUN_DELAY_SECONDS = 60
_DAYS_ANALYZED = 14
_MIN_SESSIONS_PER_BLOCK = 3

# 3-hour blocks — 8 blocks per day.
_BLOCKS: list[tuple[int, int]] = [
    (0, 3), (3, 6), (6, 9), (9, 12),
    (12, 15), (15, 18), (18, 21), (21, 24),
]
_DOW_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
_DOW_TR = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"]

# Mode → TR label for summary_tr.  Keep in sync with frontend MODE labels.
_MODE_TR: dict[str, str] = {
    "coding": "kod yazma",
    "meeting": "toplantı",
    "writing": "yazma",
    "learning": "öğrenme",
    "creative": "yaratıcı iş",
    "gaming": "oyun",
    "break": "mola",
    "working": "çalışma",
    "reading": "okuma",
}


def _block_idx(hour: int) -> int:
    return min(hour // 3, 7)


def _overlap_seconds(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime) -> float:
    start = max(a_start, b_start)
    end = min(a_end, b_end)
    if end <= start:
        return 0.0
    return (end - start).total_seconds()


async def compute_weekly_patterns(session: AsyncSession) -> dict:
    """Compute the weekly pattern JSON from the last _DAYS_ANALYZED days of ModeLog."""
    now = datetime.utcnow()
    window_start = now - timedelta(days=_DAYS_ANALYZED)

    result = await session.execute(
        select(ModeLog)
        .where(ModeLog.started_at >= window_start)
        .order_by(ModeLog.started_at.asc())
    )
    logs = result.scalars().all()

    # (dow, block_idx, mode) -> total seconds
    duration_bucket: dict[tuple[int, int, str], float] = defaultdict(float)
    # (dow, block_idx) -> set of contributing log ids (for session_count)
    session_bucket: dict[tuple[int, int], set[int]] = defaultdict(set)

    for log in logs:
        if not log.mode:
            continue
        start = log.started_at
        end = log.ended_at or now
        if end <= start:
            continue

        # Walk hour-by-hour across the log, attributing each hour's duration to
        # the correct (dow, block). Simple and robust for logs that cross block
        # boundaries or day boundaries.
        cur = start.replace(minute=0, second=0, microsecond=0)
        while cur < end:
            next_hour = cur + timedelta(hours=1)
            seg_start = max(cur, start)
            seg_end = min(next_hour, end)
            seconds = (seg_end - seg_start).total_seconds()
            if seconds > 0:
                dow = cur.weekday()
                blk = _block_idx(cur.hour)
                duration_bucket[(dow, blk, log.mode)] += seconds
                session_bucket[(dow, blk)].add(log.id)
            cur = next_hour

    # Reduce to weekly structure
    weekly: dict[str, list[dict]] = {name: [] for name in _DOW_NAMES}
    # For summary_tr ranking: collect (confidence_seconds, dow, blk, mode)
    ranked: list[tuple[float, int, int, str]] = []

    for dow in range(7):
        for blk_idx, (h_start, h_end) in enumerate(_BLOCKS):
            session_count = len(session_bucket.get((dow, blk_idx), set()))
            if session_count < _MIN_SESSIONS_PER_BLOCK:
                dominant_mode: Optional[str] = None
                total_seconds = 0.0
            else:
                # Pick mode with max duration in this cell
                candidates = {
                    mode: secs for (d, b, mode), secs in duration_bucket.items()
                    if d == dow and b == blk_idx
                }
                if not candidates:
                    dominant_mode = None
                    total_seconds = 0.0
                else:
                    dominant_mode, total_seconds = max(candidates.items(), key=lambda kv: kv[1])

            weekly[_DOW_NAMES[dow]].append({
                "hour_start": h_start,
                "hour_end": h_end,
                "dominant_mode": dominant_mode,
                "session_count": session_count,
            })

            if dominant_mode and total_seconds > 0:
                ranked.append((total_seconds, dow, blk_idx, dominant_mode))

    # Build TR summary from top 3 (dow, blk) cells by duration
    ranked.sort(reverse=True)
    top = ranked[:3]
    parts: list[str] = []
    for _, dow, blk_idx, mode in top:
        h_start, h_end = _BLOCKS[blk_idx]
        label = _MODE_TR.get(mode, mode)
        parts.append(f"{_DOW_TR[dow]} {h_start:02d}-{h_end:02d} {label}")
    summary_tr = "; ".join(parts) if parts else ""

    return {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "days_analyzed": _DAYS_ANALYZED,
        "weekly": weekly,
        "summary_tr": summary_tr,
    }


async def _persist(session: AsyncSession, patterns: dict) -> None:
    payload = json.dumps(patterns, ensure_ascii=False)
    result = await session.execute(select(Setting).where(Setting.key == "user_profile_patterns"))
    row = result.scalar_one_or_none()
    if row:
        row.value = payload
    else:
        session.add(Setting(key="user_profile_patterns", value=payload))
    await session.commit()


async def run_once() -> None:
    """Compute patterns and write to settings. Safe to call any time."""
    try:
        async with AsyncSessionLocal() as session:
            patterns = await compute_weekly_patterns(session)
            await _persist(session, patterns)
        logger.info(f"[behavioral_patterns] Updated user_profile_patterns; summary={patterns['summary_tr'][:80]!r}")
    except Exception as exc:
        logger.error(f"[behavioral_patterns] run_once failed: {exc}")


async def _run_scheduler() -> None:
    await asyncio.sleep(_FIRST_RUN_DELAY_SECONDS)
    while True:
        await run_once()
        await asyncio.sleep(_INTERVAL_SECONDS)


def create_scheduler_task() -> asyncio.Task:
    global _scheduler_task
    _scheduler_task = asyncio.create_task(_run_scheduler())
    logger.info("[behavioral_patterns] Scheduler started (6h interval, first run in 60s)")
    return _scheduler_task


async def stop_scheduler() -> None:
    global _scheduler_task
    if _scheduler_task is not None:
        _scheduler_task.cancel()
        try:
            await _scheduler_task
        except (asyncio.CancelledError, Exception):
            pass
        _scheduler_task = None


async def get_cached_patterns(session: AsyncSession) -> Optional[dict]:
    """Read the current persisted patterns, or None if not computed yet."""
    result = await session.execute(select(Setting).where(Setting.key == "user_profile_patterns"))
    row = result.scalar_one_or_none()
    if not row or not row.value:
        return None
    try:
        return json.loads(row.value)
    except Exception:
        return None
