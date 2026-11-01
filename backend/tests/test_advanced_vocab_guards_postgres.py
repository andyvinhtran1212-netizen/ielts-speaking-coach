"""Run the real Advanced Vocabulary guard migrations on disposable LOCAL PG.

Each test owns a random schema, including its auth.users stand-in. No Supabase
connection is used; the shared psql helper rejects non-loopback database URLs.
"""

import json
import os
import shutil
from pathlib import Path
from uuid import uuid4

import pytest

from test_migration_240_core_attempt_evidence import psql


MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
CHAIN = (
    "281_advanced_vocab_stage_progress.sql",
    "282_advanced_vocab_persistence_gate.sql",
    "288_advanced_vocab_rewrite_feedback.sql",
    "290_align_advanced_vocab_rewrite_evidence.sql",
    "291_repair_advanced_vocab_evidence_guard.sql",
)
EVIDENCE_TABLES = (
    "advanced_vocab_practice_selections",
    "advanced_vocab_stage_progress",
    "advanced_vocab_question_attempts",
    "advanced_vocab_listening_attempts",
    "advanced_vocab_rewrite_submissions",
)


def _json(value):
    return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"


@pytest.fixture(scope="module")
def local_pg():
    try:
        available = shutil.which("psql") and psql("SELECT 1") == "1"
    except Exception:
        available = False
    if not available:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for Advanced Vocabulary guards")
        pytest.skip("Local PostgreSQL unavailable")
    assert psql("SELECT usesuper FROM pg_user WHERE usename=current_user") == "t"
    psql("""DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $$;""")


class _Lesson:
    def __init__(self, schema):
        self.schema = schema
        self.user, self.student, self.cohort, self.bank, self.assignment, self.item = (
            str(uuid4()) for _ in range(6)
        )

    def sql(self, sql):
        return psql(f"SET search_path = {self.schema}, pg_temp; {sql}")

    def migrate(self, filenames):
        for filename in filenames:
            sql = (MIGRATIONS / filename).read_text(encoding="utf-8")
            sql = sql.replace("public.", self.schema + ".")
            sql = sql.replace("search_path = public,", f"search_path = {self.schema},")
            sql = sql.replace("auth.users", self.schema + ".users")
            self.sql(sql)

    @property
    def identity(self):
        return f"'{self.bank}', '{self.user}', '{self.item}'"

    def seed(self):
        runtime = {"kind": "advanced_vocab", "lesson_id": "ADV-T01", "content_checksum": "fixture-v1"}
        self.sql(f"""
            INSERT INTO users VALUES ('{self.user}');
            INSERT INTO students VALUES ('{self.student}', '{self.user}');
            INSERT INTO cohorts VALUES ('{self.cohort}');
            INSERT INTO student_cohort_memberships VALUES ('{self.student}', '{self.cohort}', true);
            INSERT INTO quiz_banks (id, meta, is_published)
                VALUES ('{self.bank}', {_json({'runtime': runtime})}, true);
            INSERT INTO quiz_questions (bank_id, qid, "order")
                SELECT '{self.bank}', 'q' || n, n FROM generate_series(1, 48) n;
            INSERT INTO class_assignments
                (id, cohort_id, skill, content_id, content_config, status, due_at)
                VALUES ('{self.assignment}', '{self.cohort}', 'course', '{self.bank}',
                        {_json({'runtime': runtime})}, 'published', now() + interval '1 day');
            INSERT INTO class_assignment_items (id, assignment_id, student_id)
                VALUES ('{self.item}', '{self.assignment}', '{self.student}');
        """)

    def count(self, table, where="true"):
        return int(self.sql(f"SELECT count(*) FROM {table} WHERE {where}"))

    def stage(self, stage="vocabulary", evidence=None, status="completed"):
        if evidence is None:
            evidence = {"seen_lexeme_ids": [f"lexeme-{n}" for n in range(1, 25)]}
        return f"""INSERT INTO advanced_vocab_stage_progress
            (bank_id, user_id, class_assignment_item_id, stage, status, evidence)
            VALUES ({self.identity}, '{stage}', '{status}', {_json(evidence)})"""

    def selection(self, stage="practice_1", qids=None):
        if qids is None:
            bounds = (1, 29) if stage == "practice_1" else (29, 49)
            qids = [f"q{n}" for n in range(*bounds)]
        return f"""INSERT INTO advanced_vocab_practice_selections
            (bank_id, user_id, class_assignment_item_id, stage, qids)
            VALUES ({self.identity}, '{stage}', {_json(qids)})"""

    def answer(self, qid="q1", stage="practice_1"):
        return f"""INSERT INTO advanced_vocab_question_attempts
            (bank_id, user_id, class_assignment_item_id, stage, qid, answer_given,
             is_correct, response_time_ms)
            VALUES ({self.identity}, '{stage}', '{qid}', '"fixture"', true, 250)"""

    def answers(self, start, stop, stage):
        # Separate INSERTs preserve the per-answer BEFORE/AFTER interaction.
        return ";\n".join(self.answer(f"q{n}", stage) for n in range(start, stop)) + ";"

    def section(self, section="reading", attempt=1):
        return f"""INSERT INTO course_section_submissions
            (bank_id, user_id, class_assignment_item_id, section, attempt_no,
             answers, answer_key, content_snapshot, total, correct, score, duration_sec)
            VALUES ({self.identity}, '{section}', {attempt}, '{{"1":"fixture"}}',
                    '["fixture"]', '{{"revision":"fixture-v1"}}', 1, 1, 100, 30)"""

    def listening(self):
        return f"""INSERT INTO advanced_vocab_listening_attempts
            (bank_id, user_id, class_assignment_item_id, answers, answer_key,
             content_snapshot, total, correct, score, duration_sec)
            VALUES ({self.identity}, '{{"1":"fixture"}}', '["fixture"]',
                    '{{"revision":"fixture-v1"}}', 1, 1, 100, 30)"""

    def rewrite(self):
        return f"""INSERT INTO advanced_vocab_rewrite_submissions
            (bank_id, user_id, class_assignment_item_id, answers, content_snapshot)
            VALUES ({self.identity}, '{{}}', '{{}}')"""

    def through_practice(self):
        self.sql(self.stage() + ";" + self.selection() + ";" + self.answers(1, 29, "practice_1")
                 + self.selection("practice_2") + ";" + self.answers(29, 49, "practice_2"))

    def through_reading(self):
        self.through_practice()
        self.sql(self.section())

    def through_rewrite(self):
        self.through_reading()
        # Exercise the real 288 claim against the real 290 stage guard.
        answers = {f"rewrite-{n:02}": f"A fixture answer {n}." for n in range(1, 21)}
        result = self.sql(f"""SELECT claim_advanced_vocab_rewrite_submission(
            '{self.item}', '{self.user}', '{self.bank}', {_json(answers)},
            '{{}}', 'advanced-vocab-rewrite-v1')""")
        assert json.loads(result)["should_grade"] is True

    def reject(self, sql, state, message):
        # psql's default error output omits SQLSTATE. Capture the *actual*
        # exception diagnostics in a subtransaction, including exact message.
        result = self.sql(f"""
            CREATE TEMP TABLE observed_error (state text, message text);
            DO $probe$ DECLARE code text; msg text;
            BEGIN
                BEGIN
                    {sql};
                EXCEPTION WHEN OTHERS THEN
                    GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE, msg = MESSAGE_TEXT;
                    INSERT INTO observed_error VALUES (code, msg);
                END;
            END $probe$;
            SELECT json_build_array(state, message) FROM observed_error;
        """)
        assert result, f"statement unexpectedly succeeded: {sql}"
        assert json.loads(result) == [state, message]


def _tables(s):
    """Minimal pre-281 dependencies; all five evidence tables come from SQL."""
    return f"""
        CREATE SCHEMA {s}; SET search_path = {s}, pg_temp;
        CREATE TABLE users (id uuid PRIMARY KEY);
        CREATE TABLE students (id uuid PRIMARY KEY, user_id uuid REFERENCES users(id));
        CREATE TABLE cohorts (id uuid PRIMARY KEY);
        CREATE TABLE student_cohort_memberships (
            student_id uuid REFERENCES students(id), cohort_id uuid REFERENCES cohorts(id),
            is_active boolean NOT NULL, PRIMARY KEY (student_id, cohort_id));
        CREATE TABLE quiz_banks (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), meta jsonb NOT NULL DEFAULT '{{}}',
            is_published boolean NOT NULL DEFAULT false);
        CREATE TABLE quiz_questions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bank_id uuid REFERENCES quiz_banks(id),
            qid text NOT NULL, "order" integer NOT NULL);
        CREATE TABLE class_assignments (
            id uuid PRIMARY KEY, cohort_id uuid REFERENCES cohorts(id), skill text NOT NULL,
            content_id uuid REFERENCES quiz_banks(id), content_config jsonb NOT NULL,
            status text NOT NULL, publish_at timestamptz, due_at timestamptz);
        CREATE TABLE class_assignment_items (
            id uuid PRIMARY KEY, assignment_id uuid REFERENCES class_assignments(id),
            student_id uuid REFERENCES students(id), state text NOT NULL DEFAULT 'assigned',
            submitted_at timestamptz, passed_at timestamptz, score numeric,
            artifact_kind text, artifact_id uuid, mastery jsonb, updated_at timestamptz DEFAULT now());
        CREATE TABLE course_section_submissions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bank_id uuid REFERENCES quiz_banks(id),
            user_id uuid REFERENCES users(id), class_assignment_item_id uuid
                REFERENCES class_assignment_items(id) ON DELETE CASCADE,
            section text NOT NULL CHECK (section IN ('reading', 'listening')),
            attempt_no integer NOT NULL DEFAULT 1 CHECK (attempt_no >= 1),
            answers jsonb NOT NULL, answer_key jsonb NOT NULL, content_snapshot jsonb NOT NULL,
            total integer NOT NULL CHECK (total > 0), correct integer NOT NULL,
            score numeric NOT NULL, duration_sec integer NOT NULL,
            submitted_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (class_assignment_item_id, attempt_no, section));
    """


@pytest.fixture
def lesson(local_pg, request):
    s = "av_guards_" + uuid4().hex
    db = _Lesson(s)
    try:
        psql(_tables(s))
        db.migrate(getattr(request, "param", CHAIN))
        db.seed()
        yield db
    finally:
        psql(f"DROP SCHEMA IF EXISTS {s} CASCADE")


def _isolated_evidence(db, table):
    statements = dict(zip(EVIDENCE_TABLES, (
        db.selection(), db.stage(), db.answer(), db.listening(), db.rewrite(),
    )))
    # Seed *only* this evidence source. Normal insert guards require earlier
    # stages, which would otherwise mask a missing OR branch in the delete guard.
    # Replica mode is limited to setup; deletion runs with every trigger enabled.
    db.sql("BEGIN; SET LOCAL session_replication_role = replica; " + statements[table] + "; COMMIT;")
    assert [db.count(t) for t in EVIDENCE_TABLES] == [int(t == table) for t in EVIDENCE_TABLES]


@pytest.mark.parametrize("table", EVIDENCE_TABLES)
@pytest.mark.parametrize("has_evidence", [False, True], ids=["empty", "evidence"])
def test_assignment_item_delete_checks_each_evidence_store(lesson, table, has_evidence):
    db = lesson
    if has_evidence:
        _isolated_evidence(db, table)
        db.reject(f"DELETE FROM class_assignment_items WHERE id='{db.item}'", "23503",
                  "cannot delete assignment item with advanced vocabulary evidence")
        assert db.count("class_assignment_items") == db.count(table) == 1
    else:
        db.sql(f"DELETE FROM class_assignment_items WHERE id='{db.item}'")
        assert db.count("class_assignment_items") == db.count(table) == 0


@pytest.mark.parametrize("lesson", [CHAIN[:3]], indirect=True, ids=["288-to-291"])
def test_288_to_291_selection_delete_regression(lesson):
    db = lesson
    _isolated_evidence(db, "advanced_vocab_practice_selections")
    delete = f"DELETE FROM class_assignment_items WHERE id='{db.item}'"
    # 7c8540ee4 also repaired the checked-in 288 source. A fresh migration
    # replay already protects selections before 291; do not assert that this
    # corrected source reproduces the historical omission described by 291.
    db.reject(delete, "23503", "cannot delete assignment item with advanced vocabulary evidence")
    db.migrate(CHAIN[3:])
    db.reject(delete, "23503", "cannot delete assignment item with advanced vocabulary evidence")
    assert db.count("class_assignment_items") == 1
    assert db.count("advanced_vocab_practice_selections") == 1


@pytest.mark.parametrize("advanced", [False, True], ids=["ordinary", "advanced"])
def test_bank_delete_guard(lesson, advanced):
    db = lesson
    # No assignment FK may stand in for the bank guard in this test.
    bank = str(uuid4())
    meta = {"runtime": {"kind": "advanced_vocab"}} if advanced else {}
    db.sql(f"INSERT INTO quiz_banks (id, meta) VALUES ('{bank}', {_json(meta)})")
    if advanced:
        db.reject(f"DELETE FROM quiz_banks WHERE id='{bank}'", "23503",
                  "cannot delete immutable advanced vocabulary bank; unpublish it instead")
    else:
        db.sql(f"DELETE FROM quiz_banks WHERE id='{bank}'")
    assert db.count("quiz_banks", f"id='{bank}'") == int(advanced)


@pytest.mark.parametrize("operation", ["UPDATE", "DELETE"])
def test_selection_immutable(lesson, operation):
    db = lesson
    db.sql(db.stage() + ";" + db.selection())
    original = db.sql("SELECT row_to_json(s) FROM advanced_vocab_practice_selections s")
    mutation = "UPDATE advanced_vocab_practice_selections SET qids='[]'" if operation == "UPDATE" else "DELETE FROM advanced_vocab_practice_selections"
    db.reject(mutation, "55000", "advanced_vocab_selection_immutable")
    # Identical replays are accepted and preserve even server timestamps.
    db.sql("UPDATE advanced_vocab_practice_selections SET qids=qids, created_at=now()+interval '1 day'")
    assert db.sql("SELECT row_to_json(s) FROM advanced_vocab_practice_selections s") == original


def test_selection_not_canonical(lesson):
    db = lesson
    db.sql(db.stage())
    db.reject(db.selection(qids=[f"q{n}" for n in range(2, 30)]), "22023",
              "advanced_vocab_selection_not_canonical")
    assert db.count("advanced_vocab_practice_selections") == 0
    db.sql(db.selection())
    assert json.loads(db.sql("SELECT qids FROM advanced_vocab_practice_selections")) == [f"q{n}" for n in range(1, 29)]


@pytest.mark.parametrize("qids", [[], ["q1"] * 28, list(range(28))], ids=["short", "duplicates", "non-string"])
def test_selection_invalid(lesson, qids):
    db = lesson
    db.sql(db.stage())
    db.reject(db.selection(qids=qids), "22023", "advanced_vocab_selection_invalid")
    db.sql(db.selection())
    assert db.count("advanced_vocab_practice_selections") == 1


@pytest.mark.parametrize("stage", ["practice_1", "practice_2"])
def test_selection_prerequisite_incomplete(lesson, stage):
    db = lesson
    db.reject(db.selection(stage), "55000", "advanced_vocab_prerequisite_incomplete")
    assert db.count("advanced_vocab_practice_selections") == 0
    db.sql(db.stage())
    if stage == "practice_2":
        db.sql(db.selection() + ";" + db.answers(1, 29, "practice_1"))
    db.sql(db.selection(stage))
    assert db.count("advanced_vocab_practice_selections", f"stage='{stage}'") == 1


@pytest.mark.parametrize("operation", ["UPDATE", "DELETE"])
def test_stage_immutable(lesson, operation):
    db = lesson
    db.sql(db.stage())
    original = db.sql("SELECT row_to_json(p) FROM advanced_vocab_stage_progress p")
    mutation = "UPDATE advanced_vocab_stage_progress SET evidence='{}'" if operation == "UPDATE" else "DELETE FROM advanced_vocab_stage_progress"
    db.reject(mutation, "55000", "advanced_vocab_stage_immutable")
    db.sql("UPDATE advanced_vocab_stage_progress SET evidence=evidence, completed_at=now()+interval '1 day'")
    assert db.sql("SELECT row_to_json(p) FROM advanced_vocab_stage_progress p") == original


def test_stage_invalid(lesson):
    db = lesson
    db.reject(db.stage(status="pending"), "22023", "advanced_vocab_stage_invalid")
    assert db.count("advanced_vocab_stage_progress") == 0
    db.sql(db.stage())
    assert db.sql("SELECT status FROM advanced_vocab_stage_progress") == "completed"


@pytest.mark.parametrize("seen", [[], ["lexeme-1"] * 23], ids=["empty", "partial"])
def test_vocabulary_evidence_invalid(lesson, seen):
    db = lesson
    db.reject(db.stage(evidence={"seen_lexeme_ids": seen}), "22023",
              "advanced_vocab_vocabulary_evidence_invalid")
    assert db.count("advanced_vocab_stage_progress") == 0
    db.sql(db.stage())
    assert db.count("advanced_vocab_stage_progress") == 1


@pytest.mark.parametrize("stage", ["practice_1", "practice_2"])
@pytest.mark.parametrize("selected", [False, True], ids=["no-selection", "last-answer-missing"])
def test_practice_incomplete_then_last_answer_completes_stage(lesson, stage, selected):
    db = lesson
    db.sql(db.stage())
    if stage == "practice_2":
        db.sql(db.selection() + ";" + db.answers(1, 29, "practice_1"))
    start, stop = (1, 29) if stage == "practice_1" else (29, 49)
    if selected:
        db.sql(db.selection(stage) + ";" + db.answers(start, stop - 1, stage))
    db.reject(db.stage(stage, {"question_count": stop - start}), "55000", "advanced_vocab_practice_incomplete")
    assert db.count("advanced_vocab_stage_progress", f"stage='{stage}'") == 0
    if not selected:
        # The first answer also exercises the compatibility selection path.
        db.sql(db.answers(start, stop - 1, stage))
    db.sql(db.answer(f"q{stop-1}", stage))
    assert json.loads(db.sql(f"SELECT evidence FROM advanced_vocab_stage_progress WHERE stage='{stage}'")) == {"question_count": stop - start}


@pytest.mark.parametrize("missing", ["reading", "ids", "count"])
def test_rewrite_evidence_invalid(lesson, missing):
    db = lesson
    db.through_practice()
    evidence = {"submitted_item_ids": [f"rewrite-{n:02}" for n in range(1, 21)], "response_count": 20}
    if missing != "reading":
        db.sql(db.section())
    invalid = dict(evidence)
    if missing == "ids":
        invalid["submitted_item_ids"] = invalid["submitted_item_ids"][:-1]
    if missing == "count":
        invalid["response_count"] = 19
    db.reject(db.stage("controlled_rewrite", invalid), "55000", "advanced_vocab_rewrite_evidence_invalid")
    assert db.count("advanced_vocab_stage_progress", "stage='controlled_rewrite'") == 0
    if missing == "reading":
        db.sql(db.section())
    db.sql(db.stage("controlled_rewrite", evidence))
    assert json.loads(db.sql("SELECT evidence FROM advanced_vocab_stage_progress WHERE stage='controlled_rewrite'")) == evidence


@pytest.mark.parametrize("operation", ["UPDATE", "DELETE"])
def test_question_attempt_immutable(lesson, operation):
    db = lesson
    db.sql(db.stage() + ";" + db.selection() + ";" + db.answer())
    original = db.sql("SELECT row_to_json(a) FROM advanced_vocab_question_attempts a")
    mutation = "UPDATE advanced_vocab_question_attempts SET is_correct=false" if operation == "UPDATE" else "DELETE FROM advanced_vocab_question_attempts"
    db.reject(mutation, "55000", "advanced_vocab_attempt_immutable")
    assert db.sql("SELECT row_to_json(a) FROM advanced_vocab_question_attempts a") == original


def test_question_not_selected(lesson):
    db = lesson
    db.sql(db.stage() + ";" + db.selection())
    db.reject(db.answer("q29"), "22023", "advanced_vocab_question_not_selected")
    assert db.count("advanced_vocab_question_attempts") == 0
    db.sql(db.answer())
    assert db.sql("SELECT qid FROM advanced_vocab_question_attempts") == "q1"


@pytest.mark.parametrize("operation", ["UPDATE", "DELETE"])
def test_listening_attempt_immutable(lesson, operation):
    db = lesson
    db.through_rewrite()
    db.sql(db.listening())
    original = db.sql("SELECT row_to_json(a) FROM advanced_vocab_listening_attempts a")
    mutation = "UPDATE advanced_vocab_listening_attempts SET score=0" if operation == "UPDATE" else "DELETE FROM advanced_vocab_listening_attempts"
    db.reject(mutation, "55000", "advanced_vocab_listening_attempt_immutable")
    assert db.sql("SELECT row_to_json(a) FROM advanced_vocab_listening_attempts a") == original


def test_listening_prerequisite_incomplete(lesson):
    db = lesson
    db.through_reading()
    db.reject(db.listening(), "55000", "advanced_vocab_prerequisite_incomplete")
    assert db.count("advanced_vocab_listening_attempts") == 0
    evidence = {"submitted_item_ids": [f"rewrite-{n:02}" for n in range(1, 21)], "response_count": 20}
    db.sql(db.stage("controlled_rewrite", evidence) + ";" + db.listening())
    assert db.count("advanced_vocab_listening_attempts") == 1


@pytest.mark.parametrize("operation", ["UPDATE", "DELETE"])
def test_course_section_immutable(lesson, operation):
    db = lesson
    db.through_reading()
    original = db.sql("SELECT row_to_json(c) FROM course_section_submissions c")
    mutation = "UPDATE course_section_submissions SET score=0" if operation == "UPDATE" else "DELETE FROM course_section_submissions"
    db.reject(mutation, "55000", "advanced_vocab_section_immutable")
    assert db.sql("SELECT row_to_json(c) FROM course_section_submissions c") == original


def test_course_section_attempt_must_be_one(lesson):
    db = lesson
    db.through_practice()
    db.reject(db.section(attempt=2), "22023", "advanced_vocab_attempt_must_be_one")
    assert db.count("course_section_submissions") == 0
    db.sql(db.section())
    assert db.sql("SELECT attempt_no FROM course_section_submissions") == "1"


def test_course_section_already_submitted(lesson):
    db = lesson
    db.through_reading()
    original = db.sql("SELECT row_to_json(c) FROM course_section_submissions c")
    db.reject(db.section(), "23505", "advanced_vocab_section_already_submitted")
    assert db.sql("SELECT row_to_json(c) FROM course_section_submissions c") == original


@pytest.mark.parametrize("section", ["reading", "listening"])
def test_course_section_prerequisite_incomplete(lesson, section):
    db = lesson
    db.reject(db.section(section), "55000", "advanced_vocab_prerequisite_incomplete")
    assert db.count("course_section_submissions") == 0
    if section == "reading":
        db.through_practice()
    else:
        db.through_rewrite()
    db.sql(db.section(section))
    assert db.count("course_section_submissions", f"section='{section}'") == 1


def test_ordinary_course_section_insert_update_delete_allowed(lesson):
    db = lesson
    bank = str(uuid4())
    db.sql(f"""INSERT INTO quiz_banks (id) VALUES ('{bank}');
        UPDATE class_assignments SET content_id='{bank}', content_config='{{}}'
            WHERE id='{db.assignment}';""")
    # Both the BEFORE guard and Listening AFTER trigger must pass through.
    db.sql(db.section("listening", attempt=2).replace(db.bank, bank))
    db.sql("UPDATE course_section_submissions SET score=50")
    assert db.sql("SELECT score FROM course_section_submissions") == "50"
    assert db.sql("SELECT state FROM class_assignment_items") == "assigned"
    db.sql("DELETE FROM course_section_submissions")
    assert db.count("course_section_submissions") == 0


def test_full_learner_flow_finalizes_after_listening(lesson):
    db = lesson
    db.sql(db.stage() + ";" + db.selection() + ";" + db.answers(1, 28, "practice_1"))
    assert db.count("advanced_vocab_stage_progress", "stage='practice_1'") == 0
    db.sql(db.answer("q28"))
    assert db.sql("SELECT status FROM advanced_vocab_stage_progress WHERE stage='practice_1'") == "completed"
    db.sql(db.selection("practice_2") + ";" + db.answers(29, 48, "practice_2"))
    assert db.count("advanced_vocab_stage_progress", "stage='practice_2'") == 0
    db.sql(db.answer("q48", "practice_2"))
    assert db.sql("SELECT status FROM advanced_vocab_stage_progress WHERE stage='practice_2'") == "completed"
    db.sql(db.section())
    answers = {f"rewrite-{n:02}": f"A fixture answer {n}." for n in range(1, 21)}
    claimed = json.loads(db.sql(f"""SELECT claim_advanced_vocab_rewrite_submission(
        '{db.item}', '{db.user}', '{db.bank}', {_json(answers)}, '{{}}', 'fixture-v1')"""))
    assert claimed["should_grade"] is True
    db.sql(db.listening())
    assert db.sql("SELECT state FROM class_assignment_items") == "assigned"
    assert db.sql("SELECT submitted_at IS NULL FROM class_assignment_items") == "t"
    db.sql(db.section("listening"))
    assert db.sql("""SELECT state, submitted_at IS NOT NULL, passed_at IS NOT NULL,
        score IS NULL, artifact_kind, artifact_id=id FROM class_assignment_items""") == "submitted|t|t|t|advanced_vocab_progress|t"
    assert db.count("advanced_vocab_question_attempts") == 48
    assert db.count("advanced_vocab_practice_selections") == 2
    assert db.count("advanced_vocab_stage_progress") == 4
    assert db.count("advanced_vocab_listening_attempts") == 1
    assert db.count("advanced_vocab_rewrite_submissions") == 1
    assert db.count("course_section_submissions") == 2
    assert json.loads(db.sql("SELECT mastery FROM class_assignment_items")) == {
        "runtime": "advanced_vocab_v1", "lesson_id": "ADV-T01",
        "completed_stages": ["vocabulary", "practice_1", "practice_2", "reading", "controlled_rewrite", "listening"],
        "completion_policy": "required_interactions",
    }
