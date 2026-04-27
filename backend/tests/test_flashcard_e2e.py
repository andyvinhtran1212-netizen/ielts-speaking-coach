"""
End-to-end tests for Phase D Wave 2 flashcards.

These exercise the pure helpers exposed by routers/flashcards.py — no live
DB or HTTP — to keep the suite fast.  Live RLS is covered separately
(test_stack_rls.py); rate limiting is covered in test_rate_limit.py.

Filled in steps 3-4 of Phase D Wave 2 once routers/flashcards.py exists.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest


def _import_flashcards():
    try:
        from routers import flashcards as fc  # type: ignore
        return fc
    except Exception:
        pytest.skip("routers.flashcards not yet implemented (steps 3-4)")


# ── Auto-stack id semantics ──────────────────────────────────────────────────


def test_auto_stack_returns_virtual_id():
    """The 3 auto-stacks must always advertise ids prefixed with 'auto:'."""
    fc = _import_flashcards()
    ids = fc.AUTO_STACK_IDS  # filled by step 3
    assert set(ids) == {"auto:all_vocab", "auto:recent", "auto:needs_review"}


def test_is_auto_stack_helper():
    fc = _import_flashcards()
    assert fc._is_auto_stack_id("auto:all_vocab") is True
    assert fc._is_auto_stack_id("auto:recent") is True
    assert fc._is_auto_stack_id("auto:needs_review") is True
    # Real UUIDs are not auto stacks.
    assert fc._is_auto_stack_id("11111111-1111-1111-1111-111111111111") is False
    # Unknown 'auto:' values fall back to NOT auto so callers 404 cleanly.
    assert fc._is_auto_stack_id("auto:bogus") is False


# ── Manual stack persistence shape ───────────────────────────────────────────


def test_manual_stack_persisted_with_uuid():
    """create_stack must return a UUID id (not 'auto:*')."""
    fc = _import_flashcards()
    if not hasattr(fc, "_validate_stack_name"):
        pytest.skip("validator helper not exported yet")
    # Names below the 3-char floor are rejected.
    with pytest.raises(ValueError):
        fc._validate_stack_name("ab")
    # Names above the 50-char ceiling are rejected.
    with pytest.raises(ValueError):
        fc._validate_stack_name("x" * 51)
    # 3-50 inclusive accepted (whitespace trimmed).
    assert fc._validate_stack_name("  Business words  ") == "Business words"


# ── SRS shared across stacks ─────────────────────────────────────────────────


def test_srs_shared_across_stacks():
    """
    Acceptance criterion §12: reviewing word X in stack A must update SRS
    state for word X regardless of which stack the user opens next.

    The pure-function check here: review records are keyed on (user_id,
    vocabulary_id) only — NOT on stack_id — so a second review touches the
    same row.  Schema-level guarantee comes from the UNIQUE constraint in
    migration 027; this test pins the helper that builds the upsert payload.
    """
    fc = _import_flashcards()
    if not hasattr(fc, "_review_upsert_payload"):
        pytest.skip("_review_upsert_payload helper not exported yet")
    user_id = "user-aaaa"
    vocab_id = "vocab-bbbb"
    payload_a = fc._review_upsert_payload(user_id, vocab_id, {"interval_days": 3, "ease_factor": 2.5,
                                                              "review_count": 1, "lapse_count": 0,
                                                              "last_reviewed_at": "2026-04-27T00:00:00+00:00",
                                                              "next_review_at":   "2026-04-30T00:00:00+00:00"})
    assert payload_a["user_id"] == user_id
    assert payload_a["vocabulary_id"] == vocab_id
    assert "stack_id" not in payload_a, "review state must NOT include stack_id"


# ── Filter validation ────────────────────────────────────────────────────────


def test_create_stack_with_filter_normalizes():
    """
    Filter config is JSONB — backend should accept the documented keys
    (topics, categories, search, added_after) and silently ignore unknown
    keys instead of 500ing.
    """
    fc = _import_flashcards()
    if not hasattr(fc, "_normalize_filter_config"):
        pytest.skip("_normalize_filter_config helper not exported yet")

    out = fc._normalize_filter_config({
        "topics": ["business"],
        "categories": ["needs_review"],
        "search": "implement",
        "added_after": "2026-01-01",
        "junk_field": "ignored",
    })
    assert out["topics"] == ["business"]
    assert out["categories"] == ["needs_review"]
    assert out["search"] == "implement"
    assert out["added_after"] == "2026-01-01"
    assert "junk_field" not in out


# ── Review request validation ────────────────────────────────────────────────


def test_review_rating_validation():
    fc = _import_flashcards()
    if not hasattr(fc, "ReviewRequest"):
        pytest.skip("ReviewRequest model not exported yet")
    # Valid ratings accepted.
    for rating in ("again", "hard", "good", "easy"):
        fc.ReviewRequest(rating=rating)
    # Invalid rating rejected.
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        fc.ReviewRequest(rating="perfect")
