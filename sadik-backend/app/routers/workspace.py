import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_session
from app.models.workspace import Workspace, WorkspaceAction
from app.schemas.workspace import (
    WorkspaceSchema, WorkspaceCreate, WorkspaceUpdate,
)

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])


def _action_to_dict(a: WorkspaceAction) -> dict:
    try:
        payload = json.loads(a.payload) if a.payload else {}
    except Exception:
        payload = {}
    return {
        "id": a.id,
        "order_index": a.order_index,
        "type": a.type,
        "payload": payload,
    }


async def _load_actions(session: AsyncSession, workspace_id: int) -> list:
    q = select(WorkspaceAction).where(
        WorkspaceAction.workspace_id == workspace_id
    ).order_by(WorkspaceAction.order_index)
    result = await session.execute(q)
    return [_action_to_dict(a) for a in result.scalars().all()]


def _workspace_to_dict(w: Workspace, actions: list) -> dict:
    return {
        "id": w.id,
        "name": w.name,
        "color": w.color,
        "icon": w.icon,
        "mode_sync": w.mode_sync,
        "actions": actions,
        "created_at": w.created_at.isoformat() if w.created_at else None,
        "updated_at": w.updated_at.isoformat() if w.updated_at else None,
    }


@router.get("", response_model=list[WorkspaceSchema])
async def list_workspaces(session: AsyncSession = Depends(get_session)):
    q = select(Workspace).order_by(Workspace.created_at)
    result = await session.execute(q)
    workspaces = result.scalars().all()
    out = []
    for w in workspaces:
        actions = await _load_actions(session, w.id)
        out.append(_workspace_to_dict(w, actions))
    return out


@router.post("", response_model=WorkspaceSchema, status_code=201)
async def create_workspace(body: WorkspaceCreate, session: AsyncSession = Depends(get_session)):
    w = Workspace(
        name=body.name,
        color=body.color,
        icon=body.icon,
        mode_sync=body.mode_sync,
    )
    session.add(w)
    await session.flush()  # get the id

    for act in body.actions:
        session.add(WorkspaceAction(
            workspace_id=w.id,
            order_index=act.order_index,
            type=act.type,
            payload=json.dumps(act.payload),
        ))

    await session.commit()
    await session.refresh(w)
    actions = await _load_actions(session, w.id)
    print(f"[workspace-create] id={w.id} name={w.name} actions_count={len(actions)} types={[a['type'] for a in actions]}")
    return _workspace_to_dict(w, actions)


@router.get("/{workspace_id}", response_model=WorkspaceSchema)
async def get_workspace(workspace_id: int, session: AsyncSession = Depends(get_session)):
    w = await session.get(Workspace, workspace_id)
    if not w:
        raise HTTPException(status_code=404, detail="Workspace not found")
    actions = await _load_actions(session, w.id)
    return _workspace_to_dict(w, actions)


@router.patch("/{workspace_id}", response_model=WorkspaceSchema)
async def update_workspace(
    workspace_id: int,
    body: WorkspaceUpdate,
    session: AsyncSession = Depends(get_session),
):
    w = await session.get(Workspace, workspace_id)
    if not w:
        raise HTTPException(status_code=404, detail="Workspace not found")

    if body.name is not None:
        w.name = body.name
    if body.color is not None:
        w.color = body.color
    if body.icon is not None:
        w.icon = body.icon
    if body.mode_sync is not None:
        w.mode_sync = body.mode_sync
    else:
        # Allow explicit null-clear: if key present but None, clear it
        if "mode_sync" in (body.model_fields_set or set()):
            w.mode_sync = None

    w.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)

    if body.actions is not None:
        # Replace all actions for this workspace
        await session.execute(
            WorkspaceAction.__table__.delete().where(
                WorkspaceAction.workspace_id == workspace_id
            )
        )
        for act in body.actions:
            session.add(WorkspaceAction(
                workspace_id=w.id,
                order_index=act.order_index,
                type=act.type,
                payload=json.dumps(act.payload),
            ))

    await session.commit()
    await session.refresh(w)
    actions = await _load_actions(session, w.id)
    return _workspace_to_dict(w, actions)


@router.delete("/{workspace_id}", status_code=204)
async def delete_workspace(workspace_id: int, session: AsyncSession = Depends(get_session)):
    w = await session.get(Workspace, workspace_id)
    if not w:
        raise HTTPException(status_code=404, detail="Workspace not found")
    await session.execute(
        WorkspaceAction.__table__.delete().where(
            WorkspaceAction.workspace_id == workspace_id
        )
    )
    await session.delete(w)
    await session.commit()
