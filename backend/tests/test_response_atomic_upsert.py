"""
Sprint 14.8.2 — Codex audit F3 code swap: atomic upsert for response saves.

Sprint 14.8.1 shipped migration 077 (partial UNIQUE index on
responses(session_id, question_id)); the code swap was deferred until the index
was live in prod (verified 2026-05-24). This pins the swap at the source: the
inline `_upsert_response` closure must now use a single atomic upsert
(ON CONFLICT) instead of the race-prone select-then-update/insert.

Source-scan sentinels (no live DB; the closure captures session_id/question_id
from its enclosing scope and isn't importable — Andy decision: source-scan +
mocked, consistent with the repo's zero-dependency gate). The actual race-safety
is enforced by the DB UNIQUE index from migration 077.
"""

from pathlib import Path

_BACKEND = Path(__file__).parent.parent
GRADING_PY = (_BACKEND / "routers" / "grading.py").read_text(encoding="utf-8")

# The `_upsert_response` closure body: from its `def` to the next 8-space-indented
# statement (`        try:`) that follows it in the endpoint.
_start = GRADING_PY.index("def _upsert_response")
_end = GRADING_PY.index("\n        try:", _start)
UPSERT_BODY = GRADING_PY[_start:_end]


# ── F3: the swap itself ─────────────────────────────────────────────────────────

def test_upsert_response_uses_atomic_upsert():
    assert ".upsert(" in UPSERT_BODY, "_upsert_response must use .upsert() (F3)"


def test_upsert_response_on_conflict_is_session_and_question():
    assert 'on_conflict="session_id,question_id"' in UPSERT_BODY


def test_upsert_response_no_longer_reads_then_writes():
    # The old race-prone pattern (select id, then update-by-id or insert) is gone.
    assert ".select(" not in UPSERT_BODY, "read-then-write .select() must be removed"
    assert ".update(" not in UPSERT_BODY, "update-by-id path must be removed"
    assert ".insert(" not in UPSERT_BODY, "separate insert path must be removed"


def test_upsert_response_still_returns_row_id():
    # The downstream grammar_recommendations / pronunciation steps need response_id.
    assert 'res.data[0]["id"]' in UPSERT_BODY


def test_upsert_payload_excludes_audit_fields():
    # L5 — created_at / regrade_metadata are not written, so DB default (insert) /
    # existing value (update) is preserved. They must not appear in the saved row.
    assert '"created_at"' not in GRADING_PY
    assert '"regrade_metadata"' not in GRADING_PY


# ── Resilience + prior-sprint behaviour preserved ───────────────────────────────

def test_core_column_fallback_retry_preserved():
    # The schema-tolerant retry (core columns only) that protects unmigrated envs
    # must remain — the upsert swap does not remove it.
    assert "_CORE_COLUMNS" in GRADING_PY
    assert "if k in _CORE_COLUMNS" in GRADING_PY


def test_f1_signal_persistence_regression_preserved():
    # Sprint 14.8.1 F1 — the saved feedback still merges grading + signals.
    assert "json.dumps({**grading, **signals}" in GRADING_PY


def test_upsert_response_defined_once():
    assert GRADING_PY.count("def _upsert_response") == 1
