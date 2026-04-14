from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from datetime import datetime, timezone, timedelta

from app.database import get_session
from app.models.memory import ClipboardItem, BrainstormNote
from app.models.task import Task
from app.schemas.memory import (
    ClipboardItemCreate, ClipboardItemResponse,
    BrainstormNoteCreate, BrainstormNoteUpdate, BrainstormNoteResponse,
    PushNoteToTaskRequest,
)

router = APIRouter(prefix="/api/memory", tags=["memory"])


def _clip_to_dict(c: ClipboardItem) -> dict:
    return {
        "id": c.id,
        "content_type": c.content_type,
        "content": c.content,
        "content_hash": c.content_hash,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


def _note_to_dict(n: BrainstormNote) -> dict:
    return {
        "id": n.id,
        "content_type": n.content_type,
        "content": n.content,
        "title": n.title,
        "source_clipboard_id": n.source_clipboard_id,
        "created_at": n.created_at.isoformat() if n.created_at else None,
        "updated_at": n.updated_at.isoformat() if n.updated_at else None,
    }


# ───────── Clipboard items ─────────────────────────────────────────────────

@router.get("/clipboard", response_model=list[ClipboardItemResponse])
async def list_clipboard(limit: int = 200, session: AsyncSession = Depends(get_session)):
    q = select(ClipboardItem).order_by(desc(ClipboardItem.created_at)).limit(limit)
    result = await session.execute(q)
    return [_clip_to_dict(c) for c in result.scalars().all()]


@router.post("/clipboard", response_model=ClipboardItemResponse, status_code=201)
async def create_clipboard(body: ClipboardItemCreate, session: AsyncSession = Depends(get_session)):
    if body.content_type not in ("text", "image"):
        raise HTTPException(status_code=422, detail="content_type must be 'text' or 'image'")
    if not body.content:
        raise HTTPException(status_code=422, detail="content is required")

    # Dedupe window: if same hash was stored within last 10s, skip.
    if body.content_hash:
        cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=10)
        q = select(ClipboardItem).where(
            ClipboardItem.content_hash == body.content_hash,
            ClipboardItem.created_at >= cutoff,
        ).order_by(desc(ClipboardItem.created_at)).limit(1)
        existing = (await session.execute(q)).scalar_one_or_none()
        if existing:
            return _clip_to_dict(existing)

    item = ClipboardItem(
        content_type=body.content_type,
        content=body.content,
        content_hash=body.content_hash,
    )
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return _clip_to_dict(item)


@router.delete("/clipboard/{item_id}", status_code=204)
async def delete_clipboard(item_id: int, session: AsyncSession = Depends(get_session)):
    item = await session.get(ClipboardItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Clipboard item not found")
    await session.delete(item)
    await session.commit()


@router.delete("/clipboard", status_code=204)
async def clear_clipboard(session: AsyncSession = Depends(get_session)):
    await session.execute(ClipboardItem.__table__.delete())
    await session.commit()


# ───────── Brainstorm notes ────────────────────────────────────────────────

@router.get("/notes", response_model=list[BrainstormNoteResponse])
async def list_notes(session: AsyncSession = Depends(get_session)):
    q = select(BrainstormNote).order_by(desc(BrainstormNote.updated_at))
    result = await session.execute(q)
    return [_note_to_dict(n) for n in result.scalars().all()]


@router.post("/notes", response_model=BrainstormNoteResponse, status_code=201)
async def create_note(body: BrainstormNoteCreate, session: AsyncSession = Depends(get_session)):
    if body.content_type not in ("text", "image"):
        raise HTTPException(status_code=422, detail="content_type must be 'text' or 'image'")
    if not body.content:
        raise HTTPException(status_code=422, detail="content is required")
    note = BrainstormNote(
        content_type=body.content_type,
        content=body.content,
        title=body.title,
        source_clipboard_id=body.source_clipboard_id,
    )
    session.add(note)
    await session.commit()
    await session.refresh(note)
    return _note_to_dict(note)


@router.put("/notes/{note_id}", response_model=BrainstormNoteResponse)
async def update_note(note_id: int, body: BrainstormNoteUpdate, session: AsyncSession = Depends(get_session)):
    note = await session.get(BrainstormNote, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    if body.content_type is not None:
        if body.content_type not in ("text", "image"):
            raise HTTPException(status_code=422, detail="content_type must be 'text' or 'image'")
        note.content_type = body.content_type
    if body.content is not None:
        note.content = body.content
    if body.title is not None:
        note.title = body.title
    note.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await session.commit()
    await session.refresh(note)
    return _note_to_dict(note)


@router.delete("/notes/{note_id}", status_code=204)
async def delete_note(note_id: int, session: AsyncSession = Depends(get_session)):
    note = await session.get(BrainstormNote, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    await session.delete(note)
    await session.commit()


@router.post("/notes/{note_id}/push-to-task")
async def push_note_to_task(
    note_id: int, body: PushNoteToTaskRequest, session: AsyncSession = Depends(get_session),
):
    note = await session.get(BrainstormNote, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    task = await session.get(Task, body.task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # For image notes we push the data URL as-is; the task description is
    # plain text so the recipient app will see the raw data URL. Frontend
    # consumers can render it when they recognise the prefix.
    snippet = (note.title + "\n" + note.content) if note.title else note.content

    if body.append and task.description:
        task.description = f"{task.description}\n\n---\n{snippet}"
    else:
        task.description = snippet
    task.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await session.commit()
    await session.refresh(task)
    return {"success": True, "task_id": task.id}
