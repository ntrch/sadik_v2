import { http } from './http';

export interface UsageStats {
  period_days: number;
  total_turns: number;
  avg_turns_per_day: number;
  total_audio_seconds: number;
  avg_audio_seconds_per_turn: number;
  p50_total_ms: number;
  p95_total_ms: number;
  avg_stt_ms: number;
  avg_llm_ttfb_ms: number;
  avg_tts_ttfb_ms: number;
  top_tools: Array<{ name: string; count: number }>;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  estimated_cost_usd: number;
  cost_breakdown: { stt_usd: number; llm_usd: number; tts_usd: number };
}

export const usageApi = {
  getMine: (days: number = 30) =>
    http.get<UsageStats>(`/api/usage/me?days=${days}`).then((r) => r.data),
};
