"""Admin: lượt làm bài nghe (audit 2026-07-17 — AUDIT_LISTENING_ACTIVITY_REPORTING).

GET /admin/listening/attempts       — list + join users/tests + duration/accuracy
GET /admin/listening/attempts/{id}  — chi tiết per-question

In-memory fake supabase (mirrors test_listening_test_dictation) mở rộng thêm
in_/or_ (batch join + text filter) — không đụng DB.
"""

from __future__ import annotations

import asyncio
from uuid import uuid4

import pytest
from fastapi import HTTPException

from routers import listening as listening_router


# ── Fake supabase ──────────────────────────────────────────────────────────


class _Resp:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


class _Q:
    def __init__(self, fake, name):
        self.fake = fake
        self.name = name
        self._eq: list[tuple[str, object]] = []
        self._in: list[tuple[str, list]] = []
        self._or: str | None = None
        self._range: tuple[int, int] | None = None

    def select(self, *_a, **_kw): return self
    def eq(self, c, v): self._eq.append((c, v)); return self
    def in_(self, c, vals): self._in.append((c, list(vals))); return self
    def or_(self, expr): self._or = expr; return self
    def limit(self, *_a, **_kw): return self
    def order(self, *_a, **_kw): return self
    def range(self, s, e): self._range = (s, e); return self

    def _or_match(self, r):
        if not self._or:
            return True
        # ilike_or_filter sinh 'col.ilike."%pat%"' (value quoted + escaped) —
        # strip cả ngoặc kép lẫn % để so substring.
        for part in self._or.split(","):
            col, _op, pat = part.split(".", 2)
            needle = pat.strip('"').strip("%").lower()
            if needle in str(r.get(col) or "").lower():
                return True
        return False

    def _match(self, r):
        if not all(r.get(c) == v for c, v in self._eq):
            return False
        if not all(r.get(c) in vals for c, vals in self._in):
            return False
        return self._or_match(r)

    def execute(self):
        rows = [r for r in self.fake.tables.get(self.name, []) if self._match(r)]
        total = len(rows)
        if self._range:
            s, e = self._range
            rows = rows[s:e + 1]
        return _Resp(rows, count=total)


class _Fake:
    def __init__(self):
        self.tables: dict[str, list] = {
            "listening_test_attempts": [], "listening_tests": [], "users": [],
        }

    def table(self, name): return _Q(self, name)


@pytest.fixture()
def fake(monkeypatch):
    f = _Fake()
    monkeypatch.setattr(listening_router, "supabase_admin", f)

    async def _admin(_authz):
        return {"id": "admin-1"}
    monkeypatch.setattr(listening_router, "require_admin", _admin)
    return f


def _run(c): return asyncio.run(c)


def _list(**kw):
    """Gọi trực tiếp endpoint list — điền đủ default (Query() object là truthy)."""
    args = dict(user_query=None, test_query=None, test_type=None, status=None,
                limit=50, offset=0, authorization="Bearer x")
    args.update(kw)
    return _run(listening_router.admin_list_listening_attempts(**args))


def _seed(fake, *, status="submitted", score=8, gd_n=10, user_id="u1", test_id=None):
    test_id = test_id or str(uuid4())
    if not any(t["id"] == test_id for t in fake.tables["listening_tests"]):
        fake.tables["listening_tests"].append({
            "id": test_id, "test_id": "ILR-LIS-LSN-L01",
            "title": "Lesson 01", "test_type": "mini",
        })
    if not any(u["id"] == user_id for u in fake.tables["users"]):
        fake.tables["users"].append({
            "id": user_id, "email": f"{user_id}@ex.com", "display_name": "Học Viên A",
        })
    row = {
        "id": str(uuid4()), "user_id": user_id, "test_id": test_id,
        "status": status, "score": (score if status == "submitted" else None),
        "grading_details": [
            {"q_num": i + 1, "correct": i < score, "user_answer": "x",
             "expected": "y", "trap_missed": (i == 0)}
            for i in range(gd_n)
        ] if status == "submitted" else [],
        "trap_analytics": {"trap_mechanism": {"caught": 2, "missed": 1}},
        "band_estimate": 6.5,
        "started_at": "2026-07-17T10:00:00+00:00",
        "submitted_at": ("2026-07-17T10:12:30+00:00" if status == "submitted" else None),
        "audio_duration_listened_seconds": 300,
        "created_at": "2026-07-17T10:00:00+00:00",
    }
    fake.tables["listening_test_attempts"].append(row)
    return row


# ── List ───────────────────────────────────────────────────────────────────


def test_list_joins_identity_and_computes_duration_accuracy(fake):
    _seed(fake)
    out = _list()
    assert out["total"] == 1
    it = out["items"][0]
    assert it["user"]["email"] == "u1@ex.com"
    assert it["user"]["display_name"] == "Học Viên A"
    assert it["test"]["test_id"] == "ILR-LIS-LSN-L01"
    assert it["test"]["test_type"] == "mini"
    assert it["duration_seconds"] == 750            # 12m30s
    assert it["score"] == 8 and it["total_questions"] == 10
    assert it["accuracy"] == 0.8
    assert "grading_details" not in it              # list KHÔNG mang payload nặng


def test_list_filters_by_status_and_rejects_bad_values(fake):
    _seed(fake, status="submitted")
    _seed(fake, status="abandoned")
    out = _list(status="abandoned")
    assert out["total"] == 1
    assert out["items"][0]["status"] == "abandoned"
    assert out["items"][0]["duration_seconds"] is None   # chưa nộp → không có thời lượng
    with pytest.raises(HTTPException) as ei:
        _list(status="done")
    assert ei.value.status_code == 422
    with pytest.raises(HTTPException) as ei2:
        _list(test_type="lesson")
    assert ei2.value.status_code == 422


def test_list_user_query_matches_email_or_name(fake):
    _seed(fake, user_id="u1")
    _seed(fake, user_id="u2")
    fake.tables["users"][1]["display_name"] = "Trần B"
    out = _list(user_query="u1@ex")
    assert out["total"] == 1 and out["items"][0]["user"]["id"] == "u1"
    # không khớp ai → rỗng, không đụng bảng attempts
    out2 = _list(user_query="khong-ton-tai")
    assert out2 == {"items": [], "total": 0, "limit": 50, "offset": 0}


def test_list_test_type_filter_resolves_test_ids(fake):
    _seed(fake)                                     # mini
    full_tid = str(uuid4())
    fake.tables["listening_tests"].append({
        "id": full_tid, "test_id": "C19-T1", "title": "Cam 19", "test_type": "full"})
    _seed(fake, test_id=full_tid)
    out = _list(test_type="full")
    assert out["total"] == 1
    assert out["items"][0]["test"]["test_type"] == "full"


# ── Detail ─────────────────────────────────────────────────────────────────


def test_detail_returns_grading_details_and_traps(fake):
    row = _seed(fake)
    out = _run(listening_router.admin_get_listening_attempt(
        row["id"], authorization="Bearer x"))
    assert out["user"]["email"] == "u1@ex.com"
    assert len(out["grading_details"]) == 10
    assert out["grading_details"][0]["trap_missed"] is True
    assert out["trap_analytics"]["trap_mechanism"]["caught"] == 2
    assert out["band_estimate"] == 6.5
    assert out["duration_seconds"] == 750


def test_detail_404_on_unknown_id(fake):
    with pytest.raises(HTTPException) as ei:
        _run(listening_router.admin_get_listening_attempt(
            str(uuid4()), authorization="Bearer x"))
    assert ei.value.status_code == 404
