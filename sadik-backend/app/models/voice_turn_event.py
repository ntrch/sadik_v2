from sqlalchemy import Column, Integer, String, Float, DateTime, Text
from datetime import datetime, timezone
from app.database import Base


class VoiceTurnEvent(Base):
    __tablename__ = "voice_turn_events"
    id = Column(Integer, primary_key=True)
    started_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    # Latency breakdown (ms)
    stt_ms = Column(Integer, nullable=True)
    llm_ms = Column(Integer, nullable=True)   # TTFB, not full completion
    total_ms = Column(Integer, nullable=True)  # end-to-end
    # Token usage
    prompt_tokens = Column(Integer, nullable=True)
    completion_tokens = Column(Integer, nullable=True)
    # Tool call summary
    tool_names = Column(Text, nullable=True)  # comma-separated
    tool_count = Column(Integer, default=0)
    # Audio durations
    user_audio_seconds = Column(Float, nullable=True)
    # Provider info
    stt_provider = Column(String(20), default="whisper-1")
    llm_model = Column(String(40), default="gpt-4o-mini")
