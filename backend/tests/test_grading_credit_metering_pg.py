"""COURSEACCESS-0055 G04-T07 against the real credit RPCs (migration 384).

The route helpers of routers/grading.py (``_reserve_speaking_credit``,
``_commit_credit_hold``) run with ``credits._rpc`` sent to fn_credit_* in a
disposable PostgreSQL schema (the harness of test_migration_384), so the
ledger is the real one. Two review findings on 68a027c0:

* Codex P2 / CR: a hold released after an STT 502 must not turn the retry of
  the same recording into 409 ``request_key_conflict``.
* Andy: a Speaking cluster in which one answer was graded and saved must cost
  exactly one credit, even when the cluster opener fails afterwards.
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

_UUID_PARAMS = {"p_user_id", "p_reservation_id"}


@pytest.fixture
def real_rpc(pg, monkeypatch):  # noqa: F811
    """Route credits._rpc and the request-key lookup to the harness schema."""

    async def rpc(name, params):
        names = list(params)
        args = [UUID(str(params[n])) if n in _UUID_PARAMS and params[n] is not None else params[n]
                for n in names]
        if "p_course_ids" in params and params["p_course_ids"] is not None:
            args[names.index("p_course_ids")] = [UUID(c) for c in params["p_course_ids"]]
        sql = ", ".join(f"{n} => ${i}" for i, n in enumerate(names, 1))
        return credits._unwrap(json.loads(await pg.con.fetchval(f"SELECT {name}({sql})", *args)))

    async def key_state(user_id, request_key):
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


@pytest.mark.asyncio
@pytest.mark.parametrize("part", [2, 1])
async def test_stt_failure_then_retry_of_the_same_recording_spends_one_credit(real_rpc, part):
    pg = real_rpc
    user = await pg.user()
    await pg.entitlement(user, await pg.product(), credits=3)
    sid, question, submission = await pg.session(user), uuid4(), str(uuid4())
    before = await pg.balance(user)

    first = await grading._reserve_speaking_credit(str(user), _PLAN, str(sid), str(question), part, submission)
    await credits.release_if_open(first, "stt_failed")            # Whisper 502
    retry = await grading._reserve_speaking_credit(str(user), _PLAN, str(sid), str(question), part, submission)
    assert retry.reservation_id != first.reservation_id and not retry.covered
    await grading._commit_credit_hold(retry)

    assert before - await pg.balance(user) == 1
    _rows, net = await _ledger(pg)
    assert net == -1
    keys = await pg.con.fetch("SELECT request_key, status FROM credit_reservations ORDER BY created_at")
    assert [(k["request_key"], k["status"]) for k in keys] == [
        (submission, "released"), (f"{submission}:a1", "committed")]
    # Sending it once more: a committed attempt is already graded, never a new charge.
    with pytest.raises(credits.CreditReplay) as replay:
        await grading._reserve_speaking_credit(str(user), _PLAN, str(sid), str(question), part, submission)
    assert replay.value.code == "already_graded"


@pytest.mark.asyncio
async def test_released_key_reused_for_another_question_stays_a_conflict(real_rpc):
    pg = real_rpc
    user = await pg.user()
    await pg.entitlement(user, await pg.product(), credits=3)
    sid, submission = await pg.session(user), str(uuid4())
    first = await grading._reserve_speaking_credit(str(user), _PLAN, str(sid), str(uuid4()), 2, submission)
    await credits.release_if_open(first, "stt_failed")
    with pytest.raises(credits.CreditRefused) as refused:
        await grading._reserve_speaking_credit(str(user), _PLAN, str(sid), str(uuid4()), 2, submission)
    assert refused.value.code == "request_key_conflict"


async def _covered_answer(pg, user, sid, question, key):
    """Reserve + settle like the route does before Whisper."""
    hold = await grading._reserve_speaking_credit(str(user), _PLAN, sid, question, 1, key)
    return await grading._secure_covered_hold(hold, str(user), _PLAN, sid, question, 1, key)


@pytest.mark.asyncio
async def test_overlapping_cluster_answers_opener_fails_after_the_cover_commit(real_rpc):
    """Andy's case: answer 2 is covered by the opener's open hold and commits
    it before Whisper; the opener then fails. One credit, nothing refunded."""
    pg = real_rpc
    user = await pg.user()
    await pg.entitlement(user, await pg.product(), credits=3)
    sid = str(await pg.session(user))
    before = await pg.balance(user)

    opener = await grading._reserve_speaking_credit(str(user), _PLAN, sid, str(uuid4()), 1, str(uuid4()))
    second = await _covered_answer(pg, user, sid, str(uuid4()), str(uuid4()))
    assert second.covered and second.reservation_id == opener.reservation_id
    await credits.release_if_open(opener, "grader_failed")      # opener fails afterwards
    await grading._commit_credit_hold(second)                  # answer 2 saved: no-op

    assert before - await pg.balance(user) == 1
    rows, net = await _ledger(pg)
    assert rows == [("reserve", -1)] and net == -1


@pytest.mark.asyncio
@pytest.mark.parametrize("order", ["cover_first", "valid_charge_first"])
async def test_last_credit_with_a_valid_charge_alongside(real_rpc, order):
    """Minimum balance (1 credit). The opener holds it; answer 2 is covered;
    the opener fails; a valid Part 2 answer wants a credit too. Whatever the
    order, exactly one credit is spent and no saved grade goes unpaid."""
    pg = real_rpc
    user = await pg.user()
    await pg.entitlement(user, await pg.product(), credits=1)
    sid = str(await pg.session(user))
    opener = await grading._reserve_speaking_credit(str(user), _PLAN, sid, str(uuid4()), 1, str(uuid4()))
    q2, k2 = str(uuid4()), str(uuid4())

    if order == "cover_first":
        second = await _covered_answer(pg, user, sid, q2, k2)       # commits the cover
        await credits.release_if_open(opener, "grader_failed")      # nothing to refund
        with pytest.raises(credits.CreditRefused) as refused:       # Part 2: no credit left
            await grading._reserve_speaking_credit(str(user), _PLAN, sid, str(uuid4()), 2, str(uuid4()))
        assert refused.value.code == "insufficient_credits"
        assert second.covered
    else:
        first = await grading._reserve_speaking_credit(str(user), _PLAN, sid, q2, 1, k2)
        assert first.covered
        await credits.release_if_open(opener, "grader_failed")      # credit back (1)
        part2 = await grading._reserve_speaking_credit(str(user), _PLAN, sid, str(uuid4()), 2, str(uuid4()))
        await grading._commit_credit_hold(part2)                    # the valid charge
        with pytest.raises(credits.CreditRefused) as refused:       # answer 2: 402 before Whisper
            await grading._secure_covered_hold(first, str(user), _PLAN, sid, q2, 1, k2)
        assert refused.value.code == "insufficient_credits"

    assert await pg.balance(user) == 0
    _rows, net = await _ledger(pg)
    assert net == -1
    assert await pg.con.fetchval("SELECT count(*) FROM credit_reservations WHERE status = 'committed'") == 1


@pytest.mark.asyncio
async def test_covered_answer_after_the_opener_failed_opens_the_cluster(real_rpc):
    pg = real_rpc
    user = await pg.user()
    await pg.entitlement(user, await pg.product(), credits=3)
    sid = str(await pg.session(user))
    before = await pg.balance(user)

    opener = await grading._reserve_speaking_credit(str(user), _PLAN, sid, str(uuid4()), 1, str(uuid4()))
    q2, k2 = str(uuid4()), str(uuid4())
    first = await grading._reserve_speaking_credit(str(user), _PLAN, sid, q2, 1, k2)
    assert first.covered
    await credits.release_if_open(opener, "grader_failed")      # opener fails first
    second = await grading._secure_covered_hold(first, str(user), _PLAN, sid, q2, 1, k2)
    assert not second.covered                                  # its own hold, key ':c'
    await grading._commit_credit_hold(second)                  # answer 2 saved

    assert before - await pg.balance(user) == 1
    _rows, net = await _ledger(pg)
    assert net == -1
    assert await pg.con.fetchval(
        "SELECT count(*) FROM credit_reservations WHERE status = 'committed' AND request_key = $1",
        f"{k2}:c") == 1


@pytest.mark.asyncio
async def test_covered_answer_retried_after_a_failure_is_a_regrade_not_409(real_rpc):
    """The covered answer committed the cover, then Whisper failed. Its key
    now reads already_committed; the retry of the same recording re-grades
    under '<key>:a1' (free re-grade), no second credit."""
    pg = real_rpc
    user = await pg.user()
    await pg.entitlement(user, await pg.product(), credits=3)
    sid = str(await pg.session(user))
    before = await pg.balance(user)
    await grading._reserve_speaking_credit(str(user), _PLAN, sid, str(uuid4()), 1, str(uuid4()))   # opener
    q2, k2 = str(uuid4()), str(uuid4())
    await _covered_answer(pg, user, sid, q2, k2)                   # cover committed, then STT 502
    retry = await _covered_answer(pg, user, sid, q2, k2)
    assert retry.covered
    assert before - await pg.balance(user) == 1
    assert await pg.con.fetchval("SELECT count(*) FROM credit_covered_requests WHERE request_key = $1",
                                 f"{k2}:a1") == 1
