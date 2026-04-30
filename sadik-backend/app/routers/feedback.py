import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.feedback import FeedbackSubmission
from app.schemas.feedback import FeedbackSubmit, FeedbackResponse

router = APIRouter(prefix="/api/feedback", tags=["feedback"])
logger = logging.getLogger(__name__)


@router.post("", response_model=FeedbackResponse)
async def submit_feedback(
    body: FeedbackSubmit,
    session: AsyncSession = Depends(get_session),
) -> FeedbackResponse:
    submission = FeedbackSubmission(
        type=body.type,
        body=body.body,
        screenshot_base64=body.screenshot_base64,
        app_version=body.app_version,
        os_info=body.os_info,
        current_page=body.current_page,
    )
    session.add(submission)
    await session.commit()
    await session.refresh(submission)
    logger.info("Feedback received: type=%s id=%s", submission.type, submission.id)
    return FeedbackResponse(id=submission.id, ok=True)
