from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_session
from app.models.task import Task
from app.models.setting import Setting
from app.schemas.pomodoro import PomodoroStart, PomodoroStateResponse
from app.services.pomodoro_service import pomodoro_service
from sqlalchemy import select
from datetime import datetime, timezone
from typing import Optional
from pydantic import BaseModel

class StartBreakBody(BaseModel):
    minutes: Optional[int] = None

router = APIRouter(prefix="/api/pomodoro", tags=["pomodoro"])

async def get_setting_value(session: AsyncSession, key: str, default: str = None) -> str:
    result = await session.execute(select(Setting).where(Setting.key == key))
    s = result.scalar_one_or_none()
    return s.value if s else default

@router.get("/state", response_model=PomodoroStateResponse)
async def get_state():
    return pomodoro_service.get_state()

@router.post("/start")
async def start_pomodoro(body: PomodoroStart, session: AsyncSession = Depends(get_session)):
    work_minutes = body.work_minutes
    break_minutes = body.break_minutes
    if not work_minutes:
        val = await get_setting_value(session, "pomodoro_work_minutes", "25")
        work_minutes = int(val)
    if not break_minutes:
        val = await get_setting_value(session, "pomodoro_break_minutes", "5")
        break_minutes = int(val)
    long_break_val = await get_setting_value(session, "pomodoro_long_break_minutes", "15")
    sessions_val = await get_setting_value(session, "pomodoro_sessions_before_long_break", "4")
    pomodoro_service.long_break_minutes = int(long_break_val)
    pomodoro_service.sessions_before_long_break = int(sessions_val)
    await pomodoro_service.start(task_id=body.task_id, work_minutes=work_minutes, break_minutes=break_minutes)
    return pomodoro_service.get_state()

@router.post("/pause")
async def pause_pomodoro():
    await pomodoro_service.pause()
    return pomodoro_service.get_state()

@router.post("/resume")
async def resume_pomodoro():
    await pomodoro_service.resume()
    return pomodoro_service.get_state()

@router.post("/stop")
async def stop_pomodoro(session: AsyncSession = Depends(get_session)):
    task_id = await pomodoro_service.stop()
    if task_id:
        task = await session.get(Task, task_id)
        if task:
            task.pomodoro_count += 1
            task.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
            await session.commit()
    return {"stopped": True}


@router.post("/start-break")
async def start_break(body: StartBreakBody = StartBreakBody(), session: AsyncSession = Depends(get_session)):
    """Transition a running work cycle to break, or start a standalone break if idle.

    Called by the proactive suggestion accept flow.  If pomodoro is already in a
    work phase the current task is preserved.  If idle, a standalone break is started.
    Optional `minutes` overrides the configured break duration (used for intensity-based breaks:
    gentle → 5 min, strong → 15 min).
    """
    if pomodoro_service.is_running and pomodoro_service.phase == "work":
        # Cancel the current work task and jump straight to break
        if pomodoro_service._task and not pomodoro_service._task.done():
            pomodoro_service._task.cancel()
        pomodoro_service.standalone_break = False
        await pomodoro_service._start_break_phase(override_minutes=body.minutes)
    else:
        # Idle — start a standalone break without a work phase
        if body.minutes is not None:
            break_minutes = body.minutes
        else:
            val = await get_setting_value(session, "pomodoro_break_minutes", "5")
            break_minutes = int(val)
        if pomodoro_service._task and not pomodoro_service._task.done():
            pomodoro_service._task.cancel()
        pomodoro_service.phase = "break"
        pomodoro_service.total_seconds = break_minutes * 60
        pomodoro_service.remaining_seconds = pomodoro_service.total_seconds
        pomodoro_service.is_running = True
        pomodoro_service.is_paused = False
        pomodoro_service.standalone_break = True
        import asyncio
        pomodoro_service._task = asyncio.create_task(pomodoro_service._run())
    return pomodoro_service.get_state()
