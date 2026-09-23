"""Canonical admin Review eligibility, including per-sitting retakes."""

import copy
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


class _Database:
    def __init__(self, rows, actionable=(), failure=None, receipt=None):
        self.rows = rows
        self.actionable = set(actionable)
        self.failure = failure
        self.receipt = receipt
        self.rpc_calls = []

    def table(self, name):
        pytest.fail(f"post-snapshot table read: {name}")

    def rpc(self, name, params):
        self.rpc_calls.append((name, params))
        if self.failure:
            raise self.failure
        if self.receipt is not None:
            return _Response(self.receipt)
        assert name == "fn_admin_mock_exams_with_review_eligibility"
        assert params == {}
        rows = sorted(self.rows, key=lambda row: (row["created_at"], row["id"]), reverse=True)
        return _Response({"exams": [{
            **copy.deepcopy(row),
            "review_eligible": bool(row["id"] in self.actionable and (
                row["status"] != "published" or row["exam_mode"] == "retake"
                or (row["is_open"] is False and row["active_section"] == "done")
            )),
        } for row in rows]})


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

    assert db.rpc_calls == [("fn_admin_mock_exams_with_review_eligibility", {})]
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
    assert db.rpc_calls == [("fn_admin_mock_exams_with_review_eligibility", {})]


def test_admin_exam_list_rejects_malformed_or_duplicate_snapshot_rows(monkeypatch):
    db = _Database([], receipt={"exams": [
        {**_exam("r-open", "retake"), "review_eligible": True},
        {**_exam("r-open", "retake"), "review_eligible": True},
    ]})
    monkeypatch.setattr(svc, "supabase_admin", db)
    with pytest.raises(RuntimeError, match="malformed"):
        svc.admin_list_exams()
    db.receipt = {"exams": [{**_exam("r-open", "retake"), "review_eligible": None}]}
    with pytest.raises(RuntimeError, match="malformed"):
        svc.admin_list_exams()
    db.receipt = {"exams": ["not a row"]}
    with pytest.raises(RuntimeError, match="malformed"):
        svc.admin_list_exams()


@pytest.mark.parametrize("change,expected", [
    ("status", {"status": "published", "review_eligible": True}),
    ("archived", {"status": "published", "review_eligible": True}),
    ("is_open", {"is_open": False, "review_eligible": True}),
    ("active_section", {"active_section": "done", "review_eligible": True}),
    ("delete", {"id": "s-done", "review_eligible": True}),
    ("review", {"review_eligible": True}),
])
def test_admin_exam_list_uses_one_snapshot_when_gate_changes(monkeypatch, change, expected):
    row = _exam("s-done", "sequential", section="done")
    db = _Database([row], actionable=["s-done"])
    original_rpc = db.rpc

    def mutate_after_snapshot(name, params):
        response = original_rpc(name, params)
        if change == "status":
            row["status"] = "draft"
        elif change == "archived":
            row["status"] = "archived"
        elif change == "is_open":
            row["is_open"] = True
        elif change == "active_section":
            row["active_section"] = "writing"
        elif change == "delete":
            db.rows.clear()
        elif change == "review":
            db.actionable.clear()
        return response

    monkeypatch.setattr(db, "rpc", mutate_after_snapshot)
    monkeypatch.setattr(svc, "supabase_admin", db)
    result = svc.admin_list_exams()
    assert len(result) == 1
    assert all(result[0][key] == value for key, value in expected.items())


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
