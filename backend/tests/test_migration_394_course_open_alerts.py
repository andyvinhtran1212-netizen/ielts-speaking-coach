"""ENROLL-0060 T22 (G05-T22): migration 394, "Báo cho tôi khi mở" subscriptions.

Static checks read the SQL; the PostgreSQL checks apply 383 and 394 verbatim
(``public.`` rewritten to a throwaway schema) on a LOCAL disposable cluster:
set TEST_PG_URL, and REQUIRE_PG=1 to forbid skips.
"""
import asyncio
import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

import asyncpg
import pytest
import pytest_asyncio

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
NAME = "394_course_open_alerts.sql"
FORWARD = (MIGRATIONS / NAME).read_text(encoding="utf-8")
ROLLBACK = (MIGRATIONS / "rollback" / NAME).read_text(encoding="utf-8")
M1 = (MIGRATIONS / "383_course_commerce_core.sql").read_text(encoding="utf-8")
RPCS = ("fn_course_open_alert_attempt_check(text,text)", "fn_course_open_alert_subscribe(text,text,uuid)",
        "fn_course_open_alert_unsubscribe(text,text,uuid,text)", "fn_course_open_alerts_for_user(uuid,text)",
        "fn_course_open_alerts_enqueue(integer)", "fn_course_open_alerts_rekey(uuid,text,text)",
        "fn_course_open_alert_send_check(uuid,text)")
HELPERS = ("fn_course_open_alert_new_token()", "fn_course_open_alert_has_course(uuid,uuid,text)")

# Pre-383 shapes 383 touches (as in test_migration_383).
PRE = """
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


def _body(sql: str) -> str:
    return re.sub(r"--[^\n]*", "", sql)


# ── Static ──────────────────────────────────────────────────────────────────

def test_one_transaction_definer_functions_with_pinned_search_path():
    body = _body(FORWARD)
    assert body.count("BEGIN;") == 1 and body.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s'" in body
    blocks = re.split(r"CREATE OR REPLACE FUNCTION ", body)[1:]
    assert len(blocks) == len(RPCS) + len(HELPERS)
    for block in blocks:
        header = block.split("AS $$", 1)[0]
        assert "SECURITY DEFINER" in header and "SET search_path = pg_catalog, pg_temp" in header, header


def test_no_seed_and_rollback_drops_functions_before_tables():
    body = _body(FORWARD)
    # Writes only inside the functions: one subscribe insert, the outbox insert,
    # the attempt counter; nothing seeds or backfills.
    assert sorted(re.findall(r"INSERT INTO (public\.\w+)", body)) == [
        "public.course_open_alert_attempts", "public.course_open_alerts", "public.learner_email_outbox"]
    rollback = _body(ROLLBACK)
    last_function = max(rollback.index(f"DROP FUNCTION IF EXISTS public.{sig.split('(')[0]}(")
                        for sig in RPCS + HELPERS)
    assert last_function < rollback.index("DROP TABLE IF EXISTS public.course_open_alert_attempts")
    assert last_function < rollback.index("DROP TABLE IF EXISTS public.course_open_alerts;")


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
        self.extra: list[asyncpg.Connection] = []

    def sql(self, text: str) -> str:
        return text.replace("public.", f"{self.schema}.")

    async def connect(self) -> asyncpg.Connection:
        other = await asyncpg.connect(_url())
        await other.execute(f"SET search_path = {self.schema}, pg_catalog")
        self.extra.append(other)
        return other

    async def call(self, name: str, *args, con=None):
        con = con or self.con
        params = ", ".join(f"${i}" for i in range(1, len(args) + 1))
        return await con.fetchval(f"SELECT {name}({params})", *args)

    async def user(self, email=None):
        uid = uuid4()
        await self.con.execute("INSERT INTO users (id, email) VALUES ($1, $2)",
                               uid, email or f"{uid.hex[:8]}@example.test")
        return uid

    async def product(self, status="coming_soon", is_public=True, **columns):
        course = await self.con.fetchval(
            "INSERT INTO courses (code, name) VALUES ($1, 'Course') RETURNING id", "C" + uuid4().hex[:6])
        slug = "p-" + uuid4().hex[:10]
        values = {"course_id": course, "slug": slug, "kind": "online", "title": "Khoá thử",
                  "status": status, "is_public": is_public, "tuition_vnd": 1_000_000, "access_days": 30,
                  **columns}
        names = ", ".join(values)
        params = ", ".join(f"${i}" for i in range(1, len(values) + 1))
        pid = await self.con.fetchval(
            f"INSERT INTO course_products ({names}) VALUES ({params}) RETURNING id", *values.values())
        return pid, slug

    async def open(self, product):
        await self.con.execute("UPDATE course_products SET status = 'open' WHERE id = $1", product)

    async def entitle(self, user, product):
        course = await self.con.fetchval("SELECT course_id FROM course_products WHERE id = $1", product)
        await self.con.execute(
            """INSERT INTO entitlements (user_id, product_id, course_id, source, source_ref, expires_at)
               VALUES ($1, $2, $3, 'admin_grant', gen_random_uuid(), now() + interval '30 days')""",
            user, product, course)

    async def alerts(self, product):
        return await self.con.fetch("SELECT * FROM course_open_alerts WHERE product_id = $1 ORDER BY created_at",
                                    product)

    async def outbox(self):
        return await self.con.fetch(
            "SELECT * FROM learner_email_outbox WHERE template = 'course_open_alert' ORDER BY created_at")


@pytest_asyncio.fixture
async def pg():
    con = await asyncpg.connect(_url())
    schema = "openalert_" + uuid4().hex
    harness = Harness(con, schema)
    try:
        for role in ("anon", "authenticated", "service_role"):
            await con.execute(f"DO $$ BEGIN CREATE ROLE {role}; EXCEPTION WHEN duplicate_object THEN NULL; END $$")
        await con.execute(f"CREATE SCHEMA {schema}; SET search_path = {schema}, pg_catalog;" + PRE)
        await con.execute(f"GRANT USAGE ON SCHEMA {schema} TO anon, authenticated, service_role")
        await con.execute(harness.sql(M1))
        await con.execute(harness.sql(FORWARD))
        await con.execute(harness.sql(FORWARD))  # re-runnable
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


@pytest.mark.asyncio
async def test_rls_on_and_only_service_role_executes(pg):
    for table in ("course_open_alerts", "course_open_alert_attempts"):
        assert await pg.con.fetchval(f"SELECT relrowsecurity FROM pg_class WHERE oid = '{pg.schema}.{table}'::regclass")
        for role in ("anon", "authenticated"):
            assert not await pg.con.fetchval(f"SELECT has_table_privilege('{role}', '{pg.schema}.{table}', 'SELECT')")
        for privilege in ("INSERT", "UPDATE", "DELETE"):
            assert not await pg.con.fetchval(
                f"SELECT has_table_privilege('service_role', '{pg.schema}.{table}', '{privilege}')")
    for signature in RPCS:
        regproc = f"{pg.schema}.{signature}"
        assert await pg.con.fetchval(f"SELECT has_function_privilege('service_role', '{regproc}', 'EXECUTE')")
        for role in ("anon", "authenticated"):
            assert not await pg.con.fetchval(f"SELECT has_function_privilege('{role}', '{regproc}', 'EXECUTE')")
    for signature in HELPERS:
        regproc = f"{pg.schema}.{signature}"
        for role in ("anon", "authenticated", "service_role"):
            assert not await pg.con.fetchval(f"SELECT has_function_privilege('{role}', '{regproc}', 'EXECUTE')")
    # A client cannot subscribe directly.
    await pg.con.execute("SET ROLE authenticated")
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        await pg.call("fn_course_open_alert_subscribe", "x", "a@example.test", None)
    await pg.con.execute("RESET ROLE")


@pytest.mark.asyncio
async def test_subscribe_rules_never_reset_a_notified_row(pg):
    product, slug = await pg.product()
    assert await pg.call("fn_course_open_alert_subscribe", "missing-slug", "a@example.test", None) == "course_not_found"
    draft, draft_slug = await pg.product(status="draft", is_public=False)
    assert await pg.call("fn_course_open_alert_subscribe", draft_slug, "a@example.test", None) == "course_not_found"
    _, open_slug = await pg.product(status="open")
    assert await pg.call("fn_course_open_alert_subscribe", open_slug, "a@example.test", None) == "course_already_open"

    assert await pg.call("fn_course_open_alert_subscribe", slug, " Learner@Example.test ", None) == "ok"
    assert await pg.call("fn_course_open_alert_subscribe", slug, "learner@example.TEST", None) == "ok"
    rows = await pg.alerts(product)
    assert len(rows) == 1 and rows[0]["email"] == "Learner@Example.test"
    assert re.fullmatch(r"[0-9a-f]{64}", rows[0]["unsubscribe_token"])

    # Unsubscribed, never notified → subscribing again revives it.
    assert await pg.call("fn_course_open_alert_unsubscribe", slug, rows[0]["unsubscribe_token"], None, None) == 1
    assert await pg.call("fn_course_open_alert_subscribe", slug, "learner@example.test", None) == "ok"
    revived = (await pg.alerts(product))[0]
    assert revived["unsubscribed_at"] is None and revived["subscribed_at"] > rows[0]["subscribed_at"]

    # Notified → subscribing again changes nothing (one mail per course).
    await pg.open(product)
    assert await pg.call("fn_course_open_alerts_enqueue", 200) == 1
    await pg.con.execute("UPDATE course_products SET status = 'closed' WHERE id = $1", product)
    assert await pg.call("fn_course_open_alert_subscribe", slug, "learner@example.test", None) == "ok"
    await pg.open(product)
    assert await pg.call("fn_course_open_alerts_enqueue", 200) == 0
    assert len(await pg.outbox()) == 1


@pytest.mark.asyncio
async def test_unsubscribe_token_is_single_use_and_session_unsubscribe_works(pg):
    product, slug = await pg.product()
    other_product, other_slug = await pg.product()
    await pg.call("fn_course_open_alert_subscribe", slug, "guest@example.test", None)
    await pg.call("fn_course_open_alert_subscribe", other_slug, "guest@example.test", None)
    token = (await pg.alerts(product))[0]["unsubscribe_token"]

    # A token only works on its own course, and an unknown token changes nothing.
    assert await pg.call("fn_course_open_alert_unsubscribe", other_slug, token, None, None) == 0
    assert await pg.call("fn_course_open_alert_unsubscribe", slug, "0" * 64, None, None) == 0
    assert await pg.call("fn_course_open_alert_unsubscribe", slug, token, None, None) == 1
    row = (await pg.alerts(product))[0]
    assert row["unsubscribed_at"] is not None and row["unsubscribe_token"] != token
    assert await pg.call("fn_course_open_alert_unsubscribe", slug, token, None, None) == 0  # used once

    # Session path: by account email even when the row is not linked.
    user = await pg.user("guest@example.test")
    assert await pg.call("fn_course_open_alerts_for_user", user, "guest@example.test") == [other_slug]
    assert await pg.call("fn_course_open_alert_unsubscribe", other_slug, None, user, "GUEST@example.test") == 1
    assert await pg.call("fn_course_open_alerts_for_user", user, "guest@example.test") == []
    with pytest.raises(asyncpg.NullValueNotAllowedError):
        await pg.call("fn_course_open_alert_unsubscribe", slug, None, None, None)


@pytest.mark.asyncio
async def test_enqueue_one_mail_per_person_skips_owners_and_unsubscribed(pg):
    product, slug = await pg.product()
    owner = await pg.user("owner@example.test")
    await pg.entitle(owner, product)
    for email in ("a@example.test", "b@example.test", "owner@example.test", "gone@example.test"):
        await pg.call("fn_course_open_alert_subscribe", slug, email, None)
    gone = [r for r in await pg.alerts(product) if r["email"] == "gone@example.test"][0]
    await pg.call("fn_course_open_alert_unsubscribe", slug, gone["unsubscribe_token"], None, None)

    assert await pg.call("fn_course_open_alerts_enqueue", 200) == 0  # not open yet
    await pg.open(product)
    assert await pg.call("fn_course_open_alerts_enqueue", 2) == 2    # three waiting, limit 2
    assert await pg.call("fn_course_open_alerts_enqueue", 2) == 1
    assert await pg.call("fn_course_open_alerts_enqueue", 200) == 0  # second sweep: nothing
    await pg.con.execute("UPDATE course_products SET status = 'closed' WHERE id = $1", product)
    await pg.open(product)                                            # closed, then open again
    assert await pg.call("fn_course_open_alerts_enqueue", 200) == 0

    rows = {r["email"]: r for r in await pg.alerts(product)}
    assert rows["owner@example.test"]["notify_result"] == "skipped_has_course"
    assert rows["gone@example.test"]["notified_at"] is None
    mails = await pg.outbox()
    assert sorted(m["to_email"] for m in mails) == ["a@example.test", "b@example.test"]
    for mail in mails:
        alert = rows[mail["to_email"]]
        assert mail["user_id"] is None and mail["dedupe_key"] == f"open_alert:{alert['id']}"
        payload = json.loads(mail["payload"])
        assert payload == {"alert_id": str(alert["id"]), "product_slug": slug, "product_title": "Khoá thử",
                           "unsubscribe_token": alert["unsubscribe_token"]}
    with pytest.raises(asyncpg.InvalidParameterValueError):
        await pg.call("fn_course_open_alerts_enqueue", 0)


@pytest.mark.asyncio
async def test_send_check_reasons(pg):
    product, slug = await pg.product()
    for email in ("send@example.test", "unsub@example.test", "moved@example.test", "owner@example.test"):
        await pg.call("fn_course_open_alert_subscribe", slug, email, None)
    await pg.open(product)
    await pg.call("fn_course_open_alerts_enqueue", 200)
    rows = {r["email"]: r for r in await pg.alerts(product)}

    async def check(email, to=None):
        return await pg.call("fn_course_open_alert_send_check", rows[email]["id"], to or email)

    assert await check("send@example.test", "SEND@example.test") == "send"
    await pg.call("fn_course_open_alert_unsubscribe", slug, rows["unsub@example.test"]["unsubscribe_token"], None, None)
    assert await check("unsub@example.test") == "skipped_unsubscribed"
    mover = await pg.user("moved@example.test")
    await pg.call("fn_course_open_alerts_rekey", mover, "moved@example.test", "new@example.test")
    assert await check("moved@example.test") == "skipped_email_changed"
    owner = await pg.user("owner@example.test")
    await pg.entitle(owner, product)
    assert await check("owner@example.test") == "skipped_has_course"
    await pg.con.execute("UPDATE course_products SET status = 'closed' WHERE id = $1", product)
    assert await check("send@example.test") == "skipped_closed"
    assert await pg.call("fn_course_open_alert_send_check", uuid4(), "x@example.test") == "skipped_missing"


@pytest.mark.asyncio
async def test_rekey_merges_unsubscribed_wins_notified_wins_and_is_idempotent(pg):
    p1, s1 = await pg.product()
    p2, s2 = await pg.product()
    p3, s3 = await pg.product()
    user = await pg.user("old@example.test")
    # p1: linked row under the old address + unsubscribed guest row under the new one.
    await pg.call("fn_course_open_alert_subscribe", s1, "old@example.test", user)
    await pg.call("fn_course_open_alert_subscribe", s1, "new@example.test", None)
    new_row = [r for r in await pg.alerts(p1) if r["email"] == "new@example.test"][0]
    await pg.call("fn_course_open_alert_unsubscribe", s1, new_row["unsubscribe_token"], None, None)
    unsubscribed_at = await pg.con.fetchval("SELECT unsubscribed_at FROM course_open_alerts WHERE id = $1",
                                            new_row["id"])
    # p2: the guest row under the new address was already notified.
    await pg.call("fn_course_open_alert_subscribe", s2, "new@example.test", None)
    await pg.open(p2)
    await pg.call("fn_course_open_alerts_enqueue", 200)
    await pg.con.execute("UPDATE course_products SET status = 'closed' WHERE id = $1", p2)
    await pg.call("fn_course_open_alert_subscribe", s2, "old@example.test", None)
    # p3: someone else's linked row under the old address is not touched.
    stranger = await pg.user("stranger@example.test")
    await pg.call("fn_course_open_alert_subscribe", s3, "old@example.test", stranger)

    assert await pg.call("fn_course_open_alerts_rekey", user, "old@example.test", "new@example.test") == 2
    (r1,) = await pg.alerts(p1)
    assert (r1["email"], r1["user_id"]) == ("new@example.test", user)
    assert unsubscribed_at is not None and r1["unsubscribed_at"] == unsubscribed_at  # unsubscribed wins
    (r2,) = await pg.alerts(p2)
    assert (r2["email"], r2["user_id"], r2["notify_result"]) == ("new@example.test", user, "queued")
    (r3,) = await pg.alerts(p3)
    assert (r3["email"], r3["user_id"]) == ("old@example.test", stranger)
    assert await pg.call("fn_course_open_alerts_rekey", user, "old@example.test", "new@example.test") == 0
    await pg.open(p2)
    assert await pg.call("fn_course_open_alerts_enqueue", 200) == 0  # no second mail


@pytest.mark.asyncio
async def test_rate_limit_per_key_and_action(pg):
    for _ in range(3):
        assert json.loads(await pg.call("fn_course_open_alert_attempt_check", "ip:a", "subscribe"))["allowed"]
    refused = json.loads(await pg.call("fn_course_open_alert_attempt_check", "ip:a", "subscribe"))
    assert refused["allowed"] is False and 1 <= refused["retry_after_s"] <= 3600
    assert await pg.con.fetchval("SELECT count(*) FROM course_open_alert_attempts WHERE rate_key = 'ip:a'") == 3
    assert json.loads(await pg.call("fn_course_open_alert_attempt_check", "ip:b", "subscribe"))["allowed"]
    for _ in range(20):
        assert json.loads(await pg.call("fn_course_open_alert_attempt_check", "ip:a", "unsubscribe"))["allowed"]
    assert not json.loads(await pg.call("fn_course_open_alert_attempt_check", "ip:a", "unsubscribe"))["allowed"]
    with pytest.raises(asyncpg.InvalidParameterValueError):
        await pg.call("fn_course_open_alert_attempt_check", "ip:a", "other")


@pytest.mark.asyncio
async def test_stale_attempts_of_other_keys_are_removed_so_the_counter_stays_bounded(pg):
    await pg.con.execute(
        "INSERT INTO course_open_alert_attempts (rate_key, action, attempted_at) "
        "SELECT 'ip:gone-' || g, 'subscribe', now() - interval '2 days' FROM generate_series(1, 250) g")
    await pg.con.execute(
        "INSERT INTO course_open_alert_attempts (rate_key, action, attempted_at) "
        "VALUES ('user:recent', 'unsubscribe', now() - interval '2 hours')")
    await pg.call("fn_course_open_alert_attempt_check", "ip:new", "subscribe")
    assert await pg.con.fetchval("SELECT count(*) FROM course_open_alert_attempts WHERE rate_key LIKE 'ip:gone-%'") == 50
    await pg.call("fn_course_open_alert_attempt_check", "ip:new", "unsubscribe")
    assert await pg.con.fetchval("SELECT count(*) FROM course_open_alert_attempts WHERE rate_key LIKE 'ip:gone-%'") == 0
    # Rows younger than a day stay (they may still count in a window).
    assert await pg.con.fetchval("SELECT count(*) FROM course_open_alert_attempts WHERE rate_key = 'user:recent'") == 1


@pytest.mark.asyncio
async def test_concurrent_subscribe_attempts_take_exactly_three_slots(pg):
    cons = [await pg.connect() for _ in range(8)]
    results = await asyncio.gather(*(
        pg.call("fn_course_open_alert_attempt_check", "ip:race", "subscribe", con=c) for c in cons))
    assert sum(json.loads(r)["allowed"] for r in results) == 3


@pytest.mark.asyncio
async def test_rollback_then_reapply(pg):
    await pg.con.execute(pg.sql(ROLLBACK))
    assert await pg.con.fetchval(f"SELECT to_regclass('{pg.schema}.course_open_alerts')") is None
    assert await pg.con.fetchval(
        f"SELECT count(*) FROM pg_proc WHERE proname LIKE 'fn_course_open_alert%' "
        f"AND pronamespace = '{pg.schema}'::regnamespace") == 0
    await pg.con.execute(pg.sql(FORWARD))
    assert await pg.con.fetchval(f"SELECT to_regclass('{pg.schema}.course_open_alerts')") is not None
