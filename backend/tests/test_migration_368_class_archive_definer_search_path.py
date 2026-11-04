"""SA-2209: catalog, overload repro, unchanged 337 behavior and guarded repair.

Only TEST_PG_URL pointing at a local disposable cluster is accepted by psql.
The migration runs as a NOSUPERUSER owner, with genuine NOSUPERUSER API roles.
"""
from __future__ import annotations

import hashlib
import inspect
import json
import re
from uuid import uuid4

import pytest

import test_migration_326_student_archive as m326
import test_migration_337_class_archive as m337
import test_migration_332_staff_security_audit as m332
from test_migration_240_core_attempt_evidence import psql
from test_migration_361_staff_privilege_evidence_commit_guard import _psql_all

NAME = "368_class_archive_definer_search_path.sql"
SQL = (m337.MIGRATIONS / NAME).read_text()
DOWN = (m337.MIGRATIONS / "rollback" / NAME).read_text()
FUNCTIONS = {**m337.NEW_FUNCTIONS, "fn_restore_student": "uuid,uuid,text,boolean,boolean"}
SIGS = [f"{fn}({args.replace(' ', '')})" for fn, args in FUNCTIONS.items()]
CALLS = ("array_agg", "btrim", "char_length", "count", "jsonb_array_elements_text",
         "jsonb_build_object", "now", "to_jsonb")
OWNER = m332.OWNER
PIN = "SET search_path = pg_catalog, pg_temp"


def _qualified(sql):
    sql = sql.replace("SET search_path = public, pg_temp", PIN)
    for call in CALLS:
        sql = re.sub(rf"(?<![\w.]){call}\(", f"pg_catalog.{call}(", sql)
    return sql


def _body(sql):
    return sql.split("AS $$", 1)[1].rsplit("$$;", 1)[0]


def _migrated(s, sql=SQL):
    # The production guard hashes exact prosrc. Isolated-schema tests must
    # transform both the function bodies and their expected hashes together.
    result = m337._schema_sql(sql, s)
    for fn in FUNCTIONS:
        original = m326._function(m337.SQL, fn)
        for statement in (original, _qualified(original)):
            old = hashlib.md5(_body(statement).encode()).hexdigest()
            new = hashlib.md5(_body(m337._schema_sql(statement, s)).encode()).hexdigest()
            result = result.replace(old, new)
    return result


def _apply(s):
    return m332._owner(_migrated(s))


def _post(s):
    # The final identity block needs its transaction-local snapshot. The
    # independent catalog postcondition is deliberately executable on its own.
    code = SQL.split("-- Postconditions\n", 1)[1]
    return _migrated(s, code[:code.index("END $$;") + len("END $$;")])


def _catalog(s):
    rows = json.loads(psql(f"""SELECT json_agg(row_to_json(x) ORDER BY sig) FROM (
        SELECT p.oid, p.oid::regprocedure::text AS sig, p.proowner, p.proacl,
               p.prosecdef, p.prosrc, p.proconfig, p.provolatile, p.proargdefaults::text
          FROM pg_proc p WHERE p.pronamespace = '{s}'::regnamespace) x"""))
    return {r["sig"].split(".", 1)[1]: r for r in rows}


def _other_catalog(s):
    return psql(f"""SELECT json_build_object(
        'triggers', (SELECT json_agg(row_to_json(x) ORDER BY oid) FROM (
            SELECT g.* FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid
            WHERE c.relnamespace='{s}'::regnamespace) x),
        'relations', (SELECT json_agg(row_to_json(x) ORDER BY oid) FROM (
            SELECT oid, relacl, relowner, relrowsecurity FROM pg_class
            WHERE relnamespace='{s}'::regnamespace) x))""")


def _record(s):
    m332._owner(f"""CREATE TABLE {s}._schema_migrations (filename text PRIMARY KEY);
        INSERT INTO {s}._schema_migrations VALUES
        ('337_class_archive_enforcement.sql'), ('365_staff_security_chain_search_path.sql');""")


def _schema(*, apply=False):
    m332._require_pg()
    s = "pa368_" + uuid4().hex
    try:
        m337._build(s)
        psql(m337._migrated(s))
        # The merge predecessor 366 pins this out-of-scope archive RPC. Model
        # that setup so a planted to_jsonb does not corrupt the archive receipt
        # before the 337 restore function under test even gets control.
        psql(_migrated(s, _qualified(m326._function(m326.SQL, "fn_archive_student"))))
        psql(f"""DO $$ DECLARE r record; BEGIN
            EXECUTE format('ALTER SCHEMA %I OWNER TO {OWNER}', '{s}');
            FOR r IN SELECT oid::regclass AS obj FROM pg_class
                      WHERE relnamespace='{s}'::regnamespace AND relkind IN ('r','p') LOOP
                EXECUTE format('ALTER TABLE %s OWNER TO {OWNER}', r.obj);
            END LOOP;
            FOR r IN SELECT oid::regprocedure AS obj FROM pg_proc
                      WHERE pronamespace='{s}'::regnamespace LOOP
                EXECUTE format('ALTER ROUTINE %s OWNER TO {OWNER}', r.obj);
            END LOOP;
        END $$;""")
        _record(s)
        if apply:
            _apply(s)
    except BaseException:
        psql(f"DROP SCHEMA IF EXISTS {s} CASCADE")
        raise
    return s


@pytest.fixture
def before():
    s = _schema()
    try:
        yield s
    finally:
        psql(f"DROP SCHEMA IF EXISTS {s} CASCADE")


@pytest.fixture
def fresh():
    s = _schema(apply=True)
    try:
        yield s
    finally:
        psql(f"DROP SCHEMA IF EXISTS {s} CASCADE")


@pytest.fixture(scope="module")
def db():
    s = _schema()
    try:
        admin = m326._admin(s)
        legacy = m337._new_class(s)
        learner = m326._learner(s, cohorts=0)
        psql(m326._svc(m337._add(s, learner["student"], legacy)))
        psql(m326._svc(m337._give_rpc(s, admin, [learner["student"]], legacy)))
        psql(f"ALTER TABLE {s}.cohorts DISABLE TRIGGER trg_cohorts_archive_metadata; "
             f"UPDATE {s}.cohorts SET is_active=false WHERE id='{legacy}'; "
             f"ALTER TABLE {s}.cohorts ENABLE TRIGGER trg_cohorts_archive_metadata")
        _apply(s)
        _apply(s)
        yield {"s": s, "admin": admin, "legacy": legacy, "legacy_student": learner["student"]}
    finally:
        psql(f"DROP SCHEMA IF EXISTS {s} CASCADE")


def test_focused_transaction_and_exact_body_diff():
    code = m326._strip_comments(SQL)
    assert code.strip().startswith("BEGIN;\nSET LOCAL search_path = pg_catalog, pg_temp;\nSET LOCAL lock_timeout = '5s';")
    assert code.strip().endswith("COMMIT;")
    assert len(re.findall(r"^BEGIN;", code, re.M)) == 1
    for fn, args in FUNCTIONS.items():
        original = m326._function(m337.SQL, fn)
        if fn.startswith("fn_guard_"):
            assert f"ALTER FUNCTION public.{fn}({args}) {PIN};" in code
            assert f"CREATE OR REPLACE FUNCTION public.{fn}" not in code
        else:
            assert m326._function(SQL, fn) == _qualified(original)
            assert m326._function(DOWN, fn) == original
    top = re.sub(r"\$\$.*?\$\$", "$$ $$", code, flags=re.S)
    assert top.count("CREATE TEMP TABLE m368_function_identity ON COMMIT DROP AS") == 1
    top = top.replace("ON COMMIT DROP", "ON COMMIT CLEANUP")
    assert not re.search(r"\b(GRANT|REVOKE|DROP|TRUNCATE|UPDATE|DELETE)\b|OWNER TO|CREATE.*TRIGGER", top)


def test_do_blocks_only_use_qualified_catalog_calls_and_operators():
    for sql in (SQL, DOWN):
        for block in re.findall(r"DO \$\$(.*?)END \$\$;", sql, re.S):
            for call in (*CALLS, "string_agg", "to_regclass", "to_regprocedure", "md5",
                         "has_function_privilege", "aclexplode", "array_to_string"):
                assert not re.search(rf"(?<![\w.]){call}\s*\(", block), call
            stripped = re.sub(r"'(?:[^']|'')*'", "''", block)
            stripped = re.sub(r"OPERATOR\(pg_catalog\.[^)]*\)", "OP", stripped)
            stripped = stripped.replace(":=", "ASSIGN")
            assert not re.search(r"=|<>|\|\|", stripped)


def test_policy_is_pending_and_order_is_explicit():
    rows = [line.split("\t") for line in (m337.MIGRATIONS / "forward-policy.tsv").read_text().splitlines()
            if line.startswith(NAME)]
    assert len(rows) == 1 and rows[0][1:3] == ["pending_feature", "class_archive"]
    for text in (rows[0][3], (m337.MIGRATIONS / "README.md").read_text()):
        for needle in ("needs 337 (+365)", "after SA", "No apply on merge"):
            assert needle in text


def test_catalog_before_after_only_path_and_catalog_qualification(before):
    s = before
    original = _catalog(s)
    others = _other_catalog(s)
    _apply(s)
    after = _catalog(s)
    assert original.keys() == after.keys()
    for sig, old in original.items():
        new = after[sig]
        expected = dict(old)
        if sig in SIGS:
            expected["proconfig"] = ["search_path=pg_catalog, pg_temp"]
            expected["prosrc"] = _qualified(old["prosrc"])
        assert new == expected, sig
    assert _other_catalog(s) == others
    _apply(s)
    assert _catalog(s) == after
    assert _other_catalog(s) == others


def _plant(s):
    # service_role has CREATE here only to model the pre-357 attack surface.
    m332._owner(f"GRANT CREATE ON SCHEMA {s} TO service_role")
    m332._svc(f"""CREATE FUNCTION {s}.to_jsonb(uuid[]) RETURNS jsonb LANGUAGE plpgsql AS $$
        BEGIN RAISE NOTICE 'attacker_called to_jsonb %', current_user; RETURN '[]'::jsonb; END $$;
        CREATE FUNCTION {s}.jsonb_build_object(text,bigint,text,bigint,text,bigint,text,bigint)
        RETURNS jsonb LANGUAGE plpgsql AS $$
        BEGIN RAISE NOTICE 'attacker_called jsonb_build_object %', current_user; RETURN '{{}}'::jsonb; END $$;""")


def _unplant(s):
    m332._svc(f"DROP FUNCTION {s}.to_jsonb(uuid[]); "
              f"DROP FUNCTION {s}.jsonb_build_object(text,bigint,text,bigint,text,bigint,text,bigint)")


def _scenario(s):
    admin = m326._admin(s)
    c = m337._new_class(s)
    learner = m326._learner(s, cohorts=0)
    psql(m326._svc(m337._add(s, learner["student"], c)))
    archive = m337._archive_class(s, c, admin)
    assert archive["status"] == "archived"
    rc, out = _psql_all(m326._svc(f"SELECT {s}.fn_cohort_archive_counts('{c}')"))
    assert rc == 0, out
    assert m337._restore_class(s, c, admin)["status"] == "restored"
    psql(m326._svc(f"SELECT {s}.fn_archive_student('{learner['student']}', '{admin}')"))
    rc2, out2 = _psql_all(m326._svc(
        f"SELECT {s}.fn_restore_student('{learner['student']}', '{admin}', NULL, true, false)"))
    assert rc2 == 0, out2
    facts = json.loads(psql(f"""SELECT json_build_object(
        'membership', (SELECT is_active FROM {s}.student_cohort_memberships
                        WHERE student_id='{learner['student']}' AND cohort_id='{c}'),
        'student_active', (SELECT archived_at IS NULL FROM {s}.students WHERE id='{learner['student']}'),
        'class_active', (SELECT is_active FROM {s}.cohorts WHERE id='{c}'),
        'class_audits', (SELECT count(*) FROM {s}.class_lifecycle_audit WHERE cohort_id='{c}'),
        'student_audits', (SELECT count(*) FROM {s}.student_lifecycle_audit WHERE student_id='{learner['student']}'))"""))
    return out + out2, facts


def test_negative_control_planted_overloads_run_as_definer_before_pin(before):
    _plant(before)
    out, _ = _scenario(before)
    assert f"attacker_called jsonb_build_object {OWNER}" in out
    assert f"attacker_called to_jsonb {OWNER}" in out


def test_overloads_never_run_after_pin_and_business_facts_match(before, fresh):
    _, expected = _scenario(before)
    _plant(fresh)
    out, actual = _scenario(fresh)
    assert "attacker_called" not in out
    assert actual == expected == {"membership": True, "student_active": True,
                                  "class_active": True, "class_audits": 2, "student_audits": 2}


def test_temp_tables_do_not_replace_canonical_tables(fresh):
    s = fresh
    c = m337._new_class(s)
    learner = m326._learner(s, cohorts=0)
    psql(m326._svc(m337._add(s, learner["student"], c)))
    tables = ("cohorts", "students", "student_cohort_memberships", "class_assignments",
              "class_assignment_items", "writing_assignments", "access_codes",
              "class_lifecycle_audit", "student_lifecycle_audit", "users")
    shadows = " ".join(f"CREATE TEMP TABLE {table} (LIKE {s}.{table});" for table in tables)
    output = m332._svc(f"BEGIN; {shadows} SELECT {s}.fn_cohort_archive_counts('{c}'); COMMIT;")
    assert json.loads(output.splitlines()[-1])["active_members"] == 1


def test_postcondition_ignores_planted_functions_and_operators(fresh):
    s = fresh
    _plant(s)
    m332._owner(f"CREATE FUNCTION {s}.evil_ne(oid,oid) RETURNS boolean LANGUAGE plpgsql AS $$ "
                f"BEGIN RAISE EXCEPTION 'attacker_called'; END $$; "
                f"CREATE OPERATOR {s}.<> (LEFTARG=oid, RIGHTARG=oid, FUNCTION={s}.evil_ne); "
                f"ALTER FUNCTION {s}.fn_cohort_archive_counts(uuid) SET search_path=public,pg_temp")
    rc, out = _psql_all(f"SET ROLE {OWNER}; SET search_path={s},pg_catalog; {_post(s)}")
    assert rc != 0 and "class_archive_search_path_wrong" in out
    assert "attacker_called" not in out


def test_identity_snapshot_rejects_an_unintended_grant(before):
    psql("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='pa368_observer') "
         "THEN CREATE ROLE pa368_observer NOSUPERUSER NOLOGIN; END IF; END $$")
    sql = SQL.replace("-- Postconditions", "GRANT EXECUTE ON FUNCTION public.fn_cohort_archive_counts(uuid) "
                      "TO pa368_observer;\n-- Postconditions")
    old = _catalog(before)
    error = m332._fails(m332._owner, _migrated(before, sql))
    assert "class_archive_function_identity_changed" in error
    assert _catalog(before) == old


@pytest.mark.parametrize("missing", [None, "337_class_archive_enforcement.sql", "365_staff_security_chain_search_path.sql"])
def test_missing_ledger_aborts_without_partial_changes(before, missing):
    if missing:
        m332._owner(f"DELETE FROM {before}._schema_migrations WHERE filename='{missing}'")
    else:
        m332._owner(f"DROP TABLE {before}._schema_migrations")
    old = _catalog(before)
    error = m332._fails(m332._owner, _migrated(before))
    assert "migration_368_prerequisite_missing: no ledger row" in error
    assert _catalog(before) == old


@pytest.mark.parametrize("rollback", [False, True])
@pytest.mark.parametrize("path", ["{s}", "{s}, pg_catalog"])
def test_planted_functions_block_forward_and_rollback_without_running(before, rollback, path):
    if rollback:
        _apply(before)
    _plant(before)
    old = _catalog(before)
    rc, out = _psql_all(f"SET ROLE {OWNER}; SET search_path={path.format(s=before)}; "
                        + _migrated(before, DOWN if rollback else SQL))
    assert rc != 0 and "catalog_name_shadowed_in_public" in out
    assert "attacker_called" not in out
    assert _catalog(before) == old


@pytest.mark.parametrize("op", ["=", "<>", "||", "?", "->", "->>"])
def test_planted_operator_is_rejected_before_changes(before, op):
    s = before
    m332._owner(f"CREATE FUNCTION {s}.planted(text,text) RETURNS boolean LANGUAGE plpgsql AS $$ "
                f"BEGIN RAISE EXCEPTION 'attacker_called'; END $$; "
                f"CREATE OPERATOR {s}.{op} (LEFTARG=text, RIGHTARG=text, FUNCTION={s}.planted)")
    old = _catalog(s)
    rc, out = _psql_all(f"SET ROLE {OWNER}; SET search_path={s},pg_catalog; {_migrated(s)}")
    assert rc != 0 and "catalog_name_shadowed_in_public" in out
    assert "attacker_called" not in out
    assert _catalog(s) == old


@pytest.mark.parametrize("sig", SIGS)
@pytest.mark.parametrize("tamper", ["SECURITY INVOKER", "SET search_path = public, pg_temp"])
def test_postcondition_catches_security_or_path_drift(fresh, sig, tamper):
    m332._owner(f"ALTER FUNCTION {fresh}.{sig} {tamper}")
    assert "class_archive_search_path_wrong" in m332._fails(m332._owner, _post(fresh))


@pytest.mark.parametrize("role", ["PUBLIC", "anon", "authenticated"])
def test_postcondition_catches_client_execute(fresh, role):
    m332._owner(f"GRANT EXECUTE ON FUNCTION {fresh}.fn_cohort_archive_counts(uuid) TO {role}")
    assert "class_archive_search_path_wrong" in m332._fails(m332._owner, _post(fresh))


@pytest.mark.parametrize("trigger,table", [("trg_cohorts_archive_metadata", "cohorts"),
    *[(name, spec[1]) for name, spec in m337.GUARDS.items()]])
def test_postcondition_catches_disabled_trigger(fresh, trigger, table):
    m332._owner(f"ALTER TABLE {fresh}.{table} DISABLE TRIGGER {trigger}")
    assert "class_archive_trigger_missing" in m332._fails(m332._owner, _post(fresh))


def test_unexpected_body_is_not_overwritten(before):
    statement = m326._function(m337.SQL, "fn_cohort_archive_counts")
    statement = statement.replace("RETURN NULL;", "RETURN '{}'::jsonb;")
    m332._owner(_migrated(before, statement))
    old = _catalog(before)
    assert "class_archive_source_drift" in m332._fails(m332._owner, _migrated(before))
    assert _catalog(before) == old


def test_rollback_restores_exact_catalog_and_reapply_closes_hole(before):
    old = _catalog(before)
    others = _other_catalog(before)
    _apply(before)
    m332._owner(_migrated(before, DOWN))
    assert _catalog(before) == old
    assert _other_catalog(before) == others
    _plant(before)
    out, _ = _scenario(before)
    assert f"attacker_called to_jsonb {OWNER}" in out
    _unplant(before)
    _apply(before)
    m332._owner(_post(before))


def test_rerunning_337_is_detected_and_pin_can_be_restored(fresh):
    m332._owner(m337._migrated(fresh))
    assert "class_archive_search_path_wrong" in m332._fails(m332._owner, _post(fresh))
    _apply(fresh)
    m332._owner(_post(fresh))


# Reuse unchanged 337 behavior tests with their parametrization/concurrency
# marks. Tests that execute 337/its rollback themselves or assert its old path
# stay in the original suite, which is also required in verification.
_ORIGINAL_MIGRATION_TESTS = {
    "test_catalog_after_apply", "test_preconditions_abort_without_326_320_or_the_lock_literal",
}
for _name, _fn in vars(m337).items():
    if (inspect.isfunction(_fn) and _name.startswith("test_") and _fn.__module__ == m337.__name__
            and "db" in inspect.signature(_fn).parameters and _name not in _ORIGINAL_MIGRATION_TESTS):
        globals()["test_rerun337_" + _name[5:]] = _fn
