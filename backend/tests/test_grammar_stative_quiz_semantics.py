"""Academic regression labels through the real bank parser and atomic payload.

This is an offline import: the RPC transport is captured, never sent to a DB.
It does not certify a currently published bank or mutate learner history.
"""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from services import quiz_import
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


def import_to_captured_payload(monkeypatch, code):
    captured = []

    class OfflineTransport:
        def table(self, *_args, **_kwargs):
            raise AssertionError("No DB table read is allowed in this offline import")

        def rpc(self, name, arguments):
            assert name == "import_quiz_bank_atomic"
            captured.append(arguments)
            return SimpleNamespace(execute=lambda: SimpleNamespace(data=[{
                "bank_id": "00000000-0000-4000-8000-000000000001",
                "written": len(arguments["p_rows"]), "is_published": False,
            }]))

    monkeypatch.setattr(quiz_import, "supabase_admin", OfflineTransport())
    monkeypatch.setattr(quiz_import, "_topic_skill_area", lambda _topic: "grammar")
    monkeypatch.setattr(quiz_import, "_resolve_audio_map", lambda _topic: {})
    result = quiz_import.import_quiz_file(
        (BANK_DIR / f"{code}.md").read_text(),
        topic_id="00000000-0000-4000-8000-000000000002", dry_run=False,
        publish_state="unpublished",
    )
    assert result["summary"]["errors"] == 0, result["validation_errors"]
    assert len(captured) == 1
    assert captured[0]["p_publish_state"] == "unpublished"
    assert captured[0]["p_payload"]["code"] == code
    return {row["qid"]: row for row in captured[0]["p_rows"]}


@pytest.mark.parametrize("code,qid,valid", LABELS)
def test_academic_boolean_label_survives_parser_integer_storage_and_grade(monkeypatch, code, qid, valid):
    question = import_to_captured_payload(monkeypatch, code)[qid]
    assert type(question["answer"]) is int  # boolean persisted as 1/0, not index guessing
    assert question["answer"] == int(valid)
    assert grade_attempt(str(int(valid)), question["answer"]) is True
    assert grade_attempt(str(int(not valid)), question["answer"]) is False
    assert _correct_answer_text(question) == ("Đúng" if valid else "Sai")


def test_wanting_is_valid_ppc_choice_without_a_second_valid_distractor(monkeypatch):
    question = import_to_captured_payload(monkeypatch, "G-tenses-present-perfect-continuous")["ppc_stative_i1"]
    options = question["options"]
    assert options[question["answer"]] == "has been wanting"
    assert "has wanted" not in options  # also grammatical: not a wrong distractor
    assert grade_attempt(str(options.index("has been wanting")), question["answer"]) is True


def test_passive_known_example_keeps_its_valid_answer_after_qualified_explanation(monkeypatch):
    question = import_to_captured_payload(monkeypatch, "G-sentence-structures-passive-voice")["pv_err_i1"]
    assert question["options"][question["answer"]] == "The truth is known by everyone."
    assert grade_attempt(str(question["answer"]), question["answer"]) is True
