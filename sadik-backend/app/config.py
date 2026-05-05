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

    # Google Desktop+PKCE OAuth — env'den okunur, packaged build'de build-time inject.
    google_client_id: str = ""
    google_client_secret: str = ""

    # Notion OAuth — env'den okunur, packaged build'de build-time inject.
    notion_client_id: str = ""
    notion_client_secret: str = ""

    # Stripe billing — all optional; billing endpoints return 503 when key is empty.
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_price_id: str = ""  # Monthly Pro plan price ID (e.g. price_...)
    stripe_success_url: str = "http://localhost:8000/api/billing/checkout-complete"
    stripe_cancel_url: str = "http://localhost:8000/api/billing/checkout-cancel"

    # Telegram Bot for user feedback forwarding — set in .env.
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

settings = Settings()
