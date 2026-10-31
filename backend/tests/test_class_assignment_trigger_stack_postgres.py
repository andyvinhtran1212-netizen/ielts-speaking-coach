"""Exercise the complete assignment INSERT/UPDATE trigger stack on LOCAL PG.

The 337 harness supplies minimal users/cohorts/students/class tables and its
326/331 dependencies. Hand-built additions are only the two updated_at columns
and a quiz_banks stub (id, meta, is_published). The timestamp function comes
verbatim from 033, its triggers from 177, full migrations 272/280, the assignment
snapshot function/trigger section of 282, then 337 and 346, in numeric order.
282's unrelated evidence tables, RPCs and DELETE guards are outside this stack.
No product function body is reimplemented here. Each case owns a UUID schema;
all listed triggers stay enabled throughout every behavioral case.

Set TEST_PG_URL to a disposable localhost cluster and REQUIRE_PG=1 to forbid
skips. Every connection uses migration 240's localhost-only psql helper.
"""

from __future__ import annotations

import json
import re
from uuid import uuid4

import pytest

import test_migration_326_student_archive as m326
import test_migration_331_archived_student_give_guard as m331
import test_migration_337_class_archive as m337
import test_migration_346_class_archive_update_guards as m346
from test_migration_240_core_attempt_evidence import psql

MIGRATIONS = m337.MIGRATIONS

# tgtype: ROW=1, BEFORE=2, INSERT=4, UPDATE=16. Pin timing/events as well as
# names: a new, missing, disabled or widened trigger must require a suite audit.
EXPECTED_TRIGGERS = {
    "class_assignments": {
        "trg_guard_advanced_vocab_assignment_snapshot": 23,
        "trg_guard_class_assignment_cohort_active": 7,
        "trg_guard_class_assignment_cohort_move": 19,
        "trg_guard_started_timed_course_due_change": 19,
        "trg_guard_started_timed_course_duration_change": 19,
        "update_class_assignments_updated_at": 19,
    },
    "class_assignment_items": {
        "trg_guard_class_item_cohort_active": 7,
        "trg_guard_class_item_cohort_move": 19,
        "trg_mark_timed_course_assignment_started": 17,
        "trg_snapshot_timed_course_item_cutoff": 23,
        "update_class_assignment_items_updated_at": 19,
    },
}


def _sql(name: str) -> str:
    return (MIGRATIONS / name).read_text(encoding="utf-8")


def _stack_sql(s: str) -> str:
    timestamp = _sql("033_writing_coach_tables.sql")
    start = timestamp.index("CREATE OR REPLACE FUNCTION update_updated_at_column()")
    timestamp = timestamp[start:timestamp.index("$$ LANGUAGE plpgsql;", start)
                          + len("$$ LANGUAGE plpgsql;")]
    original = _sql("177_class_assignments.sql")
    triggers = []
    for table in EXPECTED_TRIGGERS:
        name = f"update_{table}_updated_at"
        triggers.append(re.search(
            rf"CREATE TRIGGER {name}\b.*?EXECUTE FUNCTION update_updated_at_column\(\);",
            original, re.S,
        ).group())
    advanced = _sql("282_advanced_vocab_persistence_gate.sql")
    start = advanced.index("CREATE OR REPLACE FUNCTION public.guard_advanced_vocab_assignment_snapshot()")
    end = advanced.index("CREATE OR REPLACE FUNCTION public.protect_advanced_vocab_item_evidence()", start)
    return m337._schema_sql("\n".join([
        f"SET search_path = {s}, pg_temp;",
        timestamp, *triggers,
        _sql("272_lock_started_timed_course_due.sql"),
        _sql("280_snapshot_timed_course_cutoff.sql"),
        advanced[start:end],
    ]), s)


@pytest.fixture(scope="module")
def local_pg():
    m331._require_pg()


@pytest.fixture()
def db(local_pg):
    s = "class_trigger_stack_" + uuid4().hex
    try:
        m337._build(s)
        psql(f"""
            ALTER TABLE {s}.class_assignments
                ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
            ALTER TABLE {s}.class_assignment_items
                ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
            CREATE TABLE {s}.quiz_banks (
                id uuid PRIMARY KEY, meta jsonb NOT NULL,
                is_published boolean NOT NULL DEFAULT true);
        """)
        psql(_stack_sql(s))
        psql(m337._migrated(s))
        psql(m346._migrated(s))
        yield s
    finally:
        psql(f"DROP SCHEMA IF EXISTS {s} CASCADE")


def _assignment(s: str, *, skill="course", config=None, cohort=None, bank=None) -> str:
    cohort = cohort or m337._new_class(s)
    config = {"time_limit_minutes": 60} if config is None else config
    bank_sql = "NULL" if bank is None else f"'{bank}'"
    return psql(f"""
        INSERT INTO {s}.class_assignments
            (cohort_id, skill, content_id, content_config, title, due_at, updated_at)
        VALUES ('{cohort}', '{skill}', {bank_sql}, '{json.dumps(config)}',
                'Practice', '2030-01-01T12:00:00Z', '2000-01-01T00:00:00Z')
        RETURNING id
    """)


def _item(s: str, assignment: str) -> str:
    student = psql(f"INSERT INTO {s}.students (student_code, full_name) "
                   f"VALUES ('{uuid4().hex}', 'Trigger learner') RETURNING id")
    return psql(f"INSERT INTO {s}.class_assignment_items (assignment_id, student_id, updated_at) "
                f"VALUES ('{assignment}', '{student}', '2000-01-01T00:00:00Z') RETURNING id")


def _open(s: str, item: str, at="2030-01-01T11:30:00Z") -> None:
    psql(f"UPDATE {s}.class_assignment_items SET opened_at = '{at}', state = 'opened' WHERE id = '{item}'")


def _error(sql: str, message: str, state="55000") -> None:
    # psql normally omits SQLSTATE. Relay the real diagnostics in the message
    # and preserve the code; a successful statement still fails pytest.raises.
    with pytest.raises(RuntimeError) as error:
        psql(f"DO $probe$ BEGIN {sql}; EXCEPTION WHEN OTHERS THEN "
             "RAISE EXCEPTION '%: %', SQLSTATE, SQLERRM USING ERRCODE = SQLSTATE; END $probe$;")
    assert f"{state}: {message}" in str(error.value), str(error.value)


def _updated_at(s: str, table: str, row: str) -> str:
    return psql(f"SELECT updated_at FROM {s}.{table} WHERE id = '{row}'")


def _assert_advanced(s: str, table: str, row: str, before: str) -> None:
    assert psql(f"SELECT updated_at > '{before}'::timestamptz FROM {s}.{table} WHERE id = '{row}'") == "t", table


def test_catalog_has_exact_enabled_trigger_stack(db):
    actual = json.loads(psql(f"""
        SELECT json_agg(json_build_array(c.relname, t.tgname, t.tgtype, t.tgenabled)
                        ORDER BY c.relname, t.tgname)
          FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
         WHERE c.relnamespace = '{db}'::regnamespace AND NOT t.tgisinternal
           AND c.relname IN ('class_assignments', 'class_assignment_items')
    """))
    expected = sorted([table, name, kind, "O"] for table, names in EXPECTED_TRIGGERS.items()
                      for name, kind in names.items())
    assert actual == expected


def test_open_snapshots_cutoff_marks_earliest_start_and_updates_both_rows(db):
    s = db
    assignment = _assignment(s)
    first, second = _item(s, assignment), _item(s, assignment)
    parent_before = _updated_at(s, "class_assignments", assignment)
    item_before = _updated_at(s, "class_assignment_items", first)
    _open(s, first)
    assert psql(f"SELECT timed_limit_minutes = 60 AND timed_expires_at = '2030-01-01T12:00:00Z' "
                f"FROM {s}.class_assignment_items WHERE id = '{first}'") == "t"
    assert psql(f"SELECT timed_started_at = '2030-01-01T11:30:00Z' "
                f"FROM {s}.class_assignments WHERE id = '{assignment}'") == "t"
    _assert_advanced(s, "class_assignments", assignment, parent_before)
    _assert_advanced(s, "class_assignment_items", first, item_before)
    _open(s, second, "2030-01-01T10:00:00Z")
    assert psql(f"SELECT timed_started_at = '2030-01-01T10:00:00Z' "
                f"FROM {s}.class_assignments WHERE id = '{assignment}'") == "t"
    assert psql(f"SELECT timed_limit_minutes = 60 AND timed_expires_at = '2030-01-01T11:00:00Z' "
                f"FROM {s}.class_assignment_items WHERE id = '{second}'") == "t"


def test_started_assignment_allows_metadata_and_same_limit_config_edits(db):
    s, assignment = db, _assignment(db)
    _open(s, _item(s, assignment))
    before = _updated_at(s, "class_assignments", assignment)
    psql(f"UPDATE {s}.class_assignments SET title = 'Revised', instructions = 'Try again', "
         f"content_config = content_config || '{{\"hint\": \"Listen first\"}}'::jsonb WHERE id = '{assignment}'")
    assert psql(f"SELECT title = 'Revised' AND instructions = 'Try again' "
                f"AND content_config = '{{\"time_limit_minutes\":60,\"hint\":\"Listen first\"}}'::jsonb "
                f"FROM {s}.class_assignments WHERE id = '{assignment}'") == "t"
    _assert_advanced(s, "class_assignments", assignment, before)


@pytest.mark.parametrize(("change", "message"), [
    ("due_at = due_at + interval '1 hour'", "timed_course_due_locked_after_start"),
    ("content_config = jsonb_set(content_config, '{time_limit_minutes}', '30')",
     "timed_course_duration_locked_after_start"),
])
def test_started_assignment_rejects_changed_deadline_or_duration(db, change, message):
    s, assignment = db, _assignment(db)
    _open(s, _item(s, assignment))
    _error(f"UPDATE {s}.class_assignments SET {change} WHERE id = '{assignment}'", message)
    assert psql(f"SELECT due_at = '2030-01-01T12:00:00Z' AND content_config ->> 'time_limit_minutes' = '60' "
                f"FROM {s}.class_assignments WHERE id = '{assignment}'") == "t"


def test_unstarted_assignment_accepts_deadline_and_duration_edits(db):
    s, assignment = db, _assignment(db)
    item = _item(s, assignment)
    psql(f"UPDATE {s}.class_assignments SET due_at = '2030-01-01T14:00:00Z', "
         f"content_config = '{{\"time_limit_minutes\":90}}' WHERE id = '{assignment}'")
    assert psql(f"SELECT due_at = '2030-01-01T14:00:00Z' AND content_config ->> 'time_limit_minutes' = '90' "
                f"AND timed_started_at IS NULL FROM {s}.class_assignments WHERE id = '{assignment}'") == "t"
    _open(s, item)
    assert psql(f"SELECT timed_limit_minutes = 90 AND timed_expires_at = '2030-01-01T13:00:00Z' "
                f"FROM {s}.class_assignment_items WHERE id = '{item}'") == "t"


def test_started_advanced_vocab_composes_runtime_and_duration_guards(db):
    s, bank = db, str(uuid4())
    runtime = {"kind": "advanced_vocab", "lesson_id": "ADV-T01", "content_checksum": "frozen-revision"}
    psql(f"INSERT INTO {s}.quiz_banks (id, meta) VALUES ('{bank}', '{json.dumps({'runtime': runtime})}')")
    assignment = _assignment(s, bank=bank, config={"time_limit_minutes": 60, "runtime": runtime})
    _open(s, _item(s, assignment))
    psql(f"UPDATE {s}.class_assignments SET content_config = content_config || '{{\"hint\":true}}'::jsonb "
         f"WHERE id = '{assignment}'")
    assert psql(f"SELECT content_config -> 'runtime' = '{json.dumps(runtime)}'::jsonb "
                f"AND content_config ->> 'time_limit_minutes' = '60' AND content_config -> 'hint' = 'true'::jsonb "
                f"FROM {s}.class_assignments WHERE id = '{assignment}'") == "t"
    _error(f"UPDATE {s}.class_assignments SET content_config = "
           f"jsonb_set(content_config, '{{runtime,content_checksum}}', '\"wrong\"') WHERE id = '{assignment}'",
           "advanced_vocab_assignment_snapshot_mismatch")
    _error(f"UPDATE {s}.class_assignments SET content_config = "
           f"jsonb_set(content_config, '{{time_limit_minutes}}', '30') WHERE id = '{assignment}'",
           "timed_course_duration_locked_after_start")
    psql(f"UPDATE {s}.quiz_banks SET is_published = false WHERE id = '{bank}'")
    _error(f"UPDATE {s}.class_assignments SET content_config = content_config WHERE id = '{assignment}'",
           "advanced_vocab_bank_unpublished")


def test_started_assignment_and_item_moves_respect_archived_class_and_name_order(db):
    s, assignment = db, _assignment(db)
    item = _item(s, assignment)
    _open(s, item)
    active, archived = m337._new_class(s), m337._new_class(s)
    target = _assignment(s, cohort=archived)
    admin = m326._admin(s)
    m337._archive_class(s, archived, admin)
    psql(f"UPDATE {s}.class_assignments SET cohort_id = '{active}' WHERE id = '{assignment}'")
    assert psql(f"SELECT cohort_id FROM {s}.class_assignments WHERE id = '{assignment}'") == active
    _error(f"UPDATE {s}.class_assignments SET cohort_id = '{archived}' WHERE id = '{assignment}'",
           "cohort_archived", "P0001")
    _error(f"UPDATE {s}.class_assignment_items SET assignment_id = '{target}' WHERE id = '{item}'",
           "cohort_archived", "P0001")
    # Both guards apply. BEFORE ROW name order makes cohort_archived win before
    # timed_course_due_locked_after_start; do not accept either error loosely.
    assert "trg_guard_class_assignment_cohort_move" < "trg_guard_started_timed_course_due_change"
    _error(f"UPDATE {s}.class_assignments SET cohort_id = '{archived}', due_at = due_at + interval '1 hour' "
           f"WHERE id = '{assignment}'", "cohort_archived", "P0001")
    assert psql(f"SELECT cohort_id = '{active}' AND due_at = '2030-01-01T12:00:00Z' "
                f"FROM {s}.class_assignments WHERE id = '{assignment}'") == "t"
    assert psql(f"SELECT assignment_id FROM {s}.class_assignment_items WHERE id = '{item}'") == assignment
    active_target = _assignment(s, cohort=active)
    psql(f"UPDATE {s}.class_assignment_items SET assignment_id = '{active_target}' WHERE id = '{item}'")
    assert psql(f"SELECT assignment_id FROM {s}.class_assignment_items WHERE id = '{item}'") == active_target


@pytest.mark.parametrize(("skill", "config"), [
    ("reading", {"time_limit_minutes": 60}),
    ("course", {}),
])
def test_non_course_or_untimed_work_allows_edits_without_timer_snapshot(db, skill, config):
    s = db
    assignment = _assignment(s, skill=skill, config=config)
    item = _item(s, assignment)
    _open(s, item)
    assert psql(f"SELECT timed_started_at IS NULL FROM {s}.class_assignments WHERE id = '{assignment}'") == "t"
    assert psql(f"SELECT timed_limit_minutes IS NULL AND timed_expires_at IS NULL "
                f"FROM {s}.class_assignment_items WHERE id = '{item}'") == "t"
    active = m337._new_class(s)
    psql(f"UPDATE {s}.class_assignments SET title = 'Updated', instructions = 'New hint', cohort_id = '{active}', "
         f"due_at = '2030-01-01T14:00:00Z', content_config = '{{\"time_limit_minutes\":30,\"hint\":true}}' "
         f"WHERE id = '{assignment}'")
    assert psql(f"SELECT title = 'Updated' AND instructions = 'New hint' AND cohort_id = '{active}' "
                f"AND due_at = '2030-01-01T14:00:00Z' AND content_config ->> 'time_limit_minutes' = '30' "
                f"FROM {s}.class_assignments WHERE id = '{assignment}'") == "t"
