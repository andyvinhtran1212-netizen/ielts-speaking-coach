"""Global invariant (PC-J119, ADMINAAL2-0032): after the whole migration chain,
no RLS policy grants anything on an inline admin role check.

An inline check (`users.role = 'admin'`, `role IN ('admin', …)`, a JWT claim
compared with 'admin', …) ignores AAL2, `is_active` and `suspended_at`, so an
AAL1, deactivated or suspended admin keeps reading the table through
/rest/v1/ (SA 2026-10-29 F1). Admin access goes through FastAPI
(service_role + the 0032 staff guard); a policy that really needs an admin
branch must call a function that checks all three.

There is no harness that applies migrations 000–345 (most early tables were
created in the dashboard), so the chain is checked in two ways:

* statically: every CREATE / DROP / ALTER POLICY and DROP TABLE of every
  forward migration is replayed in order, and the final policy set must hold
  no expression with the string literal 'admin'. The replay is also run up to
  344 as a negative control: it must find exactly the inline policies 345
  drops, so the detector and the parser really see them. Policies that exist
  only in the hosted catalogs (dashboard-created) are listed from the staging
  catalog of 2026-10-29 and must be dropped by some migration;
* on PostgreSQL: the detector 345 runs as its postcondition (and therefore
  in the PC-J94 harness, which applies every migration since 320) flags
  exactly what this file's Python detector flags, on the deparsed form of each
  inline variant, and nothing that goes through a function.

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

import re
from pathlib import Path
from uuid import uuid4

import pytest

import test_migration_334_activate_attempt_rate_limit as m334
import test_migration_345_admin_inline_policies as m345
from test_migration_320_client_write_lockdown import _strip_sql_comments

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
INLINE_ADMIN = re.compile(r"'admin'", re.I)
# Dashboard-created policies with an inline admin check, read from the staging
# pg_policies on 2026-10-29 (no repo migration creates them).
CATALOG_ONLY = {("public", "access_codes", "Admin only")}

_NAME = r'("(?:[^"]|"")+"|\w+)'
_TABLE = r'(?:(\w+)\.)?("(?:[^"]|"")+"|\w+)'
_EVENT = re.compile(
    rf"CREATE\s+POLICY\s+{_NAME}\s+ON\s+{_TABLE}(?P<create>[^;]*);"
    rf"|DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?{_NAME}\s+ON\s+{_TABLE}"
    rf"|ALTER\s+POLICY\s+{_NAME}\s+ON\s+{_TABLE}(?P<alter>[^;]*);"
    rf"|DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?P<tables>[\w.\",\s]+?)(?:\s+CASCADE|\s+RESTRICT)?\s*;",
    re.I | re.S)


def _ident(raw: str) -> str:
    return raw[1:-1].replace('""', '"') if raw.startswith('"') else raw.lower()


def _forward_migrations(upto: int | None = None) -> list[Path]:
    files = [path for path in MIGRATIONS.glob("[0-9][0-9][0-9]*_*.sql")
             if not path.name.endswith("_rollback.sql")]
    files.sort(key=lambda path: (int(path.name[:3]), path.name))
    return [path for path in files if upto is None or int(path.name[:3]) <= upto]


def replay(files: list[Path]) -> dict[tuple[str, str, str], str]:
    """(schema, table, policy) → USING/WITH CHECK text of every live policy."""
    live: dict[tuple[str, str, str], str] = {}
    for path in files:
        code = _strip_sql_comments(path.read_text(encoding="utf-8"))
        for m in _EVENT.finditer(code):
            groups = m.groups()
            if re.match(r"CREATE", m.group(0), re.I):
                name, schema, table = groups[0], groups[1], groups[2]
                live[(schema or "public", _ident(table), _ident(name))] = m.group("create")
            elif re.match(r"DROP\s+POLICY", m.group(0), re.I):
                name, schema, table = groups[4], groups[5], groups[6]
                live.pop(((schema or "public"), _ident(table), _ident(name)), None)
            elif re.match(r"ALTER\s+POLICY", m.group(0), re.I):
                name, schema, table = groups[7], groups[8], groups[9]
                key = (schema or "public", _ident(table), _ident(name))
                rest = m.group("alter")
                renamed = re.match(rf"\s*RENAME\s+TO\s+{_NAME}", rest, re.I)
                if renamed:
                    live[(key[0], key[1], _ident(renamed.group(1)))] = live.pop(key)
                elif key in live:
                    live[key] = rest
            else:
                for raw in m.group("tables").split(","):
                    parts = [p.strip() for p in raw.strip().split(".")]
                    schema, table = (parts[0], parts[1]) if len(parts) == 2 else ("public", parts[0])
                    table = _ident(table)
                    for key in [k for k in live if k[0] == schema and k[1] == table]:
                        del live[key]
    return live


def _inline(live: dict[tuple[str, str, str], str]) -> set[tuple[str, str, str]]:
    return {key for key, text in live.items() if INLINE_ADMIN.search(text)}


# ── Static replay over the whole chain ──────────────────────────────────────

def test_no_policy_has_an_inline_admin_check_after_the_whole_chain():
    live = replay(_forward_migrations())
    assert len(live) > 90, "the replay must see the repo's policies"
    assert _inline(live) == set(), sorted(_inline(live))


def test_negative_control_the_chain_before_345_has_exactly_the_policies_345_removes():
    before = replay(_forward_migrations(upto=344))
    expected = {("public", table, policy) for table, policy in m345.DROPPED if m345.DROPPED[(table, policy)]}
    expected.add(("public", "vocabulary_exercises", "vocab_exercises_select"))
    assert _inline(before) == expected


def test_every_catalog_only_inline_policy_is_dropped_by_the_chain():
    for schema, table, policy in CATALOG_ONLY:
        dropped = [path.name for path in _forward_migrations()
                   if re.search(rf'DROP POLICY IF EXISTS "{re.escape(policy)}" ON {schema}\.{table};',
                                _strip_sql_comments(path.read_text(encoding="utf-8")))]
        assert dropped == [m345.NAME], (table, policy)


def test_dynamic_policy_sql_has_no_inline_admin_check():
    """Policies built with EXECUTE format(...) escape the replay; none may
    carry an admin literal."""
    for path in _forward_migrations():
        code = _strip_sql_comments(path.read_text(encoding="utf-8"))
        for m in re.finditer(r"format\(\s*'((?:[^']|'')*CREATE POLICY(?:[^']|'')*)'", code, re.I):
            assert not re.search(r"''admin''", m.group(1), re.I), path.name


def test_replay_parser_handles_quoting_rename_alter_and_drop_table(tmp_path):
    files = []
    for i, text in enumerate([
        'CREATE POLICY "Admins ""x""" ON public.t1 FOR ALL USING (role = \'admin\');'
        " CREATE POLICY p2 ON t2 USING (true); CREATE POLICY p3 ON storage.objects USING (x = 'admin');",
        "ALTER POLICY p2 ON public.t2 USING (u.role IN ('admin', 'instructor'));"
        " ALTER POLICY p2 ON t2 RENAME TO p2b;",
        'DROP POLICY IF EXISTS "Admins ""x""" ON t1; DROP TABLE IF EXISTS public.t9, storage.objects CASCADE;',
    ]):
        path = tmp_path / f"{900 + i}_x.sql"
        path.write_text(text, encoding="utf-8")
        files.append(path)
    assert _inline(replay(files[:1])) == {("public", "t1", 'Admins "x"'), ("storage", "objects", "p3")}
    assert _inline(replay(files[:2])) == {("public", "t1", 'Admins "x"'), ("storage", "objects", "p3"),
                                          ("public", "t2", "p2b")}
    assert _inline(replay(files)) == {("public", "t2", "p2b")}


# ── PostgreSQL: 345's SQL detector == this file's detector ──────────────────

VARIANTS = {
    "eq": ("EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')", True),
    "in_list": ("EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'instructor'))",
                True),
    "reversed_cast": ("EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND 'admin'::text = u.role::text)",
                      True),
    "upper": ("EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND upper(u.role) = 'ADMIN')", True),
    "jwt_claim": ("(current_setting('request.jwt.claims', true)::jsonb ->> 'user_role') = 'admin'", True),
    "with_check_only": (None, True),
    "function": ("is_current_user_admin()", False),
    "own_rows": ("auth.uid() = id", False),
    "administrator_word": ("note = 'administrator'", False),
}


def test_345_sql_detector_matches_the_static_detector_on_every_deparsed_variant():
    m345._require_pg()
    database = f"adm345det_{uuid4().hex[:12]}"
    m334.sql("postgres", f"CREATE DATABASE {database}")
    try:
        statements = ["CREATE SCHEMA auth;",
                      "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid';",
                      "CREATE TABLE users (id uuid, role text, note text);",
                      "CREATE FUNCTION is_current_user_admin() RETURNS boolean LANGUAGE sql AS 'SELECT false';"]
        for name, (expr, _) in VARIANTS.items():
            if expr is None:
                statements.append(f"CREATE POLICY {name} ON users FOR INSERT WITH CHECK (role = 'admin');")
            else:
                statements.append(f"CREATE POLICY {name} ON users FOR SELECT USING ({expr});")
        m334.sql(database, "\n".join(statements))
        code = m345.CODE
        detector = re.search(r"concat_ws\(' ', pg_get_expr\(p\.polqual, p\.polrelid\),\s*"
                             r"pg_get_expr\(p\.polwithcheck, p\.polrelid\)\) ~\* '''admin'''", code)
        assert detector, "345's postcondition detector changed; update this test with it"
        rows = m334.sql(database, f"""
            SELECT p.polname, ({detector.group(0)})::text,
                   regexp_replace(concat_ws(' ', pg_get_expr(p.polqual, p.polrelid),
                                            pg_get_expr(p.polwithcheck, p.polrelid)), '\s+', ' ', 'g')
              FROM pg_policy p WHERE p.polrelid = 'public.users'::regclass ORDER BY 1""").splitlines()
        seen = {}
        for row in rows:
            name, flagged, deparsed = row.split("|", 2)
            seen[name] = flagged == "true"
            assert seen[name] == bool(INLINE_ADMIN.search(deparsed)), (name, deparsed)
        assert seen == {name: inline for name, (_, inline) in VARIANTS.items()}
    finally:
        m334.sql("postgres", f"DROP DATABASE IF EXISTS {database} WITH (FORCE)")


@pytest.mark.parametrize("name", sorted(VARIANTS))
def test_static_detector_agrees_with_the_variant_table(name):
    expr, inline = VARIANTS[name]
    assert bool(INLINE_ADMIN.search(expr or "role = 'admin'")) == inline
