import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

logger = logging.getLogger(__name__)

_scheduler_task: Optional[asyncio.Task] = None


async def _get_setting(session, key: str, default: str = "") -> str:
    from sqlalchemy import select
    from app.models.setting import Setting
    result = await session.execute(select(Setting).where(Setting.key == key))
    s = result.scalar_one_or_none()
    return s.value if s else default


def _get_user_tz(tz_name: str):
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(tz_name)
    except Exception:
        logger.warning(f"[habits] Unknown timezone '{tz_name}', falling back to UTC")
        return timezone.utc


async def _get_today_snooze(session, habit_id: int, log_date: str, now_local: datetime):
    """Returns snoozed_until datetime if there's an active snooze log, else None."""
    from sqlalchemy import select
    from app.models.habit import HabitLog
    result = await session.execute(
        select(HabitLog)
        .where(
            HabitLog.habit_id == habit_id,
            HabitLog.log_date == log_date,
            HabitLog.status == "snoozed",
        )
        .order_by(HabitLog.id.desc())
        .limit(1)
    )
    log = result.scalar_one_or_none()
    if log and log.snoozed_until is not None:
        su = log.snoozed_until
        if su.tzinfo is None:
            try:
                from zoneinfo import ZoneInfo
                su = su.replace(tzinfo=now_local.tzinfo)
            except Exception:
                su = su.replace(tzinfo=timezone.utc)
        if now_local < su:
            return su
    return None


async def _run_scheduler():
    """Check all enabled habits every 30 seconds and fire reminders."""
    from app.database import AsyncSessionLocal
    from app.models.habit import Habit, HabitLog
    from app.services.ws_manager import ws_manager
    from sqlalchemy import select

    while True:
        try:
            async with AsyncSessionLocal() as session:
                # Read current timezone from settings (no cache — user may change it)
                tz_name = await _get_setting(session, "timezone", "UTC")
                user_tz = _get_user_tz(tz_name)
                now_local = datetime.now(user_tz)
                today_str = now_local.strftime("%Y-%m-%d")

                dnd_raw = await _get_setting(session, "dnd_active", "false")
                dnd_active = dnd_raw.lower() == "true"

                result = await session.execute(
                    select(Habit).where(Habit.enabled == True)
                )
                habits = result.scalars().all()

                logger.info(
                    f"[habits] tick tz={tz_name} now={now_local.strftime('%Y-%m-%d %H:%M:%S')} "
                    f"weekday={now_local.weekday()} dnd={dnd_active} habits={len(habits)}"
                )

                for habit in habits:
                    try:
                        freq = getattr(habit, "frequency_type", "daily")

                        if freq == "interval":
                            await _handle_interval_habit(
                                session, habit, now_local, today_str,
                                dnd_active, user_tz, ws_manager
                            )
                        else:
                            await _handle_daily_habit(
                                session, habit, now_local, today_str,
                                dnd_active, user_tz, ws_manager
                            )

                    except Exception as habit_err:
                        logger.error(f"[habits] Error processing habit id={habit.id}: {habit_err}")

        except asyncio.CancelledError:
            logger.info("[habits] Scheduler cancelled")
            raise
        except Exception as e:
            logger.error(f"[habits] Scheduler tick error: {e}")

        await asyncio.sleep(30)


async def _handle_daily_habit(session, habit, now_local, today_str, dnd_active, user_tz, ws_manager):
    """Original daily habit scheduler logic."""
    days = habit.get_days()
    if now_local.weekday() not in days:
        logger.info(f"[habits] skip '{habit.name}' — weekday {now_local.weekday()} not in {days}")
        return

    # Parse HH:MM → compute trigger time (habit.time - minutes_before)
    hh, mm = map(int, habit.time.split(":"))
    scheduled_dt = now_local.replace(hour=hh, minute=mm, second=0, microsecond=0)
    trigger_dt = scheduled_dt - timedelta(minutes=habit.minutes_before)

    delta = (now_local - trigger_dt).total_seconds()
    logger.info(
        f"[habits] check '{habit.name}' time={habit.time} before={habit.minutes_before}m "
        f"trigger={trigger_dt.strftime('%H:%M:%S')} delta={delta:+.0f}s"
    )
    if abs(delta) > 30:
        return

    # Already triggered today?
    if habit.last_triggered_at is not None:
        last = habit.last_triggered_at
        if last.tzinfo is None:
            last = last.replace(tzinfo=user_tz)
        if last.date() == now_local.date():
            return

    # DND check — update last_triggered_at regardless to prevent retry loop
    habit.last_triggered_at = now_local.replace(tzinfo=None)
    await session.commit()

    if habit.respect_dnd and dnd_active:
        logger.info(f"[habits] Skipping '{habit.name}' (DND active)")
        return

    await ws_manager.broadcast({
        "type": "habit_reminder",
        "data": {
            "habit_id": habit.id,
            "name": habit.name,
            "description": habit.description,
            "minutes_before": habit.minutes_before,
            "scheduled_time": habit.time,
            "frequency_type": "daily",
            "interval_minutes": None,
            "silent": False,
        },
    })
    logger.info(f"[habits] Fired daily reminder for '{habit.name}'")


async def _handle_interval_habit(session, habit, now_local, today_str, dnd_active, user_tz, ws_manager):
    """Interval habit: broadcast every interval_minutes, respecting snooze/skip."""
    im = getattr(habit, "interval_minutes", None) or 30

    # Check snooze
    snooze_until = await _get_today_snooze(session, habit.id, today_str, now_local)
    if snooze_until is not None:
        logger.info(f"[habits] interval '{habit.name}' snoozed until {snooze_until}")
        return

    last = habit.last_triggered_at
    if last is not None:
        if last.tzinfo is None:
            last = last.replace(tzinfo=user_tz)
        elapsed_min = (now_local - last).total_seconds() / 60
        if elapsed_min < im:
            return

    # DND check
    habit.last_triggered_at = now_local.replace(tzinfo=None)
    await session.commit()

    if habit.respect_dnd and dnd_active:
        logger.info(f"[habits] Skipping interval '{habit.name}' (DND active)")
        return

    await ws_manager.broadcast({
        "type": "habit_reminder",
        "data": {
            "habit_id": habit.id,
            "name": habit.name,
            "description": habit.description,
            "minutes_before": 0,
            "scheduled_time": None,
            "frequency_type": "interval",
            "interval_minutes": im,
            "silent": True,
        },
    })
    logger.info(f"[habits] Fired interval reminder for '{habit.name}' (every {im} min)")


async def start_scheduler():
    global _scheduler_task
    logger.info("[habits] Starting habit scheduler")
    await _run_scheduler()


def create_scheduler_task() -> asyncio.Task:
    global _scheduler_task
    _scheduler_task = asyncio.create_task(start_scheduler())
    return _scheduler_task


async def stop_scheduler():
    global _scheduler_task
    if _scheduler_task and not _scheduler_task.done():
        _scheduler_task.cancel()
        try:
            await _scheduler_task
        except asyncio.CancelledError:
            pass
    _scheduler_task = None
    logger.info("[habits] Scheduler stopped")
