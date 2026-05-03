from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional
from datetime import datetime, timedelta, timezone

from app.database import get_session
from app.models.habit import Habit, HabitLog
from app.schemas.habit import (
    HabitCreate, HabitUpdate, HabitResponse,
    HabitLogCreate, HabitLogResponse, HabitDueResponse,
)

router = APIRouter(prefix="/api/habits", tags=["habits"])


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _get_user_tz(session: AsyncSession):
    from sqlalchemy import select as sa_select
    from app.models.setting import Setting
    from zoneinfo import ZoneInfo
    result = await session.execute(sa_select(Setting).where(Setting.key == "timezone"))
    s = result.scalar_one_or_none()
    tz_name = s.value if s else "UTC"
    try:
        return ZoneInfo(tz_name)
    except Exception:
        return timezone.utc


def _today_str(user_tz) -> str:
    return datetime.now(user_tz).strftime("%Y-%m-%d")


async def _get_today_log(session: AsyncSession, habit_id: int, log_date: str) -> Optional[HabitLog]:
    result = await session.execute(
        select(HabitLog)
        .where(HabitLog.habit_id == habit_id, HabitLog.log_date == log_date)
        .order_by(HabitLog.id.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


# ── CRUD ───────────────────────────────────────────────────────────────────────

@router.get("", response_model=List[HabitResponse])
async def list_habits(session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(Habit).order_by(Habit.id))
    habits = result.scalars().all()
    return [HabitResponse.from_orm_habit(h) for h in habits]


@router.post("", response_model=HabitResponse, status_code=201)
async def create_habit(body: HabitCreate, session: AsyncSession = Depends(get_session)):
    habit = Habit(
        name=body.name,
        description=body.description,
        time=body.time,
        minutes_before=body.minutes_before,
        enabled=body.enabled,
        respect_dnd=body.respect_dnd,
        color=body.color,
        icon=body.icon,
        target_days=body.target_days,
        frequency_type=body.frequency_type,
        interval_minutes=body.interval_minutes,
    )
    habit.set_days(body.days_of_week)
    session.add(habit)
    await session.commit()
    await session.refresh(habit)
    return HabitResponse.from_orm_habit(habit)


@router.get("/due", response_model=List[HabitDueResponse])
async def get_due_habits(session: AsyncSession = Depends(get_session)):
    """Return all enabled habits with due status for today."""
    user_tz = await _get_user_tz(session)
    now_local = datetime.now(user_tz)
    today = _today_str(user_tz)

    result = await session.execute(select(Habit).where(Habit.enabled == True).order_by(Habit.id))
    habits = result.scalars().all()

    out: List[HabitDueResponse] = []
    for habit in habits:
        # Get latest log for today
        log = await _get_today_log(session, habit.id, today)
        today_status = log.status if log else None

        is_due_now = False
        next_trigger_at: Optional[datetime] = None

        if habit.frequency_type == "interval":
            im = habit.interval_minutes or 30
            last = habit.last_triggered_at
            if last is not None and last.tzinfo is None:
                last = last.replace(tzinfo=user_tz)
            # Check snooze
            snoozed = log and log.status == "snoozed" and log.snoozed_until is not None
            snoozed_until = None
            if snoozed and log.snoozed_until is not None:
                snoozed_until = log.snoozed_until
                if snoozed_until.tzinfo is None:
                    snoozed_until = snoozed_until.replace(tzinfo=user_tz)
            if snoozed and snoozed_until and now_local < snoozed_until:
                next_trigger_at = snoozed_until
            elif last is None:
                is_due_now = True
            else:
                elapsed = (now_local - last).total_seconds() / 60
                if elapsed >= im:
                    is_due_now = True
                else:
                    next_trigger_at = last + timedelta(minutes=im)
        else:
            # daily
            days = habit.get_days()
            if now_local.weekday() in days:
                log_done = log and log.status == "done"
                snoozed = log and log.status == "snoozed" and log.snoozed_until is not None
                snoozed_active = False
                if snoozed and log.snoozed_until is not None:
                    su = log.snoozed_until
                    if su.tzinfo is None:
                        su = su.replace(tzinfo=user_tz)
                    if now_local < su:
                        snoozed_active = True
                        next_trigger_at = su
                if not log_done and not snoozed_active:
                    is_due_now = True

        out.append(HabitDueResponse(
            habit=HabitResponse.from_orm_habit(habit),
            is_due_now=is_due_now,
            next_trigger_at=next_trigger_at,
            today_status=today_status,
        ))

    return out


@router.get("/logs", response_model=List[HabitLogResponse])
async def get_logs(
    from_date: str = Query(..., alias="from"),
    to_date: str   = Query(..., alias="to"),
    session: AsyncSession = Depends(get_session),
):
    """Return all habit logs in the given date range (YYYY-MM-DD)."""
    result = await session.execute(
        select(HabitLog)
        .where(HabitLog.log_date >= from_date, HabitLog.log_date <= to_date)
        .order_by(HabitLog.habit_id, HabitLog.log_date)
    )
    return result.scalars().all()


@router.get("/{habit_id}", response_model=HabitResponse)
async def get_habit(habit_id: int, session: AsyncSession = Depends(get_session)):
    habit = await session.get(Habit, habit_id)
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")
    return HabitResponse.from_orm_habit(habit)


@router.patch("/{habit_id}", response_model=HabitResponse)
async def update_habit(habit_id: int, body: HabitUpdate, session: AsyncSession = Depends(get_session)):
    habit = await session.get(Habit, habit_id)
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")

    if body.name is not None:
        habit.name = body.name
    if body.description is not None:
        habit.description = body.description
    if body.days_of_week is not None:
        habit.set_days(body.days_of_week)
    if body.time is not None:
        habit.time = body.time
    if body.minutes_before is not None:
        habit.minutes_before = body.minutes_before
    if body.enabled is not None:
        habit.enabled = body.enabled
    if body.respect_dnd is not None:
        habit.respect_dnd = body.respect_dnd
    if body.color is not None:
        habit.color = body.color
    if body.icon is not None:
        habit.icon = body.icon
    if body.target_days is not None:
        habit.target_days = body.target_days
    if body.frequency_type is not None:
        habit.frequency_type = body.frequency_type
    if body.interval_minutes is not None:
        habit.interval_minutes = body.interval_minutes

    await session.commit()
    await session.refresh(habit)
    return HabitResponse.from_orm_habit(habit)


@router.delete("/{habit_id}")
async def delete_habit(habit_id: int, session: AsyncSession = Depends(get_session)):
    habit = await session.get(Habit, habit_id)
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")
    await session.delete(habit)
    await session.commit()
    return {"ok": True}


# ── Log + action endpoints ─────────────────────────────────────────────────────

@router.post("/{habit_id}/log", response_model=HabitLogResponse)
async def log_habit(
    habit_id: int,
    body: HabitLogCreate,
    session: AsyncSession = Depends(get_session),
):
    """Log a habit action (done/skipped/snoozed)."""
    habit = await session.get(Habit, habit_id)
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")

    user_tz = await _get_user_tz(session)
    now_local = datetime.now(user_tz)
    log_date = body.log_date or _today_str(user_tz)
    now_naive = now_local.replace(tzinfo=None)

    if habit.frequency_type == "daily":
        # Upsert: one row per day for daily habits
        existing = await _get_today_log(session, habit_id, log_date)
        if existing:
            existing.status = body.status
            existing.completed_at = now_naive if body.status == "done" else None
            existing.snoozed_until = body.snoozed_until
            log_entry = existing
        else:
            log_entry = HabitLog(
                habit_id=habit_id,
                log_date=log_date,
                status=body.status,
                completed_at=now_naive if body.status == "done" else None,
                snoozed_until=body.snoozed_until,
            )
            session.add(log_entry)
        # On done, update last_triggered_at to today
        if body.status == "done":
            habit.last_triggered_at = now_naive
        # On skip: set last_triggered_at to 1 hour from now so scheduler waits
        if body.status == "skipped":
            habit.last_triggered_at = (now_local + timedelta(hours=1)).replace(tzinfo=None)
    else:
        # Interval: always new row (count completions)
        log_entry = HabitLog(
            habit_id=habit_id,
            log_date=log_date,
            status=body.status,
            completed_at=now_naive if body.status == "done" else None,
            snoozed_until=body.snoozed_until,
        )
        session.add(log_entry)
        if body.status == "done":
            habit.last_triggered_at = now_naive

    await session.commit()
    await session.refresh(log_entry)
    return log_entry


@router.patch("/{habit_id}/snooze", response_model=HabitLogResponse)
async def snooze_habit(
    habit_id: int,
    body: dict,
    session: AsyncSession = Depends(get_session),
):
    """Snooze a habit for N minutes. Creates or updates today's snooze log."""
    minutes = int(body.get("minutes", 30))
    if minutes not in (15, 30, 60, 120):
        raise HTTPException(status_code=422, detail="minutes must be one of 15, 30, 60, 120")

    habit = await session.get(Habit, habit_id)
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")

    user_tz = await _get_user_tz(session)
    now_local = datetime.now(user_tz)
    now_naive = now_local.replace(tzinfo=None)
    snoozed_until = (now_local + timedelta(minutes=minutes)).replace(tzinfo=None)
    today = _today_str(user_tz)

    existing = await _get_today_log(session, habit_id, today)
    if existing and existing.status == "snoozed":
        existing.snoozed_until = snoozed_until
        log_entry = existing
    else:
        log_entry = HabitLog(
            habit_id=habit_id,
            log_date=today,
            status="snoozed",
            snoozed_until=snoozed_until,
        )
        session.add(log_entry)

    # Update last_triggered_at so scheduler doesn't re-broadcast before snooze expires
    habit.last_triggered_at = now_naive

    await session.commit()
    await session.refresh(log_entry)
    return log_entry
