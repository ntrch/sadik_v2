import asyncio
import json
import logging
import os
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.setting import Setting
from app.services.wake_word_service import detector, DEFAULT_THRESHOLD, DEFAULT_INPUT_GAIN, _diag_buffer

_MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "wake_models")

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/wake", tags=["wake"])


class SelectModelBody(BaseModel):
    path: str  # relative path like "wake_models/sah_duck.onnx", or "" for built-in fallback


class DetectionSettingsBody(BaseModel):
    wake_threshold: float | None = None   # 0.1 – 0.9
    wake_input_gain: float | None = None  # 1.0 – 3.0


@router.get("/models")
async def list_models(session: AsyncSession = Depends(get_session)):
    """List available .onnx wake models in the backend `wake_models/` folder."""
    entries = []
    try:
        for name in sorted(os.listdir(_MODELS_DIR)):
            if name.lower().endswith(".onnx"):
                rel = f"wake_models/{name}"
                entries.append({"name": name, "path": rel})
    except FileNotFoundError:
        pass
    # Current selection
    result = await session.execute(select(Setting).where(Setting.key == "wake_model_path"))
    row = result.scalar_one_or_none()
    current = row.value if row else ""
    return {"models": entries, "current": current}


@router.post("/select")
async def select_model(body: SelectModelBody, session: AsyncSession = Depends(get_session)):
    """Persist wake_model_path and hot-reload the detector.
    Empty path falls back to built-in `hey_jarvis`."""
    rel = body.path.strip()
    abs_path = ""
    if rel:
        abs_path = rel if os.path.isabs(rel) else os.path.join(
            os.path.dirname(os.path.dirname(__file__)), rel
        )
        if not os.path.isfile(abs_path):
            raise HTTPException(status_code=404, detail=f"Model not found: {rel}")

    # Save
    result = await session.execute(select(Setting).where(Setting.key == "wake_model_path"))
    s = result.scalar_one_or_none()
    if s:
        s.value = rel
    else:
        session.add(Setting(key="wake_model_path", value=rel))
    await session.commit()

    # Hot-reload: stop listening, reload model, (WS reconnect will restart listen)
    was_listening = detector._thread is not None and detector._thread.is_alive()
    if was_listening:
        detector.stop_listening()
    try:
        await asyncio.get_event_loop().run_in_executor(None, detector.load, abs_path or None)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Model reload failed: {e}")
    return {"ok": True, "path": rel, "score_key": getattr(detector, "_score_key", None)}


@router.put("/settings")
async def update_detection_settings(
    body: DetectionSettingsBody,
    session: AsyncSession = Depends(get_session),
):
    """Hot-reload wake threshold and/or input gain without restarting the backend."""
    updated = {}
    if body.wake_threshold is not None:
        val = max(0.05, min(0.95, body.wake_threshold))
        detector.set_threshold(val)
        # Persist
        result = await session.execute(select(Setting).where(Setting.key == "wake_threshold"))
        s = result.scalar_one_or_none()
        if s:
            s.value = str(val)
        else:
            session.add(Setting(key="wake_threshold", value=str(val)))
        updated["wake_threshold"] = val

    if body.wake_input_gain is not None:
        val = max(1.0, min(5.0, body.wake_input_gain))
        detector.set_input_gain(val)
        # Persist
        result = await session.execute(select(Setting).where(Setting.key == "wake_input_gain"))
        s = result.scalar_one_or_none()
        if s:
            s.value = str(val)
        else:
            session.add(Setting(key="wake_input_gain", value=str(val)))
        updated["wake_input_gain"] = val

    await session.commit()
    return {"ok": True, "updated": updated}


@router.get("/diagnostic")
async def wake_diagnostic():
    """Return RMS + score statistics for the last 100 inference frames.

    Use this to distinguish:
    - RMS ~0 → audio not reaching the model (mic / sounddevice issue)
    - RMS OK but score low → model sensitivity issue (lower threshold or increase gain)
    - RMS OK and score OK but no trigger → threshold still too high
    """
    frames = list(_diag_buffer)
    if not frames:
        return {
            "frames_collected": 0,
            "note": "Henüz frame yok — wake-word servisi çalışıyor mu?",
        }
    rms_vals   = [f[0] for f in frames]
    score_vals = [f[1] for f in frames]
    return {
        "frames_collected": len(frames),
        "rms":   {"min": min(rms_vals),   "max": max(rms_vals),   "mean": sum(rms_vals)   / len(rms_vals)},
        "score": {"min": min(score_vals), "max": max(score_vals), "mean": sum(score_vals) / len(score_vals)},
        "current_threshold":  detector._threshold,
        "current_input_gain": detector._input_gain,
        "hint": (
            "RMS < 0.005 → ses yok (mikrofon sorunu). "
            "RMS OK ama score < 0.15 → gain artır veya daha yüksek sesle söyle. "
            "Score > threshold değilse threshold düşür."
        ),
    }


@router.websocket("/ws")
async def wake_ws(websocket: WebSocket, session: AsyncSession = Depends(get_session)):
    await websocket.accept()
    logger.info("[WakeWord] WS bağlandı — backend mikrofonu başlatılıyor")

    # Load persisted threshold / gain on every WS connect so settings survive restarts.
    try:
        result = await session.execute(select(Setting).where(Setting.key == "wake_threshold"))
        row = result.scalar_one_or_none()
        detector.set_threshold(float(row.value) if row else DEFAULT_THRESHOLD)

        result = await session.execute(select(Setting).where(Setting.key == "wake_input_gain"))
        row = result.scalar_one_or_none()
        detector.set_input_gain(float(row.value) if row else DEFAULT_INPUT_GAIN)
    except Exception as e:
        logger.warning("[WakeWord] Ayar yüklenemedi: %s — varsayılanlar kullanılıyor", e)

    loop = asyncio.get_event_loop()

    async def on_wake():
        try:
            logger.info("[WakeWord] Wake kelimesi algılandı!")
            await websocket.send_text(json.dumps({"type": "wake"}))
        except Exception:
            pass  # WS kapanmışsa sessizce geç

    detector.start_listening(lambda: asyncio.run_coroutine_threadsafe(on_wake(), loop), loop)

    try:
        # Tek yönlü push: client'tan veri beklenmez, bağlantı açık kalsın diye bekliyoruz.
        while True:
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=30)
            except asyncio.TimeoutError:
                pass  # keepalive — döngü devam eder
    except WebSocketDisconnect:
        logger.info("[WakeWord] WS bağlantısı kapandı")
    except Exception as e:
        logger.error("[WakeWord] WS hatası: %s", e)
    finally:
        detector.stop_listening()
