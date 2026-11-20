"""COURSEACCESS-0055 T001 (G04-T01): migration 383, the course-commerce schema (spec label M1/"381").

Static checks read the SQL; the PostgreSQL checks apply the migration verbatim
(``public.`` rewritten to a throwaway schema) on a LOCAL disposable cluster:
set TEST_PG_URL, and REQUIRE_PG=1 to forbid skips.
"""
import os
import re
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

import asyncpg
import pytest
import pytest_asyncio

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
NAME = "383_course_commerce_core.sql"
FORWARD = (MIGRATIONS / NAME).read_text(encoding="utf-8")
ROLLBACK = (MIGRATIONS / "rollback" / NAME).read_text(encoding="utf-8")
NEW_TABLES = ("course_products", "entitlements", "entitlement_events", "enrollment_orders",
              "enrollment_order_events", "learner_email_outbox")
FUNCTIONS = ("fn_entitlements_guard()", "fn_course_commerce_append_only()",
             "fn_access_codes_product_kind()", "fn_access_code_entitlement_revoke(uuid,uuid,text)",
             "fn_access_code_entitlement_sync()", "fn_code_assignment_entitlement_revoke()",
             "fn_enrollment_orders_transition()")
TEMPLATES = ("order_created", "order_pay_reminder", "order_needs_info", "order_confirmed",
             "course_open_alert", "result_ready_digest", "course_expiring", "course_expired",
             "staff_notice")

# Pre-383 shapes the migration touches (columns as on staging; 009, 175, 033).
PRE_383 = """
    CREATE TABLE users (id uuid PRIMARY KEY, email text);
    CREATE FUNCTION update_updated_at_column() RETURNS trigger LANGUAGE plpgsql
        SET search_path = pg_catalog, pg_temp AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
    CREATE TABLE courses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE,
        name text NOT NULL);
    CREATE TABLE access_codes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE,
        is_used boolean NOT NULL DEFAULT false, used_by uuid, used_at timestamptz,
        is_revoked boolean DEFAULT false, is_active boolean NOT NULL DEFAULT true,
        expires_at timestamptz);
    CREATE TABLE user_code_assignments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_id uuid NOT NULL REFERENCES access_codes(id) ON DELETE CASCADE,
        assigned_at timestamptz NOT NULL DEFAULT now(), is_active boolean NOT NULL DEFAULT true);
"""
# Minimal M2 ledger: only what the 383 code trigger writes.
LEDGER = """
    CREATE TABLE credit_ledger (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id uuid NOT NULL, entitlement_id uuid NOT NULL REFERENCES entitlements(id),
        delta integer NOT NULL, reason text NOT NULL, idempotency_key text NOT NULL UNIQUE);
"""


def _body(sql: str) -> str:
    return re.sub(r"--[^\n]*", "", sql)


# ── Static ──────────────────────────────────────────────────────────────────

def test_one_transaction_with_lock_timeout_and_pinned_search_path():
    body = _body(FORWARD)
    assert body.count("BEGIN;") == 1 and body.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s'" in body
    assert "SET LOCAL search_path = pg_catalog, pg_temp" in body
    functions = re.findall(r"CREATE OR REPLACE FUNCTION (public\.\w+)\(", body)
    assert len(functions) == len(FUNCTIONS)
    for block in re.split(r"CREATE OR REPLACE FUNCTION ", body)[1:]:
        header = block.split("AS $$", 1)[0]
        assert "SECURITY DEFINER" in header and "SET search_path = pg_catalog, pg_temp" in header, header
    for signature in FUNCTIONS:
        name = signature.split("(")[0]
        assert re.search(rf"REVOKE ALL ON FUNCTION public\.{name}\([^)]*\)\s+FROM PUBLIC, anon, authenticated, service_role",
                         body), name


def test_no_seed_no_backfill_and_no_unqualified_object():
    body = _body(FORWARD)
    assert not re.search(r"INSERT INTO public\.(course_products|courses)\b", body)
    assert not re.search(r"UPDATE public\.(access_codes|courses|users)\b", body)
    assert "retention_content_days" not in body
    # Every table reference is schema-qualified (definer bodies run with pg_catalog, pg_temp).
    for table in (*NEW_TABLES, "access_codes", "courses", "users", "user_code_assignments", "credit_ledger"):
        for match in re.finditer(rf"\b(?:FROM|INTO|UPDATE|ON|REFERENCES|TABLE)\s+{table}\b", body):
            pytest.fail(f"unqualified {table}: {match.group(0)}")
    assert "to_regclass('public.credit_ledger')" in body


def test_rollback_keeps_tables_and_requires_opt_in_for_confirmed_orders():
    body = _body(ROLLBACK)
    assert "aver.allow_commerce_rollback" in body
    assert not re.search(r"DROP TABLE", body)
    assert "DROP TRIGGER IF EXISTS trg_access_codes_entitlement_sync" in body


# ── PostgreSQL ──────────────────────────────────────────────────────────────

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

    def sql(self, text: str) -> str:
        return text.replace("public.", f"{self.schema}.")

    async def forward(self):
        await self.con.execute(self.sql(FORWARD))

    async def rollback(self, opt_in: bool = False):
        script = self.sql(ROLLBACK)
        if opt_in:
            script = script.replace("SET LOCAL lock_timeout = '5s';",
                                    "SET LOCAL lock_timeout = '5s';\nSET LOCAL aver.allow_commerce_rollback = 'on';", 1)
        await self.con.execute(script)

    async def user(self):
        uid = uuid4()
        await self.con.execute("INSERT INTO users (id, email) VALUES ($1, $2)", uid, f"{uid.hex[:8]}@example.test")
        return uid

    async def course(self):
        return await self.con.fetchval("INSERT INTO courses (code, name) VALUES ($1, 'Course') RETURNING id",
                                       "C" + uuid4().hex[:6])

    async def product(self, kind="class", **columns):
        course = await self.course()
        values = {"course_id": course, "slug": "p-" + uuid4().hex[:10], "kind": kind, "title": "Khoá thử",
                  **columns}
        names = ", ".join(values)
        params = ", ".join(f"${i}" for i in range(1, len(values) + 1))
        return await self.con.fetchval(f"INSERT INTO course_products ({names}) VALUES ({params}) RETURNING id",
                                       *values.values())

    async def code(self, product, credits=5, days=None, used_by=None):
        return await self.con.fetchval(
            """INSERT INTO access_codes (code, product_id, grant_credits, grant_days, is_used, used_by, used_at)
               VALUES ($1, $2, $3, $4, $5::uuid IS NOT NULL, $5::uuid, CASE WHEN $5::uuid IS NULL THEN NULL ELSE now() END)
               RETURNING id""",
            uuid4().hex[:12].upper(), product, credits, days, used_by)

    async def entitlements(self, code):
        return await self.con.fetch(
            "SELECT * FROM entitlements WHERE source = 'access_code' AND source_ref = $1 ORDER BY created_at, user_id",
            code)

    async def grants(self, code):
        return await self.con.fetchval(
            "SELECT count(*) FROM credit_ledger WHERE idempotency_key LIKE $1", f"code:{code}:%")


@pytest_asyncio.fixture
async def pg():
    con = await asyncpg.connect(_url())
    schema = "commerce_" + uuid4().hex
    try:
        for role in ("anon", "authenticated", "service_role"):
            await con.execute(f"DO $$ BEGIN CREATE ROLE {role}; EXCEPTION WHEN duplicate_object THEN NULL; END $$")
        await con.execute(f"CREATE SCHEMA {schema}; SET search_path = {schema}, pg_catalog;" + PRE_383)
        # Without schema USAGE a role probe would fail for the wrong reason.
        await con.execute(f"GRANT USAGE ON SCHEMA {schema} TO anon, authenticated, service_role")
        yield Harness(con, schema)
    finally:
        if con.is_in_transaction():
            await con.execute("ROLLBACK")
        await con.execute("RESET ROLE")
        await con.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")
        await con.close()


@pytest_asyncio.fixture
async def migrated(pg):
    await pg.forward()
    await pg.forward()  # re-runnable
    await pg.con.execute(LEDGER)
    return pg


@pytest.mark.asyncio
async def test_applies_twice_with_rls_and_backend_only_privileges(migrated):
    con = migrated.con
    for table in NEW_TABLES:
        assert await con.fetchval("SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass",
                                  f"{migrated.schema}.{table}")
        for role in ("anon", "authenticated"):
            await con.execute(f"SET ROLE {role}")
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await con.fetch(f"SELECT 1 FROM {table} LIMIT 1")
            await con.execute("RESET ROLE")
    await con.execute("SET ROLE service_role")
    await con.fetch("SELECT 1 FROM entitlements LIMIT 1")
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        await con.execute("DELETE FROM entitlements")
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        await con.execute("INSERT INTO entitlement_events (entitlement_id, action, actor_kind) "
                          "VALUES (gen_random_uuid(), 'grant', 'system')")
    await con.execute("RESET ROLE")
    for signature in FUNCTIONS:
        row = await con.fetchrow("SELECT prosecdef, proconfig FROM pg_proc WHERE oid = to_regprocedure($1)",
                                 f"{migrated.schema}.{signature}")
        assert row["prosecdef"] and row["proconfig"] == ["search_path=pg_catalog, pg_temp"]
        for role in ("anon", "authenticated", "service_role"):
            assert not await con.fetchval("SELECT has_function_privilege($1, $2, 'EXECUTE')",
                                          role, f"{migrated.schema}.{signature}")
    columns = {r["attname"] for r in await con.fetch(
        "SELECT attname FROM pg_attribute WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped",
        f"{migrated.schema}.course_products")}
    assert "retention_content_days" not in columns and {"short_title", "credit_valid_days", "archived_at"} <= columns
    assert await con.fetchval("SELECT count(*) FROM course_products") == 0  # no seed


@pytest.mark.asyncio
async def test_existing_courses_become_class_and_product_checks_hold(pg):
    legacy = await pg.course()
    await pg.forward()
    con = pg.con
    assert await con.fetchval("SELECT kind FROM courses WHERE id = $1", legacy) == "class"
    with pytest.raises(asyncpg.CheckViolationError):
        await con.execute("UPDATE courses SET kind = 'trial' WHERE id = $1", legacy)
    await pg.product("online", status="open", tuition_vnd=1_000_000, access_days=90, is_public=True)
    bad = [
        {"kind": "class", "is_public": True},                                  # public only when online
        {"kind": "online", "status": "open", "access_days": 30},               # open online needs tuition
        {"kind": "online", "status": "open", "tuition_vnd": 1},                # open online needs access_days
        {"kind": "online", "archived_at": "now", "status": "open", "tuition_vnd": 1, "access_days": 1},
        {"kind": "online", "archived_at": "now", "is_public": True},           # archived must be hidden
        {"kind": "class", "features": ["speaking", "trial"]},
        {"kind": "class", "review_mode": "teacher"},
        {"kind": "class", "slug": "Bad Slug"},
        {"kind": "class", "presentation": "[]"},
    ]
    for columns in bad:
        kind = columns.pop("kind")
        if columns.get("archived_at") == "now":
            columns["archived_at"] = await con.fetchval("SELECT now()")
        if "presentation" in columns:
            columns["presentation"] = columns["presentation"]
        with pytest.raises((asyncpg.CheckViolationError, asyncpg.InvalidTextRepresentationError)):
            await pg.product(kind, **columns)
    assert await pg.product("class", archived_at=await con.fetchval("SELECT now()"), status="closed")


@pytest.mark.asyncio
async def test_access_code_product_rules(migrated):
    con = migrated.con
    product = await migrated.product("class", access_days=30)
    with pytest.raises(asyncpg.CheckViolationError, match="access_codes_product_credits"):
        await con.execute("INSERT INTO access_codes (code, product_id) VALUES ('NOCREDITS1', $1)", product)
    online = await migrated.product("online")
    with pytest.raises(asyncpg.RaiseError, match="access_code_product_kind"):
        await migrated.code(online)
    assert await migrated.code(await migrated.product("repractice"))
    # A used code's terms are frozen: no in-place conversion of a legacy code.
    learner = await migrated.user()
    legacy = await con.fetchval("INSERT INTO access_codes (code, is_used, used_by, used_at) "
                                "VALUES ('LEGACY0001', true, $1, now()) RETURNING id", learner)
    with pytest.raises(asyncpg.RaiseError, match="access_code_product_locked"):
        await con.execute("UPDATE access_codes SET product_id = $1, grant_credits = 5 WHERE id = $2", product, legacy)
    assert await con.fetchval("SELECT count(*) FROM entitlements") == 0


@pytest.mark.asyncio
async def test_using_a_code_grants_one_entitlement_and_its_credits_once(migrated):
    con = migrated.con
    product = await migrated.product("class", access_days=30)
    learner = await migrated.user()
    # INSERT of an already-used code.
    code = await migrated.code(product, credits=5, used_by=learner)
    [row] = await migrated.entitlements(code)
    assert row["user_id"] == learner and row["status"] == "active"
    assert row["expires_at"] - row["starts_at"] == __import__("datetime").timedelta(days=30)
    assert await con.fetchval("SELECT delta FROM credit_ledger WHERE idempotency_key = $1",
                              f"code:{code}:{learner}:grant") == 5
    assert await con.fetchval("SELECT count(*) FROM entitlement_events WHERE entitlement_id = $1 AND action = 'grant'",
                              row["id"]) == 1
    # Replay of the same activation adds nothing.
    await con.execute("UPDATE access_codes SET is_used = true, used_by = used_by WHERE id = $1", code)
    assert len(await migrated.entitlements(code)) == 1 and await migrated.grants(code) == 1

    # UPDATE is_used, the activation path; grant_days wins over the product.
    zero = await migrated.code(product, credits=0, days=7)
    await con.execute("UPDATE access_codes SET is_used = true, used_by = $1, used_at = now() WHERE id = $2",
                      learner, zero)
    [row] = await migrated.entitlements(zero)
    assert row["expires_at"] - row["starts_at"] == __import__("datetime").timedelta(days=7)
    assert await migrated.grants(zero) == 0

    # A product without access_days and no grant_days: no expiry.
    open_ended = await migrated.code(await migrated.product("class"), credits=1, used_by=learner)
    assert (await migrated.entitlements(open_ended))[0]["expires_at"] is None

    # A legacy code (no product) never reaches the trigger.
    await con.execute("INSERT INTO access_codes (code, is_used, used_by, used_at) VALUES ('LEGACY0002', true, $1, now())",
                      learner)
    assert await con.fetchval("SELECT count(*) FROM entitlements") == 3


@pytest.mark.asyncio
async def test_revoke_reassign_and_assignment_removal_revoke_the_entitlement(migrated):
    con = migrated.con
    product = await migrated.product("class", access_days=30)
    first, second = await migrated.user(), await migrated.user()

    revoked = await migrated.code(product, used_by=first)
    await con.execute("UPDATE access_codes SET is_revoked = true WHERE id = $1", revoked)
    [row] = await migrated.entitlements(revoked)
    assert row["status"] == "revoked" and row["revoke_reason"] == "code_revoked" and row["revoked_at"]

    deactivated = await migrated.code(product, used_by=first)
    await con.execute("UPDATE access_codes SET is_active = false WHERE id = $1", deactivated)
    assert (await migrated.entitlements(deactivated))[0]["status"] == "revoked"

    moved = await migrated.code(product, used_by=first)
    await con.execute("UPDATE access_codes SET used_by = $1 WHERE id = $2", second, moved)
    rows = {r["user_id"]: r for r in await migrated.entitlements(moved)}
    assert rows[first]["status"] == "revoked" and rows[first]["revoke_reason"] == "code_reassigned"
    assert rows[second]["status"] == "active"
    assert await migrated.grants(moved) == 2

    assigned = await migrated.code(product, used_by=first)
    await con.execute("INSERT INTO user_code_assignments (user_id, code_id) VALUES ($1, $2)", first, assigned)
    await con.execute("UPDATE user_code_assignments SET is_active = false WHERE code_id = $1", assigned)
    [row] = await migrated.entitlements(assigned)
    assert row["status"] == "revoked" and row["revoke_reason"] == "assignment_removed"
    assert await con.fetchval("SELECT count(*) FROM entitlement_events WHERE action = 'revoke'") == 4


@pytest.mark.asyncio
async def test_code_with_credits_cannot_be_used_before_the_ledger_exists(pg):
    await pg.forward()
    con = pg.con
    product = await pg.product("class", access_days=30)
    learner = await pg.user()
    code = await pg.code(product, credits=3)
    with pytest.raises(asyncpg.RaiseError, match="credit_ledger_missing"):
        await con.execute("UPDATE access_codes SET is_used = true, used_by = $1, used_at = now() WHERE id = $2",
                          learner, code)
    assert await con.fetchval("SELECT is_used FROM access_codes WHERE id = $1", code) is False
    assert await con.fetchval("SELECT count(*) FROM entitlements") == 0
    # A code with zero credits needs no ledger.
    free = await pg.code(product, credits=0)
    await con.execute("UPDATE access_codes SET is_used = true, used_by = $1 WHERE id = $2", learner, free)
    assert len(await pg.entitlements(free)) == 1


@pytest.mark.asyncio
async def test_entitlement_guard(migrated):
    con = migrated.con
    product = await migrated.product("class", access_days=30)
    learner = await migrated.user()
    code = await migrated.code(product, used_by=learner)
    ent = (await migrated.entitlements(code))[0]["id"]

    async def rejected(statement, *args):
        with pytest.raises(asyncpg.RaiseError, match="entitlement_"):
            await con.execute(statement, *args)

    await rejected("UPDATE entitlements SET user_id = $1 WHERE id = $2", await migrated.user(), ent)
    await rejected("UPDATE entitlements SET starts_at = starts_at - interval '1 day' WHERE id = $1", ent)
    await rejected("UPDATE entitlements SET source = 'admin_grant' WHERE id = $1", ent)
    await rejected("UPDATE entitlements SET expires_at = expires_at - interval '1 day' WHERE id = $1", ent)
    await rejected("UPDATE entitlements SET expires_at = NULL WHERE id = $1", ent)
    await rejected("UPDATE entitlements SET credits_expire_at = expires_at WHERE id = $1", ent)
    # (b) extension, credits window moves with it.
    await con.execute("UPDATE entitlements SET expires_at = expires_at + interval '10 days' WHERE id = $1", ent)
    # (c) one-shot stamps.
    await con.execute("UPDATE entitlements SET carry_settled_at = now(), carry_expires_at = now() + interval '60 days' "
                      "WHERE id = $1", ent)
    await rejected("UPDATE entitlements SET carry_expires_at = carry_expires_at + interval '1 day' WHERE id = $1", ent)
    await rejected("UPDATE entitlements SET carry_settled_at = now() + interval '1 hour' WHERE id = $1", ent)
    await rejected("UPDATE entitlements SET expires_at = expires_at + interval '1 day', "
                   "carry_expires_at = carry_expires_at + interval '1 day' WHERE id = $1", ent)
    await con.execute("UPDATE entitlements SET carry_closed_at = now() WHERE id = $1", ent)
    await rejected("UPDATE entitlements SET carry_closed_at = NULL WHERE id = $1", ent)
    await con.execute("UPDATE entitlements SET credits_closed_at = now() WHERE id = $1", ent)
    await rejected("UPDATE entitlements SET credits_closed_at = now() + interval '1 hour' WHERE id = $1", ent)
    # (a) revoke once, never back.
    await con.execute("UPDATE entitlements SET status = 'revoked', revoked_at = now(), revoke_reason = 'x' "
                      "WHERE id = $1", ent)
    await rejected("UPDATE entitlements SET status = 'active', revoked_at = NULL WHERE id = $1", ent)
    await rejected("DELETE FROM entitlements WHERE id = $1", ent)
    await rejected(f"TRUNCATE {migrated.schema}.entitlements CASCADE")

    other = await migrated.code(product, used_by=learner)
    ent2 = (await migrated.entitlements(other))[0]["id"]
    await rejected("UPDATE entitlements SET carry_expires_at = now() WHERE id = $1", ent2)  # needs settled
    with pytest.raises(asyncpg.CheckViolationError):
        await con.execute("UPDATE entitlements SET status = 'revoked' WHERE id = $1", ent2)  # needs revoked_at
    # entitlements.source domain
    for source, ok in (("class_conversion", True), ("trial", False)):
        statement = con.execute(
            "INSERT INTO entitlements (user_id, product_id, course_id, source, source_ref) "
            "SELECT $1, id, course_id, $2, gen_random_uuid() FROM course_products WHERE id = $3",
            learner, source, product)
        if ok:
            await statement
        else:
            with pytest.raises(asyncpg.CheckViolationError):
                await statement
    with pytest.raises(asyncpg.ForeignKeyViolationError):  # product/course pair must match
        await con.execute("INSERT INTO entitlements (user_id, product_id, course_id, source, source_ref) "
                          "VALUES ($1, $2, $3, 'admin_grant', gen_random_uuid())",
                          learner, product, await migrated.course())


@pytest.mark.asyncio
async def test_event_tables_are_append_only(migrated):
    con = migrated.con
    product = await migrated.product("class")
    learner = await migrated.user()
    await migrated.code(product, used_by=learner)
    order = await con.fetchval(
        """INSERT INTO enrollment_orders (order_code, user_id, product_id, tuition_vnd, access_days, ai_credits,
                                          product_title, request_key, pay_by)
           VALUES ('AVER-ABCDEF', $1, $2, 1000, 30, 10, 'Khoá', 'req-00000001', now() + interval '2 days')
           RETURNING id""", learner, product)
    await con.execute("INSERT INTO enrollment_order_events (order_id, to_status, action, actor_kind) "
                      "VALUES ($1, 'awaiting_transfer', 'create', 'learner')", order)
    for table in ("entitlement_events", "enrollment_order_events"):
        with pytest.raises(asyncpg.RaiseError, match=f"{table}_append_only"):
            await con.execute(f"UPDATE {table} SET created_at = now()")
        with pytest.raises(asyncpg.RaiseError, match=f"{table}_append_only"):
            await con.execute(f"DELETE FROM {table}")
        with pytest.raises(asyncpg.RaiseError, match=f"{table}_append_only"):
            await con.execute(f"TRUNCATE {migrated.schema}.{table}")


@pytest.mark.asyncio
async def test_enrollment_order_transitions(migrated):
    con = migrated.con
    product = await migrated.product("online")
    learner = await migrated.user()
    codes = iter("ABCDEFGHJKMN")

    async def order(status="awaiting_transfer"):
        oid = await con.fetchval(
            """INSERT INTO enrollment_orders (order_code, user_id, product_id, tuition_vnd, access_days,
                                              ai_credits, product_title, request_key, pay_by)
               VALUES ($1, $2, $3, 1000, 30, 10, 'Khoá', $4, now() + interval '2 days') RETURNING id""",
            "AVER-" + next(codes) * 6, learner, product, "req-" + uuid4().hex)
        if status != "awaiting_transfer":
            await con.execute("UPDATE enrollment_orders SET status = $1 WHERE id = $2", status, oid)
        return oid

    async def move(oid, status, ok):
        statement = con.execute("UPDATE enrollment_orders SET status = $1 WHERE id = $2", status, oid)
        if ok:
            await statement
        else:
            with pytest.raises(asyncpg.RaiseError, match="invalid_transition"):
                await statement

    first = await order()
    with pytest.raises(asyncpg.UniqueViolationError):  # one open order per learner and product
        await order()
    await move(first, "transfer_reported", True)
    await move(first, "awaiting_transfer", False)
    await move(first, "expired", False)
    await move(first, "needs_info", True)
    await con.execute("UPDATE enrollment_orders SET status = 'needs_info', admin_message = 'again' WHERE id = $1", first)
    await move(first, "transfer_reported", True)
    await move(first, "cancelled", True)
    await move(first, "awaiting_transfer", False)
    await move(first, "confirmed", False)

    expired = await order("expired")
    await con.execute("UPDATE enrollment_orders SET late_transfer_reported_at = now() WHERE id = $1", expired)
    await move(expired, "transfer_reported", False)
    with pytest.raises(asyncpg.CheckViolationError):  # confirmed needs its entitlement
        await con.execute("UPDATE enrollment_orders SET status = 'confirmed' WHERE id = $1", expired)
    ent = await con.fetchval(
        "INSERT INTO entitlements (user_id, product_id, course_id, source, source_ref) "
        "SELECT $1, id, course_id, 'enrollment_order', $2 FROM course_products WHERE id = $3 RETURNING id",
        learner, expired, product)
    await con.execute("UPDATE enrollment_orders SET status = 'confirmed', entitlement_id = $1, reopened_at = now() "
                      "WHERE id = $2", ent, expired)
    await move(expired, "cancelled", False)
    for column, value in (("tuition_vnd", 1), ("product_title", "x"), ("order_code", "AVER-ZZZZZZ"),
                          ("user_id", await migrated.user())):
        with pytest.raises(asyncpg.RaiseError, match="enrollment_order_immutable"):
            await con.execute(f"UPDATE enrollment_orders SET {column} = $1 WHERE id = $2", value, expired)
    with pytest.raises(asyncpg.RaiseError, match="enrollment_order_append_only"):
        await con.execute("DELETE FROM enrollment_orders WHERE id = $1", expired)
    with pytest.raises(asyncpg.CheckViolationError, match="enrollment_orders_code_check"):  # O and 0 are excluded
        await con.execute(
            "INSERT INTO enrollment_orders (order_code, user_id, product_id, tuition_vnd, access_days, ai_credits, "
            "product_title, request_key, pay_by) VALUES ('AVER-OOOOOO', $1, $2, 1, 1, 0, 'x', 'req-badcode', now())",
            learner, product)


@pytest.mark.asyncio
async def test_email_outbox_templates_and_recipient_rules(migrated):
    con = migrated.con
    learner = await migrated.user()

    async def insert(template, user_id=None, to_email=None):
        return await con.execute(
            "INSERT INTO learner_email_outbox (user_id, to_email, template, dedupe_key, payload) "
            "VALUES ($1, $2, $3, $4, '{}')", user_id, to_email, template, uuid4().hex)

    for template in TEMPLATES:
        if template == "course_open_alert":
            await insert(template, to_email="someone@example.test")
        else:
            await insert(template, user_id=learner)
    for template in ("order_expired", "order_cancelled", "login_code"):
        with pytest.raises(asyncpg.CheckViolationError):
            await insert(template, user_id=learner)
    with pytest.raises(asyncpg.CheckViolationError):
        await insert("course_open_alert", user_id=learner)
    with pytest.raises(asyncpg.CheckViolationError):
        await insert("course_open_alert")
    with pytest.raises(asyncpg.CheckViolationError):
        await insert("order_created", to_email="someone@example.test")
    with pytest.raises(asyncpg.CheckViolationError):
        await insert("order_created", user_id=learner, to_email="someone@example.test")


@pytest.mark.asyncio
async def test_rollback_keeps_data_and_needs_opt_in_after_a_confirmed_order(migrated):
    con = migrated.con
    product = await migrated.product("class")
    learner = await migrated.user()
    code = await migrated.code(product, used_by=learner)
    order = await con.fetchval(
        """INSERT INTO enrollment_orders (order_code, user_id, product_id, tuition_vnd, access_days, ai_credits,
                                          product_title, request_key, pay_by)
           VALUES ('AVER-QRSTUV', $1, $2, 1000, 30, 0, 'Khoá', 'req-rollback', now()) RETURNING id""",
        learner, product)
    ent = (await migrated.entitlements(code))[0]["id"]
    await con.execute("UPDATE enrollment_orders SET status = 'confirmed', entitlement_id = $1 WHERE id = $2", ent, order)
    with pytest.raises(asyncpg.ObjectNotInPrerequisiteStateError, match="confirmed enrollment orders exist"):
        await migrated.rollback()
    await con.execute("ROLLBACK")  # the refused script left its transaction open
    await migrated.rollback(opt_in=True)
    for table in NEW_TABLES:
        assert await con.fetchval("SELECT to_regclass($1) IS NOT NULL", f"{migrated.schema}.{table}")
    assert await con.fetchval("SELECT count(*) FROM entitlements") == 1
    # The code still names its product, so the columns stay; the triggers are gone.
    assert await con.fetchval("SELECT product_id FROM access_codes WHERE id = $1", code) == product
    assert not await con.fetchval("SELECT count(*) FROM pg_trigger WHERE tgrelid = $1::regclass AND NOT tgisinternal",
                                  f"{migrated.schema}.access_codes")
    # Forward again restores the triggers.
    await migrated.forward()
    assert await con.fetchval("SELECT count(*) FROM pg_trigger WHERE tgrelid = $1::regclass AND NOT tgisinternal",
                              f"{migrated.schema}.access_codes") == 2


@pytest.mark.asyncio
async def test_rollback_drops_unused_code_columns(pg):
    await pg.forward()
    await pg.rollback()
    columns = {r["attname"] for r in await pg.con.fetch(
        "SELECT attname FROM pg_attribute WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped",
        f"{pg.schema}.access_codes")}
    assert not {"product_id", "grant_days", "grant_credits"} & columns
    await pg.forward()


def test_activation_rpc_keeps_the_code_unused_when_the_entitlement_grant_fails():
    """A product code with credits used before M2 exists: fn_activation_serialize (359,
    verbatim) catches the trigger error as activation_error and the code stays unused."""
    import migration_359_pg_harness as h359
    from test_migration_240_core_attempt_evidence import psql

    schema = h359.build("no337")
    try:
        psql(f"""
            SET search_path = {schema}, pg_temp;
            ALTER TABLE access_codes ADD COLUMN is_active boolean NOT NULL DEFAULT true;
            CREATE TABLE courses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE,
                                  name text NOT NULL);
            CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS trigger LANGUAGE plpgsql
                SET search_path = pg_catalog, pg_temp AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;""")
        psql(FORWARD.replace("public.", f"{schema}."))
        user, code_id = uuid4(), uuid4()
        receipt = psql(f"""
            SET search_path = {schema}, pg_temp;
            INSERT INTO courses (id, code, name) VALUES ('{uuid4()}', 'C9', 'Course');
            INSERT INTO course_products (course_id, slug, kind, title)
                SELECT id, 'class-c9', 'class', 'Lớp C9' FROM courses;
            INSERT INTO access_codes (id, code, product_id, grant_credits)
                SELECT '{code_id}', 'PRODUCT01', id, 5 FROM course_products;
            SELECT fn_activation_serialize('{user}', '{code_id}', 'PRODUCT01', 'a@example.test', '{{}}'::jsonb)->>'status';""")
        assert receipt.splitlines()[-1] == "activation_error"
        assert psql(f"SELECT is_used FROM {schema}.access_codes WHERE id = '{code_id}'") == "f"
        assert psql(f"SELECT count(*) FROM {schema}.entitlements") == "0"
        # Once the ledger exists the same code activates and grants once.
        psql(f"SET search_path = {schema}, pg_temp; {LEDGER}")
        assert psql(f"SELECT {schema}.fn_activation_serialize('{user}', '{code_id}', 'PRODUCT01', "
                    f"'a@example.test', '{{}}'::jsonb)->>'status'") == "ok"
        assert psql(f"SELECT count(*) FROM {schema}.entitlements WHERE user_id = '{user}'") == "1"
        assert psql(f"SELECT sum(delta) FROM {schema}.credit_ledger") == "5"
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")
