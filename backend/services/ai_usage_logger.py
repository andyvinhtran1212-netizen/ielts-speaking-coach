"""
services/ai_usage_logger.py — Best-effort AI usage logging.

Writes one row per AI API call to ai_usage_logs.
Never raises — all failures are swallowed so they never disrupt the main flow.

Schema lives in backend/migrations/031_ai_usage_logs.sql.  Apply that
migration in any new environment before logs land.
"""

import logging

from database import supabase_admin

logger = logging.getLogger(__name__)

# ── Cost per unit (USD) ────────────────────────────────────────────────────────
# Claude Haiku 4.5 pricing (2025)
_CLAUDE_IN  = 0.80 / 1_000_000   # $0.80 / 1M input tokens
_CLAUDE_OUT = 4.00 / 1_000_000   # $4.00 / 1M output tokens
_CLAUDE_CR  = 0.08 / 1_000_000   # $0.08 / 1M cache-read tokens
_CLAUDE_CW  = 1.00 / 1_000_000   # $1.00 / 1M cache-write tokens

# Gemini 2.5 Flash pricing (non-thinking, ≤200K context)
_GEMINI_IN  = 0.15 / 1_000_000   # $0.15 / 1M input tokens
_GEMINI_OUT = 0.60 / 1_000_000   # $0.60 / 1M output tokens

# OpenAI Whisper: $0.006 / minute
_WHISPER_PER_S = 0.006 / 60      # per second

# OpenAI TTS tts-1: $0.015 / 1K characters
_TTS_PER_CHAR  = 0.015 / 1_000   # per character


# ── Public log helpers ─────────────────────────────────────────────────────────

def log_claude(
    *,
    user_id:           str | None,
    session_id:        str | None,
    model:             str,
    input_tokens:      int,
    output_tokens:     int,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
) -> None:
    """Log one Claude API call. Best-effort — never raises."""
    cost = (
        input_tokens      * _CLAUDE_IN
        + output_tokens   * _CLAUDE_OUT
        + cache_read_tokens  * _CLAUDE_CR
        + cache_write_tokens * _CLAUDE_CW
    )
    _insert({
        "user_id":            user_id,
        "session_id":         session_id,
        "service":            "claude",
        "model":              model,
        "input_tokens":       input_tokens,
        "output_tokens":      output_tokens,
        "cache_read_tokens":  cache_read_tokens,
        "cache_write_tokens": cache_write_tokens,
        "cost_usd_est":       round(cost, 8),
    })


def log_gemini(
    *,
    user_id:       str | None,
    session_id:    str | None,
    model:         str,
    input_tokens:  int,
    output_tokens: int,
) -> None:
    """Log one Gemini API call. Best-effort — never raises."""
    cost = input_tokens * _GEMINI_IN + output_tokens * _GEMINI_OUT
    _insert({
        "user_id":       user_id,
        "session_id":    session_id,
        "service":       "gemini",
        "model":         model,
        "input_tokens":  input_tokens,
        "output_tokens": output_tokens,
        "cost_usd_est":  round(cost, 8),
    })


def log_whisper(
    *,
    user_id:       str | None,
    session_id:    str | None,
    model:         str,
    audio_seconds: float,
) -> None:
    """Log one Whisper transcription call. Best-effort — never raises."""
    cost = audio_seconds * _WHISPER_PER_S
    _insert({
        "user_id":       user_id,
        "session_id":    session_id,
        "service":       "whisper",
        "model":         model,
        "audio_seconds": round(audio_seconds, 2),
        "cost_usd_est":  round(cost, 8),
    })


def log_tts(
    *,
    user_id:    str | None,
    session_id: str | None,
    model:      str,
    text_chars: int,
) -> None:
    """Log one TTS call. Best-effort — never raises."""
    cost = text_chars * _TTS_PER_CHAR
    _insert({
        "user_id":    user_id,
        "session_id": session_id,
        "service":    "tts",
        "model":      model,
        "text_chars": text_chars,
        "cost_usd_est": round(cost, 8),
    })


# ── Internal ───────────────────────────────────────────────────────────────────

def _insert(row: dict) -> None:
    """Insert one row into ai_usage_logs. Silently swallows all errors."""
    try:
        supabase_admin.table("ai_usage_logs").insert(row).execute()
    except Exception as exc:
        logger.debug("[ai_usage] insert skipped (table may not exist yet): %s", exc)
