from pydantic_settings import BaseSettings
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

class Settings(BaseSettings):
    database_url: str = f"sqlite+aiosqlite:///{BASE_DIR}/sadik.db"
    host: str = "0.0.0.0"
    port: int = 8000

    # Desktop OAuth client credentials — loaded from .env (gitignored).
    # Google's Desktop+PKCE flow embeds these in the distributed app binary;
    # they are not user-secret. See .env.example for the expected variables.
    google_client_id: str = ""
    google_client_secret: str = ""

    # Notion OAuth public integration credentials.
    # NOTE: Notion does NOT support PKCE — auth code flow with Basic Auth
    # (client_id:client_secret) on token exchange. Token does not expire
    # unless user revokes. Env-overridable: NOTION_CLIENT_ID / NOTION_CLIENT_SECRET.
    notion_client_id: str = ""
    notion_client_secret: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

settings = Settings()
