"""telemetry.py — Crash telemetry ingest + admin panel endpoints.

Public endpoints (no auth):
  POST /api/telemetry/crash          — ingest a crash report
  GET  /api/settings/telemetry-consent — read consent flag
  POST /api/settings/telemetry-consent — update consent flag

Admin endpoints (gated by SADIK_ADMIN_EMAIL env var or is_admin setting):
  GET  /api/admin/telemetry              — list crashes + feedback, merged
  POST /api/admin/telemetry/{kind}/{id}/resolve — toggle resolved flag
"""
import json
import logging
import os
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.crash_report import CrashReport
from app.models.feedback import FeedbackSubmission
from app.models.setting import Setting
from app.services.telemetry_redactor import redact_crash

router = APIRouter(tags=["telemetry"])
logger = logging.getLogger(__name__)

# ── In-memory rate limiter (10 req/min per IP) ────────────────────────────────
# {ip: [timestamp, ...]}  — timestamps are epoch seconds as float
_rate_limit_store: dict[str, list[float]] = defaultdict(list)
_RATE_LIMIT_WINDOW = 60.0   # seconds
_RATE_LIMIT_MAX    = 10


def _check_rate_limit(ip: str) -> bool:
    """Return True if request is allowed, False if over limit."""
    now = time.monotonic()
    window_start = now - _RATE_LIMIT_WINDOW
    timestamps = [t for t in _rate_limit_store[ip] if t > window_start]
    if len(timestamps) >= _RATE_LIMIT_MAX:
        return False
    timestamps.append(now)
    _rate_limit_store[ip] = timestamps
    return True


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_setting(session: AsyncSession, key: str) -> str | None:
    result = await session.execute(select(Setting).where(Setting.key == key))
    row = result.scalar_one_or_none()
    return row.value if row else None


async def _set_setting(session: AsyncSession, key: str, value: str) -> None:
    result = await session.execute(select(Setting).where(Setting.key == key))
    row = result.scalar_one_or_none()
    if row:
        row.value = value
    else:
        session.add(Setting(key=key, value=value))
    await session.commit()


async def _require_admin(session: AsyncSession) -> None:
    """Raise 403 unless the current installation has admin access.

    Admin gate: SADIK_ADMIN_EMAIL env var set, OR is_admin setting = 'true'.
    We don't have per-request user auth (local app), so this is a best-effort
    gate to avoid accidental exposure.
    """
    env_email = os.environ.get("SADIK_ADMIN_EMAIL", "").strip()
    if env_email:
        return  # env var present → admin allowed

    is_admin = await _get_setting(session, "is_admin")
    if is_admin == "true":
        return

    raise HTTPException(status_code=403, detail="Admin access required")


# ── Schemas ───────────────────────────────────────────────────────────────────

class CrashReportBody(BaseModel):
    app_version: Optional[str] = None
    platform:    Optional[str] = None
    error_type:  Optional[str] = None
    message:     Optional[str] = None
    stack:       Optional[str] = None
    context:     Optional[dict] = None


class TelemetryConsentBody(BaseModel):
    enabled: bool


class ResolveBody(BaseModel):
    resolved: bool


# ── Public endpoints ──────────────────────────────────────────────────────────

@router.post("/api/telemetry/crash")
async def ingest_crash(
    body: CrashReportBody,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """Ingest a crash report. Auth-free. Silently drops if consent is off."""
    # Rate limit by client IP
    client_ip = request.client.host if request.client else "unknown"
    if not _check_rate_limit(client_ip):
        # Return 200 silently — don't reveal rate-limit to avoid log noise
        return {"ok": True}

    # Server-side consent double-check
    consent = await _get_setting(session, "telemetry_consent")
    if consent != "true":
        return {"ok": True}  # silent drop

    # Serialize context dict to JSON string for storage
    context_json: str | None = None
    if body.context is not None:
        try:
            context_json = json.dumps(body.context, ensure_ascii=False)
        except (TypeError, ValueError):
            context_json = str(body.context)

    # Redact before persist
    clean_message, clean_stack, clean_context = redact_crash(
        body.message, body.stack, context_json
    )

    report = CrashReport(
        app_version=body.app_version,
        platform=body.platform,
        error_type=body.error_type,
        message=clean_message,
        stack=clean_stack,
        context_json=clean_context,
    )
    session.add(report)
    await session.commit()
    await session.refresh(report)
    logger.info("Crash report stored: id=%s type=%s", report.id, report.error_type)
    return {"ok": True, "id": report.id}


@router.get("/api/settings/telemetry-consent")
async def get_telemetry_consent(session: AsyncSession = Depends(get_session)):
    consent = await _get_setting(session, "telemetry_consent")
    enabled = consent == "true"
    return {"enabled": enabled}


@router.post("/api/settings/telemetry-consent")
async def set_telemetry_consent(
    body: TelemetryConsentBody,
    session: AsyncSession = Depends(get_session),
):
    value = "true" if body.enabled else "false"
    await _set_setting(session, "telemetry_consent", value)
    return {"enabled": body.enabled}


# ── Admin endpoints ───────────────────────────────────────────────────────────

@router.get("/api/admin/telemetry")
async def admin_list_telemetry(
    kind:     str = "all",       # crash | feedback | all
    resolved: str = "all",       # true | false | all
    limit:    int = 20,
    offset:   int = 0,
    session:  AsyncSession = Depends(get_session),
):
    await _require_admin(session)

    items = []

    if kind in ("crash", "all"):
        q = select(CrashReport).order_by(CrashReport.created_at.desc())
        result = await session.execute(q)
        crashes = result.scalars().all()
        for c in crashes:
            items.append({
                "kind":       "crash",
                "id":         c.id,
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "app_version": c.app_version,
                "platform":   c.platform,
                "error_type": c.error_type,
                "message":    (c.message or "")[:200],
                "stack":      c.stack,
                "context_json": c.context_json,
                "resolved":   c.resolved,
                "resolved_at": c.resolved_at.isoformat() if c.resolved_at else None,
            })

    if kind in ("feedback", "all"):
        q = select(FeedbackSubmission).order_by(FeedbackSubmission.created_at.desc())
        result = await session.execute(q)
        feedbacks = result.scalars().all()
        for f in feedbacks:
            # FeedbackSubmission has no resolved column — treat as unresolved
            items.append({
                "kind":       "feedback",
                "id":         f.id,
                "created_at": f.created_at.isoformat() if f.created_at else None,
                "app_version": f.app_version,
                "platform":   f.os_info,
                "error_type": f.type,
                "message":    (f.body or "")[:200],
                "stack":      None,
                "context_json": json.dumps({
                    "current_page": f.current_page,
                    "has_screenshot": bool(f.screenshot_base64),
                }, ensure_ascii=False),
                "resolved":   False,
                "resolved_at": None,
            })

    # Sort merged list by created_at desc
    items.sort(key=lambda x: x["created_at"] or "", reverse=True)

    # Filter by resolved
    if resolved == "true":
        items = [i for i in items if i["resolved"]]
    elif resolved == "false":
        items = [i for i in items if not i["resolved"]]

    total = len(items)
    page  = items[offset : offset + limit]

    return {"total": total, "items": page}


@router.post("/api/admin/telemetry/{kind}/{item_id}/resolve")
async def admin_resolve(
    kind:    str,
    item_id: int,
    body:    ResolveBody,
    session: AsyncSession = Depends(get_session),
):
    await _require_admin(session)

    if kind == "crash":
        result = await session.execute(
            select(CrashReport).where(CrashReport.id == item_id)
        )
        item = result.scalar_one_or_none()
        if not item:
            raise HTTPException(status_code=404, detail="Crash report not found")
        item.resolved = body.resolved
        item.resolved_at = datetime.now(timezone.utc) if body.resolved else None
        await session.commit()
        return {"ok": True, "id": item_id, "resolved": item.resolved}

    if kind == "feedback":
        # FeedbackSubmission has no resolved column; just acknowledge
        result = await session.execute(
            select(FeedbackSubmission).where(FeedbackSubmission.id == item_id)
        )
        item = result.scalar_one_or_none()
        if not item:
            raise HTTPException(status_code=404, detail="Feedback not found")
        # Nothing to persist — return optimistic ack
        return {"ok": True, "id": item_id, "resolved": body.resolved}

    raise HTTPException(status_code=400, detail=f"Unknown kind '{kind}'. Use 'crash' or 'feedback'.")
