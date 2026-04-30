from sqlalchemy import Column, Integer, String, Text, DateTime
from datetime import datetime, timezone
from app.database import Base


class FeedbackSubmission(Base):
    __tablename__ = "feedback_submissions"

    id = Column(Integer, primary_key=True)
    type = Column(String(20), nullable=False)  # bug | feature | other
    body = Column(Text, nullable=False)
    screenshot_base64 = Column(Text, nullable=True)  # PNG base64, opsiyonel
    app_version = Column(String(20), nullable=True)
    os_info = Column(String(100), nullable=True)
    current_page = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
