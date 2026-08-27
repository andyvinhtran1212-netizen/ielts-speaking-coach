"""Curated Vocab Wiki contracts: grading, publish gates, auth and kill switches."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, call, patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

from services import vocab_unit_rules, vocab_units

AUTH = {"Authorization": "Bearer learner.jwt"}
ADMIN_AUTH = {"Authorization": "Bearer admin.jwt"}
LEARNER = {"id": "11111111-1111-1111-1111-111111111111"}
ADMIN = {"id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}
TASK_ID = "22222222-2222-2222-2222-222222222222"
ATTEMPT_ID = "33333333-3333-3333-3333-333333333333"


def _client() -> TestClient:
    from main import app
    return TestClient(app)


def _query(data):
    query = MagicMock()
    for method in (
        "select", "eq", "in_", "limit", "order", "lte", "range", "update", "upsert",
    ):
        getattr(query, method).return_value = query
    query.execute.return_value = MagicMock(data=data)
    return query


def _complete_content() -> dict:
    return {
        "title_vi": "Ảnh hưởng theo cách tự nhiên",
        "learning_goal_vi": "Dùng cấu trúc have an impact on khi nói IELTS.",
        "sense": "cause a change",
        "construction": "have a positive/negative impact on + noun",
        "communicative_function": "explain consequences",
        "why_vietnamese_learners_struggle": "Hay dịch từng chữ từ tiếng Việt.",
        "meaning_vi": "tạo ra ảnh hưởng lên một đối tượng",
        "usage_vi": "Dùng danh từ impact sau have, không dùng make.",
        "contrast_vi": "affect là động từ; have an impact on là cụm danh từ.",
        "production_prompt_vi": "Nói một câu về tác động của công nghệ.",
        "memory_hook_vi": "have + an impact + on",
        "examples": [
            {"en": "Technology has an impact on work.", "vi": "Công nghệ ảnh hưởng tới việc làm."},
            {"en": "Noise has a negative impact on sleep.", "vi": "Tiếng ồn ảnh hưởng xấu tới giấc ngủ."},
            {"en": "Teachers have an impact on confidence.", "vi": "Giáo viên ảnh hưởng tới sự tự tin."},
        ],
    }


def _tasks() -> list[dict]:
    return [
        {"status": "active", "task_type": "meaning_recall", "dimension": "meaning_recall", "prompt": "Nghĩa?", "answer_key": {"accepted": ["target"]}},
        {"status": "active", "task_type": "error_repair", "dimension": "usage_control", "prompt": "Sửa lỗi", "answer_key": {"accepted": ["target"]}},
        {"status": "active", "task_type": "controlled_gap", "dimension": "usage_control", "prompt": "Điền từ", "answer_key": {"accepted": ["target"]}},
        {"status": "active", "task_type": "productive_transfer", "dimension": "productive_transfer", "prompt": "Tạo câu", "answer_key": {"required_groups": [["target"]], "minimum_words": 1, "model_answer": "target"}},
    ]


def test_exact_grader_uses_private_answer_key_not_client_correctness():
    task = {
        "task_type": "controlled_gap",
        "answer_key": {
            "accepted": ["has a negative impact on"],
            "retry_vi": "Kiểm tra lại giới từ on.",
            "success_vi": "Đúng cấu trúc.",
        },
    }
    result = vocab_units.grade_response(
        task,
        {"answer": "HAS a negative impact on", "correct": False},
    )
    assert result["correct"] is True
    assert result["score"] == 1.0


def test_version_hash_covers_content_sources_and_private_tasks():
    content = {"title_vi": "Unit"}
    sources = [{"title": "Source", "url": "https://example.com"}]
    tasks = [{"task_type": "controlled_gap", "answer_key": {"accepted": ["on"]}}]
    baseline = vocab_unit_rules.canonical_version_hash(content, sources, tasks)
    assert vocab_unit_rules.canonical_version_hash(
        content, [{**sources[0], "title": "Changed"}], tasks,
    ) != baseline
    assert vocab_unit_rules.canonical_version_hash(
        content, sources, [{**tasks[0], "prompt": "Changed"}],
    ) != baseline


def test_postgrest_pager_reads_beyond_the_default_cap():
    query = _query([])
    query.execute.side_effect = [
        MagicMock(data=[{"id": "1"}, {"id": "2"}]),
        MagicMock(data=[{"id": "3"}]),
    ]
    assert [row["id"] for row in vocab_units._paged_rows(query, page_size=2)] == [
        "1", "2", "3",
    ]
    assert query.range.call_args_list == [call(0, 1), call(2, 3)]


def test_postgrest_pager_fails_closed_when_editorial_cap_is_exceeded():
    query = _query([
        {"id": "1"}, {"id": "2"}, {"id": "3"},
    ])
    with pytest.raises(vocab_units.VocabUnitError, match="giới hạn an toàn 2"):
        vocab_units._paged_rows(query, page_size=100, max_rows=2)
    query.range.assert_called_once_with(0, 2)


def test_published_unit_id_filters_are_chunked_to_bound_urls():
    first_units = _query([])
    second_units = _query([])
    with patch.object(vocab_units, "supabase_admin") as database:
        database.table.side_effect = [first_units, second_units]
        assert vocab_units._load_published_units(
            unit_ids=[f"unit-{index}" for index in range(201)],
        ) == []
    assert len(first_units.in_.call_args.args[1]) == 200
    assert len(second_units.in_.call_args.args[1]) == 1


def test_productive_transfer_requires_context_and_avoids_known_error():
    task = {
        "task_type": "productive_transfer",
        "answer_key": {
            "required_groups": [["impact on"], ["technology", "social media"]],
            "required_frames": [[["have", "has", "had"], ["impact"], ["on"]]],
            "maximum_gap_words": 3,
            "minimum_words": 7,
            "forbidden": ["make an impact on"],
            "retry_vi": "Dùng have an impact on và thêm ngữ cảnh.",
        },
    }
    good = vocab_units.grade_response(
        task, {"answer": "Technology has a major impact on the way people work."},
    )
    weak = vocab_units.grade_response(
        task, {"answer": "Technology make an impact on work."},
    )
    keyword_only = vocab_units.grade_response(
        task, {"answer": "Technology impact on work is becoming more significant."},
    )
    assert good == {"correct": True, "score": 1.0, "feedback_vi": None, "model_answer": None}
    assert weak["correct"] is False and weak["score"] < 1
    assert keyword_only["correct"] is False and keyword_only["score"] < 1


def test_publish_validator_requires_three_dimensions_contexts_and_sources():
    assert vocab_units.validate_for_publish(
        _complete_content(),
        [{"title": "Cambridge Dictionary", "url": "https://dictionary.cambridge.org/"}],
        _tasks(),
    ) == []
    errors = vocab_units.validate_for_publish({}, [], [])
    assert any("productive_transfer" in error for error in errors)
    assert any("sources" in error for error in errors)
    assert any("examples" in error for error in errors)


def test_publish_validator_rejects_ungradable_or_misclassified_tasks():
    tasks = _tasks()
    tasks[1] = {**tasks[1], "dimension": "meaning_recall"}
    tasks[3] = {
        **tasks[3],
        "answer_key": {"required_frames": "not-a-frame", "model_answer": "target"},
    }
    errors = vocab_units.validate_for_publish(
        _complete_content(),
        [{"title": "Cambridge Dictionary", "url": "https://dictionary.cambridge.org/"}],
        tasks,
    )
    assert any("dimension phải là usage_control" in error for error in errors)
    assert any("không chấm được model answer" in error for error in errors)


def test_publish_validator_rejects_unconstrained_productive_transfer():
    tasks = _tasks()
    tasks[3] = {
        **tasks[3],
        "answer_key": {"minimum_words": 1, "model_answer": "anything"},
    }
    errors = vocab_units.validate_for_publish(
        _complete_content(),
        [{"title": "Source", "url": "https://example.com/source"}],
        tasks,
    )
    assert any(
        "productive_transfer cần required_groups hoặc required_frames" in error
        for error in errors
    )
    with pytest.raises(vocab_units.VocabUnitValidationError, match="required_groups"):
        vocab_units.grade_response(tasks[3], {"answer": "anything"})


def test_public_units_default_off_and_legacy_routes_remain_available():
    with patch("routers.vocab_units.runtime_flags.is_enabled", return_value=False):
        response = _client().get("/api/vocabulary/units")
    assert response.status_code == 503
    assert response.json()["detail"]["flag"] == "vocab_units_read"
    # Existing reference route is not guarded by the new flag.
    with patch("routers.vocabulary.vocab_service.get_categories", return_value=[]):
        assert _client().get("/api/vocabulary/categories").status_code == 200


def test_public_units_return_safe_service_payload_when_enabled():
    items = [{"unit_slug": "have-an-impact-on", "title_vi": "Ảnh hưởng tự nhiên"}]
    with patch("routers.vocab_units.runtime_flags.is_enabled", return_value=True), \
         patch("routers.vocab_units.vocab_units.list_units", return_value=items):
        response = _client().get("/api/vocabulary/units?level=B1")
    assert response.status_code == 200
    assert response.json() == {"count": 1, "units": items}


def test_public_unit_withholds_editorial_explanation_until_attempt():
    unit_query = _query([{
        "id": "unit-1", "kp_id": "kp-1", "unit_slug": "have-an-impact-on",
        "display_headword": "have an impact on", "unit_type": "learning_unit",
        "target_level": "B1", "problem_tags": [], "learner_tags": [],
        "current_published_version_id": "version-1",
    }])
    version_query = _query([{
        "id": "version-1", "unit_id": "unit-1", "version_number": 1,
        "schema_version": 1, "content": {}, "sources": [], "published_at": None,
    }])
    task_query = _query([{
        "id": "task-1", "sequence": 1, "task_type": "controlled_gap",
        "dimension": "usage_control", "prompt": "Điền cụm", "options": [],
    }])
    with patch.object(vocab_units, "supabase_admin") as database:
        database.table.side_effect = [unit_query, version_query, task_query]
        payload = vocab_units.get_unit("have-an-impact-on")
    selected = task_query.select.call_args.args[0]
    assert "answer_key" not in selected
    assert "explanation_vi" not in selected
    assert "explanation_vi" not in payload["tasks"][0]


def test_mastery_is_bounded_by_unit_page():
    unit_query = _query([
        {"id": "unit-2", "kp_id": "kp-2", "unit_slug": "u-2", "display_headword": "B", "target_level": "B1"},
        {"id": "unit-3", "kp_id": "kp-3", "unit_slug": "u-3", "display_headword": "C", "target_level": "B1"},
        {"id": "unit-4", "kp_id": "kp-4", "unit_slug": "u-4", "display_headword": "D", "target_level": "B1"},
    ])
    mastery_query = _query([{
        "kp_id": "kp-2", "dimension": "meaning_recall", "state": "retained",
        "attempt_count": 4, "success_count": 4, "last_attempt_at": None,
        "last_success_at": None, "next_review_at": None, "updated_at": None,
    }])
    with patch.object(vocab_units, "supabase_admin") as database:
        database.table.side_effect = [unit_query, mastery_query]
        payload = vocab_units.get_user_mastery(
            LEARNER["id"], page=2, page_size=2,
        )
    unit_query.range.assert_called_once_with(2, 4)
    assert payload["pagination"] == {
        "page": 2, "page_size": 2, "returned_units": 2, "has_more": True,
    }
    assert "counts" not in payload and payload["page_counts"]["retained"] == 1
    assert len(payload["items"]) == 6
    assert {item["unit"]["id"] for item in payload["items"]} == {"unit-2", "unit-3"}


def test_today_discover_rotates_and_excludes_fully_retained_units():
    due_query = _query([])
    retained_query = _query([
        {"kp_id": "kp-retained", "dimension": dimension, "state": "retained"}
        for dimension in vocab_units.MASTERY_DIMENSIONS
    ])
    candidates = [
        (
            {
                "id": f"unit-{index}", "kp_id": "kp-retained" if index == 0 else f"kp-{index}",
                "unit_slug": f"unit-{index}", "display_headword": f"Unit {index}",
                "unit_type": "learning_unit", "target_level": "B1",
                "problem_tags": [], "learner_tags": [],
            },
            {"version_number": 1, "content": {"title_vi": f"Unit {index}"}},
        )
        for index in range(7)
    ]
    with patch.object(vocab_units, "supabase_admin") as database, \
         patch.object(vocab_units, "_load_published_units", side_effect=[[], candidates]):
        database.table.side_effect = [due_query, retained_query]
        payload = vocab_units.get_today(LEARNER["id"], include_recommendations=False)
    assert len(payload["discover"]) == 5
    assert all(item["id"] != "unit-0" for item in payload["discover"])


def test_today_queue_is_capped_and_deduplicated_across_sources():
    recommendation_query = _query([
        {"id": f"rec-{index}", "unit_id": f"unit-{index}", "status": "pending"}
        for index in range(1, 4)
    ])
    due_query = _query([
        {
            "kp_id": kp_id, "dimension": "usage_control", "state": "acquiring",
            "next_review_at": "2026-01-01T00:00:00+00:00",
        }
        for kp_id in ("kp-2", "kp-4", "kp-5", "kp-6")
    ])
    due_units_query = _query([
        {"id": f"unit-{index}", "kp_id": f"kp-{index}"}
        for index in (2, 4, 5, 6)
    ])
    retained_query = _query([])
    requested = [
        (
            {
                "id": f"unit-{index}", "kp_id": f"kp-{index}",
                "unit_slug": f"unit-{index}", "display_headword": f"Unit {index}",
                "unit_type": "learning_unit", "target_level": "B1",
                "problem_tags": [], "learner_tags": [],
            },
            {"version_number": 1, "content": {"title_vi": f"Unit {index}"}},
        )
        for index in range(1, 7)
    ]
    with patch.object(vocab_units, "supabase_admin") as database, \
         patch.object(vocab_units, "_load_published_units", side_effect=[requested, []]):
        database.table.side_effect = [
            recommendation_query, due_query, due_units_query, retained_query,
        ]
        payload = vocab_units.get_today(LEARNER["id"], include_recommendations=True)
    items = payload["recommendations"] + payload["due"] + payload["discover"]
    unit_ids = [str(item["unit"]["id"]) for item in items if "unit" in item]
    unit_ids.extend(str(item["id"]) for item in payload["discover"])
    assert len(items) == 5
    assert len(unit_ids) == len(set(unit_ids))
    assert unit_ids.count("unit-2") == 1
    assert all(item["state"] == "needs_refresh" for item in payload["due"])


def test_today_deduplicates_due_dimensions_before_filling_queue():
    due_query = _query([
        {
            "kp_id": f"kp-{kp_index}", "dimension": dimension,
            "state": "controlled", "next_review_at": "2026-01-01T00:00:00+00:00",
        }
        for kp_index in range(1, 4)
        for dimension in vocab_units.MASTERY_DIMENSIONS
    ] + [{
        "kp_id": "kp-4", "dimension": "meaning_recall", "state": "controlled",
        "next_review_at": "2026-01-01T00:00:00+00:00",
    }])
    due_units_query = _query([
        {"id": f"unit-{index}", "kp_id": f"kp-{index}"}
        for index in range(1, 5)
    ])
    retained_query = _query([])
    pairs = [
        (
            {
                "id": f"unit-{index}", "kp_id": f"kp-{index}",
                "unit_slug": f"unit-{index}", "display_headword": f"Unit {index}",
                "unit_type": "learning_unit", "target_level": "B1",
                "problem_tags": [], "learner_tags": [],
            },
            {"version_number": 1, "content": {"title_vi": f"Unit {index}"}},
        )
        for index in range(1, 6)
    ]
    with patch.object(vocab_units, "supabase_admin") as database, \
         patch.object(vocab_units, "_load_published_units", side_effect=[pairs[:4], pairs]):
        database.table.side_effect = [due_query, due_units_query, retained_query]
        payload = vocab_units.get_today(LEARNER["id"], include_recommendations=False)
    assert [item["unit"]["id"] for item in payload["due"]] == [
        "unit-1", "unit-2", "unit-3", "unit-4",
    ]
    assert len(payload["discover"]) == 1


def test_mastery_route_forwards_validated_pagination():
    expected = {"items": [], "pagination": {"page": 2, "page_size": 10}}
    with patch("routers.vocab_units.get_supabase_user", new=AsyncMock(return_value=LEARNER)), \
         patch("routers.vocab_units.is_vocab_curated_enabled", return_value=True), \
         patch("routers.vocab_units.runtime_flags.is_enabled", return_value=True), \
         patch("routers.vocab_units.vocab_units.get_user_mastery", return_value=expected) as mastery:
        response = _client().get(
            "/api/me/vocabulary/unit-mastery?page=2&page_size=10", headers=AUTH,
        )
    assert response.status_code == 200 and response.json() == expected
    mastery.assert_called_once_with(LEARNER["id"], page=2, page_size=10)


def test_attempt_releases_explanation_only_in_persisted_server_result():
    task_query = _query([{
        "id": TASK_ID, "version_id": "version-1", "task_type": "controlled_gap",
        "dimension": "usage_control", "answer_key": {"accepted": ["on"]},
        "explanation_vi": "Cụm này kết thúc bằng on.",
    }])
    persisted = {
        "correct": True, "score": 1.0, "feedback_vi": "Đúng.",
        "model_answer": "on", "explanation_vi": "Cụm này kết thúc bằng on.",
    }
    rpc_query = _query([{
        "duplicate": False,
        "attempt": {"attempt_id": ATTEMPT_ID, "score": 1.0, "result": persisted},
        "mastery": {"state": "acquiring"},
    }])
    with patch.object(vocab_units, "supabase_admin") as database:
        database.table.return_value = task_query
        database.rpc.return_value = rpc_query
        result = vocab_units.submit_attempt(
            LEARNER["id"], TASK_ID, ATTEMPT_ID, {"answer": "on"},
        )
    rpc_payload = database.rpc.call_args.args[1]
    assert rpc_payload["p_result"]["explanation_vi"] == "Cụm này kết thúc bằng on."
    assert result["explanation_vi"] == "Cụm này kết thúc bằng on."


def test_attempt_id_reuse_with_different_payload_becomes_conflict():
    task_query = _query([{
        "id": TASK_ID, "version_id": "version-1", "task_type": "controlled_gap",
        "dimension": "usage_control", "answer_key": {"accepted": ["on"]},
        "explanation_vi": "Cụm này kết thúc bằng on.",
    }])
    rpc_query = _query([])
    rpc_query.execute.side_effect = Exception(
        "attempt_id_reused_for_different_payload",
    )
    with patch.object(vocab_units, "supabase_admin") as database:
        database.table.return_value = task_query
        database.rpc.return_value = rpc_query
        with pytest.raises(vocab_units.VocabUnitConflict, match="câu trả lời khác"):
            vocab_units.submit_attempt(
                LEARNER["id"], TASK_ID, ATTEMPT_ID, {"answer": "on"},
            )


def test_attempt_requires_auth_before_cohort_or_runtime_checks():
    with patch("routers.vocab_units.is_vocab_curated_enabled") as cohort, \
         patch("routers.vocab_units.runtime_flags.is_enabled") as runtime:
        response = _client().post(
            f"/api/vocabulary/tasks/{TASK_ID}/attempt",
            json={"attempt_id": ATTEMPT_ID, "response": {"answer": "x"}},
        )
    assert response.status_code == 401
    cohort.assert_not_called()
    runtime.assert_not_called()


def test_attempt_rejects_client_supplied_correct_field():
    with patch("routers.vocab_units.get_supabase_user", new=AsyncMock(return_value=LEARNER)), \
         patch("routers.vocab_units.is_vocab_curated_enabled", return_value=True), \
         patch("routers.vocab_units.runtime_flags.is_enabled", return_value=True):
        response = _client().post(
            f"/api/vocabulary/tasks/{TASK_ID}/attempt",
            headers=AUTH,
            json={
                "attempt_id": ATTEMPT_ID,
                "response": {"answer": "x"},
                "correct": True,
            },
        )
    assert response.status_code == 422


def test_attempt_rejects_extra_nested_response_fields():
    with patch("routers.vocab_units.get_supabase_user", new=AsyncMock(return_value=LEARNER)), \
         patch("routers.vocab_units.is_vocab_curated_enabled", return_value=True), \
         patch("routers.vocab_units.runtime_flags.is_enabled", return_value=True):
        response = _client().post(
            f"/api/vocabulary/tasks/{TASK_ID}/attempt",
            headers=AUTH,
            json={
                "attempt_id": ATTEMPT_ID,
                "response": {"answer": "x", "correct": True},
            },
        )
    assert response.status_code == 422


def test_attempt_calls_server_service_only_after_both_gates():
    expected = {"attempt_id": ATTEMPT_ID, "correct": True, "duplicate": False}
    with patch("routers.vocab_units.get_supabase_user", new=AsyncMock(return_value=LEARNER)), \
         patch("routers.vocab_units.is_vocab_curated_enabled", return_value=True), \
         patch("routers.vocab_units.runtime_flags.is_enabled", return_value=True), \
         patch("routers.vocab_units.vocab_units.submit_attempt", return_value=expected) as submit:
        response = _client().post(
            f"/api/vocabulary/tasks/{TASK_ID}/attempt",
            headers=AUTH,
            json={"attempt_id": ATTEMPT_ID, "response": {"answer": "x"}},
        )
    assert response.status_code == 200 and response.json() == expected
    submit.assert_called_once_with(LEARNER["id"], TASK_ID, ATTEMPT_ID, {"answer": "x"})


def test_admin_create_unit_requires_canonical_admin_guard():
    payload = {
        "unit_slug": "have-an-impact-on",
        "display_headword": "have an impact on",
        "sense_key": "cause-change",
        "construction_key": "have-impact-on-noun",
        "communicative_function": "explain-consequence",
        "context_key": "ielts-speaking",
        "target_level": "B1",
    }
    assert _client().post("/admin/vocabulary/units", json=payload).status_code == 401
    created = {"id": "unit-id", **payload}
    with patch("routers.vocab_units.require_admin", new=AsyncMock(return_value=ADMIN)), \
         patch("routers.vocab_units.vocab_units.create_unit", return_value=created) as create:
        response = _client().post("/admin/vocabulary/units", json=payload, headers=ADMIN_AUTH)
    assert response.status_code == 201 and response.json()["id"] == "unit-id"
    create.assert_called_once()


def test_editorial_catalog_derives_the_database_review_gate_truthfully():
    unit_query = _query([{
        "id": "unit-1", "unit_slug": "have-an-impact-on",
        "display_headword": "have an impact on", "status": "draft",
        "current_published_version_id": None,
    }])
    unit_query.execute.return_value.count = 1
    version_query = _query([{
        "id": "version-1", "unit_id": "unit-1", "version_number": 1,
        "status": "in_review", "updated_at": "2026-08-27T00:00:00Z",
    }])
    review_query = _query([
        {
            "id": f"review-{index}", "version_id": "version-1",
            "reviewer_id": reviewer, "review_type": review_type,
            "decision": "approved",
        }
        for index, (review_type, reviewer) in enumerate((
            ("language", "reviewer-language"),
            ("pedagogy", "reviewer-pedagogy"),
            ("assessment", "reviewer-assessment"),
        ))
    ])
    task_query = _query([
        {
            "id": f"task-{index}", "version_id": "version-1",
            "dimension": dimension, "status": "active",
        }
        for index, dimension in enumerate((
            "meaning_recall", "usage_control", "usage_control",
            "productive_transfer",
        ))
    ])
    with patch.object(vocab_units, "supabase_admin") as database:
        database.table.side_effect = [
            unit_query, version_query, review_query, task_query,
        ]
        payload = vocab_units.list_editorial_units(offset=0, limit=50)
    version = payload["items"][0]["versions"][0]
    assert payload["total"] == 1
    assert version["task_count"] == 4
    assert version["dimensions"] == list(vocab_units.MASTERY_DIMENSIONS)
    assert version["review_gate"] == {
        "states": {
            "language": "approved", "pedagogy": "approved",
            "assessment": "approved",
        },
        "pending_review_types": [],
        "has_distinct_reviewers": True,
        "ready_for_publish": True,
    }


def test_editorial_review_gate_stays_blocked_by_change_request():
    gate = vocab_units._review_gate_summary([
        {"review_type": "language", "decision": "approved", "reviewer_id": "a"},
        {"review_type": "language", "decision": "changes_requested", "reviewer_id": "b"},
        {"review_type": "pedagogy", "decision": "approved", "reviewer_id": "b"},
        {"review_type": "assessment", "decision": "approved", "reviewer_id": "c"},
    ])
    assert gate["states"]["language"] == "changes_requested"
    assert gate["pending_review_types"] == ["language"]
    assert gate["ready_for_publish"] is False


def test_editorial_catalog_route_requires_admin_and_forwards_pagination():
    path = "/admin/vocabulary/editorial/units?status=draft&offset=20&limit=10"
    assert _client().get(path).status_code == 401
    expected = {"items": [], "total": 0, "offset": 20, "limit": 10}
    with patch("routers.vocab_units.require_admin", new=AsyncMock(return_value=ADMIN)), \
         patch("routers.vocab_units.vocab_units.list_editorial_units", return_value=expected) as listing:
        response = _client().get(path, headers=ADMIN_AUTH)
    assert response.status_code == 200 and response.json() == expected
    listing.assert_called_once_with(status="draft", offset=20, limit=10)


def test_editorial_detail_route_keeps_private_bundle_behind_admin_guard():
    path = f"/admin/vocabulary/editorial/units/{TASK_ID}"
    assert _client().get(path).status_code == 401
    expected = {
        "unit": {"id": TASK_ID, "display_headword": "target"},
        "versions": [{"id": "version-1", "tasks": [{"answer_key": {"accepted": ["target"]}}]}],
        "events": [],
    }
    with patch("routers.vocab_units.require_admin", new=AsyncMock(return_value=ADMIN)), \
         patch("routers.vocab_units.vocab_units.get_editorial_unit", return_value=expected) as detail:
        response = _client().get(path, headers=ADMIN_AUTH)
    assert response.status_code == 200 and response.json() == expected
    detail.assert_called_once_with(TASK_ID)


def test_schema_migrations_pin_idempotency_rls_and_rpc_security():
    migrations = Path(__file__).parent.parent / "migrations"
    identity = (migrations / "234_vocab_curated_identity_and_editorial.sql").read_text("utf-8")
    attempts = (migrations / "235_vocab_curated_tasks_attempts_mastery.sql").read_text("utf-8")
    flags = (migrations / "236_vocab_curated_recommendations_and_flags.sql").read_text("utf-8")
    for table in (
        "vocab_learning_units", "vocab_unit_versions", "vocab_card_unit_map",
        "vocab_unit_tasks", "vocab_unit_attempts", "user_kp_dimension_mastery",
    ):
        assert f"CREATE TABLE IF NOT EXISTS {table}" in identity + attempts
        assert f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY" in identity + attempts
    assert "'vocab_unit'" in identity
    assert "UNIQUE (user_id, attempt_id)" in attempts
    assert "attempt_id_reused_for_different_payload" in attempts
    assert "pg_advisory_xact_lock" in attempts
    assert "published_vocab_version_is_immutable" in identity
    assert "published_vocab_task_is_immutable" in attempts
    assert "FOR SHARE" in identity and "FOR SHARE" in attempts
    assert "pedagogy.reviewer_id <> language.reviewer_id" in attempts
    assert "assessment.reviewer_id <> pedagogy.reviewer_id" in attempts
    assert "missing_task_count" in attempts
    assert "task_dimension_mismatch" in attempts
    assert "v_successes >= 3" in attempts
    assert ">= 0.75" in attempts and ">= 0.67" in attempts
    assert "vocab_unit_publication_events" in identity + attempts
    assert "fn_replace_vocab_pathway_units" in identity
    assert "DELETE FROM vocab_pathway_units WHERE pathway_id = p_pathway" in identity
    assert "REVOKE ALL ON FUNCTION fn_replace_vocab_pathway_units" in identity
    assert "FROM PUBLIC, anon, authenticated" in attempts
    assert "('vocab_units_read', FALSE" in flags


def test_attempt_replay_precedes_current_version_gate():
    migration = (
        Path(__file__).parent.parent
        / "migrations"
        / "235_vocab_curated_tasks_attempts_mastery.sql"
    ).read_text("utf-8")
    replay_lookup = "WHERE user_id = p_user AND attempt_id = p_attempt"
    current_version_gate = "u.current_published_version_id = v.id"
    assert migration.index(replay_lookup) < migration.index(current_version_gate)
    assert "t.version_id = v_attempt.version_id" in migration


def test_curated_runbook_names_the_canonical_migration_sequence():
    backend = Path(__file__).parent.parent
    runbook = (backend / "docs" / "VOCAB_CURATED_V1.md").read_text("utf-8")
    for number in (234, 235, 236):
        assert f"Migration {number}:" in runbook
    assert "migrations `234`, `235`, `236`" in runbook
    assert "Migration 220:" not in runbook
    assert "Migration 221:" not in runbook
    assert "Migration 222:" not in runbook


def test_curated_pilot_is_valid_and_model_answers_pass_server_grader():
    from scripts.seed_vocab_curated import CONTENT_FILE, load_pilot, validate_pilot

    payload = load_pilot(CONTENT_FILE)
    assert len(payload["units"]) == 12
    assert sum(len(unit["tasks"]) for unit in payload["units"]) == 48
    assert len(payload["pathways"]) == 3
    assert validate_pilot(payload) == []


def test_every_pilot_unit_rejects_its_known_transfer_error():
    from scripts.seed_vocab_curated import CONTENT_FILE, load_pilot

    probes = {
        "have-an-impact-on": "Technology impact on jobs is becoming more significant every year.",
        "play-a-role-in": "Teachers role in education is extremely important for every child today.",
        "be-responsible-for": "Companies responsible for pollution should reduce their plastic waste more quickly.",
        "spend-time-doing": "I spend my free time with close friends and really enjoy cooking.",
        "prefer-x-to-y": "I prefer to keep studying at home rather than in cafes.",
        "access-to-vs-access": "Many students cannot access to academic journals about healthcare research.",
        "actually-vs-currently": "I actually work as an intern this summer in Hanoi.",
        "convenient-vs-comfortable": "The hotel is comfortable because it is next to the station and shops.",
        "borrow-vs-lend": "My friend borrowed me some money for the camera last week.",
        "say-tell-speak-talk": "My teacher spoke me the answer during our English lesson yesterday.",
        "economic-vs-economical": "Taking the bus is more economic for students every single day.",
        "fun-vs-funny": "Playing badminton with my friends is really funny because we enjoy it.",
    }
    units = {unit["unit_slug"]: unit for unit in load_pilot(CONTENT_FILE)["units"]}
    assert set(probes) == set(units), "Mỗi pilot unit cần một known-error probe"
    for slug, answer in probes.items():
        task = next(
            task for task in units[slug]["tasks"]
            if task["task_type"] == "productive_transfer"
        )
        result = vocab_units.grade_response(task, {"answer": answer})
        assert result["correct"] is False, f"{slug} accepted keyword-only answer"

    impact_task = next(
        task for task in units["have-an-impact-on"]["tasks"]
        if task["task_type"] == "productive_transfer"
    )
    assert "make an impact on" not in impact_task["answer_key"]["forbidden"]


def test_curated_pilot_identity_and_pathway_refs_are_unique():
    from scripts.seed_vocab_curated import CONTENT_FILE, load_pilot

    payload = load_pilot(CONTENT_FILE)
    slugs = [unit["unit_slug"] for unit in payload["units"]]
    identities = [tuple(unit[key] for key in (
        "sense_key", "construction_key", "communicative_function", "context_key",
    )) for unit in payload["units"]]
    assert len(slugs) == len(set(slugs))
    assert len(identities) == len(set(identities))
    assert all(ref in set(slugs) for path in payload["pathways"] for ref in path["units"])


def test_pathway_seed_refresh_preserves_original_creator():
    from scripts.seed_vocab_curated import _seed_pathways

    existing_query = _query([{"id": "path-1", "created_by": "original-admin"}])
    pathway_upsert = _query([{"id": "path-1"}])
    replace_query = _query([{"count": 2}])
    pathway = {
        "pathway_slug": "pilot-path", "title_vi": "Pilot",
        "description_vi": "Pathway", "target_level": "B1",
        "learner_tags": [], "units": ["unit-two", "unit-one"],
    }
    with patch("database.supabase_admin") as database:
        database.table.side_effect = [existing_query, pathway_upsert]
        database.rpc.return_value = replace_query
        _seed_pathways(
            [pathway], {
                "unit-one": {"id": "unit-1"}, "unit-two": {"id": "unit-2"},
            }, "refreshing-admin",
            publish=False,
        )
    seeded_row = pathway_upsert.upsert.call_args.args[0]
    assert "created_by" not in seeded_row
    assert "status" not in seeded_row
    database.rpc.assert_called_once_with("fn_replace_vocab_pathway_units", {
        "p_pathway": "path-1",
        "p_links": [
            {
                "unit_id": "unit-2", "sequence": 1,
                "rationale_vi": "Tiếp nối có chủ đích trong pathway pilot.",
            },
            {
                "unit_id": "unit-1", "sequence": 2,
                "rationale_vi": "Tiếp nối có chủ đích trong pathway pilot.",
            },
        ],
    })


def test_publish_validator_rejects_non_https_sources():
    errors = vocab_units.validate_for_publish(
        _complete_content(),
        [{"title": "Unsafe", "url": "javascript:alert(1)"}],
        _tasks(),
    )
    assert any("HTTPS" in error for error in errors)
