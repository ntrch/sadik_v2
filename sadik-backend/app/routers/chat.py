from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from datetime import datetime, timezone
from app.database import get_session
from app.models.chat_message import ChatMessage
from app.models.setting import Setting
from app.schemas.chat import ChatMessageCreate, ChatMessageResponse
from app.services.chat_service import chat_service

router = APIRouter(prefix="/api/chat", tags=["chat"])

async def get_settings_map(session: AsyncSession) -> dict:
    result = await session.execute(select(Setting))
    return {s.key: s.value for s in result.scalars().all()}

@router.post("/message")
async def send_message(body: ChatMessageCreate, session: AsyncSession = Depends(get_session)):
    settings = await get_settings_map(session)
    api_key = settings.get("openai_api_key", "")
    model = settings.get("llm_model", "gpt-4o-mini")
    user_name = settings.get("user_name", "")
    greeting_style = settings.get("greeting_style", "")

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    user_msg = ChatMessage(role="user", content=body.content, created_at=now)
    session.add(user_msg)
    await session.commit()
    await session.refresh(user_msg)

    result = await session.execute(
        select(ChatMessage).order_by(ChatMessage.created_at.asc()).limit(100)
    )
    history = [{"role": m.role, "content": m.content} for m in result.scalars().all()]
    history = history[:-1]  # exclude the user message we just added

    assistant_text = await chat_service.send_message(
        body.content, history, api_key, model, voice_mode=body.voice_mode,
        user_name=user_name, greeting_style=greeting_style,
    )

    now2 = datetime.now(timezone.utc).replace(tzinfo=None)
    assistant_msg = ChatMessage(role="assistant", content=assistant_text, created_at=now2)
    session.add(assistant_msg)
    await session.commit()
    await session.refresh(assistant_msg)

    return {
        "response": assistant_text,
        "message": {
            "id": assistant_msg.id,
            "role": assistant_msg.role,
            "content": assistant_msg.content,
            "created_at": assistant_msg.created_at.isoformat(),
        }
    }

@router.get("/history", response_model=list[ChatMessageResponse])
async def get_history(session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(ChatMessage).order_by(ChatMessage.created_at.asc()).limit(100)
    )
    return result.scalars().all()

@router.delete("/history", status_code=204)
async def clear_history(session: AsyncSession = Depends(get_session)):
    await session.execute(delete(ChatMessage))
    await session.commit()
