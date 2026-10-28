"""Migration 322 (AIOPS-0024 FR-003) on LOCAL disposable PostgreSQL.

Admin-only AI model overrides, their trigger-written append-only audit, the
routing-layer failure log and the dashboard rollups: RLS on, nothing for
anon/authenticated, only the service-role privileges the backend uses, and
safe re-application.
"""
import asyncio
import os
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

import asyncpg
import pytest

DB = os.environ.get("TEST_PG_URL", "")
MIGRATION = (Path(__file__).resolve().parents[1]
             / "migrations/322_ai_model_overrides_and_failures.sql").read_text()
TABLES = ("ai_model_overrides", "ai_model_override_audit", "ai_provider_failures")
FUNCTIONS = ("fn_admin_ai_usage_rollup(timestamptz,timestamptz)",
             "fn_admin_ai_failure_rollup(timestamptz,timestamptz)")


async def _run(sql, *args, role=None):
    connection = await asyncpg.connect(DB)
    try:
        if role:
            await connection.execute(f"SET ROLE {role}")
        if not args and ";" in sql:
            await connection.execute(sql)
            return []
        return await connection.fetch(sql, *args)
    finally:
        await connection.close()


def query(sql, *args, role=None):
    return asyncio.run(_run(sql, *args, role=role))


@pytest.fixture
def schema():
    parsed = urlparse(DB)
    if parsed.scheme not in {"postgres", "postgresql"} or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("322 requires an explicitly LOCAL disposable PostgreSQL URL")
        pytest.skip("Local PostgreSQL unavailable")
    name = "ai_overrides_" + uuid4().hex
    query("""DO $$ BEGIN
        IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
        IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
        IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $$""")
    # ai_usage_logs as shaped by migrations 031 + 286 (columns the rollup reads).
    query(f"""
        CREATE SCHEMA {name};
        GRANT USAGE ON SCHEMA {name} TO anon, authenticated, service_role;
        CREATE TABLE {name}.ai_usage_logs(
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, session_id uuid,
            service text NOT NULL, model text NOT NULL, input_tokens integer,
            output_tokens integer, cache_read_tokens integer, cache_write_tokens integer,
            audio_seconds real, text_chars integer, cost_usd_est real,
            created_at timestamptz NOT NULL DEFAULT now(), feature text, operation text,
            status text NOT NULL DEFAULT 'success', error_code text, thinking_tokens integer,
            pricing_version text, cost_source text NOT NULL DEFAULT 'catalog_estimate');
        -- The backend already reads/writes the ledger as service_role; the
        -- rollup is SECURITY INVOKER and relies on exactly that grant.
        GRANT SELECT, INSERT ON {name}.ai_usage_logs TO service_role;
    """)
    sql = (MIGRATION.replace("public.", name + ".")
           .replace("search_path = public,", "search_path = " + name + ","))
    try:
        query(sql)
        query(sql)  # forward re-application is safe
        yield name
    finally:
        query(f"DROP SCHEMA IF EXISTS {name} CASCADE")


def test_tables_have_rls_and_no_client_privileges(schema):
    rows = query("""SELECT c.relname, c.relrowsecurity FROM pg_class c
                      JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname = $1 AND c.relname = ANY($2::text[])""", schema, list(TABLES))
    assert {r["relname"]: r["relrowsecurity"] for r in rows} == {t: True for t in TABLES}
    assert query("""SELECT count(*) n FROM pg_policies WHERE schemaname = $1""", schema)[0]["n"] == 0

    for role in ("anon", "authenticated"):
        for table in TABLES:
            for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"):
                assert not query("SELECT has_table_privilege($1, $2, $3) ok",
                                 role, f"{schema}.{table}", privilege)[0]["ok"], (role, table, privilege)
        for function in FUNCTIONS:
            assert not query("SELECT has_function_privilege($1, $2, 'EXECUTE') ok",
                             role, f"{schema}.{function}")[0]["ok"], (role, function)

    expected = {
        "ai_model_overrides": {"SELECT", "INSERT", "UPDATE", "DELETE"},
        "ai_model_override_audit": {"SELECT", "INSERT"},
        "ai_provider_failures": {"SELECT", "INSERT"},
    }
    for table, granted in expected.items():
        for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"):
            ok = query("SELECT has_table_privilege('service_role', $1, $2) ok",
                       f"{schema}.{table}", privilege)[0]["ok"]
            assert ok is (privilege in granted), (table, privilege)
    for function in FUNCTIONS:
        assert query("SELECT has_function_privilege('service_role', $1, 'EXECUTE') ok",
                     f"{schema}.{function}")[0]["ok"]


def test_anon_and_authenticated_cannot_read_or_write(schema):
    for role in ("anon", "authenticated"):
        with pytest.raises(asyncpg.exceptions.InsufficientPrivilegeError):
            query(f"SELECT * FROM {schema}.ai_model_overrides", role=role)
        with pytest.raises(asyncpg.exceptions.InsufficientPrivilegeError):
            query(f"INSERT INTO {schema}.ai_model_overrides(feature, preferred_provider) VALUES ('writing_grading', 'gemini');",
                  role=role)
        with pytest.raises(asyncpg.exceptions.InsufficientPrivilegeError):
            query(f"SELECT * FROM {schema}.fn_admin_ai_usage_rollup(now() - interval '1 day', now())", role=role)


def test_service_role_writes_are_audited_and_audit_is_append_only(schema):
    actor, second = uuid4(), uuid4()
    write = f"""INSERT INTO {schema}.ai_model_overrides(feature, preferred_provider, anthropic_model, updated_by)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (feature) DO UPDATE SET preferred_provider = EXCLUDED.preferred_provider,
                    anthropic_model = EXCLUDED.anthropic_model, updated_by = EXCLUDED.updated_by,
                    updated_at = now() RETURNING feature"""
    query(write, "writing_grading", "gemini", None, actor, role="service_role")
    query(write, "writing_grading", "gemini", None, second, role="service_role")  # no change → no audit row
    query(write, "writing_grading", "anthropic", "claude-haiku-5-5", second, role="service_role")
    query(f"DELETE FROM {schema}.ai_model_overrides WHERE feature = 'writing_grading';", role="service_role")

    audit = query(f"""SELECT feature, action, old_preferred_provider, new_preferred_provider,
                             old_anthropic_model, new_anthropic_model, changed_by
                        FROM {schema}.ai_model_override_audit ORDER BY id""", role="service_role")
    assert [dict(r) for r in audit] == [
        {"feature": "writing_grading", "action": "insert", "old_preferred_provider": None,
         "new_preferred_provider": "gemini", "old_anthropic_model": None,
         "new_anthropic_model": None, "changed_by": actor},
        {"feature": "writing_grading", "action": "update", "old_preferred_provider": "gemini",
         "new_preferred_provider": "anthropic", "old_anthropic_model": None,
         "new_anthropic_model": "claude-haiku-5-5", "changed_by": second},
        {"feature": "writing_grading", "action": "delete", "old_preferred_provider": "anthropic",
         "new_preferred_provider": None, "old_anthropic_model": "claude-haiku-5-5",
         "new_anthropic_model": None, "changed_by": None},
    ]

    # Append-only even for the table owner, not just for missing grants.
    for statement in (f"UPDATE {schema}.ai_model_override_audit SET changed_by = NULL;",
                      f"DELETE FROM {schema}.ai_model_override_audit;"):
        with pytest.raises(asyncpg.exceptions.InsufficientPrivilegeError):
            query(statement)
    assert query(f"SELECT count(*) n FROM {schema}.ai_model_override_audit")[0]["n"] == 3


def test_re_application_does_not_duplicate_triggers(schema):
    rows = query("""SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                      JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname = $1 AND NOT t.tgisinternal ORDER BY 1""", schema)
    assert [r["tgname"] for r in rows] == [
        "trg_ai_model_override_audit", "trg_ai_model_override_audit_append_only",
    ]


@pytest.mark.parametrize("column, value", [
    ("preferred_provider", "mystery"),
    ("anthropic_model", "gpt-5"),
    ("anthropic_model", "claude-Sonnet; drop table"),
    ("feature", "Writing Grading"),
])
def test_override_shape_checks(schema, column, value):
    values = {"feature": "course_writing", "preferred_provider": None, "anthropic_model": None}
    values[column] = value
    with pytest.raises(asyncpg.exceptions.CheckViolationError):
        query(f"""INSERT INTO {schema}.ai_model_overrides(feature, preferred_provider, anthropic_model)
                  VALUES ($1, $2, $3)""",
              values["feature"], values["preferred_provider"], values["anthropic_model"],
              role="service_role")


def test_failure_log_shape_and_rollup(schema):
    insert = f"""INSERT INTO {schema}.ai_provider_failures(
                     created_at, feature, provider, model, route_slot, attempt, error_type, error_code, outcome)
                 VALUES ($1::text::timestamptz, $2, $3, $4, $5, $6, $7, $8, $9)"""
    rows = [
        ("2026-10-26T03:00:00Z", "course_writing", "anthropic", "claude-haiku-5-5", None, None, "rate_limit", "rate_limited", "fallback"),
        ("2026-10-26T03:05:00Z", "course_writing", "anthropic", "claude-haiku-5-5", None, None, "rate_limit", "rate_limited", "fallback"),
        ("2026-10-26T04:00:00Z", "speaking_grading", "gemini", "gemini-3.8-flash", "grading_primary", 0, "timeout", "timeout", "retry"),
        ("2026-10-20T04:00:00Z", "speaking_grading", "gemini", "gemini-3.8-flash", "grading_primary", 1, "timeout", "timeout", "final"),
    ]
    for row in rows:
        query(insert, *row, role="service_role")

    for bad in (("provider", "mistral"), ("error_type", "boom"), ("outcome", "served")):
        values = list(rows[0])
        values[{"provider": 2, "error_type": 6, "outcome": 8}[bad[0]]] = bad[1]
        with pytest.raises(asyncpg.exceptions.CheckViolationError):
            query(insert, *values, role="service_role")

    result = query(f"""SELECT * FROM {schema}.fn_admin_ai_failure_rollup(
                           '2026-10-25T17:00:00Z', '2026-10-26T17:00:00Z') ORDER BY feature""",
                   role="service_role")
    assert [dict(r) for r in result] == [
        {"feature": "course_writing", "provider": "anthropic", "error_type": "rate_limit",
         "outcome": "fallback", "failures": 2},
        {"feature": "speaking_grading", "provider": "gemini", "error_type": "timeout",
         "outcome": "retry", "failures": 1},
    ]


def test_usage_rollup_groups_complete_window(schema):
    insert = f"""INSERT INTO {schema}.ai_usage_logs(
                     created_at, feature, service, model, status, input_tokens, output_tokens,
                     thinking_tokens, cache_read_tokens, cache_write_tokens, cost_usd_est,
                     pricing_version, cost_source)
                 VALUES ($1::text::timestamptz, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)"""
    version = "anthropic:claude-haiku-5-5:2026-10-07:open"
    for _ in range(3):
        query(insert, "2026-10-26T02:00:00Z", "course_writing", "claude", "claude-haiku-5-5", "success",
              1000, 200, None, 500, 100, 0.0002, version, "catalog_estimate")
    query(insert, "2026-10-26T02:30:00Z", "course_writing", "claude", "claude-haiku-5-5", "error",
          None, None, None, None, None, None, None, "unpriced")
    # Outside the window on both sides.
    query(insert, "2026-10-25T16:59:59Z", "course_writing", "claude", "claude-haiku-5-5", "success",
          9, 9, None, None, None, 1.0, version, "catalog_estimate")
    query(insert, "2026-10-26T17:00:00Z", "course_writing", "claude", "claude-haiku-5-5", "success",
          9, 9, None, None, None, 1.0, version, "catalog_estimate")

    result = query(f"""SELECT * FROM {schema}.fn_admin_ai_usage_rollup(
                           '2026-10-25T17:00:00Z', '2026-10-26T17:00:00Z') ORDER BY status DESC""",
                   role="service_role")
    success, error = (dict(r) for r in result)
    assert success["calls"] == 3 and success["priced_calls"] == 3
    assert (success["input_tokens"], success["output_tokens"], success["thinking_tokens"],
            success["cache_read_tokens"], success["cache_write_tokens"]) == (3000, 600, 0, 1500, 300)
    assert success["cost_usd"] == pytest.approx(0.0006, rel=1e-5)
    assert success["pricing_version"] == version
    assert error["calls"] == 1 and error["priced_calls"] == 0 and error["cost_usd"] is None
    assert error["cost_source"] == "unpriced"


def test_usage_rollup_never_merges_legacy_rows(schema):
    insert = f"""INSERT INTO {schema}.ai_usage_logs(
                     created_at, feature, service, model, status, input_tokens, output_tokens,
                     cost_usd_est, pricing_version, cost_source)
                 VALUES ($1::text::timestamptz, 'course_writing', 'claude', 'claude-haiku-5-5',
                         'success', $2, 10, NULL, NULL, 'catalog_estimate')"""
    query(insert, "2026-10-26T02:00:00Z", 60_000, role="service_role")
    query(insert, "2026-10-26T03:00:00Z", 60_000, role="service_role")
    rows = query(f"""SELECT calls, input_tokens, last_at FROM {schema}.fn_admin_ai_usage_rollup(
                         '2026-10-25T17:00:00Z', '2026-10-26T17:00:00Z') ORDER BY last_at""",
                 role="service_role")
    # One row per legacy ledger row, each with its own timestamp, so pricing
    # periods and per-request tiers are applied per call.
    assert [(r["calls"], r["input_tokens"]) for r in rows] == [(1, 60_000), (1, 60_000)]


def test_usage_rollup_pages_past_max_rows_without_repeating_or_dropping_rows(schema):
    # Codex P2 on 30c830309: > 1000 legacy rows page through PostgREST
    # (ORDER BY <order> LIMIT/OFFSET per request); the order the dashboard
    # sends must be a unique key so the pages equal the unpaginated rollup.
    from services.admin_ai_dashboard import FAILURE_ROLLUP_ORDER, RPC_PAGE, USAGE_ROLLUP_ORDER

    query(f"""INSERT INTO {schema}.ai_usage_logs(
                  created_at, feature, service, model, status, input_tokens, output_tokens,
                  cost_usd_est, pricing_version, cost_source)
              SELECT '2026-10-26T02:00:00Z'::timestamptz + i * interval '1 second',
                     'course_writing', 'claude', 'claude-haiku-5-5', 'success', 100 + i, 10,
                     CASE WHEN i % 2 = 0 THEN 0.001 END, NULL, 'catalog_estimate'
                FROM generate_series(1, 1205) i;
              INSERT INTO {schema}.ai_usage_logs(
                  created_at, feature, service, model, status, input_tokens, output_tokens,
                  cost_usd_est, pricing_version, cost_source)
              SELECT '2026-10-26T03:00:00Z', f, 'claude', 'claude-haiku-5-5', s, 1, 1, NULL,
                     CASE WHEN s = 'success' THEN 'anthropic:claude-haiku-5-5:2026-10-07:open' END,
                     CASE WHEN s = 'success' THEN 'catalog_estimate' ELSE 'unpriced' END
                FROM unnest(ARRAY['course_writing', NULL]) f, unnest(ARRAY['success', 'error']) s;""")
    rollup = f"{schema}.fn_admin_ai_usage_rollup('2026-10-25T17:00:00Z', '2026-10-26T17:00:00Z')"
    order = ", ".join(f"{column} ASC NULLS LAST" for column in USAGE_ROLLUP_ORDER)

    def key(row):
        return tuple(row[column] for column in USAGE_ROLLUP_ORDER)

    everything = query(f"SELECT * FROM {rollup}", role="service_role")
    assert len(everything) == 1205 + 4
    assert len({key(r) for r in everything}) == len(everything)  # the order is total

    paged, offset = [], 0
    while True:
        page = query(f"SELECT * FROM {rollup} ORDER BY {order} LIMIT {RPC_PAGE} OFFSET {offset}",
                     role="service_role")
        paged.extend(page)
        if len(page) < RPC_PAGE:
            break
        offset += RPC_PAGE
    assert offset == 1000
    assert sorted(map(tuple, paged), key=repr) == sorted(map(tuple, everything), key=repr)
    assert sum(r["calls"] for r in paged) == 1205 + 4

    failure_order = ", ".join(FAILURE_ROLLUP_ORDER)  # the columns exist in the rollup
    assert query(f"""SELECT * FROM {schema}.fn_admin_ai_failure_rollup(
                         '2026-10-25T17:00:00Z', '2026-10-26T17:00:00Z') ORDER BY {failure_order}""",
                 role="service_role") == []
