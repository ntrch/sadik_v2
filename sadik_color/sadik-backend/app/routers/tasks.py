from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone
from app.database import get_session
from app.models.task import Task
from app.schemas.task import TaskCreate, TaskUpdate, TaskStatusUpdate, TaskResponse, ALLOWED_STATUSES
from app.services.ws_manager import ws_manager

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

def task_to_dict(task: Task) -> dict:
    return {
        "id": task.id,
        "title": task.title,
        "description": task.description,
        "notes": task.notes,
        "status": task.status,
        "priority": task.priority,
        "created_at": (task.created_at.isoformat() + 'Z') if task.created_at else None,
        "updated_at": (task.updated_at.isoformat() + 'Z') if task.updated_at else None,
        "due_date": task.due_date.isoformat() if task.due_date else None,
        "pomodoro_count": task.pomodoro_count,
        "notion_page_id": task.notion_page_id,
        "icon": task.icon,
        "icon_image": task.icon_image,
    }

@router.get("", response_model=list[TaskResponse])
async def list_tasks(status: str = None, session: AsyncSession = Depends(get_session)):
    q = select(Task)
    if status:
        q = q.where(Task.status == status)
    result = await session.execute(q.order_by(Task.created_at.desc()))
    return result.scalars().all()

@router.post("", response_model=TaskResponse, status_code=201)
async def create_task(body: TaskCreate, session: AsyncSession = Depends(get_session)):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    task = Task(
        title=body.title,
        description=body.description,
        notes=body.notes,
        due_date=body.due_date,
        priority=body.priority,
        status="todo",
        created_at=now,
        updated_at=now,
        icon=body.icon,
        icon_image=body.icon_image,
    )
    session.add(task)
    await session.commit()
    await session.refresh(task)
    await ws_manager.broadcast({"type": "task_updated", "data": task_to_dict(task)})
    return task

@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(task_id: int, session: AsyncSession = Depends(get_session)):
    task = await session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task

@router.put("/{task_id}", response_model=TaskResponse)
async def update_task(task_id: int, body: TaskUpdate, session: AsyncSession = Depends(get_session)):
    task = await session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if body.title is not None:
        task.title = body.title
    if body.description is not None:
        task.description = body.description
    if body.notes is not None:
        task.notes = body.notes
    # Use model_fields_set so we can distinguish "field omitted" from
    # "field explicitly set to null" — the latter should clear the column.
    if "due_date" in body.model_fields_set:
        task.due_date = body.due_date
    if body.priority is not None:
        task.priority = body.priority
    if body.status is not None:
        if body.status not in ALLOWED_STATUSES:
            raise HTTPException(status_code=422, detail=f"Invalid status. Allowed: {ALLOWED_STATUSES}")
        task.status = body.status
    # icon and icon_image support explicit null (to clear) or a value
    if "icon" in body.model_fields_set:
        task.icon = body.icon
    if "icon_image" in body.model_fields_set:
        task.icon_image = body.icon_image
    task.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await session.commit()
    await session.refresh(task)
    await ws_manager.broadcast({"type": "task_updated", "data": task_to_dict(task)})
    return task

@router.delete("/{task_id}", status_code=204)
async def delete_task(task_id: int, session: AsyncSession = Depends(get_session)):
    task = await session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await session.delete(task)
    await session.commit()

@router.patch("/{task_id}/status", response_model=TaskResponse)
async def update_task_status(task_id: int, body: TaskStatusUpdate, session: AsyncSession = Depends(get_session)):
    if body.status not in ALLOWED_STATUSES:
        raise HTTPException(status_code=422, detail=f"Invalid status. Allowed: {ALLOWED_STATUSES}")
    task = await session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task.status = body.status
    task.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await session.commit()
    await session.refresh(task)
    await ws_manager.broadcast({"type": "task_updated", "data": task_to_dict(task)})
    return task
