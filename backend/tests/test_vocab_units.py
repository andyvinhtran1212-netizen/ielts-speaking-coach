"""Curated Vocab Wiki contracts: grading, publish gates, auth and kill switches."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

from services import vocab_units

AUTH = {"Authorization": "Bearer learner.jwt"}
ADMIN_AUTH = {"Authorization": "Bearer admin.jwt"}
LEARNER = {"id": "11111111-1111-1111-1111-111111111111"}
ADMIN = {"id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}
TASK_ID = "22222222-2222-2222-2222-222222222222"
ATTEMPT_ID = "33333333-3333-3333-3333-333333333333"


def _client() -> TestClient:
    from main import app
    return TestClient(app)


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
        {"status": "active", "dimension": "meaning_recall", "prompt": "Nghĩa?", "answer_key": {}},
        {"status": "active", "dimension": "usage_control", "prompt": "Sửa lỗi", "answer_key": {}},
        {"status": "active", "dimension": "usage_control", "prompt": "Điền từ", "answer_key": {}},
        {"status": "active", "dimension": "productive_transfer", "prompt": "Tạo câu", "answer_key": {}},
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


def test_productive_transfer_requires_context_and_avoids_known_error():
    task = {
        "task_type": "productive_transfer",
        "answer_key": {
            "required_groups": [["impact on"], ["technology", "social media"]],
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
    assert good == {"correct": True, "score": 1.0, "feedback_vi": None, "model_answer": None}
    assert weak["correct"] is False and weak["score"] < 1


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


def test_public_units_default_off_and_legacy_routes_remain_available():
    with patch("routers.vocab_units.runtime_flags.is_enabled", return_value=False):
        response = _client().get("/api/vocabulary/units")
    assert response.status_code == 503
    assert response.json()["detail"]["flag"] == "vocab_units_read"
    # Existing reference route is not guarded by the new flag.
    assert _client().get("/api/vocabulary/categories").status_code == 200


def test_public_units_return_safe_service_payload_when_enabled():
    items = [{"unit_slug": "have-an-impact-on", "title_vi": "Ảnh hưởng tự nhiên"}]
    with patch("routers.vocab_units.runtime_flags.is_enabled", return_value=True), \
         patch("routers.vocab_units.vocab_units.list_units", return_value=items):
        response = _client().get("/api/vocabulary/units?level=B1")
    assert response.status_code == 200
    assert response.json() == {"count": 1, "units": items}


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


def test_schema_migrations_pin_idempotency_rls_and_rpc_security():
    migrations = Path(__file__).parent.parent / "migrations"
    identity = (migrations / "220_vocab_curated_identity_and_editorial.sql").read_text("utf-8")
    attempts = (migrations / "221_vocab_curated_tasks_attempts_mastery.sql").read_text("utf-8")
    flags = (migrations / "222_vocab_curated_recommendations_and_flags.sql").read_text("utf-8")
    for table in (
        "vocab_learning_units", "vocab_unit_versions", "vocab_card_unit_map",
        "vocab_unit_tasks", "vocab_unit_attempts", "user_kp_dimension_mastery",
    ):
        assert f"CREATE TABLE IF NOT EXISTS {table}" in identity + attempts
        assert f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY" in identity + attempts
    assert "'vocab_unit'" in identity
    assert "UNIQUE (user_id, attempt_id)" in attempts
    assert "pg_advisory_xact_lock" in attempts
    assert "published_vocab_version_is_immutable" in identity
    assert "published_vocab_task_is_immutable" in attempts
    assert "COUNT(DISTINCT reviewer_id)" in attempts
    assert "vocab_unit_publication_events" in identity + attempts
    assert "FROM PUBLIC, anon, authenticated" in attempts
    assert "('vocab_units_read', FALSE" in flags


def test_curated_pilot_is_valid_and_model_answers_pass_server_grader():
    from scripts.seed_vocab_curated import CONTENT_FILE, load_pilot, validate_pilot

    payload = load_pilot(CONTENT_FILE)
    assert len(payload["units"]) == 12
    assert sum(len(unit["tasks"]) for unit in payload["units"]) == 48
    assert len(payload["pathways"]) == 3
    assert validate_pilot(payload) == []


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


def test_publish_validator_rejects_non_https_sources():
    errors = vocab_units.validate_for_publish(
        _complete_content(),
        [{"title": "Unsafe", "url": "javascript:alert(1)"}],
        _tasks(),
    )
    assert any("HTTPS" in error for error in errors)
