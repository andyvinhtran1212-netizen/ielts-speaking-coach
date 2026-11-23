"""COURSEACCESS-0055 T013 (G04-T15): migration 387, class credit conversion (spec label "388").

Static checks read the SQL; the PostgreSQL checks apply 383, 384 and 387
verbatim (``public.`` rewritten to a throwaway schema) on a LOCAL disposable
cluster: set TEST_PG_URL, and REQUIRE_PG=1 to forbid skips. The class shape
(cohorts, student_cohort_memberships, access_codes.cohort_id) is the part of
060/062/227/337 the function reads.
"""
import asyncio
import hashlib
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg
import pytest
import pytest_asyncio

import test_migration_384_credit_ledger_enrollment_rpcs as m384

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
NAME = "387_class_credit_conversion.sql"
FORWARD = (MIGRATIONS / NAME).read_text(encoding="utf-8")
ROLLBACK = (MIGRATIONS / "rollback" / NAME).read_text(encoding="utf-8")
RPC = "fn_credit_convert_class(uuid,uuid,uuid,integer,uuid)"
ADMIN = uuid4()

CLASS_SHAPE = """
    CREATE TABLE cohorts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
        course_id uuid REFERENCES courses(id), archived_at timestamptz);
    CREATE TABLE student_cohort_memberships (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        cohort_id uuid NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
        is_active boolean NOT NULL DEFAULT true, left_at timestamptz,
        CONSTRAINT uq_student_cohort_membership UNIQUE (student_id, cohort_id));
    ALTER TABLE access_codes ADD COLUMN cohort_id uuid REFERENCES cohorts(id) ON DELETE SET NULL;
"""


def _body(sql: str) -> str:
    return re.sub(r"--[^\n]*", "", sql)


# ── Static ──────────────────────────────────────────────────────────────────

def test_one_transaction_one_definer_rpc_service_role_only():
    body = _body(FORWARD)
    assert body.count("BEGIN;") == 1 and body.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s'" in body
    assert "SET LOCAL search_path = pg_catalog, pg_temp" in body
    assert re.findall(r"CREATE OR REPLACE FUNCTION public\.(\w+)\(", body) == ["fn_credit_convert_class"]
    header = body.split("CREATE OR REPLACE FUNCTION ", 1)[1].split("AS $$", 1)[0]
    assert "SECURITY DEFINER" in header and "SET search_path = pg_catalog, pg_temp" in header
    assert f"'public.{RPC}'::regprocedure" in body
    assert not re.search(r"\b(CREATE TABLE|ALTER TABLE|DROP TABLE)\b", body)
    assert not re.search(r"pg_advisory_lock\(", body)
    # Codes, assignments and memberships are only read.
    assert not re.search(r"\b(UPDATE|INSERT INTO|DELETE FROM)\s+public\.(access_codes|user_code_assignments|"
                         r"student_cohort_memberships|cohorts|students)\b", body)


def test_constant_reason_and_source_and_the_lock_order():
    body = _body(FORWARD)
    insert = re.search(r"INSERT INTO public\.entitlements \(([^)]*)\)\s*VALUES \(([^;]*?)\)\s*ON CONFLICT", body)
    columns = [c.strip() for c in insert.group(1).split(",")]
    values = [v.strip() for v in insert.group(2).split(",")]
    assert values[columns.index("source")] == "'class_conversion'"
    assert values[columns.index("reason")] == "'class_conversion'"
    assert values[columns.index("source_ref")] == "p_cohort_id"
    ledger = re.search(r"INSERT INTO public\.credit_ledger \(([^)]*)\)\s*VALUES \(([^;]*)\)", body)
    assert "'grant'" in ledger.group(2)
    assert "FOR UPDATE" in body.split("FROM public.cohorts", 1)[1].split(";", 1)[0]
    assert "ORDER BY s.user_id NULLS LAST" in body
    assert "public.fn_credit_lock_user(v_member.user_id)" in body


def test_register_policy_readme_and_rollback():
    register = [line.split("\t") for line in (MIGRATIONS / "register.tsv").read_text().splitlines()
                if line and not line.startswith("#")]
    assert ["387", NAME, "present", "G04-T15"] == next(r for r in register if r[0] == "387")[:4]
    assert next(r for r in register if r[0] == "386")[2] == "abandoned"
    policy = {line.split("\t")[0]: line.split("\t")[1:3]
              for line in (MIGRATIONS / "forward-policy.tsv").read_text().splitlines()
              if line and not line.startswith("#")}
    assert policy[NAME] == ["pending_feature", "class_credit_conversion"]
    readme = (MIGRATIONS / "README.md").read_text()
    assert "`387` is `pending_feature class_credit_conversion`" in readme and "`386` is left empty" in readme
    body = _body(ROLLBACK)
    assert "DROP TABLE" not in body and "DELETE" not in body
    assert "DROP FUNCTION IF EXISTS public.fn_credit_convert_class(uuid, uuid, uuid, integer, uuid)" in body


# ── PostgreSQL harness ──────────────────────────────────────────────────────

class Harness(m384.Harness):
    async def cohort(self, course, *, archived=False, name="Lớp IELTS 6.5"):
        return await self.con.fetchval(
            "INSERT INTO cohorts (name, course_id, archived_at) VALUES ($1, $2, "
            "CASE WHEN $3 THEN now() END) RETURNING id", name, course, archived)

    async def member(self, cohort, user=None, *, active=True):
        """A student of ``cohort``; ``user`` None = no account yet."""
        student = await self.con.fetchval("INSERT INTO students (user_id) VALUES ($1) RETURNING id", user)
        await self.con.execute(
            "INSERT INTO student_cohort_memberships (student_id, cohort_id, is_active, left_at) "
            "VALUES ($1, $2, $3, CASE WHEN $3 THEN NULL ELSE now() END)", student, cohort, active)
        return student

    async def code(self, cohort, *, expires=None, used_by=None, assign=None, assignment_active=True,
                   revoked=False, active=True):
        """A legacy code of ``cohort`` (no product). ``expires`` is a timedelta from now."""
        code = await self.con.fetchval(
            "INSERT INTO access_codes (code, cohort_id, expires_at, used_by, is_used, is_revoked, is_active) "
            "VALUES ($1, $2, CASE WHEN $3::interval IS NULL THEN NULL ELSE now() + $3::interval END, "
            "$4::uuid, $4::uuid IS NOT NULL, $5, $6) RETURNING id",
            "L" + uuid4().hex[:10], cohort, expires, used_by, revoked, active)
        if assign:
            await self.con.execute("INSERT INTO user_code_assignments (user_id, code_id, is_active) "
                                   "VALUES ($1, $2, $3)", assign, code, assignment_active)
        return code

    async def convert(self, cohort, product, credits, key=None, con=None):
        return await self.rpc("fn_credit_convert_class", ADMIN, cohort, product, credits, key or uuid4(), con=con)

    async def ents(self, user):
        return await self.con.fetch("SELECT * FROM entitlements WHERE user_id = $1 AND source = 'class_conversion'",
                                    user)

    async def grants(self, user):
        return [r["delta"] for r in await self.con.fetch(
            "SELECT delta FROM credit_ledger WHERE user_id = $1 AND reason = 'grant' ORDER BY id", user)]

    async def fingerprint(self):
        rows = []
        for table in ("access_codes", "user_code_assignments", "student_cohort_memberships", "cohorts"):
            rows.append(await self.con.fetchval(f"SELECT count(*) FROM {table}"))
            rows.append(await self.con.fetchval(
                f"SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM {table} t"))
        return hashlib.sha256(repr(rows).encode()).hexdigest()


@pytest_asyncio.fixture
async def pg():
    con = await asyncpg.connect(m384._url())
    schema = "convert_" + uuid4().hex
    harness = Harness(con, schema)
    try:
        for role in ("anon", "authenticated", "service_role"):
            await con.execute(f"DO $$ BEGIN CREATE ROLE {role}; EXCEPTION WHEN duplicate_object THEN NULL; END $$")
        await con.execute(f"CREATE SCHEMA {schema}; SET search_path = {schema}, pg_catalog;" + m384.PRE
                          + CLASS_SHAPE)
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


async def _class(pg):
    """A course with one class product and a class of four (plan task T15 point 5)."""
    product = await pg.product(kind="class")
    course = await pg.con.fetchval("SELECT course_id FROM course_products WHERE id = $1", product)
    cohort = await pg.cohort(course)
    a, b, c = [await pg.user() for _ in range(3)]
    for user in (a, b, c, None):
        await pg.member(cohort, user)
    await pg.code(cohort, expires=40 * D, assign=a)              # A: code of the class, assignment path
    await pg.code(cohort, used_by=b)                             # B: code without expiry, used_by path
    return {"product": product, "course": course, "cohort": cohort, "a": a, "b": b, "c": c}


def _by_user(result):
    return {UUID(item["user_id"]): item for item in result["converted"]}


@pytest.mark.asyncio
async def test_rpc_is_service_role_only_and_validates_arguments(pg):
    row = await pg.con.fetchrow("SELECT prosecdef, proconfig FROM pg_proc WHERE oid = to_regprocedure($1)",
                                f"{pg.schema}.{RPC}")
    assert row and row["prosecdef"] and row["proconfig"] == ["search_path=pg_catalog, pg_temp"]
    for role in ("anon", "authenticated"):
        assert not await pg.con.fetchval("SELECT has_function_privilege($1, $2, 'EXECUTE')", role,
                                         f"{pg.schema}.{RPC}")
    assert await pg.con.fetchval("SELECT has_function_privilege('service_role', $1, 'EXECUTE')", f"{pg.schema}.{RPC}")
    world = await _class(pg)
    for credits in (-1, 100001, None):
        with pytest.raises(asyncpg.exceptions.InvalidParameterValueError):
            await pg.convert(world["cohort"], world["product"], credits)


@pytest.mark.asyncio
async def test_four_members_replay_new_key_and_a_new_member(pg):
    world = await _class(pg)
    before = await pg.fingerprint()
    key = uuid4()
    result = await pg.convert(world["cohort"], world["product"], 10, key)
    assert result["status"] == "converted"
    converted = _by_user(result)
    assert set(converted) == {world["a"], world["b"], world["c"]}
    assert result["skipped"] == [{"user_id": None, "reason": "no_account"}]
    code_expiry = await pg.con.fetchval("SELECT expires_at FROM access_codes WHERE cohort_id = $1 "
                                        "AND expires_at IS NOT NULL", world["cohort"])
    (a_ent,) = await pg.ents(world["a"])
    assert a_ent["expires_at"] == code_expiry and a_ent["source_ref"] == world["cohort"]
    assert a_ent["product_id"] == world["product"] and a_ent["granted_by"] == ADMIN
    assert a_ent["reason"] == "class_conversion" and a_ent["review_mode"] is None
    for user in (world["b"], world["c"]):
        (row,) = await pg.ents(user)
        assert row["expires_at"] is None
    for user in (world["a"], world["b"], world["c"]):
        assert await pg.grants(user) == [10]
        assert converted[user]["balance"] == 10
    events = await pg.con.fetch("SELECT * FROM entitlement_events WHERE entitlement_id = $1", a_ent["id"])
    assert len(events) == 1 and events[0]["action"] == "grant" and events[0]["actor_kind"] == "admin"

    again = await pg.convert(world["cohort"], world["product"], 10, key)
    assert again["status"] == "replay" and again["converted"] == []
    assert {s["reason"] for s in again["skipped"]} == {"already_metered", "no_account"}
    other_key = await pg.convert(world["cohort"], world["product"], 25)
    assert other_key["status"] == "converted" and other_key["converted"] == []
    for user in (world["a"], world["b"], world["c"]):
        assert len(await pg.ents(user)) == 1 and await pg.grants(user) == [10]

    e = await pg.user()
    await pg.member(world["cohort"], e)
    later = await pg.convert(world["cohort"], world["product"], 6)
    assert list(_by_user(later)) == [e] and await pg.grants(e) == [6]
    assert await pg.grants(world["a"]) == [10]
    # Codes, assignments, memberships and the class row did not change (rows and hashes),
    # except the membership row added for E above.
    e_student = await pg.con.fetchval("SELECT id FROM students WHERE user_id = $1", e)
    await pg.con.execute("DELETE FROM student_cohort_memberships WHERE student_id = $1", e_student)
    assert await pg.fingerprint() == before


@pytest.mark.asyncio
async def test_already_metered_and_a_conversion_that_ended(pg):
    world = await _class(pg)
    # B already has a usable class entitlement for this course from a new (product) code.
    await pg.entitlement(world["b"], world["product"], credits=3, source="access_code")
    # A once had one that is now over: a past one does not meter, so A is converted.
    await pg.entitlement(world["a"], world["product"], starts=datetime(2020, 1, 1, tzinfo=timezone.utc),
                         days=30, source="access_code")
    result = await pg.convert(world["cohort"], world["product"], 5)
    assert set(_by_user(result)) == {world["a"], world["c"]}
    assert {"user_id": str(world["b"]), "reason": "already_metered"} in result["skipped"]
    # A converted entitlement that was revoked since stays converted: no second one in this class.
    (a_ent,) = await pg.ents(world["a"])
    await pg.rpc("fn_entitlement_admin_revoke", ADMIN, a_ent["id"], "Học viên xin dừng")
    again = await pg.convert(world["cohort"], world["product"], 5)
    assert again["converted"] == [] and len(await pg.ents(world["a"])) == 1
    # Same learner in a second class of the same course: one class pool per course.
    second = await pg.cohort(world["course"], name="Lớp tối")
    await pg.member(second, world["c"])
    other = await pg.convert(second, world["product"], 5)
    assert other["converted"] == [] and other["skipped"] == [{"user_id": str(world["c"]), "reason": "already_metered"}]


@pytest.mark.asyncio
async def test_which_codes_count_for_the_expiry(pg):
    product = await pg.product(kind="class")
    course = await pg.con.fetchval("SELECT course_id FROM course_products WHERE id = $1", product)
    cohort = await pg.cohort(course)
    other_cohort = await pg.cohort(course, name="Lớp khác")
    users = {name: await pg.user() for name in ("revoked", "inactive_assign", "two", "other_class", "expired",
                                                "used_by_and_assign_off")}
    for user in users.values():
        await pg.member(cohort, user)
    await pg.code(cohort, expires=40 * D, assign=users["revoked"], revoked=True)
    await pg.code(cohort, expires=40 * D, used_by=users["inactive_assign"], assign=users["inactive_assign"],
                  assignment_active=False)
    await pg.code(cohort, expires=20 * D, assign=users["two"])
    await pg.code(cohort, expires=50 * D, used_by=users["two"])
    await pg.code(other_cohort, expires=40 * D, assign=users["other_class"])
    await pg.code(cohort, expires=-1 * D, assign=users["expired"])
    await pg.code(cohort, expires=30 * D, assign=users["used_by_and_assign_off"], active=False)
    result = await pg.convert(cohort, product, 1)
    expiry = {UUID(i["user_id"]): i["expires_at"] for i in result["converted"]}
    assert len(expiry) == len(users)
    for name in ("revoked", "inactive_assign", "other_class", "expired", "used_by_and_assign_off"):
        assert expiry[users[name]] is None, name
    latest = await pg.con.fetchval("SELECT max(expires_at) FROM access_codes WHERE used_by = $1", users["two"])
    (row,) = await pg.ents(users["two"])
    assert row["expires_at"] == latest


@pytest.mark.asyncio
async def test_refusals_and_zero_credits(pg):
    world = await _class(pg)
    archived = await pg.cohort(world["course"], archived=True)
    no_course = await pg.cohort(None)
    online = await pg.product(kind="online", course=world["course"])
    elsewhere = await pg.product(kind="class")
    assert (await pg.convert(uuid4(), world["product"], 1))["status"] == "cohort_not_found"
    assert (await pg.convert(archived, world["product"], 1))["status"] == "cohort_archived"
    assert (await pg.convert(no_course, world["product"], 1))["status"] == "cohort_has_no_course"
    for product in (online, elsewhere, uuid4()):
        assert (await pg.convert(world["cohort"], product, 1))["status"] == "product_invalid"
    assert await pg.con.fetchval("SELECT count(*) FROM entitlements WHERE source = 'class_conversion'") == 0
    result = await pg.convert(world["cohort"], world["product"], 0)
    assert len(result["converted"]) == 3 and all(i["balance"] == 0 for i in result["converted"])
    assert await pg.con.fetchval("SELECT count(*) FROM credit_ledger") == 0


@pytest.mark.asyncio
async def test_two_admins_at_once_grant_each_member_once(pg):
    for _ in range(10):
        world = await _class(pg)
        cons = [await pg.connect() for _ in range(2)]
        results = await asyncio.gather(*(pg.convert(world["cohort"], world["product"], 4, con=c) for c in cons))
        assert sorted(len(r["converted"]) for r in results) == [0, 3]
        for user in (world["a"], world["b"], world["c"]):
            assert len(await pg.ents(user)) == 1 and await pg.grants(user) == [4]
        for c in cons:
            await c.close()


@pytest.mark.asyncio
async def test_rollback_keeps_the_rows(pg):
    world = await _class(pg)
    await pg.convert(world["cohort"], world["product"], 2)
    await pg.con.execute(pg.sql(ROLLBACK))
    assert await pg.con.fetchval("SELECT to_regprocedure($1)", f"{pg.schema}.{RPC}") is None
    assert await pg.con.fetchval("SELECT count(*) FROM entitlements WHERE source = 'class_conversion'") == 3
    assert await pg.con.fetchval("SELECT count(*) FROM credit_ledger") == 3
    await pg.con.execute(pg.sql(FORWARD))


@pytest.mark.asyncio
async def test_after_conversion_class_work_spends_the_class_credits(pg):
    """Plan 5.18 "Sau khi chuyển" with the real 384/385 RPCs: two credits pay for
    two submissions and the third is refused; grant-extra on the converted
    entitlement works; a revoked member is refused, never graded for free."""
    world = await _class(pg)
    await pg.con.execute(pg.sql((MIGRATIONS / "385_credit_lifecycle.sql").read_text(encoding="utf-8")))
    await pg.convert(world["cohort"], world["product"], 2)
    a, b = world["a"], world["b"]
    sid = await pg.session(a)
    work = {"course_ids": [world["course"]], "kinds": ["class", "repractice"]}
    for _ in range(2):
        assert (await pg.reserve(a, "speaking_response", f"{sid}:{uuid4()}", **work))["status"] == "reserved"
    assert (await pg.reserve(a, "speaking_response", f"{sid}:{uuid4()}", **work))["status"] == "insufficient_credits"
    (a_ent,) = await pg.ents(a)
    extra = await pg.rpc("fn_credit_grant_extra", ADMIN, "admin", a_ent["id"], 1, "Bù lượt cho lớp", uuid4().hex)
    assert extra["status"] == "granted"
    assert (await pg.reserve(a, "speaking_response", f"{sid}:{uuid4()}", **work))["status"] == "reserved"
    (b_ent,) = await pg.ents(b)
    await pg.rpc("fn_entitlement_admin_revoke", ADMIN, b_ent["id"], "Học viên xin dừng")
    bsid = await pg.session(b)
    assert (await pg.reserve(b, "speaking_response", f"{bsid}:{uuid4()}", **work))["status"] == "no_entitlement"
