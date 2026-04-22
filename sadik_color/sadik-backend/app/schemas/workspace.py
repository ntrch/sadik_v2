from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Any


class WorkspaceActionSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    order_index: int
    type: str
    payload: dict


class WorkspaceSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    color: str
    icon: str
    mode_sync: Optional[str] = None
    actions: List[WorkspaceActionSchema] = []
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class WorkspaceActionCreate(BaseModel):
    order_index: int = 0
    type: str
    payload: dict = {}


class WorkspaceCreate(BaseModel):
    name: str
    color: str = "#fb923c"
    icon: str = "Rocket"
    mode_sync: Optional[str] = None
    actions: List[WorkspaceActionCreate] = []


class WorkspaceUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    mode_sync: Optional[str] = None
    actions: Optional[List[WorkspaceActionCreate]] = None
