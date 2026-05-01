from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean
from datetime import datetime, timezone
from app.database import Base


class CrashReport(Base):
    __tablename__ = "crash_reports"

    id = Column(Integer, primary_key=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    app_version = Column(String(50), nullable=True)
    platform = Column(String(50), nullable=True)
    error_type = Column(String(200), nullable=True)
    message = Column(Text, nullable=True)
    stack = Column(Text, nullable=True)
    context_json = Column(Text, nullable=True)
    resolved = Column(Boolean, default=False, nullable=False)
    resolved_at = Column(DateTime, nullable=True)
