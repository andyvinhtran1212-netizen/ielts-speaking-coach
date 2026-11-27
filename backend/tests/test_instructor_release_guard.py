"""Báo cáo săn lỗi #71: trả lại (release) một bài đã giao không được đưa nó về hàng đợi."""
from uuid import uuid4

import pytest

from services import instructor_workflow as wf

ME = uuid4()


class _Q:
    def __init__(self, rows):
        self.rows, self.filters, self.patch = rows, [], None

    def update(self, patch):
        self.patch = patch
        return self

    def select(self, *_a):
        return self

    def eq(self, col, val):
        self.filters.append(lambda r, c=col, v=val: str(r.get(c)) == str(v))
        return self

    def in_(self, col, vals):
        self.filters.append(lambda r, c=col, v=vals: r.get(c) in v)
        return self

    def limit(self, _n):
        return self

    def execute(self):
        hit = [r for r in self.rows if all(f(r) for f in self.filters)]
        if self.patch is not None:
            for r in hit:
                r.update(self.patch)
        return type("R", (), {"data": [dict(r) for r in hit]})()


class _DB:
    def __init__(self, rows):
        self.rows = rows

    def table(self, _name):
        return _Q(self.rows)


def _review(status):
    return {"id": str(uuid4()), "status": status, "claimed_by": str(ME),
            "claimed_at": "2026-11-25T00:00:00+00:00"}


def test_releasing_a_delivered_review_is_refused_and_row_unchanged(monkeypatch):
    row = _review("delivered")
    monkeypatch.setattr(wf, "supabase_admin", _DB([row]))
    with pytest.raises(wf.ConflictError):
        wf.release(row["id"], ME)
    assert row["status"] == "delivered"
    assert row["claimed_by"] == str(ME)


@pytest.mark.parametrize("status", ["claimed", "edited"])
def test_releasing_own_open_claim_returns_it_to_queue(monkeypatch, status):
    row = _review(status)
    monkeypatch.setattr(wf, "supabase_admin", _DB([row]))
    monkeypatch.setattr(wf, "_row_to_review", lambda r: r)
    got = wf.release(row["id"], ME)
    assert got["status"] == "queued" and got["claimed_by"] is None


def test_someone_elses_claim_is_still_permission_error(monkeypatch):
    row = _review("claimed")
    monkeypatch.setattr(wf, "supabase_admin", _DB([row]))
    with pytest.raises(PermissionError):
        wf.release(row["id"], uuid4())
