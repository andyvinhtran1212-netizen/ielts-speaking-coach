"""Sprint W0 — auth gate smoke tests for Writing Coach admin routers.

Pins the require_admin enforcement on the new /admin/writing/* and
/admin/students/* endpoints. These tests don't exercise the actual
501 logic (admin-authenticated tests deferred to W2 when real endpoint
implementations land); they confirm the auth wall fires before any
endpoint body runs.

Pattern follows test_vocab_export.py — TestClient instantiated inline,
no shared fixture. conftest.py provides dummy SUPABASE_* env vars so
the app boots without real credentials; we avoid any test that would
make a network call to Supabase by using malformed-auth-shape inputs
that short-circuit in get_supabase_user before the upstream HTTP call.
"""

from fastapi.testclient import TestClient


def _client() -> TestClient:
    """Fresh client per test — keeps fixture surface explicit."""
    from main import app
    return TestClient(app)


# ── /admin/writing/* endpoints — auth gate must fire ─────────────────

def test_writing_essays_post_requires_auth_header():
    """No Authorization header → 401 (require_admin → get_supabase_user)."""
    r = _client().post("/admin/writing/essays")
    assert r.status_code == 401, f"expected 401, got {r.status_code} {r.text}"


def test_writing_essays_post_rejects_malformed_auth():
    """Header without 'Bearer ' prefix → 401 (no upstream call made)."""
    r = _client().post(
        "/admin/writing/essays",
        headers={"Authorization": "NotBearer abc.def.ghi"},
    )
    assert r.status_code == 401, f"expected 401, got {r.status_code} {r.text}"


def test_writing_essays_list_requires_auth_header():
    """GET listing also gated."""
    r = _client().get("/admin/writing/essays")
    assert r.status_code == 401


def test_writing_stats_requires_auth_header():
    """GET stats also gated — covers a different endpoint shape."""
    r = _client().get("/admin/writing/stats")
    assert r.status_code == 401


# ── /admin/students/* endpoints — same gate ──────────────────────────

def test_students_post_requires_auth_header():
    """No Authorization header → 401. (Body sent so Pydantic doesn't 422
    before the auth gate runs in the handler body.)"""
    r = _client().post(
        "/admin/students",
        json={"student_code": "S001", "full_name": "x"},
    )
    assert r.status_code == 401


def test_students_list_requires_auth_header():
    """GET listing also gated."""
    r = _client().get("/admin/students")
    assert r.status_code == 401


def test_students_get_one_requires_auth_header():
    """Path-parametrised endpoint also gated."""
    # UUID shape doesn't matter — auth fires before path validation runs.
    r = _client().get("/admin/students/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 401


# ── Routes are wired (negative reachability check) ───────────────────

def test_writing_routes_registered_not_404():
    """Catches accidental router-mount regression — without auth we should
    see 401 (gate fires) or 405 (method-not-allowed), never 404."""
    r = _client().post("/admin/writing/essays")
    assert r.status_code != 404
    r = _client().get("/admin/students")
    assert r.status_code != 404
