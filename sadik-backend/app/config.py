from pydantic_settings import BaseSettings
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

class Settings(BaseSettings):
    database_url: str = f"sqlite+aiosqlite:///{BASE_DIR}/sadik.db"
    host: str = "0.0.0.0"
    port: int = 8000

    google_client_id: str = (
        "61778071617-gj3h4rp6bpdp6lq8cc3o9rqfehuo0k17.apps.googleusercontent.com"
    )

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

settings = Settings()
