from sqlalchemy import Integer, String, Text, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from datetime import datetime


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    color: Mapped[str] = mapped_column(String, nullable=False, default="#fb923c")
    icon: Mapped[str] = mapped_column(String, nullable=False, default="Rocket")
    # Optional mode key to activate when the workspace is run
    mode_sync: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())


class WorkspaceAction(Base):
    __tablename__ = "workspace_actions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 'launch_app' | 'open_url' | 'system_setting' | 'window_snap'
    type: Mapped[str] = mapped_column(String, nullable=False)
    # JSON-encoded payload dict
    payload: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
