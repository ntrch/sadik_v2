"""Stripe billing service — shadow integration.

All functions gracefully degrade when Stripe env vars are absent.
AI flow is NEVER blocked by anything in this module.
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.setting import Setting

logger = logging.getLogger(__name__)


def _get_stripe():
    """Return the stripe module with api_key set, or raise RuntimeError if not configured."""
    try:
        import stripe as _stripe  # lazy import — no crash if package missing
    except ImportError:
        raise RuntimeError("stripe package not installed; run: pip install stripe>=8.0.0")
    if not settings.stripe_secret_key:
        raise RuntimeError("STRIPE_SECRET_KEY is not set")
    _stripe.api_key = settings.stripe_secret_key
    return _stripe


async def _get_settings_map(session: AsyncSession) -> dict:
    result = await session.execute(select(Setting))
    return {s.key: s.value for s in result.scalars().all()}


async def _upsert_setting(session: AsyncSession, key: str, value: str) -> None:
    result = await session.execute(select(Setting).where(Setting.key == key))
    row = result.scalar_one_or_none()
    if row:
        row.value = value
    else:
        session.add(Setting(key=key, value=value))


async def create_checkout_session(session: AsyncSession, customer_email: Optional[str] = None) -> str:
    """Create a Stripe checkout session and return the redirect URL."""
    stripe = _get_stripe()
    if not settings.stripe_price_id:
        raise RuntimeError("STRIPE_PRICE_ID is not set")

    try:
        smap = await _get_settings_map(session)
        customer_id = smap.get("stripe_customer_id", "")

        checkout_kwargs: dict = {
            "mode": "subscription",
            "line_items": [{"price": settings.stripe_price_id, "quantity": 1}],
            "success_url": settings.stripe_success_url,
            "cancel_url": settings.stripe_cancel_url,
        }

        if customer_id:
            checkout_kwargs["customer"] = customer_id
        elif customer_email:
            checkout_kwargs["customer_email"] = customer_email

        cs = stripe.checkout.Session.create(**checkout_kwargs)
        url = cs.get("url") or cs.url
        if not url:
            raise RuntimeError("Stripe checkout session returned no URL")
        return url
    except RuntimeError:
        raise
    except Exception as exc:
        logger.error(f"[billing] create_checkout_session error: {exc}")
        raise RuntimeError(f"Stripe checkout error: {exc}") from exc


async def create_portal_session(session: AsyncSession) -> str:
    """Create a Stripe billing portal session and return the redirect URL."""
    stripe = _get_stripe()

    try:
        smap = await _get_settings_map(session)
        customer_id = smap.get("stripe_customer_id", "")
        if not customer_id:
            raise ValueError("No Stripe customer ID found; user has not completed checkout")

        portal = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=settings.stripe_cancel_url,  # return_url reuses cancel_url (settings page)
        )
        url = portal.get("url") or portal.url
        if not url:
            raise RuntimeError("Stripe portal session returned no URL")
        return url
    except (RuntimeError, ValueError):
        raise
    except Exception as exc:
        logger.error(f"[billing] create_portal_session error: {exc}")
        raise RuntimeError(f"Stripe portal error: {exc}") from exc


async def handle_webhook_event(session: AsyncSession, event: dict) -> None:
    """Process a verified Stripe webhook event. Never raises — all errors are logged."""
    event_type = event.get("type", "")
    data_obj = event.get("data", {}).get("object", {})

    try:
        if event_type == "checkout.session.completed":
            customer_id = data_obj.get("customer", "")
            subscription_id = data_obj.get("subscription", "")
            logger.info(f"[billing] checkout.session.completed — customer={customer_id} sub={subscription_id}")

            # Fetch subscription to get current_period_end
            expires_iso = ""
            if subscription_id:
                try:
                    stripe = _get_stripe()
                    sub = stripe.Subscription.retrieve(subscription_id)
                    period_end = sub.get("current_period_end") or getattr(sub, "current_period_end", None)
                    if period_end:
                        expires_dt = datetime.fromtimestamp(int(period_end), tz=timezone.utc)
                        expires_iso = expires_dt.isoformat()
                except Exception as sub_exc:
                    logger.warning(f"[billing] could not retrieve subscription for period_end: {sub_exc}")
                    # Fallback: +31 days
                    expires_iso = (datetime.now(timezone.utc) + timedelta(days=31)).isoformat()

            await _upsert_setting(session, "stripe_customer_id", customer_id)
            await _upsert_setting(session, "stripe_subscription_id", subscription_id)
            await _upsert_setting(session, "user_tier", "pro")
            await _upsert_setting(session, "pro_expires_at", expires_iso)
            await session.commit()
            logger.info(f"[billing] user upgraded to pro, expires={expires_iso}")

        elif event_type == "customer.subscription.updated":
            subscription_id = data_obj.get("id", "")
            status = data_obj.get("status", "")
            period_end = data_obj.get("current_period_end")
            logger.info(f"[billing] subscription.updated — sub={subscription_id} status={status}")

            if status == "active":
                expires_iso = ""
                if period_end:
                    expires_dt = datetime.fromtimestamp(int(period_end), tz=timezone.utc)
                    expires_iso = expires_dt.isoformat()
                await _upsert_setting(session, "user_tier", "pro")
                await _upsert_setting(session, "pro_expires_at", expires_iso)
            elif status in ("canceled", "unpaid", "past_due"):
                await _upsert_setting(session, "user_tier", "free")
                await _upsert_setting(session, "pro_expires_at", "")
                await _upsert_setting(session, "stripe_subscription_id", "")
            await session.commit()

        elif event_type == "customer.subscription.deleted":
            logger.info("[billing] subscription.deleted — reverting to free")
            await _upsert_setting(session, "user_tier", "free")
            await _upsert_setting(session, "pro_expires_at", "")
            await _upsert_setting(session, "stripe_subscription_id", "")
            await session.commit()

        else:
            logger.debug(f"[billing] unhandled event type: {event_type} — ignoring")

    except Exception as exc:
        logger.error(f"[billing] handle_webhook_event error (event={event_type}): {exc}")
        # Do NOT re-raise — webhook errors must never affect the AI flow
