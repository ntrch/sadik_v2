"""Billing router — Stripe checkout, portal, webhook, and status endpoints.

All endpoints gracefully return 503 when Stripe env vars are absent.
NO AI flow is ever blocked by billing logic.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.setting import Setting
from app.services import billing_stripe
from app.services.tier_guard import get_effective_tier

router = APIRouter(prefix="/api/billing", tags=["billing"])
logger = logging.getLogger(__name__)


async def _get_settings_map(session: AsyncSession) -> dict:
    result = await session.execute(select(Setting))
    return {s.key: s.value for s in result.scalars().all()}


@router.get("/status")
async def billing_status(session: AsyncSession = Depends(get_session)):
    """Return billing feature flag + effective tier + subscription info.

    Frontend reads this on mount; when enabled=false, Abonelik section is hidden.
    Never raises — returns safe defaults on any error.
    """
    try:
        smap = await _get_settings_map(session)
        enabled = smap.get("billing_enabled", "false").lower() == "true"
        tier = get_effective_tier(smap)
        return {
            "enabled": enabled,
            "tier": tier,
            "subscription_id": smap.get("stripe_subscription_id", ""),
            "expires_at": smap.get("pro_expires_at", ""),
        }
    except Exception as exc:
        logger.error(f"[billing] /status error: {exc}")
        return {"enabled": False, "tier": "free", "subscription_id": "", "expires_at": ""}


@router.post("/checkout")
async def create_checkout(request: Request, session: AsyncSession = Depends(get_session)):
    """Create a Stripe Checkout session and return the redirect URL.

    Returns 503 if STRIPE_SECRET_KEY or STRIPE_PRICE_ID is not configured.
    """
    try:
        # Optionally pass customer_email from request body (ignore if absent)
        customer_email = None
        try:
            body = await request.json()
            customer_email = body.get("customer_email")
        except Exception:
            pass

        url = await billing_stripe.create_checkout_session(session, customer_email=customer_email)
        return {"url": url}

    except RuntimeError as exc:
        msg = str(exc)
        logger.warning(f"[billing] checkout unavailable: {msg}")
        raise HTTPException(status_code=503, detail=f"Billing not configured: {msg}")
    except Exception as exc:
        logger.error(f"[billing] checkout error: {exc}")
        raise HTTPException(status_code=502, detail="Stripe API error")


@router.post("/portal")
async def create_portal(session: AsyncSession = Depends(get_session)):
    """Create a Stripe billing portal session and return the redirect URL.

    Returns 503 if STRIPE_SECRET_KEY not configured.
    Returns 400 if user has no customer ID (hasn't subscribed yet).
    """
    try:
        url = await billing_stripe.create_portal_session(session)
        return {"url": url}

    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        msg = str(exc)
        logger.warning(f"[billing] portal unavailable: {msg}")
        raise HTTPException(status_code=503, detail=f"Billing not configured: {msg}")
    except Exception as exc:
        logger.error(f"[billing] portal error: {exc}")
        raise HTTPException(status_code=502, detail="Stripe API error")


@router.post("/webhook")
async def stripe_webhook(request: Request, session: AsyncSession = Depends(get_session)):
    """Receive and verify Stripe webhook events.

    Uses raw request body for signature verification (required by Stripe).
    Returns 400 on signature failure (security-correct behavior).
    """
    from app.config import settings as app_settings

    raw_body = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    # Verify signature
    if not app_settings.stripe_webhook_secret:
        logger.warning("[billing] STRIPE_WEBHOOK_SECRET not set — rejecting webhook")
        raise HTTPException(status_code=503, detail="Webhook secret not configured")

    try:
        stripe = billing_stripe._get_stripe()
        event = stripe.Webhook.construct_event(
            payload=raw_body,
            sig_header=sig_header,
            secret=app_settings.stripe_webhook_secret,
        )
        event_dict = dict(event)
    except ValueError as exc:
        logger.warning(f"[billing] webhook payload parse error: {exc}")
        raise HTTPException(status_code=400, detail="Invalid webhook payload")
    except Exception as exc:
        # Includes stripe.error.SignatureVerificationError
        logger.warning(f"[billing] webhook signature verification failed: {exc}")
        raise HTTPException(status_code=400, detail="Webhook signature verification failed")

    try:
        await billing_stripe.handle_webhook_event(session, event_dict)
    except Exception as exc:
        logger.error(f"[billing] handle_webhook_event raised unexpectedly: {exc}")
        raise HTTPException(status_code=500, detail="Webhook processing error")

    return {"received": True}
