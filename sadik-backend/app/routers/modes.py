from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_session
from app.models.mode_log import ModeLog
from app.schemas.mode import ModeSet, ModeLogResponse, CurrentModeResponse
from app.services.mode_tracker import mode_tracker
from app.services.ws_manager import ws_manager

router = APIRouter(prefix="/api/modes", tags=["modes"])

@router.get("/current", response_model=CurrentModeResponse)
async def get_current_mode():
    current = await mode_tracker.get_current()
    if current:
        return {"mode": current.mode, "started_at": current.started_at}
    return {"mode": None}

@router.post("", response_model=ModeLogResponse, status_code=201)
async def set_mode(body: ModeSet, session: AsyncSession = Depends(get_session)):
    new_log = await mode_tracker.set_mode(body.mode)
    await ws_manager.broadcast({
        "type": "mode_changed",
        "data": {"mode": new_log.mode, "started_at": new_log.started_at.isoformat()}
    })
    return new_log

@router.get("/history", response_model=list[ModeLogResponse])
async def get_mode_history(session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(ModeLog).order_by(ModeLog.started_at.desc()).limit(50)
    )
    return result.scalars().all()
