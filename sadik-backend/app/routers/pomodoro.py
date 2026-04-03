from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_session
from app.models.task import Task
from app.models.setting import Setting
from app.schemas.pomodoro import PomodoroStart, PomodoroStateResponse
from app.services.pomodoro_service import pomodoro_service
from sqlalchemy import select
from datetime import datetime, timezone

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
