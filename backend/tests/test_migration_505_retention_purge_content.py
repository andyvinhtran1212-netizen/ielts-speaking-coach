"""COURSEACCESS-0055 FR-048 follow-up (G04-T10b): migration 505, the locked
content purge by course-access window.

Static checks read the SQL; the PostgreSQL checks apply 383, 384 and 505
verbatim (``public.`` rewritten to a throwaway schema) on a LOCAL disposable
cluster: set TEST_PG_URL, and REQUIRE_PG=1 to forbid skips. The class and
retention shapes (cohorts, student_cohort_memberships, sessions.content_purged_at,
responses) are the parts of 060/227/224 the function reads and writes.
"""
import asyncio
import re
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import asyncpg
import pytest
import pytest_asyncio

import test_migration_384_credit_ledger_enrollment_rpcs as m384

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
NAME = "505_retention_purge_content.sql"
FORWARD = (MIGRATIONS / NAME).read_text(encoding="utf-8")
ROLLBACK = (MIGRATIONS / "rollback" / NAME).read_text(encoding="utf-8")
RPC = "fn_retention_purge_content(uuid,integer)"
D = timedelta(days=1)

SHAPE = """
    CREATE TABLE cohorts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL DEFAULT 'Lớp',
        course_id uuid REFERENCES courses(id), archived_at timestamptz);
    CREATE TABLE student_cohort_memberships (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        cohort_id uuid NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
        is_active boolean NOT NULL DEFAULT true,
        CONSTRAINT uq_student_cohort_membership UNIQUE (student_id, cohort_id));
    ALTER TABLE students ADD CONSTRAINT students_user_fk FOREIGN KEY (user_id) REFERENCES users(id);
    ALTER TABLE sessions ADD COLUMN content_purged_at timestamptz, ADD COLUMN band_overall numeric;
    CREATE TABLE responses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
        transcript text, raw_transcript_text text, feedback jsonb, pronunciation_payload jsonb,
        overall_band numeric);
"""


def _body(sql: str) -> str:
    return re.sub(r"--[^\n]*", "", sql)


# ── Static ──────────────────────────────────────────────────────────────────

def test_one_transaction_one_definer_rpc_service_role_only():
    body = _body(FORWARD)
    assert body.count("BEGIN;") == 1 and body.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s'" in body
    assert re.findall(r"CREATE OR REPLACE FUNCTION public\.(\w+)\(", body) == ["fn_retention_purge_content"]
    header = body.split("CREATE OR REPLACE FUNCTION ", 1)[1].split("AS $$", 1)[0]
    assert "SECURITY DEFINER" in header and "SET search_path = pg_catalog, pg_temp" in header
    assert not re.search(r"\b(CREATE TABLE|ALTER TABLE|DROP TABLE|DELETE FROM)\b", body)
    assert not re.search(r"pg_advisory_lock\(", body)
    # Only the purge writes: four content columns and the stamp; no score column.
    updates = re.findall(r"UPDATE public\.(\w+)\s+SET ([^;]*?)\s+WHERE", body)
    assert [(t, sorted(c.split("=")[0].strip() for c in cols.split(","))) for t, cols in updates] == [
        ("responses", ["feedback", "pronunciation_payload", "raw_transcript_text", "transcript"]),
        ("sessions", ["content_purged_at"]),
    ]


def test_every_lock_comes_before_the_first_check():
    function = _body(FORWARD).split("AS $$", 1)[1]
    # The advisory lock comes before every row lock (384/387 order; a session
    # row locked first deadlocks with fn_credit_reserve, SA #2624).
    assert function.index("public.fn_credit_lock_user(v_user)") < function.index("FOR UPDATE")
    order = [function.index(token) for token in (
        "SELECT s.user_id INTO v_user FROM public.sessions s WHERE s.id = p_session_id;",
        "public.fn_credit_lock_user(v_user)",
        "FROM public.sessions s WHERE s.id = p_session_id FOR UPDATE",
        "v_owner IS DISTINCT FROM v_user",
        "'already_purged'",
        "FROM public.users u WHERE u.id = v_user FOR UPDATE",
        "FROM public.entitlements e WHERE e.user_id = v_user FOR UPDATE",
        "'live_access'",
        "'window_open'",
        "UPDATE public.responses",
    )]
    assert order == sorted(order)


def test_register_policy_readme_and_rollback():
    register = [line.split("\t") for line in (MIGRATIONS / "register.tsv").read_text().splitlines()
                if line and not line.startswith("#")]
    assert ["505", NAME, "present", "G04-T10b"] == next(r for r in register if r[0] == "505")[:4]
    policy = {line.split("\t")[0]: line.split("\t")[1:3]
              for line in (MIGRATIONS / "forward-policy.tsv").read_text().splitlines()
              if line and not line.startswith("#")}
    assert policy[NAME] == ["pending_feature", "retention_purge"]
    assert "`505` is `pending_feature retention_purge`" in (MIGRATIONS / "README.md").read_text()
    body = _body(ROLLBACK)
    assert "DROP TABLE" not in body and "DELETE" not in body and "UPDATE" not in body
    assert "DROP FUNCTION IF EXISTS public.fn_retention_purge_content(uuid, integer)" in body


# ── PostgreSQL harness ──────────────────────────────────────────────────────

class Harness(m384.Harness):
    async def learner(self, *, age_days=100):
        """A user with a student row and one old session holding content."""
        user = await self.user()
        await self.con.execute("INSERT INTO students (user_id) VALUES ($1)", user)
        session = await self.con.fetchval(
            "INSERT INTO sessions (user_id, band_overall) VALUES ($1, 6.5) RETURNING id", user)
        await self.con.execute(
            "INSERT INTO responses (session_id, transcript, raw_transcript_text, feedback, pronunciation_payload, "
            "overall_band) VALUES ($1, 'I like', 'i like', '{\"a\": 1}', '{\"p\": 1}', 6.0)", session)
        return user, session

    async def ended(self, user, product, days_ago):
        """An entitlement whose 30-day window ended ``days_ago`` days ago
        (expires_at must stay after starts_at, so it started before that)."""
        starts = await self.con.fetchval("SELECT now() - make_interval(days => $1)", days_ago + 30)
        return await self.entitlement(user, product, starts=starts, days=30)

    async def purge(self, session, days=45, con=None):
        return await self.rpc("fn_retention_purge_content", session, days, con=con)

    async def content(self, session):
        return await self.con.fetchrow(
            "SELECT r.transcript, r.raw_transcript_text, r.feedback, r.pronunciation_payload, r.overall_band, "
            "s.content_purged_at, s.band_overall FROM responses r JOIN sessions s ON s.id = r.session_id "
            "WHERE r.session_id = $1", session)

    async def cohort(self, course=None, archived=False):
        return await self.con.fetchval(
            "INSERT INTO cohorts (course_id, archived_at) VALUES ($1, CASE WHEN $2 THEN now() END) RETURNING id",
            course, archived)

    async def join(self, user, cohort, active=True, con=None):
        await (con or self.con).execute(
            "INSERT INTO student_cohort_memberships (student_id, cohort_id, is_active) "
            "SELECT id, $2, $3 FROM students WHERE user_id = $1", user, cohort, active)

    async def code(self, *, used_by=None, assign=None, assignment_active=True, product=None, expires=None,
                   revoked=False, active=True):
        code = await self.con.fetchval(
            "INSERT INTO access_codes (code, product_id, grant_credits, used_by, is_used, expires_at, is_revoked, "
            "is_active) VALUES ($1, $2, CASE WHEN $2::uuid IS NULL THEN NULL ELSE 0 END, $3::uuid, "
            "$3::uuid IS NOT NULL, CASE WHEN $4::text IS NULL THEN NULL "
            "ELSE now() + $4::text::interval END, $5, $6) RETURNING id",
            "R" + uuid4().hex[:10], product, used_by, expires, revoked, active)
        if assign:
            await self.con.execute("INSERT INTO user_code_assignments (user_id, code_id, is_active) "
                                   "VALUES ($1, $2, $3)", assign, code, assignment_active)
        return code


@pytest_asyncio.fixture
async def pg():
    con = await asyncpg.connect(m384._url())
    schema = "purge_" + uuid4().hex
    harness = Harness(con, schema)
    try:
        for role in ("anon", "authenticated", "service_role"):
            await con.execute(f"DO $$ BEGIN CREATE ROLE {role}; EXCEPTION WHEN duplicate_object THEN NULL; END $$")
        await con.execute(f"CREATE SCHEMA {schema}; SET search_path = {schema}, pg_catalog;" + m384.PRE + SHAPE)
        await con.execute(f"GRANT USAGE ON SCHEMA {schema} TO anon, authenticated, service_role")
        await con.execute(harness.sql(m384.M1))
        await con.execute(harness.sql(m384.FORWARD))
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


def _purged(row) -> bool:
    return (row["transcript"], row["raw_transcript_text"], row["feedback"], row["pronunciation_payload"]) \
        == (None, None, None, None) and row["content_purged_at"] is not None


@pytest.mark.asyncio
async def test_rpc_is_service_role_only_and_validates_arguments(pg):
    row = await pg.con.fetchrow("SELECT prosecdef, proconfig FROM pg_proc WHERE oid = to_regprocedure($1)",
                                f"{pg.schema}.{RPC}")
    assert row and row["prosecdef"] and row["proconfig"] == ["search_path=pg_catalog, pg_temp"]
    for role in ("anon", "authenticated"):
        assert not await pg.con.fetchval("SELECT has_function_privilege($1, $2, 'EXECUTE')", role,
                                         f"{pg.schema}.{RPC}")
    assert await pg.con.fetchval("SELECT has_function_privilege('service_role', $1, 'EXECUTE')",
                                 f"{pg.schema}.{RPC}")
    _, session = await pg.learner()
    for days in (-1, 3651, None):
        with pytest.raises(asyncpg.exceptions.InvalidParameterValueError):
            await pg.purge(session, days)
    assert (await pg.purge(uuid4()))["status"] == "not_found"


@pytest.mark.asyncio
async def test_never_enrolled_is_purged_once_and_scores_stay(pg):
    _, session = await pg.learner()
    assert await pg.purge(session) == {"status": "purged", "responses": 1}
    row = await pg.content(session)
    assert _purged(row) and row["overall_band"] == 6 and row["band_overall"] == 6.5
    assert await pg.purge(session) == {"status": "already_purged"}


@pytest.mark.asyncio
async def test_the_window_decides(pg):
    product = await pg.product(kind="online")
    cases = {
        "live": dict(starts=None, days=30),
        "ended_10_days_ago": dict(starts=None, ago=10),          # 35 days of window left
        "starts_later": dict(starts="later", days=30),
        "ended_50_days_ago": dict(starts=None, ago=50),          # window closed 5 days ago
    }
    sessions = {}
    for name, case in cases.items():
        user, sessions[name] = await pg.learner()
        starts = None
        if "ago" in case:
            await pg.ended(user, product, case["ago"])
            continue
        if case["starts"] == "later":
            starts = await pg.con.fetchval("SELECT now() + interval '5 days'")
        await pg.entitlement(user, product, starts=starts, days=case["days"])
    assert (await pg.purge(sessions["live"]))["reason"] == "window_open"
    assert (await pg.purge(sessions["ended_10_days_ago"]))["reason"] == "window_open"
    assert (await pg.purge(sessions["starts_later"]))["reason"] == "window_open"
    assert (await pg.purge(sessions["ended_50_days_ago"]))["status"] == "purged"
    # A wider window keeps the last one too (the days come from the caller).
    user, session = await pg.learner()
    await pg.ended(user, product, 50)
    assert (await pg.purge(session, 60))["reason"] == "window_open"
    # Revoked 50 days ago, though it would have run another year: ends at revocation.
    user, session = await pg.learner()
    ent = await pg.entitlement(user, product, days=365)
    await pg.con.execute("UPDATE entitlements SET status = 'revoked', revoked_at = now() - interval '50 days' "
                         "WHERE id = $1", ent)
    assert (await pg.purge(session))["status"] == "purged"
    # Active with no end: always open.
    user, session = await pg.learner()
    await pg.con.execute(
        "INSERT INTO entitlements (user_id, product_id, course_id, source, source_ref, starts_at, expires_at) "
        "SELECT $1, id, course_id, 'admin_grant', gen_random_uuid(), now() - interval '400 days', NULL "
        "FROM course_products WHERE id = $2", user, product)
    assert (await pg.purge(session))["reason"] == "window_open"
    for name in ("live", "ended_10_days_ago", "starts_later"):
        assert (await pg.content(sessions[name]))["transcript"] == "I like"


@pytest.mark.asyncio
async def test_a_live_class_or_legacy_code_keeps_the_content(pg):
    product = await pg.product(kind="online")
    course = await pg.con.fetchval("SELECT course_id FROM course_products WHERE id = $1", product)
    live_class, archived_class = await pg.cohort(course), await pg.cohort(course, archived=True)
    keep, purge = [], []

    user, s = await pg.learner()          # live class beside a long-expired entitlement
    await pg.ended(user, product, 300)
    await pg.join(user, live_class)
    keep.append(s)
    user, s = await pg.learner()          # class archived, or membership inactive
    await pg.join(user, archived_class)
    purge.append(s)
    user, s = await pg.learner()
    await pg.join(user, live_class, active=False)
    purge.append(s)
    user, s = await pg.learner()          # legacy code through an active assignment
    await pg.code(assign=user, expires="40 days")
    keep.append(s)
    user, s = await pg.learner()          # legacy code through used_by, no assignment row
    await pg.code(used_by=user)
    keep.append(s)
    user, s = await pg.learner()          # used_by but the assignment was switched off
    await pg.code(used_by=user, assign=user, assignment_active=False)
    purge.append(s)
    for kwargs in (dict(revoked=True), dict(active=False), dict(expires="-1 day"),
                   dict(product=await pg.product(kind="class"))):
        user, s = await pg.learner()      # revoked, locked, expired, or a product code
        await pg.code(assign=user, **kwargs)
        purge.append(s)
    for s in keep:
        assert (await pg.purge(s)) == {"status": "kept", "reason": "live_access"}
        assert (await pg.content(s))["transcript"] == "I like"
    for s in purge:
        assert (await pg.purge(s))["status"] == "purged", s


async def _blocked_until_commit(pg, session, write):
    """``write(con)`` runs in an open transaction on another connection; the
    purge must wait for it, then see its result."""
    other = await pg.connect()
    tx = other.transaction()
    await tx.start()
    await write(other)
    purge = asyncio.create_task(pg.purge(session, con=await pg.connect()))
    await asyncio.sleep(0.5)
    assert not purge.done(), "the purge did not wait for the open write"
    await tx.commit()
    return await asyncio.wait_for(purge, 10)


@pytest.mark.asyncio
async def test_a_write_in_flight_is_waited_for_and_then_seen(pg):
    product = await pg.product(kind="online")
    course = await pg.con.fetchval("SELECT course_id FROM course_products WHERE id = $1", product)
    live_class = await pg.cohort(course)

    # 1. A first grant through the real 384 RPC (it takes the user's credit lock).
    user, session = await pg.learner()

    async def grant(con):
        await pg.rpc("fn_entitlement_admin_grant", user, user, product, 30, 0, None, "Cấp quyền thử", uuid4(),
                     con=con)

    assert await _blocked_until_commit(pg, session, grant) == {"status": "kept", "reason": "window_open"}

    # 2. A raw entitlement insert (no advisory lock): waits on the users row.
    user, session = await pg.learner()

    async def insert(con):
        await con.execute(
            "INSERT INTO entitlements (user_id, product_id, course_id, source, source_ref, starts_at, expires_at) "
            "VALUES ($1, $2, $3, 'admin_grant', gen_random_uuid(), now(), now() + interval '30 days')",
            user, product, course)

    assert (await _blocked_until_commit(pg, session, insert))["reason"] == "window_open"

    # 3. A new class membership: waits on the students row.
    user, session = await pg.learner()
    assert (await _blocked_until_commit(pg, session, lambda con: pg.join(user, live_class, con=con))) \
        == {"status": "kept", "reason": "live_access"}

    # 4. Reactivating an existing membership: waits on the membership row.
    user, session = await pg.learner()
    await pg.join(user, live_class, active=False)
    reactivate = "UPDATE student_cohort_memberships SET is_active = true WHERE student_id = " \
                 "(SELECT id FROM students WHERE user_id = $1)"
    assert (await _blocked_until_commit(pg, session, lambda con: con.execute(reactivate, user)))["reason"] \
        == "live_access"

    # 5. Extending an expired entitlement back to life: waits on the entitlement row.
    user, session = await pg.learner()
    ent = await pg.ended(user, product, 100)
    extend = "UPDATE entitlements SET expires_at = now() + interval '30 days' WHERE id = $1"
    assert (await _blocked_until_commit(pg, session, lambda con: con.execute(extend, ent)))["reason"] \
        == "window_open"

    # 6. Redeeming a legacy code (a new assignment row): waits on the users row.
    user, session = await pg.learner()
    code = await pg.code(expires="40 days")
    assign = "INSERT INTO user_code_assignments (user_id, code_id, is_active) VALUES ($1, $2, true)"
    assert (await _blocked_until_commit(pg, session, lambda con: con.execute(assign, user, code)))["reason"] \
        == "live_access"

    # Control: an unrelated user's write does not hold the purge, and a write
    # that is rolled back leaves the purge free to go on.
    user, session = await pg.learner()
    other = await pg.connect()
    tx = other.transaction()
    await tx.start()
    stranger = await pg.user()
    await other.execute("INSERT INTO students (user_id) VALUES ($1)", stranger)
    assert (await asyncio.wait_for(pg.purge(session, con=await pg.connect()), 5))["status"] == "purged"
    await tx.rollback()


@pytest.mark.asyncio
async def test_a_regrade_holding_the_credit_lock_does_not_deadlock_with_a_purge(pg):
    """SA #2624: fn_credit_reserve takes the learner's advisory lock, then its
    cluster row needs KEY SHARE on the session. The purge waits on the
    advisory lock before it locks the session row, so both finish."""
    product = await pg.product(kind="online")
    user, session = await pg.learner()
    await pg.entitlement(user, product, credits=1)
    regrade = await pg.connect()
    tx = regrade.transaction()
    await tx.start()
    await regrade.execute("SELECT fn_credit_lock_user($1)", user)
    purge = asyncio.create_task(pg.purge(session, con=await pg.connect()))
    await asyncio.sleep(0.5)
    assert not purge.done(), "the purge did not wait for the learner's credit lock"
    reserved = await asyncio.wait_for(pg.reserve(user, "speaking_cluster", f"{session}:p1:q{uuid4()}",
                                                 con=regrade), 10)
    assert reserved["status"] == "reserved"
    await tx.commit()
    assert await asyncio.wait_for(purge, 10) == {"status": "kept", "reason": "window_open"}
    # The other order: a purge holding its locks makes the regrade wait, then it goes on.
    user, session = await pg.learner()
    await pg.ended(user, product, 100)
    held = await pg.connect()
    tx = held.transaction()
    await tx.start()
    assert (await pg.purge(session, con=held))["status"] == "purged"
    other = await pg.connect()
    grant = asyncio.create_task(pg.reserve(user, "speaking_cluster", f"{session}:p1:q{uuid4()}", con=other))
    await asyncio.sleep(0.5)
    assert not grant.done()
    await tx.commit()
    # The learner's only course ended, so the regrade answers no_entitlement, after the purge.
    assert await asyncio.wait_for(grant, 10) == {"status": "no_entitlement"}


@pytest.mark.asyncio
async def test_two_sweeps_purge_one_session_once(pg):
    _, session = await pg.learner()
    cons = [await pg.connect(), await pg.connect()]
    results = await asyncio.gather(*(pg.purge(session, con=con) for con in cons))
    assert sorted(r["status"] for r in results) == ["already_purged", "purged"]


@pytest.mark.asyncio
async def test_rollback_drops_only_the_function(pg):
    _, session = await pg.learner()
    await pg.purge(session)
    await pg.con.execute(pg.sql(ROLLBACK))
    assert await pg.con.fetchval("SELECT to_regprocedure($1)", f"{pg.schema}.{RPC}") is None
    assert _purged(await pg.content(session))
    await pg.con.execute(pg.sql(FORWARD))
    assert await pg.con.fetchval("SELECT to_regprocedure($1)", f"{pg.schema}.{RPC}") is not None
