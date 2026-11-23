"""COURSEACCESS-0055 T003 — services/credits.py: charge_plan order and the
reserve wrapper (plan 5.4)."""

from __future__ import annotations

import asyncio
import logging
from unittest.mock import MagicMock

import pytest

from services import credits, runtime_flags

COURSE = "11111111-1111-1111-1111-111111111111"
COHORT = "33333333-3333-3333-3333-333333333333"


@pytest.fixture
def world(monkeypatch):
    """A switchable world for charge_plan's reads."""
    state = {"flag": True, "flag_error": False, "cohort_course": COURSE, "item_cohort": COHORT,
             "ever_class": False, "converted": False, "legacy": (), "read_error": None}

    def flag(key, default=False):
        assert key == "credit_metering" and default is False
        if state["flag_error"]:
            raise runtime_flags.FlagLookupError(key)
        return state["flag"]

    def read(name, value):
        def fn(*_a):
            if state["read_error"] == name:
                raise RuntimeError(f"{name} down")
            return state[value]
        return fn

    monkeypatch.setattr(credits.runtime_flags, "is_enabled_strict", flag)
    monkeypatch.setattr(credits, "fetch_cohort_course", read("cohort", "cohort_course"))
    monkeypatch.setattr(credits, "fetch_class_item_cohort", read("item", "item_cohort"))
    monkeypatch.setattr(credits, "fetch_ever_had_class_entitlement", read("ever", "ever_class"))
    monkeypatch.setattr(credits, "fetch_cohort_converted", read("converted", "converted"))
    monkeypatch.setattr(credits, "fetch_legacy_code_features", read("legacy", "legacy"))
    monkeypatch.setattr(credits, "_metering_seen_on", False)
    return state


def plan(feature="speaking_grading", **kw):
    return credits.charge_plan("u1", feature, **kw)


# ── The six branches, in order ────────────────────────────────────────────


def test_1_flag_off_is_not_metered_and_logs_after_it_was_on(world, caplog):
    world["flag"] = False
    assert plan() == credits.ChargePlan(False, "flag_off")
    assert "flag_off" not in caplog.text
    world["flag"] = True
    plan()
    world["flag"] = False
    with caplog.at_level(logging.WARNING, logger="services.credits"):
        assert plan().reason == "flag_off"
    assert "[credits] flag_off user=u1 feature=speaking_grading" in caplog.text


def test_1_flag_read_error_is_unavailable_not_off(world):
    world["flag_error"] = True
    with pytest.raises(credits.CreditUnavailable):
        plan()


def test_2_trial_wins_over_everything_after_the_flag(world):
    world["legacy"] = ("speaking",)
    assert plan(trial=True, session={"sitting_id": "s"}) == credits.ChargePlan(False, "trial")


def test_3_mock_sitting(world):
    assert plan(session={"sitting_id": "sit", "class_assignment_item_id": "i"}).reason == "mock"


def test_4_class_work_with_a_class_entitlement_is_metered_for_that_course(world):
    world["ever_class"] = True  # also true after that entitlement expired (any status)
    result = plan(session={"class_assignment_item_id": "item-1"})
    assert result == credits.ChargePlan(True, "class", [COURSE], ["class", "repractice"])
    assert result.credit_source == "class"
    # Writing class work through the assignment's cohort.
    assert plan("writing_grading", assignment={"cohort_id": COHORT}).reason == "class"


def test_4_converted_class_is_metered_for_a_member_without_rows(world):
    world["converted"] = True
    assert plan(session={"class_assignment_item_id": "item-1"}).reason == "class"


def test_4_legacy_class_and_class_without_course_are_not_metered(world):
    assert plan(session={"class_assignment_item_id": "item-1"}) == credits.ChargePlan(False, "legacy_class")
    world["cohort_course"] = None
    assert plan(session={"class_assignment_item_id": "item-1"}).reason == "legacy_class"
    # A legacy code does not matter for class work: branch 4 decides.
    world["legacy"] = ("speaking",)
    assert plan(session={"class_assignment_item_id": "item-1"}).reason == "legacy_class"


@pytest.mark.parametrize("failing", ["item", "cohort", "ever", "converted"])
def test_4_read_error_is_unavailable(world, failing):
    world["read_error"] = failing
    with pytest.raises(credits.CreditUnavailable):
        plan(session={"class_assignment_item_id": "item-1"})


def test_5_legacy_code_for_the_skill(world):
    world["legacy"] = ("speaking",)
    assert plan() == credits.ChargePlan(False, "legacy_code")
    # A Speaking-only code does not make Writing free.
    assert plan("writing_grading") == credits.ChargePlan(True, "entitlement")


def test_5_read_error_is_unavailable(world):
    world["read_error"] = "legacy"
    with pytest.raises(credits.CreditUnavailable):
        plan()


def test_6_everything_else_spends_any_entitlement(world):
    result = plan("writing_grading")
    assert result == credits.ChargePlan(True, "entitlement")
    assert result.course_ids is None and result.kinds is None and result.credit_source == "online"


# ── New features are never free (C1 e) ────────────────────────────────────


@pytest.mark.parametrize("kw", [{"feature": "short_writing_feedback"},
                                {"feature": "writing_grading", "new_feature": True}])
def test_new_feature_never_free(world, kw):
    feature = kw.pop("feature")
    world["flag"] = False
    with pytest.raises(credits.CreditUnavailable):
        plan(feature, **kw)
    world["flag"] = True
    world["legacy"] = ("writing",)
    assert plan(feature, **kw).reason == "entitlement"
    assert plan(feature, assignment={"cohort_id": COHORT}, **kw).reason == "entitlement"
    assert plan(feature, trial=True, **kw).reason == "trial"
    assert plan(feature, session={"sitting_id": "s"}, **kw).reason == "mock"


def test_acharge_plan_matches(world):
    assert asyncio.run(credits.acharge_plan("u1", "speaking_grading", trial=True)).reason == "trial"


def test_unknown_feature_is_a_caller_bug(world):
    with pytest.raises(ValueError):
        plan("reading_grading")


# ── reserve: every non-reserved answer stops before the AI ────────────────


def _rpc_returning(monkeypatch, *answers):
    calls = []
    answers = list(answers)

    def rpc(name, params):
        calls.append((name, dict(params)))
        answer = answers.pop(0)
        query = MagicMock()
        if isinstance(answer, Exception):
            query.execute.side_effect = answer
        else:
            query.execute.return_value.data = answer
        return query

    client = MagicMock()
    client.rpc.side_effect = rpc
    monkeypatch.setattr(credits, "supabase_admin", client)
    return calls


def _reserve(**kw):
    args = dict(request_key="sub-12345678", resource_type="writing_essay",
                resource_id="44444444-4444-4444-4444-444444444444", ttl_seconds=600)
    return asyncio.run(credits.reserve("u1", "writing_grading", **{**args, **kw}))


def test_reserve_reserved_and_covered(monkeypatch):
    calls = _rpc_returning(monkeypatch, {"status": "reserved", "reservation_id": "r1", "entitlement_id": "e1",
                                         "balance_after": 4})
    hold = _reserve(course_ids=[COURSE], kinds=["class", "repractice"])
    assert (hold.reservation_id, hold.covered, hold.balance_after) == ("r1", False, 4)
    name, params = calls[0]
    assert name == "fn_credit_reserve" and params["p_cost"] == 1 and params["p_course_ids"] == [COURSE]
    _rpc_returning(monkeypatch, [{"status": "covered", "reservation_id": "r0"}])  # list of one row
    hold = _reserve()
    assert hold.covered is True
    asyncio.run(hold.commit())
    asyncio.run(hold.release("grader_failed"))  # no-ops: no RPC left to answer


@pytest.mark.parametrize("answer,exc,code,status", [
    ({"status": "replay"}, credits.CreditReplay, "grading_in_progress", 409),
    ({"status": "already_committed"}, credits.CreditReplay, "already_graded", 409),
    ({"status": "request_key_conflict"}, credits.CreditRefused, "request_key_conflict", 409),
    ({"status": "not_owner"}, credits.CreditRefused, "not_owner", 404),
    ({"status": "no_entitlement"}, credits.CreditRefused, "no_entitlement", 403),
    ({"status": "insufficient_credits", "balance": 0}, credits.CreditRefused, "insufficient_credits", 402),
])
def test_reserve_refusals(monkeypatch, answer, exc, code, status):
    _rpc_returning(monkeypatch, answer)
    with pytest.raises(exc) as info:
        _reserve(kinds=["class", "repractice"])
    assert info.value.code == code and info.value.status_code == status
    if exc is credits.CreditRefused:
        assert info.value.credit_source == "class"


@pytest.mark.parametrize("answer", [RuntimeError("timeout"), None, [], [{}, {}], {"status": "weird"}])
def test_reserve_failures_are_unavailable(monkeypatch, answer):
    _rpc_returning(monkeypatch, answer)
    with pytest.raises(credits.CreditUnavailable):
        _reserve()


def test_reserve_past_the_free_regrade_charges_a_separate_answer(monkeypatch):
    sid, qid = "55555555-5555-5555-5555-555555555555", "66666666-6666-6666-6666-666666666666"
    calls = _rpc_returning(monkeypatch, {"status": "regrade_limit", "regrade_count": 1},
                           {"status": "reserved", "reservation_id": "r9"})
    hold = asyncio.run(credits.reserve("u1", "speaking_grading", request_key="sub-abcdefgh",
                                       resource_type="speaking_cluster", resource_id=f"{sid}:p1:q{qid}",
                                       ttl_seconds=600))
    assert hold.reservation_id == "r9"
    assert calls[1][1]["p_resource_type"] == "speaking_response"
    assert calls[1][1]["p_resource_id"] == f"{sid}:{qid}:r1"
    assert calls[1][1]["p_request_key"] == "sub-abcdefgh"


@pytest.mark.parametrize("hold_status,code", [("open", "grading_in_progress"), ("committed", "already_graded")])
def test_paid_regrade_sent_twice_replays_instead_of_conflicting(monkeypatch, hold_status, code):
    """Codex P2 / CR B2 on 37de4c62. The first call is charged as
    speaking_response '<s>:<q>:r1' under the caller's key; the identical retry
    (speaking_cluster again) meets that reservation in fn_credit_reserve and
    gets request_key_conflict. The wrapper maps it back to the RPC's replay."""
    sid, qid = "55555555-5555-5555-5555-555555555555", "66666666-6666-6666-6666-666666666666"
    reservations = {}
    answers = [{"status": "regrade_limit", "regrade_count": 1},
               {"status": "reserved", "reservation_id": "r9"},
               {"status": "request_key_conflict", "reservation_id": "r9"}]

    def rpc(name, params):
        query = MagicMock()
        answer = answers.pop(0)
        if answer["status"] == "reserved":
            reservations["r9"] = {"user_id": "u1", "resource_type": params["p_resource_type"],
                                  "resource_id": params["p_resource_id"], "status": "open"}
        query.execute.return_value.data = answer
        return query

    client = MagicMock()
    client.rpc.side_effect = rpc
    monkeypatch.setattr(credits, "supabase_admin", client)
    monkeypatch.setattr(credits, "fetch_reservation", lambda rid: reservations.get(rid))

    def send():
        return asyncio.run(credits.reserve("u1", "speaking_grading", request_key="sub-abcdefgh",
                                           resource_type="speaking_cluster", resource_id=f"{sid}:p1:q{qid}",
                                           ttl_seconds=600))

    assert send().reservation_id == "r9"
    reservations["r9"]["status"] = hold_status
    with pytest.raises(credits.CreditReplay) as info:
        send()
    assert info.value.code == code and info.value.status_code == 409


@pytest.mark.parametrize("row", [
    None,                                                              # gone
    {"user_id": "u2", "resource_type": "speaking_response",
     "resource_id": "55555555-5555-5555-5555-555555555555:66666666-6666-6666-6666-666666666666:r1",
     "status": "open"},                                                # someone else's
    {"user_id": "u1", "resource_type": "speaking_response",
     "resource_id": "55555555-5555-5555-5555-555555555555:77777777-7777-7777-7777-777777777777:r1",
     "status": "open"},                                                # another question
    {"user_id": "u1", "resource_type": "writing_essay", "resource_id": "x", "status": "open"},
    {"user_id": "u1", "resource_type": "speaking_response",
     "resource_id": "55555555-5555-5555-5555-555555555555:66666666-6666-6666-6666-666666666666:r1",
     "status": "released"},                                            # a released hold stays a conflict
])
def test_other_cluster_conflicts_stay_conflicts(monkeypatch, row):
    sid, qid = "55555555-5555-5555-5555-555555555555", "66666666-6666-6666-6666-666666666666"
    _rpc_returning(monkeypatch, {"status": "request_key_conflict", "reservation_id": "r9"})
    monkeypatch.setattr(credits, "fetch_reservation", lambda rid: row)
    with pytest.raises(credits.CreditRefused) as info:
        asyncio.run(credits.reserve("u1", "speaking_grading", request_key="sub-abcdefgh",
                                    resource_type="speaking_cluster", resource_id=f"{sid}:p1:q{qid}",
                                    ttl_seconds=600))
    assert info.value.code == "request_key_conflict"


def test_paid_regrade_replay_lookup_failure_is_unavailable(monkeypatch):
    _rpc_returning(monkeypatch, {"status": "request_key_conflict", "reservation_id": "r9"})

    def broken(rid):
        raise RuntimeError("db down")

    monkeypatch.setattr(credits, "fetch_reservation", broken)
    with pytest.raises(credits.CreditUnavailable):
        asyncio.run(credits.reserve("u1", "speaking_grading", request_key="sub-abcdefgh",
                                    resource_type="speaking_cluster", resource_id="s:p1:qq", ttl_seconds=600))


def test_commit_release_and_release_if_open(monkeypatch, caplog):
    calls = _rpc_returning(monkeypatch, {"status": "committed"})
    hold = credits.CreditHold(reservation_id="r1")
    asyncio.run(hold.commit())
    asyncio.run(hold.commit())  # idempotent: no second call
    asyncio.run(hold.release("grader_failed"))
    assert [c[0] for c in calls] == ["fn_credit_commit"]
    _rpc_returning(monkeypatch, RuntimeError("down"))
    hold = credits.CreditHold(reservation_id="r2")
    with caplog.at_level(logging.WARNING, logger="services.credits"):
        asyncio.run(credits.release_if_open(hold, "grader_failed"))
    assert "decision=release_failed" in caplog.text
    with pytest.raises(ValueError):
        asyncio.run(hold.release("because"))


def test_is_enabled_strict_raises_on_lookup_error_and_shares_the_cache(monkeypatch):
    runtime_flags.clear_cache()
    broken = MagicMock()
    broken.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.side_effect = \
        RuntimeError("db down")
    monkeypatch.setattr(runtime_flags, "supabase_admin", broken)
    with pytest.raises(runtime_flags.FlagLookupError):
        runtime_flags.is_enabled_strict("credit_metering")
    ok = MagicMock()
    ok.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
        {"enabled": True}]
    monkeypatch.setattr(runtime_flags, "supabase_admin", ok)
    assert runtime_flags.is_enabled_strict("credit_metering") is True
    monkeypatch.setattr(runtime_flags, "supabase_admin", broken)
    assert runtime_flags.is_enabled_strict("credit_metering") is True  # cached
    runtime_flags.clear_cache()
    ok.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
    monkeypatch.setattr(runtime_flags, "supabase_admin", ok)
    assert runtime_flags.is_enabled_strict("credit_metering") is False  # no row → default off
    runtime_flags.clear_cache()


# ── The same paid re-grade, twice, against the real 384 RPC ───────────────
# (Codex P2 on 37de4c62 asked for this against fn_credit_reserve itself.)

from tests.test_migration_384_credit_ledger_enrollment_rpcs import pg  # noqa: E402,F401  (PG fixture)


class _PgClient:
    """``supabase_admin.rpc(name, params).execute().data`` on the test cluster.
    The wrapper calls it from a worker thread; the query runs on the test loop."""

    def __init__(self, harness, loop):
        self.harness, self.loop = harness, loop

    def _run(self, coro):
        return asyncio.run_coroutine_threadsafe(coro, self.loop).result(timeout=10)

    def rpc(self, name, params):
        harness = self.harness
        args = ", ".join(f"{k} => ${i}" for i, k in enumerate(params, start=1))
        values = list(params.values())
        run = self._run

        class _Query:
            def execute(self):
                result = MagicMock()
                result.data = run(_call())
                return result

        async def _call():
            import json as _json
            return _json.loads(await harness.con.fetchval(f"SELECT {name}({args})", *values))

        return _Query()


@pytest.mark.asyncio
@pytest.mark.parametrize("settle", ["open", "commit"])
async def test_paid_regrade_twice_against_fn_credit_reserve(pg, monkeypatch, settle):  # noqa: F811
    from uuid import uuid4

    user = await pg.user()
    await pg.entitlement(user, await pg.product(), credits=5)
    sid = await pg.session(user)
    q = uuid4()
    resource = f"{sid}:p1:q{q}"
    # First grade (reserved) and the one free re-grade (covered) of the question.
    assert (await pg.reserve(user, "speaking_cluster", resource))["status"] == "reserved"
    assert (await pg.reserve(user, "speaking_cluster", resource))["status"] == "covered"

    loop = asyncio.get_running_loop()
    client = _PgClient(pg, loop)
    monkeypatch.setattr(credits, "supabase_admin", client)

    async def fetch(rid):
        row = await pg.con.fetchrow(
            "SELECT user_id::text, resource_type, resource_id, status FROM credit_reservations WHERE id = $1::uuid",
            rid)
        return dict(row) if row else None

    monkeypatch.setattr(credits, "fetch_reservation", lambda rid: client._run(fetch(rid)))

    async def send():
        return await credits.reserve(str(user), "speaking_grading", request_key="paid-regrade-key",
                                     resource_type="speaking_cluster", resource_id=resource, ttl_seconds=600)

    hold = await send()  # past the free re-grade: charged as its own answer
    assert hold.reservation_id and not hold.covered
    row = await fetch(hold.reservation_id)
    assert (row["resource_type"], row["resource_id"]) == ("speaking_response", f"{sid}:{q}:r1")
    # Without the fix the RPC's request_key_conflict reached the caller here.
    raw = await pg.reserve(user, "speaking_cluster", resource, key="paid-regrade-key")
    assert raw["status"] == "request_key_conflict"
    if settle == "commit":
        await hold.commit()
    with pytest.raises(credits.CreditReplay) as info:
        await send()
    assert info.value.code == ("already_graded" if settle == "commit" else "grading_in_progress")
    assert await pg.con.fetchval("SELECT count(*) FROM credit_reservations WHERE request_key = 'paid-regrade-key'") == 1
