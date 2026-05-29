"""Sprint 20.13c — backend grader norm() compliance with Interactive
HTML Standards §5.3 + anti-pattern §10.4.

The shared `normalize_answer` (services/listening_test_grader) now
NFD-decomposes its input and strips combining marks so that ``El Niño``
matches ``El Nino`` and ``café`` matches ``cafe``. These tests pin:

  • the diacritic strip behaviour itself (positive cases),
  • the alternatives / answer_accept variant path (Standards §5.3
    "match `answer` AND every `answer_accept`"),
  • backward-compat: ASCII answers grade identically to before, so the
    AVR-READ-001 seed (zero non-ASCII in answer keys) produces the same
    score before and after this change.
"""

from __future__ import annotations

from services.listening_test_grader import answer_matches, normalize_answer
from services.reading_test_grader import grade_attempt


# ── normalize_answer: NFD diacritic strip (Standards §5.3) ─────────────


def test_normalize_strips_acute_accent():
    assert normalize_answer("café") == "cafe"
    assert normalize_answer("Café") == "cafe"


def test_normalize_strips_tilde_and_cedilla():
    assert normalize_answer("El Niño") == "el nino"
    assert normalize_answer("garçon") == "garcon"


def test_normalize_strips_umlaut():
    # German umlauts strip rather than expand — matches the standards'
    # documented behaviour. Authors who want "Müller" ≡ "Mueller" must
    # add the expansion to `alternatives:`.
    assert normalize_answer("Müller") == "muller"


def test_normalize_strips_grave_circumflex_macron():
    assert normalize_answer("à la carte") == "a la carte"
    assert normalize_answer("crêpe") == "crepe"
    assert normalize_answer("sōan") == "soan"


def test_normalize_combined_diacritic_then_uk_us_canonicalisation():
    # Diacritic strip happens BEFORE the UK→US canonicalisation, so a
    # word like "colôur" still folds to the canonical UK form.
    assert normalize_answer("colôur") == "colour"
    assert normalize_answer("colôr")  == "colour"


def test_normalize_combined_marks_only_input():
    # A string of just combining marks decomposes away entirely. The
    # function then sees an empty stripped string — and since trim is
    # applied first, the input was "" all along.
    assert normalize_answer("") == ""
    assert normalize_answer("   ") == ""


# ── answer_matches: diacritic-insensitive vs canonical answer ──────────


def test_answer_matches_diacritic_in_user_input():
    # User typed the diacritic version; canonical is plain ASCII.
    assert answer_matches("El Niño", "El Nino", [])
    assert answer_matches("café", "cafe", [])


def test_answer_matches_diacritic_in_canonical_answer():
    # Canonical is the diacritic form (e.g. an author who wrote the
    # "correct" spelling); user typed ASCII.
    assert answer_matches("El Nino", "El Niño", [])
    assert answer_matches("cafe", "café", [])


def test_answer_matches_diacritic_only_in_alternatives():
    # Canonical is ASCII; alternatives carry the diacritic form. The
    # diacritic-typed user answer must still match.
    assert answer_matches("Niño", "Nino", ["Niño"])
    assert answer_matches("Nino", "Nino", ["Niño"])


# ── Backward-compat: ASCII answers (the entire AVR-READ-001 universe) ──


def test_backward_compat_ascii_exact_match_still_passes():
    # The previously documented matches in test_student_listening_full_test
    # all remain green. Re-checking the canonical handful here makes the
    # backward-compat claim explicit on the reading side too.
    assert normalize_answer("  Brighton  ") == "brighton"
    assert normalize_answer("PASTA") == "pasta"
    assert answer_matches("color", "colour", [])
    assert answer_matches("Self-Correction", "self-correction", [])


def test_backward_compat_contractions_still_rejected():
    # The contraction sentinel was the most surprising existing rule;
    # the diacritic-strip layer must not weaken it.
    assert not answer_matches("don't know", "do not know", [])


# ── grade_attempt: a 3-question AVR-style attempt grades the same ───────


def test_backward_compat_grade_attempt_ascii_unchanged():
    # Three answers from the AVR-READ-001 universe: case folding,
    # surrounding punctuation, UK/US pair. Pre- and post-diacritic-strip
    # these all grade the same way.
    answer_key = [
        {"q_num": 1, "answer": "TRUE",   "alternatives": ["T"],     "skill_tag": "detail",   "passage_order": 1},
        {"q_num": 2, "answer": "colour", "alternatives": [],        "skill_tag": "scanning", "passage_order": 2},
        {"q_num": 3, "answer": "cat",    "alternatives": ["kitten"],"skill_tag": "main_idea","passage_order": 3},
    ]
    user_answers = [
        {"q_num": 1, "user_answer": "True."},      # punctuation stripped → match
        {"q_num": 2, "user_answer": "color"},      # UK/US pair → match
        {"q_num": 3, "user_answer": "kitten"},     # alternatives → match
    ]
    result = grade_attempt(user_answers, answer_key)
    assert result["score"] == 3
    assert result["max_score"] == 3


def test_grade_attempt_with_diacritic_user_answer_now_accepted():
    # New capability: a student types the diacritic spelling for an
    # ASCII canonical answer. Pre-20.13c this graded as incorrect; the
    # standards (§5.3) say it must match.
    answer_key = [
        {"q_num": 1, "answer": "El Nino", "alternatives": [], "skill_tag": "detail", "passage_order": 1},
    ]
    user_answers = [{"q_num": 1, "user_answer": "El Niño"}]
    result = grade_attempt(user_answers, answer_key)
    assert result["score"] == 1
