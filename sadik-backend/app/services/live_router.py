"""
live_router.py — SADIK v2 T9.5.2 Adım 3: A/B Router state machine.

LiveRouter coordinates two parallel paths for a Gemini Live turn:
  A-path: Live audio from Gemini → forwarded to client (unless muted).
  B-path: User transcript → LLM router → tool execution.

Lifecycle per turn:
  1. on_transcript(text, finished) — called for each transcript chunk.
  2. on_turn_complete()            — called once; flushes buffer to LLM.
  3. LLM decides:
       - finish_reason="tool_calls" → execute tool, return ("tool", name, "ok"|"error", data, err)
       - finish_reason="stop"       → return ("chat", None)
  4. Caller resets mute + transcript_buffer for next turn.

Mute flag:
  - asyncio.Event: set = audio MUTED (drop server→client forwarding).
  - Set before LLM call when tool_calls detected early? No — muted only
    AFTER LLM confirms tool_calls (see architecture note in T9.5.2 spec).
  - Cleared by caller (voice.py) after on_turn_complete() returns.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional, Tuple

from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# System prompt for the B-path LLM router.
# Minimal: classify intent, call a tool if appropriate, else mark as chat.
_ROUTER_SYSTEM_PROMPT = (
    "Sen SADIK'sın. Kullanıcının isteğini değerlendir.\n"
    "Eğer uygun bir araç varsa onu çağır.\n"
    "Eğer araç gerekmiyorsa (genel sohbet, selamlama, soru-cevap) hiçbir araç çağırma ve boş cevap ver.\n"
    "Araç çağırdıktan sonra kısa bir onay cümlesi döndür (TTS için). "
    "Araç çağırmıyorsan hiçbir şey yazma — sadece boş string döndür."
)

# Result type aliases
# ("tool",  tool_name, "ok"|"error", data_dict, error_str|None)
# ("chat",  None)
RouterResult = Tuple


class LiveRouter:
    """State machine for one Gemini Live WebSocket session.

    One LiveRouter instance per WS connection. Re-used across turns
    (reset() clears per-turn state between turns).
    """

    def __init__(self) -> None:
        self.transcript_buffer: str = ""
        # asyncio.Event: set() = muted (audio forwarding paused)
        self.mute_flag: asyncio.Event = asyncio.Event()

    # ── Per-turn state ─────────────────────────────────────────────────────────

    def reset_turn(self) -> None:
        """Clear transcript buffer and unmute for the next turn."""
        self.transcript_buffer = ""
        self.mute_flag.clear()

    # ── Mute helpers ───────────────────────────────────────────────────────────

    def mute(self) -> None:
        self.mute_flag.set()

    def unmute(self) -> None:
        self.mute_flag.clear()

    def is_muted(self) -> bool:
        return self.mute_flag.is_set()

    # ── Transcript accumulation ────────────────────────────────────────────────

    def on_transcript(self, text: str, finished: bool) -> None:
        """Accumulate transcript text. Called for every transcript chunk."""
        if text:
            self.transcript_buffer += text
        logger.debug(
            "[LiveRouter] transcript chunk finished=%s buf_len=%d",
            finished, len(self.transcript_buffer),
        )

    # ── Turn complete → LLM routing ────────────────────────────────────────────

    async def on_turn_complete(
        self,
        session: AsyncSession,
        settings: dict,
    ) -> RouterResult:
        """Route the accumulated transcript to the LLM tool-use loop.

        Returns:
            ("tool",  tool_name, status, data, error)  — tool was executed
            ("chat",  None)                             — no tool needed
        """
        text = self.transcript_buffer.strip()
        logger.info("[LiveRouter] on_turn_complete: transcript=%r", text[:120])

        if not text:
            logger.info("[LiveRouter] empty transcript — skipping LLM call, treating as chat")
            return ("chat", None)

        # ── Build OpenAI client ────────────────────────────────────────────────
        api_key = settings.get("openai_api_key", "").strip()
        model   = settings.get("llm_model", "gpt-4o-mini")

        if not api_key:
            logger.warning("[LiveRouter] openai_api_key not set — skipping router LLM")
            return ("chat", None)

        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=api_key)

        # ── Build tool schemas ─────────────────────────────────────────────────
        from app.services.voice_tools import get_tool_schemas, execute_tool, TOOLS
        from app.services.privacy_flags import get_privacy_flags, get_privacy_tier

        privacy_flags = await get_privacy_flags(session)
        tier = await get_privacy_tier(session)
        tool_schemas = get_tool_schemas("openai", tier=tier)

        messages = [
            {"role": "system", "content": _ROUTER_SYSTEM_PROMPT},
            {"role": "user",   "content": text},
        ]

        # ── Single LLM call (non-stream for simplicity) ────────────────────────
        try:
            create_kwargs: dict = {
                "model": model,
                "messages": messages,
            }
            if tool_schemas:
                create_kwargs["tools"] = tool_schemas
                create_kwargs["tool_choice"] = "auto"

            response = await client.chat.completions.create(**create_kwargs)
            choice = response.choices[0]
        except Exception as e:
            logger.error("[LiveRouter] LLM call failed: %s", e)
            return ("chat", None)

        finish_reason = choice.finish_reason
        msg = choice.message

        logger.info(
            "[LiveRouter] LLM finish_reason=%s tool_calls=%s",
            finish_reason,
            bool(msg.tool_calls),
        )

        # ── No tool calls → pure chat turn ────────────────────────────────────
        if finish_reason != "tool_calls" or not msg.tool_calls:
            return ("chat", None)

        # ── Tool call detected → execute tool (T9.5.7: mute intentionally skipped) ──
        # live_router.mute() removed — narration audio must flow to client after tool exec.
        # Mute plumbing (mute_flag / mute() / is_muted()) retained for cancel path callers.

        # Execute the FIRST tool call (router intent: one tool per turn)
        tc = msg.tool_calls[0]
        tool_name = tc.function.name
        try:
            fn_args = json.loads(tc.function.arguments or "{}")
        except json.JSONDecodeError:
            fn_args = {}

        logger.info("[LiveRouter] executing tool=%s args=%s", tool_name, fn_args)

        try:
            result_text = await execute_tool(
                tool_name, fn_args, session, privacy_flags=privacy_flags
            )
            logger.info("[LiveRouter] tool=%s result=%r", tool_name, result_text[:120])
            return ("tool", tool_name, "ok", {"result": result_text}, None)
        except Exception as e:
            logger.error("[LiveRouter] tool=%s execute error: %s", tool_name, e)
            return ("tool", tool_name, "error", {}, str(e))
