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


def _per_user_flag(user_id: str, key: str) -> bool:
    """
    Single shared lookup against users.feature_flags.  Strict True (not truthy);
    any DB error denies.
    """
    try:
        row = (
            supabase_admin.table("users")
            .select("feature_flags")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
        flags = (row.data or [{}])[0].get("feature_flags") or {}
        return flags.get(key) is True
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
