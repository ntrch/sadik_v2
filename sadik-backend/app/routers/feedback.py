import base64
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException

from app.config import settings
from app.schemas.feedback import FeedbackSubmit, FeedbackResponse

router = APIRouter(prefix="/api/feedback", tags=["feedback"])
logger = logging.getLogger(__name__)

_TYPE_COLORS = {
    "bug": 0xEF4444,
    "suggestion": 0x3B82F6,
    "feature": 0x3B82F6,
    "praise": 0x10B981,
}
_DEFAULT_COLOR = 0x6B7280


def _build_embed(body: FeedbackSubmit) -> dict:
    description = body.body[:4000]
    fields = []
    if body.app_version:
        fields.append({"name": "App Version", "value": body.app_version, "inline": True})
    if body.os_info:
        fields.append({"name": "OS Info", "value": body.os_info, "inline": True})
    if body.current_page:
        fields.append({"name": "Current Page", "value": body.current_page, "inline": True})

    return {
        "title": f"Feedback: {body.type}",
        "description": description,
        "color": _TYPE_COLORS.get(body.type, _DEFAULT_COLOR),
        "fields": fields,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.post("", response_model=FeedbackResponse)
async def submit_feedback(body: FeedbackSubmit) -> FeedbackResponse:
    webhook_url = settings.discord_feedback_webhook
    if not webhook_url:
        logger.error("DISCORD_FEEDBACK_WEBHOOK is not configured")
        raise HTTPException(status_code=503, detail="Feedback servisi yapılandırılmamış")

    embed = _build_embed(body)
    payload_json = {"embeds": [embed]}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            if body.screenshot_base64:
                image_bytes = base64.b64decode(body.screenshot_base64)
                response = await client.post(
                    webhook_url,
                    data={"payload_json": __import__("json").dumps(payload_json)},
                    files={"files[0]": ("screenshot.png", image_bytes, "image/png")},
                )
            else:
                response = await client.post(webhook_url, json=payload_json)

        if response.is_success:
            logger.info("Feedback forwarded to Discord: type=%s", body.type)
            return FeedbackResponse(id=0, ok=True)

        logger.error("Discord webhook returned %s: %s", response.status_code, response.text)
        raise HTTPException(status_code=503, detail="Feedback gönderilemedi")

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Discord webhook error: %s", exc)
        raise HTTPException(status_code=503, detail="Feedback gönderilemedi")
