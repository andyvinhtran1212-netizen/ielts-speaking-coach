"""Migration 346 (PC-J153, CLASSARCHIVE-0030 FR-003): moving work into an archived class is refused.

337's work guards are BEFORE INSERT only, so an UPDATE of
class_assignments.cohort_id, writing_assignments.cohort_id or
class_assignment_items.assignment_id could still move existing work into an
archived class (audit PC-J106 F4). 346 adds BEFORE UPDATE OF <column> triggers
with a value-changed WHEN clause that call the unchanged 337 guard functions.

The static half pins the file to that design (separate triggers, 337 untouched,
rollback order). The PostgreSQL half reuses the 337 harness: it shows the hole
with 337 alone, then the move matrix, the untouched reaper/finaliser UPDATEs,
precedence, the archive lock race, re-applying 337 and 346, the rollback and
the preconditions.

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

import re
from pathlib import Path
from uuid import uuid4

import pytest

import test_migration_326_student_archive as m326
import test_migration_331_archived_student_give_guard as m331
import test_migration_337_class_archive as m337
from test_migration_240_core_attempt_evidence import psql

BACKEND = Path(__file__).resolve().parents[1]
MIGRATIONS = BACKEND / "migrations"
NAME = "346_class_archive_update_guards.sql"
SQL = (MIGRATIONS / NAME).read_text(encoding="utf-8")
CODE = m326._strip_comments(SQL)

# trigger → (table, guarded column, 337 function, 337 INSERT trigger)
MOVE_GUARDS = {
    "trg_guard_class_assignment_cohort_move": (
        "class_assignments", "cohort_id", "fn_guard_class_assignment_cohort_active",
        "trg_guard_class_assignment_cohort_active"),
    "trg_guard_class_item_cohort_move": (
        "class_assignment_items", "assignment_id", "fn_guard_class_item_cohort_active",
        "trg_guard_class_item_cohort_active"),
    "trg_guard_writing_give_cohort_move": (
        "writing_assignments", "cohort_id", "fn_guard_writing_give_cohort_active",
        "trg_guard_writing_give_cohort_active"),
}


# ── Static contract ─────────────────────────────────────────────────────────

def test_one_transaction_with_lock_timeout_and_only_three_triggers():
    assert CODE.strip().startswith("BEGIN;") and CODE.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s';" in CODE
    for forbidden in (r"\bDROP\b", r"DELETE\s+FROM", r"^\s*TRUNCATE", r"DISABLE\s+TRIGGER",
                      r"\bUPDATE\s+public\.", r"INSERT\s+INTO", r"ALTER\s+TABLE",
                      r"CREATE\s+(OR\s+REPLACE\s+)?FUNCTION", r"\bGRANT\b", r"\bREVOKE\b"):
        assert not re.search(forbidden, CODE, re.I | re.M), forbidden
    assert len(re.findall(r"CREATE OR REPLACE TRIGGER", CODE)) == 3


def test_move_guards_fire_only_when_the_class_binding_changes():
    for trigger, (table, column, function, _insert) in MOVE_GUARDS.items():
        assert re.search(
            rf"CREATE OR REPLACE TRIGGER {trigger}\s+BEFORE UPDATE OF {column} ON public\.{table}\s+"
            rf"FOR EACH ROW\s+WHEN \(NEW\.{column} IS DISTINCT FROM OLD\.{column}\)\s+"
            rf"EXECUTE FUNCTION public\.{function}\(\);", CODE), trigger


def test_the_337_insert_triggers_and_functions_are_not_redefined():
    """Widening the 337 triggers would break 337's own tgtype = 7 postcondition
    on a re-apply (research.md §11.1); 346 only adds new trigger names."""
    for _trigger, (_table, _column, function, insert) in MOVE_GUARDS.items():
        assert f"CREATE OR REPLACE TRIGGER {insert}" not in CODE
        assert not re.search(rf"FUNCTION\s+public\.{function}\(\)\s+RETURNS", CODE)
    assert "migration_337_missing" in CODE and "migration_337_guard_missing" in CODE


def test_trigger_names_sort_for_precedence():
    # BEFORE ROW triggers fire in name order: the item guard refuses before the
    # timed-course snapshot and updated_at triggers; the give guard runs after
    # the 331 learner guard, so student_archived wins.
    assert ("trg_guard_class_item_cohort_move" < "trg_snapshot_timed_course_item_cutoff"
            < "update_class_assignment_items_updated_at")
    assert m331.TRIGGER < "trg_guard_writing_give_cohort_move"


def test_never_names_a_331_object():
    for name in (m331.TRIGGER, m331.FUNCTION, "session_replication_role"):
        assert name not in SQL, name


def test_preconditions_precede_and_postconditions_follow_the_triggers():
    first = CODE.index("CREATE OR REPLACE TRIGGER")
    assert CODE.index("migration_337_guard_missing") < first
    post = CODE[CODE.rindex("DO $$"):]
    for marker in ("class_archive_move_guard_wrong", "tgtype = 19", "IS DISTINCT FROM old.",
                   "class_archive_insert_guard_changed", "tgtype = 7",
                   "class_archive_guard_function_wrong"):
        assert marker in post, marker


def test_rollback_note_drops_only_the_three_triggers():
    note = _rollback_sql("public")
    assert "SET LOCAL lock_timeout = '5s';" in note
    drops = re.findall(r"DROP TRIGGER IF EXISTS (\w+) ON public\.(\w+);", note)
    assert sorted(drops) == sorted((t, v[0]) for t, v in MOVE_GUARDS.items())
    assert "DROP FUNCTION" not in note
    assert "BEFORE any 337 rollback" in SQL


def test_readme_and_forward_policy():
    readme = (MIGRATIONS / "README.md").read_text(encoding="utf-8")
    assert "Migration `346` (PC-J153" in readme
    rows = [line.split("\t") for line in
            (MIGRATIONS / "forward-policy.tsv").read_text(encoding="utf-8").splitlines()
            if line and not line.startswith("#")]
    assert [row[1:3] for row in rows if row[0] == NAME] == [["pending_feature", "class_archive"]]


# ── PostgreSQL harness ──────────────────────────────────────────────────────

def _migrated(schema: str) -> str:
    return m337._schema_sql(SQL, schema)


def _rollback_sql(schema: str) -> str:
    header = SQL[SQL.index("-- ROLLBACK"):SQL.index("\nBEGIN;\n")]
    lines = [line[5:] for line in header.splitlines() if line.startswith("--   ")]
    return m337._schema_sql("\n".join(lines), schema)


def _build(schema: str, *, with_346: bool = True) -> None:
    m337._build(schema)
    psql(m337._migrated(schema))
    if with_346:
        psql(_migrated(schema))


def _legacy_class(s: str) -> str:
    """A pre-337 inactive class (archived_at NULL), rebuilt past the metadata trigger."""
    cid = m337._new_class(s)
    psql(f"ALTER TABLE {s}.cohorts DISABLE TRIGGER trg_cohorts_archive_metadata;"
         f"UPDATE {s}.cohorts SET is_active = false WHERE id = '{cid}';"
         f"ALTER TABLE {s}.cohorts ENABLE TRIGGER trg_cohorts_archive_metadata;")
    return cid


def _work(s: str) -> dict:
    """A learner in an active class with one class assignment, one item and one
    cohort Writing give, plus a second (archivable) class with its own assignment."""
    learner = m326._learner(s)
    sid, home = learner["student"], learner["cohorts"][0]
    target = m337._new_class(s)
    assignment = psql(f"INSERT INTO {s}.class_assignments (cohort_id) VALUES ('{home}') RETURNING id")
    target_assignment = psql(f"INSERT INTO {s}.class_assignments (cohort_id) VALUES ('{target}') RETURNING id")
    item = psql(f"INSERT INTO {s}.class_assignment_items (assignment_id, student_id) "
                f"VALUES ('{assignment}', '{sid}') RETURNING id")
    give = psql(f"INSERT INTO {s}.writing_assignments (student_id, prompt_id, cohort_id) "
                f"VALUES ('{sid}', '{uuid4()}', '{home}') RETURNING id")
    single = psql(f"INSERT INTO {s}.writing_assignments (student_id, prompt_id) "
                  f"VALUES ('{sid}', '{uuid4()}') RETURNING id")
    return {"sid": sid, "home": home, "target": target, "assignment": assignment,
            "target_assignment": target_assignment, "item": item, "give": give, "single": single}


def _moves(s: str, w: dict, cid: str, assignment: str | None = None) -> dict[str, str]:
    """Each statement moves one piece of the learner's work into class ``cid``
    (the item into ``assignment``, by default the target class's assignment)."""
    assignment = assignment or w["target_assignment"]
    return {
        "assignment": f"UPDATE {s}.class_assignments SET cohort_id = '{cid}' WHERE id = '{w['assignment']}';",
        "item": f"UPDATE {s}.class_assignment_items SET assignment_id = '{assignment}' WHERE id = '{w['item']}';",
        "give": f"UPDATE {s}.writing_assignments SET cohort_id = '{cid}' WHERE id = '{w['give']}';",
        "individual_give": f"UPDATE {s}.writing_assignments SET cohort_id = '{cid}' WHERE id = '{w['single']}';",
    }


def _binding(s: str, w: dict) -> str:
    return psql(f"""SELECT (SELECT cohort_id FROM {s}.class_assignments WHERE id = '{w['assignment']}')
                    || '|' || (SELECT assignment_id FROM {s}.class_assignment_items WHERE id = '{w['item']}')
                    || '|' || (SELECT cohort_id FROM {s}.writing_assignments WHERE id = '{w['give']}')
                    || '|' || coalesce((SELECT cohort_id::text FROM {s}.writing_assignments
                                         WHERE id = '{w['single']}'), '-')""")


@pytest.fixture(scope="module")
def db():
    """Schema with the 337 harness, 337 applied, then 346 applied twice."""
    m331._require_pg()
    schema = "class_archive_move_" + uuid4().hex
    try:
        _build(schema)
        psql(_migrated(schema))   # re-applying is a no-op
        yield {"s": schema, "admin": m326._admin(schema)}
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


# ── PostgreSQL: the gap 337 leaves, closed by 346 ───────────────────────────

def test_337_alone_lets_work_move_into_an_archived_class_and_346_refuses_it():
    m331._require_pg()
    s = "class_archive_move_gap_" + uuid4().hex
    try:
        _build(s, with_346=False)
        admin = m326._admin(s)
        before, after = _work(s), _work(s)
        m337._archive_class(s, before["target"], admin)
        m337._archive_class(s, after["target"], admin)
        for sql in _moves(s, before, before["target"]).values():   # 337 only: every move passes
            psql(m326._svc(sql))
        assert _binding(s, before) == "|".join((before["target"], before["target_assignment"],
                                                before["target"], before["target"]))
        psql(_migrated(s))
        for name, sql in _moves(s, after, after["target"]).items():
            assert "cohort_archived" in m337._svc_fails(sql), name
    finally:
        psql(f"DROP SCHEMA IF EXISTS {s} CASCADE")


# ── PostgreSQL: behaviour ───────────────────────────────────────────────────

def test_catalog_after_apply(db):
    s = db["s"]
    for trigger, (table, column, function, insert) in MOVE_GUARDS.items():
        row = psql(f"""SELECT t.tgenabled, t.tgtype, t.tgfoid = '{s}.{function}()'::regprocedure,
                              (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute
                                WHERE attrelid = t.tgrelid AND attnum = ANY (t.tgattr::smallint[])),
                              pg_get_triggerdef(t.oid) LIKE '%WHEN ((new.{column} IS DISTINCT FROM old.{column}))%'
                         FROM pg_trigger t
                        WHERE t.tgrelid = '{s}.{table}'::regclass AND t.tgname = '{trigger}'""")
        assert row == f"O|19|t|{{{column}}}|t", (trigger, row)
        assert psql(f"SELECT tgtype FROM pg_trigger WHERE tgrelid = '{s}.{table}'::regclass "
                    f"AND tgname = '{insert}'") == "7", insert


@pytest.mark.parametrize("move", ["assignment", "item", "give", "individual_give"])
def test_moving_work_into_an_archived_class_is_refused_and_nothing_changes(db, move):
    s, admin = db["s"], db["admin"]
    w = _work(s)
    m337._archive_class(s, w["target"], admin)
    before = _binding(s, w)
    error = m337._svc_fails(_moves(s, w, w["target"])[move])
    assert "cohort_archived" in error and w["target"] in error, error
    assert _binding(s, w) == before


def test_moving_work_to_an_active_or_legacy_class_or_out_of_an_archived_one_passes(db):
    s, admin = db["s"], db["admin"]
    for destination in ("active", "legacy"):
        w = _work(s)
        if destination == "active":
            cid, assignment = w["target"], w["target_assignment"]
        else:
            cid = _legacy_class(s)
            assignment = psql(f"INSERT INTO {s}.class_assignments (cohort_id) VALUES ('{cid}') RETURNING id")
        for sql in _moves(s, w, cid, assignment).values():
            psql(m326._svc(sql))
        assert _binding(s, w) == "|".join((cid, assignment, cid, cid)), destination
    # Out of an archived class: to an active class, and a give back to individual.
    w = _work(s)
    m337._archive_class(s, w["home"], admin)
    psql(m326._svc(f"UPDATE {s}.class_assignments SET cohort_id = '{w['target']}' WHERE id = '{w['assignment']}'"))
    psql(m326._svc(f"UPDATE {s}.class_assignment_items SET assignment_id = '{w['target_assignment']}' "
                   f"WHERE id = '{w['item']}'"))
    psql(m326._svc(f"UPDATE {s}.writing_assignments SET cohort_id = NULL WHERE id = '{w['give']}'"))
    assert psql(f"SELECT cohort_id IS NULL FROM {s}.writing_assignments WHERE id = '{w['give']}'") == "t"


def test_updates_that_keep_the_class_still_pass_on_an_archived_class(db):
    """Reaper, full retry, timed start, finalisers, due-date and status changes
    never move work: they keep passing on an archived class's rows, including
    statements that name the guarded column with its current value."""
    s, admin = db["s"], db["admin"]
    w = _work(s)
    m337._archive_class(s, w["home"], admin)
    for sql in (
        f"UPDATE {s}.class_assignment_items SET state = 'opened', opened_at = now() WHERE id = '{w['item']}'",
        f"UPDATE {s}.class_assignment_items SET assignment_id = assignment_id, state = 'passed' "
        f"WHERE id = '{w['item']}'",
        f"UPDATE {s}.class_assignment_items SET state = 'graded' WHERE id = '{w['item']}'",
        f"UPDATE {s}.class_assignments SET title = 'renamed', cohort_id = cohort_id WHERE id = '{w['assignment']}'",
        f"UPDATE {s}.writing_assignments SET status = 'in_progress' WHERE id = '{w['give']}'",
        f"UPDATE {s}.writing_assignments SET cohort_id = '{w['home']}', status = 'submitted' WHERE id = '{w['give']}'",
    ):
        psql(m326._svc(sql))
    assert psql(f"SELECT state FROM {s}.class_assignment_items WHERE id = '{w['item']}'") == "graded"
    assert psql(f"SELECT status FROM {s}.writing_assignments WHERE id = '{w['give']}'") == "submitted"
    # A new item into the archived class is still refused by the 337 INSERT guard.
    late = m326._learner(s, cohorts=0)["student"]
    assert "cohort_archived" in m337._svc_fails(
        f"INSERT INTO {s}.class_assignment_items (assignment_id, student_id) VALUES ('{w['assignment']}', '{late}')")


def test_restoring_the_class_lets_the_move_pass(db):
    s, admin = db["s"], db["admin"]
    w = _work(s)
    m337._archive_class(s, w["target"], admin)
    assert "cohort_archived" in m337._svc_fails(_moves(s, w, w["target"])["give"])
    m337._restore_class(s, w["target"], admin)
    for sql in _moves(s, w, w["target"]).values():
        psql(m326._svc(sql))


def test_student_archived_takes_precedence_over_cohort_archived(db):
    s, admin = db["s"], db["admin"]
    w, other = _work(s), m326._learner(s)
    m337._archive_class(s, w["target"], admin)
    m326._archive(s, other["student"], admin)
    error = m337._svc_fails(f"UPDATE {s}.writing_assignments SET student_id = '{other['student']}', "
                            f"cohort_id = '{w['target']}' WHERE id = '{w['give']}'")
    assert "student_archived" in error and "cohort_archived" not in error, error


def test_reapplying_337_keeps_the_move_guards():
    m331._require_pg()
    s = "class_archive_move_reapply_" + uuid4().hex
    try:
        _build(s)
        psql(m337._migrated(s))          # 337 re-run: its postcondition (tgtype = 7) still holds
        psql(_migrated(s))
        admin = m326._admin(s)
        w = _work(s)
        m337._archive_class(s, w["target"], admin)
        for name, sql in _moves(s, w, w["target"]).items():
            assert "cohort_archived" in m337._svc_fails(sql), name
    finally:
        psql(f"DROP SCHEMA IF EXISTS {s} CASCADE")


def test_rollback_reopens_the_move_then_346_reapplies_and_precedes_the_337_rollback():
    m331._require_pg()
    s = "class_archive_move_rollback_" + uuid4().hex
    try:
        _build(s)
        admin = m326._admin(s)
        # The 337 light rollback drops the guard functions the move triggers use.
        assert "depend" in m326._fails(m337._rollback_sql(s, "light"))
        psql(_rollback_sql(s))
        psql(_rollback_sql(s))           # idempotent
        assert psql(f"SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid "
                    f"WHERE c.relnamespace = '{s}'::regnamespace AND t.tgname LIKE 'trg_guard_%_cohort_move'") == "0"
        w = _work(s)
        m337._archive_class(s, w["target"], admin)
        psql(m326._svc(_moves(s, w, w["target"])["give"]))            # the 337-only behaviour is back
        assert "cohort_archived" in m337._svc_fails(
            f"INSERT INTO {s}.class_assignments (cohort_id) VALUES ('{w['target']}')")
        psql(_migrated(s))
        assert "cohort_archived" in m337._svc_fails(_moves(s, w, w["target"])["assignment"])
        # Order from the header: 346 rollback first, then the 337 light rollback works.
        psql(_rollback_sql(s))
        psql(m337._rollback_sql(s, "light"))
    finally:
        psql(f"DROP SCHEMA IF EXISTS {s} CASCADE")


def test_preconditions_abort_without_337_or_with_a_337_guard_disabled():
    m331._require_pg()
    s = "class_archive_move_pre_" + uuid4().hex
    try:
        _build(s, with_346=False)
        psql(m337._rollback_sql(s, "light"))
        assert "migration_337_missing" in m326._fails(_migrated(s))
        psql(m337._migrated(s))
        psql(f"ALTER TABLE {s}.class_assignment_items DISABLE TRIGGER trg_guard_class_item_cohort_active")
        assert "migration_337_guard_missing: trg_guard_class_item_cohort_active" in m326._fails(_migrated(s))
        assert psql(f"SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid "
                    f"WHERE c.relnamespace = '{s}'::regnamespace AND t.tgname LIKE 'trg_guard_%_cohort_move'") == "0"
        psql(f"ALTER TABLE {s}.class_assignment_items ENABLE TRIGGER trg_guard_class_item_cohort_active")
        psql(_migrated(s))
    finally:
        psql(f"DROP SCHEMA IF EXISTS {s} CASCADE")


def test_a_disabled_move_guard_is_re_enabled_by_a_re_apply(db):
    """Re-applying 346 restores a guard someone disabled; the postcondition
    would refuse a guard left disabled or rebound."""
    s = db["s"]
    psql(f"ALTER TABLE {s}.writing_assignments DISABLE TRIGGER trg_guard_writing_give_cohort_move")
    psql(_migrated(s))
    assert psql(f"SELECT tgenabled FROM pg_trigger WHERE tgrelid = '{s}.writing_assignments'::regclass "
                f"AND tgname = 'trg_guard_writing_give_cohort_move'") == "O"


# ── PostgreSQL: concurrency (lock-observed start, measured wait) ────────────

def test_archive_commits_first_then_the_waiting_move_is_refused(db):
    s, admin = db["s"], db["admin"]
    w = _work(s)
    archive, refused = m331._timed_race(m337._hold_archive(s, w["target"], admin),
                                        m326._svc(_moves(s, w, w["target"])["assignment"]))
    assert archive[0] == 0, archive[2]
    assert refused[0] != 0 and "cohort_archived" in refused[2], refused
    assert refused[3] >= 1.0, f"the move did not wait on the archive's class lock ({refused[3]:.2f}s)"
    assert psql(f"SELECT cohort_id FROM {s}.class_assignments WHERE id = '{w['assignment']}'") == w["home"]
