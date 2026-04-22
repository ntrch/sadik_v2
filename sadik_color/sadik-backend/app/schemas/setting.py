from pydantic import BaseModel
from typing import Dict

class SettingsUpdate(BaseModel):
    model_config = {"extra": "allow"}
