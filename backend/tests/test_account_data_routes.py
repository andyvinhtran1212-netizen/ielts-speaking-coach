"""ACCOUNTDATA-0100 T004: /api/account deletion-request and data-export routes
(FR-001…FR-003, FR-010, FR-012) on a real PostgreSQL with migration 500."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from tests.account_data_pg import make_engine, pg_database

U1 = "00000000-0000-0000-0000-0000000010a1"
U2 = "00000000-0000-0000-0000-0000000010a2"
ADMIN = "00000000-0000-0000-0000-0000000010ad"
USERS = {"t1": (U1, "An@Example.test"), "t2": (U2, "b@example.test"), "tadmin": (ADMIN, "admin@example.test")}

SEED = f"""
INSERT INTO public.users (id, email, display_name, role) VALUES
  ('{U1}', 'an@example.test', 'An', 'student'),
  ('{U2}', 'b@example.test', NULL, 'student'),
  ('{ADMIN}', 'admin@example.test', 'Admin', 'admin');
INSERT INTO auth.sessions (user_id) VALUES ('{U1}'), ('{U1}'), ('{U2}');
"""


@pytest.fixture
def env(monkeypatch):
    gen = pg_database(SEED)
    url, run = next(gen)
    engine = make_engine(url)
    from main import app
    from routers import account_data
    from services import account_data_db

    async def fake_user(authorization):
        token = (authorization or "").removeprefix("Bearer ")
        if token not in USERS:
            from fastapi import HTTPException
            raise HTTPException(401, detail="Invalid token")
        uid, email = USERS[token]
        return {"id": uid, "email": email}

    letters = []

    async def fake_send(template, to, payload, *, client=None, idempotency_key=None):
        letters.append((template, to, payload, idempotency_key))
        return SimpleNamespace(ok=True, error=None)

    monkeypatch.setattr(account_data, "get_supabase_user", fake_user)
    monkeypatch.setattr(account_data.learner_email, "send_direct", fake_send)
    account_data_db.set_engine(engine)
    try:
        with TestClient(app) as client:
            yield SimpleNamespace(client=client, run=run, letters=letters, monkeypatch=monkeypatch)
    finally:
        account_data_db.set_engine(None)
        try:
            next(gen)
        except StopIteration:
            pass


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def test_get_without_request_is_none(env):
    r = env.client.get("/api/account/deletion-request", headers=_h("t1"))
    assert r.status_code == 200 and r.json() == {"status": "none", "requested_at": None, "erase_after": None}
    assert r.headers["cache-control"] == "no-store"
    assert env.client.get("/api/account/data-export", headers=_h("t1")).headers["cache-control"] == "no-store"


def test_create_checks_email_and_staff(env):
    r = env.client.post("/api/account/deletion-request", json={"confirm_email": "other@example.test"},
                        headers=_h("t1"))
    assert r.status_code == 422 and r.json()["detail"]["error_code"] == "confirm_email_mismatch"
    r = env.client.post("/api/account/deletion-request", json={"confirm_email": "admin@example.test"},
                        headers=_h("tadmin"))
    assert r.status_code == 403 and r.json()["detail"]["error_code"] == "staff_account_not_self_deletable"
    assert env.run("SELECT count(*) FROM public.account_deletion_requests") == "0"
    assert env.letters == []


def test_create_revokes_sessions_sends_letter_and_is_idempotent(env):
    r = env.client.post("/api/account/deletion-request", json={"confirm_email": "  AN@example.TEST "},
                        headers=_h("t1"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "pending" and body["sessions_revoked"] is True and body["email_sent"] is True
    assert env.run(f"SELECT count(*) FROM auth.sessions WHERE user_id = '{U1}'") == "0"
    assert env.run(f"SELECT count(*) FROM auth.sessions WHERE user_id = '{U2}'") == "1"
    days = env.run(f"SELECT round(extract(epoch FROM erase_after - requested_at) / 86400) "
                   f"FROM public.account_deletion_requests WHERE user_id = '{U1}'")
    assert days == "30"
    assert [t for t, *_ in env.letters] == ["account_deletion_requested"]
    assert env.letters[0][1] == "An@Example.test"
    again = env.client.post("/api/account/deletion-request", json={"confirm_email": "an@example.test"},
                            headers=_h("t1"))
    assert again.status_code == 200
    assert again.json()["erase_after"] == body["erase_after"] and again.json()["email_sent"] is None
    assert env.run("SELECT count(*) FROM public.account_deletion_requests") == "1"
    assert len(env.letters) == 1
    got = env.client.get("/api/account/deletion-request", headers=_h("t1")).json()
    assert got["status"] == "pending" and got["erase_after"] == body["erase_after"]


def test_letter_and_revoke_failures_keep_the_request(env):
    from routers import account_data

    async def broken_revoke(engine, user_id):
        raise RuntimeError("auth down")

    async def broken_send(*a, **k):
        return SimpleNamespace(ok=False, error="unconfigured")

    env.monkeypatch.setattr(account_data, "delete_auth_sessions", broken_revoke)
    env.monkeypatch.setattr(account_data.learner_email, "send_direct", broken_send)
    r = env.client.post("/api/account/deletion-request", json={"confirm_email": "b@example.test"},
                        headers=_h("t2"))
    assert r.status_code == 200
    assert r.json()["sessions_revoked"] is False and r.json()["email_sent"] is False
    assert env.run(f"SELECT status FROM public.account_deletion_requests WHERE user_id = '{U2}'") == "pending"


def test_cancel(env):
    r = env.client.post("/api/account/deletion-request/cancel", headers=_h("t1"))
    assert r.status_code == 409 and r.json()["detail"]["error_code"] == "no_pending_deletion_request"
    env.client.post("/api/account/deletion-request", json={"confirm_email": "an@example.test"}, headers=_h("t1"))
    r = env.client.post("/api/account/deletion-request/cancel", headers=_h("t1"))
    assert r.status_code == 200 and r.json()["status"] == "cancelled" and r.json()["cancelled_at"]
    assert env.client.get("/api/account/deletion-request", headers=_h("t1")).json()["status"] == "none"
    # A new request after a cancel is a new row.
    env.client.post("/api/account/deletion-request", json={"confirm_email": "an@example.test"}, headers=_h("t1"))
    env.run(f"UPDATE public.account_deletion_requests SET status = 'erasing', erasing_owner = 'w', "
            f"lease_until = now() + interval '5 minutes' WHERE user_id = '{U1}' AND status = 'pending'")
    r = env.client.post("/api/account/deletion-request/cancel", headers=_h("t1"))
    assert r.status_code == 409 and r.json()["detail"]["error_code"] == "deletion_in_progress"


def test_export_request_status_cooldown_and_erasing(env):
    assert env.client.get("/api/account/data-export", headers=_h("t1")).json() == {"status": "none"}
    r = env.client.post("/api/account/data-export", headers=_h("t1"))
    assert r.status_code == 200 and r.json()["status"] == "queued"
    export_id = r.json()["export_id"]
    again = env.client.post("/api/account/data-export", headers=_h("t1"))
    assert again.json()["export_id"] == export_id
    # Ready one hour ago → within the 24 h cooldown.
    env.run(f"UPDATE public.account_data_exports SET status = 'ready', claim_token = gen_random_uuid(), "
            f"ready_at = now() - interval '1 hour', expires_at = now() + interval '6 days', "
            f"object_path = user_id::text || '/' || id::text || '/' || gen_random_uuid()::text || '.zip' "
            f"WHERE id = '{export_id}'")
    r = env.client.post("/api/account/data-export", headers=_h("t1"))
    assert r.status_code == 429 and r.json()["detail"]["error_code"] == "export_recently_requested"
    assert 22 * 3600 < r.json()["detail"]["retry_after"] <= 23 * 3600
    assert r.headers["retry-after"] == str(r.json()["detail"]["retry_after"])
    # A pending deletion may still export; erasing may not.
    env.run(f"INSERT INTO public.account_deletion_requests (user_id, status, erase_after, erasing_owner, lease_until) "
            f"VALUES ('{U2}', 'erasing', now(), 'w', now() + interval '5 minutes')")
    r = env.client.post("/api/account/data-export", headers=_h("t2"))
    assert r.status_code == 409 and r.json()["detail"]["error_code"] == "account_erasing"


def test_download(env):
    from routers import account_data
    signed = []

    def fake_sign(path, seconds):
        signed.append((path, seconds))
        return "https://storage.example/signed?token=x"

    env.monkeypatch.setattr(account_data, "sign_export_url", fake_sign)
    job = env.client.post("/api/account/data-export", headers=_h("t1")).json()["export_id"]
    r = env.client.get(f"/api/account/data-export/{job}/download", headers=_h("t1"), follow_redirects=False)
    assert r.status_code == 409 and r.json()["detail"]["error_code"] == "export_not_ready"
    env.run(f"UPDATE public.account_data_exports SET status = 'ready', claim_token = gen_random_uuid(), "
            f"ready_at = now(), expires_at = now() + interval '7 days', "
            f"object_path = user_id::text || '/' || id::text || '/' || gen_random_uuid()::text || '.zip' "
            f"WHERE id = '{job}'")
    r = env.client.get(f"/api/account/data-export/{job}/download", headers=_h("t1"), follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"].startswith("https://storage.example/")
    assert r.headers["cache-control"] == "no-store"
    assert signed[0][0].startswith(f"{U1}/{job}/") and signed[0][1] == 60
    j = env.client.get(f"/api/account/data-export/{job}/download",
                       headers={**_h("t1"), "Accept": "application/json"}, follow_redirects=False)
    assert j.status_code == 200 and j.headers["cache-control"] == "no-store"
    assert j.json() == {"url": "https://storage.example/signed?token=x", "expires_in_seconds": 60}
    other = env.client.get(f"/api/account/data-export/{job}/download", headers=_h("t2"), follow_redirects=False)
    assert other.status_code == 404 and other.json()["detail"]["error_code"] == "export_not_found"
    env.run(f"UPDATE public.account_data_exports SET ready_at = now() - interval '8 days', "
            f"expires_at = now() - interval '1 day' WHERE id = '{job}'")
    r = env.client.get(f"/api/account/data-export/{job}/download", headers=_h("t1"), follow_redirects=False)
    assert r.status_code == 410 and r.json()["detail"]["error_code"] == "export_expired"
    assert env.client.get("/api/account/data-export", headers=_h("t1")).json()["status"] == "expired"
    env.run(f"INSERT INTO public.account_deletion_requests (user_id, status, erase_after, erasing_owner, lease_until) "
            f"VALUES ('{U1}', 'erasing', now(), 'w', now() + interval '5 minutes')")
    r = env.client.get(f"/api/account/data-export/{job}/download", headers=_h("t1"), follow_redirects=False)
    assert r.status_code == 404


def test_unauthenticated_is_401(env):
    assert env.client.get("/api/account/deletion-request").status_code == 401
    assert env.client.post("/api/account/data-export").status_code == 401


def test_signed_url_downloads_under_a_readable_name(monkeypatch):
    from datetime import datetime, timezone
    from routers import account_data

    calls = []

    class Bucket:
        def create_signed_url(self, path, seconds, options=None):
            calls.append((path, seconds, options))
            return {"signedURL": "https://storage.example/s?token=x&download=f.zip"}

    monkeypatch.setattr(account_data, "supabase_admin",
                        SimpleNamespace(storage=SimpleNamespace(from_=lambda bucket: Bucket())))
    assert account_data.sign_export_url("u/e/token.zip", 60).startswith("https://storage.example/")
    name = calls[0][2]["download"]
    assert name.endswith(".zip") and "token" not in name and calls[0][:2] == ("u/e/token.zip", 60)
    assert account_data.export_filename(datetime(2026, 11, 23, tzinfo=timezone.utc)) == \
        "averlearning-du-lieu-tai-khoan-20261123.zip"
