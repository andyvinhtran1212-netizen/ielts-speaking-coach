"""reading-access-tracking Part B — shareable links + ANONYMOUS attempts.

Security-first. The invariants pinned here:
  • A valid, unexpired share token IS the access grant — it BYPASSES the F1
    password lock (the boot bundle is returned for a LOCKED test) but still
    strips answer keys + solution during the test.
  • An expired / rotated / unknown share token is rejected (403 / 404).
  • An anonymous attempt is owned ONLY by its secret anon_id capability token:
    a different anon_id (or none) is 403'd on review — not "any anonymous".
  • anon_src is a SALTED hash of the client IP — the raw IP is NEVER persisted;
    READING_ANON_SALT fails LOUD in production when unset.
  • The post-submit review reveals the solution to the owning anon_id only.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from config import settings

_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_ADMIN = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "a@x"}


def _client():
    from main import app
    return TestClient(app, raise_server_exceptions=False)


# ── A flexible table-routing DB mock (records inserts/updates) ─────────

class _Q:
    def __init__(self, db, table):
        self._db = db
        self._table = table

    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def neq(self, *a, **k): return self
    def in_(self, *a, **k): return self
    def order(self, *a, **k): return self
    def limit(self, *a, **k): return self

    def insert(self, payload):
        self._db.inserts.append((self._table, payload))
        return self

    def update(self, payload):
        self._db.updates.append((self._table, payload))
        return self

    def execute(self):
        return MagicMock(data=list(self._db.data.get(self._table, [])))


class _DB:
    def __init__(self, data):
        self.data = data
        self.inserts: list[tuple] = []
        self.updates: list[tuple] = []

    def table(self, name):
        return _Q(self, name)


# ── Fixtures ───────────────────────────────────────────────────────────

def _shared_test(token="TOK", days=1, locked=False):
    md = {
        "share": {
            "token":      token,
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=days)).isoformat(),
        }
    }
    if locked:
        md["access"] = {"locked": True, "password": "PW-9999"}
    return {
        "id": "t-uuid", "test_id": "T1", "title": "Mock", "module": "academic",
        "time_limit_minutes": 60, "passage_count": 1, "total_questions": 1,
        "band_target": None, "status": "published", "updated_at": None,
        "metadata": md,
    }


def _passage():
    return {"id": "p1", "slug": "s", "title": "t", "body_markdown": "body",
            "passage_order": 1, "word_count": 10, "estimated_minutes": 2,
            "topic_tags": []}


def _question_with_solution():
    return {"id": "q1", "q_num": 1, "question_type": "mcq_single", "prompt": "P",
            "payload": {"options": ["a", "b"], "solution": {"steps": "SECRET_SOLUTION_STEP"}},
            "skill_tag": "detail", "sub_skill": None, "order_num": 1, "passage_id": "p1"}


# ── _hash_anon_src: privacy + fail-loud ────────────────────────────────

def test_hash_anon_src_dev_fallback_never_contains_raw_ip():
    from routers.reading_student import _hash_anon_src
    with patch.object(settings, "ENVIRONMENT", "development"), \
         patch.object(settings, "READING_ANON_SALT", ""):
        h = _hash_anon_src("203.0.113.7")
    assert h and len(h) == 16
    assert "203.0.113.7" not in h            # raw IP never present


def test_hash_anon_src_fails_loud_in_production_without_salt():
    from routers.reading_student import _hash_anon_src
    with patch.object(settings, "ENVIRONMENT", "production"), \
         patch.object(settings, "READING_ANON_SALT", ""):
        with pytest.raises(HTTPException) as e:
            _hash_anon_src("203.0.113.7")
    assert e.value.status_code == 500


def test_hash_anon_src_salted_deterministic_and_salt_sensitive():
    from routers.reading_student import _hash_anon_src
    with patch.object(settings, "READING_ANON_SALT", "salt-a"):
        a1 = _hash_anon_src("1.2.3.4")
        a2 = _hash_anon_src("1.2.3.4")
    with patch.object(settings, "READING_ANON_SALT", "salt-b"):
        b = _hash_anon_src("1.2.3.4")
    assert a1 == a2          # deterministic for a given salt
    assert a1 != b           # different salt → different hash
    assert _hash_anon_src(None) is None


# ── _resolve_share: expiry + unknown token ─────────────────────────────

def test_resolve_share_expired_token_403():
    db = _DB({"reading_tests": [_shared_test(days=-1)]})
    with patch("routers.reading_student.supabase_admin", db):
        from routers.reading_student import _resolve_share
        with pytest.raises(HTTPException) as e:
            _resolve_share("TOK", by_token=True)
    assert e.value.status_code == 403


def test_resolve_share_unknown_token_404():
    db = _DB({"reading_tests": []})
    with patch("routers.reading_student.supabase_admin", db):
        from routers.reading_student import _resolve_share
        with pytest.raises(HTTPException) as e:
            _resolve_share("NOPE", by_token=True)
    assert e.value.status_code == 404


# ── share-boot: bypasses the lock, strips the solution ─────────────────

def test_share_boot_bypasses_lock_and_strips_solution():
    db = _DB({
        "reading_tests":     [_shared_test(locked=True)],   # LOCKED test
        "reading_passages":  [_passage()],
        "reading_questions": [_question_with_solution()],
    })
    with patch("routers.reading_student.supabase_admin", db):
        r = _client().get("/api/reading/test/share/TOK/boot")     # NO auth
    assert r.status_code == 200
    body = r.json()
    assert body["test"]["locked"] is False         # the valid share token IS the grant
    assert "metadata" not in body["test"]          # never leaks password / share token
    assert "SECRET_SOLUTION_STEP" not in r.text    # solution stripped DURING the test
    assert body["in_progress"] is None             # no anon header → no resume


def test_share_boot_expired_token_403():
    db = _DB({"reading_tests": [_shared_test(days=-1)]})
    with patch("routers.reading_student.supabase_admin", db):
        r = _client().get("/api/reading/test/share/TOK/boot")
    assert r.status_code == 403


# ── anonymous start: mints anon_id, salted anon_src, user_id NULL ──────

def test_share_start_mints_anon_id_and_salted_src_no_raw_ip():
    db = _DB({"reading_tests": [_shared_test(locked=True)], "reading_test_attempts": []})
    with patch("routers.reading_student.supabase_admin", db), \
         patch.object(settings, "READING_ANON_SALT", "salt-x"):
        r = _client().post("/api/reading/test/share/TOK/attempts",
                           headers={"X-Forwarded-For": "203.0.113.9"})
    assert r.status_code == 200
    body = r.json()
    assert body["anon_id"] and len(body["anon_id"]) >= 20     # unguessable capability token
    inserted = [p for (t, p) in db.inserts if t == "reading_test_attempts"]
    assert len(inserted) == 1
    row = inserted[0]
    assert row["user_id"] is None                 # anonymous
    assert row["anon_id"] == body["anon_id"]
    assert row["share_token"] == "TOK"
    assert row["status"] == "in_progress"
    assert row["anon_src"] and "203.0.113.9" not in row["anon_src"]   # salted, not raw IP


# ── _fetch_attempt_owned: capability-token ownership ───────────────────

def test_fetch_attempt_owned_anon_match_and_mismatch():
    from routers.reading_student import _fetch_attempt_owned
    row = {"id": "a1", "user_id": None, "anon_id": "SECRET", "test_id": "t", "status": "submitted"}
    db = _DB({"reading_test_attempts": [row]})
    with patch("routers.reading_student.supabase_admin", db):
        assert _fetch_attempt_owned("a1", None, "SECRET")["id"] == "a1"   # match → ok
        with pytest.raises(HTTPException) as e_wrong:
            _fetch_attempt_owned("a1", None, "OTHER")    # wrong anon_id → 403
        assert e_wrong.value.status_code == 403
        with pytest.raises(HTTPException) as e_none:
            _fetch_attempt_owned("a1", None, None)       # NO credential at all → 401
        assert e_none.value.status_code == 401


def test_fetch_attempt_owned_authed_requires_user_match():
    from routers.reading_student import _fetch_attempt_owned
    row = {"id": "a2", "user_id": "U1", "anon_id": None, "test_id": "t", "status": "submitted"}
    db = _DB({"reading_test_attempts": [row]})
    with patch("routers.reading_student.supabase_admin", db):
        assert _fetch_attempt_owned("a2", {"id": "U1"}, None)["id"] == "a2"
        with pytest.raises(HTTPException) as e1:
            _fetch_attempt_owned("a2", {"id": "U2"}, None)       # wrong user
        assert e1.value.status_code == 403
        with pytest.raises(HTTPException) as e2:
            _fetch_attempt_owned("a2", None, "anything")         # anon can't claim an authed attempt
        assert e2.value.status_code == 403


# ── anonymous review gated by anon_id (other anon_id → 403) ────────────

def test_share_review_gated_by_anon_id_and_reveals_solution_to_owner():
    attempt = {
        "id": "a1", "user_id": None, "anon_id": "SECRET", "test_id": "t-uuid",
        "status": "submitted", "score": 0, "band_estimate": 4.0,
        "skill_breakdown": {}, "answers": [],
        "grading_details": [{"q_num": 1, "correct": False, "passage_order": 1}],
    }
    db = _DB({
        "reading_test_attempts": [attempt],
        "reading_tests":     [{"test_id": "T1", "title": "Mock", "module": "academic"}],
        "reading_passages":  [{"id": "p1", "slug": "s", "title": "t",
                               "body_markdown": "b", "passage_order": 1, "metadata": {}}],
        "reading_questions": [_question_with_solution()],
    })
    with patch("routers.reading_student.supabase_admin", db):
        bad = _client().get("/api/reading/test/attempts/a1/review",
                            headers={"X-Reading-Anon": "OTHER"})
        ok = _client().get("/api/reading/test/attempts/a1/review",
                           headers={"X-Reading-Anon": "SECRET"})
    assert bad.status_code == 403                       # foreign anon_id can't review
    assert ok.status_code == 200
    assert "SECRET_SOLUTION_STEP" in ok.text            # solution revealed post-submit to the owner


# ── admin: generate / rotate / revoke the share link ───────────────────

def test_admin_share_generate_writes_token_and_preserves_metadata():
    db = _DB({"reading_tests": [{"id": "t-uuid", "metadata": {"translation_vi": "keep me"}}]})
    with patch("routers.admin_reading.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_reading.supabase_admin", db):
        r = _client().post("/admin/reading/content/tests/T1/share",
                           headers=_ADMIN_AUTH, json={"expires_in_days": 14})
    assert r.status_code == 200
    share = r.json()["share"]
    assert share["token"] and share["expires_in_days"] == 14
    written = [p for (t, p) in db.updates if t == "reading_tests"][0]["metadata"]
    assert written["share"]["token"] == share["token"]
    assert written["translation_vi"] == "keep me"       # other metadata preserved


def test_admin_share_rotation_replaces_token_old_dies():
    db = _DB({"reading_tests": [{"id": "t-uuid", "metadata": {"share": {"token": "OLD"}}}]})
    with patch("routers.admin_reading.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_reading.supabase_admin", db):
        r = _client().post("/admin/reading/content/tests/T1/share",
                           headers=_ADMIN_AUTH, json={"expires_in_days": 7})
    new_token = r.json()["share"]["token"]
    assert new_token != "OLD"                            # fresh token
    written = [p for (t, p) in db.updates if t == "reading_tests"][0]["metadata"]
    assert written["share"]["token"] == new_token        # only the new token survives (old dies)


def test_admin_share_revoke_drops_share():
    db = _DB({"reading_tests": [{"id": "t-uuid", "metadata": {"share": {"token": "OLD"}, "x": 1}}]})
    with patch("routers.admin_reading.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_reading.supabase_admin", db):
        r = _client().post("/admin/reading/content/tests/T1/share",
                           headers=_ADMIN_AUTH, json={"revoke": True})
    assert r.status_code == 200 and r.json()["share"] is None
    written = [p for (t, p) in db.updates if t == "reading_tests"][0]["metadata"]
    assert "share" not in written and written["x"] == 1  # share gone, rest preserved


def test_admin_share_requires_admin():
    assert _client().post("/admin/reading/content/tests/T1/share",
                          json={"expires_in_days": 7}).status_code == 401


def test_admin_share_rejects_out_of_range_days():
    db = _DB({"reading_tests": [{"id": "t-uuid", "metadata": {}}]})
    with patch("routers.admin_reading.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_reading.supabase_admin", db):
        r = _client().post("/admin/reading/content/tests/T1/share",
                           headers=_ADMIN_AUTH, json={"expires_in_days": 999})
    assert r.status_code == 422
