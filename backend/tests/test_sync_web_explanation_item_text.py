"""PC-J156: the web-explanation item-text sync copies the paper's CURRENT wording
into a new content version and refuses every state it cannot sync safely.

Unit cases drive the pure planner with synthetic papers. The PostgreSQL cases
(`REQUIRE_PG=1` in CI) run the script's own load and commit SQL against a
disposable local schema, together with migration 319's approval gate.
"""
import asyncio
import copy
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

import pytest

from scripts import sync_web_explanation_item_text as sync

OLD = "cambridge-web-explanations/2026-09-10-v1"
OLD_LISTENING_NOTE = "(Thứ tự không tính; cần đúng cả hai chữ cái.)\n"


# ── synthetic papers ────────────────────────────────────────────────────────

def _object(skill, paper_id, q, item, **extra):
    payload = {
        "item": item,
        "audit": {"verdict": "CONFIRMED"},
        "explanation": {"why_correct": f"Lời giải đã duyệt cho câu {q}.", "trap": "giữ nguyên"},
        "source": {"immutable": True, "question_number": q},
    }
    return {
        "id": str(uuid4()), "object_id": f"cambridge-20-test-1-{skill}-q{q:02d}",
        "content_version": OLD, "source_test_key": "cambridge-20-test-1", "skill": skill,
        "book_number": 20, "test_number": 1, "question_number": q,
        "reading_test_id": paper_id if skill == "reading" else None,
        "listening_test_id": paper_id if skill == "listening" else None,
        "payload": payload, "row_md5": f"md5-{q}", "source_hash": f"h{q}",
        "audit_verdict": "CONFIRMED", "rights_status": "BLOCKED_PENDING_RIGHTS_REVIEW",
        "editorial_status": "GENERATED_REQUIRES_EDITORIAL_REVIEW",
        "serving_status": "ELIGIBLE_AFTER_GLOBAL_RELEASE_GATES", "binding_status": "BOUND",
        "is_current": True, "import_batch_id": str(uuid4()), "created_at": "2026-09-11T02:47:06+00:00",
        **extra,
    }


def reading_paper():
    """Q1–40; Q3 is an MCQ, Q5 a matching item that later gains an instruction."""
    paper = {"id": str(uuid4()), "test_id": "ILR-RDG-CAM-B20-T1", "status": "draft",
             "web_explanation_mode": "disabled", "web_explanation_content_version": None}
    rows, objects = [], []
    for q in range(1, 41):
        options = [{"label": "A", "text": "old A"}, {"label": "B", "text": "old B"}] if q == 3 else []
        row = {"id": str(uuid4()), "passage_id": "p1", "q_num": q, "prompt": f"Question {q} old wording",
               "answer": {"answer": "B" if q == 3 else f"word{q}", "alternatives": []},
               "payload": {"options": options}, "question_type": "mcq_single" if q == 3 else "notes_completion",
               "updated_at": "2026-09-11T03:35:28+00:00"}
        rows.append(row)
        objects.append(_object("reading", paper["id"], q, {
            "prompt": row["prompt"],
            "options": {"A": "old A", "B": "old B"} if q == 3 else None,
            "question_type": "multiple_choice_single" if q == 3 else "note_completion",
            "response_constraint": {"instruction_text": "Choose the correct letter."},
            "answer": {"canonical": row["answer"]["answer"], "accepted_forms": [row["answer"]["answer"]]},
        }))
    return {"skill": "reading", "tests": [paper], "rows": rows, "objects": objects,
            "paper_md5": "paper-md5", "class_pins": [], "mocks": []}


def listening_paper():
    """Q1–40 in exercises of two; Q17–18 is a Choose-TWO (mcq_multi) group."""
    paper = {"id": str(uuid4()), "test_id": "ILR-LIS-CAM-B20-T1", "status": "draft",
             "web_explanation_mode": "disabled", "web_explanation_content_version": None}
    rows, objects = [], []
    for first in range(1, 41, 2):
        pair = (first, first + 1)
        multi = first == 17
        options = [{"label": x, "text": f"opt {x}"} for x in "ABCDE"] if multi else []
        instruction = "Choose TWO letters, A–E." if multi else "Write ONE WORD ONLY."
        questions = [{"q_num": q, "prompt": (OLD_LISTENING_NOTE if multi else "") + f"Listening question {q}",
                      "options": options} for q in pair]
        answers = [{"q_num": q, "answer": "A, E" if multi else f"word{q}", "alternatives": []} for q in pair]
        rows.append({"id": str(uuid4()), "content_id": "s1", "order_num": first,
                     "payload": {"instruction": instruction, "questions": questions, "answers": answers,
                                 "template_kind": "mcq_multi" if multi else "notes_completion"},
                     "updated_at": "2026-09-11T03:37:49+00:00"})
        for question in questions:
            q = question["q_num"]
            objects.append(_object("listening", paper["id"], q, {
                "prompt": instruction + "\n" + question["prompt"],
                "options": {o["label"]: o["text"] for o in options} or None,
                "question_type": "multiple_choice_multiple" if multi else "note_completion",
                "response_constraint": {"instruction_text": instruction},
                "answer": ({"canonical": ["A", "E"], "accepted_forms": ["A", "E"]} if multi
                           else {"canonical": f"word{q}", "accepted_forms": [f"word{q}"]}),
            }))
    return {"skill": "listening", "tests": [paper], "rows": rows, "objects": objects,
            "paper_md5": "paper-md5", "class_pins": [], "mocks": []}


def expected_for(data):
    """An after.json-shaped package that matches the paper's current rows."""
    table = "reading_questions" if data["skill"] == "reading" else "listening_exercises"
    return {"test": {"id": data["tests"][0]["id"], "test_id": data["tests"][0]["test_id"]},
            "table": table, "rows": copy.deepcopy(data["rows"][:3])}


def plan_for(data, expected=None):
    return sync.build_plan(data, expected_rows=expected if expected is not None else expected_for(data),
                           expected_rows_sha256="sha-of-after-json")


def fix_reading(data):
    """A content fix like PC-J128: new prompt+options on Q3, new instruction on Q5."""
    rows = {row["q_num"]: row for row in data["rows"]}
    rows[3]["prompt"] = "Question 3 corrected wording"
    rows[3]["payload"]["options"] = [{"label": "A", "text": "new A"}, {"label": "B", "text": "new B"}]
    rows[5]["payload"]["instruction"] = "Which paragraph contains the following information?"
    return data


# ── dry run: what is listed ─────────────────────────────────────────────────

def test_reading_dry_run_lists_exactly_the_questions_whose_paper_text_changed():
    data = fix_reading(reading_paper())
    plan = plan_for(data)

    assert plan["changed_questions"] == [3, 5]
    assert plan["changes"]["3"] == {
        "prompt": {"object": "Question 3 old wording", "paper": "Question 3 corrected wording"},
        "options": {"object": {"A": "old A", "B": "old B"}, "paper": {"A": "new A", "B": "new B"}},
    }
    assert plan["changes"]["5"] == {"instruction_text": {
        "object": "Choose the correct letter.",
        "paper": "Which paragraph contains the following information?"}}
    assert plan["source_version"] == OLD
    assert plan["target_version"].startswith(OLD + "+item-text-sync-")
    assert len(plan["sha256"]) == 64


def test_listening_prompt_is_instruction_plus_question_and_group_members_are_listed():
    data = listening_paper()
    for row in data["rows"]:
        for question in row["payload"]["questions"]:
            question["prompt"] = question["prompt"].replace(OLD_LISTENING_NOTE, "")
    plan = plan_for(data)

    assert plan["changed_questions"] == [17, 18]
    assert plan["changes"]["17"]["prompt"] == {
        "object": "Choose TWO letters, A–E.\n" + OLD_LISTENING_NOTE + "Listening question 17",
        "paper": "Choose TWO letters, A–E.\nListening question 17"}


def test_listening_empty_question_prompt_keeps_the_instruction_only_prompt():
    data = listening_paper()
    row = data["rows"][6]  # Q13–14
    row["payload"]["instruction"] = "Choose the correct letter.\nWhat does Heather value most?"
    row["payload"]["questions"][0]["prompt"] = ""
    obj = next(o for o in data["objects"] if o["question_number"] == 13)
    obj["payload"]["item"]["prompt"] = "Choose the correct letter.\nWhat does Heather value most?"
    obj["payload"]["item"]["response_constraint"]["instruction_text"] = "anything"
    other = next(o for o in data["objects"] if o["question_number"] == 14)
    other["payload"]["item"]["prompt"] = ("Choose the correct letter.\nWhat does Heather value most?\n"
                                          "Listening question 14")

    assert plan_for(data)["changed_questions"] == []


def test_new_version_copies_every_object_and_changes_only_the_paper_text():
    data = fix_reading(reading_paper())
    before = copy.deepcopy(data["objects"])
    plan = plan_for(data)

    # One version per paper (migration 319 refuses a paper with two), so all 40 move.
    assert len(plan["rows"]) == 40
    assert {row["content_version"] for row in plan["rows"]} == {plan["target_version"]}
    assert [p["id"] for p in plan["preconditions"]] == [o["id"] for o in before]
    by_q = {row["question_number"]: row for row in plan["rows"]}
    old = {o["question_number"]: o for o in before}
    for q in range(1, 41):
        new_payload, old_payload = by_q[q]["payload"], old[q]["payload"]
        assert new_payload["explanation"] == old_payload["explanation"]
        assert new_payload["item"]["answer"] == old_payload["item"]["answer"]
        assert by_q[q]["source_hash"] == old[q]["source_hash"]
        assert by_q[q]["object_id"] == old[q]["object_id"]
        if q not in (3, 5):
            assert new_payload == old_payload
    assert by_q[3]["payload"]["item"]["prompt"] == "Question 3 corrected wording"
    assert by_q[3]["payload"]["item"]["options"] == {"A": "new A", "B": "new B"}
    assert by_q[3]["payload"]["audit"]["item_text_sync"] == {
        "ticket": "PC-J156", "previous_content_version": OLD, "fields": ["options", "prompt"]}
    assert (by_q[5]["payload"]["item"]["response_constraint"]["instruction_text"]
            == "Which paragraph contains the following information?")
    assert data["objects"] == before  # the planner never mutates its input


def test_question_type_difference_is_reported_but_not_rewritten():
    data = reading_paper()
    data["rows"][2]["question_type"] = "matching_sentence_endings"
    plan = plan_for(data)

    assert plan["changed_questions"] == []
    assert plan["rows"] == []
    assert plan["review_notes"] == {"3": {"question_type": {
        "object": "multiple_choice_single", "paper": "matching_sentence_endings"}}}


def test_no_drift_creates_no_version():
    plan = plan_for(reading_paper())
    assert plan["changed_questions"] == []
    assert plan["rows"] == [] and plan["target_version"] is None
    assert sync.render_commit_sql(plan) is None


def test_approved_editorial_status_is_reset_only_on_changed_objects():
    data = fix_reading(reading_paper())
    for obj in data["objects"]:
        obj["rights_status"], obj["editorial_status"] = "APPROVED", "APPROVED"
    by_q = {row["question_number"]: row for row in plan_for(data)["rows"]}

    assert by_q[3]["editorial_status"] == "GENERATED_REQUIRES_EDITORIAL_REVIEW"
    assert by_q[5]["editorial_status"] == "GENERATED_REQUIRES_EDITORIAL_REVIEW"
    assert by_q[1]["editorial_status"] == "APPROVED"
    assert {row["rights_status"] for row in by_q.values()} == {"APPROVED"}


def test_plan_sha_is_stable_and_covers_the_paper_text():
    first = plan_for(fix_reading(reading_paper()))
    data = fix_reading(reading_paper())
    data["tests"][0]["id"] = first["paper"]["id"]
    for obj, ref in zip(data["objects"], first["preconditions"]):
        obj["id"] = ref["id"]
        obj["reading_test_id"] = first["paper"]["id"]
    expected = expected_for(data)
    same = sync.build_plan(data, expected_rows=expected, expected_rows_sha256="sha-of-after-json")
    data["rows"][2]["prompt"] = "Question 3 corrected wording, again"
    other = sync.build_plan(data, expected_rows=expected_for(data), expected_rows_sha256="sha-of-after-json")

    assert same["sha256"] == first["sha256"]
    assert other["sha256"] != first["sha256"]
    assert other["target_version"] != first["target_version"]


# ── refusals: the whole paper, every reason ─────────────────────────────────

def refusal(data, expected=None):
    with pytest.raises(sync.SyncRefused) as caught:
        plan_for(data, expected)
    return caught.value.reasons


def test_answer_key_disagreement_refuses_the_whole_paper():
    data = fix_reading(reading_paper())
    data["rows"][9]["answer"] = {"answer": "different", "alternatives": []}
    reasons = refusal(data)
    assert any(r.startswith("Q10:") and "đáp án" in r for r in reasons)


def test_listening_group_key_disagreement_refuses():
    data = listening_paper()
    for row in data["rows"]:
        for answer in row["payload"]["answers"]:
            if answer["q_num"] in (17, 18):
                answer["answer"] = "A, D"
    assert any(r.startswith("Q17:") for r in refusal(data))


def test_listening_group_in_per_slot_shape_agrees():
    data = listening_paper()
    for row in data["rows"]:
        for answer in row["payload"]["answers"]:
            if answer["q_num"] in (17, 18):
                answer["answer"] = "A" if answer["q_num"] == 17 else "E"
    assert plan_for(data)["changed_questions"] == []


def test_content_fix_not_fully_applied_refuses():
    data = fix_reading(reading_paper())
    expected = expected_for(data)
    expected["rows"][0]["prompt"] = "the wording the fix package expects"
    reasons = refusal(data, expected)
    assert any("chưa áp đủ" in r and expected["rows"][0]["id"] in r and "prompt" in r for r in reasons)


def test_content_fix_package_for_another_paper_or_missing_row_refuses():
    data = reading_paper()
    expected = expected_for(data)
    expected["test"]["id"] = str(uuid4())
    expected["rows"].append({"id": str(uuid4()), "prompt": "x"})
    reasons = refusal(data, expected)
    assert any("gói sửa đề" in r and "không phải" in r for r in reasons)
    assert any("không còn trong đề" in r for r in reasons)


def test_content_fix_updated_at_bump_alone_is_not_a_difference():
    data = reading_paper()
    expected = expected_for(data)
    data["rows"][0]["updated_at"] = "2026-10-29T09:00:00+00:00"  # migration 338 trigger
    assert plan_for(data, expected)["changed_questions"] == []


def test_pins_and_mock_pairing_refuse():
    data = fix_reading(reading_paper())
    paper = data["tests"][0]
    paper["web_explanation_content_version"] = OLD
    data["class_pins"] = [{"id": "give-1", "policy": {"content_version": OLD,
                                                      "web_explanation_mode": "immediate_after_capture"}}]
    data["mocks"] = [
        {"id": "mock-1", "code": "MOCK-A", "reading_test_id": paper["id"], "listening_test_id": str(uuid4()),
         "web_explanation_mode": "with_result", "web_explanation_content_version": None},
        {"id": "mock-2", "code": "MOCK-B", "reading_test_id": paper["id"], "listening_test_id": None,
         "web_explanation_mode": "with_result", "web_explanation_content_version": OLD},
    ]
    reasons = refusal(data)
    assert any("public practice" in r for r in reasons)
    assert any("give-1" in r for r in reasons)
    assert any("MOCK-A" in r and "ghép" in r for r in reasons)
    assert any("MOCK-B" in r and OLD in r for r in reasons)


def test_single_paper_mock_without_pin_is_not_a_blocker():
    data = fix_reading(reading_paper())
    data["mocks"] = [{"id": "mock-3", "code": "MOCK-C", "reading_test_id": data["tests"][0]["id"],
                      "listening_test_id": None, "web_explanation_mode": "with_result",
                      "web_explanation_content_version": None}]
    assert plan_for(data)["changed_questions"] == [3, 5]


def test_paper_without_one_current_version_q1_q40_refuses():
    data = reading_paper()
    data["objects"][0]["content_version"] = "other-version"
    data["objects"].pop()
    reasons = refusal(data)
    assert any("content version hiện hành" in r for r in reasons)
    assert any("Q1–Q40" in r for r in reasons)


def test_unknown_object_column_refuses():
    data = reading_paper()
    data["objects"][0]["surprise_column"] = 1
    assert any("cột" in r for r in refusal(data))


def test_payload_with_the_sql_quote_tag_refuses():
    data = fix_reading(reading_paper())
    data["objects"][2]["payload"]["explanation"]["trap"] = "x " + sync.JSON_TAG + " y"
    assert any("tag" in r for r in refusal(data))


# ── CLI / environment guards ────────────────────────────────────────────────

def test_cli_only_offers_staging_and_requires_a_paper_and_the_fix_package(capsys):
    parser = sync.build_parser()
    with pytest.raises(SystemExit):
        parser.parse_args(["--env", "production", "--skill", "reading", "--paper", "X",
                           "--expected-rows", "a.json"])
    with pytest.raises(SystemExit):
        parser.parse_args(["--skill", "reading", "--expected-rows", "a.json"])
    with pytest.raises(SystemExit):
        parser.parse_args(["--skill", "reading", "--paper", "X"])
    args = parser.parse_args(["--skill", "reading", "--paper", "X", "--expected-rows", "a.json"])
    assert args.env == "staging" and not args.commit
    assert sync.STAGING_PROJECT_REF == "zjphffoujxkpltixsbzj"


def test_local_runner_refuses_a_remote_database_url():
    with pytest.raises(SystemExit):
        sync.LocalPgRunner("postgresql://user@db.example.com:5432/postgres")


def test_commit_with_a_different_plan_sha_writes_nothing(tmp_path, monkeypatch):
    data = fix_reading(reading_paper())
    calls = []

    class Runner:
        def load(self, sql):
            calls.append(("load", sql))
            return copy.deepcopy(data)

        def execute(self, sql):  # pragma: no cover — must not be reached
            calls.append(("execute", sql))

    after = tmp_path / "after.json"
    after.write_text(json.dumps(expected_for(data)))
    monkeypatch.setattr(sync, "make_runner", lambda args: Runner())
    code = sync.main(["--skill", "reading", "--paper", "ILR-RDG-CAM-B20-T1", "--expected-rows", str(after),
                      "--commit", "--expected-plan-sha", "0" * 64, "--request-out", str(tmp_path / "req.sql")])
    assert code == 3
    assert [kind for kind, _ in calls] == ["load"]
    assert not (tmp_path / "req.sql").exists()


def test_commit_requires_expected_sha_and_request_file(tmp_path):
    with pytest.raises(SystemExit):
        sync.main(["--skill", "reading", "--paper", "X", "--expected-rows", "a.json", "--commit"])


# ── real PostgreSQL: the script's own load and commit SQL ───────────────────

DB = os.environ.get("TEST_PG_URL", "")
MIGRATION_319 = (Path(__file__).resolve().parents[1]
                 / "migrations/319_explanation_version_unavailable_reason.sql").read_text()


async def _pg(sql, *args, fetch=True):
    import asyncpg
    connection = await asyncpg.connect(DB)
    try:
        if not fetch:
            await connection.execute(sql)
            return []
        return await connection.fetch(sql, *args)
    finally:
        await connection.close()


def pg(sql, *args):
    return asyncio.run(_pg(sql, *args))


def pg_exec(sql):
    return asyncio.run(_pg(sql, fetch=False))


@pytest.fixture
def schema():
    parsed = urlparse(DB)
    if parsed.scheme not in {"postgres", "postgresql"} or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("PC-J156 sync requires an explicitly LOCAL disposable PostgreSQL URL")
        pytest.skip("Local PostgreSQL unavailable")
    name = "wexsync_" + uuid4().hex
    pg_exec("""DO $$ BEGIN
        IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
        IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
        IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
    END $$""")
    pg_exec(f"""
        CREATE SCHEMA {name};
        CREATE TABLE {name}.reading_tests(id uuid PRIMARY KEY, test_id text UNIQUE, status text,
            web_explanation_mode text DEFAULT 'disabled', web_explanation_content_version text,
            updated_at timestamptz DEFAULT now());
        CREATE TABLE {name}.reading_passages(id uuid PRIMARY KEY, test_id uuid, library text);
        CREATE TABLE {name}.reading_questions(id uuid PRIMARY KEY, passage_id uuid, q_num int,
            prompt text, answer jsonb, payload jsonb, question_type text, updated_at timestamptz DEFAULT now());
        CREATE TABLE {name}.listening_tests(id uuid PRIMARY KEY, test_id text UNIQUE, status text,
            web_explanation_mode text DEFAULT 'disabled', web_explanation_content_version text,
            updated_at timestamptz DEFAULT now());
        CREATE TABLE {name}.listening_content(id uuid PRIMARY KEY, test_id uuid, section_num int);
        CREATE TABLE {name}.listening_exercises(id uuid PRIMARY KEY, content_id uuid, order_num int,
            payload jsonb, updated_at timestamptz DEFAULT now());
        CREATE TABLE {name}.class_assignments(id uuid PRIMARY KEY, skill text, content_id uuid,
            content_config jsonb NOT NULL DEFAULT '{{}}');
        CREATE TABLE {name}.mock_exams(id uuid PRIMARY KEY, code text, status text,
            reading_test_id uuid, listening_test_id uuid, web_explanation_mode text DEFAULT 'with_result',
            web_explanation_content_version text);
        CREATE TABLE {name}.web_explanation_objects(
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), object_id text NOT NULL,
            content_version text NOT NULL, source_test_key text NOT NULL, skill text NOT NULL,
            book_number int NOT NULL, test_number int NOT NULL, question_number int NOT NULL,
            reading_test_id uuid, listening_test_id uuid, payload jsonb NOT NULL, source_hash text NOT NULL,
            audit_verdict text NOT NULL, rights_status text NOT NULL, editorial_status text NOT NULL,
            serving_status text NOT NULL, binding_status text NOT NULL DEFAULT 'BOUND',
            is_current boolean NOT NULL DEFAULT false, import_batch_id uuid NOT NULL DEFAULT gen_random_uuid(),
            imported_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (object_id, content_version));
        CREATE UNIQUE INDEX uq_web_explanation_current_object
            ON {name}.web_explanation_objects(object_id) WHERE is_current;
        CREATE TABLE {name}.mock_correction_release_events(
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scope_type text, scope_id text,
            action text, previous_state jsonb, new_state jsonb, reason text, actor_id uuid,
            created_at timestamptz DEFAULT now());
    """)
    pg_exec(MIGRATION_319.replace("public.", name + ".")
            .replace("search_path = public,", "search_path = " + name + ","))
    try:
        yield name
    finally:
        pg_exec(f"DROP SCHEMA IF EXISTS {name} CASCADE")


def seed(schema, data):
    """Write a synthetic paper into the disposable schema; return it re-read."""
    skill = data["skill"]
    paper = data["tests"][0]
    table = f"{schema}.{skill}_tests"
    pg(f"INSERT INTO {table}(id, test_id, status) VALUES ($1::uuid, $2, 'draft')", paper["id"], paper["test_id"])
    if skill == "reading":
        passage = str(uuid4())
        pg(f"INSERT INTO {schema}.reading_passages VALUES ($1::uuid, $2::uuid, 'l3_test')", passage, paper["id"])
        for row in data["rows"]:
            pg(f"""INSERT INTO {schema}.reading_questions(id, passage_id, q_num, prompt, answer, payload, question_type)
                   VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6::jsonb, $7)""",
               row["id"], passage, row["q_num"], row["prompt"], json.dumps(row["answer"]),
               json.dumps(row["payload"]), row["question_type"])
    else:
        section = str(uuid4())
        pg(f"INSERT INTO {schema}.listening_content VALUES ($1::uuid, $2::uuid, 1)", section, paper["id"])
        for row in data["rows"]:
            pg(f"""INSERT INTO {schema}.listening_exercises(id, content_id, order_num, payload)
                   VALUES ($1::uuid, $2::uuid, $3, $4::jsonb)""",
               row["id"], section, row["order_num"], json.dumps(row["payload"]))
    for obj in data["objects"]:
        pg(f"""INSERT INTO {schema}.web_explanation_objects(id, object_id, content_version, source_test_key, skill,
                   book_number, test_number, question_number, reading_test_id, listening_test_id, payload,
                   source_hash, audit_verdict, rights_status, editorial_status, serving_status, binding_status,
                   is_current)
               VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::uuid, $10::uuid, $11::jsonb, $12, $13, $14, $15,
                   $16, 'BOUND', true)""",
           obj["id"], obj["object_id"], obj["content_version"], obj["source_test_key"], skill,
           obj["book_number"], obj["test_number"], obj["question_number"], obj["reading_test_id"],
           obj["listening_test_id"], json.dumps(obj["payload"]), obj["source_hash"], obj["audit_verdict"],
           obj["rights_status"], obj["editorial_status"], obj["serving_status"])


def objects_snapshot(schema, skill, paper_id):
    rows = pg(f"""SELECT id, (to_jsonb(o) - 'is_current')::text AS body, is_current, content_version, object_id
                    FROM {schema}.web_explanation_objects o WHERE {skill}_test_id = $1::uuid
                   ORDER BY object_id, content_version""", paper_id)
    return [dict(row) for row in rows]


def pg_runner(schema):
    return sync.LocalPgRunner(DB)


def load_and_plan(schema, skill, test_id, expected):
    runner = pg_runner(schema)
    data = runner.load(sync.load_sql(skill, test_id, schema=schema))
    return runner, sync.build_plan(data, expected_rows=expected, expected_rows_sha256="sha")


def apply_fix_in_db(schema, data):
    """The content fix lands in the DB the way the PC-J128 SQL does."""
    rows = {row["q_num"]: row for row in data["rows"]}
    fix_reading(data)
    for q in (3, 5):
        pg(f"UPDATE {schema}.reading_questions SET prompt=$2, payload=$3::jsonb, updated_at=now() WHERE id=$1::uuid",
           rows[q]["id"], rows[q]["prompt"], json.dumps(rows[q]["payload"]))
    return package_from_db(schema, data, [rows[3]["id"], rows[5]["id"]])


def package_from_db(schema, data, row_ids):
    """The fix package's after-state, as the export tool reads it (to_jsonb rows)."""
    skill = data["skill"]
    loaded = pg_runner(schema).load(sync.load_sql(skill, data["tests"][0]["test_id"], schema=schema))
    return {"test": {"id": data["tests"][0]["id"]}, "table": sync.TABLES[skill],
            "rows": [row for row in loaded["rows"] if row["id"] in row_ids]}


def test_pg_commit_creates_one_new_current_version_and_rerun_is_a_no_op(schema):
    data = reading_paper()
    seed(schema, data)
    expected = apply_fix_in_db(schema, data)
    paper_id, test_id = data["tests"][0]["id"], data["tests"][0]["test_id"]
    before = {row["id"]: row for row in objects_snapshot(schema, "reading", paper_id)}

    runner, plan = load_and_plan(schema, "reading", test_id, expected)
    assert plan["changed_questions"] == [3, 5]
    runner.execute(sync.render_commit_sql(plan, schema=schema))

    after = objects_snapshot(schema, "reading", paper_id)
    old_rows = [row for row in after if row["id"] in before]
    new_rows = [row for row in after if row["id"] not in before]
    # Old rows: every byte but the current flag is unchanged.
    assert len(old_rows) == 40 and all(row["body"] == before[row["id"]]["body"] for row in old_rows)
    assert not any(row["is_current"] for row in old_rows)
    # Exactly one new version, 40 rows, all current; the current index points at it.
    assert len(new_rows) == 40 and all(row["is_current"] for row in new_rows)
    assert {row["content_version"] for row in new_rows} == {plan["target_version"]}
    current = pg(f"""SELECT question_number, payload FROM {schema}.web_explanation_objects
                      WHERE reading_test_id=$1::uuid AND is_current ORDER BY question_number""", paper_id)
    by_q = {row["question_number"]: json.loads(row["payload"]) for row in current}
    original = {o["question_number"]: o["payload"] for o in data["objects"]}
    assert by_q[3]["item"]["prompt"] == "Question 3 corrected wording"
    assert by_q[3]["item"]["options"] == {"A": "new A", "B": "new B"}
    assert all(by_q[q]["explanation"] == original[q]["explanation"] for q in range(1, 41))
    assert all(by_q[q] == original[q] for q in range(1, 41) if q not in (3, 5))

    # Migration 319's gate now sees exactly one current version for the paper.
    approval = pg(f"SELECT {schema}.fn_approve_web_explanation_paper('reading', $1::uuid, $2::uuid, NULL, 't') r",
                  paper_id, str(uuid4()))
    assert json.loads(approval[0]["r"])["content_version"] == plan["target_version"]

    _, rerun = load_and_plan(schema, "reading", test_id, expected)
    assert rerun["changed_questions"] == [] and rerun["rows"] == []


def test_pg_listening_commit_and_readback(schema):
    data = listening_paper()
    seed(schema, data)
    for row in data["rows"]:
        if row["order_num"] == 17:
            for question in row["payload"]["questions"]:
                question["prompt"] = question["prompt"].replace(OLD_LISTENING_NOTE, "")
            pg(f"UPDATE {schema}.listening_exercises SET payload=$2::jsonb WHERE id=$1::uuid",
               row["id"], json.dumps(row["payload"]))
            expected = package_from_db(schema, data, [row["id"]])
    runner, plan = load_and_plan(schema, "listening", data["tests"][0]["test_id"], expected)
    assert plan["changed_questions"] == [17, 18]
    runner.execute(sync.render_commit_sql(plan, schema=schema))
    assert sync.readback(runner, plan, schema=schema)["ok"] is True


def test_pg_commit_refuses_when_objects_changed_after_the_dry_run(schema):
    data = reading_paper()
    seed(schema, data)
    expected = apply_fix_in_db(schema, data)
    paper_id = data["tests"][0]["id"]
    runner, plan = load_and_plan(schema, "reading", data["tests"][0]["test_id"], expected)
    pg(f"""UPDATE {schema}.web_explanation_objects SET payload = payload || '{{"x":1}}'::jsonb
            WHERE reading_test_id=$1::uuid AND question_number=7""", paper_id)
    before = objects_snapshot(schema, "reading", paper_id)

    with pytest.raises(Exception) as caught:
        runner.execute(sync.render_commit_sql(plan, schema=schema))
    assert "pcj156_precondition" in str(caught.value)
    assert objects_snapshot(schema, "reading", paper_id) == before


def test_pg_commit_refuses_when_an_approval_landed_after_the_dry_run(schema):
    """Statuses are copied into the new rows, so a status change must also stop the commit."""
    data = reading_paper()
    seed(schema, data)
    expected = apply_fix_in_db(schema, data)
    paper_id = data["tests"][0]["id"]
    runner, plan = load_and_plan(schema, "reading", data["tests"][0]["test_id"], expected)
    pg(f"""UPDATE {schema}.web_explanation_objects SET rights_status='APPROVED', editorial_status='APPROVED'
            WHERE reading_test_id=$1::uuid AND is_current""", paper_id)
    before = objects_snapshot(schema, "reading", paper_id)

    with pytest.raises(Exception) as caught:
        runner.execute(sync.render_commit_sql(plan, schema=schema))
    assert "pcj156_precondition" in str(caught.value)
    assert objects_snapshot(schema, "reading", paper_id) == before


def test_pg_commit_refuses_when_the_paper_changed_after_the_dry_run(schema):
    data = reading_paper()
    seed(schema, data)
    expected = apply_fix_in_db(schema, data)
    paper_id = data["tests"][0]["id"]
    runner, plan = load_and_plan(schema, "reading", data["tests"][0]["test_id"], expected)
    pg(f"UPDATE {schema}.reading_questions SET prompt = prompt || '!' WHERE q_num = 8 "
       f"AND passage_id IN (SELECT id FROM {schema}.reading_passages WHERE test_id=$1::uuid)", paper_id)
    before = objects_snapshot(schema, "reading", paper_id)

    with pytest.raises(Exception) as caught:
        runner.execute(sync.render_commit_sql(plan, schema=schema))
    assert "pcj156_precondition" in str(caught.value)
    assert objects_snapshot(schema, "reading", paper_id) == before


def test_pg_load_reports_pins_and_pairing(schema):
    data = fix_reading(reading_paper())
    seed(schema, data)
    paper_id = data["tests"][0]["id"]
    pg(f"""INSERT INTO {schema}.class_assignments(id, skill, content_id, content_config)
           VALUES ($1::uuid, 'reading', $2::uuid, $3::jsonb)""", str(uuid4()), paper_id,
       json.dumps({"correction_policy": {"content_version": OLD, "web_explanation_mode": "admin_release"}}))
    pg(f"""INSERT INTO {schema}.mock_exams(id, code, reading_test_id, listening_test_id)
           VALUES ($1::uuid, 'MOCK-PAIR', $2::uuid, $3::uuid)""", str(uuid4()), paper_id, str(uuid4()))
    runner = pg_runner(schema)
    loaded = runner.load(sync.load_sql("reading", data["tests"][0]["test_id"], schema=schema))

    assert len(loaded["class_pins"]) == 1 and loaded["mocks"][0]["code"] == "MOCK-PAIR"
    with pytest.raises(sync.SyncRefused) as caught:
        sync.build_plan(loaded, expected_rows={"test": {"id": paper_id}, "table": "reading_questions",
                                               "rows": []}, expected_rows_sha256="sha")
    assert any("MOCK-PAIR" in r for r in caught.value.reasons)
    assert any("bài giao" in r for r in caught.value.reasons)
