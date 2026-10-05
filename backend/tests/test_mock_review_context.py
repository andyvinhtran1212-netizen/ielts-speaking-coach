"""Immutable original versus explicit historical fallback; no regrading."""
from copy import deepcopy
import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException
import pytest

from services.mock_review_context import (
    context_reference, load_review_snapshot, provenance, question_context,
    attach_review_web_explanations,
)


class DB:
    def __init__(self, rows): self.rows=rows; self.calls=[]
    def table(self,name): self.calls.append(name); return self
    def select(self,*_): return self
    def eq(self,*_): return self
    def limit(self,*_): return self
    def execute(self): return SimpleNamespace(data=self.rows)


def source():
    return {"skill":"reading","attempt_id":"original-attempt","paper_id":"paper1","paper_revision":7,
        "policy_revision":3,"paper_row":{"title":"Original paper"},
        "source_rows":[{"id":"p1","body_markdown":"Original passage"}],
        "marking_rows":[{"id":"q20","q_num":20,"prompt":"Original stem",
            "payload":{"options":[{"id":"A","text":"Original option"}],
                "template":None,"solution":{"steps":"Original rationale"},
                "response_policy":{"accepted_answers":["protected"]}}}]}


def test_private_frozen_context_unchanged_by_live_source_edits_or_deletes():
    original=source(); before=deepcopy(original)
    db=DB([original]); attempt={"id":"original-attempt","test_id":"paper1","paper_revision":7,
        "score":1,"answers":[{"q_num":20,"user_answer":"A"}]}
    frozen=load_review_snapshot(db,"reading",attempt)
    display=question_context(frozen["marking_rows"][0],frozen)
    assert display["options"] == [{"id":"A","text":"Original option"}]
    assert "response_policy" not in display and "accepted_answers" not in display
    assert display["template"] is None
    assert display["context_provenance"]["template"] == "submission_snapshot"
    assert display["context_provenance"]["instructions"] == "unavailable"
    # Returned mutable structures cannot mutate the protected source in-process.
    display["options"][0]["text"]="changed"
    assert original==before and attempt["score"]==1 and attempt["answers"][0]["user_answer"]=="A"
    assert db.calls == ["mock_paper_attempt_snapshots"]
    assert context_reference(frozen)["possibly_changed"] is False
    assert len(context_reference(frozen)["context_sha256"])==64


def test_legacy_is_not_captured_and_missing_frozen_context_never_falls_back():
    db=DB([])
    assert load_review_snapshot(db,"reading",{"id":"old","paper_revision":None}) is None
    assert not db.calls
    assert context_reference(None)["possibly_changed"] is True
    with pytest.raises(HTTPException) as error:
        load_review_snapshot(db,"reading",{"id":"new","paper_revision":7})
    assert error.value.status_code==503 and db.calls==["mock_paper_attempt_snapshots"]


def test_wrong_snapshot_identity_or_revision_is_not_used():
    for field,value in [("skill","listening"),("attempt_id","other"),("paper_revision",8)]:
        row=source(); row[field]=value
        with pytest.raises(HTTPException) as error:
            load_review_snapshot(DB([row]),"reading",{"id":"original-attempt","test_id":"paper1","paper_revision":7})
        assert error.value.status_code==503


def test_intentionally_empty_snapshot_stays_empty_and_legacy_rationale_is_per_field():
    row=source(); row["source_rows"]=[]; row["marking_rows"]=[]
    frozen=load_review_snapshot(DB([row]),"reading",{"id":"original-attempt","test_id":"paper1","paper_revision":7})
    assert frozen["source_rows"]==[] and frozen["marking_rows"]==[]
    assert provenance("",None,persisted=True)=="submission_snapshot"
    assert provenance(None,None,present=False)=="unavailable"
    assert provenance("Current stem",None)=="current_content_fallback"
    assert provenance("",frozen)=="submission_snapshot"


def test_current_web_publication_cannot_replace_frozen_original_rationale():
    def current(_skill,_attempt,review,**_):
        for item in review: item["web_explanation_object"]={"rationale":"Current rewritten prose"}
        return {"available":True}
    original=source(); original["scoring_override_rows"]=[
        {"question_number":20,"payload":{"rationale":"Original accepted prose"}}]
    review=[{"q_num":20},{"q_num":21}]
    with patch("services.mock_correction_service.attach_web_explanations",side_effect=current):
        attach_review_web_explanations("reading",{},review,original)
    assert review[0]["web_explanation_object"]["rationale"]=="Original accepted prose"
    assert review[0]["context_provenance"]["web_explanation_object"]=="submission_snapshot"
    assert "web_explanation_object" not in review[1]
    assert review[1]["context_provenance"]["web_explanation_object"]=="unavailable"


def test_authored_flow_bank_and_display_metadata_preserve_presence():
    question={"payload":{"metadata":{"match_options":["A water","B heat"],
        "flow_direction":"vertical","response_policy":{"accepted_answers":["private"]}},
        "labels":["A","B"],"image_alt":"Blank flow diagram"}}
    context=question_context(question,source())
    assert context["options"]==["A water","B heat"]
    assert context["metadata"]=={"flow_direction":"vertical"}
    assert context["labels"]==["A","B"]
    assert context["context_provenance"]["options"]=="submission_snapshot"
    question["payload"]["options"]=None
    assert question_context(question,source())["options"] is None


def test_persisted_l025_map_context_reaches_review_without_private_map_hints():
    fixture = json.loads((Path(__file__).resolve().parents[2] /
        "frontend/tests/fixtures/listening-review-l025-map.json").read_text())
    question = fixture["authored_question"]
    before = deepcopy(question)
    context = question_context(question, None)
    assert context == fixture["expected_context"]
    assert context["options"] == [{"text": "", "letter": letter} for letter in "ABCDEFGH"]
    assert "map_description" not in json.dumps(context)
    assert "map_image_custom_prompt" not in json.dumps(context)
    assert "answers" not in context and "solutions" not in context
    assert question == before


def test_authored_letter_bank_fallback_preserves_explicit_empty_frozen_fields():
    question = {"payload": {"map_svg": "", "metadata": {"letter_options": ["A", "C", "H"]}}}
    context = question_context(question, source())
    assert context["options"] == ["A", "C", "H"]
    assert context["map_svg"] == ""
    assert context["context_provenance"]["map_svg"] == "submission_snapshot"
    assert context["context_provenance"]["options"] == "submission_snapshot"
    question["payload"]["options"] = []
    assert question_context(question, source())["options"] == []


def test_native_listening_admin_preview_keeps_persisted_l025_map_and_bank(monkeypatch):
    from routers import listening

    fixture = json.loads((Path(__file__).resolve().parents[2] /
        "frontend/tests/fixtures/listening-review-l025-map.json").read_text())
    question = fixture["authored_question"]
    exercise_id = question["id"].rsplit(":", 1)[0]
    rows = {
        "listening_tests": [{"id": fixture["test_uuid"], "test_id": "ILR-LIS-025-R12-STG-20261005",
            "title": "Private L025", "metadata": {}, "test_type": "full"}],
        "listening_content": [{"id": "section-2", "section_num": 2, "title": "Smart city expo"}],
        "listening_exercises": [{"id": exercise_id, "payload": question["payload"]}],
    }
    db = MagicMock()

    def table(name):
        query = MagicMock()
        for method in ("select", "eq", "limit", "order", "in_"):
            getattr(query, method).return_value = query
        query.execute.return_value = SimpleNamespace(data=rows[name])
        return query

    db.table.side_effect = table
    monkeypatch.setattr(listening, "supabase_admin", db)
    monkeypatch.setattr(listening, "require_admin", AsyncMock(return_value={"id": "admin"}))
    monkeypatch.setattr(listening, "_student_audio_url_for_test", lambda _: (None, None, None))
    monkeypatch.setattr("services.mock_review_context.attach_review_web_explanations", lambda *_: {})
    result = asyncio.run(listening.admin_preview_listening_test(fixture["test_uuid"], "Bearer fixture"))
    q16 = next(item for item in result["review"] if item["q_num"] == 16)
    assert result["preview"] is True and result["score"] is None
    assert q16["question_context"] == fixture["expected_context"]
    assert q16["prompt"] == "Main hall"
    assert q16["expected"] == "A"
    assert q16["question_context"]["map_svg"] == question["payload"]["map_svg"]
    assert "mock_paper_attempt_snapshots" not in [call.args[0] for call in db.table.call_args_list]
