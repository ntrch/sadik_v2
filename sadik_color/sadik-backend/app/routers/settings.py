from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from app.database import get_session
from app.models.setting import Setting

router = APIRouter(prefix="/api/settings", tags=["settings"])


class TimezoneBody(BaseModel):
    timezone: str

@router.get("")
async def get_all_settings(session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(Setting))
    return {s.key: s.value for s in result.scalars().all()}

@router.put("")
async def update_settings(body: dict, session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(Setting))
    existing = {s.key: s for s in result.scalars().all()}
    for key, value in body.items():
        if key in existing:
            existing[key].value = str(value)
        else:
            session.add(Setting(key=key, value=str(value)))
    await session.commit()
    result2 = await session.execute(select(Setting))
    return {s.key: s.value for s in result2.scalars().all()}

@router.get("/{key}")
async def get_setting(key: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(Setting).where(Setting.key == key))
    s = result.scalar_one_or_none()
    if not s:
        raise HTTPException(status_code=404, detail=f"Setting '{key}' not found")
    return {"key": s.key, "value": s.value}


@router.post("/timezone")
async def set_timezone(body: TimezoneBody, session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(Setting).where(Setting.key == "timezone"))
    s = result.scalar_one_or_none()
    if s:
        s.value = body.timezone
    else:
        session.add(Setting(key="timezone", value=body.timezone))
    await session.commit()
    return {"ok": True}
