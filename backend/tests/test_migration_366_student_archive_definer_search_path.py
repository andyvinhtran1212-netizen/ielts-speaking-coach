"""Migration 366 (PC-J611): search_path pin on the 326/331 SECURITY DEFINERs.

SA-2209 (residual P2): fn_archive_student, fn_add_student_cohort_membership,
fn_add_students_cohort_membership (EXECUTE for service_role),
fn_sync_legacy_student_cohort_membership (trigger on students) and
fn_guard_writing_assignment_student_archived (trigger on writing_assignments)
ran as their owner with search_path = public, pg_temp. A role with CREATE on
public could plant an exact typed overload (to_jsonb(uuid[]),
array_agg(uuid), unnest(uuid[]), array_to_string(uuid[], text)) that beats the
catalog's polymorphic version and runs as the owner, through RPCs that same
role may call.

The static half compares the four recreated bodies with the 326 bodies they
replace, checks the one ALTER and that the DO blocks qualify every function
and operator. The PostgreSQL half builds the 331 harness (326 + 331 on the
227 writers, the 320 users guard and the 228 Writing RPC), hands every object
to the NOSUPERUSER owner the hosted runner uses, records 326, 331 and 365,
applies 366 (twice) and proves: the repro before 366 (red), the same planted
overloads never running after 366 with identical rows, pg_temp tables never
read, catalog before/after, the precondition and postcondition aborts,
re-runs of 326/331, the rollback, and the 326 and 331 behaviour suites re-run
on the 366 schema.

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

import inspect
import json
import re
from pathlib import Path
from uuid import uuid4

import pytest

import test_migration_326_student_archive as m326
import test_migration_331_archived_student_give_guard as m331
import test_migration_332_staff_security_audit as m332
import test_migration_361_staff_privilege_evidence_commit_guard as m361
import test_migration_363_users_privilege_audit_search_path as m363
import test_migration_365_staff_security_chain_search_path as m365
from test_migration_240_core_attempt_evidence import psql

BACKEND = Path(__file__).resolve().parents[1]
MIGRATIONS = BACKEND / "migrations"
NAME = "366_student_archive_definer_search_path.sql"
SQL = (MIGRATIONS / NAME).read_text(encoding="utf-8")
CODE = m326._strip_comments(SQL)
ROLLBACK = (MIGRATIONS / "rollback" / NAME).read_text(encoding="utf-8")
NAME_326, NAME_331, NAME_365 = "326_student_archive.sql", m331.NAME, m365.NAME
OWNER = m332.OWNER
PINNED = "SET search_path = pg_catalog, pg_temp"
CALLS = ("array_agg", "array_to_string", "count", "jsonb_build_object", "now", "to_jsonb", "unnest")
TABLES = ("students", "cohorts", "student_cohort_memberships", "student_lifecycle_audit", "users")
# Recreated with a qualified body: name -> (signature, EXECUTE for service_role).
RECREATED = {
    "fn_archive_student": ("fn_archive_student(uuid,uuid,text,boolean)", True),
    "fn_add_student_cohort_membership": ("fn_add_student_cohort_membership(uuid,uuid,uuid)", True),
    "fn_add_students_cohort_membership": ("fn_add_students_cohort_membership(uuid[],uuid,uuid)", True),
    "fn_sync_legacy_student_cohort_membership": ("fn_sync_legacy_student_cohort_membership()", False),
}
GUARD = m331.FUNCTION
GUARD_SIG = f"{GUARD}()"
SIGS = [sig for sig, _ in RECREATED.values()] + [GUARD_SIG]
RPC_SIGS = [sig for sig, service in RECREATED.values() if service]
ALTER = f"ALTER FUNCTION public.{GUARD}() SET search_path = pg_catalog, pg_temp;"
TRIGGERS = (("students", "trg_sync_legacy_student_cohort_membership"),
            ("writing_assignments", m331.TRIGGER))

_svc, _owner, _fails = m332._svc, m332._owner, m332._fails
_psql_all, _catalog, _proconfig = m361._psql_all, m361._catalog, m363._proconfig
_do_blocks, _without_strings, _squash = m363._do_blocks, m363._without_strings, m363._squash


def _qualified(fn: str) -> str:
    """The only change 366 makes to a body: pinned path, pg_catalog. calls,
    public. tables."""
    fn = fn.replace("SET search_path = public, pg_temp", PINNED)
    for name in CALLS:
        fn = re.sub(rf"(?<![\w.]){name}\(", f"pg_catalog.{name}(", fn)
    return re.sub(rf"\b(FROM|JOIN|INTO|UPDATE)(\s+)({'|'.join(TABLES)})\b(?!\.)", r"\1\2public.\3", fn)


def _body(fn: str) -> str:
    return m326._strip_comments(fn[fn.index("AS $$"):])


def _unqualified_calls(fn: str) -> list[str]:
    return [name for name in CALLS if re.search(rf"(?<![\w.]){name}\s*\(", _body(fn))]


def _unqualified_tables(fn: str) -> list[str]:
    return re.findall(rf"(?i)\b(?:FROM|JOIN|INTO|UPDATE)\s+({'|'.join(TABLES)})\b(?!\.)", _body(fn))


def _defining(name: str) -> list[str]:
    return [path.name for path in sorted(MIGRATIONS.glob("*.sql"))
            if re.search(rf"CREATE OR REPLACE FUNCTION\s+(?:public\.)?{name}\s*\(",
                         m326._strip_comments(path.read_text(encoding="utf-8")))]


# ── Static contract ─────────────────────────────────────────────────────────

def test_one_transaction_with_pinned_search_path_lock_timeout_and_no_data_change():
    lines = [line for line in CODE.strip().splitlines() if line.strip()]
    assert lines[:3] == ["BEGIN;", "SET LOCAL search_path = pg_catalog, pg_temp;",
                         "SET LOCAL lock_timeout = '5s';"]
    assert lines[-1] == "COMMIT;" and CODE.count("BEGIN;") == 1 and CODE.count("COMMIT;") == 1
    top = m332._without_bodies(CODE)
    assert top.count(ALTER) == 1 and len(re.findall(r"\bALTER\b", top)) == 1
    for forbidden in (r"\bDROP\b", r"DELETE\s+FROM", r"\bTRUNCATE\b", r"^\s*UPDATE\s", r"INSERT\s+INTO",
                      r"DISABLE\s+TRIGGER", r"session_replication_role", r"\bPOLICY\b", r"\bGRANT\b",
                      r"\bREVOKE\b", r"OWNER\s+TO", r"SECURITY\s+(DEFINER|INVOKER)\s*;",
                      r"CREATE\s+(OR\s+REPLACE\s+)?TRIGGER"):
        assert not re.search(forbidden, top, re.M | re.I), forbidden
    for block in _do_blocks(CODE):
        assert not re.search(r"\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|ALTER|DROP)\b", block), block[:80]


def test_bodies_are_326_with_only_the_path_catalog_calls_and_tables_qualified():
    for name, (_sig, _service) in RECREATED.items():
        old = m326._function(m326.SQL, name)
        assert _unqualified_calls(old), f"repro precondition: {name}"
        assert "SECURITY DEFINER SET search_path = public, pg_temp" in old
        new = m326._function(CODE, name)
        assert _squash(new) == _squash(m326._strip_comments(_qualified(old))), name
        assert PINNED in new and "search_path = public" not in new, name
        assert _unqualified_calls(new) == [] and _unqualified_tables(new) == [], name
        assert "SECURITY DEFINER" in new, name
    assert len(re.findall(r"CREATE OR REPLACE FUNCTION", CODE)) == len(RECREATED)
    # 331's precondition reads this text in fn_archive_student.
    assert "students WHERE id = p_student_id FOR UPDATE" in m326._function(CODE, "fn_archive_student")
    # The give guard calls no function and names only public.students: only its path changes.
    guard = m326._function(m331.SQL, GUARD)
    assert "SECURITY DEFINER SET search_path = public, pg_temp" in guard
    assert not re.search(r"(?<![\w.])[a-z_]+\s*\(", _without_strings(_body(guard)))
    named = re.findall(r"\b(?:FROM|JOIN|INTO|UPDATE)\s+([\w.]+)", _body(guard))
    assert [n for n in named if not n.startswith(("OLD.", "NEW.", "v_"))] == ["public.students"], named
    assert f"FUNCTION public.{GUARD}" not in CODE.replace(ALTER, "")


def test_no_later_migration_redefines_the_functions():
    """366 recreates the 326 bodies: a later redefinition would be reverted."""
    for name in RECREATED:
        assert _defining(name)[-2:] == [NAME_326, NAME], name
    assert _defining(GUARD) == [NAME_331]


def test_do_blocks_qualify_every_catalog_function_and_operator():
    pre = _do_blocks(CODE)[0]
    listed = set(re.findall(r"'([a-z_]+)'", re.search(
        r"catalog_functions CONSTANT text\[\] := ARRAY\[(.*?)\];", pre, re.S).group(1)))
    assert set(CALLS) <= listed
    operators = set(re.findall(r"'([^']+)'", re.search(
        r"catalog_operators CONSTANT text\[\] := ARRAY\[(.*?)\];", pre, re.S).group(1)))
    blocks = _do_blocks(CODE)
    assert len(blocks) == 2   # precondition, postcondition
    for block in blocks:
        bare = _without_strings(block)
        assert set(re.findall(r"pg_catalog\.([a-z_]+)\(", bare)) <= listed
        for name in listed:
            assert not re.search(rf"(?<![\w.]){name}\(", bare), name
        used = set(re.findall(r"OPERATOR\(pg_catalog\.([^)]+)\)", bare))
        assert used <= operators, used
        rest = re.sub(r"OPERATOR\(pg_catalog\.[^)]+\)", " ", bare).replace(":=", " ")
        assert not re.search(r"[=<>~|@!]|->", rest), re.findall(r".{20}[=<>~|@!].{20}", rest)


def test_preconditions_come_first_and_cover_ledger_objects_and_shadowing():
    pre = _do_blocks(CODE)[0]
    assert CODE.index(pre) < CODE.index("CREATE OR REPLACE FUNCTION")
    for marker in ("migration_366_prerequisite_missing: no ledger row",
                   "migration_366_prerequisite_missing: objects", "catalog_name_shadowed_in_public"):
        assert marker in pre, marker
    for name in (NAME_326, NAME_331, NAME_365):
        assert f"'{name}'" in pre, name
    assert "p.pronamespace OPERATOR(pg_catalog.=) 'public'::regnamespace" in pre
    assert "o.oprnamespace OPERATOR(pg_catalog.=) 'public'::regnamespace" in pre
    for sig in SIGS:
        assert f"'public.{sig}'" in pre, sig


def test_postconditions_cover_path_body_mode_owner_acl_and_triggers():
    post = _do_blocks(CODE)[-1]
    assert CODE.index(post) > CODE.rindex("CREATE OR REPLACE FUNCTION") and CODE.index(post) > CODE.index(ALTER)
    for marker in ("student_archive_search_path_wrong", "student_archive_trigger_missing"):
        assert f"RAISE EXCEPTION '{marker}" in post, marker
    assert "'search_path=pg_catalog, pg_temp'" in post and "|".join(CALLS) in post
    assert "|".join(TABLES) in post
    for sig in SIGS:
        assert f"'public.{sig}'" in post, sig
    for table, trigger in TRIGGERS:
        assert f"'public.{table}', '{trigger}'" in post, trigger
    assert "NOT p.prosecdef" in post and "p.proowner OPERATOR(pg_catalog.<>) c.relowner" in post
    for role in ("anon", "authenticated"):
        assert f"has_function_privilege('{role}', p.oid, 'EXECUTE')" in post
    assert "(f.service_exec AND NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'))" in post


def test_header_documents_scope_order_and_rollback():
    header = SQL[:SQL.index("\nBEGIN;\n")]
    for needle in ("SA-2209", "never edited", "364 is held by PC-J544", "365 by PC-J603", *RECREATED, GUARD,
                   "MIGRATION_FEATURES=admin_aal2", "after 365", "re-run 366", f"rollback/{NAME}",
                   "grants nothing", "grants and revokes nothing", "catalog_name_shadowed_in_public",
                   "333, 337, 339 and 340", "pg_temp"):
        assert needle in header, needle


def test_rollback_restores_the_326_bodies_and_331_path_verbatim_and_grants_nothing():
    code = m326._strip_comments(ROLLBACK)
    for name in RECREATED:
        assert m326._function(m326.SQL, name) in ROLLBACK, name
    assert f"ALTER FUNCTION public.{GUARD}() SET search_path = public, pg_temp;" in code
    assert "REOPENS SA-2209" in ROLLBACK and "catalog_name_shadowed_in_public" in code
    shadow_check = _do_blocks(code)[0]
    for name in CALLS:
        assert f"'{name}'" in shadow_check, name
    assert code.count("BEGIN;") == 1 and code.strip().endswith("COMMIT;")
    assert not re.search(r"\bGRANT\b|\bREVOKE\b|\bDROP\b|OWNER\s+TO", code)
    assert len(re.findall(r"\bALTER\b", code)) == 1


def test_release_metadata_holds_366_behind_the_admin_aal2_group_with_365():
    policy = (MIGRATIONS / "forward-policy.tsv").read_text(encoding="utf-8")
    rows = {line.split("\t")[0]: line.split("\t") for line in policy.splitlines()
            if line and not line.startswith("#")}
    assert len(rows[NAME]) == 4 and rows[NAME][1:3] == ["pending_feature", "admin_aal2"]
    assert rows[NAME_365][1:3] == ["pending_feature", "admin_aal2"]
    assert not any(name.startswith("364_") for name in rows)
    readme = (MIGRATIONS / "README.md").read_text(encoding="utf-8")
    paragraph = readme[readme.index("Migration `366`"):readme.index("Migration `367`")]
    for needle in ("SA-2209", "MIGRATION_FEATURES=admin_aal2", "after SA review", "363 → 365 → 366",
                   "migration_366_prerequisite_missing", "catalog_name_shadowed_in_public", "re-run 366",
                   *RECREATED, GUARD, "grants nothing", "pg_temp"):
        assert needle in paragraph, needle
    assert "`364` is held by PC-J544" in readme


# ── PostgreSQL harness ──────────────────────────────────────────────────────

def _migrated(schema: str, sql: str = SQL) -> str:
    return m331._schema_sql(sql, schema)


def _postcondition_sql(schema: str) -> str:
    return _migrated(schema, SQL[SQL.rindex("DO $$"):SQL.rindex("COMMIT;")])


def _rollback_sql(schema: str) -> str:
    return _migrated(schema, ROLLBACK)


def _apply(schema: str) -> None:
    _owner(_migrated(schema))


def _drop(schema: str | None) -> None:
    if schema:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


def _hand_to_owner(schema: str) -> None:
    """The 326/331 harness builds as the cluster superuser; on Supabase the
    NOSUPERUSER postgres role owns the schema, tables and functions."""
    psql(f"""DO $$
    DECLARE r record;
    BEGIN
        EXECUTE format('ALTER SCHEMA %I OWNER TO {OWNER}', '{schema}');
        FOR r IN SELECT c.oid::regclass AS rel FROM pg_class c
                  WHERE c.relnamespace = '{schema}'::regnamespace AND c.relkind IN ('r', 'p') LOOP
            EXECUTE format('ALTER TABLE %s OWNER TO {OWNER}', r.rel);
        END LOOP;
        FOR r IN SELECT p.oid::regprocedure AS fn FROM pg_proc p
                  WHERE p.pronamespace = '{schema}'::regnamespace LOOP
            EXECUTE format('ALTER ROUTINE %s OWNER TO {OWNER}', r.fn);
        END LOOP;
    END $$;""")


def _record(schema: str, *names: str) -> None:
    for name in names:
        m361._record(schema, name)


def _schema(prefix: str, *, with_366: bool = True, guard: bool = True,
            ledger: tuple[str, ...] = (NAME_326, NAME_331, NAME_365)) -> str:
    """326 and 331 applied (331 optional), owned by the NOSUPERUSER owner,
    ``ledger`` recorded: staging after 365."""
    m332._require_pg()
    m331._require_pg()
    schema = prefix + uuid4().hex
    try:
        m331._build(schema, guard=guard)
        _hand_to_owner(schema)
        if ledger:
            _record(schema, *ledger)
        if with_366:
            _apply(schema)
    except BaseException:
        _drop(schema)
        raise
    return schema


@pytest.fixture(scope="module")
def db():
    schema = None
    try:
        schema = _schema("pa366_")
        _apply(schema)   # re-applying is a no-op
        yield schema
    finally:
        _drop(schema)


@pytest.fixture
def fresh():
    schema = None
    try:
        schema = _schema("pa366_fresh_")
        yield schema
    finally:
        _drop(schema)


@pytest.fixture
def only_331():
    """326, 331 and 365 recorded, 366 not yet: the staging state before 366."""
    schema = None
    try:
        schema = _schema("pa366_pre_", with_366=False)
        yield schema
    finally:
        _drop(schema)


# Exact typed overloads of the polymorphic catalog functions the bodies call:
# each beats pg_catalog's anyelement / anyarray / anynonarray version, leaves a
# NOTICE with the role it runs as and returns what the catalog would, so the
# rows stay identical. now() and count(*) have exact pg_catalog signatures,
# which pg_catalog (searched first) always wins.
_SHADOWS = {
    "to_jsonb": ("to_jsonb(uuid[]) RETURNS jsonb", "RETURN pg_catalog.to_jsonb($1);"),
    "unnest": ("unnest(uuid[]) RETURNS SETOF uuid", "RETURN QUERY SELECT pg_catalog.unnest($1);"),
    "array_to_string": ("array_to_string(uuid[], text) RETURNS text",
                        "RETURN pg_catalog.array_to_string($1, $2);"),
}


def _plant_shadows(s: str) -> None:
    """service_role, given CREATE on the schema as on staging before 357,
    plants typed overloads and an array_agg(uuid) aggregate."""
    _owner(f"GRANT CREATE ON SCHEMA {s} TO service_role")
    sql = "".join(
        f"CREATE FUNCTION {s}.{head} LANGUAGE plpgsql AS $$ BEGIN "
        f"RAISE NOTICE 'attacker_called {tag} %', current_user; {ret} END $$; "
        for tag, (head, ret) in _SHADOWS.items())
    sql += (f"CREATE FUNCTION {s}.pa366_acc(uuid[], uuid) RETURNS uuid[] LANGUAGE plpgsql AS $$ BEGIN "
            f"RAISE NOTICE 'attacker_called array_agg %', current_user; "
            f"RETURN pg_catalog.array_append($1, $2); END $$; "
            f"CREATE AGGREGATE {s}.array_agg(uuid) (SFUNC = {s}.pa366_acc, STYPE = uuid[]);")
    _svc(sql)
    assert psql(f"SELECT count(*) FROM pg_proc WHERE pronamespace = '{s}'::regnamespace "
                f"AND proname IN ('to_jsonb', 'unnest', 'array_to_string', 'array_agg') "
                f"AND pg_get_userbyid(proowner) = 'service_role'") == "4"


def _drop_shadows(s: str) -> None:
    psql(f"DROP AGGREGATE {s}.array_agg(uuid); DROP FUNCTION {s}.pa366_acc(uuid[], uuid), "
         + ", ".join(f"{s}.{head.split(' RETURNS')[0]}" for head, _ in _SHADOWS.values()))


# Fixed ids: every schema gets the same rows, so the rows compare directly.
IDS = {key: str(uuid4()) for key in ("admin", "ua", "ub", "a", "b", "c1", "c2", "c3")}


def _scenario(s: str) -> list[str]:
    """Every function 366 changes, called the way the backend calls them
    (service_role RPCs, the legacy cohort_id write, Writing gives): adds,
    a bulk add, the archive (twice), refusals of every writer for the archived
    learner, and the same writes for an active learner. Returns the psql
    outputs, NOTICEs included."""
    i = IDS
    outputs = []

    def run(sql: str, *, role: str = "service_role", error: str | None = None) -> None:
        rc, out = _psql_all(m326._svc(sql) if role == "service_role" else sql)
        assert (rc == 0) if error is None else (rc != 0 and error in out), out
        outputs.append(out)

    run(f"INSERT INTO {s}.users (id, email, role, is_active) VALUES ('{i['admin']}', 'admin@q366.test', 'admin', true),"
        f" ('{i['ua']}', 'a@q366.test', 'user', true), ('{i['ub']}', 'b@q366.test', 'user', true);"
        f"INSERT INTO {s}.cohorts (id, name) VALUES ('{i['c1']}', 'c1'), ('{i['c2']}', 'c2'), ('{i['c3']}', 'c3');"
        f"INSERT INTO {s}.students (id, student_code, full_name, user_id, cohort_id) VALUES "
        f"('{i['a']}', 'Q366-A', 'A', '{i['ua']}', '{i['c1']}'), ('{i['b']}', 'Q366-B', 'B', '{i['ub']}', NULL)",
        role="owner")
    arr = f"ARRAY['{i['b']}', '{i['a']}']::uuid[]"
    run(f"SELECT {s}.fn_add_student_cohort_membership('{i['a']}', '{i['c2']}', '{i['admin']}')")
    run(f"SELECT {s}.fn_add_students_cohort_membership({arr}, '{i['c3']}', '{i['admin']}')")
    run(f"SELECT {s}.fn_archive_student('{i['a']}', '{i['admin']}', 'left q366', true)")
    run(f"SELECT {s}.fn_archive_student('{i['a']}', '{i['admin']}', 'again', false)")
    run(f"SELECT {s}.fn_add_students_cohort_membership({arr}, '{i['c2']}', NULL)", error="student_archived")
    run(f"SELECT {s}.fn_add_student_cohort_membership('{i['a']}', '{i['c1']}', NULL)", error="student_archived")
    run(f"UPDATE {s}.students SET cohort_id = '{i['c1']}' WHERE id = '{i['a']}'", error="student_archived")
    run(m331._insert(s, [i["a"]], i["c1"]), error="student_archived")
    run(m331._insert(s, [i["b"]], i["c1"]))
    run(f"UPDATE {s}.students SET cohort_id = '{i['c2']}' WHERE id = '{i['b']}'")
    return outputs


def _rows(s: str) -> list:
    detail = psql(f"SELECT json_agg(json_build_object('action', action, 'actor', actor_user_id, 'reason', reason,"
                  f" 'detail', detail) ORDER BY created_at, id) FROM {s}.student_lifecycle_audit")
    audit = json.loads(detail)
    for row in audit:
        row["detail"]["ended_cohort_ids"] = sorted(row["detail"].get("ended_cohort_ids") or [])
    return [
        psql(f"SELECT string_agg(student_id || ':' || cohort_id || ':' || is_active || ':' || (left_at IS NULL)"
             f" || ':' || COALESCE(added_by::text, '-'), ',' ORDER BY student_id, cohort_id)"
             f" FROM {s}.student_cohort_memberships"),
        psql(f"SELECT string_agg(id || ':' || COALESCE(cohort_id::text, '-') || ':' || (archived_at IS NOT NULL)"
             f" || ':' || COALESCE(archived_by::text, '-') || ':' || COALESCE(archive_reason, '-'), ','"
             f" ORDER BY id) FROM {s}.students"),
        psql(f"SELECT string_agg(id || ':' || is_active, ',' ORDER BY id) FROM {s}.users"),
        psql(f"SELECT string_agg(student_id::text, ',' ORDER BY student_id) FROM {s}.writing_assignments"),
        audit,
    ]


def _facts(s: str) -> list[str]:
    return [psql(f"SELECT prosecdef::text || '|' || pg_get_userbyid(proowner) || '|' || "
                 f"COALESCE(proacl::text, '-') FROM pg_proc WHERE oid = '{s}.{sig}'::regprocedure")
            for sig in SIGS]


def _prosrc(s: str, sig: str) -> str:
    return psql(f"SELECT prosrc FROM pg_proc WHERE oid = '{s}.{sig}'::regprocedure")


def _unpinned(s: str) -> None:
    for sig in SIGS:
        assert _proconfig(s, sig) == f"search_path={s}, pg_temp", sig


# ── PostgreSQL: SA-2209 ─────────────────────────────────────────────────────

def test_harness_is_owned_by_the_nosuperuser_owner(db):
    m332._require_pg()
    assert psql(f"SELECT count(*) FROM pg_roles WHERE rolname IN "
                f"('anon', 'authenticated', 'service_role', '{OWNER}') AND NOT rolsuper") == "4"
    assert psql(f"SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = '{db}'") == OWNER
    assert psql(f"SELECT count(*) FROM pg_proc WHERE pronamespace = '{db}'::regnamespace "
                f"AND pg_get_userbyid(proowner) <> '{OWNER}'") == "0"
    assert psql(f"SELECT count(*) FROM pg_class WHERE relnamespace = '{db}'::regnamespace "
                f"AND relkind IN ('r', 'p') AND pg_get_userbyid(relowner) <> '{OWNER}'") == "0"


def test_negative_control_before_366_runs_planted_overloads_as_the_owner(only_331):
    """SA-2209 on the 331 schema (red before 366): service_role plants the
    overloads and calls the archive and bulk-add RPCs, which run them as the
    owner."""
    s = only_331
    _plant_shadows(s)
    out = "\n".join(_scenario(s))
    for tag in ("to_jsonb", "array_agg", "unnest", "array_to_string"):
        assert f"attacker_called {tag} {OWNER}" in out, (tag, out)


def test_planted_overloads_never_run_after_366_and_rows_match(only_331, fresh):
    """The same scenario writes the same memberships, archive state, account
    flags, gives and audit rows on a clean pre-366 schema and on a 366 schema
    with every shadow planted, and no planted function runs."""
    reference = _scenario(only_331)
    assert "attacker_called" not in "\n".join(reference)
    expected = _rows(only_331)
    assert [row["action"] for row in expected[-1]] == ["archive"]
    assert expected[-1][0]["detail"]["ended_cohort_ids"] == sorted([IDS["c1"], IDS["c2"], IDS["c3"]])
    assert expected[3] == IDS["b"]
    _plant_shadows(fresh)
    out = "\n".join(_scenario(fresh))
    assert "attacker_called" not in out, out
    assert _rows(fresh) == expected


def test_pg_temp_tables_are_never_read_after_366(fresh):
    """With public off the path an unqualified table would resolve to pg_temp:
    a service_role session with temp tables of every name the bodies use
    still writes the real tables."""
    s, i = fresh, IDS
    _scenario(s)
    student, cohort = str(uuid4()), str(uuid4())
    psql(f"INSERT INTO {s}.students (id, student_code, full_name) VALUES ('{student}', 'Q366-T', 'T');"
         f"INSERT INTO {s}.cohorts (id, name) VALUES ('{cohort}', 'ct')")
    temp = "".join(f"CREATE TEMP TABLE {name} (LIKE {s}.{name} INCLUDING DEFAULTS); " for name in TABLES)
    rc, out = _psql_all(m326._svc(
        f"{temp} INSERT INTO pg_temp.students (id, student_code, full_name, archived_at) "
        f"VALUES ('{student}', 'x', 'x', now()); "
        f"SELECT {s}.fn_add_student_cohort_membership('{student}', '{cohort}', NULL); "
        f"SELECT {s}.fn_add_students_cohort_membership(ARRAY['{student}']::uuid[], '{i['c3']}', NULL); "
        f"UPDATE {s}.students SET cohort_id = '{i['c1']}' WHERE id = '{student}'; "
        f"SELECT {s}.fn_archive_student('{student}', '{i['admin']}', 'tmp', false); "
        f"SELECT (SELECT count(*) FROM pg_temp.student_cohort_memberships) || ':' || "
        f"(SELECT count(*) FROM pg_temp.student_lifecycle_audit)"))
    assert rc == 0, out
    assert out.strip().splitlines()[-1] == "0:0"
    assert psql(f"SELECT string_agg(cohort_id || ':' || is_active, ',' ORDER BY cohort_id) "
                f"FROM {s}.student_cohort_memberships WHERE student_id = '{student}'") == ",".join(
        f"{c}:false" for c in sorted([cohort, i["c3"], i["c1"]]))
    assert psql(f"SELECT count(*) FROM {s}.student_lifecycle_audit WHERE student_id = '{student}'") == "1"


def test_catalog_before_after_changes_only_the_path_and_qualification(only_331, db):
    """Owner, security mode and ACL of the five functions are identical; every
    other function, trigger and relation ACL of the schema is untouched; the
    live bodies differ only by pg_catalog./public. qualification and
    whitespace, and the guard's body is byte-identical."""
    assert _facts(db) == _facts(only_331)
    for sig, fact in zip(SIGS, _facts(db)):
        assert fact.startswith(f"true|{OWNER}|"), (sig, fact)
        assert _proconfig(only_331, sig) == f"search_path={only_331}, pg_temp"
        assert _proconfig(db, sig) == "search_path=pg_catalog, pg_temp"
        for role in ("anon", "authenticated"):
            assert psql(f"SELECT has_function_privilege('{role}', '{db}.{sig}', 'EXECUTE')") == "f"
        assert psql(f"SELECT has_function_privilege('service_role', '{db}.{sig}', 'EXECUTE')") == psql(
            f"SELECT has_function_privilege('service_role', '{only_331}.{sig}', 'EXECUTE')"), sig
        before, after = _prosrc(only_331, sig).replace(f"{only_331}.", ""), _prosrc(db, sig).replace(f"{db}.", "")
        assert _squash(after.replace("pg_catalog.", "")) == _squash(before), sig
        assert (before == after) is (sig == GUARD_SIG), sig
    for sig in RPC_SIGS:
        assert psql(f"SELECT has_function_privilege('service_role', '{db}.{sig}', 'EXECUTE')") == "t", sig
    changed = {f"fn S.{sig.split('(')[0]}(" for sig in SIGS}
    keep = [line for line in _catalog(db, oids=False) if not any(line.startswith(c) for c in changed)]
    assert keep == [line for line in _catalog(only_331, oids=False)
                    if not any(line.startswith(c) for c in changed)]
    assert len(_catalog(db, oids=False)) == len(_catalog(only_331, oids=False))


# ── PostgreSQL: release path and idempotency ────────────────────────────────

def test_staging_path_applies_on_top_of_365_with_history_and_reruns_as_a_no_op(only_331):
    s = only_331
    _scenario(s)
    history = _rows(s)
    _apply(s)
    assert _rows(s) == history
    _owner(_postcondition_sql(s))
    snapshot = _catalog(s, oids=True)
    _apply(s)
    assert _catalog(s, oids=True) == snapshot, "second run must change nothing"


@pytest.mark.parametrize("rerun,changed", [
    ("326", [sig for sig, _ in RECREATED.values()]),
    ("331", [GUARD_SIG]),
])
def test_rerunning_326_or_331_is_caught_and_366_restores_the_pin(fresh, rerun, changed):
    s = fresh
    _owner(m326._migrated(s) if rerun == "326" else m331._migrated(s))
    for sig in SIGS:
        assert (_proconfig(s, sig) == "search_path=pg_catalog, pg_temp") is (sig not in changed), sig
    error = _fails(_owner, _postcondition_sql(s))
    assert "student_archive_search_path_wrong" in error, error
    for sig in changed:
        assert sig.split("(")[0] in error, (sig, error)
    _apply(s)
    _owner(_postcondition_sql(s))


def test_331_reruns_on_top_of_366_and_its_precondition_still_finds_the_lock(fresh):
    """331's precondition reads fn_archive_student's FOR UPDATE: it still
    passes on the 366 body, and 366 re-pins the guard afterwards."""
    s = fresh
    _owner(m331._migrated(s))
    _apply(s)
    _owner(_postcondition_sql(s))


# ── PostgreSQL: preconditions ───────────────────────────────────────────────

@pytest.mark.parametrize("state,marker", [
    ("no_ledger", "migration_366_prerequisite_missing: no ledger row"),
    ("326_not_recorded", "migration_366_prerequisite_missing: no ledger row"),
    ("331_not_recorded", "migration_366_prerequisite_missing: no ledger row"),
    ("365_not_recorded", "migration_366_prerequisite_missing: no ledger row"),
    ("331_recorded_not_applied", "migration_366_prerequisite_missing: objects"),
])
def test_precondition_requires_326_331_365_recorded_and_applied(state, marker):
    ledger = {"no_ledger": (), "326_not_recorded": (NAME_331, NAME_365),
              "331_not_recorded": (NAME_326, NAME_365), "365_not_recorded": (NAME_326, NAME_331),
              "331_recorded_not_applied": (NAME_326, NAME_331, NAME_365)}[state]
    schema = None
    try:
        schema = _schema("pa366_noprereq_", with_366=False, ledger=ledger,
                         guard=state != "331_recorded_not_applied")
        assert marker in _fails(_owner, _migrated(schema))
        for sig in SIGS[:-1] if state == "331_recorded_not_applied" else SIGS:
            assert _proconfig(schema, sig) == f"search_path={schema}, pg_temp", sig
    finally:
        _drop(schema)


@pytest.mark.parametrize("path", ["{s}", "{s}, pg_catalog", "pg_catalog, pg_temp"])
def test_precondition_refuses_a_planted_shadow_without_running_it(only_331, path):
    s = only_331
    _plant_shadows(s)
    rc, out = _psql_all(f"SET ROLE {OWNER}; SET search_path = {path.format(s=s)}; {_migrated(s)}")
    assert rc != 0 and ("catalog_name_shadowed_in_public: function array_agg, function array_to_string, "
                        "function to_jsonb, function unnest") in out, out
    assert "attacker_called" not in out, out
    _unpinned(s)


@pytest.mark.parametrize("op,left,right", [("=", "name", "text"), ("<>", "integer", "integer"),
                                           ("~*", "text", "text")])
def test_precondition_refuses_a_planted_operator(only_331, op, left, right):
    s = only_331
    _owner(f"GRANT CREATE ON SCHEMA {s} TO service_role")
    _svc(f"CREATE FUNCTION {s}.pa366_op({left}, {right}) RETURNS boolean LANGUAGE sql AS 'SELECT true'; "
         f"CREATE OPERATOR {s}.{op} (LEFTARG = {left}, RIGHTARG = {right}, FUNCTION = {s}.pa366_op);")
    assert f"catalog_name_shadowed_in_public: operator {op}" in _fails(_owner, _migrated(s))
    _unpinned(s)


# ── PostgreSQL: postconditions ──────────────────────────────────────────────

# (tamper, None if re-applying 366 repairs it else the operator's fix, marker)
_DRIFT = [
    *[(f"ALTER FUNCTION {{s}}.{sig} {change}", None, "student_archive_search_path_wrong")
      for sig in SIGS for change in ("SET search_path = public, pg_temp",
                                     "SET search_path = pg_catalog, public, pg_temp", "RESET search_path")],
    # 366 only ALTERs the guard's path: it never makes it a definer again.
    *[(f"ALTER FUNCTION {{s}}.{sig} SECURITY INVOKER",
       f"ALTER FUNCTION {{s}}.{sig} SECURITY DEFINER" if sig == GUARD_SIG else None,
       "student_archive_search_path_wrong") for sig in SIGS],
    # 366 grants and revokes nothing: a client grant or a lost service_role
    # grant fails the release until an operator fixes it.
    *[(f"GRANT EXECUTE ON FUNCTION {{s}}.{sig} TO {role}", f"REVOKE EXECUTE ON FUNCTION {{s}}.{sig} FROM {role}",
       "student_archive_search_path_wrong")
      for sig in SIGS for role in ("PUBLIC", "anon", "authenticated")],
    *[(f"REVOKE EXECUTE ON FUNCTION {{s}}.{sig} FROM service_role",
       f"GRANT EXECUTE ON FUNCTION {{s}}.{sig} TO service_role", "student_archive_search_path_wrong")
      for sig in RPC_SIGS],
    *[(f"ALTER TABLE {{s}}.{table} {mode} TRIGGER {trigger}", f"ALTER TABLE {{s}}.{table} ENABLE TRIGGER {trigger}",
       "student_archive_trigger_missing")
      for table, trigger in TRIGGERS for mode in ("DISABLE", "ENABLE REPLICA")],
]


@pytest.mark.parametrize("tamper,revert,marker", _DRIFT)
def test_postcondition_aborts_on_drift(fresh, tamper, revert, marker):
    s = fresh
    _owner(_postcondition_sql(s))   # clean state passes
    _owner(tamper.format(s=s))
    assert marker in _fails(_owner, _postcondition_sql(s))
    if revert is None:
        _apply(s)
    else:
        assert marker in _fails(_owner, _migrated(s))   # the release fails until an operator fixes it
        _owner(revert.format(s=s))
    _owner(_postcondition_sql(s))


def _partly_qualified(name: str, *, tables: bool) -> str:
    """The 326 body under the pinned path with the calls left bare, or with the
    calls qualified and the tables left bare."""
    fn = m326._function(m326.SQL, name).replace("SET search_path = public, pg_temp", PINNED)
    if tables:
        for call in CALLS:
            fn = re.sub(rf"(?<![\w.]){call}\(", f"pg_catalog.{call}(", fn)
    return fn


@pytest.mark.parametrize("name,tables", [
    *[(name, False) for name in RECREATED],
    # fn_archive_student already names public.<table> everywhere.
    *[(name, True) for name in RECREATED if name != "fn_archive_student"],
])
def test_postcondition_refuses_an_unqualified_call_or_table_under_the_pinned_path(fresh, name, tables):
    s = fresh
    body = _partly_qualified(name, tables=tables)
    if tables:
        assert _unqualified_calls(body) == [] and _unqualified_tables(body) != [], name
    else:
        assert _unqualified_calls(body) != [], name
    _owner(_migrated(s, body))
    error = _fails(_owner, _postcondition_sql(s))
    assert "student_archive_search_path_wrong" in error and name in error, error
    _apply(s)
    _owner(_postcondition_sql(s))


@pytest.mark.parametrize("sig", [RECREATED["fn_archive_student"][0], GUARD_SIG])
def test_postcondition_refuses_a_definer_that_does_not_own_its_table(fresh, sig):
    s = fresh
    psql("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pa366_other') THEN "
         "CREATE ROLE pa366_other NOSUPERUSER NOLOGIN; END IF; END $$;")
    acl = psql(f"SELECT proacl::text FROM pg_proc WHERE oid = '{s}.{sig}'::regprocedure")
    psql(f"ALTER FUNCTION {s}.{sig} OWNER TO pa366_other")
    try:
        error = _fails(psql, _postcondition_sql(s))
        assert "student_archive_search_path_wrong" in error and sig.split("(")[0] in error, error
    finally:
        psql(f"ALTER FUNCTION {s}.{sig} OWNER TO {OWNER}; REVOKE ALL ON FUNCTION {s}.{sig} FROM pa366_other")
    assert psql(f"SELECT proacl::text FROM pg_proc WHERE oid = '{s}.{sig}'::regprocedure") == acl
    _owner(_postcondition_sql(s))


def test_postcondition_ignores_planted_overloads_and_operators(fresh):
    """A shadow planted after 366 never runs in its checks, on any path."""
    s = fresh
    _plant_shadows(s)
    _svc(f"CREATE FUNCTION {s}.pa366_ne(oid, oid) RETURNS boolean LANGUAGE plpgsql AS $$ "
         f"BEGIN RAISE NOTICE 'attacker_called ne %', current_user; RETURN false; END $$; "
         f"CREATE OPERATOR {s}.<> (LEFTARG = oid, RIGHTARG = oid, FUNCTION = {s}.pa366_ne);")
    _owner(f"ALTER FUNCTION {s}.{RPC_SIGS[0]} SET search_path = public, pg_temp")
    for path in (f"{s}", f"{s}, pg_catalog"):
        rc, out = _psql_all(f"SET ROLE {OWNER}; SET search_path = {path}; {_postcondition_sql(s)}")
        assert rc != 0 and "student_archive_search_path_wrong" in out, out
        assert "attacker_called" not in out, out


# ── PostgreSQL: rollback ────────────────────────────────────────────────────

def test_rollback_restores_the_pre_366_catalog_reopens_sa_2209_and_366_reapplies(fresh, only_331):
    s = fresh
    _owner(_rollback_sql(s))
    assert _catalog(s, oids=False) == _catalog(only_331, oids=False)
    assert _facts(s) == _facts(only_331)
    _unpinned(s)
    _plant_shadows(s)   # negative control: the hole is open again
    assert f"attacker_called to_jsonb {OWNER}" in "\n".join(_scenario(s))
    _drop_shadows(s)
    _apply(s)
    _owner(_postcondition_sql(s))


def test_rollback_refuses_while_a_shadow_is_planted(fresh):
    s = fresh
    _plant_shadows(s)
    rc, out = _psql_all(f"SET ROLE {OWNER}; {_rollback_sql(s)}")
    assert rc != 0 and "catalog_name_shadowed_in_public: array_agg, array_to_string, to_jsonb, unnest" in out, out
    for sig in SIGS:
        assert _proconfig(s, sig) == "search_path=pg_catalog, pg_temp"


# ── PostgreSQL: the 326 and 331 suites on the 366 schema ────────────────────

# The excluded tests drive the 326 or 331 file itself (re-running it puts the
# public path back on purpose; test_rerunning_326_or_331_is_caught_and_366_
# restores_the_pin covers that) or pin search_path=public, pg_temp on the
# functions 366 pins (331's catalog test; this suite's catalog and
# postcondition tests check those functions instead). Every excluded test
# still passes in its own suite on its own schema. All other tests that take
# only db run unchanged here, on the NOSUPERUSER-owned 366 schema.
_NOT_RERUN = {
    m326: {"test_rerun_aborts_on_conflicting_column_or_missing_320_guard",
           "test_rerun_aborts_when_clients_can_update_students",
           "test_rollback_guard_aborts_with_archived_learners_or_audit_rows"},
    m331: {"test_catalog_after_apply",
           "test_preconditions_abort_when_a_lifecycle_function_does_not_lock_for_update",
           "test_rerun_re_enables_a_disabled_guard_and_aborts_on_client_students_update"},
}


def _rerun(module, prefix: str) -> None:
    for name, fn in inspect.getmembers(module, inspect.isfunction):
        params = set(inspect.signature(fn).parameters)
        if (name.startswith("test_") and fn.__module__ == module.__name__
                and "db" in params and not params & {"bare", "unguarded"}
                and name not in _NOT_RERUN.get(module, set())):
            globals()[f"test_{prefix}_{name[5:]}"] = fn


_rerun(m326, "rerun326")
_rerun(m331, "rerun331")
