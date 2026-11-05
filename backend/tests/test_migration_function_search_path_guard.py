"""CI guard for SVCPRIV-0042 FR-010 (PC-J406, PGTEMP option a, PC-J510): no
migration adds a function or procedure whose search_path lets a caller's temp
objects shadow the names it resolves, and none unpins one again.

PostgreSQL searches pg_temp FIRST for relations and types unless the path
names it, so a routine is safe only when pg_temp is listed and listed LAST.
Migration 358 pins every public/app_private routine that is not; this static
guard keeps the repository from adding a new one:

  · every CREATE [OR REPLACE] FUNCTION / PROCEDURE in backend/migrations/**.sql
    must carry SET search_path in its definition (outside the body, so a
    `SET search_path` written inside the function body does not count);
    definitions nested in a DO block are checked too;
  · that search_path must not be empty (`''`) and its last entry must be
    pg_temp (`public, pg_temp` or `pg_catalog, pg_temp`);
  · ALTER FUNCTION / ROUTINE / PROCEDURE ... SET search_path follows the same
    two rules;
  · no ALTER FUNCTION / ROUTINE / PROCEDURE ... RESET search_path, RESET ALL or
    SET search_path TO DEFAULT, including in header rollback notes.

Files that predate 358 are allowlisted with the exact number of findings they
had and a reason per file, so a new finding in an old file still fails. Dynamic
SQL built with format() is not parsed here: the 358 postcondition and check
(e) of test_client_write_invariant_postgres.py catch it on a real database.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"

CREATE = re.compile(r"\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+([\w.\"]+)", re.I)
ALTER = re.compile(r"\bALTER\s+(?:FUNCTION|ROUTINE|PROCEDURE)\s+([\w.\"]+)", re.I)
SET_PATH = re.compile(r"\bSET\s+search_path\s*(?:=|\bTO\b)\s*", re.I)
UNPIN = re.compile(r"\bALTER\s+(?:FUNCTION|ROUTINE|PROCEDURE)\s+[\w.\"]+\s*(?:\([^)]*\))?\s*"
                   r"(?:RESET\s+(?:search_path|ALL)\b|SET\s+search_path\s*(?:=|TO)\s*DEFAULT\b)", re.I)
# A quoted literal of the statement is replaced by \x01<index>\x01.
ITEM = re.compile(r'\s*(?:\x01(\d+)\x01|"((?:[^"]|"")*)"|([A-Za-z_][\w$]*))\s*')

# Findings that existed when 358 was widened (PC-J510, 2026-11-02), per file,
# each with its reason. Shared facts behind the reasons (read-only staging
# catalog 2026-11-02, job 1oo ro-catalog.result): exactly 11 public/app_private
# routines lack a pg_temp-last search_path there (the four 283 triggers, the
# five fn_admin_* definers of 297–302, 334, 335) and 358 pins all of them;
# every other routine created below was dropped, re-created pinned by a later
# migration, or never applied. 358 re-reads the catalog at apply time and its
# postcondition fails if any routine is left. Never add an entry for a new
# file: pin the routine instead.
ALLOWLIST: dict[str, tuple[int, str]] = {
    "033_writing_coach_tables.sql": (2, "both functions pinned to public, pg_temp by 108"),
    "047_instructor_review.sql": (1, "pinned to public, pg_temp by 108"),
    "089_admin_dashboard_grading_minutes_rpc.sql": (1, "pinned to public, pg_temp by 108"),
    "098_completed_session_counts_rpc.sql": (1, "pinned to public, pg_temp by 108"),
    "106_instructor_role_foundation.sql": (1, "pinned to public, pg_temp by 108"),
    "108_security_hardening.sql": (6, "header rollback note resets the six functions 108 pins (comment only)"),
    "118_quiz_banks.sql": (1, "quiz_replace_questions re-created pinned by 186 and later"),
    "121_quiz_analytics_rpcs.sql": (3, "the three RPCs re-created pinned by 229"),
    "123_quiz_admin_student_rollup.sql": (1, "re-created pinned by 229"),
    "159_quiz_questions_hint.sql": (1, "quiz_replace_questions re-created pinned by 186 and later"),
    "247_core_admission_ledger.sql": (6, "retired in forward-policy.tsv (Gate F waived); none of its routines is live with this path on staging"),
    "248_writing_admission_execution.sql": (2, "retired in forward-policy.tsv (Gate F waived); none of its routines is live with this path on staging"),
    "249_writing_admission_provenance.sql": (7, "retired in forward-policy.tsv (Gate F waived); none of its routines is live with this path on staging"),
    "250_writing_admission_preparation.sql": (1, "retired in forward-policy.tsv (Gate F waived); none of its routines is live with this path on staging"),
    "251_writing_admission_reconciliation.sql": (1, "retired in forward-policy.tsv (Gate F waived); none of its routines is live with this path on staging"),
    "252_writing_baseline_entry.sql": (2, "retired in forward-policy.tsv (Gate F waived); none of its routines is live with this path on staging"),
    "253_writing_admission_nonce_lookup.sql": (1, "retired in forward-policy.tsv (Gate F waived); none of its routines is live with this path on staging"),
    "254_writing_admission_cohort_snapshot.sql": (1, "retired in forward-policy.tsv (Gate F waived); none of its routines is live with this path on staging"),
    "255_writing_cohort_reports.sql": (4, "retired in forward-policy.tsv (Gate F waived); none of its routines is live with this path on staging"),
    "263_atomic_timed_course_quiz_start.sql": (1, "`public`; re-created with public, pg_temp by 265/266/270"),
    "264_lock_timed_course_start_authorization.sql": (1, "`public`; re-created with public, pg_temp by 265/266/270"),
    "283_master30_grammar_diagnostic.sql": (4, "the four grammar triggers: 358 pins public, pg_temp"),
    "297_admin_writing_queue_page.sql": (1, "pg_catalog, public: 358 appends pg_temp"),
    "298_admin_mock_review_eligibility.sql": (1, "pg_catalog, public: 358 appends pg_temp"),
    "299_admin_exam_content_page.sql": (2, "pg_catalog, public: 358 appends pg_temp to both"),
    "300_admin_writing_queue_page_snapshot.sql": (1, "pg_catalog, public: 358 appends pg_temp"),
    "301_admin_exam_content_page_snapshot.sql": (1, "pg_catalog, public: 358 appends pg_temp"),
    "302_admin_mock_review_list_snapshot.sql": (1, "pg_catalog, public: 358 appends pg_temp"),
    "334_activate_attempt_rate_limit.sql": (1, "'' (body fully qualified): 358 pins pg_catalog, pg_temp"),
    "335_learner_jwt_writes_require_active_account.sql": (1, "'' (body fully qualified): 358 pins pg_catalog, pg_temp"),
    # 345 is pending; its Part B pins the 283 triggers to public, pg_temp, but
    # its header rollback must not run after 358 (see the 358 header).
    "345_admin_inline_policies_strict.sql": (4, "header rollback note resets the four 283 triggers (comment only)"),
}


def _strip_comments(sql: str) -> str:
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.S)
    return re.sub(r"--[^\n]*", "", sql)


def _statement(code: str, start: int) -> tuple[str, list[str]]:
    """Text of the statement from `start` up to its `;`; every quoted or
    dollar-quoted literal (the body) is replaced by a numbered placeholder."""
    out: list[str] = []
    literals: list[str] = []
    i, n = start, len(code)
    while i < n:
        ch = code[i]
        if ch == "'":
            j, buf = i + 1, []
            while j < n:
                if code[j] == "'" and code[j + 1:j + 2] == "'":
                    buf.append("'")
                    j += 2
                    continue
                if code[j] == "'":
                    break
                buf.append(code[j])
                j += 1
            out.append(f"\x01{len(literals)}\x01")
            literals.append("".join(buf))
            i = j + 1
            continue
        if ch == "$":
            tag = re.match(r"\$(?:[A-Za-z_]\w*)?\$", code[i:])
            if tag:
                end = code.find(tag.group(0), i + len(tag.group(0)))
                out.append(f"\x01{len(literals)}\x01")
                literals.append(code[i + len(tag.group(0)):n if end < 0 else end])
                i = n if end < 0 else end + len(tag.group(0))
                continue
        if ch == ";":
            break
        out.append(ch)
        i += 1
    return "".join(out), literals


def search_path_items(text: str, literals: list[str]) -> list[str] | None:
    """The entries of the first `SET search_path = ...` clause, or None."""
    m = SET_PATH.search(text)
    if not m:
        return None
    items, pos = [], m.end()
    while (item := ITEM.match(text, pos)) is not None:
        if item.group(1) is not None:
            items.append(literals[int(item.group(1))])
        elif item.group(2) is not None:
            items.append(item.group(2).replace('""', '"'))
        else:
            items.append(item.group(3).lower())
        pos = item.end()
        if text[pos:pos + 1] != ",":
            break
        pos += 1
    return items


def path_problem(items: list[str] | None) -> str | None:
    if items is None:
        return "unpinned"
    if items in ([], [""]):
        return "empty search_path"
    # PostgreSQL keeps the first pg_temp of a list, so a second one at the end does not help.
    if items[-1] != "pg_temp" or "pg_temp" in items[:-1]:
        return "pg_temp not last"
    return None


def findings(sql: str) -> list[str]:
    """One entry per CREATE FUNCTION/PROCEDURE or ALTER ... SET search_path
    whose path is missing, empty or not pg_temp-last, and per unpinning ALTER."""
    code = _strip_comments(sql)
    found = []
    for m in CREATE.finditer(code):
        items = search_path_items(*_statement(code, m.end()))
        problem = path_problem(items)
        if problem == "unpinned":
            found.append(f"unpinned {m.group(1)}")
        elif problem:
            found.append(f"{problem} {m.group(1)}: {', '.join(items)}")
    for m in ALTER.finditer(code):
        items = search_path_items(*_statement(code, m.end()))
        if items is None or items == ["default"]:
            continue  # no SET search_path, or TO DEFAULT (reported by UNPIN)
        problem = path_problem(items)
        if problem:
            found.append(f"{problem} {m.group(1)}: {', '.join(items)}")
    # Raw text: a header rollback note that unpins is a finding too.
    found += [f"unpins: {' '.join(m.group(0).split())}" for m in UNPIN.finditer(sql)]
    return found


def scan(root: Path, allowlist: dict[str, tuple[int, str]]) -> list[str]:
    problems = []
    for path in sorted(root.rglob("*.sql")):
        name = path.relative_to(root).as_posix()
        found = findings(path.read_text(encoding="utf-8"))
        allowed = allowlist.get(name, (0, ""))[0]
        if len(found) != allowed:
            problems.append(f"{name}: {found} (allowlisted: {allowed})")
    missing = sorted(set(allowlist) - {p.relative_to(root).as_posix() for p in root.rglob("*.sql")})
    problems += [f"{name}: allowlisted but missing" for name in missing]
    return problems


def test_no_migration_adds_an_unsafe_search_path_or_unpins_one():
    problems = scan(MIGRATIONS, ALLOWLIST)
    assert problems == [], (
        "SVCPRIV-0042 FR-010: give every new function or procedure `SET search_path = public, pg_temp` "
        "(or `pg_catalog, pg_temp`), never '' and never without pg_temp last, and never RESET it:\n"
        + "\n".join(problems))


def test_the_allowlist_is_frozen_at_358_with_a_reason_per_file():
    # Every allowlisted file predates 358; growing the list needs a spec decision.
    assert all(int(name[:3]) < 358 for name in ALLOWLIST)
    assert all(count > 0 and len(reason) > 20 for count, reason in ALLOWLIST.values())
    assert sum(count for count, _ in ALLOWLIST.values()) == 62
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
    # Single-quoted body, no spaces, mixed case.
    ("CREATE FUNCTION f() RETURNS int LANGUAGE sql SET search_path=Public,PG_TEMP AS 'select 1';", []),
    ("CREATE FUNCTION f() RETURNS int LANGUAGE sql SET search_path = pg_catalog, pg_temp AS $$ SELECT 1 $$;", []),
    ("CREATE FUNCTION f() RETURNS int LANGUAGE sql SET search_path TO 'public', 'pg_temp' AS $$ SELECT 1 $$;", []),
    ('CREATE FUNCTION f() RETURNS int LANGUAGE sql SET search_path = "public", "pg_temp" AS $$ SELECT 1 $$;', []),
    # FR-010: empty path.
    ("CREATE FUNCTION public.e() RETURNS int LANGUAGE sql SET search_path = '' AS $$ SELECT 1 $$;",
     ["empty search_path public.e: "]),
    ("CREATE FUNCTION public.e() RETURNS int LANGUAGE sql SET search_path TO '' AS $$ SELECT 1 $$;",
     ["empty search_path public.e: "]),
    # FR-010: pg_temp missing or not last.
    ("CREATE FUNCTION public.d() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public "
     "AS $$ SELECT 1 $$;", ["pg_temp not last public.d: pg_catalog, public"]),
    ("CREATE FUNCTION public.d() RETURNS int LANGUAGE sql SET search_path = public AS $$ SELECT 1 $$;",
     ["pg_temp not last public.d: public"]),
    ("CREATE FUNCTION public.d() RETURNS int LANGUAGE sql SET search_path = pg_temp, public AS $$ SELECT 1 $$;",
     ["pg_temp not last public.d: pg_temp, public"]),
    ("CREATE PROCEDURE public.d() LANGUAGE sql SET search_path = pg_temp, pg_catalog AS $$ SELECT 1 $$;",
     ["pg_temp not last public.d: pg_temp, pg_catalog"]),
    ("CREATE FUNCTION public.d() RETURNS int LANGUAGE sql SET search_path = pg_temp, public, pg_temp "
     "AS $$ SELECT 1 $$;", ["pg_temp not last public.d: pg_temp, public, pg_temp"]),
    # One literal is one schema name, not a list.
    ("CREATE FUNCTION public.d() RETURNS int LANGUAGE sql SET search_path = 'public, pg_temp' AS $$ SELECT 1 $$;",
     ["pg_temp not last public.d: public, pg_temp"]),
    # A SET search_path inside the body does not pin the function.
    ("CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN SET search_path = public, pg_temp; END $$;",
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
    ("DO $$ BEGIN CREATE FUNCTION public.n() RETURNS int LANGUAGE sql SET search_path = public "
     "AS $f$ SELECT 1 $f$; END $$;", ["pg_temp not last public.n: public"]),
    # Commented-out definitions are not code.
    ("-- CREATE FUNCTION public.c() RETURNS int AS $$ SELECT 1 $$;", []),
    ("/* CREATE FUNCTION public.c() RETURNS int SET search_path = '' AS $$ SELECT 1 $$; */", []),
    # ALTER ... SET search_path follows the same rules.
    ("ALTER FUNCTION f() SET search_path = public, pg_temp;", []),
    ("ALTER ROUTINE public.f(uuid) SET search_path = pg_catalog, pg_temp;", []),
    ("ALTER FUNCTION public.f(uuid) SET search_path = '';", ["empty search_path public.f: "]),
    ("ALTER PROCEDURE public.f() SET search_path = pg_catalog, public;",
     ["pg_temp not last public.f: pg_catalog, public"]),
    ("ALTER FUNCTION public.f() OWNER TO postgres;", []),
    # Unpinning, in code or in a header rollback note.
    ("ALTER FUNCTION public.f() RESET search_path;", ["unpins: ALTER FUNCTION public.f() RESET search_path"]),
    ("--   ALTER ROUTINE public.f(uuid) RESET ALL;", ["unpins: ALTER ROUTINE public.f(uuid) RESET ALL"]),
    ("ALTER FUNCTION f() SET search_path TO DEFAULT;", ["unpins: ALTER FUNCTION f() SET search_path TO DEFAULT"]),
])
def test_findings_control(sql, expected):
    assert findings(sql) == expected


def test_scan_fails_a_new_migration_and_passes_it_once_pinned(tmp_path):
    for bad, finding in ((UNPINNED_FN, "unpinned public.f"),
                         (PINNED_FN.replace("public, pg_temp", "''"), "empty search_path public.f: "),
                         (PINNED_FN.replace("public, pg_temp", "pg_temp, public"),
                          "pg_temp not last public.f: pg_temp, public")):
        (tmp_path / "361_new.sql").write_text(bad, encoding="utf-8")
        assert scan(tmp_path, {}) == [f"361_new.sql: ['{finding}'] (allowlisted: 0)"]
    (tmp_path / "361_new.sql").write_text(PINNED_FN, encoding="utf-8")
    assert scan(tmp_path, {}) == []


def test_scan_fails_a_new_finding_in_an_allowlisted_file_and_a_stale_entry(tmp_path):
    (tmp_path / "283_old.sql").write_text(UNPINNED_FN + "\n" + UNPINNED_FN, encoding="utf-8")
    assert scan(tmp_path, {"283_old.sql": (2, "reason")}) == []
    assert scan(tmp_path, {"283_old.sql": (1, "reason")}) == [
        "283_old.sql: ['unpinned public.f', 'unpinned public.f'] (allowlisted: 1)"]
    assert scan(tmp_path, {"283_old.sql": (2, "r"), "100_gone.sql": (1, "r")}) == [
        "100_gone.sql: allowlisted but missing"]
    (tmp_path / "rollback").mkdir()
    (tmp_path / "rollback" / "283_old.sql").write_text("ALTER FUNCTION public.f() RESET search_path;",
                                                        encoding="utf-8")
    assert scan(tmp_path, {"283_old.sql": (2, "r")}) == [
        "rollback/283_old.sql: ['unpins: ALTER FUNCTION public.f() RESET search_path'] (allowlisted: 0)"]
