import asyncio
import logging
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import Integration

logger = logging.getLogger(__name__)

_scheduler_task: Optional[asyncio.Task] = None

# ---------------------------------------------------------------------------
# Known providers
# ---------------------------------------------------------------------------

KNOWN_PROVIDERS = ["google_calendar", "notion", "slack", "zoom"]

# ---------------------------------------------------------------------------
# Abstract base for concrete provider implementations (Phase 1+).
# ---------------------------------------------------------------------------


class BaseProvider(ABC):
    """Subclass per external service. Register in PROVIDERS dict below."""

    @abstractmethod
    async def refresh_token(self, integration: Integration) -> None:
        """Refresh the access_token using refresh_token before it expires."""
        raise NotImplementedError

    @abstractmethod
    async def sync(self, session: AsyncSession, integration: Integration) -> None:
        """Pull data from the external service and persist locally."""
        raise NotImplementedError


# Registry populated by later phases:
#   from app.services.integration_service import PROVIDERS, GoogleCalendarProvider
#   PROVIDERS['google_calendar'] = GoogleCalendarProvider
PROVIDERS: dict[str, type[BaseProvider]] = {}

# ---------------------------------------------------------------------------
# CRUD helpers
# ---------------------------------------------------------------------------


async def get_integration(session: AsyncSession, provider: str) -> Optional[Integration]:
    """Return the Integration row for *provider*, or None if it doesn't exist yet."""
    result = await session.execute(
        select(Integration).where(Integration.provider == provider)
    )
    return result.scalar_one_or_none()


async def list_integrations(session: AsyncSession) -> list[Integration]:
    """Return all Integration rows ordered by provider name."""
    result = await session.execute(select(Integration).order_by(Integration.provider))
    return list(result.scalars().all())


async def upsert_integration(
    session: AsyncSession, provider: str, **fields
) -> Integration:
    """Create or update the Integration row for *provider*.

    Pass any subset of Integration columns as keyword arguments.
    Always updates `updated_at` implicitly via the ORM `onupdate`.
    """
    integration = await get_integration(session, provider)
    if integration is None:
        integration = Integration(provider=provider)
        session.add(integration)

    for key, value in fields.items():
        setattr(integration, key, value)

    await session.commit()
    await session.refresh(integration)
    return integration


async def disconnect(session: AsyncSession, provider: str) -> None:
    """Set status='disconnected' and clear tokens while preserving the row for audit."""
    integration = await get_integration(session, provider)
    if integration is None:
        return  # Nothing to disconnect — no-op.

    integration.status = "disconnected"
    integration.access_token = None
    integration.refresh_token = None
    integration.expires_at = None
    integration.account_email = None
    integration.last_error = None
    await session.commit()


async def mark_error(session: AsyncSession, provider: str, message: str) -> None:
    """Record an error on the integration row without clearing tokens."""
    integration = await get_integration(session, provider)
    if integration is None:
        integration = Integration(provider=provider)
        session.add(integration)

    integration.status = "error"
    integration.last_error = message
    await session.commit()

# ---------------------------------------------------------------------------
# Sync cycle (called every 10 minutes)
# ---------------------------------------------------------------------------


async def run_sync_cycle() -> None:
    """Iterate connected integrations and call provider.sync() on each.

    A crash in one provider must never kill the others — each is wrapped in
    its own try/except. No-op when PROVIDERS registry is empty.
    """
    if not PROVIDERS:
        return

    from app.database import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        integrations = await list_integrations(session)
        connected = [i for i in integrations if i.status == "connected"]

        for integration in connected:
            provider_cls = PROVIDERS.get(integration.provider)
            if provider_cls is None:
                logger.debug(
                    "[integrations] No provider registered for '%s', skipping",
                    integration.provider,
                )
                continue

            try:
                provider = provider_cls()
                await provider.sync(session, integration)
                integration.last_sync_at = datetime.now(timezone.utc).replace(tzinfo=None)
                await session.commit()
                logger.info("[integrations] Synced '%s' OK", integration.provider)
            except Exception as exc:
                logger.error(
                    "[integrations] Sync failed for '%s': %s",
                    integration.provider,
                    exc,
                )
                try:
                    await mark_error(session, integration.provider, str(exc))
                except Exception:
                    pass  # Don't let error-recording crash the loop.


# ---------------------------------------------------------------------------
# Background scheduler
# ---------------------------------------------------------------------------


async def _scheduler_loop() -> None:
    """Run run_sync_cycle() every 60 seconds."""
    while True:
        try:
            await run_sync_cycle()
        except asyncio.CancelledError:
            logger.info("[integrations] Scheduler cancelled")
            raise
        except Exception as exc:
            logger.error("[integrations] Scheduler tick error: %s", exc)

        await asyncio.sleep(60)  # 1 minute


def create_scheduler_task() -> asyncio.Task:
    global _scheduler_task
    logger.info("[integrations] Starting integration sync scheduler")
    _scheduler_task = asyncio.create_task(_scheduler_loop())
    return _scheduler_task


async def stop_scheduler() -> None:
    global _scheduler_task
    if _scheduler_task and not _scheduler_task.done():
        _scheduler_task.cancel()
        try:
            await _scheduler_task
        except asyncio.CancelledError:
            pass
    _scheduler_task = None
    logger.info("[integrations] Scheduler stopped")
