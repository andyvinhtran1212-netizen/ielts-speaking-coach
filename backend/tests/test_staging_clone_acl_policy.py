"""Offline operational-script ACL guard; local-PG behavior lives in its own suite."""

from pathlib import Path
import re
import shlex
import subprocess

import pytest


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
CLONE = SCRIPTS / "staging_clone_schema_from_prod.sh"
APP_ROLES = {"public", "anon", "authenticated", "service_role"}
GRANT_ALL = re.compile(
    r"\bGRANT\s+ALL(?:\s+PRIVILEGES)?\s+ON\s+(?:ALL\s+)?"
    r"(?:TABLES|SEQUENCES|FUNCTIONS)\b[^;]*?\bTO\s+([^;]+);",
    re.IGNORECASE,
)
OBJECT_GRANT = re.compile(r"\bGRANT\s+([^;]+?)\s+ON\s+([^;]+?)\s+TO\s+([^;]+);", re.I)


def _grantees(text: str) -> set[str]:
    text = re.sub(r"\s+(?:WITH\s+(?:GRANT|ADMIN)\s+OPTION|GRANTED\s+BY)\b.*$", "", text, flags=re.I)
    return {role.strip().strip('"').lower() for role in text.split(",")}


def _assert_no_blanket_app_grants(source: str) -> None:
    # Scan SQL files and SQL embedded in shell heredocs, ignoring comments.
    source = re.sub(r"/\*.*?\*/|--[^\n]*|(?m:^\s*#[^\n]*)", " ", source, flags=re.DOTALL)
    for match in GRANT_ALL.finditer(source):
        grantees = _grantees(match[1])
        assert not grantees & APP_ROLES, f"blanket application-role grant: {match[0]}"
    for match in OBJECT_GRANT.finditer(source):
        privileges = set(re.findall(r"\b[A-Z_]+\b", match[1].upper()))
        target = match[2].lower()
        grantees = _grantees(match[3])
        clients = grantees & {"public", "anon", "authenticated"}
        writes = privileges & {"ALL", "INSERT", "UPDATE", "DELETE", "TRUNCATE",
                               "REFERENCES", "TRIGGER", "MAINTAIN"}
        if not target.startswith("schema "):
            assert not (clients and writes), f"unsafe application-role grant: {match[0]}"
        if "all functions" in target and clients and "EXECUTE" in privileges:
            raise AssertionError(f"blanket application-role grant: {match[0]}")
        if "class_action_log" in target and "service_role" in grantees:
            assert not privileges & {"ALL", "UPDATE", "DELETE", "TRUNCATE", "MAINTAIN"}, (
                f"unsafe append-only log grant: {match[0]}"
            )
    for match in re.finditer(r"\bGRANT\s+([^;]+?)\s+TO\s+([^;]+);", source, re.I):
        if re.search(r"\bON\b", match[1], re.I):
            continue
        grantees = _grantees(match[2])
        assert not grantees & APP_ROLES, f"application-role membership grant: {match[0]}"


def _assert_scripts_safe(directory: Path) -> None:
    # Option (i) preserves the dump's ACLs, so no re-apply exception is needed.
    # TODO(#2041 / PC-J336): reconcile with the migration guard when it lands.
    # It is absent from origin/staging at 672cd02b1; migrations have deliberate
    # historical grants and cannot use this operational-script policy verbatim.
    for path in sorted(directory.rglob("*")):
        if path.suffix in {".sh", ".sql"}:
            try:
                _assert_no_blanket_app_grants(path.read_text(encoding="utf-8"))
            except AssertionError as exc:
                raise AssertionError(f"{path.relative_to(directory)}: {exc}") from exc


def test_scripts_do_not_replace_migration_acls_with_blanket_grants():
    _assert_scripts_safe(SCRIPTS)


def test_clone_dumps_schema_and_acls_and_restores_the_same_dump():
    source = CLONE.read_text(encoding="utf-8")
    dump_command, = (
        shlex.split(line) for line in source.splitlines() if line.startswith("pg_dump ")
    )
    assert dump_command == [
        "pg_dump", "$PROD_URL", "--schema-only", "--schema=public", "--no-owner",
        "-f", "$DUMP",
    ]
    restore = source[source.index('psql "$STAGING_URL" -X -1'):source.index('echo "== baselining')]
    assert '-v ON_ERROR_STOP=1 -q' in restore
    assert '-f "$ROOT/backend/scripts/sql/staging_clone_reset.sql" -f "$DUMP"' in restore
    assert '-f "$ROOT/backend/scripts/sql/staging_clone_postconditions.sql"' in restore
    preflight = source.index('python3 "$ROOT/backend/scripts/staging_clone_preflight.py" "$DUMP"')
    assert preflight < source.index(restore)
    assert 'BEGIN READ ONLY;' in source
    assert 'FROM pg_default_acl WHERE defaclnamespace = 0' in source
    before_preflight = re.sub(r"(?m)^\s*#.*$", "", source[:preflight])
    assert re.search(r"\bDROP\s+SCHEMA\b", before_preflight, re.I) is None


def test_dump_filter_preserves_object_acls_and_migration_owner_defaults():
    source = CLONE.read_text(encoding="utf-8")
    match = re.search(r"^grep -v (?:[^\n]*\\\n)*[^\n]*", source, re.MULTILINE)
    assert match
    command = shlex.split(match[0].replace("\\\n", " "))
    assert command[-3:] == ["$DUMP", ">", "$DUMP.tmp"]
    assert source.index(match[0]) < source.index('echo "== preflighting dump roles')
    kept = (
        "CREATE TABLE public.class_action_log (id uuid);\n"
        "REVOKE ALL ON TABLE public.class_action_log FROM service_role;\n"
        "GRANT SELECT, INSERT ON TABLE public.class_action_log TO service_role;\n"
        "GRANT SELECT ON TABLE public.users TO authenticated;\n"
        "REVOKE ALL ON FUNCTION public.sensitive_rpc() FROM PUBLIC;\n"
        "GRANT EXECUTE ON FUNCTION public.sensitive_rpc() TO service_role;\n"
        "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public "
        "GRANT SELECT ON TABLES TO authenticated;\n"
    )
    # Exercise only the dump's grep filter against fake SQL, never the script.
    result = subprocess.run(
        command[:-3], input=(
            "CREATE SCHEMA public;\n" + kept +
            "ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public "
            "GRANT ALL ON TABLES TO anon, authenticated;\n"
        ), capture_output=True, text=True, check=True,
    )
    assert result.stdout == kept


@pytest.mark.parametrize("suffix", [".sh", ".sql"])
def test_guard_rejects_restoring_the_original_clone_grant(tmp_path, suffix):
    # Mutation of the real source at the original position; no shell/DB runs.
    source = CLONE.read_text(encoding="utf-8")
    original_grant = (
        "GRANT ALL ON ALL TABLES IN SCHEMA public "
        "TO anon, authenticated, service_role;\n"
    )
    mutated = source.replace(
        'echo "== baselining migration ledger',
        original_grant + 'echo "== baselining migration ledger',
        1,
    )
    assert mutated != source
    (tmp_path / f"clone{suffix}").write_text(mutated, encoding="utf-8")
    with pytest.raises(AssertionError, match="clone.*blanket application-role grant"):
        _assert_scripts_safe(tmp_path)


@pytest.mark.parametrize("grant", [
    'grant all privileges on all tables in schema public to "authenticated";',
    "GRANT ALL\nON ALL TABLES IN SCHEMA public\nTO postgres, anon WITH GRANT OPTION;",
    "GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;",
    "GRANT/* ACL reset */ALL ON ALL TABLES IN SCHEMA public TO anon;",
    "GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO PUBLIC;",
    "GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon;",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;",
    "ALTER DEFAULT PRIVILEGES GRANT ALL ON SEQUENCES TO service_role;",
    "ALTER DEFAULT PRIVILEGES GRANT ALL ON FUNCTIONS TO anon;",
])
def test_guard_covers_multiline_role_and_default_acl_variants(grant):
    with pytest.raises(AssertionError, match="blanket application-role grant"):
        _assert_no_blanket_app_grants(grant)


def test_guard_allows_narrow_grants_and_comments():
    _assert_no_blanket_app_grants('''
        # GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
        -- GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
        /* GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role; */
        GRANT ALL ON SCHEMA public TO postgres, service_role;
        GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres;
        GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
        GRANT SELECT, INSERT ON TABLE public.class_action_log TO service_role;
    ''')


@pytest.mark.parametrize("grant", [
    "GRANT INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO anon, authenticated;",
    "GRANT ALL ON TABLE public.class_action_log TO service_role;",
    "GRANT TRUNCATE, MAINTAIN ON public.class_action_log TO service_role;",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT INSERT, UPDATE, DELETE ON TABLES TO anon;",
    "GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;",
    "GRANT anon TO authenticated;",
    "GRANT anon TO authenticated WITH ADMIN OPTION;",
    "GRANT UPDATE ON ALL TABLES IN SCHEMA public TO anon WITH GRANT OPTION;",
])
def test_guard_rejects_sa_reported_acl_and_membership_gaps(grant):
    with pytest.raises(AssertionError, match="grant"):
        _assert_no_blanket_app_grants(grant)
