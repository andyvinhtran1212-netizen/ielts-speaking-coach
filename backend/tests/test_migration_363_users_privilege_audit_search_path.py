"""Migration 363 (PC-J538): search_path pin on the users audit trigger chain.

SA-2180-R3-2: fn_users_privilege_audit (SECURITY DEFINER) and the writer it
calls, fn_staff_security_record (SECURITY INVOKER, so it runs as the definer),
kept search_path = public, pg_temp and called catalog functions without a
schema. A role with CREATE on public could plant an exact typed
jsonb_build_object overload that beats the catalog's VARIADIC "any" version
and runs as the function owner on the next users update (SA probe C).

The static half pins 361 as merged, compares both new bodies with the 361/332
bodies they replace and checks the DO blocks qualify every function and
operator. The PostgreSQL half reuses the 361 harness (NOSUPERUSER owner,
Supabase default privileges, 322, 332, 336, 341, 361), applies 363 (twice) and
proves: the repro on 361 (red), the same planted overloads never running after
363 with the audit/outbox rows unchanged, both release paths, the
precondition and postcondition aborts, the rollback, and the 332/336/341/361
behaviour suites re-run on the 363 schema.

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

import hashlib
import inspect
import json
import re
from pathlib import Path
from uuid import uuid4

import pytest

import test_migration_326_student_archive as m326
import test_migration_331_archived_student_give_guard as m331
import test_migration_332_staff_security_audit as m332
import test_migration_336_suspended_account_role_guard as m336
import test_migration_341_staff_guc_and_ai_override_hardening as m341
import test_migration_361_staff_privilege_evidence_commit_guard as m361
from test_migration_240_core_attempt_evidence import psql

BACKEND = Path(__file__).resolve().parents[1]
MIGRATIONS = BACKEND / "migrations"
NAME = "363_users_privilege_audit_search_path.sql"
SQL = (MIGRATIONS / NAME).read_text(encoding="utf-8")
CODE = m326._strip_comments(SQL)
ROLLBACK = (MIGRATIONS / "rollback" / NAME).read_text(encoding="utf-8")
NAME_361 = m361.NAME
# 361 as merged by #2180 (origin/staging a7bf14f32); 363 never edits it.
MERGED_361_BLOB = "1d603a190598eaf43e6681afae57ea17dadd29d3"
MERGED_361_SHA256 = "fd236ae6de39392ac170e90823cc4a1b9277f9e5710a77c89c52340e4e4e68a4"
OWNER = m332.OWNER
EVIDENCE = m341.EVIDENCE
AUDIT_FN = "fn_users_privilege_audit"
RECORD_FN = "fn_staff_security_record"
RECORD_SIG = "fn_staff_security_record(uuid,text,uuid,uuid,text,jsonb,jsonb,text,text,jsonb,boolean)"
CALLS = ("jsonb_build_object", "gen_random_uuid", "current_setting", "pg_current_xact_id", "now")
PINNED = "SET search_path = pg_catalog, pg_temp"

_user, _audit, _outbox = m332._user, m332._audit, m332._outbox
_svc, _owner, _fails = m332._svc, m332._owner, m332._fails
_psql_all, _catalog = m361._psql_all, m361._catalog


def _do_blocks(code: str) -> list[str]:
    return re.findall(r"DO \$\$(.*?)END \$\$;", code, flags=re.S)


def _without_strings(code: str) -> str:
    return re.sub(r"'(?:[^']|'')*'", "''", code)


def _qualified(fn: str) -> str:
    """The only change 363 makes to a body: pinned path, pg_catalog. calls."""
    fn = fn.replace("SET search_path = public, pg_temp", PINNED)
    for name in CALLS:
        fn = re.sub(rf"(?<![\w.]){name}\(", f"pg_catalog.{name}(", fn)
    return fn


def _squash(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _unqualified_calls(fn: str) -> list[str]:
    body = m326._strip_comments(fn[fn.index("AS $$"):])
    return [name for name in CALLS if re.search(rf"(?<![\w.]){name}\s*\(", body)]


# ── Static contract ─────────────────────────────────────────────────────────

def test_361_is_unchanged_since_its_merge():
    data = (MIGRATIONS / NAME_361).read_bytes()
    assert hashlib.sha256(data).hexdigest() == MERGED_361_SHA256
    assert hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest() == MERGED_361_BLOB


def test_one_transaction_with_pinned_search_path_lock_timeout_and_no_data_change():
    lines = [line for line in CODE.strip().splitlines() if line.strip()]
    assert lines[:3] == ["BEGIN;", "SET LOCAL search_path = pg_catalog, pg_temp;",
                         "SET LOCAL lock_timeout = '5s';"]
    assert lines[-1] == "COMMIT;" and CODE.count("BEGIN;") == 1 and CODE.count("COMMIT;") == 1
    top = m332._without_bodies(CODE)
    for forbidden in (r"\bDROP\b", r"DELETE\s+FROM", r"\bTRUNCATE\b", r"^\s*UPDATE\s", r"INSERT\s+INTO",
                      r"DISABLE\s+TRIGGER", r"session_replication_role", r"\bPOLICY\b", r"\bGRANT\b",
                      r"\bALTER\b", r"OWNER\s+TO"):
        assert not re.search(forbidden, top, re.M | re.I), forbidden
    for block in _do_blocks(CODE):
        assert not re.search(r"\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|ALTER|DROP)\b", block), block[:80]


def test_bodies_are_361_and_332_with_only_the_path_and_catalog_calls_changed():
    audit_361 = m326._function(m361.SQL, AUDIT_FN)
    record_332 = m326._function(m332.SQL, RECORD_FN)
    assert _unqualified_calls(audit_361) and _unqualified_calls(record_332), "repro precondition"
    audit, record = m326._function(CODE, AUDIT_FN), m326._function(CODE, RECORD_FN)
    assert _squash(audit) == _squash(m326._strip_comments(_qualified(audit_361)))
    assert _squash(record) == _squash(m326._strip_comments(_qualified(record_332)))
    for fn in (audit, record):
        assert PINNED in fn and "search_path = public" not in fn
        assert _unqualified_calls(fn) == []
    assert "SECURITY DEFINER" in audit and "SECURITY DEFINER" not in record
    assert ("REVOKE ALL ON FUNCTION public.fn_users_privilege_audit() "
            "FROM PUBLIC, anon, authenticated, service_role;") in CODE
    assert _squash("REVOKE ALL ON FUNCTION public.fn_staff_security_record(uuid, text, uuid, uuid, text, "
                   "jsonb, jsonb, text, text, jsonb, boolean) FROM PUBLIC, anon, authenticated, "
                   "service_role;") in _squash(CODE)


def test_do_blocks_qualify_every_catalog_function_and_operator():
    """SA-2180-R3-1 applied here: no bare function or operator in the checks."""
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
        assert used - {"||"} <= operators, used
        rest = re.sub(r"OPERATOR\(pg_catalog\.[^)]+\)", " ", bare).replace(":=", " ")
        assert not re.search(r"[=<>~|@!]|->", rest), re.findall(r".{20}[=<>~|@!].{20}", rest)


def test_preconditions_come_first_and_cover_ledger_objects_and_shadowing():
    pre = _do_blocks(CODE)[0]
    assert CODE.index(pre) < CODE.index("CREATE OR REPLACE FUNCTION")
    for marker in ("migration_361_missing: no ledger row", "migration_361_missing: objects",
                   "catalog_name_shadowed_in_public"):
        assert marker in pre, marker
    assert f"m.filename OPERATOR(pg_catalog.=) '{NAME_361}'" in pre
    assert "p.pronamespace OPERATOR(pg_catalog.=) 'public'::regnamespace" in pre
    assert "o.oprnamespace OPERATOR(pg_catalog.=) 'public'::regnamespace" in pre
    for name in (AUDIT_FN, RECORD_SIG, "fn_staff_privilege_evidence_consumed", EVIDENCE,
                 "staff_security_audit", "owner_alert_outbox", "trg_users_privilege_audit"):
        assert name in pre, name


def test_postconditions_cover_path_body_owner_acl_key_and_trigger():
    post = _do_blocks(CODE)[-1]
    assert CODE.index(post) > CODE.rindex("CREATE OR REPLACE FUNCTION")
    for marker in ("staff_audit_search_path_wrong", "staff_privilege_audit_evidence_key_wrong",
                   "staff_security_trigger_missing"):
        assert f"RAISE EXCEPTION '{marker}" in post, marker
    assert "'search_path=pg_catalog, pg_temp'" in post
    assert "|".join(CALLS) in post
    assert "p.proowner OPERATOR(pg_catalog.<>) c.relowner" in post
    for role in ("anon", "authenticated", "service_role"):
        assert f"has_function_privilege('{role}', p.oid, 'EXECUTE')" in post


def test_header_documents_order_scope_and_rollback():
    header = SQL[:SQL.index("\nBEGIN;\n")]
    for needle in ("SA-2180-R3-2", "never edited", "SA probe C", RECORD_FN, "fn_set_staff_privilege",
                   "MIGRATION_FEATURES=admin_aal2", "after 361", "re-run 363 after it",
                   f"rollback/{NAME}", "grants nothing", "catalog_name_shadowed_in_public"):
        assert needle in header, needle


def test_rollback_restores_the_361_and_332_bodies_verbatim_and_grants_nothing():
    code = m326._strip_comments(ROLLBACK)
    assert m326._function(m361.SQL, AUDIT_FN) in ROLLBACK
    assert m326._function(m332.SQL, RECORD_FN) in ROLLBACK
    assert "REOPENS SA-2180-R3-2" in ROLLBACK and "catalog_name_shadowed_in_public" in code
    assert code.count("BEGIN;") == 1 and code.strip().endswith("COMMIT;")
    assert not re.search(r"\bGRANT\b|\bDROP\b|ALTER\s|OWNER\s+TO", code)
    assert code.count("REVOKE ALL ON FUNCTION") == 2


def test_release_metadata_holds_363_behind_the_admin_aal2_group():
    policy = (MIGRATIONS / "forward-policy.tsv").read_text(encoding="utf-8")
    rows = {line.split("\t")[0]: line.split("\t") for line in policy.splitlines()
            if line and not line.startswith("#")}
    assert len(rows[NAME]) == 4 and rows[NAME][1:3] == ["pending_feature", "admin_aal2"]
    assert rows[NAME_361][1:3] == ["pending_feature", "admin_aal2"]
    readme = (MIGRATIONS / "README.md").read_text(encoding="utf-8")
    paragraph = readme[readme.index("Migration `363`"):readme.index("Migration `365`")]
    for needle in ("SA-2180-R3-2", "MIGRATION_FEATURES=admin_aal2", "after SA review", "361 → 363",
                   "migration_361_missing", "catalog_name_shadowed_in_public", "re-run 363",
                   "fn_set_staff_privilege", "grants nothing"):
        assert needle in paragraph, needle


# ── PostgreSQL harness ──────────────────────────────────────────────────────

def _migrated(schema: str, sql: str = SQL) -> str:
    return m331._schema_sql(sql, schema)


def _postcondition_sql(schema: str) -> str:
    return _migrated(schema, SQL[SQL.rindex("DO $$"):SQL.rindex("COMMIT;")])


def _rollback_sql(schema: str) -> str:
    return _migrated(schema, ROLLBACK)


def _build_361(schema: str) -> None:
    """341 applied and recorded, 361 applied and recorded: staging after 361."""
    m361._build(schema)
    m361._apply(schema)
    m361._record(schema, NAME_361)


def _apply(schema: str) -> None:
    _owner(_migrated(schema))


def _drop(schema: str | None) -> None:
    if schema:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


def _schema(prefix: str, *, with_363: bool = True) -> str:
    m332._require_pg()
    schema = prefix + uuid4().hex
    try:
        _build_361(schema)
        if with_363:
            _apply(schema)
    except BaseException:
        _drop(schema)
        raise
    return schema


@pytest.fixture(scope="module")
def db():
    schema = None
    try:
        schema = _schema("pa363_")
        _apply(schema)   # re-applying is a no-op
        yield schema
    finally:
        _drop(schema)


@pytest.fixture
def fresh():
    schema = None
    try:
        schema = _schema("pa363_fresh_")
        yield schema
    finally:
        _drop(schema)


@pytest.fixture
def only_361():
    """361 applied and recorded, 363 not yet: the staging state before 363."""
    schema = None
    try:
        schema = _schema("pa363_pre_", with_363=False)
        yield schema
    finally:
        _drop(schema)


def _proconfig(s: str, sig: str) -> str:
    return psql(f"SELECT COALESCE(array_to_string(proconfig, '|'), '-') FROM pg_proc "
                f"WHERE oid = '{s}.{sig}'::regprocedure")


# Exact typed overloads of every jsonb_build_object call in the two bodies:
# the 361 before/after objects (SA probe C), the bootstrap detail, SA's
# eight-argument probe and the 22-argument owner alert payload of the writer.
_SHADOWS = {
    "audit6": "text, text, text, boolean, text, timestamptz",
    "probe8": "text, text, text, boolean, text, timestamptz, text, text",
    "detail2": "text, text",
    "record22": ", ".join(["text, uuid", "text, text", "text, timestamptz", "text, text", "text, uuid",
                           "text, text", "text, uuid", "text, text", "text, jsonb", "text, jsonb",
                           "text, text"]),
}


def _plant_shadows(s: str) -> None:
    """service_role, given CREATE on the schema as on staging, plants typed
    jsonb_build_object overloads that leave a NOTICE when they run."""
    _owner(f"GRANT CREATE ON SCHEMA {s} TO service_role")
    _svc("".join(
        f"CREATE FUNCTION {s}.jsonb_build_object({args}) RETURNS jsonb LANGUAGE plpgsql AS $$ "
        f"BEGIN RAISE NOTICE 'attacker_called {tag} %', current_user; RETURN '{{}}'::jsonb; END $$; "
        for tag, args in _SHADOWS.items()))
    assert psql(f"SELECT count(*) FROM pg_proc WHERE pronamespace = '{s}'::regnamespace "
                f"AND proname = 'jsonb_build_object' AND pg_get_userbyid(proowner) = 'service_role'") == "4"


def _scenario(s: str) -> tuple[list[str], dict[str, str]]:
    """Every branch of the audit body through the trigger chain, without the
    RPC or bootstrap functions (outside 363): owner and service updates, an
    owner staff insert, and owner updates carrying rpc / bootstrap evidence.
    Returns the psql outputs (NOTICEs included) and the user ids."""
    ids = {name: str(uuid4()) for name in ("actor", "target", "inst1", "inst2", "inst3", "new_admin")}
    outputs = []

    def run(sql: str, *, role: str = "owner") -> None:
        wrapped = f"SET ROLE {OWNER}; {sql}" if role == "owner" else m326._svc(sql)
        rc, out = _psql_all(wrapped)
        assert rc == 0, out
        outputs.append(out)

    for name, role in (("actor", "admin"), ("target", "admin"), ("inst1", "instructor"),
                       ("inst2", "instructor"), ("inst3", "instructor")):
        run(f"INSERT INTO {s}.users (id, email, role, is_active) "
            f"VALUES ('{ids[name]}', '{name}@q363.test', '{role}', true)")
    run(f"UPDATE {s}.users SET is_active = false WHERE id = '{ids['target']}'")        # SA probe C
    run(f"UPDATE {s}.users SET role = 'admin' WHERE id = '{ids['inst1']}'")
    run(f"UPDATE {s}.users SET is_active = false WHERE id = '{ids['inst3']}'", role="service_role")
    run(f"INSERT INTO {s}.users (id, email, role, is_active) "
        f"VALUES ('{ids['new_admin']}', 'new_admin@q363.test', 'admin', true)")
    run(f"""BEGIN;
        INSERT INTO {s}.{EVIDENCE}(target_user_id, kind, audit_id, actor_user_id, reason, request_id)
        VALUES ('{ids['inst2']}', 'rpc', '{ids['inst2'][:-4]}aaaa', '{ids['actor']}', 'rpc reason', 'req-363');
        UPDATE {s}.users SET is_active = false WHERE id = '{ids['inst2']}';
        COMMIT;""")
    run(f"""BEGIN;
        INSERT INTO {s}.{EVIDENCE}(target_user_id, kind, audit_id, reason, operator)
        VALUES ('{ids['target']}', 'bootstrap', '{ids['target'][:-4]}bbbb', 'drill', 'Vinh');
        UPDATE {s}.users SET is_active = true WHERE id = '{ids['target']}';
        COMMIT;""")
    return outputs, ids


def _rows(s: str, ids: dict[str, str]) -> list[tuple[str, str, str]]:
    """Audit + outbox rows per user, ids mapped to names, times dropped."""
    def name(text: str) -> str:
        for key, uid in ids.items():
            text = text.replace(uid, f"<{key}>").replace(uid[:-4], f"<{key}:>")
        return text

    result = []
    for key, uid in ids.items():
        for row in _audit(s, uid):
            if not row["id"].endswith(("aaaa", "bbbb")):   # random unless set by evidence
                row.pop("id")
            result.append((key, "audit", name(json.dumps(row, sort_keys=True))))
        for row in _outbox(s, uid):
            row.pop("audit_id")
            row["payload"].pop("audit_id", None)
            row["payload"].pop("occurred_at", None)
            result.append((key, "outbox", name(json.dumps(row, sort_keys=True))))
    return result


# ── PostgreSQL: SA-2180-R3-2 ────────────────────────────────────────────────

def test_harness_roles_are_nosuperuser():
    m332._require_pg()
    assert psql(f"SELECT count(*) FROM pg_roles WHERE rolname IN "
                f"('anon', 'authenticated', 'service_role', '{OWNER}') AND NOT rolsuper") == "4"


def test_negative_control_361_runs_planted_overloads_as_the_owner(only_361):
    """SA probe C on the merged 361 (red before 363): the definer and its
    writer both run service_role's code as the owner."""
    s = only_361
    _plant_shadows(s)
    outputs, ids = _scenario(s)
    out = "\n".join(outputs)
    for tag in ("audit6", "detail2", "record22"):
        assert f"attacker_called {tag} {OWNER}" in out, (tag, out)
    assert any(row[1] == "audit" and '"before": {}' in row[2] for row in _rows(s, ids))


def test_negative_control_pinning_only_the_audit_leaves_the_writer_open(only_361):
    """Why 363 also pins fn_staff_security_record: it re-opens public."""
    s = only_361
    audit = m326._function(CODE, AUDIT_FN)
    _owner(_migrated(s, "SET search_path = pg_catalog, pg_temp;\n" + audit))
    assert _proconfig(s, f"{AUDIT_FN}()") == "search_path=pg_catalog, pg_temp"
    _plant_shadows(s)
    out = "\n".join(_scenario(s)[0])
    assert "attacker_called audit6" not in out and "attacker_called detail2" not in out
    assert f"attacker_called record22 {OWNER}" in out, out


def test_planted_overloads_never_run_after_363_and_rows_match_361(only_361, fresh):
    """The same scenario writes the same audit and outbox rows on a clean 361
    schema and on a 363 schema with every shadow planted, and no NOTICE."""
    reference_out, reference_ids = _scenario(only_361)
    assert "attacker_called" not in "\n".join(reference_out)
    expected = _rows(only_361, reference_ids)
    # 6 staff inserts + 5 changes; the alert rows are the admin ones.
    assert len([row for row in expected if row[1] == "audit"]) == 11
    _plant_shadows(fresh)
    outputs, ids = _scenario(fresh)
    out = "\n".join(outputs)
    assert "attacker_called" not in out, out
    assert _rows(fresh, ids) == expected
    assert psql(f"SELECT count(*) FROM {fresh}.{EVIDENCE}") == "0"


def test_sa_probe_c_owner_update_after_363(fresh):
    """SA retest recipe: probe C verbatim (6- and 8-argument overloads)."""
    s = fresh
    _plant_shadows(s)
    _user(s, "admin", True)
    b = _user(s, "admin", True)
    rc, out = _psql_all(f"SET ROLE {OWNER}; UPDATE {s}.users SET is_active = false WHERE id = '{b}';")
    assert rc == 0 and "attacker_called" not in out, out
    row = _audit(s, b)[-1]
    assert row["event"] == "active_changed" and row["source"] == "out_of_band"
    assert row["before"] == {"role": "admin", "is_active": True, "suspended_at": None}
    assert row["after"] == {"role": "admin", "is_active": False, "suspended_at": None}
    payload = _outbox(s, b)[-1]["payload"]
    assert payload["target_email"].startswith(b) and payload["before"] == row["before"]


def test_definer_identity_owner_and_acl_are_unchanged(only_361, db):
    def facts(s: str) -> list[str]:
        return [psql(f"SELECT prosecdef::text || '|' || pg_get_userbyid(proowner) || '|' || "
                     f"COALESCE(proacl::text, '-') FROM pg_proc WHERE oid = '{s}.{sig}'::regprocedure")
                for sig in (f"{AUDIT_FN}()", RECORD_SIG)]

    assert facts(db) == facts(only_361)
    assert facts(db)[0].startswith(f"true|{OWNER}|") and facts(db)[1].startswith(f"false|{OWNER}|")
    for sig in (f"{AUDIT_FN}()", RECORD_SIG):
        assert _proconfig(only_361, sig) == "search_path=public, pg_temp".replace("public", only_361)
        assert _proconfig(db, sig) == "search_path=pg_catalog, pg_temp"
        for role in ("anon", "authenticated", "service_role"):
            assert psql(f"SELECT has_function_privilege('{role}', '{db}.{sig}', 'EXECUTE')") == "f"


# ── PostgreSQL: release paths and idempotency ───────────────────────────────

def test_staging_path_applies_on_top_of_361_with_history_and_reruns_as_a_no_op(only_361):
    s = only_361
    _, ids = _scenario(s)
    history = _rows(s, ids)
    _apply(s)
    assert _rows(s, ids) == history
    _owner(_postcondition_sql(s))
    snapshot = _catalog(s, oids=True)
    _apply(s)
    assert _catalog(s, oids=True) == snapshot, "second run must change nothing"


def test_production_path_runs_341_361_363_back_to_back_and_matches_staging(fresh):
    schema = "pa363_prod_" + uuid4().hex
    try:
        m361._build(schema, with_341=False, ledger=False)
        ledger = (f"CREATE TABLE IF NOT EXISTS {schema}._schema_migrations (filename text PRIMARY KEY, "
                  f"applied_at timestamptz NOT NULL DEFAULT now());\n")
        _owner(f"{m341._migrated(schema)}\n{ledger}"
               f"INSERT INTO {schema}._schema_migrations (filename) VALUES ('{m361.NAME_341}');\n"
               f"{m361._migrated(schema)}\n"
               f"INSERT INTO {schema}._schema_migrations (filename) VALUES ('{NAME_361}');\n"
               f"{_migrated(schema)}")
        assert _catalog(schema, oids=False) == _catalog(fresh, oids=False)
        snapshot = _catalog(schema, oids=True)
        _apply(schema)
        assert _catalog(schema, oids=True) == snapshot
    finally:
        _drop(schema)


@pytest.mark.parametrize("rerun", ["332", "341", "361"])
def test_rerunning_an_older_body_is_caught_and_363_restores_the_pin(fresh, rerun):
    s = fresh
    if rerun == "332":
        _owner(_migrated(s, m326._function(m332.SQL, RECORD_FN)))
        changed = RECORD_SIG
    else:
        _owner((m341._migrated if rerun == "341" else m361._migrated)(s))
        changed = f"{AUDIT_FN}()"
    assert _proconfig(s, changed) != "search_path=pg_catalog, pg_temp"
    error = _fails(_owner, _postcondition_sql(s))
    assert "staff_audit_search_path_wrong" in error and changed.split("(")[0] in error, error
    _apply(s)
    _owner(_postcondition_sql(s))
    assert _proconfig(s, changed) == "search_path=pg_catalog, pg_temp"


# ── PostgreSQL: preconditions ───────────────────────────────────────────────

def _unchanged_361(s: str) -> None:
    if psql(f"SELECT to_regprocedure('{s}.{AUDIT_FN}()') IS NOT NULL") == "t":
        assert _proconfig(s, f"{AUDIT_FN}()") != "search_path=pg_catalog, pg_temp"
    if psql(f"SELECT to_regprocedure('{s}.{RECORD_SIG}') IS NOT NULL") == "t":
        assert _proconfig(s, RECORD_SIG) != "search_path=pg_catalog, pg_temp"


@pytest.mark.parametrize("state,marker", [
    ("no_ledger", "migration_361_missing: no ledger row"),
    ("ledger_without_361", "migration_361_missing: no ledger row"),
    ("361_recorded_not_applied", "migration_361_missing: objects"),
])
def test_precondition_requires_361_recorded_and_applied(state, marker):
    m332._require_pg()
    schema = "pa363_noprereq_" + uuid4().hex
    try:
        m361._build(schema, ledger=state != "no_ledger")
        if state == "ledger_without_361":
            m361._record(schema, "360_instructor_writing_give_idempotency.sql")
        elif state == "361_recorded_not_applied":
            m361._record(schema, NAME_361)
        assert marker in _fails(_owner, _migrated(schema))
        _unchanged_361(schema)
    finally:
        _drop(schema)


@pytest.mark.parametrize("path", ["{s}", "{s}, pg_catalog", "pg_catalog, pg_temp"])
def test_precondition_refuses_a_planted_shadow_without_running_it(only_361, path):
    s = only_361
    _plant_shadows(s)
    rc, out = _psql_all(f"SET ROLE {OWNER}; SET search_path = {path.format(s=s)}; {_migrated(s)}")
    assert rc != 0 and "catalog_name_shadowed_in_public: function jsonb_build_object" in out, out
    assert "attacker_called" not in out, out
    _unchanged_361(s)


def test_precondition_refuses_a_planted_operator(only_361):
    s = only_361
    _owner(f"GRANT CREATE ON SCHEMA {s} TO service_role")
    _svc(f"CREATE FUNCTION {s}.pa363_eq(name, text) RETURNS boolean LANGUAGE sql AS 'SELECT true'; "
         f"CREATE OPERATOR {s}.= (LEFTARG = name, RIGHTARG = text, FUNCTION = {s}.pa363_eq);")
    assert "catalog_name_shadowed_in_public: operator =" in _fails(_owner, _migrated(s))
    _unchanged_361(s)


# ── PostgreSQL: postconditions ──────────────────────────────────────────────

_AUDIT = f"FUNCTION {{s}}.{AUDIT_FN}()"
_RECORD = f"FUNCTION {{s}}.{RECORD_SIG}"
# (tamper, repaired by re-applying 363, marker)
_DRIFT = [
    (f"ALTER {_AUDIT} SET search_path = public, pg_temp", True, "staff_audit_search_path_wrong"),
    (f"ALTER {_AUDIT} SET search_path = pg_catalog, public, pg_temp", True, "staff_audit_search_path_wrong"),
    (f"ALTER {_AUDIT} RESET search_path", True, "staff_audit_search_path_wrong"),
    (f"ALTER {_RECORD} SET search_path = public, pg_temp", True, "staff_audit_search_path_wrong"),
    (f"ALTER {_RECORD} RESET search_path", True, "staff_audit_search_path_wrong"),
    (f"ALTER {_AUDIT} SECURITY INVOKER", True, "staff_audit_search_path_wrong"),
    (f"ALTER {_RECORD} SECURITY DEFINER", True, "staff_audit_search_path_wrong"),
    *[(f"GRANT EXECUTE ON {fn} TO {role}", True, "staff_audit_search_path_wrong")
      for fn in (_AUDIT, _RECORD) for role in ("PUBLIC", "anon", "authenticated", "service_role")],
    ("ALTER TABLE {s}.users DISABLE TRIGGER trg_users_privilege_audit", False,
     "staff_security_trigger_missing"),
    ("ALTER TABLE {s}.users ENABLE REPLICA TRIGGER trg_users_privilege_audit", False,
     "staff_security_trigger_missing"),
]


@pytest.mark.parametrize("tamper,repaired,marker", _DRIFT)
def test_postcondition_aborts_on_drift(fresh, tamper, repaired, marker):
    s = fresh
    _owner(_postcondition_sql(s))   # clean state passes
    _owner(tamper.format(s=s))
    assert marker in _fails(_owner, _postcondition_sql(s))
    if repaired:
        _apply(s)
    else:
        assert marker in _fails(_owner, _migrated(s))
        _owner(f"ALTER TABLE {s}.users ENABLE TRIGGER trg_users_privilege_audit")
    _owner(_postcondition_sql(s))


@pytest.mark.parametrize("fn", [AUDIT_FN, RECORD_FN])
def test_postcondition_refuses_an_unqualified_call_under_the_pinned_path(fresh, fn):
    s = fresh
    source = m361.SQL if fn == AUDIT_FN else m332.SQL
    body = m326._function(source, fn).replace("SET search_path = public, pg_temp", PINNED)
    _owner(_migrated(s, body))
    error = _fails(_owner, _postcondition_sql(s))
    assert "staff_audit_search_path_wrong" in error and fn in error, error
    _apply(s)
    _owner(_postcondition_sql(s))


def test_postcondition_refuses_the_new_id_evidence_key(fresh):
    s = fresh
    audit = m326._function(CODE, AUDIT_FN).replace("e.target_user_id = OLD.id", "e.target_user_id = NEW.id")
    _owner(_migrated(s, audit))
    assert "staff_privilege_audit_evidence_key_wrong" in _fails(_owner, _postcondition_sql(s))
    _apply(s)


def test_postcondition_refuses_a_writer_that_does_not_own_the_audit_table(fresh):
    s = fresh
    psql("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pa363_other') THEN "
         "CREATE ROLE pa363_other NOSUPERUSER NOLOGIN; END IF; END $$;")
    psql(f"ALTER FUNCTION {s}.{RECORD_SIG} OWNER TO pa363_other")
    try:
        error = _fails(psql, _postcondition_sql(s))
        assert "staff_audit_search_path_wrong" in error and RECORD_FN in error, error
    finally:
        psql(f"ALTER FUNCTION {s}.{RECORD_SIG} OWNER TO {OWNER}; "
             f"REVOKE ALL ON FUNCTION {s}.{RECORD_SIG} FROM pa363_other")
    _owner(_postcondition_sql(s))


def test_postcondition_ignores_planted_overloads_and_operators(fresh):
    """A shadow planted after 363 never runs in its checks, on any path."""
    s = fresh
    _plant_shadows(s)
    _svc(f"CREATE FUNCTION {s}.pa363_ne(oid, oid) RETURNS boolean LANGUAGE plpgsql AS $$ "
         f"BEGIN RAISE NOTICE 'attacker_called ne %', current_user; RETURN false; END $$; "
         f"CREATE OPERATOR {s}.<> (LEFTARG = oid, RIGHTARG = oid, FUNCTION = {s}.pa363_ne);")
    _owner(f"ALTER FUNCTION {s}.{RECORD_SIG} SET search_path = public, pg_temp")
    for path in (f"{s}", f"{s}, pg_catalog"):
        rc, out = _psql_all(f"SET ROLE {OWNER}; SET search_path = {path}; {_postcondition_sql(s)}")
        assert rc != 0 and "staff_audit_search_path_wrong" in out, out
        assert "attacker_called" not in out, out


# ── PostgreSQL: rollback ────────────────────────────────────────────────────

def test_rollback_restores_the_361_catalog_reopens_r3_2_and_363_reapplies(fresh, only_361):
    s = fresh
    _owner(_rollback_sql(s))
    assert _catalog(s, oids=False) == _catalog(only_361, oids=False)
    _plant_shadows(s)   # negative control: the hole is open again
    out = "\n".join(_scenario(s)[0])
    assert f"attacker_called record22 {OWNER}" in out and f"attacker_called audit6 {OWNER}" in out
    psql(f"DROP FUNCTION {s}.jsonb_build_object({_SHADOWS['audit6']}), "
         f"{s}.jsonb_build_object({_SHADOWS['probe8']}), {s}.jsonb_build_object({_SHADOWS['detail2']}), "
         f"{s}.jsonb_build_object({_SHADOWS['record22']})")
    _apply(s)
    _owner(_postcondition_sql(s))


def test_rollback_refuses_while_a_shadow_is_planted(fresh):
    s = fresh
    _plant_shadows(s)
    rc, out = _psql_all(f"SET ROLE {OWNER}; {_rollback_sql(s)}")
    assert rc != 0 and "catalog_name_shadowed_in_public: jsonb_build_object" in out, out
    assert _proconfig(s, f"{AUDIT_FN}()") == "search_path=pg_catalog, pg_temp"


# ── PostgreSQL: the 332, 336, 341 and 361 suites on the 363 schema ──────────

# As in the 361 suite: 332's trigger-list catalog test predates 336; 341's and
# 361's own pre/postcondition, rollback and re-apply tests drive their own
# files. Two more are the contract 363 changes on purpose: 332's postcondition
# (every drift case runs it on the clean schema first) and 341's catalog test
# pin search_path = public, pg_temp on fn_users_privilege_audit and
# fn_staff_security_record. 363's own postcondition and drift tests check
# those two functions instead (pinned path, definer mode, owner, EXECUTE);
# the other 332/341 objects are untouched by 363 and stay covered by the
# 332, 341 and 361 suites on their own schemas.
_NOT_RERUN = {
    m332: {"test_catalog_after_apply_and_rerun", "test_postcondition_block_aborts_on_drift"},
    m341: {"test_header_rollback_reopens_f1_and_341_reapplies", "test_catalog_after_apply_and_rerun"},
    m361: {"test_rerunning_341_after_361_is_caught_and_361_restores_old_id",
           "test_header_rollback_reopens_p3_2_grants_nothing_and_361_reapplies"},
}


def _rerun(module, prefix: str) -> None:
    for name, fn in inspect.getmembers(module, inspect.isfunction):
        params = set(inspect.signature(fn).parameters)
        if (name.startswith("test_") and fn.__module__ == module.__name__
                and params & {"db", "fresh"} and name not in _NOT_RERUN.get(module, set())
                and not (module in (m341, m361) and name.startswith("test_postcondition_"))):
            globals()[f"test_{prefix}_{name[5:]}"] = fn


_rerun(m332, "rerun332")
_rerun(m336, "rerun336")
_rerun(m341, "rerun341")
_rerun(m361, "rerun361")
