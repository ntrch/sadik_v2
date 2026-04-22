import logging
from fastapi import APIRouter, Query, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel
from datetime import datetime, timezone, date, time as dt_time, timedelta
from typing import Optional
from app.database import get_session
from app.models.app_usage_session import AppUsageSession
from app.services.mode_tracker import mode_tracker
from app.services.behavioral_insight import (
    evaluate_behavioral_insight,
    mark_behavioral_insight_fired,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/stats", tags=["stats"])

# ── Mode stats (existing) ─────────────────────────────────────────────────────

@router.get("/daily")
async def get_daily_stats(date: str = None):
    if date:
        try:
            day = datetime.strptime(date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid date format. Use YYYY-MM-DD")
    else:
        day = datetime.now(timezone.utc).replace(tzinfo=None)
    return await mode_tracker.get_daily_stats(day)

@router.get("/range")
async def get_range_stats(days: int = Query(default=7)):
    if days not in (7, 14, 30):
        raise HTTPException(status_code=422, detail="days must be 7, 14, or 30")
    return await mode_tracker.get_range_stats(days)

# ── App usage — schema ────────────────────────────────────────────────────────

class AppUsageSessionCreate(BaseModel):
    app_name:         str
    window_title:     str = ""
    started_at:       datetime
    ended_at:         datetime
    duration_seconds: int

# ── App usage — ingestion ─────────────────────────────────────────────────────

@router.post("/app-usage", status_code=201)
async def log_app_usage(
    body: AppUsageSessionCreate,
    session: AsyncSession = Depends(get_session),
):
    """Record one focused-application session sent by the Electron tracker."""
    if body.duration_seconds < 1:
        raise HTTPException(status_code=422, detail="duration_seconds must be >= 1")

    app_name_clean = body.app_name.strip().replace('.root', '').replace('.exe', '').replace('.app', '') or "Unknown"
    logger.info(
        "App usage session received: app=%s duration=%ds started=%s",
        app_name_clean,
        body.duration_seconds,
        body.started_at.isoformat(),
    )
    # Normalize to naive LOCAL time so aggregations roll over at local midnight.
    # Electron sends ISO strings with UTC offset (toISOString → "...Z"); Pydantic
    # parses them as tz-aware. .astimezone() without args converts to system local.
    def _to_local_naive(dt: datetime) -> datetime:
        if dt.tzinfo is not None:
            return dt.astimezone().replace(tzinfo=None)
        return dt
    entry = AppUsageSession(
        app_name=         app_name_clean,
        window_title=     body.window_title or None,
        started_at=       _to_local_naive(body.started_at),
        ended_at=         _to_local_naive(body.ended_at),
        duration_seconds= body.duration_seconds,
        created_at=       datetime.now().replace(microsecond=0),
    )
    session.add(entry)
    await session.commit()
    logger.info("App usage session persisted to DB: app=%s", app_name_clean)
    return {"ok": True}

# ── App usage — daily summary ─────────────────────────────────────────────────

@router.get("/app-usage/daily")
async def get_app_usage_daily(
    date: str = None,
    session: AsyncSession = Depends(get_session),
):
    """Return today's app usage grouped by app_name, sorted by total duration desc."""
    if date:
        try:
            target_date = datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid date format. Use YYYY-MM-DD")
    else:
        # Use LOCAL date — sessions are stored as naive-local, so aggregations
        # must roll over at local midnight, not UTC midnight.
        target_date = datetime.now().date()

    day_start = datetime.combine(target_date, dt_time.min)
    day_end   = datetime.combine(target_date, dt_time.max)

    result = await session.execute(
        select(
            AppUsageSession.app_name,
            func.sum(AppUsageSession.duration_seconds).label("duration_seconds"),
        )
        .where(AppUsageSession.started_at >= day_start)
        .where(AppUsageSession.started_at <= day_end)
        .group_by(AppUsageSession.app_name)
        .order_by(func.sum(AppUsageSession.duration_seconds).desc())
    )
    return [
        {"app_name": row.app_name, "duration_seconds": int(row.duration_seconds)}
        for row in result
    ]

# ── App usage — 7-day range summary ──────────────────────────────────────────

@router.get("/app-usage/range")
async def get_app_usage_range(
    days: int = Query(default=7, ge=1, le=90),
    session: AsyncSession = Depends(get_session),
):
    """
    Aggregate app usage sessions over the last N days (default 7).

    Returns:
      - top_apps:     total duration per app across the range, sorted desc (up to 10)
      - daily_totals: sum of tracked seconds per calendar day, every day filled in
                      (0 for days with no recorded sessions)
    """
    today       = datetime.now().date()
    range_start = datetime.combine(today - timedelta(days=days - 1), dt_time.min)
    range_end   = datetime.combine(today, dt_time.max)

    # ── Top apps across the full range ────────────────────────────────────────
    top_result = await session.execute(
        select(
            AppUsageSession.app_name,
            func.sum(AppUsageSession.duration_seconds).label("duration_seconds"),
        )
        .where(AppUsageSession.started_at >= range_start)
        .where(AppUsageSession.started_at <= range_end)
        .group_by(AppUsageSession.app_name)
        .order_by(func.sum(AppUsageSession.duration_seconds).desc())
        .limit(10)
    )
    top_apps = [
        {"app_name": row.app_name, "duration_seconds": int(row.duration_seconds)}
        for row in top_result
    ]

    # ── Daily totals — one row per calendar day ───────────────────────────────
    # func.date() extracts the date string ("YYYY-MM-DD") from a DateTime in SQLite.
    daily_result = await session.execute(
        select(
            func.date(AppUsageSession.started_at).label("day"),
            func.sum(AppUsageSession.duration_seconds).label("duration_seconds"),
        )
        .where(AppUsageSession.started_at >= range_start)
        .where(AppUsageSession.started_at <= range_end)
        .group_by(func.date(AppUsageSession.started_at))
        .order_by(func.date(AppUsageSession.started_at).asc())
    )
    # Map date strings to their totals, then fill all days (including zeros)
    daily_map: dict[str, int] = {
        row.day: int(row.duration_seconds) for row in daily_result
    }
    daily_totals = [
        {
            "date":             (today - timedelta(days=days - 1 - i)).isoformat(),
            "duration_seconds": daily_map.get(
                (today - timedelta(days=days - 1 - i)).isoformat(), 0
            ),
        }
        for i in range(days)
    ]

    return {"days": days, "top_apps": top_apps, "daily_totals": daily_totals}


# ── App usage — proactive insights ───────────────────────────────────────────
#
# Rule A: same app has >= 3 600 s (60 min) today  → level "gentle"
# Rule B: same app has >= 7 200 s (120 min) today → level "strong"
#
# The endpoint is deterministic, local-only, and calls no external services.

def _format_duration_tr(total_seconds: int) -> str:
    """Return a human-readable Turkish duration string ending with -dır suffix."""
    h = total_seconds // 3600
    m = (total_seconds % 3600) // 60
    if h > 0 and m >= 5:
        return f"yaklaşık {h} saat {m} dakikadır"
    if h > 0:
        return f"yaklaşık {h} saattir"
    return f"yaklaşık {m} dakikadır"

@router.get("/app-usage/insights")
async def get_app_usage_insights(
    session: AsyncSession = Depends(get_session),
):
    """
    Return ALL apps exceeding usage thresholds for today, plus a behavioral
    insight (source='behavioral') when the privacy flag is on and conditions
    hold.  Each item has app_name, level, message. Returns {has_insight: false,
    insights: []} when no threshold is reached.
    """
    today     = datetime.now().date()
    day_start = datetime.combine(today, dt_time.min)
    day_end   = datetime.combine(today, dt_time.max)

    # Aggregate today's usage per app — all of them
    result = await session.execute(
        select(
            AppUsageSession.app_name,
            func.sum(AppUsageSession.duration_seconds).label("duration_seconds"),
        )
        .where(AppUsageSession.started_at >= day_start)
        .where(AppUsageSession.started_at <= day_end)
        .group_by(AppUsageSession.app_name)
        .order_by(func.sum(AppUsageSession.duration_seconds).desc())
    )

    insights = []
    for row in result:
        total_seconds = int(row.duration_seconds)
        app_name      = row.app_name
        duration_str  = _format_duration_tr(total_seconds)

        if total_seconds >= 7200:
            insights.append({
                "app_name": app_name,
                "level":    "strong",
                "message":  f"{duration_str} {app_name} kullanıyorsun. Uzun bir mola zamanı geldi.",
            })
        elif total_seconds >= 3600:
            insights.append({
                "app_name": app_name,
                "level":    "gentle",
                "message":  f"{duration_str} {app_name} kullanıyorsun. Kısa bir mola iyi gelebilir.",
            })

    # ── Behavioral insight category (T3.3) ───────────────────────────────────
    # Evaluated alongside app-usage; fires only when privacy_behavioral_learning
    # is True, the user is off-pattern, and an open task exists.  Anti-spam:
    # 24 h cooldown persisted in Setting "proactive_behavioral_last_fired_at".
    behavioral: Optional[dict] = None
    try:
        behavioral = await evaluate_behavioral_insight(session)
        if behavioral:
            # Mark delivered so anti-spam 24 h window starts now.
            await mark_behavioral_insight_fired(session)
    except Exception as exc:
        logger.warning("[stats] behavioral_insight evaluation failed: %s", exc)

    if not insights and not behavioral:
        return {"has_insight": False, "insights": []}

    if insights:
        # App-usage path — backward compat: top-level fields from the first app.
        top = insights[0]
        response: dict = {
            "has_insight": True,
            "app_name":    top["app_name"],
            "level":       top["level"],
            "message":     top["message"],
            "source":      "app_usage",
            "insights":    insights,
        }
        # Attach behavioral as secondary insight if present
        if behavioral:
            response["behavioral"] = behavioral
        return response

    # Behavioral-only path — no app-usage threshold reached.
    assert behavioral is not None
    return behavioral
