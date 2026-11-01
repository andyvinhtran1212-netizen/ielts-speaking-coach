"""Fast, offline coverage ratchet for live migration triggers.

PG evidence is deliberately a textual heuristic, not proof of execution: a PG
test must mention the defining filename, trigger or function. Stack coverage is
curated separately because mentioning two triggers does not exercise both.
"""

from dataclasses import dataclass
from pathlib import Path
import re
import warnings

import pytest


ROOT = Path(__file__).resolve().parents[2]
IDENT = r'(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*)'
QUALIFIED = rf'{IDENT}(?:\s*\.\s*{IDENT})?'
CREATE = re.compile(
    rf'\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+'
    rf'(?P<name>{IDENT})\s+(?P<timing>BEFORE|AFTER|INSTEAD\s+OF)\s+'
    rf'(?P<events>[^;]*?)\s+ON\s+(?P<table>{QUALIFIED})\s+'
    rf'(?:(?!;).)*?\bEXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(?P<function>{QUALIFIED})\s*\(',
    re.I | re.S,
)
DROP = re.compile(
    rf'\bDROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?(?P<name>{IDENT})\s+'
    rf'ON\s+(?P<table>{QUALIFIED})', re.I,
)
# Traverse executable DO/function bodies; SQL literals inside them are masked.
SQL_TOKENS = re.compile(
    r'''"(?:[^"]|"")*"|--[^\n]*|/\*.*?\*/|'(?:[^']|'')*' '''
    r'|(?P<tag>\$(?:[A-Za-z_]\w*)?\$)(?P<body>.*?)(?P=tag)', re.S | re.X,
)
CREATE_START = re.compile(r"\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\b", re.I)


@dataclass(frozen=True)
class Trigger:
    name: str
    table: str
    timing: str
    events: frozenset[str]
    function: str
    migration: str
    line: int


# Explicit expansions of EXECUTE format(...). Keys are defining file:line;
# retain order within migrations so a later DROP/CREATE replaces the right key.
DYNAMIC_TRIGGERS = {
    "306_mock_paper_policy_and_admission.sql:164": (
        "trg_mock_paper_reference", ("mock_exams", "mock_exam_sittings", "mock_exam_assignments", "class_assignments"),
        "BEFORE", "INSERT UPDATE DELETE", "fn_guard_mock_paper_reference",
    ),
    "306_mock_paper_policy_and_admission.sql:1241": (
        "trg_mock_paper_source", ("reading_passages", "reading_questions", "listening_content", "listening_exercises", "web_explanation_objects"),
        "BEFORE", "INSERT UPDATE DELETE", "fn_guard_mock_paper_source",
    ),
    "309_grammar_quiz_revision_cutover.sql:68": (
        "grammar_quiz_statement_gate", ("content_topics", "quiz_banks", "quiz_questions", "quiz_sessions", "quiz_attempts", "quiz_word_stats", "governance_audit"),
        "BEFORE", "INSERT UPDATE DELETE TRUNCATE", "grammar_quiz_shared_write_gate",
    ),
    "338_reading_listening_paper_updated_at.sql:87": (
        "update_{table}_updated_at", ("reading_tests", "listening_tests", "reading_passages", "reading_questions", "listening_content"),
        "BEFORE", "UPDATE", "update_updated_at_column",
    ),
}

# name -> (defining migration, reason, follow-up ticket). Remove a row when its
# PG test lands; stale covered rows warn instead of making merge order matter.
KNOWN_UNCOVERED = {
    "trg_instructor_reviews_updated_at": ("047_instructor_review.sql", "Legacy review timestamp has no PG execution test", "PC-J262 baseline"),
    "trg_mock_exams_updated_at": ("145_mock_exam_definition.sql", "Legacy exam timestamp has no PG execution test", "PC-J262 baseline"),
    "trg_mock_sittings_updated_at": ("146_mock_exam_sittings.sql", "Legacy sitting timestamp has no PG execution test", "PC-J262 baseline"),
    "trg_mock_reviews_updated_at": ("147_mock_exam_reviews.sql", "Legacy mock-review timestamp has no PG execution test", "PC-J262 baseline"),
    "trg_band_conversion_updated_at": ("148_mock_sitting_links_and_band_tables.sql", "Legacy band-table timestamp has no PG execution test", "PC-J262 baseline"),
    "trg_sessions_full_test_attempt_id": ("204_reconcile_course_and_gate_e_schema.sql", "Only the ACL block is exercised here; the Speaking trigger still needs named PG evidence", "PC-J262 baseline; follow-up unassigned"),
    "trg_fulfil_writing_regrade_on_delivery": ("205_writing_regrade_atomic_transitions.sql", "Delivery/regrade fulfilment lacks a PG behavior test", "PC-J262 baseline; follow-up unassigned"),
    "trg_guard_published_vocab_version": ("234_vocab_curated_identity_and_editorial.sql", "Published version immutability PG coverage pending", "PC-J260"),
    "trg_guard_published_vocab_review": ("234_vocab_curated_identity_and_editorial.sql", "Published review immutability PG coverage pending", "PC-J260"),
    "trg_guard_published_vocab_task": ("235_vocab_curated_tasks_attempts_mastery.sql", "Published task immutability PG coverage pending", "PC-J260"),
    "trg_complete_vocab_recommendations_after_attempt": ("238_vocab_curated_pilot_metrics.sql", "Attempt/recommendation completion PG coverage pending", "PC-J260"),
    "trg_complete_vocab_recommendation_on_insert": ("238_vocab_curated_pilot_metrics.sql", "Already-completed recommendation insert PG coverage pending", "PC-J260"),
    "trg_mark_timed_course_assignment_started": ("272_lock_started_timed_course_due.sql", "First-open assignment stamp PG coverage pending", "PC-J258"),
    "trg_guard_started_timed_course_due_change": ("272_lock_started_timed_course_due.sql", "Started assignment due guard PG coverage pending", "PC-J258"),
    "trg_finalize_advanced_vocab_on_listening": ("281_advanced_vocab_stage_progress.sql", "Listening completion finalizer PG coverage pending", "PC-J257"),
    "trg_advanced_vocab_guard_stage_progress": ("282_advanced_vocab_persistence_gate.sql", "Stage evidence guard PG coverage pending", "PC-J257"),
    "trg_protect_advanced_vocab_bank": ("282_advanced_vocab_persistence_gate.sql", "Advanced vocabulary bank erasure PG coverage pending", "PC-J257"),
    "trg_protect_advanced_vocab_item_evidence": ("282_advanced_vocab_persistence_gate.sql", "Assignment evidence erasure PG coverage pending", "PC-J257"),
    "guard_single_attempt_course_session": ("284_single_attempt_course_assignments.sql", "Course session admission PG coverage pending", "PC-J261"),
    "guard_single_attempt_course_answer": ("284_single_attempt_course_assignments.sql", "Course answer admission PG coverage pending", "PC-J261"),
}

# The ACL test executes only one block of 204. A filename reference cannot
# establish evidence for its unrelated Speaking trigger, even if debt is removed.
REQUIRES_NAMED_PG_EVIDENCE = {("sessions", "trg_sessions_full_test_attempt_id")}

# table -> PG test path relative to root; this means the file deliberately
# executes the table's coexisting triggers, not merely separate unit tests.
STACK_TESTS = {
    "dictation_attempt_answers": "backend/tests/test_dictation_grading_postgres.py",
    "users": "backend/tests/test_migration_336_suspended_account_role_guard.py",
    "reading_tests": "backend/tests/test_migration_338_paper_updated_at_triggers.py",
    "reading_passages": "backend/tests/test_migration_338_paper_updated_at_triggers.py",
    "reading_questions": "backend/tests/test_migration_338_paper_updated_at_triggers.py",
}
# table -> (reason, ticket, expected stack-test path or None).
KNOWN_UNSTACKED = {
    "class_assignments": ("Due/duration, snapshot, paper and cohort guards need combined execution", "PC-J258", "backend/tests/test_class_assignment_trigger_stack_postgres.py"),
    "class_assignment_items": ("Timestamp, cutoff and cohort guards need combined execution", "PC-J258", "backend/tests/test_class_assignment_trigger_stack_postgres.py"),
    "writing_assignments": ("Timestamp, terminal, activity and archive guards need combined execution", "PC-J259", "backend/tests/test_writing_trigger_stack_postgres.py"),
    "writing_drafts": ("Timestamp, terminal and origin guards need combined execution", "PC-J259", "backend/tests/test_writing_trigger_stack_postgres.py"),
    "content_topics": ("Timestamp and grammar revision gates lack a curated stack test", "PC-J262 baseline", None),
    "quiz_banks": ("Timestamp and grammar bank/revision gates lack a curated stack test", "PC-J262 baseline", None),
    "quiz_word_stats": ("Timestamp and grammar evidence gates lack a curated stack test", "PC-J262 baseline", None),
    "mock_exams": ("Timestamp and confidential paper reference guard need combined execution", "PC-J262 baseline", None),
    "mock_exam_sittings": ("Timestamp and confidential paper reference guard need combined execution", "PC-J262 baseline", None),
    "mock_exam_assignments": ("Timestamp and confidential paper reference guard need combined execution", "PC-J262 baseline", None),
    "sessions": ("Speaking affinity and terminal immutability need combined execution", "PC-J262 baseline", None),
    "reading_attempt_answers": ("Terminal answer and mock paper guards need combined execution", "PC-J262 baseline", None),
    "reading_test_attempts": ("Terminal attempt and mock admission guards need combined execution", "PC-J262 baseline", None),
    "listening_test_attempts": ("Terminal attempt and mock admission guards need combined execution", "PC-J262 baseline", None),
    "listening_package_stimuli": ("Package protection and provenance guards need combined execution", "PC-J262 baseline", None),
    "listening_exercises": ("Existing 338 harnesses execute 295 and 306 separately", "PC-J262 baseline / PC-J252", None),
    "listening_tests": ("Existing 338 harnesses execute 295 and 306 separately", "PC-J262 baseline / PC-J252", None),
    "listening_content": ("Existing 338 harnesses execute 295 and 306 separately", "PC-J262 baseline / PC-J252", None),
}


def _identifier(raw):
    parts = re.findall(IDENT, raw)
    parts = [p[1:-1].replace('""', '"') if p.startswith('"') else p.lower() for p in parts]
    if len(parts) == 2 and parts[0] == "public":
        parts.pop(0)
    return ".".join(parts)


def _sql_code(sql):
    """Return executable text and dynamic CREATE offsets, preserving positions."""
    dynamic = set()

    def walk(text, offset):
        parts, position, prefix = [], 0, ""
        for token in SQL_TOKENS.finditer(text):
            gap = text[position:token.start()]
            parts.append(gap)
            prefix = (prefix + gap)[-512:]
            raw, tag = token[0], token["tag"]
            if raw.startswith('"'):
                replacement = raw
            elif tag and re.search(r"\b(?:DO(?:\s+LANGUAGE\s+\w+)?|AS)\s*$", prefix, re.I):
                replacement = tag + walk(token["body"], offset + token.start() + len(tag)) + tag
            else:
                if (tag or raw.startswith("'")) and CREATE_START.search(raw):
                    dynamic.add(offset + token.start())
                replacement = re.sub(r"[^\n]", " ", raw)
            parts.append(replacement)
            prefix = (prefix + replacement)[-512:]
            position = token.end()
        parts.append(text[position:])
        return "".join(parts)

    return walk(sql, 0), dynamic


def inventory(root):
    """Replay numeric migrations, keyed by (table, name), excluding rollback/."""
    live = {}
    paths = sorted((Path(root) / "backend/migrations").glob("[0-9]*.sql"),
                   key=lambda p: (int(re.match(r"\d+", p.name)[0]), p.name))
    for path in paths:
        sql = path.read_text(encoding="utf-8")
        code, dynamic_offsets = _sql_code(sql)
        dynamic_sources = set()
        for offset in dynamic_offsets:
            source = f"{path.name}:{sql.count(chr(10), 0, offset) + 1}"
            assert source in DYNAMIC_TRIGGERS, f"{source}: declare dynamic CREATE TRIGGER in DYNAMIC_TRIGGERS"
            dynamic_sources.add(source)
        operations = []
        for pattern in (CREATE, DROP):
            for match in pattern.finditer(code):
                line = code.count("\n", 0, match.start()) + 1
                table, name = (_identifier(match[k]) for k in ("table", "name"))
                trigger = None
                if pattern is CREATE:
                    trigger = Trigger(name, table, " ".join(match["timing"].upper().split()),
                                      frozenset(re.findall(r"\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b", match["events"].upper())),
                                      _identifier(match["function"]), path.name, line)
                operations.append((match.start(), (table, name), trigger))
        for source, (name, tables, timing, events, function) in DYNAMIC_TRIGGERS.items():
            filename, line = source.split(":")
            if source in dynamic_sources:
                for table in tables:
                    expanded = name.format(table=table)
                    offset = sum(len(s) for s in sql.splitlines(keepends=True)[:int(line) - 1])
                    operations.append((offset, (table, expanded), Trigger(
                        expanded, table, timing, frozenset(events.split()), function, filename, int(line))))
        for _, key, trigger in sorted(operations, key=lambda op: op[0]):
            if trigger is None:
                live.pop(key, None)
            else:
                live[key] = trigger
    return live


def pg_covered(root, *, live=None):
    """Return live trigger keys with a reference in a PG-capable test file."""
    sources = [p.read_text(encoding="utf-8") for p in (Path(root) / "backend/tests").rglob("test_*.py")
               if p.name != Path(__file__).name]
    evidence = "\n".join(s for s in sources if re.search(r"TEST_PG_URL|psql\s*\(|\basyncpg\b", s))
    identifiers = set(re.findall(r"[\w$]+", evidence))
    live = inventory(root) if live is None else live
    return {key for key, trigger in live.items()
            if (key not in REQUIRES_NAMED_PG_EVIDENCE and trigger.migration in evidence) or any(
                name in identifiers or (not re.fullmatch(r"[\w$]+", name) and
                    re.search(rf"(?<![\w$]){re.escape(name)}(?![\w$])", evidence))
                for name in (trigger.name, trigger.function))}


def stacked_tables(root, *, live=None):
    tables = {}
    live = inventory(root) if live is None else live
    for trigger in live.values():
        if trigger.timing == "BEFORE" and "UPDATE" in trigger.events:
            tables.setdefault(trigger.table, []).append(trigger)
    return {table: triggers for table, triggers in tables.items()
            if len({t.migration for t in triggers}) >= 2}


def coverage_errors(root):
    """Collect both gaps before asserting so one failure cannot hide another."""
    live = inventory(root)
    covered = pg_covered(root, live=live)
    errors = []
    for key, trigger in live.items():
        known = KNOWN_UNCOVERED.get(trigger.name)
        allowed = known and known[0] == trigger.migration and all(known[1:])
        if key in covered:
            if allowed:
                warnings.warn(f"{trigger.name}: có thể xoá khỏi KNOWN_UNCOVERED", stacklevel=2)
        elif not allowed:
            errors.append(f"{trigger.name} on {trigger.table} ({trigger.migration}:{trigger.line}): "
                          "add a PG test or KNOWN_UNCOVERED entry with migration, reason and ticket")
    for table, triggers in stacked_tables(root, live=live).items():
        test_path = STACK_TESTS.get(table)
        if test_path and (Path(root) / test_path).is_file():
            continue
        known = KNOWN_UNSTACKED.get(table)
        if known and all(known[:2]):
            if known[2] and (Path(root) / known[2]).is_file():
                warnings.warn(f"{table}: có thể xoá khỏi KNOWN_UNSTACKED; move to STACK_TESTS", stacklevel=2)
            continue
        sources = ", ".join(f"{t.name} {t.migration}:{t.line}" for t in triggers)
        errors.append(f"trigger stack / chồng trigger on {table}: {sources}; "
                      "add a PG stack test to STACK_TESTS or KNOWN_UNSTACKED with reason and ticket")
    return errors


def test_repository_trigger_pg_coverage():
    live = inventory(ROOT)
    print(f"Live triggers: {len(live)}; KNOWN_UNCOVERED: {len(KNOWN_UNCOVERED)}; "
          f"stacked tables: {len(stacked_tables(ROOT, live=live))}; KNOWN_UNSTACKED: {len(KNOWN_UNSTACKED)}")
    assert_pg_coverage(ROOT)


def assert_pg_coverage(root):
    assert not (errors := coverage_errors(root)), "\n".join(errors)


def _tree(root, migrations, tests=None):
    for directory, files in (("migrations", migrations), ("tests", tests or {})):
        folder = root / "backend" / directory
        folder.mkdir(parents=True, exist_ok=True)
        for name, content in files.items():
            (folder / name).write_text(content, encoding="utf-8")
    return root


FIRST = "CREATE TRIGGER t_new BEFORE UPDATE ON public.records FOR EACH ROW EXECUTE FUNCTION public.guard_new();"
SECOND = "CREATE TRIGGER t_second BEFORE UPDATE ON public.records FOR EACH ROW EXECUTE FUNCTION public.guard_second();"


def test_new_trigger_without_pg_evidence_fails_with_its_location(tmp_path):
    root = _tree(tmp_path, {"001_first.sql": FIRST}, {"test_mock.py": "# t_new guard_new 001_first.sql"})
    with pytest.raises(AssertionError, match=r"t_new on records \(001_first.sql:1\)"):
        assert_pg_coverage(root)


@pytest.mark.parametrize("reference", ["001_first.sql", "t_new", "guard_new"])
@pytest.mark.parametrize("pg_marker", ["TEST_PG_URL", "psql(", "asyncpg"])
def test_pg_test_reference_covers_the_trigger(tmp_path, reference, pg_marker):
    root = _tree(tmp_path, {"001_first.sql": FIRST}, {"test_pg.py": f"# {pg_marker} {reference}"})
    assert_pg_coverage(root)


def test_later_drop_removes_the_trigger_in_numeric_order_and_ignores_rollback(tmp_path):
    root = _tree(tmp_path, {"2_first.sql": FIRST, "10_drop.sql": 'DROP TRIGGER IF EXISTS "t_new" ON "public"."records" CASCADE;'})
    rollback = root / "backend/migrations/rollback"
    rollback.mkdir()
    (rollback / "999_restore.sql").write_text(FIRST)
    assert inventory(root) == {}
    assert_pg_coverage(root)


def test_cross_migration_before_update_stack_requires_an_existing_stack_test(tmp_path, monkeypatch):
    root = _tree(tmp_path, {"001_first.sql": FIRST, "002_second.sql": SECOND},
                 {"test_pg.py": "# TEST_PG_URL t_new t_second"})
    with pytest.raises(AssertionError, match="chồng trigger on records"):
        assert_pg_coverage(root)
    monkeypatch.setitem(STACK_TESTS, "records", "backend/tests/missing.py")
    with pytest.raises(AssertionError, match="chồng trigger on records"):
        assert_pg_coverage(root)
    monkeypatch.setitem(STACK_TESTS, "records", "backend/tests/test_pg.py")
    assert_pg_coverage(root)


def test_covered_known_uncovered_entry_only_warns(tmp_path, monkeypatch):
    root = _tree(tmp_path, {"001_first.sql": FIRST}, {"test_pg.py": "# TEST_PG_URL t_new"})
    monkeypatch.setitem(KNOWN_UNCOVERED, "t_new", ("001_first.sql", "Existing coverage debt", "TEST-1"))
    with pytest.warns(UserWarning, match="có thể xoá khỏi KNOWN_UNCOVERED"):
        assert_pg_coverage(root)


@pytest.mark.parametrize("reference", ["filename", "trigger", "function"])
def test_204_acl_filename_does_not_cover_the_speaking_trigger(tmp_path, monkeypatch, reference):
    name = "trg_sessions_full_test_attempt_id"
    filename = KNOWN_UNCOVERED[name][0]
    function = "fn_sessions_full_test_attempt_id"
    sql = f"CREATE TRIGGER {name} BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION {function}();"
    evidence = {"filename": filename, "trigger": name, "function": function}[reference]
    root = _tree(tmp_path, {filename: sql}, {"test_acl_pg.py": f"# TEST_PG_URL {evidence}"})
    if reference == "filename":
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            assert_pg_coverage(root)
        assert not caught, "ACL-only evidence must not suggest deleting Speaking coverage debt"
        monkeypatch.delitem(KNOWN_UNCOVERED, name)
        with pytest.raises(AssertionError, match=f"{name} on sessions"):
            assert_pg_coverage(root)
    else:
        with pytest.warns(UserWarning, match=f"{name}: có thể xoá khỏi KNOWN_UNCOVERED"):
            assert_pg_coverage(root)


def test_known_stack_becomes_a_warning_when_followup_file_lands(tmp_path, monkeypatch):
    root = _tree(tmp_path, {"001_first.sql": FIRST, "002_second.sql": SECOND},
                 {"test_pg.py": "# TEST_PG_URL t_new t_second"})
    path = "backend/tests/test_followup_pg.py"
    monkeypatch.setitem(KNOWN_UNSTACKED, "records", ("Stack test pending", "TEST-2", path))
    assert_pg_coverage(root)
    (root / path).write_text("# TEST_PG_URL t_new t_second")
    with pytest.warns(UserWarning, match="có thể xoá khỏi KNOWN_UNSTACKED"):
        assert_pg_coverage(root)


def test_parser_handles_replace_constraint_quotes_comments_and_table_scoped_names(tmp_path):
    sql = '''-- CREATE TRIGGER ignored BEFORE UPDATE ON x EXECUTE FUNCTION f();
/* DROP TRIGGER t_shared ON records; */
CREATE CONSTRAINT TRIGGER "t_shared" AFTER INSERT OR UPDATE ON "public"."records"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public"."guard"();
CREATE TRIGGER t_shared BEFORE UPDATE ON public.other FOR EACH ROW EXECUTE PROCEDURE public.guard();
CREATE OR REPLACE TRIGGER "t_shared" BEFORE UPDATE OF value OR DELETE ON "public"."records"
FOR EACH ROW EXECUTE FUNCTION "public"."replacement"();
DROP TRIGGER t_shared ON public.other;
'''
    root = _tree(tmp_path, {"001_quoted.sql": sql})
    live = inventory(root)
    assert list(live) == [("records", "t_shared")]
    trigger = live["records", "t_shared"]
    assert (trigger.function, trigger.timing, trigger.events, trigger.line) == (
        "replacement", "BEFORE", frozenset({"UPDATE", "DELETE"}), 6)


@pytest.mark.parametrize("quote", ["'", "$$", "$ddl$"])
def test_dynamic_triggers_are_expanded_and_later_drops_still_apply(tmp_path, monkeypatch, quote):
    sql = f"DO $body$ BEGIN EXECUTE format({quote}CREATE TRIGGER t_dynamic BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard(){quote}, t); END $body$;"
    root = _tree(tmp_path, {"001_dynamic.sql": sql, "002_drop.sql": "DROP TRIGGER t_dynamic ON public.second;"})
    with pytest.raises(AssertionError, match=r"001_dynamic.sql:1: declare dynamic CREATE TRIGGER"):
        inventory(root)
    monkeypatch.setitem(DYNAMIC_TRIGGERS, "001_dynamic.sql:1", (
        "t_dynamic", ("first", "second"), "BEFORE", "UPDATE", "guard"))
    assert set(inventory(root)) == {("first", "t_dynamic")}


def test_dollar_quoted_format_reports_its_file_and_line_inside_a_do_block(tmp_path):
    root = _tree(tmp_path, {"001_dynamic.sql": '''DO $$ BEGIN
EXECUTE format($ddl$CREATE TRIGGER %I BEFORE UPDATE ON public.%I
FOR EACH ROW EXECUTE FUNCTION public.guard_new()$ddl$, 't_new', 'records');
END $$;'''})
    with pytest.raises(AssertionError, match=r"001_dynamic.sql:2: declare dynamic CREATE TRIGGER"):
        assert_pg_coverage(root)


def test_dollar_quoted_function_bodies_still_expose_trigger_ddl(tmp_path):
    root = _tree(tmp_path, {"001_function.sql":
                 "CREATE FUNCTION install() RETURNS void AS $fn$ BEGIN " + FIRST + " END $fn$ LANGUAGE plpgsql;"})
    assert ("records", "t_new") in inventory(root)


def test_guard_and_non_pg_mentions_cannot_cover_themselves(tmp_path):
    root = _tree(tmp_path, {"001_first.sql": FIRST}, {
        Path(__file__).name: "# TEST_PG_URL t_new guard_new 001_first.sql",
        "test_pg.py": "# TEST_PG_URL t_newer guard_newer",
    })
    assert not pg_covered(root)


def test_single_migration_or_non_update_triggers_do_not_require_a_stack_test(tmp_path):
    root = _tree(tmp_path, {"001_first.sql": FIRST + SECOND, "002_after.sql":
                 "CREATE TRIGGER t_after AFTER UPDATE ON records FOR EACH ROW EXECUTE FUNCTION guard();"},
                 {"test_pg.py": "# TEST_PG_URL 001_first.sql 002_after.sql"})
    assert not stacked_tables(root)
    assert_pg_coverage(root)


def test_drop_and_recreate_on_one_line_preserve_statement_order(tmp_path):
    root = _tree(tmp_path, {"001_first.sql": FIRST, "002_replace.sql":
                 "DROP TRIGGER t_new ON public.records; " + FIRST.replace("guard_new", "replacement")})
    trigger = inventory(root)["records", "t_new"]
    assert (trigger.function, trigger.migration) == ("replacement", "002_replace.sql")


def test_comment_and_string_delimiters_inside_quoted_identifiers_are_preserved(tmp_path):
    sql = '''CREATE TRIGGER "trg--with'quote" BEFORE UPDATE ON "public"."records--name"
FOR EACH ROW EXECUTE FUNCTION "public"."guard'fn"();
CREATE TRIGGER "trg""quoted" BEFORE DELETE ON "public"."records--name"
FOR EACH ROW EXECUTE FUNCTION public.guard();
'''
    root = _tree(tmp_path, {"001_quoted.sql": sql})
    live = inventory(root)
    assert set(live) == {("records--name", "trg--with'quote"), ("records--name", 'trg"quoted')}
    assert live["records--name", "trg--with'quote"].function == "guard'fn"
    (root / "backend/migrations/002_drop.sql").write_text(
        '''DROP TRIGGER "trg--with'quote" ON "public"."records--name";''')
    assert set(inventory(root)) == {("records--name", 'trg"quoted')}
