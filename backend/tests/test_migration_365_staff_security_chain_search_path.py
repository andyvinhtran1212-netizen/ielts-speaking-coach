"""Migration 365 (PC-J603): search_path pin on the rest of the staff-security chain.

SA-2209 (residual P2 after 363): fn_set_staff_privilege (SECURITY DEFINER,
EXECUTE for service_role), fn_ai_model_override_audit (SECURITY DEFINER
trigger), the 332/336 guards, the bootstrap and the 332 append-only trigger
kept search_path = public, pg_temp and called catalog functions without a
schema. A role with CREATE on public could plant an exact typed overload
(jsonb_build_object, format) that beats the catalog's VARIADIC "any" version
and runs as the function owner, through the RPC that same role may call.

The static half compares the five recreated bodies with the 341/332 bodies
they replace, checks the one ALTER and that the DO blocks qualify every
function and operator. The PostgreSQL half reuses the 363 harness
(NOSUPERUSER owner, Supabase default privileges, 322, 332, 336, 341, 361,
363), applies 365 (twice) and proves: the repro on 363 (red), the same
planted overloads never running after 365 with audit/outbox/override rows
unchanged, catalog before/after, both release paths, the precondition and
postcondition aborts, the rollback, and the 332/336/341/361/363 behaviour
suites re-run on the 365 schema.

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
import test_migration_336_suspended_account_role_guard as m336
import test_migration_341_staff_guc_and_ai_override_hardening as m341
import test_migration_361_staff_privilege_evidence_commit_guard as m361
import test_migration_363_users_privilege_audit_search_path as m363
from test_migration_240_core_attempt_evidence import psql

BACKEND = Path(__file__).resolve().parents[1]
MIGRATIONS = BACKEND / "migrations"
NAME = "365_staff_security_chain_search_path.sql"
SQL = (MIGRATIONS / NAME).read_text(encoding="utf-8")
CODE = m326._strip_comments(SQL)
ROLLBACK = (MIGRATIONS / "rollback" / NAME).read_text(encoding="utf-8")
NAME_361, NAME_363 = m361.NAME, m363.NAME
OWNER = m332.OWNER
EVIDENCE = m341.EVIDENCE
PINNED = "SET search_path = pg_catalog, pg_temp"
CALLS = ("btrim", "char_length", "current_setting", "format", "gen_random_uuid", "has_table_privilege",
         "jsonb_build_object", "now", "pg_advisory_xact_lock", "pg_current_xact_id")
# Recreated with a qualified body: name -> (source migration, signature, SECURITY DEFINER).
RECREATED = {
    "fn_users_suspension_guard": (m341.SQL, "fn_users_suspension_guard()", False),
    "fn_users_suspension_role_guard": (m341.SQL, "fn_users_suspension_role_guard()", False),
    "fn_set_staff_privilege": (m341.SQL, "fn_set_staff_privilege(uuid,uuid,text,boolean,text,text)", True),
    "fn_bootstrap_admin_recovery": (m341.SQL, "fn_bootstrap_admin_recovery(uuid,text,text)", False),
    "fn_staff_security_audit_append_only": (m332.SQL, "fn_staff_security_audit_append_only()", False),
}
AI_AUDIT = "fn_ai_model_override_audit"
SIGS = [sig for _, sig, _ in RECREATED.values()] + [f"{AI_AUDIT}()"]
RPC_SIG = RECREATED["fn_set_staff_privilege"][1]
ALTER = f"ALTER FUNCTION public.{AI_AUDIT}() SET search_path = pg_catalog, pg_temp;"

_user, _audit, _outbox = m332._user, m332._audit, m332._outbox
_svc, _owner, _fails = m332._svc, m332._owner, m332._fails
_psql_all, _catalog, _proconfig = m361._psql_all, m361._catalog, m363._proconfig
_do_blocks, _without_strings, _squash = m363._do_blocks, m363._without_strings, m363._squash


def _qualified(fn: str) -> str:
    """The only change 365 makes to a body: pinned path, pg_catalog. calls."""
    fn = fn.replace("SET search_path = public, pg_temp", PINNED)
    for name in CALLS:
        fn = re.sub(rf"(?<![\w.]){name}\(", f"pg_catalog.{name}(", fn)
    return fn


def _unqualified_calls(fn: str) -> list[str]:
    body = m326._strip_comments(fn[fn.index("AS $$"):])
    return [name for name in CALLS if re.search(rf"(?<![\w.]){name}\s*\(", body)]


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
                      r"OWNER\s+TO", r"SECURITY\s+(DEFINER|INVOKER)\s*;", r"CREATE\s+(OR\s+REPLACE\s+)?TRIGGER"):
        assert not re.search(forbidden, top, re.M | re.I), forbidden
    for block in _do_blocks(CODE):
        assert not re.search(r"\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|ALTER|DROP)\b", block), block[:80]


def test_bodies_are_341_and_332_with_only_the_path_and_catalog_calls_changed():
    for name, (source, _sig, definer) in RECREATED.items():
        old = m326._function(source, name)
        assert _unqualified_calls(old), f"repro precondition: {name}"
        new = m326._function(CODE, name)
        assert _squash(new) == _squash(m326._strip_comments(_qualified(old))), name
        assert PINNED in new and "search_path = public" not in new and _unqualified_calls(new) == []
        assert ("SECURITY DEFINER" in new) is definer and ("SECURITY DEFINER" in old) is definer, name
    assert len(re.findall(r"CREATE OR REPLACE FUNCTION", CODE)) == len(RECREATED)
    # fn_ai_model_override_audit calls no function: only its path changes.
    ai_341 = m326._function(m341.SQL, AI_AUDIT)
    assert "SECURITY DEFINER" in ai_341 and not re.search(r"(?<![\w.])[a-z_]+\s*\(", _without_strings(
        m326._strip_comments(ai_341[ai_341.index("AS $$"):])).replace("public.ai_model_override_audit (", ""))
    assert f"FUNCTION public.{AI_AUDIT}()" not in CODE.replace(ALTER, "").replace(
        f"REVOKE ALL ON FUNCTION public.{AI_AUDIT}()", "")


def test_acls_are_restated_and_service_role_keeps_only_the_rpc():
    code = _squash(CODE)
    for name in ("fn_users_suspension_guard()", "fn_users_suspension_role_guard()",
                 "fn_bootstrap_admin_recovery(uuid, text, text)", "fn_staff_security_audit_append_only()",
                 f"{AI_AUDIT}()"):
        assert f"REVOKE ALL ON FUNCTION public.{name} FROM PUBLIC, anon, authenticated, service_role;" in code
    assert ("REVOKE ALL ON FUNCTION public.fn_set_staff_privilege(uuid, uuid, text, boolean, text, text) "
            "FROM PUBLIC, anon, authenticated;") in code
    assert code.count("REVOKE ALL ON FUNCTION") == 6


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


def test_preconditions_come_first_and_cover_ledger_363_pin_objects_and_shadowing():
    pre = _do_blocks(CODE)[0]
    assert CODE.index(pre) < CODE.index("CREATE OR REPLACE FUNCTION")
    for marker in ("migration_363_missing: no ledger row", "migration_363_missing: objects",
                   "migration_363_missing: fn_users_privilege_audit", "catalog_name_shadowed_in_public"):
        assert marker in pre, marker
    assert f"'{NAME_361}'" in pre and f"'{NAME_363}'" in pre
    assert "p.pronamespace OPERATOR(pg_catalog.=) 'public'::regnamespace" in pre
    assert "o.oprnamespace OPERATOR(pg_catalog.=) 'public'::regnamespace" in pre
    for sig in SIGS + [m363.RECORD_SIG, "fn_users_privilege_audit()"]:
        assert f"'public.{sig}'" in pre, sig


def test_postconditions_cover_path_body_mode_owner_acl_and_triggers():
    post = _do_blocks(CODE)[-1]
    assert CODE.index(post) > CODE.rindex("CREATE OR REPLACE FUNCTION") and CODE.index(post) > CODE.index(ALTER)
    for marker in ("staff_chain_search_path_wrong", "staff_security_trigger_missing"):
        assert f"RAISE EXCEPTION '{marker}" in post, marker
    assert "'search_path=pg_catalog, pg_temp'" in post and "|".join(CALLS) in post
    for sig in SIGS:
        assert f"'public.{sig}'" in post, sig
    for trigger in ("trg_users_suspension_guard", "trg_users_suspension_role_guard",
                    "trg_staff_security_audit_append_only", "trg_staff_security_audit_no_truncate",
                    "trg_ai_model_override_audit"):
        assert f"'{trigger}'" in post, trigger
    assert "p.proowner OPERATOR(pg_catalog.<>) c.relowner" in post
    for role in ("anon", "authenticated"):
        assert f"has_function_privilege('{role}', p.oid, 'EXECUTE')" in post
    assert "has_function_privilege('service_role', p.oid, 'EXECUTE') OPERATOR(pg_catalog.<>) f.service_exec" in post


def test_header_documents_scope_order_and_rollback():
    header = SQL[:SQL.index("\nBEGIN;\n")]
    for needle in ("SA-2209", "never edited", "364 is held by PC-J544", "fn_set_staff_privilege",
                   AI_AUDIT, "MIGRATION_FEATURES=admin_aal2", "after 363", "re-run 361, 363 and 365",
                   f"rollback/{NAME}", "grants nothing", "catalog_name_shadowed_in_public",
                   "326, 331, 333, 337, 339 and 340"):
        assert needle in header, needle


def test_rollback_restores_the_341_and_332_bodies_verbatim_and_grants_nothing():
    code = m326._strip_comments(ROLLBACK)
    for name, (source, _sig, _definer) in RECREATED.items():
        assert m326._function(source, name) in ROLLBACK, name
    assert f"ALTER FUNCTION public.{AI_AUDIT}() SET search_path = public, pg_temp;" in code
    assert "REOPENS SA-2209" in ROLLBACK and "catalog_name_shadowed_in_public" in code
    assert code.count("BEGIN;") == 1 and code.strip().endswith("COMMIT;")
    assert not re.search(r"\bGRANT\b|\bDROP\b|OWNER\s+TO", code)
    assert len(re.findall(r"\bALTER\b", code)) == 1
    assert _squash(code).count("REVOKE ALL ON FUNCTION") == 6
    assert "FROM PUBLIC, anon, authenticated;" in _squash(code)   # RPC keeps service_role


def test_release_metadata_holds_365_behind_the_admin_aal2_group():
    policy = (MIGRATIONS / "forward-policy.tsv").read_text(encoding="utf-8")
    rows = {line.split("\t")[0]: line.split("\t") for line in policy.splitlines()
            if line and not line.startswith("#")}
    assert len(rows[NAME]) == 4 and rows[NAME][1:3] == ["pending_feature", "admin_aal2"]
    assert rows[NAME_363][1:3] == ["pending_feature", "admin_aal2"]
    assert [row[:3] for name, row in rows.items() if name.startswith("364_")] == [[
        "364_service_role_table_maintenance_revoke.sql", "pending_feature",
        "service_role_table_maintenance_revoke",
    ]]
    readme = (MIGRATIONS / "README.md").read_text(encoding="utf-8")
    paragraph = readme[readme.index("Migration `365`"):readme.index("Migration `363`")]
    for needle in ("SA-2209", "MIGRATION_FEATURES=admin_aal2", "after SA review", "361 → 363 → 365",
                   "migration_363_missing", "catalog_name_shadowed_in_public", "re-run",
                   "fn_set_staff_privilege", AI_AUDIT, "grants nothing"):
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


def _schema(prefix: str, *, with_365: bool = True) -> str:
    """341, 361 and 363 applied, 361 and 363 recorded: staging after 363."""
    m332._require_pg()
    schema = prefix + uuid4().hex
    try:
        m363._build_361(schema)
        m363._apply(schema)
        m361._record(schema, NAME_363)
        if with_365:
            _apply(schema)
    except BaseException:
        _drop(schema)
        raise
    return schema


@pytest.fixture(scope="module")
def db():
    schema = None
    try:
        schema = _schema("pa365_")
        _apply(schema)   # re-applying is a no-op
        yield schema
    finally:
        _drop(schema)


@pytest.fixture
def fresh():
    schema = None
    try:
        schema = _schema("pa365_fresh_")
        yield schema
    finally:
        _drop(schema)


@pytest.fixture
def only_363():
    """363 applied and recorded, 365 not yet: the staging state before 365."""
    schema = None
    try:
        schema = _schema("pa365_pre_", with_365=False)
        yield schema
    finally:
        _drop(schema)


# The 363 overloads (jsonb_build_object: the RPC and bootstrap before/after
# objects are SA's six-argument audit6, the bootstrap detail is detail2) plus
# format(text, text), which beats format(text, VARIADIC "any") in the
# append-only trigger. Every other catalog call in the bodies has an exact
# pg_catalog signature, which pg_catalog (searched first) always wins.
_FORMAT = "format(text, text)"


def _plant_shadows(s: str) -> None:
    m363._plant_shadows(s)
    _svc(f"CREATE FUNCTION {s}.{_FORMAT} RETURNS text LANGUAGE plpgsql AS $$ "
         f"BEGIN RAISE NOTICE 'attacker_called format %', current_user; RETURN 'x'; END $$;")


def _drop_shadows(s: str) -> None:
    psql(f"DROP FUNCTION {s}.{_FORMAT}, " + ", ".join(
        f"{s}.jsonb_build_object({args})" for args in m363._SHADOWS.values()))


def _scenario(s: str) -> tuple[list[str], dict[str, str]]:
    """Every function 365 changes, called the way the backend and the runbook
    call them: the bootstrap (owner), the RPC (service_role: suspend,
    reactivate, role change, no-op, refusals), the guards refusing a direct
    owner write, the append-only trigger refusing an owner UPDATE, and the
    override audit through the service_role upsert. Returns the psql outputs
    (NOTICEs included) and the user ids."""
    ids = {name: str(uuid4()) for name in ("boot", "inst1", "inst2", "inst3")}
    outputs = []

    def run(sql: str, *, role: str = "owner", error: str | None = None) -> None:
        wrapped = f"SET ROLE {OWNER}; {sql}" if role == "owner" else m326._svc(sql)
        rc, out = _psql_all(wrapped)
        assert (rc == 0) if error is None else (rc != 0 and error in out), out
        outputs.append(out)

    for name in ids:
        run(f"INSERT INTO {s}.users (id, email, role, is_active) "
            f"VALUES ('{ids[name]}', '{name}@q365.test', 'instructor', true)")
    run(m332._bootstrap_sql(s, ids["boot"], operator=" Vinh ", reason="drill 365"))
    rpc = m332._rpc_sql
    run(rpc(s, ids["boot"], ids["inst1"], active=False, reason=" lost laptop ", request="req-365-a"),
        role="service_role")
    run(f"UPDATE {s}.users SET is_active = true WHERE id = '{ids['inst1']}'", error="account_suspended")
    run(f"UPDATE {s}.users SET role = 'admin' WHERE id = '{ids['inst1']}'",
        error="account_suspended_role_change")
    run(rpc(s, ids["boot"], ids["inst1"], active=True, reason="back from leave", request="req-365-b"),
        role="service_role")
    run(rpc(s, ids["boot"], ids["inst2"], role="admin", reason=None, request="req-365-c"), role="service_role")
    run(rpc(s, ids["boot"], ids["inst2"], role="admin", reason=None), role="service_role")   # no change
    run(rpc(s, ids["boot"], ids["boot"], role="student"), role="service_role", error="self_change_forbidden")
    run(rpc(s, ids["inst3"], ids["inst2"], role="student"), role="service_role", error="actor_not_admin")
    run(f"UPDATE {s}.staff_security_audit SET reason = 'x' WHERE target_user_id = '{ids['inst1']}'",
        error="staff_security_audit_append_only")
    feature = "f365_" + ids["boot"][:8]
    upsert = (f"INSERT INTO {s}.ai_model_overrides (feature, preferred_provider, anthropic_model, updated_by) "
              f"VALUES ('{feature}', '{{p}}', {{m}}, '{ids['boot']}') ON CONFLICT (feature) DO UPDATE SET "
              f"preferred_provider = EXCLUDED.preferred_provider, anthropic_model = EXCLUDED.anthropic_model, "
              f"updated_by = EXCLUDED.updated_by, updated_at = now()")
    run(upsert.format(p="gemini", m="NULL"), role="service_role")
    run(upsert.format(p="anthropic", m="'claude-haiku-5-5'"), role="service_role")
    run(f"DELETE FROM {s}.ai_model_overrides WHERE feature = '{feature}'", role="service_role")
    ids["feature"] = feature
    return outputs, ids


def _rows(s: str, ids: dict[str, str]) -> list:
    users = {key: uid for key, uid in ids.items() if key != "feature"}
    # suspended_at is now() of the call: compare set / not set.
    rows = [(key, kind, re.sub(r'"suspended_at": "[^"]+"', '"suspended_at": "<set>"', text))
            for key, kind, text in m363._rows(s, users)]
    rows.append(psql(f"SELECT string_agg(action || ':' || COALESCE(old_preferred_provider, '-') || ':' || "
                     f"COALESCE(new_preferred_provider, '-') || ':' || COALESCE(new_anthropic_model, '-') || ':' "
                     f"|| (changed_by IS NOT NULL)::text, ',' ORDER BY id) "
                     f"FROM {s}.ai_model_override_audit WHERE feature = '{ids['feature']}'"))
    return rows


def _facts(s: str) -> list[str]:
    return [psql(f"SELECT prosecdef::text || '|' || pg_get_userbyid(proowner) || '|' || "
                 f"COALESCE(proacl::text, '-') FROM pg_proc WHERE oid = '{s}.{sig}'::regprocedure")
            for sig in SIGS]


def _prosrc(s: str, sig: str) -> str:
    return psql(f"SELECT prosrc FROM pg_proc WHERE oid = '{s}.{sig}'::regprocedure")


def _unpinned(s: str) -> None:
    for sig in SIGS:
        assert _proconfig(s, sig) != "search_path=pg_catalog, pg_temp", sig


# ── PostgreSQL: SA-2209 ─────────────────────────────────────────────────────

def test_harness_roles_are_nosuperuser():
    m332._require_pg()
    assert psql(f"SELECT count(*) FROM pg_roles WHERE rolname IN "
                f"('anon', 'authenticated', 'service_role', '{OWNER}') AND NOT rolsuper") == "4"


def test_negative_control_363_runs_planted_overloads_as_the_owner(only_363):
    """SA-2209 on the 363 schema (red before 365): service_role plants the
    overload and calls the RPC, which runs it as the owner; the bootstrap and
    the append-only trigger do the same."""
    s = only_363
    _plant_shadows(s)
    outputs, _ = _scenario(s)
    rpc = "\n".join(out for out in outputs if "attacker_called" in out)
    assert f"attacker_called audit6 {OWNER}" in rpc, rpc
    assert f"attacker_called format {OWNER}" in rpc, rpc
    # The suspend call alone (service_role -> definer RPC) is enough.
    assert f"attacker_called audit6 {OWNER}" in outputs[5], outputs[5]


def test_planted_overloads_never_run_after_365_and_rows_match_363(only_363, fresh):
    """The same scenario writes the same audit, outbox and override rows on a
    clean 363 schema and on a 365 schema with every shadow planted, and no
    planted function runs."""
    reference_out, reference_ids = _scenario(only_363)
    assert "attacker_called" not in "\n".join(reference_out)
    expected = _rows(only_363, reference_ids)
    assert expected[-1] == "insert:-:gemini:-:true,update:gemini:anthropic:claude-haiku-5-5:true,delete:anthropic:-:-:false"
    events = [json.loads(row[2])["event"] for row in expected[:-1] if row[1] == "audit"]
    assert events.count("bootstrap_recovery") == 1 and events.count("active_changed") == 2
    assert events.count("role_changed") == 1
    _plant_shadows(fresh)
    outputs, ids = _scenario(fresh)
    out = "\n".join(outputs)
    assert "attacker_called" not in out, out
    assert _rows(fresh, ids) == expected
    assert psql(f"SELECT count(*) FROM {fresh}.{EVIDENCE}") == "0"


def test_rpc_as_service_role_with_planted_overloads_after_365(fresh):
    """SA retest recipe: the #2209 RPC probe (service_role plants audit6 and
    calls fn_set_staff_privilege) on the 365 schema."""
    s = fresh
    _plant_shadows(s)
    actor, target = _user(s, "admin", True), _user(s, "instructor", True)
    rc, out = _psql_all(m326._svc(m332._rpc_sql(s, actor, target, active=False, reason="probe 365")))
    assert rc == 0 and "attacker_called" not in out, out
    result = json.loads(out.strip().splitlines()[-1])
    assert result["changed"] is True
    assert result["before"] == {"role": "instructor", "is_active": True, "suspended_at": None}
    assert result["after"]["is_active"] is False and result["after"]["suspended_at"] is not None
    row = _audit(s, target)[-1]
    assert (row["id"], row["source"], row["actor"]) == (result["audit_id"], "admin_api", actor)


def test_catalog_before_after_changes_only_the_path_and_qualification(only_363, db):
    """Owner, security mode and ACL of the six functions are identical; every
    other function, trigger and relation ACL of the schema is untouched; the
    live bodies differ only by pg_catalog. and whitespace."""
    assert _facts(db) == _facts(only_363)
    for sig, fact in zip(SIGS, _facts(db)):
        definer = sig.startswith(("fn_set_staff_privilege", AI_AUDIT))
        assert fact.startswith(f"{str(definer).lower()}|{OWNER}|"), (sig, fact)
        assert _proconfig(only_363, sig) == f"search_path={only_363}, pg_temp"
        assert _proconfig(db, sig) == "search_path=pg_catalog, pg_temp"
        for role in ("anon", "authenticated"):
            assert psql(f"SELECT has_function_privilege('{role}', '{db}.{sig}', 'EXECUTE')") == "f"
        assert psql(f"SELECT has_function_privilege('service_role', '{db}.{sig}', 'EXECUTE')") == (
            "t" if sig == RPC_SIG else "f"), sig
        before, after = _prosrc(only_363, sig).replace(only_363, "S"), _prosrc(db, sig).replace(db, "S")
        assert _squash(after.replace("pg_catalog.", "")) == _squash(before), sig
        assert (before == after) is (sig == f"{AI_AUDIT}()"), sig
    changed = {f"fn S.{sig.split('(')[0]}(" for sig in SIGS}
    keep = [line for line in _catalog(db, oids=False) if not any(line.startswith(c) for c in changed)]
    assert keep == [line for line in _catalog(only_363, oids=False)
                    if not any(line.startswith(c) for c in changed)]
    assert len(_catalog(db, oids=False)) == len(_catalog(only_363, oids=False))


# ── PostgreSQL: release paths and idempotency ───────────────────────────────

def test_staging_path_applies_on_top_of_363_with_history_and_reruns_as_a_no_op(only_363):
    s = only_363
    _, ids = _scenario(s)
    history = _rows(s, ids)
    _apply(s)
    assert _rows(s, ids) == history
    _owner(_postcondition_sql(s))
    snapshot = _catalog(s, oids=True)
    _apply(s)
    assert _catalog(s, oids=True) == snapshot, "second run must change nothing"


def test_production_path_runs_341_361_363_365_back_to_back_and_matches_staging(fresh):
    schema = "pa365_prod_" + uuid4().hex
    try:
        m361._build(schema, with_341=False, ledger=False)
        ledger = (f"CREATE TABLE IF NOT EXISTS {schema}._schema_migrations (filename text PRIMARY KEY, "
                  f"applied_at timestamptz NOT NULL DEFAULT now());\n")
        record = f"INSERT INTO {schema}._schema_migrations (filename) VALUES ('{{}}');\n"
        _owner(f"{m341._migrated(schema)}\n{ledger}{record.format(m361.NAME_341)}"
               f"{m361._migrated(schema)}\n{record.format(NAME_361)}"
               f"{m363._migrated(schema)}\n{record.format(NAME_363)}"
               f"{_migrated(schema)}")
        assert _catalog(schema, oids=False) == _catalog(fresh, oids=False)
        snapshot = _catalog(schema, oids=True)
        _apply(schema)
        assert _catalog(schema, oids=True) == snapshot
    finally:
        _drop(schema)


@pytest.mark.parametrize("rerun,changed", [
    ("332", "fn_staff_security_audit_append_only()"),
    ("336", "fn_users_suspension_role_guard()"),
])
def test_rerunning_an_older_body_is_caught_and_365_restores_the_pin(fresh, rerun, changed):
    s = fresh
    source = m332.SQL if rerun == "332" else m336.SQL
    _owner(_migrated(s, m326._function(source, changed.split("(")[0])))
    assert _proconfig(s, changed) != "search_path=pg_catalog, pg_temp"
    error = _fails(_owner, _postcondition_sql(s))
    assert "staff_chain_search_path_wrong" in error and changed.split("(")[0] in error, error
    _apply(s)
    _owner(_postcondition_sql(s))
    assert _proconfig(s, changed) == "search_path=pg_catalog, pg_temp"


def test_rerunning_341_is_caught_and_needs_361_363_365_again(fresh):
    s = fresh
    _owner(m341._migrated(s))
    for sig in SIGS:   # 341 recreates all but the 332 append-only trigger
        assert (_proconfig(s, sig) == "search_path=pg_catalog, pg_temp") is sig.startswith(
            "fn_staff_security_audit_append_only"), sig
    error = _fails(_owner, _postcondition_sql(s))
    assert "staff_chain_search_path_wrong" in error and "fn_set_staff_privilege" in error, error
    assert "migration_363_missing: fn_users_privilege_audit" in _fails(_owner, _migrated(s))
    _owner(m361._migrated(s))
    m363._apply(s)
    _apply(s)
    _owner(_postcondition_sql(s))
    _owner(m363._postcondition_sql(s))


def test_rerunning_361_after_365_aborts_and_changes_nothing(fresh):
    """361's postcondition pins the 341 path on these functions: a manual
    re-run after 365 fails closed (one transaction) and leaves 365 in place."""
    s = fresh
    snapshot = _catalog(s, oids=True)
    error = _fails(_owner, m361._migrated(s))
    assert "staff_security_function_wrong" in error and "fn_set_staff_privilege" in error, error
    assert _catalog(s, oids=True) == snapshot
    _owner(_postcondition_sql(s))


# ── PostgreSQL: preconditions ───────────────────────────────────────────────

@pytest.mark.parametrize("state,marker", [
    ("no_ledger", "migration_363_missing: no ledger row"),
    ("363_not_recorded", "migration_363_missing: no ledger row"),
    ("361_not_recorded", "migration_363_missing: no ledger row"),
    ("363_recorded_not_applied", "migration_363_missing: fn_users_privilege_audit"),
    ("361_and_363_recorded_341_only", "migration_363_missing: objects"),
])
def test_precondition_requires_361_and_363_recorded_and_applied(state, marker):
    m332._require_pg()
    schema = "pa365_noprereq_" + uuid4().hex
    try:
        if state == "no_ledger":
            m361._build(schema, ledger=False)
        elif state == "361_and_363_recorded_341_only":
            m361._build(schema)   # 341 applied and recorded, no 361 objects
            m361._record(schema, NAME_361)
            m361._record(schema, NAME_363)
        else:
            m363._build_361(schema)
            if state != "363_recorded_not_applied":
                m363._apply(schema)
            if state == "361_not_recorded":
                psql(f"DELETE FROM {schema}._schema_migrations WHERE filename = '{NAME_361}'")
            if state != "363_not_recorded":
                m361._record(schema, NAME_363)
        assert marker in _fails(_owner, _migrated(schema))
        _unpinned(schema)
    finally:
        _drop(schema)


@pytest.mark.parametrize("path", ["{s}", "{s}, pg_catalog", "pg_catalog, pg_temp"])
def test_precondition_refuses_a_planted_shadow_without_running_it(only_363, path):
    s = only_363
    _plant_shadows(s)
    rc, out = _psql_all(f"SET ROLE {OWNER}; SET search_path = {path.format(s=s)}; {_migrated(s)}")
    assert rc != 0 and "catalog_name_shadowed_in_public: function format, function jsonb_build_object" in out, out
    assert "attacker_called" not in out, out
    _unpinned(s)


@pytest.mark.parametrize("op,left,right", [("=", "name", "text"), (">", "integer", "integer"),
                                           ("<", "integer", "integer")])
def test_precondition_refuses_a_planted_operator(only_363, op, left, right):
    s = only_363
    _owner(f"GRANT CREATE ON SCHEMA {s} TO service_role")
    _svc(f"CREATE FUNCTION {s}.pa365_op({left}, {right}) RETURNS boolean LANGUAGE sql AS 'SELECT true'; "
         f"CREATE OPERATOR {s}.{op} (LEFTARG = {left}, RIGHTARG = {right}, FUNCTION = {s}.pa365_op);")
    assert f"catalog_name_shadowed_in_public: operator {op}" in _fails(_owner, _migrated(s))
    _unpinned(s)


# ── PostgreSQL: postconditions ──────────────────────────────────────────────

_AI = f"{AI_AUDIT}()"
# (tamper, None if re-applying 365 repairs it else the operator's fix, marker)
_DRIFT = [
    *[(f"ALTER FUNCTION {{s}}.{sig} {change}", None, "staff_chain_search_path_wrong")
      for sig in SIGS for change in ("SET search_path = public, pg_temp",
                                     "SET search_path = pg_catalog, public, pg_temp", "RESET search_path")],
    *[(f"ALTER FUNCTION {{s}}.{sig} SECURITY {'INVOKER' if sig in (RPC_SIG, _AI) else 'DEFINER'}",
       # 365 only ALTERs the path of the override audit: it never changes a security mode back.
       f"ALTER FUNCTION {{s}}.{sig} SECURITY DEFINER" if sig == _AI else None, "staff_chain_search_path_wrong")
      for sig in SIGS],
    *[(f"GRANT EXECUTE ON FUNCTION {{s}}.{sig} TO {role}", None, "staff_chain_search_path_wrong")
      for sig in SIGS for role in ("PUBLIC", "anon", "authenticated", "service_role")
      if sig != RPC_SIG or role != "service_role"],
    # 365 never grants: the RPC losing service_role fails the release.
    (f"REVOKE EXECUTE ON FUNCTION {{s}}.{RPC_SIG} FROM service_role",
     f"GRANT EXECUTE ON FUNCTION {{s}}.{RPC_SIG} TO service_role", "staff_chain_search_path_wrong"),
    *[(f"ALTER TABLE {{s}}.{table} {mode} TRIGGER {trigger}", f"ALTER TABLE {{s}}.{table} ENABLE TRIGGER {trigger}",
       "staff_security_trigger_missing")
      for table, trigger in (("users", "trg_users_suspension_guard"), ("users", "trg_users_suspension_role_guard"),
                             ("staff_security_audit", "trg_staff_security_audit_append_only"),
                             ("staff_security_audit", "trg_staff_security_audit_no_truncate"),
                             ("ai_model_overrides", "trg_ai_model_override_audit"))
      for mode in ("DISABLE", "ENABLE REPLICA")],
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


@pytest.mark.parametrize("name", list(RECREATED))
def test_postcondition_refuses_an_unqualified_call_under_the_pinned_path(fresh, name):
    s = fresh
    body = m326._function(RECREATED[name][0], name).replace("SET search_path = public, pg_temp", PINNED)
    _owner(_migrated(s, body))
    error = _fails(_owner, _postcondition_sql(s))
    assert "staff_chain_search_path_wrong" in error and name in error, error
    _apply(s)
    _owner(_postcondition_sql(s))


@pytest.mark.parametrize("sig", [RPC_SIG, f"{AI_AUDIT}()"])
def test_postcondition_refuses_a_definer_that_does_not_own_its_table(fresh, sig):
    s = fresh
    psql("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pa365_other') THEN "
         "CREATE ROLE pa365_other NOSUPERUSER NOLOGIN; END IF; END $$;")
    acl = psql(f"SELECT proacl::text FROM pg_proc WHERE oid = '{s}.{sig}'::regprocedure")
    psql(f"ALTER FUNCTION {s}.{sig} OWNER TO pa365_other")
    try:
        error = _fails(psql, _postcondition_sql(s))
        assert "staff_chain_search_path_wrong" in error and sig.split("(")[0] in error, error
    finally:
        psql(f"ALTER FUNCTION {s}.{sig} OWNER TO {OWNER}; REVOKE ALL ON FUNCTION {s}.{sig} FROM pa365_other")
    assert psql(f"SELECT proacl::text FROM pg_proc WHERE oid = '{s}.{sig}'::regprocedure") == acl
    _owner(_postcondition_sql(s))


def test_postcondition_ignores_planted_overloads_and_operators(fresh):
    """A shadow planted after 365 never runs in its checks, on any path."""
    s = fresh
    _plant_shadows(s)
    _svc(f"CREATE FUNCTION {s}.pa365_ne(oid, oid) RETURNS boolean LANGUAGE plpgsql AS $$ "
         f"BEGIN RAISE NOTICE 'attacker_called ne %', current_user; RETURN false; END $$; "
         f"CREATE OPERATOR {s}.<> (LEFTARG = oid, RIGHTARG = oid, FUNCTION = {s}.pa365_ne);")
    _owner(f"ALTER FUNCTION {s}.{RPC_SIG} SET search_path = public, pg_temp")
    for path in (f"{s}", f"{s}, pg_catalog"):
        rc, out = _psql_all(f"SET ROLE {OWNER}; SET search_path = {path}; {_postcondition_sql(s)}")
        assert rc != 0 and "staff_chain_search_path_wrong" in out, out
        assert "attacker_called" not in out, out


# ── PostgreSQL: rollback ────────────────────────────────────────────────────

def test_rollback_restores_the_363_catalog_reopens_sa_2209_and_365_reapplies(fresh, only_363):
    s = fresh
    _owner(_rollback_sql(s))
    assert _catalog(s, oids=False) == _catalog(only_363, oids=False)
    assert _facts(s) == _facts(only_363)
    for sig in SIGS:
        assert _proconfig(s, sig) == _proconfig(only_363, sig).replace(only_363, s)
    _owner(m363._postcondition_sql(s))   # 363 is untouched
    _plant_shadows(s)   # negative control: the hole is open again
    outputs, _ = _scenario(s)
    assert f"attacker_called audit6 {OWNER}" in outputs[5], outputs[5]
    _drop_shadows(s)
    _apply(s)
    _owner(_postcondition_sql(s))


def test_rollback_refuses_while_a_shadow_is_planted(fresh):
    s = fresh
    _plant_shadows(s)
    rc, out = _psql_all(f"SET ROLE {OWNER}; {_rollback_sql(s)}")
    assert rc != 0 and "catalog_name_shadowed_in_public: format, jsonb_build_object" in out, out
    for sig in SIGS:
        assert _proconfig(s, sig) == "search_path=pg_catalog, pg_temp"


# ── PostgreSQL: the 332, 336, 341, 361 and 363 suites on the 365 schema ─────

# As in the 363 suite: 332's trigger-list catalog test predates 336; 341's and
# 361's own pre/postcondition, rollback and re-apply tests drive their own
# files. The rest are the contract 365 changes on purpose, each pinning
# search_path = public, pg_temp on functions 365 pins: 332's postcondition
# and 336's postcondition (every drift case runs it on the clean schema
# first), 341's catalog test, 363's production-path test (it compares a
# 341 -> 361 -> 363 schema with this 365 fixture) and 363's re-run test,
# whose 361 case now aborts at 361's postcondition by design
# (test_rerunning_361_after_365_aborts_and_changes_nothing). 365's own
# postcondition, drift, catalog and release-path tests check those functions
# instead (pinned path, definer mode, owner, EXECUTE, unchanged body); every
# excluded test still passes in its own suite on its own schema. All other
# 363 tests that take only db/fresh run unchanged here.
_NOT_RERUN = {
    m332: {"test_catalog_after_apply_and_rerun", "test_postcondition_block_aborts_on_drift"},
    m341: {"test_header_rollback_reopens_f1_and_341_reapplies", "test_catalog_after_apply_and_rerun"},
    m336: {"test_postcondition_block_aborts_on_drift"},
    m361: {"test_rerunning_341_after_361_is_caught_and_361_restores_old_id",
           "test_header_rollback_reopens_p3_2_grants_nothing_and_361_reapplies"},
    m363: {"test_production_path_runs_341_361_363_back_to_back_and_matches_staging",
           "test_rerunning_an_older_body_is_caught_and_363_restores_the_pin"},
}


def _rerun(module, prefix: str) -> None:
    for name, fn in inspect.getmembers(module, inspect.isfunction):
        params = set(inspect.signature(fn).parameters)
        if (name.startswith("test_") and fn.__module__ == module.__name__
                and params & {"db", "fresh"} and not params & {"only_341", "only_361", "only_363"}
                and name not in _NOT_RERUN.get(module, set())
                and not (module in (m341, m361) and name.startswith("test_postcondition_"))):
            globals()[f"test_{prefix}_{name[5:]}"] = fn


_rerun(m332, "rerun332")
_rerun(m336, "rerun336")
_rerun(m341, "rerun341")
_rerun(m361, "rerun361")
_rerun(m363, "rerun363")
