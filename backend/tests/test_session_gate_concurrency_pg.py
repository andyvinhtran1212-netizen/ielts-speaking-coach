"""COURSEACCESS-0055 T009, HOLD FR-040/041 and Codex P2 on #2544: the real
``session_gate.claim`` racing a real timed-work start, and two real claims
racing each other, on a LOCAL disposable PostgreSQL.

Each test builds one fresh DATABASE (so ``public`` and ``auth`` are the real
names the gate's SQL uses), applies migration 388 verbatim on top of the
columns it reads, and runs the gate with a real SQLAlchemy/asyncpg engine.
Only the PostgREST reads are replaced: ``_load`` (role) and ``_timed`` (here a
direct query for an ``in_progress`` Reading attempt, the same answer
``timed_work.reading_attempt_work`` gives). TEST_PG_URL; with REQUIRE_PG=1 a
missing cluster is a failure, not a skip.

What is proved:
  * a start that holds the account lock first: the claim waits, then sees the
    work and refuses (409); the device doing the work keeps its session;
  * a claim that holds the lock first: the start waits and is then refused,
    so no timed work begins on the session the claim just signed out;
  * two claims at once: exactly one wins; the loser finds its own session
    gone under the lock and answers 401 ``session_displaced`` without
    deleting the winner.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import shutil
import subprocess
from urllib.parse import urlparse, urlunparse
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pathlib import Path

from services import session_gate
from services.timed_work import TimedWork

DB = os.environ.get("TEST_PG_URL", "")
SQL = (Path(__file__).resolve().parents[1] / "migrations" / "388_learner_active_sessions.sql").read_text(
    encoding="utf-8")
USER = "00000000-0000-0000-0000-000000000388"
S_A = "aaaaaaaa-0000-0000-0000-00000000000a"  # the device doing the timed work
S_B = "bbbbbbbb-0000-0000-0000-00000000000b"  # the device pressing "Tiếp tục ở đây"
S_C = "cccccccc-0000-0000-0000-00000000000c"


def _psql(url: str, sql: str) -> str:
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    env["PGCONNECT_TIMEOUT"] = "3"
    result = subprocess.run(["psql", url, "-X", "-v", "ON_ERROR_STOP=1", "-tAq", "-c", sql],
                            capture_output=True, text=True, timeout=30, env=env)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def _local(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme in {"postgres", "postgresql"} and parsed.hostname in {"localhost", "127.0.0.1", "::1"}


@pytest.fixture
def database():
    try:
        available = bool(DB) and _local(DB) and bool(shutil.which("psql")) and _psql(DB, "SELECT 1") == "1"
    except Exception:
        available = False
    if not available:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for the session-gate concurrency proof")
        pytest.skip("Local PostgreSQL unavailable")
    if _psql(DB, "SELECT usesuper FROM pg_user WHERE usename=current_user") != "t":
        pytest.fail("The session-gate concurrency fixture requires a superuser on its LOCAL cluster")
    name = "session_gate_" + uuid4().hex
    _psql(DB, f"CREATE DATABASE {name}")
    url = urlunparse(urlparse(DB)._replace(path="/" + name))
    try:
        _psql(url, """DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
        END $$;""")
        _psql(url, f"""
            CREATE SCHEMA auth;
            CREATE TABLE auth.sessions (id uuid PRIMARY KEY, user_id uuid NOT NULL);
            CREATE TABLE public.users (id uuid PRIMARY KEY);
            INSERT INTO public.users VALUES ('{USER}');
            CREATE TABLE public.students (id uuid PRIMARY KEY, user_id uuid);
            CREATE TABLE public.reading_test_attempts (id bigserial PRIMARY KEY, user_id uuid NOT NULL,
                status text NOT NULL DEFAULT 'in_progress');
            CREATE TABLE public.class_assignment_items (id bigserial PRIMARY KEY, student_id uuid,
                timed_expires_at timestamptz, submitted_at timestamptz);
            CREATE TABLE public.mock_exams (id uuid PRIMARY KEY, listening_started_at timestamptz,
                reading_started_at timestamptz, writing_started_at timestamptz);
            CREATE TABLE public.mock_exam_sittings (id bigserial PRIMARY KEY, mock_exam_id uuid, user_id uuid,
                status text, listening_started_at timestamptz, reading_started_at timestamptz,
                writing_started_at timestamptz);
        """)
        _psql(url, SQL)
        yield url
    finally:
        _psql(DB, f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")


def _token(session_id: str) -> str:
    body = base64.urlsafe_b64encode(json.dumps({"sub": USER, "session_id": session_id}).encode())
    return "Bearer eyJhbGciOiJIUzI1NiJ9." + body.decode().rstrip("=") + ".c2ln"


class _Pause:
    """Holds one claim inside its timed-work lookup (after the lock) until
    released, so the other side of the race can be started deterministically."""

    def __init__(self):
        self.entered = asyncio.Event()
        self.release = asyncio.Event()
        self.armed = True


@pytest.fixture
def wired(database, monkeypatch):
    from sqlalchemy.ext.asyncio import create_async_engine

    parsed = urlparse(database)
    async_url = urlunparse(parsed._replace(scheme="postgresql+asyncpg"))
    state = {"engine": None, "pause": None}

    async def _on():
        return True

    async def _timed(user_id):
        pause = state["pause"]
        if pause is not None and pause.armed:
            pause.armed = False
            pause.entered.set()
            await pause.release.wait()
        async with state["engine"].connect() as conn:
            from sqlalchemy import text
            count = (await conn.execute(text(
                "SELECT count(*) FROM public.reading_test_attempts "
                "WHERE user_id = CAST(:uid AS uuid) AND status = 'in_progress'"), {"uid": user_id})).scalar()
        return TimedWork(title="Reading Test 3", minutes_left=40) if count else None

    monkeypatch.setattr(session_gate, "flag_on", _on)
    monkeypatch.setattr(session_gate, "_load", lambda uid: ("student", None))
    monkeypatch.setattr(session_gate, "_timed", _timed)
    monkeypatch.setattr(session_gate, "_engine", lambda: state["engine"])

    def run(scenario):
        async def main():
            state["engine"] = create_async_engine(async_url, pool_size=5)
            try:
                return await scenario(state)
            finally:
                await state["engine"].dispose()
        return asyncio.run(main())

    return database, run


def _seed(url: str, current: str, sessions: list[str]) -> None:
    values = ", ".join(f"('{s}', '{USER}')" for s in sessions)
    _psql(url, f"INSERT INTO auth.sessions VALUES {values}; "
               f"INSERT INTO public.learner_active_sessions (user_id, session_id) VALUES ('{USER}', '{current}')")


def _sessions(url: str) -> list[str]:
    out = _psql(url, f"SELECT id FROM auth.sessions WHERE user_id = '{USER}' ORDER BY id")
    return out.split("\n") if out else []


def _current(url: str) -> str:
    return _psql(url, f"SELECT session_id FROM public.learner_active_sessions WHERE user_id = '{USER}'")


async def _until_waiting_on_account_lock(engine, count: int = 1) -> None:
    from sqlalchemy import text
    for _ in range(100):
        async with engine.connect() as conn:
            waiting = (await conn.execute(text(
                "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND classid = 388 AND NOT granted"
            ))).scalar()
        if waiting >= count:
            return
        await asyncio.sleep(0.05)
    raise AssertionError("nobody waited for the account lock")


async def _raw(url: str):
    import asyncpg
    return await asyncpg.connect(url)


def test_start_first_the_claim_waits_sees_the_work_and_keeps_the_exam_session(wired):
    url, run = wired
    _seed(url, S_A, [S_A, S_B])

    async def scenario(state):
        starter = await _raw(url)
        try:
            tx = starter.transaction()
            await tx.start()
            await starter.execute(f"INSERT INTO public.reading_test_attempts (user_id) VALUES ('{USER}')")
            claim = asyncio.create_task(session_gate.claim(USER, _token(S_B)))
            await _until_waiting_on_account_lock(state["engine"])
            assert not claim.done()
            await tx.commit()
            with pytest.raises(HTTPException) as refused:
                await claim
            return refused.value
        finally:
            await starter.close()

    refused = run(scenario)
    assert refused.status_code == 409 and refused.detail["error_code"] == "timed_activity_in_progress"
    assert _sessions(url) == [S_A, S_B]   # the device in the test is still signed in
    assert _current(url) == S_A


def test_claim_first_the_start_waits_and_is_refused(wired):
    url, run = wired
    _seed(url, S_A, [S_A, S_B])

    async def scenario(state):
        import asyncpg
        state["pause"] = pause = _Pause()
        claim = asyncio.create_task(session_gate.claim(USER, _token(S_B)))
        await pause.entered.wait()           # claim holds the lock, has not looked yet
        starter = await _raw(url)
        try:
            start = asyncio.create_task(starter.execute(
                f"INSERT INTO public.reading_test_attempts (user_id) VALUES ('{USER}')"))
            await _until_waiting_on_account_lock(state["engine"])
            pause.release.set()
            result = await claim
            with pytest.raises(asyncpg.PostgresError) as refused:
                await start
            return result, refused.value
        finally:
            await starter.close()

    result, refused = run(scenario)
    assert result == {"enabled": True, "state": "current", "revoked": 1}
    assert "learner_session_changed_during_timed_start" in str(refused)
    assert _psql(url, "SELECT count(*) FROM public.reading_test_attempts") == "0"  # no work began
    assert _sessions(url) == [S_B] and _current(url) == S_B


def test_two_claims_at_once_exactly_one_wins(wired):
    url, run = wired
    _seed(url, S_C, [S_A, S_B, S_C])

    async def scenario(state):
        state["pause"] = pause = _Pause()
        first = asyncio.create_task(session_gate.claim(USER, _token(S_A)))
        await pause.entered.wait()           # S_A holds the lock
        second = asyncio.create_task(session_gate.claim(USER, _token(S_B)))
        await _until_waiting_on_account_lock(state["engine"])
        pause.release.set()
        return await asyncio.gather(first, second, return_exceptions=True)

    first, second = run(scenario)
    assert first == {"enabled": True, "state": "current", "revoked": 2}
    assert isinstance(second, HTTPException) and second.status_code == 401
    assert second.detail["error_code"] == "session_displaced"
    assert _sessions(url) == [S_A] and _current(url) == S_A   # the loser deleted nothing
