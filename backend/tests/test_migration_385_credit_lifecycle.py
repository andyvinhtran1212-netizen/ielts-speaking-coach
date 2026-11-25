"""COURSEACCESS-0055 T011 (G04-T12): migration 385, credit lifecycle (spec label "383").

Static checks read the SQL; the PostgreSQL checks apply 383, 384 and 385
verbatim (``public.`` rewritten to a throwaway schema) on a LOCAL disposable
cluster: set TEST_PG_URL, and REQUIRE_PG=1 to forbid skips. Each carry test is
named after its row in the plan 5.15 edge-case table ("case N").

Entitlements are inserted with past dates (the 383 guard checks updates only),
so no test waits for the clock.
"""
import asyncio
import re
from datetime import timedelta
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg
import pytest
import pytest_asyncio

import test_migration_384_credit_ledger_enrollment_rpcs as m384

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
NAME = "385_credit_lifecycle.sql"
FORWARD = (MIGRATIONS / NAME).read_text(encoding="utf-8")
ROLLBACK = (MIGRATIONS / "rollback" / NAME).read_text(encoding="utf-8")
RPCS = ("fn_credit_expire_entitlements(uuid,integer,integer,integer)",
        "fn_credit_grant_extra(uuid,text,uuid,integer,text,text)")
ADMIN = uuid4()


def _body(sql: str) -> str:
    return re.sub(r"--[^\n]*", "", sql)


# ── Static ──────────────────────────────────────────────────────────────────

def test_one_transaction_two_definer_rpcs_service_role_only():
    body = _body(FORWARD)
    assert body.count("BEGIN;") == 1 and body.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s'" in body
    assert "SET LOCAL search_path = pg_catalog, pg_temp" in body
    functions = re.findall(r"CREATE OR REPLACE FUNCTION public\.(\w+)\(", body)
    assert sorted(functions) == sorted(s.split("(")[0] for s in RPCS)
    for block in re.split(r"CREATE OR REPLACE FUNCTION ", body)[1:]:
        header = block.split("AS $$", 1)[0]
        assert "SECURITY DEFINER" in header and "SET search_path = pg_catalog, pg_temp" in header, header
    for signature in RPCS:
        assert f"'public.{signature}'::regprocedure" in body, signature
    # No table, column or seed; only session-free locks.
    assert not re.search(r"\b(CREATE TABLE|ALTER TABLE|DROP TABLE)\b", body)
    assert not re.search(r"pg_advisory_lock\(", body)
    assert not re.search(r"FROM public\.users[^;]*FOR UPDATE", body)


def test_the_carry_formula_is_not_copied():
    """The carry_left formula has one home, 384's fn_credit_usable_balance."""
    body = _body(FORWARD)
    assert "public.fn_credit_usable_balance(" in body
    assert "FILTER" not in body and "least(v_carry" not in body


def test_grant_extra_writes_the_reason_column_as_a_literal():
    body = _body(FORWARD)
    grant = body.split("FUNCTION public.fn_credit_grant_extra(", 1)[1].split("$$;", 1)[0]
    insert = re.search(r"INSERT INTO public\.credit_ledger \(([^)]*)\)\s*VALUES \(([^;]*)\)", grant)
    columns = [c.strip() for c in insert.group(1).split(",")]
    values = [v.strip() for v in re.split(r",\s*(?![^(]*\))", insert.group(2))]
    assert values[columns.index("reason")] == "'grant_extra'"
    assert values[columns.index("note")] == "btrim(p_reason)"


def test_register_policy_and_rollback():
    register = [line.split("\t") for line in (MIGRATIONS / "register.tsv").read_text().splitlines()
                if line and not line.startswith("#")]
    assert ["385", NAME, "present"] == next(r for r in register if r[0] == "385")[:3]
    policy = {line.split("\t")[0]: line.split("\t")[1:3]
              for line in (MIGRATIONS / "forward-policy.tsv").read_text().splitlines()
              if line and not line.startswith("#")}
    assert policy[NAME] == ["pending_feature", "credit_lifecycle"]
    body = _body(ROLLBACK)
    assert "DROP TABLE" not in body and "DELETE" not in body
    for signature in RPCS:
        name, args = signature.split("(")
        assert f"DROP FUNCTION IF EXISTS public.{name}(" in body


def test_callers_pass_server_config():
    """Sweep step 4 and the after-confirm call pass the two config values."""
    root = MIGRATIONS.parent
    for path in ("scripts/enrollment_sweep.py", "routers/admin_commerce.py"):
        text = (root / path).read_text(encoding="utf-8")
        assert '"fn_credit_expire_entitlements"' in text
        assert "settings.CREDIT_CARRY_PERCENT" in text and "settings.CREDIT_CARRY_VALID_DAYS" in text
    for path in root.rglob("*.py"):
        if "tests" in path.parts:
            continue
        assert not re.search(r"CREDIT_CARRY_OVER|carry_ratio|carry_rounding", path.read_text(encoding="utf-8")), path


# ── PostgreSQL harness ──────────────────────────────────────────────────────

class Harness(m384.Harness):
    async def ent(self, user, product, *, starts, days=30, credits_days=None, credits=0,
                  source="enrollment_order", renews=None, carry=None):
        """An entitlement starting ``starts`` (a timedelta from now; negative = past)."""
        course = await self.con.fetchval("SELECT course_id FROM course_products WHERE id = $1", product)
        ent = await self.con.fetchval(
            """INSERT INTO entitlements (user_id, product_id, course_id, source, source_ref, starts_at,
                                         expires_at, credits_expire_at, renews_entitlement_id)
               VALUES ($1, $2, $3, $4, gen_random_uuid(), now() + $5::interval,
                       now() + $5::interval + make_interval(days => $6),
                       CASE WHEN $7::int IS NULL THEN NULL
                            ELSE now() + $5::interval + make_interval(days => $7) END, $8)
               RETURNING id""",
            user, product, course, source, starts, days, credits_days, renews)
        if credits:
            await self.ledger_row(user, ent, credits, "grant", f"test:{ent}:grant")
        if carry:
            amount, hold_ends = carry
            await self.ledger_row(user, ent, amount, "carry_over", f"carry:test:{ent}")
            await self.con.execute(
                "UPDATE entitlements SET carry_settled_at = now(), carry_expires_at = now() + $2::interval "
                "WHERE id = $1", ent, hold_ends)
        return ent

    async def ledger_row(self, user, ent, delta, reason, key):
        await self.con.execute(
            "INSERT INTO credit_ledger (user_id, entitlement_id, delta, reason, idempotency_key) "
            "VALUES ($1, $2, $3, $4, $5)", user, ent, delta, reason, key)

    async def use(self, user, ent, cost, *, ago=timedelta(minutes=5), status="committed"):
        """A reservation of ``cost`` made ``ago`` before now (committed, or still open)."""
        res = await self.con.fetchval(
            """INSERT INTO credit_reservations (user_id, entitlement_id, feature, cost, request_key, status,
                                                resource_type, resource_id, expires_at, settled_at, created_at)
               VALUES ($1, $2, 'speaking_grading', $3, $4, $5, 'speaking_response', $6,
                       now() + interval '1 hour', CASE WHEN $5 = 'open' THEN NULL ELSE now() END, now() - $7::interval)
               RETURNING id""",
            user, ent, cost, uuid4().hex, status, uuid4().hex, ago)
        await self.con.execute(
            "INSERT INTO credit_ledger (user_id, entitlement_id, delta, reason, reservation_id, idempotency_key, "
            "feature) VALUES ($1, $2, $3, 'reserve', $4, $5, 'speaking_grading')",
            user, ent, -cost, res, f"res:{res}:reserve")
        return res

    async def run(self, user=None, percent=100, days=60, limit=100, con=None):
        return await self.rpc("fn_credit_expire_entitlements", user, limit, percent, days, con=con)

    async def rows(self, ent):
        return [(r["reason"], r["delta"]) for r in await self.con.fetch(
            "SELECT reason, delta FROM credit_ledger WHERE entitlement_id = $1 ORDER BY id", ent)]

    async def row(self, ent):
        return await self.con.fetchrow("SELECT * FROM entitlements WHERE id = $1", ent)

    async def usable(self, ent):
        return dict(await self.con.fetchrow("SELECT * FROM fn_credit_usable_balance($1)", ent))


@pytest_asyncio.fixture
async def pg():
    con = await asyncpg.connect(m384._url())
    schema = "lifecycle_" + uuid4().hex
    harness = Harness(con, schema)
    try:
        for role in ("anon", "authenticated", "service_role"):
            await con.execute(f"DO $$ BEGIN CREATE ROLE {role}; EXCEPTION WHEN duplicate_object THEN NULL; END $$")
        await con.execute(f"CREATE SCHEMA {schema}; SET search_path = {schema}, pg_catalog;" + m384.PRE)
        await con.execute(f"GRANT USAGE ON SCHEMA {schema} TO anon, authenticated, service_role")
        await con.execute(harness.sql(m384.M1))
        await con.execute(harness.sql(m384.FORWARD))
        await con.execute(harness.sql(FORWARD))
        await con.execute(harness.sql(FORWARD))  # re-runnable
        await con.execute("INSERT INTO users (id, email) VALUES ($1, 'admin@example.test')", ADMIN)
        yield harness
    finally:
        for other in harness.extra:
            if not other.is_closed():
                await other.close()
        if con.is_in_transaction():
            await con.execute("ROLLBACK")
        await con.execute("RESET ROLE")
        await con.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")
        await con.close()


D = timedelta(days=1)
M = timedelta(minutes=1)


@pytest.mark.asyncio
async def test_rpcs_are_service_role_only_and_validate_arguments(pg):
    con = pg.con
    for signature in RPCS:
        qualified = f"{pg.schema}.{signature}"
        row = await con.fetchrow("SELECT prosecdef, proconfig FROM pg_proc WHERE oid = to_regprocedure($1)",
                                 qualified)
        assert row and row["prosecdef"] and row["proconfig"] == ["search_path=pg_catalog, pg_temp"]
        for role in ("anon", "authenticated"):
            assert not await con.fetchval("SELECT has_function_privilege($1, $2, 'EXECUTE')", role, qualified)
        assert await con.fetchval("SELECT has_function_privilege('service_role', $1, 'EXECUTE')", qualified)
    for args in ((None, 0, 100, 60), (None, 10001, 100, 60), (None, 100, 101, 60), (None, 100, -1, 60),
                 (None, 100, 100, 3651), (None, 100, None, 60)):
        with pytest.raises(asyncpg.InvalidParameterValueError, match="credit_lifecycle_invalid_argument"):
            await pg.rpc("fn_credit_expire_entitlements", *args)
    assert await pg.run() == {"closed": 0, "carried": 0, "carry_expired": 0}


@pytest.mark.asyncio
async def test_rollback_drops_the_rpcs_and_keeps_every_row(pg):
    user = await pg.user()
    ent = await pg.ent(user, await pg.product(), starts=-40 * D, credits=7)
    await pg.run()
    await pg.con.execute(pg.sql(ROLLBACK))
    assert await pg.con.fetchval("SELECT to_regprocedure($1)",
                                 f"{pg.schema}.fn_credit_expire_entitlements(uuid,integer,integer,integer)") is None
    assert await pg.rows(ent) == [("grant", 7), ("expire", -7)]
    await pg.con.execute(pg.sql(FORWARD))  # forward again after a rollback


# ── Closing the book (plan 5.15 step 2) ─────────────────────────────────────

@pytest.mark.asyncio
async def test_close_writes_expire_once_and_closes_an_empty_book(pg):
    user = await pg.user()
    product = await pg.product()
    full = await pg.ent(user, product, starts=-40 * D, credits=10)
    await pg.use(user, full, 3, ago=20 * D)
    empty = await pg.ent(user, product, starts=-40 * D, credits=2)
    await pg.use(user, empty, 2, ago=20 * D)
    live = await pg.ent(user, product, starts=-1 * D, credits=4)
    assert await pg.run() == {"closed": 2, "carried": 0, "carry_expired": 0}
    assert await pg.rows(full) == [("grant", 10), ("reserve", -3), ("expire", -7)]
    assert await pg.rows(empty) == [("grant", 2), ("reserve", -2)]
    assert (await pg.row(full))["credits_closed_at"] and (await pg.row(empty))["credits_closed_at"]
    assert (await pg.row(live))["credits_closed_at"] is None
    assert await pg.run() == {"closed": 0, "carried": 0, "carry_expired": 0}
    assert await pg.rows(full) == [("grant", 10), ("reserve", -3), ("expire", -7)]
    assert await pg.balance(user) == 4


@pytest.mark.asyncio
async def test_case_13_an_open_reservation_defers_the_close(pg):
    user = await pg.user()
    ent = await pg.ent(user, await pg.product(), starts=-40 * D, credits=7)
    hold = await pg.use(user, ent, 2, ago=1 * D, status="open")
    assert await pg.run() == {"closed": 0, "carried": 0, "carry_expired": 0}
    assert (await pg.row(ent))["credits_closed_at"] is None
    assert (await pg.rpc("fn_credit_release", hold, "request_failed"))["status"] == "released"
    assert (await pg.run())["closed"] == 1
    assert await pg.rows(ent) == [("grant", 7), ("reserve", -2), ("release", 2), ("expire", -7)]


@pytest.mark.asyncio
async def test_revoked_and_class_books_close_and_never_carry(pg):
    """Case 6 (a revoked previous term) and case 12 (code entitlements)."""
    user = await pg.user()
    product = await pg.product()
    prev = await pg.ent(user, product, starts=-20 * D, credits=7)
    await pg.con.execute("UPDATE entitlements SET status = 'revoked', revoked_at = now() WHERE id = $1", prev)
    renewal = await pg.ent(user, product, starts=-1 * M, renews=prev)
    klass = await pg.product(kind="class")
    old_code = await pg.ent(user, klass, starts=-40 * D, credits=5, source="access_code")
    new_code = await pg.ent(user, klass, starts=-1 * D, credits=5, source="access_code")
    assert await pg.run() == {"closed": 2, "carried": 0, "carry_expired": 0}
    assert await pg.rows(prev) == [("grant", 7), ("expire", -7)]
    assert await pg.rows(renewal) == []
    assert (await pg.row(renewal))["carry_settled_at"] and (await pg.row(renewal))["carry_expires_at"] is None
    assert await pg.rows(old_code) == [("grant", 5), ("expire", -5)]
    assert await pg.rows(new_code) == [("grant", 5)]
    assert (await pg.row(new_code))["carry_settled_at"] is None


# ── Carrying into a renewal (plan 5.15 step 3, edge-case table) ─────────────

@pytest.mark.asyncio
async def test_case_1_renewal_while_the_term_runs_carries_when_it_closes(pg):
    user = await pg.user()
    product = await pg.product()
    prev = await pg.ent(user, product, starts=-29 * D, credits=10)
    await pg.use(user, prev, 3, ago=5 * D)
    old = await pg.row(prev)
    nxt = await pg.con.fetchval(
        """INSERT INTO entitlements (user_id, product_id, course_id, source, source_ref, starts_at, expires_at,
                                     renews_entitlement_id)
           SELECT user_id, product_id, course_id, 'enrollment_order', gen_random_uuid(), expires_at,
                  expires_at + interval '30 days', id FROM entitlements WHERE id = $1 RETURNING id""", prev)
    # The old term still runs: nothing moves, its credits stay usable there.
    assert await pg.run() == {"closed": 0, "carried": 0, "carry_expired": 0}
    assert (await pg.usable(prev))["balance"] == 7 and await pg.rows(nxt) == []
    # It ends.
    await pg.con.execute("ALTER TABLE entitlements DISABLE TRIGGER trg_entitlements_guard")
    await pg.con.execute("UPDATE entitlements SET starts_at = starts_at - interval '2 days', "
                         "expires_at = expires_at - interval '2 days' WHERE id = ANY($1::uuid[])", [prev, nxt])
    await pg.con.execute("ALTER TABLE entitlements ENABLE TRIGGER trg_entitlements_guard")
    assert await pg.run() == {"closed": 1, "carried": 1, "carry_expired": 0}
    assert await pg.rows(prev) == [("grant", 10), ("reserve", -3), ("expire", -7)]
    assert await pg.con.fetchval("SELECT note FROM credit_ledger WHERE reason = 'carry_over'") == "7 × 100% = 7"
    new = await pg.row(nxt)
    assert new["carry_expires_at"] - new["starts_at"] == timedelta(days=30)  # case 15: clamped to its end
    assert old["expires_at"] - timedelta(days=2) == new["starts_at"]
    assert (await pg.usable(nxt)) == {"balance": 7, "carry_left": 7, "carry_lapsed": 0}


@pytest.mark.asyncio
async def test_case_2_an_order_made_after_expiry_carries_right_after_confirm(pg):
    """End to end with 384's confirm: the window check, then the per-user call."""
    user = await pg.user()
    product = await pg.product(ai_credits=20, access_days=365)
    prev = await pg.ent(user, product, starts=-60 * D, days=30, credits=10)
    await pg.use(user, prev, 3, ago=40 * D)
    assert (await pg.run())["closed"] == 1  # the sweep closed it when it ended
    order = await pg.order(user, product)
    confirmed = await pg.rpc("fn_enrollment_order_confirm", ADMIN, UUID(order["id"]), None, False, 60, None)
    assert confirmed["status"] == "confirmed" and confirmed["renews_entitlement_id"] == str(prev)
    assert await pg.run(user) == {"closed": 0, "carried": 1, "carry_expired": 0}
    nxt = UUID(confirmed["entitlement_id"])
    assert await pg.rows(nxt) == [("grant", 20), ("carry_over", 7)]
    new = await pg.row(nxt)
    assert new["carry_expires_at"] - new["starts_at"] == timedelta(days=60)
    balance = await pg.rpc("fn_credit_balance", user)
    assert balance["total"] == 27 and balance["items"][0]["carry_balance"] == 7


@pytest.mark.asyncio
async def test_case_3_no_renewal_link_no_carry(pg):
    user = await pg.user()
    product = await pg.product()
    await pg.ent(user, product, starts=-40 * D, credits=7)
    other = await pg.ent(user, product, starts=-1 * D, credits=2)
    assert await pg.run() == {"closed": 1, "carried": 0, "carry_expired": 0}
    assert await pg.rows(other) == [("grant", 2)] and (await pg.row(other))["carry_settled_at"] is None


@pytest.mark.asyncio
async def test_case_7_a_renewal_revoked_before_the_carry_gets_nothing(pg):
    user = await pg.user()
    product = await pg.product()
    prev = await pg.ent(user, product, starts=-31 * D, credits=7)
    nxt = await pg.ent(user, product, starts=-1 * D, renews=prev)
    await pg.con.execute("UPDATE entitlements SET status = 'revoked', revoked_at = now() WHERE id = $1", nxt)
    assert (await pg.run())["carried"] == 0
    assert [r for r in await pg.rows(nxt) if r[0] == "carry_over"] == []
    assert (await pg.row(nxt))["carry_settled_at"] is not None


@pytest.mark.asyncio
async def test_case_9_a_carried_balance_is_not_carried_again(pg):
    user = await pg.user()
    product = await pg.product()
    second = await pg.ent(user, product, starts=-31 * D, credits=3, carry=(2, 10 * D))
    third = await pg.ent(user, product, starts=-1 * D, renews=second)
    assert await pg.run() == {"closed": 1, "carried": 1, "carry_expired": 1}
    assert await pg.rows(second) == [("grant", 3), ("carry_over", 2), ("carry_expire", -2), ("expire", -3)]
    assert await pg.rows(third) == [("carry_over", 3)]
    closed = await pg.row(second)
    assert closed["carry_closed_at"] and closed["credits_closed_at"]


@pytest.mark.asyncio
async def test_case_10_grant_extra_and_adjustments_are_carried(pg):
    user = await pg.user()
    product = await pg.product()
    prev = await pg.ent(user, product, starts=-31 * D, credits=4)
    await pg.ledger_row(user, prev, 5, "grant_extra", f"extra:test:{prev}")
    await pg.ledger_row(user, prev, -1, "admin_adjust", f"admin:test:{prev}")
    nxt = await pg.ent(user, product, starts=-1 * D, renews=prev)
    await pg.run()
    assert await pg.rows(nxt) == [("carry_over", 8)]


@pytest.mark.asyncio
async def test_case_11_credits_that_lapse_early_still_carry(pg):
    user = await pg.user()
    product = await pg.product()
    prev = await pg.ent(user, product, starts=-20 * D, days=30, credits_days=10, credits=6)
    assert (await pg.run())["closed"] == 1  # credit window over, access still runs
    assert await pg.rows(prev) == [("grant", 6), ("expire", -6)]
    nxt = await pg.ent(user, product, starts=10 * D, renews=prev)
    assert (await pg.run())["carried"] == 1
    assert await pg.rows(nxt) == [("carry_over", 6)]
    assert (await pg.usable(nxt))["balance"] == 6  # booked, usable from its own starts_at


@pytest.mark.asyncio
async def test_case_13_an_open_reservation_defers_the_carry(pg):
    user = await pg.user()
    product = await pg.product()
    prev = await pg.ent(user, product, starts=-31 * D, credits=7)
    nxt = await pg.ent(user, product, starts=-1 * D, credits=1, renews=prev)
    hold = await pg.use(user, nxt, 1, ago=M, status="open")
    assert await pg.run() == {"closed": 1, "carried": 0, "carry_expired": 0}
    assert (await pg.row(nxt))["carry_settled_at"] is None
    assert (await pg.rpc("fn_credit_commit", hold))["status"] == "committed"
    assert (await pg.run())["carried"] == 1


@pytest.mark.asyncio
async def test_case_16_percent_zero_and_fifty_round_down(pg):
    user = await pg.user()
    product = await pg.product()
    results = {}
    for percent, left in ((0, 7), (50, 7), (50, 1)):
        prev = await pg.ent(user, product, starts=-31 * D, credits=left)
        nxt = await pg.ent(user, product, starts=-1 * D, renews=prev)
        await pg.run(percent=percent)
        results[(percent, left)] = (await pg.rows(nxt), (await pg.row(nxt))["carry_settled_at"] is not None)
    assert results == {(0, 7): ([], True), (50, 7): ([("carry_over", 3)], True), (50, 1): ([], True)}
    assert await pg.con.fetchval("SELECT note FROM credit_ledger WHERE reason = 'carry_over'") == "7 × 50% = 3"


@pytest.mark.asyncio
async def test_two_sweeps_at_once_write_one_carry(pg):
    a, b = await pg.connect(), await pg.connect()
    product = await pg.product()
    for _ in range(20):
        user = await pg.user()
        prev = await pg.ent(user, product, starts=-31 * D, credits=7)
        nxt = await pg.ent(user, product, starts=-1 * D, renews=prev)
        await asyncio.gather(pg.run(con=a), pg.run(con=b))
        await pg.run()  # whatever one sweep skipped, the next run finishes
        assert await pg.rows(prev) == [("grant", 7), ("expire", -7)]
        assert await pg.rows(nxt) == [("carry_over", 7)]


@pytest.mark.asyncio
async def test_the_sweep_skips_a_learner_whose_credit_lock_is_busy(pg):
    user = await pg.user()
    ent = await pg.ent(user, await pg.product(), starts=-40 * D, credits=7)
    other = await pg.connect()
    await other.execute("BEGIN")
    await other.execute("SELECT pg_advisory_xact_lock(hashtextextended('aver.credit:' || $1::text, 0))", str(user))
    assert (await pg.run())["closed"] == 0
    await other.execute("COMMIT")
    assert (await pg.run())["closed"] == 1
    assert await pg.rows(ent) == [("grant", 7), ("expire", -7)]


# ── A carry's hold ends (plan 5.15 step 1) ──────────────────────────────────

@pytest.mark.asyncio
async def test_a_lapsed_carry_is_booked_and_the_balance_never_jumps(pg):
    user = await pg.user()
    product = await pg.product()
    ent = await pg.ent(user, product, starts=-61 * D, days=365, credits=4, carry=(7, -1 * D))
    await pg.use(user, ent, 3, ago=30 * D)  # before the hold ended: spent from the carry
    assert await pg.balance(user) == 4  # time-based, before the job
    assert await pg.run() == {"closed": 0, "carried": 0, "carry_expired": 1}
    assert await pg.rows(ent) == [("grant", 4), ("carry_over", 7), ("reserve", -3), ("carry_expire", -4)]
    assert (await pg.row(ent))["carry_closed_at"] is not None
    assert await pg.balance(user) == 4
    note = await pg.con.fetchval("SELECT note FROM credit_ledger WHERE reason = 'carry_expire'")
    assert note.startswith("hết hạn bảo lưu ")
    assert (await pg.run())["carry_expired"] == 0
    assert len(await pg.rows(ent)) == 4


@pytest.mark.asyncio
async def test_a_carry_already_spent_closes_without_a_row(pg):
    user = await pg.user()
    ent = await pg.ent(user, await pg.product(), starts=-61 * D, days=365, credits=4, carry=(7, -1 * D))
    await pg.use(user, ent, 9, ago=30 * D)
    assert await pg.run() == {"closed": 0, "carried": 0, "carry_expired": 0}
    assert [r[0] for r in await pg.rows(ent)] == ["grant", "carry_over", "reserve"]
    assert (await pg.row(ent))["carry_closed_at"] is not None
    assert await pg.balance(user) == 2


@pytest.mark.asyncio
async def test_case_13_an_open_reservation_defers_the_lapse(pg):
    user = await pg.user()
    ent = await pg.ent(user, await pg.product(), starts=-61 * D, days=365, credits=4, carry=(7, -1 * D))
    await pg.use(user, ent, 1, ago=M, status="open")
    assert (await pg.run())["carry_expired"] == 0
    assert (await pg.row(ent))["carry_closed_at"] is None


@pytest.mark.asyncio
async def test_case_14_an_extension_keeps_the_hold_date(pg):
    user = await pg.user()
    ent = await pg.ent(user, await pg.product(), starts=-1 * D, days=90, carry=(5, 59 * D))
    before = (await pg.row(ent))["carry_expires_at"]
    assert (await pg.rpc("fn_entitlement_admin_extend", ADMIN, ent, 30, "gia hạn thử"))["status"] == "extended"
    assert (await pg.row(ent))["carry_expires_at"] == before


# ── fn_credit_grant_extra ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_grant_extra_is_idempotent_per_key_and_learner(pg):
    user = await pg.user()
    second_user = await pg.user()
    product = await pg.product(kind="class")
    ent = await pg.ent(user, product, starts=-1 * D, credits=2, source="access_code")
    other = await pg.ent(user, product, starts=-1 * D, source="admin_grant")
    theirs = await pg.ent(second_user, product, starts=-1 * D, source="access_code")
    key = uuid4().hex
    first = await pg.rpc("fn_credit_grant_extra", ADMIN, "admin", ent, 5, "  bù bài lỗi  ", key)
    assert first == {"status": "granted", "ledger_id": first["ledger_id"], "entitlement_id": str(ent), "balance": 7}
    again = await pg.rpc("fn_credit_grant_extra", ADMIN, "admin", ent, 5, "bù bài lỗi", key)
    assert again == {"status": "replay", "ledger_id": first["ledger_id"], "entitlement_id": str(ent), "balance": 7}
    # A retry after the backend picked another entitlement of the same learner
    # (a newer class term was granted meanwhile) replays the first grant.
    moved = await pg.rpc("fn_credit_grant_extra", ADMIN, "admin", other, 5, "bù bài lỗi", key)
    assert moved == again
    # Same key, other credits or reason: refused, nothing written.
    for credits, reason in ((6, "bù bài lỗi"), (5, "lý do khác")):
        assert (await pg.rpc("fn_credit_grant_extra", ADMIN, "admin", ent, credits, reason, key)) \
            == {"status": "request_key_conflict"}
    # Another learner in the same batch gets their own row.
    assert (await pg.rpc("fn_credit_grant_extra", ADMIN, "admin", theirs, 5, "bù bài lỗi", key))["status"] == "granted"
    assert await pg.con.fetchval("SELECT count(*) FROM credit_ledger WHERE reason = 'grant_extra'") == 2
    row = await pg.con.fetchrow("SELECT * FROM credit_ledger WHERE id = $1", first["ledger_id"])
    assert (row["reason"], row["delta"], row["note"], row["actor_id"]) == ("grant_extra", 5, "bù bài lỗi", ADMIN)
    assert row["idempotency_key"] == f"extra:{key}:{user}"


@pytest.mark.asyncio
async def test_grant_extra_refuses_unusable_unknown_and_bad_arguments(pg):
    user = await pg.user()
    product = await pg.product()
    expired = await pg.ent(user, product, starts=-40 * D)
    later = await pg.ent(user, product, starts=5 * D)
    revoked = await pg.ent(user, product, starts=-1 * D)
    await pg.con.execute("UPDATE entitlements SET status = 'revoked', revoked_at = now() WHERE id = $1", revoked)
    for ent in (expired, later, revoked):
        assert (await pg.rpc("fn_credit_grant_extra", ADMIN, "admin", ent, 3, "lý do", uuid4().hex)) \
            == {"status": "not_usable"}
    assert (await pg.rpc("fn_credit_grant_extra", ADMIN, "admin", uuid4(), 3, "lý do", uuid4().hex)) \
        == {"status": "not_found"}
    good = (ADMIN, "admin", expired, 3, "lý do", uuid4().hex)
    for index, bad in ((0, None), (1, "student"), (3, 0), (3, 100001), (4, "  a "), (4, "x" * 501), (5, "short")):
        args = list(good)
        args[index] = bad
        with pytest.raises(asyncpg.InvalidParameterValueError, match="credit_grant_extra_invalid_argument"):
            await pg.rpc("fn_credit_grant_extra", *args)
    assert await pg.con.fetchval("SELECT count(*) FROM credit_ledger WHERE reason = 'grant_extra'") == 0
