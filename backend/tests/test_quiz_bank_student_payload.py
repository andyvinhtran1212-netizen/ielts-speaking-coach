"""SA-BANK-ANSWERS / J411R2: what a learner's browser may receive.

Before this change `GET /api/quiz/banks/{id}` served `quiz_questions.select("*")`
through a model with `extra='allow'`: every Course bank in the default
"mastery" mode shipped its keys, explanations and traps before the first
answer, and `/api/quiz/mistakes` returned the key of a one-sitting assessment
(FINAL) before hand-in.

Contract pinned here:
  * the learner wire is an allowlist (`extra='forbid'`, column constants);
  * no Course bank ever carries a key on the read path, in any mode;
  * Course rows are graded on the server, and mastery feedback is returned
    only for answers that are already on record;
  * `/mistakes` keeps unsubmitted one-sitting rows out entirely;
  * Grammar/Vocab self-study keeps its keys (client grading, QĐ-5, until J412);
  * the admin editor still receives every column;
  * a quiz-only FINAL can only be assigned as single-attempt.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from models.grammar_quiz_revisions import (
    AdminQuizBankDetailResponse, AdminQuizQuestion, QuizBankPlayResponse,
    QuizSessionProgressResponse, QuizSessionStartResponse, StudentQuizQuestion,
)
from routers import admin_class_assignments as adm
from routers import admin_quiz, quiz
from services import grammar_quiz_session, quiz_service
from test_course_assignment import _BANK as _ASSIGN_BANK, _body, _full, _resolve
from test_quiz_course_resume import BANK as R_BANK, ITEM as R_ITEM, USER as R_USER, _DB, _sess
from test_quiz_service import _FakeSupabase

USER = "11111111-1111-1111-1111-111111111111"
BANK = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
SESS = "55555555-5555-5555-5555-555555555555"
C1 = "c1c1c1c1-0000-4000-8000-000000000001"
C2 = "c2c2c2c2-0000-4000-8000-000000000002"

KEY_FIELDS = {"answer", "accept", "explain", "why_wrong", "hint"}
COURSE_WITHHELD = KEY_FIELDS | {"pairs", "mask", "segments"}
ALLOWLIST = set(StudentQuizQuestion.model_fields)


def _row(qid="q1", **over):
    """A stored `quiz_questions` row with EVERY column, plus one the code has
    never heard of: what `select("*")` used to hand to the browser."""
    row = {
        "id": "row-" + qid, "bank_id": BANK, "qid": qid, "item_key": "k-" + qid,
        "type": "mcq", "subtype": "B1", "input": "choice", "skill": "B01",
        "pair": None, "counts_toward_mastery": True, "prompt": "Pick one",
        "options": ["a", "b", "c"], "answer": 1, "accept": ["b"],
        "segments": ["x", "y"], "mask": "b_", "pairs": [["l", "r"]],
        "explain": "Because b.", "why_wrong": {"0": "trap a", "2": "trap c"},
        "hint": "think", "points": 1, "order": 0, "audio_url": None,
        "grammar_article_slug": None, "created_at": "2026-10-01T00:00:00Z",
        "future_internal_column": "never for learners",
    }
    row.update(over)
    return row


class _RecordingFake(_FakeSupabase):
    """`_FakeSupabase` that also remembers the column list of every select."""

    def __init__(self, responses=None):
        super().__init__(responses)
        self.selected: dict[str, list] = {}

    def table(self, name):
        query = super().table(name)
        original = query.select

        def select(*args, **kwargs):
            self.selected.setdefault(name, []).append(args[0] if args else None)
            return original(*args, **kwargs)

        query.select = select
        return query


def _learner_client(monkeypatch):
    async def gate(token):
        if token == "Bearer learner":
            return {"id": USER}
        raise HTTPException(401, "no")
    monkeypatch.setattr(quiz, "get_supabase_user", gate)
    app = FastAPI()
    app.include_router(quiz.router)
    return TestClient(app)


# ── Contract: the models themselves ─────────────────────────────────────────

def test_learner_models_forbid_unknown_fields():
    for model in (StudentQuizQuestion, QuizBankPlayResponse,
                  QuizSessionProgressResponse, QuizSessionStartResponse):
        assert model.model_config.get("extra") == "forbid", model.__name__
    assert not {"created_at", "bank_id", "pairs"} & ALLOWLIST
    # The service projection and the model are the same list.
    assert quiz_service._STUDENT_QUESTION_FIELDS == ALLOWLIST
    assert "*" not in quiz_service._STUDENT_QUESTION_COLUMNS
    assert "*" not in quiz_service._STUDENT_BANK_COLUMNS


def test_admin_models_are_separate_and_keep_every_column():
    assert AdminQuizQuestion is not StudentQuizQuestion
    assert AdminQuizQuestion.model_config.get("extra") == "allow"
    assert COURSE_WITHHELD | {"pairs"} <= set(AdminQuizQuestion.model_fields)
    detail = AdminQuizBankDetailResponse.model_fields["questions"].annotation
    assert "AdminQuizQuestion" in str(detail)


# ── GET /api/quiz/banks/{id} ────────────────────────────────────────────────

_GRAMMAR_STATE = {
    "canonical_code": "G-error-clinic-affect-vs-effect", "bank_id": BANK,
    "bank_revision": "a" * 64, "content_state": "current",
    "new_starts_enabled": True, "can_continue_legacy": False,
    "can_continue_current": True, "current_bank_id": BANK,
    "current_bank_revision": "a" * 64,
}


def _course_item(mode, *, submitted=False, timed=False):
    cfg = {"completion_mode": mode} if mode else {}
    if timed:
        cfg["time_limit_minutes"] = 30
    attempts = ([{"phase": "run", "pct": 90.0, "completed": True,
                  "next_action": "completed", "sections": {"quiz": 90.0}}]
                if submitted else [])
    return {
        "id": "item-1", "assignment_id": "asg-1", "opened_at": None,
        "due_at": None, "accepting": True, "passed_at": None,
        "submitted_at": "2026-10-30T01:00:00Z" if submitted else None,
        "mastery": {"attempts": attempts}, "content_config": cfg,
    }


_CASES = {
    # name: (bank row, assignment item or None, learner action)
    "grammar_current": ({"id": BANK, "code": "G-1~c87d", "skill_area": "grammar",
                         "is_published": True, "meta": {},
                         "grammar_canonical_code": "G-error-clinic-affect-vs-effect",
                         "grammar_revision": "a" * 64, "grammar_is_current": True},
                        None, None),
    "grammar_legacy": ({"id": BANK, "code": "G-1", "skill_area": "grammar",
                        "is_published": True, "meta": {}, "grammar_canonical_code": None,
                        "grammar_revision": None, "grammar_is_current": False},
                       None, None),
    "course_mastery": ({"id": BANK, "code": "C1-B12", "skill_area": "course", "meta": {}},
                       _course_item(None), "continue"),
    "course_single_open": ({"id": BANK, "code": "C1-FINAL", "skill_area": "course",
                            "meta": {"assessment_kind": "final"}},
                           _course_item("single_attempt"), "continue"),
    "course_single_submitted": ({"id": BANK, "code": "C1-FINAL", "skill_area": "course",
                                 "meta": {"assessment_kind": "final"}},
                                _course_item("single_attempt", submitted=True), "review"),
    "course_timed": ({"id": BANK, "code": "C1-TIMED", "skill_area": "course", "meta": {}},
                     _course_item("single_attempt", timed=True), "continue"),
}


def _get_bank(monkeypatch, case):
    bank, item, action = _CASES[case]
    fake = _RecordingFake(responses={
        ("quiz_banks", "select"): [{**bank, "import_batch_id": "batch-7",
                                    "source": "internal.md", "created_at": "x"}],
        ("quiz_questions", "select"): [_row("q1"), _row("q2", answer=2)],
        ("class_assignment_items", "select"): [item] if item else [],
        ("class_assignments", "select"): ([{"id": "asg-1", "status": "published",
                                            "publish_at": None, "due_at": None,
                                            "content_config": item["content_config"]}]
                                          if item else []),
    })
    monkeypatch.setattr(quiz_service, "supabase_admin", fake)
    monkeypatch.setattr(quiz_service, "_word_cards_for", lambda _b: {})
    monkeypatch.setattr(quiz_service, "_attach_article_urls", lambda _q: None)
    monkeypatch.setattr(quiz_service, "_resolve_question_audio", lambda _q, _w: None)
    if item:
        monkeypatch.setattr(quiz_service, "_assignment_item_for_review",
                            lambda *_a, **_k: item)
        monkeypatch.setattr(quiz_service, "course_assignment_action_with_session_truth",
                            lambda *_a, **_k: action)
        monkeypatch.setattr(quiz_service, "_ensure_timed_course_session",
                            lambda it, **_k: (it, None))
    if bank.get("grammar_canonical_code"):
        monkeypatch.setattr(grammar_quiz_session, "is_managed", lambda _b: True)
        monkeypatch.setattr(grammar_quiz_session, "validate_bank_policy",
                            lambda *_a, **_k: None)
        monkeypatch.setattr(grammar_quiz_session, "bank_state",
                            lambda *_a, **_k: dict(_GRAMMAR_STATE))
    client = _learner_client(monkeypatch)
    response = client.get(f"/api/quiz/banks/{BANK}",
                          headers={"Authorization": "Bearer learner"})
    return response, fake


@pytest.mark.parametrize("case", sorted(_CASES))
def test_every_question_is_inside_the_allowlist(monkeypatch, case):
    response, fake = _get_bank(monkeypatch, case)
    assert response.status_code == 200, response.text
    body = response.json()
    for question in body["questions"]:
        assert set(question) <= ALLOWLIST, set(question) - ALLOWLIST
        assert "future_internal_column" not in question
        assert "created_at" not in question and "bank_id" not in question
        assert "pairs" not in question
    assert "import_batch_id" not in body["bank"] and "source" not in body["bank"]
    # Column constants, not `*`, on both reads.
    assert fake.selected["quiz_questions"][0] == quiz_service._STUDENT_QUESTION_COLUMNS
    assert fake.selected["quiz_banks"][0] == quiz_service._STUDENT_BANK_COLUMNS


@pytest.mark.parametrize("case", [c for c in sorted(_CASES) if c.startswith("course")])
def test_no_course_bank_ships_a_key_in_any_mode(monkeypatch, case):
    response, _ = _get_bank(monkeypatch, case)
    assert response.status_code == 200, response.text
    body = response.json()
    for question in body["questions"]:
        assert not COURSE_WITHHELD & set(question), question
        assert question["options"] == ["a", "b", "c"]
        assert question["prompt"] == "Pick one"
    assert body["mastery"]["answers_withheld"] is True
    # Only the one-sitting, not-yet-handed-in item hides correctness after
    # answering; mastery gets server feedback per answer instead.
    assert body["mastery"]["answers_sealed"] is (case in {"course_single_open",
                                                          "course_timed"})


@pytest.mark.parametrize("case", ["grammar_current", "grammar_legacy"])
def test_grammar_self_study_payload_keeps_its_keys(monkeypatch, case):
    """QĐ-5 is unchanged for self-study until J412: the browser grades."""
    response, _ = _get_bank(monkeypatch, case)
    assert response.status_code == 200, response.text
    question = response.json()["questions"][0]
    expected = {k: v for k, v in _row("q1").items() if k in ALLOWLIST}
    assert question == expected
    assert KEY_FIELDS <= set(question)
    assert "mastery" not in response.json()


def test_advanced_vocab_course_bank_never_reaches_the_generic_player(monkeypatch):
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [{"id": BANK, "skill_area": "course",
                                    "meta": {"runtime": {"kind": "advanced_vocab"}}}],
        ("quiz_questions", "select"): [_row()],
    })
    monkeypatch.setattr(quiz_service, "supabase_admin", fake)
    monkeypatch.setattr(quiz_service, "_assignment_item_for_review",
                        lambda *_a, **_k: {"id": "item-1"})
    client = _learner_client(monkeypatch)
    response = client.get(f"/api/quiz/banks/{BANK}",
                          headers={"Authorization": "Bearer learner"})
    assert response.status_code == 409
    assert not any(c["table"] == "quiz_questions" for c in fake.calls)


# ── POST /api/quiz/sessions/{id}/progress ───────────────────────────────────

_KEYS = {
    "q1": {"qid": "q1", "answer": 1, "explain": "Because b.",
           "why_wrong": {"0": "trap a", "2": "trap c"}},
    "q2": {"qid": "q2", "answer": 2, "explain": "Because c.", "why_wrong": {}},
}


def _progress_fake(mode, *, stored=None, course=True, qids=("q1",)):
    cfg = {"completion_mode": mode} if mode else {}
    responses = {
        ("quiz_sessions", "select"): [{
            "id": SESS, "user_id": USER, "bank_id": BANK,
            "class_assignment_item_id": "item-1" if course else None,
            "ended_at": None, "ended_by": None,
        }],
        ("quiz_banks", "select"): [{"id": BANK, "skill_area": "course" if course else "grammar",
                                    "grammar_canonical_code": None}],
        ("class_assignment_items", "select"): [{
            "id": "item-1", "assignment_id": "asg-1", "opened_at": None,
            "submitted_at": None, "passed_at": None, "mastery": None,
        }],
        ("class_assignments", "select"): [{
            "id": "asg-1", "skill": "course", "status": "published",
            "publish_at": None, "due_at": None, "content_config": cfg,
        }],
        # The fake ignores `in_`, so serve exactly the requested questions.
        ("quiz_questions", "select"): [_KEYS[q] for q in qids],
        ("quiz_attempts", "upsert"): [],
        ("quiz_attempts", "select"): stored if stored is not None else [],
    }
    return _RecordingFake(responses=responses)


def _attempt(client_id, qid, given, claimed=True):
    return {"client_id": client_id, "item_key": "k", "qid": qid, "skill": "B01",
            "type": "mcq", "is_correct": claimed, "answer_given": given,
            "response_time_ms": 900, "attempt_no": 1}


def _post_progress(monkeypatch, fake, attempts):
    monkeypatch.setattr(quiz_service, "supabase_admin", fake)
    monkeypatch.setattr(quiz_service, "_record_quiz_kp_evidence", lambda *_a, **_k: None)
    client = _learner_client(monkeypatch)
    return client.post(f"/api/quiz/sessions/{SESS}/progress",
                       json={"attempts": attempts, "word_stats": []},
                       headers={"Authorization": "Bearer learner"})


def test_mastery_progress_grades_on_the_server_and_returns_recorded_feedback(monkeypatch):
    # The browser claims both rows are correct; the stored rows decide.
    stored = [{"client_id": C1, "qid": "q1", "answer_given": "0"}]
    fake = _progress_fake(None, stored=stored, qids=("q1", "q2"))
    response = _post_progress(monkeypatch, fake, [
        _attempt(C1, "q1", "0"), _attempt(C2, "q2", "2"),
    ])
    assert response.status_code == 200, response.text
    body = response.json()
    written = next(c for c in fake.calls
                   if c["table"] == "quiz_attempts" and c["op"] == "upsert")["payload"]
    assert [row["is_correct"] for row in written] == [False, True]
    # Feedback only for what the read-back found on record for THIS session.
    readback = next(c for c in fake.calls
                    if c["table"] == "quiz_attempts" and c["op"] == "select")
    assert ("session_id", SESS) in readback["filters"]
    assert ("user_id", USER) in readback["filters"]
    assert ("in", "client_id", sorted([C1, C2])) in readback["filters"]
    assert body["feedback"] == [{
        "qid": "q1", "client_id": C1, "is_correct": False, "answer": 1,
        "why_wrong": "trap a", "explain": "Because b.",
    }]
    assert body["attempts"] == 2


def test_a_fresh_answer_costs_no_extra_read(monkeypatch):
    """Load matters (single event loop, incident 30/10 18:10): the INSERT's own
    RETURNING rows and the grading read are reused; nothing is read twice."""
    fake = _progress_fake(None)
    fake.responses[("quiz_attempts", "upsert")] = [{
        "client_id": C1, "qid": "q1", "answer_given": "2",
        "session_id": SESS, "user_id": USER, "bank_id": BANK, "is_correct": False,
    }]
    response = _post_progress(monkeypatch, fake, [_attempt(C1, "q1", "2")])
    assert response.status_code == 200, response.text
    assert response.json()["feedback"][0]["why_wrong"] == "trap c"
    assert not any(c["table"] == "quiz_attempts" and c["op"] == "select"
                   for c in fake.calls)
    assert len([c for c in fake.calls if c["table"] == "quiz_questions"]) == 1


def test_inserted_rows_of_another_session_are_not_trusted(monkeypatch):
    fake = _progress_fake(None, stored=[])
    fake.responses[("quiz_attempts", "upsert")] = [{
        "client_id": C1, "qid": "q1", "answer_given": "1",
        "session_id": "other-session", "user_id": USER,
    }]
    response = _post_progress(monkeypatch, fake, [_attempt(C1, "q1", "1")])
    assert response.status_code == 200, response.text
    assert response.json()["feedback"] == []


def test_feedback_uses_the_stored_answer_not_the_replayed_request(monkeypatch):
    """A retry of the same client_id after a lost response cannot swap the
    answer it is graded on: the first stored row wins."""
    stored = [{"client_id": C1, "qid": "q1", "answer_given": "1"}]
    response = _post_progress(monkeypatch, _progress_fake(None, stored=stored),
                              [_attempt(C1, "q1", "2", claimed=False)])
    assert response.status_code == 200, response.text
    assert response.json()["feedback"][0]["is_correct"] is True
    assert response.json()["feedback"][0]["why_wrong"] is None


@pytest.mark.parametrize("given", ["1", " 01 ", "0", "2", "x", ""])
def test_feedback_correctness_is_the_verdict_grader(monkeypatch, given):
    """Verdict/score (course_verdict) re-grades `answer_given` with
    `grade_attempt`; the per-answer feedback must say the same thing."""
    stored = [{"client_id": C1, "qid": "q1", "answer_given": given}]
    response = _post_progress(monkeypatch, _progress_fake(None, stored=stored),
                              [_attempt(C1, "q1", given)])
    assert response.status_code == 200, response.text
    assert response.json()["feedback"][0]["is_correct"] is (
        quiz_service.grade_attempt(given, 1) is True)


def test_single_attempt_progress_returns_no_feedback(monkeypatch):
    fake = _progress_fake("single_attempt",
                          stored=[{"client_id": C1, "qid": "q1", "answer_given": "1"}])
    response = _post_progress(monkeypatch, fake, [_attempt(C1, "q1", "1", claimed=False)])
    assert response.status_code == 200, response.text
    assert "feedback" not in response.json()
    written = next(c for c in fake.calls
                   if c["table"] == "quiz_attempts" and c["op"] == "upsert")["payload"]
    assert written[0]["is_correct"] is True
    assert not any(c["table"] == "quiz_attempts" and c["op"] == "select"
                   for c in fake.calls)


def test_self_study_progress_is_unchanged(monkeypatch):
    """Non-Course sessions keep the client's flag and get no feedback."""
    fake = _progress_fake(None, course=False)
    response = _post_progress(monkeypatch, fake, [_attempt(C1, "q1", "0", claimed=True)])
    assert response.status_code == 200, response.text
    assert response.json() == {"ok": True, "attempts": 1, "word_stats": 0}
    written = next(c for c in fake.calls
                   if c["table"] == "quiz_attempts" and c["op"] == "upsert")["payload"]
    assert written[0]["is_correct"] is True
    assert not any(c["table"] == "quiz_questions" for c in fake.calls)


def test_feedback_read_failure_is_loud_and_retry_safe(monkeypatch):
    fake = _progress_fake(None)
    fake.responses[("quiz_attempts", "select")] = RuntimeError("db down")
    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_record_quiz_kp_evidence"):
        with pytest.raises(HTTPException) as caught:
            quiz_service.log_progress(user_id=USER, session_id=SESS,
                                      attempts=[_attempt(C1, "q1", "1")], word_stats=[])
    assert caught.value.status_code == 500
    # The answer was stored first (idempotent on client_id), so a retry is safe.
    assert any(c["table"] == "quiz_attempts" and c["op"] == "upsert" for c in fake.calls)


# ── GET /api/quiz/mistakes ──────────────────────────────────────────────────

def _mistakes_fake(item_rows, assignment_cfg):
    return _FakeSupabase(responses={
        ("quiz_attempts", "select"): [
            {"bank_id": BANK, "session_id": SESS, "item_key": "k-q1", "qid": "q1",
             "skill": "B01", "type": "mcq", "answer_given": "0",
             "created_at": "2026-10-30T02:00:00Z"},
            {"bank_id": "g-bank", "session_id": "g-sess", "item_key": "affect",
             "qid": "g1", "skill": "meaning", "type": "mcq", "answer_given": "0",
             "created_at": "2026-10-30T01:00:00Z"},
        ],
        ("quiz_banks", "select"): [
            {"id": BANK, "code": "C1-FINAL", "title": "Final", "skill_area": "course"},
            {"id": "g-bank", "code": "G-1", "title": "Affect", "skill_area": "grammar",
             "grammar_canonical_code": None},
        ],
        ("quiz_questions", "select"): [
            {**_row("q1"), "bank_id": BANK},
            {**_row("g1", item_key="affect"), "bank_id": "g-bank"},
        ],
        ("quiz_word_stats", "select"): [],
        ("quiz_sessions", "select"): [{"id": SESS, "class_assignment_item_id": "item-1"}],
        ("class_assignment_items", "select"): item_rows,
        ("class_assignments", "select"): [{"id": "asg-1", "content_config": assignment_cfg}],
    })


def _mistakes(monkeypatch, fake, query=""):
    monkeypatch.setattr(quiz_service, "supabase_admin", fake)
    monkeypatch.setattr(quiz_service, "_bank_ids_for_skill", lambda _s: None)
    client = _learner_client(monkeypatch)
    response = client.get("/api/quiz/mistakes" + query,
                          headers={"Authorization": "Bearer learner"})
    assert response.status_code == 200, response.text
    return {(q["qid"]): q for it in response.json()["items"] for q in it["questions"]}


def _single_item(submitted):
    item = _course_item("single_attempt", submitted=submitted)
    return {k: item[k] for k in ("id", "assignment_id", "submitted_at", "mastery")}


def test_mistakes_hide_an_unsubmitted_single_attempt_row_entirely(monkeypatch):
    by_qid = _mistakes(monkeypatch, _mistakes_fake(
        [_single_item(False)], {"completion_mode": "single_attempt"}))
    # Not just the key: the row's presence alone would say "your pick was wrong".
    assert "q1" not in by_qid
    assert by_qid["g1"]["correct_answer"] == "b"           # Grammar unchanged


def test_mistakes_show_a_handed_in_single_attempt_row_with_its_key(monkeypatch):
    by_qid = _mistakes(monkeypatch, _mistakes_fake(
        [_single_item(True)], {"completion_mode": "single_attempt"}))
    assert by_qid["q1"]["correct_answer"] == "b"
    assert by_qid["q1"]["explain"] == "Because b."


def test_mistakes_show_mastery_rows(monkeypatch):
    """A mastery row is on record and already got its feedback from /progress."""
    by_qid = _mistakes(monkeypatch, _mistakes_fake(
        [_single_item(False)], {}))
    assert by_qid["q1"]["correct_answer"] == "b"


def test_mistakes_fail_closed_when_the_assignment_cannot_be_read(monkeypatch):
    by_qid = _mistakes(monkeypatch, _mistakes_fake([], {"completion_mode": "single_attempt"}))
    assert "q1" not in by_qid and "g1" in by_qid


# ── GET /course-resume (sealed vs mastery) ──────────────────────────────────

@pytest.mark.parametrize("mode,sealed", [("single_attempt", True), (None, False)])
def test_course_resume_only_reveals_correctness_when_not_sealed(mode, sealed):
    item = {"id": R_ITEM, "submitted_at": None, "due_at": None,
            "content_config": {"completion_mode": mode} if mode else {}}
    db = _DB({
        "quiz_sessions": [_sess("open")],
        "quiz_attempts": [{"session_id": "open", "qid": "q00", "is_correct": False,
                           "created_at": "2026-09-18T01:00:00+00:00"}],
        "quiz_questions": [{"bank_id": R_BANK, "qid": "q00", "type": "mcq", "order": 0}],
        "class_assignment_items": [],
    })
    with patch.object(quiz_service, "supabase_admin", db), \
            patch.object(quiz_service, "_bank_meta_or_404",
                         lambda *_a, **_k: {"skill_area": quiz_service.COURSE_AREA}), \
            patch.object(quiz_service, "_assignment_item_for", lambda *_a, **_k: item):
        sv = quiz_service.get_course_resume(user_id=R_USER, bank_id=R_BANK)
    assert sv["answers_sealed"] is sealed
    assert sv["answered"] == [{"qid": "q00", "is_correct": None if sealed else False}]
    if sealed:
        assert sv["last_stage"] is None


# ── Admin editor still gets everything ──────────────────────────────────────

def test_admin_bank_detail_keeps_every_column(monkeypatch):
    async def admin_gate(token):
        if token == "Bearer admin":
            return {"id": USER}
        raise HTTPException(403, "no")
    monkeypatch.setattr(admin_quiz, "require_admin", admin_gate)
    row = _row("q1")
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [{"id": BANK, "skill_area": "course",
                                    "import_batch_id": "batch-7"}],
        ("quiz_questions", "select"): [row],
    })
    monkeypatch.setattr(admin_quiz, "supabase_admin", fake)
    app = FastAPI()
    app.include_router(admin_quiz.router)
    response = TestClient(app).get(f"/admin/quiz/banks/{BANK}",
                                   headers={"Authorization": "Bearer admin"})
    assert response.status_code == 200, response.text
    assert response.json()["questions"] == [row]
    assert response.json()["bank"]["import_batch_id"] == "batch-7"


# ── (e) A quiz-only FINAL is always single-attempt ──────────────────────────

_FINAL = {**_ASSIGN_BANK, "meta": {"assessment_kind": "final"}}


def test_a_quiz_only_final_cannot_be_assigned_in_mastery_mode():
    with pytest.raises(HTTPException) as caught:
        _resolve(_full(quiz_banks=[_FINAL]), _body(completion_mode="mastery"))
    assert caught.value.status_code == 400
    assert "một lượt" in str(caught.value.detail)


def test_a_quiz_only_final_assigns_as_single_attempt():
    _, cfg = _resolve(_full(quiz_banks=[_FINAL]),
                      _body(completion_mode="single_attempt"))
    assert cfg["completion_mode"] == "single_attempt"


@pytest.mark.parametrize("kind", ["midterm", "post_midterm_practice", None])
def test_other_course_banks_keep_mastery(kind):
    bank = {**_ASSIGN_BANK, "meta": {"assessment_kind": kind} if kind else {}}
    _, cfg = _resolve(_full(quiz_banks=[bank]), _body())
    assert cfg["completion_mode"] == "mastery"


def test_a_final_with_other_sections_is_left_to_the_owner_decision():
    """Q4 (Vinh): single-attempt is still refused for mixed banks, and this
    change does not relax that — it only does not add a second refusal."""
    questions = [{"id": "q1", "bank_id": "bank-1", "type": "mcq"},
                 {"id": "w1", "bank_id": "bank-1", "type": "writing"}]
    _, cfg = _resolve(_full(quiz_banks=[_FINAL], quiz_questions=questions), _body())
    assert cfg["completion_mode"] == "mastery"
    with pytest.raises(HTTPException) as caught:
        _resolve(_full(quiz_banks=[_FINAL], quiz_questions=questions),
                 _body(completion_mode="single_attempt"))
    assert "trắc nghiệm thuần" in str(caught.value.detail)
