"""Migration 340 (AIBUDGET-0033 hardening, PC-J85): the PC-J67 findings
F01–F05 on migration 333.

The static half pins the file: one transaction, no top-level data change, the
five replaced RPCs keep the 333 signature/security/ACL text, the helper is
executable by no API role, the forward-policy row and the README paragraph.

The PostgreSQL half reuses the 333 harness (a disposable schema owned by a
NOSUPERUSER role, with Supabase's default privileges), applies 333 and then
340 twice, and proves:

- F01: NaN/Infinity/-Infinity caps (hard, soft and total), estimates,
  actuals and raise amounts/base caps raise `ai_budget_non_finite_amount`
  with no counter or reservation change; finite values still reserve, settle
  and release; the finite CHECKs reject direct writes and an existing NaN
  row aborts the migration without being rewritten;
- F02: every incomplete Speaking result is refused with no marker and the job
  is claimed again after its lease; the canonical result commits once;
- F03: the ROLLBACK (b) script refuses while only a class-score sync is owed,
  passes after the sync, and keeps every 333 guard; ROLLBACK (a) restores the
  333 bodies and 340 re-applies;
- F04: a stale Writing token after requeue/failed never commits; a reclaim
  token does;
- F05: a residual policy aborts 340 and is named, not dropped.

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

import re
from uuid import uuid4

import pytest

import test_migration_326_student_archive as m326
import test_migration_333_ai_budget as m333
from test_migration_240_core_attempt_evidence import psql

MIGRATIONS = m333.MIGRATIONS
NAME = "340_ai_budget_hardening.sql"
SQL = (MIGRATIONS / NAME).read_text(encoding="utf-8")
CODE = m326._strip_comments(SQL)
HELPER = "fn_ai_budget_assert_finite(numeric,text)"
REPLACED = ("fn_ai_budget_reserve", "fn_ai_budget_settle", "fn_ai_deferred_commit",
            "fn_ai_deferred_commit_writing", "fn_ai_budget_raise_grant")
CONSTRAINTS = {
    "ai_budget_counters": "ai_budget_counters_finite_usd",
    "ai_budget_reservations": "ai_budget_reservations_finite_usd",
    "ai_budget_raises": "ai_budget_raises_finite_usd",
    "ai_budget_raise_events": "ai_budget_raise_events_finite_usd",
    "ai_budget_alerts": "ai_budget_alerts_finite_usd",
}
NON_FINITE = ("NaN", "Infinity", "-Infinity")

_owner, _svc, _svc_json, _fails = m333._owner, m333._svc, m333._svc_json, m333._fails
_reserve, _reserve_sql, _caps, _line, _counters = (m333._reserve, m333._reserve_sql, m333._caps, m333._line,
                                                   m333._counters)


def _header(fn: str) -> str:
    """A function's definition up to its body: name, arguments, return type,
    language, volatility, security and search_path."""
    return fn[:fn.index("AS $$")]


def _script(marker: str, end: str) -> str:
    header = SQL[SQL.index(marker):SQL.index(end)]
    return "\n".join(line[5:] for line in header.splitlines() if line.startswith("--   "))


ROLLBACK_A = _script("-- ROLLBACK (a)", "-- ROLLBACK (b)")
ROLLBACK_B = _script("-- ROLLBACK (b)", "\nBEGIN;\n")
SPLICE = "-- <the five 333 function blocks, verbatim>"


def _rollback_a(schema: str) -> str:
    blocks = "\n\n".join(m326._function(m333.SQL, name) for name in REPLACED)
    assert ROLLBACK_A.count(SPLICE) == 1
    return m333._schema_sql(ROLLBACK_A.replace(SPLICE, blocks), schema)


def _rollback_b(schema: str) -> str:
    return m333._schema_sql(ROLLBACK_B, schema)


# ── Static contract ─────────────────────────────────────────────────────────

def test_one_transaction_with_lock_timeout_and_no_data_change():
    assert CODE.strip().startswith("BEGIN;") and CODE.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s';" in CODE
    top = m333._without_bodies(CODE)
    for forbidden in (r"\bDROP\b", r"DELETE\s+FROM", r"\bTRUNCATE\b", r"^\s*UPDATE\s", r"INSERT\s+INTO",
                      r"DISABLE\s+TRIGGER", r"session_replication_role", r"CREATE POLICY", r"CREATE TABLE"):
        assert not re.search(forbidden, top, re.M | re.I), forbidden


def test_replaced_rpcs_keep_the_333_signature_security_and_acl():
    names = re.findall(r"CREATE OR REPLACE FUNCTION public\.(\w+)\(", CODE)
    assert sorted(names) == sorted((*REPLACED, "fn_ai_budget_assert_finite"))
    for name in REPLACED:
        assert _header(m326._function(CODE, name)) == _header(m333._function(name)), name
        assert re.search(rf"REVOKE ALL ON FUNCTION public\.{name}\(", CODE), name
    granted = re.findall(r"GRANT EXECUTE ON FUNCTION public\.(\w+)\([^;]*\)\s+TO (\w+);", CODE)
    assert sorted(granted) == sorted((name, "service_role") for name in REPLACED)
    helper = m326._function(CODE, "fn_ai_budget_assert_finite")
    assert "SECURITY DEFINER" in helper and "SET search_path = public, pg_temp" in helper
    assert "ERRCODE = '22023'" in helper
    assert re.search(r"REVOKE ALL ON FUNCTION public\.fn_ai_budget_assert_finite\(numeric, text\) "
                     r"FROM PUBLIC, anon, authenticated, service_role;", CODE)
    assert not re.search(r"GRANT[^;]*\bTO\s+(?:anon|authenticated|PUBLIC)\b", CODE, re.I)


def test_header_maps_the_f02_required_fields_to_the_live_mapper():
    """The mapper statements the header cites still exist (their line numbers
    are those of staging f69055f65 and may drift)."""
    grading = (m333.BACKEND / "routers" / "grading.py").read_text(encoding="utf-8")
    for line, text in ((1022, '"transcript":                  transcript,'),
                       (1031, '"stt_status":                  "completed",'),
                       (1032, '"grading_status":              "completed" if grading else "failed",'),
                       (1058, 'db_row["overall_band"] = grading["overall_band"]'),
                       (1080, 'db_row["feedback"] = _serialize_feedback('),
                       (717, "if not transcript:")):
        assert text in grading, text
        assert f":{line}" in SQL, line
    commit = m326._function(CODE, "fn_ai_deferred_commit")
    for field in ("overall_band", "feedback", "transcript", "stt_status"):
        assert f"ai_deferred_commit_result_incomplete: {field}" in commit, field


def test_rollback_b_keeps_every_333_guard_adds_the_class_sync_guard_and_drops_after_them():
    note = ROLLBACK_B
    old = m333._rollback_sql("public")
    for guard in ("rollback_unsafe_deferred_jobs_pending", "rollback_unsafe_session_refresh_owed",
                  "rollback_unsafe_writing_jobs_deferred", "rollback_unsafe_raise_active",
                  "rollback_unsafe_class_sync_owed"):
        assert guard in note, guard
    assert "class_synced_generation < r.refreshed_generation" in note
    drops = [m.start() for m in re.finditer(r"\bDROP\b", note)]
    assert note.index("LOCK TABLE") < note.index("RAISE EXCEPTION")
    assert note.rindex("RAISE EXCEPTION") < drops[0]
    assert note.index("DROP TRIGGER IF EXISTS trg_ai_session_generation") == drops[0]
    for statement in re.findall(r"^(?:DROP|ALTER TABLE)[^\n]*", old, re.M):
        assert statement in note, statement
    assert "DROP FUNCTION IF EXISTS public.fn_ai_budget_assert_finite(numeric, text);" in note
    assert "ai_budget_raise_events" not in note[drops[0]:], "the raise audit is kept"


def test_forward_policy_and_readme_hold_340_in_the_ai_budget_group():
    rows = [line.split("\t") for line in (MIGRATIONS / "forward-policy.tsv").read_text(
        encoding="utf-8").splitlines() if line.startswith(NAME)]
    assert len(rows) == 1 and rows[0][1:3] == ["pending_feature", "ai_budget"]
    assert rows[0][3].startswith("AIBUDGET-0033 hardening (PC-J67 F01–F05); needs 333")
    readme = (MIGRATIONS / "README.md").read_text(encoding="utf-8")
    assert "Migration `340` (AIBUDGET-0033 hardening" in readme
    section_333 = readme[readme.index("Migration `333` (AIBUDGET-0033)"):]
    section_333 = section_333[:section_333.index("\nMigration `332`")]
    assert "340" in section_333 and "ROLLBACK (b)" in section_333


# ── PostgreSQL harness ──────────────────────────────────────────────────────

def _apply_340(schema: str) -> None:
    _owner(m333._schema_sql(SQL, schema))


@pytest.fixture
def s():
    """333 then 340 twice, in a fresh schema per test."""
    m333._require_pg()
    schema = "ai_budget_h_" + uuid4().hex
    try:
        m333._build(schema)
        m333._apply(schema)
        _apply_340(schema)
        _apply_340(schema)   # re-applying is a no-op
        yield schema
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


@pytest.fixture
def s333():
    """333 only: the state 340 is applied to."""
    m333._require_pg()
    schema = "ai_budget_o_" + uuid4().hex
    try:
        m333._build(schema)
        m333._apply(schema)
        yield schema
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


def _money(s: str) -> tuple:
    return (_counters(s), psql(f"SELECT count(*) || ':' || COALESCE(sum(estimate_usd), 0) || ':' || "
                               f"COALESCE(sum(actual_usd), 0) FROM {s}.ai_budget_reservations"),
            psql(f"SELECT count(*) FROM {s}.ai_budget_alerts"))


def _prosrc(schema: str, name: str) -> str:
    return psql(f"SELECT prosrc FROM pg_proc WHERE pronamespace = '{schema}'::regnamespace "
                f"AND proname = '{name}'").replace(schema, "S")


# ── PostgreSQL: catalog ─────────────────────────────────────────────────────

def test_catalog_acl_and_constraints_after_apply_and_rerun(s):
    for sig in m333.RPCS + m333.INTERNAL + (HELPER,):
        assert psql(f"SELECT prosecdef::text || '|' || array_to_string(proconfig, ';') || '|' || "
                    f"pg_get_userbyid(proowner) FROM pg_proc WHERE oid = '{s}.{sig}'::regprocedure") == (
            f"true|search_path={s}, pg_temp|{m333.OWNER}"), sig
        for role in ("anon", "authenticated"):
            assert psql(f"SELECT has_function_privilege('{role}', '{s}.{sig}', 'EXECUTE')") == "f", (sig, role)
        assert psql(f"SELECT count(*) FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = '{s}.{sig}'::regprocedure "
                    f"AND a.grantee = 0") == "0", sig
        expected = "t" if sig in m333.RPCS else "f"
        assert psql(f"SELECT has_function_privilege('service_role', '{s}.{sig}', 'EXECUTE')") == expected, sig
    for table, constraint in CONSTRAINTS.items():
        assert psql(f"SELECT count(*) || ':' || bool_and(convalidated) FROM pg_constraint "
                    f"WHERE conrelid = '{s}.{table}'::regclass AND conname LIKE '%finite%'") == "1:true", table
    for table in m333.TABLES:
        assert psql(f"SELECT count(*) FROM pg_policy WHERE polrelid = '{s}.{table}'::regclass") == "0"
    assert "permission denied" in _fails(psql, f"SET ROLE service_role; SELECT {s}.fn_ai_budget_assert_finite(1, 'x');")


def test_precondition_requires_333():
    m333._require_pg()
    schema = "ai_budget_p_" + uuid4().hex
    try:
        m333._build(schema)
        message = _fails(_apply_340, schema)
        assert "ai_budget_hardening_requires_333" in message and "ai_budget_counters" in message
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


def test_postcondition_names_a_reverted_body(s):
    """Re-running 333 after 340 restores the weak bodies; 340 detects it and a
    re-run of 340 repairs it."""
    m333._apply(s)
    post = m333._schema_sql(SQL[SQL.rindex("DO $$"):SQL.rindex("NOTIFY")], s)
    message = _fails(_owner, post)
    assert "ai_budget_hardening_body_missing" in message and "fn_ai_deferred_commit" in message
    _apply_340(s)
    _owner(post)


# ── PostgreSQL: F01 non-finite money ────────────────────────────────────────

@pytest.mark.parametrize("value", NON_FINITE)
def test_non_finite_caps_estimates_and_actuals_are_refused_without_a_write(s, value):
    granted = _reserve(s, "base", [_line("openai", 0.2), _line("anthropic", 0.3, 2)])
    ids = m333._ids(granted)
    before = _money(s)
    for scope, kind in (("openai", "month"), ("google", "day"), ("anthropic", "day"),
                        ("anthropic", "month"), ("total", "month"), ("total", "day")):
        caps = _caps(**{scope: {kind: value}})
        for lines in ([_line("openai", 0.1)], [_line("anthropic", 0.1)]):   # touched or not
            message = _fails(_svc, _reserve_sql(s, "c-" + uuid4().hex, lines, caps))
            assert f"ai_budget_non_finite_amount: caps.{scope}.{kind}" in message, (scope, kind)
    for provider in ("openai", "anthropic"):   # hard and soft lines
        message = _fails(_svc, _reserve_sql(s, "e-" + uuid4().hex, [_line(provider, value)]))
        assert "ai_budget_non_finite_amount: estimate_usd" in message
    for line in ids.values():
        message = _fails(_svc, f"SELECT {s}.fn_ai_budget_settle('{line}', '{value}'::numeric);")
        assert "ai_budget_non_finite_amount: actual_usd" in message
    assert _money(s) == before, "no counter, reservation or alert changed"
    assert psql(f"SELECT string_agg(DISTINCT status, ',') FROM {s}.ai_budget_reservations") == "reserved"


@pytest.mark.parametrize("value", NON_FINITE)
def test_non_finite_raise_amount_and_base_caps_are_refused(s, value):
    for kwargs, field in (({"amount": f"'{value}'::numeric"}, "amount_usd"),
                          ({"caps": _caps(google={"month": value})}, "base_caps.month"),
                          ({"caps": _caps(google={"day": value})}, "base_caps.day")):
        message = _fails(_svc, m333._grant_sql(s, **kwargs))
        assert f"ai_budget_non_finite_amount: {field}" in message, kwargs
    for table in ("ai_budget_raises", "ai_budget_raise_events", "ai_budget_alerts", "ai_budget_counters"):
        assert psql(f"SELECT count(*) FROM {s}.{table}") == "0", table
    assert m333._grant(s)["granted"] is True, "a finite raise still grants"


def test_finite_values_still_reserve_settle_and_release_on_hard_soft_and_total(s):
    r = m333._ids(_reserve(s, "ok", [_line("openai", 0.4, 1), _line("anthropic", 0.6, 2), _line("google", 0.3, 3)]))
    assert _svc_json(f"SELECT {s}.fn_ai_budget_settle('{r[('openai', 1)]}', 0.1);")["status"] == "settled"
    assert _svc_json(f"SELECT {s}.fn_ai_budget_settle('{r[('anthropic', 2)]}', 0.5);")["status"] == "settled"
    assert _svc_json(f"SELECT {s}.fn_ai_budget_release('{r[('google', 3)]}');")["status"] == "released"
    c = _counters(s)
    assert (c["openai:day"]["settled"], c["anthropic:month"]["settled"], c["google:month"]["reserved"]) == (
        0.1, 0.5, 0)
    assert (c["total:month"]["settled"], c["total:day"]["reserved"]) == (0.6, 0)
    assert c["anthropic:month"]["cap"] == 100 and c["total:month"]["cap"] == 200
    assert m333._v3_drift(s) == []
    # A cap given as a numeric string is still accepted (T001 sends numbers).
    assert _reserve(s, "str", [_line("azure", 0.1)], _caps(azure={"month": "20", "day": "1.5"}))["granted"] is True


def test_finite_checks_reject_direct_writes(s):
    for sql, constraint in (
            (f"INSERT INTO {s}.ai_budget_counters (scope, period_kind, period_start, settled_usd) "
             f"VALUES ('openai', 'day', current_date, 'NaN')", "ai_budget_counters_finite_usd"),
            (f"INSERT INTO {s}.ai_budget_counters (scope, period_kind, period_start, cap_usd) "
             f"VALUES ('total', 'day', current_date, 'NaN')", "ai_budget_counters_finite_usd"),
            (f"INSERT INTO {s}.ai_budget_reservations (id, request_key, line_no, provider, model, feature, "
             f"month_start, day_start, estimate_usd, expires_at) VALUES (gen_random_uuid(), 'k', 1, 'openai', "
             f"'m', 'f', current_date, current_date, 'NaN', now())", "ai_budget_reservations_finite_usd"),
            (f"INSERT INTO {s}.ai_budget_alerts (scope, period_kind, period_start, threshold, trigger, cap_usd) "
             f"VALUES ('openai', 'day', current_date, 100, 'crossing', 'NaN')", "ai_budget_alerts_finite_usd")):
        assert constraint in _fails(_owner, sql), sql


def test_an_existing_nan_row_aborts_340_and_is_not_rewritten(s333):
    psql(f"INSERT INTO {s333}.ai_budget_counters (scope, period_kind, period_start, settled_usd) "
         f"VALUES ('openai', 'day', current_date, 'NaN'), ('openai', 'month', current_date, 'NaN')")
    message = _fails(_apply_340, s333)
    assert "ai_budget_non_finite_rows: ai_budget_counters=2" in message
    assert psql(f"SELECT count(*) FROM {s333}.ai_budget_counters WHERE settled_usd = 'NaN'") == "2"
    assert psql(f"SELECT count(*) FROM pg_constraint WHERE conname LIKE 'ai_budget_%_finite_usd' "
                f"AND connamespace = '{s333}'::regnamespace") == "0", "the whole migration rolled back"
    assert psql(f"SELECT to_regprocedure('{s333}.{HELPER}') IS NULL") == "t"


# ── PostgreSQL: F02 incomplete Speaking results ─────────────────────────────

RESULT = m333.RESULT


def _commit_sql(s: str, job: str, token: str, result) -> str:
    payload = "NULL::jsonb" if result is None else m333._j(result)
    return f"SELECT {s}.fn_ai_deferred_commit('{job}', {m333._q(token)}::uuid, {payload});"


def _without(key: str) -> dict:
    return {**RESULT, "response": {k: v for k, v in RESULT["response"].items() if k != key}}


def _with(**changes) -> dict:
    return {**RESULT, "response": {**RESULT["response"], **changes}}


INCOMPLETE = (
    (None, "ai_deferred_commit_invalid_result"),
    ({}, "ai_deferred_commit_invalid_result"),
    ({"grammar_recommendations": []}, "ai_deferred_commit_invalid_result"),
    ({"response": None}, "ai_deferred_commit_invalid_result"),
    ({"response": {}}, "ai_deferred_commit_invalid_result"),
    ({"response": "graded"}, "ai_deferred_commit_invalid_result"),
    (_without("overall_band"), "ai_deferred_commit_result_incomplete: overall_band"),
    (_with(overall_band=None), "ai_deferred_commit_result_incomplete: overall_band"),
    (_with(overall_band="6.5"), "ai_deferred_commit_result_incomplete: overall_band"),
    (_with(overall_band=12), "ai_deferred_commit_result_incomplete: overall_band"),
    (_without("feedback"), "ai_deferred_commit_result_incomplete: feedback"),
    (_with(feedback={}), "ai_deferred_commit_result_incomplete: feedback"),
    (_with(feedback=""), "ai_deferred_commit_result_incomplete: feedback"),
    (_with(feedback="{}"), "ai_deferred_commit_result_incomplete: feedback"),
    (_with(feedback=None), "ai_deferred_commit_result_incomplete: feedback"),
    (_without("transcript"), "ai_deferred_commit_result_incomplete: transcript"),
    (_with(transcript="  "), "ai_deferred_commit_result_incomplete: transcript"),
    (_without("stt_status"), "ai_deferred_commit_result_incomplete: stt_status"),
    (_with(stt_status="failed"), "ai_deferred_commit_result_incomplete: stt_status"),
)


def test_incomplete_results_are_refused_and_the_job_is_reclaimed(s):
    sid, qid, token = m333._session(s), str(uuid4()), str(uuid4())
    saved = m333._save(s, sid, qid, token, m333._path(token), "absent")   # stored stt_status 'pending'
    job, rid = saved["job_id"], saved["response_id"]
    lease = m333._claim(s)[0]["lease_token"]
    gen = m333._generation(s, sid)
    for result, marker in INCOMPLETE:
        assert marker in _fails(_svc, _commit_sql(s, job, lease, result)), result
    assert psql(f"SELECT status || ':' || (persisted_at IS NULL) || ':' || commit_count "
                f"FROM {s}.ai_deferred_grading_jobs WHERE id = '{job}'") == "running:true:0"
    assert psql(f"SELECT grading_status || ':' || COALESCE(overall_band::text, 'null') || ':' || "
                f"COALESCE(transcript, 'null') FROM {s}.responses WHERE id = '{rid}'") == "awaiting_budget:null:null"
    assert psql(f"SELECT count(*) FROM {s}.grammar_recommendations WHERE response_id = '{rid}'") == "0"
    assert m333._generation(s, sid) == gen, "no response write"
    # The job is claimable again after its lease, and the canonical result commits once.
    assert m333._claim(s) == []
    psql(f"UPDATE {s}.ai_deferred_grading_jobs SET lease_until = now() - interval '1 second'")
    fresh = m333._claim(s)[0]
    assert fresh["id"] == job and fresh["attempts"] == 2
    assert _svc_json(_commit_sql(s, job, fresh["lease_token"], RESULT))["status"] == "committed"
    assert _svc_json(_commit_sql(s, job, fresh["lease_token"], RESULT)) == {"status": "duplicate"}
    assert psql(f"SELECT status || ':' || commit_count FROM {s}.ai_deferred_grading_jobs "
                f"WHERE id = '{job}'") == "done:1"


def test_a_stored_transcript_and_stt_status_satisfy_the_check(s):
    sid, qid, token = m333._session(s), str(uuid4()), str(uuid4())
    row = {"audio_url": "signed://x", "transcript": "stored answer", "stt_status": "completed"}
    saved = m333._save(s, sid, qid, token, m333._path(token), "absent", row=row)
    lease = m333._claim(s)[0]["lease_token"]
    result = {**RESULT, "response": {"overall_band": 6, "feedback": '{"band_fc": 6}'}}
    assert _svc_json(_commit_sql(s, saved["job_id"], lease, result))["status"] == "committed"
    assert psql(f"SELECT grading_status || ':' || overall_band || ':' || transcript FROM {s}.responses "
                f"WHERE id = '{saved['response_id']}'") == "completed:6:stored answer"


# ── PostgreSQL: F04 stale Writing worker ────────────────────────────────────

def test_stale_writing_token_after_requeue_or_failure_never_commits(s):
    claim = f"SELECT {s}.fn_ai_deferred_claim_writing(1, 300);"
    for state in ("queued", "failed"):
        essay, job = m333._writing_job(s)
        stale = _svc_json(claim)[0]["budget_lease_token"]
        psql(f"UPDATE {s}.writing_jobs SET status = '{state}', budget_lease_until = NULL WHERE id = '{job}'")
        assert _svc_json(m333._commit_writing_sql(s, job, stale)) == {"status": "lease_lost"}, state
        assert psql(f"SELECT count(*) FROM {s}.writing_feedback WHERE essay_id = '{essay}'") == "0"
        assert psql(f"SELECT status || ':' || (budget_persisted_at IS NULL) FROM {s}.writing_jobs "
                    f"WHERE id = '{job}'") == f"{state}:true"
        assert psql(f"SELECT status FROM {s}.writing_essays WHERE id = '{essay}'") == "pending"
        if state == "queued":
            fresh = _svc_json(claim)[0]["budget_lease_token"]
            assert fresh != stale
            assert _svc_json(m333._commit_writing_sql(s, job, stale)) == {"status": "lease_lost"}
            assert _svc_json(m333._commit_writing_sql(s, job, fresh)) == {
                "status": "committed", "essay_id": essay, "version": 1}
        else:
            psql(f"DELETE FROM {s}.writing_jobs WHERE id = '{job}'")


# ── PostgreSQL: F05 residual policy ─────────────────────────────────────────

def test_a_residual_policy_aborts_340_and_is_named_not_dropped(s333):
    psql(f"CREATE POLICY leftover_read ON {s333}.ai_budget_counters FOR SELECT TO authenticated USING (true)")
    message = _fails(_apply_340, s333)
    assert "ai_budget_policy_present: ai_budget_counters.leftover_read" in message
    assert psql(f"SELECT count(*) FROM pg_policy WHERE polrelid = '{s333}.ai_budget_counters'::regclass") == "1"
    assert psql(f"SELECT to_regprocedure('{s333}.{HELPER}') IS NULL") == "t", "the whole migration rolled back"


# ── PostgreSQL: F03 rollback scripts ────────────────────────────────────────

def _owed_class_sync(s: str) -> tuple[str, str]:
    """J67 F03: a session on a class item, its band written, the sync not run."""
    item = str(uuid4())
    psql(f"INSERT INTO {s}.class_assignment_items (id, score) VALUES ('{item}', 4)")
    sid = m333._session(s, "in_progress", item)
    m333._response(s, sid)
    psql(f"UPDATE {s}.sessions SET status = 'completed' WHERE id = '{sid}'")
    gen = m333._generation(s, sid)[0]
    assert _svc_json(f"SELECT {s}.fn_ai_deferred_aggregate_write('{sid}', {gen}, "
                     f"'{{\"overall_band\": 7}}');")["status"] == "written"
    assert m333._generation(s, sid) == (gen, gen, 0)
    return sid, item


def test_rollback_b_refuses_while_only_a_class_sync_is_owed(s):
    sid, item = _owed_class_sync(s)
    rollback = _rollback_b(s)
    assert "rollback_unsafe_class_sync_owed" in _fails(_owner, rollback)
    assert psql(f"SELECT to_regclass('{s}.ai_deferred_session_refresh') IS NOT NULL") == "t"
    psql(f"UPDATE {s}.class_assignment_items SET artifact_kind = 'session', artifact_id = '{sid}', "
         f"submitted_at = now() WHERE id = '{item}'")
    assert _svc_json(f"SELECT {s}.fn_ai_class_sync('{sid}');")["status"] == "synced"
    assert psql(f"SELECT score FROM {s}.class_assignment_items WHERE id = '{item}'") == "7.0"
    _owner(rollback)
    assert psql(f"SELECT to_regclass('{s}.ai_deferred_session_refresh') IS NULL") == "t"
    assert psql(f"SELECT score FROM {s}.class_assignment_items WHERE id = '{item}'") == "7.0"


def test_rollback_b_keeps_every_333_guard_then_drops_the_group(s):
    sid, qid, token = m333._session(s), str(uuid4()), str(uuid4())
    saved = m333._save(s, sid, qid, token, m333._path(token), "absent")
    rollback = _rollback_b(s)
    assert "rollback_unsafe_deferred_jobs_pending" in _fails(_owner, rollback)
    lease = m333._claim(s)[0]["lease_token"]
    _svc(_commit_sql(s, saved["job_id"], lease, RESULT))
    psql(f"UPDATE {s}.sessions SET status = 'completed' WHERE id = '{sid}'")
    assert "rollback_unsafe_session_refresh_owed" in _fails(_owner, rollback)
    gen = m333._generation(s, sid)[0]
    _svc(f"SELECT {s}.fn_ai_deferred_aggregate_write('{sid}', {gen}, '{{\"overall_band\": 6.5}}');")
    # A session with no class item owes no score: its unsynced generation does not block.
    assert m333._generation(s, sid) == (gen, gen, 0)
    essay, job = m333._writing_job(s)
    assert "rollback_unsafe_writing_jobs_deferred" in _fails(_owner, rollback)
    psql(f"UPDATE {s}.writing_jobs SET status = 'failed' WHERE id = '{job}'")
    rid = m333._grant(s)["raise"]["id"]
    assert "rollback_unsafe_raise_active" in _fails(_owner, rollback)
    _svc(f"SELECT {s}.fn_ai_budget_raise_end('{rid}', '{m333.ADMIN}', 'aal2', 'rollback drill', 'req');")

    _owner(rollback)
    assert psql(f"SELECT count(*) FROM pg_trigger WHERE tgrelid = '{s}.responses'::regclass "
                f"AND tgname = 'trg_ai_session_generation'") == "0"
    for table in ("ai_budget_counters", "ai_budget_reservations", "ai_budget_alerts", "ai_deferred_grading_jobs",
                  "ai_deferred_session_refresh", "ai_budget_raises", "ai_budget_heartbeat"):
        assert psql(f"SELECT to_regclass('{s}.{table}') IS NULL") == "t", table
    assert psql(f"SELECT count(*) FROM {s}.ai_budget_raise_events") == "2", "the audit is kept"
    assert psql(f"SELECT count(*) FROM pg_proc WHERE pronamespace = '{s}'::regnamespace "
                f"AND proname LIKE 'fn_ai_%' AND proname <> 'fn_ai_budget_raise_events_append_only'") == "0"
    assert psql(f"SELECT count(*) FROM information_schema.columns WHERE table_schema = '{s}' "
                f"AND table_name = 'writing_jobs' AND column_name LIKE 'budget_%'") == "0"
    psql(f"UPDATE {s}.responses SET overall_band = 7 WHERE id = '{saved['response_id']}'")
    m333._response(s, m333._session(s))


def test_rollback_a_restores_the_333_bodies_and_340_reapplies(s, s333):
    _owner(_rollback_a(s))
    for name in REPLACED:
        assert _prosrc(s, name) == _prosrc(s333, name), name
    assert psql(f"SELECT to_regprocedure('{s}.{HELPER}') IS NULL") == "t"
    assert psql(f"SELECT count(*) FROM pg_constraint WHERE conname LIKE 'ai_budget_%_finite_usd' "
                f"AND connamespace = '{s}'::regnamespace") == "0"
    for sig in m333.RPCS:
        assert psql(f"SELECT has_function_privilege('service_role', '{s}.{sig}', 'EXECUTE')") == "t", sig
        assert psql(f"SELECT has_function_privilege('authenticated', '{s}.{sig}', 'EXECUTE')") == "f", sig
    assert _reserve(s, "after-a", [_line("openai", 0.1)])["granted"] is True, "the 333 bodies work"
    _apply_340(s)
    assert "ai_budget_non_finite_amount" in _fails(
        _svc, _reserve_sql(s, "nan", [_line("openai", "NaN")]))
