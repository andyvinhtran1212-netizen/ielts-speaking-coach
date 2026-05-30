"""Sprint 20.15 — admin reading test preview + delete tests.

Covers:
  * GET    /admin/reading/content/tests/{test_id} — admin preview returns
    full bundle with answer keys + explanations + any-status filter
  * DELETE /admin/reading/content/tests/{test_id} — attempt-safe semantics
    (0 attempts → hard delete; >0 attempts → soft `status='archived'`)
  * 404 on missing test_id; auth-gated

Supabase is fully mocked (no real DB). Pattern matches the existing
test_reading_l3 + test_reading_diagram_image suites.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient


_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}
_TEST_UUID  = "11111111-1111-1111-1111-111111111111"
_TEST_ROW   = {
    "id":                 _TEST_UUID,
    "test_id":            "AVR-READ-001",
    "title":              "Academic Reading — Test 1",
    "module":             "academic",
    "time_limit_minutes": 60,
    "passage_count":      3,
    "total_questions":    40,
    "band_target":        7.0,
    "status":             "published",
    "created_at":         "2026-05-29T00:00:00Z",
    "updated_at":         "2026-05-29T00:00:00Z",
}


def _client() -> TestClient:
    from main import app
    return TestClient(app)


# ── Helpers to build the chainable Supabase select() mock ────────────


def _mk_test_select_chain(row=_TEST_ROW):
    """Mock for `supabase.table("reading_tests").select(...).eq(...).
    limit(1).execute()` returning the row (or empty)."""
    chain = MagicMock()
    chain.select.return_value.eq.return_value.limit.return_value.execute.return_value = (
        MagicMock(data=[row] if row else [])
    )
    return chain


def _mk_passages_select_chain(passages):
    """For `.table("reading_passages").select(...).eq(...).eq(...).order(...).execute()`."""
    chain = MagicMock()
    chain.select.return_value.eq.return_value.eq.return_value.order.return_value.execute.return_value = (
        MagicMock(data=passages)
    )
    return chain


def _mk_questions_select_chain(questions):
    """For `.table("reading_questions").select(...).in_(...).order(...).execute()`."""
    chain = MagicMock()
    chain.select.return_value.in_.return_value.order.return_value.execute.return_value = (
        MagicMock(data=questions)
    )
    return chain


def _mk_attempts_count_chain(count: int):
    """For `.table("reading_test_attempts").select("id", count="exact").
    eq(...).limit(1).execute()`."""
    chain = MagicMock()
    res = MagicMock(data=[])
    res.count = count
    chain.select.return_value.eq.return_value.limit.return_value.execute.return_value = res
    return chain


def _mk_update_chain():
    chain = MagicMock()
    chain.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
    return chain


def _mk_delete_chain():
    chain = MagicMock()
    chain.delete.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
    return chain


# ── GET /admin/reading/content/tests/{test_id} — admin preview ───────


def test_admin_preview_returns_test_with_answer_keys():
    """The admin endpoint must INCLUDE the answer key column the
    student fetch strips. Verification is the whole point."""
    passages = [
        {"id": "p-1", "slug": "p1", "title": "P1", "body_markdown": "...",
         "passage_order": 1, "word_count": 100, "estimated_minutes": 2,
         "topic_tags": [], "status": "published"},
    ]
    questions = [
        {"id": "q-1", "q_num": 1, "question_type": "mcq_single",
         "prompt": "...", "payload": {"options": [{"label": "A", "text": "x"}]},
         "answer": {"answer": "A", "alternatives": []},
         "explanation": "Because A.",
         "skill_tag": "detail", "sub_skill": None, "order_num": 1,
         "passage_id": "p-1"},
    ]

    def table_router(name):
        if name == "reading_tests":      return _mk_test_select_chain(_TEST_ROW)
        if name == "reading_passages":   return _mk_passages_select_chain(passages)
        if name == "reading_questions":  return _mk_questions_select_chain(questions)
        return MagicMock()

    with patch("routers.admin_reading.require_admin") as req_admin, \
         patch("routers.admin_reading.supabase_admin") as supa, \
         patch("routers.reading_student.supabase_admin"):
        async def _ok(_): return _ADMIN_USER
        req_admin.side_effect = _ok
        supa.table.side_effect = table_router
        resp = _client().get(
            "/admin/reading/content/tests/AVR-READ-001",
            headers=_ADMIN_AUTH,
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["test_id"] == "AVR-READ-001"
    assert body["title"] == "Academic Reading — Test 1"
    assert len(body["passages"]) == 1
    qs = body["questions"]
    assert len(qs) == 1
    # The answer key + explanation are surfaced (NOT stripped).
    assert qs[0]["answer"] == {"answer": "A", "alternatives": []}
    assert qs[0]["explanation"] == "Because A."
    # passage_order is stamped from the joined passage.
    assert qs[0]["passage_order"] == 1


def test_admin_preview_404_on_missing_test():
    with patch("routers.admin_reading.require_admin") as req_admin, \
         patch("routers.admin_reading.supabase_admin") as supa:
        async def _ok(_): return _ADMIN_USER
        req_admin.side_effect = _ok
        supa.table.return_value = _mk_test_select_chain(row=None)
        resp = _client().get(
            "/admin/reading/content/tests/NOPE",
            headers=_ADMIN_AUTH,
        )
    assert resp.status_code == 404
    assert "NOPE" in resp.text


def test_admin_preview_accepts_any_status():
    """The admin endpoint must NOT filter by status — drafts +
    archived tests must be previewable too. The handler doesn't add
    any status filter; verified here by checking the chain doesn't
    receive `.eq("status", ...)` after the test_id select."""
    draft_row = dict(_TEST_ROW, status="draft")
    passages = []
    questions = []
    def table_router(name):
        if name == "reading_tests":      return _mk_test_select_chain(draft_row)
        if name == "reading_passages":   return _mk_passages_select_chain(passages)
        if name == "reading_questions":  return _mk_questions_select_chain(questions)
        return MagicMock()
    with patch("routers.admin_reading.require_admin") as req_admin, \
         patch("routers.admin_reading.supabase_admin") as supa:
        async def _ok(_): return _ADMIN_USER
        req_admin.side_effect = _ok
        supa.table.side_effect = table_router
        resp = _client().get(
            "/admin/reading/content/tests/AVR-READ-001",
            headers=_ADMIN_AUTH,
        )
    assert resp.status_code == 200
    assert resp.json()["status"] == "draft"


# ── DELETE /admin/reading/content/tests/{test_id} — attempt-safe ─────


def test_delete_hard_when_no_attempts():
    """0 attempts → action='deleted', the delete chain fires on
    reading_tests, the FK cascade handles passages + questions."""
    delete_chain = _mk_delete_chain()
    def table_router(name):
        if name == "reading_tests":          return _RouterDeleteChain(delete_chain)
        if name == "reading_test_attempts":  return _mk_attempts_count_chain(0)
        return MagicMock()
    with patch("routers.admin_reading.require_admin") as req_admin, \
         patch("routers.admin_reading.supabase_admin") as supa:
        async def _ok(_): return _ADMIN_USER
        req_admin.side_effect = _ok
        supa.table.side_effect = table_router
        resp = _client().delete(
            "/admin/reading/content/tests/AVR-READ-001",
            headers=_ADMIN_AUTH,
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["action"] == "deleted"
    assert body["attempts_preserved"] == 0
    # The chain was called via .delete().eq().execute().
    delete_chain.delete.return_value.eq.return_value.execute.assert_called_once()


def test_delete_soft_when_attempts_exist():
    """>0 attempts → action='archived' + status updated, NO hard delete.
    Per Lesson 9: don't cascade-wipe student attempt data."""
    update_chain = _mk_update_chain()
    def table_router(name):
        if name == "reading_tests":          return _RouterUpdateChain(update_chain)
        if name == "reading_test_attempts":  return _mk_attempts_count_chain(5)
        return MagicMock()
    with patch("routers.admin_reading.require_admin") as req_admin, \
         patch("routers.admin_reading.supabase_admin") as supa:
        async def _ok(_): return _ADMIN_USER
        req_admin.side_effect = _ok
        supa.table.side_effect = table_router
        resp = _client().delete(
            "/admin/reading/content/tests/AVR-READ-001",
            headers=_ADMIN_AUTH,
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["action"] == "archived"
    assert body["attempts_preserved"] == 5
    # The chain was called via .update({"status":"archived"}).eq().execute().
    update_chain.update.assert_called_once_with({"status": "archived"})


def test_delete_404_on_missing_test():
    with patch("routers.admin_reading.require_admin") as req_admin, \
         patch("routers.admin_reading.supabase_admin") as supa:
        async def _ok(_): return _ADMIN_USER
        req_admin.side_effect = _ok
        supa.table.return_value = _mk_test_select_chain(row=None)
        resp = _client().delete(
            "/admin/reading/content/tests/NOPE",
            headers=_ADMIN_AUTH,
        )
    assert resp.status_code == 404


def test_delete_requires_admin_auth():
    """No auth header → 401/403 (passes through require_admin which
    is what enforces it)."""
    resp = _client().delete("/admin/reading/content/tests/AVR-READ-001")
    assert resp.status_code in (401, 403)


def test_preview_requires_admin_auth():
    resp = _client().get("/admin/reading/content/tests/AVR-READ-001")
    assert resp.status_code in (401, 403)


# ── Helper classes: shaped chains that ALSO satisfy the select call ──
# The router does select → fetch_or_404 BEFORE the delete/update step,
# so the test_router needs to return a chain that supports BOTH the
# initial select+limit AND the subsequent delete/update.


class _RouterDeleteChain:
    """Supports both `.select(...).eq(...).limit(1).execute()` and
    `.delete().eq(...).execute()` on the same `table()` return."""
    def __init__(self, delete_chain):
        self._select_chain = _mk_test_select_chain(_TEST_ROW)
        self._delete_chain = delete_chain
        self.delete = delete_chain.delete
        self.select = self._select_chain.select


class _RouterUpdateChain:
    def __init__(self, update_chain):
        self._select_chain = _mk_test_select_chain(_TEST_ROW)
        self._update_chain = update_chain
        self.update = update_chain.update
        self.select = self._select_chain.select
