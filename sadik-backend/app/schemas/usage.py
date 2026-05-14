from pydantic import BaseModel


class UsageStats(BaseModel):
    period_days: int
    total_turns: int
    avg_turns_per_day: float
    total_audio_seconds: float
    avg_audio_seconds_per_turn: float
    p50_total_ms: int
    p95_total_ms: int
    avg_stt_ms: int
    avg_llm_ttfb_ms: int
    top_tools: list[dict]  # [{name, count}]
    total_prompt_tokens: int
    total_completion_tokens: int
    estimated_cost_usd: float
    cost_breakdown: dict  # {stt_usd, llm_usd, tts_usd}
