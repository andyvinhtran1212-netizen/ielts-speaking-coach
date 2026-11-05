"""SVCPRIV-0042 FR-006/FR-007 (mig 364, PC-J544): no re-grant of table maintenance rights.

Migration 364 revokes TRIGGER, REFERENCES, TRUNCATE and MAINTAIN on every
public relation and in the table default ACLs from service_role, anon,
authenticated and PUBLIC; 357 revokes CREATE on schema public. This offline
guard stops the files that run after 364 from handing any of that back:

* every forward migration numbered above 364;
* EVERY file in ``backend/migrations/rollback/`` (and ``*_rollback.sql``),
  whatever its number, including a future down of 356;
* every ``.sh``, ``.sql`` and ``.py`` file under ``backend/scripts/`` and the
  repository-root ``scripts/`` (``scripts/backup/restore_into_project.sh``
  restores dump ACLs).

Forward migrations numbered 364 or lower are the only exemption. Outside real
comments it rejects: a table or default-ACL ``GRANT`` of ALL [PRIVILEGES],
TRIGGER, REFERENCES, TRUNCATE or MAINTAIN to one of those grantees (also
``ON ALL TABLES IN SCHEMA`` and ``ALTER DEFAULT PRIVILEGES … ON TABLES``);
``GRANT pg_maintain | pg_write_all_data | postgres TO`` one of them;
``ALTER … OWNER TO`` one of them; and ``GRANT CREATE | ALL ON SCHEMA public``
(the 357 guard, ``find_public_schema_create_grants``). SQL inside
``EXECUTE format('GRANT …')``, shell heredocs and Python strings is executable
SQL here, and a name built at run time counts as any role (fail closed).
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest

from test_public_schema_create_guard import (
    APP_ROLES,
    CLONE_FILES,
    DYNAMIC,
    _NAME,
    _PLACEHOLDER,
    _blank_comments,
    _names,
    _statements,
    find_public_schema_create_grants,
)

REPO = Path(__file__).resolve().parents[2]
BACKEND = REPO / "backend"
MIGRATIONS = BACKEND / "migrations"
NNN = 364
NAME = "364_service_role_table_maintenance_revoke.sql"
GROUP = "service_role_table_maintenance_revoke"
SCRIPT_ROOTS = ("backend/scripts", "scripts")
SCAN_SUFFIXES = {".sh", ".sql", ".py"}
TABLE_PRIVILEGES = {"ALL", "TRIGGER", "REFERENCES", "TRUNCATE", "MAINTAIN"}
PRIVILEGED_ROLES = {"pg_maintain", "pg_write_all_data", "postgres"}
# Object kinds a GRANT … ON may name that are not tables (sequences, routines,
# schemas and the rest are outside this guard; schema CREATE has its own).
_NON_TABLE_TARGET = re.compile(
    r"(?:ALL\s+(?:SEQUENCES|FUNCTIONS|PROCEDURES|ROUTINES)\s+IN\b|SEQUENCES?\b|FUNCTIONS?\b|"
    r"PROCEDURES?\b|ROUTINES?\b|SCHEMAS?\b|DATABASE\b|DOMAIN\b|TYPES?\b|LANGUAGE\b|"
    r"LARGE\s+OBJECT\b|TABLESPACE\b|FOREIGN\s+DATA\s+WRAPPER\b|FOREIGN\s+SERVER\b|PARAMETER\b)",
    re.IGNORECASE,
)
_GRANTEES = rf"(?P<grantees>(?:GROUP )?{_NAME}(?:\s*,\s*(?:GROUP )?{_NAME})*)"
_OBJECT_GRANT = re.compile(
    rf"GRANT\b(?P<privs>(?:(?!\bON\b)[^;])*?)\bON (?P<target>(?:(?!\bTO\b)[^;])*?)\bTO {_GRANTEES}",
    re.IGNORECASE,
)
_ROLE_GRANT = re.compile(
    rf"GRANT (?P<roles>{_NAME}(?:\s*,\s*{_NAME})*) TO {_GRANTEES}", re.IGNORECASE)
_OWNER_TO = re.compile(rf"\bOWNER\s+TO\s+(?P<owner>{_NAME})", re.IGNORECASE)


def _targeted(grantees: set[str]) -> bool:
    return bool(grantees & (APP_ROLES | {DYNAMIC}))


def _privileges(text: str) -> set[str]:
    found = set(re.findall(r"[A-Z_]+", text.upper()))
    if re.search(_PLACEHOLDER, text):
        found.add(DYNAMIC)
    return found


def find_table_privilege_grants(source: str, suffix: str = ".sql") -> list[tuple[int, str]]:
    """(line, family) for every forbidden grant/ownership statement in ``source``."""
    hits: list[tuple[int, str]] = []
    for line, statement in _statements(source, suffix):
        if match := _OBJECT_GRANT.match(statement):
            target = match["target"].strip()
            if _NON_TABLE_TARGET.match(target):
                continue
            privileges = _privileges(match["privs"])
            if privileges & (TABLE_PRIVILEGES | {DYNAMIC}) and _targeted(_names(match["grantees"])):
                hits.append((line, "default_acl" if re.match(r"TABLES\b", target, re.I) else "table"))
        elif match := _ROLE_GRANT.match(statement):
            roles = _names(match["roles"])
            if roles & (PRIVILEGED_ROLES | {DYNAMIC}) and _targeted(_names(match["grantees"])):
                hits.append((line, "role_membership"))
    stripped = _blank_comments(source, suffix)
    for match in _OWNER_TO.finditer(stripped):
        if _targeted(_names(match["owner"])):
            hits.append((stripped.count("\n", 0, match.start()) + 1, "owner"))
    hits += [(line, "schema_create") for line in find_public_schema_create_grants(source, suffix)]
    return sorted(set(hits))


def _forward_number(path: Path) -> int | None:
    match = re.match(r"^(\d{3})[a-z]?_", path.name)   # 019b_, 161b_ are forward files
    return int(match.group(1)) if match else None


def scanned_files(repo: Path = REPO) -> list[Path]:
    """Every file FR-006 scans; forward migrations <= 364 are the only exemption."""
    migrations = repo / "backend/migrations"
    files = [path for path in sorted((migrations / "rollback").rglob("*")) if path.is_file()]
    for path in sorted(migrations.glob("*.sql")):
        number = _forward_number(path)
        if path.name.endswith("_rollback.sql") or number is None or number > NNN:
            files.append(path)
    for root in SCRIPT_ROOTS:
        files += [path for path in sorted((repo / root).rglob("*"))
                  if path.is_file() and path.suffix in SCAN_SUFFIXES]
    return files


def offenders(repo: Path = REPO) -> list[str]:
    return [
        f"{path.relative_to(repo)}:{line}: {family}"
        for path in scanned_files(repo)
        for line, family in find_table_privilege_grants(
            path.read_text(encoding="utf-8"), path.suffix if path.suffix in SCAN_SUFFIXES else ".sql")
    ]


# ── Every forbidden family is caught ────────────────────────────────────────

@pytest.mark.parametrize(
    ("suffix", "source", "family"),
    [
        (".sql", "GRANT ALL ON TABLE public.users TO service_role;", "table"),
        (".sql", "grant all privileges on public.users to service_role;", "table"),
        (".sql", "GRANT TRIGGER ON ALL TABLES IN SCHEMA public TO service_role;", "table"),
        (".sql", "GRANT SELECT, REFERENCES (id) ON public.users TO anon;", "table"),
        (".sql", "GRANT TRUNCATE ON public.class_action_log TO authenticated;", "table"),
        (".sql", "GRANT MAINTAIN ON public.activation_attempts TO PUBLIC;", "table"),
        (".sql", 'Grant Trigger On "public"."Users" To "service_role";', "table"),
        (".sql", "GRANT SELECT,\n  TRIGGER\n  ON public.users\n  TO postgres,\n  service_role;", "table"),
        (".sql", "GRANT ALL ON public.users TO postgres\n  , GROUP authenticated WITH GRANT OPTION;", "table"),
        (".sql", "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;",
         "default_acl"),
        (".sql", "ALTER DEFAULT PRIVILEGES FOR ROLE postgres\n  GRANT TRUNCATE ON TABLES TO anon;",
         "default_acl"),
        (".sql", "EXECUTE format('GRANT ALL ON TABLE %I.%I TO %I', 'public', t, 'service_role');", "table"),
        (".sql", "EXECUTE format('GRANT %s ON public.users TO service_role', p);", "table"),
        (".sql", "EXECUTE 'GRANT TRIGGER ON public.' || quote_ident(t) || ' TO service_role';", "table"),
        (".sql", "GRANT pg_maintain TO service_role;", "role_membership"),
        (".sql", "GRANT pg_write_all_data, pg_read_all_data TO anon;", "role_membership"),
        (".sql", "GRANT postgres TO service_role WITH INHERIT FALSE;", "role_membership"),
        (".sql", "EXECUTE format('GRANT %I TO service_role', r);", "role_membership"),
        (".sql", "ALTER TABLE public.users OWNER TO service_role;", "owner"),
        (".sql", "ALTER FUNCTION public.f() OWNER TO authenticated;", "owner"),
        (".sql", "ALTER SCHEMA public\n  OWNER TO\n  anon;", "owner"),
        (".sql", "EXECUTE format('ALTER TABLE %I OWNER TO %I', t, r);", "owner"),
        (".sql", "GRANT CREATE ON SCHEMA public TO service_role;", "schema_create"),
        (".sql", "GRANT ALL PRIVILEGES ON SCHEMA public TO PUBLIC;", "schema_create"),
        (".sh", 'psql "$DB" -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;"', "table"),
        (".sh", "psql \"$DB\" <<'SQL'\n-- reset\nGRANT TRIGGER\n  ON public.users\n  TO service_role;\nSQL\n",
         "table"),
        (".sh", 'psql "$DB" <<EOSQL\nALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO ${ROLE};\nEOSQL\n',
         "default_acl"),
        (".sh", 'psql "$DB" -c "GRANT pg_maintain TO service_role"', "role_membership"),
        (".sh", 'psql "$DB" -c "ALTER TABLE public.t OWNER TO service_role"', "owner"),
        (".py", 'cur.execute("GRANT ALL ON public.users TO service_role")', "table"),
        (".py", 'cur.execute(f"GRANT TRIGGER ON {table} TO {role}")', "table"),
        (".py", 'cur.execute(\n    "GRANT REFERENCES ON public.users TO "\n    "service_role"\n)', "table"),
        (".py", 'cur.execute("GRANT %s TO service_role", (role,))', "role_membership"),
        (".py", 'cur.execute(f"ALTER TABLE {t} OWNER TO service_role")', "owner"),
        (".py", 'cur.execute("GRANT ALL ON SCHEMA public TO anon")', "schema_create"),
    ],
)
def test_guard_flags_every_forbidden_family(suffix, source, family):
    hits = find_table_privilege_grants(source, suffix)
    assert family in {f for _, f in hits}, hits


@pytest.mark.parametrize(
    ("suffix", "source"),
    [
        (".sql", "GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO service_role;"),
        (".sql", "GRANT UPDATE (email) ON public.users TO service_role;"),
        (".sql", "GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;"),
        (".sql", "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT ON TABLES TO service_role;"),
        (".sql", "GRANT ALL ON public.users TO postgres;"),
        (".sql", "GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;"),
        (".sql", "GRANT ALL ON SEQUENCE public.s TO service_role;"),
        (".sql", "GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;"),
        (".sql", "GRANT ALL ON FUNCTION public.f() TO service_role;"),
        (".sql", "ALTER DEFAULT PRIVILEGES GRANT ALL ON FUNCTIONS TO service_role;"),
        (".sql", "GRANT anon TO authenticator;"),
        (".sql", "ALTER TABLE public.users OWNER TO postgres;"),
        (".sql", "REVOKE TRIGGER ON ALL TABLES IN SCHEMA public FROM service_role;"),
        (".sql", "-- GRANT ALL ON public.users TO service_role;"),
        (".sql", "/* GRANT TRIGGER ON public.users\n   TO service_role; */"),
        (".sh", "# psql -c 'GRANT ALL ON public.users TO service_role'"),
        (".sh", 'psql --dbname "$DB" -c "GRANT SELECT ON public.users TO service_role;"'),
        (".py", '# cur.execute("GRANT ALL ON public.users TO service_role")'),
        (".py", 'cur.execute("GRANT SELECT, INSERT ON public.users TO service_role")'),
    ],
)
def test_guard_allows_crud_usage_other_objects_and_comments(suffix, source):
    assert find_table_privilege_grants(source, suffix) == []


def test_guard_reports_file_line_numbers():
    source = "-- a\nGRANT SELECT ON public.t TO anon;\n\nGRANT TRIGGER\n  ON public.t TO anon;\n"
    assert find_table_privilege_grants(source) == [(4, "table")]


# ── Scan scope: rollback files have no number exemption ────────────────────

def _fake_repo(tmp_path: Path, files: dict[str, str]) -> Path:
    for name, text in files.items():
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    for root in ("backend/migrations/rollback", *SCRIPT_ROOTS):
        (tmp_path / root).mkdir(parents=True, exist_ok=True)
    return tmp_path


def test_scope_exempts_only_forward_migrations_up_to_364(tmp_path):
    bad = "GRANT ALL ON TABLE public.users TO service_role;\n"
    repo = _fake_repo(tmp_path, {
        "backend/migrations/194_old.sql": bad,
        "backend/migrations/161b_old.sql": bad,
        f"backend/migrations/{NAME}": bad,
        "backend/migrations/365_later.sql": bad,
        "backend/migrations/032_rollback.sql": bad,
        "backend/migrations/rollback/356_class_action_log_no_truncate.sql": bad,
        "backend/migrations/rollback/200_old_down.sql": bad,
        "backend/scripts/staging_clone_schema_from_prod.sh": f'psql "$U" -c "{bad.strip()}"\n',
        "scripts/backup/restore_into_project.sh": f'psql "$U" -c "{bad.strip()}"\n',
        "scripts/tool.py": f'cur.execute("{bad.strip()}")\n',
    })
    assert offenders(repo) == [
        "backend/migrations/rollback/200_old_down.sql:1: table",
        "backend/migrations/rollback/356_class_action_log_no_truncate.sql:1: table",
        "backend/migrations/032_rollback.sql:1: table",
        "backend/migrations/365_later.sql:1: table",
        "backend/scripts/staging_clone_schema_from_prod.sh:1: table",
        "scripts/backup/restore_into_project.sh:1: table",
        "scripts/tool.py:1: table",
    ]


def test_a_down_of_356_that_restores_a_targeted_privilege_is_rejected():
    """FR-008: the future CALAPPEND-0041 T001 down is scanned despite its number."""
    down = "-- down 356\nDROP TRIGGER IF EXISTS trg_x ON public.class_action_log;\n"
    assert find_table_privilege_grants(down) == []
    for statement in ("GRANT TRIGGER ON public.class_action_log TO service_role;",
                      "GRANT ALL ON TABLE public.class_action_log TO service_role;",
                      "GRANT REFERENCES, TRUNCATE ON public.class_action_log TO authenticated;"):
        assert find_table_privilege_grants(down + statement + "\n") == [(3, "table")]


# ── The repository ──────────────────────────────────────────────────────────

def test_repository_regrants_no_table_maintenance_privilege():
    files = scanned_files()
    assert len(files) > 100, f"scanned only {len(files)} files"
    names = {path.relative_to(REPO).as_posix() for path in files}
    assert {*CLONE_FILES, "scripts/backup/restore_into_project.sh",
            f"backend/migrations/rollback/{NAME}"} <= names
    assert not any(_forward_number(MIGRATIONS / Path(name).name) in range(0, NNN + 1)
                   for name in names if name.startswith("backend/migrations/")
                   and "/rollback/" not in name and not name.endswith("_rollback.sql"))
    assert offenders() == []


def test_down_of_364_is_a_noop():
    down = (MIGRATIONS / "rollback" / NAME).read_text(encoding="utf-8")
    assert "mig364_down_noop" in down
    code = re.sub(r"'[^']*'", "''", _blank_comments(down))
    assert not re.search(r"\b(?:GRANT|REVOKE|ALTER|CREATE|DROP)\b", code, re.I)


# ── FR-007: clone, baseline and the pending feature group ──────────────────

def test_clone_files_grant_service_role_usage_only():
    for name in CLONE_FILES:
        text = (REPO / name).read_text(encoding="utf-8")
        assert find_table_privilege_grants(text, Path(name).suffix) == [], name


def test_364_is_a_mandatory_pending_feature():
    rows = [line.split("\t") for line in (MIGRATIONS / "forward-policy.tsv").read_text(
        encoding="utf-8").splitlines() if line.startswith(NAME)]
    assert len(rows) == 1 and rows[0][1:3] == ["pending_feature", GROUP]
    assert "Merge KHÔNG áp" in rows[0][3] and "after 357" in rows[0][3]


def _runner(tmp_path: Path, args: list[str], features: str | None) -> subprocess.CompletedProcess:
    calls = tmp_path / "calls"
    fake = tmp_path / "psql"
    fake.write_text(f'#!/usr/bin/env bash\necho "$*" >> {calls}\nexit 0\n', encoding="utf-8")
    fake.chmod(0o755)
    env = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
    env["PATH"] = f"{tmp_path}:{env['PATH']}"
    env.pop("MIGRATION_FEATURES", None)
    if features is not None:
        env["MIGRATION_FEATURES"] = features
    result = subprocess.run([str(BACKEND / "scripts" / "apply_migrations.sh"), *args,
                             "postgresql://postgres:secret@staging.example/postgres"],
                            capture_output=True, text=True, env=env)
    result.calls = calls.read_text().splitlines() if calls.exists() else []
    return result


@pytest.mark.parametrize("features", [GROUP, f"curated_vocab,{GROUP}", "curated_vocab"])
def test_baseline_refuses_an_inherited_feature_selection_before_touching_the_database(tmp_path, features):
    result = _runner(tmp_path, ["--baseline"], features)
    assert result.returncode == 1
    assert f"REFUSED: --baseline with MIGRATION_FEATURES={features}" in result.stderr
    assert result.calls == []


def test_clone_script_baselines_then_applies_feature_groups_separately():
    clone = (BACKEND / "scripts" / "staging_clone_schema_from_prod.sh").read_text(encoding="utf-8")
    baseline = re.search(r"^(?P<prefix>.*)apply_migrations\.sh\" --baseline", clone, re.M)
    assert baseline and "MIGRATION_FEATURES" not in baseline["prefix"]
