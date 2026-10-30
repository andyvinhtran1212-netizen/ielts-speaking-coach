"""CI guard for SVCPRIV-0042 FR-010 (PC-J406): no migration adds a function
or procedure without SET search_path, and none unpins one again.

Migration 358 pins search_path = public, pg_temp on every public routine that
lacks one (SA P2-R2-1: an unpinned 283 trigger ran a service_role temp view's
code as the table owner through an FK cascade). This static guard keeps the
repository from adding a new one:

  · every CREATE [OR REPLACE] FUNCTION / PROCEDURE in backend/migrations/**.sql
    must carry SET search_path in its definition (outside the body, so a
    `SET search_path` written inside the function body does not count);
    definitions nested in a DO block are checked too;
  · no ALTER FUNCTION / ROUTINE / PROCEDURE ... RESET search_path, RESET ALL or
    SET search_path TO DEFAULT, including in header rollback notes.

Files that predate 358 are allowlisted with the exact number of findings they
had, so a new finding in an old file still fails. Their routines were applied
before 358; 358 pins every public one that is still unpinned at apply time and
its postcondition fails otherwise. Dynamic SQL inside EXECUTE strings is not
parsed here: the 358 postcondition and check (e) of
test_client_write_invariant_postgres.py catch it on a real database.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"

CREATE = re.compile(r"\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+([\w.\"]+)", re.I)
PINNED = re.compile(r"\bSET\s+search_path\b", re.I)
UNPIN = re.compile(r"\bALTER\s+(?:FUNCTION|ROUTINE|PROCEDURE)\s+[\w.\"]+\s*(?:\([^)]*\))?\s*"
                   r"(?:RESET\s+(?:search_path|ALL)\b|SET\s+search_path\s*(?:=|TO)\s*DEFAULT\b)", re.I)

# Findings that existed when 358 was written (2026-10-30), per file. Reason for
# all: applied before 358, which pins every public routine still unpinned at
# apply time (staging catalog 2026-10-30: only the four 283 triggers were
# left; the other functions were re-created pinned by later migrations).
# Never add an entry for a new file: pin the function instead.
ALLOWLIST = {
    "033_writing_coach_tables.sql": 2,
    "047_instructor_review.sql": 1,
    "089_admin_dashboard_grading_minutes_rpc.sql": 1,
    "098_completed_session_counts_rpc.sql": 1,
    "106_instructor_role_foundation.sql": 1,
    # 108's header rollback resets the six functions it pins (comment only).
    "108_security_hardening.sql": 6,
    "118_quiz_banks.sql": 1,
    "121_quiz_analytics_rpcs.sql": 3,
    "123_quiz_admin_student_rollup.sql": 1,
    "159_quiz_questions_hint.sql": 1,
    "283_master30_grammar_diagnostic.sql": 4,
    # 345's header rollback resets the four 283 functions (comment only; it
    # must not run after 358, see the 358 header).
    "345_admin_inline_policies_strict.sql": 4,
}


def _strip_comments(sql: str) -> str:
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.S)
    return re.sub(r"--[^\n]*", "", sql)


def _definition_outside_quotes(code: str, start: int) -> str:
    """Text of the statement from `start` up to its `;`, with every quoted or
    dollar-quoted literal (the body) blanked out."""
    out, i, n = [], start, len(code)
    while i < n:
        ch = code[i]
        if ch == "'":
            j = i + 1
            while j < n and not (code[j] == "'" and code[j + 1:j + 2] != "'"):
                j += 2 if code[j] == "'" else 1
            i = j + 1
            out.append(" ")
            continue
        if ch == "$":
            tag = re.match(r"\$(?:[A-Za-z_]\w*)?\$", code[i:])
            if tag:
                end = code.find(tag.group(0), i + len(tag.group(0)))
                i = n if end < 0 else end + len(tag.group(0))
                out.append(" ")
                continue
        if ch == ";":
            break
        out.append(ch)
        i += 1
    return "".join(out)


def findings(sql: str) -> list[str]:
    """One entry per unpinned CREATE FUNCTION/PROCEDURE and per unpinning ALTER."""
    code = _strip_comments(sql)
    found = [f"unpinned {m.group(1)}" for m in CREATE.finditer(code)
             if not PINNED.search(_definition_outside_quotes(code, m.end()))]
    # Raw text: a header rollback note that unpins is a finding too.
    found += [f"unpins: {' '.join(m.group(0).split())}" for m in UNPIN.finditer(sql)]
    return found


def scan(root: Path, allowlist: dict[str, int]) -> list[str]:
    problems = []
    for path in sorted(root.rglob("*.sql")):
        name = path.relative_to(root).as_posix()
        found = findings(path.read_text(encoding="utf-8"))
        if len(found) != allowlist.get(name, 0):
            problems.append(f"{name}: {found} (allowlisted: {allowlist.get(name, 0)})")
    missing = sorted(set(allowlist) - {p.relative_to(root).as_posix() for p in root.rglob("*.sql")})
    problems += [f"{name}: allowlisted but missing" for name in missing]
    return problems


def test_no_migration_adds_an_unpinned_function_or_unpins_one():
    problems = scan(MIGRATIONS, ALLOWLIST)
    assert problems == [], (
        "SVCPRIV-0042 FR-010: add `SET search_path = public, pg_temp` (pg_temp last) to every new "
        "function or procedure, and never RESET it:\n" + "\n".join(problems))


def test_the_allowlist_is_frozen_at_358():
    # Every allowlisted file predates 358; growing the list needs a spec decision.
    assert all(int(name[:3]) <= 358 for name in ALLOWLIST)
    assert sum(ALLOWLIST.values()) == 26
    assert findings((MIGRATIONS / "358_public_function_search_path_pin.sql").read_text(encoding="utf-8")) == []


# ── Controls: the guard really fails on what it guards ──────────────────────

UNPINNED_FN = """CREATE OR REPLACE FUNCTION public.f() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM 1 FROM some_table; RETURN NEW; END $$;"""
PINNED_FN = """CREATE OR REPLACE FUNCTION public.f() RETURNS trigger LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$ BEGIN RETURN NEW; END $$;"""


@pytest.mark.parametrize("sql, expected", [
    (UNPINNED_FN, ["unpinned public.f"]),
    (PINNED_FN, []),
    # Pin written after the body.
    ("CREATE FUNCTION f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$ SET search_path = public, pg_temp;", []),
    # Single-quoted body.
    ("CREATE FUNCTION f() RETURNS int LANGUAGE sql SET search_path=public,pg_temp AS 'select 1';", []),
    # A SET search_path inside the body does not pin the function.
    ("CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN SET search_path = public; END $$;",
     ["unpinned f"]),
    ("CREATE FUNCTION f() RETURNS text LANGUAGE sql AS 'SET search_path = x';", ["unpinned f"]),
    # A pin in the NEXT statement does not count for this one.
    ("CREATE FUNCTION f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;\n"
     "CREATE FUNCTION g() RETURNS int LANGUAGE sql SET search_path = public, pg_temp AS $$ SELECT 1 $$;",
     ["unpinned f"]),
    ("CREATE PROCEDURE public.p() LANGUAGE sql AS $$ SELECT 1 $$;", ["unpinned public.p"]),
    # Nested in a DO block.
    ("DO $$ BEGIN CREATE FUNCTION public.n() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$; END $$;",
     ["unpinned public.n"]),
    # Commented-out definitions are not code.
    ("-- CREATE FUNCTION public.c() RETURNS int AS $$ SELECT 1 $$;", []),
    # Unpinning, in code or in a header rollback note.
    ("ALTER FUNCTION public.f() RESET search_path;", ["unpins: ALTER FUNCTION public.f() RESET search_path"]),
    ("--   ALTER ROUTINE public.f(uuid) RESET ALL;", ["unpins: ALTER ROUTINE public.f(uuid) RESET ALL"]),
    ("ALTER FUNCTION f() SET search_path TO DEFAULT;", ["unpins: ALTER FUNCTION f() SET search_path TO DEFAULT"]),
    ("ALTER FUNCTION f() SET search_path = public, pg_temp;", []),
])
def test_findings_control(sql, expected):
    assert findings(sql) == expected


def test_scan_fails_a_new_migration_and_passes_it_once_pinned(tmp_path):
    (tmp_path / "359_new.sql").write_text(UNPINNED_FN, encoding="utf-8")
    assert scan(tmp_path, {}) == ["359_new.sql: ['unpinned public.f'] (allowlisted: 0)"]
    (tmp_path / "359_new.sql").write_text(PINNED_FN, encoding="utf-8")
    assert scan(tmp_path, {}) == []


def test_scan_fails_a_new_finding_in_an_allowlisted_file_and_a_stale_entry(tmp_path):
    (tmp_path / "283_old.sql").write_text(UNPINNED_FN + "\n" + UNPINNED_FN, encoding="utf-8")
    assert scan(tmp_path, {"283_old.sql": 2}) == []
    assert scan(tmp_path, {"283_old.sql": 1}) == [
        "283_old.sql: ['unpinned public.f', 'unpinned public.f'] (allowlisted: 1)"]
    assert scan(tmp_path, {"283_old.sql": 2, "100_gone.sql": 1}) == ["100_gone.sql: allowlisted but missing"]
    (tmp_path / "rollback").mkdir()
    (tmp_path / "rollback" / "283_old.sql").write_text("ALTER FUNCTION public.f() RESET search_path;",
                                                        encoding="utf-8")
    assert scan(tmp_path, {"283_old.sql": 2}) == [
        "rollback/283_old.sql: ['unpins: ALTER FUNCTION public.f() RESET search_path'] (allowlisted: 0)"]
