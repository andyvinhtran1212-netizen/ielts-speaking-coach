"""ACCOUNTDATA-0100 T006: export package job (FR-011, FR-012, FR-014 export
side) on a real PostgreSQL with migration 500 and an in-memory Storage."""

from __future__ import annotations

import asyncio
import os
import io
import json
import zipfile
from types import SimpleNamespace

import pytest

from services import account_export as ex
from tests.account_data_pg import make_engine, pg_database

U1 = "00000000-0000-0000-0000-0000000030a1"
U2 = "00000000-0000-0000-0000-0000000030a2"
S1 = "00000000-0000-0000-0000-0000000030b1"
SESS = "00000000-0000-0000-0000-0000000030c1"
SESS2 = "00000000-0000-0000-0000-0000000030c2"

SEED = f"""
INSERT INTO public.users (id, email, display_name) VALUES
  ('{U1}', 'an@example.test', 'An'), ('{U2}', 'b@example.test', 'B');
CREATE TABLE public.students (id uuid PRIMARY KEY, user_id uuid, full_name text NOT NULL);
INSERT INTO public.students VALUES ('{S1}', '{U1}', 'Nguyễn An');
CREATE TABLE public.sessions (id uuid PRIMARY KEY, user_id uuid NOT NULL, status text);
INSERT INTO public.sessions VALUES ('{SESS}', '{U1}', 'completed'), ('{SESS2}', '{U2}', 'completed');
CREATE TABLE public.responses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid REFERENCES public.sessions(id) ON DELETE CASCADE, transcript text);
INSERT INTO public.responses (session_id, transcript) VALUES ('{SESS}', 'mine'), ('{SESS2}', 'not mine');
CREATE TABLE public.writing_essays (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), student_id uuid, body text);
INSERT INTO public.writing_essays (student_id, body) VALUES ('{S1}', 'my essay');
"""


class FakeStorage(ex.StorageAdapter):
    def __init__(self):
        super().__init__(client=object())
        self.objects: dict[tuple[str, str], bytes] = {}
        self.uploads: list[str] = []

    def list_prefix(self, bucket, prefix):
        prefix = prefix.rstrip("/")
        return sorted(p for b, p in self.objects if b == bucket and (not prefix or p.startswith(prefix + "/")))

    def download(self, bucket, path):
        return self.objects[(bucket, path)]

    def upload(self, bucket, path, data, content_type):
        assert content_type == "application/zip"
        self.uploads.append(path)
        self.objects[(bucket, path)] = data

    def remove(self, bucket, paths):
        for p in paths:
            self.objects.pop((bucket, p), None)


@pytest.fixture
def env():
    gen = pg_database(SEED)
    url, run = next(gen)
    engine = make_engine(url)
    storage = FakeStorage()
    storage.objects[("audio-responses", f"{U1}/{SESS}/q1.a.webm")] = b"audio-1" * 10
    storage.objects[("audio-responses", f"{U2}/{SESS2}/q1.b.webm")] = b"other"
    letters = []

    async def send(template, to, payload, *, idempotency_key=None):
        letters.append((template, to, payload, idempotency_key))
        return SimpleNamespace(ok=True, error=None)

    async def pdf(session_id):
        return b"%PDF-" + session_id.encode()

    try:
        yield SimpleNamespace(engine=engine, run=run, storage=storage, letters=letters, send=send, pdf=pdf)
    finally:
        try:
            next(gen)
        except StopIteration:
            pass


def _queue(env, user=U1):
    return env.run(f"INSERT INTO public.account_data_exports (user_id) VALUES ('{user}') RETURNING id")


def _run(env, **kw):
    args = dict(owner="w1", storage=env.storage, lease_seconds=300, max_bytes=10_000_000, link_days=7,
                send=env.send, render_pdf=env.pdf)
    args.update(kw)
    return asyncio.run(ex.run_one(env.engine, **args))


def test_builds_package_with_only_own_data(env):
    job = _queue(env)
    assert _run(env) == "ready"
    status, path, size = env.run(f"SELECT status, object_path, size_bytes FROM public.account_data_exports "
                                 f"WHERE id = '{job}'").split("|")
    assert status == "ready" and path.startswith(f"{U1}/{job}/") and path.endswith(".zip")
    zf = zipfile.ZipFile(io.BytesIO(env.storage.objects[("account-exports", path)]))
    names = set(zf.namelist())
    assert int(size) == len(env.storage.objects[("account-exports", path)])
    manifest = json.loads(zf.read("manifest.json"))
    assert manifest["inventory_version"] and "data/users.id.json" in manifest["files"]
    assert f"speaking/{SESS}.pdf" in names and f"speaking/{SESS2}.pdf" not in names
    assert f"recordings/{U1}/{SESS}/q1.a.webm" in names
    assert not any(U2 in n for n in names)
    responses = json.loads(zf.read("data/responses.session_id.json"))
    assert [r["transcript"] for r in responses] == ["mine"]
    essays = json.loads(zf.read("data/writing_essays.student_id.json"))
    assert [e["body"] for e in essays] == ["my essay"]
    assert {"table": "credit_ledger", "reason": "table_not_present"} in manifest["left_out"]
    assert [t for t, *_ in env.letters] == ["account_export_ready"]
    assert "https://" not in json.dumps(env.letters[0][2], default=str)
    assert _run(env) is None  # nothing left to claim


def test_over_size_drops_recordings(env):
    env.storage.objects[("audio-responses", f"{U1}/{SESS}/big.webm")] = os.urandom(300_000)
    job = _queue(env)
    assert _run(env, max_bytes=200_000) == "ready"
    path = env.run(f"SELECT object_path FROM public.account_data_exports WHERE id = '{job}'")
    zf = zipfile.ZipFile(io.BytesIO(env.storage.objects[("account-exports", path)]))
    assert not any(n.startswith("recordings/") for n in zf.namelist())
    left = json.loads(zf.read("manifest.json"))["left_out"]
    assert {"part": "recordings", "count": 2, "reason": "package_over_size_limit"} in left


def test_erasing_account_is_not_claimed_and_cancel_during_build_removes_own_object(env):
    _queue(env, U2)
    env.run(f"INSERT INTO public.account_deletion_requests (user_id, status, erase_after, erasing_owner, lease_until) "
            f"VALUES ('{U2}', 'erasing', now(), 'e', now() + interval '5 minutes')")
    assert _run(env) is None
    job = _queue(env, U1)

    storage = env.storage
    real_upload = storage.upload

    def upload_then_cancel(bucket, path, data, content_type):
        real_upload(bucket, path, data, content_type)
        env.run(f"UPDATE public.account_data_exports SET status = 'cancelled', lease_until = NULL "
                f"WHERE id = '{job}'")

    storage.upload = upload_then_cancel
    assert _run(env) == "lost"
    assert env.run(f"SELECT status FROM public.account_data_exports WHERE id = '{job}'") == "cancelled"
    assert storage.list_prefix("account-exports", "") == []


def test_build_failure_marks_failed_and_learner_can_ask_again(env):
    job = _queue(env)

    async def broken_pdf(_sid):
        raise RuntimeError("reportlab")

    # A broken sheet is left out, not fatal.
    assert _run(env, render_pdf=broken_pdf) == "ready"
    path = env.run(f"SELECT object_path FROM public.account_data_exports WHERE id = '{job}'")
    zf = zipfile.ZipFile(io.BytesIO(env.storage.objects[("account-exports", path)]))
    assert {"part": f"speaking/{SESS}.pdf", "reason": "pdf_failed"} in json.loads(zf.read("manifest.json"))["left_out"]
    env.run("DELETE FROM public.account_data_exports")
    job = _queue(env)

    def broken_upload(*a, **k):
        raise RuntimeError("storage down")

    env.storage.upload = broken_upload
    assert _run(env).startswith("failed:")
    status, code = env.run(f"SELECT status, last_error_code FROM public.account_data_exports "
                           f"WHERE id = '{job}'").split("|")
    assert status == "failed" and code.startswith("build_failed:")
    _queue(env)  # failed is not running: a new job is accepted


def test_cleanup_lists_first_and_keeps_live_objects(env):
    job = _queue(env)
    assert _run(env) == "ready"
    live = env.run(f"SELECT object_path FROM public.account_data_exports WHERE id = '{job}'")
    env.storage.objects[("account-exports", f"{U1}/{job}/00000000-0000-0000-0000-000000000000.zip")] = b"stray"
    out = asyncio.run(ex.cleanup(env.engine, env.storage))
    assert out == {"expired": 0, "removed": 1}
    assert env.storage.list_prefix("account-exports", "") == [live]
    env.run(f"UPDATE public.account_data_exports SET ready_at = now() - interval '8 days', "
            f"expires_at = now() - interval '1 day' WHERE id = '{job}'")
    out = asyncio.run(ex.cleanup(env.engine, env.storage))
    assert out == {"expired": 1, "removed": 1}
    assert env.storage.list_prefix("account-exports", "") == []
    assert env.run(f"SELECT status FROM public.account_data_exports WHERE id = '{job}'") == "expired"


def test_expired_lease_is_taken_over_with_a_new_token(env):
    job = _queue(env)
    claim = asyncio.run(ex.claim_next(env.engine, "w1", 300))
    assert claim and claim.id == job
    assert asyncio.run(ex.claim_next(env.engine, "w2", 300)) is None
    env.run(f"UPDATE public.account_data_exports SET lease_until = now() - interval '1 second' WHERE id = '{job}'")
    taken = asyncio.run(ex.claim_next(env.engine, "w2", 300))
    assert taken and taken.claim_token != claim.claim_token
    assert asyncio.run(ex.renew(env.engine, claim, 300)) is False
    assert asyncio.run(ex.complete(env.engine, claim, 10, 7)) is None
