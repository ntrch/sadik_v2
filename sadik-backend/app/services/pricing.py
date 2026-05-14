# OpenAI pricing per 1M tokens / per minute audio (Jan 2026 rates)
PRICING = {
    "whisper-1":   0.006,       # per minute
    "gpt-4o-mini": {
        "input":  0.150,        # per 1M tokens
        "output": 0.600,        # per 1M tokens
    },
}


def estimate_cost(turns: list) -> dict:
    """turns: list of VoiceTurnEvent rows. Returns USD breakdown."""
    stt_secs = sum(t.user_audio_seconds or 0 for t in turns)
    stt_usd  = (stt_secs / 60) * PRICING["whisper-1"]

    in_tok  = sum(t.prompt_tokens or 0 for t in turns)
    out_tok = sum(t.completion_tokens or 0 for t in turns)
    llm_usd = (in_tok / 1_000_000) * PRICING["gpt-4o-mini"]["input"] + \
              (out_tok / 1_000_000) * PRICING["gpt-4o-mini"]["output"]

    return {
        "stt_usd":   round(stt_usd, 4),
        "llm_usd":   round(llm_usd, 4),
        "total_usd": round(stt_usd + llm_usd, 4),
    }
