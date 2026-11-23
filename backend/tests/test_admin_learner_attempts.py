"""G09-T04c (ADMINIA-0074 FR-025): the profile's Học tập tab.

Runs the real service and route over the in-memory stand-in of
test_admin_learners. Made-up people only; no AI or network call.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from routers import admin_learner_profile as mod
from services import admin_learner_attempts
from services import admin_learner_directory as directory
from services import learner_attention, ops_thresholds, staff_scope, test_data_visibility
from test_admin_learners import DEFAULTS, S_LAN, S_OFFLINE, U_ADMIN, U_LAN, U_MINH, _DB, _ago


@pytest.fixture
def db(monkeypatch):
    fake = _DB()
    for module in (directory, learner_attention, staff_scope, admin_learner_attempts):
        monkeypatch.setattr(module, "supabase_admin", fake)
    monkeypatch.setattr(ops_thresholds, "get", AsyncMock(return_value=dict(DEFAULTS)))
    monkeypatch.setattr(test_data_visibility, "hide_for", lambda **_k: False)
    monkeypatch.setattr(mod, "require_admin", AsyncMock(return_value={"id": U_ADMIN}))
    return fake


def _attempts(ref, skill=None, state=None, cursor=None):
    return asyncio.run(mod.get_learner_attempts(ref, skill, state, cursor, "Bearer x"))


def _seed(db):
    db.rows["sessions"] = [
        {"id": "x1", "user_id": U_LAN, "part": 2, "topic": "A trip", "status": "completed", "overall_band": 6.5,
         "started_at": _ago(days=2, minutes=20), "completed_at": _ago(days=2)},
        {"id": "x2", "user_id": U_LAN, "part": 1, "topic": "Work", "status": "in_progress", "overall_band": None,
         "started_at": _ago(hours=1)},
        # Part of a mock sitting: it belongs to the mock row, not here.
        {"id": "x3", "user_id": U_LAN, "part": 3, "topic": "Mock", "status": "completed", "overall_band": 7.0,
         "started_at": _ago(days=1), "sitting_id": "s1"},
    ]
    db.rows["writing_essays"] = [
        {"id": "e1", "student_id": S_LAN, "task_type": "task2", "status": "delivered",
         "is_flagged": False, "deleted_at": None, "created_at": _ago(days=3), "delivered_at": _ago(days=2, hours=12),
         "writing_feedback": {"overall_band_score": 6.0}},
        {"id": "e2", "student_id": S_LAN, "task_type": "task1_academic",
         "status": "delivered", "is_flagged": True, "deleted_at": None, "created_at": _ago(days=4),
         "writing_feedback": {"overall_band_score": 5.0}},
        {"id": "e3", "student_id": S_LAN, "task_type": "task2", "status": "grading",
         "is_flagged": False, "deleted_at": None, "created_at": _ago(hours=3), "writing_feedback": None},
        {"id": "e4", "student_id": S_LAN, "task_type": "task2", "status": "delivered",
         "is_flagged": False, "deleted_at": _ago(days=1), "created_at": _ago(days=5), "writing_feedback": None},
    ]
    db.rows["reading_test_attempts"] = [
        {"id": "r1", "user_id": U_LAN, "test_id": "rt1", "status": "submitted", "score": 30, "band_estimate": 7.0,
         "grading_details": [{"q": i} for i in range(40)],
         "started_at": _ago(days=6, hours=1), "submitted_at": _ago(days=6)},
        {"id": "r2", "user_id": U_LAN, "test_id": "rt1", "status": "in_progress", "score": None,
         "band_estimate": None, "started_at": _ago(days=1, hours=2)},
        # The Reading part of mock sitting s2 (not yet released): no row, no band.
        {"id": "r3", "user_id": U_LAN, "test_id": "rt1", "status": "submitted", "score": 35, "band_estimate": 8.0,
         "grading_details": [{"q": i} for i in range(40)], "sitting_id": "s2",
         "started_at": _ago(days=8, hours=1), "submitted_at": _ago(days=8)},
    ]
    db.rows["reading_tests"] = [{"id": "rt1", "title": "Cambridge 18 Test 1"}]
    db.rows["listening_test_attempts"] = [
        {"id": "l1", "user_id": U_LAN, "test_id": "lt1", "status": "abandoned", "score": None, "band_estimate": None,
         "started_at": _ago(days=7)},
        # The Listening part of mock sitting s2.
        {"id": "l2", "user_id": U_LAN, "test_id": "lt1", "status": "submitted", "score": 33, "band_estimate": 7.5,
         "grading_details": [], "sitting_id": "s2", "started_at": _ago(days=8, hours=2),
         "submitted_at": _ago(days=8, hours=1)}]
    db.rows["listening_tests"] = [{"id": "lt1", "title": "Full Listening 3"}]
    db.rows["mock_exam_sittings"] = [
        {"id": "s1", "user_id": U_LAN, "mock_exam_id": "m1", "status": "released", "created_at": _ago(days=10)},
        {"id": "s2", "user_id": U_LAN, "mock_exam_id": "m1", "status": "under_review", "created_at": _ago(days=8)},
    ]
    db.rows["mock_exams"] = [{"id": "m1", "title": "Thi thử tháng 11"}]
    db.rows["mock_exam_reviews"] = [{"id": "rv1", "sitting_id": "s1", "status": "released",
                                     "final_bands": {"overall": 6.5}, "released_at": _ago(days=9)}]


def test_a_learner_with_no_attempts_has_an_empty_table_and_no_made_up_insights(db):
    out = _attempts(f"u-{U_MINH}")
    # Fewer than five graded essays: no repeated-error verdict yet (null);
    # an account with no recommendation: checked, nothing weak ([]).
    assert out == {"items": [], "next_cursor": None, "writing_repeated_errors": None,
                   "weak_grammar_groups": [], "sources_failed": []}


def test_every_skill_is_one_table_newest_first_with_the_view_that_opens_it(db):
    _seed(db)
    out = _attempts(f"u-{U_LAN}")
    rows = [(i["skill"], i["id"], i["title"], i["state"], i["result_text"], i["open_href"]) for i in out["items"]]
    assert rows == [
        ("speaking", "x2", "Speaking Part 1 · Work", "in_progress", None, "/admin/speaking/sessions?session=x2"),
        ("writing", "e3", "Writing Task 2", "submitted", None, "/admin/writing/grade?essay_id=e3"),
        ("reading", "r2", "Cambridge 18 Test 1", "in_progress", None, None),
        ("speaking", "x1", "Speaking Part 2 · A trip", "done", "Band 6.5", "/admin/speaking/sessions?session=x1"),
        ("writing", "e1", "Writing Task 2", "done", "Band 6.0", "/admin/writing/grade?essay_id=e1"),
        # Flagged: no band, as on the Tổng quan tab.
        ("writing", "e2", "Writing Task 1 (Academic)", "done", None, "/admin/writing/grade?essay_id=e2"),
        ("reading", "r1", "Cambridge 18 Test 1", "done", "Band 7.0 · 30/40",
         "/reading/review?attempt_id=r1&from=admin"),
        ("listening", "l1", "Full Listening 3", "abandoned", None, None),
        ("mock", "s2", "Thi thử tháng 11", "submitted", None, "/admin/mock-reviews?mock_exam_id=m1"),
        ("mock", "s1", "Thi thử tháng 11", "done", "Band 6.5", "/admin/mock-reviews?mock_exam_id=m1"),
    ]
    assert out["sources_failed"] == [] and out["next_cursor"] is None
    # The mock's Speaking session and a deleted essay are not rows of their own.
    # Nor are the mock's Reading and Listening parts, whose bands wait for release.
    assert not {"x3", "e4", "r3", "l2"} & {i["id"] for i in out["items"]}


def test_skill_and_state_filters(db):
    _seed(db)
    assert [i["id"] for i in _attempts(f"u-{U_LAN}", skill="writing")["items"]] == ["e3", "e1", "e2"]
    assert [i["id"] for i in _attempts(f"u-{U_LAN}", state="done")["items"]] == ["x1", "e1", "e2", "r1", "s1"]
    assert [i["id"] for i in _attempts(f"u-{U_LAN}", skill="mock", state="submitted")["items"]] == ["s2"]


def test_one_failed_source_is_named_and_the_others_still_answer(db):
    _seed(db)
    db.fail.add("reading_test_attempts")
    out = _attempts(f"u-{U_LAN}")
    assert out["sources_failed"] == ["reading"]
    assert {i["skill"] for i in out["items"]} == {"speaking", "writing", "listening", "mock"}


def test_a_score_uses_the_review_page_denominator(db):
    _seed(db)
    db.rows["reading_test_attempts"].append(
        {"id": "r3", "user_id": U_LAN, "test_id": "rt1", "status": "submitted", "score": 9, "band_estimate": None,
         "grading_details": [{"q": i} for i in range(13)], "started_at": _ago(days=9), "submitted_at": _ago(days=9)})
    db.rows["listening_test_attempts"] += [
        # Two self-check items are not scored.
        {"id": "l2", "user_id": U_LAN, "test_id": "lt1", "status": "submitted", "score": 7, "band_estimate": None,
         "grading_details": [{"q": i, "self_check": i < 2} for i in range(10)],
         "started_at": _ago(days=11), "submitted_at": _ago(days=11)},
        {"id": "l3", "user_id": U_LAN, "test_id": "lt1", "status": "submitted", "score": 5, "band_estimate": 6.0,
         "scoring_policy": "report_only", "grading_details": [{"q": 1}], "started_at": _ago(days=12),
         "submitted_at": _ago(days=12)},
    ]
    by_id = {i["id"]: i["result_text"] for i in _attempts(f"u-{U_LAN}")["items"]}
    assert (by_id["r1"], by_id["r3"], by_id["l2"], by_id["l3"]) == ("Band 7.0 · 30/40", "9/13", "7/8", None)


def test_a_failed_regrade_reads_failed(db):
    _seed(db)
    db.rows["sessions"][0]["status"] = "grading_failed"
    assert [i["id"] for i in _attempts(f"u-{U_LAN}", state="failed")["items"]] == ["x1"]


def _mistakes(*types):
    return {"mistakeAnalysis": [{"mistakeType": t, "criterion": "GRA", "original": f"câu của học viên {i}"}
                                for i, t in enumerate(types)]}


def test_repeated_writing_errors_use_the_grader_rule_over_the_newest_five_essays(db):
    # Lan has five essays (e1..e5); e1 is the newest feedback.
    db.rows["writing_feedback_current"] = [
        {"id": f"f{i}", "essay_id": f"e{i}", "created_at": _ago(days=i),
         "feedback_json": _mistakes("Article", "Tense") if i <= 3 else _mistakes("Plural")}
        for i in range(1, 6)]
    out = _attempts(f"u-{U_LAN}")
    assert out["writing_repeated_errors"] == [
        {"mistake_type": "Article", "count": 3, "criterion": "GRA"},
        {"mistake_type": "Tense", "count": 3, "criterion": "GRA"},
        {"mistake_type": "Plural", "count": 2, "criterion": "GRA"},
    ]
    # The learner's sentences are not copied.
    assert "câu của học viên" not in str(out)
    # Four graded essays: below the grader's floor, so no verdict.
    db.rows["writing_feedback_current"].pop()
    assert _attempts(f"u-{U_LAN}")["writing_repeated_errors"] is None


def test_weak_grammar_groups_are_the_learner_dashboard_rule(db):
    from services.grammar_content import grammar_service
    slug_a, slug_b = list(grammar_service.articles_by_slug)[:2]
    db.rows["grammar_recommendations"] = [
        {"id": "g1", "user_id": U_LAN, "recommended_slug": slug_a, "created_at": _ago(days=1)},
        {"id": "g2", "user_id": U_LAN, "recommended_slug": slug_a, "created_at": _ago(days=3)},
        {"id": "g3", "user_id": U_LAN, "recommended_slug": slug_b, "created_at": _ago(days=2)},   # once: not weak
        {"id": "g4", "user_id": U_LAN, "recommended_slug": slug_b, "created_at": _ago(days=40)},  # outside 30 days
        {"id": "g5", "user_id": U_LAN, "recommended_slug": "no-such-article", "created_at": _ago(days=1)},
        {"id": "g6", "user_id": U_LAN, "recommended_slug": "no-such-article", "created_at": _ago(days=1)},
    ]
    groups = _attempts(f"u-{U_LAN}")["weak_grammar_groups"]
    article = grammar_service.get_article_by_slug(slug_a)
    assert groups == [{"tag": slug_a, "label_vi": article.get("title", slug_a), "category": article.get("category", ""),
                       "occurrence_count": 2, "last_seen_at": db.rows["grammar_recommendations"][0]["created_at"]}]


def test_a_failed_insight_is_null_and_named(db):
    _seed(db)
    db.fail.add("grammar_recommendations")
    out = _attempts(f"u-{U_LAN}")
    assert out["weak_grammar_groups"] is None and out["sources_failed"] == ["weak_grammar_groups"]
    assert len(out["items"]) == 10


def test_an_unknown_status_is_other_never_a_guess(db):
    _seed(db)
    db.rows["sessions"][0]["status"] = "brand_new_status"
    x1 = next(i for i in _attempts(f"u-{U_LAN}")["items"] if i["id"] == "x1")
    assert x1["state"] == "other" and x1["result_text"] is None


def test_pages_cover_every_attempt_once(db):
    db.rows["sessions"] = [{"id": f"x{i:03d}", "user_id": U_LAN, "part": 1, "topic": "T", "status": "completed",
                            "overall_band": 6.0, "started_at": _ago(days=1), "completed_at": _ago(days=1)
                            if i % 4 == 0 else _ago(days=1, minutes=i)} for i in range(70)]
    first = _attempts(f"u-{U_LAN}", skill="speaking")
    second = _attempts(f"u-{U_LAN}", skill="speaking", cursor=first["next_cursor"])
    third = _attempts(f"u-{U_LAN}", skill="speaking", cursor=second["next_cursor"])
    assert [len(p["items"]) for p in (first, second, third)] == [30, 30, 10] and third["next_cursor"] is None
    ids = [i["id"] for p in (first, second, third) for i in p["items"]]
    assert sorted(ids) == sorted(f"x{i:03d}" for i in range(70))


def test_a_bad_cursor_is_refused(db):
    with pytest.raises(HTTPException) as exc:
        _attempts(f"u-{U_LAN}", cursor="nope")
    assert exc.value.status_code == 422 and exc.value.detail["code"] == "bad_cursor"


def test_an_offline_learner_has_only_their_writing(db):
    db.rows["writing_essays"] = [{"id": "e-duc", "student_id": S_OFFLINE, "task_type": "task2", "status": "pending",
                                  "is_flagged": False, "deleted_at": None, "created_at": _ago(days=1)}]
    out = _attempts(f"s-{S_OFFLINE}")
    assert [(i["skill"], i["id"], i["state"]) for i in out["items"]] == [("writing", "e-duc", "submitted")]
