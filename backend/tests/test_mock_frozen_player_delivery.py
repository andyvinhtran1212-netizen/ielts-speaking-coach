"""Native player endpoints load only the admitted revision and safe flag state."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import UUID

import pytest

from routers import listening, reading_student

P = "11111111-1111-4111-8111-111111111111"
A = "22222222-2222-4222-8222-222222222222"
U = "33333333-3333-4333-8333-333333333333"
S = "44444444-4444-4444-8444-444444444444"
Q = "55555555-5555-4555-8555-555555555555"


class Query:
    def __init__(self, rows): self.rows = deepcopy(rows)
    def select(self, *_a, **_kw): return self
    def eq(self, key, value):
        self.rows = [row for row in self.rows if str(row.get(key)) == str(value)]
        return self
    def order(self, *_a, **_kw): return self
    def limit(self, value): self.rows = self.rows[:value]; return self
    def execute(self): return SimpleNamespace(data=self.rows)


class DB:
    def __init__(self, skill, snapshot):
        now = datetime.now(timezone.utc)
        self.tables = {
            f"{skill}_test_attempts": [{"id": A, "test_id": P, "user_id": U,
                "sitting_id": S, "attempt_purpose": "mock_delivery", "paper_revision": 3,
                "policy_revision": 2, "status": "in_progress", "answers": [],
                "started_at": now.isoformat(), "resume_expires_at": (now + timedelta(hours=24)).isoformat()}],
            "mock_paper_attempt_snapshots": [snapshot],
            "mock_attempt_review_flags": [{"skill": skill, "attempt_id": A, "q_num": 1,
                "question_id": Q, "flagged": True, "revision": 2, "updated_at": now.isoformat()}],
            "reading_attempt_answers": [{"attempt_id": A, "q_num": 1, "user_answer": "saved"}],
            f"{skill}_tests": [{"id": P, "test_id": "TEST", "status": "published",
                "title": "Changed current paper", "time_limit_minutes": 10}],
        }
        self.calls = []
    def table(self, name):
        self.calls.append(name)
        if name in {"reading_passages", "reading_questions", "listening_content", "listening_exercises"}:
            raise AssertionError("mutable player rows read after admission")
        return Query(self.tables.get(name, []))
    def rpc(self, name, params):
        if name == "fn_resolve_mock_paper_access":
            assert params["p_user_id"] == U
            result = {"allowed": True, "attempt_purpose": "mock_delivery", "mock_sitting_id": S, "attempt_id": A}
        elif name == "fn_guard_owned_mock_attempt":
            assert params["p_attempt"]["user_id"] == U
            result = {"allowed": True}
        else: raise AssertionError(name)
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=result))


def private_snapshot(skill):
    paper = {"id": P, "test_id": "TEST", "title": "Original paper", "module": "academic",
             "time_limit_minutes": 60, "full_audio_storage_path": "original.mp3", "test_type": "full"}
    marks = [{"id": Q, "content_id": "section", "passage_id": "passage", "q_num": 1,
              "question_type": "completion", "exercise_type": "fill_in_blank", "prompt": "Original stem",
              "answer": {"value": "PRIVATEKEY"}, "payload": {"question_range": [1, 1],
                  "questions": [{"q_num": 1, "text": "Original stem", "answer": "PRIVATEKEY"}],
                  "response_policy": {"accepted_answers": ["PRIVATEFORM"]}, "solutions": {"1": "PRIVATERATIONALE"}}}]
    sources = [{"id": "passage" if skill == "reading" else "section", "passage_order": 1,
                "section_num": 1, "title": "Original section", "body_markdown": "Original passage",
                "transcript": "PRIVATETRANSCRIPT", "metadata": {}}]
    return {"skill": skill, "attempt_id": A, "paper_id": P, "paper_revision": 3,
            "policy_revision": 2, "paper_row": paper, "source_rows": sources,
            "marking_rows": marks, "passage_order_by_id": {"passage": 1}, "scoring_override_rows": []}


@pytest.mark.asyncio
async def test_reading_native_boot_uses_frozen_source_clock_and_canonical_flags():
    db = DB("reading", private_snapshot("reading"))
    current = db.tables["reading_tests"][0]
    with patch.object(reading_student, "supabase_admin", db), \
         patch.object(reading_student, "_require_auth", AsyncMock(return_value={"id": U})), \
         patch.object(reading_student, "_fetch_published_test", return_value=deepcopy(current)), \
         patch.object(reading_student, "_stamp_diagram_image_urls"):
        result = await reading_student.boot_reading_test("TEST", sitting_id=UUID(S), authorization="Bearer owned")
    assert result["test"]["title"] == "Original paper"
    assert result["test"]["passages"][0]["body_markdown"] == "Original passage"
    assert result["in_progress"]["time_limit_minutes"] == 60
    assert result["in_progress"]["mock_sitting_id"] == S
    assert result["in_progress"]["review_flags"][0]["revision"] == 2
    assert all(value not in str(result) for value in ("PRIVATEKEY", "PRIVATEFORM", "PRIVATERATIONALE", "PRIVATETRANSCRIPT"))


@pytest.mark.asyncio
async def test_listening_native_detail_uses_frozen_stem_audio_and_flags():
    db = DB("listening", private_snapshot("listening"))
    signed = []
    def sign(test):
        signed.append(test["full_audio_storage_path"])
        return "https://signed.local/original.mp3", "original.mp3", 300
    with patch.object(listening, "supabase_admin", db), \
         patch.object(listening, "_require_auth", AsyncMock(return_value={"id": U})), \
         patch.object(listening, "_student_audio_url_for_test", side_effect=sign):
        result = await listening.get_published_listening_test(UUID(P), sitting_id=UUID(S), authorization="Bearer owned")
    assert result["title"] == "Original paper" and signed == ["original.mp3"]
    assert "Original stem" in str(result["sections"])
    assert result["paper_revision"] == 3 and result["review_flags"][0]["flagged"] is True
    assert all(value not in str(result) for value in ("PRIVATEKEY", "PRIVATEFORM", "PRIVATERATIONALE", "PRIVATETRANSCRIPT"))


def test_submit_key_uses_frozen_policy_and_overrides_without_live_lookup():
    from services.mock_paper_policy import frozen_answer_key
    from services.reading_test_grader import grade_attempt
    snapshot = private_snapshot("reading")
    snapshot["marking_rows"][0]["answer"] = {"answer": "11000", "response_policy": {
        "version": 1, "policy_id": "synthetic-pinned", "kind": "number", "accepted_answers": ["11000"],
        "settings": {"locale": "en"}, "provenance": {"source_item_id": "synthetic-item",
            "source_sha256": "a" * 64, "item_revision": "v1", "reviewer": "synthetic-reviewer", "review_status": "ACCEPTED"}}}
    snapshot["marking_rows"][0]["payload"] = {}
    snapshot["scoring_override_rows"] = [{"question_number": 1, "payload": {
        "audit": {"release_adjudication": {"override_version": "cambridge-release-overrides/1.0"}},
        "item": {"answer": {"canonical": "11000", "accepted_forms": ["11000", "WRONG"]}}}}]
    db = DB("reading", snapshot)
    attempt = db.tables["reading_test_attempts"][0]
    with patch("services.mock_correction_service._current_explanation_rows", side_effect=AssertionError("live override read")):
        key = frozen_answer_key(db, "reading", attempt)
    assert grade_attempt([{"q_num": 1, "user_answer": "11,000"}], key)["score"] == 1
    assert grade_attempt([{"q_num": 1, "user_answer": "WRONG"}], key)["score"] == 0
    assert db.calls == ["mock_paper_attempt_snapshots"]
    attempt["paper_revision"] = None
    db.calls.clear()
    assert frozen_answer_key(db, "reading", attempt) is None and db.calls == []
