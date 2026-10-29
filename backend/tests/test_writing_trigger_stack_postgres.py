"""Exercise the complete Writing BEFORE ROW trigger stack on disposable LOCAL PG.

Each case invokes the 240/248 fixture builders with function scope, so its UUID
schema is dropped even after a failure. 248 supplies the admission ledger,
Writing tables and actual 224 draft guard; 249/326/331/337/346 are applied from
their real SQL. The 224 terminal guard and 033/036/037 timestamp definitions
are extracted verbatim (unrelated tables/RLS in those migrations are omitted).

Hand-built dependencies are only the users/cohorts/class table shapes and the
extra students/Writing columns missing from 248, following the 326 harness.
The 227 roster and 320 users guard come from that harness; 337's _class_tables
adds its remaining columns. No product trigger function is a test stand-in.
TEST_PG_URL must be local; REQUIRE_PG=1 makes missing PostgreSQL a failure.
"""

import json
from datetime import datetime
from pathlib import Path
from uuid import uuid4

import pytest

import test_migration_240_core_attempt_evidence as evidence
import test_migration_248_writing_admission as admission
import test_migration_326_student_archive as students
import test_migration_331_archived_student_give_guard as learner_guard
import test_migration_337_class_archive as classes
import test_migration_346_class_archive_update_guards as moves
from test_migration_240_core_attempt_evidence import psql

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"


def _scoped(sql, schema):
    return classes._schema_sql(sql, schema).replace(
        "pg_catalog,public", f"pg_catalog,{schema}"
    ).replace("pg_catalog, public", f"pg_catalog, {schema}")


def _build(schema):
    admission.schema.__wrapped__(schema)
    psql(f"""
        SET search_path = {schema}, pg_temp;
        CREATE TABLE users (
            id uuid PRIMARY KEY, email text, role text NOT NULL DEFAULT 'user',
            is_active boolean NOT NULL DEFAULT false, display_name text, target_band numeric,
            exam_date date, self_level text, preferred_topics text[], onboarding_completed boolean,
            timezone text, weekly_goal integer, notification_email boolean, updated_at timestamptz);
        CREATE TABLE cohorts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
        ALTER TABLE students
            ADD COLUMN cohort_id uuid REFERENCES cohorts(id) ON DELETE SET NULL,
            ADD COLUMN instructor_id uuid REFERENCES users(id) ON DELETE SET NULL,
            ADD COLUMN updated_at timestamptz DEFAULT now();
        CREATE TABLE class_assignments (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            cohort_id uuid REFERENCES cohorts(id), skill text NOT NULL, title text NOT NULL,
            status text NOT NULL DEFAULT 'published');
        CREATE TABLE class_assignment_items (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            assignment_id uuid REFERENCES class_assignments(id), student_id uuid REFERENCES students(id));
        {students._227_table()}
        ALTER TABLE writing_assignments
            ADD COLUMN essay_id uuid, ADD COLUMN cohort_id uuid REFERENCES cohorts(id),
            ADD COLUMN created_at timestamptz DEFAULT now(),
            ADD COLUMN updated_at timestamptz DEFAULT now();
        ALTER TABLE writing_drafts ADD COLUMN updated_at timestamptz DEFAULT now();
    """)
    psql(students._227_writers(schema))
    psql(students._users_guard(schema))
    psql(students._migrated(schema))
    psql(_scoped((MIGRATIONS / "249_writing_admission_provenance.sql").read_text(), schema))

    terminal = students._function(admission.TTL_SQL, "fn_guard_active_player_terminal_mutation")
    start = admission.TTL_SQL.index("DROP TRIGGER IF EXISTS trg_guard_writing_assignment_terminal_mutation")
    end = admission.TTL_SQL.index("COMMENT ON COLUMN", start)
    psql(_scoped(terminal + "\n" + admission.TTL_SQL[start:end], schema))
    timestamp_sql = (MIGRATIONS / "033_writing_coach_tables.sql").read_text()
    start = timestamp_sql.index("CREATE OR REPLACE FUNCTION update_updated_at_column()")
    end = timestamp_sql.index("$$ LANGUAGE plpgsql;", start) + len("$$ LANGUAGE plpgsql;")
    timestamp = timestamp_sql[start:end]
    psql(f"SET search_path = {schema}, pg_temp;\n" + timestamp)
    for number, table in (("036", "writing_assignments"), ("037", "writing_drafts")):
        sql = (MIGRATIONS / f"{number}_{table}.sql").read_text()
        trigger = sql[sql.index(f"DROP TRIGGER IF EXISTS update_{table}_updated_at"):]
        psql(f"SET search_path = {schema}, pg_temp;\n" + trigger)
    psql(learner_guard._migrated(schema))
    psql(classes._class_tables(schema))
    psql(classes._migrated(schema))
    psql(moves._migrated(schema))
    # 248's minimal tables predate the Supabase service-role default grants.
    # Keep the private provenance/ledger ACLs from the migrations unchanged.
    psql(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {schema}.writing_assignments, "
         f"{schema}.writing_drafts TO service_role")
    psql(f"INSERT INTO {schema}.core_writing_capture_control(enabled,manifest_digest) "
         f"VALUES (true, '{'e' * 64}')")


@pytest.fixture
def schema():
    # Reuse the existing localhost-only helper, role setup and UUID teardown,
    # without sharing the original module-scoped schema between these cases.
    with_schema = evidence.probe.__wrapped__()
    name = next(with_schema)
    try:
        _build(name)
        yield name
    finally:
        with_schema.close()


def _row(schema, table, predicate):
    raw = psql(f"SELECT to_jsonb(r) FROM {schema}.{table} r WHERE {predicate}")
    return json.loads(raw) if raw else None


def _assignment(schema, data):
    return _row(schema, "writing_assignments", f"id = '{data['assignment']}'")


def _origin(schema, data):
    return _row(schema, "core_writing_origins", f"assignment_id = '{data['assignment']}'")


def _draft(schema, data):
    return _row(schema, "writing_drafts", f"assignment_id = '{data['assignment']}'")


def _refused(sql, code, message):
    # psql's default error output omits SQLSTATE. Re-raise the original code
    # and message together, without changing the transaction's rollback.
    with pytest.raises(RuntimeError, match=f"{code}:{message}") as error:
        psql("SET ROLE service_role; DO $case$ BEGIN " + sql +
             "; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION '%:%', SQLSTATE, SQLERRM; END $case$;")
    return str(error.value)


def _insert_draft(schema, data):
    return (f"INSERT INTO {schema}.writing_drafts(assignment_id,student_id,draft_text) "
            f"VALUES ('{data['assignment']}','{data['student']}','first learner draft')")


def _submit(schema, data):
    # The learner claim links the new essay in the SAME status UPDATE (224).
    return (f"UPDATE {schema}.writing_assignments SET status = 'submitted', essay_id = '{uuid4()}' "
            f"WHERE id = '{data['assignment']}'")


def _expire(schema, data):
    psql(f"UPDATE {schema}.writing_assignments SET "
         "renderer_affinity_expires_at = now() - interval '1 minute' "
         f"WHERE id = '{data['assignment']}'")


def _advance_timestamp(before, after):
    assert datetime.fromisoformat(after) > datetime.fromisoformat(before)


def test_catalog_exact_enabled_before_row_triggers(schema):
    # tgtype bits: ROW=1, BEFORE=2, INSERT=4, DELETE=8, UPDATE=16.
    expected = {
        "writing_assignments": {
            "archive_guard_writing_assignment_student": (23, "student_id"),
            "core_capture_writing_origin": (7, ""),
            "core_track_writing_origin_activity": (27, ""),
            "trg_guard_writing_assignment_terminal_mutation": (19, "status"),
            "trg_guard_writing_give_cohort_active": (7, ""),
            "trg_guard_writing_give_cohort_move": (19, "cohort_id"),
            "update_writing_assignments_updated_at": (19, ""),
        },
        "writing_drafts": {
            "core_track_writing_origin_draft": (23, ""),
            "trg_guard_writing_draft_mutation": (23, ""),
            "update_writing_drafts_updated_at": (19, ""),
        },
    }
    rows = json.loads(psql(f"""
        SELECT json_agg(json_build_array(c.relname, t.tgname, t.tgtype, t.tgenabled,
            coalesce((SELECT string_agg(a.attname, ',' ORDER BY a.attnum)
                      FROM pg_attribute a WHERE a.attrelid = t.tgrelid
                        AND a.attnum = ANY(t.tgattr::smallint[])), ''),
            pg_get_triggerdef(t.oid)))
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE c.relnamespace = '{schema}'::regnamespace AND NOT t.tgisinternal
          AND c.relname IN ('writing_assignments', 'writing_drafts')
    """))
    actual = {table: {} for table in expected}
    for table, name, kind, enabled, columns, definition in rows:
        assert enabled == "O", (table, name, enabled)
        actual[table][name] = (kind, columns)
        if name == "trg_guard_writing_give_cohort_move":
            assert "WHEN ((new.cohort_id IS DISTINCT FROM old.cohort_id))" in definition
        else:
            assert " WHEN " not in definition, (name, definition)
    assert actual == expected


@pytest.mark.parametrize("initial_status", ["pending", "in_progress"])
def test_learner_draft_insert_update_and_submit(schema, initial_status):
    data = admission.seed(schema)
    assert _origin(schema, data)["first_activity"] is None
    classification = "unclaimed"
    if initial_status == "in_progress":
        assert admission.execute(schema, data)["assignment"]["status"] == "in_progress"
        classification = "admitted"
    psql("SET ROLE service_role; " + _insert_draft(schema, data))
    first, draft = _origin(schema, data), _draft(schema, data)
    assert first["first_activity"] == classification and first["first_activity_at"] is not None
    psql(f"SET ROLE service_role; UPDATE {schema}.writing_drafts SET draft_text = 'revised learner draft' "
         f"WHERE assignment_id = '{data['assignment']}'")
    revised = _draft(schema, data)
    assert revised["draft_text"] == "revised learner draft"
    _advance_timestamp(draft["updated_at"], revised["updated_at"])
    assert _origin(schema, data) == first
    before = _assignment(schema, data)
    psql("SET ROLE service_role; " + _submit(schema, data))
    submitted = _assignment(schema, data)
    assert submitted["status"] == "submitted" and submitted["essay_id"] is not None
    _advance_timestamp(before["updated_at"], submitted["updated_at"])
    assert _origin(schema, data) == first  # Even origin.updated_at cannot move twice.
    assert psql(f"SELECT count(*) FROM {schema}.core_writing_origins "
                f"WHERE assignment_id = '{data['assignment']}'") == "1"


@pytest.mark.parametrize("write", ["insert_draft", "update_draft", "submit"])
def test_expired_learner_writes_roll_back_origin_and_source(schema, write):
    data = admission.seed(schema)
    if write == "update_draft":
        psql("SET ROLE service_role; " + _insert_draft(schema, data))
    _expire(schema, data)
    before = (_assignment(schema, data), _draft(schema, data), _origin(schema, data))
    if write == "insert_draft":
        sql = _insert_draft(schema, data)
    elif write == "update_draft":
        sql = (f"UPDATE {schema}.writing_drafts SET draft_text = 'must roll back' "
               f"WHERE assignment_id = '{data['assignment']}'")
    else:
        sql = _submit(schema, data)
    _refused(sql, "55000", "active_player_expired")
    assert (_assignment(schema, data), _draft(schema, data), _origin(schema, data)) == before


def test_admin_reassigns_active_learner_and_invalidates_original_origin(schema):
    data, other = admission.seed(schema), admission.seed(schema)
    original = _origin(schema, data)
    psql(f"SET ROLE service_role; UPDATE {schema}.writing_assignments "
         f"SET student_id = '{other['student']}' WHERE id = '{data['assignment']}'")
    assert _assignment(schema, data)["student_id"] == str(other["student"])
    invalidated = _origin(schema, data)
    assert invalidated["invalidated_at"] is not None
    assert invalidated["student_id"] == original["student_id"]
    assert invalidated["first_activity"] is None
    psql(f"SET ROLE service_role; UPDATE {schema}.writing_assignments "
         f"SET student_id = '{data['student']}' WHERE id = '{data['assignment']}'")
    assert _origin(schema, data) == invalidated
    with pytest.raises(RuntimeError, match="writing_admission_baseline_conflict"):
        admission.execute(schema, data)


@pytest.mark.parametrize("operation", ["insert", "reassign", "reassign_and_claim"])
def test_archived_learner_refused_before_origin_triggers(schema, operation):
    data, archived = admission.seed(schema), admission.seed(schema)
    assert students._archive(schema, archived["student"], students._admin(schema))["status"] == "archived"
    before = (_assignment(schema, data), _origin(schema, data))
    if operation == "insert":
        new_id = uuid4()
        sql = (f"INSERT INTO {schema}.writing_assignments(id,student_id,core_admission_tracked) "
               f"VALUES ('{new_id}', '{archived['student']}', true)")
    else:
        claim = ", core_admission_tracked = false" if operation == "reassign_and_claim" else ""
        sql = (f"UPDATE {schema}.writing_assignments SET student_id = '{archived['student']}'{claim} "
               f"WHERE id = '{data['assignment']}'")
    error = _refused(sql, "P0001", "student_archived")
    assert "writing_origin_client_claim" not in error
    assert (_assignment(schema, data), _origin(schema, data)) == before
    if operation == "insert":
        missing = {"assignment": new_id}
        assert _assignment(schema, missing) is None and _origin(schema, missing) is None


def test_cohort_insert_move_and_combined_archive_precedence(schema):
    data, archived = admission.seed(schema), admission.seed(schema)
    active, closed = classes._new_class(schema), classes._new_class(schema)
    admin = students._admin(schema)
    assert classes._archive_class(schema, closed, admin)["status"] == "archived"
    assert students._archive(schema, archived["student"], admin)["status"] == "archived"
    psql(f"SET ROLE service_role; UPDATE {schema}.writing_assignments SET cohort_id = '{active}' "
         f"WHERE id = '{data['assignment']}'")
    assert _assignment(schema, data)["cohort_id"] == active
    before = (_assignment(schema, data), _origin(schema, data))
    _refused(f"UPDATE {schema}.writing_assignments SET cohort_id = '{closed}' "
             f"WHERE id = '{data['assignment']}'", "P0001", "cohort_archived")
    assert (_assignment(schema, data), _origin(schema, data)) == before
    new_id = uuid4()
    _refused(f"INSERT INTO {schema}.writing_assignments(id,student_id,cohort_id) "
             f"VALUES ('{new_id}','{data['student']}','{closed}')", "P0001", "cohort_archived")
    assert _assignment(schema, {"assignment": new_id}) is None
    assert _origin(schema, {"assignment": new_id}) is None  # Capture ran first, then rolled back.
    error = _refused(f"UPDATE {schema}.writing_assignments SET student_id = '{archived['student']}', "
                     f"cohort_id = '{closed}' WHERE id = '{data['assignment']}'", "P0001", "student_archived")
    # archive_guard_* sorts before core_track_* and trg_guard_*.
    assert "cohort_archived" not in error
    assert (_assignment(schema, data), _origin(schema, data)) == before


def test_client_cannot_change_core_admission_tracked(schema):
    data = admission.seed(schema)
    before = (_assignment(schema, data), _origin(schema, data))
    _refused(f"UPDATE {schema}.writing_assignments SET core_admission_tracked = false "
             f"WHERE id = '{data['assignment']}'", "ZA001", "writing_origin_client_claim")
    assert (_assignment(schema, data), _origin(schema, data)) == before


def test_delete_tracked_give_tombstones_but_untracked_give_leaves_origins_untouched(schema):
    tracked = admission.seed(schema)
    before = _origin(schema, tracked)
    psql(f"SET ROLE service_role; DELETE FROM {schema}.writing_assignments WHERE id = '{tracked['assignment']}'")
    tombstone = _origin(schema, tracked)
    assert _assignment(schema, tracked) is None and tombstone["deleted_at"] is not None
    assert {k: v for k, v in tombstone.items() if k not in ("deleted_at", "updated_at")} == {
        k: v for k, v in before.items() if k not in ("deleted_at", "updated_at")}
    psql(f"UPDATE {schema}.core_writing_capture_control SET enabled = false")
    untracked = admission.seed(schema)
    assert _assignment(schema, untracked)["core_admission_tracked"] is False
    assert _origin(schema, untracked) is None
    psql(f"SET ROLE service_role; DELETE FROM {schema}.writing_assignments WHERE id = '{untracked['assignment']}'")
    assert _assignment(schema, untracked) is None and _origin(schema, untracked) is None
    assert _origin(schema, tracked) == tombstone
    assert psql(f"SELECT count(*) FROM {schema}.core_writing_origins") == "1"


def test_reaper_and_finalisers_keep_work_writable_after_expiry_and_archive(schema):
    data = admission.seed(schema)
    admission.execute(schema, data)
    home = classes._new_class(schema)
    psql(f"UPDATE {schema}.writing_assignments SET cohort_id = '{home}' WHERE id = '{data['assignment']}'")
    admin = students._admin(schema)
    classes._archive_class(schema, home, admin)
    students._archive(schema, data["student"], admin)
    _expire(schema, data)
    origin = _origin(schema, data)
    for status in ("submitted", "graded", "delivered"):
        before = _assignment(schema, data)
        # 224's operational override does not link a new learner artifact.
        # Naming unchanged guarded columns also exercises 331/346's no-op paths.
        psql(f"SET ROLE service_role; UPDATE {schema}.writing_assignments "
             f"SET status = '{status}', auto_submitted = true, student_id = student_id, cohort_id = cohort_id "
             f"WHERE id = '{data['assignment']}'")
        after = _assignment(schema, data)
        assert after["status"] == status and after["auto_submitted"] is True
        _advance_timestamp(before["updated_at"], after["updated_at"])
        assert _origin(schema, data) == origin


def test_learner_submit_from_graded_state_conflicts_without_origin_mutation(schema):
    data = admission.seed(schema)
    admission.execute(schema, data)
    psql(f"SET ROLE service_role; UPDATE {schema}.writing_assignments "
         f"SET status = 'graded', essay_id = '{uuid4()}' WHERE id = '{data['assignment']}'")
    _expire(schema, data)
    before = (_assignment(schema, data), _origin(schema, data))
    # PC-J259 case 3 requires the DB to reject a learner artifact relink from
    # a terminal state, independently of the router's current-status filter.
    _refused(_submit(schema, data), "55000", "active_player_state_conflict")
    assert (_assignment(schema, data), _origin(schema, data)) == before
