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

_COMMENT = re.compile(r"/\*.*?\*/|--[^\n]*|(?m:^\s*#[^\n]*)", re.DOTALL)
# Privileges and the schema list may not contain another ON / TO, and the
# grantee list only continues on a new line after a comma.
_SCHEMA_GRANT = re.compile(
    r"\bGRANT\b(?P<privs>(?:(?!\bON\b)[^;])*?)\bON\s+SCHEMA\b"
    r"(?P<schemas>(?:(?!\bTO\b)[^;])*?)\bTO\b(?P<grantees>(?:,\s*\n|[^;\n])*)",
    re.IGNORECASE,
)
_GRANT_TAIL = re.compile(r"\s+(?:WITH\s+GRANT\s+OPTION|GRANTED\s+BY)\b.*$", re.I | re.S)


def _blank_comments(source: str) -> str:
    # Keep newlines so reported line numbers match the file.
    return _COMMENT.sub(lambda m: "\n" * m[0].count("\n") or " ", source)


def _names(text: str) -> set[str]:
    # Identifiers only, so quotes and a closing ")" of a host-language string drop out.
    return {name.lower() for name in re.findall(r"[A-Za-z_][A-Za-z0-9_$]*", text)}


def _schema_grants(source: str):
    stripped = _blank_comments(source)
    for match in _SCHEMA_GRANT.finditer(stripped):
        line = stripped.count("\n", 0, match.start()) + 1
        privileges = set(re.findall(r"[A-Z_]+", match["privs"].upper()))
        grantees = _names(_GRANT_TAIL.sub("", match["grantees"]))
        yield line, privileges, _names(match["schemas"]), grantees


def find_public_schema_create_grants(source: str) -> list[int]:
    """Line numbers of GRANT CREATE/ALL ON SCHEMA public to an app role."""
    return [
        line
        for line, privileges, schemas, grantees in _schema_grants(source)
        if "public" in schemas and privileges & {"CREATE", "ALL"} and grantees & APP_ROLES
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
    ],
)
def test_guard_flags_create_on_public_to_app_roles(sql):
    assert find_public_schema_create_grants(sql) == [1]


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
    ],
)
def test_guard_allows_usage_owner_and_comments(sql):
    assert find_public_schema_create_grants(sql) == []


def test_guard_reports_file_line_numbers():
    source = "-- a\n/* b\n c */\nGRANT USAGE ON SCHEMA public TO anon;\nGRANT ALL ON SCHEMA public TO anon;\n"
    assert find_public_schema_create_grants(source) == [5]


def _scanned_files():
    for root in SCAN_ROOTS:
        for path in sorted((REPO / root).rglob("*")):
            if path.is_file() and path.suffix in SCAN_SUFFIXES:
                yield path


def test_repo_scripts_grant_no_create_on_public_to_app_roles():
    offenders = [
        f"{path.relative_to(REPO)}:{line}"
        for path in _scanned_files()
        for line in find_public_schema_create_grants(path.read_text(encoding="utf-8"))
    ]
    assert offenders == [], "CREATE/ALL on schema public granted to an app role:\n" + "\n".join(offenders)


def test_clone_keeps_service_role_usage_on_public():
    # PostgREST needs USAGE; the fix must narrow the grant, not drop it.
    usage = [
        f"{name}:{line}"
        for name in CLONE_FILES
        if (REPO / name).exists()
        for line, privileges, schemas, grantees in _schema_grants((REPO / name).read_text(encoding="utf-8"))
        if "public" in schemas and privileges == {"USAGE"} and "service_role" in grantees
    ]
    assert len(usage) == 1, usage
