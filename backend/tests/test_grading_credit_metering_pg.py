"""COURSEACCESS-0055 G04-T07 against the real credit RPCs (migrations 384 + 503).

The route helpers of routers/grading.py (``_reserve_speaking_credit``,
``_settle_speaking_attempt``) run with ``credits._rpc`` sent to fn_credit_* in
a disposable PostgreSQL schema (the 384 harness plus 503), so the ledger is
the real one. Review findings on #2554:

* Codex P2 / CR: a hold released after an STT 502 must not turn the retry of
  the same recording into 409 ``request_key_conflict``.
* Andy 68a027c0 / f8170c8e: a Speaking cluster in which one answer was graded
  and saved costs exactly one credit, even when the cluster opener fails.
* Andy 11:18Z (FR-015): a cluster in which every answer fails costs nothing.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from routers import grading  # noqa: E402
from services import credits  # noqa: E402
from test_migration_384_credit_ledger_enrollment_rpcs import _url, pg  # noqa: E402,F401 — fixture
from test_migration_503_credit_attempt_settle import pg503  # noqa: E402,F401 — fixture

_UUID_PARAMS = {"p_user_id", "p_reservation_id"}


@pytest.fixture
def real_rpc(pg503, monkeypatch):  # noqa: F811
    """Route credits._rpc and the request-key lookup to the harness schema."""

    async def rpc(name, params):
        names = list(params)
        args = [UUID(str(params[n])) if n in _UUID_PARAMS and params[n] is not None else params[n]
                for n in names]
        if "p_course_ids" in params and params["p_course_ids"] is not None:
            args[names.index("p_course_ids")] = [UUID(c) for c in params["p_course_ids"]]
        sql = ", ".join(f"{n} => ${i}" for i, n in enumerate(names, 1))
        return credits._unwrap(json.loads(await pg.con.fetchval(f"SELECT {name}({sql})", *args)))

    pg = pg503

    async def key_state(user_id, request_key):
        outcome = await pg.con.fetchval(
            "SELECT outcome FROM credit_attempt_outcomes WHERE user_id = $1 AND request_key = $2",
            UUID(user_id), request_key)
        state = await _key_row(user_id, request_key)
        return state and {**state, "outcome": outcome}

    async def _key_row(user_id, request_key):
        row = await pg.con.fetchrow(
            "SELECT resource_type, resource_id, status FROM credit_reservations "
            "WHERE user_id = $1 AND feature = 'speaking_grading' AND request_key = $2",
            UUID(user_id), request_key)
        if row:
            return dict(row)
        row = await pg.con.fetchrow(
            "SELECT c.resource_type, c.resource_id, r.status FROM credit_covered_requests c "
            "JOIN credit_reservations r ON r.id = c.reservation_id "
            "WHERE c.user_id = $1 AND c.feature = 'speaking_grading' AND c.request_key = $2",
            UUID(user_id), request_key)
        return {**dict(row), "covered": True} if row else None

    def fetch_reservation(reservation_id):
        # credits reads this in a worker thread (paid re-grade replay check):
        # give that thread its own loop and connection to the harness schema.
        async def read():
            con = await asyncpg.connect(_url())
            try:
                await con.execute(f"SET search_path = {pg.schema}, pg_catalog")
                row = await con.fetchrow("SELECT user_id::text, resource_type, resource_id, status "
                                         "FROM credit_reservations WHERE id = $1", UUID(str(reservation_id)))
                return dict(row) if row else None
            finally:
                await con.close()
        return asyncio.run(read())

    monkeypatch.setattr(credits, "_rpc", rpc)
    monkeypatch.setattr(credits, "fetch_reservation", fetch_reservation)
    monkeypatch.setattr(grading, "_request_key_state", key_state)
    return pg


async def _ledger(pg):  # noqa: F811
    rows = await pg.con.fetch("SELECT reason, delta FROM credit_ledger WHERE reason IN ('reserve', 'release')")
    return sorted((r["reason"], r["delta"]) for r in rows), sum(r["delta"] for r in rows)


_PLAN = credits.ChargePlan(True, "entitlement")


async def _reserve(user, sid, question, part, key):
    return await grading._reserve_speaking_credit(str(user), _PLAN, str(sid), str(question), part, key)


async def _graded(hold):
    await grading._settle_speaking_attempt(hold, "graded")


async def _failed(hold, reason="grader_failed"):
    await grading._settle_speaking_attempt(hold, "failed", reason)


@pytest.mark.asyncio
@pytest.mark.parametrize("part", [2, 1])
async def test_stt_failure_then_retry_of_the_same_recording_spends_one_credit(real_rpc, part):
    pg = real_rpc
    user = await pg.user()
    await pg.entitlement(user, await pg.product(), credits=3)
    sid, question, submission = await pg.session(user), uuid4(), str(uuid4())
    before = await pg.balance(user)

    first = await _reserve(user, sid, question, part, submission)
    await _failed(first, "stt_failed")                         # Whisper 502
    retry = await _reserve(user, sid, question, part, submission)
    assert retry.reservation_id != first.reservation_id and not retry.covered
    await _graded(retry)

    assert before - await pg.balance(user) == 1
    _rows, net = await _ledger(pg)
    assert net == -1
    keys = await pg.con.fetch("SELECT request_key, status FROM credit_reservations ORDER BY created_at")
    assert [(k["request_key"], k["status"]) for k in keys] == [
        (submission, "released"), (f"{submission}:a1", "committed")]
    # Sending it once more: a graded attempt is already graded, never a new charge.
    with pytest.raises(credits.CreditReplay) as replay:
        await _reserve(user, sid, question, part, submission)
    assert replay.value.code == "already_graded"


@pytest.mark.asyncio
async def test_released_key_reused_for_another_question_stays_a_conflict(real_rpc):
    pg = real_rpc
    user = await pg.user()
    await pg.entitlement(user, await pg.product(), credits=3)
    sid, submission = await pg.session(user), str(uuid4())
    first = await _reserve(user, sid, uuid4(), 2, submission)
    await _failed(first, "stt_failed")
    with pytest.raises(credits.CreditRefused) as refused:
        await _reserve(user, sid, uuid4(), 2, submission)
    assert refused.value.code == "request_key_conflict"


@pytest.mark.asyncio
@pytest.mark.parametrize("opener_first", [True, False])
async def test_whole_cluster_failing_leaves_the_balance_unchanged(real_rpc, opener_first):
    """CR ledger case 1 (Andy 11:18Z, FR-015): no grade saved, balance unchanged."""
    pg = real_rpc
    user = await pg.user()
    await pg.entitlement(user, await pg.product(), credits=3)
    sid = await pg.session(user)
    before = await pg.balance(user)
    opener = await _reserve(user, sid, uuid4(), 1, str(uuid4()))
    second = await _reserve(user, sid, uuid4(), 1, str(uuid4()))
    assert second.covered and second.reservation_id == opener.reservation_id
    for hold in ((opener, second) if opener_first else (second, opener)):
        await _failed(hold)

    assert await pg.balance(user) == before
    rows, net = await _ledger(pg)
    assert rows == [("release", 1), ("reserve", -1)] and net == 0


@pytest.mark.asyncio
async def test_opener_fails_while_the_covered_answer_runs_then_it_saves(real_rpc):
    """CR ledger case 2: exactly one credit, nothing refunded."""
    pg = real_rpc
    user = await pg.user()
    await pg.entitlement(user, await pg.product(), credits=3)
    sid = await pg.session(user)
    before = await pg.balance(user)
    opener = await _reserve(user, sid, uuid4(), 1, str(uuid4()))
    second = await _reserve(user, sid, uuid4(), 1, str(uuid4()))
    assert second.covered
    await _failed(opener)                                      # pending: answer 2 still grading
    assert await pg.con.fetchval("SELECT status FROM credit_reservations") == "open"
    await _graded(second)                                      # answer 2 saved: commits the cluster

    assert before - await pg.balance(user) == 1
    rows, net = await _ledger(pg)
    assert rows == [("reserve", -1)] and net == -1


@pytest.mark.asyncio
async def test_overlapping_cluster_answers_opener_fails_after_the_save(real_rpc):
    """Andy 68a027c0: answer 2 is saved first, the opener fails afterwards."""
    pg = real_rpc
    user = await pg.user()
    await pg.entitlement(user, await pg.product(), credits=3)
    sid = await pg.session(user)
    before = await pg.balance(user)
    opener = await _reserve(user, sid, uuid4(), 1, str(uuid4()))
    second = await _reserve(user, sid, uuid4(), 1, str(uuid4()))
    await _graded(second)
    await _failed(opener)

    assert before - await pg.balance(user) == 1
    rows, net = await _ledger(pg)
    assert rows == [("reserve", -1)] and net == -1


@pytest.mark.asyncio
async def test_last_credit_with_a_valid_charge_alongside(real_rpc):
    """Andy f8170c8e: minimum balance (1 credit). The opener holds it; answer
    2 is covered; the opener fails; a valid Part 2 answer wants a credit too.
    Answer 2 keeps the cluster's credit held, so Part 2 is 402 before any
    paid call and answer 2's saved grade is paid: one credit, none free."""
    pg = real_rpc
    user = await pg.user()
    await pg.entitlement(user, await pg.product(), credits=1)
    sid = await pg.session(user)
    opener = await _reserve(user, sid, uuid4(), 1, str(uuid4()))
    second = await _reserve(user, sid, uuid4(), 1, str(uuid4()))
    assert second.covered
    await _failed(opener)                                      # credit stays held for answer 2
    with pytest.raises(credits.CreditRefused) as refused:
        await _reserve(user, sid, uuid4(), 2, str(uuid4()))
    assert refused.value.code == "insufficient_credits"
    await _graded(second)

    assert await pg.balance(user) == 0
    _rows, net = await _ledger(pg)
    assert net == -1
    assert await pg.con.fetchval("SELECT count(*) FROM credit_reservations WHERE status = 'committed'") == 1


@pytest.mark.asyncio
async def test_answer_after_the_whole_cluster_failed_opens_a_new_hold(real_rpc):
    pg = real_rpc
    user = await pg.user()
    await pg.entitlement(user, await pg.product(), credits=3)
    sid = await pg.session(user)
    before = await pg.balance(user)
    opener = await _reserve(user, sid, uuid4(), 1, str(uuid4()))
    await _failed(opener)                                      # alone: released
    second = await _reserve(user, sid, uuid4(), 1, str(uuid4()))
    assert not second.covered and second.reservation_id != opener.reservation_id
    await _graded(second)

    assert before - await pg.balance(user) == 1
    _rows, net = await _ledger(pg)
    assert net == -1


@pytest.mark.asyncio
async def test_failed_covered_answer_retried_while_the_opener_runs(real_rpc):
    """The covered answer failed while the opener still grades: its key reads
    'replay' (hold open) but its outcome is failed, so the retry of the same
    recording re-grades under '<key>:a1', covered by the same hold."""
    pg = real_rpc
    user = await pg.user()
    await pg.entitlement(user, await pg.product(), credits=3)
    sid = await pg.session(user)
    before = await pg.balance(user)
    opener = await _reserve(user, sid, uuid4(), 1, str(uuid4()))
    q2, k2 = uuid4(), str(uuid4())
    first = await _reserve(user, sid, q2, 1, k2)
    await _failed(first, "stt_failed")
    retry = await _reserve(user, sid, q2, 1, k2)
    assert retry.covered and retry.reservation_id == opener.reservation_id
    assert retry.request_key == f"{k2}:a1"
    await _failed(opener)                                      # the retry still runs: pending
    await _graded(retry)

    assert before - await pg.balance(user) == 1
    _rows, net = await _ledger(pg)
    assert net == -1


@pytest.mark.asyncio
async def test_running_attempt_resent_is_in_progress(real_rpc):
    pg = real_rpc
    user = await pg.user()
    await pg.entitlement(user, await pg.product(), credits=3)
    sid = await pg.session(user)
    await _reserve(user, sid, uuid4(), 1, str(uuid4()))       # opener
    q2, k2 = uuid4(), str(uuid4())
    await _reserve(user, sid, q2, 1, k2)                       # still grading
    with pytest.raises(credits.CreditReplay) as replay:
        await _reserve(user, sid, q2, 1, k2)
    assert replay.value.code == "grading_in_progress"


@pytest.mark.asyncio
async def test_covered_answer_failing_three_times_while_the_opener_runs_costs_one_credit(real_rpc):
    """CR+SA on 1f58dedf (reproduced on PG16): retries of a failed covered
    answer while the cluster is pending must not become re-grades, the third
    of which was a paid one. Route keys: '<sid>', ':a1', ':a2', ':a3'."""
    pg = real_rpc
    user = await pg.user()
    await pg.entitlement(user, await pg.product(), credits=3)
    sid = await pg.session(user)
    before = await pg.balance(user)
    opener = await _reserve(user, sid, uuid4(), 1, str(uuid4()))
    q2, k2 = uuid4(), str(uuid4())
    for attempt in range(3):
        hold = await _reserve(user, sid, q2, 1, k2)
        assert hold.covered and hold.reservation_id == opener.reservation_id, attempt
        await _failed(hold, "stt_failed")
    last = await _reserve(user, sid, q2, 1, k2)
    assert last.covered and last.request_key == f"{k2}:a3"
    await _graded(last)
    await _failed(opener)

    assert before - await pg.balance(user) == 1
    rows, net = await _ledger(pg)
    assert rows == [("reserve", -1)] and net == -1
