"""Canonical admin Review eligibility, including per-sitting retakes."""

from pathlib import Path

import pytest

from services import mock_exam_service as svc


SQL = (Path(__file__).parents[1] / "migrations" /
       "298_admin_mock_review_eligibility.sql").read_text(encoding="utf-8")


class _Response:
    def __init__(self, data):
        self.data = data

    def execute(self):
        return self


class _ExamQuery:
    def __init__(self, rows):
        self.rows = rows
        self.orders = []

    def select(self, columns):
        assert columns == "*"
        return self

    def order(self, key, desc=False):
        self.orders.append((key, desc))
        return self

    def execute(self):
        rows = sorted(self.rows, key=lambda row: (row["created_at"], row["id"]), reverse=True)
        return _Response(rows)


class _Database:
    def __init__(self, rows, actionable=(), failure=None):
        self.query = _ExamQuery(rows)
        self.actionable = actionable
        self.failure = failure
        self.rpc_calls = []

    def table(self, name):
        assert name == "mock_exams"
        return self.query

    def rpc(self, name, params):
        self.rpc_calls.append((name, params))
        if self.failure:
            raise self.failure
        return _Response({"exam_ids": list(self.actionable)})


def _exam(id, mode, *, status="published", open=False, section="not_started", created="2026-09-01"):
    return {"id": id, "exam_mode": mode, "status": status, "is_open": open,
            "active_section": section, "created_at": created}


def test_admin_exam_list_requires_persisted_work_for_every_mode_and_stable_order(monkeypatch):
    db = _Database([
        _exam("s-done", "sequential", section="done"),
        _exam("s-released", "sequential", section="done"),
        _exam("s-empty", "sequential", section="done"),
        _exam("r-open", "retake", open=True),
        _exam("r-released", "retake"),
        _exam("s-open", "sequential", open=True, section="done"),
        _exam("a-sequential", "sequential", status="archived", section="writing"),
        _exam("a-retake", "retake", status="archived"),
        _exam("a-released", "retake", status="archived"),
        _exam("draft", "retake", status="draft"),
    ], actionable=["s-done", "s-open", "r-open", "a-sequential", "a-retake", "draft"])
    monkeypatch.setattr(svc, "supabase_admin", db)

    rows = svc.admin_list_exams()

    assert db.query.orders == [("created_at", True), ("id", True)]
    assert db.rpc_calls == [("fn_admin_mock_actionable_review_exam_ids", {
        "p_exam_ids": ["a-released", "a-retake", "a-sequential", "draft", "r-open", "r-released", "s-done", "s-empty", "s-open", "s-released"],
    })]
    assert [row["id"] for row in rows] == ["s-released", "s-open", "s-empty", "s-done", "r-released", "r-open", "draft", "a-sequential", "a-retake", "a-released"]
    assert {row["id"]: row["review_eligible"] for row in rows} == {
        "s-done": True, "r-open": True, "r-released": False,
        "s-open": False, "s-released": False, "s-empty": False,
        "draft": True, "a-sequential": True,
        "a-retake": True, "a-released": False,
    }


def test_admin_exam_list_fails_instead_of_inventing_no_retake_work(monkeypatch):
    db = _Database([_exam("r-open", "retake", open=True)], failure=RuntimeError("lookup failed"))
    monkeypatch.setattr(svc, "supabase_admin", db)
    with pytest.raises(RuntimeError, match="lookup failed"):
        svc.admin_list_exams()


def test_admin_exam_list_fails_closed_when_sequential_lookup_fails(monkeypatch):
    db = _Database([_exam("s-done", "sequential", section="done")],
                   failure=RuntimeError("lookup unavailable"))
    monkeypatch.setattr(svc, "supabase_admin", db)
    with pytest.raises(RuntimeError, match="lookup unavailable"):
        svc.admin_list_exams()
    assert db.rpc_calls[0][1]["p_exam_ids"] == ["s-done"]


def test_admin_exam_list_rejects_foreign_or_duplicate_eligibility_ids(monkeypatch):
    db = _Database([_exam("r-open", "retake", open=True)], actionable=["foreign"])
    monkeypatch.setattr(svc, "supabase_admin", db)
    with pytest.raises(RuntimeError, match="malformed"):
        svc.admin_list_exams()
    db.actionable = ["r-open", "r-open"]
    with pytest.raises(RuntimeError, match="malformed"):
        svc.admin_list_exams()


def test_admin_exam_list_response_schema_pins_new_flag_without_hiding_old_fields():
    from main import app
    from routers.admin_mock_exams import AdminMockExamListResponse

    payload = AdminMockExamListResponse.model_validate({"exams": [{
        **_exam("r-open", "retake", open=True),
        "code": "R-1", "title": "Retake", "review_eligible": True,
        "reading_test_id": "paper-1",
    }]}).model_dump()
    assert payload["exams"][0]["review_eligible"] is True
    assert payload["exams"][0]["reading_test_id"] == "paper-1"
    schema = app.openapi()["paths"]["/admin/mock-exams"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
    assert schema == {"$ref": "#/components/schemas/AdminMockExamListResponse"}
    row_schema = app.openapi()["components"]["schemas"]["AdminMockExamListRow"]
    assert row_schema["properties"]["review_eligible"]["type"] == "boolean"
    assert "review_eligible" in row_schema["required"]


def test_admin_review_rpc_is_set_based_private_and_idempotent():
    assert "CREATE OR REPLACE FUNCTION public.fn_admin_mock_actionable_review_exam_ids(" in SQL
    assert "p_exam_ids uuid[]" in SQL
    assert "RETURNS jsonb" in SQL
    assert "exam.id = ANY(p_exam_ids)" in SQL
    assert "'exam_ids'" in SQL
    assert "JOIN public.mock_exam_sittings AS sitting" in SQL
    assert "JOIN public.mock_exam_reviews AS review" in SQL
    assert "exam.exam_mode = 'retake' OR exam.status <> 'published'" not in SQL
    assert "WHERE exam.id = ANY(p_exam_ids)" in SQL
    assert "sitting.status IN ('all_submitted', 'under_review', 'reviewed')" in SQL
    assert "review.status IN ('queued', 'claimed', 'edited', 'reviewed')" in SQL
    assert "CREATE INDEX IF NOT EXISTS idx_mock_sittings_admin_review_eligibility" in SQL
    assert "SECURITY DEFINER" in SQL
    assert "SET search_path = pg_catalog, public" in SQL
    assert "REVOKE ALL ON FUNCTION public.fn_admin_mock_actionable_review_exam_ids(uuid[])" in SQL
    assert "FROM PUBLIC, anon, authenticated" in SQL
    assert "GRANT EXECUTE ON FUNCTION public.fn_admin_mock_actionable_review_exam_ids(uuid[])" in SQL
    assert "TO service_role" in SQL
    assert "DROP TABLE" not in SQL and "DROP COLUMN" not in SQL
