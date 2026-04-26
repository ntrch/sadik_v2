"""PyInstaller entry point — runs uvicorn programmatically.

Frozen onedir bundle: sys.frozen=True, sys._MEIPASS points to the extracted
bundle root. We push it onto sys.path so `app.*` imports resolve.
"""
import os
import sys


if __name__ == "__main__":
    if getattr(sys, "frozen", False):
        bundle_dir = sys._MEIPASS
        if bundle_dir not in sys.path:
            sys.path.insert(0, bundle_dir)

    import uvicorn

    port = int(os.environ.get("SADIK_BACKEND_PORT", "8000"))
    host = os.environ.get("SADIK_BACKEND_HOST", "127.0.0.1")

    uvicorn.run("app.main:app", host=host, port=port, log_level="info")
