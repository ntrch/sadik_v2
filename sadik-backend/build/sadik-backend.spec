# -*- mode: python ; coding: utf-8 -*-
# PyInstaller onedir spec for SADIK backend.
# Build:  cd sadik-backend && pyinstaller build/sadik-backend.spec --noconfirm --clean
# Output: sadik-backend/dist/sadik-backend/sadik-backend(.exe)
import os
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

SPEC_DIR = os.path.dirname(os.path.abspath(SPEC))
PROJECT_ROOT = os.path.normpath(os.path.join(SPEC_DIR, ".."))

# Runtime data files
datas = []
datas += collect_data_files("openwakeword")
datas += collect_data_files("onnxruntime")
datas += collect_data_files("sounddevice")

custom_models = os.path.join(PROJECT_ROOT, "app", "wake_models")
if os.path.isdir(custom_models):
    datas.append((custom_models, "app/wake_models"))

hiddenimports = [
    # SQLAlchemy async sqlite
    "aiosqlite",
    "sqlalchemy.dialects.sqlite",
    "sqlalchemy.dialects.sqlite.aiosqlite",
    "sqlalchemy.ext.asyncio",
    # uvicorn auto-discovered modules
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.protocols.websockets.wsproto_impl",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
    # pydantic optional
    "email_validator",
    # Voice / wake-word stack
    "openwakeword",
    "openwakeword.model",
    "openwakeword.utils",
    "openwakeword.vad",
    "openwakeword.custom_verifier_model",
    "onnxruntime",
    "onnxruntime.capi",
    "onnxruntime.capi._pybind_state",
    "numpy",
    "sounddevice",
    # Serial / device
    "serial",
    "serial.tools",
    "serial.tools.list_ports",
    # HTTP/TTS
    "httpx",
    "httpx._transports.default",
    "edge_tts",
    "edge_tts.communicate",
    "websockets",
    "websockets.legacy",
    "websockets.legacy.server",
    # Multipart upload
    "multipart",
    "python_multipart",
    "tzdata",
    # SADIK lazy-loaded service modules (deferred imports in lifespan)
    "app.services.wake_word_service",
    "app.services.habits_service",
    "app.services.integration_service",
    "app.services.behavioral_patterns",
    "app.services.behavioral_insight",
    "app.services.pomodoro_service",
    "app.services.device_manager",
    "app.services.mode_tracker",
    "app.services.providers.google_calendar",
    "app.services.providers.google_meet",
    "app.services.providers.notion",
    "app.services.chat_service",
    "app.services.voice_tools",
    "app.services.privacy_flags",
    "app.services.redaction",
]

hiddenimports += collect_submodules("uvicorn")
hiddenimports += collect_submodules("fastapi")
hiddenimports += collect_submodules("sqlalchemy")
hiddenimports += collect_submodules("openwakeword")
# SADIK app package — uvicorn loads it via string ("app.main:app"); without
# this the import graph misses every router/service module.
hiddenimports += collect_submodules("app")

block_cipher = None

a = Analysis(
    [os.path.join(PROJECT_ROOT, "launch.py")],
    pathex=[PROJECT_ROOT],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tkinter", "matplotlib", "PIL", "PyQt5", "wx",
        "IPython", "jupyter", "notebook",
        "tflite_runtime", "tensorflow", "torch",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="sadik-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,           # UPX corrupts onnxruntime DLLs
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="sadik-backend",
)
