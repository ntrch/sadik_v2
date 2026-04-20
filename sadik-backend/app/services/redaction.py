"""redaction.py — Strip sensitive data from text before it reaches the LLM.

Masks: email, phone (TR + international), IBAN, API keys, credit cards.
Always active — designed to be toggled later without refactor.
"""
import copy
import logging
import re
from typing import Union

logger = logging.getLogger(__name__)

# ── Compiled patterns ──────────────────────────────────────────────────────────

# Email: standard RFC-ish, no false-positive on times like 09:30
_EMAIL = re.compile(
    r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}",
    re.ASCII,
)

# Phone: TR (05xx, +90) and international (+1-555-..., spaces/dashes/dots ok).
# Requires 7+ digits after stripping separators to avoid short numbers.
# Negative lookahead for colon prevents "09:30" match.
_PHONE = re.compile(
    r"(?<!\d)"                          # not preceded by digit
    r"(?:\+?(?:90|1|44|49|33|7)[\s\-.]?)?"  # optional country code
    r"(?:0\d{3}|[2-9]\d{2})"           # area code: 05xx or 3-digit NXX
    r"[\s\-.]?"
    r"\d{3}"
    r"[\s\-.]?"
    r"\d{2}"
    r"[\s\-.]?"
    r"\d{2}"
    r"(?!\d)"                           # not followed by digit
    r"(?!:)",                           # not followed by colon (time guard)
    re.ASCII,
)

# IBAN: TR + generic (up to 34 chars, letters+digits, optional spaces every 4)
_IBAN = re.compile(
    r"\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){4,7}(?:[ ]?[A-Z0-9]{1,4})?\b",
)

# API keys: sk-... variants and 32+ char hex/base64 tokens
_API_KEY = re.compile(
    r"\b(?:sk-(?:proj-|live_|test_)?[A-Za-z0-9_\-]{20,})"  # sk-... family
    r"|(?:[A-Fa-f0-9]{32,})"                                 # hex token 32+
    r"|(?:[A-Za-z0-9+/]{32,}={0,2})\b",                     # base64 token 32+
)

# Credit card: 16 consecutive digits (with optional spaces/dashes every 4)
_CARD = re.compile(
    r"\b(?:\d{4}[\s\-]?){3}\d{4}\b",
)

_PATTERNS: list[tuple[re.Pattern, str]] = [
    (_EMAIL,   "[EMAIL]"),
    (_PHONE,   "[PHONE]"),
    (_IBAN,    "[IBAN]"),
    (_API_KEY, "[API_KEY]"),
    (_CARD,    "[CARD]"),
]


# ── Public API ─────────────────────────────────────────────────────────────────

def redact(text: str) -> str:
    """Return text with sensitive data replaced by placeholder tokens."""
    if not text:
        return text

    counts: dict[str, int] = {}
    result = text
    for pattern, placeholder in _PATTERNS:
        matches = pattern.findall(result)
        if matches:
            counts[placeholder] = len(matches)
            result = pattern.sub(placeholder, result)

    if counts:
        summary = " ".join(
            f"{k.strip('[]').lower()}={v}" for k, v in counts.items()
        )
        logger.debug("redaction: %s", summary)

    return result


def redact_messages(messages: list[dict]) -> list[dict]:
    """Return a deep-copied messages list with all content strings redacted.

    Handles:
    - Standard {"role": ..., "content": "<string>"} entries.
    - Multipart content: {"role": ..., "content": [{"type": "text", "text": ...}, ...]}
    - Tool result entries with string content.
    """
    result: list[dict] = []
    for msg in messages:
        msg_copy = dict(msg)
        content = msg_copy.get("content")
        if isinstance(content, str):
            msg_copy["content"] = redact(content)
        elif isinstance(content, list):
            new_parts = []
            for part in content:
                if isinstance(part, dict):
                    part = dict(part)
                    if part.get("type") == "text" and isinstance(part.get("text"), str):
                        part["text"] = redact(part["text"])
                new_parts.append(part)
            msg_copy["content"] = new_parts
        result.append(msg_copy)
    return result
