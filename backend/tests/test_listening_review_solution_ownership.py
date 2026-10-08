"""Review the actual L001 collision without letting foreign copies win."""
from copy import deepcopy
import json
from pathlib import Path
from unittest.mock import patch

import pytest

from routers import listening
from tests.test_mock_frozen_review_assembly import DB, snapshot


FIXTURE = json.loads((Path(__file__).parent / "fixtures" /
                      "listening_l001_q35_foreign_solution.json").read_text())


@pytest.mark.parametrize("reverse", [False, True])
@pytest.mark.parametrize("frozen", [False, True])
def test_q35_uses_its_owner_solution_in_either_db_order_and_frozen_context(reverse, frozen):
    marks = deepcopy(FIXTURE["exercises"])
    if reverse:
        marks.reverse()
    sources = [{"id": "s4", "section_num": 4, "transcript": "Corrected native transcript"}]
    paper = {"id": "t1", "test_id": "L001-REV01", "metadata": {}}
    saved = {"id": "a1", "test_id": "t1", "status": "submitted", "score": 1,
             "grading_details": [{"q_num": 35, "expected": "arc", "correct": True,
                                  "user_answer": "arc"}]}
    tables = {"listening_tests": [paper], "listening_content": sources,
              "listening_exercises": marks}
    if frozen:
        saved["paper_revision"] = 2
        tables["mock_paper_attempt_snapshots"] = [snapshot("listening", marks, sources, paper)]
    db = DB(tables)
    before = deepcopy(db.tables), deepcopy(saved)
    with patch.object(listening, "supabase_admin", db), \
         patch("services.mock_correction_service.attach_web_explanations",
               return_value={"available": False}):
        result = listening._assemble_listening_review(saved, "a1")
    item = result["review"][0]
    owner = next(row for row in marks if row["id"] == "6662cd3e-f641-5f00-aaaf-867cc0b44563")
    assert item["solution"] == owner["payload"]["solutions"]["35"]
    assert "The first city to install electric street lighting" not in item["solution"]["script"]
    assert "New York/London" not in str(item["solution"])
    assert item["expected"] == "arc" and result["score"] == 1
    assert (db.tables, saved) == before


def test_foreign_window_and_anchor_do_not_override_the_question_owner():
    marks = deepcopy(FIXTURE["exercises"])
    owner = next(row for row in marks if row["id"] == "6662cd3e-f641-5f00-aaaf-867cc0b44563")
    foreign = next(row for row in marks if row["id"] != owner["id"])
    foreign["payload"]["audio_windows"]["35"] = {"start": 9999, "end": 10000, "section": "S4"}
    foreign["payload"]["transcript_anchors"]["35"] = 9999
    db = DB({"listening_tests": [{"id": "t1", "metadata": {}}],
             "listening_content": [{"id": "s4", "section_num": 4}],
             "listening_exercises": [owner, foreign]})
    saved = {"id": "a1", "test_id": "t1", "status": "submitted",
             "grading_details": [{"q_num": 35, "expected": "arc"}]}
    with patch.object(listening, "supabase_admin", db), \
         patch("services.mock_correction_service.attach_web_explanations",
               return_value={"available": False}):
        item = listening._assemble_listening_review(saved, "a1")["review"][0]
    assert item["audio_window"] == owner["payload"]["audio_windows"]["35"]
    assert item["transcript_anchor"] == owner["payload"]["transcript_anchors"]["35"]


@pytest.mark.parametrize("frozen", [False, True])
@pytest.mark.parametrize("with_questions", [False, True])
def test_legacy_answer_map_owns_slots_in_current_and_frozen_review(frozen, with_questions):
    marks = deepcopy(FIXTURE["exercises"])
    owner = next(row for row in marks if row["id"] == "6662cd3e-f641-5f00-aaaf-867cc0b44563")
    owner["payload"]["answers"] = {
        str(row["q_num"]): row["answer"] for row in owner["payload"]["answers"]
    }
    if not with_questions:
        owner["payload"].pop("questions", None)
    sources = [{"id": "s4", "section_num": 4, "transcript": "Corrected native transcript"}]
    paper = {"id": "t1", "test_id": "L001-REV01", "metadata": {}}
    saved = {"id": "a1", "test_id": "t1", "status": "submitted", "score": 1,
             "grading_details": [{"q_num": 35, "expected": "arc", "correct": True,
                                  "user_answer": "arc"}]}
    tables = {"listening_tests": [paper], "listening_content": sources,
              "listening_exercises": marks}
    if frozen:
        saved["paper_revision"] = 2
        tables["mock_paper_attempt_snapshots"] = [snapshot("listening", marks, sources, paper)]
    db = DB(tables)
    before = deepcopy(db.tables), deepcopy(saved)
    with patch.object(listening, "supabase_admin", db), \
         patch("services.mock_correction_service.attach_web_explanations",
               return_value={"available": False}):
        result = listening._assemble_listening_review(saved, "a1")
    item = result["review"][0]
    assert item["solution"] == owner["payload"]["solutions"]["35"]
    assert item["audio_window"] == owner["payload"]["audio_windows"]["35"]
    assert item["expected"] == "arc" and result["score"] == 1
    assert (db.tables, saved) == before
