import logging
from collections import Counter
from statistics import median, quantiles

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone, timedelta

from app.database import get_session
from app.models.voice_turn_event import VoiceTurnEvent
from app.schemas.usage import UsageStats
from app.services.pricing import estimate_cost

router = APIRouter(prefix="/api/usage", tags=["usage"])
logger = logging.getLogger(__name__)


def _safe_avg(values: list[int | float]) -> int:
    filtered = [v for v in values if v is not None and v >= 0]
    return int(sum(filtered) / len(filtered)) if filtered else 0


@router.get("/me", response_model=UsageStats)
async def get_my_usage(
    days: int = Query(default=30, ge=1, le=90),
    session: AsyncSession = Depends(get_session),
) -> UsageStats:
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)

    result = await session.execute(
        select(VoiceTurnEvent)
        .where(VoiceTurnEvent.started_at >= since)
        .order_by(VoiceTurnEvent.started_at.asc())
    )
    turns = result.scalars().all()

    total_turns = len(turns)
    avg_turns_per_day = round(total_turns / days, 2)

    total_audio = sum(t.user_audio_seconds or 0 for t in turns)
    avg_audio = round(total_audio / total_turns, 2) if total_turns else 0.0

    # Latency percentiles — only turns with total_ms recorded
    total_ms_vals = sorted(t.total_ms for t in turns if t.total_ms is not None)
    if total_ms_vals:
        p50 = int(median(total_ms_vals))
        # quantiles needs at least 2 values for 95th; fall back to max otherwise
        if len(total_ms_vals) >= 2:
            p95 = int(quantiles(total_ms_vals, n=20)[-1])  # 95th = index 18 of 20-quantile
        else:
            p95 = total_ms_vals[-1]
    else:
        p50 = p95 = 0

    avg_stt  = _safe_avg([t.stt_ms for t in turns])
    avg_llm  = _safe_avg([t.llm_ms for t in turns])

    # Top tools — count occurrences across all tool_names CSVs
    tool_counter: Counter = Counter()
    for t in turns:
        if t.tool_names:
            for name in t.tool_names.split(","):
                name = name.strip()
                if name:
                    tool_counter[name] += 1
    top_tools = [{"name": n, "count": c} for n, c in tool_counter.most_common(5)]

    total_prompt = sum(t.prompt_tokens or 0 for t in turns)
    total_completion = sum(t.completion_tokens or 0 for t in turns)

    cost = estimate_cost(turns)

    return UsageStats(
        period_days=days,
        total_turns=total_turns,
        avg_turns_per_day=avg_turns_per_day,
        total_audio_seconds=round(total_audio, 1),
        avg_audio_seconds_per_turn=avg_audio,
        p50_total_ms=p50,
        p95_total_ms=p95,
        avg_stt_ms=avg_stt,
        avg_llm_ttfb_ms=avg_llm,
        top_tools=top_tools,
        total_prompt_tokens=total_prompt,
        total_completion_tokens=total_completion,
        estimated_cost_usd=cost["total_usd"],
        cost_breakdown={
            "stt_usd": cost["stt_usd"],
            "llm_usd": cost["llm_usd"],
        },
    )
