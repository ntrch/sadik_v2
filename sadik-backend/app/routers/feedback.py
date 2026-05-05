import base64
import logging
from html import escape

import httpx
from fastapi import APIRouter, HTTPException

from app.config import settings
from app.schemas.feedback import FeedbackSubmit, FeedbackResponse

router = APIRouter(prefix="/api/feedback", tags=["feedback"])
logger = logging.getLogger(__name__)


def _build_message(body: FeedbackSubmit) -> str:
    lines = [f"<b>Feedback: {body.type}</b>", ""]
    lines.append(escape(body.body))
    lines.append("")
    if body.app_version:
        lines.append(f"<b>App Version:</b> {escape(body.app_version)}")
    if body.os_info:
        lines.append(f"<b>OS:</b> {escape(body.os_info)}")
    if body.current_page:
        lines.append(f"<b>Page:</b> {escape(body.current_page)}")
    return "\n".join(lines)


@router.post("", response_model=FeedbackResponse)
async def submit_feedback(body: FeedbackSubmit) -> FeedbackResponse:
    bot_token = settings.telegram_bot_token
    chat_id = settings.telegram_chat_id
    if not bot_token or not chat_id:
        logger.error("TELEGRAM_BOT_TOKEN/CHAT_ID is not configured")
        raise HTTPException(status_code=503, detail="Feedback servisi yapılandırılmamış")

    message_html = _build_message(body)
    base_url = f"https://api.telegram.org/bot{bot_token}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            if body.screenshot_base64:
                # Telegram caption max 1024 chars
                caption = message_html[:1024]
                image_bytes = base64.b64decode(body.screenshot_base64)
                response = await client.post(
                    f"{base_url}/sendPhoto",
                    data={"chat_id": chat_id, "caption": caption, "parse_mode": "HTML"},
                    files={"photo": ("screenshot.png", image_bytes, "image/png")},
                )
            else:
                response = await client.post(
                    f"{base_url}/sendMessage",
                    json={"chat_id": chat_id, "text": message_html, "parse_mode": "HTML"},
                )

        if response.is_success:
            logger.info("Feedback forwarded to Telegram: type=%s", body.type)
            return FeedbackResponse(id=0, ok=True)

        logger.error("Telegram API returned %s: %s", response.status_code, response.text)
        raise HTTPException(status_code=503, detail="Feedback gönderilemedi")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Telegram API error: %s", exc)
        raise HTTPException(status_code=503, detail="Feedback gönderilemedi")
