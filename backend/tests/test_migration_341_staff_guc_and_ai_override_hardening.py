"""Migration 341 (PC-J88; PC-J74 F1/F2/F3): the staff guards and the audit no
longer trust session settings, and the 322 override audit / sequences are
closed.

The static half pins the migration text: one transaction, no data change, the
332/336 function headers unchanged, no body reading a custom `aver.*`
setting, the grants, the rollback note and the release metadata.

The PostgreSQL half reuses the 332 harness (NOSUPERUSER owner, Supabase
default privileges, 320 guard, 326) and adds Supabase's default sequence
grants and the 322 objects, then applies 322, 332, 336 and 341 (twice). It
proves:

- T4: the PC-J74 repro (`SET LOCAL aver.bootstrap/staff_privilege/actor_id`
  plus a direct UPDATE) is refused for a suspended account as service_role,
  the owner and a superuser; on an allowed write the forged labels are ignored
  and exactly one out_of_band row (+ outbox for admin) is written; the RPC and
  the bootstrap still write exactly one row each;
- the whole 332 and 336 behaviour suites, re-run on the 341 schema;
- T2: no client privilege on the identity sequences, no service_role INSERT
  into the override audit, TRUNCATE refused, the backend's upsert still
  writes one audit row per change;
- precondition and postcondition aborts, and the header rollback (which
  reopens F1 — the negative control for T4) followed by a re-apply.

F5 (inline admin policies) is owned by 345; its suite covers T7.

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
from test_migration_240_core_attempt_evidence import psql

BACKEND = Path(__file__).resolve().parents[1]
MIGRATIONS = BACKEND / "migrations"
NAME = "341_staff_guc_and_ai_override_hardening.sql"
SQL = (MIGRATIONS / NAME).read_text(encoding="utf-8")
CODE = m326._strip_comments(SQL)
SQL_322 = (MIGRATIONS / "322_ai_model_overrides_and_failures.sql").read_text(encoding="utf-8")
OWNER = m332.OWNER
EVIDENCE = "staff_privilege_evidence"
STAFF_FUNCTIONS = {
    "fn_users_suspension_guard": m332.SQL,
    "fn_users_privilege_audit": m332.SQL,
    "fn_set_staff_privilege": m332.SQL,
    "fn_bootstrap_admin_recovery": m332.SQL,
    "fn_users_suspension_role_guard": m336.SQL,
}
SEQUENCES = ("ai_model_override_audit_id_seq", "ai_provider_failures_id_seq")

_user, _state, _audit, _outbox = m332._user, m332._state, m332._audit, m332._outbox
_rpc, _rpc_sql, _suspend, _bootstrap_sql = m332._rpc, m332._rpc_sql, m332._suspend, m332._bootstrap_sql
_svc, _owner, _fails = m332._svc, m332._owner, m332._fails


def _header(fn: str) -> str:
    return fn[:fn.index("AS $$")]


# ── Static contract ─────────────────────────────────────────────────────────

def test_one_transaction_with_lock_timeout_and_no_data_change():
    assert CODE.strip().startswith("BEGIN;") and CODE.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s';" in CODE
    top = m332._without_bodies(CODE)
    for forbidden in (r"\bDROP\b", r"DELETE\s+FROM", r"\bTRUNCATE\s+(?:TABLE\s+)?public", r"^\s*UPDATE\s",
                      r"INSERT\s+INTO", r"DISABLE\s+TRIGGER", r"session_replication_role",
                      r"\bPOLICY\b"):
        assert not re.search(forbidden, top, re.M | re.I), forbidden


def test_staff_functions_keep_their_332_and_336_headers_and_read_no_session_setting():
    for name, source in STAFF_FUNCTIONS.items():
        new = m326._function(CODE, name)
        assert _header(new) == _header(m326._function(m326._strip_comments(source), name)), name
        assert "aver." not in new, name
    # The only settings read are PostgREST's own (claims and the switched role).
    audit = m326._function(CODE, "fn_users_privilege_audit")
    assert set(re.findall(r"current_setting\('([^']+)'", audit)) == {
        "request.jwt.claim.role", "request.jwt.claims", "role"}
    assert "RETURN NULL;   -- not a change" in m326._function(SQL, "fn_users_privilege_audit")
    assert audit.count("RETURN NULL") == 3


def test_guards_open_only_on_evidence_and_the_role_freeze_only_for_the_bootstrap():
    guard = m326._function(CODE, "fn_users_suspension_guard")
    role_guard = m326._function(CODE, "fn_users_suspension_role_guard")
    for fn in (guard, role_guard):
        assert "SECURITY DEFINER" not in fn
        privilege = fn.index("IF has_table_privilege('public.staff_privilege_evidence', 'SELECT') THEN")
        assert privilege < fn.index("IF EXISTS (SELECT 1 FROM public.staff_privilege_evidence e") < fn.index("RAISE")
        assert "e.xact_id = pg_current_xact_id() AND e.target_user_id = OLD.id" in fn
    assert "e.kind IN ('rpc', 'bootstrap')" in guard
    assert "e.kind = 'bootstrap'" in role_guard and "'rpc'" not in role_guard
    assert re.findall(r"RAISE EXCEPTION '([a-z_]+)'", guard) == [
        "account_suspended", "account_suspended_marker_protected"]
    assert re.findall(r"RAISE EXCEPTION '([a-z_]+)'", role_guard) == ["account_suspended_role_change"]


def test_rpc_and_bootstrap_write_evidence_around_their_single_update():
    for name, kind in (("fn_set_staff_privilege", "'rpc'"), ("fn_bootstrap_admin_recovery", "'bootstrap'")):
        fn = m326._function(CODE, name)
        insert = fn.index("INSERT INTO public.staff_privilege_evidence")
        assert kind in fn[insert:fn.index("UPDATE public.users", insert)]
        assert fn.count("UPDATE public.users") == 1
        assert insert < fn.index("UPDATE public.users") < fn.index(
            "DELETE FROM public.staff_privilege_evidence e") < fn.index("fn_staff_security_record")
        assert "set_config" not in fn
    bootstrap = m326._function(CODE, "fn_bootstrap_admin_recovery")
    assert "SECURITY INVOKER" in bootstrap
    assert bootstrap.index("bootstrap_requires_read_committed") < bootstrap.index(
        "pg_advisory_xact_lock(332, 1)") < bootstrap.index("'admins_exist'") < bootstrap.index(
        "INSERT INTO public.staff_privilege_evidence")


def test_evidence_table_and_acls():
    assert f"CREATE TABLE IF NOT EXISTS public.{EVIDENCE} (" in CODE
    assert f"ALTER TABLE public.{EVIDENCE} ENABLE ROW LEVEL SECURITY;" in CODE
    assert f"REVOKE ALL ON TABLE public.{EVIDENCE} FROM PUBLIC, anon, authenticated, service_role;" in CODE
    assert not re.search(rf"GRANT[^;]*{EVIDENCE}", CODE)
    assert ("GRANT EXECUTE ON FUNCTION public.fn_set_staff_privilege(uuid, uuid, text, boolean, text, text) "
            "TO service_role;") in CODE
    assert len(re.findall(r"\bGRANT\b", CODE)) == 1


def test_f2_f3_statements():
    assert ("REVOKE ALL ON SEQUENCE public.ai_model_override_audit_id_seq, public.ai_provider_failures_id_seq\n"
            "    FROM PUBLIC, anon, authenticated;") in CODE
    assert "REVOKE INSERT ON TABLE public.ai_model_override_audit FROM service_role;" in CODE
    assert ("REVOKE ALL ON FUNCTION public.fn_ai_model_override_audit() "
            "FROM PUBLIC, anon, authenticated, service_role;") in CODE
    assert re.search(r"CREATE OR REPLACE TRIGGER trg_ai_model_override_audit_no_truncate\s+"
                     r"BEFORE TRUNCATE ON public\.ai_model_override_audit\s+FOR EACH STATEMENT "
                     r"EXECUTE FUNCTION public\.fn_ai_model_override_audit_append_only\(\);", CODE)
    new = m326._function(CODE, "fn_ai_model_override_audit")
    old = m326._function(m326._strip_comments(SQL_322), "fn_ai_model_override_audit")
    assert new == old.replace("LANGUAGE plpgsql\nSET search_path",
                              "LANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path"), "body unchanged"


def test_f5_is_owned_by_345():
    code_345 = m326._strip_comments((MIGRATIONS / "345_admin_inline_policies_strict.sql").read_text("utf-8"))
    for table, policy in (("dictation_sessions", "admins read dictation sessions"),
                          ("dictation_attempts", "admins read dictation attempts"),
                          ("dictation_attempt_answers", "admins read dictation attempt answers"),
                          ("user_feedback", "admins read feedback"),
                          ("lemma_overrides", "Admins manage lemma overrides"),
                          ("vocabulary_exercises", "vocab_exercises_admin_write")):
        assert policy in code_345 and table in code_345, policy


def test_postconditions_cover_every_finding():
    post = CODE[CODE.rindex("DO $$"):]
    for marker in ("staff_privilege_evidence_rls_off", "staff_privilege_evidence_privileges_wrong",
                   "staff_privilege_evidence_not_empty", "staff_definer_owner_mismatch",
                   "staff_security_trigger_missing",
                   "staff_security_function_wrong", "ai_override_sequence_privileges_wrong",
                   "ai_model_override_audit_privileges_wrong", "ai_model_override_audit_trigger_missing",
                   "server_version_num", "has_sequence_privilege"):
        assert marker in post, marker


def test_rollback_note_reopens_f1_and_restores_the_old_blocks():
    note = SQL[SQL.index("-- ROLLBACK"):SQL.index("\nBEGIN;\n")]
    assert "REOPENS" in note and "F1" in note
    body = _rollback_sql("public")
    for name in (*STAFF_FUNCTIONS, "fn_ai_model_override_audit"):
        assert f"FUNCTION public.{name}(" in body, name
    assert body.index("GRANT INSERT ON TABLE public.ai_model_override_audit TO service_role;") < body.index(
        "fn_ai_model_override_audit()") < body.index(f"DROP TABLE IF EXISTS public.{EVIDENCE};")


def test_release_metadata_is_a_normal_forward_migration():
    policy = (MIGRATIONS / "forward-policy.tsv").read_text(encoding="utf-8")
    assert NAME not in policy, "322/332/336 are applied everywhere: 341 must not be policy-skipped"
    readme = (MIGRATIONS / "README.md").read_text(encoding="utf-8")
    assert "Migration `341` (PC-J88" in readme and "341 is PC-J88" in readme


# ── PostgreSQL harness ──────────────────────────────────────────────────────

def _migrated(schema: str) -> str:
    return m331._schema_sql(SQL, schema)


def _postcondition_sql(schema: str) -> str:
    return m331._schema_sql(SQL[SQL.rindex("DO $$"):SQL.rindex("COMMIT;")], schema)


def _rollback_sql(schema: str) -> str:
    header = SQL[SQL.index("-- ROLLBACK"):SQL.index("\nBEGIN;\n")]
    lines = [line[5:] for line in header.splitlines() if line.startswith("--   ")]
    blocks = [m326._function(source, name) for name, source in STAFF_FUNCTIONS.items()]
    blocks.append(m326._function(SQL_322, "fn_ai_model_override_audit"))
    text = "\n".join(lines).replace("-- <the six function blocks, verbatim>", "\n".join(blocks))
    return m331._schema_sql(text, schema)


def _build(schema: str, *, with_336: bool = True, with_322: bool = True) -> None:
    m332._build(schema)
    _owner(f"""
        ALTER DEFAULT PRIVILEGES IN SCHEMA {schema}
            GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
        CREATE TABLE {schema}.ai_usage_logs(
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, session_id uuid,
            service text NOT NULL, model text NOT NULL, input_tokens integer,
            output_tokens integer, cache_read_tokens integer, cache_write_tokens integer,
            audio_seconds real, text_chars integer, cost_usd_est real,
            created_at timestamptz NOT NULL DEFAULT now(), feature text, operation text,
            status text NOT NULL DEFAULT 'success', error_code text, thinking_tokens integer,
            pricing_version text, cost_source text NOT NULL DEFAULT 'catalog_estimate');
    """)
    if with_322:
        _owner(m331._schema_sql(SQL_322, schema))
    m332._apply(schema)
    if with_336:
        m336._apply(schema)


def _apply(schema: str) -> None:
    _owner(_migrated(schema))


def _schema(prefix: str) -> str:
    m332._require_pg()
    schema = prefix + uuid4().hex
    _build(schema)
    _apply(schema)
    return schema


@pytest.fixture(scope="module")
def db():
    schema = None
    try:
        schema = _schema("guc341_")
        _apply(schema)   # re-applying is a no-op
        yield schema
    finally:
        if schema:
            psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


@pytest.fixture
def fresh():
    schema = None
    try:
        schema = _schema("guc341_fresh_")
        yield schema
    finally:
        if schema:
            psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


# Every name below sets a transaction-local setting the 332/336 triggers used
# to trust (PC-J74 F1).
FORGED = ("SET LOCAL aver.bootstrap = 'on'; SET LOCAL aver.staff_privilege = 'on'; "
          "SET LOCAL aver.actor_id = '{actor}'; SET LOCAL aver.audit_id = '{audit}'; "
          "SET LOCAL aver.reason = 'forged reason'; SET LOCAL aver.request_id = 'forged-req';")


def _forged(actor: str, audit: str | None = None) -> str:
    return FORGED.format(actor=actor, audit=audit or uuid4())


def _superuser(sql: str) -> str:
    return psql(sql)


RUNNERS = {"service": _svc, "owner": _owner, "superuser": _superuser}


def _evidence_rows(s: str) -> str:
    return psql(f"SELECT count(*) FROM {s}.{EVIDENCE}")


# ── PostgreSQL: the 332 and 336 suites on the 341 schema ────────────────────

# 332's catalog test lists the users triggers before 336 added its guard; the
# 336 catalog test (re-run below) pins the full list on this schema instead.
_NOT_RERUN = {"test_catalog_after_apply_and_rerun"}


def _rerun(module, prefix: str) -> None:
    for name, fn in inspect.getmembers(module, inspect.isfunction):
        params = set(inspect.signature(fn).parameters)
        if (name.startswith("test_") and fn.__module__ == module.__name__
                and params & {"db", "fresh"} and not (module is m332 and name in _NOT_RERUN)):
            globals()[f"test_{prefix}_{name[5:]}"] = fn


_rerun(m332, "rerun332")
_rerun(m336, "rerun336")


# ── PostgreSQL: catalog ─────────────────────────────────────────────────────

def test_catalog_after_apply_and_rerun(db):
    s = db
    assert psql(f"SELECT relrowsecurity FROM pg_class WHERE oid = '{s}.{EVIDENCE}'::regclass") == "t"
    assert psql(f"SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = '{s}.{EVIDENCE}'::regclass") == OWNER
    assert _evidence_rows(s) == "0"
    maintain = psql("SELECT current_setting('server_version_num')::int >= 170000") == "t"
    privileges = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]
    privileges += ["MAINTAIN"] if maintain else []
    for role in ("anon", "authenticated", "service_role"):
        for priv in privileges:
            assert psql(f"SELECT has_table_privilege('{role}', '{s}.{EVIDENCE}', '{priv}')") == "f", (role, priv)
    for sig, definer in (("fn_users_suspension_guard()", "false"), ("fn_users_suspension_role_guard()", "false"),
                         ("fn_users_privilege_audit()", "true"), (m332.RPC_SIG, "true"),
                         (m332.BOOTSTRAP_SIG, "false"), ("fn_ai_model_override_audit()", "true")):
        assert psql(f"SELECT prosecdef::text || '|' || array_to_string(proconfig, ';') || '|' || "
                    f"pg_get_userbyid(proowner) FROM pg_proc WHERE oid = '{s}.{sig}'::regprocedure") == (
            f"{definer}|search_path={s}, pg_temp|{OWNER}"), sig
        assert psql(f"SELECT prosrc LIKE '%aver.%' FROM pg_proc WHERE oid = '{s}.{sig}'::regprocedure") == "f"
        expected = "t" if sig == m332.RPC_SIG else "f"
        assert psql(f"SELECT has_function_privilege('service_role', '{s}.{sig}', 'EXECUTE')") == expected, sig
        for role in ("anon", "authenticated"):
            assert psql(f"SELECT has_function_privilege('{role}', '{s}.{sig}', 'EXECUTE')") == "f", (role, sig)


def test_clients_and_service_role_cannot_read_or_forge_evidence(db):
    s = db
    target = _user(s, "instructor", True)
    forge = (f"INSERT INTO {s}.{EVIDENCE} (target_user_id, kind, audit_id) "
             f"VALUES ('{target}', 'bootstrap', gen_random_uuid())")
    for role in ("anon", "authenticated", "service_role"):
        assert "permission denied" in m326._denied(role, f"SELECT count(*) FROM {s}.{EVIDENCE}")
        assert "permission denied" in m326._denied(role, forge)


# ── PostgreSQL: T4, the PC-J74 repro is closed ──────────────────────────────

@pytest.mark.parametrize("run", RUNNERS)
@pytest.mark.parametrize("change,code", [
    ("role = 'admin', is_active = true, suspended_at = NULL, suspended_by = NULL, suspension_reason = NULL",
     "account_suspended"),
    ("is_active = true", "account_suspended"),
    ("suspended_at = NULL, suspended_by = NULL, suspension_reason = NULL", "account_suspended_marker_protected"),
    ("role = 'admin'", "account_suspended_role_change"),
    ("role = 'student'", "account_suspended_role_change"),
])
def test_forged_settings_do_not_open_the_suspension_guards(db, run, change, code):
    s = db
    admin, target = _user(s, "admin", True), _user(s, "instructor", True)
    _suspend(s, admin, target)
    before = m336._snapshot(s), psql(f"SELECT count(*) FROM {s}.owner_alert_outbox")
    error = _fails(RUNNERS[run], f"BEGIN; {_forged(admin)} UPDATE {s}.users SET {change} WHERE id = '{target}'; COMMIT;")
    assert re.search(rf"ERROR:\s+{code}\b", error) and target in error, error
    assert (m336._snapshot(s), psql(f"SELECT count(*) FROM {s}.owner_alert_outbox")) == before
    assert _state(s, target)["suspended"] is True and _state(s, target)["role"] == "instructor"


@pytest.mark.parametrize("run,source", [("service", "service"), ("owner", "out_of_band"),
                                        ("superuser", "out_of_band")])
def test_forged_settings_on_an_allowed_write_still_write_one_unlabelled_row(db, run, source):
    s = db
    admin, target = _user(s, "admin", True), _user(s, "instructor", True)
    forged_audit = str(uuid4())
    rows, alerts = len(_audit(s, target)), len(_outbox(s, target))
    RUNNERS[run](f"BEGIN; {_forged(admin, forged_audit)} "
                 f"UPDATE {s}.users SET role = 'admin' WHERE id = '{target}'; COMMIT;")
    audit = _audit(s, target)
    assert len(audit) == rows + 1
    row = audit[-1]
    assert (row["event"], row["source"], row["actor"], row["reason"], row["request_id"]) == (
        "role_changed", source, None, None, None)
    assert row["id"] != forged_audit and row["detail"] == {}
    outbox = _outbox(s, target)
    assert len(outbox) == alerts + 1 and outbox[-1]["audit_id"] == row["id"]
    assert outbox[-1]["payload"]["source"] == source and outbox[-1]["payload"]["actor_user_id"] is None
    assert _evidence_rows(s) == "0"


def test_a_forged_service_claim_without_the_service_role_is_out_of_band(db):
    s = db
    target = _user(s, "instructor", True)
    claims = m326._claims("service_role")
    _owner(f"SELECT set_config('request.jwt.claims', '{claims}', true); "
           f"SELECT set_config('request.jwt.claim.role', 'service_role', true); "
           f"UPDATE {s}.users SET role = 'student' WHERE id = '{target}';")
    assert _audit(s, target)[-1]["source"] == "out_of_band"


def test_rpc_writes_one_labelled_row_whatever_the_caller_set(db):
    s = db
    actor, decoy, target = _user(s, "admin", True), _user(s, "admin", True), _user(s, "instructor", True)
    rows = len(_audit(s, target))
    out = _svc(f"BEGIN; {_forged(decoy)} {_rpc_sql(s, actor, target, active=False, reason='  lost laptop ', request='req-341')} COMMIT;")
    result = json.loads(out.splitlines()[-1])
    audit = _audit(s, target)
    assert len(audit) == rows + 1
    row = audit[-1]
    assert row["id"] == result["audit_id"] and (row["event"], row["source"], row["actor"]) == (
        "active_changed", "admin_api", actor)
    assert (row["reason"], row["request_id"]) == ("lost laptop", "req-341")
    assert _state(s, target)["suspended"] is True and _evidence_rows(s) == "0"
    # Reactivation through the RPC still opens the guard; its role freeze does not open.
    assert _rpc(s, actor, target, active=True, reason="back from leave")["changed"] is True
    assert len(_audit(s, target)) == rows + 2 and _audit(s, target)[-1]["source"] == "admin_api"


def test_evidence_does_not_outlive_the_rpc_inside_one_transaction(db):
    s = db
    actor, target, other = _user(s, "admin", True), _user(s, "instructor", True), _user(s, "instructor", True)
    _suspend(s, actor, other)
    # Same transaction: after the RPC on `target`, a direct write on `target`
    # is out of band and a direct reactivation of `other` is refused.
    out = _owner(f"BEGIN; {_rpc_sql(s, actor, target, role='student')} "
                 f"SELECT count(*) FROM {s}.{EVIDENCE}; "
                 f"UPDATE {s}.users SET role = 'instructor' WHERE id = '{target}'; COMMIT;")
    assert out.splitlines()[-1] == "0"
    # One transaction shares now(), so the two rows have no stable order.
    rows = _audit(s, target)[1:]   # [0] is the fixture row's insert
    assert sorted((r["source"], r["actor"]) for r in rows) == sorted(
        [("admin_api", actor), ("out_of_band", None)])
    error = _fails(_owner, f"BEGIN; {_rpc_sql(s, actor, target, role='student')} "
                           f"UPDATE {s}.users SET is_active = true WHERE id = '{other}'; COMMIT;")
    assert "account_suspended" in error and _state(s, target)["role"] == "instructor"


def test_bootstrap_writes_one_row_with_forged_settings_ignored(fresh):
    s = fresh
    admin, target = _user(s, "admin", True), _user(s, "admin", True)
    _suspend(s, admin, target)
    _owner(f"UPDATE {s}.users SET is_active = false WHERE id = '{admin}'")
    rows, alerts = len(_audit(s, target)), len(_outbox(s, target))
    audit_id = _owner(f"BEGIN; {_forged(admin)} {_bootstrap_sql(s, target, operator=' Vinh ')} COMMIT;").splitlines()[-1]
    audit = _audit(s, target)
    assert len(audit) == rows + 1 and len(_outbox(s, target)) == alerts + 1
    row = audit[-1]
    assert row["id"] == audit_id and (row["event"], row["source"], row["actor"]) == (
        "bootstrap_recovery", "out_of_band", None)
    assert row["detail"] == {"operator": "Vinh"} and row["reason"] == "drill (e)" and row["request_id"] is None
    assert row["before"]["is_active"] is False and row["before"]["suspended_at"] is not None
    assert row["after"] == {"role": "admin", "is_active": True, "suspended_at": None}
    assert _state(s, target) == {"role": "admin", "is_active": True, "suspended": False,
                                 "suspended_by": None, "reason": None}
    assert _evidence_rows(s) == "0"


def test_bootstrap_restores_a_suspended_instructor_role_and_the_rpc_cannot(fresh):
    """FR-019: only the bootstrap's evidence opens the role freeze."""
    s = fresh
    admin, target = _user(s, "admin", True), _user(s, "instructor", True)
    _suspend(s, admin, target)
    assert "account_suspended_role_change" in _fails(_svc, _rpc_sql(s, admin, target, role="admin", reason=None))
    _owner(f"UPDATE {s}.users SET is_active = false WHERE id = '{admin}'")
    _owner(_bootstrap_sql(s, target))
    assert _state(s, target)["role"] == "admin" and _audit(s, target)[-1]["event"] == "bootstrap_recovery"


# ── PostgreSQL: T2, the 322 objects ─────────────────────────────────────────

def test_sequences_grant_nothing_to_clients(db):
    s = db
    for seq in SEQUENCES:
        for role in ("anon", "authenticated"):
            for priv in ("USAGE", "SELECT", "UPDATE"):
                assert psql(f"SELECT has_sequence_privilege('{role}', '{s}.{seq}', '{priv}')") == "f", (seq, role)
            assert "permission denied" in m326._denied(role, f"SELECT nextval('{s}.{seq}')")
        assert psql(f"SELECT count(*) FROM pg_class c, aclexplode(c.relacl) a "
                    f"WHERE c.oid = '{s}.{seq}'::regclass AND a.grantee = 0") == "0"


def test_harness_default_acl_gave_the_sequences_to_clients_before_341():
    """Negative control: without 341 the harness reproduces F2."""
    m332._require_pg()
    schema = "guc341_pre_" + uuid4().hex
    try:
        _build(schema)
        for seq in SEQUENCES:
            for role in ("anon", "authenticated"):
                assert psql(f"SELECT has_sequence_privilege('{role}', '{schema}.{seq}', 'USAGE')") == "t"
        assert psql(f"SELECT has_table_privilege('service_role', '{schema}.ai_model_override_audit', "
                    f"'INSERT')") == "t"
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


def test_override_audit_is_written_by_the_trigger_only(db):
    s = db
    feature = "f341_" + uuid4().hex[:8]
    actor, second = uuid4(), uuid4()
    # services/ai_model_overrides.py: PostgREST upsert on_conflict=feature as service_role.
    upsert = (f"INSERT INTO {s}.ai_model_overrides (feature, preferred_provider, anthropic_model, updated_by) "
              f"VALUES ('{feature}', '{{p}}', {{m}}, '{{a}}') ON CONFLICT (feature) DO UPDATE SET "
              f"preferred_provider = EXCLUDED.preferred_provider, anthropic_model = EXCLUDED.anthropic_model, "
              f"updated_by = EXCLUDED.updated_by, updated_at = now()")
    _svc(upsert.format(p="gemini", m="NULL", a=actor))
    _svc(upsert.format(p="gemini", m="NULL", a=second))   # no change → no row
    _svc(upsert.format(p="anthropic", m="'claude-haiku-5-5'", a=second))
    _svc(f"DELETE FROM {s}.ai_model_overrides WHERE feature = '{feature}'")
    rows = psql(f"SELECT string_agg(action || ':' || COALESCE(changed_by::text, '-'), ',' ORDER BY id) "
                f"FROM {s}.ai_model_override_audit WHERE feature = '{feature}'")
    assert rows == f"insert:{actor},update:{second},delete:-"
    assert "permission denied" in _fails(
        _svc, f"INSERT INTO {s}.ai_model_override_audit (feature, action) VALUES ('{feature}', 'insert')")
    assert psql(f"SELECT count(*) FROM {s}.ai_model_override_audit WHERE feature = '{feature}'") == "3"


@pytest.mark.parametrize("run", ["owner", "superuser"])
def test_override_audit_truncate_is_refused_for_every_role(db, run):
    s = db
    _svc(f"INSERT INTO {s}.ai_model_overrides (feature, preferred_provider) "
         f"VALUES ('t341_{uuid4().hex[:8]}', 'gemini')")
    count = psql(f"SELECT count(*) FROM {s}.ai_model_override_audit")
    assert "ai_model_override_audit is append-only" in _fails(
        RUNNERS[run], f"TRUNCATE {s}.ai_model_override_audit")
    assert "permission denied" in _fails(_svc, f"TRUNCATE {s}.ai_model_override_audit")
    assert psql(f"SELECT count(*) FROM {s}.ai_model_override_audit") == count != "0"


# ── PostgreSQL: preconditions, postconditions, rollback ─────────────────────

@pytest.mark.parametrize("missing,marker", [("336", "migration_336_missing"), ("322", "migration_322_missing")])
def test_precondition_aborts_and_creates_nothing(missing, marker):
    m332._require_pg()
    schema = "guc341_noprereq_" + uuid4().hex
    try:
        _build(schema, with_336=missing != "336", with_322=missing != "322")
        assert marker in _fails(_owner, _migrated(schema))
        assert psql(f"SELECT to_regclass('{schema}.{EVIDENCE}') IS NULL") == "t"
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


@pytest.mark.parametrize("tamper,revert,marker", [
    ("GRANT SELECT ON {s}." + EVIDENCE + " TO service_role",
     "REVOKE SELECT ON {s}." + EVIDENCE + " FROM service_role", "staff_privilege_evidence_privileges_wrong"),
    ("GRANT INSERT ON {s}." + EVIDENCE + " TO PUBLIC",
     "REVOKE INSERT ON {s}." + EVIDENCE + " FROM PUBLIC", "staff_privilege_evidence_privileges_wrong"),
    ("ALTER TABLE {s}." + EVIDENCE + " DISABLE ROW LEVEL SECURITY",
     "ALTER TABLE {s}." + EVIDENCE + " ENABLE ROW LEVEL SECURITY", "staff_privilege_evidence_rls_off"),
    ("INSERT INTO {s}." + EVIDENCE + " (target_user_id, kind, audit_id) VALUES (gen_random_uuid(), 'rpc', "
     "gen_random_uuid())", "DELETE FROM {s}." + EVIDENCE, "staff_privilege_evidence_not_empty"),
    ("ALTER TABLE {s}.users DISABLE TRIGGER trg_users_suspension_role_guard",
     "ALTER TABLE {s}.users ENABLE TRIGGER trg_users_suspension_role_guard", "staff_security_trigger_missing"),
    ("ALTER FUNCTION {s}.fn_ai_model_override_audit() SECURITY INVOKER",
     "ALTER FUNCTION {s}.fn_ai_model_override_audit() SECURITY DEFINER", "staff_security_function_wrong"),
    ("GRANT EXECUTE ON FUNCTION {s}.fn_users_privilege_audit() TO service_role",
     "REVOKE EXECUTE ON FUNCTION {s}.fn_users_privilege_audit() FROM service_role", "staff_security_function_wrong"),
    ("GRANT USAGE ON SEQUENCE {s}.ai_provider_failures_id_seq TO anon",
     "REVOKE USAGE ON SEQUENCE {s}.ai_provider_failures_id_seq FROM anon", "ai_override_sequence_privileges_wrong"),
    ("GRANT SELECT ON SEQUENCE {s}.ai_model_override_audit_id_seq TO PUBLIC",
     "REVOKE SELECT ON SEQUENCE {s}.ai_model_override_audit_id_seq FROM PUBLIC",
     "ai_override_sequence_privileges_wrong"),
    ("GRANT INSERT ON {s}.ai_model_override_audit TO service_role",
     "REVOKE INSERT ON {s}.ai_model_override_audit FROM service_role", "ai_model_override_audit_privileges_wrong"),
    ("ALTER TABLE {s}.ai_model_override_audit DISABLE TRIGGER trg_ai_model_override_audit_no_truncate",
     "ALTER TABLE {s}.ai_model_override_audit ENABLE TRIGGER trg_ai_model_override_audit_no_truncate",
     "ai_model_override_audit_trigger_missing"),
])
def test_postcondition_block_aborts_on_drift(db, tamper, revert, marker):
    s = db
    _owner(_postcondition_sql(s))   # clean state passes
    _owner(tamper.format(s=s))
    try:
        assert marker in _fails(_owner, _postcondition_sql(s))
    finally:
        _owner(revert.format(s=s))
    _owner(_postcondition_sql(s))


def test_postcondition_refuses_a_definer_that_does_not_own_its_table(fresh):
    s = fresh
    # A neutral role: an API role as owner would trip the privilege check first.
    psql("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'guc341_other') THEN "
         "CREATE ROLE guc341_other NOLOGIN; END IF; END $$;")
    psql(f"ALTER TABLE {s}.{EVIDENCE} OWNER TO guc341_other")
    error = _fails(psql, _postcondition_sql(s))
    assert "staff_definer_owner_mismatch" in error and "fn_set_staff_privilege" in error, error


def test_postcondition_refuses_a_body_that_reads_a_session_setting_again(fresh):
    s = fresh
    _owner(m331._schema_sql(m326._function(m336.SQL, "fn_users_suspension_role_guard"), s))
    assert "staff_security_function_wrong" in _fails(_owner, _postcondition_sql(s))


def test_header_rollback_reopens_f1_and_341_reapplies(fresh):
    """The rollback is the negative control for T4: with the old bodies the
    PC-J74 repro succeeds silently again."""
    s = fresh
    admin, target, again = _user(s, "admin", True), _user(s, "instructor", True), _user(s, "instructor", True)
    _suspend(s, admin, target)
    _suspend(s, admin, again)
    _owner(_rollback_sql(s))
    assert psql(f"SELECT to_regclass('{s}.{EVIDENCE}') IS NULL") == "t"
    assert psql(f"SELECT has_table_privilege('service_role', '{s}.ai_model_override_audit', 'INSERT')") == "t"
    rows = len(_audit(s, target))
    repro = (f"BEGIN; {_forged(admin)} UPDATE {s}.users SET role = 'admin', is_active = true, "
             f"suspended_at = NULL, suspended_by = NULL, suspension_reason = NULL WHERE id = '{{t}}'; COMMIT;")
    _svc(repro.format(t=target))
    assert _state(s, target)["role"] == "admin" and _state(s, target)["is_active"] is True
    assert len(_audit(s, target)) == rows, "F1 reopened: no audit row"
    # The 332/336 paths keep working on the restored bodies.
    assert _rpc(s, admin, target, active=False, reason="re-suspend")["changed"] is True

    _apply(s)
    error = _fails(_svc, repro.format(t=again))
    assert re.search(r"ERROR:\s+account_suspended\b", error), error
    assert _state(s, again)["suspended"] is True
    assert _rpc(s, admin, again, active=True, reason="back")["changed"] is True
    assert _audit(s, again)[-1]["source"] == "admin_api"


def test_rpc_and_bootstrap_stay_audited_after_the_332_header_rollback(fresh):
    """332's rollback drops the audit trigger and keeps the bootstrap, whose
    one row the 341 bootstrap then writes itself."""
    s = fresh
    admin, target = _user(s, "admin", True), _user(s, "admin", True)
    _suspend(s, admin, target)
    rpc_row = _rpc(s, admin, target, active=True, reason="before rollback")["audit_id"]
    assert _audit(s, target)[-1]["id"] == rpc_row
    _owner("DROP TRIGGER IF EXISTS trg_users_privilege_audit ON {s}.users".format(s=s))
    out = _rpc(s, admin, target, active=False, reason="partial rollback")
    row = _audit(s, target)[-1]
    assert row["id"] == out["audit_id"] and (row["source"], row["actor"], row["reason"]) == (
        "admin_api", admin, "partial rollback")
    _owner(f"UPDATE {s}.users SET is_active = false WHERE id = '{admin}'")
    audit_id = _owner(_bootstrap_sql(s, target))
    rows = [r for r in _audit(s, target) if r["event"] == "bootstrap_recovery"]
    assert [r["id"] for r in rows] == [audit_id] and rows[0]["detail"] == {"operator": "Vinh"}
    assert _evidence_rows(s) == "0"
