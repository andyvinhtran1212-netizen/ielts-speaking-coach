"""GET /api/mock-exams/sittings/{id}/result — TRF result endpoint (2026-07-12).

Pins the addition of listening_attempt_id/reading_attempt_id to the response,
which mock-result.html uses to link the student into the detailed chữa bài
for each skill once results are released."""
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient


def _client() -> TestClient:
    from main import app
    return TestClient(app)


_USER = {"id": "00000000-0000-0000-0000-0000000000aa"}
_AUTH = {"Authorization": "Bearer faketoken"}
_SITTING_ID = "00000000-0000-0000-0000-0000000000bb"


def test_result_includes_attempt_ids_and_delivered_essays():
    sitting = {
        "id":                   _SITTING_ID,
        "user_id":              _USER["id"],
        "status":               "released",
        "listening_attempt_id": "l-attempt-1",
        "reading_attempt_id":   "r-attempt-1",
        "essay_task1_id":       "essay-1",
        "essay_task2_id":       "essay-2",
    }
    review = {
        "final_bands":         {"listening": 7.0, "reading": 7.0},
        "examiner_comment_vi": "Tốt",
        "per_skill_notes":     {},
        "released_at":         "2026-07-12T00:00:00Z",
    }
    with patch("routers.mock_exams.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.mock_exams.svc.get_sitting", return_value=sitting), \
         patch("routers.mock_exams.svc.lr_skill_states", return_value=[]), \
         patch("routers.mock_exams.review_wf.get_review_for_sitting", return_value=review), \
         patch("routers.mock_exams.essay_service.delivered_essay_ids",
               return_value={"essay-1", "essay-2"}):
        r = _client().get(
            "/api/mock-exams/sittings/" + _SITTING_ID + "/result", headers=_AUTH,
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["listening_attempt_id"] == "l-attempt-1"
    assert body["reading_attempt_id"] == "r-attempt-1"
    # both essays delivered → both linkable
    assert body["essay_task1_id"] == "essay-1"
    assert body["essay_task2_id"] == "essay-2"


def test_result_hides_undelivered_writing_essay():
    """Codex P2 (2026-07-12): release leaves a still-'graded' essay undelivered;
    that id must NOT be surfaced (writing-result.html only shows 'delivered', so
    it would be a dead-end link). Only the delivered essay comes back."""
    sitting = {
        "id":             _SITTING_ID,
        "user_id":        _USER["id"],
        "status":         "released",
        "essay_task1_id": "essay-1",   # delivered
        "essay_task2_id": "essay-2",   # still graded → not delivered
    }
    review = {"final_bands": {"writing": 6.0}}
    with patch("routers.mock_exams.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.mock_exams.svc.get_sitting", return_value=sitting), \
         patch("routers.mock_exams.svc.lr_skill_states", return_value=[]), \
         patch("routers.mock_exams.review_wf.get_review_for_sitting", return_value=review), \
         patch("routers.mock_exams.essay_service.delivered_essay_ids",
               return_value={"essay-1"}):
        r = _client().get(
            "/api/mock-exams/sittings/" + _SITTING_ID + "/result", headers=_AUTH,
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["essay_task1_id"] == "essay-1"
    assert body["essay_task2_id"] is None   # undelivered → hidden


def test_result_omits_attempt_ids_when_sitting_has_none():
    """A speaking-only or writing-only exam has no listening/reading attempt —
    the field must be None, not a KeyError or a stray placeholder."""
    sitting = {"id": _SITTING_ID, "user_id": _USER["id"], "status": "released"}
    review = {"final_bands": {"speaking": 7.0}}
    with patch("routers.mock_exams.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.mock_exams.svc.get_sitting", return_value=sitting), \
         patch("routers.mock_exams.svc.lr_skill_states", return_value=[]), \
         patch("routers.mock_exams.review_wf.get_review_for_sitting", return_value=review):
        r = _client().get(
            "/api/mock-exams/sittings/" + _SITTING_ID + "/result", headers=_AUTH,
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["listening_attempt_id"] is None
    assert body["reading_attempt_id"] is None
    assert body["essay_task1_id"] is None
    assert body["essay_task2_id"] is None


# ── Per-task Writing outcome (2026-07-15) ─────────────────────────────
#
# The TRF only ever linked a DELIVERED essay and said NOTHING about a task that
# never got graded — a student with one graded task saw one link and a silent
# gap. writing_task_states reports what actually happened per task so the page
# can say it. Pure function: no DB, no mocks needed.

def _states(**kw):
    from services import mock_exam_service as svc
    sitting = {
        "essay_task1_id": kw.get("e1"), "essay_task2_id": kw.get("e2"),
        "writing_submission": {
            "task1": {"word_count": kw.get("wc1"), "text": kw.get("t1", "x " * (kw.get("wc1") or 0))},
            "task2": {"word_count": kw.get("wc2"), "text": kw.get("t2", "x " * (kw.get("wc2") or 0))},
        },
    }
    return {t["task"]: t for t in svc.writing_task_states(sitting, kw.get("delivered", set()))}


def test_writing_states_delivered_task_is_linkable():
    st = _states(e1="e1", e2="e2", wc1=180, wc2=300, delivered={"e1", "e2"})
    assert st["task1"]["state"] == "delivered" and st["task1"]["essay_id"] == "e1"
    assert st["task2"]["state"] == "delivered" and st["task2"]["essay_id"] == "e2"


def test_writing_states_too_short_reports_the_real_reason():
    """The reason is a FACT on the row (word count vs the IELTS minimum), not the
    admin's retest decision — the page must explain the gap even if nobody ticked
    anything."""
    st = _states(e1="e1", e2="e2", wc1=180, wc2=121, delivered={"e1"})
    assert st["task1"]["state"] == "delivered"          # graded task still shown
    assert st["task2"]["state"] == "too_short"
    assert st["task2"]["word_count"] == 121
    assert st["task2"]["min_words"] == 250              # Task 2 minimum, not Task 1's
    assert st["task2"]["essay_id"] is None              # unreadable → no dead-end link


def test_writing_states_task1_uses_its_own_minimum():
    st = _states(e1="e1", e2="e2", wc1=140, wc2=300, delivered={"e2"})
    assert st["task1"]["state"] == "too_short" and st["task1"]["min_words"] == 150
    assert st["task2"]["state"] == "delivered"


def test_writing_states_long_enough_but_undelivered_is_not_called_too_short():
    """A long essay that simply isn't readable yet must not be blamed on length —
    that would tell the student a falsehood about their own work."""
    st = _states(e1="e1", e2="e2", wc1=180, wc2=300, delivered=set())
    assert st["task1"]["state"] == "not_graded"
    assert st["task2"]["state"] == "not_graded"


def test_writing_states_missing_task_is_missing_not_too_short():
    st = _states(e1=None, e2="e2", wc1=None, wc2=300, delivered={"e2"})
    assert st["task1"]["state"] == "missing"
    assert st["task2"]["state"] == "delivered"


def test_result_payload_carries_writing_tasks_and_retest_flags():
    sitting = {
        "id": _SITTING_ID, "user_id": _USER["id"], "status": "released",
        "essay_task1_id": "essay-1", "essay_task2_id": "essay-2",
        "writing_submission": {"task1": {"word_count": 176}, "task2": {"word_count": 121}},
    }
    review = {"final_bands": {"writing": 5.0}, "retest_flags": {"writing": True, "reading": False}}
    with patch("routers.mock_exams.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.mock_exams.svc.get_sitting", return_value=sitting), \
         patch("routers.mock_exams.svc.lr_skill_states", return_value=[]), \
         patch("routers.mock_exams.review_wf.get_review_for_sitting", return_value=review), \
         patch("routers.mock_exams.essay_service.delivered_essay_ids", return_value={"essay-1"}):
        r = _client().get("/api/mock-exams/sittings/" + _SITTING_ID + "/result", headers=_AUTH)
    assert r.status_code == 200, r.text
    body = r.json()
    tasks = {t["task"]: t for t in body["writing_tasks"]}
    assert tasks["task1"]["state"] == "delivered"
    assert tasks["task2"]["state"] == "too_short" and tasks["task2"]["word_count"] == 121
    # only the flagged skills ride along — an unticked one is not an obligation
    assert body["retest_flags"] == {"writing": True}


def test_writing_states_text_without_essay_id_is_not_called_missing():
    """Codex P2 (PR #777): _promote_writing_essays is best-effort and can return
    without stamping an essay id (no students row), leaving captured text with no
    essay. Reporting that as 'missing' tells the student they never submitted
    work the row itself holds — a falsehood about their own essay."""
    st = _states(e1=None, e2=None, wc1=180, wc2=300, delivered=set())
    assert st["task1"]["state"] == "not_graded"
    assert st["task2"]["state"] == "not_graded"


def test_writing_states_missing_needs_genuinely_empty_text():
    st = _states(e1=None, e2=None, wc1=0, wc2=0, t1="", t2="", delivered=set())
    assert st["task1"]["state"] == "missing"
    assert st["task2"]["state"] == "missing"


def test_writing_states_short_text_without_essay_id_is_still_too_short():
    """Text present but under the minimum → the length IS the honest reason,
    essay id or not."""
    st = _states(e1=None, e2="e2", wc1=40, wc2=300, delivered={"e2"})
    assert st["task1"]["state"] == "too_short" and st["task1"]["word_count"] == 40


def test_result_omits_writing_tasks_when_the_sitting_has_no_writing():
    """Codex P2 (PR #777): an L/R-only retake is a supported assignment. The TRF
    renders every non-delivered task as a gap, so an unconditional two-task list
    would tell that student they failed to submit Writing they were never set."""
    sitting = {
        "id": _SITTING_ID, "user_id": _USER["id"], "status": "released",
        "essay_task1_id": None, "essay_task2_id": None, "writing_submission": {},
        "assigned_skills": ["listening", "reading"],   # retake without Writing
    }
    review = {"final_bands": {"listening": 6.0, "reading": 6.5}}
    with patch("routers.mock_exams.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.mock_exams.svc.get_sitting", return_value=sitting), \
         patch("routers.mock_exams.svc.lr_skill_states", return_value=[]), \
         patch("routers.mock_exams.review_wf.get_review_for_sitting", return_value=review), \
         patch("routers.mock_exams.essay_service.delivered_essay_ids", return_value=set()):
        r = _client().get("/api/mock-exams/sittings/" + _SITTING_ID + "/result", headers=_AUTH)
    assert r.status_code == 200, r.text
    assert r.json()["writing_tasks"] == []


def test_result_includes_writing_tasks_when_writing_is_required():
    sitting = {
        "id": _SITTING_ID, "user_id": _USER["id"], "status": "released",
        "essay_task1_id": "essay-1", "essay_task2_id": "essay-2",
        "writing_submission": {"task1": {"word_count": 176, "text": "x"},
                               "task2": {"word_count": 121, "text": "x"}},
    }
    review = {"final_bands": {"writing": 5.0}}
    with patch("routers.mock_exams.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.mock_exams.svc.get_sitting", return_value=sitting), \
         patch("routers.mock_exams.svc.lr_skill_states", return_value=[]), \
         patch("routers.mock_exams.review_wf.get_review_for_sitting", return_value=review), \
         patch("routers.mock_exams.essay_service.delivered_essay_ids", return_value={"essay-1"}):
        r = _client().get("/api/mock-exams/sittings/" + _SITTING_ID + "/result", headers=_AUTH)
    assert len(r.json()["writing_tasks"]) == 2


# ── Why an L/R skill has no band (2026-07-15) ─────────────────────────
#
# The TRF grid lists only banded skills, so a bandless one vanished with no
# explanation. These states are kept apart because they are different truths:
# every stuck production sitting DID submit, on time, with 40 questions — telling
# those students "không nhận được bài làm" would be a lie about their own exam.

def _lr(**kw):
    from services import mock_exam_service as svc
    from unittest.mock import patch as _p
    # assigned_skills says WHICH skills this sitting runs — set it so
    # _sitting_lr_skills short-circuits instead of querying for the exam config.
    # Its own scoping is covered by the _sitting_lr_skills tests below.
    sitting = {"listening_attempt_id": kw.get("l_id"), "reading_attempt_id": None,
               "assigned_skills": kw.get("assigned", ["listening", "reading", "writing"])}
    rows = kw.get("row")

    class _Res:
        data = [rows] if rows else []

    class _Q:
        def select(self, *a, **k): return self
        def eq(self, *a, **k): return self
        def limit(self, *a, **k): return self
        def execute(self): return _Res()

    class _DB:
        def table(self, *a, **k): return _Q()

    with _p.object(svc, "supabase_admin", _DB()):
        return {s["skill"]: s for s in svc.lr_skill_states(sitting)}["listening"]


def _q(n_answered, total=40):
    return [{"q_num": i, "user_answer": ("x" if i <= n_answered else "")} for i in range(1, total + 1)]


def test_lr_no_attempt_is_the_only_never_received():
    st = _lr(l_id=None)
    assert st["state"] == "no_attempt"


def test_lr_submitted_but_blank_is_no_answers_not_never_received():
    """0/40 with zero answers = a blank paper that WAS received. Production's
    dd1106df is exactly this."""
    st = _lr(l_id="la-1", row={"score": 0, "band_estimate": None, "grading_details": _q(0)})
    assert st["state"] == "no_answers"
    assert st["answered"] == 0


def test_lr_answered_but_below_the_table_says_so_with_the_numbers():
    """6d9192a3 answered 3 of 40 — they attempted. Calling that a blank paper, or
    a lost submission, would both be false."""
    st = _lr(l_id="la-1", row={"score": 0, "band_estimate": None, "grading_details": _q(3)})
    assert st["state"] == "below_table"
    assert st["answered"] == 3 and st["max"] == 40


def test_lr_banded_skill_needs_no_excuse():
    st = _lr(l_id="la-1", row={"score": 30, "band_estimate": 7.0, "grading_details": _q(40)})
    assert st["state"] == "scored"


def test_lr_dangling_attempt_id_reads_as_never_received_not_blank():
    """A sitting pointing at an attempt that isn't there is broken data — calling
    it a blank paper would blame the student for our bug."""
    st = _lr(l_id="la-1", row=None)
    assert st["state"] == "no_attempt"


def test_lr_states_skip_a_skill_the_sitting_never_ran():
    """Codex P2 (PR #780): a writing-only retake has no Listening. Emitting a
    state for it rendered "Không nhận được bài làm" to a student who was never
    set the skill — the same falsehood writing_task_states already guards, made
    again one function over."""
    from services import mock_exam_service as svc
    sitting = {"assigned_skills": ["writing"], "listening_attempt_id": None,
               "reading_attempt_id": None}
    assert svc.lr_skill_states(sitting) == []


def test_lr_states_cover_only_the_assigned_lr_skill():
    from services import mock_exam_service as svc
    sitting = {"assigned_skills": ["reading", "writing"],
               "listening_attempt_id": None, "reading_attempt_id": None}
    assert [s["skill"] for s in svc.lr_skill_states(sitting)] == ["reading"]


def test_sitting_lr_skills_falls_back_to_the_exam_config():
    """No assigned_skills = a normal sitting → the exam's configured sections
    decide (a Reading+Writing exam runs no Listening)."""
    from unittest.mock import patch as _p
    from services import mock_exam_service as svc
    with _p.object(svc, "get_published_exam_by_id",
                   return_value={"reading_test_id": "r-1", "listening_test_id": None}):
        assert svc._sitting_lr_skills({"mock_exam_id": "ex-1"}) == {"reading"}
