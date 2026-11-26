"""Báo cáo săn lỗi B2-12 / B2-13: POST /api/listening/attempts.

B2-12: `listening_session_id` đến thẳng từ body và được ghi bằng service role
(bỏ qua RLS) mà không kiểm chủ ⇒ gắn được lượt vào phiên của người khác.

B2-13: chấm True/False trả `details[].expected` (đáp án đúng) về trình duyệt.
Anh Andy chọn 25/11: chỉ báo đúng/sai, giống MCQ. Bước 1 (PR này): client mới
không hiện đáp án và đọc được cả hai dạng; backend VẪN gửi `expected` để client
cũ (tab đang mở) không vỡ. Bước 2 (PR riêng, sau khi client mới lên prod): bỏ
`expected` khỏi phản hồi.
"""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

import routers.listening as lst


class _Q:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op, self.payload = db, table, {}, "select", None

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.filters[col] = val
        return self

    def limit(self, *_a):
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def execute(self):
        if self.op == "insert":
            self.db.inserted.append((self.table, self.payload))
            return SimpleNamespace(data=[self.payload])
        rows = [r for r in self.db.rows.get(self.table, [])
                if all(r.get(k) == v for k, v in self.filters.items())]
        return SimpleNamespace(data=rows)


class _DB:
    def __init__(self, rows):
        self.rows, self.inserted = rows, []

    def table(self, name):
        return _Q(self, name)


OWNER, OTHER = str(uuid4()), str(uuid4())
SESSION = str(uuid4())


@pytest.fixture
def db(monkeypatch):
    fake = _DB({"listening_sessions": [{"id": SESSION, "user_id": OWNER}]})
    monkeypatch.setattr(lst, "supabase_admin", fake)
    return fake


def _insert(user_id, session_id):
    return lst._insert_attempt(
        user_id=user_id, exercise_id="ex-1", segment_idx=None, user_answer={},
        score=1.0, is_correct=True, listen_count=1, listening_session_id=session_id,
    )


def test_attempt_cannot_be_attached_to_another_users_session(db):
    with pytest.raises(HTTPException) as exc:
        _insert(OTHER, SESSION)
    assert exc.value.status_code == 404
    assert db.inserted == []


def test_non_uuid_session_id_is_404_without_a_query(db):
    with pytest.raises(HTTPException) as exc:
        _insert(OWNER, "not-a-uuid")
    assert exc.value.status_code == 404
    assert db.inserted == []


def test_own_session_and_no_session_still_insert(db):
    _insert(OWNER, SESSION)
    _insert(OTHER, None)
    assert [row["listening_session_id"] for _t, row in db.inserted if "listening_session_id" in row] == [SESSION]
    assert len(db.inserted) == 2


def test_true_false_response_keeps_expected_until_old_clients_are_gone(db, monkeypatch):
    """Bước 1 tương thích: client đang live ném `attempt-detail-contract` khi
    thiếu `expected`, nên backend chưa được bỏ trường này."""
    monkeypatch.setattr(lst, "_check_first_attempt", lambda **_k: True)
    exercise = {"id": "ex-tf", "payload": {"statements": [
        {"text": "a", "answer": "T"}, {"text": "b", "answer": "F"}, {"text": "c", "answer": "NG"}]}}
    body = SimpleNamespace(answers=["F", "F", "T"], listen_count=1, listening_session_id=None)
    out = lst._grade_and_save_true_false(user_id=OWNER, body=body, exercise_row=exercise)
    assert out["correct"] == 1 and out["total"] == 3
    assert [d["is_correct"] for d in out["details"]] == [False, True, False]
    assert [d["expected"] for d in out["details"]] == ["T", "F", "NG"]
    saved = db.inserted[0][1]["user_answer"]["details"]
    assert all("expected" in d for d in saved)
