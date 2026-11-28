"""List every user-pointing column declared by backend/migrations/*.sql.

ACCOUNTDATA-0100 FR-006 / T001. A column "points at a user" when it:

* has a foreign key to ``public.users(id)``, ``auth.users(id)`` or
  ``public.students(id)`` (inline ``REFERENCES`` or a table/ALTER constraint);
* is named ``user_id``, ``learner_id``, ``student_id`` or ``used_by``; or
* has a name ending in ``_user_id``.

The scanner replays the migrations in file order, so a table dropped or a
column dropped/renamed by a later migration leaves the list. Only ``public``
tables count (``auth.*``/``storage.*`` belong to Supabase). Function
parameters (``p_user_id``) are not columns and never match, because only
``CREATE TABLE`` bodies and ``ALTER TABLE ... ADD`` clauses are read.

Usage::

    python scripts/account_data_inventory_scan.py            # TSV to stdout
    python scripts/account_data_inventory_scan.py --with-action

``--with-action`` adds the classification from
``services/account_data_inventory.py`` (``UNCLASSIFIED`` when missing).
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "migrations"

USER_NAMES = frozenset({"user_id", "learner_id", "student_id", "used_by"})
USER_TABLES = frozenset({"users", "auth.users", "students"})

_IDENT = r'(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)'
_QNAME = rf"{_IDENT}(?:\s*\.\s*{_IDENT})?"

_CONSTRAINT_WORDS = frozenset(
    {"constraint", "primary", "unique", "foreign", "check", "exclude", "like"}
)


@dataclass(frozen=True)
class UserColumn:
    table: str
    column: str
    migration: str
    reason: str  # "fk", "name" or "fk+name"


def _unquote(name: str) -> str:
    name = name.strip()
    if name.startswith('"') and name.endswith('"'):
        return name[1:-1]
    return name.lower()


def _qualified(raw: str) -> tuple[str, str]:
    """Return ``(schema, table)`` for ``[schema.]table``."""
    parts = [p for p in re.split(r"\s*\.\s*", raw.strip()) if p]
    if len(parts) == 2:
        return _unquote(parts[0]), _unquote(parts[1])
    return "public", _unquote(parts[0])


def _ref_target(raw: str) -> str:
    schema, table = _qualified(raw)
    return table if schema == "public" else f"{schema}.{table}"


def strip_sql(text: str) -> str:
    """Remove comments and string literals; keep dollar-quoted bodies.

    Dollar-quoted function bodies may hold ``CREATE TABLE`` for temp tables;
    those are rare in this repo and still describe real tables when they
    run, so they stay in.
    """
    out: list[str] = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if text.startswith("--", i):
            j = text.find("\n", i)
            i = n if j == -1 else j
            continue
        if text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = n if j == -1 else j + 2
            out.append(" ")
            continue
        if c == "'":
            j = i + 1
            while j < n:
                if text[j] == "'" and j + 1 < n and text[j + 1] == "'":
                    j += 2
                    continue
                if text[j] == "'":
                    break
                j += 1
            out.append("''")
            i = j + 1
            continue
        if c == "$":
            m = re.match(r"\$[A-Za-z_]*\$", text[i:])
            if m:
                # keep the body, drop only the tags
                out.append(" ")
                i += len(m.group(0))
                continue
        out.append(c)
        i += 1
    return "".join(out)


def _split_top_level(body: str) -> list[str]:
    parts, depth, cur = [], 0, []
    for ch in body:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    if "".join(cur).strip():
        parts.append("".join(cur))
    return parts


def _matching_paren(text: str, open_idx: int) -> int:
    depth = 0
    for k in range(open_idx, len(text)):
        if text[k] == "(":
            depth += 1
        elif text[k] == ")":
            depth -= 1
            if depth == 0:
                return k
    return -1


_REF_RE = re.compile(rf"\breferences\s+({_QNAME})", re.IGNORECASE)
_FK_RE = re.compile(
    rf"\bforeign\s+key\s*\(([^)]*)\)\s*references\s+({_QNAME})", re.IGNORECASE
)


class _State:
    def __init__(self) -> None:
        # (table, column) -> (migration, by_fk, by_name)
        self.columns: dict[tuple[str, str], list] = {}
        self.all_columns: dict[str, set[str]] = {}

    def add_column(self, table: str, column: str, migration: str, fk: bool) -> None:
        self.all_columns.setdefault(table, set()).add(column)
        by_name = column in USER_NAMES or column.endswith("_user_id")
        key = (table, column)
        if key in self.columns:
            if fk:
                self.columns[key][1] = True
            return
        if fk or by_name:
            self.columns[key] = [migration, fk, by_name]

    def mark_fk(self, table: str, column: str, migration: str) -> None:
        key = (table, column)
        if key in self.columns:
            self.columns[key][1] = True
        else:
            by_name = column in USER_NAMES or column.endswith("_user_id")
            self.columns[key] = [migration, True, by_name]
        self.all_columns.setdefault(table, set()).add(column)

    def drop_table(self, table: str) -> None:
        self.all_columns.pop(table, None)
        for key in [k for k in self.columns if k[0] == table]:
            del self.columns[key]

    def drop_column(self, table: str, column: str) -> None:
        self.all_columns.get(table, set()).discard(column)
        self.columns.pop((table, column), None)

    def rename_column(self, table: str, old: str, new: str, migration: str) -> None:
        entry = self.columns.pop((table, old), None)
        self.all_columns.get(table, set()).discard(old)
        fk = bool(entry and entry[1])
        self.add_column(table, new, migration, fk)

    def rename_table(self, old: str, new: str) -> None:
        if old in self.all_columns:
            self.all_columns[new] = self.all_columns.pop(old)
        for key in [k for k in self.columns if k[0] == old]:
            self.columns[(new, key[1])] = self.columns.pop(key)


def _column_def(part: str) -> tuple[str, bool] | None:
    part = part.strip()
    m = re.match(rf"({_IDENT})\s+(.*)$", part, re.DOTALL)
    if not m:
        return None
    name = _unquote(m.group(1))
    if name in _CONSTRAINT_WORDS:
        return None
    ref = _REF_RE.search(m.group(2))
    fk = bool(ref and _ref_target(ref.group(1)) in USER_TABLES)
    return name, fk


def _apply_table_constraint(state: _State, table: str, part: str, migration: str) -> None:
    for fk in _FK_RE.finditer(part):
        if _ref_target(fk.group(2)) in USER_TABLES:
            for col in fk.group(1).split(","):
                state.mark_fk(table, _unquote(col), migration)


_CREATE_RE = re.compile(
    rf"\bcreate\s+(?:(?:global\s+|local\s+)?(?:temporary|temp|unlogged)\s+)?table\s+"
    rf"(?:if\s+not\s+exists\s+)?({_QNAME})\s*\(",
    re.IGNORECASE,
)
_ALTER_RE = re.compile(
    rf"\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?({_QNAME})\s+(.*?);",
    re.IGNORECASE | re.DOTALL,
)
_DROP_TABLE_RE = re.compile(
    rf"\bdrop\s+table\s+(?:if\s+exists\s+)?((?:{_QNAME})(?:\s*,\s*{_QNAME})*)",
    re.IGNORECASE,
)


def _apply_alter(state: _State, table: str, actions: str, migration: str) -> None:
    m = re.match(rf"\s*rename\s+to\s+({_IDENT})", actions, re.IGNORECASE)
    if m:
        state.rename_table(table, _unquote(m.group(1)))
        return
    m = re.match(
        rf"\s*rename\s+(?:column\s+)?({_IDENT})\s+to\s+({_IDENT})", actions, re.IGNORECASE
    )
    if m:
        state.rename_column(table, _unquote(m.group(1)), _unquote(m.group(2)), migration)
        return
    for action in _split_top_level(actions):
        a = action.strip()
        m = re.match(
            rf"add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?({_IDENT}\s+.*)$",
            a,
            re.IGNORECASE | re.DOTALL,
        )
        if m and not re.match(r"add\s+(constraint|primary|unique|foreign|check|exclude)\b", a, re.I):
            col = _column_def(m.group(1))
            if col:
                state.add_column(table, col[0], migration, col[1])
            continue
        if re.match(r"add\s+", a, re.IGNORECASE):
            _apply_table_constraint(state, table, a, migration)
            continue
        m = re.match(
            rf"drop\s+(?:column\s+)?(?:if\s+exists\s+)?({_IDENT})", a, re.IGNORECASE
        )
        if m and _unquote(m.group(1)) not in {"constraint", "not", "default"}:
            state.drop_column(table, _unquote(m.group(1)))


def _apply_file(state: _State, sql: str, migration: str) -> None:
    events: list[tuple[int, str, re.Match]] = []
    for rx, kind in ((_CREATE_RE, "create"), (_ALTER_RE, "alter"), (_DROP_TABLE_RE, "drop")):
        for m in rx.finditer(sql):
            events.append((m.start(), kind, m))
    events.sort(key=lambda e: e[0])
    for _, kind, m in events:
        if kind == "create":
            schema, table = _qualified(m.group(1))
            open_idx = m.end() - 1
            close = _matching_paren(sql, open_idx)
            if schema != "public" or close == -1:
                continue
            body = sql[open_idx + 1 : close]
            for part in _split_top_level(body):
                col = _column_def(part)
                if col:
                    state.add_column(table, col[0], migration, col[1])
                else:
                    _apply_table_constraint(state, table, part, migration)
        elif kind == "alter":
            schema, table = _qualified(m.group(1))
            if schema == "public":
                _apply_alter(state, table, m.group(2), migration)
        else:
            for raw in m.group(1).split(","):
                schema, table = _qualified(raw)
                if schema == "public":
                    state.drop_table(table)


def migration_files(directory: Path = MIGRATIONS_DIR) -> list[Path]:
    return sorted(p for p in directory.glob("*.sql") if p.is_file())


def scan(directory: Path = MIGRATIONS_DIR, files: list[Path] | None = None) -> list[UserColumn]:
    state = _State()
    for path in files if files is not None else migration_files(directory):
        _apply_file(state, strip_sql(path.read_text(encoding="utf-8")), path.name)
    out = []
    for (table, column), (migration, fk, by_name) in state.columns.items():
        reason = "fk+name" if fk and by_name else ("fk" if fk else "name")
        out.append(UserColumn(table, column, migration, reason))
    return sorted(out, key=lambda c: (c.table, c.column))


def scan_text(sql_by_name: dict[str, str]) -> list[UserColumn]:
    """Scan in-memory migrations (tests)."""
    state = _State()
    for name in sorted(sql_by_name):
        _apply_file(state, strip_sql(sql_by_name[name]), name)
    return sorted(
        (
            UserColumn(t, c, mig, "fk+name" if fk and nm else ("fk" if fk else "name"))
            for (t, c), (mig, fk, nm) in state.columns.items()
        ),
        key=lambda c: (c.table, c.column),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--with-action", action="store_true")
    args = parser.parse_args(argv)
    actions: dict[tuple[str, str], str] = {}
    if args.with_action:
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from services.account_data_inventory import action_for  # noqa: PLC0415

        actions = {"__fn__": action_for}  # type: ignore[dict-item]
    rows = scan()
    header = ["table", "column", "migration", "reason"] + (["action"] if args.with_action else [])
    print("\t".join(header))
    for c in rows:
        row = [c.table, c.column, c.migration, c.reason]
        if args.with_action:
            row.append(actions["__fn__"](c.table, c.column) or "UNCLASSIFIED")  # type: ignore[operator]
        print("\t".join(row))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
