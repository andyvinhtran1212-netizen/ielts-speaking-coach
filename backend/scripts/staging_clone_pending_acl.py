"""List staging-first migration groups whose ACL changes a clone leaves out.

Print-only (PC-J498). The clone restores production ACLs and --baseline skips
pending_feature groups, so a staging-first migration that changes privileges
on objects production already has (347 listening_tests_revoke) is absent after
a clone without the ledger claiming it. This prints the groups and the command
to re-apply each; it never applies one. Leader/owner decides.

Usage: staging_clone_pending_acl.py <migrations dir> [re-applied group ...]
"""

from pathlib import Path
import re
import sys

APP_ROLES = re.compile(r"\b(?:PUBLIC|anon|authenticated|service_role)\b", re.IGNORECASE)
_COMMENT = re.compile(r"/\*.*?\*/|--[^\n]*", re.DOTALL)
_ACL = re.compile(
    r"\b(?:REVOKE|GRANT)\b[^;]*?\bON\s+(?:TABLE\s+|FUNCTION\s+|ROUTINE\s+|SEQUENCE\s+|SCHEMA\s+)?"
    r"(?P<targets>[^;]*?)\s+(?:FROM|TO)\b(?P<roles>[^;]*)",
    re.IGNORECASE,
)
_CREATED = re.compile(
    r"\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|MATERIALIZED\s+VIEW|FUNCTION|PROCEDURE|SEQUENCE|SCHEMA|TYPE)"
    r"\s+(?:IF\s+NOT\s+EXISTS\s+)?(?P<name>[\w.\"]+)",
    re.IGNORECASE,
)


def _bare(name: str) -> str:
    return re.sub(r"\s*\(.*", "", name, flags=re.DOTALL).strip().split(".")[-1].strip('"').lower()


def pending_groups(policy: Path) -> dict[str, list[str]]:
    groups: dict[str, list[str]] = {}
    for line in policy.read_text(encoding="utf-8").splitlines():
        fields = line.split("\t")
        if not line.startswith("#") and len(fields) >= 3 and fields[1] == "pending_feature":
            groups.setdefault(fields[2], []).append(fields[0])
    return groups


def pending_acl_groups(migrations: Path, reapplied: set[str]) -> dict[str, list[str]]:
    """Pending groups (minus ``reapplied``) with an app-role GRANT/REVOKE on an
    object the group does not create. A dynamic target (format/EXECUTE) counts."""
    found: dict[str, list[str]] = {}
    for group, files in pending_groups(migrations / "forward-policy.tsv").items():
        if group in reapplied:
            continue
        sources = {name: _COMMENT.sub(" ", (migrations / name).read_text(encoding="utf-8"))
                   for name in sorted(files)}
        created = {_bare(m["name"]) for sql in sources.values() for m in _CREATED.finditer(sql)}
        for name, sql in sources.items():
            for match in _ACL.finditer(sql):
                if not APP_ROLES.search(match["roles"]):
                    continue
                targets = re.split(r",(?![^(]*\))", match["targets"])
                if "%" in match["targets"] or any(_bare(t) not in created for t in targets):
                    found.setdefault(group, []).append(name)
                    break
    return found


def warning(groups: dict[str, list[str]]) -> str:
    if not groups:
        return "== staging-first ACL migrations: none outside the re-applied groups"
    lines = ["== WARNING: staging-first ACL migrations NOT re-applied by this clone",
             "   Their privilege changes are absent and the ledger does not list them.",
             "   Not applied automatically; Leader/owner decides, then per group:"]
    for group, files in sorted(groups.items()):
        lines.append(f"   - {group}: {', '.join(files)}")
        lines.append(f'     MIGRATION_FEATURES={group} backend/scripts/apply_migrations.sh "$STAGING_URL"')
    return "\n".join(lines)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__.strip().splitlines()[-1])
    print(warning(pending_acl_groups(Path(sys.argv[1]), set(sys.argv[2:]))))
