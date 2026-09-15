from __future__ import annotations

import copy
from unittest.mock import MagicMock

import pytest

from scripts.import_course_assessment_bank import _commit_bank
from services.course_assessment_import import normalize_assessment_rows


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
