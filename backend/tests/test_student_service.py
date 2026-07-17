"""Tests for services.student_service (Sprint W2 Phase 1).

Service-level coverage for CSV parsing logic + helpers — supabase_admin
is mocked so no DB IO. Router-level wiring is covered separately in
test_admin_students.py.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from services import student_service


_ADMIN_ID = "00000000-0000-0000-0000-00000000aaaa"


def _stub_chain(insert_data: list | None = None,
                insert_raises: Exception | None = None) -> MagicMock:
    """Build a chainable mock that mimics supabase_admin.table(...).insert(...).execute()."""
    table = MagicMock()
    insert = MagicMock()
    execute = MagicMock()
    if insert_raises:
        execute.side_effect = insert_raises
    else:
        execute.return_value = MagicMock(data=insert_data or [])
    insert.execute = execute
    table.insert = MagicMock(return_value=insert)
    return MagicMock(return_value=table)


# ── _is_duplicate_code_error ─────────────────────────────────────────

@pytest.mark.parametrize("msg", [
    "duplicate key value violates unique constraint",
    "Postgres error 23505: ...",
    "violates UNIQUE CONSTRAINT students_student_code_key",
])
def test_duplicate_detector_matches_known_signals(msg):
    assert student_service._is_duplicate_code_error(Exception(msg)) is True


def test_duplicate_detector_negative():
    assert student_service._is_duplicate_code_error(Exception("connection refused")) is False


# ── bulk_import_students — pure parsing logic ────────────────────────

def test_bulk_import_rejects_empty_csv():
    with pytest.raises(HTTPException) as exc:
        student_service.bulk_import_students(csv_content="", admin_id=_ADMIN_ID)
    assert exc.value.status_code == 400


def test_bulk_import_rejects_missing_required_columns():
    with pytest.raises(HTTPException) as exc:
        student_service.bulk_import_students(
            csv_content="student_code,age\nS001,21\n",
            admin_id=_ADMIN_ID,
        )
    assert exc.value.status_code == 400
    assert "full_name" in str(exc.value.detail)


def test_bulk_import_happy_path_inserts_each_row():
    csv = (
        "student_code,full_name,target_band\n"
        "S001,Nguyen A,7\n"
        "S002,Tran B,6.5\n"
    )
    with patch.object(student_service, "create_student") as mock_create:
        result = student_service.bulk_import_students(csv_content=csv, admin_id=_ADMIN_ID)

    assert result == {"imported": 2, "errors": []}
    assert mock_create.call_count == 2
    first = mock_create.call_args_list[0].kwargs
    assert first["data"]["student_code"] == "S001"
    assert first["data"]["target_band"] == 7.0
    assert first["admin_id"] == _ADMIN_ID


def test_bulk_import_skips_blank_required_fields():
    csv = (
        "student_code,full_name\n"
        ",missing-code\n"
        "S010,\n"
        "S011,Valid Row\n"
    )
    with patch.object(student_service, "create_student") as mock_create:
        result = student_service.bulk_import_students(csv_content=csv, admin_id=_ADMIN_ID)

    assert result["imported"] == 1
    assert len(result["errors"]) == 2
    assert result["errors"][0]["row"] == 2
    assert result["errors"][1]["row"] == 3
    assert mock_create.call_count == 1


def test_bulk_import_flags_non_numeric_target_band():
    csv = (
        "student_code,full_name,target_band\n"
        "S001,A,seven\n"
    )
    with patch.object(student_service, "create_student") as mock_create:
        result = student_service.bulk_import_students(csv_content=csv, admin_id=_ADMIN_ID)

    assert result["imported"] == 0
    assert "target_band not numeric" in result["errors"][0]["error"]
    mock_create.assert_not_called()


def test_bulk_import_collects_duplicate_code_errors_without_aborting():
    """One row succeeds; another duplicates — second is logged, loop continues."""
    csv = (
        "student_code,full_name\n"
        "S001,A\n"
        "S001,B-duplicate\n"
        "S002,C\n"
    )

    def fake_create(*, data, admin_id):
        if data["student_code"] == "S001" and data["full_name"] == "B-duplicate":
            raise HTTPException(409, f"student_code already exists: {data['student_code']!r}")
        return {"id": "x", **data}

    with patch.object(student_service, "create_student", side_effect=fake_create):
        result = student_service.bulk_import_students(csv_content=csv, admin_id=_ADMIN_ID)

    assert result["imported"] == 2
    assert len(result["errors"]) == 1
    assert result["errors"][0]["row"] == 3
    assert "already exists" in result["errors"][0]["error"]


def test_bulk_import_normalizes_header_case_and_whitespace():
    csv = (
        " Student_Code , Full_Name \n"
        "S001,Test\n"
    )
    with patch.object(student_service, "create_student") as mock_create:
        result = student_service.bulk_import_students(csv_content=csv, admin_id=_ADMIN_ID)
    assert result["imported"] == 1
    assert mock_create.call_args.kwargs["data"]["student_code"] == "S001"


# ── create_student error mapping ─────────────────────────────────────

def test_create_student_raises_409_on_duplicate():
    duplicate = Exception("duplicate key value violates unique constraint")
    with patch.object(
        student_service, "supabase_admin",
        MagicMock(table=_stub_chain(insert_raises=duplicate)),
    ):
        with pytest.raises(HTTPException) as exc:
            student_service.create_student(
                data={"student_code": "S001", "full_name": "A"},
                admin_id=_ADMIN_ID,
            )
    assert exc.value.status_code == 409


def test_create_student_returns_inserted_row():
    inserted = {"id": "x", "student_code": "S001", "full_name": "A"}
    with patch.object(
        student_service, "supabase_admin",
        MagicMock(table=_stub_chain(insert_data=[inserted])),
    ):
        row = student_service.create_student(
            data={"student_code": "S001", "full_name": "A"},
            admin_id=_ADMIN_ID,
        )
    assert row == inserted


# ── _listening_summary (audit 2026-07-17 đợt 3) ──────────────────────

class _LisQ:
    def __init__(self, rows): self._rows = rows; self._range = None
    def select(self, *_a, **_k): return self
    def eq(self, *_a): return self
    def order(self, *_a, **_k): return self
    def limit(self, *_a): return self
    def range(self, s, e): self._range = (s, e); return self
    def execute(self):
        rows = self._rows
        if self._range:
            s, e = self._range
            rows = rows[s:e + 1]
        return MagicMock(data=rows)


class _LisFake:
    def __init__(self, tables): self.tables = tables
    def table(self, name): return _LisQ(self.tables.get(name, []))


def _lis_att(test_id, status, score, total, created, dur=None):
    row = {"test_id": test_id, "status": status,
           "score": score if status == "submitted" else None,
           "grading_details": ([{"q": i} for i in range(total)]
                               if status == "submitted" else []),
           "created_at": created, "started_at": None, "submitted_at": None}
    if dur is not None:
        row["started_at"] = "2026-07-17T10:00:00+00:00"
        row["submitted_at"] = f"2026-07-17T10:{dur:02d}:00+00:00"
    return row


def test_listening_summary_aggregates_first_submitted_rule():
    tables = {
        "listening_test_attempts": [   # newest-first như query thật
            _lis_att("t1", "submitted", 9, 10, "2026-07-17T12:00:00+00:00", dur=10),  # retry
            _lis_att("t1", "submitted", 5, 10, "2026-07-16T12:00:00+00:00", dur=20),  # lượt nộp ĐẦU → 0.5
            _lis_att("t2", "abandoned", None, 0, "2026-07-15T12:00:00+00:00"),
        ],
        "dictation_sessions": [
            {"accuracy": 0.9, "completed_at": "2026-07-16T17:00:00+00:00",
             "created_at": "2026-07-16T17:00:00+00:00"},
        ],
        "users": [{"email": "hv@ex.com"}],
    }
    with patch.object(student_service, "supabase_admin", _LisFake(tables)):
        out = student_service._listening_summary("u1")
    assert out["attempts_total"] == 3
    assert out["attempts_submitted"] == 2
    assert out["attempts_abandoned"] == 1
    assert out["avg_accuracy"] == 0.5          # lượt NỘP đầu của t1, retry không tính
    assert out["avg_duration_seconds"] == 900  # (10p + 20p)/2
    assert out["last_attempt_at"] == "2026-07-17T12:00:00+00:00"
    assert out["dictation_total"] == 1
    assert out["dictation_avg_accuracy"] == 0.9
    assert out["user_email"] == "hv@ex.com"


def test_listening_summary_paginates_past_1000_rows():
    """Cap newest-N từng cắt lịch sử >N (sai tổng + chọn nhầm retry làm lượt
    nộp đầu) — giờ phân trang đủ (review P2, PR #810)."""
    rows = [_lis_att(f"t{i}", "submitted", 5, 10,
                     f"2026-07-{17 - (i // 100):02d}T{i % 24:02d}:00:00+00:00")
            for i in range(1200)]
    tables = {"listening_test_attempts": rows, "dictation_sessions": [],
              "users": [{"email": "hv@ex.com"}]}
    with patch.object(student_service, "supabase_admin", _LisFake(tables)):
        out = student_service._listening_summary("u1")
    assert out["attempts_total"] == 1200          # không bị cắt ở 1000
    assert out["attempts_submitted"] == 1200


def test_listening_summary_none_without_account_or_on_error():
    assert student_service._listening_summary(None) is None

    class _Boom:
        def table(self, name): raise RuntimeError("db down")
    with patch.object(student_service, "supabase_admin", _Boom()):
        assert student_service._listening_summary("u1") is None
