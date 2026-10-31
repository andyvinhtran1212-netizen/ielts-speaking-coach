"""Execute 284 together with Grammar 309/314 and timed-start RPC 270 on LOCAL PG.

The class foundation is the 326 builder plus 337's _class_tables (the same
assignment_id/student_id shape used by the 337 harness). Hand-built additions
are courses(id) and assignment-item submitted_at/passed_at/mastery/updated_at,
the 177/189 columns those narrow class harnesses omit. Quiz tables, FKs,
indexes and update triggers follow GrammarPg.foundation(), extracted from the
real 107/117/118/119/159/186/188/189 SQL. The update helper comes from 033;
186/294 provide the import functions wrapped by 309. Full 309, 314, 284 and 270
are loaded verbatim apart from schema/auth.users/search_path substitutions.

No Auth/RLS or application finalization parity is claimed. All rows are
synthetic, every test owns a uuid schema, and every connection uses the shared
loopback-only psql helper. Set TEST_PG_URL and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

import json
import os
import re
import shutil
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

import pytest

import test_migration_326_student_archive as classes
import test_migration_337_class_archive as archive
from test_migration_240_core_attempt_evidence import psql

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
GRAMMAR_CODE = "G-tenses-present-simple"


def _source(filename: str) -> str:
    return (MIGRATIONS / filename).read_text(encoding="utf-8")


def _adapt(sql: str, schema: str) -> str:
    sql = sql.replace("public.", f"{schema}.").replace("auth.users", f"{schema}.users")
    sql = re.sub(r"\bpublic\b(?=\s*,\s*pg_temp)", schema, sql)
    sql = sql.replace("'public', 'pg_temp'", f"'{schema}', 'pg_temp'")
    return sql.replace("n.nspname='public'", f"n.nspname='{schema}'")


def _build(schema: str) -> None:
    classes._build(schema)
    psql(archive._class_tables(schema))
    statements = [f"""
        CREATE TABLE courses (id uuid PRIMARY KEY);
        ALTER TABLE class_assignment_items
          ADD COLUMN submitted_at timestamptz,
          ADD COLUMN passed_at timestamptz,
          ADD COLUMN mastery jsonb,
          ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
    """]
    tables = [
        ("content_topics", "117_content_topics.sql"),
        ("quiz_banks", "118_quiz_banks.sql"),
        ("quiz_questions", "118_quiz_banks.sql"),
        ("quiz_sessions", "119_quiz_progress.sql"),
        ("quiz_attempts", "119_quiz_progress.sql"),
        ("quiz_word_stats", "119_quiz_progress.sql"),
        ("governance_audit", "107_governance_audit.sql"),
    ]
    for table, filename in tables:
        match = re.search(r"CREATE TABLE IF NOT EXISTS " + table + r" \([\s\S]*?\n\);", _source(filename))
        assert match, table
        statements.append(match.group())
    for filename, table in [
        ("159_quiz_questions_hint.sql", "quiz_questions"),
        ("186_quiz_why_wrong_and_lesson.sql", "quiz_questions"),
        ("186_quiz_why_wrong_and_lesson.sql", "quiz_banks"),
        ("188_quiz_session_class_link.sql", "quiz_sessions"),
        ("189_course_mastery_gate.sql", "quiz_sessions"),
    ]:
        alters = re.findall(r"^ALTER TABLE " + table + r"\b[\s\S]*?;", _source(filename), re.M)
        assert alters, (filename, table)
        statements.extend(alters)
    helper = re.search(
        r"CREATE OR REPLACE FUNCTION update_updated_at_column\(\)[\s\S]*?\$\$ LANGUAGE plpgsql;",
        _source("033_writing_coach_tables.sql"),
    )
    assert helper
    statements.append(helper.group())
    quiz_tables = {table for table, _ in tables} - {"governance_audit"}
    for filename in ("117_content_topics.sql", "118_quiz_banks.sql", "119_quiz_progress.sql"):
        for statement in re.findall(r"^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS[\s\S]*?;", _source(filename), re.M):
            if any(re.search(r"\bON\s+" + table + r"\s*\(", statement) for table in quiz_tables):
                statements.append(statement)
        for statement in re.findall(r"^CREATE TRIGGER [\s\S]*?;", _source(filename), re.M):
            if "update_updated_at_column()" in statement and "vocab_cards" not in statement:
                statements.append(statement)
    importer = re.search(
        r"CREATE OR REPLACE FUNCTION public.quiz_replace_questions[\s\S]*?END; \$function\$;",
        _source("186_quiz_why_wrong_and_lesson.sql"),
    )
    assert importer
    statements.append(importer.group())
    psql(f"SET search_path={schema},pg_temp;\n" + _adapt("\n".join(statements), schema))
    for filename in (
        "294_atomic_quiz_import_publish_state.sql",
        "309_grammar_quiz_revision_cutover.sql",
        "314_grammar_audit_reviewed_publication.sql",
        "284_single_attempt_course_assignments.sql",
        "270_atomic_timed_course_session_creation.sql",
    ):
        # 314 exceeds Linux's per-argument limit after schema substitution.
        # Keep the canonical loopback-only helper, using psql's file command.
        with TemporaryDirectory(prefix="single-attempt-") as directory:
            migration = Path(directory) / filename
            migration.write_text(f"SET search_path={schema},pg_temp;\n" + _adapt(_source(filename), schema), encoding="utf-8")
            psql(r"\i " + str(migration))


class CoursePg:
    def __init__(self, schema: str):
        self.schema = schema
        self.user, self.student, self.cohort, self.bank, self.assignment, self.item = [str(uuid4()) for _ in range(6)]

    def sql(self, sql: str) -> str:
        return psql(f"SET search_path={self.schema},pg_temp;\n" + sql)

    def seed(self) -> None:
        self.sql(f"""
            INSERT INTO users(id) VALUES ('{self.user}');
            INSERT INTO cohorts(id,name) VALUES ('{self.cohort}','Synthetic class');
            INSERT INTO students(id,user_id,student_code,full_name)
              VALUES ('{self.student}','{self.user}','J261','Synthetic learner');
            INSERT INTO student_cohort_memberships(student_id,cohort_id,is_active)
              VALUES ('{self.student}','{self.cohort}',true);
            INSERT INTO quiz_banks(id,code,skill_area) VALUES ('{self.bank}','J261-course','course');
            INSERT INTO class_assignments(id,cohort_id,skill,content_id,content_config,title)
              VALUES ('{self.assignment}','{self.cohort}','course','{self.bank}',
                      '{{"completion_mode":"single_attempt","time_limit_minutes":60}}','Synthetic course');
            INSERT INTO class_assignment_items(id,assignment_id,student_id)
              VALUES ('{self.item}','{self.assignment}','{self.student}');
        """)

    def session_sql(self, *, kind: str = "run", linked: bool = True) -> str:
        item = f"'{self.item}'" if linked else "NULL"
        return f"""INSERT INTO quiz_sessions(user_id,bank_id,code,class_assignment_item_id,kind)
          VALUES ('{self.user}','{self.bank}','J261-course',{item},'{kind}') RETURNING id"""

    def answer_sql(self, session: str) -> str:
        return f"""INSERT INTO quiz_attempts(user_id,session_id,bank_id,item_key,qid,is_correct)
          VALUES ('{self.user}','{session}','{self.bank}','synthetic','q1',true) RETURNING id"""

    def close(self, reason: str) -> None:
        patch = "submitted_at=now()" if reason == "submitted" else """mastery='{
          "attempts":[{"next_action":"retry_full"},{"next_action":"completed"}]}'::jsonb"""
        self.sql(f"UPDATE class_assignment_items SET {patch} WHERE id='{self.item}'")

    def rpc_sql(self) -> str:
        return f"""SELECT * FROM quiz_start_timed_course_session(
          '{self.item}','{self.user}','{self.bank}','J261-course','run',true)"""


@pytest.fixture
def pg():
    try:
        available = shutil.which("psql") and psql("SELECT 1") == "1"
    except Exception:
        available = False
    if not available:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for single-attempt Course verification")
        pytest.skip("Local PostgreSQL unavailable")
    assert psql("SELECT usesuper FROM pg_user WHERE usename=current_user") == "t"
    schema = "single_attempt_" + uuid4().hex
    try:
        # Only local cluster roles, as in the reused class harness.
        psql("""DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
        END $$;""")
        _build(schema)
        db = CoursePg(schema)
        db.seed()
        yield db
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


def _reject(pg: CoursePg, statement: str, message: str) -> None:
    # Surface the real SQLSTATE through psql's RuntimeError, not just a matching
    # error string from an unrelated CHECK/FK/RPC failure. DO rolls back a failed
    # statement and rethrows; pytest also fails if the write unexpectedly works.
    statement = re.sub(r"\s+RETURNING id$", "", statement)
    statement = re.sub(r"^SELECT\b", "PERFORM", statement)
    with pytest.raises(RuntimeError, match="55000: " + message + r"\n"):
        pg.sql(f"""DO $check$ BEGIN
          {statement};
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION '%: %', SQLSTATE, SQLERRM USING ERRCODE=SQLSTATE;
        END $check$;""")


def test_01_catalog_has_both_row_guards_and_statement_gate(pg):
    rows = json.loads(pg.sql("""SELECT json_agg(row_to_json(t) ORDER BY table_name, name)
      FROM (SELECT c.relname AS table_name,t.tgname AS name,t.tgtype AS type,
                   t.tgenabled AS enabled,p.proname AS function,n.nspname AS function_schema
            FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
            JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE t.tgrelid IN ('quiz_sessions'::regclass,'quiz_attempts'::regclass)
              AND NOT t.tgisinternal) t"""))
    expected = []
    for table, row_guard, single_guard in [
        ("quiz_sessions", "grammar_quiz_session_guard", "guard_single_attempt_course_session"),
        ("quiz_attempts", "grammar_quiz_attempt_guard", "guard_single_attempt_course_answer"),
    ]:
        for name, kind, function in [
            (row_guard, 31, "grammar_quiz_guard_session" if table == "quiz_sessions" else "grammar_quiz_guard_progress"),
            ("grammar_quiz_statement_gate", 62, "grammar_quiz_shared_write_gate"),
            (single_guard, 7, single_guard),
        ]:
            expected.append(dict(table_name=table, name=name, type=kind, enabled="O", function=function, function_schema=pg.schema))
    assert rows == sorted(expected, key=lambda row: (row["table_name"], row["name"]))


def test_open_single_attempt_allows_run_stages_and_answers_but_not_retake(pg):
    first = pg.sql(pg.session_sql())
    second = pg.sql(pg.session_sql())
    assert first != second  # 284 fences the terminal ledger, not the first stage.
    assert pg.sql(pg.answer_sql(first))
    _reject(pg, pg.session_sql(kind="retake"), "single_attempt_course_retake_forbidden")
    assert pg.sql("SELECT count(*) FROM quiz_sessions") == "2"
    assert pg.sql("SELECT count(*) FROM quiz_attempts") == "1"


@pytest.mark.parametrize("reason", ["submitted", "completed"])
def test_terminal_single_attempt_rejects_new_session_and_late_answer(pg, reason):
    session = pg.sql(pg.session_sql())
    pg.close(reason)
    _reject(pg, pg.session_sql(), "single_attempt_course_session_closed")
    _reject(pg, pg.answer_sql(session), "single_attempt_course_answer_closed")
    assert pg.sql("SELECT count(*) FROM quiz_sessions") == "1"
    assert pg.sql("SELECT count(*) FROM quiz_attempts") == "0"


def test_only_latest_attempt_controls_completion(pg):
    pg.sql(f"""UPDATE class_assignment_items SET mastery='{{"attempts":[
      {{"next_action":"completed"}},{{"next_action":"retry_full"}}]}}' WHERE id='{pg.item}'""")
    session = pg.sql(pg.session_sql())
    assert pg.sql(pg.answer_sql(session))


@pytest.mark.parametrize("bypass", ["mastery", "missing_mode", "non_course", "no_item"])
def test_unmanaged_bank_bypasses_284_outside_single_attempt_course(pg, bypass):
    if bypass in ("mastery", "missing_mode"):
        config = '{"completion_mode":"mastery"}' if bypass == "mastery" else '{}'
        pg.sql(f"UPDATE class_assignments SET content_config='{config}' WHERE id='{pg.assignment}'")
    elif bypass == "non_course":
        pg.sql(f"UPDATE class_assignments SET skill='grammar' WHERE id='{pg.assignment}'")
    pg.close("submitted")
    pg.close("completed")
    for kind in ("run", "retake"):
        session = pg.sql(pg.session_sql(kind=kind, linked=bypass != "no_item"))
        assert pg.sql(pg.answer_sql(session))
    assert pg.sql("SELECT count(*) FROM quiz_sessions") == "2"
    assert pg.sql("SELECT count(*) FROM quiz_attempts") == "2"


@pytest.mark.parametrize("reason", ["submitted", "completed"])
def test_timed_rpc_creates_and_adopts_then_284_rejects_after_closure(pg, reason):
    first, started = pg.sql(pg.rpc_sql()).split("|")
    assert first and started
    assert pg.sql(f"SELECT state||'|'||(opened_at IS NOT NULL)::text FROM class_assignment_items WHERE id='{pg.item}'") == "opened|true"
    assert pg.sql(pg.rpc_sql()) == f"{first}|{started}"
    # Normal finalization ends the session as well as closing the item. Force
    # RPC 270's later-stage INSERT branch rather than adopting an active stage.
    pg.sql(f"UPDATE quiz_sessions SET ended_at=now(),ended_by='completed' WHERE id='{first}'")
    pg.close(reason)
    _reject(pg, pg.rpc_sql(), "single_attempt_course_session_closed")
    assert pg.sql("SELECT count(*) FROM quiz_sessions") == "1"
    assert pg.sql("SELECT count(*) FROM quiz_sessions WHERE ended_at IS NULL") == "0"


def test_timed_rpc_first_insert_is_also_guarded_when_item_already_submitted(pg):
    pg.close("submitted")
    _reject(pg, pg.rpc_sql(), "single_attempt_course_session_closed")
    assert pg.sql("SELECT count(*) FROM quiz_sessions") == "0"
    assert pg.sql("SELECT opened_at IS NULL AND state='assigned' FROM class_assignment_items") == "t"


def test_timed_rpc_entitlement_check_precedes_284_for_completed_passing_result(pg):
    session, _ = pg.sql(pg.rpc_sql()).split("|")
    pg.sql(f"""UPDATE quiz_sessions SET ended_at=now(),ended_by='completed' WHERE id='{session}';
      UPDATE class_assignment_items SET mastery='{{"attempts":[{{"completed":true,
        "pct":100,"next_action":"completed"}}]}}' WHERE id='{pg.item}';""")
    _reject(pg, pg.rpc_sql(), "timed_course_session_not_entitled")
    assert pg.sql("SELECT count(*) FROM quiz_sessions") == "1"


def test_managed_grammar_direct_session_is_rejected_by_309_before_284(pg):
    # quiz_service.start_session rejects assignment_item_id for managed Grammar.
    # Seed a pre-cutover legacy bank (no client writes or guards disabled), then
    # enroll it under 309/314's internal cutover context. No receipt is required
    # to test the direct-write refusal, which precedes receipt validation.
    topic, bank = str(uuid4()), str(uuid4())
    pg.sql(f"""INSERT INTO content_topics(id,slug,title,skill_area)
        VALUES ('{topic}','synthetic','Synthetic Grammar','grammar');
      INSERT INTO quiz_banks(id,topic_id,code,skill_area)
        VALUES ('{bank}','{topic}','{GRAMMAR_CODE}','grammar');""")
    pg.bank = bank
    # A synthetic pre-cutover session lets the attempt trigger be exercised
    # without bypassing the live session guard to construct an impossible start.
    legacy_session = pg.sql(pg.session_sql())
    pg.sql(f"""
      BEGIN;
      SELECT set_config('aver.grammar_quiz_context','{{"action":"cutover","code":"{GRAMMAR_CODE}",
        "old_bank":"{bank}","old_revision":"{'a' * 64}"}}',true);
      UPDATE quiz_banks SET grammar_canonical_code='{GRAMMAR_CODE}',grammar_revision='{'a' * 64}',
        grammar_retired_at=transaction_timestamp() WHERE id='{bank}';
      COMMIT;""")
    pg.close("submitted")
    for kind in ("run", "retake"):
        _reject(pg, pg.session_sql(kind=kind), "grammar_managed_write_required")
    _reject(pg, pg.answer_sql(legacy_session), "grammar_managed_progress_not_admitted")
    assert pg.sql("SELECT count(*) FROM quiz_sessions") == "1"
    assert pg.sql("SELECT count(*) FROM quiz_attempts") == "0"
