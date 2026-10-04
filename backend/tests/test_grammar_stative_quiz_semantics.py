"""Academic regression labels through the reviewed source parser and row payload.

This remains offline: all DB transport is forbidden. Managed policy banks
are parsed through the revision source contract; general import must refuse them.
It does not certify a currently published bank or mutate learner history.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from services import quiz_import
from services.grammar_quiz_revision_source import parse_reviewed_source
from services.quiz_service import _correct_answer_text, grade_attempt


BANK_DIR = Path(__file__).resolve().parents[2] / "docs/grammar-quiz-banks"
# Independent reviewed grammatical labels, rather than mirroring boolean data.
LABELS = [
    ("G-tenses-present-simple", "ps_vspc_a1", True),  # loving a current experience
    ("G-tenses-present-continuous", "pc_stative_a1", True),
    ("G-tenses-present-continuous", "pc_stative_a2", False),  # is want: missing -ing
    ("G-tenses-past-continuous", "pc_stative_a1", True),
    ("G-tenses-past-continuous", "pc_stative_a2", False),  # knowing the truth
    ("G-tenses-present-perfect-continuous", "ppc_stative_a1", False),
    ("G-tenses-present-perfect-continuous", "ppc_stative_a2", True),  # wanting over time
    ("G-parts-of-speech-verbs", "verb_stat_a1", True),
]


def reviewed_payload(monkeypatch, code):
    class OfflineTransport:
        def table(self, *_args, **_kwargs):
            raise AssertionError("No DB table read is allowed in this offline parser")

        def rpc(self, *_args, **_kwargs):
            raise AssertionError("No DB RPC is allowed in this offline parser")

    monkeypatch.setattr(quiz_import, "supabase_admin", OfflineTransport())
    raw = (BANK_DIR / f"{code}.md").read_text()
    parsed = parse_reviewed_source(code, raw)
    assert parsed.metadata["code"] == code
    # These sources now have a nonempty managed text policy. General import
    # must fail before transport, rather than silently replace the old bank.
    refused = quiz_import.import_quiz_file(
        raw, topic_id="00000000-0000-4000-8000-000000000002",
        dry_run=False, publish_state="unpublished",
    )
    assert refused["committed_bank_id"] is None
    assert refused["summary"]["errors"] == 1
    assert refused["validation_errors"][0]["field"] == "text_match_by_qid"
    return {row["qid"]: row for row in parsed.questions}


@pytest.mark.parametrize("code,qid,valid", LABELS)
def test_academic_boolean_label_survives_parser_integer_storage_and_grade(monkeypatch, code, qid, valid):
    question = reviewed_payload(monkeypatch, code)[qid]
    assert type(question["answer"]) is int  # boolean persisted as 1/0, not index guessing
    assert question["answer"] == int(valid)
    assert grade_attempt(str(int(valid)), question["answer"]) is True
    assert grade_attempt(str(int(not valid)), question["answer"]) is False
    assert _correct_answer_text(question) == ("Đúng" if valid else "Sai")


def test_wanting_is_valid_ppc_choice_without_a_second_valid_distractor(monkeypatch):
    question = reviewed_payload(monkeypatch, "G-tenses-present-perfect-continuous")["ppc_stative_i1"]
    options = question["options"]
    assert options[question["answer"]] == "has been wanting"
    assert "has wanted" not in options  # also grammatical: not a wrong distractor
    assert grade_attempt(str(options.index("has been wanting")), question["answer"]) is True


def test_passive_known_example_keeps_its_valid_answer_after_qualified_explanation(monkeypatch):
    question = reviewed_payload(monkeypatch, "G-sentence-structures-passive-voice")["pv_err_i1"]
    assert question["options"][question["answer"]] == "The truth is known by everyone."
    assert grade_attempt(str(question["answer"]), question["answer"]) is True
