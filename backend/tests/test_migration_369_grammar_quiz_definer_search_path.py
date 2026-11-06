"""SA-2209: catalog, overload repro, unchanged 339 behavior and guarded repair.

369 pins the four SECURITY DEFINER functions whose latest body is 339. The
actual-PostgreSQL tests reuse the Grammar quiz fixture (309/314/339 applied
to a random schema, real cutover receipts from the admin owner). The fixture
URL must be a named loopback aver_ux_ database (see the boundary fixture).
"""
from __future__ import annotations

import functools
import hashlib
import inspect
import json
import re

import asyncpg
import pytest
import pytest_asyncio

import test_grammar_quiz_followup_codes as followup
import test_grammar_quiz_revision_boundary as boundary
import test_grammar_quiz_revisions as revisions
import test_migration_326_student_archive as m326
from test_grammar_quiz_revision_boundary import MIGRATIONS, pg  # noqa: F401 (fixture)

NAME = "369_grammar_quiz_definer_search_path.sql"
SQL = (MIGRATIONS / NAME).read_text()
DOWN = (MIGRATIONS / "rollback" / NAME).read_text()
SQL_339 = (MIGRATIONS / "339_grammar_quiz_followup_codes.sql").read_text()
# Catalog functions each 339 body calls (the only text 369 changes besides the path).
CALLS = {
    "grammar_quiz_audit_chain": ("count", "left"),
    "grammar_quiz_guard_bank": ("count", "left", "to_jsonb"),
    "grammar_quiz_validate_receipt_envelope": (
        "count", "jsonb_agg", "jsonb_array_elements_text", "jsonb_array_length", "jsonb_build_array",
        "jsonb_build_object", "jsonb_each", "jsonb_object_agg", "jsonb_object_keys", "jsonb_set",
        "jsonb_typeof", "left", "unnest"),
    "grammar_quiz_receipt_data": (
        "array_append", "bool_or", "convert_to", "count", "encode", "json_typeof", "jsonb_array_elements",
        "jsonb_array_length", "jsonb_object_keys", "jsonb_typeof", "octet_length", "sha256", "to_jsonb"),
}
SIGS = {"grammar_quiz_audit_chain": "text", "grammar_quiz_guard_bank": "",
        "grammar_quiz_validate_receipt_envelope": "jsonb,uuid,uuid", "grammar_quiz_receipt_data": "uuid"}
OLD = "SET search_path=public,pg_temp"
PIN = "SET search_path = pg_catalog, pg_temp"
DO_CALLS = ("aclexplode", "array_to_string", "count", "has_function_privilege", "md5", "string_agg",
            "to_regclass", "to_regprocedure")


def _qualified(statement, name):
    assert statement.count(OLD) == 1
    statement = statement.replace(OLD, PIN)
    for call in CALLS[name]:
        statement = re.sub(rf"(?<![\w.]){call}\(", f"pg_catalog.{call}(", statement)
    return statement


def _body(statement):
    return statement.split("AS $$", 1)[1].rsplit("$$;", 1)[0]


def _md5(text):
    return hashlib.md5(text.encode()).hexdigest()


def _adapt(pg, sql):
    """The fixture's schema mapping, plus the hashes of the mapped bodies."""
    result = pg.adapted(sql).replace("'public'::regnamespace", f"'{pg.schema}'::regnamespace")
    for name in CALLS:
        original = m326._function(SQL_339, name)
        for statement in (original, _qualified(original, name)):
            result = result.replace(_md5(_body(statement)), _md5(_body(pg.adapted(statement))))
    return result


def _post(pg, sql=SQL):
    # The final identity block needs its transaction-local snapshot. The
    # independent catalog postcondition is deliberately executable on its own.
    code = sql.split("-- Postconditions\n", 1)[1]
    return _adapt(pg, code[:code.index("END $$;") + len("END $$;")])


async def _record(pg):
    await pg.c.execute("CREATE TABLE IF NOT EXISTS _schema_migrations (filename text PRIMARY KEY)")
    await pg.c.execute("INSERT INTO _schema_migrations VALUES ('339_grammar_quiz_followup_codes.sql') "
                       "ON CONFLICT DO NOTHING")


async def _apply(pg, sql=SQL):
    await pg.c.execute(_adapt(pg, sql))


async def _fails(pg, sql):
    with pytest.raises(asyncpg.PostgresError) as error:
        await pg.c.execute(sql)
    await pg.c.execute("ROLLBACK")
    return str(error.value)


async def _catalog(pg):
    rows = await pg.c.fetch("""SELECT p.oid, p.oid::regprocedure::text AS sig, p.proowner, p.proacl::text AS acl,
        p.prosecdef, p.prosrc, p.proconfig, p.provolatile, p.proargdefaults::text AS defaults
        FROM pg_proc p WHERE p.pronamespace = $1::regnamespace ORDER BY 2""", pg.schema)
    return {r["sig"].removeprefix(pg.schema + "."): dict(r) for r in rows}


async def _other_catalog(pg):
    return await pg.c.fetchval("""SELECT json_build_object(
        'triggers', (SELECT json_agg(json_build_object('oid', g.oid, 'name', g.tgname, 'rel', g.tgrelid,
                       'fn', g.tgfoid, 'enabled', g.tgenabled, 'type', g.tgtype) ORDER BY g.oid)
                     FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid WHERE c.relnamespace = $1::regnamespace),
        'relations', (SELECT json_agg(json_build_object('oid', oid, 'acl', relacl, 'owner', relowner,
                        'rls', relrowsecurity) ORDER BY oid)
                      FROM pg_class WHERE relnamespace = $1::regnamespace),
        'rows', (SELECT json_build_object('banks', (SELECT json_agg(b ORDER BY id) FROM quiz_banks b),
                                          'receipts', (SELECT json_agg(a ORDER BY id) FROM governance_audit a))))::text""",
                                 pg.schema)


def _expected_sigs():
    return {f"{name}({args})" for name, args in SIGS.items()}


@pytest_asyncio.fixture
async def pinned(pg):  # noqa: F811 (fixture parameter)
    await _record(pg)
    await _apply(pg)
    yield pg


# ── Static shape ─────────────────────────────────────────────────────────────

def test_focused_transaction_and_exact_body_diff():
    code = m326._strip_comments(SQL)
    assert code.strip().startswith("BEGIN;\nSET LOCAL search_path = pg_catalog, pg_temp;\nSET LOCAL lock_timeout = '5s';")
    assert code.strip().endswith("COMMIT;")
    assert len(re.findall(r"^BEGIN;", code, re.M)) == 1
    assert len(re.findall(r"^CREATE OR REPLACE FUNCTION", code, re.M)) == len(CALLS)
    for name in CALLS:
        original = m326._function(SQL_339, name)
        assert m326._function(SQL, name) == _qualified(original, name)
        assert m326._function(DOWN, name) == original
        # Nothing callable is left unqualified except keywords, public helpers
        # and the jsonb_each column alias e(k,v).
        assert set(re.findall(r"(?<![\w.])([a-z_]\w*)\(", _body(m326._function(SQL, name)))) <= {"e"}
    for sql in (SQL, DOWN):
        top = re.sub(r"\$\$.*?\$\$", "$$ $$", m326._strip_comments(sql), flags=re.S)
        assert top.count("CREATE TEMP TABLE m369_function_identity ON COMMIT DROP AS") == 1
        top = top.replace("ON COMMIT DROP", "ON COMMIT CLEANUP")
        assert not re.search(r"\b(GRANT|REVOKE|DROP|TRUNCATE|UPDATE|DELETE|INSERT|NOTIFY)\b|OWNER TO|TRIGGER\s+\w+\s+(BEFORE|AFTER)", top)


def test_do_blocks_only_use_qualified_catalog_calls_and_operators():
    for sql in (SQL, DOWN):
        blocks = re.findall(r"DO \$\$(.*?)END \$\$;", sql, re.S)
        assert len(blocks) == 3
        for block in blocks:
            for call in DO_CALLS:
                assert not re.search(rf"(?<![\w.]){call}\s*\(", block), call
            stripped = re.sub(r"'(?:[^']|'')*'", "''", block)
            stripped = re.sub(r"OPERATOR\(pg_catalog\.[^)]*\)", "OP", stripped)
            stripped = stripped.replace(":=", "ASSIGN")
            assert not re.search(r"=|<>|\|\|", stripped)


def test_policy_is_pending_and_order_is_explicit():
    rows = [line.split("\t") for line in (MIGRATIONS / "forward-policy.tsv").read_text().splitlines()
            if line.startswith(NAME)]
    assert len(rows) == 1 and rows[0][1:3] == ["pending_feature", "grammar_quiz_search_path"]
    for text in (rows[0][3], (MIGRATIONS / "README.md").read_text()):
        for needle in ("needs 339", "after SA", "No apply on merge"):
            assert needle in text


# ── Actual PostgreSQL ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_catalog_before_after_only_path_and_catalog_qualification(pg):
    await pg.enroll()
    await _record(pg)
    original = await _catalog(pg)
    others = await _other_catalog(pg)
    await _apply(pg)
    after = await _catalog(pg)
    assert original.keys() == after.keys() and _expected_sigs() <= original.keys()
    for sig, old in original.items():
        expected = dict(old)
        name = sig.split("(", 1)[0]
        if sig in _expected_sigs():
            assert old["proconfig"] == [f"search_path={pg.schema}, pg_temp"] and old["prosecdef"]
            expected["proconfig"] = ["search_path=pg_catalog, pg_temp"]
            expected["prosrc"] = _body(pg.adapted(_qualified(m326._function(SQL_339, name), name)))
            assert old["prosrc"] == _body(pg.adapted(m326._function(SQL_339, name)))
        assert after[sig] == expected, sig
    assert await _other_catalog(pg) == others
    await _apply(pg)
    assert await _catalog(pg) == after
    assert await _other_catalog(pg) == others


async def _plant(pg):
    # service_role has CREATE here only to model the pre-357 attack surface.
    svc = pg.roles["service_role"]
    s = pg.schema
    await pg.c.execute(f"GRANT CREATE ON SCHEMA {s} TO {svc}")
    await pg.c.execute(f"SET ROLE {svc}")
    try:
        await pg.c.execute(f"""
            CREATE FUNCTION {s}.to_jsonb({s}.quiz_banks) RETURNS jsonb LANGUAGE plpgsql AS $$
            DECLARE ctx text; BEGIN GET DIAGNOSTICS ctx = PG_CONTEXT;
            RAISE NOTICE 'attacker_called to_jsonb % via %', current_user, pg_catalog.split_part(ctx, E'\\n', 2);
            RETURN pg_catalog.to_jsonb($1); END $$;
            CREATE FUNCTION {s}.jsonb_build_object(text, jsonb, text, jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
            DECLARE ctx text; BEGIN GET DIAGNOSTICS ctx = PG_CONTEXT;
            RAISE NOTICE 'attacker_called jsonb_build_object % via %', current_user, pg_catalog.split_part(ctx, E'\\n', 2);
            RETURN pg_catalog.jsonb_build_object($1, $2, $3, $4); END $$;""")
    finally:
        await pg.c.execute("RESET ROLE")


async def _unplant(pg):
    s = pg.schema
    await pg.c.execute(f"DROP FUNCTION {s}.to_jsonb({s}.quiz_banks); "
                       f"DROP FUNCTION {s}.jsonb_build_object(text, jsonb, text, jsonb)")


async def _scenario(pg):
    """service_role reaches every pinned definer: state/start/progress -> receipt
    proof and envelope, and a refused managed-bank UPDATE -> bank guard."""
    notices = []
    listener = lambda _connection, message: notices.append(message.message)  # noqa: E731
    pg.c.add_log_listener(listener)
    svc = pg.roles["service_role"]
    try:
        await pg.c.execute(f"SET ROLE {svc}")
        state = await pg.rpc("grammar_quiz_state", pg.user, pg.old)
        legacy = await pg.start()
        progress = await pg.progress(legacy["session_id"])
        with pytest.raises(asyncpg.PostgresError, match="grammar_managed_bank_immutable"):
            await pg.c.execute("UPDATE quiz_banks SET title='x' WHERE id=$1", pg.new)
    finally:
        await pg.c.execute("RESET ROLE")
        pg.c.remove_log_listener(listener)
    chain = await pg.c.fetchval("SELECT grammar_quiz_audit_chain($1)", pg.code)
    receipt = await pg.c.fetchval("SELECT grammar_quiz_receipt_data($1)::text", pg.old)
    owner = await pg.c.fetchval("SELECT proowner::regrole::text FROM pg_proc WHERE oid=$1::regprocedure",
                                f"{pg.schema}.grammar_quiz_receipt_data(uuid)")
    facts = {"can_continue_legacy": state["can_continue_legacy"], "content_state": legacy["grammar"]["content_state"],
             "attempts": progress["attempts"], "chain": chain, "receipt_cohort": len(json.loads(receipt)["cohort"])}
    return _callers(notices), facts, owner


def _callers(notices):
    """{(planted function, role it ran as, direct caller)} from the PG_CONTEXT line."""
    found = set()
    for notice in notices:
        match = re.fullmatch(r"attacker_called (\w+) (\S+) via (?:PL/pgSQL|SQL) function "
                             r"(?:\"?)(?:[\w]+\.)?(\w+)[\s\S]*", notice)
        assert match, notice
        found.add(match.groups())
    return found


@pytest.mark.asyncio
async def test_planted_overloads_run_as_definer_before_pin_and_never_after(pg):
    await pg.enroll()
    await _record(pg)
    await _plant(pg)
    before, expected, owner = await _scenario(pg)
    assert {("to_jsonb", owner, "grammar_quiz_guard_bank"),
            ("jsonb_build_object", owner, "grammar_quiz_validate_receipt_envelope")} <= before
    await _unplant(pg)
    await _apply(pg)
    await _plant(pg)
    after, actual, _ = await _scenario(pg)
    # Out-of-scope 309/314 helpers keep public, pg_temp and may still be direct
    # callers (locally: grammar_quiz_bank_evidence -> to_jsonb); never the four.
    assert not {caller for *_, caller in after} & set(SIGS)
    assert actual == expected
    assert expected["can_continue_legacy"] and expected["chain"] and expected["receipt_cohort"] >= 1


@pytest.mark.asyncio
async def test_temp_tables_do_not_replace_canonical_tables(pinned):
    pg = pinned
    await pg.enroll()
    expected = await pg.c.fetchval("SELECT grammar_quiz_receipt_data($1)::text", pg.old)
    async with pg.c.transaction():
        for table in ("quiz_banks", "quiz_questions", "quiz_sessions", "quiz_attempts", "quiz_word_stats",
                      "governance_audit", "content_topics"):
            await pg.c.execute(f"CREATE TEMP TABLE {table} (LIKE {pg.schema}.{table}) ON COMMIT DROP")
        assert await pg.c.fetchval(f"SELECT {pg.schema}.grammar_quiz_receipt_data($1)::text", pg.old) == expected
        assert await pg.c.fetchval(f"SELECT {pg.schema}.grammar_quiz_audit_chain($1)", pg.code)


@pytest.mark.asyncio
async def test_postcondition_ignores_planted_functions_and_operators(pinned):
    pg = pinned
    s = pg.schema
    await _plant(pg)
    await pg.c.execute(f"CREATE FUNCTION {s}.evil_ne(oid,oid) RETURNS boolean LANGUAGE plpgsql AS $$ "
                       f"BEGIN RAISE EXCEPTION 'attacker_called'; END $$; "
                       f"CREATE OPERATOR {s}.<> (LEFTARG=oid, RIGHTARG=oid, FUNCTION={s}.evil_ne); "
                       f"ALTER FUNCTION {s}.grammar_quiz_audit_chain(text) SET search_path={s},pg_temp")
    error = await _fails(pg, f"BEGIN; SET LOCAL search_path={s},pg_catalog; {_post(pg)}")
    assert "grammar_quiz_search_path_wrong" in error and "attacker_called" not in error


@pytest.mark.asyncio
async def test_identity_snapshot_rejects_an_unintended_grant(pg):
    await _record(pg)
    observer = pg.roles["anon"] + "_obs"
    await pg.c.execute(f"CREATE ROLE {observer} NOLOGIN")
    try:
        sql = SQL.replace("-- Postconditions", "GRANT EXECUTE ON FUNCTION public.grammar_quiz_audit_chain(text) "
                          f"TO {observer};\n-- Postconditions")
        old = await _catalog(pg)
        assert "grammar_quiz_function_identity_changed" in await _fails(pg, _adapt(pg, sql))
        assert await _catalog(pg) == old
    finally:
        await pg.c.execute(f"DROP ROLE {observer}")


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", ["table", "row"])
async def test_missing_ledger_aborts_without_partial_changes(pg, missing):
    if missing == "row":
        await pg.c.execute("CREATE TABLE _schema_migrations (filename text PRIMARY KEY)")
        await pg.c.execute("INSERT INTO _schema_migrations VALUES ('338_paper_updated_at.sql')")
    old = await _catalog(pg)
    assert "migration_369_prerequisite_missing: no ledger row" in await _fails(pg, _adapt(pg, SQL))
    assert await _catalog(pg) == old


@pytest.mark.asyncio
@pytest.mark.parametrize("rollback", [False, True])
@pytest.mark.parametrize("path", ["{s}", "{s}, pg_catalog"])
async def test_planted_functions_block_forward_and_rollback_without_running(pg, rollback, path):
    await _record(pg)
    if rollback:
        await _apply(pg)
    await _plant(pg)
    old = await _catalog(pg)
    error = await _fails(pg, f"SET search_path={path.format(s=pg.schema)}; " + _adapt(pg, DOWN if rollback else SQL))
    assert "catalog_name_shadowed_in_public" in error and "attacker_called" not in error
    assert await _catalog(pg) == old


@pytest.mark.asyncio
@pytest.mark.parametrize("op", ["=", "<>", "||", "?", "->", "->>", "#>>", "!~"])
async def test_planted_operator_is_rejected_before_changes(pg, op):
    s = pg.schema
    await _record(pg)
    await pg.c.execute(f"CREATE FUNCTION {s}.planted(text,text) RETURNS boolean LANGUAGE plpgsql AS $$ "
                       f"BEGIN RAISE EXCEPTION 'attacker_called'; END $$; "
                       f"CREATE OPERATOR {s}.{op} (LEFTARG=text, RIGHTARG=text, FUNCTION={s}.planted)")
    old = await _catalog(pg)
    error = await _fails(pg, f"SET search_path={s},pg_catalog; " + _adapt(pg, SQL))
    assert "catalog_name_shadowed_in_public" in error and "attacker_called" not in error
    assert await _catalog(pg) == old


@pytest.mark.asyncio
@pytest.mark.parametrize("name", list(SIGS))
@pytest.mark.parametrize("tamper", ["SECURITY INVOKER", "SET search_path = {s}, pg_temp", "RESET search_path"])
async def test_postcondition_catches_security_or_path_drift(pinned, name, tamper):
    pg = pinned
    await pg.c.execute(f"ALTER FUNCTION {pg.schema}.{name}({SIGS[name]}) {tamper.format(s=pg.schema)}")
    assert "grammar_quiz_search_path_wrong" in await _fails(pg, _post(pg))


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["PUBLIC", "anon", "authenticated", "service_role"])
async def test_postcondition_catches_client_execute(pinned, role):
    pg = pinned
    grantee = "PUBLIC" if role == "PUBLIC" else pg.roles[role]
    await pg.c.execute(f"GRANT EXECUTE ON FUNCTION {pg.schema}.grammar_quiz_receipt_data(uuid) TO {grantee}")
    assert "grammar_quiz_search_path_wrong" in await _fails(pg, _post(pg))


@pytest.mark.asyncio
async def test_postcondition_catches_disabled_bank_guard(pinned):
    pg = pinned
    await pg.c.execute("ALTER TABLE quiz_banks DISABLE TRIGGER zz_grammar_quiz_bank_guard")
    assert "grammar_quiz_trigger_missing" in await _fails(pg, _post(pg))


@pytest.mark.asyncio
async def test_unexpected_body_is_not_overwritten(pg):
    await _record(pg)
    statement = m326._function(SQL_339, "grammar_quiz_audit_chain")
    await pg.c.execute(pg.adapted(statement.replace("RETURN FALSE; END IF;", "RETURN TRUE; END IF;", 1)))
    old = await _catalog(pg)
    assert "grammar_quiz_source_drift" in await _fails(pg, _adapt(pg, SQL))
    assert await _catalog(pg) == old


@pytest.mark.asyncio
async def test_rollback_restores_exact_catalog_and_reapply_closes_hole(pg):
    await pg.enroll()
    await _record(pg)
    old = await _catalog(pg)
    others = await _other_catalog(pg)
    await _apply(pg)
    await _apply(pg, DOWN)
    assert await _catalog(pg) == old
    assert await _other_catalog(pg) == others
    await pg.c.execute(_post(pg, DOWN))
    await _plant(pg)
    callers, _, owner = await _scenario(pg)
    assert ("to_jsonb", owner, "grammar_quiz_guard_bank") in callers
    await _unplant(pg)
    await _apply(pg)
    await pg.c.execute(_post(pg))


@pytest.mark.asyncio
async def test_rerunning_339_is_detected_and_pin_can_be_restored(pinned):
    pg = pinned
    await pg.c.execute(pg.adapted(SQL_339))
    assert "grammar_quiz_search_path_wrong" in await _fails(pg, _post(pg))
    await _apply(pg)
    await pg.c.execute(_post(pg))


# Reuse unchanged 339 behavior tests (cutovers, follow-ups, receipts, learner
# progress) on the pinned schema with their parametrization marks. Tests that
# execute 309/314/339 or the 339 rollback themselves stay in their original
# suites, which are also required in verification.
_MIGRATION_TESTS = {
    "test_rerun_rollback_and_reapply_restore_exact_function_definitions_and_grants",
    "test_rollback_refuses_after_a_v3_publication", "test_339_aborts_without_314",
    "test_concurrent_learner_quiz_traffic_does_not_abort_339",
    "test_postcondition_still_catches_a_row_change_made_inside_339",
    "test_additive_migration_and_rerun_preserve_unmanaged_rows",
}


def _on_pinned(fn):
    signature = inspect.signature(fn)

    @functools.wraps(fn)
    async def run(*args, **kwargs):
        kwargs["pg"] = kwargs.pop("pinned")
        return await fn(*args, **kwargs)

    run.__signature__ = signature.replace(parameters=[
        p.replace(name="pinned") if p.name == "pg" else p for p in signature.parameters.values()])
    del run.__wrapped__
    return run


for _module in (followup, boundary, revisions):
    for _name, _fn in vars(_module).items():
        if (inspect.iscoroutinefunction(_fn) and _name.startswith("test_") and _fn.__module__ == _module.__name__
                and "pg" in inspect.signature(_fn).parameters and _name not in _MIGRATION_TESTS):
            globals()[f"test_pinned_{_module.__name__[5:]}_{_name[5:]}"] = _on_pinned(_fn)
