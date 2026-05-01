"""telemetry_redactor.py — Strip PII and secrets from crash telemetry data.

Applied to message, stack, and context_json string values before persisting.
Complements the existing redaction.py (which covers LLM traffic).
"""
import json
import os
import re
from typing import Any

# ── Compiled patterns ──────────────────────────────────────────────────────────

# File paths → basename only (Windows + POSIX)
_WIN_PATH = re.compile(r'[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*([^\\/:*?"<>|\r\n]+)')
_UNIX_PATH = re.compile(r'(?<!\w)/(?:[^/\s]+/)*([^/\s]+)')

# API keys
_SK_KEY = re.compile(r'\bsk-[A-Za-z0-9_\-]{20,}')
_XOXB_KEY = re.compile(r'\bxoxb-[A-Za-z0-9_\-]+')

# Bearer tokens
_BEARER = re.compile(r'Bearer\s+\S+', re.IGNORECASE)

# Generic 32+ char hex/base64 after key=, token=, secret=, password=, etc.
_GENERIC_SECRET = re.compile(
    r'(?:key|token|secret|password|passwd|pwd|auth|credential)\s*=\s*[A-Za-z0-9+/=_\-]{32,}',
    re.IGNORECASE,
)

# Email addresses
_EMAIL = re.compile(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}', re.ASCII)

# Env var values: SOME_VAR=value (all-caps name, 4+ chars)
_ENV_VAR = re.compile(r'\b[A-Z_]{4,}=[^\s]+')


def _redact_str(text: str) -> str:
    """Apply all redaction patterns to a single string."""
    if not text:
        return text

    # Windows absolute paths → basename
    text = _WIN_PATH.sub(lambda m: m.group(1), text)
    # POSIX absolute paths → basename (only when clearly a path, not URLs)
    text = _UNIX_PATH.sub(lambda m: m.group(1), text)

    # Secrets
    text = _SK_KEY.sub('[API_KEY]', text)
    text = _XOXB_KEY.sub('[API_KEY]', text)
    text = _BEARER.sub('Bearer [TOKEN]', text)
    text = _GENERIC_SECRET.sub(lambda m: m.group(0).split('=')[0] + '=[REDACTED]', text)

    # PII
    text = _EMAIL.sub('[EMAIL]', text)
    text = _ENV_VAR.sub(lambda m: m.group(0).split('=')[0] + '=[REDACTED]', text)

    return text


def _redact_value(v: Any) -> Any:
    """Recursively redact strings inside dicts/lists."""
    if isinstance(v, str):
        return _redact_str(v)
    if isinstance(v, dict):
        return {k: _redact_value(val) for k, val in v.items()}
    if isinstance(v, list):
        return [_redact_value(item) for item in v]
    return v


def redact_crash(
    message: str | None,
    stack: str | None,
    context_json: str | None,
) -> tuple[str | None, str | None, str | None]:
    """Redact crash fields. Returns (message, stack, context_json)."""
    clean_message = _redact_str(message) if message else message
    clean_stack = _redact_str(stack) if stack else stack

    clean_context: str | None = context_json
    if context_json:
        try:
            obj = json.loads(context_json)
            obj = _redact_value(obj)
            clean_context = json.dumps(obj, ensure_ascii=False)
        except (json.JSONDecodeError, TypeError):
            # If it's not valid JSON, treat as plain text
            clean_context = _redact_str(context_json)

    return clean_message, clean_stack, clean_context
