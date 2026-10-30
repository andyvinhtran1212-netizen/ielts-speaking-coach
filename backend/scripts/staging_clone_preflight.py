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


# psql's lexer: identifiers and dollar tags take any non-ASCII character, E''
# strings take backslash escapes, and a backslash anywhere else (even mid-line)
# starts a meta-command running to the end of the line.
IDENT = r"[A-Za-z_\u0080-\U0010ffff][A-Za-z_0-9$\u0080-\U0010ffff]*"
TOKEN = re.compile(
    r"--[^\n]*|/\*.*?(?:\*/|\Z)"
    r"|\$(?P<tag>[A-Za-z_\u0080-\U0010ffff][A-Za-z_0-9\u0080-\U0010ffff]*|)\$.*?\$(?P=tag)\$"
    r"|[Ee]'(?:[^'\\]|\\.|'')*'|'(?:[^']|'')*'|\"(?:[^\"]|\"\")*\""
    r"|" + IDENT + r"|\\[^\n]*|[^\s]",
    re.DOTALL,
)
RESTRICT = re.compile(r"\\(un)?restrict ([A-Za-z0-9]+)[ \t\r]*")
# psql -1 is atomic only if the dump never ends or opens a transaction itself.
TRANSACTION_CONTROL = {"BEGIN", "START", "COMMIT", "END", "ROLLBACK", "ABORT",
                       "SAVEPOINT", "RELEASE", "PREPARE"}
# pg_dump --schema-only never runs queries or routines at restore time; these
# could switch role from inside a function body this scanner cannot see.
RESTORE_TIME_CODE = {"DO", "CALL", "EXECUTE", "EXPLAIN", "VALUES", "WITH", "TABLE",
                     "COPY", "REFRESH"}
ROLE_SETTINGS = {"role", "session_authorization"}


def lex(sql: str) -> list[str]:
    """Code and meta-command tokens. Fails closed where psql would lex differently."""
    result = []
    for match in TOKEN.finditer(sql):
        token = match[0]
        if token.startswith("/*"):
            # psql nests block comments; this scanner does not.
            if not token.endswith("*/") or len(token) < 4:
                raise ValueError("unterminated block comment")
            if "/*" in token[2:]:
                raise ValueError("nested block comment")
        elif not token.startswith("--"):
            result.append(token)
    return result


def statements(sql: str):
    """SQL statements. Only one \\restrict/\\unrestrict pair, same key, may
    frame them; any other meta-command (\\!, \\connect, \\o, \\i, \\copy, ...),
    at line start or mid-line, is refused."""
    stream = lex(sql)
    meta = [i for i, token in enumerate(stream) if token.startswith("\\")]
    for i in meta:
        if not re.match(r"\\(un)?restrict\b", stream[i]):
            raise ValueError("dump contains a psql meta-command other than \\restrict/\\unrestrict")
    if meta:
        frames = [RESTRICT.fullmatch(stream[i]) for i in meta]
        if len(meta) != 2 or not all(frames) or frames[0][1] or not frames[1][1]:
            if not all(frames):
                raise ValueError("malformed \\restrict/\\unrestrict line")
            raise ValueError("dump must contain exactly one \\restrict and one \\unrestrict")
        if frames[0][2] != frames[1][2]:
            raise ValueError("\\restrict and \\unrestrict must use the same key")
        if meta[0] != 0:
            raise ValueError("\\restrict must come before every SQL statement")
        if meta[1] != len(stream) - 1:
            raise ValueError("\\unrestrict must come after every SQL statement")
    statement = []
    for token in stream:
        if token.startswith("\\"):
            continue
        if token == ";":
            if statement:
                yield statement
                statement = []
        else:
            statement.append(token)
    if statement:
        raise ValueError("unterminated dump statement")


def name(token: str) -> str:
    """Identifier as PostgreSQL resolves it; other tokens unchanged."""
    if token.startswith('"'):
        return token[1:-1].replace('""', '"')
    return token.lower() if re.fullmatch(IDENT, token) else token


def literal(token: str) -> str | None:
    """Value of a plain '...' string, else None (E'', U&'', expressions)."""
    if len(token) >= 2 and token[0] == token[-1] == "'":
        return token[1:-1].replace("''", "'")
    return None


def check_session_control(tokens: list[str], upper: list[str]) -> None:
    """Refuse role switches, transaction control and lexer-state changes."""
    names = [name(token) for token in tokens] + ["", ""]
    if upper[0] in TRANSACTION_CONTROL:
        raise ValueError(f"dump contains transaction control ({upper[0]})")
    if upper[0] in RESTORE_TIME_CODE:
        raise ValueError(f"dump contains {upper[0]}")
    for i, token in enumerate(upper):
        if token not in {"SET", "RESET"}:
            continue
        j = i + 1
        while names[j] in {"local", "session"} and names[j:j + 2] != ["session", "authorization"]:
            j += 1
        if names[j] == "role":
            raise ValueError("dump changes the restore role (SET ROLE)")
        if names[j] == "session_authorization" or names[j:j + 2] == ["session", "authorization"]:
            raise ValueError("dump changes the restore role (SET SESSION AUTHORIZATION)")
    for i in range(len(tokens)):
        if names[i] == "set_config" and not tokens[i].startswith("'"):
            setting = literal(tokens[i + 2]) if i + 3 < len(tokens) and tokens[i + 1] == "(" else None
            if setting is None or tokens[i + 3] != ",":
                raise ValueError("dump calls set_config with a non-literal setting name")
            if setting.lower() in ROLE_SETTINGS:
                raise ValueError("dump changes the restore role (set_config)")
    if upper[0] == "SELECT":
        # pg_dump's only top-level SELECT, exactly:
        # SELECT pg_catalog.set_config('search_path', '', false)
        call = names[1:-2]
        if call[:3] == ["pg_catalog", ".", "set_config"]:
            call = call[2:]
        if (len(call) != 8 or call[:3] != ["set_config", "(", "'search_path'"]
                or call[3::2] != [",", ",", ")"] or literal(call[4]) is None
                or call[6] not in {"false", "true"}):
            raise ValueError("dump contains a top-level SELECT other than set_config(search_path)")
    if upper[0] == "RESET":
        raise ValueError("dump contains RESET")
    if upper[0] == "SET":
        # psql lexes strings by these settings; a change would desynchronize
        # this scanner from psql and could hide a meta-command.
        j = 2 if names[1] in {"local", "session"} else 1
        value = names[j + 2] if names[j + 1] in {"=", "to"} else None
        value = literal(value) if value and value.startswith("'") else value
        if names[j] == "standard_conforming_strings" and (value or "").lower() != "on":
            raise ValueError("dump turns standard_conforming_strings off")
        if names[j] == "client_encoding" and (value or "").lower() not in {"utf8", "utf-8"}:
            raise ValueError("dump sets a client_encoding other than UTF8")


def role_name(token: str) -> str:
    if token.startswith('"') and token.endswith('"'):
        return token[1:-1].replace('""', '"')
    if not re.fullmatch(IDENT, token):
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
        check_session_control(tokens, upper)
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


def preflight_dump(sql: str) -> set[str]:
    """Roles a whole pg_dump file references; it must be \\restrict-framed."""
    # statements() checks the pair itself; pg_dump 17.6+ always emits it.
    if not any(token.startswith("\\") for token in lex(sql)):
        raise ValueError("dump must contain exactly one \\restrict and one \\unrestrict")
    return referenced_roles(sql)


def main() -> int:
    try:
        catalog = json.load(sys.stdin)
        if catalog["global_default_acl"]:
            raise ValueError("target has global default ACL entries (defaclnamespace=0)")
        sql = Path(sys.argv[1]).read_text(encoding="utf-8")
        missing = preflight_dump(sql) - set(catalog["roles"])
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
