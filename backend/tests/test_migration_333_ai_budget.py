"""Migration 333 (AIBUDGET-0033, T002): AI budget counters, reservations,
deferred grading, session refresh generation, alerts and temporary raises.

The static half always runs: it pins the migration text to plan.md
"Migration 333" (one transaction, SECURITY DEFINER + pinned search_path,
service-role-only EXECUTE, the item 11 trigger columns, the guarded down
script, the forward-policy group).

The PostgreSQL half builds a disposable schema owned by a NOSUPERUSER role
(the hosted-Supabase runner `postgres` is not a superuser) with Supabase's
default privileges and the tables 333 writes, including the 224/225 response
guard verbatim. It applies 333 twice and proves:

- catalog, RLS, grants, function ACLs and an idempotent re-apply;
- reservations: all-or-nothing bundles, every line counted on `total`, soft
  scopes never refused, replay never grants, settle/release/expire
  arithmetic, zero V3 drift, provider spend-limit closure, cap-refusal and
  crossing alerts exactly once, 4N racing reservations for N slots (AC4);
- raises: every refusal, the effective cap, revert at expires_at, the
  monthly limit and append-only events (FR-022);
- the responses generation trigger and the band writers' generation fence,
  including a deadlock race against response writes (FR-024);
- deferred save/claim/commit for Speaking and Writing, and class-score sync;
- N-1 response writes with the trigger installed, the postcondition and the
  guarded down script.

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import pytest

import test_migration_326_student_archive as m326
import test_migration_331_archived_student_give_guard as m331
from test_migration_240_core_attempt_evidence import DB, psql

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
MIGRATIONS = BACKEND / "migrations"
NAME = "333_ai_budget_hard_cap.sql"
SQL = (MIGRATIONS / NAME).read_text(encoding="utf-8")
CODE = m326._strip_comments(SQL)
GUARD_225 = (MIGRATIONS / "225_allow_admitted_speaking_grade_after_submit.sql").read_text(encoding="utf-8")
OWNER = "m333_owner"
TABLES = ("ai_budget_counters", "ai_budget_reservations", "ai_deferred_grading_jobs",
          "ai_deferred_session_refresh", "ai_budget_raises", "ai_budget_raise_events",
          "ai_budget_alerts", "ai_budget_heartbeat")
SERVICE_TABLE_GRANTS = {
    "ai_budget_counters": {"SELECT"},
    "ai_budget_reservations": {"SELECT"},
    "ai_deferred_grading_jobs": {"SELECT", "INSERT", "UPDATE"},
    "ai_deferred_session_refresh": {"SELECT"},
    "ai_budget_raises": {"SELECT"},
    "ai_budget_raise_events": {"SELECT"},
    "ai_budget_alerts": {"SELECT"},
    "ai_budget_heartbeat": {"SELECT", "INSERT", "UPDATE"},
}
RPCS = (
    "fn_ai_budget_reserve(text,jsonb,jsonb,integer)",
    "fn_ai_budget_settle(uuid,numeric)",
    "fn_ai_budget_release(uuid)",
    "fn_ai_budget_expire(timestamp with time zone)",
    "fn_ai_budget_close_scope(text,date,text)",
    "fn_ai_deferred_save(jsonb,jsonb)",
    "fn_ai_deferred_claim(integer,integer)",
    "fn_ai_deferred_commit(uuid,uuid,jsonb)",
    "fn_ai_deferred_claim_writing(integer,integer)",
    "fn_ai_deferred_commit_writing(uuid,uuid,jsonb)",
    "fn_ai_deferred_aggregate_write(uuid,bigint,jsonb)",
    "fn_ai_session_bands_write(uuid,bigint,jsonb,boolean,boolean)",
    "fn_ai_class_sync(uuid)",
    "fn_ai_budget_raise_grant(text,numeric,integer,text,uuid,text,jsonb,text)",
    "fn_ai_budget_raise_end(uuid,uuid,text,text,text)",
    "fn_ai_budget_raise_expire_sweep(timestamp with time zone)",
)
INTERNAL = (
    "fn_ai_budget_thresholds(text,text)",
    "fn_ai_budget_lock_counter(text,text,date)",
    "fn_ai_budget_alert_crossings(text,text,date)",
    "fn_ai_budget_active_raise(text)",
    "fn_ai_response_revision(uuid,text)",
    "fn_ai_patch_row(text,uuid,jsonb,text[])",
    "fn_ai_insert_row(text,jsonb,text[])",
    "fn_ai_budget_ensure_refresh(uuid)",
    "fn_ai_budget_raise_record_end(uuid,text,uuid,text,text,text)",
    "fn_ai_budget_recompute(date)",
    "fn_ai_session_generation_bump()",
)


def _without_bodies(code: str) -> str:
    return re.sub(r"\$\$.*?\$\$", "$$ $$", code, flags=re.S)


def _function(name: str) -> str:
    return m326._function(CODE, name)


# ── Static contract ─────────────────────────────────────────────────────────

def test_one_transaction_with_lock_timeout_and_no_data_change():
    assert CODE.strip().startswith("BEGIN;") and CODE.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s';" in CODE
    top = _without_bodies(CODE)
    for forbidden in (r"\bDROP\b", r"DELETE\s+FROM", r"\bTRUNCATE\s+(?:TABLE\s+)?public", r"^\s*UPDATE\s",
                      r"INSERT\s+INTO", r"DISABLE\s+TRIGGER", r"session_replication_role"):
        assert not re.search(forbidden, top, re.M | re.I), forbidden


def test_every_table_has_rls_and_no_client_grant():
    for table in TABLES:
        assert f"CREATE TABLE IF NOT EXISTS public.{table} (" in CODE, table
        assert re.search(rf"ALTER TABLE public\.{table}\s+ENABLE ROW LEVEL SECURITY;", CODE), table
        assert re.search(rf"REVOKE ALL ON public\.{table}\s+FROM PUBLIC, anon, authenticated, service_role;",
                         CODE), table
    assert not re.search(r"GRANT[^;]*\bTO\s+(?:anon|authenticated|PUBLIC)\b", CODE, re.I)
    assert not re.search(r"CREATE POLICY", CODE, re.I)


def test_every_function_is_definer_with_pinned_search_path_and_service_only_execute():
    names = re.findall(r"CREATE OR REPLACE FUNCTION public\.(\w+)\(", CODE)
    assert len(names) == len(set(names)), "each function is defined once"
    for name in names:
        fn = _function(name)
        assert "SET search_path = public, pg_temp" in fn, name
        if name != "fn_ai_budget_raise_events_append_only":
            assert "SECURITY DEFINER" in fn, name
        assert re.search(rf"REVOKE ALL ON FUNCTION public\.{name}\(", CODE), name
    granted = set(re.findall(r"GRANT EXECUTE ON FUNCTION public\.(\w+)\(", CODE))
    assert granted == {sig.split("(")[0] for sig in RPCS}
    assert not granted & {sig.split("(")[0] for sig in INTERNAL}
    assert re.findall(r"GRANT EXECUTE ON FUNCTION [^;]+ TO (\w+);", CODE) == ["service_role"] * len(RPCS)


def test_generation_trigger_fires_on_the_planned_columns_after_the_refresh_table():
    assert re.search(
        r"CREATE OR REPLACE TRIGGER trg_ai_session_generation\s+AFTER INSERT OR DELETE OR UPDATE OF "
        r"overall_band, final_band_p, final_overall_band, feedback, grading_status\s+ON public\.responses\s+"
        r"FOR EACH ROW EXECUTE FUNCTION public\.fn_ai_session_generation_bump\(\);", CODE)
    assert CODE.index("CREATE TABLE IF NOT EXISTS public.ai_deferred_session_refresh") < CODE.index(
        "CREATE OR REPLACE TRIGGER trg_ai_session_generation")
    bump = _function("fn_ai_session_generation_bump")
    # Session row before refresh row, also for a DELETE the 225 guard does not lock.
    assert bump.index("FROM public.sessions WHERE id = v_session FOR UPDATE") < bump.index(
        "INSERT INTO public.ai_deferred_session_refresh")


def test_raise_objects_precede_the_alerts_that_reference_them():
    assert CODE.index("CREATE TABLE IF NOT EXISTS public.ai_budget_raises") < CODE.index(
        "CREATE TABLE IF NOT EXISTS public.ai_budget_alerts")
    raises = CODE[CODE.index("CREATE TABLE IF NOT EXISTS public.ai_budget_raises"):]
    raises = raises[:raises.index(");\n") + 2]
    assert "CHECK (scope IN ('google', 'azure', 'openai', 'elevenlabs'))" in raises
    assert "CHECK (amount_usd <= base_month_cap_usd)" in raises
    assert "interval '1 hour'" in raises and "interval '24 hours'" in raises
    assert "CHECK (granted_aal = 'aal2')" in raises
    assert re.search(r"ON public\.ai_budget_raises \(scope\) WHERE ended_at IS NULL", CODE)


def test_reserve_reads_the_raise_after_locking_and_never_caps_soft_scopes():
    fn = _function("fn_ai_budget_reserve")
    assert fn.index("pg_advisory_xact_lock(333, hashtext(p_request_key))") < fn.index(
        "FROM public.ai_budget_reservations WHERE request_key = p_request_key")
    assert fn.index("fn_ai_budget_lock_counter") < fn.index("fn_ai_budget_active_raise")
    assert "v_soft := v_scope IN ('anthropic', 'total');" in fn
    assert "UNION SELECT 'total'" in fn, "every line is counted on total"


def test_postconditions_cover_the_plan_item_8_checks():
    post = CODE[CODE.rindex("DO $$"):]
    for marker in ("ai_budget_table_missing_or_rls_off", "ai_budget_table_privileges_wrong",
                   "ai_budget_alert_column_privileges_wrong", "ai_budget_unique_index_missing",
                   "ai_budget_writing_jobs_columns_missing", "ai_budget_trigger_missing",
                   "trg_ai_session_generation", "ai_budget_function_acl_wrong", "server_version_num"):
        assert marker in post, marker
    for sig in RPCS + INTERNAL:
        assert sig.replace("timestamp with time zone", "timestamptz") in post, sig


def test_down_script_is_guarded_and_drops_the_trigger_first():
    note = _rollback_sql("public")
    for guard in ("rollback_unsafe_deferred_jobs_pending", "rollback_unsafe_session_refresh_owed",
                  "rollback_unsafe_writing_jobs_deferred", "rollback_unsafe_raise_active"):
        assert guard in note, guard
    drops = [m.start() for m in re.finditer(r"\bDROP\b", note)]
    assert drops and note.index("DROP TRIGGER IF EXISTS trg_ai_session_generation") == drops[0]
    assert note.rindex("RAISE EXCEPTION") < drops[0]
    assert "ai_budget_raise_events" not in note[drops[0]:], "the raise audit is kept"
    for sig in RPCS + INTERNAL:
        name = sig.split("(")[0]
        assert f"DROP FUNCTION IF EXISTS public.{name}(" in note, name


def test_forward_policy_holds_333_behind_the_ai_budget_group():
    rows = [line.split("\t") for line in (MIGRATIONS / "forward-policy.tsv").read_text(
        encoding="utf-8").splitlines() if line.startswith(NAME)]
    assert len(rows) == 1 and rows[0][1:3] == ["pending_feature", "ai_budget"]
    assert "AIBUDGET-0033" in rows[0][3]
    readme = (MIGRATIONS / "README.md").read_text(encoding="utf-8")
    assert "Migration `333` (AIBUDGET-0033)" in readme and "MIGRATION_FEATURES=ai_budget" in readme


def test_no_other_migration_touches_the_333_objects():
    # 340 is the reviewed PC-J85 hardening of these objects, pinned by its own
    # suite (test_migration_340_ai_budget_hardening.py).
    for path in sorted(MIGRATIONS.glob("*.sql")):
        if path.name in (NAME, "340_ai_budget_hardening.sql"):
            continue
        code = m326._strip_comments(path.read_text(encoding="utf-8"))
        for name in ("ai_budget_", "ai_deferred_", "trg_ai_session_generation", "budget_deferred_at",
                     "fn_ai_session_bands_write", "fn_ai_class_sync"):
            assert name not in code, (path.name, name)


# ── PostgreSQL harness ──────────────────────────────────────────────────────

def _schema_sql(sql: str, schema: str) -> str:
    return m331._schema_sql(sql, schema)


def _rollback_sql(schema: str) -> str:
    header = SQL[SQL.index("-- ROLLBACK"):SQL.index("\nBEGIN;\n")]
    lines = [line[5:] for line in header.splitlines() if line.startswith("--   ")]
    return _schema_sql("\n".join(lines), schema)


def _postcondition_sql(schema: str) -> str:
    return _schema_sql(SQL[SQL.rindex("DO $$"):SQL.rindex("NOTIFY")], schema)


def _owner(sql: str) -> str:
    """Run as the NOSUPERUSER schema owner, like the hosted migration runner."""
    return psql(f"SET ROLE {OWNER}; {sql}")


def _svc(sql: str) -> str:
    out = psql(f"SET ROLE service_role; {sql}")
    return out.splitlines()[-1] if out else ""


def _svc_json(sql: str):
    return json.loads(_svc(sql))


def _fails(run, sql: str) -> str:
    with pytest.raises(RuntimeError) as error:
        run(sql)
    return str(error.value)


def _require_pg() -> None:
    try:
        available = shutil.which("psql") and psql("SELECT 1") == "1"
    except Exception:
        available = False
    if not available:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 333 verification")
        pytest.skip("Local PostgreSQL unavailable")
    if psql("SELECT usesuper FROM pg_user WHERE usename=current_user") != "t":
        pytest.fail("Migration 333 fixture requires a superuser on its disposable LOCAL cluster")
    psql(f"""DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{OWNER}') THEN
        CREATE ROLE {OWNER} NOSUPERUSER NOLOGIN NOBYPASSRLS;
      END IF;
    END $$;""")
    psql("ALTER ROLE service_role BYPASSRLS")


def _guard_225(schema: str) -> str:
    start = GUARD_225.index("CREATE OR REPLACE FUNCTION public.fn_guard_speaking_response_mutation()")
    end = GUARD_225.index("COMMENT ON FUNCTION")
    return _schema_sql(GUARD_225[start:end], schema)


def _build(schema: str) -> None:
    psql(f"CREATE SCHEMA {schema} AUTHORIZATION {OWNER}; "
         f"GRANT USAGE ON SCHEMA {schema} TO anon, authenticated, service_role;")
    _owner(f"""
        -- Supabase schema defaults: every new table/function is client-writable
        -- and executable unless a migration revokes it.
        ALTER DEFAULT PRIVILEGES IN SCHEMA {schema}
            GRANT ALL ON TABLES TO anon, authenticated, service_role;
        ALTER DEFAULT PRIVILEGES IN SCHEMA {schema}
            GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
        SET search_path = {schema}, pg_temp;
        CREATE TABLE sessions (
            id uuid PRIMARY KEY, user_id uuid, status text NOT NULL DEFAULT 'in_progress',
            resume_expires_at timestamptz, overall_band double precision, band_fc double precision,
            band_lr double precision, band_gra double precision, band_p double precision,
            completed_at timestamptz, error_code text, error_message text, failed_step text,
            last_error_at timestamptz, last_regraded_at timestamptz, last_regraded_by text,
            regrade_count integer DEFAULT 0, class_assignment_item_id uuid);
        CREATE TABLE responses (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            question_id uuid NOT NULL, audio_url text, audio_storage_path text, transcript text,
            raw_transcript_text text, transcript_model text, transcript_reliability text,
            score_confidence text, duration_seconds double precision, stt_status text, feedback jsonb,
            overall_band double precision, final_band_p double precision,
            final_overall_band double precision, grading_status text DEFAULT 'completed',
            pronunciation_score double precision, pronunciation_fluency double precision,
            pronunciation_accuracy double precision, pronunciation_completeness double precision,
            pronunciation_status text, pronunciation_provider text, pronunciation_locale text,
            pronunciation_payload jsonb);
        CREATE UNIQUE INDEX uq_responses_session_question ON responses (session_id, question_id);
        CREATE TABLE grammar_recommendations (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid,
            session_id uuid REFERENCES sessions(id), response_id uuid REFERENCES responses(id),
            grammar_issue text, recommended_slug text, recommended_category text,
            recommended_title text, similarity_score double precision, was_clicked boolean DEFAULT false,
            clicked_at timestamptz, created_at timestamptz DEFAULT now(), recommended_anchor text,
            CONSTRAINT ck_grammar_rec_has_context
                CHECK (response_id IS NOT NULL OR session_id IS NOT NULL OR user_id IS NOT NULL));
        CREATE TABLE writing_essays (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            status text NOT NULL DEFAULT 'pending' CHECK (status IN (
                'pending', 'grading', 'graded', 'reviewed', 'delivered', 'failed')),
            error_message text, current_version integer NOT NULL DEFAULT 1,
            grading_tier_metadata jsonb, updated_at timestamptz NOT NULL DEFAULT now());
        CREATE TABLE writing_feedback (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            essay_id uuid NOT NULL REFERENCES writing_essays(id) ON DELETE CASCADE,
            overall_band_score numeric(2,1) NOT NULL, band_main_criterion numeric(2,1),
            band_coherence_cohesion numeric(2,1), band_lexical_resource numeric(2,1),
            band_grammatical_range numeric(2,1), feedback_json jsonb NOT NULL, prompt_version text NOT NULL,
            model_used text NOT NULL, tokens_input integer, tokens_output integer, cost_usd numeric(8,4),
            grading_duration_ms integer, created_at timestamptz NOT NULL DEFAULT now(),
            version integer NOT NULL DEFAULT 1, source text, parent_version integer, provenance jsonb,
            CONSTRAINT writing_feedback_essay_id_version_key UNIQUE (essay_id, version),
            CONSTRAINT writing_feedback_version_range_chk CHECK (version BETWEEN 1 AND 3));
        CREATE TABLE writing_jobs (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            essay_id uuid NOT NULL REFERENCES writing_essays(id) ON DELETE CASCADE,
            job_type text NOT NULL DEFAULT 'analyze', job_payload jsonb,
            attempt_count integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 3,
            status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
            error_log jsonb DEFAULT '[]'::jsonb, started_at timestamptz, completed_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now());
        CREATE TABLE class_assignment_items (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            state text NOT NULL DEFAULT 'assigned', artifact_kind text, artifact_id uuid,
            submitted_at timestamptz,
            score numeric(3,1) CHECK (score IS NULL OR (score >= 0 AND score <= 9)),
            updated_at timestamptz NOT NULL DEFAULT now());
        {_guard_225(schema)}
        CREATE TRIGGER trg_guard_speaking_response_mutation
            BEFORE INSERT OR UPDATE ON responses
            FOR EACH ROW EXECUTE FUNCTION fn_guard_speaking_response_mutation();
    """)
    _owner(f"REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA {schema} "
           f"FROM anon, authenticated;")


def _apply(schema: str) -> None:
    _owner(_schema_sql(SQL, schema))


@pytest.fixture(scope="module")
def db():
    _require_pg()
    schema = "ai_budget_" + uuid4().hex
    try:
        _build(schema)
        _apply(schema)
        _apply(schema)   # re-applying is a no-op
        yield schema
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


@pytest.fixture
def s():
    """A fresh schema per test: budget counters are per scope and period."""
    _require_pg()
    schema = "ai_budget_t_" + uuid4().hex
    try:
        _build(schema)
        _apply(schema)
        yield schema
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


def _j(value) -> str:
    return "$j$" + json.dumps(value) + "$j$::jsonb"


def _q(value) -> str:
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


CAPS = {
    "total": {"month": 200, "day": 13.3333, "mode": "soft"},
    "anthropic": {"month": 100, "day": 6.6667, "mode": "soft", "thresholds": [80, 100]},
    "google": {"month": 20, "day": 1.3333, "mode": "hard"},
    "azure": {"month": 20, "day": 1.3333, "mode": "hard"},
    "openai": {"month": 20, "day": 1.3333, "mode": "hard", "thresholds": [50, 80, 100]},
    "elevenlabs": {"month": 20, "day": 1.3333, "mode": "hard"},
}


def _caps(**override) -> dict:
    caps = json.loads(json.dumps(CAPS))
    for scope, value in override.items():
        if value is None:
            caps.pop(scope, None)
        else:
            caps[scope] = {**caps.get(scope, {}), **value}
    return caps


def _line(provider: str, estimate: float, line_no: int = 1, **extra) -> dict:
    return {"line_no": line_no, "provider": provider, "model": f"{provider}-model",
            "feature": "speaking_grading", "operation": "grade", "estimate_usd": estimate, **extra}


def _reserve_sql(s: str, key: str, lines: list[dict], caps: dict | None = None, ttl: int = 600) -> str:
    return (f"SELECT {s}.fn_ai_budget_reserve({_q(key)}, {_j(lines)}, {_j(caps or _caps())}, {ttl});")


def _reserve(s: str, key: str, lines: list[dict], caps: dict | None = None, ttl: int = 600) -> dict:
    return _svc_json(_reserve_sql(s, key, lines, caps, ttl))


def _counters(s: str) -> dict:
    out = psql(f"""SELECT COALESCE(json_object_agg(scope || ':' || period_kind, json_build_object(
                     'settled', settled_usd, 'reserved', reserved_usd, 'cap', cap_usd,
                     'closed', closed_reason)), '{{}}') FROM {s}.ai_budget_counters""")
    return json.loads(out)


def _alerts(s: str) -> list[tuple]:
    out = psql(f"""SELECT COALESCE(json_agg(json_build_array(kind, scope, period_kind, threshold, trigger)
                     ORDER BY kind, scope, period_kind, threshold), '[]') FROM {s}.ai_budget_alerts""")
    return [tuple(row) for row in json.loads(out)]


def _ids(result: dict) -> dict:
    return {(r["provider"], r["line_no"]): r["id"] for r in result["reservations"]}


def _v3_drift(s: str) -> list:
    """plan.md V3: counters equal the reservations (total counts every provider)."""
    out = psql(f"""
        SELECT COALESCE(json_agg(json_build_array(scope, period_kind)), '[]') FROM (
          SELECT c.scope, c.period_kind, c.settled_usd, c.reserved_usd,
                 coalesce(sum(r.actual_usd) filter (where r.status in ('settled')), 0)
                   + coalesce(sum(r.estimate_usd) filter (where r.status = 'expired'), 0) AS settled_from_rows,
                 coalesce(sum(r.estimate_usd) filter (where r.status = 'reserved'), 0) AS reserved_from_rows
            FROM {s}.ai_budget_counters c
            LEFT JOIN {s}.ai_budget_reservations r
              ON (c.scope = 'total' OR c.scope = r.provider)
             AND ((c.period_kind = 'month' AND r.month_start = c.period_start)
               OR (c.period_kind = 'day' AND r.day_start = c.period_start))
           GROUP BY 1, 2, 3, 4) x
         WHERE settled_usd <> settled_from_rows OR reserved_usd <> reserved_from_rows""")
    return json.loads(out)


# ── PostgreSQL: catalog and grants ──────────────────────────────────────────

def test_catalog_after_apply_and_rerun(db):
    for table in TABLES:
        assert psql(f"SELECT relrowsecurity FROM pg_class WHERE oid = '{db}.{table}'::regclass") == "t"
        assert psql(f"SELECT count(*) FROM pg_policy WHERE polrelid = '{db}.{table}'::regclass") == "0"
    assert psql(f"""SELECT string_agg(tgname || ':' || tgenabled::text, ',' ORDER BY tgname) FROM pg_trigger
                    WHERE tgrelid = '{db}.responses'::regclass AND NOT tgisinternal""") == (
        "trg_ai_session_generation:O,trg_guard_speaking_response_mutation:O"), "a re-run created no duplicate"
    assert psql(f"""SELECT string_agg(column_name || ':' || data_type, ',' ORDER BY column_name)
                    FROM information_schema.columns WHERE table_schema = '{db}' AND table_name = 'writing_jobs'
                     AND column_name LIKE 'budget_%'""") == (
        "budget_commit_count:integer,budget_deferred_at:timestamp with time zone,budget_drain_count:integer,"
        "budget_lease_token:uuid,budget_lease_until:timestamp with time zone,"
        "budget_persisted_at:timestamp with time zone")
    for sig in RPCS + INTERNAL:
        assert psql(f"SELECT prosecdef::text || '|' || array_to_string(proconfig, ';') || '|' || "
                    f"pg_get_userbyid(proowner) FROM pg_proc WHERE oid = '{db}.{sig}'::regprocedure") == (
            f"true|search_path={db}, pg_temp|{OWNER}"), sig


def test_grants_on_tables_columns_and_functions(db):
    maintain = psql("SELECT current_setting('server_version_num')::int >= 170000") == "t"
    privileges = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]
    privileges += ["MAINTAIN"] if maintain else []
    for table, granted in SERVICE_TABLE_GRANTS.items():
        for role in ("anon", "authenticated", "service_role"):
            for privilege in privileges:
                expected = role == "service_role" and privilege in granted
                assert psql(f"SELECT has_table_privilege('{role}', '{db}.{table}', '{privilege}')") == (
                    "t" if expected else "f"), (table, role, privilege)
    assert psql(f"""SELECT string_agg(attname, ',' ORDER BY attname) FROM pg_attribute
                    WHERE attrelid = '{db}.ai_budget_alerts'::regclass AND attnum > 0
                      AND has_column_privilege('service_role', attrelid, attnum, 'UPDATE')""") == (
        "attempts,last_error,next_attempt_at,send_status,sent_at")
    for sig in RPCS:
        assert psql(f"SELECT has_function_privilege('service_role', '{db}.{sig}', 'EXECUTE')") == "t", sig
    for sig in RPCS + INTERNAL:
        for role in ("anon", "authenticated"):
            assert psql(f"SELECT has_function_privilege('{role}', '{db}.{sig}', 'EXECUTE')") == "f", (sig, role)
    for sig in INTERNAL:
        assert psql(f"SELECT has_function_privilege('service_role', '{db}.{sig}', 'EXECUTE')") == "f", sig


def test_clients_cannot_reach_the_budget_and_service_role_cannot_write_counters(db):
    for role in ("anon", "authenticated"):
        message = _fails(psql, f"SET ROLE {role}; SELECT {db}.fn_ai_budget_reserve('k', '[]', '{{}}', 1);")
        assert "permission denied" in message
        assert "permission denied" in _fails(psql, f"SET ROLE {role}; SELECT * FROM {db}.ai_budget_counters;")
    for sql in (f"INSERT INTO {db}.ai_budget_counters (scope, period_kind, period_start) "
                f"VALUES ('openai', 'day', current_date)",
                f"UPDATE {db}.ai_budget_counters SET settled_usd = 0",
                f"INSERT INTO {db}.ai_budget_alerts (scope, period_kind, period_start, threshold, trigger) "
                f"VALUES ('openai', 'day', current_date, 100, 'crossing')",
                f"UPDATE {db}.ai_budget_alerts SET scope = 'google'",
                f"UPDATE {db}.ai_deferred_session_refresh SET refreshed_generation = 0",
                f"INSERT INTO {db}.ai_budget_raises (scope) VALUES ('google')",
                f"SELECT {db}.fn_ai_budget_recompute(current_date)"):
        assert "permission denied" in _fails(psql, f"SET ROLE service_role; {sql};"), sql
    _svc(f"UPDATE {db}.ai_budget_alerts SET send_status = 'failed', attempts = attempts + 1 WHERE false;")


def test_postcondition_aborts_when_the_trigger_is_disabled(s):
    psql(f"ALTER TABLE {s}.responses DISABLE TRIGGER trg_ai_session_generation")
    assert "ai_budget_trigger_missing" in _fails(_owner, _postcondition_sql(s))
    psql(f"ALTER TABLE {s}.responses ENABLE TRIGGER trg_ai_session_generation")
    psql(f"GRANT INSERT ON {s}.ai_budget_counters TO authenticated")
    assert "ai_budget_table_privileges_wrong" in _fails(_owner, _postcondition_sql(s))


def test_precondition_names_the_missing_tables():
    _require_pg()
    schema = "ai_budget_pre_" + uuid4().hex
    try:
        psql(f"CREATE SCHEMA {schema} AUTHORIZATION {OWNER};")
        message = _fails(_owner, _schema_sql(SQL, schema))
        assert "ai_budget_precondition_missing" in message and "responses" in message
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


# ── PostgreSQL: reservations ────────────────────────────────────────────────

def test_grant_counts_every_line_on_its_scope_and_total(s):
    result = _reserve(s, "r1", [_line("openai", 0.25, 1), _line("anthropic", 0.5, 2)])
    assert result["granted"] is True and result["replay"] is False
    assert {(r["provider"], r["line_no"]) for r in result["reservations"]} == {("anthropic", 2), ("openai", 1)}
    c = _counters(s)
    assert c["openai:month"]["reserved"] == c["openai:day"]["reserved"] == 0.25
    assert c["anthropic:month"]["reserved"] == c["anthropic:day"]["reserved"] == 0.5
    assert c["total:month"]["reserved"] == c["total:day"]["reserved"] == 0.75
    assert c["openai:month"]["cap"] == 20 and c["total:month"]["cap"] == 200
    # The id is deterministic from the request key, provider and line.
    expected = hashlib.md5(b"r1:openai:1").hexdigest()
    assert _ids(result)[("openai", 1)].replace("-", "") == expected


def test_estimates_round_up_and_invalid_input_raises(s):
    result = _reserve(s, "tiny", [_line("google", 0.0000001)])
    assert result["reservations"][0]["estimate_usd"] == 0.000001
    for lines, marker in (([_line("total", 1)], "ai_budget_invalid_provider"),
                          ([_line("google", 0)], "ai_budget_invalid_estimate"),
                          ([_line("google", 1, 1), _line("google", 1, 1)], "ai_budget_duplicate_line"),
                          ([], "ai_budget_invalid_lines")):
        assert marker in _fails(_svc, _reserve_sql(s, "bad-" + uuid4().hex, lines))
    caps = _caps(google={"mode": "soft"})
    assert "ai_budget_mode_mismatch" in _fails(_svc, _reserve_sql(s, "m", [_line("google", 1)], caps))
    caps = _caps(anthropic={"thresholds": [50, 80, 100]})
    assert "ai_budget_thresholds_mismatch" in _fails(_svc, _reserve_sql(s, "t", [_line("anthropic", 1)], caps))
    assert psql(f"SELECT count(*) FROM {s}.ai_budget_reservations") == "1"


def test_hard_bundle_is_all_or_nothing_and_alerts_100_once(s):
    _reserve(s, "fill", [_line("google", 1.2)])
    before = _counters(s)
    for attempt in range(3):
        result = _reserve(s, f"bundle-{attempt}", [_line("openai", 0.1, 1), _line("google", 0.2, 2)])
        assert result["granted"] is False and result["replay"] is False
        assert result["reason"] == "daily_cap" and result["scope"] == "google"
    after = _counters(s)
    for key, row in after.items():
        money = (row["settled"], row["reserved"])
        assert money == ((before[key]["settled"], before[key]["reserved"]) if key in before else (0, 0)), key
    assert {k: v["cap"] for k, v in after.items() if k in before} == {k: v["cap"] for k, v in before.items()}
    assert psql(f"SELECT count(*) FROM {s}.ai_budget_reservations WHERE request_key LIKE 'bundle-%'") == "0"
    assert _alerts(s).count(("threshold", "google", "day", 100, "cap_refusal")) == 1
    # Below the cap, an estimate that does not fit still fires the 100% alert.
    assert before["google:day"]["settled"] + before["google:day"]["reserved"] < 1.3333


def test_monthly_cap_refuses_and_names_the_month(s):
    caps = _caps(azure={"month": 2, "day": 50})
    assert _reserve(s, "a1", [_line("azure", 1.5)], caps)["granted"] is True
    result = _reserve(s, "a2", [_line("azure", 1.0)], caps)
    assert (result["granted"], result["reason"], result["period_kind"]) == (False, "monthly_cap", "month")
    assert ("threshold", "azure", "month", 100, "cap_refusal") in _alerts(s)


def test_hard_scope_without_a_valid_cap_is_config_invalid_and_soft_never_is(s):
    for caps in (_caps(elevenlabs=None), _caps(elevenlabs={"month": None}), _caps(elevenlabs={"day": 0})):
        result = _reserve(s, "el-" + uuid4().hex, [_line("elevenlabs", 0.01)], caps)
        assert (result["granted"], result["reason"]) == (False, "config_invalid")
    # A soft scope with an invalid variable is counted with alerts suspended.
    result = _reserve(s, "soft", [_line("anthropic", 150)], _caps(anthropic={"month": None, "day": None},
                                                                 total={"month": None, "day": None}))
    assert result["granted"] is True
    assert _counters(s)["anthropic:month"]["cap"] is None
    assert _alerts(s) == []


def test_soft_scopes_are_counted_never_refused_and_alert_80_100_only(s):
    for i in range(3):
        assert _reserve(s, f"anth-{i}", [_line("anthropic", 45)])["granted"] is True
    c = _counters(s)
    assert c["anthropic:month"]["reserved"] == 135 and c["total:month"]["reserved"] == 135
    alerts = _alerts(s)
    assert ("threshold", "anthropic", "month", 80, "crossing") in alerts
    assert ("threshold", "anthropic", "month", 100, "crossing") in alerts
    assert ("threshold", "anthropic", "day", 100, "crossing") in alerts
    assert not any(a[1] == "anthropic" and a[3] == 50 for a in alerts), "no 50% Anthropic alert"
    assert ("threshold", "total", "day", 100, "crossing") in alerts
    assert ("threshold", "total", "month", 50, "crossing") in alerts
    # total over its own soft threshold still refuses nothing.
    assert _reserve(s, "anth-big", [_line("anthropic", 100)])["granted"] is True
    assert ("threshold", "total", "month", 80, "crossing") in _alerts(s)
    assert ("threshold", "total", "month", 100, "crossing") in _alerts(s)


def test_replay_never_grants_whatever_the_status(s):
    first = _reserve(s, "key", [_line("openai", 0.1)])
    rid = first["reservations"][0]["id"]
    for step in ("reserved", "settled"):
        if step == "settled":
            assert _svc_json(f"SELECT {s}.fn_ai_budget_settle('{rid}', 0.05);")["status"] == "settled"
        again = _reserve(s, "key", [_line("openai", 0.1)])
        assert again == {"granted": False, "replay": True,
                         "lines": [{"line_no": 1, "provider": "openai", "status": step}]}
    released = _reserve(s, "key-2", [_line("google", 0.1)])
    _svc(f"SELECT {s}.fn_ai_budget_release('{released['reservations'][0]['id']}');")
    assert _reserve(s, "key-2", [_line("google", 0.1)])["lines"][0]["status"] == "released"
    expired = _reserve(s, "key-3", [_line("azure", 0.1)], ttl=1)
    psql(f"UPDATE {s}.ai_budget_reservations SET expires_at = now() - interval '1 second' "
         f"WHERE request_key = 'key-3'")
    assert _svc(f"SELECT {s}.fn_ai_budget_expire(now());") == "1"
    assert _reserve(s, "key-3", [_line("azure", 0.1)])["lines"][0]["status"] == "expired"
    assert psql(f"SELECT count(*) FROM {s}.ai_budget_reservations") == "3"
    assert _v3_drift(s) == []


def test_settle_release_expire_arithmetic_and_second_calls_are_noops(s):
    r = _ids(_reserve(s, "mix", [_line("openai", 0.4, 1), _line("anthropic", 0.6, 2), _line("google", 0.3, 3)]))
    assert _svc_json(f"SELECT {s}.fn_ai_budget_settle('{r[('openai', 1)]}', 0.1);")["status"] == "settled"
    assert _svc_json(f"SELECT {s}.fn_ai_budget_settle('{r[('openai', 1)]}', 9);") == {
        "status": "noop", "reservation_status": "settled"}
    assert _svc_json(f"SELECT {s}.fn_ai_budget_settle('{r[('anthropic', 2)]}', 0.6);")["status"] == "settled"
    assert _svc_json(f"SELECT {s}.fn_ai_budget_release('{r[('google', 3)]}');")["status"] == "released"
    assert _svc_json(f"SELECT {s}.fn_ai_budget_release('{r[('google', 3)]}');")["status"] == "noop"
    assert _svc_json(f"SELECT {s}.fn_ai_budget_settle('{r[('google', 3)]}', 1);")["status"] == "noop"
    c = _counters(s)
    assert (c["openai:day"]["settled"], c["openai:day"]["reserved"]) == (0.1, 0)
    assert (c["anthropic:month"]["settled"], c["google:month"]["settled"], c["google:month"]["reserved"]) == (
        0.6, 0, 0)
    assert (c["total:month"]["settled"], c["total:month"]["reserved"]) == (0.7, 0)
    # Expiry settles at the estimate and leaves actual_usd null.
    e = _ids(_reserve(s, "late", [_line("elevenlabs", 0.2)], ttl=1))
    assert _svc(f"SELECT {s}.fn_ai_budget_expire(now());") == "0", "not yet past expires_at"
    psql(f"UPDATE {s}.ai_budget_reservations SET expires_at = now() - interval '1 minute' "
         f"WHERE request_key = 'late'")
    assert _svc(f"SELECT {s}.fn_ai_budget_expire(now() + interval '1 day');") == "1"
    assert _svc(f"SELECT {s}.fn_ai_budget_expire(now());") == "0"
    assert psql(f"SELECT status || ':' || COALESCE(actual_usd::text, 'null') FROM {s}.ai_budget_reservations "
                f"WHERE id = '{e[('elevenlabs', 1)]}'") == "expired:null"
    c = _counters(s)
    assert (c["elevenlabs:day"]["settled"], c["total:day"]["settled"]) == (0.2, 0.9)
    assert _v3_drift(s) == [], "mixed settled Anthropic/OpenAI lines: zero V3 drift on total"


def test_recompute_restores_the_counters_and_is_owner_only(s):
    r = _ids(_reserve(s, "rc", [_line("openai", 0.5), _line("anthropic", 0.5, 2)]))
    _svc(f"SELECT {s}.fn_ai_budget_settle('{r[('openai', 1)]}', 0.2);")
    psql(f"UPDATE {s}.ai_budget_counters SET settled_usd = 7, reserved_usd = 3")
    assert _v3_drift(s)
    month = psql("SELECT date_trunc('month', now() AT TIME ZONE 'UTC')::date")
    day = psql("SELECT (now() AT TIME ZONE 'UTC')::date")
    _owner(f"SELECT {s}.fn_ai_budget_recompute('{month}'); SELECT {s}.fn_ai_budget_recompute('{day}');")
    assert _v3_drift(s) == []


def test_provider_spend_limit_closes_the_day_for_soft_scopes_too(s):
    assert _svc_json(f"SELECT {s}.fn_ai_budget_close_scope('anthropic', NULL, 'provider_spend_limit');")[
        "status"] == "closed"
    assert _svc_json(f"SELECT {s}.fn_ai_budget_close_scope('anthropic', NULL, 'provider_spend_limit');")[
        "status"] == "already_closed"
    result = _reserve(s, "after-402", [_line("anthropic", 0.01)])
    assert (result["granted"], result["reason"], result["scope"]) == (False, "provider_spend_limit", "anthropic")
    assert _reserve(s, "other", [_line("openai", 0.01)])["granted"] is True, "other providers unaffected"
    assert _alerts(s).count(("threshold", "anthropic", "day", 100, "provider_spend_limit")) == 1
    assert "ai_budget_invalid_scope" in _fails(
        _svc, f"SELECT {s}.fn_ai_budget_close_scope('total', NULL, 'provider_spend_limit');")


# ── PostgreSQL: concurrency of reservations and alerts ─────────────────────

SESSION_TIMEOUT = 120


def _script(sql: str) -> subprocess.CompletedProcess:
    """psql reading a script: every statement autocommits on its own connection."""
    return subprocess.run(["psql", DB, "-X", "-v", "ON_ERROR_STOP=1", "-tAq"], input=sql,
                          capture_output=True, text=True, timeout=SESSION_TIMEOUT, env=m326._env())


def test_4n_racing_reservations_grant_exactly_n(s):
    """AC4: two connections race 4N reservations for N slots."""
    n = 6
    caps = _caps(openai={"month": n * 0.5, "day": n * 0.5})

    def worker(prefix: str) -> subprocess.CompletedProcess:
        body = "".join(f"SET ROLE service_role; {_reserve_sql(s, f'{prefix}-{i}', [_line('openai', 0.5)], caps)}\n"
                       for i in range(2 * n))
        return _script(body)

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(worker, ("a", "b")))
    assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
    granted = sum(json.loads(line)["granted"] for r in results for line in r.stdout.split("\n") if line)
    assert granted == n
    assert psql(f"SELECT count(*) FROM {s}.ai_budget_reservations") == str(n)
    c = _counters(s)
    assert c["openai:month"]["reserved"] == n * 0.5 and c["total:day"]["reserved"] == n * 0.5
    assert _alerts(s).count(("threshold", "openai", "month", 100, "crossing")) == 1
    assert _alerts(s).count(("threshold", "openai", "month", 50, "crossing")) == 1


def test_concurrent_same_key_gets_one_grant_and_one_replay(s):
    tag = "ai333_" + uuid4().hex[:10]
    first = (f"SET ROLE service_role; BEGIN; {_reserve_sql(s, 'dup', [_line('google', 0.1)])} "
             f"SELECT pg_sleep(2); COMMIT;")
    a = m331._spawn_tagged(first, tag)
    try:
        m331._wait_until_holding(tag, a)
        b = m326._spawn(f"SET ROLE service_role; {_reserve_sql(s, 'dup', [_line('google', 0.1)])}")
        out_b = b.communicate(timeout=SESSION_TIMEOUT)
        out_a = a.communicate(timeout=SESSION_TIMEOUT)
    finally:
        if a.poll() is None:
            a.kill()
    assert a.returncode == 0 and b.returncode == 0, (out_a, out_b)
    first_result = json.loads([l for l in out_a[0].splitlines() if l.startswith("{")][0])
    second_result = json.loads(out_b[0].splitlines()[-1])
    assert first_result["granted"] is True
    assert second_result == {"granted": False, "replay": True,
                             "lines": [{"line_no": 1, "provider": "google", "status": "reserved"}]}
    assert _counters(s)["google:day"]["reserved"] == 0.1


# ── PostgreSQL: raises ──────────────────────────────────────────────────────

ADMIN = str(uuid4())


def _grant_sql(s: str, scope="google", amount=10, hours=24, reason="exam week", aal="aal2",
               caps: dict | None = None, actor: str = ADMIN) -> str:
    return (f"SELECT {s}.fn_ai_budget_raise_grant({_q(scope)}, {amount}, {hours}, {_q(reason)}, "
            f"{_q(actor)}::uuid, {_q(aal)}, {_j(caps or _caps())}, 'req-333');")


def _grant(s: str, **kwargs) -> dict:
    return _svc_json(_grant_sql(s, **kwargs))


def test_raise_refusals_write_nothing(s):
    for kwargs, code in (({"aal": "aal1"}, "mfa_required"), ({"aal": None}, "mfa_required"),
                         ({"scope": "anthropic"}, "scope_not_raisable"), ({"scope": "total"}, "scope_not_raisable"),
                         ({"caps": _caps(google={"month": None})}, "scope_config_invalid"),
                         ({"caps": _caps(google={"month": -1})}, "scope_config_invalid"),
                         ({"amount": 21}, "amount_out_of_range"), ({"amount": 0}, "amount_out_of_range"),
                         ({"amount": 2.5}, "amount_out_of_range"), ({"hours": 25}, "duration_out_of_range"),
                         ({"hours": 0}, "duration_out_of_range"), ({"reason": " "}, "reason_invalid"),
                         ({"reason": "x" * 501}, "reason_invalid")):
        assert _grant(s, **kwargs) == {"granted": False, "error_code": code}, kwargs
    for table in ("ai_budget_raises", "ai_budget_raise_events", "ai_budget_alerts"):
        assert psql(f"SELECT count(*) FROM {s}.{table}") == "0"


def test_raise_lifts_the_hard_cap_and_reverts_at_expires_at(s):
    caps = _caps(google={"month": 20, "day": 1})
    assert _reserve(s, "g1", [_line("google", 1)], caps)["granted"] is True
    assert _reserve(s, "g2", [_line("google", 1)], caps)["reason"] == "daily_cap"
    grant = _grant(s, amount=20, hours=1, caps=caps)
    assert grant["granted"] is True
    assert (grant["effective_month_cap_usd"], grant["effective_day_cap_usd"]) == (40, 21)
    assert _reserve(s, "g3", [_line("google", 1)], caps)["granted"] is True
    assert _counters(s)["google:day"]["cap"] == 21
    assert _grant(s, caps=caps)["error_code"] == "raise_active"
    # The moment expires_at passes, the base cap applies again with no sweep.
    psql(f"UPDATE {s}.ai_budget_raises SET granted_at = now() - interval '2 hours', "
         f"expires_at = now() - interval '1 hour'")
    assert _reserve(s, "g4", [_line("google", 0.01)], caps)["reason"] == "daily_cap"
    assert _svc(f"SELECT {s}.fn_ai_budget_raise_expire_sweep(now());") == "1"
    assert _svc(f"SELECT {s}.fn_ai_budget_raise_expire_sweep(now());") == "0"
    events = psql(f"SELECT string_agg(event || ':' || COALESCE(actor_id::text, '-') || ':' || "
                  f"effective_month_cap_usd::int, ',' ORDER BY created_at, event) FROM {s}.ai_budget_raise_events")
    assert events == f"granted:{ADMIN}:40,expired:-:20"
    assert sorted(a[0] for a in _alerts(s) if a[0] != "threshold") == ["raise_expired", "raise_granted"]


def test_raise_end_early_and_three_grants_a_month(s):
    for i in range(3):
        grant = _grant(s, scope="openai", amount=5)
        assert grant["granted"] is True, (i, grant)
        rid = grant["raise"]["id"]
        end = f"SELECT {s}.fn_ai_budget_raise_end('{rid}', '{ADMIN}', %s, 'done', 'req-end');"
        assert _svc_json(end % "'aal1'") == {"ended": False, "error_code": "mfa_required"}
        assert _svc_json(end % "'aal2'")["ended"] is True
        assert _svc_json(end % "'aal2'") == {"ended": False, "error_code": "not_active"}
    assert _grant(s, scope="openai", amount=5)["error_code"] == "raise_limit_reached"
    assert _grant(s, scope="azure", amount=5)["granted"] is True, "the limit is per scope"
    assert psql(f"SELECT count(*) FROM {s}.ai_budget_raise_events WHERE event = 'ended_early'") == "3"
    assert psql(f"SELECT count(*) FROM {s}.ai_budget_alerts WHERE kind = 'raise_ended'") == "3"


def test_an_expired_raise_is_recorded_before_a_new_grant(s):
    rid = _grant(s, scope="elevenlabs", amount=3, hours=1)["raise"]["id"]
    psql(f"UPDATE {s}.ai_budget_raises SET granted_at = now() - interval '3 hours', "
         f"expires_at = now() - interval '2 hours'")
    assert _grant(s, scope="elevenlabs", amount=3)["granted"] is True
    assert psql(f"SELECT end_kind FROM {s}.ai_budget_raises WHERE id = '{rid}'") == "expired"
    assert psql(f"SELECT count(*) FROM {s}.ai_budget_raise_events WHERE raise_id = '{rid}'") == "2"


def test_raise_events_are_append_only_for_every_role(s):
    _grant(s)
    for run in (_owner, psql):
        for sql in (f"UPDATE {s}.ai_budget_raise_events SET reason = 'x'",
                    f"DELETE FROM {s}.ai_budget_raise_events",
                    f"TRUNCATE {s}.ai_budget_raise_events"):
            assert "ai_budget_raise_events_append_only" in _fails(run, sql), sql
    for sql in (f"UPDATE {s}.ai_budget_raise_events SET reason = 'x'", f"DELETE FROM {s}.ai_budget_raise_events"):
        assert "permission denied" in _fails(psql, f"SET ROLE service_role; {sql};")
    assert psql(f"SELECT count(*) FROM {s}.ai_budget_raise_events") == "1"


# ── PostgreSQL: Speaking fixtures ───────────────────────────────────────────

USER = str(uuid4())


def _session(s: str, status: str = "in_progress", item: str | None = None) -> str:
    sid = str(uuid4())
    psql(f"INSERT INTO {s}.sessions (id, user_id, status, resume_expires_at, class_assignment_item_id) "
         f"VALUES ('{sid}', '{USER}', '{status}', now() + interval '1 hour', {_q(item)})")
    return sid


def _path(token: str, digest: str = "a") -> str:
    return f"{USER}/s/q.{token}.{(digest * 64)[:64]}.webm"


def _revision(response_id: str | None, path: str | None) -> str:
    if response_id is None:
        return "absent"
    return hashlib.sha256(f"{response_id}:{path or ''}".encode()).hexdigest()


def _save_sql(s: str, session: str, question: str, token: str, path: str, expected: str, row=None) -> str:
    response = {"session_id": session, "question_id": question, "submission_token": token,
                "audio_storage_path": path, "expected_revision": expected,
                "row": row if row is not None else {"audio_url": "signed://x", "duration_seconds": 42.5,
                                                    "stt_status": "pending"}}
    job = {"user_id": USER, "reason": "monthly_cap"}
    return f"SELECT {s}.fn_ai_deferred_save({_j(response)}, {_j(job)});"


def _save(s: str, *args, **kwargs) -> dict:
    return _svc_json(_save_sql(s, *args, **kwargs))


def _generation(s: str, session: str) -> tuple[int, int, int]:
    out = psql(f"SELECT generation || ',' || refreshed_generation || ',' || class_synced_generation "
               f"FROM {s}.ai_deferred_session_refresh WHERE session_id = '{session}'")
    return tuple(int(x) for x in out.split(",")) if out else (0, 0, 0)


def _response(s: str, session: str) -> str:
    rid = str(uuid4())
    psql(f"INSERT INTO {s}.responses (id, session_id, question_id, overall_band, feedback, grading_status) "
         f"VALUES ('{rid}', '{session}', gen_random_uuid(), 6.0, '{{\"band_fc\": 6}}', 'completed')")
    return rid


# ── PostgreSQL: generation trigger ──────────────────────────────────────────

def test_trigger_advances_generation_on_band_bearing_writes_only(s):
    sid = _session(s)
    rid = _response(s, sid)
    assert _generation(s, sid) == (1, 0, 0), "insert"
    psql(f"UPDATE {s}.responses SET overall_band = 6.5 WHERE id = '{rid}'")
    assert _generation(s, sid)[0] == 2
    psql(f"UPDATE {s}.responses SET overall_band = 6.5, feedback = '{{\"band_fc\": 6}}' WHERE id = '{rid}'")
    assert _generation(s, sid)[0] == 2, "same values: no step"
    psql(f"UPDATE {s}.responses SET transcript = 'hello', audio_url = 'x' WHERE id = '{rid}'")
    assert _generation(s, sid)[0] == 2, "unlisted columns: no step"
    for column, value in (("final_band_p", "7"), ("final_overall_band", "6"),
                          ("feedback", "'{\"band_fc\": 7}'"), ("grading_status", "'failed'")):
        psql(f"UPDATE {s}.responses SET {column} = {value} WHERE id = '{rid}'")
    assert _generation(s, sid)[0] == 6, "one step per listed-column write"
    psql(f"BEGIN; UPDATE {s}.responses SET overall_band = 9 WHERE id = '{rid}'; ROLLBACK;")
    assert _generation(s, sid)[0] == 6, "a rolled-back write leaves the generation"
    psql(f"DELETE FROM {s}.responses WHERE id = '{rid}'")
    assert _generation(s, sid)[0] == 7, "delete"
    _response(s, sid)
    psql(f"DELETE FROM {s}.sessions WHERE id = '{sid}'")   # cascade delete is not blocked
    assert psql(f"SELECT count(*) FROM {s}.sessions WHERE id = '{sid}'") == "0"


def test_n1_service_role_response_writes_work_with_the_trigger(s):
    sid = _session(s)
    rid = str(uuid4())
    _svc(f"INSERT INTO {s}.responses (id, session_id, question_id, overall_band) "
         f"VALUES ('{rid}', '{sid}', gen_random_uuid(), 5.5);")
    _svc(f"UPDATE {s}.responses SET overall_band = 6, transcript = 't' WHERE id = '{rid}';")
    assert _generation(s, sid)[0] == 2
    assert psql(f"SELECT overall_band || ':' || transcript FROM {s}.responses WHERE id = '{rid}'") == "6:t"


# ── PostgreSQL: band writers (FR-024) ───────────────────────────────────────

def _bands_sql(s: str, sid: str, gen: int, patch: dict, from_in_progress=False, ack=True) -> str:
    return (f"SELECT {s}.fn_ai_session_bands_write('{sid}', {gen}, {_j(patch)}, "
            f"{str(from_in_progress).lower()}, {str(ack).lower()});")


def _bands(s: str, *args, **kwargs) -> dict:
    return _svc_json(_bands_sql(s, *args, **kwargs))


def test_session_bands_write_fences_on_generation(s):
    sid = _session(s)
    rid = _response(s, sid)
    gen = _generation(s, sid)[0]
    psql(f"UPDATE {s}.responses SET overall_band = 7 WHERE id = '{rid}'")   # lands after the read
    stale = _bands(s, sid, gen, {"overall_band": 6, "status": "completed", "completed_at": "2026-10-29T00:00:00Z"},
                   from_in_progress=True)
    assert stale == {"status": "stale", "generation": gen + 1}
    assert psql(f"SELECT status FROM {s}.sessions WHERE id = '{sid}'") == "in_progress", "stale writes nothing"
    written = _bands(s, sid, gen + 1, {"overall_band": 7, "band_fc": 7, "status": "completed",
                                       "completed_at": "2026-10-29T00:00:00Z"}, from_in_progress=True)
    assert written["status"] == "written" and written["acknowledged"] is True
    assert written["session"]["overall_band"] == 7 and written["session"]["status"] == "completed"
    assert _generation(s, sid)[:2] == (gen + 1, gen + 1)
    # completed_at is written only while unset; from_in_progress needs in_progress.
    again = _bands(s, sid, gen + 1, {"overall_band": 7, "completed_at": "2030-01-01T00:00:00Z"})
    assert again["session"]["completed_at"].startswith("2026-10-29")
    assert _bands(s, sid, gen + 1, {"overall_band": 7}, from_in_progress=True)["status"] == "not_applied"
    # Unacknowledged: the band is written, the row stays owed.
    psql(f"UPDATE {s}.responses SET overall_band = 8 WHERE id = '{rid}'")
    owed = _bands(s, sid, gen + 1, {"overall_band": 7.5}, ack=False)
    assert owed["status"] == "written" and owed["acknowledged"] is False
    assert _generation(s, sid)[:2] == (gen + 2, gen + 1)
    assert "ai_budget_patch_key_not_allowed: user_id" in _fails(_svc, _bands_sql(s, sid, gen, {"user_id": USER}))
    assert "ai_session_bands_invalid_status" in _fails(_svc, _bands_sql(s, sid, gen, {"status": "in_progress"}))


def test_aggregate_write_is_stale_not_completed_or_written(s):
    sid = _session(s)
    rid = _response(s, sid)
    gen = _generation(s, sid)[0]
    agg = f"SELECT {s}.fn_ai_deferred_aggregate_write('{sid}', %d, {_j({'overall_band': 6.5, 'band_p': None})});"
    assert _svc_json(agg % gen) == {"status": "not_completed"}
    psql(f"UPDATE {s}.sessions SET status = 'completed' WHERE id = '{sid}'")
    psql(f"UPDATE {s}.responses SET overall_band = 6.5 WHERE id = '{rid}'")
    assert _svc_json(agg % gen)["status"] == "stale"
    assert _svc_json(agg % (gen + 1)) == {"status": "written", "generation": gen + 1}
    assert _generation(s, sid)[:2] == (gen + 1, gen + 1)
    assert "ai_budget_patch_key_not_allowed: status" in _fails(
        _svc, f"SELECT {s}.fn_ai_deferred_aggregate_write('{sid}', {gen + 1}, {_j({'status': 'completed'})});")


def test_response_writes_and_band_writes_never_deadlock(s):
    """Lock order (FR-024): response → session → refresh, raced many times."""
    sid = _session(s)
    rids = [_response(s, sid) for _ in range(2)]
    psql(f"UPDATE {s}.sessions SET status = 'completed' WHERE id = '{sid}'")
    rounds = 25

    def responses_worker() -> subprocess.CompletedProcess:
        body = "".join(
            f"BEGIN; UPDATE {s}.responses SET overall_band = {5.5 + i % 3} WHERE id = '{rids[i % 2]}'; "
            f"SELECT pg_sleep(0.01); UPDATE {s}.responses SET feedback = '{{\"i\": {i}}}' "
            f"WHERE id = '{rids[(i + 1) % 2]}'; COMMIT;\n" for i in range(rounds))
        return _script(body)

    def bands_worker() -> subprocess.CompletedProcess:
        body = "".join(
            f"SET ROLE service_role; SELECT {s}.fn_ai_session_bands_write('{sid}', "
            f"(SELECT generation FROM {s}.ai_deferred_session_refresh WHERE session_id = '{sid}'), "
            f"'{{\"overall_band\": 6}}'::jsonb, false, false); "
            f"SELECT {s}.fn_ai_class_sync('{sid}'); RESET ROLE;\n" for _ in range(rounds))
        return _script(body)

    def aggregate_worker() -> subprocess.CompletedProcess:
        body = "".join(
            f"SET ROLE service_role; SELECT {s}.fn_ai_deferred_aggregate_write('{sid}', "
            f"(SELECT generation FROM {s}.ai_deferred_session_refresh WHERE session_id = '{sid}'), "
            f"'{{\"overall_band\": 6}}'::jsonb); RESET ROLE;\n" for _ in range(rounds))
        return _script(body)

    with ThreadPoolExecutor(3) as pool:
        futures = [pool.submit(f) for f in (responses_worker, bands_worker, aggregate_worker)]
        results = [f.result() for f in futures]
    for r in results:
        assert r.returncode == 0 and "deadlock" not in r.stderr, r.stderr
    assert _generation(s, sid)[0] == 2 + 2 * rounds


# ── PostgreSQL: deferred Speaking save, claim and commit ────────────────────

def test_deferred_save_insert_replay_audio_changed_and_superseded(s):
    sid, qid, token = _session(s), str(uuid4()), str(uuid4())
    path = _path(token)
    saved = _save(s, sid, qid, token, path, "absent")
    assert saved["status"] == "saved"
    rid = saved["response_id"]
    assert saved["submission_revision"] == _revision(rid, path)
    assert psql(f"SELECT grading_status || ':' || audio_storage_path || ':' || duration_seconds || ':' || "
                f"COALESCE(overall_band::text, 'null') FROM {s}.responses WHERE id = '{rid}'") == (
        f"awaiting_budget:{path}:42.5:null")
    assert psql(f"SELECT status || ':' || user_id || ':' || reason FROM {s}.ai_deferred_grading_jobs "
                f"WHERE id = '{saved['job_id']}'") == f"queued:{USER}:monthly_cap"
    assert _generation(s, sid)[0] == 2, "insert, then the awaiting_budget marker"

    replay = _save(s, sid, qid, token, path, "absent")
    assert replay == {"status": "replay", "response_id": rid, "job_id": saved["job_id"]}
    assert _save(s, sid, qid, token, _path(token, "b"), "absent") == {"status": "audio_changed",
                                                                     "response_id": rid}
    other = str(uuid4())
    assert _save(s, sid, qid, other, _path(other), "absent")["status"] == "superseded"
    assert psql(f"SELECT count(*) FROM {s}.ai_deferred_grading_jobs") == "1"

    # A new recording over the saved row supersedes the queued job.
    token2 = str(uuid4())
    path2 = _path(token2, "c")
    second = _save(s, sid, qid, token2, path2, _revision(rid, path))
    assert second["status"] == "saved" and second["response_id"] == rid
    assert psql(f"SELECT string_agg(status, ',' ORDER BY enqueued_at, status) "
                f"FROM {s}.ai_deferred_grading_jobs") == "superseded,queued"
    assert "ai_deferred_save_invalid_input" in _fails(_svc, _save_sql(s, sid, qid, token, _path(str(uuid4())),
                                                                      "absent"))
    assert "ai_budget_patch_key_not_allowed: overall_band" in _fails(
        _svc, _save_sql(s, sid, str(uuid4()), token2, path2, "absent", row={"overall_band": 9}))


def test_deferred_save_is_atomic(s):
    sid, qid, token = _session(s), str(uuid4()), str(uuid4())
    _owner(f"""CREATE FUNCTION {s}.fail_job() RETURNS trigger LANGUAGE plpgsql AS $$
               BEGIN RAISE EXCEPTION 'injected_job_failure'; END $$;
               CREATE TRIGGER fail_job BEFORE INSERT ON {s}.ai_deferred_grading_jobs
               FOR EACH ROW EXECUTE FUNCTION {s}.fail_job();""")
    assert "injected_job_failure" in _fails(_svc, _save_sql(s, sid, qid, token, _path(token), "absent"))
    assert psql(f"SELECT count(*) FROM {s}.responses WHERE session_id = '{sid}'") == "0"
    assert _generation(s, sid) == (0, 0, 0)
    _owner(f"DROP TRIGGER fail_job ON {s}.ai_deferred_grading_jobs;")
    assert _save(s, sid, qid, token, _path(token), "absent")["status"] == "saved"


def _claim(s: str, limit: int = 2, lease: int = 300) -> list[dict]:
    return _svc_json(f"SELECT {s}.fn_ai_deferred_claim({limit}, {lease});")


def _commit_sql(s: str, job: str, token: str, result: dict) -> str:
    return f"SELECT {s}.fn_ai_deferred_commit('{job}', {_q(token)}::uuid, {_j(result)});"


RESULT = {
    "response": {"transcript": "I like reading", "overall_band": 6.5, "final_overall_band": 6.5,
                 "final_band_p": None, "feedback": {"band_fc": 6.5, "band_lr": 6.5, "band_gra": 6.5},
                 "stt_status": "completed", "pronunciation_status": "skipped_budget"},
    "grammar_recommendations": [{"user_id": USER, "grammar_issue": "articles", "recommended_slug": "articles",
                                 "recommended_category": "foundations", "recommended_title": "Articles",
                                 "similarity_score": 0.8}],
}


def test_claim_commit_duplicate_and_lease_lost(s):
    sid, qid, token = _session(s), str(uuid4()), str(uuid4())
    saved = _save(s, sid, qid, token, _path(token), "absent")
    psql(f"INSERT INTO {s}.grammar_recommendations (response_id, grammar_issue) "
         f"VALUES ('{saved['response_id']}', 'stale rec')")
    claimed = _claim(s)
    assert [j["id"] for j in claimed] == [saved["job_id"]] and claimed[0]["attempts"] == 1
    assert claimed[0]["status"] == "running" and claimed[0]["lease_token"]
    assert _claim(s) == [], "a leased job is not claimed twice"
    job, lease = saved["job_id"], claimed[0]["lease_token"]
    assert _svc_json(_commit_sql(s, job, str(uuid4()), RESULT)) == {"status": "lease_lost"}
    gen = _generation(s, sid)[0]
    committed = _svc_json(_commit_sql(s, job, lease, RESULT))
    assert committed == {"status": "committed", "response_id": saved["response_id"], "session_id": sid,
                         "session_status": "in_progress"}
    assert _generation(s, sid)[0] == gen + 1, "the commit advanced the session generation"
    assert psql(f"SELECT grading_status || ':' || overall_band || ':' || transcript || ':' || pronunciation_status "
                f"FROM {s}.responses WHERE id = '{saved['response_id']}'") == (
        "completed:6.5:I like reading:skipped_budget")
    assert psql(f"SELECT string_agg(grammar_issue || ':' || session_id, ',') FROM {s}.grammar_recommendations "
                f"WHERE response_id = '{saved['response_id']}'") == f"articles:{sid}"
    assert psql(f"SELECT status || ':' || commit_count || ':' || (persisted_at IS NOT NULL) "
                f"FROM {s}.ai_deferred_grading_jobs WHERE id = '{job}'") == "done:1:true"
    assert _svc_json(_commit_sql(s, job, lease, RESULT)) == {"status": "duplicate"}
    assert "ai_deferred_commit_invalid_result" in _fails(
        _svc, _commit_sql(s, job, lease, {"response": {"grading_status": "failed"}}))


def test_reclaim_after_lease_expiry_fences_the_stale_worker(s):
    sid, qid, token = _session(s), str(uuid4()), str(uuid4())
    saved = _save(s, sid, qid, token, _path(token), "absent")
    stale = _claim(s)[0]
    psql(f"UPDATE {s}.ai_deferred_grading_jobs SET lease_until = now() - interval '1 second'")
    fresh = _claim(s)[0]
    assert fresh["id"] == stale["id"] and fresh["attempts"] == 2 and fresh["lease_token"] != stale["lease_token"]
    assert _svc_json(_commit_sql(s, saved["job_id"], stale["lease_token"], RESULT)) == {"status": "lease_lost"}
    assert _svc_json(_commit_sql(s, saved["job_id"], fresh["lease_token"], RESULT))["status"] == "committed"


def test_superseded_jobs_are_never_claimed_or_committed(s):
    sid, qid, token = _session(s), str(uuid4()), str(uuid4())
    path = _path(token)
    saved = _save(s, sid, qid, token, path, "absent")
    # A live re-record replaces the audio: the queued job is superseded at claim.
    psql(f"UPDATE {s}.responses SET audio_storage_path = '{_path(str(uuid4()))}' WHERE id = '{saved['response_id']}'")
    assert _claim(s) == []
    assert psql(f"SELECT status FROM {s}.ai_deferred_grading_jobs WHERE id = '{saved['job_id']}'") == "superseded"
    # A revision change after the claim: the commit supersedes and writes nothing.
    sid2, qid2, token2 = _session(s), str(uuid4()), str(uuid4())
    saved2 = _save(s, sid2, qid2, token2, _path(token2), "absent")
    lease = _claim(s)[0]["lease_token"]
    psql(f"UPDATE {s}.responses SET audio_storage_path = '{_path(str(uuid4()))}' WHERE id = '{saved2['response_id']}'")
    assert _svc_json(_commit_sql(s, saved2["job_id"], lease, RESULT)) == {"status": "superseded"}
    assert psql(f"SELECT grading_status FROM {s}.responses WHERE id = '{saved2['response_id']}'") == "awaiting_budget"


# ── PostgreSQL: class-score sync ────────────────────────────────────────────

def test_class_sync_pending_handin_synced_and_other_attempt(s):
    item = str(uuid4())
    psql(f"INSERT INTO {s}.class_assignment_items (id) VALUES ('{item}')")
    sid = _session(s, "in_progress", item)
    _response(s, sid)
    psql(f"UPDATE {s}.sessions SET status = 'completed', overall_band = 6.5 WHERE id = '{sid}'")
    gen = _generation(s, sid)[0]
    _bands(s, sid, gen, {"overall_band": 6.5})
    sync = f"SELECT {s}.fn_ai_class_sync('{sid}');"
    assert _svc_json(sync) == {"status": "pending_handin"}
    assert _generation(s, sid) == (gen, gen, 0), "the sync stays owed"
    psql(f"UPDATE {s}.class_assignment_items SET artifact_kind = 'session', artifact_id = '{sid}', "
         f"submitted_at = now(), score = 5 WHERE id = '{item}'")
    assert _svc_json(sync) == {"status": "synced", "class_synced_generation": gen}
    assert psql(f"SELECT score FROM {s}.class_assignment_items WHERE id = '{item}'") == "6.5"
    assert _generation(s, sid) == (gen, gen, gen)
    # A retry session linked to the same item never rewrites the recorded score.
    retry = _session(s, "completed", item)
    psql(f"UPDATE {s}.sessions SET overall_band = 8 WHERE id = '{retry}'")
    assert _svc_json(f"SELECT {s}.fn_ai_class_sync('{retry}');")["status"] == "no_item"
    assert psql(f"SELECT score FROM {s}.class_assignment_items WHERE id = '{item}'") == "6.5"
    assert _svc_json(f"SELECT {s}.fn_ai_class_sync('{_session(s)}');")["status"] == "no_item"


# ── PostgreSQL: Writing budget drain ────────────────────────────────────────

FEEDBACK = {"feedback": {"overall_band_score": 6.5, "band_main_criterion": 6, "band_coherence_cohesion": 7,
                         "band_lexical_resource": 6.5, "band_grammatical_range": 6.5,
                         "feedback_json": {"overallBandScore": 6.5}, "prompt_version": "v1",
                         "model_used": "gemini-test", "tokens_input": 100, "tokens_output": 50},
            "essay": {"grading_tier_metadata": {"tier": "standard"}}}


def _writing_job(s: str, essay_status: str = "pending") -> tuple[str, str]:
    essay, job = str(uuid4()), str(uuid4())
    psql(f"INSERT INTO {s}.writing_essays (id, status) VALUES ('{essay}', '{essay_status}');"
         f"INSERT INTO {s}.writing_jobs (id, essay_id, attempt_count, budget_deferred_at) "
         f"VALUES ('{job}', '{essay}', 1, now());")
    return essay, job


def _commit_writing_sql(s: str, job: str, token, result: dict = FEEDBACK) -> str:
    return f"SELECT {s}.fn_ai_deferred_commit_writing('{job}', {_q(token)}::uuid, {_j(result)});"


def test_writing_drain_claim_reclaim_commit_without_touching_attempt_count(s):
    essay, job = _writing_job(s)
    psql(f"INSERT INTO {s}.writing_jobs (essay_id) VALUES ('{essay}')")   # not budget-deferred
    claim = f"SELECT {s}.fn_ai_deferred_claim_writing(2, 300);"
    first = _svc_json(claim)
    assert [(j["id"], j["budget_drain_count"]) for j in first] == [(job, 1)]
    assert _svc_json(claim) == []
    assert _svc_json(_commit_writing_sql(s, job, None)) == {"status": "lease_lost"}
    psql(f"UPDATE {s}.writing_jobs SET budget_lease_until = now() - interval '1 second' WHERE id = '{job}'")
    second = _svc_json(claim)[0]
    assert second["budget_drain_count"] == 2 and second["budget_lease_token"] != first[0]["budget_lease_token"]
    assert _svc_json(_commit_writing_sql(s, job, first[0]["budget_lease_token"])) == {"status": "lease_lost"}
    assert _svc_json(_commit_writing_sql(s, job, second["budget_lease_token"])) == {
        "status": "committed", "essay_id": essay, "version": 1}
    assert psql(f"SELECT status || ':' || current_version || ':' || (grading_tier_metadata->>'tier') "
                f"FROM {s}.writing_essays WHERE id = '{essay}'") == "graded:1:standard"
    assert psql(f"SELECT version || ':' || COALESCE(parent_version::text, '-') || ':' || source || ':' || "
                f"(provenance->>'job_id') FROM {s}.writing_feedback WHERE essay_id = '{essay}'") == f"1:-:ai_pro:{job}"
    assert psql(f"SELECT status || ':' || attempt_count || ':' || budget_commit_count || ':' || "
                f"(budget_persisted_at IS NOT NULL) FROM {s}.writing_jobs WHERE id = '{job}'") == "completed:1:1:true"
    assert _svc_json(_commit_writing_sql(s, job, second["budget_lease_token"])) == {"status": "duplicate"}


def test_writing_drain_versions_after_the_live_chain_and_gcs_orphans(s):
    essay, job = _writing_job(s, "grading")
    psql(f"""UPDATE {s}.writing_essays SET current_version = 1 WHERE id = '{essay}';
             INSERT INTO {s}.writing_feedback (essay_id, version, parent_version, overall_band_score,
                 feedback_json, prompt_version, model_used)
             VALUES ('{essay}', 1, NULL, 5.5, '{{}}', 'v1', 'm'), ('{essay}', 2, 1, 6.0, '{{}}', 'v1', 'm');""")
    lease = _svc_json(f"SELECT {s}.fn_ai_deferred_claim_writing(1, 300);")[0]["budget_lease_token"]
    assert _svc_json(_commit_writing_sql(s, job, lease))["version"] == 2
    assert psql(f"SELECT string_agg(version || ':' || COALESCE(parent_version::text, '-') || ':' || "
                f"overall_band_score, ',' ORDER BY version) FROM {s}.writing_feedback "
                f"WHERE essay_id = '{essay}'") == "1:-:5.5,2:1:6.5"


def test_writing_drain_superseded_when_the_essay_moved_on(s):
    essay, job = _writing_job(s)
    lease = _svc_json(f"SELECT {s}.fn_ai_deferred_claim_writing(1, 300);")[0]["budget_lease_token"]
    psql(f"UPDATE {s}.writing_essays SET status = 'failed' WHERE id = '{essay}'")
    assert _svc_json(_commit_writing_sql(s, job, lease)) == {"status": "superseded"}
    assert psql(f"SELECT count(*) FROM {s}.writing_feedback") == "0"


# ── PostgreSQL: guarded down script ─────────────────────────────────────────

def test_down_script_refuses_while_work_is_owed_then_keeps_the_raise_audit(s):
    sid, qid, token = _session(s), str(uuid4()), str(uuid4())
    saved = _save(s, sid, qid, token, _path(token), "absent")
    rollback = _rollback_sql(s)
    assert "rollback_unsafe_deferred_jobs_pending" in _fails(_owner, rollback)
    lease = _claim(s)[0]["lease_token"]
    _svc(_commit_sql(s, saved["job_id"], lease, RESULT))
    psql(f"UPDATE {s}.sessions SET status = 'completed' WHERE id = '{sid}'")
    assert "rollback_unsafe_session_refresh_owed" in _fails(_owner, rollback)
    gen = _generation(s, sid)[0]
    _svc(f"SELECT {s}.fn_ai_deferred_aggregate_write('{sid}', {gen}, '{{\"overall_band\": 6.5}}');")
    essay, job = _writing_job(s)
    assert "rollback_unsafe_writing_jobs_deferred" in _fails(_owner, rollback)
    psql(f"UPDATE {s}.writing_jobs SET status = 'failed' WHERE id = '{job}'")
    rid = _grant(s)["raise"]["id"]
    assert "rollback_unsafe_raise_active" in _fails(_owner, rollback)
    _svc(f"SELECT {s}.fn_ai_budget_raise_end('{rid}', '{ADMIN}', 'aal2', 'rollback drill', 'req');")

    _owner(rollback)
    assert psql(f"SELECT count(*) FROM pg_trigger WHERE tgrelid = '{s}.responses'::regclass "
                f"AND tgname = 'trg_ai_session_generation'") == "0"
    for table in ("ai_budget_counters", "ai_budget_alerts", "ai_deferred_grading_jobs",
                  "ai_deferred_session_refresh", "ai_budget_raises"):
        assert psql(f"SELECT to_regclass('{s}.{table}') IS NULL") == "t", table
    assert psql(f"SELECT count(*) FROM {s}.ai_budget_raise_events") == "2", "the audit is kept"
    assert psql(f"SELECT count(*) FROM pg_proc WHERE pronamespace = '{s}'::regnamespace "
                f"AND proname LIKE 'fn_ai_%' AND proname <> 'fn_ai_budget_raise_events_append_only'") == "0"
    assert psql(f"SELECT count(*) FROM information_schema.columns WHERE table_schema = '{s}' "
                f"AND table_name = 'writing_jobs' AND column_name LIKE 'budget_%'") == "0"
    # Response writes keep working without the trigger or the refresh table.
    psql(f"UPDATE {s}.responses SET overall_band = 7 WHERE id = '{saved['response_id']}'")
    _response(s, _session(s))
