"""
Sprint 14.8.2 / 15.1.1 — response save path sentinels.

History: Sprint 14.8.2 swapped the save to an atomic
`.upsert(..., on_conflict="session_id,question_id")`. That was REVERTED in the
Sprint 15.1.1 P0 hotfix: PostgREST's ON CONFLICT cannot target migration 077's
*partial* unique index, so in production every upsert errored and /responses
persisted no row → /complete returned 422 "no usable band scores".

These sentinels now pin the corrected read-then-write save AND guard against
re-introducing the on_conflict-vs-partial-index incompatibility. Source-scan
only (the closure captures session_id/question_id and isn't importable).
"""

from pathlib import Path

_BACKEND = Path(__file__).parent.parent
GRADING_PY = (_BACKEND / "routers" / "grading.py").read_text(encoding="utf-8")
MIG_077 = (_BACKEND / "migrations" / "077_responses_unique_session_question.sql").read_text(encoding="utf-8")

_start = GRADING_PY.index("def _upsert_response")
_end = GRADING_PY.index("\n        try:", _start)
UPSERT_BODY = GRADING_PY[_start:_end]
# Code without comment lines — so substring checks don't match the explanatory
# comment (which quotes the reverted on_conflict upsert).
UPSERT_CODE = "\n".join(
    ln for ln in UPSERT_BODY.splitlines() if not ln.lstrip().startswith("#")
)


# ── Sprint 15.1.1 — read-then-write save (works against any index state) ────────

def test_save_uses_read_then_write():
    assert ".select(" in UPSERT_BODY, "save must read existing row first"
    assert ".insert(" in UPSERT_BODY, "save must insert when no existing row"
    assert ".update(" in UPSERT_BODY, "save must update the existing row by id"


def test_save_still_returns_row_id():
    # Downstream grammar_recommendations / pronunciation need response_id.
    assert 'res.data[0]["id"]' in UPSERT_BODY


def test_save_does_not_use_on_conflict_against_partial_index():
    """Sprint 15.1.1 regression guard. Migration 077's index is PARTIAL
    (WHERE ... IS NOT NULL); PostgREST's on_conflict cannot target a partial
    index. So the save path must NOT use `.upsert(..., on_conflict=...)` while
    that index is partial — it silently fails to persist (the P0 bug)."""
    index_is_partial = (
        "CREATE UNIQUE INDEX" in MIG_077
        and "WHERE session_id IS NOT NULL AND question_id IS NOT NULL" in MIG_077
    )
    assert index_is_partial, "migration 077 index assumed partial; re-evaluate if changed"
    assert "on_conflict" not in UPSERT_CODE and ".upsert(" not in UPSERT_CODE, (
        "on_conflict upsert is incompatible with 077's partial unique index "
        "(Sprint 15.1.1 P0). Use read-then-write, or make the index non-partial first."
    )


# ── Resilience + prior-sprint behaviour preserved ──────────────────────────────

def test_core_column_fallback_retry_preserved():
    # P0-2 moved the full→core fallback into _persist_response_with_fallback, but
    # the mechanism is unchanged: _CORE_COLUMNS is passed in and the helper still
    # filters the row down to the core columns before the retry insert.
    assert "_CORE_COLUMNS" in GRADING_PY
    assert "_persist_response_with_fallback" in GRADING_PY
    assert "if k in core_columns" in GRADING_PY


def test_f1_signal_persistence_regression_preserved():
    # Sprint 14.8.1 F1 — saved feedback still merges grading + signals.
    assert "json.dumps({**grading, **signals}" in GRADING_PY


def test_upsert_response_defined_once():
    assert GRADING_PY.count("def _upsert_response") == 1
