from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List

from app.database import get_session
from app.models.habit import Habit
from app.schemas.habit import HabitCreate, HabitUpdate, HabitResponse

router = APIRouter(prefix="/api/habits", tags=["habits"])


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
    )
    habit.set_days(body.days_of_week)
    session.add(habit)
    await session.commit()
    await session.refresh(habit)
    return HabitResponse.from_orm_habit(habit)


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
