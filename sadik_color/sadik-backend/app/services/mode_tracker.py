import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
from sqlalchemy import select, and_
from app.database import AsyncSessionLocal
from app.models.mode_log import ModeLog

logger = logging.getLogger(__name__)

class ModeTracker:
    async def get_current(self) -> Optional[ModeLog]:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(ModeLog).where(ModeLog.ended_at.is_(None)).order_by(ModeLog.started_at.desc()).limit(1)
            )
            return result.scalar_one_or_none()

    async def set_mode(self, mode: str) -> ModeLog:
        async with AsyncSessionLocal() as session:
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            result = await session.execute(
                select(ModeLog).where(ModeLog.ended_at.is_(None))
            )
            active = result.scalars().all()
            for entry in active:
                entry.ended_at = now
                entry.duration_seconds = int((now - entry.started_at).total_seconds())
            new_log = ModeLog(mode=mode, started_at=now)
            session.add(new_log)
            await session.commit()
            await session.refresh(new_log)
            return new_log

    async def end_current(self):
        async with AsyncSessionLocal() as session:
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            result = await session.execute(
                select(ModeLog).where(ModeLog.ended_at.is_(None))
            )
            active = result.scalars().all()
            for entry in active:
                entry.ended_at = now
                entry.duration_seconds = int((now - entry.started_at).total_seconds())
            await session.commit()

    async def get_daily_stats(self, date: datetime) -> list[dict]:
        async with AsyncSessionLocal() as session:
            day_start = datetime(date.year, date.month, date.day, 0, 0, 0)
            day_end = day_start + timedelta(days=1)
            result = await session.execute(
                select(ModeLog).where(
                    and_(
                        ModeLog.started_at < day_end,
                        (ModeLog.ended_at > day_start) | ModeLog.ended_at.is_(None)
                    )
                )
            )
            logs = result.scalars().all()
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            totals: dict[str, int] = {}
            for log in logs:
                start = max(log.started_at, day_start)
                end = min(log.ended_at if log.ended_at else now, day_end)
                secs = int((end - start).total_seconds())
                if secs > 0:
                    totals[log.mode] = totals.get(log.mode, 0) + secs
            return [{"mode": m, "total_seconds": s} for m, s in totals.items()]

    async def get_range_stats(self, days: int) -> list[dict]:
        result = []
        today = datetime.now(timezone.utc).replace(tzinfo=None)
        for i in range(days - 1, -1, -1):
            day = today - timedelta(days=i)
            daily = await self.get_daily_stats(day)
            result.append({"date": day.strftime("%Y-%m-%d"), "modes": daily})
        return result

mode_tracker = ModeTracker()
