"""Fail closed on role/ACL hazards in a schema-only pg_dump, before reset.

No DB connections: stdin is the target's read-only catalog snapshot. Tokenize
SQL so quoted role names, multiline ACLs, comments and function bodies cannot
be confused with top-level statements. This accepts pg_dump SQL, not arbitrary
operator-authored restore scripts.
"""

import json
from pathlib import Path
import re
import sys


TOKEN = re.compile(
    r"--[^\n]*|/\*.*?\*/|(?m:^\\[^\n]*)"
    r"|\$(?P<tag>[A-Za-z_][A-Za-z_0-9]*|)\$.*?\$(?P=tag)\$"
    r"|'(?:[^']|'')*'|\"(?:[^\"]|\"\")*\""
    r"|[A-Za-z_\u0080-\uffff][\w$]*|[^\s]",
    re.DOTALL,
)


def statements(sql: str):
    statement = []
    for match in TOKEN.finditer(sql):
        token = match[0]
        if token.startswith(("--", "/*", "\\")):
            continue
        if token == ";":
            if statement:
                yield statement
                statement = []
        else:
            statement.append(token)
    if statement:
        raise ValueError("unterminated dump statement")


def role_name(token: str) -> str:
    if token.startswith('"') and token.endswith('"'):
        return token[1:-1].replace('""', '"')
    if not re.fullmatch(r"[A-Za-z_\u0080-\uffff][\w$]*", token):
        raise ValueError("unrecognized role identifier")
    return token.lower()


def role_list(tokens: list[str], start: int) -> set[str]:
    # Only the unquoted PUBLIC keyword is a pseudo-role. A quoted "public"
    # or "PUBLIC" is an ordinary role which must exist on the target.
    roles = set() if tokens[start].upper() == "PUBLIC" else {role_name(tokens[start])}
    while start + 1 < len(tokens) and tokens[start + 1] == ",":
        start += 2
        if tokens[start].upper() != "PUBLIC":
            roles.add(role_name(tokens[start]))
    return roles


def referenced_roles(sql: str) -> set[str]:
    roles = {"postgres", "anon", "authenticated", "service_role"}  # reset + postconditions
    for tokens in statements(sql):
        upper = [token.upper() if not token.startswith(('"', "'", "$")) else token
                 for token in tokens]
        if upper[:3] == ["SET", "SESSION", "AUTHORIZATION"]:
            raise ValueError("dump contains SET SESSION AUTHORIZATION")
        if upper[:2] == ["SET", "ROLE"]:
            raise ValueError("dump contains SET ROLE")
        if upper[:3] == ["ALTER", "DEFAULT", "PRIVILEGES"]:
            # The managed supabase_admin defaults were already filtered out.
            if upper[3:5] != ["FOR", "ROLE"] or role_name(tokens[5]) != "postgres":
                raise ValueError("default privileges must be FOR ROLE postgres")
            roles.add(role_name(tokens[5]))
        # Privilege lists can contain function signatures, column names or
        # quoted identifiers named TO/FROM: the role list follows the LAST
        # unquoted TO/FROM in pg_dump's GRANT/REVOKE format.
        if upper[0] in {"GRANT", "REVOKE"} or upper[:3] == ["ALTER", "DEFAULT", "PRIVILEGES"]:
            acl_action = next(token for token in upper if token in {"GRANT", "REVOKE"})
            action = "TO" if acl_action == "GRANT" else "FROM"
            positions = [i for i, token in enumerate(upper) if token == action]
            if not positions:
                raise ValueError("unrecognized dump ACL statement")
            roles.update(role_list(tokens, positions[-1] + 1))
            if upper[0] in {"GRANT", "REVOKE"} and "ON" not in upper:
                start = 1 if upper[0] == "GRANT" else 4 if upper[1:4] == ["ADMIN", "OPTION", "FOR"] else 1
                roles.update(role_list(tokens, start))
        if upper[0] == "ALTER" and "OWNER" in upper:
            for i in range(len(tokens) - 2):
                if upper[i:i + 2] == ["OWNER", "TO"]:
                    roles.add(role_name(tokens[i + 2]))
        if upper[:2] == ["CREATE", "POLICY"] and "TO" in upper:
            roles.update(role_list(tokens, upper.index("TO") + 1))
        if upper[:2] == ["CREATE", "SCHEMA"] and "AUTHORIZATION" in upper:
            roles.add(role_name(tokens[upper.index("AUTHORIZATION") + 1]))
        if "GRANTED" in upper:
            for i in range(len(tokens) - 2):
                if upper[i:i + 2] == ["GRANTED", "BY"]:
                    roles.add(role_name(tokens[i + 2]))
    return roles


def main() -> int:
    try:
        catalog = json.load(sys.stdin)
        if catalog["global_default_acl"]:
            raise ValueError("target has global default ACL entries (defaclnamespace=0)")
        sql = Path(sys.argv[1]).read_text(encoding="utf-8")
        missing = referenced_roles(sql) - set(catalog["roles"])
        if missing:
            # JSON escapes newlines/control characters in unusual role names.
            raise ValueError("target missing roles: " + json.dumps(sorted(missing), ensure_ascii=True))
    except (ValueError, KeyError, IndexError) as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 1
    print("== role/default-ACL preflight passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
