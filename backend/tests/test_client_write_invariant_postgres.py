"""Global client-privilege invariant after every migration since 320 (PC-J94).

PC-J74 (2026-10-29) F4: the postcondition of 335 only scans relkind r/p, so a
client-writable view, materialized view or foreign table added later would
escape it, and nothing re-checks the 320/335 invariants once a later migration
lands (BL-10: a new table or function that forgets its REVOKE goes unnoticed).
T1: migration 321 only had static tests.

This file builds one disposable DATABASE (the 334 harness: fresh database,
NOSUPERUSER runner, Supabase default ACLs) with a pre-320 shape that is the
union of the shapes the per-migration harnesses use, then applies EVERY
forward migration numbered 320 or later, verbatim and in order, through the
real `scripts/apply_migration_locked.sql` (the per-file step of
`apply_migrations.sh`). Migrations are discovered from the directory, so a new
migration is checked here automatically; one that needs pre-320 objects this
shape lacks fails with its name, and the fix is to extend `_pre_320()`.

After the chain:
  (a) every public relation of relkind r/p/v/m/f where anon/authenticated
      hold INSERT/UPDATE/DELETE/TRUNCATE (MAINTAIN on PG 17) is on the 320
      allowlist, and every authenticated write has the 335 RESTRICTIVE
      active-account policy for that command (and RLS on); sequences keep no
      client UPDATE (setval);
  (b) a client-writable view is security_invoker;
  (c) no SECURITY DEFINER function outside the platform schemas is EXECUTE-able
      by PUBLIC/anon, nor by authenticated except the 335 helper;
  (d) T1: writing_grade_ratings keeps RLS on and anon/authenticated cannot
      write it (catalog and a real SET ROLE probe).
Negative controls (a writable view, matview, foreign table and partitioned
table, an unnarrowed supabase_admin default ACL, a definer left on default
EXECUTE, a dropped restrictive policy, RLS off) prove each check fires.

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from uuid import uuid4

import pytest

import test_migration_320_client_write_lockdown as m320
import test_migration_325_access_codes_unique as m325
import test_migration_326_student_archive as m326
import test_migration_331_archived_student_give_guard as m331
import test_migration_333_ai_budget as m333
import test_migration_334_activate_attempt_rate_limit as m334
import test_migration_335_learner_writes_require_active as m335
import test_migration_338_paper_updated_at_triggers as m338

BACKEND = Path(__file__).resolve().parents[1]
MIGRATIONS = BACKEND / "migrations"
LOCKED_APPLIER = BACKEND / "scripts" / "apply_migration_locked.sql"
FIRST = 320
# The brief's floor: the chain must never silently shrink below these.
REQUIRED = {320, 321, 322, 326, 331, 332, 334, 335, 336, 338}
OWNER = "client_invariant_runner"

# 320's allowlist (learner-JWT writes) and 335's active-account coverage.
CLIENT_WRITE_TABLES = m320._array("client_write_tables")[0]
COLUMN_SCOPED = m320.COLUMN_SCOPED
ACTIVE_CHECKED = m335._learner_tables()[0]
ACTIVE_HELPER = "app_private.is_current_user_active()"
DEFINER_ALLOWLIST = {ACTIVE_HELPER: {"authenticated"}}
PLATFORM_SCHEMAS = ("pg_catalog", "information_schema", "pg_toast", "auth")

sql = m334.sql


def _forward_migrations() -> list[Path]:
    """What apply_migrations.sh runs from 320 on, every pending feature group opted in
    (as on staging); retired files are excluded."""
    retired = set()
    for line in (MIGRATIONS / "forward-policy.tsv").read_text(encoding="utf-8").splitlines():
        if line and not line.startswith("#") and line.split("\t")[1] == "retired":
            retired.add(line.split("\t")[0])
    return sorted(path for path in MIGRATIONS.glob("[0-9][0-9][0-9]_*.sql")
                  if int(path.name[:3]) >= FIRST and path.name not in retired
                  and not path.name.endswith("_rollback.sql"))


def _script(database: str, script: str, *, role: str | None = OWNER) -> str:
    """Run a multi-statement script (every SELECT prints) as the runner."""
    prefix = f"SET ROLE {role};\n" if role else ""
    result = subprocess.run([*m334._psql_args(database, app="inv94"), "-f", "-"],
                            input=prefix + script, capture_output=True, text=True,
                            timeout=120, env=m334._env())
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def _apply(database: str, migration: Path) -> str:
    """One file through the real locked applier, as the NOSUPERUSER runner."""
    result = subprocess.run(
        [*m334._psql_args(database, app="inv94"), "-c", f"SET ROLE {OWNER}",
         "-v", f"MIGRATION_NAME={migration.name}", "-v", f"MIGRATION_PATH={migration}",
         "-v", "BASELINE=0", "-v", "DRY_RUN=0", "-f", str(LOCKED_APPLIER)],
        capture_output=True, text=True, timeout=300, env=m334._env())
    if result.returncode or "__apply_migration_status__=processed" not in result.stdout:
        raise RuntimeError(
            f"{migration.name} did not apply on the invariant harness. If it needs pre-320 objects "
            f"this shape lacks, extend _pre_320() in {Path(__file__).name}.\n{result.stderr}")
    return result.stderr


# ── Pre-320 shape (Supabase defaults: everything client-writable) ───────────

def _pre_320() -> str:
    own = "USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())"
    return f"""
        SET search_path = public, pg_temp;
        CREATE TABLE _schema_migrations (filename text PRIMARY KEY,
                                         applied_at timestamptz NOT NULL DEFAULT now());
        -- users: the union of the 320/326/332/336 harness columns.
        CREATE TABLE users (
            id uuid PRIMARY KEY, email text,
            role text NOT NULL DEFAULT 'user'
                CONSTRAINT chk_users_role CHECK (role IN ('user', 'student', 'instructor', 'admin')),
            is_active boolean NOT NULL DEFAULT false, display_name text, avatar_url text,
            access_code_used text, permissions text[], feature_flags jsonb, last_seen_at timestamptz,
            target_band numeric, exam_date date, self_level text, preferred_topics text[],
            onboarding_completed boolean, timezone text, weekly_goal integer,
            notification_email boolean, updated_at timestamptz);
        ALTER TABLE users ENABLE ROW LEVEL SECURITY;
        CREATE POLICY "Users can view own data" ON users FOR SELECT USING (auth.uid() = id);
        -- Dashboard-created on staging: roles {{public}}, no WITH CHECK (320 hardens it).
        CREATE POLICY "Users can update own data" ON users FOR UPDATE USING (auth.uid() = id);
        -- 320/335 learner tables (the 320 harness shapes).
        CREATE TABLE flashcard_stacks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL, note text);
        CREATE TABLE flashcard_cards (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL, note text);
        CREATE TABLE user_vocabulary (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, note text,
            is_archived boolean NOT NULL DEFAULT false, is_pending boolean NOT NULL DEFAULT false);
        CREATE TABLE flashcard_reviews (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, note text,
            vocabulary_id uuid, interval_days integer, ease_factor real,
            review_count integer NOT NULL DEFAULT 0, lapse_count integer NOT NULL DEFAULT 0,
            last_reviewed_at timestamptz, next_review_at timestamptz, updated_at timestamptz,
            UNIQUE (user_id, vocabulary_id));
        CREATE TABLE flashcard_review_log (id bigserial PRIMARY KEY, user_id uuid NOT NULL, note text);
        CREATE TABLE user_d1_questions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
            vocabulary_id uuid, target_answer text NOT NULL, is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE d1_sessions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
            correct_count integer NOT NULL DEFAULT 0, total_count integer NOT NULL DEFAULT 1,
            status text NOT NULL DEFAULT 'active');
        CREATE TABLE vocabulary_exercise_attempts (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
            exercise_id uuid, user_answer text, is_correct boolean, score real, feedback jsonb,
            session_id uuid, post_processed_at timestamptz);
        -- 333 harness shapes, plus the user_id/student_id links 320/326 use.
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
        {"".join(f'''
        ALTER TABLE {t} ENABLE ROW LEVEL SECURITY;
        CREATE POLICY own ON {t} {own};'''
                 for t in ("sessions", "d1_sessions", "vocabulary_exercise_attempts",
                           *sorted(CLIENT_WRITE_TABLES | set(COLUMN_SCOPED))))}
        CREATE TABLE cohorts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text,
            is_active boolean NOT NULL DEFAULT true, description text,
            updated_at timestamptz NOT NULL DEFAULT now());
        CREATE TABLE students (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            student_code text UNIQUE NOT NULL, full_name text NOT NULL,
            cohort_id uuid REFERENCES cohorts(id) ON DELETE SET NULL,
            instructor_id uuid REFERENCES users(id) ON DELETE SET NULL,
            user_id uuid REFERENCES users(id) ON DELETE SET NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now());
        {m326._227_table()}
        CREATE TABLE writing_assignments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE);
        CREATE TABLE writing_drafts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
            assignment_id uuid REFERENCES writing_assignments(id) ON DELETE CASCADE);
        CREATE TABLE writing_essays (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            student_id uuid REFERENCES students(id) ON DELETE CASCADE,
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
        -- Class work (the columns the class-archive migration reads).
        CREATE TABLE class_assignments (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            cohort_id uuid NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
            title text NOT NULL DEFAULT 'work', status text NOT NULL DEFAULT 'published');
        CREATE TABLE class_assignment_items (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            student_id uuid REFERENCES students(id) ON DELETE CASCADE,
            assignment_id uuid REFERENCES class_assignments(id) ON DELETE CASCADE,
            opened_at timestamptz,
            state text NOT NULL DEFAULT 'assigned', artifact_kind text, artifact_id uuid,
            submitted_at timestamptz,
            score numeric(3,1) CHECK (score IS NULL OR (score >= 0 AND score <= 9)),
            updated_at timestamptz NOT NULL DEFAULT now());
        {m333._guard_225("public")}
        CREATE TRIGGER trg_guard_speaking_response_mutation
            BEFORE INSERT OR UPDATE ON responses
            FOR EACH ROW EXECUTE FUNCTION fn_guard_speaking_response_mutation();
        -- 322 harness: ai_usage_logs as shaped by 031 + 286.
        CREATE TABLE ai_usage_logs(
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, session_id uuid,
            service text NOT NULL, model text NOT NULL, input_tokens integer,
            output_tokens integer, cache_read_tokens integer, cache_write_tokens integer,
            audio_seconds real, text_chars integer, cost_usd_est real,
            created_at timestamptz NOT NULL DEFAULT now(), feature text, operation text,
            status text NOT NULL DEFAULT 'success', error_code text, thinking_tokens integer,
            pricing_version text, cost_source text NOT NULL DEFAULT 'catalog_estimate');
        {m325.REPO_TABLE}
        ALTER TABLE access_codes
            ADD COLUMN cohort_id uuid REFERENCES cohorts(id) ON DELETE SET NULL,
            ADD COLUMN is_active boolean NOT NULL DEFAULT true,
            ADD COLUMN is_revoked boolean DEFAULT false;
        -- 338 minimal shape: 033's trigger function, 306's paper guard, 208's trigger.
        {m338.FUNCTION_033}
        ALTER FUNCTION update_updated_at_column() SET search_path = public, pg_temp;
        CREATE FUNCTION fn_stub_paper_trigger() RETURNS trigger LANGUAGE plpgsql
            SET search_path = public, pg_temp AS $$ BEGIN RETURN NEW; END $$;
        {"".join(f'''
        CREATE TABLE {t} (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), updated_at timestamptz);'''
                 for t in (*m338.TABLES, "listening_exercises"))}
        CREATE TRIGGER trg_mock_paper_policy BEFORE UPDATE OR DELETE ON reading_tests
            FOR EACH ROW EXECUTE FUNCTION fn_stub_paper_trigger();
        CREATE TRIGGER trg_mock_paper_policy BEFORE UPDATE OR DELETE ON listening_tests
            FOR EACH ROW EXECUTE FUNCTION fn_stub_paper_trigger();
        CREATE TRIGGER trg_listening_exercises_updated_at BEFORE UPDATE ON listening_exercises
            FOR EACH ROW EXECUTE FUNCTION fn_stub_paper_trigger();
        -- 339 minimal shape: empty quiz/receipt tables and plain stubs of the 309/314
        -- functions 339 replaces or grants. 339 re-creates the replaced bodies as
        -- SECURITY DEFINER and must re-run 314's REVOKE, or (c) fires on these defaults.
        CREATE TABLE quiz_banks (id uuid PRIMARY KEY, code text, grammar_canonical_code text);
        {"".join(f'''
        CREATE TABLE {t} (id uuid PRIMARY KEY);'''
                 for t in ("quiz_questions", "quiz_sessions", "quiz_attempts", "quiz_word_stats"))}
        CREATE TABLE governance_audit (id bigserial PRIMARY KEY);
        CREATE FUNCTION grammar_quiz_audit_binding(text, text) RETURNS jsonb
            LANGUAGE sql IMMUTABLE AS $$ SELECT NULL::jsonb $$;
        CREATE FUNCTION grammar_quiz_audit_chain(text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
        CREATE FUNCTION grammar_quiz_guard_bank() RETURNS trigger LANGUAGE plpgsql
            AS $$ BEGIN RETURN NEW; END $$;
        CREATE TRIGGER zz_grammar_quiz_bank_guard BEFORE INSERT OR UPDATE OR DELETE ON quiz_banks
            FOR EACH ROW EXECUTE FUNCTION grammar_quiz_guard_bank();
        CREATE FUNCTION grammar_quiz_validate_receipt_envelope(jsonb, uuid, uuid) RETURNS void
            LANGUAGE plpgsql AS $$ BEGIN END $$;
        {"".join(f'''
        CREATE FUNCTION grammar_quiz_{name}({args}) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;'''
                 for name, args in (("receipt_data", "uuid"), ("start_service", "uuid, uuid, text, text"),
                                    ("start_service", "uuid, uuid, text, text, text"),
                                    ("progress_service", "uuid, uuid, jsonb, jsonb"),
                                    ("end_service", "uuid, uuid, jsonb"), ("reset_service", "uuid, uuid"),
                                    ("state", "uuid, uuid")))}
        -- One pre-320 relation of every other kind 320 must lock down.
        CREATE VIEW sessions_passthrough AS SELECT * FROM sessions;
        CREATE MATERIALIZED VIEW session_band_summary AS SELECT user_id, overall_band FROM sessions;
        CREATE FOREIGN TABLE legacy_feed (id integer) SERVER client_invariant_server;
        CREATE TABLE practice_events (id bigint, at timestamptz NOT NULL) PARTITION BY RANGE (at);
        CREATE TABLE practice_events_2026 PARTITION OF practice_events
            FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
        -- A pre-320 SECURITY DEFINER trigger function on default EXECUTE (F14) and
        -- the retired learner finalize RPC with its explicit grant (211).
        CREATE FUNCTION guard_grammar_assignment_evidence_write() RETURNS trigger
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
            AS $$ BEGIN RETURN NEW; END $$;
        CREATE FUNCTION fn_finalize_d1_attempt(uuid, uuid, integer, real, integer,
            timestamptz, timestamptz, jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{{}}'::jsonb $$;
        GRANT EXECUTE ON FUNCTION fn_finalize_d1_attempt(uuid, uuid, integer, real, integer,
            timestamptz, timestamptz, jsonb) TO authenticated;
    """


def _pre_320_history() -> str:
    """Verbatim earlier migrations (116, 228) and the pieces the 326/331 harnesses replay."""
    table_grants = "\n".join(statement + ";" for statement in re.findall(
        r"(?:REVOKE|GRANT) ALL ON TABLE student_cohort_memberships[^;]*", m326.SQL_227))
    assert table_grants.count(";") == 2, "227 table grants changed; re-check the roster privileges"
    return "\n".join((m326._227_writers("public"), table_grants, _writing_tables_without_revoke(),
                      _instructor_give_shape(),
                      m331._schema_sql(m331.SQL_228, "public"),
                      "SET search_path = public, pg_temp;",
                      (MIGRATIONS / "116_writing_grade_ratings.sql").read_text(encoding="utf-8")))


def _instructor_give_shape() -> str:
    """What migration 360 (INSTRUCTORGIVE-0044) reads: the grading_tier enum
    column (044/115), prompt ownership (035) and class ownership (060)."""
    return """
        SET search_path = public, pg_temp;
        CREATE TYPE grading_tier_enum AS ENUM ('quick', 'standard', 'deep', 'instructor');
        ALTER TABLE writing_assignments
            ADD COLUMN grading_tier grading_tier_enum NOT NULL DEFAULT 'standard';
        ALTER TABLE cohorts ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE SET NULL;
        CREATE TABLE writing_prompts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            created_by uuid REFERENCES users(id) ON DELETE SET NULL);
    """


def _writing_tables_without_revoke() -> str:
    writing_tables = m331._writing_tables("public")
    revoke = "REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;"
    # Keep the pre-320 grants as Supabase made them: 320 must close them itself.
    assert revoke in writing_tables, "the 331 harness changed; re-check what this strips"
    return writing_tables.replace(revoke, "")


def _create_database() -> tuple[str, bool]:
    m334._require_pg()
    created_admin = sql("postgres", "SELECT NOT EXISTS (SELECT 1 FROM pg_roles "
                                    "WHERE rolname = 'supabase_admin')") == "t"
    sql("postgres", f"""DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
        CREATE ROLE supabase_admin NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{OWNER}') THEN
        CREATE ROLE {OWNER} NOSUPERUSER NOBYPASSRLS NOLOGIN;
      END IF;
    END $$;""")
    database = f"inv94_{uuid4().hex[:12]}"
    sql("postgres", f"CREATE DATABASE {database}")
    # Supabase: the runner (hosted `postgres`, NOSUPERUSER) owns the app schema
    # objects; it and supabase_admin carry default ACLs that make every new
    # table/sequence/function client-writable/executable. The runner cannot
    # revoke supabase_admin's (production keeps them, 320 header).
    defaults = "".join(f"""
        ALTER DEFAULT PRIVILEGES FOR ROLE {who} IN SCHEMA public
            GRANT ALL ON TABLES TO anon, authenticated, service_role;
        ALTER DEFAULT PRIVILEGES FOR ROLE {who} IN SCHEMA public
            GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
        ALTER DEFAULT PRIVILEGES FOR ROLE {who} IN SCHEMA public
            GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;"""
                       for who in (OWNER, "supabase_admin"))
    sql(database, f"""
        GRANT CREATE ON DATABASE {database} TO {OWNER};
        GRANT USAGE, CREATE ON SCHEMA public TO {OWNER}, supabase_admin;
        GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
        {defaults}
        CREATE SCHEMA auth;
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
          SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.sub', true), ''),
                          NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
        $$;
        GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, {OWNER};
        GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
        CREATE FOREIGN DATA WRAPPER client_invariant_fdw;
        CREATE SERVER client_invariant_server FOREIGN DATA WRAPPER client_invariant_fdw;
        GRANT USAGE ON FOREIGN SERVER client_invariant_server TO {OWNER};""")
    return database, created_admin


def _drop_database(database: str, created_admin: bool) -> None:
    m334._drop_database(database)
    if created_admin:
        sql("postgres", "DROP ROLE IF EXISTS supabase_admin")


# ── The invariant ───────────────────────────────────────────────────────────

def _array(values) -> str:
    return "ARRAY[" + ", ".join(f"'{v}'" for v in sorted(values)) + "]::text[]"


def _invariant_sql() -> str:
    """Rows `check|object|detail`, one per violation; empty means the invariant holds."""
    column_allow = ", ".join(f"('{t}', '{c}')" for t, cols in sorted(COLUMN_SCOPED.items())
                             for c in sorted(cols))
    definer_allow = ", ".join(f"('{fn}', '{role}')" for fn, roles in sorted(DEFINER_ALLOWLIST.items())
                              for role in sorted(roles))
    return f"""
WITH privs AS (
    SELECT unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']
                  || CASE WHEN current_setting('server_version_num')::int >= 170000
                          THEN ARRAY['MAINTAIN'] ELSE ARRAY[]::text[] END) AS priv
), rel AS (
    SELECT c.oid, c.relname::text AS relname, c.relkind::text AS relkind, c.relrowsecurity, c.reloptions
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
), writes AS (
    SELECT rel.*, r.rolname, p.priv
      FROM rel CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname) CROSS JOIN privs p
     WHERE CASE WHEN p.priv IN ('INSERT', 'UPDATE')
                THEN has_any_column_privilege(r.rolname, rel.oid, p.priv)
                ELSE has_table_privilege(r.rolname, rel.oid, p.priv) END
), column_allow(relname, attname) AS (VALUES {column_allow}),
definer_allow(signature, rolname) AS (VALUES {definer_allow})
SELECT 'a:not_on_320_allowlist|' || w.relkind || ':' || w.relname || '|' || w.rolname || ':' || w.priv
  FROM writes w
 WHERE NOT (w.rolname = 'authenticated' AND w.priv IN ('INSERT', 'UPDATE', 'DELETE')
            AND w.relname = ANY ({_array(CLIENT_WRITE_TABLES)}))
   AND NOT (w.rolname = 'authenticated' AND w.priv = 'UPDATE'
            AND w.relname IN (SELECT relname FROM column_allow))
UNION ALL
SELECT 'a:column_outside_scope|' || c.relname || '.' || a.attname || '|' || r.rolname || ':' || p.priv
  FROM pg_class c
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
 CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
 CROSS JOIN (VALUES ('INSERT'), ('UPDATE')) p(priv)
 WHERE c.relnamespace = 'public'::regnamespace
   AND c.relname IN (SELECT relname FROM column_allow)
   AND has_column_privilege(r.rolname, c.oid, a.attnum, p.priv)
   AND NOT (r.rolname = 'authenticated' AND p.priv = 'UPDATE'
            AND (c.relname, a.attname::text) IN (SELECT relname, attname FROM column_allow))
UNION ALL
SELECT 'a:write_without_active_account_policy|' || w.relkind || ':' || w.relname || '|' || w.priv
  FROM writes w
 WHERE w.rolname = 'authenticated' AND w.priv IN ('INSERT', 'UPDATE', 'DELETE')
   AND NOT (w.relrowsecurity AND EXISTS (
        SELECT 1 FROM pg_policy pol
         WHERE pol.polrelid = w.oid AND NOT pol.polpermissive
           AND pol.polcmd = CASE w.priv WHEN 'INSERT' THEN 'a' WHEN 'UPDATE' THEN 'w' ELSE 'd' END
           AND 'authenticated'::regrole = ANY (pol.polroles)
           AND (w.priv = 'INSERT' OR pg_get_expr(pol.polqual, pol.polrelid)
                                     LIKE '%{ACTIVE_HELPER}%')
           AND (w.priv = 'DELETE' OR pg_get_expr(pol.polwithcheck, pol.polrelid)
                                     LIKE '%{ACTIVE_HELPER}%')))
UNION ALL
SELECT 'a:sequence_update|' || c.relname || '|' || r.rolname
  FROM pg_class c CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
   AND has_sequence_privilege(r.rolname, c.oid, 'UPDATE')
UNION ALL
SELECT DISTINCT 'b:client_writable_view_not_security_invoker|' || w.relname || '|'
  FROM writes w
 WHERE w.relkind = 'v'
   AND NOT EXISTS (SELECT 1 FROM unnest(w.reloptions) o
                    WHERE lower(o) IN ('security_invoker=true', 'security_invoker=on',
                                       'security_invoker=1', 'security_invoker=yes'))
UNION ALL
SELECT 'c:client_executable_security_definer|' || p.oid::regprocedure || '|' || r.rolname
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
 WHERE p.prosecdef
   AND n.nspname <> ALL ({_array(PLATFORM_SCHEMAS)}) AND n.nspname NOT LIKE 'pg\\_temp%'
   AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')
   AND (p.oid::regprocedure::text, r.rolname) NOT IN (SELECT signature, rolname FROM definer_allow)
UNION ALL
SELECT 'c:security_definer_public_execute|' || p.oid::regprocedure || '|PUBLIC'
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
 WHERE p.prosecdef AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
   AND n.nspname <> ALL ({_array(PLATFORM_SCHEMAS)}) AND n.nspname NOT LIKE 'pg\\_temp%'
UNION ALL
SELECT 'd:writing_grade_ratings_rls_off|writing_grade_ratings|'
 WHERE NOT COALESCE((SELECT relrowsecurity FROM pg_class
                      WHERE oid = to_regclass('public.writing_grade_ratings')), false)
ORDER BY 1;"""


def _violations(database: str, setup: str = "", *, role: str = OWNER) -> list[str]:
    """The invariant, optionally after `setup` (run as `role`) in a rolled-back transaction."""
    out = _script(database, f"BEGIN;\nSET LOCAL ROLE {role};\n{setup}\nRESET ROLE;\n"
                            f"{_invariant_sql()}\nROLLBACK;", role=None)
    return [line for line in out.splitlines() if line]


@pytest.fixture(scope="module")
def chain():
    database, created_admin = _create_database()
    try:
        _script(database, _pre_320() + _pre_320_history())
        # The shape mimics Supabase before 320: the findings are reproducible.
        assert sql(database, "SELECT has_column_privilege('anon', 'public.users', 'role', 'UPDATE')") == "t"
        for relation in ("sessions_passthrough", "session_band_summary", "legacy_feed", "practice_events",
                         "writing_assignments", "writing_grade_ratings"):
            assert sql(database, f"SELECT has_table_privilege('authenticated', 'public.{relation}', 'INSERT')") == "t"
        assert sql(database, "SELECT has_function_privilege('anon', "
                             "'public.guard_grammar_assignment_evidence_write()', 'EXECUTE')") == "t"
        before = _violations(database)
        assert any(v.startswith("a:not_on_320_allowlist|r:users|anon:UPDATE") for v in before), before
        assert any(v.startswith("c:") for v in before), before

        applied, warnings = [], {}
        for migration in _forward_migrations():
            warnings[migration.name] = _apply(database, migration)
            applied.append(migration.name)
        yield {"database": database, "applied": applied, "warnings": warnings, "before": before}
    finally:
        _drop_database(database, created_admin)


# ── Static ──────────────────────────────────────────────────────────────────

def test_chain_starts_at_320_and_covers_the_required_migrations():
    numbers = [int(path.name[:3]) for path in _forward_migrations()]
    assert numbers == sorted(numbers) and numbers[0] == FIRST
    assert REQUIRED <= set(numbers), sorted(REQUIRED - set(numbers))


def test_allowlists_are_the_320_and_335_ones():
    assert CLIENT_WRITE_TABLES == {"user_vocabulary", "flashcard_stacks", "flashcard_cards",
                                   "flashcard_reviews", "flashcard_review_log"}
    assert COLUMN_SCOPED == {"user_d1_questions": {"is_active"}}
    # 335 puts the active-account check on every table 320 lets clients write.
    assert ACTIVE_CHECKED == CLIENT_WRITE_TABLES | set(COLUMN_SCOPED)
    assert f"FUNCTION {ACTIVE_HELPER}" in m335.CODE


# ── PostgreSQL: the invariant after the whole chain ─────────────────────────

def test_every_forward_migration_applied_through_the_locked_runner(chain):
    names = [path.name for path in _forward_migrations()]
    assert chain["applied"] == names
    ledger = sql(chain["database"], "SELECT string_agg(filename, ',' ORDER BY filename) "
                                    "FROM public._schema_migrations")
    assert ledger.split(",") == names
    # Applied as the NOSUPERUSER runner (the hosted shape), not as the superuser.
    assert sql(chain["database"], f"""
        SELECT count(*) FROM pg_class c
         WHERE c.relnamespace IN ('public'::regnamespace, 'app_private'::regnamespace)
           AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S') AND c.relowner <> '{OWNER}'::regrole""") == "0"
    assert sql(chain["database"], f"""
        SELECT count(*) FROM pg_proc
         WHERE pronamespace IN ('public'::regnamespace, 'app_private'::regnamespace)
           AND proowner <> '{OWNER}'::regrole""") == "0"


@pytest.mark.parametrize("check", ["a:", "b:", "c:", "d:"])
def test_the_invariant_holds_after_every_migration(chain, check):
    assert [v for v in _violations(chain["database"]) if v.startswith(check)] == []


def test_authenticated_writes_are_exactly_the_allowlist_with_restrictive_policies(chain):
    db = chain["database"]
    writes = sql(db, """
        SELECT string_agg(format('%s:%s', c.relname, p), ',' ORDER BY c.relname, p)
          FROM pg_class c CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) p
         WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
           AND CASE WHEN p = 'DELETE' THEN has_table_privilege('authenticated', c.oid, p)
                    ELSE has_any_column_privilege('authenticated', c.oid, p) END""")
    expected = sorted([f"{t}:{p}" for t in CLIENT_WRITE_TABLES for p in ("DELETE", "INSERT", "UPDATE")]
                      + [f"{t}:UPDATE" for t in COLUMN_SCOPED])
    # A positive check: the probe must see the grants it then requires policies for.
    assert writes.split(",") == expected
    policies = sql(db, """
        SELECT count(*) FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
         WHERE c.relnamespace = 'public'::regnamespace AND NOT pol.polpermissive
           AND pol.polname LIKE 'require_active_account_%'""")
    assert int(policies) == 3 * len(ACTIVE_CHECKED)
    assert sql(db, "SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace "
                   f"AND relname = ANY ({_array(ACTIVE_CHECKED)}) AND relrowsecurity") == str(len(ACTIVE_CHECKED))


def test_anon_writes_no_relation_of_any_kind(chain):
    assert [v for v in _violations(chain["database"]) if "|anon:" in v] == []
    assert sql(chain["database"], """
        SELECT count(*) FROM pg_class c CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
         WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
           AND CASE WHEN p IN ('INSERT', 'UPDATE') THEN has_any_column_privilege('anon', c.oid, p)
                    ELSE has_table_privilege('anon', c.oid, p) END""") == "0"


def test_the_only_client_executable_definer_is_the_335_helper(chain):
    rows = sql(chain["database"], f"""
        SELECT string_agg(format('%s:%s', p.oid::regprocedure, r), ',' ORDER BY 1)
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         CROSS JOIN unnest(ARRAY['anon', 'authenticated']) r
         WHERE p.prosecdef AND n.nspname <> ALL ({_array(PLATFORM_SCHEMAS)})
           AND has_function_privilege(r, p.oid, 'EXECUTE')""")
    assert rows == f"{ACTIVE_HELPER}:authenticated"
    # The chain does create definers; they are just not client RPCs.
    assert int(sql(chain["database"], "SELECT count(*) FROM pg_proc WHERE prosecdef "
                                      "AND pronamespace = 'public'::regnamespace")) > 10


def test_t1_writing_grade_ratings_keeps_rls_and_rejects_client_writes(chain):
    db = chain["database"]
    assert "321_writing_grade_ratings_feedback_version.sql" in chain["applied"]
    assert sql(db, "SELECT relrowsecurity FROM pg_class "
                   "WHERE oid = 'public.writing_grade_ratings'::regclass") == "t"
    assert sql(db, """
        SELECT count(*) FROM unnest(ARRAY['anon', 'authenticated']) r
         CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
         WHERE CASE WHEN p IN ('INSERT', 'UPDATE')
                    THEN has_any_column_privilege(r, 'public.writing_grade_ratings', p)
                    ELSE has_table_privilege(r, 'public.writing_grade_ratings', p) END""") == "0"
    essay, user = str(uuid4()), str(uuid4())
    sql(db, f"""INSERT INTO public.writing_essays (id) VALUES ('{essay}');
                INSERT INTO public.writing_grade_ratings (essay_id, feedback_version, grading_model, rating)
                VALUES ('{essay}', 1, 'claude-sonnet-5-5', 4);""")
    for role in ("anon", "authenticated"):
        claims = json.dumps({"role": role} if role == "anon" else {"role": role, "sub": user})
        prefix = f"SET ROLE {role}; SELECT set_config('request.jwt.claims', '{claims}', false);"
        # RLS on and no client policy: the row exists but a client reads none of it.
        assert sql(db, f"{prefix} SELECT count(*) FROM public.writing_grade_ratings").splitlines()[-1] == "0"
        for write in (f"INSERT INTO public.writing_grade_ratings (essay_id, feedback_version, grading_model, rating)"
                      f" VALUES ('{essay}', 2, 'x', 1)",
                      "UPDATE public.writing_grade_ratings SET rating = 1",
                      "DELETE FROM public.writing_grade_ratings",
                      "TRUNCATE public.writing_grade_ratings"):
            with pytest.raises(RuntimeError, match="permission denied"):
                sql(db, f"{prefix} {write}")
    assert sql(db, "SELECT rating FROM public.writing_grade_ratings") == "4"


def test_320_warns_only_about_the_unrevocable_supabase_admin_defaults(chain):
    """Production-shaped: the runner cannot narrow supabase_admin's default ACL."""
    warning = chain["warnings"]["320_client_write_privilege_lockdown.sql"]
    listed = re.search(r"client_default_write_privilege_not_revocable_by_runner: ([^\n]*)", warning)
    assert listed, warning
    entries = listed.group(1).split(", ")
    assert "supabase_admin:r:authenticated:INSERT" in entries
    assert all(entry.startswith("supabase_admin:") for entry in entries), entries
    # The runner's own defaults (what every app migration creates with) are narrowed.
    assert sql(chain["database"], f"""
        SELECT count(*) FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
         WHERE d.defaclrole = '{OWNER}'::regrole AND d.defaclnamespace = 'public'::regnamespace
           AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated'))
           AND ((d.defaclobjtype = 'r' AND a.privilege_type <> 'SELECT')
                OR (d.defaclobjtype = 'S' AND a.privilege_type = 'UPDATE'))""") == "0"


# ── Negative controls: each check fires ─────────────────────────────────────

NEGATIVE = {
    # The brief's control (F4): a view that authenticated may INSERT into.
    "writable_view": (
        OWNER,
        "CREATE VIEW public.inv94_essays_feed AS SELECT * FROM public.writing_essays;"
        " GRANT INSERT ON public.inv94_essays_feed TO authenticated;",
        ["a:not_on_320_allowlist|v:inv94_essays_feed|authenticated:INSERT",
         "a:write_without_active_account_policy|v:inv94_essays_feed|INSERT",
         "b:client_writable_view_not_security_invoker|inv94_essays_feed|"]),
    "writable_security_invoker_view_still_off_allowlist": (
        OWNER,
        "CREATE VIEW public.inv94_vocab_feed WITH (security_invoker = true) AS"
        " SELECT * FROM public.user_vocabulary; GRANT UPDATE ON public.inv94_vocab_feed TO authenticated;",
        ["a:not_on_320_allowlist|v:inv94_vocab_feed|authenticated:UPDATE"]),
    "writable_matview": (
        OWNER,
        "CREATE MATERIALIZED VIEW public.inv94_bands AS SELECT 1 AS band;"
        " GRANT DELETE ON public.inv94_bands TO anon;",
        ["a:not_on_320_allowlist|m:inv94_bands|anon:DELETE"]),
    "writable_foreign_table": (
        OWNER,
        "CREATE FOREIGN TABLE public.inv94_remote (id int) SERVER client_invariant_server;"
        " GRANT INSERT ON public.inv94_remote TO authenticated;",
        ["a:not_on_320_allowlist|f:inv94_remote|authenticated:INSERT",
         "a:write_without_active_account_policy|f:inv94_remote|INSERT"]),
    "writable_partitioned_table": (
        OWNER,
        "GRANT TRUNCATE ON public.practice_events TO authenticated;",
        ["a:not_on_320_allowlist|p:practice_events|authenticated:TRUNCATE"]),
    # BL-10: an owner whose Supabase default ACL was never narrowed creates a table.
    "table_on_unnarrowed_default_acl": (
        "supabase_admin",
        "CREATE TABLE public.inv94_new_table (id int);",
        ["a:not_on_320_allowlist|r:inv94_new_table|anon:INSERT",
         "a:not_on_320_allowlist|r:inv94_new_table|authenticated:DELETE"]),
    "column_grant_on_users": (
        OWNER,
        "GRANT UPDATE (role) ON public.users TO authenticated;",
        ["a:not_on_320_allowlist|r:users|authenticated:UPDATE",
         "a:write_without_active_account_policy|r:users|UPDATE"]),
    "column_outside_d1_scope": (
        OWNER,
        "GRANT UPDATE (target_answer) ON public.user_d1_questions TO authenticated;",
        ["a:column_outside_scope|user_d1_questions.target_answer|authenticated:UPDATE"]),
    "allowlisted_table_loses_restrictive_policy": (
        OWNER,
        "DROP POLICY require_active_account_insert ON public.user_vocabulary;",
        ["a:write_without_active_account_policy|r:user_vocabulary|INSERT"]),
    "allowlisted_table_policy_made_permissive": (
        OWNER,
        "DROP POLICY require_active_account_delete ON public.flashcard_cards;"
        " CREATE POLICY require_active_account_delete ON public.flashcard_cards FOR DELETE"
        " TO authenticated USING ((SELECT app_private.is_current_user_active()));",
        ["a:write_without_active_account_policy|r:flashcard_cards|DELETE"]),
    "allowlisted_table_rls_off": (
        OWNER,
        "ALTER TABLE public.flashcard_reviews DISABLE ROW LEVEL SECURITY;",
        ["a:write_without_active_account_policy|r:flashcard_reviews|INSERT"]),
    "sequence_setval": (
        OWNER,
        "GRANT UPDATE ON SEQUENCE public.flashcard_review_log_id_seq TO authenticated;",
        ["a:sequence_update|flashcard_review_log_id_seq|authenticated"]),
    # BL-10: a new definer that forgets its REVOKE keeps the default EXECUTE.
    "definer_on_default_execute": (
        OWNER,
        "CREATE FUNCTION public.inv94_definer() RETURNS int LANGUAGE sql SECURITY DEFINER"
        " SET search_path = '' AS $$ SELECT 1 $$;",
        ["c:client_executable_security_definer|inv94_definer()|anon",
         "c:client_executable_security_definer|inv94_definer()|authenticated",
         "c:security_definer_public_execute|inv94_definer()|PUBLIC"]),
    "definer_in_another_schema": (
        OWNER,
        "CREATE SCHEMA inv94_rpc; CREATE FUNCTION inv94_rpc.f() RETURNS int LANGUAGE sql"
        " SECURITY DEFINER SET search_path = '' AS $$ SELECT 1 $$;"
        " REVOKE ALL ON FUNCTION inv94_rpc.f() FROM PUBLIC;"
        " GRANT EXECUTE ON FUNCTION inv94_rpc.f() TO authenticated;",
        ["c:client_executable_security_definer|inv94_rpc.f()|authenticated"]),
    "active_helper_granted_to_anon": (
        OWNER,
        f"GRANT EXECUTE ON FUNCTION {ACTIVE_HELPER} TO anon;",
        [f"c:client_executable_security_definer|{ACTIVE_HELPER}|anon"]),
    "t1_writing_grade_ratings_rls_off": (
        OWNER,
        "ALTER TABLE public.writing_grade_ratings DISABLE ROW LEVEL SECURITY;",
        ["d:writing_grade_ratings_rls_off|writing_grade_ratings|"]),
    "t1_writing_grade_ratings_client_insert": (
        OWNER,
        "GRANT INSERT ON public.writing_grade_ratings TO authenticated;",
        ["a:not_on_320_allowlist|r:writing_grade_ratings|authenticated:INSERT"]),
}


@pytest.mark.parametrize("name", sorted(NEGATIVE))
def test_negative_control_is_caught(chain, name):
    role, setup, expected = NEGATIVE[name]
    found = _violations(chain["database"], setup, role=role)
    missing = [line for line in expected if line not in found]
    assert not missing, f"{name}: {missing} not reported; got {found}"
    # Rolled back: the chain itself stays clean for the next control.
    assert _violations(chain["database"]) == []


def test_negative_control_fails_the_invariant_test_itself(chain):
    """The brief's control, end to end: the same assertion as the real test fails."""
    _, setup, _ = NEGATIVE["writable_view"]
    with pytest.raises(AssertionError):
        assert _violations(chain["database"], setup) == []
