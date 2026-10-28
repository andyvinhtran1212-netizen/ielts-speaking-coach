"""
services/feature_flags.py — System-level feature flag reads.

Uses the service-role Supabase client intentionally:
  - `users.feature_flags` is system metadata, not user content.
  - Reading it with the service role is the same pattern as reading roles/permissions —
    it requires no RLS bypass of user-owned rows.
  - The service-role key is never exposed to route responses; it stays in this layer.
"""

import logging

from database import supabase_admin

logger = logging.getLogger(__name__)


def _per_user_flag_query(user_id: str):
    return lambda db: db.table("users").select("feature_flags").eq("id", user_id).limit(1)


def _flag_value(row, key: str) -> bool:
    flags = (row.data or [{}])[0].get("feature_flags") or {}
    return flags.get(key) is True


def _per_user_flag(user_id: str, key: str) -> bool:
    """
    Single shared lookup against users.feature_flags.  Strict True (not truthy);
    any DB error denies.
    """
    try:
        return _flag_value(_per_user_flag_query(user_id)(supabase_admin).execute(), key)
    except Exception as e:
        logger.warning("[feature_flags] lookup failed for key=%s (default deny): %s", key, e)
        return False


async def _aper_user_flag(user_id: str, key: str, run) -> bool:
    """:func:`_per_user_flag` with the read awaited through ``run(build)``.

    PC-J05: ``run`` is the async-DB facade's ``aexecute``, handed in by /auth/me
    when ``USE_ASYNC_DB`` is on. This module never picks the client itself, so
    the facade allowlist (ASYNCAUTH-0036 FR-005) stays the routers that call it.
    """
    try:
        return _flag_value(await run(_per_user_flag_query(user_id)), key)
    except Exception as e:
        logger.warning("[feature_flags] lookup failed for key=%s (default deny): %s", key, e)
        return False


def is_vocab_bank_enabled(user_id: str, global_flag: bool) -> bool:
    """
    Return True only when the global flag is on AND the user's per-user flag is
    explicitly True.  Missing key / False / DB error all deny.

    Args:
        user_id: Supabase user UUID.
        global_flag: Value of settings.VOCAB_BANK_FEATURE_FLAG_ENABLED.
    """
    if not global_flag:
        return False
    return _per_user_flag(user_id, "vocab_enabled")


def is_d1_enabled(user_id: str, global_flag: bool) -> bool:
    """Phase D: D1 fill-blank.  Same default-deny semantics as vocab bank."""
    if not global_flag:
        return False
    return _per_user_flag(user_id, "d1_enabled")


def is_d3_enabled(user_id: str, global_flag: bool) -> bool:
    """Phase D: D3 speak-with-target (deferred to Phase E).  Same default-deny."""
    if not global_flag:
        return False
    return _per_user_flag(user_id, "d3_enabled")


def is_flashcard_enabled(user_id: str, global_flag: bool) -> bool:
    """Phase D Wave 2: Flashcards.  Same default-deny semantics as vocab/D1."""
    if not global_flag:
        return False
    return _per_user_flag(user_id, "flashcard_enabled")


async def ais_flashcard_enabled(user_id: str, global_flag: bool, *, run) -> bool:
    """:func:`is_flashcard_enabled` with the per-user read awaited via ``run``."""
    if not global_flag:
        return False
    return await _aper_user_flag(user_id, "flashcard_enabled", run)


def is_vocab_curated_enabled(user_id: str) -> bool:
    """Curated Vocab Wiki cohort gate. Runtime kill switches are checked apart."""
    return _per_user_flag(user_id, "vocab_curated_enabled")
