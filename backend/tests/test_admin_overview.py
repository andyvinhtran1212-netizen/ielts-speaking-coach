"""Tests for routers/admin_overview.py (Sprint 12.4 — DEBT-ADMIN-IA-REFACTOR 4/8).

Surfaces under test:

  1. Auth gate — non-admin → 403.
  2. Empty DB returns zero counts (not null, not 500).
  3. Cache-Control: max-age=300 header set on success.
  4. Students bucketed by cohort with synthetic "Đại trà" for NULL.
  5. Active 7d / 30d union of writing + listening + speaking signals.
  6. Speaking avg_band filters to completed sessions only.
  7. Listening avg_score uses first-attempt-only rule (Sprint 11.5.1).
  8. Reading metrics use canonical attempts and first-attempt accuracy.
  9. Pending writing essays counted by delivered_at IS NULL.
  10. Access codes counted by code_type, excluding revoked.
  11. Error log counts (undismissed / 24h / 7d).
  12. Recent activity sorted DESC by timestamp, capped at 20.
  13. Email enrichment for user_ids present in activity feed.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4
from unittest.mock import AsyncMock, patch
from pathlib import Path
import re

import pytest
from fastapi.testclient import TestClient


_ROUTER_SOURCE = (Path(__file__).parents[1] / "routers" / "admin_overview.py").read_text()


# ── In-memory Supabase fake (reused pattern from test_error_logs.py) ──


class _Resp:
    def __init__(self, data, count=None):
        self.data = data
        # PostgREST exposes exact row count on .count when the query used
        # count="exact"; None otherwise.
        self.count = count


class _IsNot:
    def __init__(self, parent):
        self._parent = parent

    def is_(self, field, value):
        if value == "null":
            self._parent.filters.append((field, "not_null", None))
        else:
            self._parent.filters.append((field, "ne", value))
        return self._parent


class _TableQuery:
    def __init__(self, fake, table_name):
        self.fake = fake
        self.table_name = table_name
        self._mode = "select"
        self._payload = None
        self.filters: list[tuple[str, str, object]] = []
        self.in_filter: tuple[str, list] | None = None
        self.limit_n = None
        self._count_mode = None
        self._head = False
        self.order_fields: list[tuple[str, bool]] = []
        self.cursor_after: tuple[str, str] | None = None

    @property
    def not_(self):
        return _IsNot(self)

    def select(self, *_args, **_kw):
        self._mode = "select"
        self._count_mode = _kw.get("count")
        self._head = bool(_kw.get("head", False))
        return self

    def eq(self, field, value):
        self.filters.append((field, "eq", value))
        return self

    def gte(self, field, value):
        self.filters.append((field, "gte", value))
        return self

    def lte(self, field, value):
        self.filters.append((field, "lte", value))
        return self

    def or_(self, expression):
        match = re.fullmatch(
            r"created_at\.gt\.(.*),and\(created_at\.eq\.(.*),id\.gt\.(.*)\)",
            expression,
        )
        if not match or match.group(1) != match.group(2):
            raise AssertionError(f"unsupported fake cursor expression: {expression}")
        self.cursor_after = (match.group(1), match.group(3))
        return self

    def is_(self, field, value):
        if value == "null":
            self.filters.append((field, "is_null", None))
        else:
            self.filters.append((field, "eq", value))
        return self

    def in_(self, field, values):
        self.in_filter = (field, list(values))
        return self

    def limit(self, n):
        self.limit_n = n
        return self

    def order(self, field, **kwargs):
        self.order_fields.append((field, bool(kwargs.get("desc", False))))
        return self

    def execute(self):
        rows = self.fake.tables.get(self.table_name, [])
        matched = [r for r in rows if self._matches(r)]
        if self.cursor_after:
            matched = [
                row for row in matched
                if (str(row.get("created_at") or ""), str(row.get("id") or "")) > self.cursor_after
            ]
        for field, desc in reversed(self.order_fields):
            matched.sort(key=lambda row: str(row.get(field) or ""), reverse=desc)
        # Exact count reflects ALL filter-matched rows, before limit paging.
        count = len(matched) if self._count_mode else None
        if self.limit_n is not None:
            matched = matched[: self.limit_n]
        if self.fake.response_cap is not None:
            matched = matched[: self.fake.response_cap]
        self.fake.executions.append((self.table_name, self._head, len(matched)))
        data = [] if self._head else matched
        return _Resp(data, count)

    def _matches(self, row):
        for field, op, value in self.filters:
            row_val = row.get(field)
            if op == "eq" and row_val != value:
                return False
            if op == "ne" and row_val == value:
                return False
            if op == "gte" and (row_val is None or row_val < value):
                return False
            if op == "lte" and (row_val is None or row_val > value):
                return False
            if op == "is_null" and row_val is not None:
                return False
            if op == "not_null" and row_val is None:
                return False
        if self.in_filter:
            field, values = self.in_filter
            if row.get(field) not in values:
                return False
        return True


class _FakeSupabase:
    def __init__(self):
        self.response_cap: int | None = None
        self.executions: list[tuple[str, bool, int]] = []
        self.tables: dict[str, list[dict]] = {
            "students":      [],
            "cohorts":       [],
            "sessions":      [],
            "writing_essays": [],
            "listening_test_attempts": [],
            "reading_test_attempts": [],
            "dictation_sessions": [],
            "listening_content":  [],
            "user_vocabulary":    [],
            "grammar_recommendations": [],
            "error_logs":    [],
            "access_codes":  [],
            "users":         [],
        }

    def table(self, name: str):
        return _TableQuery(self, name)


# ── Fixtures ──────────────────────────────────────────────────────────


_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}
_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}


@pytest.fixture
def fake_db(monkeypatch):
    fake = _FakeSupabase()
    monkeypatch.setattr("routers.admin_overview.supabase_admin", fake)
    monkeypatch.setattr("routers.admin.supabase_admin", fake)
    return fake


@pytest.fixture
def client(fake_db):
    from main import app
    with patch("routers.admin_overview.require_admin", new=AsyncMock(return_value=_ADMIN_USER)):
        with TestClient(app) as c:
            yield c


def _iso(delta_days: float = 0) -> str:
    """ISO timestamp shifted by `delta_days` from now (negative = past)."""
    return (datetime.now(timezone.utc) + timedelta(days=delta_days)).isoformat()


# ── Auth gate ────────────────────────────────────────────────────────


class TestAuth:
    def test_non_admin_blocked(self, fake_db):
        # Patch require_admin to raise like a non-admin request.
        from fastapi import HTTPException
        from main import app

        async def deny(_):
            raise HTTPException(403, "không có quyền")

        with patch("routers.admin_overview.require_admin", new=deny):
            with TestClient(app) as c:
                r = c.get("/admin/overview", headers=_ADMIN_AUTH)
        assert r.status_code == 403


# ── Empty DB returns zero counts ─────────────────────────────────────


class TestEmpty:
    def test_zero_counts_no_errors(self, client):
        r = client.get("/admin/overview", headers=_ADMIN_AUTH)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["students"]["total"] == 0
        assert body["students"]["active_7d"] == 0
        assert body["students"]["by_cohort"] == []
        assert body["skills"]["speaking"]["sessions_total"] == 0
        assert body["skills"]["speaking"]["avg_band_7d"] is None
        assert body["skills"]["writing"]["essays_total"] == 0
        assert body["skills"]["writing"]["feedback_pending"] == 0
        assert body["skills"]["listening"]["attempts_total"] == 0
        assert body["skills"]["listening"]["avg_score_7d"] is None
        assert body["skills"]["reading"]["attempts_total"] == 0
        assert body["skills"]["reading"]["avg_score_7d"] is None
        assert body["errors"]["undismissed"] == 0
        assert body["access_codes"]["active"] == 0
        assert body["recent_activity"] == []
        assert "generated_at" in body


# ── Cache-Control header ─────────────────────────────────────────────


class TestCacheControl:
    def test_cache_control_header_set(self, client):
        r = client.get("/admin/overview", headers=_ADMIN_AUTH)
        assert r.status_code == 200
        assert r.headers.get("cache-control") == "max-age=300"


# ── Student counts + cohort buckets ──────────────────────────────────


class TestStudents:
    def test_total_students_counted(self, client, fake_db):
        fake_db.tables["students"] = [
            {"id": f"s{i}", "user_id": f"u{i}", "cohort_id": None,
             "created_at": _iso(-1)} for i in range(5)
        ]
        r = client.get("/admin/overview", headers=_ADMIN_AUTH)
        assert r.json()["students"]["total"] == 5

    def test_cohort_buckets_with_synthetic_dai_tra(self, client, fake_db):
        fake_db.tables["cohorts"] = [
            {"id": "c1", "name": "Lớp A", "is_active": True},
            {"id": "c2", "name": "Lớp B", "is_active": True},
        ]
        fake_db.tables["students"] = [
            {"id": "s1", "user_id": "u1", "cohort_id": "c1", "created_at": _iso(-1)},
            {"id": "s2", "user_id": "u2", "cohort_id": "c1", "created_at": _iso(-1)},
            {"id": "s3", "user_id": "u3", "cohort_id": "c2", "created_at": _iso(-1)},
            {"id": "s4", "user_id": "u4", "cohort_id": None, "created_at": _iso(-1)},
        ]
        r = client.get("/admin/overview", headers=_ADMIN_AUTH)
        buckets = {b["cohort_name"]: b["count"] for b in r.json()["students"]["by_cohort"]}
        assert buckets["Lớp A"] == 2
        assert buckets["Lớp B"] == 1
        assert buckets["Đại trà"] == 1


# ── Active 7d / 30d signals ──────────────────────────────────────────


class TestActiveUsers:
    def test_active_7d_unions_reading_listening_sessions_writing(self, client, fake_db):
        # Four different users, each touching one surface in the last 7d.
        fake_db.tables["students"] = [
            {"id": "stu1", "user_id": "u-writer", "cohort_id": None, "created_at": _iso(-10)},
        ]
        fake_db.tables["sessions"] = [
            {"id": "sess1", "user_id": "u-speaker", "overall_band": 6.5,
             "status": "completed", "created_at": _iso(-1), "completed_at": _iso(-1)},
        ]
        fake_db.tables["listening_test_attempts"] = [
            {"id": "att1", "user_id": "u-listener", "test_id": "t1",
             "status": "in_progress", "score": None, "grading_details": [],
             "created_at": _iso(-2), "submitted_at": None},
        ]
        fake_db.tables["reading_test_attempts"] = [
            {"id": "read1", "user_id": "u-reader", "test_id": "rt1",
             "status": "in_progress", "score": None, "grading_details": [],
             "created_at": _iso(-2), "submitted_at": None},
        ]
        fake_db.tables["writing_essays"] = [
            {"id": "ess1", "student_id": "stu1", "status": "delivered",
             "delivered_at": _iso(-1), "created_at": _iso(-1)},
        ]
        r = client.get("/admin/overview", headers=_ADMIN_AUTH)
        assert r.json()["students"]["active_7d"] == 4

    def test_active_7d_excludes_older_activity(self, client, fake_db):
        fake_db.tables["sessions"] = [
            {"id": "old", "user_id": "u-old", "overall_band": 6.0,
             "status": "completed", "created_at": _iso(-20), "completed_at": _iso(-20)},
            {"id": "new", "user_id": "u-new", "overall_band": 6.0,
             "status": "completed", "created_at": _iso(-1), "completed_at": _iso(-1)},
        ]
        r = client.get("/admin/overview", headers=_ADMIN_AUTH)
        body = r.json()
        assert body["students"]["active_7d"] == 1
        assert body["students"]["active_30d"] == 2


# ── Skill-specific metrics ───────────────────────────────────────────


class TestSpeakingMetrics:
    def test_avg_band_filters_completed_only(self, client, fake_db):
        # 1 completed, 1 in_progress (band=None) — only completed counted.
        fake_db.tables["sessions"] = [
            {"id": "s1", "user_id": "u1", "overall_band": 7.0,
             "status": "completed", "created_at": _iso(-1), "completed_at": _iso(-1)},
            {"id": "s2", "user_id": "u1", "overall_band": None,
             "status": "in_progress", "created_at": _iso(-1), "completed_at": None},
        ]
        r = client.get("/admin/overview", headers=_ADMIN_AUTH)
        assert r.json()["skills"]["speaking"]["avg_band_7d"] == 7.0

    def test_avg_band_null_when_no_completed(self, client, fake_db):
        fake_db.tables["sessions"] = [
            {"id": "s1", "user_id": "u1", "overall_band": None,
             "status": "in_progress", "created_at": _iso(-1), "completed_at": None},
        ]
        r = client.get("/admin/overview", headers=_ADMIN_AUTH)
        assert r.json()["skills"]["speaking"]["avg_band_7d"] is None


class TestListeningFirstAttempt:
    def test_avg_accuracy_uses_first_attempt_per_user_test(self, client, fake_db):
        # Audit 2026-07-17: nguồn = listening_test_attempts; avg = % đúng
        # (score/số câu) của lượt ĐẦU per (user, test) — retry không tính.
        def _att(i, score, days_ago):
            return {"id": f"a{i}", "user_id": "u1", "test_id": "t1",
                    "status": "submitted", "score": score,
                    "grading_details": [{"q_num": q + 1} for q in range(10)],
                    "created_at": _iso(-days_ago), "submitted_at": _iso(-days_ago)}
        fake_db.tables["listening_test_attempts"] = [
            _att(1, 5, 1),      # first attempt: 5/10 = 0.5
            _att(2, 9, 0.5),    # retry — ignored for avg
            _att(3, 10, 0.25),  # retry — ignored for avg
        ]
        r = client.get("/admin/overview", headers=_ADMIN_AUTH)
        assert r.json()["skills"]["listening"]["avg_score_7d"] == 0.5
        # But raw attempts_7d counts all 3 (engagement signal).
        assert r.json()["skills"]["listening"]["attempts_7d"] == 3

    def test_dictation_counts_surface(self, client, fake_db):
        fake_db.tables["dictation_sessions"] = [
            {"id": "d1", "user_id": "u9", "accuracy": 0.9,
             "section_title": "Section 1", "test_id_external": "ILR-LIS-LSN-L01",
             "completed_at": _iso(-1), "created_at": _iso(-1)},
        ]
        r = client.get("/admin/overview", headers=_ADMIN_AUTH)
        body = r.json()
        assert body["skills"]["listening"]["dictation_total"] == 1
        assert body["skills"]["listening"]["dictation_7d"] == 1
        # phiên chép chính tả cũng tính active user
        assert body["students"]["active_7d"] == 1
        # và vào feed hoạt động với accuracy %
        feed = [r2 for r2 in body["recent_activity"] if "chép chính tả" in r2["action"]]
        assert feed and feed[0]["score"] == "90%"


class TestReadingFirstAttempt:
    def test_only_reading_query_requests_anonymous_source_column(self):
        listening_block, reading_block = _ROUTER_SOURCE.split("reading_recent =", 1)
        listening_block = listening_block.rsplit("listening_recent =", 1)[1]
        paging_helper = _ROUTER_SOURCE.split("def _safe_reading_attempt_window", 1)[1]
        paging_helper = paging_helper.split("def _first_attempt_only", 1)[0]
        assert "anon_src" not in listening_block
        assert 'select("id, user_id, anon_src, test_id' in paging_helper
        assert "_safe_reading_attempt_window(iso_30d, snapshot_to)" in reading_block

    def test_avg_accuracy_uses_first_attempt_per_user_test(self, client, fake_db):
        def _att(i, score, days_ago):
            return {"id": f"r{i}", "user_id": "u-reader", "test_id": "rt1",
                    "status": "submitted", "score": score,
                    "grading_details": [{"q_num": q + 1} for q in range(20)],
                    "created_at": _iso(-days_ago), "submitted_at": _iso(-days_ago)}

        fake_db.tables["reading_test_attempts"] = [
            _att(1, 12, 1),     # canonical first attempt: 60%
            _att(2, 18, 0.5),   # retry must not inflate the average
        ]
        body = client.get("/admin/overview", headers=_ADMIN_AUTH).json()
        assert body["skills"]["reading"] == {
            "attempts_total": 2,
            "attempts_7d": 2,
            "avg_score_7d": 0.6,
        }
        row = next(item for item in body["recent_activity"] if item["skill"] == "reading")
        assert row["link"] == "/admin/dashboard/reading-attempts"
        assert row["score"] in {"12/20", "18/20"}

    def test_anonymous_sources_are_deduped_without_collapsing_unknown_owners(self, client, fake_db):
        def _anon(row_id, source, score, hours):
            return {"id": row_id, "user_id": None, "anon_src": source, "test_id": "rt1",
                    "status": "submitted", "score": score,
                    "grading_details": [{"q_num": q + 1} for q in range(10)],
                    "created_at": _iso(-hours / 24), "submitted_at": _iso(-hours / 24)}

        fake_db.tables["reading_test_attempts"] = [
            _anon("same-first", "hash-a", 4, 8),
            _anon("same-retry", "hash-a", 10, 4),
            _anon("other-source", "hash-b", 8, 3),
            _anon("unknown-a", None, 6, 2),
            _anon("unknown-b", None, 10, 1),
        ]
        reading = client.get("/admin/overview", headers=_ADMIN_AUTH).json()["skills"]["reading"]
        # hash-a contributes 40% once; hash-b 80%; two unknown owners remain
        # separate (60%, 100%) instead of collapsing into one NULL identity.
        assert reading["avg_score_7d"] == 0.7

    def test_reads_every_page_across_server_cap_and_seven_day_boundary(self, client, fake_db):
        fake_db.response_cap = 1000
        old = [
            {"id": f"old-{i:04d}", "user_id": f"old-user-{i}", "anon_src": None,
             "test_id": "rt-old", "status": "submitted", "score": 0,
             "grading_details": [{"q_num": q + 1} for q in range(20)],
             "created_at": _iso(-10 - i / 10000), "submitted_at": _iso(-10 - i / 10000)}
            for i in range(100)
        ]
        recent = [
            {"id": f"new-{i:04d}", "user_id": f"new-user-{i}", "anon_src": None,
             "test_id": "rt-new", "status": "submitted", "score": 20,
             "grading_details": [{"q_num": q + 1} for q in range(20)],
             "created_at": _iso(-1 - i / 10000), "submitted_at": _iso(-1 - i / 10000)}
            for i in range(1005)
        ]
        # Deliberately reverse physical storage order: correctness must come
        # from the stable query order + cursor, not fixture insertion order.
        fake_db.tables["reading_test_attempts"] = list(reversed(old + recent))

        body = client.get("/admin/overview", headers=_ADMIN_AUTH).json()
        assert body["skills"]["reading"] == {
            "attempts_total": 1105,
            "attempts_7d": 1005,
            "avg_score_7d": 1.0,
        }
        data_pages = [
            item for item in fake_db.executions
            if item[0] == "reading_test_attempts" and not item[1]
        ]
        assert [page[2] for page in data_pages] == [1000, 105]
        assert body["students"]["active_7d"] == 1005


class TestWritingPending:
    def test_pending_counts_undelivered(self, client, fake_db):
        fake_db.tables["writing_essays"] = [
            {"id": "e1", "student_id": "s1", "status": "pending",
             "delivered_at": None, "created_at": _iso(-1)},
            {"id": "e2", "student_id": "s1", "status": "graded",
             "delivered_at": None, "created_at": _iso(-1)},
            {"id": "e3", "student_id": "s1", "status": "delivered",
             "delivered_at": _iso(-1), "created_at": _iso(-2)},
        ]
        r = client.get("/admin/overview", headers=_ADMIN_AUTH)
        assert r.json()["skills"]["writing"]["feedback_pending"] == 2


# ── Access codes by type ─────────────────────────────────────────────


class TestAccessCodes:
    def test_counted_by_type_excludes_revoked(self, client, fake_db):
        fake_db.tables["access_codes"] = [
            {"id": "ac1", "code_type": "mass",   "is_active": True,  "is_revoked": False},
            {"id": "ac2", "code_type": "mass",   "is_active": True,  "is_revoked": False},
            {"id": "ac3", "code_type": "direct", "is_active": True,  "is_revoked": False},
            {"id": "ac4", "code_type": "staff",  "is_active": True,  "is_revoked": False},
            {"id": "ac5", "code_type": "mass",   "is_active": False, "is_revoked": False},
            {"id": "ac6", "code_type": "mass",   "is_active": True,  "is_revoked": True},
        ]
        r = client.get("/admin/overview", headers=_ADMIN_AUTH)
        ac = r.json()["access_codes"]
        assert ac["active"] == 4
        assert ac["by_type"] == {"mass": 2, "direct": 1, "staff": 1}


# ── Error log counts ─────────────────────────────────────────────────


class TestErrorCounts:
    def test_undismissed_24h_7d(self, client, fake_db):
        fake_db.tables["error_logs"] = [
            {"id": "e1", "level": "error", "occurred_at": _iso(-0.5),  "dismissed_at": None},
            {"id": "e2", "level": "error", "occurred_at": _iso(-2),    "dismissed_at": None},
            {"id": "e3", "level": "error", "occurred_at": _iso(-10),   "dismissed_at": None},
            {"id": "e4", "level": "error", "occurred_at": _iso(-0.5),  "dismissed_at": _iso(-0.1)},
        ]
        r = client.get("/admin/overview", headers=_ADMIN_AUTH)
        e = r.json()["errors"]
        assert e["undismissed"] == 3
        assert e["last_24h"] == 2  # e1 (-0.5d) and e4 (-0.5d) within 24h
        assert e["last_7d"] == 3   # e1 + e2 + e4


# ── Recent activity feed ─────────────────────────────────────────────


class TestRecentActivity:
    def test_sorted_desc_by_timestamp(self, client, fake_db):
        fake_db.tables["sessions"] = [
            {"id": "old", "user_id": "u1", "overall_band": 6.5, "status": "completed",
             "created_at": _iso(-3), "completed_at": _iso(-3)},
            {"id": "new", "user_id": "u1", "overall_band": 7.0, "status": "completed",
             "created_at": _iso(-1), "completed_at": _iso(-1)},
        ]
        r = client.get("/admin/overview", headers=_ADMIN_AUTH)
        feed = r.json()["recent_activity"]
        assert len(feed) == 2
        assert feed[0]["timestamp"] > feed[1]["timestamp"]

    def test_capped_at_20_rows(self, client, fake_db):
        # 30 attempts in last 30d.
        fake_db.tables["listening_test_attempts"] = [
            {"id": f"a{i}", "user_id": "u1", "test_id": f"t{i}",
             "status": "submitted", "score": 8,
             "grading_details": [{"q_num": q + 1} for q in range(10)],
             "created_at": _iso(-(i / 10)), "submitted_at": _iso(-(i / 10))}
            for i in range(30)
        ]
        r = client.get("/admin/overview", headers=_ADMIN_AUTH)
        assert len(r.json()["recent_activity"]) == 20

    def test_email_enrichment(self, client, fake_db):
        fake_db.tables["users"] = [
            {"id": "u1", "email": "user1@x"},
        ]
        fake_db.tables["sessions"] = [
            {"id": "s1", "user_id": "u1", "overall_band": 6.5, "status": "completed",
             "created_at": _iso(-1), "completed_at": _iso(-1)},
        ]
        r = client.get("/admin/overview", headers=_ADMIN_AUTH)
        feed = r.json()["recent_activity"]
        assert feed[0]["user_email"] == "user1@x"

    def test_links_populated_for_speaking_and_writing(self, client, fake_db):
        fake_db.tables["students"] = [
            {"id": "stu1", "user_id": "u1", "cohort_id": None, "created_at": _iso(-10)},
        ]
        fake_db.tables["sessions"] = [
            {"id": "s1", "user_id": "u1", "overall_band": 6.5, "status": "completed",
             "created_at": _iso(-1), "completed_at": _iso(-1)},
        ]
        fake_db.tables["writing_essays"] = [
            {"id": "e1", "student_id": "stu1", "status": "graded",
             "delivered_at": None, "created_at": _iso(-2)},
        ]
        r = client.get("/admin/overview", headers=_ADMIN_AUTH)
        feed = r.json()["recent_activity"]
        speaking_row = next(a for a in feed if a["skill"] == "speaking")
        writing_row = next(a for a in feed if a["skill"] == "writing")
        assert speaking_row["link"] == "/result?session_id=s1"
        assert writing_row["link"] == "/admin/writing/grade?essay_id=e1"
