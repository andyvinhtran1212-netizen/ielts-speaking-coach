"""COURSEACCESS-0055 T002 (G04-T02): migration 384, credit ledger and RPCs (spec label M2/"382").

Static checks read the SQL; the PostgreSQL checks apply 383 and 384 verbatim
(``public.`` rewritten to a throwaway schema) on a LOCAL disposable cluster:
set TEST_PG_URL, and REQUIRE_PG=1 to forbid skips. Race checks open several
connections and repeat 20 times (tasks.md T002 acceptance).
"""
import asyncio
import json
import os
import re
from datetime import timedelta
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

import asyncpg
import pytest
import pytest_asyncio

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
NAME = "384_credit_ledger_enrollment_rpcs.sql"
FORWARD = (MIGRATIONS / NAME).read_text(encoding="utf-8")
ROLLBACK = (MIGRATIONS / "rollback" / NAME).read_text(encoding="utf-8")
M1 = (MIGRATIONS / "383_course_commerce_core.sql").read_text(encoding="utf-8")
NEW_TABLES = ("credit_reservations", "credit_ledger", "credit_cluster_members", "credit_covered_requests")
INTERNAL = ("fn_credit_reservations_guard()", "fn_credit_cluster_members_guard()",
            "fn_enrollment_order_entitlement_match()", "fn_credit_lock_user(uuid)",
            "fn_entitlement_credit_usable(public.entitlements)", "fn_credit_feature_skill(text)",
            "fn_credit_resource_owned(uuid,text,text)",
            "fn_credit_settle_release(public.credit_reservations,text,text)",
            "fn_enrollment_order_event(public.enrollment_orders,text,text,uuid,text,text)",
            "fn_enrollment_order_confirm_result(text,public.entitlements,boolean)")
RPCS = ("fn_credit_usable_balance(uuid)",
        "fn_credit_reserve(uuid,text,integer,text,text,text,integer,uuid[],text[],integer,integer)",
        "fn_credit_commit(uuid)", "fn_credit_release(uuid,text)",
        "fn_credit_commit_for_resource(text,text,text)", "fn_credit_release_for_resource(text,text,text)",
        "fn_credit_expire_reservations(integer)", "fn_credit_balance(uuid)",
        "fn_credit_admin_adjust(uuid,uuid,integer,text,text)",
        "fn_enrollment_order_create(uuid,uuid,text,text,integer)",
        "fn_enrollment_order_learner_action(uuid,text,text,text)",
        "fn_enrollment_order_admin_action(uuid,uuid,text,text,text,timestamptz,integer)",
        "fn_enrollment_order_confirm(uuid,uuid,text,boolean,integer,integer)",
        "fn_enrollment_orders_expire(integer)", "fn_enrollment_order_pay_reminders(integer,integer,integer)",
        "fn_entitlement_admin_grant(uuid,uuid,uuid,integer,integer,text,text,uuid)",
        "fn_entitlement_admin_revoke(uuid,uuid,text)", "fn_entitlement_admin_extend(uuid,uuid,integer,text)",
        "fn_course_product_archive(uuid,uuid)", "fn_deliver_writing_essay_instant(uuid)")

# Pre-383 shapes both files touch (as on staging: 009, 033, 175, 205, 332).
PRE = """
    CREATE TABLE users (id uuid PRIMARY KEY, email text, is_active boolean NOT NULL DEFAULT true,
        suspended_at timestamptz);
    -- Stand-in for the 332 audit trigger: one row per is_active change.
    CREATE TABLE users_audit (user_id uuid, before boolean, after boolean);
    CREATE FUNCTION users_audit_fn() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
        BEGIN INSERT INTO users_audit VALUES (NEW.id, OLD.is_active, NEW.is_active); RETURN NULL; END $$;
    CREATE TRIGGER users_audit AFTER UPDATE OF is_active ON users FOR EACH ROW EXECUTE FUNCTION users_audit_fn();
    CREATE FUNCTION update_updated_at_column() RETURNS trigger LANGUAGE plpgsql
        SET search_path = pg_catalog, pg_temp AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
    CREATE TABLE courses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE,
        name text NOT NULL);
    CREATE TABLE access_codes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE,
        is_used boolean NOT NULL DEFAULT false, used_by uuid, used_at timestamptz,
        is_revoked boolean DEFAULT false, is_active boolean NOT NULL DEFAULT true, expires_at timestamptz);
    CREATE TABLE user_code_assignments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_id uuid NOT NULL REFERENCES access_codes(id) ON DELETE CASCADE,
        assigned_at timestamptz NOT NULL DEFAULT now(), is_active boolean NOT NULL DEFAULT true);
    CREATE TABLE sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL);
    CREATE TABLE students (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
    CREATE TABLE writing_essays (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        status text NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'grading', 'graded', 'reviewed', 'delivered', 'failed')),
        delivered_at timestamptz,
        delivery_method text CHECK (delivery_method IS NULL OR delivery_method IN
            ('google_docs_paste', 'word_download', 'gdocs_api', 'web_view')),
        deleted_at timestamptz);
"""


def _body(sql: str) -> str:
    return re.sub(r"--[^\n]*", "", sql)


# ── Static ──────────────────────────────────────────────────────────────────

def test_one_transaction_definer_functions_and_privileges():
    body = _body(FORWARD)
    assert body.count("BEGIN;") == 1 and body.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s'" in body
    assert "SET LOCAL search_path = pg_catalog, pg_temp" in body
    functions = re.findall(r"CREATE OR REPLACE FUNCTION public\.(\w+)\(", body)
    assert sorted(functions) == sorted(s.split("(")[0] for s in INTERNAL + RPCS)
    for block in re.split(r"CREATE OR REPLACE FUNCTION ", body)[1:]:
        header = block.split("AS $$", 1)[0]
        assert "SECURITY DEFINER" in header and "SET search_path = pg_catalog, pg_temp" in header, header
    for signature in INTERNAL:
        name = signature.split("(")[0]
        assert re.search(rf"REVOKE ALL ON FUNCTION public\.{name}\(", body), name
    for signature in RPCS:
        assert f"'public.{signature}'::regprocedure" in body, signature
    # Only session-free locks (Supabase pooler in transaction mode).
    assert "pg_advisory_xact_lock" in body and not re.search(r"pg_advisory_lock\(", body)
    assert not re.search(r"FROM public\.users[^;]*FOR UPDATE", body)


def test_admin_adjust_writes_the_reason_column_as_a_literal():
    """SA-2335-R7-C2: p_reason only ever reaches the note."""
    body = _body(FORWARD)
    adjust = body.split("FUNCTION public.fn_credit_admin_adjust(", 1)[1].split("$$;", 1)[0]
    insert = re.search(r"INSERT INTO public\.credit_ledger \(([^)]*)\)\s*VALUES \(([^;]*)\)", adjust)
    columns = [c.strip() for c in insert.group(1).split(",")]
    values = [v.strip() for v in insert.group(2).split(",")]
    assert values[columns.index("reason")] == "'admin_adjust'"
    assert values[columns.index("note")] == "p_reason"


def test_no_seed_and_every_object_is_qualified():
    body = _body(FORWARD)
    assert not re.search(r"INSERT INTO public\.(course_products|courses|entitlements)\s+SELECT", body)
    for table in (*NEW_TABLES, "entitlements", "enrollment_orders", "users", "sessions", "writing_essays",
                  "course_products", "learner_email_outbox", "students"):
        for match in re.finditer(rf"\b(?:FROM|INTO|UPDATE|JOIN|REFERENCES|TABLE)\s+{table}\b", body):
            pytest.fail(f"unqualified {table}: {match.group(0)}")


def test_rollback_keeps_tables_and_needs_opt_in_when_the_ledger_has_rows():
    body = _body(ROLLBACK)
    assert "aver.allow_commerce_rollback" in body and "DROP TABLE" not in body
    assert "DROP FUNCTION IF EXISTS public.fn_credit_reserve(" in body


# ── PostgreSQL harness ──────────────────────────────────────────────────────

def _url() -> str:
    url = os.environ.get("TEST_PG_URL")
    if not url:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("TEST_PG_URL is required")
        pytest.skip("Disposable TEST_PG_URL is not configured")
    target = urlsplit(url)
    assert target.hostname in {"127.0.0.1", "localhost", "::1"}
    assert target.path == "/postgres" or target.path.lstrip("/").startswith("aver_")
    return url


class Harness:
    def __init__(self, con: asyncpg.Connection, schema: str):
        self.con, self.schema = con, schema
        self.extra: list[asyncpg.Connection] = []

    def sql(self, text: str) -> str:
        return text.replace("public.", f"{self.schema}.")

    async def connect(self) -> asyncpg.Connection:
        other = await asyncpg.connect(_url())
        await other.execute(f"SET search_path = {self.schema}, pg_catalog")
        self.extra.append(other)
        return other

    async def rpc(self, name: str, *args, con=None):
        con = con or self.con
        params = ", ".join(f"${i}" for i in range(1, len(args) + 1))
        return json.loads(await con.fetchval(f"SELECT {name}({params})", *args))

    async def rollback(self, opt_in: bool = False):
        await self.con.execute(f"SET aver.allow_commerce_rollback = '{'on' if opt_in else 'off'}'")
        try:
            await self.con.execute(self.sql(ROLLBACK))
        finally:
            if self.con.is_in_transaction():
                await self.con.execute("ROLLBACK")
            await self.con.execute("RESET aver.allow_commerce_rollback")

    async def user(self, active=True):
        uid = uuid4()
        await self.con.execute("INSERT INTO users (id, email, is_active) VALUES ($1, $2, $3)",
                               uid, f"{uid.hex[:8]}@example.test", active)
        return uid

    async def product(self, kind="online", features=("speaking", "writing"), course=None, **columns):
        course = course or await self.con.fetchval(
            "INSERT INTO courses (code, name) VALUES ($1, 'Course') RETURNING id", "C" + uuid4().hex[:6])
        values = {"course_id": course, "slug": "p-" + uuid4().hex[:10], "kind": kind, "title": "Khoá thử",
                  "features": list(features), **columns}
        if kind == "online":
            values = {"status": "open", "is_public": True, "tuition_vnd": 1_000_000, "access_days": 30,
                      **values}
        names = ", ".join(values)
        params = ", ".join(f"${i}" for i in range(1, len(values) + 1))
        return await self.con.fetchval(f"INSERT INTO course_products ({names}) VALUES ({params}) RETURNING id",
                                       *values.values())

    async def entitlement(self, user, product, credits=0, starts=None, days=30, credits_days=None,
                          source="admin_grant"):
        course = await self.con.fetchval("SELECT course_id FROM course_products WHERE id = $1", product)
        ent = await self.con.fetchval(
            """INSERT INTO entitlements (user_id, product_id, course_id, source, source_ref, starts_at,
                                         expires_at, credits_expire_at)
               VALUES ($1, $2, $3, $4, gen_random_uuid(), coalesce($5, now()),
                       coalesce($5, now()) + make_interval(days => $6),
                       CASE WHEN $7::int IS NULL THEN NULL ELSE coalesce($5, now()) + make_interval(days => $7) END)
               RETURNING id""",
            user, product, course, source, starts, days, credits_days)
        if credits:
            await self.con.execute(
                "INSERT INTO credit_ledger (user_id, entitlement_id, delta, reason, idempotency_key) "
                "VALUES ($1, $2, $3, 'grant', $4)", user, ent, credits, f"test:{ent}:grant")
        return ent

    async def session(self, user):
        return await self.con.fetchval("INSERT INTO sessions (user_id) VALUES ($1) RETURNING id", user)

    async def essay(self, user, status="pending", review_mode=None):
        student = await self.con.fetchval("INSERT INTO students (user_id) VALUES ($1) RETURNING id", user)
        return await self.con.fetchval(
            "INSERT INTO writing_essays (student_id, status, review_mode) VALUES ($1, $2, $3) RETURNING id",
            student, status, review_mode)

    async def reserve(self, user, resource_type, resource_id, key=None, feature="speaking_grading", cost=1,
                      course_ids=None, kinds=None, con=None):
        return await self.rpc("fn_credit_reserve", user, feature, cost, key or uuid4().hex, resource_type,
                              resource_id, 600, course_ids, kinds, 3, 1, con=con)

    async def balance(self, user):
        return (await self.rpc("fn_credit_balance", user))["total"]

    async def order(self, user, product, pay_hours=48):
        code = "AVER-" + "".join(__import__("random").choice("23456789ABCDEFGHJKMNPQRSTUVWXYZ") for _ in range(6))
        result = await self.rpc("fn_enrollment_order_create", user, product, code, uuid4().hex, pay_hours)
        assert result["status"] == "created", result
        return result["order"]

    async def outbox(self, template=None):
        if template:
            return await self.con.fetchval("SELECT count(*) FROM learner_email_outbox WHERE template = $1", template)
        return await self.con.fetchval("SELECT count(*) FROM learner_email_outbox")


@pytest_asyncio.fixture
async def pg():
    con = await asyncpg.connect(_url())
    schema = "credit_" + uuid4().hex
    harness = Harness(con, schema)
    try:
        for role in ("anon", "authenticated", "service_role"):
            await con.execute(f"DO $$ BEGIN CREATE ROLE {role}; EXCEPTION WHEN duplicate_object THEN NULL; END $$")
        await con.execute(f"CREATE SCHEMA {schema}; SET search_path = {schema}, pg_catalog;" + PRE)
        await con.execute(f"GRANT USAGE ON SCHEMA {schema} TO anon, authenticated, service_role")
        await con.execute(harness.sql(M1))
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


ADMIN = uuid4()  # inserted as a user by the fixture


# ── Schema and privileges ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_rls_on_and_writes_only_through_definer_rpcs(pg):
    con = pg.con
    for table in NEW_TABLES:
        assert await con.fetchval("SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass",
                                  f"{pg.schema}.{table}")
        for role in ("anon", "authenticated"):
            await con.execute(f"SET ROLE {role}")
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await con.fetch(f"SELECT 1 FROM {table} LIMIT 1")
            await con.execute("RESET ROLE")
    await con.execute("SET ROLE service_role")
    await con.fetch("SELECT 1 FROM credit_ledger LIMIT 1")
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        await con.execute("INSERT INTO credit_ledger (user_id, entitlement_id, delta, reason, idempotency_key) "
                          "VALUES (gen_random_uuid(), gen_random_uuid(), 1, 'grant', 'x')")
    await con.execute("RESET ROLE")
    for signature in INTERNAL + RPCS:
        qualified = f"{pg.schema}.{signature.replace('public.', pg.schema + '.')}"
        row = await con.fetchrow("SELECT prosecdef, proconfig FROM pg_proc WHERE oid = to_regprocedure($1)",
                                 qualified)
        assert row and row["prosecdef"] and row["proconfig"] == ["search_path=pg_catalog, pg_temp"], signature
        for role in ("anon", "authenticated"):
            assert not await con.fetchval("SELECT has_function_privilege($1, $2, 'EXECUTE')", role, qualified)
        assert await con.fetchval("SELECT has_function_privilege('service_role', $1, 'EXECUTE')",
                                  qualified) == (signature in RPCS), signature
    assert await con.fetchval("SELECT count(*) FROM credit_ledger") == 0  # no seed


@pytest.mark.asyncio
async def test_ledger_and_reservations_are_append_only(pg):
    con = pg.con
    user = await pg.user()
    ent = await pg.entitlement(user, await pg.product(), credits=2)
    held = await pg.reserve(user, "speaking_response", f"{await pg.session(user)}:{uuid4()}")
    for statement in ("UPDATE credit_ledger SET delta = 5", "DELETE FROM credit_ledger", "TRUNCATE credit_ledger"):
        with pytest.raises(asyncpg.RaiseError, match="credit_ledger_append_only"):
            await con.execute(statement)
    with pytest.raises(asyncpg.RaiseError, match="credit_reservation_immutable"):
        await con.execute("UPDATE credit_reservations SET cost = 2")
    with pytest.raises(asyncpg.RaiseError, match="credit_reservation_append_only"):
        await con.execute("DELETE FROM credit_reservations")
    assert (await pg.rpc("fn_credit_commit", _uuid(held["reservation_id"])))["status"] == "committed"
    with pytest.raises(asyncpg.RaiseError, match="credit_reservation_immutable"):
        await con.execute("UPDATE credit_reservations SET status = 'released', release_reason = 'admin'")
    # service_role has no write at all.
    await con.execute("SET ROLE service_role")
    for statement in ("UPDATE credit_ledger SET delta = 5", "DELETE FROM credit_ledger"):
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await con.execute(statement)
    await con.execute("RESET ROLE")
    assert await con.fetchval("SELECT sum(delta) FROM credit_ledger WHERE entitlement_id = $1", ent) == 1


# ── Reservations ────────────────────────────────────────────────────────────

def _uuid(value):
    return __import__("uuid").UUID(value)


@pytest.mark.asyncio
async def test_reserve_commit_release_and_replay_rules(pg):
    con = pg.con
    user = await pg.user()
    await pg.entitlement(user, await pg.product(), credits=3)
    sid = await pg.session(user)
    resource = f"{sid}:{uuid4()}"
    first = await pg.reserve(user, "speaking_response", resource, key="submission-1")
    assert first["status"] == "reserved" and first["balance_after"] == 2 and first["product_kind"] == "online"
    # Same key while open: replay, nothing written.
    rows = await con.fetchval("SELECT count(*) FROM credit_ledger")
    assert (await pg.reserve(user, "speaking_response", resource, key="submission-1"))["status"] == "replay"
    assert (await pg.reserve(user, "speaking_response", f"{sid}:{uuid4()}", key="submission-1"))["status"] \
        == "request_key_conflict"
    assert await con.fetchval("SELECT count(*) FROM credit_ledger") == rows
    assert (await pg.rpc("fn_credit_commit", _uuid(first["reservation_id"])))["status"] == "committed"
    assert (await pg.rpc("fn_credit_commit", _uuid(first["reservation_id"])))["status"] == "already_committed"
    assert (await pg.rpc("fn_credit_release", _uuid(first["reservation_id"]), "grader_failed"))["status"] == "not_open"
    # 10b: a later key does not change the committed one.
    assert (await pg.reserve(user, "speaking_response", f"{sid}:{uuid4()}", key="submission-2"))["status"] == "reserved"
    assert (await pg.reserve(user, "speaking_response", resource, key="submission-1"))["status"] == "already_committed"
    assert await pg.balance(user) == 1
    # Release returns the credit once; a released key is a conflict afterwards.
    third = await pg.reserve(user, "speaking_response", f"{sid}:{uuid4()}", key="submission-3")
    assert (await pg.rpc("fn_credit_release", _uuid(third["reservation_id"]), "grader_failed"))["status"] == "released"
    assert (await pg.rpc("fn_credit_release", _uuid(third["reservation_id"]), "grader_failed"))["status"] \
        == "already_released"
    assert await pg.balance(user) == 1
    assert (await pg.reserve(user, "speaking_response", "x", key="submission-3"))["status"] == "request_key_conflict"
    # Expiry job.
    fourth = await pg.reserve(user, "writing_essay", str(await pg.essay(user)), feature="writing_grading")
    await con.execute("ALTER TABLE credit_reservations DISABLE TRIGGER trg_credit_reservations_guard")
    await con.execute("UPDATE credit_reservations SET expires_at = now() - interval '1 minute' WHERE id = $1",
                      _uuid(fourth["reservation_id"]))
    await con.execute("ALTER TABLE credit_reservations ENABLE TRIGGER trg_credit_reservations_guard")
    assert await pg.balance(user) == 0
    assert (await pg.rpc("fn_credit_expire_reservations", 100)) == {"expired": 1}
    assert await pg.balance(user) == 1
    assert await con.fetchval("SELECT release_reason FROM credit_reservations WHERE id = $1",
                              _uuid(fourth["reservation_id"])) == "expired"
    # By resource (background Writing).
    essay = str(await pg.essay(user))
    await pg.reserve(user, "writing_essay", essay, feature="writing_grading")
    assert (await pg.rpc("fn_credit_commit_for_resource", "writing_essay", essay, None))["status"] == "committed"
    assert (await pg.rpc("fn_credit_release_for_resource", "writing_essay", essay, "grader_failed"))["status"] == "none"
    assert await pg.balance(user) == 0
    assert (await pg.reserve(user, "speaking_response", f"{sid}:{uuid4()}"))["status"] == "insufficient_credits"


@pytest.mark.asyncio
async def test_owner_check_comes_first(pg):
    con = pg.con
    user, other = await pg.user(), await pg.user()
    await pg.entitlement(user, await pg.product(), credits=5)
    theirs = await pg.session(other)
    for resource_type, resource_id in (
            ("speaking_response", f"{theirs}:{uuid4()}"),
            ("speaking_cluster", f"{theirs}:p1:q{uuid4()}"),
            ("writing_essay", str(await pg.essay(other))),
            ("short_writing", str(uuid4())),  # TOPICKNOW-0097 table not there yet
            ("speaking_response", "not-a-resource")):
        assert (await pg.reserve(user, resource_type, resource_id))["status"] == "not_owner"
    assert await con.fetchval("SELECT count(*) FROM credit_cluster_members") == 0
    assert await con.fetchval("SELECT count(*) FROM credit_reservations") == 0
    # The owner check also runs before the entitlement lookup.
    assert (await pg.reserve(other, "speaking_response", f"{theirs}:{uuid4()}"))["status"] == "no_entitlement"


@pytest.mark.asyncio
async def test_entitlement_choice_filters_and_one_shared_pool(pg):
    con = pg.con
    user = await pg.user()
    sid = await pg.session(user)
    late = await pg.entitlement(user, await pg.product(), credits=1, days=60)
    early = await pg.entitlement(user, await pg.product(), credits=1, days=60, credits_days=10)
    await con.execute("ALTER TABLE entitlements DISABLE TRIGGER trg_entitlements_guard")
    future = await pg.entitlement(user, await pg.product(), credits=9,
                                  starts=await con.fetchval("SELECT now() + interval '5 days'"))
    lapsed = await pg.entitlement(user, await pg.product(), credits=9, days=60, credits_days=1)
    await con.execute("UPDATE entitlements SET starts_at = now() - interval '3 days', "
                      "credits_expire_at = now() - interval '1 day' WHERE id = $1", lapsed)
    await con.execute("ALTER TABLE entitlements ENABLE TRIGGER trg_entitlements_guard")
    first = await pg.reserve(user, "speaking_response", f"{sid}:{uuid4()}")
    assert _uuid(first["entitlement_id"]) == early  # credits lapse first
    second = await pg.reserve(user, "speaking_response", f"{sid}:{uuid4()}")
    assert _uuid(second["entitlement_id"]) not in {future, lapsed, early}
    balance = await pg.rpc("fn_credit_balance", user)
    by_id = {_uuid(i["entitlement_id"]): i for i in balance["items"]}
    assert future in by_id and lapsed not in by_id
    assert balance["total"] == sum(i["balance"] for e, i in by_id.items() if e != future)
    # Filters by course and kind.
    other_user = await pg.user()
    osid = await pg.session(other_user)
    course = await con.fetchval("INSERT INTO courses (code, name) VALUES ('CX1', 'X') RETURNING id")
    class_product = await pg.product("class", course=course)
    await pg.entitlement(other_user, class_product, credits=1)
    assert (await pg.reserve(other_user, "speaking_response", f"{osid}:{uuid4()}",
                             course_ids=[uuid4()]))["status"] == "no_entitlement"
    assert (await pg.reserve(other_user, "speaking_response", f"{osid}:{uuid4()}",
                             kinds=["online"]))["status"] == "no_entitlement"
    one = await pg.reserve(other_user, "writing_essay", str(await pg.essay(other_user)), feature="writing_grading",
                           course_ids=[course], kinds=["class", "repractice"])
    assert one["status"] == "reserved" and one["product_kind"] == "class"
    # One shared pool: the last credit served Writing, so Speaking now has none.
    assert (await pg.reserve(other_user, "speaking_response", f"{osid}:{uuid4()}"))["status"] \
        == "insufficient_credits"
    # Feature map: short_writing_feedback needs writing in features.
    speaking_only = await pg.user()
    await pg.entitlement(speaking_only, await pg.product(features=("speaking",)), credits=3)
    await con.execute("CREATE TABLE short_writing_submissions (id uuid PRIMARY KEY, user_id uuid NOT NULL)")
    sub = uuid4()
    await con.execute("INSERT INTO short_writing_submissions VALUES ($1, $2)", sub, speaking_only)
    assert (await pg.reserve(speaking_only, "short_writing", str(sub),
                             feature="short_writing_feedback"))["status"] == "no_entitlement"
    await pg.entitlement(speaking_only, await pg.product(features=("writing",)), credits=1)
    assert (await pg.reserve(speaking_only, "short_writing", str(sub),
                             feature="short_writing_feedback"))["status"] == "reserved"
    assert late  # chosen only after the earlier credit window


@pytest.mark.asyncio
async def test_ten_concurrent_reservations_for_the_last_credit(pg):
    con = pg.con
    user = await pg.user()
    sid = await pg.session(user)
    others = [await pg.connect() for _ in range(10)]
    for _ in range(20):
        await pg.entitlement(user, await pg.product(), credits=1)
        results = await asyncio.gather(*(
            pg.reserve(user, "speaking_response", f"{sid}:{uuid4()}", con=c) for c in others))
        statuses = sorted(r["status"] for r in results)
        assert statuses == ["insufficient_credits"] * 9 + ["reserved"], statuses
        assert await pg.balance(user) == 0
    assert await con.fetchval("SELECT min(b.balance) FROM entitlements e "
                              "CROSS JOIN LATERAL fn_credit_usable_balance(e.id) b") == 0


@pytest.mark.asyncio
async def test_speaking_cluster_covers_three_questions(pg):
    con = pg.con
    user = await pg.user()
    await pg.entitlement(user, await pg.product(), credits=1)
    sid = await pg.session(user)
    questions = [uuid4() for _ in range(4)]
    results = [await pg.reserve(user, "speaking_cluster", f"{sid}:p1:q{q}") for q in questions[:3]]
    assert [r["status"] for r in results] == ["reserved", "covered", "covered"]
    assert await con.fetchval("SELECT count(*) FROM credit_ledger WHERE reason = 'reserve'") == 1
    fourth = await pg.reserve(user, "speaking_cluster", f"{sid}:p1:q{questions[3]}")
    assert fourth["status"] == "insufficient_credits"
    assert await con.fetchval("SELECT cluster_k FROM credit_cluster_members WHERE question_id = $1",
                              questions[3]) == 1
    # Same question again, new key: a free re-grade once (N-3), then a separate charge.
    again = await pg.reserve(user, "speaking_cluster", f"{sid}:p1:q{questions[1]}")
    assert again["status"] == "covered" and again["regrade_count"] == 1
    assert (await pg.reserve(user, "speaking_cluster", f"{sid}:p1:q{questions[1]}"))["status"] == "regrade_limit"
    # Part 3 is a separate cluster series.
    assert (await pg.reserve(user, "speaking_cluster", f"{sid}:p3:q{uuid4()}"))["status"] == "insufficient_credits"


@pytest.mark.asyncio
async def test_concurrent_submissions_of_one_cluster(pg):
    con = pg.con
    user = await pg.user()
    others = [await pg.connect() for _ in range(5)]
    for _ in range(20):
        await pg.entitlement(user, await pg.product(), credits=5)
        sid = await pg.session(user)
        question = uuid4()
        results = await asyncio.gather(*(
            pg.reserve(user, "speaking_cluster", f"{sid}:p1:q{question}", con=c) for c in others))
        statuses = sorted(r["status"] for r in results)
        # The first reserves; the others are free re-grades or past the limit,
        # never a second charge.
        assert statuses.count("reserved") == 1, statuses
        assert set(statuses) <= {"reserved", "covered", "regrade_limit"}, statuses
        # Four different questions at once: exactly two clusters, two credits.
        sid = await pg.session(user)
        before = await pg.balance(user)
        results = await asyncio.gather(*(
            pg.reserve(user, "speaking_cluster", f"{sid}:p1:q{uuid4()}", con=c) for c in others[:4]))
        assert sorted(r["status"] for r in results) == ["covered", "covered", "reserved", "reserved"]
        assert before - await pg.balance(user) == 2
    assert await con.fetchval("SELECT count(DISTINCT cluster_k) FROM credit_cluster_members "
                              "WHERE session_id = $1", sid) == 2


@pytest.mark.asyncio
async def test_cluster_seats_stay_fixed_when_a_hold_is_released(pg):
    """Codex case: c0 and c1 full, c1 committed, c0 released."""
    con = pg.con
    user = await pg.user()
    await pg.entitlement(user, await pg.product(), credits=10)
    sid = await pg.session(user)
    questions = [uuid4() for _ in range(7)]
    results = [await pg.reserve(user, "speaking_cluster", f"{sid}:p1:q{q}") for q in questions[:6]]
    assert [r["status"] for r in results] == ["reserved", "covered", "covered"] * 2
    await pg.rpc("fn_credit_commit", _uuid(results[3]["reservation_id"]))
    assert (await pg.rpc("fn_credit_release", _uuid(results[0]["reservation_id"]), "grader_failed"))["status"] \
        == "released"
    assert await con.fetchval("SELECT count(*) FROM credit_cluster_members WHERE session_id = $1", sid) == 6
    assert await con.fetchval("SELECT count(*) FROM credit_cluster_members WHERE cluster_k = 0 "
                              "AND reservation_id IS NOT NULL") == 0
    seventh = await pg.reserve(user, "speaking_cluster", f"{sid}:p1:q{questions[6]}")
    assert seventh["status"] == "reserved" and seventh["cluster_k"] == 2
    resubmit = await pg.reserve(user, "speaking_cluster", f"{sid}:p1:q{questions[1]}")
    assert resubmit["status"] == "reserved" and resubmit["cluster_k"] == 0
    assert (await pg.reserve(user, "speaking_cluster", f"{sid}:p1:q{questions[2]}"))["status"] == "covered"
    # An expired cluster hold also frees the cluster, keeping its members.
    await con.execute("ALTER TABLE credit_reservations DISABLE TRIGGER trg_credit_reservations_guard")
    await con.execute("UPDATE credit_reservations SET expires_at = now() - interval '1 minute' WHERE id = $1",
                      _uuid(seventh["reservation_id"]))
    await con.execute("ALTER TABLE credit_reservations ENABLE TRIGGER trg_credit_reservations_guard")
    assert (await pg.rpc("fn_credit_expire_reservations", 10))["expired"] == 1
    assert await con.fetchval("SELECT count(*) FROM credit_cluster_members WHERE cluster_k = 2") == 1
    assert (await pg.reserve(user, "speaking_cluster", f"{sid}:p1:q{uuid4()}"))["status"] == "reserved"
    # Members are fixed: no update of the seat itself.
    with pytest.raises(asyncpg.RaiseError, match="credit_cluster_member_immutable"):
        await con.execute("UPDATE credit_cluster_members SET cluster_k = 9")


@pytest.mark.asyncio
async def test_covered_replay_does_not_spend_another_free_regrade(pg):
    """FR-014 (review on 74a845c): a covered answer is replayed by its request key."""
    con = pg.con
    user = await pg.user()
    await pg.entitlement(user, await pg.product(), credits=1)
    sid = await pg.session(user)
    q1, q2 = uuid4(), uuid4()
    first = await pg.reserve(user, "speaking_cluster", f"{sid}:p1:q{q1}")
    covered = await pg.reserve(user, "speaking_cluster", f"{sid}:p1:q{q2}", key="q2-first-key")
    assert covered["status"] == "covered" and covered["regrade_count"] == 0
    regrade = await pg.reserve(user, "speaking_cluster", f"{sid}:p1:q{q2}", key="q2-regrade-key")
    assert regrade["status"] == "covered" and regrade["regrade_count"] == 1
    rows = await con.fetchval("SELECT count(*) FROM credit_covered_requests")
    for _ in range(3):  # replays: never 'covered' again, nothing written, no extra regrade spent
        again = await pg.reserve(user, "speaking_cluster", f"{sid}:p1:q{q2}", key="q2-regrade-key")
        assert (again["status"], again["regrade_count"], again["covered"]) == ("replay", 1, True)
        assert again["reservation_id"] == first["reservation_id"]
    assert await con.fetchval("SELECT count(*) FROM credit_covered_requests") == rows
    assert await con.fetchval("SELECT regrade_count FROM credit_cluster_members WHERE question_id = $1", q2) == 1
    assert (await pg.reserve(user, "speaking_cluster", f"{sid}:p1:q{q2}", key="q2-third-key"))["status"] \
        == "regrade_limit"
    # The covered key cannot be reused for another resource.
    assert (await pg.reserve(user, "speaking_cluster", f"{sid}:p1:q{uuid4()}", key="q2-first-key"))["status"] \
        == "request_key_conflict"
    with pytest.raises(asyncpg.RaiseError, match="credit_covered_requests_append_only"):
        await con.execute("DELETE FROM credit_covered_requests")


@pytest.mark.asyncio
async def test_covered_replay_follows_the_cover_hold_state(pg):
    """HOLD on 6277f9ea: a covered replay never tells the wrapper to grade again."""
    user = await pg.user()
    await pg.entitlement(user, await pg.product(), credits=5)
    seen = []
    for final in ("open", "committed", "released", "expired"):
        sid = await pg.session(user)
        first = await pg.reserve(user, "speaking_cluster", f"{sid}:p1:q{uuid4()}")
        q2 = uuid4()
        key = f"cover-{final}-key"
        assert (await pg.reserve(user, "speaking_cluster", f"{sid}:p1:q{q2}", key=key))["status"] == "covered"
        hold = _uuid(first["reservation_id"])
        if final == "committed":
            await pg.rpc("fn_credit_commit", hold)
        elif final == "released":
            await pg.rpc("fn_credit_release", hold, "grader_failed")
        elif final == "expired":
            await pg.con.execute("ALTER TABLE credit_reservations DISABLE TRIGGER trg_credit_reservations_guard")
            await pg.con.execute("UPDATE credit_reservations SET expires_at = now() - interval '1 minute' "
                                 "WHERE id = $1", hold)
            await pg.con.execute("ALTER TABLE credit_reservations ENABLE TRIGGER trg_credit_reservations_guard")
            assert (await pg.rpc("fn_credit_expire_reservations", 10))["expired"] == 1
        again = await pg.reserve(user, "speaking_cluster", f"{sid}:p1:q{q2}", key=key)
        assert again["covered"] is True and again["reservation_id"] == first["reservation_id"]
        seen.append(again["status"])
    assert seen == ["replay", "already_committed", "request_key_conflict", "request_key_conflict"]


@pytest.mark.asyncio
async def test_no_coverage_from_a_hold_released_concurrently(pg):
    """Review on 74a845c: covered never points at a released hold."""
    con = pg.con
    user = await pg.user()
    await pg.entitlement(user, await pg.product(), credits=50)
    other = await pg.connect()
    for _ in range(20):
        sid = await pg.session(user)
        opener = await pg.reserve(user, "speaking_cluster", f"{sid}:p1:q{uuid4()}")
        assert opener["status"] == "reserved"
        # The release runs first and holds the row: the covering check waits, then
        # sees the released hold and charges a new credit for the cluster.
        await other.execute("BEGIN")
        await pg.rpc("fn_credit_release", _uuid(opener["reservation_id"]), "grader_failed", con=other)
        follower = asyncio.create_task(pg.reserve(user, "speaking_cluster", f"{sid}:p1:q{uuid4()}"))
        await asyncio.sleep(0.2)
        assert not follower.done()
        await other.execute("COMMIT")
        result = await follower
        assert result["status"] == "reserved", result
        assert await con.fetchval("SELECT status FROM credit_reservations WHERE id = $1",
                                  _uuid(result["reservation_id"])) == "open"
    # The covering answer runs first: a release of its hold waits for it.
    sid = await pg.session(user)
    opener = await pg.reserve(user, "speaking_cluster", f"{sid}:p1:q{uuid4()}")
    await con.execute("BEGIN")
    covered = await pg.reserve(user, "speaking_cluster", f"{sid}:p1:q{uuid4()}")
    assert covered["status"] == "covered"
    release = asyncio.create_task(pg.rpc("fn_credit_release", _uuid(opener["reservation_id"]), "grader_failed",
                                         con=other))
    await asyncio.sleep(0.2)
    assert not release.done()
    await con.execute("COMMIT")
    assert (await release)["status"] == "released"
    assert await con.fetchval("SELECT count(*) FROM credit_cluster_members WHERE reservation_id = $1",
                              _uuid(opener["reservation_id"])) == 0


@pytest.mark.asyncio
async def test_usable_balance_spends_the_carry_first(pg):
    con = pg.con
    user = await pg.user()
    ent = await pg.entitlement(user, await pg.product(), credits=4)
    await con.execute("INSERT INTO credit_ledger (user_id, entitlement_id, delta, reason, idempotency_key) "
                      "VALUES ($1, $2, 7, 'carry_over', 'carry:test')", user, ent)
    await con.execute("UPDATE entitlements SET carry_settled_at = now(), carry_expires_at = now() + interval '9 days' "
                      "WHERE id = $1", ent)
    usable = dict(await con.fetchrow("SELECT * FROM fn_credit_usable_balance($1)", ent))
    assert usable == {"balance": 11, "carry_left": 7, "carry_lapsed": 0}
    sid = await pg.session(user)
    for _ in range(3):
        assert (await pg.reserve(user, "speaking_response", f"{sid}:{uuid4()}"))["status"] == "reserved"
    [item] = (await pg.rpc("fn_credit_balance", user))["items"]
    assert (item["balance"], item["carry_balance"]) == (8, 4)
    # The hold date passes before the 385 job books carry_expire.
    await con.execute("ALTER TABLE entitlements DISABLE TRIGGER trg_entitlements_guard")
    await con.execute("UPDATE entitlements SET carry_expires_at = (SELECT max(created_at) FROM credit_reservations "
                      "WHERE entitlement_id = $1) + interval '1 microsecond' WHERE id = $1", ent)
    await con.execute("ALTER TABLE entitlements ENABLE TRIGGER trg_entitlements_guard")
    usable = dict(await con.fetchrow("SELECT * FROM fn_credit_usable_balance($1)", ent))
    assert usable == {"balance": 4, "carry_left": 0, "carry_lapsed": 4}
    [item] = (await pg.rpc("fn_credit_balance", user))["items"]
    assert (item["balance"], item["carry_balance"], item["carry_expires_at"]) == (4, 0, None)
    for _ in range(4):
        assert (await pg.reserve(user, "speaking_response", f"{sid}:{uuid4()}"))["status"] == "reserved"
    assert (await pg.reserve(user, "speaking_response", f"{sid}:{uuid4()}"))["status"] == "insufficient_credits"
    # Used past the carry before the hold lapsed: only the new term is left.
    user2 = await pg.user()
    ent2 = await pg.entitlement(user2, await pg.product(), credits=4)
    await con.execute("INSERT INTO credit_ledger (user_id, entitlement_id, delta, reason, idempotency_key) "
                      "VALUES ($1, $2, 7, 'carry_over', 'carry:test2')", user2, ent2)
    await con.execute("UPDATE entitlements SET carry_settled_at = now(), carry_expires_at = now() + interval '9 days' "
                      "WHERE id = $1", ent2)
    sid2 = await pg.session(user2)
    for _ in range(9):
        assert (await pg.reserve(user2, "speaking_response", f"{sid2}:{uuid4()}"))["status"] == "reserved"
    await con.execute("ALTER TABLE entitlements DISABLE TRIGGER trg_entitlements_guard")
    await con.execute("UPDATE entitlements SET carry_expires_at = (SELECT max(created_at) FROM credit_reservations "
                      "WHERE entitlement_id = $1) + interval '1 microsecond' WHERE id = $1", ent2)
    await con.execute("ALTER TABLE entitlements ENABLE TRIGGER trg_entitlements_guard")
    assert (await con.fetchrow("SELECT * FROM fn_credit_usable_balance($1)", ent2))["balance"] == 2


@pytest.mark.asyncio
async def test_admin_adjust_reason_is_a_constant(pg):
    con = pg.con
    user = await pg.user()
    ent = await pg.entitlement(user, await pg.product(), credits=2)
    for text in ("expire", "carry_over", "carry_expire"):
        padded = text.ljust(12, ".")
        result = await pg.rpc("fn_credit_admin_adjust", ADMIN, ent, 1, padded, uuid4().hex)
        assert result["status"] == "adjusted"
        row = await con.fetchrow("SELECT reason, note FROM credit_ledger WHERE id = $1", result["ledger_id"])
        assert (row["reason"], row["note"]) == ("admin_adjust", padded)
    rows = await con.fetchval("SELECT count(*) FROM credit_ledger")
    with pytest.raises(asyncpg.CheckViolationError, match="credit_ledger_delta_check"):
        await pg.rpc("fn_credit_admin_adjust", ADMIN, ent, 100001, "Bù lượt lỗi chấm", uuid4().hex)
    assert await con.fetchval("SELECT count(*) FROM credit_ledger") == rows
    key = uuid4().hex
    assert (await pg.rpc("fn_credit_admin_adjust", ADMIN, ent, -5, "Trừ lượt nhầm", key))["status"] == "adjusted"
    assert (await pg.rpc("fn_credit_admin_adjust", ADMIN, ent, -5, "Trừ lượt nhầm", key))["status"] == "replay"
    assert (await pg.rpc("fn_credit_admin_adjust", ADMIN, ent, -1, "Trừ lượt nhầm", uuid4().hex))["status"] \
        == "would_go_negative"
    assert (await pg.rpc("fn_credit_admin_adjust", ADMIN, uuid4(), 1, "Không có quyền", uuid4().hex))["status"] \
        == "not_found"
    await pg.rpc("fn_entitlement_admin_revoke", ADMIN, ent, "Thu hồi thử")
    assert (await pg.rpc("fn_credit_admin_adjust", ADMIN, ent, 1, "Sau thu hồi", uuid4().hex))["status"] \
        == "not_usable"


# ── Enrollment orders ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_order_create_rules(pg):
    con = pg.con
    user = await pg.user()
    product = await pg.product(ai_credits=10)
    key = uuid4().hex
    created = await pg.rpc("fn_enrollment_order_create", user, product, "AVER-ABCDEF", key, 48)
    assert created["status"] == "created" and created["order"]["status"] == "awaiting_transfer"
    assert (await pg.rpc("fn_enrollment_order_create", user, product, "AVER-ABCDEG", key, 48))["status"] == "replay"
    assert (await pg.rpc("fn_enrollment_order_create", user, product, "AVER-ABCDEH", uuid4().hex, 48))["status"] \
        == "existing_open"
    assert (await pg.rpc("fn_enrollment_order_create", await pg.user(), await pg.product(), "AVER-ABCDEF",
                         uuid4().hex, 48))["status"] == "code_collision"
    assert (await pg.rpc("fn_enrollment_order_create", user, await pg.product("class"), "AVER-ABCDEJ",
                         uuid4().hex, 48))["status"] == "product_unavailable"
    suspended = await pg.user(active=False)
    await con.execute("UPDATE users SET suspended_at = now() WHERE id = $1", suspended)
    assert (await pg.rpc("fn_enrollment_order_create", suspended, product, "AVER-ABCDEK", uuid4().hex, 48))["status"] \
        == "account_suspended"
    assert await pg.outbox("order_created") == 1
    assert await con.fetchval("SELECT count(*) FROM enrollment_order_events WHERE action = 'create'") == 1


@pytest.mark.asyncio
async def test_order_transitions_and_outbox_per_row(pg):
    con = pg.con
    user = await pg.user()

    async def fresh():
        return await pg.order(user, await pg.product())

    async def learner(order, action, note=None):
        return await pg.rpc("fn_enrollment_order_learner_action", user, order["order_code"], action, note)

    async def admin(order, action, reason=None, message="Vui lòng bổ sung", by=None, received=None):
        by = by or await con.fetchval("SELECT now() + interval '2 days'")
        return await pg.rpc("fn_enrollment_order_admin_action", ADMIN, _uuid(order["id"]), action, reason, message,
                            by, received)

    order = await fresh()
    before = await pg.outbox()
    assert (await learner(order, "report_transfer"))["status"] == "ok"
    assert (await learner(order, "report_transfer"))["status"] == "invalid_transition"
    assert (await admin(order, "request_info", "not_found"))["status"] == "ok"
    assert (await admin(order, "request_info", "other"))["status"] == "ok"  # marked again
    assert (await learner(order, "supplement", "Đã chuyển bù"))["status"] == "ok"
    assert (await learner(order, "cancel"))["status"] == "ok"
    for action in ("report_transfer", "cancel", "supplement"):
        assert (await learner(order, action, "abc"))["status"] == "invalid_transition"
    assert (await admin(order, "cancel", message="Lý do huỷ"))["status"] == "invalid_transition"
    assert await pg.outbox() - before == 2  # only the two needs_info letters
    # Admin cancel needs a reason; request_info needs a message and a future date.
    order = await fresh()
    assert (await admin(order, "cancel", message="Học viên xin huỷ"))["status"] == "ok"
    order = await fresh()
    with pytest.raises(asyncpg.InvalidParameterValueError, match="invalid_argument"):
        await admin(order, "request_info", "other", message="")
    with pytest.raises(asyncpg.InvalidParameterValueError, match="invalid_argument"):
        await admin(order, "request_info", "other", by=await con.fetchval("SELECT now() - interval '1 hour'"))
    with pytest.raises(asyncpg.InvalidParameterValueError, match="invalid_argument"):
        await admin(order, "request_info", "underpaid")  # received amount required
    with pytest.raises(asyncpg.InvalidParameterValueError, match="invalid_argument"):
        await admin(order, "request_info", "underpaid", received=order["tuition_vnd"])
    # Expiry: system only, no letter; a late transfer report keeps it expired.
    await con.execute("ALTER TABLE enrollment_orders DISABLE TRIGGER trg_enrollment_orders_transition")
    await con.execute("UPDATE enrollment_orders SET pay_by = now() - interval '1 minute' WHERE id = $1",
                      _uuid(order["id"]))
    await con.execute("ALTER TABLE enrollment_orders ENABLE TRIGGER trg_enrollment_orders_transition")
    before = await pg.outbox()
    assert (await pg.rpc("fn_enrollment_orders_expire", 100)) == {"expired": 1}
    late = await learner(order, "report_transfer")
    assert late["status"] == "ok" and late["late"] and late["order"]["status"] == "expired"
    assert late["order"]["late_transfer_reported_at"]
    assert (await learner(order, "cancel"))["status"] == "invalid_transition"
    assert await pg.outbox() == before
    # Someone else's order is not_found.
    assert (await pg.rpc("fn_enrollment_order_learner_action", await pg.user(), order["order_code"], "cancel",
                         None))["status"] == "not_found"


@pytest.mark.asyncio
async def test_needs_info_letters_keep_the_message_exactly(pg):
    con = pg.con
    user = await pg.user()
    order = await pg.order(user, await pg.product())
    messages = ["Thiếu 200.000đ\nvui lòng chuyển bù 'trước' thứ Sáu", 'Nội dung "AVER" chưa khớp']
    for message in messages:
        result = await pg.rpc("fn_enrollment_order_admin_action", ADMIN, _uuid(order["id"]), "request_info",
                              "underpaid", message, await con.fetchval("SELECT now() + interval '1 day'"), 800000)
        assert result["status"] == "ok"
    rows = await con.fetch("SELECT dedupe_key, payload FROM learner_email_outbox WHERE template = 'order_needs_info' "
                           "ORDER BY created_at, dedupe_key")
    assert len({r["dedupe_key"] for r in rows}) == 2
    assert sorted(json.loads(r["payload"])["admin_message"] for r in rows) == sorted(messages)


@pytest.mark.asyncio
async def test_pay_reminders(pg):
    con = pg.con
    user = await pg.user()
    due = await pg.order(user, await pg.product())
    young = await pg.order(user, await pg.product())
    reported = await pg.order(user, await pg.product())
    await pg.rpc("fn_enrollment_order_learner_action", user, reported["order_code"], "report_transfer", None)
    await con.execute("ALTER TABLE enrollment_orders DISABLE TRIGGER trg_enrollment_orders_transition")
    await con.execute("UPDATE enrollment_orders SET created_at = now() - interval '7 hours', "
                      "pay_by = now() + interval '23 hours' WHERE id = ANY($1::uuid[])",
                      [_uuid(due["id"]), _uuid(reported["id"])])
    await con.execute("UPDATE enrollment_orders SET created_at = now() - interval '2 hours', "
                      "pay_by = now() + interval '23 hours' WHERE id = $1", _uuid(young["id"]))
    await con.execute("ALTER TABLE enrollment_orders ENABLE TRIGGER trg_enrollment_orders_transition")
    assert await pg.rpc("fn_enrollment_order_pay_reminders", 24, 6, 100) == {"queued": 1}
    assert await pg.rpc("fn_enrollment_order_pay_reminders", 24, 6, 100) == {"queued": 0}
    # Queued orders do not fill the batch: with p_limit = 1 each sweep queues a new one.
    more = [await pg.order(user, await pg.product()) for _ in range(2)]
    await con.execute("ALTER TABLE enrollment_orders DISABLE TRIGGER trg_enrollment_orders_transition")
    await con.execute("UPDATE enrollment_orders SET created_at = now() - interval '7 hours', "
                      "pay_by = now() + interval '20 hours' WHERE id = ANY($1::uuid[])",
                      [_uuid(o["id"]) for o in more])
    await con.execute("ALTER TABLE enrollment_orders ENABLE TRIGGER trg_enrollment_orders_transition")
    assert [await pg.rpc("fn_enrollment_order_pay_reminders", 24, 6, 1) for _ in range(3)] \
        == [{"queued": 1}, {"queued": 1}, {"queued": 0}]


async def _confirm(pg, order_id, allow_expired=False, window=60, received=None, note=None, con=None):
    return await pg.rpc("fn_enrollment_order_confirm", ADMIN, order_id, note, allow_expired, window, received, con=con)


@pytest.mark.asyncio
async def test_confirm_is_idempotent_and_race_safe(pg):
    con = pg.con
    user = await pg.user()
    order = await pg.order(user, await pg.product(ai_credits=40, credit_valid_days=20))
    first = await _confirm(pg, _uuid(order["id"]))
    assert first["status"] == "confirmed" and first["credits_granted"] == 40 and not first["reopened"]
    assert first["credits_expire_at"] and first["renews_entitlement_id"] is None
    again = await _confirm(pg, _uuid(order["id"]))
    assert again["status"] == "already_confirmed" and again["entitlement_id"] == first["entitlement_id"]
    assert await con.fetchval("SELECT count(*) FROM entitlements WHERE source = 'enrollment_order'") == 1
    assert await con.fetchval("SELECT count(*) FROM credit_ledger WHERE reason = 'grant'") == 1
    assert await pg.outbox("order_confirmed") == 1
    ent = await con.fetchrow("SELECT * FROM entitlements WHERE id = $1", _uuid(first["entitlement_id"]))
    assert ent["expires_at"] - ent["starts_at"] == timedelta(days=30)
    assert ent["credits_expire_at"] - ent["starts_at"] == timedelta(days=20)
    # F4: the order can only point at its own entitlement.
    stranger = await pg.order(await pg.user(), await pg.product())
    await con.execute("ALTER TABLE enrollment_orders DISABLE TRIGGER trg_enrollment_orders_transition")
    with pytest.raises(asyncpg.RaiseError, match="enrollment_order_entitlement_mismatch"):
        await con.execute("UPDATE enrollment_orders SET status = 'confirmed', entitlement_id = $1 WHERE id = $2",
                          ent["id"], _uuid(stranger["id"]))
    await con.execute("ALTER TABLE enrollment_orders ENABLE TRIGGER trg_enrollment_orders_transition")
    # Two admins confirm at once, 20 times: one entitlement, one grant each time.
    a, b = await pg.connect(), await pg.connect()
    for _ in range(20):
        order = await pg.order(await pg.user(), await pg.product(ai_credits=5))
        results = await asyncio.gather(_confirm(pg, _uuid(order["id"]), con=a), _confirm(pg, _uuid(order["id"]), con=b))
        assert sorted(r["status"] for r in results) == ["already_confirmed", "confirmed"]
        assert await con.fetchval("SELECT count(*) FROM entitlements WHERE source_ref = $1", _uuid(order["id"])) == 1
        assert await con.fetchval("SELECT count(*) FROM credit_ledger WHERE idempotency_key = $1",
                                  f"order:{order['id']}:grant") == 1


@pytest.mark.asyncio
async def test_confirm_chains_a_renewal_inside_the_window(pg):
    con = pg.con
    product = await pg.product(access_days=30)
    user = await pg.user()
    current = await pg.entitlement(user, product, days=10)
    order = await pg.order(user, product)
    result = await _confirm(pg, _uuid(order["id"]))
    old_end = await con.fetchval("SELECT expires_at FROM entitlements WHERE id = $1", current)
    new = await con.fetchrow("SELECT * FROM entitlements WHERE id = $1", _uuid(result["entitlement_id"]))
    assert new["starts_at"] == old_end and new["expires_at"] == old_end + timedelta(days=30)
    assert _uuid(result["renews_entitlement_id"]) == current

    async def renewal(days_after_end, confirm_after_end=None, revoke=False, other_product=False):
        learner = await pg.user()
        confirm_day = confirm_after_end or days_after_end + 1
        started = await con.fetchval("SELECT now() - make_interval(days => $1 + 30)", confirm_day)
        previous = await pg.entitlement(learner, product, starts=started, days=30)
        if revoke:
            await pg.rpc("fn_entitlement_admin_revoke", ADMIN, previous, "Thu hồi thử")
        target = await pg.product(course=await con.fetchval("SELECT course_id FROM course_products WHERE id = $1",
                                                            product)) if other_product else product
        order = await pg.order(learner, target)
        await con.execute("ALTER TABLE enrollment_orders DISABLE TRIGGER trg_enrollment_orders_transition")
        await con.execute("UPDATE enrollment_orders SET created_at = $1::timestamptz + make_interval(days => $2) "
                          "WHERE id = $3", started + timedelta(days=30), days_after_end, _uuid(order["id"]))
        await con.execute("ALTER TABLE enrollment_orders ENABLE TRIGGER trg_enrollment_orders_transition")
        result = await _confirm(pg, _uuid(order["id"]))
        assert result["status"] == "confirmed", result
        assert result["starts_at"]  # expired previous term: starts now
        return result["renews_entitlement_id"], previous

    linked, previous = await renewal(59)
    assert _uuid(linked) == previous
    assert (await renewal(61))[0] is None
    assert (await renewal(59, confirm_after_end=70))[0] is not None  # judged by created_at
    assert (await renewal(5, revoke=True))[0] is None
    assert (await renewal(5, other_product=True))[0] is None


@pytest.mark.asyncio
async def test_confirm_account_states_and_expired_orders(pg):
    con = pg.con
    product = await pg.product()
    suspended = await pg.user(active=False)
    order = await pg.order(suspended, product)
    await con.execute("UPDATE users SET suspended_at = now() WHERE id = $1", suspended)
    assert (await _confirm(pg, _uuid(order["id"])))["status"] == "account_suspended"
    assert await con.fetchval("SELECT status FROM enrollment_orders WHERE id = $1", _uuid(order["id"])) \
        == "awaiting_transfer"
    inactive = await pg.user(active=False)
    order = await pg.order(inactive, product)
    assert (await _confirm(pg, _uuid(order["id"])))["status"] == "confirmed"
    assert await con.fetchval("SELECT is_active FROM users WHERE id = $1", inactive)
    assert await con.fetchval("SELECT count(*) FROM users_audit WHERE user_id = $1", inactive) == 1
    active = await pg.user()
    order = await pg.order(active, product)
    await _confirm(pg, _uuid(order["id"]))
    assert await con.fetchval("SELECT count(*) FROM users_audit WHERE user_id = $1", active) == 0
    # Overpaid: a note is required.
    payer = await pg.user()
    order = await pg.order(payer, product)
    with pytest.raises(asyncpg.InvalidParameterValueError, match="overpaid_needs_note"):
        await _confirm(pg, _uuid(order["id"]), received=2_000_000)
    assert (await _confirm(pg, _uuid(order["id"]), received=2_000_000, note="Chuyển thừa, hoàn sau"))["status"] \
        == "confirmed"
    # Expired orders reopen only on request, and not over another open order.
    late = await pg.user()
    order = await pg.order(late, product)
    await con.execute("ALTER TABLE enrollment_orders DISABLE TRIGGER trg_enrollment_orders_transition")
    await con.execute("UPDATE enrollment_orders SET pay_by = now() - interval '1 minute' WHERE id = $1",
                      _uuid(order["id"]))
    await con.execute("ALTER TABLE enrollment_orders ENABLE TRIGGER trg_enrollment_orders_transition")
    await pg.rpc("fn_enrollment_orders_expire", 10)
    assert (await _confirm(pg, _uuid(order["id"])))["status"] == "invalid_transition"
    newer = await pg.order(late, product)
    assert (await _confirm(pg, _uuid(order["id"]), allow_expired=True))["status"] == "has_open_order"
    await pg.rpc("fn_enrollment_order_learner_action", late, newer["order_code"], "cancel", None)
    reopened = await _confirm(pg, _uuid(order["id"]), allow_expired=True)
    assert reopened["status"] == "confirmed" and reopened["reopened"]
    assert await con.fetchval("SELECT reopened_at IS NOT NULL FROM enrollment_orders WHERE id = $1",
                              _uuid(order["id"]))
    cancelled = await pg.order(await pg.user(), product)
    await pg.rpc("fn_enrollment_order_admin_action", ADMIN, _uuid(cancelled["id"]), "cancel", None, "Huỷ thử", None,
                 None)
    assert (await _confirm(pg, _uuid(cancelled["id"]), allow_expired=True))["status"] == "invalid_transition"


# ── Admin entitlement actions, archive, instant Writing ────────────────────

@pytest.mark.asyncio
async def test_admin_grant_revoke_and_extend(pg):
    con = pg.con
    user = await pg.user()
    product = await pg.product("repractice", access_days=20, ai_credits=6, credit_valid_days=10)
    key = uuid4()
    granted = await pg.rpc("fn_entitlement_admin_grant", ADMIN, user, product, None, None, None, "Cấp luyện lại", key)
    assert granted["status"] == "granted" and granted["credits_granted"] == 6
    assert (await pg.rpc("fn_entitlement_admin_grant", ADMIN, user, product, None, None, None, "Cấp luyện lại",
                         key))["status"] == "replay"
    assert await con.fetchval("SELECT count(*) FROM credit_ledger WHERE reason = 'grant'") == 1
    ent = _uuid(granted["entitlement_id"])
    row = await con.fetchrow("SELECT * FROM entitlements WHERE id = $1", ent)
    assert row["expires_at"] - row["starts_at"] == timedelta(days=20)
    assert row["credits_expire_at"] - row["starts_at"] == timedelta(days=10)
    extended = await pg.rpc("fn_entitlement_admin_extend", ADMIN, ent, 5, "Gia hạn thử")
    assert extended["status"] == "extended"
    row2 = await con.fetchrow("SELECT * FROM entitlements WHERE id = $1", ent)
    assert row2["expires_at"] - row["expires_at"] == timedelta(days=5)
    assert row2["credits_expire_at"] - row["credits_expire_at"] == timedelta(days=5)
    assert row2["carry_expires_at"] is None
    assert (await pg.rpc("fn_entitlement_admin_revoke", ADMIN, ent, "Thu hồi thử"))["status"] == "revoked"
    assert (await pg.rpc("fn_entitlement_admin_revoke", ADMIN, ent, "Thu hồi thử"))["status"] == "already_revoked"
    assert (await pg.rpc("fn_entitlement_admin_extend", ADMIN, ent, 5, "Gia hạn thử"))["status"] == "revoked"
    assert await pg.balance(user) == 0
    archived = await pg.product("class")
    await pg.rpc("fn_course_product_archive", ADMIN, archived)
    assert (await pg.rpc("fn_entitlement_admin_grant", ADMIN, user, archived, None, None, None, "Cấp thử",
                         uuid4()))["status"] == "product_invalid"
    closed = await pg.entitlement(user, await pg.product(), credits=1)
    await con.execute("UPDATE entitlements SET credits_closed_at = now() WHERE id = $1", closed)
    assert (await pg.rpc("fn_entitlement_admin_extend", ADMIN, closed, 5, "Gia hạn thử"))["status"] == "credits_closed"
    assert await con.fetchval("SELECT count(*) FROM entitlement_events WHERE action IN ('extend', 'revoke')") == 2


@pytest.mark.asyncio
async def test_product_archive_refuses_with_learners_or_open_orders(pg):
    con = pg.con
    with_learner = await pg.product()
    await pg.entitlement(await pg.user(), with_learner)
    assert (await pg.rpc("fn_course_product_archive", ADMIN, with_learner)) == {"status": "has_active_learners", "n": 1}
    with_order = await pg.product()
    await pg.order(await pg.user(), with_order)
    assert (await pg.rpc("fn_course_product_archive", ADMIN, with_order)) == {"status": "has_open_orders", "n": 1}
    free = await pg.product()
    assert (await pg.rpc("fn_course_product_archive", ADMIN, free))["status"] == "archived"
    assert (await pg.rpc("fn_course_product_archive", ADMIN, free))["status"] == "already_archived"
    row = await con.fetchrow("SELECT status, is_public, archived_at FROM course_products WHERE id = $1", free)
    assert (row["status"], row["is_public"]) == ("closed", False) and row["archived_at"]


@pytest.mark.asyncio
async def test_instant_writing_delivery_only_for_graded_ai_instant(pg):
    con = pg.con
    user = await pg.user()
    instant = await pg.essay(user, "graded", "ai_instant")
    assert (await pg.rpc("fn_deliver_writing_essay_instant", instant))["status"] == "delivered"
    row = await con.fetchrow("SELECT status, delivery_method, delivered_at FROM writing_essays WHERE id = $1", instant)
    assert (row["status"], row["delivery_method"]) == ("delivered", "web_view") and row["delivered_at"]
    assert (await pg.rpc("fn_deliver_writing_essay_instant", await pg.essay(user, "graded", "teacher_review")))["status"] \
        == "not_instant"
    assert (await pg.rpc("fn_deliver_writing_essay_instant", await pg.essay(user, "graded")))["status"] == "not_instant"
    assert (await pg.rpc("fn_deliver_writing_essay_instant", await pg.essay(user, "grading", "ai_instant")))["status"] \
        == "not_graded"
    with pytest.raises(asyncpg.CheckViolationError):
        await pg.essay(user, "pending", "manual")


# ── Rollback ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_rollback_keeps_rows_and_needs_opt_in(pg):
    con = pg.con
    await pg.rollback()  # empty ledger: allowed
    assert await con.fetchval("SELECT to_regprocedure($1)", f"{pg.schema}.fn_credit_balance(uuid)") is None
    await con.execute(pg.sql(FORWARD))
    user = await pg.user()
    await pg.entitlement(user, await pg.product(), credits=1)
    with pytest.raises(asyncpg.ObjectNotInPrerequisiteStateError, match="credit_ledger has rows"):
        await pg.rollback()
    assert await con.fetchval("SELECT to_regprocedure($1)", f"{pg.schema}.fn_credit_balance(uuid)")
    await pg.rollback(opt_in=True)
    assert await con.fetchval("SELECT count(*) FROM credit_ledger") == 1
    with pytest.raises(asyncpg.RaiseError, match="credit_ledger_append_only"):
        await con.execute("DELETE FROM credit_ledger")
    await con.execute(pg.sql(FORWARD))  # forward again after a rollback
    assert await pg.balance(user) == 1
