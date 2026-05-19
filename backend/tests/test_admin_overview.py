"""Tests for routers/admin_overview.py (Sprint 12.4 — DEBT-ADMIN-IA-REFACTOR 4/8).

Surfaces under test:

  1. Auth gate — non-admin → 403.
  2. Empty DB returns zero counts (not null, not 500).
  3. Cache-Control: max-age=300 header set on success.
  4. Students bucketed by cohort with synthetic "Đại trà" for NULL.
  5. Active 7d / 30d union of writing + listening + speaking signals.
  6. Speaking avg_band filters to completed sessions only.
  7. Listening avg_score uses first-attempt-only rule (Sprint 11.5.1).
  8. Pending writing essays counted by delivered_at IS NULL.
  9. Access codes counted by code_type, excluding revoked.
  10. Error log counts (undismissed / 24h / 7d).
  11. Recent activity sorted DESC by timestamp, capped at 20.
  12. Email enrichment for user_ids present in activity feed.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


# ── In-memory Supabase fake (reused pattern from test_error_logs.py) ──


class _Resp:
    def __init__(self, data):
        self.data = data


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

    @property
    def not_(self):
        return _IsNot(self)

    def select(self, *_args, **_kw):
        self._mode = "select"
        return self

    def eq(self, field, value):
        self.filters.append((field, "eq", value))
        return self

    def gte(self, field, value):
        self.filters.append((field, "gte", value))
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

    def order(self, *_args, **_kw):
        return self

    def execute(self):
        rows = self.fake.tables.get(self.table_name, [])
        matched = [r for r in rows if self._matches(r)]
        if self.limit_n is not None:
            matched = matched[: self.limit_n]
        return _Resp(matched)

    def _matches(self, row):
        for field, op, value in self.filters:
            row_val = row.get(field)
            if op == "eq" and row_val != value:
                return False
            if op == "ne" and row_val == value:
                return False
            if op == "gte" and (row_val is None or row_val < value):
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
        self.tables: dict[str, list[dict]] = {
            "students":      [],
            "cohorts":       [],
            "sessions":      [],
            "writing_essays": [],
            "listening_attempts": [],
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
    def test_active_7d_unions_listening_sessions_writing(self, client, fake_db):
        # Three different users, each touching one surface in the last 7d.
        fake_db.tables["students"] = [
            {"id": "stu1", "user_id": "u-writer", "cohort_id": None, "created_at": _iso(-10)},
        ]
        fake_db.tables["sessions"] = [
            {"id": "sess1", "user_id": "u-speaker", "overall_band": 6.5,
             "status": "completed", "created_at": _iso(-1), "completed_at": _iso(-1)},
        ]
        fake_db.tables["listening_attempts"] = [
            {"id": "att1", "user_id": "u-listener", "exercise_id": "e1",
             "segment_idx": 0, "score": 80, "created_at": _iso(-2)},
        ]
        fake_db.tables["writing_essays"] = [
            {"id": "ess1", "student_id": "stu1", "status": "delivered",
             "delivered_at": _iso(-1), "created_at": _iso(-1)},
        ]
        r = client.get("/admin/overview", headers=_ADMIN_AUTH)
        assert r.json()["students"]["active_7d"] == 3

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
    def test_avg_score_uses_first_attempt_only(self, client, fake_db):
        # 1 exercise+segment, 3 attempts with different scores. First attempt
        # was 50; retries 90 and 95. Avg must be 50 (Sprint 11.5.1 rule).
        fake_db.tables["listening_attempts"] = [
            {"id": "a1", "user_id": "u1", "exercise_id": "ex1", "segment_idx": 0,
             "score": 50, "created_at": _iso(-1)},
            {"id": "a2", "user_id": "u1", "exercise_id": "ex1", "segment_idx": 0,
             "score": 90, "created_at": _iso(-0.5)},
            {"id": "a3", "user_id": "u1", "exercise_id": "ex1", "segment_idx": 0,
             "score": 95, "created_at": _iso(-0.25)},
        ]
        r = client.get("/admin/overview", headers=_ADMIN_AUTH)
        assert r.json()["skills"]["listening"]["avg_score_7d"] == 50.0
        # But raw attempts_7d counts all 3 (engagement signal).
        assert r.json()["skills"]["listening"]["attempts_7d"] == 3


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
        fake_db.tables["listening_attempts"] = [
            {"id": f"a{i}", "user_id": "u1", "exercise_id": f"ex{i}",
             "segment_idx": 0, "score": 80,
             "created_at": _iso(-(i / 10))}
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
        assert "/pages/result.html?session_id=s1" in speaking_row["link"]
        assert "/pages/admin/writing/grade.html?essay_id=e1" in writing_row["link"]
