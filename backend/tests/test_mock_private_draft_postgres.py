"""Run the real private-draft transaction and admission guards on disposable PG."""
import asyncio
import json
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg
import pytest

from test_mock_paper_policy_postgres import DB, _policy_probe, access, paper, query, room

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"


@pytest.fixture
def private_probe():
    for schema in _policy_probe(active=True):
        query(f"""
            ALTER TABLE {schema}.mock_exams ADD CONSTRAINT fixture_mock_code UNIQUE(code);
            ALTER TABLE {schema}.web_explanation_objects
                ADD COLUMN skill text, ADD COLUMN source_test_key text,
                ADD COLUMN book_number int, ADD COLUMN test_number int,
                ADD COLUMN source_hash text, ADD COLUMN audit_verdict text,
                ADD COLUMN rights_status text, ADD COLUMN editorial_status text,
                ADD COLUMN serving_status text, ADD COLUMN binding_status text DEFAULT 'BOUND';
            CREATE UNIQUE INDEX ON {schema}.web_explanation_objects(object_id,content_version);
            CREATE UNIQUE INDEX ON {schema}.web_explanation_objects(object_id) WHERE is_current;
        """)
        # Use the real approval gate rather than the legacy fixture's approval stub.
        approval = (MIGRATIONS / "260_approve_web_explanation_paper.sql").read_text()
        approval = approval.split("CREATE OR REPLACE FUNCTION fn_approve_web_explanation_paper", 1)[1].split(
            "-- Replace migration 259", 1)[0]
        approval = "CREATE OR REPLACE FUNCTION public.fn_approve_web_explanation_paper" + approval
        approval = approval.replace("ON FUNCTION fn_approve_web_explanation_paper", "ON FUNCTION public.fn_approve_web_explanation_paper")
        query(approval.replace("public.", schema + ".").replace("search_path = public,", "search_path = " + schema + ","))
        migration = (MIGRATIONS / "315_mock_exam_private_draft_copies.sql").read_text()
        migration = migration.replace("public.", schema + ".").replace("search_path=public,", "search_path=" + schema + ",")
        query(migration)
        query(migration)  # safe forward re-application
        followup = (MIGRATIONS / "316_mock_draft_shared_resume_and_package_guard.sql").read_text()
        followup = followup.replace("public.", schema + ".").replace("search_path=public,", "search_path=" + schema + ",")
        query(followup)
        query(followup)
        yield schema


def source_bundle(schema, skill, public=True, explanations=False):
    source = paper(schema, skill, public=public)
    if skill == "reading":
        child = query(f"INSERT INTO {schema}.reading_passages(test_id,body_markdown,title,slug,passage_order) VALUES($1,'Source passage','Source title',$2,1) RETURNING id", source, uuid4().hex)[0]["id"]
        query(f"INSERT INTO {schema}.reading_questions(passage_id,q_num,prompt,answer,payload) SELECT $1,n,'Question '||n,'[\"answer\"]',jsonb_build_object('q_num',n,'evidence','original') FROM generate_series(1,40) n", child)
    else:
        child = query(f"INSERT INTO {schema}.listening_content(test_id,section_num,title,transcript) VALUES($1,1,'Source section','Source transcript') RETURNING id", source)[0]["id"]
        query(f"INSERT INTO {schema}.listening_exercises(content_id,exercise_type,payload,order_num) VALUES($1,'completion',jsonb_build_object('answers',(SELECT jsonb_agg(jsonb_build_object('q_num',n,'answer','answer')) FROM generate_series(1,40) n),'audio','source-section.mp3'),1)", child)
    if explanations:
        query(f"""INSERT INTO {schema}.web_explanation_objects(object_id,skill,source_test_key,
            {skill}_test_id,question_number,content_version,payload,rights_status,editorial_status,serving_status,source_hash)
            SELECT 'cambridge-21-test-1-'||$2||'-q'||lpad(n::text,2,'0'),$2,'cambridge-21-test-1',
                $1,n,'version-1',jsonb_build_object('q_num',n,'evidence','source explanation'),
                'PENDING','PENDING','ELIGIBLE_AFTER_GLOBAL_RELEASE_GATES','source-hash-'||n
            FROM generate_series(1,40) n""", source, skill)
    return source


def create(schema, **fields):
    payload = {"code": uuid4().hex, "title": "Private draft", "private_content_copy": True, **fields}
    result = query(f"SELECT {schema}.fn_create_mock_exam_with_paper_policy($1,$2) receipt", json.dumps(payload), uuid4())
    return json.loads(result[0]["receipt"])


def children(schema, skill, source):
    if skill == "reading":
        parents = query(f"SELECT to_jsonb(p)-ARRAY['id','test_id','slug'] data FROM {schema}.reading_passages p WHERE test_id=$1 ORDER BY passage_order", source)
        items = query(f"SELECT to_jsonb(q)-ARRAY['id','passage_id'] data FROM {schema}.reading_questions q JOIN {schema}.reading_passages p ON p.id=q.passage_id WHERE p.test_id=$1 ORDER BY q_num", source)
    else:
        parents = query(f"SELECT to_jsonb(c)-ARRAY['id','test_id'] data FROM {schema}.listening_content c WHERE test_id=$1 ORDER BY section_num", source)
        items = query(f"SELECT to_jsonb(e)-ARRAY['id','content_id'] data FROM {schema}.listening_exercises e JOIN {schema}.listening_content c ON c.id=e.content_id WHERE c.test_id=$1 ORDER BY order_num", source)
    return parents, items


@pytest.mark.parametrize("hide_source", [False, True])
def test_private_create_preserves_live_practice_and_copies_exact_content(private_probe, hide_source):
    s = private_probe
    sources = {skill: source_bundle(s, skill) for skill in ("reading", "listening")}
    owner = uuid4()
    before = {}
    attempts = {}
    for skill, source in sources.items():
        attempts[skill] = query(f"INSERT INTO {s}.{skill}_test_attempts(test_id,user_id,attempt_purpose,answers) VALUES($1,$2,'practice','[{{\"q_num\":1,\"user_answer\":\"saved\"}}]') RETURNING id", source, owner)[0]["id"]
        if hide_source:
            query(f"SELECT {s}.fn_mutate_mock_paper_policy($1,$2,'{{\"is_public\":false}}',NULL,NULL,NULL,NULL)", skill, source)
        before[skill] = query(f"SELECT * FROM {s}.{skill}_tests WHERE id=$1", source)
    snapshots = query(f"SELECT * FROM {s}.mock_paper_attempt_snapshots ORDER BY skill,attempt_id")
    saved = {skill: query(f"SELECT * FROM {s}.{skill}_test_attempts WHERE id=$1", attempt) for skill, attempt in attempts.items()}
    result = create(s, reading_test_id=str(sources["reading"]), listening_test_id=str(sources["listening"]),
                    reading_is_public=True, listening_is_public=True, writing_minutes=75, total_minutes=165)
    assert result["status"] == "draft" and result["is_open"] is False
    assert result["web_explanation_mode"] == "disabled"
    assert result["writing_minutes"] == 75 and result["total_minutes"] == 165
    for skill, source in sources.items():
        copy_id = result[skill + "_test_id"]
        assert copy_id != str(source)
        observed = query(f"SELECT * FROM {s}.{skill}_tests WHERE id=$1", UUID(copy_id))[0]
        assert observed["status"] == "published" and observed["exam_only"] is True
        assert observed["is_public"] is False and observed["public_practice_enabled"] is False
        assert observed["approved_public_overlap"] is None
        assert children(s, skill, source) == children(s, skill, UUID(copy_id))
        if skill == "listening":
            assert observed["full_audio_storage_path"] == before[skill][0]["full_audio_storage_path"]
            assert observed["full_audio_duration_seconds"] == before[skill][0]["full_audio_duration_seconds"]
        source_after = query(f"SELECT * FROM {s}.{skill}_tests WHERE id=$1", source)[0]
        assert source_after["is_public"] is False
        assert source_after["policy_revision"] == before[skill][0]["policy_revision"] + (0 if hide_source else 1)
        assert {k: v for k, v in source_after.items() if k not in {"is_public", "policy_revision", "updated_at"}} == {
            k: v for k, v in before[skill][0].items() if k not in {"is_public", "policy_revision", "updated_at"}}
        assert query(f"SELECT * FROM {s}.{skill}_test_attempts WHERE id=$1", attempts[skill]) == saved[skill]
        assert access(s, skill, source, owner, "delivery")["allowed"] is True
        assert access(s, skill, source, owner, "practice", admit=True)["allowed"] is False
        assert access(s, skill, UUID(copy_id), owner, "practice", admit=True)["allowed"] is False
    assert query(f"SELECT * FROM {s}.mock_paper_attempt_snapshots ORDER BY skill,attempt_id") == snapshots


@pytest.mark.parametrize("failure", ["missing_source", "missing_explanations", "blocked_explanation", "duplicate_code"])
def test_failed_private_create_rolls_back_every_copy_and_draft(private_probe, failure):
    s = private_probe
    listening = source_bundle(s, "listening", explanations=failure == "blocked_explanation")
    reading = source_bundle(s, "reading")
    code = uuid4().hex
    payload = {"listening_test_id": str(listening), "reading_test_id": str(reading), "code": code}
    if failure == "missing_source":
        payload["reading_test_id"] = str(uuid4())
        expected = "mock_copy_source_not_published"
    elif failure in {"missing_explanations", "blocked_explanation"}:
        payload["web_explanation_mode"] = "with_result"
        expected = "web_explanation_content_version_unavailable"
        if failure == "blocked_explanation":
            query(f"UPDATE {s}.web_explanation_objects SET serving_status='BLOCKED' WHERE listening_test_id=$1", listening)
            expected = "web_explanation_serving_blocked"
    else:
        create(s, code=code)
        expected = "fixture_mock_code"
    tables = ("mock_exams", "reading_tests", "listening_tests", "reading_passages", "reading_questions",
              "listening_content", "listening_exercises", "web_explanation_objects", "mock_correction_release_events")
    before = {table: query(f"SELECT * FROM {s}.{table} ORDER BY id") for table in tables}
    with pytest.raises(asyncpg.PostgresError, match=expected):
        create(s, **payload)
    assert {table: query(f"SELECT * FROM {s}.{table} ORDER BY id") for table in tables} == before


def test_explanation_copy_keeps_source_approval_and_survives_global_import(private_probe):
    s = private_probe
    source = source_bundle(s, "reading", explanations=True)
    before = query(f"SELECT * FROM {s}.web_explanation_objects WHERE reading_test_id=$1 ORDER BY question_number", source)
    result = create(s, reading_test_id=str(source), web_explanation_mode="with_result")
    assert result["web_explanation_content_version"] == "version-1"
    copies = query(f"SELECT * FROM {s}.web_explanation_objects WHERE reading_test_id=$1 ORDER BY question_number", UUID(result["reading_test_id"]))
    assert len(copies) == 40
    for original, copy in zip(before, copies):
        assert copy["object_id"] == f"mock-{result['reading_test_id']}-reading-q{copy['question_number']:02d}"
        assert copy["payload"] == original["payload"] and copy["source_hash"] == original["source_hash"]
        assert copy["rights_status"] == copy["editorial_status"] == "APPROVED"
    assert query(f"SELECT * FROM {s}.web_explanation_objects WHERE reading_test_id=$1 ORDER BY question_number", source) == before
    query(f"SELECT {s}.fn_activate_web_explanation_version('version-1',40)")
    assert query(f"SELECT * FROM {s}.web_explanation_objects WHERE reading_test_id=$1 ORDER BY question_number", UUID(result["reading_test_id"])) == copies
    query(f"INSERT INTO {s}.web_explanation_objects SELECT r.* FROM {s}.web_explanation_objects o CROSS JOIN LATERAL jsonb_populate_record(NULL::{s}.web_explanation_objects,to_jsonb(o)||jsonb_build_object('id',gen_random_uuid(),'content_version','version-2','is_current',false)) r WHERE o.reading_test_id=$1", source)
    query(f"SELECT {s}.fn_activate_web_explanation_version('version-2',40)")
    assert query(f"SELECT * FROM {s}.web_explanation_objects WHERE reading_test_id=$1 ORDER BY question_number", UUID(result["reading_test_id"])) == copies


@pytest.mark.parametrize("skill", ["reading", "listening"])
def test_hidden_shared_source_retains_only_existing_owner_resume(private_probe, skill):
    s = private_probe
    source = source_bundle(s, skill, public=False)
    room(s, source, skill)  # an independently protected mock already uses this source
    owner, actor = uuid4(), uuid4()
    info = json.loads(query(f"SELECT {s}.fn_inspect_mock_paper_policy($1,$2) receipt", skill, source)[0]["receipt"])
    overlap = {"reason": "Approved source practice overlap", "paper_revision": info["paper_revision"],
               "references": info["protected_references"]}
    query(f"SELECT {s}.fn_mutate_mock_paper_policy($1,$2,'{{\"is_public\":true}}',$3,0,$4,NULL)",
          skill, source, actor, json.dumps(overlap))
    attempt = query(f"INSERT INTO {s}.{skill}_test_attempts(test_id,user_id,attempt_purpose,answers) "
                    "VALUES($1,$2,'practice','[{\"q_num\":1,\"user_answer\":\"saved\"}]') RETURNING id", source, owner)[0]["id"]
    before = query(f"SELECT * FROM {s}.{skill}_test_attempts WHERE id=$1", attempt)
    snapshot = query(f"SELECT * FROM {s}.mock_paper_attempt_snapshots WHERE skill=$1 AND attempt_id=$2", skill, attempt)
    draft = create(s, **{skill + "_test_id": str(source)})
    assert draft[skill + "_test_id"] != str(source)
    assert query(f"SELECT is_public FROM {s}.{skill}_tests WHERE id=$1", source)[0]["is_public"] is False
    assert access(s, skill, source, owner, "delivery")["allowed"] is True
    assert access(s, skill, source, uuid4(), "delivery")["allowed"] is False
    assert access(s, skill, source, None, "delivery")["allowed"] is False
    assert access(s, skill, source, owner, "delivery", admit=True)["allowed"] is False
    assert access(s, skill, source, owner, "practice", admit=True)["allowed"] is False
    assert query(f"SELECT * FROM {s}.{skill}_test_attempts WHERE id=$1", attempt) == before
    assert query(f"SELECT * FROM {s}.mock_paper_attempt_snapshots WHERE skill=$1 AND attempt_id=$2", skill, attempt) == snapshot


def test_package_rejection_rolls_back_draft_and_other_selected_copy(private_probe):
    s = private_probe
    reading = source_bundle(s, "reading", public=True)
    listening = source_bundle(s, "listening", public=True)
    query(f"ALTER TABLE {s}.listening_tests ADD COLUMN content_package_id uuid")
    # Preserve normal immutability guards: the fixture adds a package marker
    # before admission, then the real helper rejects it before any policy write.
    query(f"UPDATE {s}.listening_tests SET content_package_id=$1 WHERE id=$2", uuid4(), listening)
    tables = ("mock_exams", "reading_tests", "listening_tests", "reading_passages", "reading_questions",
              "listening_content", "listening_exercises", "mock_correction_release_events")
    before = {table: query(f"SELECT * FROM {s}.{table} ORDER BY id") for table in tables}
    with pytest.raises(asyncpg.PostgresError, match="mock_copy_source_package_unsupported:listening"):
        create(s, reading_test_id=str(reading), listening_test_id=str(listening))
    assert {table: query(f"SELECT * FROM {s}.{table} ORDER BY id") for table in tables} == before


@pytest.mark.parametrize("role", ["anon", "authenticated"])
def test_private_copy_commands_are_service_only(private_probe, role):
    s = private_probe
    for call in (f"{s}.fn_copy_mock_draft_paper('reading',gen_random_uuid(),gen_random_uuid(),NULL)",
                 f"{s}.fn_create_mock_exam_with_paper_policy('{{}}',NULL)"):
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            query(f"SET ROLE {role}; SELECT {call};")


def test_copy_waits_for_source_content_writer(private_probe):
    s = private_probe
    source = source_bundle(s, "reading")

    async def overlap():
        writer = await asyncpg.connect(DB)
        creator = await asyncpg.connect(DB)
        pending = None
        try:
            await writer.execute("BEGIN")
            await writer.execute(f"UPDATE {s}.reading_passages SET body_markdown='Committed revision' WHERE test_id=$1", source)
            payload = json.dumps({"code": uuid4().hex, "title": "Concurrent draft", "private_content_copy": True, "reading_test_id": str(source)})
            pending = asyncio.create_task(creator.fetchval(f"SELECT {s}.fn_create_mock_exam_with_paper_policy($1,NULL)", payload))
            await asyncio.sleep(0.1)
            assert not pending.done()
            await writer.execute("COMMIT")
            result = json.loads(await asyncio.wait_for(pending, 5))
            assert await creator.fetchval(f"SELECT body_markdown FROM {s}.reading_passages WHERE test_id=$1", UUID(result["reading_test_id"])) == "Committed revision"
        finally:
            if pending and not pending.done():
                pending.cancel()
            await writer.close()
            await creator.close()

    asyncio.run(overlap())
