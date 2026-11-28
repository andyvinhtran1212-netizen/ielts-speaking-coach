"""LIBRARY-0061 T016 (G06-T16): the caller's own read/saved marks (FR-060,
FR-061). The database and Supabase Auth are faked; the router is the real one
in main.py, behind the real activation gate where a test says so."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tests._library_fake_db import FakeDB

A, B = "user-a", "user-b"
GRAMMAR_KEY = "tenses/past-perfect"


@pytest.fixture()
def db(monkeypatch):
    fake = FakeDB(tables={
        "writing_samples": [
            {"slug": "alpha-schools", "published": True},
            {"slug": "draft-secret", "published": False},
        ],
        "speaking_samples": [{"slug": "describe-a-teacher", "published": True}],
        "writing_tips": [
            {"slug": "linking-words", "published": True, "content_type": "knowledge"},
            {"slug": "student-only", "published": True, "content_type": "other"},
        ],
        "library_marks": [],
    })
    import routers.library as library

    monkeypatch.setattr(library, "supabase_admin", fake)
    return fake


@pytest.fixture()
def auth(monkeypatch):
    """Bearer <uid> is user <uid>; no header is the real 401."""
    import routers.library as library
    from routers.auth import get_supabase_user as real

    async def fake(authorization):
        if not authorization or not authorization.startswith("Bearer "):
            return await real(authorization)
        return {"id": authorization.removeprefix("Bearer "), "email": "x@example.test"}

    monkeypatch.setattr(library, "get_supabase_user", fake)
    return fake


@pytest.fixture()
def api(db, auth):
    from main import app

    client = TestClient(app, raise_server_exceptions=False)

    def call(method, path, uid=None, **kw):
        headers = {"Authorization": f"Bearer {uid}"} if uid else {}
        return client.request(method, path, headers=headers, **kw)

    return call


def _marks(api, uid, shelf):
    r = api("GET", f"/api/library/me/marks?shelf={shelf}", uid)
    assert r.status_code == 200, r.text
    assert r.headers["cache-control"] == "private, no-store"
    return r.json()["marks"]


def test_set_twice_is_one_row_and_listed(api, db):
    for _ in range(2):
        r = api("PATCH", "/api/library/me/marks/writing_sample/read", A, json={"item_key": "alpha-schools"})
        assert r.status_code == 204 and r.content == b""
        assert r.headers["cache-control"] == "private, no-store"
    assert len(db.tables["library_marks"]) == 1
    assert _marks(api, A, "writing_sample") == [{"item_key": "alpha-schools", "kind": "read"}]


def test_read_and_saved_are_separate_and_clear_one(api, db):
    api("PATCH", "/api/library/me/marks/writing_sample/read", A, json={"item_key": "alpha-schools"})
    api("PATCH", "/api/library/me/marks/writing_sample/saved", A, json={"item_key": "alpha-schools"})
    assert [m["kind"] for m in _marks(api, A, "writing_sample")] == ["read", "saved"]
    r = api("DELETE", "/api/library/me/marks/writing_sample/saved", A, json={"item_key": "alpha-schools"})
    assert r.status_code == 204
    assert _marks(api, A, "writing_sample") == [{"item_key": "alpha-schools", "kind": "read"}]
    # Clearing again is fine.
    assert api("DELETE", "/api/library/me/marks/writing_sample/saved", A, json={"item_key": "alpha-schools"}).status_code == 204


def test_grammar_key_with_a_slash_round_trips(api, db):
    r = api("PATCH", "/api/library/me/marks/grammar_article/read", A, json={"item_key": GRAMMAR_KEY})
    assert r.status_code == 204, r.text
    assert _marks(api, A, "grammar_article") == [{"item_key": GRAMMAR_KEY, "kind": "read"}]
    assert api("DELETE", "/api/library/me/marks/grammar_article/read", A, json={"item_key": GRAMMAR_KEY}).status_code == 204
    assert _marks(api, A, "grammar_article") == []


def test_grammar_saved_stays_in_saved_articles(api, db):
    r = api("PATCH", "/api/library/me/marks/grammar_article/saved", A, json={"item_key": GRAMMAR_KEY})
    assert r.status_code == 422 and r.json()["detail"] == "kind_not_allowed"
    assert db.tables["library_marks"] == []


@pytest.mark.parametrize("shelf,key", [
    ("writing_sample", "draft-secret"),          # not published
    ("writing_sample", "no-such-set"),
    ("speaking_sample", "alpha-schools"),        # exists on another shelf only
    ("writing_guide", "student-only"),           # not a public guide type
    ("grammar_article", "tenses/no-such-article"),
    ("grammar_article", "past-perfect"),         # missing category
    ("grammar_article", "tenses/past-perfect/x"),
    ("writing_sample", "   "),
])
def test_marking_a_missing_or_unpublished_item_is_404(api, db, shelf, key):
    r = api("PATCH", f"/api/library/me/marks/{shelf}/read", A, json={"item_key": key})
    assert r.status_code == 404 and r.json()["detail"] == "item_not_found"
    assert db.tables["library_marks"] == []


def test_every_shelf_accepts_its_published_items(api, db):
    for shelf, key in [("speaking_sample", "describe-a-teacher"), ("writing_guide", "linking-words")]:
        assert api("PATCH", f"/api/library/me/marks/{shelf}/saved", A, json={"item_key": key}).status_code == 204
    assert _marks(api, A, "speaking_sample") == [{"item_key": "describe-a-teacher", "kind": "saved"}]
    assert _marks(api, A, "writing_guide") == [{"item_key": "linking-words", "kind": "saved"}]


def test_a_user_never_reads_or_clears_another_users_marks(api, db):
    api("PATCH", "/api/library/me/marks/writing_sample/read", A, json={"item_key": "alpha-schools"})
    assert _marks(api, B, "writing_sample") == []
    # B clearing "the same" mark only touches B's rows.
    assert api("DELETE", "/api/library/me/marks/writing_sample/read", B, json={"item_key": "alpha-schools"}).status_code == 204
    assert _marks(api, A, "writing_sample") == [{"item_key": "alpha-schools", "kind": "read"}]
    # The body cannot name a user: rows are always written for the verified caller.
    api("PATCH", "/api/library/me/marks/writing_sample/saved", B, json={"item_key": "alpha-schools", "user_id": A})
    assert {(r["user_id"], r["kind"]) for r in db.tables["library_marks"]} == {(A, "read"), (B, "saved")}


@pytest.mark.parametrize("method,path,body", [
    ("GET", "/api/library/me/marks?shelf=writing_sample", None),
    ("PATCH", "/api/library/me/marks/writing_sample/read", {"item_key": "alpha-schools"}),
    ("DELETE", "/api/library/me/marks/writing_sample/read", {"item_key": "alpha-schools"}),
])
def test_without_a_token_is_401_and_nothing_is_read(api, db, method, path, body):
    r = api(method, path, json=body)
    assert r.status_code == 401
    assert "library_marks" not in db.calls


@pytest.mark.parametrize("method,path,body", [
    ("GET", "/api/library/me/marks?shelf=vocabulary", None),
    ("GET", "/api/library/me/marks", None),
    ("PATCH", "/api/library/me/marks/vocabulary/read", {"item_key": "x"}),
    ("PATCH", "/api/library/me/marks/writing_sample/liked", {"item_key": "alpha-schools"}),
    ("PATCH", "/api/library/me/marks/writing_sample/read", {}),
    ("PATCH", "/api/library/me/marks/writing_sample/read", {"item_key": ""}),
    ("PATCH", "/api/library/me/marks/writing_sample/read", {"item_key": "x" * 201}),
    ("DELETE", "/api/library/me/marks/writing_sample/read", None),
])
def test_bad_shelf_kind_or_body_is_422(api, db, method, path, body):
    assert api(method, path, A, json=body).status_code == 422
    assert db.writes == []


def test_more_marks_than_one_postgrest_page_are_all_returned(api, db):
    """549 Writing sets × read/saved can pass PostgREST's 1,000-row cap."""
    db.row_limit = 1000
    keys = [f"set-{i:04d}" for i in range(549)]
    db.tables["library_marks"] = [
        {"user_id": A, "shelf": "writing_sample", "item_key": k, "kind": kind}
        for k in keys for kind in ("read", "saved")
    ] + [{"user_id": B, "shelf": "writing_sample", "item_key": "set-0000", "kind": "read"}]
    marks = _marks(api, A, "writing_sample")
    assert len(marks) == 1098
    assert marks[0] == {"item_key": "set-0000", "kind": "read"}
    assert marks[-1] == {"item_key": "set-0548", "kind": "saved"}
    assert len({(m["item_key"], m["kind"]) for m in marks}) == 1098
    assert db.calls.count("library_marks") == 2


def test_db_failure_is_503_no_store(api, db):
    db.broken.add("library_marks")
    for method, path, body in [
        ("GET", "/api/library/me/marks?shelf=writing_sample", None),
        ("PATCH", "/api/library/me/marks/writing_sample/read", {"item_key": "alpha-schools"}),
        ("DELETE", "/api/library/me/marks/writing_sample/read", {"item_key": "alpha-schools"}),
    ]:
        r = api(method, path, A, json=body)
        assert r.status_code == 503 and r.json()["detail"] == "library_unavailable"
        assert "no-store" in r.headers["cache-control"]


def test_routes_are_exempt_from_activation_with_a_reason():
    from services.activation_gate import ACTIVATION_EXEMPT_ROUTES

    for key in [("GET", "/api/library/me/marks"),
                ("PATCH", "/api/library/me/marks/{shelf}/{kind}"),
                ("DELETE", "/api/library/me/marks/{shelf}/{kind}")]:
        assert ACTIVATION_EXEMPT_ROUTES[key].startswith("own library marks; no paid work")


def test_an_account_without_a_class_code_keeps_its_marks(live_activation_gate, db, auth, monkeypatch):
    """Real gate: is_active=false passes on the marks routes (FR-061)."""
    from main import app
    from routers import auth as auth_router
    from services import activation_gate

    class _Users:
        def table(self, name):
            assert name == "users"
            return _UsersQuery()

    class _UsersQuery:
        def select(self, *_a, **_k): return self
        def eq(self, *_a, **_k): return self
        def limit(self, *_a, **_k): return self
        def execute(self):
            class R: data = [{"id": A, "is_active": False}]
            return R()

    monkeypatch.setattr(activation_gate, "supabase_admin", _Users())
    monkeypatch.setattr(auth_router, "get_supabase_user", auth)
    client = TestClient(app, raise_server_exceptions=False)
    headers = {"Authorization": f"Bearer {A}"}
    r = client.patch("/api/library/me/marks/writing_sample/read", headers=headers, json={"item_key": "alpha-schools"})
    assert r.status_code == 204, r.text
    r = client.get("/api/library/me/marks?shelf=writing_sample", headers=headers)
    assert r.status_code == 200 and r.json()["marks"] == [{"item_key": "alpha-schools", "kind": "read"}]
