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

    # Static import: gives PyInstaller a real edge in the import graph so the
    # `app` package is collected. Without this, `uvicorn.run("app.main:app")`
    # is just a string and `app.*` ends up missing from the bundle.
    import app.main as _app_main  # noqa: F401

    import uvicorn

    port = int(os.environ.get("SADIK_BACKEND_PORT", "8000"))
    host = os.environ.get("SADIK_BACKEND_HOST", "127.0.0.1")

    uvicorn.run(_app_main.app, host=host, port=port, log_level="info")
