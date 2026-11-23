"""COURSEACCESS-0055 T007 (G04-T07, FR-015): migration 503, per-attempt credit settlement.

Static checks read the SQL; the PostgreSQL checks apply 383, 384 and 503
verbatim (``public.`` rewritten to a throwaway schema) on a LOCAL disposable
cluster through the 384 harness: set TEST_PG_URL, and REQUIRE_PG=1 to forbid
skips. The race check opens two connections and repeats 20 times.
"""
import asyncio
import re
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg
import pytest
import pytest_asyncio

from test_migration_384_credit_ledger_enrollment_rpcs import _body, pg  # noqa: F401 — fixture

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
NAME = "503_credit_attempt_settle.sql"
FORWARD = (MIGRATIONS / NAME).read_text(encoding="utf-8")
ROLLBACK = (MIGRATIONS / "rollback" / NAME).read_text(encoding="utf-8")
RPC = "fn_credit_settle_attempt(uuid,text,text,text)"


def _policy_row():
    rows = [line.split("\t") for line in (MIGRATIONS / "forward-policy.tsv").read_text(encoding="utf-8").splitlines()
            if line.startswith(NAME)]
    assert len(rows) == 1
    return rows[0]


# ── Static ──────────────────────────────────────────────────────────────────

def test_one_transaction_one_definer_rpc_service_role_only():
    body = _body(FORWARD)
    assert body.count("BEGIN;") == 1 and body.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s'" in body
    assert "SET LOCAL search_path = pg_catalog, pg_temp" in body
    assert re.findall(r"CREATE OR REPLACE FUNCTION public\.(\w+)\(", body) == ["fn_credit_settle_attempt"]
    header = body.split("CREATE OR REPLACE FUNCTION ", 1)[1].split("AS $$", 1)[0]
    assert "SECURITY DEFINER" in header and "SET search_path = pg_catalog, pg_temp" in header
    assert "REVOKE ALL ON FUNCTION public.fn_credit_settle_attempt(uuid, text, text, text)" in body
    assert "GRANT EXECUTE ON FUNCTION public.fn_credit_settle_attempt(uuid, text, text, text) TO service_role" in body
    assert "GRANT SELECT ON public.credit_attempt_outcomes TO service_role" in body
    # The user's credit lock, the same as fn_credit_reserve; session-free only.
    assert "PERFORM public.fn_credit_lock_user(v_user)" in body and "pg_advisory_lock(" not in body


def test_no_seed_no_change_to_existing_objects():
    body = _body(FORWARD)
    assert not re.search(r"\bINSERT INTO public\.(?!credit_attempt_outcomes\b)", body)
    assert not re.search(r"\b(ALTER TABLE|DROP)\s+(?!.*credit_attempt_outcomes)", body.replace(
        "ALTER TABLE public.credit_attempt_outcomes ENABLE ROW LEVEL SECURITY", ""))
    assert re.findall(r"CREATE OR REPLACE TRIGGER (\w+)", body) == [
        "trg_credit_attempt_outcomes_append_only", "trg_credit_attempt_outcomes_no_truncate"]


def test_rollback_drops_only_the_rpc_and_keeps_the_table():
    body = _body(ROLLBACK)
    assert "DROP FUNCTION IF EXISTS public.fn_credit_settle_attempt(uuid, text, text, text);" in body
    assert "DROP TABLE" not in body and "DROP INDEX" not in body


def test_register_and_forward_policy_rows():
    register = [line.split("\t") for line in (MIGRATIONS / "register.tsv").read_text(encoding="utf-8").splitlines()
                if line.startswith("503\t")]
    assert register and register[0][1:5] == [NAME, "present", "G04-T07", "COURSEACCESS-0055"]
    row = _policy_row()
    assert row[1:3] == ["pending_feature", "credit_attempt_settle"]
    assert "No apply on merge" in row[3]


# ── PostgreSQL ──────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def pg503(pg):  # noqa: F811
    await pg.con.execute(pg.sql(FORWARD))
    await pg.con.execute(pg.sql(FORWARD))       # re-runnable
    return pg


def _u(value):
    return UUID(str(value))


async def _settle(pg, reservation, key, outcome, reason=None, con=None):
    if outcome == "failed" and reason is None:
        reason = "grader_failed"
    return await pg.rpc("fn_credit_settle_attempt", _u(reservation), key, outcome, reason, con=con)


async def _cluster(pg, credits=3):
    user = await pg.user()
    await pg.entitlement(user, await pg.product(), credits=credits)
    sid = await pg.session(user)
    key = uuid4().hex
    opener = await pg.reserve(user, "speaking_cluster", f"{sid}:p1:q{uuid4()}", key=key)
    assert opener["status"] == "reserved"
    return user, sid, opener["reservation_id"], key


async def _covered(pg, user, sid, con=None):
    key = uuid4().hex
    result = await pg.reserve(user, "speaking_cluster", f"{sid}:p1:q{uuid4()}", key=key, con=con)
    return result, key


async def _net(pg, user):
    return await pg.con.fetchval(
        "SELECT coalesce(sum(delta), 0) FROM credit_ledger WHERE user_id = $1 AND reason IN ('reserve', 'release')",
        user)


async def _status(pg, reservation):
    return await pg.con.fetchval("SELECT status FROM credit_reservations WHERE id = $1", _u(reservation))


@pytest.mark.asyncio
async def test_table_and_rpc_are_backend_only_and_append_only(pg503):
    pg = pg503
    con = pg.con
    table, rpc = f"{pg.schema}.credit_attempt_outcomes", f"{pg.schema}.{RPC}"
    assert await con.fetchval("SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass", table)
    for role in ("anon", "authenticated"):
        assert not await con.fetchval("SELECT has_table_privilege($1, $2, 'SELECT')", role, table)
        assert not await con.fetchval("SELECT has_function_privilege($1, $2, 'EXECUTE')", role, rpc)
    assert await con.fetchval("SELECT has_table_privilege('service_role', $1, 'SELECT')", table)
    assert not await con.fetchval("SELECT has_table_privilege('service_role', $1, 'INSERT')", table)
    assert await con.fetchval("SELECT has_function_privilege('service_role', $1, 'EXECUTE')", rpc)
    user, _sid, hold, key = await _cluster(pg)
    await _settle(pg, hold, key, "failed")
    for statement in ("UPDATE credit_attempt_outcomes SET outcome = 'graded'", "DELETE FROM credit_attempt_outcomes",
                      "TRUNCATE credit_attempt_outcomes"):
        with pytest.raises(asyncpg.RaiseError, match="append_only"):
            await con.execute(statement)


@pytest.mark.asyncio
async def test_single_attempt_graded_commits_failed_releases(pg503):
    pg = pg503
    user = await pg.user()
    await pg.entitlement(user, await pg.product(), credits=2)
    sid = await pg.session(user)
    a = await pg.reserve(user, "speaking_response", f"{sid}:{uuid4()}", key="k-graded-1")
    b = await pg.reserve(user, "speaking_response", f"{sid}:{uuid4()}", key="k-failed-1")
    assert (await _settle(pg, a["reservation_id"], "k-graded-1", "graded"))["status"] == "committed"
    assert (await _settle(pg, a["reservation_id"], "k-graded-1", "graded"))["status"] == "already_committed"
    assert (await _settle(pg, b["reservation_id"], "k-failed-1", "failed", "stt_failed"))["status"] == "released"
    assert (await _settle(pg, b["reservation_id"], "k-failed-1", "failed", "stt_failed"))["status"] == "not_open"
    assert await pg.con.fetchval("SELECT release_reason FROM credit_reservations WHERE id = $1",
                                 _u(b["reservation_id"])) == "stt_failed"
    assert await _net(pg, user) == -1


@pytest.mark.asyncio
async def test_whole_cluster_failing_refunds_once(pg503):
    """CR ledger case 1: opener and covered answer both fail; balance unchanged."""
    pg = pg503
    user, sid, hold, opener_key = await _cluster(pg)
    before = await pg.balance(user) + 1
    covered, key2 = await _covered(pg, user, sid)
    assert covered["status"] == "covered" and covered["reservation_id"] == hold
    assert (await _settle(pg, hold, opener_key, "failed"))["status"] == "pending"
    assert await _status(pg, hold) == "open"
    assert (await _settle(pg, hold, key2, "failed", "stt_failed"))["status"] == "released"
    assert await pg.balance(user) == before and await _net(pg, user) == 0


@pytest.mark.asyncio
async def test_opener_fails_while_covered_runs_then_it_saves(pg503):
    """CR ledger case 2: exactly one credit."""
    pg = pg503
    user, sid, hold, opener_key = await _cluster(pg)
    _covered_result, key2 = await _covered(pg, user, sid)
    assert (await _settle(pg, hold, opener_key, "failed"))["status"] == "pending"
    assert (await _settle(pg, hold, key2, "graded"))["status"] == "committed"
    assert await _net(pg, user) == -1
    # A third answer joins the committed cluster and its failure refunds nothing.
    third, key3 = await _covered(pg, user, sid)
    assert third["status"] == "covered"
    assert (await _settle(pg, hold, key3, "failed"))["status"] == "already_committed"
    assert await _net(pg, user) == -1


@pytest.mark.asyncio
async def test_first_outcome_of_an_attempt_stands_and_strangers_are_refused(pg503):
    pg = pg503
    user, sid, hold, opener_key = await _cluster(pg)
    _c, key2 = await _covered(pg, user, sid)
    await _settle(pg, hold, key2, "failed")
    await _settle(pg, hold, key2, "graded")        # a stale duplicate: recorded once, still commits
    rows = await pg.con.fetch("SELECT request_key, outcome FROM credit_attempt_outcomes")
    assert [tuple(r) for r in rows] == [(key2, "failed")]
    assert await _status(pg, hold) == "committed"
    assert (await _settle(pg, hold, "someone-elses-key", "failed"))["status"] == "not_participant"
    assert (await _settle(pg, uuid4(), opener_key, "failed"))["status"] == "not_found"
    for outcome, reason in (("graded", "stt_failed"), ("failed", None), ("failed", "expired"), ("done", None)):
        with pytest.raises(asyncpg.InvalidParameterValueError, match="credit_settle_attempt_invalid_argument"):
            await pg.rpc("fn_credit_settle_attempt", _u(hold), opener_key, outcome, reason)


@pytest.mark.asyncio
async def test_expired_hold_is_not_open_for_a_late_grade(pg503):
    pg = pg503
    user, _sid, hold, opener_key = await _cluster(pg)
    await pg.con.execute("ALTER TABLE credit_reservations DISABLE TRIGGER USER")
    await pg.con.execute("UPDATE credit_reservations SET expires_at = now() - interval '1 minute'")
    await pg.con.execute("ALTER TABLE credit_reservations ENABLE TRIGGER USER")
    assert (await pg.rpc("fn_credit_expire_reservations", 10))["expired"] == 1
    result = await _settle(pg, hold, opener_key, "graded")
    assert result["status"] == "not_open" and result["reservation_status"] == "expired"
    assert await _net(pg, user) == 0


@pytest.mark.asyncio
async def test_opener_failure_racing_a_new_covered_answer_never_loses_or_frees_a_credit(pg503):
    """The covered answer either joins the hold before the opener's failed
    settle (then the hold waits for it) or after the release (then it opens
    its own hold). Either way its saved grade costs exactly one credit."""
    pg = pg503
    a, b = await pg.connect(), await pg.connect()
    for _ in range(20):
        user, sid, hold, opener_key = await _cluster(pg)
        settled, (covered, key2) = await asyncio.gather(
            _settle(pg, hold, opener_key, "failed", con=a), _covered(pg, user, sid, con=b))
        if covered["status"] == "covered":
            assert covered["reservation_id"] == hold and settled["status"] == "pending"
        else:
            assert covered["status"] == "reserved" and settled["status"] == "released"
        assert (await _settle(pg, covered["reservation_id"], key2, "graded"))["status"] == "committed"
        assert await _net(pg, user) == -1
        assert await pg.con.fetchval(
            "SELECT count(*) FROM credit_reservations WHERE user_id = $1 AND status = 'committed'", user) == 1


@pytest.mark.asyncio
async def test_rollback_drops_the_rpc_and_keeps_the_rows(pg503):
    pg = pg503
    user, _sid, hold, opener_key = await _cluster(pg)
    await _settle(pg, hold, opener_key, "failed")
    await pg.con.execute(pg.sql(ROLLBACK))
    assert await pg.con.fetchval("SELECT to_regprocedure($1)", f"{pg.schema}.{RPC}") is None
    assert await pg.con.fetchval("SELECT count(*) FROM credit_attempt_outcomes") == 1
    await pg.con.execute(pg.sql(FORWARD))        # forward again after a rollback
    assert await pg.con.fetchval("SELECT to_regprocedure($1)", f"{pg.schema}.{RPC}") is not None
