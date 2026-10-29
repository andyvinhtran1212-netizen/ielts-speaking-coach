"""Migration 337 (CLASSARCHIVE-0030): an archived class takes no new learners or work.

The static half always runs. It pins the migration text to the approved design
(specs/0030-class-archive/research.md §7, §7.1, §11): one locked transaction,
no backfill and no is_active-dependent CHECK, pinned SECURITY DEFINER functions
with no client EXECUTE, the trigger timings (membership guard AFTER, item guard
INSERT-only), no migration-331 object names, and fn_restore_student = the 326
body plus the archived-class skip.

The PostgreSQL half builds the 331 harness (326 + the 228 Writing RPC + 331),
adds the class tables 337 touches and a legacy inactive class with a member and
an open give, then applies 337 twice. It proves the FR-009 "nothing changes at
deploy" rule, the guard matrix, the RPCs and audit, the 0029 restore skip (with
a negative control on the 326 body), the light and full rollbacks, and the
lock-observed races in both orders.

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
T009 extends this file with the route-level coverage.
"""

from __future__ import annotations

import difflib
import json
import re
from pathlib import Path
from uuid import uuid4

import pytest

import test_migration_326_student_archive as m326
import test_migration_331_archived_student_give_guard as m331
from test_migration_240_core_attempt_evidence import psql

BACKEND = Path(__file__).resolve().parents[1]
MIGRATIONS = BACKEND / "migrations"
NAME = "337_class_archive_enforcement.sql"
SQL = (MIGRATIONS / NAME).read_text(encoding="utf-8")
SQL_326 = (MIGRATIONS / "326_student_archive.sql").read_text(encoding="utf-8")
CODE = m326._strip_comments(SQL)

NEW_FUNCTIONS = {
    "fn_cohorts_archive_metadata": "",
    "fn_cohort_archive_counts": "uuid",
    "fn_archive_cohort": "uuid, uuid, text",
    "fn_restore_cohort": "uuid, uuid, text",
    "fn_guard_membership_cohort_active": "",
    "fn_guard_class_assignment_cohort_active": "",
    "fn_guard_class_item_cohort_active": "",
    "fn_guard_writing_give_cohort_active": "",
}
RPCS = ("fn_cohort_archive_counts", "fn_archive_cohort", "fn_restore_cohort")
GUARDS = {
    "trg_guard_membership_cohort_active": ("AFTER INSERT OR UPDATE OF is_active, cohort_id",
                                           "student_cohort_memberships", "fn_guard_membership_cohort_active"),
    "trg_guard_class_assignment_cohort_active": ("BEFORE INSERT", "class_assignments",
                                                 "fn_guard_class_assignment_cohort_active"),
    "trg_guard_class_item_cohort_active": ("BEFORE INSERT", "class_assignment_items",
                                           "fn_guard_class_item_cohort_active"),
    "trg_guard_writing_give_cohort_active": ("BEFORE INSERT", "writing_assignments",
                                             "fn_guard_writing_give_cohort_active"),
}
LOCK_LITERAL = "students WHERE id = p_student_id FOR UPDATE"


def _dollar_bodies_removed(code: str) -> str:
    return re.sub(r"\$\$.*?\$\$", "$$ $$", code, flags=re.S)


def _do_blocks(code: str) -> list[str]:
    return re.findall(r"DO \$\$(.*?)\$\$;", code, flags=re.S)


# ── Static contract ─────────────────────────────────────────────────────────

def test_one_transaction_with_lock_timeout_and_no_destructive_ddl_or_backfill():
    assert CODE.strip().startswith("BEGIN;") and CODE.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s';" in CODE
    for forbidden in (r"\bDROP\b", r"DELETE\s+FROM", r"^\s*TRUNCATE", r"DISABLE\s+TRIGGER",
                      r"NOT\s+VALID", r"\bVALIDATE\b"):
        assert not re.search(forbidden, CODE, re.I | re.M), forbidden
    # No data change at apply: writes exist only inside the RPC bodies, never at
    # top level and never in a DO block (FR-009: no archived_at backfill).
    top = _dollar_bodies_removed(CODE)
    assert not re.search(r"^\s*(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\b", top, re.I | re.M)
    for block in _do_blocks(CODE):
        assert not re.search(r"\bUPDATE\s+public\.|INSERT\s+INTO|DELETE\s+FROM", block, re.I)


def test_no_is_active_dependent_check():
    checks = [line for line in CODE.splitlines() if re.search(r"\bCHECK\s*\(", line)]
    assert len(checks) == 2, checks          # audit action + archive_reason length
    for check in checks:
        assert "is_active" not in check, check
    assert "chk_cohorts_archive_reason_length" in CODE
    assert "char_length(archive_reason) <= 500" in CODE


def test_every_new_function_is_a_pinned_definer_without_client_execute():
    for name, args in NEW_FUNCTIONS.items():
        fn = m326._function(SQL, name)
        assert "SECURITY DEFINER SET search_path = public, pg_temp" in fn, name
        assert f"REVOKE ALL ON FUNCTION public.{name}({args}) FROM PUBLIC, anon, authenticated;" in CODE, name
        granted = f"GRANT EXECUTE ON FUNCTION public.{name}({args}) TO service_role;" in CODE
        assert granted == (name in RPCS), name
    assert not re.search(r"GRANT[^;]*\b(anon|authenticated|PUBLIC)\b", CODE)
    # fn_restore_student keeps its 326 ACL (CREATE OR REPLACE): no grant rewrite.
    assert not re.search(r"(GRANT|REVOKE)[^;]*fn_restore_student", CODE)


def test_trigger_timings_events_and_names():
    for trigger, (timing, table, function) in GUARDS.items():
        assert re.search(rf"CREATE OR REPLACE TRIGGER {trigger}\s+{re.escape(timing)} ON public\.{table}\s+"
                         rf"FOR EACH ROW EXECUTE FUNCTION public\.{function}\(\);", CODE), trigger
    assert re.search(r"CREATE OR REPLACE TRIGGER trg_cohorts_archive_metadata\s+BEFORE INSERT OR UPDATE "
                     r"ON public\.cohorts\s+FOR EACH ROW EXECUTE FUNCTION public\.fn_cohorts_archive_metadata\(\);",
                     CODE)
    # T002a §11.1: widening the item guard to UPDATE would abort the reaper,
    # full retry and the finalisers. The postcondition pins tgtype = 7.
    assert "class_item_guard_trigger_wrong" in CODE and "tgtype = 7" in CODE
    assert "membership_guard_trigger_wrong" in CODE and "tgtype = 21" in CODE
    # BEFORE ROW triggers fire in name order: the give guard runs after the 331
    # learner guard (student_archived wins); the item guard before the snapshot.
    assert m331.TRIGGER < "trg_guard_writing_give_cohort_active"
    assert "trg_guard_class_item_cohort_active" < "trg_snapshot_timed_course_item_cutoff"


def test_guards_lock_the_class_for_share_and_raise_cohort_archived():
    for _trigger, (_timing, _table, function) in GUARDS.items():
        fn = m326._function(SQL, function)
        assert re.search(r"FOR SHARE( OF c)?;", fn), function
        assert "RAISE EXCEPTION 'cohort_archived'" in fn and "USING DETAIL =" in fn, function
        assert "NOT v_is_active AND v_archived_at IS NOT NULL" in fn, function
    membership = m326._function(SQL, "fn_guard_membership_cohort_active")
    assert re.search(r"NEW\.is_active AND \(TG_OP = 'INSERT' OR NOT OLD\.is_active\s+"
                     r"OR NEW\.cohort_id IS DISTINCT FROM OLD\.cohort_id\)", membership)
    give = m326._function(SQL, "fn_guard_writing_give_cohort_active")
    assert give.index("NEW.cohort_id IS NULL") < give.index("FOR SHARE")


def test_counts_function_never_locks():
    """T002a §11.2: a locking read after fn_archive_cohort's class lock would
    invert the membership → class lock order of fan-out and enroll."""
    fn = m326._function(SQL, "fn_cohort_archive_counts")
    assert not re.search(r"FOR\s+(SHARE|UPDATE|NO KEY UPDATE|KEY SHARE)", fn)
    for key in ("active_members", "open_writing_gives", "open_class_items", "unused_class_codes"):
        assert f"'{key}'" in fn


def test_rpcs_lock_the_class_for_update_and_audit_once():
    for name, action in (("fn_archive_cohort", "archive"), ("fn_restore_cohort", "restore")):
        fn = m326._function(SQL, name)
        assert "FROM public.cohorts WHERE id = p_cohort_id FOR UPDATE;" in fn
        assert fn.count("INSERT INTO public.class_lifecycle_audit") == 1
        assert f"'{action}'" in fn
        assert "NULLIF(btrim(p_reason), '')" in fn and "archive_reason_too_long" in fn
        # The idempotent early return comes before any write.
        early = fn.index("'already_archived'" if action == "archive" else "'not_archived'")
        assert early < fn.index("UPDATE public.cohorts")
    assert "'legacy_upgrade', v_legacy" in m326._function(SQL, "fn_archive_cohort")
    assert "'was_legacy', v_was_legacy" in m326._function(SQL, "fn_restore_cohort")


def test_audit_is_append_only_without_fk_and_rls_on():
    table = CODE[CODE.index("CREATE TABLE IF NOT EXISTS public.class_lifecycle_audit"):]
    table = table[:table.index(");") + 2]
    assert "REFERENCES" not in table, "the audit must survive a hard delete of the class"
    assert "ALTER TABLE public.class_lifecycle_audit ENABLE ROW LEVEL SECURITY;" in CODE
    assert "REVOKE ALL ON public.class_lifecycle_audit FROM PUBLIC, anon, authenticated;" in CODE
    assert "REVOKE UPDATE, DELETE, TRUNCATE ON public.class_lifecycle_audit FROM service_role;" in CODE
    assert "GRANT SELECT, INSERT ON public.class_lifecycle_audit TO service_role;" in CODE


def test_never_names_a_331_object_even_in_comments_or_rollback():
    for name in (m331.TRIGGER, m331.FUNCTION, "session_replication_role"):
        assert name not in SQL, name


def test_restore_student_is_the_326_body_plus_the_archived_class_skip():
    old, new = m326._function(SQL_326, "fn_restore_student"), m326._function(SQL, "fn_restore_student")
    assert m326._signature(new) == m326._signature(old)
    assert LOCK_LITERAL in new
    diff = list(difflib.ndiff(m326._lines(old), m326._lines(new)))
    removed = [line[2:] for line in diff if line.startswith("- ")]
    added = [line[2:] for line in diff if line.startswith("+ ")]
    assert removed == ["AND EXISTS (SELECT 1 FROM public.cohorts c WHERE c.id = m.cohort_id)"]
    assert added == [
        "v_skipped  uuid[] := '{}';",
        "PERFORM 1 FROM public.cohorts c WHERE c.id = ANY (v_cohorts)",
        "ORDER BY c.id FOR SHARE;",
        "SELECT COALESCE(array_agg(c.id ORDER BY c.id), '{}') INTO v_skipped",
        "FROM public.cohorts c",
        "WHERE c.id = ANY (v_cohorts) AND NOT c.is_active AND c.archived_at IS NOT NULL;",
        "AND EXISTS (SELECT 1 FROM public.cohorts c WHERE c.id = m.cohort_id",
        "AND (c.is_active OR c.archived_at IS NULL))",
        "'skipped_archived_cohort_ids', to_jsonb(v_skipped),",
        "'skipped_archived_cohort_ids', to_jsonb(v_skipped),",
    ]
    # The class lock is taken before the archive state is read.
    assert new.index("ORDER BY c.id FOR SHARE") < new.index("INTO v_skipped") < new.index("WITH back AS")


def test_preconditions_precede_any_ddl():
    pre = CODE[:CODE.index("ALTER TABLE public.cohorts")]
    for marker in ("migration_320_guard_missing", "migration_326_missing", "fn_restore_student_lock_missing",
                   "cohorts_archive_columns_conflict", "m337.archived_before", LOCK_LITERAL):
        assert marker in pre, marker


def test_postconditions_cover_catalog_privileges_and_fr009():
    post = CODE[CODE.rindex("DO $$"):]
    for marker in ("cohorts_archive_columns_missing", "cohorts_archive_metadata_trigger_wrong",
                   "membership_guard_trigger_wrong", "class_assignment_guard_trigger_wrong",
                   "class_item_guard_trigger_wrong", "writing_give_guard_trigger_wrong",
                   "class_archive_function_not_pinned_security_definer",
                   "class_archive_function_client_executable", "class_archive_service_grant_missing",
                   "fn_restore_student_archive_skip_missing", "class_lifecycle_audit_privileges_wrong",
                   "class_tables_client_writable", "m337_archived_class_created"):
        assert marker in post, marker


def test_rollback_notes_order():
    light, full = _rollback_sql("public", "light"), _rollback_sql("public", "full")
    for note in (light, full):
        assert "SET LOCAL lock_timeout = '5s';" in note
        assert note.index("DROP FUNCTION IF EXISTS public.fn_archive_cohort") < note.index("DROP TRIGGER")
    assert "trg_cohorts_archive_metadata" not in light and "DROP TABLE" not in light
    assert "DROP COLUMN" not in light
    assert full.index("rollback_would_drop_class_audit") < full.index("DROP FUNCTION")
    assert "rollback_would_drop_archive_actor" in full
    assert (full.index("fn_guard_writing_give_cohort_active();") < full.index("326_student_archive.sql")
            < full.index("DROP TRIGGER IF EXISTS trg_cohorts_archive_metadata") < full.index("DROP COLUMN"))


def test_readme_documents_337_and_retires_the_330_reservation():
    readme = (MIGRATIONS / "README.md").read_text(encoding="utf-8")
    assert "Migration `337` (CLASSARCHIVE-0030" in readme
    assert "330 A-10" not in readme


# ── PostgreSQL harness ──────────────────────────────────────────────────────

def _schema_sql(sql: str, schema: str) -> str:
    return m331._schema_sql(sql, schema)


def _migrated(schema: str) -> str:
    return _schema_sql(SQL, schema)


def _rollback_sql(schema: str, kind: str) -> str:
    start = SQL.index("-- ROLLBACK (light") if kind == "light" else SQL.index("-- ROLLBACK (full")
    end = SQL.index("-- ROLLBACK (full") if kind == "light" else SQL.index("\nBEGIN;\n")
    lines = [line[5:] for line in SQL[start:end].splitlines() if line.startswith("--   ")]
    return _schema_sql("\n".join(lines), schema)


def _restore_326(schema: str) -> str:
    return _schema_sql(m326._function(SQL_326, "fn_restore_student"), schema)


def _full_rollback(schema: str) -> str:
    """The full rollback with the 326 body pasted where the note says."""
    note = _rollback_sql(schema, "full")
    marker = note.index("DROP TRIGGER IF EXISTS trg_cohorts_archive_metadata")
    return note[:marker] + _restore_326(schema) + "\n" + note[marker:]


def _class_tables(s: str) -> str:
    """The cohorts/class/code columns 337 reads, on top of the 331 harness."""
    return f"""
        SET search_path = {s}, pg_temp;
        ALTER TABLE cohorts
            ADD COLUMN is_active boolean NOT NULL DEFAULT true,
            ADD COLUMN description text,
            ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
        CREATE TABLE class_assignments (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            cohort_id uuid NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
            title text NOT NULL DEFAULT 'work',
            status text NOT NULL DEFAULT 'published');
        ALTER TABLE class_assignment_items
            ADD COLUMN assignment_id uuid REFERENCES class_assignments(id) ON DELETE CASCADE,
            ADD COLUMN state text NOT NULL DEFAULT 'assigned',
            ADD COLUMN opened_at timestamptz;
        CREATE TABLE access_codes (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            cohort_id uuid REFERENCES cohorts(id) ON DELETE SET NULL,
            is_active boolean NOT NULL DEFAULT true,
            is_used boolean DEFAULT false, is_revoked boolean DEFAULT false);
        REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA {s} FROM anon, authenticated;
        -- 227: the roster is service-role only.
        REVOKE ALL ON TABLE student_cohort_memberships FROM PUBLIC, anon, authenticated;
    """


def _build(schema: str) -> None:
    m331._build(schema)
    psql(_class_tables(schema))


def _new_class(s: str, *, active: bool = True) -> str:
    cid = str(uuid4())
    psql(f"INSERT INTO {s}.cohorts (id, name, is_active) VALUES ('{cid}', 'class {cid[:6]}', {str(active).lower()})")
    return cid


def _add(s: str, sid: str, cid: str) -> str:
    return f"SELECT {s}.fn_add_student_cohort_membership('{sid}', '{cid}', NULL);"


def _give_rpc(s: str, admin: str, students, cid: str, request: str | None = None) -> str:
    return m331._rpc(s, request or str(uuid4()), admin, students, [str(uuid4())], cid)


def _rpc_json(sql: str) -> dict | None:
    out = m326._as("service_role", sql)
    return json.loads(out) if out else None


def _archive_class(s: str, cid: str, admin: str, reason: str | None = "Kết thúc khoá") -> dict | None:
    arg = "NULL" if reason is None else "'" + reason.replace("'", "''") + "'"
    return _rpc_json(f"SELECT {s}.fn_archive_cohort('{cid}', '{admin}', {arg})")


def _restore_class(s: str, cid: str, admin: str) -> dict | None:
    return _rpc_json(f"SELECT {s}.fn_restore_cohort('{cid}', '{admin}', NULL)")


def _class_state(s: str, cid: str) -> str:
    return psql(f"""SELECT is_active, archived_at IS NOT NULL, coalesce(archived_by::text, '-'),
                           coalesce(archive_reason, '-') FROM {s}.cohorts WHERE id = '{cid}'""")


def _audits(s: str, cid: str, action: str | None = None) -> int:
    where = f" AND action = '{action}'" if action else ""
    return int(psql(f"SELECT count(*) FROM {s}.class_lifecycle_audit WHERE cohort_id = '{cid}'{where}"))


def _svc_fails(sql: str) -> str:
    return m331._svc_fails(sql)


def _archived_count(s: str) -> str:
    return psql(f"SELECT count(*) FROM {s}.cohorts WHERE NOT is_active AND archived_at IS NOT NULL")


@pytest.fixture(scope="module")
def db():
    """Schema with 326 + 331, a legacy inactive class (one member, one open
    cohort give) created BEFORE 337, then 337 applied twice."""
    m331._require_pg()
    schema = "class_archive_" + uuid4().hex
    try:
        _build(schema)
        admin = m326._admin(schema)
        legacy = _new_class(schema)
        learner = m326._learner(schema, cohorts=0)
        psql(m326._svc(_add(schema, learner["student"], legacy)))
        psql(m326._svc(_give_rpc(schema, admin, [learner["student"]], legacy)))
        psql(f"UPDATE {schema}.cohorts SET is_active = false WHERE id = '{legacy}'")   # pre-337 "Lưu trữ"
        psql(_migrated(schema))
        psql(_migrated(schema))   # re-applying is a no-op
        yield {"s": schema, "admin": admin, "legacy": legacy, "legacy_student": learner["student"]}
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


# ── PostgreSQL: behaviour ───────────────────────────────────────────────────

def test_catalog_after_apply(db):
    s = db["s"]
    assert psql(f"""SELECT string_agg(column_name || ':' || data_type, ',' ORDER BY column_name)
                    FROM information_schema.columns WHERE table_schema = '{s}' AND table_name = 'cohorts'
                     AND column_name IN ('archived_at', 'archived_by', 'archive_reason')""") == (
        "archive_reason:text,archived_at:timestamp with time zone,archived_by:uuid")
    for trigger, (timing, table, function) in GUARDS.items():
        definition = psql(f"SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = '{trigger}' "
                          f"AND tgrelid = '{s}.{table}'::regclass AND tgenabled = 'O'")
        assert f"{timing} ON {s}.{table} FOR EACH ROW EXECUTE FUNCTION {s}.{function}()" in definition
    give_triggers = psql(f"""SELECT string_agg(tgname, ',' ORDER BY tgname) FROM pg_trigger
                             WHERE tgrelid = '{s}.writing_assignments'::regclass AND NOT tgisinternal""")
    assert give_triggers.split(",").index(m331.TRIGGER) < give_triggers.split(",").index(
        "trg_guard_writing_give_cohort_active")
    for name, args in NEW_FUNCTIONS.items():
        signature = f"{s}.{name}({args.replace(' ', '')})"
        assert psql(f"SELECT prosecdef, proconfig FROM pg_proc WHERE oid = '{signature}'::regprocedure") == (
            f"t|{{\"search_path={s}, pg_temp\"}}"), name
        for role in ("anon", "authenticated"):
            assert psql(f"SELECT has_function_privilege('{role}', '{signature}', 'EXECUTE')") == "f", (role, name)
        if name in RPCS:
            assert psql(f"SELECT has_function_privilege('service_role', '{signature}', 'EXECUTE')") == "t", name
    restore = f"{s}.fn_restore_student(uuid,uuid,text,boolean,boolean)"
    assert psql(f"SELECT has_function_privilege('authenticated', '{restore}', 'EXECUTE')") == "f"
    assert psql(f"SELECT has_function_privilege('service_role', '{restore}', 'EXECUTE')") == "t"
    assert psql(f"SELECT relrowsecurity FROM pg_class WHERE oid = '{s}.class_lifecycle_audit'::regclass") == "t"
    assert psql(f"SELECT count(*) FROM pg_constraint WHERE conrelid = '{s}.cohorts'::regclass "
                f"AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%is_active%'") == "0"


def test_fr009_legacy_inactive_class_stays_legacy_and_open(db):
    """Deploy changes nothing: the pre-337 inactive class is not archived, its
    member and give are kept, and it still accepts members and work."""
    s, admin, legacy = db["s"], db["admin"], db["legacy"]
    assert _archived_count(s) == "0"
    assert _class_state(s, legacy) == "f|f|-|-"
    assert m326._active(s, db["legacy_student"]) == [legacy]
    assert psql(f"SELECT count(*) FROM {s}.writing_assignments WHERE cohort_id = '{legacy}' "
                f"AND status = 'pending'") == "1"
    newcomer = m326._learner(s, cohorts=0)
    assert m326._as("service_role", _add(s, newcomer["student"], legacy)) == "t"
    psql(m326._svc(_give_rpc(s, admin, [newcomer["student"]], legacy)))
    assignment = psql(f"INSERT INTO {s}.class_assignments (cohort_id) VALUES ('{legacy}') RETURNING id")
    psql(f"INSERT INTO {s}.class_assignment_items (assignment_id, student_id) "
         f"VALUES ('{assignment}', '{newcomer['student']}')")
    # A name edit keeps it legacy (no archived_at stamp on false → false).
    psql(f"UPDATE {s}.cohorts SET name = 'renamed', is_active = false WHERE id = '{legacy}'")
    assert _class_state(s, legacy) == "f|f|-|-"
    # Re-applying keeps the count (postcondition) and the legacy state.
    psql(_migrated(s))
    assert _archived_count(s) == "0" and _class_state(s, legacy) == "f|f|-|-"


def test_membership_guard_matrix(db):
    s, admin = db["s"], db["admin"]
    learner = m326._learner(s, cohorts=2)            # active in A (primary) and B
    sid, a, b = learner["student"], *learner["cohorts"]
    target, other = _new_class(s), m326._learner(s, cohorts=0)
    psql(m326._svc(f"SELECT {s}.fn_remove_student_cohort_membership('{sid}', '{b}')"))
    _archive_class(s, target, admin)
    _archive_class(s, b, admin)

    # Refused: a new row (single, bulk as a whole, legacy pointer), inactive → active.
    assert "cohort_archived" in _svc_fails(_add(s, sid, target))
    assert "cohort_archived" in _svc_fails(
        f"SELECT {s}.fn_add_students_cohort_membership(ARRAY['{other['student']}', '{sid}']::uuid[], '{target}', NULL)")
    assert m326._active(s, other["student"]) == []
    assert "cohort_archived" in m326._fails(f"UPDATE {s}.students SET cohort_id = '{target}' WHERE id = '{sid}'")
    assert "cohort_archived" in _svc_fails(_add(s, sid, b))                  # rejoin after leaving
    assert "cohort_archived" in m326._fails(
        f"UPDATE {s}.student_cohort_memberships SET is_active = true, left_at = NULL "
        f"WHERE student_id = '{sid}' AND cohort_id = '{b}'")
    # A cohort_id change of an active row into the archived class.
    assert "cohort_archived" in m326._fails(
        f"UPDATE {s}.student_cohort_memberships SET cohort_id = '{target}' "
        f"WHERE student_id = '{sid}' AND cohort_id = '{a}'")
    assert m326._active(s, sid) == [a]
    assert psql(f"SELECT count(*) FROM {s}.student_cohort_memberships WHERE cohort_id = '{target}'") == "0"

    # Allowed: active class, an already-active upsert, active → inactive, name edits.
    mate = m326._learner(s, cohorts=0)
    psql(m326._svc(_add(s, mate["student"], a)))
    archived_member = m326._learner(s, cohorts=1)
    c = archived_member["cohorts"][0]
    _archive_class(s, c, admin)
    assert m326._as("service_role", _add(s, archived_member["student"], c)) == "t"       # active → active
    psql(f"UPDATE {s}.students SET full_name = 'Renamed' WHERE id = '{archived_member['student']}'")
    psql(f"UPDATE {s}.cohorts SET name = 'renamed archived' WHERE id = '{c}'")
    assert m326._as("service_role",
                    f"SELECT {s}.fn_remove_student_cohort_membership('{archived_member['student']}', '{c}')") == "t"
    assert m326._active(s, archived_member["student"]) == []
    assert _class_state(s, c).startswith("f|t|")


def test_removal_moves_the_pointer_to_an_archived_class_and_succeeds(db):
    """§4 'Unchanged': removing a learner from A while still active in archived
    B passes — the sync trigger's upsert of the active B row is active→active."""
    s, admin = db["s"], db["admin"]
    learner = m326._learner(s, cohorts=2)
    sid, a, b = learner["student"], *learner["cohorts"]
    _archive_class(s, b, admin)
    assert m326._as("service_role", f"SELECT {s}.fn_remove_student_cohort_membership('{sid}', '{a}')") == "t"
    assert psql(f"SELECT cohort_id FROM {s}.students WHERE id = '{sid}'") == b
    assert m326._active(s, sid) == [b]


def test_student_archived_takes_precedence(db):
    s, admin = db["s"], db["admin"]
    learner = m326._learner(s)
    cid = learner["cohorts"][0]
    m326._archive(s, learner["student"], admin)
    _archive_class(s, cid, admin)
    for sql in (_add(s, learner["student"], cid),
                f"SELECT {s}.fn_add_students_cohort_membership(ARRAY['{learner['student']}']::uuid[], '{cid}', NULL)",
                f"INSERT INTO {s}.writing_assignments (student_id, prompt_id, cohort_id) "
                f"VALUES ('{learner['student']}', '{uuid4()}', '{cid}')"):
        error = _svc_fails(sql)
        assert "student_archived" in error and "cohort_archived" not in error, sql


def test_class_work_and_cohort_gives_are_refused_but_history_and_individual_gives_pass(db):
    s, admin = db["s"], db["admin"]
    learner = m326._learner(s)
    sid, cid = learner["student"], learner["cohorts"][0]
    assignment = psql(f"INSERT INTO {s}.class_assignments (cohort_id) VALUES ('{cid}') RETURNING id")
    item = psql(f"INSERT INTO {s}.class_assignment_items (assignment_id, student_id) "
                f"VALUES ('{assignment}', '{sid}') RETURNING id")
    done = _give_rpc(s, admin, [sid], cid)
    first = json.loads(m326._as("service_role", done))
    _archive_class(s, cid, admin)

    assert "cohort_archived" in _svc_fails(f"INSERT INTO {s}.class_assignments (cohort_id) VALUES ('{cid}')")
    late = m326._learner(s, cohorts=0)["student"]
    assert "cohort_archived" in _svc_fails(
        f"INSERT INTO {s}.class_assignment_items (assignment_id, student_id) VALUES ('{assignment}', '{late}')")
    request = str(uuid4())
    assert "cohort_archived" in _svc_fails(_give_rpc(s, admin, [sid], cid, request))
    assert m331._ledger(s, request) == 0                                   # no orphan ledger row
    # Started work is UPDATEd, never re-inserted: reaper/finalisers keep working.
    psql(m326._svc(f"UPDATE {s}.class_assignment_items SET state = 'opened', opened_at = now() WHERE id = '{item}'"))
    psql(m326._svc(f"UPDATE {s}.writing_assignments SET status = 'in_progress' WHERE cohort_id = '{cid}'"))
    # Individual give (cohort_id NULL) to the same learner is allowed.
    psql(m326._svc(m331._insert(s, [sid], str(uuid4()))))
    # A completed idempotent request replays its receipt after the archive.
    replay = json.loads(m326._as("service_role", done))
    assert replay["replayed"] is True and replay["assignment_ids"] == first["assignment_ids"]
    # Restore reopens everything.
    _restore_class(s, cid, admin)
    psql(f"INSERT INTO {s}.class_assignment_items (assignment_id, student_id) VALUES ('{assignment}', '{late}')")
    psql(m326._svc(_give_rpc(s, admin, [sid], cid)))


def test_metadata_trigger_keeps_the_old_backend_patch_working(db):
    """FR-011: an old-backend PATCH {is_active} never fails, every new archive
    is stamped (enforced) and cannot be un-enforced; restore clears it all."""
    s, admin = db["s"], db["admin"]
    cid = _new_class(s)
    psql(f"UPDATE {s}.cohorts SET is_active = false, updated_at = now() WHERE id = '{cid}'")
    assert _class_state(s, cid) == "f|t|-|-"
    assert _audits(s, cid) == 0
    psql(f"UPDATE {s}.cohorts SET archived_at = NULL WHERE id = '{cid}'")          # cannot un-enforce
    assert _class_state(s, cid) == "f|t|-|-"
    psql(f"UPDATE {s}.cohorts SET is_active = true WHERE id = '{cid}'")
    assert _class_state(s, cid) == "t|f|-|-"
    psql(f"UPDATE {s}.cohorts SET archived_at = now(), archived_by = '{admin}', archive_reason = 'x' "
         f"WHERE id = '{cid}'")
    assert _class_state(s, cid) == "t|f|-|-"                                      # active ⇒ no metadata
    inserted = str(uuid4())
    psql(f"INSERT INTO {s}.cohorts (id, name, is_active) VALUES ('{inserted}', 'born archived', false)")
    assert _class_state(s, inserted) == "f|t|-|-"
    assert "chk_cohorts_archive_reason_length" in m326._fails(
        f"UPDATE {s}.cohorts SET is_active = false, archive_reason = repeat('x', 501) WHERE id = '{cid}'")


def test_archive_and_restore_rpcs_are_atomic_idempotent_and_audited(db):
    s, admin = db["s"], db["admin"]
    learner = m326._learner(s)
    sid, cid = learner["student"], learner["cohorts"][0]
    psql(m326._svc(_give_rpc(s, admin, [sid], cid)))
    assignment = psql(f"INSERT INTO {s}.class_assignments (cohort_id) VALUES ('{cid}') RETURNING id")
    psql(f"INSERT INTO {s}.class_assignment_items (assignment_id, student_id) VALUES ('{assignment}', '{sid}')")
    psql(f"INSERT INTO {s}.access_codes (cohort_id) VALUES ('{cid}'), ('{cid}')")
    psql(f"INSERT INTO {s}.access_codes (cohort_id, is_used) VALUES ('{cid}', true)")
    counts = {"active_members": 1, "open_writing_gives": 1, "open_class_items": 1, "unused_class_codes": 2}
    assert _rpc_json(f"SELECT {s}.fn_cohort_archive_counts('{cid}')") == counts

    receipt = _archive_class(s, cid, admin, "  Kết thúc khoá  ")
    assert receipt["status"] == "archived" and receipt["counts"] == counts and receipt["legacy_upgrade"] is False
    assert _class_state(s, cid) == f"f|t|{admin}|Kết thúc khoá"
    detail = json.loads(psql(f"SELECT detail FROM {s}.class_lifecycle_audit WHERE cohort_id = '{cid}'"))
    assert detail == {**counts, "legacy_upgrade": False}
    assert psql(f"SELECT reason FROM {s}.class_lifecycle_audit WHERE cohort_id = '{cid}'") == "Kết thúc khoá"
    assert _archive_class(s, cid, admin)["status"] == "already_archived"
    assert _audits(s, cid) == 1
    psql(f"UPDATE {s}.cohorts SET name = 'renamed' WHERE id = '{cid}'")             # no audit on a rename
    assert _audits(s, cid) == 1 and _class_state(s, cid).startswith("f|t|")

    restored = _restore_class(s, cid, admin)
    assert restored == {"status": "restored", "counts": counts, "was_legacy": False}
    assert _class_state(s, cid) == "t|f|-|-"
    detail = json.loads(psql(f"SELECT detail FROM {s}.class_lifecycle_audit "
                             f"WHERE cohort_id = '{cid}' AND action = 'restore'"))
    assert detail["previous_archive_reason"] == "Kết thúc khoá" and detail["was_legacy"] is False
    assert _restore_class(s, cid, admin) == {"status": "not_archived"}
    assert _audits(s, cid, "restore") == 1

    # Empty reason → NULL; >500 refused before any write; unknown → NULL; actor required.
    assert _archive_class(s, cid, admin, "   ")["status"] == "archived"
    assert _class_state(s, cid) == f"f|t|{admin}|-"
    _restore_class(s, cid, admin)
    assert "archive_reason_too_long" in _svc_fails(f"SELECT {s}.fn_archive_cohort('{cid}', '{admin}', repeat('x', 501))")
    assert _class_state(s, cid) == "t|f|-|-" and _audits(s, cid) == 4
    assert m326._as("service_role", f"SELECT {s}.fn_archive_cohort('{uuid4()}', '{admin}') IS NULL") == "t"
    assert m326._as("service_role", f"SELECT {s}.fn_restore_cohort('{uuid4()}', '{admin}') IS NULL") == "t"
    assert m326._as("service_role", f"SELECT {s}.fn_cohort_archive_counts('{uuid4()}') IS NULL") == "t"
    assert "archive_actor_required" in _svc_fails(f"SELECT {s}.fn_archive_cohort('{cid}', NULL)")
    assert "restore_actor_required" in _svc_fails(f"SELECT {s}.fn_restore_cohort('{cid}', NULL)")


def test_apply_to_a_legacy_class_and_restore_a_legacy_class(db):
    s, admin = db["s"], db["admin"]
    upgrade, clear = _new_class(s), _new_class(s)
    # A pre-337 "Lưu trữ" (the trigger stamps every new archive, so bypass it
    # to rebuild the legacy state 337 finds on deploy).
    psql(f"ALTER TABLE {s}.cohorts DISABLE TRIGGER trg_cohorts_archive_metadata;"
         f"UPDATE {s}.cohorts SET is_active = false WHERE id IN ('{upgrade}', '{clear}');"
         f"ALTER TABLE {s}.cohorts ENABLE TRIGGER trg_cohorts_archive_metadata;")
    assert _class_state(s, upgrade) == "f|f|-|-"
    receipt = _archive_class(s, upgrade, admin, "Áp dụng")
    assert receipt["status"] == "archived" and receipt["legacy_upgrade"] is True
    assert _class_state(s, upgrade) == f"f|t|{admin}|Áp dụng"
    restored = _restore_class(s, clear, admin)
    assert restored["status"] == "restored" and restored["was_legacy"] is True
    assert _class_state(s, clear) == "t|f|-|-"
    assert _audits(s, upgrade, "archive") == 1 and _audits(s, clear, "restore") == 1


def test_clients_cannot_archive_restore_read_the_audit_or_write_the_class(db):
    s, admin = db["s"], db["admin"]
    learner = m326._learner(s)
    me, cid = learner["user"], learner["cohorts"][0]
    for role in ("authenticated", "anon"):
        for call in (f"SELECT {s}.fn_archive_cohort('{cid}', '{me}', NULL)",
                     f"SELECT {s}.fn_restore_cohort('{cid}', '{me}', NULL)",
                     f"SELECT {s}.fn_cohort_archive_counts('{cid}')"):
            assert "permission denied for function" in m326._denied(role, call, me)
        for sql in (f"SELECT count(*) FROM {s}.class_lifecycle_audit",
                    f"UPDATE {s}.cohorts SET archived_at = NULL WHERE id = '{cid}'",
                    f"INSERT INTO {s}.student_cohort_memberships (student_id, cohort_id) "
                    f"VALUES ('{learner['student']}', '{cid}')"):
            assert "permission denied" in m326._denied(role, sql, me)
    _archive_class(s, cid, admin)
    for sql in (f"DELETE FROM {s}.class_lifecycle_audit WHERE cohort_id = '{cid}'",
                f"UPDATE {s}.class_lifecycle_audit SET reason = 'x' WHERE cohort_id = '{cid}'"):
        assert "permission denied" in m326._denied("service_role", sql)


def test_restore_student_skips_an_archived_class_and_the_326_body_would_500(db):
    """Scenario 7 / FR-007, with the negative control: the 326 body aborts the
    whole restore with cohort_archived (the route's 500) on the same data."""
    s, admin = db["s"], db["admin"]
    learner = m326._learner(s, cohorts=2)
    sid, a, b = learner["student"], *learner["cohorts"]
    psql(f"UPDATE {s}.students SET cohort_id = '{b}' WHERE id = '{sid}'")          # primary pointer → B
    m326._archive(s, sid, admin)
    _archive_class(s, b, admin)

    body_337 = psql(f"SELECT pg_get_functiondef('{s}.fn_restore_student(uuid,uuid,text,boolean,boolean)'::regprocedure)")
    psql(_restore_326(s))
    try:
        assert "cohort_archived" in m326._denied(
            "service_role", f"SELECT {s}.fn_restore_student('{sid}', '{admin}')")
        assert psql(f"SELECT archived_at IS NOT NULL FROM {s}.students WHERE id = '{sid}'") == "t"
    finally:
        psql(body_337)

    result = m326._restore(s, sid, admin)
    assert result["status"] == "restored"
    assert result["restored_cohort_ids"] == [a] and result["skipped_archived_cohort_ids"] == [b]
    assert m326._active(s, sid) == [a]
    assert psql(f"SELECT cohort_id FROM {s}.students WHERE id = '{sid}'") == a
    detail = json.loads(psql(f"SELECT detail FROM {s}.student_lifecycle_audit "
                             f"WHERE student_id = '{sid}' AND action = 'restore'"))
    assert detail["skipped_archived_cohort_ids"] == [b]
    # A learner whose only former class is archived: restored with no class.
    alone = m326._learner(s)
    m326._archive(s, alone["student"], admin)
    _archive_class(s, alone["cohorts"][0], admin)
    result = m326._restore(s, alone["student"], admin)
    assert result["restored_cohort_ids"] == [] and result["skipped_archived_cohort_ids"] == alone["cohorts"]
    assert psql(f"SELECT cohort_id IS NULL FROM {s}.students WHERE id = '{alone['student']}'") == "t"


def test_preconditions_abort_without_326_320_or_the_lock_literal(db):
    s = db["s"]
    psql(f"ALTER TABLE {s}.users DISABLE TRIGGER trg_users_guard_privileged_columns")
    try:
        assert "migration_320_guard_missing" in m326._fails(_migrated(s))
    finally:
        psql(f"ALTER TABLE {s}.users ENABLE TRIGGER trg_users_guard_privileged_columns")
    body = psql(f"SELECT pg_get_functiondef('{s}.fn_restore_student(uuid,uuid,text,boolean,boolean)'::regprocedure)")
    weakened = body.replace("p_student_id FOR UPDATE", "p_student_id FOR NO KEY UPDATE")
    assert weakened != body
    psql(weakened)
    try:
        assert "fn_restore_student_lock_missing" in m326._fails(_migrated(s))
    finally:
        psql(body)
    other = "class_archive_pre_" + uuid4().hex
    try:
        m326._build(other)                                    # no 326
        assert "migration_326_missing" in m326._fails(_migrated(other))
        assert psql(f"SELECT count(*) FROM information_schema.columns WHERE table_schema = '{other}' "
                    f"AND table_name = 'cohorts' AND column_name = 'archived_at'") == "0"
    finally:
        psql(f"DROP SCHEMA IF EXISTS {other} CASCADE")
    conflict = "class_archive_conflict_" + uuid4().hex
    try:
        _build(conflict)
        psql(f"ALTER TABLE {conflict}.cohorts ADD COLUMN archived_at text")
        assert "cohorts_archive_columns_conflict" in m326._fails(_migrated(conflict))
    finally:
        psql(f"DROP SCHEMA IF EXISTS {conflict} CASCADE")
    psql(_migrated(s))


def test_light_rollback_keeps_the_old_backend_working_then_337_reapplies():
    m331._require_pg()
    s = "class_archive_light_" + uuid4().hex
    try:
        _build(s)
        psql(_migrated(s))
        admin = m326._admin(s)
        learner = m326._learner(s)
        cid = learner["cohorts"][0]
        _archive_class(s, cid, admin)
        psql(_rollback_sql(s, "light"))
        assert psql(f"SELECT to_regprocedure('{s}.fn_archive_cohort(uuid,uuid,text)') IS NULL") == "t"
        assert psql(f"SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid "
                    f"WHERE c.relnamespace = '{s}'::regnamespace AND t.tgname LIKE 'trg_guard_%_cohort_active'") == "0"
        # Old backend: PATCH both ways, enroll and give into the inactive class.
        psql(f"UPDATE {s}.cohorts SET is_active = true WHERE id = '{cid}'")
        psql(f"UPDATE {s}.cohorts SET is_active = false WHERE id = '{cid}'")
        newcomer = m326._learner(s, cohorts=0)["student"]
        assert m326._as("service_role", _add(s, newcomer, cid)) == "t"
        psql(m326._svc(_give_rpc(s, admin, [newcomer], cid)))
        # The 337 restore body stays and still works without the RPCs.
        m326._archive(s, learner["student"], admin)
        assert m326._restore(s, learner["student"], admin)["skipped_archived_cohort_ids"] == [cid]
        psql(_migrated(s))
        assert "cohort_archived" in _svc_fails(_add(s, m326._learner(s, cohorts=0)["student"], cid))
    finally:
        psql(f"DROP SCHEMA IF EXISTS {s} CASCADE")


def test_full_rollback_refuses_with_audit_or_actor_then_restores_326_and_reapplies():
    m331._require_pg()
    s = "class_archive_full_" + uuid4().hex
    try:
        _build(s)
        restore_326_src = psql(f"SELECT md5(prosrc) FROM pg_proc "
                               f"WHERE oid = '{s}.fn_restore_student(uuid,uuid,text,boolean,boolean)'::regprocedure")
        psql(_migrated(s))
        admin = m326._admin(s)
        cid = _new_class(s)
        _archive_class(s, cid, admin)
        assert "rollback_would_drop_class_audit" in m326._fails(_full_rollback(s))
        psql(f"DELETE FROM {s}.class_lifecycle_audit")             # "export first" (owner only)
        assert "rollback_would_drop_archive_actor" in m326._fails(_full_rollback(s))
        _restore_class(s, cid, admin)
        psql(f"DELETE FROM {s}.class_lifecycle_audit")
        psql(_full_rollback(s))
        assert psql(f"SELECT count(*) FROM information_schema.columns WHERE table_schema = '{s}' "
                    f"AND table_name = 'cohorts' AND column_name LIKE 'archive%'") == "0"
        assert psql(f"SELECT to_regclass('{s}.class_lifecycle_audit') IS NULL") == "t"
        assert psql(f"SELECT md5(prosrc) FROM pg_proc "
                    f"WHERE oid = '{s}.fn_restore_student(uuid,uuid,text,boolean,boolean)'::regprocedure") == (
            restore_326_src)
        assert psql(f"SELECT has_function_privilege('authenticated', "
                    f"'{s}.fn_restore_student(uuid,uuid,text,boolean,boolean)', 'EXECUTE')") == "f"
        learner = m326._learner(s)
        m326._archive(s, learner["student"], admin)
        assert m326._restore(s, learner["student"], admin)["status"] == "restored"   # 326 restore works
        psql(f"UPDATE {s}.cohorts SET is_active = false WHERE id = '{cid}'")
        psql(_migrated(s))
        assert _class_state(s, cid) == "f|f|-|-"                                     # legacy again
    finally:
        psql(f"DROP SCHEMA IF EXISTS {s} CASCADE")


# ── PostgreSQL: concurrency (lock-observed starts, measured waits) ──────────

def _hold_archive(s: str, cid: str, admin: str) -> str:
    return m331._hold(f"SELECT {s}.fn_archive_cohort('{cid}', '{admin}', NULL);")


@pytest.mark.parametrize("writer", ["single", "bulk", "trigger", "give", "assignment"])
def test_archive_commits_first_then_the_waiting_write_is_refused(db, writer):
    s, admin = db["s"], db["admin"]
    owner = m326._learner(s)
    cid = owner["cohorts"][0]
    newcomer = m326._learner(s, cohorts=0)["student"]
    write = {
        "single": _add(s, newcomer, cid),
        "bulk": f"SELECT {s}.fn_add_students_cohort_membership(ARRAY['{newcomer}']::uuid[], '{cid}', NULL);",
        "trigger": f"UPDATE {s}.students SET cohort_id = '{cid}' WHERE id = '{newcomer}';",
        "give": _give_rpc(s, admin, [owner["student"]], cid),
        "assignment": f"INSERT INTO {s}.class_assignments (cohort_id) VALUES ('{cid}');",
    }[writer]
    gives = psql(f"SELECT count(*) FROM {s}.writing_assignments WHERE cohort_id = '{cid}'")
    archive, refused = m331._timed_race(_hold_archive(s, cid, admin), m326._svc(write))
    assert archive[0] == 0, archive[2]
    assert refused[0] != 0 and "cohort_archived" in refused[2], refused
    assert refused[3] >= 1.0, f"the write did not wait on the archive's class lock ({refused[3]:.2f}s)"
    assert m326._active(s, newcomer) == []
    assert psql(f"SELECT count(*) FROM {s}.writing_assignments WHERE cohort_id = '{cid}'") == gives
    assert psql(f"SELECT count(*) FROM {s}.class_assignments WHERE cohort_id = '{cid}'") == "0"


@pytest.mark.parametrize("writer", ["single", "give"])
def test_write_commits_first_then_the_archive_waits_and_counts_it(db, writer):
    s, admin = db["s"], db["admin"]
    owner = m326._learner(s)
    cid = owner["cohorts"][0]
    newcomer = m326._learner(s, cohorts=0)["student"]
    write = {"single": _add(s, newcomer, cid), "give": _give_rpc(s, admin, [owner["student"]], cid)}[writer]
    held, archive = m331._timed_race(m331._hold(write), m326._svc(f"SELECT {s}.fn_archive_cohort('{cid}', '{admin}', NULL);"))
    assert held[0] == 0, held[2]
    assert archive[0] == 0, archive[2]
    assert archive[3] >= 1.0, f"the archive did not wait on the write's class lock ({archive[3]:.2f}s)"
    counts = json.loads(archive[1].strip().splitlines()[-1])["counts"]
    if writer == "single":
        assert counts["active_members"] == 2 and cid in m326._active(s, newcomer)
    else:
        assert counts["open_writing_gives"] == 1


def test_archive_commits_during_a_learner_restore_then_the_class_is_skipped(db):
    """The archive holds the class FOR UPDATE; the restore has read its
    candidate classes and waits on the FOR SHARE lock; once the archive
    commits, the restore returns 200 with the class skipped — never a 500."""
    s, admin = db["s"], db["admin"]
    learner = m326._learner(s, cohorts=2)
    sid, a, b = learner["student"], *learner["cohorts"]
    m326._archive(s, sid, admin)
    archive, restore = m331._timed_race(
        _hold_archive(s, b, admin),
        m326._svc(f"SELECT {s}.fn_restore_student('{sid}', '{admin}');"))
    assert archive[0] == 0, archive[2]
    assert restore[0] == 0, restore[2]
    assert restore[3] >= 1.0, f"the restore did not wait on the class lock ({restore[3]:.2f}s)"
    result = json.loads(restore[1].strip().splitlines()[-1])
    assert result["restored_cohort_ids"] == [a] and result["skipped_archived_cohort_ids"] == [b]
    assert m326._active(s, sid) == [a]


def test_restore_holds_the_class_lock_then_the_archive_waits_and_counts_the_member(db):
    s, admin = db["s"], db["admin"]
    learner = m326._learner(s)
    sid, cid = learner["student"], learner["cohorts"][0]
    m326._archive(s, sid, admin)
    restore, archive = m331._timed_race(
        m331._hold(f"SELECT {s}.fn_restore_student('{sid}', '{admin}');"),
        m326._svc(f"SELECT {s}.fn_archive_cohort('{cid}', '{admin}', NULL);"))
    assert restore[0] == 0, restore[2]
    assert archive[0] == 0, archive[2]
    assert archive[3] >= 1.0, f"the archive did not wait on the restore's class lock ({archive[3]:.2f}s)"
    assert json.loads(archive[1].strip().splitlines()[-1])["counts"]["active_members"] == 1
    assert m326._active(s, sid) == [cid]


def test_negative_control_326_restore_body_500s_when_an_archive_commits_mid_restore(db):
    """Without the candidate-class lock, the same interleaving makes the
    membership guard raise inside the restore: the route's 500."""
    s, admin = db["s"], db["admin"]
    learner = m326._learner(s, cohorts=2)
    sid, b = learner["student"], learner["cohorts"][1]
    m326._archive(s, sid, admin)
    body_337 = psql(f"SELECT pg_get_functiondef('{s}.fn_restore_student(uuid,uuid,text,boolean,boolean)'::regprocedure)")
    psql(_restore_326(s))
    try:
        archive, restore = m331._timed_race(
            _hold_archive(s, b, admin),
            m326._svc(f"SELECT {s}.fn_restore_student('{sid}', '{admin}');"))
    finally:
        psql(body_337)
    assert archive[0] == 0, archive[2]
    assert restore[0] != 0 and "cohort_archived" in restore[2], restore
    assert psql(f"SELECT archived_at IS NOT NULL FROM {s}.students WHERE id = '{sid}'") == "t"
