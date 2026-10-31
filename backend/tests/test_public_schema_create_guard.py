"""Offline guard: no script or migration re-grants CREATE on schema public to app roles.

CREATE on ``public`` lets ``service_role`` (or a client role) create a function
that shadows a ``pg_catalog`` one used by SECURITY DEFINER code, which then
runs with the owner's rights. Migration 357 revokes it; the staging clone used
to grant it back on every run (SVCPRIV-0042 FR-007, PC-J497).

This is the schema-CREATE part of the SVCPRIV-0042 FR-006 guard only; the full
table-privilege guard (``test_service_role_table_privilege_guard.py``) may
import ``find_public_schema_create_grants`` from here.
"""

from pathlib import Path
import re

import pytest


REPO = Path(__file__).resolve().parents[2]
# Test fixtures (backend/tests/**) grant CREATE to OWNER/RUNNER roles on purpose
# and are not scanned.
SCAN_ROOTS = ("backend/scripts", "scripts", "backend/migrations")
SCAN_SUFFIXES = {".sh", ".sql", ".py"}
CLONE_FILES = (
    "backend/scripts/staging_clone_schema_from_prod.sh",
    "backend/scripts/sql/staging_clone_reset.sql",
)
APP_ROLES = {"service_role", "anon", "authenticated", "public"}
# Stands for a name built at run time (f-string, %s, $VAR, psql :var); the guard
# treats it as any role, schema or privilege (fail closed).
DYNAMIC = "<dynamic>"

# SQL comments are only stripped from SQL text: .sql files and psql heredoc
# bodies. In shell and Python, "--" starts an option and "/*" is a glob.
_SQL_COMMENT = re.compile(r"/\*.*?\*/|--[^\n]*|(?m:^\s*#[^\n]*)", re.DOTALL)
_HOST_COMMENT = re.compile(r"(?m:^\s*#[^\n]*)")
_HEREDOC = re.compile(
    r"^(?P<cmd>[^\n]*?)<<-?\s*(?P<q>['\"]?)(?P<tag>\w+)(?P=q)[^\n]*\n(?P<body>.*?)^\s*(?P=tag)\s*$",
    re.MULTILINE | re.DOTALL,
)
# Shell line continuations and adjacent Python string literals ("... TO "
# "service_role") join one statement across lines.
_HOST_JOIN = re.compile(r"\\\n|([\"'])\s+[rRbBuUfF]{0,2}\1")

_PLACEHOLDER = r"\{[^{}\n]*\}|%\(\w+\)[sIL]|%[sIL]|\$\{\w+\}|\$\w+|:'\w+'|:\"\w+\"|:\w+|[\"']\s*(?:\+|\|\|)"
_NAME = rf"(?:{_PLACEHOLDER}|\"(?:[^\"]|\"\")+\"|[A-Za-z_][A-Za-z0-9_$]*)"
_NAME_LIST = rf"{_NAME}(?:\s*,\s*{_NAME})*"
# One statement, whitespace-normalised: privileges may not contain another ON,
# the schema and grantee lists are names separated by commas.
_SCHEMA_GRANT = re.compile(
    rf"GRANT\b(?P<privs>(?:(?!\bON\b)[^;])*?)\bON SCHEMA (?P<schemas>{_NAME_LIST}) TO "
    rf"(?P<grantees>(?:GROUP )?{_NAME}(?:\s*,\s*(?:GROUP )?{_NAME})*)",
    re.IGNORECASE,
)
_STATEMENT_START = re.compile(r"\bGRANT\b", re.IGNORECASE)


def _blank(pattern: re.Pattern, text: str) -> str:
    # Keep newlines so reported line numbers match the file.
    return pattern.sub(lambda m: "\n" * m[0].count("\n") or " ", text)


def _blank_comments(source: str, suffix: str = ".sql") -> str:
    if suffix == ".sql":
        return _blank(_SQL_COMMENT, source)
    parts, end = [], 0
    if suffix == ".sh":
        for m in _HEREDOC.finditer(source):
            sql = "psql" in m["cmd"] or "SQL" in m["tag"].upper()
            parts += [
                _blank(_HOST_COMMENT, source[end : m.start("body")]),
                _blank(_SQL_COMMENT if sql else _HOST_COMMENT, m["body"]),
            ]
            end = m.end("body")
    parts.append(_blank(_HOST_COMMENT, source[end:]))
    return _blank(_HOST_JOIN, "".join(parts))


def _names(text: str) -> set[str]:
    # Identifiers only, so quotes and a closing ")" of a host-language string drop out.
    names = {name.lower() for name in re.findall(r"[A-Za-z_][A-Za-z0-9_$]*", re.sub(_PLACEHOLDER, " ", text))}
    if re.search(_PLACEHOLDER, text):
        names.add(DYNAMIC)
    return names - {"group"}


def _statements(source: str, suffix: str):
    """(line, text) per GRANT, whitespace and newlines collapsed to one space."""
    stripped = _blank_comments(source, suffix)
    starts = [m.start() for m in _STATEMENT_START.finditer(stripped)] + [len(stripped)]
    for start, nxt in zip(starts, starts[1:]):
        end = stripped.find(";", start, nxt)
        text = stripped[start : nxt if end < 0 else end]
        yield stripped.count("\n", 0, start) + 1, re.sub(r"\s+", " ", text)


def _schema_grants(source: str, suffix: str = ".sql"):
    for line, statement in _statements(source, suffix):
        match = _SCHEMA_GRANT.match(statement)
        if match:
            privileges = set(re.findall(r"[A-Z_]+", match["privs"].upper()))
            if re.search(_PLACEHOLDER, match["privs"]):
                privileges.add(DYNAMIC)
            yield line, privileges, _names(match["schemas"]), _names(match["grantees"])


def find_public_schema_create_grants(source: str, suffix: str = ".sql") -> list[int]:
    """Line numbers of GRANT CREATE/ALL ON SCHEMA public to an app role.

    ``suffix`` is the file type: SQL comments are only stripped from ``.sql``
    text and psql heredoc bodies.
    """
    return [
        line
        for line, privileges, schemas, grantees in _schema_grants(source, suffix)
        if schemas & {"public", DYNAMIC}
        and privileges & {"CREATE", "ALL", DYNAMIC}
        and grantees & (APP_ROLES | {DYNAMIC})
    ]


@pytest.mark.parametrize(
    "sql",
    [
        "GRANT ALL ON SCHEMA public TO postgres, service_role;",
        'grant all privileges on schema "public" to "service_role";',
        "GRANT USAGE, CREATE ON SCHEMA public TO anon;",
        "GRANT CREATE\nON SCHEMA public\nTO authenticated WITH GRANT OPTION;",
        "GRANT ALL ON SCHEMA app_private, public TO PUBLIC;",
        "GRANT/* x */CREATE ON SCHEMA public TO service_role GRANTED BY postgres;",
        "GRANT CREATE ON SCHEMA public TO postgres,\n  service_role;",
        'cur.execute("GRANT CREATE ON SCHEMA public TO service_role")',
        # Codex P2 (PR #2118 r4429805527): grantee on the line after TO.
        "GRANT CREATE ON SCHEMA public TO\n  service_role;",
        "GRANT ALL\n  ON\n  SCHEMA\n  public\n  TO\n  postgres,\n  anon;",
        # Grantee list continued with a leading comma.
        "GRANT ALL ON SCHEMA public TO postgres\n  , service_role;",
        "GRANT ALL ON SCHEMA public\n  TO postgres\n  ,authenticated\n  WITH GRANT OPTION;",
        "GRANT ALL ON SCHEMA public TO GROUP service_role;",
    ],
)
def test_guard_flags_create_on_public_to_app_roles(sql):
    assert find_public_schema_create_grants(sql) == [1]


@pytest.mark.parametrize(
    ("suffix", "source", "lines"),
    [
        # psql option "--dbname" is not a SQL comment in a shell script.
        (".sh", 'psql --dbname "$DB" -c "GRANT ALL ON SCHEMA public TO service_role;"', [1]),
        (".sh", 'psql --dbname="$DB" --command "GRANT CREATE ON SCHEMA public TO anon"', [1]),
        (".sh", 'psql "$DB" -c "GRANT ALL ON SCHEMA public \\\n  TO service_role;"', [1]),
        # Shell globs ("/*" ... "*/", "public.*") are not SQL comments.
        (
            ".sh",
            'rm -rf "$WORK"/*\npsql "$DB" -c "GRANT ALL ON SCHEMA public TO service_role;"\nls backups/*/\n',
            [2],
        ),
        (
            ".sh",
            "pg_dump -t 'public.*' -f \"$OUT\"/*.sql\npsql -c 'GRANT ALL ON SCHEMA public TO anon'\nmv \"$OUT\"/*/ .\n",
            [2],
        ),
        # Heredocs: the body is SQL, so multi-line statements and SQL comments apply.
        (".sh", "psql \"$DB\" <<'SQL'\n-- reset\nGRANT ALL\n  ON SCHEMA public\n  TO\n  service_role;\nSQL\n", [3]),
        (".sh", 'psql "$DB" <<EOSQL\nGRANT CREATE ON SCHEMA public TO postgres\n  , ${ROLE};\nEOSQL\n', [2]),
        # SQL built by Python, including f-strings and %-formatting.
        (".py", 'cur.execute(f"GRANT ALL ON SCHEMA public TO {role}")', [1]),
        (".py", 'cur.execute(f"GRANT CREATE ON SCHEMA {schema} TO service_role")', [1]),
        (".py", 'cur.execute(f"GRANT {privs} ON SCHEMA public TO anon")', [1]),
        (".py", 'cur.execute("GRANT ALL ON SCHEMA public TO %s", (role,))', [1]),
        (".py", 'cur.execute(\n    "GRANT CREATE ON SCHEMA public TO "\n    "service_role"\n)', [2]),
        (".py", 'sql = "GRANT ALL ON SCHEMA public TO " + role', [1]),
        (".py", 'parser.add_argument("--db")  # x\nconn.execute("GRANT ALL ON SCHEMA public TO anon")', [2]),
        (".sql", "EXECUTE format('GRANT ALL ON SCHEMA %I TO %I', 'public', r);", [1]),
    ],
)
def test_guard_flags_shell_python_and_dynamic_forms(suffix, source, lines):
    assert find_public_schema_create_grants(source, suffix) == lines


@pytest.mark.parametrize(
    "sql",
    [
        "GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;",
        "GRANT ALL ON SCHEMA public TO postgres;",
        # Other schemas are out of scope for this guard.
        "GRANT CREATE ON SCHEMA app_private TO service_role;",
        "-- GRANT ALL ON SCHEMA public TO service_role;",
        "/* GRANT ALL ON SCHEMA public TO service_role; */",
        "  # GRANT ALL ON SCHEMA public TO service_role;",
        "REVOKE CREATE ON SCHEMA public FROM service_role;",
        "GRANT SELECT ON TABLE public.t TO anon;\nCOMMENT ON SCHEMA public IS 'x';",
        "GRANT ALL ON SCHEMA public TO\n  postgres;\nSELECT 1 AS anon;",
        "GRANT USAGE ON SCHEMA public TO postgres\n  , anon;",
    ],
)
def test_guard_allows_usage_owner_and_comments(sql):
    assert find_public_schema_create_grants(sql) == []


@pytest.mark.parametrize(
    ("suffix", "source"),
    [
        (".sh", "# GRANT ALL ON SCHEMA public TO service_role;"),
        (".sh", "psql \"$DB\" <<'SQL'\n-- GRANT ALL ON SCHEMA public TO service_role;\nGRANT ALL ON SCHEMA public TO postgres;\nSQL\n"),
        (".sh", "psql \"$DB\" <<'SQL'\n/* GRANT ALL ON SCHEMA public\n   TO anon; */\nSQL\n"),
        (".sh", 'psql --dbname "$DB" -c "GRANT USAGE ON SCHEMA public TO service_role;"'),
        (".py", '# cur.execute("GRANT ALL ON SCHEMA public TO anon")'),
        (".py", 'cur.execute(f"GRANT USAGE ON SCHEMA {schema} TO {role}")'),
        (".py", 'cur.execute(f"GRANT ALL ON SCHEMA public TO postgres")'),
    ],
)
def test_guard_allows_shell_python_comments_and_usage(suffix, source):
    assert find_public_schema_create_grants(source, suffix) == []


def test_guard_reports_file_line_numbers():
    source = "-- a\n/* b\n c */\nGRANT USAGE ON SCHEMA public TO anon;\nGRANT ALL ON SCHEMA public TO anon;\n"
    assert find_public_schema_create_grants(source) == [5]


def _scanned_files():
    for root in SCAN_ROOTS:
        for path in sorted((REPO / root).rglob("*")):
            if path.is_file() and path.suffix in SCAN_SUFFIXES:
                yield path


def test_repo_scripts_grant_no_create_on_public_to_app_roles():
    files = list(_scanned_files())
    offenders = [
        f"{path.relative_to(REPO)}:{line}"
        for path in files
        for line in find_public_schema_create_grants(path.read_text(encoding="utf-8"), path.suffix)
    ]
    assert len(files) > 100, f"scanned only {len(files)} files"
    assert offenders == [], "CREATE/ALL on schema public granted to an app role:\n" + "\n".join(offenders)


def test_clone_keeps_service_role_usage_on_public():
    # PostgREST needs USAGE; the fix must narrow the grant, not drop it.
    usage = [
        f"{name}:{line}"
        for name in CLONE_FILES
        if (REPO / name).exists()
        for line, privileges, schemas, grantees in _schema_grants(
            (REPO / name).read_text(encoding="utf-8"), Path(name).suffix
        )
        if "public" in schemas and privileges == {"USAGE"} and "service_role" in grantees
    ]
    assert len(usage) == 1, usage
