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

    def select(self, *args, **_kw):
        self.fake.selections.append((self.name, args[0] if args else '*'))
        return self
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
        if self.name in self.fake.fail_tables:
            raise RuntimeError(f"forced lookup failure: {self.name}")
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
        self.fail_tables: set[str] = set()
        self.selections: list[tuple[str, str]] = []

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


def test_list_accuracy_uses_python_four_decimal_rounding(fake):
    _seed(fake, score=1, gd_n=32)
    out = _list()
    assert out["items"][0]["accuracy"] == 0.0312


def test_admin_report_only_uses_frozen_policy_without_inventing_a_score(fake):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    row = _seed(fake, score=0, gd_n=3)
    row.update({
        'score': None, 'band_estimate': None, 'scoring_policy': 'report_only',
        'grading_details': [
            {'q_num': 1, 'state': 'unscored', 'correct': None,
             'response_type': 'written', 'user_answer': 'My answer',
             'self_review': {'guidance': 'Compare your explanation.'}},
            {'q_num': 2, 'state': 'blank', 'correct': None, 'user_answer': ''},
            {'q_num': 3, 'state': 'checked', 'correct': True,
             'response_type': 'single_choice', 'expected': ['A', 'B'],
             'user_answer': 'A'},
        ],
    })
    # A later current-test policy is not the policy this attempt captured.
    fake.tables['listening_tests'][0]['scoring_policy'] = 'diagnostic'
    app = FastAPI()
    app.include_router(listening_router.admin_router)
    with TestClient(app) as client:
        listed = client.get('/admin/listening/attempts').json()
        item = listed['items'][0]
        assert item['scoring_policy'] == 'report_only'
        assert item['total_questions'] == 3
        assert item['score'] is None and item['accuracy'] is None
        detail_response = client.get('/admin/listening/attempts/' + row['id'])
        assert detail_response.status_code == 200
        detail = detail_response.json()
        assert detail['scoring_policy'] == 'report_only'
        assert detail['band_estimate'] is None
        assert detail['grading_details'][0]['correct'] is None
        assert detail['grading_details'][0]['state'] == 'unscored'
        assert detail['grading_details'][0]['self_review'] == row['grading_details'][0]['self_review']
        assert detail['grading_details'][2]['expected'] == ['A', 'B']
        assert detail['grading_details'][2]['correct'] is True
    assert any(table == 'listening_test_attempts' and 'scoring_policy' in columns
               for table, columns in fake.selections)


def test_legacy_policy_default_and_unknown_policy_are_truthful(fake):
    row = _seed(fake)
    assert _list()['items'][0]['scoring_policy'] == 'diagnostic'
    row['scoring_policy'] = 'invented'
    with pytest.raises(HTTPException) as exc:
        _list()
    assert exc.value.status_code == 503


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
    assert out2 == {
        "items": [], "total": 0, "limit": 50, "offset": 0,
        "association_lookup_failed": False,
        "association_lookup_failures": [],
    }


def test_list_test_type_filter_resolves_test_ids(fake):
    _seed(fake)                                     # mini
    full_tid = str(uuid4())
    fake.tables["listening_tests"].append({
        "id": full_tid, "test_id": "C19-T1", "title": "Cam 19", "test_type": "full"})
    _seed(fake, test_id=full_tid)
    out = _list(test_type="full")
    assert out["total"] == 1
    assert out["items"][0]["test"]["test_type"] == "full"


def test_list_accepts_every_test_type_the_table_allows(fake):
    """Bộ lọc phải phủ đúng CHECK của listening_tests (migration 173).

    Thiếu một loại thì lượt làm bài của loại đó vẫn nằm trong
    listening_test_attempts nhưng admin gọi ?test_type=<loại> nhận 422 —
    không có cách nào lọc ra. Đây là điều đã xảy ra với `practice`.
    """
    _seed(fake)
    for kind in ("full", "mini", "drill", "practice"):
        _list(test_type=kind)          # không được ném 422


def test_list_practice_filter_resolves_test_ids(fake):
    _seed(fake)                                     # mini
    prac_tid = str(uuid4())
    fake.tables["listening_tests"].append({
        "id": prac_tid, "test_id": "ILR-LIS-KKR-TRAP-001",
        "title": "Bẫy: sửa lời", "test_type": "practice"})
    _seed(fake, test_id=prac_tid)
    out = _list(test_type="practice")
    assert out["total"] == 1
    assert out["items"][0]["test"]["test_type"] == "practice"


def test_list_exposes_join_failure_instead_of_claiming_association_is_empty(fake):
    _seed(fake)
    fake.fail_tables.add("users")

    out = _list()

    assert out["association_lookup_failed"] is True
    assert out["association_lookup_failures"] == ["users"]
    assert out["items"][0]["user"]["id"] == "u1"
    assert out["items"][0]["user"]["email"] is None


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
    assert out["association_lookup_failed"] is False
    assert out["association_lookup_failures"] == []


def test_detail_exposes_test_lookup_failure(fake):
    row = _seed(fake)
    fake.fail_tables.add("listening_tests")

    out = _run(listening_router.admin_get_listening_attempt(
        row["id"], authorization="Bearer x"))

    assert out["association_lookup_failed"] is True
    assert out["association_lookup_failures"] == ["listening_tests"]
    assert out["test"]["id"] == row["test_id"]
    assert out["test"]["title"] is None


def test_detail_404_on_unknown_id(fake):
    with pytest.raises(HTTPException) as ei:
        _run(listening_router.admin_get_listening_attempt(
            str(uuid4()), authorization="Bearer x"))
    assert ei.value.status_code == 404
