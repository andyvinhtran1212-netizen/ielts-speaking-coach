from __future__ import annotations

import copy
from unittest.mock import MagicMock

import pytest

from scripts.import_course_assessment_bank import _commit_bank
from services.course_assessment_import import normalize_assessment_rows, parse_lesson_scope


def _row(number: int = 1) -> dict:
    return {
        "id": f"MID-{number:03d}", "dang": "A1", "muc": 2,
        "diem_day": "KHUNG-CAU", "truc": f"khung câu {number}",
        "truc_nhom": "KHUNG-CAU", "chieu": "thuan",
        "de": f"Chọn đáp án đúng cho câu {number}.",
        "pa": ["one", "two", "three", "four", "five"],
        "dap_an": 4, "dap_an_chu": "E",
        "giai_thich": "Five là đáp án đúng.",
        "bay": ["bẫy 1", "bẫy 2", "bẫy 3", "bẫy 4", ""],
        "ma_bay": ["N1", "N2", "N3", "N4", ""],
        "loai_cau_hoi": "multiple_choice_5", "so_phuong_an": 5,
        "lesson_primary": "B01", "classroom_alignment": True,
    }


def test_maps_exactly_five_choices_without_creating_audio_or_sections():
    out = normalize_assessment_rows([_row()], expected_count=1)
    assert out[0]["options"] == ["one", "two", "three", "four", "five"]
    assert out[0]["answer"] == 4
    assert out[0]["segments"] is None
    assert out[0]["audio_url"] is None
    assert out[0]["why_wrong"] == {
        "0": "bẫy 1", "1": "bẫy 2", "2": "bẫy 3", "3": "bẫy 4",
    }


@pytest.mark.parametrize("mutate", [
    lambda row: row.update(pa=row["pa"][:4], so_phuong_an=4),
    lambda row: row.update(dap_an=3, dap_an_chu="E"),
    lambda row: row.update(kind="reading"),
    lambda row: row["bay"].__setitem__(0, ""),
])
def test_rejects_a_broken_assessment_before_mapping(mutate):
    row = copy.deepcopy(_row())
    mutate(row)
    with pytest.raises(ValueError):
        normalize_assessment_rows([row], expected_count=1)


def test_rejects_internal_markers_inside_wrong_answer_feedback():
    row = copy.deepcopy(_row())
    row["bay"][0] = "[C] Bẫy nội bộ không được hiện cho học viên."
    with pytest.raises(ValueError, match="còn mã nội bộ"):
        normalize_assessment_rows([row], expected_count=1)


def test_rejects_choices_that_only_differ_by_internal_whitespace():
    row = copy.deepcopy(_row())
    row["pa"] = ["at school", "at  school", "home", "work", "outside"]
    with pytest.raises(ValueError, match="phương án trùng nhau"):
        normalize_assessment_rows([row], expected_count=1)


def test_rejects_wrong_total_and_duplicate_full_items_but_allows_shared_instructions():
    with pytest.raises(ValueError, match="đúng 2 câu"):
        normalize_assessment_rows([_row()], expected_count=2)
    second = _row(2)
    second["de"] = _row()["de"]
    second["pa"] = ["six", "seven", "eight", "nine", "ten"]
    second["giai_thich"] = "Ten là đáp án đúng."
    normalize_assessment_rows([_row(), second], expected_count=2)
    second["pa"] = list(reversed(_row()["pa"]))
    with pytest.raises(ValueError, match="trùng nguyên nội dung"):
        normalize_assessment_rows([_row(), second], expected_count=2)


class _ImportDb:
    def __init__(self, *, inserted=None, rpc_result=1, rpc_error=None):
        self.inserted = inserted or []
        self.rpc_result = rpc_result
        self.rpc_error = rpc_error
        self.calls = []

    def table(self, name):
        db = self
        class Query:
            op = None
            payload = None
            def insert(self, payload): self.op = "insert"; self.payload = payload; return self
            def update(self, payload): self.op = "update"; self.payload = payload; return self
            def delete(self): self.op = "delete"; return self
            def eq(self, *_args): return self
            def execute(self):
                db.calls.append((name, self.op, self.payload))
                return MagicMock(data=(db.inserted if self.op == "insert" else []))
        return Query()

    def rpc(self, name, params):
        db = self
        class Rpc:
            def execute(self):
                db.calls.append((name, "rpc", params))
                if db.rpc_error:
                    raise db.rpc_error
                return MagicMock(data=db.rpc_result)
        return Rpc()


def test_existing_bank_replaces_questions_and_metadata_in_one_rpc():
    db = _ImportDb()
    _commit_bank(db, existing=[{"id": "bank-old"}],
                 payload={"title": "new"}, rows=[{"qid": "q1"}])
    assert [(name, op) for name, op, _ in db.calls] == [
        ("quiz_replace_course_assessment_bank", "rpc"),
    ]
    params = db.calls[0][2]
    assert params == {
        "p_bank_id": "bank-old", "p_payload": {"title": "new"},
        "p_rows": [{"qid": "q1"}],
    }


def test_existing_bank_has_no_second_write_after_atomic_rpc_fails():
    db = _ImportDb(rpc_error=RuntimeError("replace failed"))
    with pytest.raises(RuntimeError, match="replace failed"):
        _commit_bank(db, existing=[{"id": "bank-old"}],
                     payload={"title": "new"}, rows=[{"qid": "q1"}])
    assert [(name, op) for name, op, _ in db.calls] == [
        ("quiz_replace_course_assessment_bank", "rpc"),
    ]


def test_new_bank_and_questions_use_one_atomic_rpc():
    db = _ImportDb(rpc_result=[{"bank_id": "bank-new", "written": 1}])
    bank_id, written = _commit_bank(
        db, existing=[], payload={"title": "new"}, rows=[{"qid": "q1"}],
    )
    assert (bank_id, written) == ("bank-new", 1)
    assert [(name, op) for name, op, _ in db.calls] == [
        ("quiz_create_course_assessment_bank", "rpc"),
    ]


def test_new_bank_failure_has_no_client_cleanup_or_half_write():
    db = _ImportDb(rpc_error=RuntimeError("replace failed"))
    with pytest.raises(RuntimeError, match="replace failed"):
        _commit_bank(db, existing=[], payload={"title": "new"},
                     rows=[{"qid": "q1"}])
    assert [(name, op) for name, op, _ in db.calls] == [
        ("quiz_create_course_assessment_bank", "rpc"),
    ]


# ── Lesson scope: the end-of-course final covers B01–B20 ─────────────────────

def _scoped_rows(*lessons: str) -> list[dict]:
    rows = []
    for number, lesson in enumerate(lessons, start=1):
        row = _row(number)
        row["lesson_primary"] = lesson
        rows.append(row)
    return rows


def test_default_scope_still_refuses_lessons_after_b11():
    with pytest.raises(ValueError, match="B01–B11"):
        normalize_assessment_rows(_scoped_rows("B01", "B12"), expected_count=2)


def test_declared_scope_accepts_every_lesson_inside_it():
    out = normalize_assessment_rows(
        _scoped_rows("B01", "B11", "B12", "B20"), expected_count=4,
        scope="B01-B20")
    assert [row["qid"] for row in out] == ["MID-001", "MID-002", "MID-003", "MID-004"]


@pytest.mark.parametrize("lesson", ["B00", "B21", "B5", "B012", "b05", "12"])
def test_declared_scope_refuses_lessons_outside_or_malformed(lesson):
    with pytest.raises(ValueError, match="B01–B20"):
        normalize_assessment_rows(
            _scoped_rows(lesson), expected_count=1, scope="B01-B20")


@pytest.mark.parametrize("scope", ["", "B01", "B11-B01", "B00-B20", "B1-B20", "B01-B20x"])
def test_malformed_scope_is_refused(scope):
    with pytest.raises(ValueError, match="phạm vi"):
        parse_lesson_scope(scope)


def test_scope_parser_returns_inclusive_bounds():
    assert parse_lesson_scope("B01-B20") == (1, 20)
    assert parse_lesson_scope(" B12-B12 ") == (12, 12)


def test_final_kind_and_scope_reach_the_bank_metadata(tmp_path):
    from scripts.import_course_assessment_bank import _bank_payload

    raw = _scoped_rows("B01", "B20")
    rows = normalize_assessment_rows(raw, expected_count=2, scope="B01-B20")
    payload = _bank_payload(
        course={"id": "course-1", "code": "C1"}, code="C1-FINAL-B01-B20-2",
        title="Cuối khoá", kind="final", scope="B01-B20",
        expected_count=2, path=tmp_path / "FINAL.json", raw=raw, rows=rows)
    assert payload["meta"]["assessment_kind"] == "final"
    assert payload["meta"]["scope"] == "B01-B20"
    assert payload["lesson_no"] is None
    assert payload["is_published"] is False
    assert payload["skill_area"] == "course"


def test_cli_dry_run_accepts_a_final_spanning_b01_to_b20(tmp_path, monkeypatch):
    import json as _json
    import sys as _sys

    from scripts import import_course_assessment_bank as script

    source = tmp_path / "FINAL.json"
    source.write_text(_json.dumps(_scoped_rows("B01", "B20")), encoding="utf-8")
    monkeypatch.setattr(_sys, "argv", [
        "import_course_assessment_bank", "--file", str(source), "--course", "C1",
        "--code", "C1-FINAL-B01-B20-2", "--title", "Cuối khoá", "--kind", "final",
        "--scope", "B01-B20", "--expected-count", "2",
    ])
    assert script.main() == 0


def test_cli_dry_run_without_scope_refuses_a_b20_question(tmp_path, monkeypatch):
    import json as _json
    import sys as _sys

    from scripts import import_course_assessment_bank as script

    source = tmp_path / "FINAL.json"
    source.write_text(_json.dumps(_scoped_rows("B01", "B20")), encoding="utf-8")
    monkeypatch.setattr(_sys, "argv", [
        "import_course_assessment_bank", "--file", str(source), "--course", "C1",
        "--code", "C1-FINAL", "--title", "Cuối khoá", "--kind", "final",
        "--expected-count", "2",
    ])
    with pytest.raises(SystemExit, match="B01–B11"):
        script.main()
