"""Sprint 10.1 — pin Guard 6 lemma-equality primary dedup.

Background. Pre-10.1, Guard 6 used three heuristics to catch
duplicates: same-root prefix (≥6 chars), Levenshtein ≤ 2, and
hand-curated semantic clusters. These miss irregular morphology —
"ran" vs "run" is Levenshtein 3, no shared prefix, and not in any
cluster. The user's bank quietly accumulated `ran`, `run`, `running`
as three rows.

Sprint 10.1 adds lemma equality as the PRIMARY check: if the new
item's lemma equals any existing-row lemma (case-insensitive), reject
with `guard_6_lemma_duplicate`. The legacy 3-heuristic fallback still
runs when the lemma equality misses (different lemmas that share a
stem, or rows that don't yet have a lemma stored — backfill catches
those eventually).

The two surfaces here are:

  1. **Lemma path** — `existing_lemmas` and `new_lemma` are both
     provided; equality is checked first. Tests assert the
     `guard_6_lemma_duplicate` token is the failure reason, not the
     legacy `guard_6_levenshtein_duplicate`.

  2. **Fallback path** — one or both of `existing_lemmas` /
     `new_lemma` are None / empty; the function falls through to the
     legacy heuristic block. Tests assert legacy behaviour is
     preserved (no regression for pre-10.1 callers).
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.vocab_guards import run_all_guards


# ── Fixtures ─────────────────────────────────────────────────────────

TRANSCRIPT = (
    "Yesterday I ran to the store and bought some groceries. "
    "Today I run every morning to stay healthy. "
    "Running has become a daily habit for me."
)

ITEM_RAN = {
    "headword": "ran",
    "context_sentence": "Yesterday I ran to the store and bought some groceries.",
    "evidence_substring": "Yesterday I ran to the store",
    "reason": "irregular past tense of run",
    "category": "topic",
}

ITEM_RUNNING = {
    "headword": "running",
    "context_sentence": "Running has become a daily habit for me.",
    "evidence_substring": "Running has become a daily habit",
    "reason": "gerund form of run",
    "category": "topic",
}

ITEM_UNIQUE = {
    "headword": "groceries",
    "context_sentence": "Yesterday I ran to the store and bought some groceries.",
    "evidence_substring": "bought some groceries",
    "reason": "plural noun, distinct lemma",
    "category": "topic",
}


# ── Lemma-equality (primary) path ────────────────────────────────────


def test_lemma_equality_dedups_irregular_past_tense():
    """The whole point of Sprint 10.1 — "ran" must be caught as a
    duplicate of an existing "run" row even though Levenshtein is 3
    and prefix-share is < 6 chars."""
    passed, guard = run_all_guards(
        ITEM_RAN,
        TRANSCRIPT,
        "used_well",
        existing_headwords=["run"],
        existing_lemmas=["run"],
        new_lemma="run",
    )
    assert not passed
    assert guard == "guard_6_lemma_duplicate", (
        f"Expected lemma-equality failure (the primary 10.1 check) but "
        f"got '{guard}' — likely the fallback block is firing first."
    )


def test_lemma_equality_dedups_gerund_form():
    """'running' (lemma=run) collides with existing 'run' (lemma=run).
    Pre-10.1 the same-root heuristic would also catch this (shared
    prefix 'runnin'... well, only 3 chars 'run' so it actually
    wouldn't), so this test specifically pins that the lemma path is
    the one that fires — not Levenshtein."""
    passed, guard = run_all_guards(
        ITEM_RUNNING,
        TRANSCRIPT,
        "used_well",
        existing_headwords=["run"],
        existing_lemmas=["run"],
        new_lemma="run",
    )
    assert not passed
    assert guard == "guard_6_lemma_duplicate"


def test_lemma_equality_is_case_insensitive():
    """Lemma comparison must not depend on case — DB rows may have
    been written with mixed case from the legacy capture path."""
    passed, guard = run_all_guards(
        ITEM_RAN,
        TRANSCRIPT,
        "used_well",
        existing_headwords=["Run"],
        existing_lemmas=["RUN"],  # stored upper for paranoia
        new_lemma="run",
    )
    assert not passed
    assert guard == "guard_6_lemma_duplicate"


def test_lemma_equality_passes_when_lemmas_differ():
    """'groceries' (lemma=grocery) should not collide with existing
    'run' (lemma=run) — distinct lemmas mean the item passes the
    lemma check, and the legacy fallback also passes (groceries and
    run share no root and Levenshtein > 2)."""
    passed, guard = run_all_guards(
        ITEM_UNIQUE,
        TRANSCRIPT,
        "used_well",
        existing_headwords=["run"],
        existing_lemmas=["run"],
        new_lemma="grocery",
    )
    assert passed, f"Distinct lemmas should pass, but blocked on '{guard}'"
    assert guard is None


def test_lemma_equality_handles_multiple_existing_lemmas():
    """The loop must walk the entire existing_lemmas list, not just
    the first entry — irregular dedup can hit a row that isn't the
    most recently inserted one."""
    passed, guard = run_all_guards(
        ITEM_RAN,
        TRANSCRIPT,
        "used_well",
        existing_headwords=["walk", "talk", "run"],
        existing_lemmas=["walk", "talk", "run"],
        new_lemma="run",
    )
    assert not passed
    assert guard == "guard_6_lemma_duplicate"


def test_lemma_equality_ignores_none_entries_in_existing():
    """During the dual-write window, some rows have NULL lemma. The
    loop must skip them (None != "run") without crashing."""
    passed, guard = run_all_guards(
        ITEM_UNIQUE,
        TRANSCRIPT,
        "used_well",
        existing_headwords=["legacy_word"],
        existing_lemmas=[None],  # legacy row, lemma not yet backfilled
        new_lemma="grocery",
    )
    # Should pass — None can't equal "grocery", legacy fallback also
    # passes because "legacy_word" and "groceries" share nothing.
    assert passed
    assert guard is None


# ── Fallback path: legacy heuristics still run ───────────────────────


def test_fallback_when_new_lemma_none():
    """If the caller didn't compute a lemma (e.g. spaCy unavailable),
    Guard 6 must NOT skip dedup — it falls through to the legacy
    prefix / Levenshtein / cluster heuristics. Here 'groceries' and
    'grocerys' (typo) are Levenshtein 1 → legacy catches."""
    item = {
        "headword": "groceries",
        "context_sentence": "Yesterday I ran to the store and bought some groceries.",
        "evidence_substring": "bought some groceries",
        "reason": "noun",
        "category": "topic",
    }
    passed, guard = run_all_guards(
        item,
        TRANSCRIPT,
        "used_well",
        existing_headwords=["grocerys"],
        existing_lemmas=["grocerys"],
        new_lemma=None,  # lemma computation failed / not yet wired
    )
    assert not passed
    assert guard == "guard_6_levenshtein_duplicate", (
        "When new_lemma is None, must fall through to legacy heuristics."
    )


def test_fallback_when_existing_lemmas_empty():
    """If `existing_lemmas` is empty (no rows yet), the lemma block
    short-circuits and the legacy fallback runs against
    `existing_headwords` only."""
    item = {
        "headword": "groceries",
        "context_sentence": "Yesterday I ran to the store and bought some groceries.",
        "evidence_substring": "bought some groceries",
        "reason": "noun",
        "category": "topic",
    }
    passed, guard = run_all_guards(
        item,
        TRANSCRIPT,
        "used_well",
        existing_headwords=["grocerys"],
        existing_lemmas=[],
        new_lemma="grocery",
    )
    assert not passed
    assert guard == "guard_6_levenshtein_duplicate"


def test_fallback_when_both_none_preserves_pre_10_1_behaviour():
    """The fully backward-compatible call shape — no lemma params at
    all. Pre-10.1 callers must continue to work."""
    item = {
        "headword": "utilize",
        "context_sentence": "Yesterday I ran to the store and bought some groceries.",
        "evidence_substring": "Yesterday I ran to the store",
        "reason": "B2 verb",
        "category": "topic",
    }
    # No existing rows → passes everything cleanly.
    passed, guard = run_all_guards(
        item,
        TRANSCRIPT,
        "used_well",
        existing_headwords=[],
    )
    # Guard 1 (headword in context_sentence) would actually fail here
    # since "utilize" isn't in the transcript. Switch to something
    # actually in the transcript.
    item["headword"] = "ran"
    item["evidence_substring"] = "Yesterday I ran to the store"
    passed, guard = run_all_guards(
        item,
        TRANSCRIPT,
        "used_well",
        existing_headwords=[],
    )
    assert passed
    assert guard is None


def test_legacy_fallback_runs_after_lemma_miss():
    """Lemma equality misses (different lemmas) BUT the legacy
    Levenshtein block still catches near-duplicates that share form
    without sharing lemma — e.g. typo variants. Pin that the fallback
    block isn't accidentally short-circuited by the lemma return."""
    item = {
        "headword": "groceries",
        "context_sentence": "Yesterday I ran to the store and bought some groceries.",
        "evidence_substring": "bought some groceries",
        "reason": "noun",
        "category": "topic",
    }
    # Existing row: "grocerys" (typo). Different lemma if spaCy can't
    # normalise the typo, but Levenshtein 1 from "groceries" → legacy
    # catches.
    passed, guard = run_all_guards(
        item,
        TRANSCRIPT,
        "used_well",
        existing_headwords=["grocerys"],
        existing_lemmas=["grocerys"],  # spaCy passes typo through
        new_lemma="grocery",  # spaCy normalises the new item
    )
    assert not passed
    assert guard == "guard_6_levenshtein_duplicate", (
        "Legacy fallback must still fire when lemmas miss but surface "
        "forms are near-duplicates."
    )


# ── Clean-pass smoke ──────────────────────────────────────────────────


def test_unique_item_with_lemma_passes_cleanly():
    """Sanity — a genuinely new item with a distinct lemma and no
    surface-similar existing rows passes through."""
    passed, guard = run_all_guards(
        ITEM_UNIQUE,
        TRANSCRIPT,
        "used_well",
        existing_headwords=["healthy"],
        existing_lemmas=["healthy"],
        new_lemma="grocery",
    )
    assert passed
    assert guard is None
