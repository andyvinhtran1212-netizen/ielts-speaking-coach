"""Migration 367 (PC-J612): search_path pin on the 22 333 SECURITY DEFINERs.

SA-2209 (residual P2): the 22 SECURITY DEFINER functions 333 created and 340
left unchanged (11 RPCs with EXECUTE for service_role, 11 internal helpers
including the responses trigger fn_ai_session_generation_bump) ran as their
owner with search_path = public, pg_temp. A role with CREATE on public could
plant an exact typed overload (to_jsonb(ai_deferred_grading_jobs),
array_agg(uuid), cardinality(uuid[]), unnest(uuid[]), format(text x5),
jsonb_populate_record(sessions, jsonb)) that beats the catalog's polymorphic
version and runs as the owner, through RPCs that same role may call.

The static half compares the 18 recreated bodies with the 333 bodies they
replace, checks the four ALTERs and that the DO blocks qualify every function
and operator. The PostgreSQL half builds the 333 harness (333 + 340 on the
NOSUPERUSER owner the hosted runner uses), records 333 and 340, applies 367
(twice) and proves: the repro before 367 (red), the same planted overloads
never running after 367 with identical rows, pg_temp tables never read,
catalog before/after, the hot path not slower, the precondition and
postcondition aborts, re-runs of 333/340, the rollback, and the 333 and 340
behaviour suites re-run on the 367 schema.

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

import inspect
import json
import os
import re
import subprocess
from pathlib import Path
from uuid import uuid4

import pytest

import test_migration_240_core_attempt_evidence as m240
import test_migration_326_student_archive as m326
import test_migration_333_ai_budget as m333
import test_migration_340_ai_budget_hardening as m340
import test_migration_361_staff_privilege_evidence_commit_guard as m361
import test_migration_363_users_privilege_audit_search_path as m363
from test_migration_240_core_attempt_evidence import psql

BACKEND = Path(__file__).resolve().parents[1]
MIGRATIONS = BACKEND / "migrations"
NAME = "367_ai_budget_definer_search_path.sql"
SQL = (MIGRATIONS / NAME).read_text(encoding="utf-8")
CODE = m326._strip_comments(SQL)
ROLLBACK = (MIGRATIONS / "rollback" / NAME).read_text(encoding="utf-8")
NAME_333, NAME_340 = m333.NAME, m340.NAME
OWNER = m333.OWNER
PINNED = "SET search_path = pg_catalog, pg_temp"
CALLS = ("array_agg", "btrim", "cardinality", "char_length", "convert_to", "date_trunc", "encode", "format",
         "gen_random_uuid", "jsonb_agg", "jsonb_array_length", "jsonb_build_array", "jsonb_build_object",
         "jsonb_object_keys", "jsonb_populate_record", "jsonb_typeof", "make_interval", "now", "quote_ident",
         "sha256", "string_agg", "sum", "to_jsonb", "unnest")
TABLES = ("ai_budget_alerts", "ai_budget_counters", "ai_budget_raise_events", "ai_budget_raises",
          "ai_budget_reservations", "ai_deferred_grading_jobs", "ai_deferred_session_refresh",
          "class_assignment_items", "responses", "sessions", "writing_essays", "writing_feedback", "writing_jobs")
# Recreated with a qualified body: name -> (signature, EXECUTE for service_role).
RECREATED = {
    "fn_ai_budget_active_raise": ("fn_ai_budget_active_raise(text)", False),
    "fn_ai_response_revision": ("fn_ai_response_revision(uuid,text)", False),
    "fn_ai_patch_row": ("fn_ai_patch_row(text,uuid,jsonb,text[])", False),
    "fn_ai_insert_row": ("fn_ai_insert_row(text,jsonb,text[])", False),
    "fn_ai_budget_release": ("fn_ai_budget_release(uuid)", True),
    "fn_ai_budget_expire": ("fn_ai_budget_expire(timestamptz)", True),
    "fn_ai_budget_close_scope": ("fn_ai_budget_close_scope(text,date,text)", True),
    "fn_ai_budget_recompute": ("fn_ai_budget_recompute(date)", False),
    "fn_ai_deferred_save": ("fn_ai_deferred_save(jsonb,jsonb)", True),
    "fn_ai_deferred_claim": ("fn_ai_deferred_claim(integer,integer)", True),
    "fn_ai_deferred_claim_writing": ("fn_ai_deferred_claim_writing(integer,integer)", True),
    "fn_ai_deferred_aggregate_write": ("fn_ai_deferred_aggregate_write(uuid,bigint,jsonb)", True),
    "fn_ai_session_bands_write": ("fn_ai_session_bands_write(uuid,bigint,jsonb,boolean,boolean)", True),
    "fn_ai_class_sync": ("fn_ai_class_sync(uuid)", True),
    "fn_ai_budget_raise_record_end": ("fn_ai_budget_raise_record_end(uuid,text,uuid,text,text,text)", False),
    "fn_ai_budget_raise_end": ("fn_ai_budget_raise_end(uuid,uuid,text,text,text)", True),
    "fn_ai_budget_raise_expire_sweep": ("fn_ai_budget_raise_expire_sweep(timestamptz)", True),
    "fn_ai_session_generation_bump": ("fn_ai_session_generation_bump()", False),
}
# Only the path changes: they call no catalog function and name only public. objects.
ALTERED = {
    "fn_ai_budget_thresholds": ("fn_ai_budget_thresholds(text,text)", "text, text"),
    "fn_ai_budget_lock_counter": ("fn_ai_budget_lock_counter(text,text,date)", "text, text, date"),
    "fn_ai_budget_alert_crossings": ("fn_ai_budget_alert_crossings(text,text,date)", "text, text, date"),
    "fn_ai_budget_ensure_refresh": ("fn_ai_budget_ensure_refresh(uuid)", "uuid"),
}
ALTERS = [f"ALTER FUNCTION public.{name}({args}) SET search_path = pg_catalog, pg_temp;"
          for name, (_sig, args) in ALTERED.items()]
SIGS = [sig for sig, _ in RECREATED.values()] + [sig for sig, _ in ALTERED.values()]
RPC_SIGS = [sig for sig, service in RECREATED.values() if service]
INTERNAL_SIGS = [sig for sig in SIGS if sig not in RPC_SIGS]
TRIGGER = ("responses", "trg_ai_session_generation")
# The 340 functions keep their public path (their own SA-2209 ticket).
UNTOUCHED_340 = ("fn_ai_budget_assert_finite(numeric,text)", "fn_ai_budget_reserve(text,jsonb,jsonb,integer)",
                 "fn_ai_budget_settle(uuid,numeric)", "fn_ai_deferred_commit(uuid,uuid,jsonb)",
                 "fn_ai_deferred_commit_writing(uuid,uuid,jsonb)",
                 "fn_ai_budget_raise_grant(text,numeric,integer,text,uuid,text,jsonb,text)")

_owner, _svc, _svc_json, _fails = m333._owner, m333._svc, m333._svc_json, m333._fails
_j, _q = m333._j, m333._q
_catalog, _proconfig = m361._catalog, m363._proconfig
_do_blocks, _without_strings, _squash = m363._do_blocks, m363._without_strings, m363._squash


def _qualified(fn: str) -> str:
    """The only change 367 makes to a body: pinned path and pg_catalog. calls
    (also inside the dynamic SQL strings of fn_ai_patch_row/fn_ai_insert_row)."""
    fn = fn.replace("SET search_path = public, pg_temp", PINNED)
    for name in CALLS:
        fn = re.sub(rf"(?<![\w.]){name}\(", f"pg_catalog.{name}(", fn)
    return fn


def _body(fn: str) -> str:
    return m326._strip_comments(fn[fn.index("AS $$"):])


def _unqualified_calls(fn: str) -> list[str]:
    return [name for name in CALLS if re.search(rf"(?<![\w.]){name}\s*\(", _body(fn))]


def _bare_tables(fn: str) -> list[str]:
    """Table or row-type names not written as public.<name> (strings aside)."""
    return re.findall(rf"(?<![\w.])({'|'.join(TABLES)})\b", _without_strings(_body(fn)))


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
    top = m333._without_bodies(CODE)
    assert [line for line in top.splitlines() if line.startswith("ALTER")] == ALTERS
    assert len(re.findall(r"\bALTER\b", top)) == len(ALTERS)
    for forbidden in (r"\bDROP\b", r"DELETE\s+FROM", r"\bTRUNCATE\b", r"^\s*UPDATE\s", r"INSERT\s+INTO",
                      r"DISABLE\s+TRIGGER", r"session_replication_role", r"\bPOLICY\b", r"\bGRANT\b",
                      r"\bREVOKE\b", r"OWNER\s+TO", r"SECURITY\s+(DEFINER|INVOKER)\s*;", r"\bNOTIFY\b",
                      r"CREATE\s+(OR\s+REPLACE\s+)?TRIGGER", r"CREATE\s+(TABLE|INDEX|UNIQUE)", r"ALTER\s+TABLE"):
        assert not re.search(forbidden, top, re.M | re.I), forbidden
    for block in _do_blocks(CODE):
        assert not re.search(r"\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|ALTER|DROP)\b", block), block[:80]


def test_bodies_are_333_with_only_the_path_and_catalog_calls_qualified():
    for name in RECREATED:
        old = m326._function(m333.CODE, name)
        assert _unqualified_calls(old), f"repro precondition: {name}"
        assert "SECURITY DEFINER\nSET search_path = public, pg_temp" in old, name
        assert _bare_tables(old) == [], f"333 already qualifies every table: {name}"
        new = m326._function(CODE, name)
        assert _squash(new) == _squash(m326._strip_comments(_qualified(old))), name
        assert PINNED in new and "search_path = public" not in new, name
        assert _unqualified_calls(new) == [] and _bare_tables(new) == [], name
        assert "SECURITY DEFINER" in new, name
    assert len(re.findall(r"CREATE OR REPLACE FUNCTION", CODE)) == len(RECREATED)
    # The dynamic SQL qualifies the polymorphic record builder too.
    for name in ("fn_ai_patch_row", "fn_ai_insert_row"):
        assert "FROM pg_catalog.jsonb_populate_record(NULL::public.%I, $1) x" in m326._function(CODE, name)
    # The four ALTERed bodies call nothing and name only public. objects.
    for name in ALTERED:
        old = m326._function(m333.CODE, name)
        assert "SECURITY DEFINER\nSET search_path = public, pg_temp" in old, name
        assert not re.search(r"(?<![\w.])[a-z_]+\s*\(", _without_strings(_body(old))), name
        assert _bare_tables(old) == [], name
    rest = CODE
    for alter in ALTERS:
        rest = rest.replace(alter, "")
    for name in ALTERED:
        assert f"FUNCTION public.{name}" not in rest, name


def test_no_later_migration_redefines_the_functions():
    """367 recreates the 333 bodies: a later redefinition would be reverted."""
    for name in RECREATED:
        assert _defining(name) == [NAME_333, NAME], name
    for name in ALTERED:
        assert _defining(name) == [NAME_333], name


def test_do_blocks_qualify_every_catalog_function_and_operator():
    pre = _do_blocks(CODE)[0]
    listed = set(re.findall(r"'([a-z_0-9]+)'", re.search(
        r"catalog_functions CONSTANT text\[\] := ARRAY\[(.*?)\];", pre, re.S).group(1)))
    assert set(CALLS) <= listed
    operators = set(re.findall(r"'([^']+)'", re.search(
        r"catalog_operators CONSTANT text\[\] := ARRAY\[(.*?)\];", pre, re.S).group(1)))
    body_ops = set()
    for name in RECREATED:
        body = _without_strings(_body(m326._function(CODE, name)))
        body_ops |= set(re.findall(r"->>|->|\|\||<>|<=|>=|[-+*/<>=?]", body.replace(":=", " ").replace("=>", " ")))
    assert body_ops <= operators, body_ops - operators
    blocks = _do_blocks(CODE)
    assert len(blocks) == 2   # precondition, postcondition
    for block in blocks:
        bare = _without_strings(block)
        assert set(re.findall(r"pg_catalog\.([a-z_0-9]+)\(", bare)) <= listed
        for name in listed:
            assert not re.search(rf"(?<![\w.]){name}\(", bare), name
        used = set(re.findall(r"OPERATOR\(pg_catalog\.([^)]+)\)", bare))
        assert used <= operators, used
        rest = re.sub(r"OPERATOR\(pg_catalog\.[^)]+\)", " ", bare).replace(":=", " ")
        assert not re.search(r"[=<>~|@!]|->", rest), re.findall(r".{20}[=<>~|@!].{20}", rest)


def test_preconditions_come_first_and_cover_ledger_objects_shadowing_and_triggers():
    pre = _do_blocks(CODE)[0]
    assert CODE.index(pre) < CODE.index("CREATE OR REPLACE FUNCTION")
    for marker in ("migration_367_prerequisite_missing: no ledger row",
                   "migration_367_prerequisite_missing: objects", "catalog_name_shadowed_in_public",
                   "trigger_function_without_search_path"):
        assert marker in pre, marker
    for name in (NAME_333, NAME_340):
        assert f"'{name}'" in pre, name
    assert "p.pronamespace OPERATOR(pg_catalog.=) 'public'::regnamespace" in pre
    assert "o.oprnamespace OPERATOR(pg_catalog.=) 'public'::regnamespace" in pre
    for sig in [*SIGS, UNTOUCHED_340[0]]:
        assert f"'public.{sig.replace('timestamp with time zone', 'timestamptz')}'" in pre, sig
    for table in TABLES:
        assert f"'public.{table}'" in pre, table


def test_postconditions_cover_path_body_mode_owner_acl_and_trigger():
    post = _do_blocks(CODE)[-1]
    assert CODE.index(post) > CODE.rindex("CREATE OR REPLACE FUNCTION")
    assert all(CODE.index(post) > CODE.index(alter) for alter in ALTERS)
    for marker in ("ai_budget_search_path_wrong", "ai_budget_trigger_missing"):
        assert f"RAISE EXCEPTION '{marker}" in post, marker
    assert "'search_path=pg_catalog, pg_temp'" in post
    regexes = "".join(re.findall(r"'((?:[^']|'')*)'", post))
    assert f"({'|'.join(CALLS)})" in regexes and f"({'|'.join(TABLES)})" in regexes
    for name, (sig, service) in RECREATED.items():
        assert f"('public.{sig}', {str(service).lower()}," in post, sig
    for name, (sig, _args) in ALTERED.items():
        assert f"('public.{sig}', false," in post, sig
    assert f"'public.{TRIGGER[0]}'::regclass" in post and f"'{TRIGGER[1]}'" in post
    assert "NOT p.prosecdef" in post and "p.proowner OPERATOR(pg_catalog.<>) c.relowner" in post
    for role in ("anon", "authenticated"):
        assert f"has_function_privilege('{role}', p.oid, 'EXECUTE')" in post
    assert ("pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') IS DISTINCT FROM f.service_exec"
            in post)


def test_header_documents_scope_order_and_rollback():
    header = SQL[:SQL.index("\nBEGIN;\n")]
    for needle in ("SA-2209", "never edited", "364 is", "365 by PC-J603", "366 by PC-J611", *RECREATED, *ALTERED,
                   "MIGRATION_FEATURES=ai_budget", "after 340", "re-run 340 and then 367",
                   "ai_budget_function_acl_wrong", f"rollback/{NAME}", "grants nothing", "grants and revokes nothing",
                   "catalog_name_shadowed_in_public", "trigger_function_without_search_path", "Hot path",
                   "jsonb_populate_record", "pg_temp", "337 and\n-- 339 groups", *[s.split("(")[0] for s in UNTOUCHED_340]):
        assert needle in header, needle


def test_rollback_restores_the_333_bodies_and_paths_verbatim_and_grants_nothing():
    code = m326._strip_comments(ROLLBACK)
    for name in RECREATED:
        assert m326._function(m333.SQL, name) in ROLLBACK, name
    assert len(re.findall(r"CREATE OR REPLACE FUNCTION", code)) == len(RECREATED)
    for alter in ALTERS:
        assert alter.replace("pg_catalog, pg_temp", "public, pg_temp") in code, alter
    assert "REOPENS SA-2209" in ROLLBACK and "catalog_name_shadowed_in_public" in code
    shadow_check = _do_blocks(code)[0]
    for name in CALLS:
        assert f"'{name}'" in shadow_check, name
    assert code.count("BEGIN;") == 1 and code.strip().endswith("COMMIT;")
    assert not re.search(r"\bGRANT\b|\bREVOKE\b|\bDROP\b|OWNER\s+TO", code)
    assert len(re.findall(r"\bALTER\b", m333._without_bodies(code))) == len(ALTERS)


def test_release_metadata_holds_367_behind_the_ai_budget_group_with_333_and_340():
    policy = (MIGRATIONS / "forward-policy.tsv").read_text(encoding="utf-8")
    rows = {line.split("\t")[0]: line.split("\t") for line in policy.splitlines()
            if line and not line.startswith("#")}
    assert len(rows[NAME]) == 4 and rows[NAME][1:3] == ["pending_feature", "ai_budget"]
    for name in (NAME_333, NAME_340):
        assert rows[name][1:3] == ["pending_feature", "ai_budget"], name
    assert "needs 333 and 340" in rows[NAME][3] and "after SA review" in rows[NAME][3]
    readme = (MIGRATIONS / "README.md").read_text(encoding="utf-8")
    paragraph = readme[readme.index("Migration `367`"):readme.index("Migration `366`")]
    for needle in ("SA-2209", "MIGRATION_FEATURES=ai_budget", "after SA review", "333 → 340 →\n367",
                   "migration_367_prerequisite_missing", "catalog_name_shadowed_in_public",
                   "trigger_function_without_search_path", "re-run 340 and then 367", *RECREATED, *ALTERED,
                   "grants nothing", "pg_temp", "staging has 333 but not\n340 yet"):
        assert needle in paragraph, needle


# ── PostgreSQL harness ──────────────────────────────────────────────────────

def _migrated(schema: str, sql: str = SQL) -> str:
    return m333._schema_sql(sql, schema)


def _postcondition_sql(schema: str) -> str:
    return _migrated(schema, SQL[SQL.rindex("DO $$"):SQL.rindex("COMMIT;")])


def _rollback_sql(schema: str) -> str:
    return _migrated(schema, ROLLBACK)


def _apply(schema: str) -> None:
    _owner(_migrated(schema))


def _drop(schema: str | None) -> None:
    if schema:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


def _record(schema: str, *names: str) -> None:
    """The runner's ledger, schema-local (the harness maps public. to it)."""
    _owner(f"CREATE TABLE IF NOT EXISTS {schema}._schema_migrations ("
           f"filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());"
           + "".join(f"INSERT INTO {schema}._schema_migrations (filename) VALUES ('{name}') "
                     f"ON CONFLICT (filename) DO NOTHING;" for name in names))


def _schema(prefix: str, *, with_367: bool = True, with_340: bool = True,
            ledger: tuple[str, ...] = (NAME_333, NAME_340)) -> str:
    """333 and 340 applied (340 optional) by the NOSUPERUSER owner, ``ledger``
    recorded: the state 367 is applied to."""
    m333._require_pg()
    schema = prefix + uuid4().hex
    try:
        m333._build(schema)
        m333._apply(schema)
        if with_340:
            m340._apply_340(schema)
        if ledger:
            _record(schema, *ledger)
        if with_367:
            _apply(schema)
    except BaseException:
        _drop(schema)
        raise
    return schema


@pytest.fixture(scope="module")
def db():
    schema = None
    try:
        schema = _schema("pa367_")
        _apply(schema)   # re-applying is a no-op
        yield schema
    finally:
        _drop(schema)


@pytest.fixture
def fresh():
    schema = None
    try:
        schema = _schema("pa367_fresh_")
        yield schema
    finally:
        _drop(schema)


@pytest.fixture
def pre():
    """333 and 340 applied and recorded, 367 not yet: the state 367 is applied to."""
    schema = None
    try:
        schema = _schema("pa367_pre_", with_367=False)
        yield schema
    finally:
        _drop(schema)


@pytest.fixture
def s():
    """The fixture the 333 and 340 suites take (a fresh schema per test):
    here a 367 schema."""
    schema = None
    try:
        schema = _schema("pa367_s_")
        yield schema
    finally:
        _drop(schema)


def _run(sql: str, role: str | None = "service_role") -> tuple[int, str, str]:
    """psql returning stdout and stderr (NOTICEs) apart."""
    environment = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
    environment["PGCONNECT_TIMEOUT"] = "3"
    prefix = f"SET ROLE {role}; " if role else ""
    result = subprocess.run(["psql", m240.DB, "-X", "-v", "ON_ERROR_STOP=1", "-tAq", "-c", prefix + sql],
                            capture_output=True, text=True, timeout=120, env=environment)
    return result.returncode, result.stdout.strip(), result.stderr


# Exact typed overloads of the polymorphic catalog functions only the 22
# bodies call with these types (the 340 bodies use text[]/integer[] and
# jsonb_populate_recordset): each beats pg_catalog's anyelement / anyarray /
# VARIADIC "any" version, leaves a NOTICE with the role it runs as and returns
# what the catalog would, so the rows stay identical. now(), sum(numeric),
# sha256(bytea) and friends have exact pg_catalog signatures, which pg_catalog
# (searched first) always wins.
def _shadows(s: str) -> dict[str, tuple[str, str]]:
    return {
        "to_jsonb": (f"to_jsonb({s}.ai_deferred_grading_jobs) RETURNS jsonb", "RETURN pg_catalog.to_jsonb($1);"),
        "cardinality": ("cardinality(uuid[]) RETURNS integer", "RETURN pg_catalog.cardinality($1);"),
        "unnest": ("unnest(uuid[]) RETURNS SETOF uuid", "RETURN QUERY SELECT pg_catalog.unnest($1);"),
        "format": ("format(text, text, text, text, text) RETURNS text",
                   "RETURN pg_catalog.format($1, $2, $3, $4, $5);"),
        "jsonb_populate_record": (f"jsonb_populate_record({s}.sessions, jsonb) RETURNS {s}.sessions",
                                  "RETURN pg_catalog.jsonb_populate_record($1, $2);"),
    }


TAGS = ("to_jsonb", "cardinality", "unnest", "format", "jsonb_populate_record", "array_agg")


def _plant_shadows(s: str, tags: tuple[str, ...] = TAGS) -> None:
    """service_role, given CREATE on the schema as on staging before 357,
    plants typed overloads and an array_agg(uuid) aggregate."""
    _owner(f"GRANT CREATE ON SCHEMA {s} TO service_role")
    sql = "".join(
        f"CREATE FUNCTION {s}.{head} LANGUAGE plpgsql AS $$ BEGIN "
        f"RAISE NOTICE 'attacker_called {tag} %', current_user; {ret} END $$; "
        for tag, (head, ret) in _shadows(s).items() if tag in tags)
    if "array_agg" in tags:
        sql += (f"CREATE FUNCTION {s}.pa367_acc(uuid[], uuid) RETURNS uuid[] LANGUAGE plpgsql AS $$ BEGIN "
                f"RAISE NOTICE 'attacker_called array_agg %', current_user; "
                f"RETURN pg_catalog.array_append($1, $2); END $$; "
                f"CREATE AGGREGATE {s}.array_agg(uuid) (SFUNC = {s}.pa367_acc, STYPE = uuid[]);")
    rc, out, err = _run(sql)
    assert rc == 0, err
    assert psql(f"SELECT count(*) FROM pg_proc WHERE pronamespace = '{s}'::regnamespace "
                f"AND proname IN ({', '.join(repr(t) for t in tags)}) "
                f"AND pg_get_userbyid(proowner) = 'service_role'") == str(len(tags))


def _drop_shadows(s: str) -> None:
    psql(f"DROP AGGREGATE {s}.array_agg(uuid); DROP FUNCTION {s}.pa367_acc(uuid[], uuid), "
         + ", ".join(f"{s}.{head.split(' RETURNS')[0]}" for head, _ in _shadows(s).values()))


# A typed to_jsonb(<composite>) also makes the 333 to_jsonb(u) over a CTE
# record ambiguous (fn_ai_deferred_claim_writing fails "is not unique"), so
# the pre-367 scenario plants it on its own.
WITHOUT_TO_JSONB = tuple(tag for tag in TAGS if tag != "to_jsonb")


# Fixed ids: every schema gets the same rows, so the rows compare directly.
IDS = {key: str(uuid4()) for key in ("user", "admin", "session", "question", "token", "item", "essay", "wjob")}
_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
_TS = re.compile(r"\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(\.\d+)?([+-]\d\d(:\d\d)?|Z)?")


def _normal(text: str) -> str:
    """Generated ids and clock times differ between schemas; fixed ids stay."""
    fixed = {value: f"<{key}>" for key, value in IDS.items()}
    text = _TS.sub("<ts>", text)
    text = _UUID.sub(lambda m: fixed.get(m.group(0), "<uuid>"), text)
    return re.sub(r"\b[0-9a-f]{64}\b", "<sha256>", text)   # submission revisions of generated ids


def _scenario(s: str) -> tuple[list[str], str]:
    """Every function 367 changes, called the way the backend and the sweeper
    call them (service_role RPCs, the owner-only repair, response writes that
    fire the generation trigger): reserve/release, reserve/expire, the
    provider close, recompute, deferred save/claim/commit, the Writing drain,
    both band writers, the class-score sync and raise grant/end/expiry.
    Returns the normalised RPC results and every NOTICE."""
    i = IDS
    results, notices = [], []

    def run(sql: str, role: str | None = "service_role") -> str:
        rc, out, err = _run(sql, role)
        assert rc == 0, err
        notices.append(err)
        results.append(_normal(out))
        return out

    psql(f"INSERT INTO {s}.class_assignment_items (id) VALUES ('{i['item']}');"
         f"INSERT INTO {s}.sessions (id, user_id, status, resume_expires_at, class_assignment_item_id) "
         f"VALUES ('{i['session']}', '{i['user']}', 'in_progress', now() + interval '1 hour', '{i['item']}');"
         f"INSERT INTO {s}.writing_essays (id, status) VALUES ('{i['essay']}', 'pending');"
         f"INSERT INTO {s}.writing_jobs (id, essay_id, attempt_count, budget_deferred_at) "
         f"VALUES ('{i['wjob']}', '{i['essay']}', 1, now());")
    # Budget lines: release, expire, provider close, operator recompute.
    run(m333._reserve_sql(s, "k-release", [m333._line("google", 0.3)]))
    rel = psql(f"SELECT id FROM {s}.ai_budget_reservations WHERE request_key = 'k-release'")
    run(f"SELECT {s}.fn_ai_budget_release('{rel}');")
    run(f"SELECT {s}.fn_ai_budget_release('{rel}');")
    run(m333._reserve_sql(s, "k-expire", [m333._line("openai", 0.2), m333._line("elevenlabs", 0.1, 2)], ttl=60))
    psql(f"UPDATE {s}.ai_budget_reservations SET expires_at = now() - interval '1 minute' "
         f"WHERE request_key = 'k-expire'")
    run(f"SELECT {s}.fn_ai_budget_expire(now());")
    run(f"SELECT {s}.fn_ai_budget_close_scope('google', NULL, 'provider_spend_limit');")
    run(f"SELECT {s}.fn_ai_budget_close_scope('google', NULL, 'provider_spend_limit');")
    day = psql("SELECT (now() AT TIME ZONE 'UTC')::date")
    month = psql("SELECT date_trunc('month', now() AT TIME ZONE 'UTC')::date")
    run(f"SELECT {s}.fn_ai_budget_recompute('{day}'); SELECT {s}.fn_ai_budget_recompute('{month}');", role=OWNER)
    # Deferred Speaking: save (insert_row + trigger), claim, commit (340, patch_row).
    path = f"{i['user']}/s/q.{i['token']}.{'a' * 64}.webm"
    response = {"session_id": i["session"], "question_id": i["question"], "submission_token": i["token"],
                "audio_storage_path": path, "expected_revision": "absent",
                "row": {"audio_url": "signed://x", "duration_seconds": 42.5, "stt_status": "pending"}}
    saved = json.loads(run(f"SELECT {s}.fn_ai_deferred_save({_j(response)}, "
                           f"{_j({'user_id': i['user'], 'reason': 'monthly_cap'})});"))
    run(f"SELECT {s}.fn_ai_deferred_save({_j(response)}, {_j({'user_id': i['user'], 'reason': 'monthly_cap'})});")
    claimed = json.loads(run(f"SELECT {s}.fn_ai_deferred_claim(2, 300);"))
    assert [job["id"] for job in claimed] == [saved["job_id"]]
    run(m333._commit_sql(s, saved["job_id"], claimed[0]["lease_token"], m333.RESULT))
    # Writing drain: claim (340 commit uses insert_row/patch_row).
    drained = json.loads(run(f"SELECT {s}.fn_ai_deferred_claim_writing(2, 300);"))
    run(m333._commit_writing_sql(s, i["wjob"], drained[0]["budget_lease_token"]))
    # Band writers and the class-score sync (patch_row on sessions).
    gen = psql(f"SELECT generation FROM {s}.ai_deferred_session_refresh WHERE session_id = '{i['session']}'")
    run(m333._bands_sql(s, i["session"], int(gen),
                        {"overall_band": 6.5, "band_fc": 6.5, "status": "completed", "completed_at": "2026-11-04"},
                        from_in_progress=True))
    run(f"SELECT {s}.fn_ai_deferred_aggregate_write('{i['session']}', {gen}, {_j({'overall_band': 6.5})});")
    run(f"SELECT {s}.fn_ai_class_sync('{i['session']}');")
    psql(f"UPDATE {s}.class_assignment_items SET artifact_kind = 'session', artifact_id = '{i['session']}', "
         f"submitted_at = now() WHERE id = '{i['item']}'")
    run(f"SELECT {s}.fn_ai_class_sync('{i['session']}');")
    # Raises: grant (340) and end early; grant and expire through the sweep.
    granted = json.loads(run(m333._grant_sql(s, scope="google", amount=10, actor=i["admin"])))
    rid = granted["raise"]["id"]
    run(f"SELECT {s}.fn_ai_budget_raise_end('{rid}', '{i['admin']}', 'aal2', 'done', 'req-end');")
    run(f"SELECT {s}.fn_ai_budget_raise_end('{rid}', '{i['admin']}', 'aal2', 'done', 'req-end');")
    run(m333._grant_sql(s, scope="openai", amount=5, hours=1, actor=i["admin"]))
    psql(f"UPDATE {s}.ai_budget_raises SET granted_at = now() - interval '3 hours', "
         f"expires_at = now() - interval '2 hours' WHERE ended_at IS NULL")
    run(f"SELECT {s}.fn_ai_budget_raise_expire_sweep(now());")
    run(f"SELECT {s}.fn_ai_budget_raise_expire_sweep(now());")
    return results, "\n".join(notices)


def _rows(s: str) -> list[str]:
    """Every table the scenario writes, ids and clock times normalised."""
    queries = [
        f"SELECT json_object_agg(scope || ':' || period_kind, json_build_array(settled_usd, reserved_usd, "
        f"cap_usd, closed_reason) ORDER BY scope, period_kind) FROM {s}.ai_budget_counters",
        f"SELECT json_agg(json_build_array(kind, scope, period_kind, threshold, trigger, committed_usd, cap_usd) "
        f"ORDER BY kind, scope, period_kind, threshold, trigger) FROM {s}.ai_budget_alerts",
        f"SELECT json_agg(json_build_array(request_key, provider, status, estimate_usd, actual_usd) "
        f"ORDER BY request_key, provider) FROM {s}.ai_budget_reservations",
        f"SELECT json_agg(json_build_array(kind, status, attempts, reason) ORDER BY kind, status) "
        f"FROM {s}.ai_deferred_grading_jobs",
        f"SELECT json_agg(json_build_array(session_id, generation, refreshed_generation, class_synced_generation)) "
        f"FROM {s}.ai_deferred_session_refresh",
        f"SELECT json_agg(json_build_array(session_id, grading_status, overall_band, transcript, stt_status, "
        f"feedback)) FROM {s}.responses",
        f"SELECT json_agg(json_build_array(id, status, overall_band, band_fc, completed_at IS NOT NULL)) "
        f"FROM {s}.sessions",
        f"SELECT json_agg(json_build_array(id, score, submitted_at IS NOT NULL)) FROM {s}.class_assignment_items",
        f"SELECT json_agg(json_build_array(id, status, current_version, grading_tier_metadata)) "
        f"FROM {s}.writing_essays",
        f"SELECT json_agg(json_build_array(essay_id, version, source, overall_band_score)) FROM {s}.writing_feedback",
        f"SELECT json_agg(json_build_array(id, status, attempt_count, budget_drain_count, budget_commit_count)) "
        f"FROM {s}.writing_jobs",
        f"SELECT json_agg(json_build_array(scope, amount_usd, end_kind) ORDER BY scope) FROM {s}.ai_budget_raises",
        f"SELECT json_agg(json_build_array(scope, event, amount_usd) ORDER BY scope, event) "
        f"FROM {s}.ai_budget_raise_events",
        f"SELECT json_agg(json_build_array(grammar_issue, recommended_slug)) FROM {s}.grammar_recommendations",
    ]
    return [_normal(psql(query)) for query in queries]


def _facts(s: str) -> list[str]:
    return [psql(f"SELECT prosecdef::text || '|' || provolatile::text || '|' || pg_get_userbyid(proowner) || '|' || "
                 f"COALESCE(proacl::text, '-') FROM pg_proc WHERE oid = '{s}.{sig}'::regprocedure")
            for sig in SIGS]


def _prosrc(s: str, sig: str) -> str:
    return psql(f"SELECT prosrc FROM pg_proc WHERE oid = '{s}.{sig}'::regprocedure")


def _unpinned(s: str) -> None:
    for sig in SIGS:
        assert _proconfig(s, sig) == f"search_path={s}, pg_temp", sig


def _pinned(s: str) -> None:
    for sig in SIGS:
        assert _proconfig(s, sig) == "search_path=pg_catalog, pg_temp", sig


# ── PostgreSQL: SA-2209 ─────────────────────────────────────────────────────

def test_harness_is_owned_by_the_nosuperuser_owner(db):
    assert psql(f"SELECT count(*) FROM pg_roles WHERE rolname IN "
                f"('anon', 'authenticated', 'service_role', '{OWNER}') AND NOT rolsuper") == "4"
    assert psql(f"SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = '{db}'") == OWNER
    assert psql(f"SELECT count(*) FROM pg_proc WHERE pronamespace = '{db}'::regnamespace "
                f"AND pg_get_userbyid(proowner) <> '{OWNER}'") == "0"
    assert psql(f"SELECT count(*) FROM pg_class WHERE relnamespace = '{db}'::regnamespace "
                f"AND relkind IN ('r', 'p') AND pg_get_userbyid(relowner) <> '{OWNER}'") == "0"
    _pinned(db)
    for sig in UNTOUCHED_340:
        assert _proconfig(db, sig) == f"search_path={db}, pg_temp", sig


def test_negative_control_before_367_runs_planted_overloads_as_the_owner(pre):
    """SA-2209 on the 340 schema (red before 367): service_role plants the
    overloads and calls the RPCs, which run them as the owner."""
    s = pre
    _plant_shadows(s, WITHOUT_TO_JSONB)
    _results, notices = _scenario(s)
    for tag in WITHOUT_TO_JSONB:
        assert f"attacker_called {tag} {OWNER}" in notices, (tag, notices)
    _plant_shadows(s, ("to_jsonb",))
    sid, token = str(uuid4()), str(uuid4())
    psql(f"INSERT INTO {s}.sessions (id, user_id, status, resume_expires_at) "
         f"VALUES ('{sid}', '{IDS['user']}', 'in_progress', now() + interval '1 hour');"
         f"INSERT INTO {s}.writing_jobs (essay_id, budget_deferred_at) VALUES ('{IDS['essay']}', now())")
    assert _svc_json(m333._save_sql(s, sid, str(uuid4()), token, m333._path(token), "absent"))["status"] == "saved"
    rc, _out, err = _run(f"SELECT {s}.fn_ai_deferred_claim(2, 300);")
    assert rc == 0 and f"attacker_called to_jsonb {OWNER}" in err, err
    rc, _out, err = _run(f"SELECT {s}.fn_ai_deferred_claim_writing(2, 300);")
    assert rc != 0 and "is not unique" in err, err


def test_planted_overloads_never_run_after_367_and_rows_match(pre, fresh):
    """The same scenario returns the same results and writes the same
    counters, reservations, alerts, jobs, responses, sessions, Writing rows,
    class score and raise audit on a clean pre-367 schema and on a 367 schema
    with every shadow planted, and no planted function runs."""
    reference, notices = _scenario(pre)
    assert "attacker_called" not in notices
    expected = _rows(pre)
    assert '"status": "released"' in reference[1] and reference[4] == "2", reference[:5]
    assert '"status": "synced"' in reference[17] and reference[22] == "1", reference[15:]
    _plant_shadows(fresh)
    results, notices = _scenario(fresh)
    assert "attacker_called" not in notices, notices
    assert results == reference
    assert _rows(fresh) == expected


def test_pg_temp_tables_are_never_read_after_367(fresh):
    """With public off the path an unqualified table would resolve to pg_temp:
    a service_role session with temp tables of every name the bodies use
    still writes the real tables."""
    s = fresh
    _scenario(s)
    sid = str(uuid4())
    psql(f"INSERT INTO {s}.sessions (id, user_id, status, resume_expires_at) "
         f"VALUES ('{sid}', '{IDS['user']}', 'completed', now() + interval '1 hour')")
    temp = "".join(f"CREATE TEMP TABLE {name} (LIKE {s}.{name} INCLUDING DEFAULTS); " for name in TABLES)
    rc, out, err = _run(
        f"{temp} INSERT INTO pg_temp.sessions (id, status) VALUES ('{sid}', 'in_progress'); "
        f"SELECT {s}.fn_ai_budget_close_scope('openai', NULL, 'provider_spend_limit'); "
        f"SELECT {s}.fn_ai_session_bands_write('{sid}', 0, '{{\"overall_band\": 7}}', false, false); "
        f"SELECT {s}.fn_ai_class_sync('{sid}'); "
        f"SELECT {s}.fn_ai_deferred_claim(2, 300); "
        f"SELECT " + " || ':' || ".join(f"(SELECT count(*) FROM pg_temp.{name})" for name in TABLES) + ";")
    assert rc == 0, err
    assert out.splitlines()[-1] == ":".join("1" if name == "sessions" else "0" for name in TABLES)
    assert psql(f"SELECT overall_band FROM {s}.sessions WHERE id = '{sid}'") == "7"
    assert psql(f"SELECT closed_reason FROM {s}.ai_budget_counters WHERE scope = 'openai' "
                f"AND period_kind = 'day'") == "provider_spend_limit"


def test_catalog_before_after_changes_only_the_path_and_qualification(pre, db):
    """Owner, security mode, volatility and ACL of the 22 functions are
    identical; every other function (the 340 ones included), trigger and
    relation ACL of the schema is untouched; the live bodies differ only by
    pg_catalog. qualification and whitespace, and the four ALTERed bodies are
    byte-identical."""
    assert _facts(db) == _facts(pre)
    altered = [sig for sig, _ in ALTERED.values()]
    for sig, fact in zip(SIGS, _facts(db)):
        assert fact.startswith(f"true|"), (sig, fact)
        assert _proconfig(pre, sig) == f"search_path={pre}, pg_temp"
        assert _proconfig(db, sig) == "search_path=pg_catalog, pg_temp"
        for role in ("anon", "authenticated"):
            assert psql(f"SELECT has_function_privilege('{role}', '{db}.{sig}', 'EXECUTE')") == "f"
        assert psql(f"SELECT has_function_privilege('service_role', '{db}.{sig}', 'EXECUTE')") == (
            "t" if sig in RPC_SIGS else "f"), sig
        before, after = _prosrc(pre, sig).replace(f"{pre}.", ""), _prosrc(db, sig).replace(f"{db}.", "")
        assert _squash(after.replace("pg_catalog.", "")) == _squash(before), sig
        assert (before == after) is (sig in altered), sig
    changed = {f"fn S.{sig.split('(')[0]}(" for sig in SIGS}
    keep = [line for line in _catalog(db, oids=False) if not any(line.startswith(c) for c in changed)]
    assert keep == [line for line in _catalog(pre, oids=False) if not any(line.startswith(c) for c in changed)]
    assert len(_catalog(db, oids=False)) == len(_catalog(pre, oids=False))


def _bench(s: str, n: int) -> float:
    """Seconds per round of the request path: reserve + settle (340, calling
    the 333 helpers 367 pins) and a band-bearing response write (the
    generation trigger), as service_role, in one session per round."""
    sid, rid = str(uuid4()), str(uuid4())
    psql(f"INSERT INTO {s}.sessions (id, user_id, status, resume_expires_at) "
         f"VALUES ('{sid}', '{IDS['user']}', 'in_progress', now() + interval '1 hour');"
         f"INSERT INTO {s}.responses (id, session_id, question_id) VALUES ('{rid}', '{sid}', gen_random_uuid())")
    lines, caps = _j([m333._line("anthropic", 0.0001)]), _j(m333._caps())
    rc, out, err = _run(f"""DO $$
            DECLARE t0 timestamptz := clock_timestamp(); v jsonb;
            BEGIN
                FOR i IN 1..{n} LOOP
                    v := {s}.fn_ai_budget_reserve('bench-{rid}-' || i, {lines}, {caps}, 600);
                    PERFORM {s}.fn_ai_budget_settle((v->'reservations'->0->>'id')::uuid, 0.0001);
                    UPDATE {s}.responses SET overall_band = i % 9 WHERE id = '{rid}';
                END LOOP;
                RAISE NOTICE 'bench %', extract(epoch FROM clock_timestamp() - t0);
            END $$;""")
    assert rc == 0, err
    assert psql(f"SELECT count(*) FROM {s}.ai_budget_reservations WHERE request_key LIKE 'bench-{rid}-%' "
                f"AND status = 'settled'") == str(n), "every round grants and settles anew"
    return float(re.search(r"bench ([0-9.]+)", err).group(1))


def test_hot_path_is_not_slower_after_367(pre, fresh):
    """Every function already had a SET search_path, so the per-call GUC
    save/restore and the no-inlining stay; only the value changes. Interleaved
    rounds on the same cluster, best of 5: the 367 schema may not be slower
    than the 340 schema beyond noise (30 %)."""
    before, after = [], []
    for _ in range(5):
        before.append(_bench(pre, 150))
        after.append(_bench(fresh, 150))
    print(f"hot path reserve+settle+response write x150: before {sorted(before)} after {sorted(after)}")
    assert min(after) <= min(before) * 1.3, (before, after)


# ── PostgreSQL: release path and idempotency ────────────────────────────────

def test_staging_path_applies_on_top_of_340_with_history_and_reruns_as_a_no_op(pre):
    s = pre
    _scenario(s)
    history = _rows(s)
    _apply(s)
    assert _rows(s) == history
    _pinned(s)
    _owner(_postcondition_sql(s))
    snapshot = _catalog(s, oids=True)
    _apply(s)
    assert _catalog(s, oids=True) == snapshot, "second run must change nothing"


def test_rerunning_333_is_caught_and_340_then_367_restore_the_pin(fresh):
    s = fresh
    m333._apply(s)
    _unpinned(s)
    error = _fails(_owner, _postcondition_sql(s))
    assert "ai_budget_search_path_wrong" in error, error
    for sig in SIGS:
        assert sig.split("(")[0] in error, (sig, error)
    m340._apply_340(s)
    _apply(s)
    _owner(_postcondition_sql(s))
    assert "fn_ai_budget_assert_finite" in _prosrc(s, UNTOUCHED_340[1]), "the 340 bodies are back"


def test_rerunning_340_alone_after_367_aborts_on_its_postcondition_and_changes_nothing(fresh):
    s = fresh
    snapshot = _catalog(s, oids=True)
    error = _fails(m340._apply_340, s)
    assert "ai_budget_function_acl_wrong" in error, error
    assert _catalog(s, oids=True) == snapshot
    _pinned(s)


# ── PostgreSQL: preconditions ───────────────────────────────────────────────

@pytest.mark.parametrize("state,marker", [
    ("no_ledger", "migration_367_prerequisite_missing: no ledger row"),
    ("333_not_recorded", "migration_367_prerequisite_missing: no ledger row"),
    ("340_not_recorded", "migration_367_prerequisite_missing: no ledger row"),
    ("340_recorded_not_applied", "migration_367_prerequisite_missing: objects public.fn_ai_budget_assert_finite"),
])
def test_precondition_requires_333_and_340_recorded_and_applied(state, marker):
    ledger = {"no_ledger": (), "333_not_recorded": (NAME_340,), "340_not_recorded": (NAME_333,),
              "340_recorded_not_applied": (NAME_333, NAME_340)}[state]
    schema = None
    try:
        schema = _schema("pa367_noprereq_", with_367=False, ledger=ledger,
                         with_340=state != "340_recorded_not_applied")
        assert marker.replace("public.", f"{schema}.") in _fails(_owner, _migrated(schema))
        _unpinned(schema)
    finally:
        _drop(schema)


@pytest.mark.parametrize("path", ["{s}", "{s}, pg_catalog", "pg_catalog, pg_temp"])
def test_precondition_refuses_a_planted_shadow_without_running_it(pre, path):
    s = pre
    _plant_shadows(s)
    rc, out, err = _run(f"SET search_path = {path.format(s=s)}; {_migrated(s)}", role=OWNER)
    assert rc != 0 and ("catalog_name_shadowed_in_public: function array_agg, function cardinality, "
                        "function format, function jsonb_populate_record, function to_jsonb, "
                        "function unnest") in err, err
    assert "attacker_called" not in err, err
    _unpinned(s)


@pytest.mark.parametrize("op,left,right", [("=", "name", "text"), ("<>", "integer", "integer"),
                                           ("->>", "jsonb", "text"), ("~*", "text", "text")])
def test_precondition_refuses_a_planted_operator(pre, op, left, right):
    s = pre
    _owner(f"GRANT CREATE ON SCHEMA {s} TO service_role")
    rc, _out, err = _run(
        f"CREATE FUNCTION {s}.pa367_op({left}, {right}) RETURNS boolean LANGUAGE sql AS 'SELECT true'; "
        f"CREATE OPERATOR {s}.{op} (LEFTARG = {left}, RIGHTARG = {right}, FUNCTION = {s}.pa367_op);")
    assert rc == 0, err
    assert f"catalog_name_shadowed_in_public: operator {op}" in _fails(_owner, _migrated(s))
    _unpinned(s)


@pytest.mark.parametrize("table", ["sessions", "writing_feedback", "class_assignment_items"])
def test_precondition_refuses_a_trigger_that_would_inherit_the_pinned_path(pre, table):
    """A trigger function without its own path would run on pg_catalog,
    pg_temp inside the pinned writers: refused and named, nothing changed."""
    s = pre
    _owner(f"CREATE FUNCTION {s}.pa367_touch() RETURNS trigger LANGUAGE plpgsql AS $$ "
           f"BEGIN RETURN NEW; END $$; "
           f"CREATE TRIGGER pa367_touch BEFORE UPDATE ON {s}.{table} "
           f"FOR EACH ROW EXECUTE FUNCTION {s}.pa367_touch();")
    error = _fails(_owner, _migrated(s))
    assert f"trigger_function_without_search_path: {s}.{table}.pa367_touch" in error, error
    _unpinned(s)
    _owner(f"ALTER FUNCTION {s}.pa367_touch() SET search_path = {s}, pg_temp")
    _apply(s)
    _owner(_postcondition_sql(s))


# ── PostgreSQL: postconditions ──────────────────────────────────────────────

def _drift(s: str, tamper: str, revert: str | None, sigs: list[str], marker: str = "ai_budget_search_path_wrong"):
    """For each function: the clean state passes, the tamper fails the
    postcondition naming it, and re-applying 367 repairs it (revert None) or
    keeps failing until the operator's revert."""
    for sig in sigs:
        _owner(_postcondition_sql(s))
        _owner(tamper.format(s=s, sig=sig))
        error = _fails(_owner, _postcondition_sql(s))
        assert marker in error and sig.split("(")[0] in error, (sig, error)
        if revert is None:
            _apply(s)
        else:
            assert marker in _fails(_owner, _migrated(s)), sig
            _owner(revert.format(s=s, sig=sig))
    _owner(_postcondition_sql(s))


@pytest.mark.parametrize("change", ["SET search_path = public, pg_temp",
                                    "SET search_path = pg_catalog, public, pg_temp", "RESET search_path"])
def test_postcondition_aborts_on_a_changed_path_and_367_restores_it(fresh, change):
    _drift(fresh, f"ALTER FUNCTION {{s}}.{{sig}} {change}", None, SIGS)


def test_postcondition_aborts_on_security_invoker(fresh):
    """367 recreates 18 functions as SECURITY DEFINER; it only ALTERs the
    path of the other four, so their mode needs the operator's fix."""
    altered = [sig for sig, _ in ALTERED.values()]
    _drift(fresh, "ALTER FUNCTION {s}.{sig} SECURITY INVOKER", None, [s for s in SIGS if s not in altered])
    _drift(fresh, "ALTER FUNCTION {s}.{sig} SECURITY INVOKER", "ALTER FUNCTION {s}.{sig} SECURITY DEFINER",
           altered)


@pytest.mark.parametrize("role", ["PUBLIC", "anon", "authenticated"])
def test_postcondition_aborts_on_a_client_grant_until_the_operator_revokes_it(fresh, role):
    _drift(fresh, f"GRANT EXECUTE ON FUNCTION {{s}}.{{sig}} TO {role}",
           f"REVOKE EXECUTE ON FUNCTION {{s}}.{{sig}} FROM {role}", SIGS)


def test_postcondition_aborts_on_a_changed_service_role_grant(fresh):
    _drift(fresh, "REVOKE EXECUTE ON FUNCTION {s}.{sig} FROM service_role",
           "GRANT EXECUTE ON FUNCTION {s}.{sig} TO service_role", RPC_SIGS)
    _drift(fresh, "GRANT EXECUTE ON FUNCTION {s}.{sig} TO service_role",
           "REVOKE EXECUTE ON FUNCTION {s}.{sig} FROM service_role", INTERNAL_SIGS)


@pytest.mark.parametrize("mode", ["DISABLE", "ENABLE REPLICA"])
def test_postcondition_aborts_when_the_generation_trigger_is_off(fresh, mode):
    s = fresh
    _owner(f"ALTER TABLE {s}.{TRIGGER[0]} {mode} TRIGGER {TRIGGER[1]}")
    assert "ai_budget_trigger_missing" in _fails(_owner, _postcondition_sql(s))
    assert "ai_budget_trigger_missing" in _fails(_owner, _migrated(s))
    _owner(f"ALTER TABLE {s}.{TRIGGER[0]} ENABLE TRIGGER {TRIGGER[1]}")
    _owner(_postcondition_sql(s))


def test_postcondition_refuses_an_unqualified_call_under_the_pinned_path(fresh):
    """The 333 body under the pinned path with the calls left bare."""
    s = fresh
    for name in RECREATED:
        body = m326._function(m333.SQL, name).replace("SET search_path = public, pg_temp", PINNED)
        assert _unqualified_calls(body) != [], name
        _owner(_migrated(s, body))
        error = _fails(_owner, _postcondition_sql(s))
        assert "ai_budget_search_path_wrong" in error and name in error, error
        _apply(s)
    _owner(_postcondition_sql(s))


def test_postcondition_refuses_an_unqualified_table_under_the_pinned_path(fresh):
    s = fresh
    for name, table in (("fn_ai_budget_release", "ai_budget_reservations"), ("fn_ai_class_sync", "sessions"),
                        ("fn_ai_deferred_claim_writing", "writing_jobs")):
        body = m326._function(CODE, name).replace(f"FROM public.{table}", f"FROM {table}", 1)
        assert f"FROM {table}" in body, name
        _owner(_migrated(s, body))
        error = _fails(_owner, _postcondition_sql(s))
        assert "ai_budget_search_path_wrong" in error and name in error, error
        _apply(s)
    _owner(_postcondition_sql(s))


@pytest.mark.parametrize("sig", [RECREATED["fn_ai_deferred_claim"][0], ALTERED["fn_ai_budget_lock_counter"][0]])
def test_postcondition_refuses_a_definer_that_does_not_own_its_table(fresh, sig):
    s = fresh
    psql("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pa367_other') THEN "
         "CREATE ROLE pa367_other NOSUPERUSER NOLOGIN; END IF; END $$;")
    acl = psql(f"SELECT proacl::text FROM pg_proc WHERE oid = '{s}.{sig}'::regprocedure")
    psql(f"ALTER FUNCTION {s}.{sig} OWNER TO pa367_other")
    try:
        error = _fails(psql, _postcondition_sql(s))
        assert "ai_budget_search_path_wrong" in error and sig.split("(")[0] in error, error
    finally:
        psql(f"ALTER FUNCTION {s}.{sig} OWNER TO {OWNER}; REVOKE ALL ON FUNCTION {s}.{sig} FROM pa367_other")
    assert psql(f"SELECT proacl::text FROM pg_proc WHERE oid = '{s}.{sig}'::regprocedure") == acl
    _owner(_postcondition_sql(s))


def test_postcondition_ignores_planted_overloads_and_operators(fresh):
    """A shadow planted after 367 never runs in its checks, on any path."""
    s = fresh
    _plant_shadows(s)
    rc, _out, err = _run(
        f"CREATE FUNCTION {s}.pa367_ne(oid, oid) RETURNS boolean LANGUAGE plpgsql AS $$ "
        f"BEGIN RAISE NOTICE 'attacker_called ne %', current_user; RETURN false; END $$; "
        f"CREATE OPERATOR {s}.<> (LEFTARG = oid, RIGHTARG = oid, FUNCTION = {s}.pa367_ne);")
    assert rc == 0, err
    _owner(f"ALTER FUNCTION {s}.{RPC_SIGS[0]} SET search_path = public, pg_temp")
    for path in (f"{s}", f"{s}, pg_catalog"):
        rc, _out, err = _run(f"SET search_path = {path}; {_postcondition_sql(s)}", role=OWNER)
        assert rc != 0 and "ai_budget_search_path_wrong" in err, err
        assert "attacker_called" not in err, err


# ── PostgreSQL: rollback ────────────────────────────────────────────────────

def test_rollback_restores_the_pre_367_catalog_reopens_sa_2209_and_367_reapplies(fresh, pre):
    s = fresh
    _owner(_rollback_sql(s))
    assert _catalog(s, oids=False) == _catalog(pre, oids=False)
    assert _facts(s) == _facts(pre)
    _unpinned(s)
    _owner(m333._schema_sql(m340.SQL[m340.SQL.rindex("DO $$"):m340.SQL.rindex("NOTIFY")], s))   # 340 holds again
    _plant_shadows(s, WITHOUT_TO_JSONB)   # negative control: the hole is open again
    notices = _scenario(s)[1]
    for tag in WITHOUT_TO_JSONB:
        assert f"attacker_called {tag} {OWNER}" in notices, tag
    psql(f"DROP AGGREGATE {s}.array_agg(uuid); DROP FUNCTION {s}.pa367_acc(uuid[], uuid), "
         + ", ".join(f"{s}.{head.split(' RETURNS')[0]}" for tag, (head, _) in _shadows(s).items()
                     if tag != "to_jsonb"))
    _apply(s)
    _owner(_postcondition_sql(s))


def test_rollback_refuses_while_a_shadow_is_planted(fresh):
    s = fresh
    _plant_shadows(s)
    rc, _out, err = _run(_rollback_sql(s), role=OWNER)
    assert rc != 0 and ("catalog_name_shadowed_in_public: array_agg, cardinality, format, "
                        "jsonb_populate_record, to_jsonb, unnest") in err, err
    _pinned(s)


# ── PostgreSQL: the 333 and 340 suites on the 367 schema ────────────────────

# Excluded, each still passing in its own suite on its own schema:
# - the two catalog tests pin search_path=public, pg_temp on the functions 367
#   pins (test_catalog_before_after_changes_only_the_path_and_qualification
#   and the postcondition tests here check those functions instead);
# - 333's down script needs a 333-only schema: 340's helper
#   fn_ai_budget_assert_finite survives it by design, which is why 340
#   replaced it with ROLLBACK (b) (test_rerun340_rollback_b_* runs here).
# All other tests that take only db or s (and 340's `value` parameter) run
# unchanged here, on the NOSUPERUSER-owned 367 schema.
_NOT_RERUN: dict = {
    m333: {"test_catalog_after_apply_and_rerun",
           "test_down_script_refuses_while_work_is_owed_then_keeps_the_raise_audit"},
    m340: {"test_catalog_acl_and_constraints_after_apply_and_rerun"},
}


def _rerun(module, prefix: str) -> None:
    for name, fn in inspect.getmembers(module, inspect.isfunction):
        params = set(inspect.signature(fn).parameters)
        if (name.startswith("test_") and fn.__module__ == module.__name__
                and params & {"db", "s"} and not params - {"db", "s", "value"}
                and name not in _NOT_RERUN.get(module, set())):
            globals()[f"test_{prefix}_{name[5:]}"] = fn


_rerun(m333, "rerun333")
_rerun(m340, "rerun340")
