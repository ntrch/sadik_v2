import os
import sys
from pydantic_settings import BaseSettings
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _default_db_path() -> str:
    """Resolve SQLite DB path. Frozen (PyInstaller) → user data dir; dev → repo root."""
    if getattr(sys, "frozen", False):
        if sys.platform == "win32":
            base = os.environ.get("APPDATA", os.path.expanduser("~"))
        else:
            base = os.path.expanduser("~")
        data_dir = os.path.join(base, "sadik")
        os.makedirs(data_dir, exist_ok=True)
        return f"sqlite+aiosqlite:///{data_dir}/sadik.db"
    return f"sqlite+aiosqlite:///{BASE_DIR}/sadik.db"


class Settings(BaseSettings):
    database_url: str = _default_db_path()
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

    # Stripe billing — all optional; billing endpoints return 503 when key is empty.
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_price_id: str = ""  # Monthly Pro plan price ID (e.g. price_...)
    stripe_success_url: str = "http://localhost:8000/api/billing/checkout-complete"
    stripe_cancel_url: str = "http://localhost:8000/api/billing/checkout-cancel"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

settings = Settings()
