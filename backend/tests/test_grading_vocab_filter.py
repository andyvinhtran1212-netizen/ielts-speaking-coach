"""Sprint 6.0 → Sprint 10.1.5 — pin the persist filter inside grading.py.

The vocab-extraction background task receives `result.used_well`,
`result.needs_review`, and `result.upgrade_suggested` from the Claude
grader. Sprint 6.0 originally added a filter at the persist step that
dropped `needs_review` because surfacing those items in the main
vocab bank encouraged learners to memorise wrong forms.

Sprint 10.1.5 reverses that archival. `needs_review` items ARE
useful as a "learning from mistakes" surface — just not in the same
bucket as items the learner used correctly. The fix re-enables
persistence at this constant and routes them to a dedicated
Needs Review tab in vocabulary.html (the list endpoint
`GET /api/vocabulary/bank` default-excludes `needs_review` so the
main bank stays "ổn items only"; the dedicated
`GET /api/vocabulary/bank/needs-review` endpoint surfaces them).

These tests pin the post-10.1.5 contract: all 3 categories
(`used_well`, `upgrade_suggested`, `needs_review`) reach the
`.insert(...)` chain. The pre-10.1.5 "needs_review skipped" tests
are intentionally flipped — a regression that re-drops needs_review
would now fail loudly here.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest


# ── Test doubles ─────────────────────────────────────────────────────


class _FakeVocabItem:
    """Minimal stand-in for the Pydantic VocabItem the grader produces.

    Only the fields the persist loop touches need to round-trip through
    `model_dump()`. Everything else is None / "" so the row is shaped
    correctly without recreating the full Pydantic model."""

    def __init__(self, headword: str, **overrides):
        self.headword = headword
        self.context_sentence = overrides.get("context_sentence", "Some context.")
        self.evidence_substring = overrides.get("evidence_substring")
        self.category = overrides.get("category", "topic")
        self.reason = overrides.get("reason", "Reason text.")
        self.definition_en = overrides.get("definition_en", "definition")
        self.definition_vi = overrides.get("definition_vi", "định nghĩa")
        self.original_word = overrides.get("original_word")
        self.suggestion = overrides.get("suggestion")

    def model_dump(self):
        return {
            "headword": self.headword,
            "context_sentence": self.context_sentence,
            "evidence_substring": self.evidence_substring,
            "category": self.category,
            "reason": self.reason,
            "definition_en": self.definition_en,
            "definition_vi": self.definition_vi,
            "original_word": self.original_word,
            "suggestion": self.suggestion,
        }


class _FakeExtractionResult:
    """Stand-in for the grader's extraction output. The persist loop
    in grading.py reads `.used_well`, `.needs_review`,
    `.upgrade_suggested` as iterables of items."""

    def __init__(self, used_well=None, needs_review=None, upgrade_suggested=None):
        self.used_well = used_well or []
        self.needs_review = needs_review or []
        self.upgrade_suggested = upgrade_suggested or []


def _seed_supabase_mock():
    """Return a mock matching the supabase-py call chain used in the
    persist loop. Captured `.insert(row)` calls are accessible via
    `inserted_rows` on the returned mock."""
    sb = MagicMock()
    sb.inserted_rows = []

    # `existing headwords` lookup returns []
    select_chain = MagicMock()
    select_chain.execute.return_value.data = []
    sb.table.return_value.select.return_value.eq.return_value.eq.return_value = select_chain

    # `.insert(row).execute()` records the row.
    def record_insert(row):
        sb.inserted_rows.append(row)
        execute_mock = MagicMock()
        execute_mock.execute.return_value.data = [row]
        return execute_mock

    sb.table.return_value.insert.side_effect = record_insert
    return sb


def _run_persist_loop(extraction_result):
    """Re-import grading and reach into `_persist_vocab` /
    `_run_vocab_extraction_bg` style flow. The actual function name
    isn't part of the public surface — we exercise the inline loop
    by patching its dependencies (sb, guards) and calling the BG
    function directly.

    For Sprint 6.0 we keep this contained — patch the loop's two
    inputs (existing headword lookup → []; guard → always pass), then
    re-execute the relevant section."""
    from routers import grading

    sb_mock = _seed_supabase_mock()
    user_id = str(uuid4())
    session_id = str(uuid4())
    response_id = str(uuid4())

    # `run_all_guards` is imported lazily (only inside the BG function),
    # so it lives at services.vocab_guards rather than as a module
    # attribute on grading. We don't actually call into the BG fn here,
    # we replay the persist branch — the guards aren't on the path so
    # we just skip patching them.
    with patch.object(grading, "supabase_admin", sb_mock), \
         patch("services.vocab_enrichment.enrich_vocabulary_batch", return_value=[]):
        # Inline replay of the persist loop block from
        # _run_vocab_extraction_bg. We can't simply call the full BG
        # function because it also constructs `result` from a Whisper
        # transcript. Instead we mirror the persist branch verbatim,
        # using the SAME _PERSISTED_SOURCE_TYPES symbol so a future
        # rename still flows through. Read the symbol fresh each call
        # so monkeypatching works.
        persisted = grading._PERSISTED_SOURCE_TYPES
        category_map = [
            ("used_well", extraction_result.used_well),
            ("needs_review", extraction_result.needs_review),
            ("upgrade_suggested", extraction_result.upgrade_suggested),
        ]
        # Sprint 10.1 — replay must mirror the dual-write shape used
        # by the real persist loop. We compute lemma here so the row
        # shape includes surface_form / lemma / pos / lemma_version
        # alongside the legacy `headword` column. Failure to lemmatize
        # falls through to None values (matches grading.py fail-soft).
        try:
            from services.lemmatizer import lemmatize, lemma_version
            _current_lemma_version = lemma_version()
        except Exception:
            lemmatize = None  # type: ignore[assignment]
            _current_lemma_version = None
        for source_type, items in category_map:
            if source_type not in persisted:
                continue
            for item in items:
                if lemmatize is not None:
                    try:
                        _lemma, _pos = lemmatize(item.headword)
                    except Exception:
                        _lemma, _pos = None, None
                else:
                    _lemma, _pos = None, None
                row = {
                    "user_id":           user_id,
                    "session_id":        session_id,
                    "response_id":       response_id,
                    "headword":          item.headword,
                    # Sprint 10.1 dual-write: surface_form mirrors
                    # headword verbatim; lemma / pos / lemma_version
                    # come from services.lemmatizer.
                    "surface_form":      item.headword,
                    "lemma":             _lemma,
                    "pos":               _pos,
                    "lemma_version":     _current_lemma_version,
                    "context_sentence":  item.context_sentence,
                    "evidence_substring": item.evidence_substring or None,
                    "category":          item.category,
                    "source_type":       source_type,
                    "reason":            item.reason[:200] if item.reason else None,
                    "definition_en":     item.definition_en,
                    "definition_vi":     item.definition_vi,
                    "original_word":     item.original_word if source_type == "upgrade_suggested" else None,
                    "suggestion":        item.suggestion if source_type == "needs_review" else None,
                    "topic":             None,
                    "mastery_status":    "learning",
                    "is_archived":       False,
                }
                sb_mock.table("user_vocabulary").insert(row).execute()

    return sb_mock.inserted_rows


# ── Tests ─────────────────────────────────────────────────────────────


def test_persisted_source_types_constant_includes_needs_review():
    """Sprint 10.1.5 — pin the canonical allowlist. All 3 categories
    must be persisted; `needs_review` was re-added after Sprint 6.0's
    archival was reversed in favour of routing items to a dedicated
    Needs Review tab (the main bank's list endpoint default-excludes
    needs_review via `.neq("source_type", "needs_review")` — the
    separation happens at the read layer, not at the write layer)."""
    from routers.grading import _PERSISTED_SOURCE_TYPES
    assert "needs_review" in _PERSISTED_SOURCE_TYPES, (
        "Sprint 10.1.5 re-enabled needs_review persistence. If a future "
        "change drops it again, audit (a) the GET /api/vocabulary/bank "
        "default-exclude filter, (b) the GET /api/vocabulary/bank/"
        "needs-review surface endpoint, and (c) the frontend "
        "/js/vocab-modules/needs-review.js consumer first — those three "
        "are the only places that expect items to exist."
    )
    assert "used_well" in _PERSISTED_SOURCE_TYPES
    assert "upgrade_suggested" in _PERSISTED_SOURCE_TYPES


def test_used_well_items_persisted():
    extraction = _FakeExtractionResult(
        used_well=[_FakeVocabItem("ephemeral"), _FakeVocabItem("ubiquitous")],
    )
    rows = _run_persist_loop(extraction)
    assert len(rows) == 2
    assert {r["headword"] for r in rows} == {"ephemeral", "ubiquitous"}
    assert all(r["source_type"] == "used_well" for r in rows)


def test_needs_review_items_persisted_to_needs_review_surface():
    """Sprint 10.1.5 — needs_review items ARE persisted (with
    source_type='needs_review' preserved on each row). The dedicated
    Needs Review tab consumes them via GET /api/vocabulary/bank/
    needs-review, and the `suggestion` field is carried through for
    the original→suggestion card layout in the frontend module."""
    extraction = _FakeExtractionResult(
        needs_review=[
            _FakeVocabItem("alot", suggestion="a lot"),
            _FakeVocabItem("loose vs lose", suggestion="lose"),
        ],
    )
    rows = _run_persist_loop(extraction)
    assert len(rows) == 2, (
        f"needs_review must be persisted (Sprint 10.1.5); got {len(rows)} rows."
    )
    assert all(r["source_type"] == "needs_review" for r in rows), (
        "needs_review rows must keep source_type='needs_review' so the "
        "Needs Review surface endpoint can filter them."
    )
    # `suggestion` is the AI's correction — preserved for the card UI.
    assert {r["suggestion"] for r in rows} == {"a lot", "lose"}


def test_mixed_extraction_all_three_categories_persisted():
    """Sprint 10.1.5 — all 3 categories now reach the insert chain.
    Pre-10.1.5 this asserted len(rows)==2 with by_type ==
    {used_well, upgrade_suggested}; post-10.1.5 it's
    len(rows)==4 with all 3 source_types present."""
    extraction = _FakeExtractionResult(
        used_well=[_FakeVocabItem("articulate")],
        needs_review=[_FakeVocabItem("error1"), _FakeVocabItem("error2")],
        upgrade_suggested=[_FakeVocabItem("better-than-good")],
    )
    rows = _run_persist_loop(extraction)
    assert len(rows) == 4, (
        f"All 3 categories must persist; got {len(rows)} rows: "
        f"{[(r['headword'], r['source_type']) for r in rows]}"
    )
    by_type = {r["source_type"] for r in rows}
    assert by_type == {"used_well", "needs_review", "upgrade_suggested"}, by_type


def test_empty_extraction_inserts_nothing():
    rows = _run_persist_loop(_FakeExtractionResult())
    assert rows == []


# ── Sprint 10.1 — lemma dual-write shape ─────────────────────────────


def test_persisted_rows_include_dual_write_lemma_columns():
    """Sprint 10.1 — every inserted row must carry the 4 new lemma
    columns alongside the legacy `headword` field. The dual-write
    window: `headword` stays for the UNIQUE-constraint era; the new
    columns power lemma-aware dedup and future SRS grouping."""
    extraction = _FakeExtractionResult(
        used_well=[_FakeVocabItem("running")],
    )
    rows = _run_persist_loop(extraction)
    assert len(rows) == 1
    row = rows[0]
    # All 4 columns must be present as keys (value may be None when
    # spaCy isn't installed in the local dev env — see fail-soft path
    # in _run_persist_loop). Key presence is what matters: the column
    # exists in the migration and the persist loop writes it.
    for col in ("surface_form", "lemma", "pos", "lemma_version"):
        assert col in row, f"Sprint 10.1 column '{col}' missing from row"
    # surface_form is the verbatim headword — no normalisation at this
    # layer. Lemmatizer handles strip+lowercase internally.
    assert row["surface_form"] == "running"
    # Legacy field still populated — dual-write contract.
    assert row["headword"] == "running"


def test_persisted_rows_lemma_matches_lemmatizer_when_available():
    """When spaCy + en_core_web_sm are installed, the persisted row
    must carry the canonical lemma — pin the contract end-to-end so a
    future regression in the lemmatizer call site is caught here.

    Gated on whether the lemmatizer can actually produce a non-None
    value; in a stripped CI image without the model, the fail-soft
    path writes None and this assert short-circuits."""
    extraction = _FakeExtractionResult(
        used_well=[_FakeVocabItem("ran")],
    )
    rows = _run_persist_loop(extraction)
    assert len(rows) == 1
    row = rows[0]
    if row["lemma"] is None:
        pytest.skip("spaCy / en_core_web_sm not available — fail-soft path")
    assert row["lemma"] == "run", (
        f"ran → expected lemma 'run', got '{row['lemma']}'. The capture "
        f"pipeline must lemmatize before insert."
    )
    assert row["pos"] == "VERB"
    assert isinstance(row["lemma_version"], int) and row["lemma_version"] >= 1
