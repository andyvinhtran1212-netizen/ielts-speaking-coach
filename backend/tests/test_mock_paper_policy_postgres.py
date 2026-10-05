"""Actual306 role/lifecycle/rollback/contention tests on LOCAL disposable PG."""
import asyncio
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from unittest.mock import patch
from uuid import UUID, uuid4

import asyncpg
import pytest

DB = os.environ.get("TEST_PG_URL", "")
SQL = (Path(__file__).resolve().parents[1] / "migrations/306_mock_paper_policy_and_admission.sql").read_text()
FLAGS_SQL = (Path(__file__).resolve().parents[1] / "migrations/307_mock_attempt_review_flags.sql").read_text()
ACTIVATION_SQL = (Path(__file__).resolve().parents[1] / "migrations/308_activate_mock_paper_admission.sql").read_text()
FINALIZE_SQL = (Path(__file__).resolve().parents[1] / "migrations/310_mock_attempt_submitted_finalization.sql").read_text()
VOID_SQL = (Path(__file__).resolve().parents[1] / "migrations/168_fn_void_sitting.sql").read_text()
PARENT_LIFECYCLE_SQL = (Path(__file__).resolve().parents[1] / "migrations/311_mock_submitted_parent_lifecycle.sql").read_text()


async def run(sql, *args):
    connection = await asyncpg.connect(DB)
    try:
        if not args and ";" in sql:
            await connection.execute(sql)
            return []
        return await connection.fetch(sql, *args)
    finally:
        await connection.close()


def query(sql, *args):
    return asyncio.run(run(sql, *args))


def _policy_probe(*, active):
    parsed = urlparse(DB)
    if parsed.scheme not in {"postgres", "postgresql"} or parsed.hostname not in {"localhost", "127.0.0.1", "::1"} or parsed.query:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("306 requires an explicitly LOCAL disposable PostgreSQL URL")
        pytest.skip("Local PostgreSQL unavailable")
    schema = "mock_policy_probe_" + uuid4().hex
    bootstrap = f"""
      CREATE SCHEMA {schema};
      GRANT USAGE ON SCHEMA {schema} TO anon,authenticated,service_role;
      CREATE TABLE {schema}.users(id uuid PRIMARY KEY);
      CREATE TABLE {schema}.students(id uuid PRIMARY KEY,user_id uuid);
      CREATE TABLE {schema}.reading_tests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),test_id text,title text,
        status text DEFAULT 'published',is_public boolean DEFAULT false,exam_only boolean DEFAULT true,
        public_practice_enabled boolean DEFAULT false,web_explanation_mode text DEFAULT 'disabled',
        web_explanation_content_version text,web_explanations_released_at timestamptz,web_explanations_released_by uuid,
        module text DEFAULT 'academic',time_limit_minutes int DEFAULT 60,passage_count int DEFAULT3,
        total_questions int DEFAULT40,metadata jsonb DEFAULT'{{}}',test_type text DEFAULT'full',updated_at timestamptz);
      CREATE TABLE {schema}.listening_tests(LIKE {schema}.reading_tests INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
        full_audio_storage_path text DEFAULT'local.mp3',assembled_audio_storage_path text,
        full_audio_duration_seconds numeric DEFAULT300,scoring_policy text DEFAULT'diagnostic');
      CREATE TABLE {schema}.reading_passages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),test_id uuid,
        passage_order int,library text DEFAULT'l3_test',body_markdown text,title text,slug text,metadata jsonb DEFAULT'{{}}');
      CREATE TABLE {schema}.reading_questions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),passage_id uuid,
        q_num int,question_type text DEFAULT'completion',prompt text,payload jsonb DEFAULT'{{}}',answer jsonb,
        explanation text,skill_tag text,order_num int);
      CREATE TABLE {schema}.listening_content(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),test_id uuid,
        section_num int,title text,transcript text,metadata jsonb DEFAULT'{{}}');
      CREATE TABLE {schema}.listening_exercises(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),content_id uuid,
        exercise_type text,payload jsonb DEFAULT'{{}}',order_num int);
      CREATE TABLE {schema}.web_explanation_objects(id uuid DEFAULT gen_random_uuid(),object_id text,
        reading_test_id uuid,listening_test_id uuid,question_number int,is_current boolean DEFAULT true,
        content_version text,payload jsonb DEFAULT'{{}}');
      CREATE TABLE {schema}.reading_test_attempts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),test_id uuid,user_id uuid,
        sitting_id uuid,class_assignment_item_id uuid,status text DEFAULT'in_progress',answers jsonb DEFAULT'[]',
        started_at timestamptz DEFAULT now(),resume_expires_at timestamptz DEFAULT(now()+interval'24 hours'),
        renderer_affinity text DEFAULT'legacy',score int,grading_details jsonb DEFAULT'[]',anon_id text,
        CONSTRAINT fixture_reading_ttl CHECK(resume_expires_at<=started_at+interval'24 hours'));
      CREATE TABLE {schema}.listening_test_attempts(LIKE {schema}.reading_test_attempts INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
        scoring_policy text DEFAULT'diagnostic',playback_started_at timestamptz);
      CREATE TABLE {schema}.reading_attempt_answers(attempt_id uuid,q_num int,user_answer text,PRIMARY KEY(attempt_id,q_num));
      CREATE TABLE {schema}.mock_exams(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text,title text,created_by uuid,
        status text DEFAULT'draft',reading_test_id uuid,listening_test_id uuid,exam_mode text DEFAULT'sequential',
        active_section text DEFAULT'not_started',collected_section text,is_open boolean DEFAULT true,
        reading_started_at timestamptz,listening_started_at timestamptz,reading_minutes int DEFAULT60,
        writing_minutes int DEFAULT60,writing_task1_prompt_id uuid,writing_task2_prompt_id uuid,
        speaking_topic_set jsonb DEFAULT'{{}}',total_minutes int DEFAULT150,open_from timestamptz,open_until timestamptz,
        cohort_id uuid,review_sla_days int DEFAULT3,post_test_capture_required boolean DEFAULT true,
        web_explanation_mode text DEFAULT'disabled',web_explanation_content_version text,
        web_explanations_released_at timestamptz,web_explanations_released_by uuid);
      CREATE TABLE {schema}.mock_exam_sittings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),mock_exam_id uuid,
        user_id uuid,status text DEFAULT'registered',assigned_skills text[],sealed boolean DEFAULT true,integrity jsonb DEFAULT'{{}}',
        reading_attempt_id uuid,listening_attempt_id uuid,reading_started_at timestamptz,listening_started_at timestamptz,
        reading_submitted_at timestamptz,listening_submitted_at timestamptz);
      CREATE TABLE {schema}.mock_exam_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),exam_id uuid,user_id uuid,
        skills text[],open_from timestamptz,open_until timestamptz);
      CREATE TABLE {schema}.class_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),skill text,content_id uuid,
        title text,status text DEFAULT'published',publish_at timestamptz,due_at timestamptz,content_config jsonb DEFAULT'{{}}');
      CREATE TABLE {schema}.class_assignment_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),assignment_id uuid,student_id uuid);
      CREATE TABLE {schema}.mock_correction_release_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),scope_type text,
        scope_id text,action text,previous_state jsonb,new_state jsonb,actor_id uuid,reason text,created_at timestamptz DEFAULT now());
      CREATE FUNCTION {schema}.fn_approve_web_explanation_paper(text,uuid,uuid,text,text) RETURNS jsonb
        LANGUAGE plpgsql AS $$ BEGIN IF $4='reject' THEN RAISE EXCEPTION 'fixture_approval_rejected'; END IF;
        RETURN jsonb_build_object('content_version',COALESCE($4,'fixture-v1')); END $$;
    """
    # PostgreSQL keywords must be separated from numeric defaults.
    bootstrap = bootstrap.replace("DEFAULT3", "DEFAULT 3").replace("DEFAULT40", "DEFAULT 40").replace("DEFAULT300", "DEFAULT 300").replace("DEFAULT60", "DEFAULT 60").replace("DEFAULT150", "DEFAULT 150")
    query("DO $$ BEGIN IF NOT EXISTS(SELECT1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; IF NOT EXISTS(SELECT1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF; END $$".replace("SELECT1","SELECT 1"))
    migrated = SQL.replace("public.", schema + ".").replace("search_path=public,", "search_path=" + schema + ",").replace("search_path = public,", "search_path = " + schema + ",").replace("ns.nspname='public'", "ns.nspname='" + schema + "'")
    migrated_flags = FLAGS_SQL.replace("public.", schema + ".").replace("search_path = public,", "search_path = " + schema + ",")
    try:
        query(bootstrap)
        void_sql = VOID_SQL.replace('CREATE OR REPLACE FUNCTION fn_void_sitting(', 'CREATE OR REPLACE FUNCTION public.fn_void_sitting(').replace('COMMENT ON FUNCTION fn_void_sitting(', 'COMMENT ON FUNCTION public.fn_void_sitting(')
        query(void_sql.replace('public.', schema + '.').replace('search_path = public,', 'search_path = ' + schema + ','))
        query(migrated)
        query(migrated)  # idempotent forward application, no hidden baseline DML
        query(migrated_flags)
        query(FINALIZE_SQL.replace('public.', schema + '.').replace('search_path=public,', 'search_path=' + schema + ','))
        query(PARENT_LIFECYCLE_SQL.replace('public.', schema + '.').replace('search_path=public,', 'search_path=' + schema + ','))
        if active:
            activate(schema)
        yield schema
    finally:
        query(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


def activate(schema):
    migration = ACTIVATION_SQL.replace('public.', schema + '.').replace('search_path=public,', 'search_path=' + schema + ',')
    query("SELECT set_config('mock_paper.deployed_backend_sha','" + 'a'*40 + "',false);" + migration)


@pytest.fixture(scope='module')
def policy_probe():
    yield from _policy_probe(active=True)


@pytest.fixture
def rollout_probe():
    yield from _policy_probe(active=False)


def paper(schema, skill="reading", public=False):
    return query(f"INSERT INTO {schema}.{skill}_tests(is_public,test_id) VALUES($1,$2) RETURNING id", public, uuid4().hex)[0]["id"]


def room(schema, paper_id, skill="reading", active=False, mode="sequential"):
    return query(f"INSERT INTO {schema}.mock_exams({skill}_test_id,status,active_section,exam_mode,{skill}_started_at) VALUES($1,$2,$3,$4,now()) RETURNING id", paper_id, "published" if active else "draft", skill if active else "not_started", mode)[0]["id"]


def access(schema, skill, paper_id, user=None, purpose="practice", sitting=None, admit=False):
    return json.loads(query(f"SELECT {schema}.fn_resolve_mock_paper_access($1,$2,$3,$4,NULL,$5,$6) receipt", skill, paper_id, user, purpose, sitting, admit)[0]["receipt"])


def test_planned_future_public_and_old_token_fail_closed(policy_probe):
    s=policy_probe; p=paper(s); m=room(s,p)
    query(f"ALTER TABLE {s}.reading_tests DISABLE TRIGGER trg_mock_paper_policy;")
    query(f"UPDATE {s}.reading_tests SET is_public=true WHERE id=$1",p)
    query(f"ALTER TABLE {s}.reading_tests ENABLE TRIGGER trg_mock_paper_policy;")
    assert access(s,"reading",p)["allowed"] is False
    assert query(f"SELECT id FROM {s}.reading_public_practice_catalog WHERE id=$1",p)==[]
    with pytest.raises(asyncpg.RaiseError,match="protected_dependency"):
        query(f"UPDATE {s}.reading_tests SET status='draft' WHERE id=$1",p)


def test_bound_admission_preserves_closed_entry_and_denies_dictation(policy_probe):
    s=policy_probe; p=paper(s,"listening"); m=room(s,p,"listening",True); u=uuid4()
    sid=query(f"INSERT INTO {s}.mock_exam_sittings(mock_exam_id,user_id) VALUES($1,$2) RETURNING id",m,u)[0]["id"]
    assert access(s,"listening",p,u,"delivery",sid)["reason"]=="admission_required"
    sql=f"SELECT {s}.fn_admit_mock_paper_attempt('listening',$1,$2,$3,'claim-v1') receipt"
    first=json.loads(query(sql,p,u,sid)[0]["receipt"])
    assert first["mock_sitting_id"]==str(sid)
    query(f"UPDATE {s}.mock_exams SET is_open=false WHERE id=$1",m)
    retry=json.loads(query(sql,p,u,sid)[0]["receipt"])
    assert first["attempt_id"]==retry["attempt_id"] and retry["acquired_existing"] is True
    assert access(s,"listening",p,u,"delivery",sid)["allowed"] is True
    assert access(s,"listening",p,u,"dictation")["allowed"] is False
    with pytest.raises(asyncpg.RaiseError,match="mock_binding_required"):
        query(f"INSERT INTO {s}.listening_test_attempts(test_id,user_id,attempt_purpose) VALUES($1,$2,'practice')",p,u)


def test_historical_done_depends_on_actual_unfinished_rights(policy_probe):
    s=policy_probe; p=paper(s); m=room(s,p,active=True)
    query(f"UPDATE {s}.mock_exams SET active_section='done' WHERE id=$1",m)
    query(f"UPDATE {s}.reading_tests SET status='draft' WHERE id=$1",p)
    p2=paper(s); m2=room(s,p2,active=True,mode="retake")
    query(f"INSERT INTO {s}.mock_exam_assignments(exam_id,user_id,skills,open_from) VALUES($1,$2,ARRAY['reading'],now()+interval'1 day')",m2,uuid4())
    with pytest.raises(asyncpg.RaiseError,match="protected_dependency"):
        query(f"UPDATE {s}.reading_tests SET status='draft' WHERE id=$1",p2)


def test_hide_is_exact_and_restore_is_complete_cas(policy_probe):
    s=policy_probe; p=paper(s,public=True)
    query(f"SELECT {s}.fn_mutate_mock_paper_policy('reading',$1,'{{\"is_public\":false}}',NULL,0,NULL,NULL)",p)
    row=query(f"SELECT * FROM {s}.reading_tests WHERE id=$1",p)[0]
    assert row["is_public"] is False and row["exam_only"] is True and row["policy_revision"]==1
    event=query(f"SELECT id,previous_state FROM {s}.mock_correction_release_events WHERE scope_id=$1 AND action='mock_paper_policy_updated'",str(p))[0]
    assert json.loads(event["previous_state"])["web_explanations_released_by"] is None
    with pytest.raises(asyncpg.RaiseError,match="stale_revision"):
        query(f"SELECT {s}.fn_mutate_mock_paper_policy('reading',$1,'{{}}',NULL,0,NULL,$2)",p,event["id"])
    query(f"SELECT {s}.fn_mutate_mock_paper_policy('reading',$1,'{{}}',NULL,1,NULL,$2)",p,event["id"])
    assert query(f"SELECT is_public FROM {s}.reading_tests WHERE id=$1",p)[0]["is_public"] is True


def test_private_snapshot_survives_source_edit_and_client_select_denied(policy_probe):
    s=policy_probe; p=paper(s,public=True); u=uuid4()
    source=query(f"INSERT INTO {s}.reading_passages(test_id,passage_order,body_markdown) VALUES($1,1,'original passage') RETURNING id",p)[0]["id"]
    qid=query(f"INSERT INTO {s}.reading_questions(passage_id,q_num,prompt,answer) VALUES($1,1,'original prompt','{{\"value\":\"A\"}}') RETURNING id",source)[0]["id"]
    aid=query(f"INSERT INTO {s}.reading_test_attempts(test_id,user_id,attempt_purpose) VALUES($1,$2,'practice') RETURNING id",p,u)[0]["id"]
    query(f"UPDATE {s}.reading_questions SET prompt='changed',answer='{{\"value\":\"B\"}}' WHERE id=$1",qid)
    snap=query(f"SELECT marking_rows,source_rows FROM {s}.mock_paper_attempt_snapshots WHERE attempt_id=$1",aid)[0]
    assert json.loads(snap["marking_rows"])[0]["prompt"]=="original prompt"
    assert json.loads(snap["marking_rows"])[0]["answer"]["value"]=="A"
    assert json.loads(snap["source_rows"])[0]["body_markdown"]=="original passage"
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        query(f"SET ROLE authenticated; SELECT * FROM {s}.mock_paper_attempt_snapshots")
    with pytest.raises(asyncpg.RaiseError,match="immutable_mock_paper_snapshot"):
        query(f"UPDATE {s}.mock_paper_attempt_snapshots SET marking_rows='[]' WHERE attempt_id=$1",aid)
    assert query(f"SELECT has_column_privilege('authenticated','{s}.reading_test_attempts','id','SELECT') allowed")[0]["allowed"] is True
    assert query(f"SELECT has_column_privilege('authenticated','{s}.reading_test_attempts','grading_details','SELECT') allowed")[0]["allowed"] is False
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        query(f"SET ROLE authenticated; SELECT * FROM {s}.reading_test_attempts")
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        query(f"SET ROLE authenticated; UPDATE {s}.reading_test_attempts SET score=40 WHERE id='{aid}'")


def test_new_reference_vs_depublish_is_serialized(policy_probe):
    s=policy_probe; p=paper(s)
    async def overlap():
        first=await asyncpg.connect(DB); second=await asyncpg.connect(DB)
        tx=first.transaction(); await tx.start(); pending=None
        try:
            await first.execute(f"UPDATE {s}.reading_tests SET status='draft' WHERE id=$1",p)
            pending=asyncio.create_task(second.execute(f"INSERT INTO {s}.mock_exams(reading_test_id) VALUES($1)",p))
            await asyncio.sleep(.1)
            assert not pending.done()
            await tx.commit()
            with pytest.raises(asyncpg.RaiseError,match="paper_not_ready"): await pending
            assert await first.fetchval(f"SELECT count(*) FROM {s}.mock_exams WHERE reading_test_id=$1",p)==0
        finally:
            if pending is not None and not pending.done(): pending.cancel()
            await first.close(); await second.close()
    asyncio.run(overlap())


def test_all_reference_overlap_is_explicit_and_revision_bound(policy_probe):
    s=policy_probe; p=paper(s); room(s,p); room(s,p); actor=uuid4()
    info=json.loads(query(f"SELECT {s}.fn_inspect_mock_paper_policy('reading',$1) receipt",p)[0]["receipt"])
    overlap={"reason":"Reviewed public assessment overlap","paper_revision":info["paper_revision"],"references":info["protected_references"]}
    assert len(overlap["references"])==2
    partial={**overlap,"references":overlap["references"][:1]}
    with pytest.raises(asyncpg.RaiseError,match="stale_revision"):
        query(f"SELECT {s}.fn_mutate_mock_paper_policy('reading',$1,'{{\"is_public\":true}}',$2,0,$3,NULL)",p,actor,json.dumps(partial))
    query(f"SELECT {s}.fn_mutate_mock_paper_policy('reading',$1,'{{\"is_public\":true}}',$2,0,$3,NULL)",p,actor,json.dumps(overlap))
    assert access(s,"reading",p)["allowed"] is True
    query(f"UPDATE {s}.reading_tests SET title='new source revision' WHERE id=$1",p)
    assert access(s,"reading",p)["allowed"] is False
    assert query(f"SELECT id FROM {s}.reading_public_practice_catalog WHERE id=$1",p)==[]


def test_hide_preserves_existing_work_and_reverse_link_is_blocked(policy_probe):
    s=policy_probe; p=paper(s,public=True); owner=uuid4()
    query(f"INSERT INTO {s}.reading_test_attempts(test_id,user_id,attempt_purpose) VALUES($1,$2,'practice')",p,owner)
    query(f"SELECT {s}.fn_mutate_mock_paper_policy('reading',$1,'{{\"is_public\":false}}',NULL,0,NULL,NULL)",p)
    assert access(s,"reading",p,owner,"delivery")["allowed"] is True
    assert access(s,"reading",p,owner,"practice",admit=True)["allowed"] is False
    with pytest.raises(asyncpg.RaiseError,match="valid_resume"):
        room(s,p)


def test_mock_create_visibility_and_approval_are_one_transaction(policy_probe):
    s=policy_probe; p=paper(s,public=True); actor=uuid4()
    payload={"code":uuid4().hex,"title":"atomic draft","reading_test_id":str(p),
             "reading_is_public":False,"web_explanation_mode":"with_result","web_explanation_content_version":"reject"}
    with pytest.raises(asyncpg.RaiseError,match="fixture_approval_rejected"):
        query(f"SELECT {s}.fn_create_mock_exam_with_paper_policy($1,$2)",json.dumps(payload),actor)
    row=query(f"SELECT is_public,exam_only,policy_revision FROM {s}.reading_tests WHERE id=$1",p)[0]
    assert row["is_public"] is True and row["exam_only"] is True and row["policy_revision"]==0
    assert query(f"SELECT id FROM {s}.mock_exams WHERE code=$1",payload["code"])==[]
    payload["web_explanation_content_version"]="fixture-v1"
    receipt=json.loads(query(f"SELECT {s}.fn_create_mock_exam_with_paper_policy($1,$2) receipt",json.dumps(payload),actor)[0]["receipt"])
    assert receipt["reading_test_id"]==str(p)
    row=query(f"SELECT is_public,exam_only,policy_revision FROM {s}.reading_tests WHERE id=$1",p)[0]
    assert row["is_public"] is False and row["exam_only"] is True and row["policy_revision"]==1


def test_atomic_admission_rolls_back_pointer_on_snapshot_failure(policy_probe):
    s=policy_probe; p=paper(s); m=room(s,p,active=True); owner=uuid4()
    sid=query(f"INSERT INTO {s}.mock_exam_sittings(mock_exam_id,user_id) VALUES($1,$2) RETURNING id",m,owner)[0]["id"]
    query(f"CREATE FUNCTION {s}.reject_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'snapshot_fixture_failed'; END $$; CREATE TRIGGER reject_snapshot BEFORE INSERT ON {s}.mock_paper_attempt_snapshots FOR EACH ROW EXECUTE FUNCTION {s}.reject_snapshot();")
    try:
        with pytest.raises(asyncpg.RaiseError,match="snapshot_fixture_failed"):
            query(f"SELECT {s}.fn_admit_mock_paper_attempt('reading',$1,$2,$3,'legacy')",p,owner,sid)
        assert query(f"SELECT reading_attempt_id FROM {s}.mock_exam_sittings WHERE id=$1",sid)[0]["reading_attempt_id"] is None
        assert query(f"SELECT id FROM {s}.reading_test_attempts WHERE test_id=$1",p)==[]
    finally:
        query(f"DROP TRIGGER reject_snapshot ON {s}.mock_paper_attempt_snapshots; DROP FUNCTION {s}.reject_snapshot();")


def test_admission_parent_contention_is_typed_retry(policy_probe):
    s=policy_probe; p=paper(s); m=room(s,p,active=True); owner=uuid4()
    sid=query(f"INSERT INTO {s}.mock_exam_sittings(mock_exam_id,user_id) VALUES($1,$2) RETURNING id",m,owner)[0]["id"]
    async def contention():
        first=await asyncpg.connect(DB); second=await asyncpg.connect(DB)
        tx=first.transaction(); await tx.start()
        try:
            await first.execute(f"SELECT id FROM {s}.mock_exam_sittings WHERE id=$1 FOR UPDATE",sid)
            with pytest.raises(asyncpg.RaiseError,match="verification_unavailable"):
                await second.fetchval(f"SELECT {s}.fn_admit_mock_paper_attempt('reading',$1,$2,$3,'legacy')",p,owner,sid)
        finally:
            await tx.rollback(); await first.close(); await second.close()
    asyncio.run(contention())


def test_server_collection_can_finalize_after_parent_claim(policy_probe):
    s=policy_probe; p=paper(s); m=room(s,p,active=True); owner=uuid4()
    sid=query(f"INSERT INTO {s}.mock_exam_sittings(mock_exam_id,user_id) VALUES($1,$2) RETURNING id",m,owner)[0]["id"]
    receipt=json.loads(query(f"SELECT {s}.fn_admit_mock_paper_attempt('reading',$1,$2,$3,'legacy') receipt",p,owner,sid)[0]["receipt"])
    query(f"UPDATE {s}.mock_exam_sittings SET reading_submitted_at=now() WHERE id=$1",sid)
    query(f"UPDATE {s}.mock_exams SET collected_section='reading' WHERE id=$1",m)
    query(f"UPDATE {s}.reading_test_attempts SET status='submitted',score=0 WHERE id=$1",UUID(receipt["attempt_id"]))
    assert query(f"SELECT status FROM {s}.reading_test_attempts WHERE id=$1",UUID(receipt["attempt_id"]))[0]["status"]=='submitted'


def _admitted_retake(schema, skill):
    p=paper(schema,skill); owner=uuid4(); m=room(schema,p,skill,True,'retake')
    sid=query(f"INSERT INTO {schema}.mock_exam_sittings(mock_exam_id,user_id,assigned_skills,{skill}_started_at) VALUES($1,$2,ARRAY[$3],now()) RETURNING id",m,owner,skill)[0]['id']
    admitted=json.loads(query(f"SELECT {schema}.fn_admit_mock_paper_attempt($1,$2,$3,$4,'legacy') receipt",skill,p,owner,sid)[0]['receipt'])
    return p,m,sid,UUID(admitted['attempt_id'])


@pytest.mark.parametrize('skill',['reading','listening'])
@pytest.mark.parametrize('boundary',['expired_clock','claimed_stamp'])
@pytest.mark.parametrize('sitting_status',['registered','lrw_in_progress'])
def test_finalized_answers_survive_section_finish_boundary(policy_probe,skill,boundary,sitting_status):
    s=policy_probe; _,m,sid,aid=_admitted_retake(s,skill)
    query(f"UPDATE {s}.mock_exam_sittings SET status=$2 WHERE id=$1",sid,sitting_status)
    answers=json.dumps([{'q_num':3,'user_answer':'hairs'}])
    if skill=='reading':
        query(f"INSERT INTO {s}.reading_attempt_answers(attempt_id,q_num,user_answer) VALUES($1,3,'hairs')",aid)
    if boundary=='expired_clock':
        query(f"UPDATE {s}.mock_exam_sittings SET {skill}_started_at=now()-interval'10 minutes' WHERE id=$1",sid)
        query(f"UPDATE {s}.mock_exams SET reading_minutes=1 WHERE id=$1",m)
    else:
        query(f"UPDATE {s}.mock_exam_sittings SET {skill}_submitted_at=now() WHERE id=$1",sid)
    # The older zero-score collection test left answers unchanged, so it did
    # not exercise the authoritative saved-answer write during finalization.
    command=f"UPDATE {s}.{skill}_test_attempts SET status='submitted',answers=$2::jsonb,score=1,grading_details='[{{\"q_num\":3,\"correct\":true}}]' WHERE id=$1"
    query(command,aid,answers)
    first=dict(query(f"SELECT * FROM {s}.{skill}_test_attempts WHERE id=$1",aid)[0])
    assert first['status']=='submitted' and first['score']==1
    assert json.loads(first['answers'])==json.loads(answers)
    query(command,aid,answers)  # exact retry is idempotent
    assert dict(query(f"SELECT * FROM {s}.{skill}_test_attempts WHERE id=$1",aid)[0])==first


@pytest.mark.parametrize('skill',['reading','listening'])
@pytest.mark.parametrize('parent_change',['void','unpublished'])
def test_finalize_rechecks_parent_lifecycle_after_router_guard(policy_probe,skill,parent_change):
    s=policy_probe; _,m,sid,aid=_admitted_retake(s,skill)

    async def concurrent_parent_change():
        submitter=await asyncpg.connect(DB); operator=await asyncpg.connect(DB)
        try:
            # The HTTP request's authorization completed before the admin write.
            # Independent autocommit connections reproduce that precise gap.
            parent=await submitter.fetchval(f"SELECT to_jsonb(a) FROM {s}.{skill}_test_attempts a WHERE id=$1",aid)
            decision=await submitter.fetchval(f"SELECT {s}.fn_guard_owned_mock_attempt($1,$2::jsonb,'submit')",skill,parent)
            assert json.loads(decision)['allowed'] is True
            if parent_change=='void':
                cancelled=await operator.fetchval(f"SELECT {s}.fn_void_sitting($1,'admin','cancel concurrent submission')",sid)
                assert json.loads(cancelled)['status']=='void'
            else:
                await operator.execute(f"UPDATE {s}.mock_exams SET status='draft' WHERE id=$1",m)
            with pytest.raises(asyncpg.RaiseError,match='invalid_resume') as rejected:
                await submitter.execute(f"UPDATE {s}.{skill}_test_attempts SET status='submitted',answers='[{{\"q_num\":3,\"user_answer\":\"hairs\"}}]',score=1 WHERE id=$1",aid)
            assert 'submit' in str(rejected.value)
        finally:
            await submitter.close(); await operator.close()

    asyncio.run(concurrent_parent_change())
    stored=query(f"SELECT status,answers,score FROM {s}.{skill}_test_attempts WHERE id=$1",aid)[0]
    assert stored['status']=='in_progress' and json.loads(stored['answers'])==[] and stored['score'] is None


@pytest.mark.parametrize('skill',['reading','listening'])
def test_expired_abandoned_answer_write_still_denied(policy_probe,skill):
    s=policy_probe; _,m,sid,aid=_admitted_retake(s,skill)
    query(f"UPDATE {s}.mock_exam_sittings SET {skill}_started_at=now()-interval'10 minutes' WHERE id=$1",sid)
    query(f"UPDATE {s}.mock_exams SET reading_minutes=1 WHERE id=$1",m)
    with pytest.raises(asyncpg.RaiseError,match='invalid_resume') as rejected:
        query(f"UPDATE {s}.{skill}_test_attempts SET status='abandoned',answers='[{{\"q_num\":3,\"user_answer\":\"late\"}}]' WHERE id=$1",aid)
    assert 'answer_write' in str(rejected.value)
    assert query(f"SELECT status FROM {s}.{skill}_test_attempts WHERE id=$1",aid)[0]['status']=='in_progress'


@pytest.mark.parametrize('skill',['reading','listening'])
def test_expired_autosave_still_denied(policy_probe,skill):
    s=policy_probe; _,m,sid,aid=_admitted_retake(s,skill)
    query(f"UPDATE {s}.mock_exam_sittings SET {skill}_started_at=now()-interval'10 minutes' WHERE id=$1",sid)
    query(f"UPDATE {s}.mock_exams SET reading_minutes=1 WHERE id=$1",m)
    with pytest.raises(asyncpg.RaiseError,match='invalid_resume') as rejected:
        query(f"UPDATE {s}.{skill}_test_attempts SET answers='[{{\"q_num\":3,\"user_answer\":\"late\"}}]' WHERE id=$1",aid)
    assert 'answer_write' in str(rejected.value)
    if skill=='reading':
        with pytest.raises(asyncpg.RaiseError,match='invalid_resume'):
            query(f"INSERT INTO {s}.reading_attempt_answers(attempt_id,q_num,user_answer) VALUES($1,3,'late')",aid)


@pytest.mark.parametrize('skill',['reading','listening'])
@pytest.mark.parametrize('mismatch',['owner','pointer','purpose','parent_owner','ttl'])
def test_finalize_keeps_admission_and_submit_guards(policy_probe,skill,mismatch):
    s=policy_probe; _,_,sid,aid=_admitted_retake(s,skill)
    updates={'owner':"user_id=gen_random_uuid()",'pointer':"sitting_id=gen_random_uuid()",'purpose':"attempt_purpose='practice'"}
    if mismatch in updates:
        with pytest.raises(asyncpg.RaiseError,match='immutable_admission'):
            query(f"UPDATE {s}.{skill}_test_attempts SET status='submitted',answers='[{{\"q_num\":3,\"user_answer\":\"hairs\"}}]',{updates[mismatch]} WHERE id=$1",aid)
    elif mismatch=='parent_owner':
        query(f"UPDATE {s}.mock_exam_sittings SET user_id=gen_random_uuid() WHERE id=$1",sid)
        with pytest.raises(asyncpg.RaiseError,match='ambiguous_orphan'):
            query(f"UPDATE {s}.{skill}_test_attempts SET status='submitted',answers='[{{\"q_num\":3,\"user_answer\":\"hairs\"}}]' WHERE id=$1",aid)
    else:
        query(f"UPDATE {s}.{skill}_test_attempts SET resume_expires_at=now()-interval'1 second' WHERE id=$1",aid)
        parent=json.loads(query(f"SELECT to_jsonb(a) parent FROM {s}.{skill}_test_attempts a WHERE id=$1",aid)[0]['parent'])
        with pytest.raises(asyncpg.RaiseError,match='invalid_resume'):
            query(f"SELECT {s}.fn_guard_owned_mock_attempt($1,$2::jsonb,'submit')",skill,json.dumps(parent))
    assert query(f"SELECT status FROM {s}.{skill}_test_attempts WHERE id=$1",aid)[0]['status']=='in_progress'


@pytest.mark.parametrize('skill',['reading','listening'])
def test_finalize_migration_preserves_historical_rows_on_reapply(rollout_probe,skill):
    s=rollout_probe; p=paper(s,skill)
    aid=query(f"INSERT INTO {s}.{skill}_test_attempts(test_id,user_id,status,answers,score,grading_details) VALUES($1,$2,'submitted','[{{\"q_num\":3,\"user_answer\":\"hair\"}}]',27,'[{{\"legacy\":true}}]') RETURNING id",p,uuid4())[0]['id']
    before=dict(query(f"SELECT * FROM {s}.{skill}_test_attempts WHERE id=$1",aid)[0])
    assert before['paper_revision'] is None
    migration=FINALIZE_SQL.replace('public.',s+'.').replace('search_path=public,','search_path='+s+',')
    query(migration)
    query(migration)
    lifecycle=PARENT_LIFECYCLE_SQL.replace('public.',s+'.').replace('search_path=public,','search_path='+s+',')
    query(lifecycle)
    query(lifecycle)
    assert dict(query(f"SELECT * FROM {s}.{skill}_test_attempts WHERE id=$1",aid)[0])==before


def test_unfinished_orphan_never_becomes_public_by_ended_room_badge(policy_probe):
    s=policy_probe; p=paper(s); m=room(s,p,active=True); owner=uuid4()
    sid=query(f"INSERT INTO {s}.mock_exam_sittings(mock_exam_id,user_id) VALUES($1,$2) RETURNING id",m,owner)[0]["id"]
    query(f"SELECT {s}.fn_admit_mock_paper_attempt('reading',$1,$2,$3,'legacy')",p,owner,sid)
    query(f"UPDATE {s}.mock_exams SET active_section='done' WHERE id=$1",m)
    assert access(s,'reading',p,owner,'delivery')["reason"]=='ambiguous_orphan'
    with pytest.raises(asyncpg.RaiseError,match="ambiguous_orphan"):
        query(f"UPDATE {s}.reading_tests SET is_public=true WHERE id=$1",p)


def test_flags_use_real_policy_guard_and_original_identity_after_source_delete(policy_probe):
    s=policy_probe; p=paper(s); m=room(s,p,active=True); owner=uuid4()
    passage=query(f"INSERT INTO {s}.reading_passages(test_id,passage_order) VALUES($1,1) RETURNING id",p)[0]['id']
    qid=query(f"INSERT INTO {s}.reading_questions(passage_id,q_num) VALUES($1,1) RETURNING id",passage)[0]['id']
    sid=query(f"INSERT INTO {s}.mock_exam_sittings(mock_exam_id,user_id) VALUES($1,$2) RETURNING id",m,owner)[0]['id']
    admitted=json.loads(query(f"SELECT {s}.fn_admit_mock_paper_attempt('reading',$1,$2,$3,'legacy') receipt",p,owner,sid)[0]['receipt'])
    aid=UUID(admitted['attempt_id']); operation=uuid4()
    query(f"DELETE FROM {s}.reading_questions WHERE id=$1",qid)
    command=f"SELECT {s}.fn_patch_mock_attempt_review_flag('reading',$1,$2,NULL,1,$3,$4,$5) receipt"
    first=json.loads(query(command,aid,owner,True,0,operation)[0]['receipt'])
    replay=json.loads(query(command,aid,owner,True,0,operation)[0]['receipt'])
    conflict=json.loads(query(command,aid,owner,False,0,uuid4())[0]['receipt'])
    assert first['accepted'] and first['question_id']==str(qid) and first['revision']==1
    assert replay['reason']=='replayed' and conflict['reason']=='conflict' and conflict['flagged'] is True
    assert query(f"SELECT answers FROM {s}.reading_test_attempts WHERE id=$1",aid)[0]['answers']=='[]'
    with pytest.raises(asyncpg.InsufficientPrivilegeError,match='review_flag_owner_mismatch'):
        query(command,aid,uuid4(),False,1,uuid4())
    query(f"UPDATE {s}.mock_exams SET collected_section='reading' WHERE id=$1",m)
    with pytest.raises(asyncpg.RaiseError,match='ambiguous_orphan'):
        query(command,aid,owner,False,1,uuid4())


@pytest.mark.parametrize('mode', ['sequential', 'retake'])
def test_listening_admitted_duration_cannot_expire_live_work_after_source_edit(policy_probe, mode):
    s=policy_probe; p=paper(s,'listening'); owner=uuid4()
    query(f"UPDATE {s}.listening_tests SET full_audio_duration_seconds=1800 WHERE id=$1",p)
    section=query(f"INSERT INTO {s}.listening_content(test_id,section_num) VALUES($1,1) RETURNING id",p)[0]['id']
    query(f"INSERT INTO {s}.listening_exercises(content_id,payload) VALUES($1,'{{\"questions\":[{{\"q_num\":1}}]}}')",section)
    m=room(s,p,'listening',True,mode)
    query(f"UPDATE {s}.mock_exams SET listening_started_at=now()-interval'200 seconds' WHERE id=$1",m)
    sid=query(f"INSERT INTO {s}.mock_exam_sittings(mock_exam_id,user_id,assigned_skills,listening_started_at) VALUES($1,$2,ARRAY['listening'],now()-interval'200 seconds') RETURNING id",m,owner)[0]['id']
    admitted=json.loads(query(f"SELECT {s}.fn_admit_mock_paper_attempt('listening',$1,$2,$3,'legacy') receipt",p,owner,sid)[0]['receipt'])
    aid=UUID(admitted['attempt_id'])

    with pytest.raises(asyncpg.RaiseError,match='live_timing_dependency'):
        query(f"UPDATE {s}.listening_tests SET full_audio_duration_seconds=60 WHERE id=$1",p)
    current=query(f"SELECT full_audio_duration_seconds FROM {s}.listening_tests WHERE id=$1",p)[0]
    frozen=json.loads(query(f"SELECT paper_row FROM {s}.mock_paper_attempt_snapshots WHERE skill='listening' AND attempt_id=$1",aid)[0]['paper_row'])
    assert current['full_audio_duration_seconds']==frozen['full_audio_duration_seconds']==1800
    from services import mock_exam_service as clocks
    exam=json.loads(query(f"SELECT to_jsonb(m) parent FROM {s}.mock_exams m WHERE id=$1",m)[0]['parent'])
    sitting=json.loads(query(f"SELECT to_jsonb(s) parent FROM {s}.mock_exam_sittings s WHERE id=$1",sid)[0]['parent'])
    ticking_now=query('SELECT clock_timestamp() value')[0]['value']
    with patch.object(clocks,'_listening_audio_duration_seconds',return_value=current['full_audio_duration_seconds']), \
         patch.object(clocks,'_now',return_value=ticking_now):
        assert clocks.section_duration_seconds(exam,'listening')==1920
        assert 1700<clocks.section_time_remaining_seconds(exam,'listening')<=1720
        assert 1700<clocks.retake_time_remaining_seconds(sitting,exam,'listening')<=1720
        assert clocks._retake_section_expired(sitting,exam,'listening',30) is False
    query(f"UPDATE {s}.listening_tests SET title='Revised display title' WHERE id=$1",p)
    assert access(s,'listening',p,owner,'delivery',sid)['allowed'] is True
    parent=json.loads(query(f"SELECT to_jsonb(a) parent FROM {s}.listening_test_attempts a WHERE id=$1",aid)[0]['parent'])
    guard=json.loads(query(f"SELECT {s}.fn_guard_owned_mock_attempt('listening',$1::jsonb,'resume') receipt",json.dumps(parent))[0]['receipt'])
    assert guard['allowed'] is True
    assert json.loads(query(f"SELECT {s}.fn_guard_owned_mock_attempt('listening',$1::jsonb,'submit') receipt",json.dumps(parent))[0]['receipt'])['allowed'] is True
    flag=json.loads(query(f"SELECT {s}.fn_patch_mock_attempt_review_flag('listening',$1,$2,NULL,1,true,0,$3) receipt",aid,owner,uuid4())[0]['receipt'])
    assert flag['accepted'] is True
    query(f"UPDATE {s}.listening_test_attempts SET answers='[{{\"q_num\":1,\"user_answer\":\"saved\"}}]' WHERE id=$1",aid)
    query(f"UPDATE {s}.mock_exam_sittings SET listening_submitted_at=now() WHERE id=$1",sid)
    query(f"UPDATE {s}.listening_test_attempts SET status='submitted' WHERE id=$1",aid)
    if mode=='sequential':
        query(f"UPDATE {s}.mock_exams SET collected_section='listening' WHERE id=$1",m)
    query(f"UPDATE {s}.listening_tests SET full_audio_duration_seconds=60 WHERE id=$1",p)
    assert query(f"SELECT full_audio_duration_seconds FROM {s}.listening_tests WHERE id=$1",p)[0]['full_audio_duration_seconds']==60
    assert json.loads(query(f"SELECT paper_row FROM {s}.mock_paper_attempt_snapshots WHERE skill='listening' AND attempt_id=$1",aid)[0]['paper_row'])['full_audio_duration_seconds']==1800


def test_new_listening_duration_never_falls_back_when_private_snapshot_is_missing(policy_probe):
    s=policy_probe; p=paper(s,'listening'); m=room(s,p,'listening',True); owner=uuid4()
    sid=query(f"INSERT INTO {s}.mock_exam_sittings(mock_exam_id,user_id) VALUES($1,$2) RETURNING id",m,owner)[0]['id']
    admitted=json.loads(query(f"SELECT {s}.fn_admit_mock_paper_attempt('listening',$1,$2,$3,'legacy') receipt",p,owner,sid)[0]['receipt'])
    aid=UUID(admitted['attempt_id'])
    # Simulate corrupt storage only in this disposable synthetic schema.
    query(f"ALTER TABLE {s}.mock_paper_attempt_snapshots DISABLE TRIGGER USER;")
    query(f"DELETE FROM {s}.mock_paper_attempt_snapshots WHERE skill='listening' AND attempt_id=$1",aid)
    query(f"ALTER TABLE {s}.mock_paper_attempt_snapshots ENABLE TRIGGER USER;")
    with pytest.raises(asyncpg.RaiseError,match='verification_unavailable'):
        access(s,'listening',p,owner,'delivery',sid)


def test_standalone_listening_revision_does_not_inherit_mock_clock_barrier(policy_probe):
    s=policy_probe; p=paper(s,'listening',public=True)
    query(f"UPDATE {s}.listening_tests SET full_audio_duration_seconds=1800 WHERE id=$1",p)
    aid=query(f"INSERT INTO {s}.listening_test_attempts(test_id,user_id,attempt_purpose) VALUES($1,$2,'practice') RETURNING id",p,uuid4())[0]['id']
    query(f"UPDATE {s}.listening_tests SET full_audio_duration_seconds=60 WHERE id=$1",p)
    assert query(f"SELECT full_audio_duration_seconds FROM {s}.listening_tests WHERE id=$1",p)[0]['full_audio_duration_seconds']==60
    frozen=json.loads(query(f"SELECT paper_row FROM {s}.mock_paper_attempt_snapshots WHERE skill='listening' AND attempt_id=$1",aid)[0]['paper_row'])
    assert frozen['full_audio_duration_seconds']==1800


@pytest.mark.parametrize('skill', ['reading','listening'])
def test_n_minus_one_start_attach_submit_then_activation_preserves_history(rollout_probe, skill):
    s=rollout_probe; p=paper(s,skill); owner=uuid4(); m=room(s,p,skill,True)
    sid=query(f"INSERT INTO {s}.mock_exam_sittings(mock_exam_id,user_id) VALUES($1,$2) RETURNING id",m,owner)[0]['id']
    old=query(f"INSERT INTO {s}.{skill}_test_attempts(test_id,user_id) VALUES($1,$2) RETURNING id",p,owner)[0]['id']
    # The deployed N-1 start is a separate abandon write BEFORE its untyped
    # INSERT. Additive306 must not turn this into abandon-then-rejectedINSERT.
    query(f"UPDATE {s}.{skill}_test_attempts SET status='abandoned' WHERE id=$1",old)
    aid=query(f"INSERT INTO {s}.{skill}_test_attempts(test_id,user_id) VALUES($1,$2) RETURNING id",p,owner)[0]['id']
    query(f"UPDATE {s}.mock_exam_sittings SET {skill}_attempt_id=$1 WHERE id=$2",aid,sid)
    query(f"UPDATE {s}.{skill}_test_attempts SET sitting_id=$1 WHERE id=$2",sid,aid)
    saved='[{"q_num":1,"user_answer":"saved legacy work"}]'
    if skill=='reading':
        query(f"INSERT INTO {s}.reading_attempt_answers VALUES($1,1,'saved legacy work')",aid)
    else:
        query(f"UPDATE {s}.listening_test_attempts SET answers=$1::jsonb WHERE id=$2",saved,aid)
        query(f"UPDATE {s}.listening_tests SET full_audio_duration_seconds=60 WHERE id=$1",p)
    # Existing pointer retries/continuation remain valid and cannot mint or
    # relink a different empty attempt during the transition.
    retry=json.loads(query(f"SELECT {s}.fn_admit_mock_paper_attempt($1,$2,$3,$4,'legacy') receipt",skill,p,owner,sid)[0]['receipt'])
    assert retry['attempt_id']==str(aid) and retry['acquired_existing'] is True
    assert retry['paper_revision'] is None
    assert access(s,skill,p,owner,'delivery',sid)['allowed'] is True
    query(f"UPDATE {s}.{skill}_test_attempts SET status='submitted',score=27,grading_details='[{{\"legacy\":true}}]' WHERE id=$1",aid)
    query(f"UPDATE {s}.mock_exam_sittings SET {skill}_submitted_at=now() WHERE id=$1",sid)
    if skill=='listening':
        query(f"UPDATE {s}.mock_exams SET collected_section='listening' WHERE id=$1",m)
    # A new backend already serving some requests before old workers drain
    # explicitly types admission, but cannot create a pinned key that N-1
    # submit would mistakenly grade against today's mutable content.
    practice=paper(s,skill,public=True)
    phased=query(f"INSERT INTO {s}.{skill}_test_attempts(test_id,user_id,attempt_purpose) VALUES($1,$2,'practice') RETURNING id,paper_revision",practice,owner)[0]
    assert phased['paper_revision'] is None
    assert query(f"SELECT * FROM {s}.mock_paper_attempt_snapshots WHERE skill=$1",skill)==[]
    activate(s)
    fresh=query(f"INSERT INTO {s}.{skill}_test_attempts(test_id,user_id,attempt_purpose) VALUES($1,$2,'practice') RETURNING id,paper_revision",practice,uuid4())[0]
    assert fresh['paper_revision'] is not None
    assert len(query(f"SELECT * FROM {s}.mock_paper_attempt_snapshots WHERE skill=$1 AND attempt_id=$2",skill,fresh['id']))==1
    with pytest.raises(asyncpg.RaiseError,match='typed_admission_required'):
        query(f"INSERT INTO {s}.{skill}_test_attempts(test_id,user_id) VALUES($1,$2)",practice,uuid4())
    # Old work stays legacy and can finish through the new backend without
    # retroactive capture or claiming reconstruction of original keys.
    query(f"UPDATE {s}.{skill}_test_attempts SET status='submitted',score=15 WHERE id=$1",phased['id'])
    historical=query(f"SELECT score,paper_revision,grading_details FROM {s}.{skill}_test_attempts WHERE id=$1",aid)[0]
    assert historical['score']==27 and historical['paper_revision'] is None
    assert json.loads(historical['grading_details'])==[{'legacy':True}]
    assert query(f"SELECT * FROM {s}.mock_paper_attempt_snapshots WHERE attempt_id=ANY($1::uuid[])",[old,aid,phased['id']])==[]
    reapplied=SQL.replace('public.',s+'.').replace('search_path=public,','search_path='+s+',').replace('search_path = public,','search_path = '+s+',').replace("ns.nspname='public'","ns.nspname='"+s+"'")
    query(reapplied)
    assert query(f"SELECT {s}.fn_mock_admission_contract_active() active")[0]['active'] is True


def test_activation_requires_explicit_exact_backend_receipt_and_is_private(rollout_probe):
    s=rollout_probe
    migration=ACTIVATION_SQL.replace('public.',s+'.').replace('search_path=public,','search_path='+s+',')
    with pytest.raises(asyncpg.RaiseError,match='requires_verified_backend_sha'):
        query(migration)
    assert query(f"SELECT {s}.fn_mock_admission_contract_active() active")[0]['active'] is False
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        query(f"SET ROLE authenticated; SELECT {s}.fn_mock_admission_contract_active();")
    activate(s)
    comment=query(f"SELECT obj_description('{s}.fn_mock_admission_contract_active()'::regprocedure,'pg_proc') receipt")[0]['receipt']
    assert comment.endswith('a'*40)


def test_programme_v2_explicit_admission_preserves_old_rpc_during_rollout(rollout_probe):
    s=rollout_probe
    # Faithful N-1 INSERT shape delegated by the unchanged295 acquisition.
    query(f"""CREATE FUNCTION {s}.fn_acquire_listening_programme_attempt(uuid,uuid,text)
        RETURNS TABLE(attempt_id uuid,attempt_status text,attempt_started_at timestamptz,
            attempt_resume_expires_at timestamptz,attempt_answers jsonb,attempt_renderer_affinity text,
            attempt_playback_started_at timestamptz,created boolean) LANGUAGE plpgsql AS $$ BEGIN
        RETURN QUERY INSERT INTO {s}.listening_test_attempts AS a(test_id,user_id,scoring_policy,renderer_affinity)
        VALUES($1,$2,'report_only',$3) RETURNING a.id,a.status,a.started_at,a.resume_expires_at,a.answers,a.renderer_affinity,a.playback_started_at,true;
        END $$;""")
    p=paper(s,'listening',public=True)
    query(f"UPDATE {s}.listening_tests SET scoring_policy='report_only' WHERE id=$1",p)
    legacy=query(f"SELECT * FROM {s}.fn_acquire_listening_programme_attempt($1,$2,'legacy')",p,uuid4())[0]['attempt_id']
    phased=query(f"SELECT * FROM {s}.fn_acquire_listening_programme_attempt_v2($1,$2,'legacy')",p,uuid4())[0]['attempt_id']
    assert query(f"SELECT paper_revision FROM {s}.listening_test_attempts WHERE id=$1",phased)[0]['paper_revision'] is None
    assert query(f"SELECT * FROM {s}.mock_paper_attempt_snapshots")==[]
    activate(s)
    fresh=query(f"SELECT * FROM {s}.fn_acquire_listening_programme_attempt_v2($1,$2,'claim-v1')",p,uuid4())[0]['attempt_id']
    assert query(f"SELECT attempt_purpose,paper_revision FROM {s}.listening_test_attempts WHERE id=$1",fresh)[0]['attempt_purpose']=='practice'
    assert len(query(f"SELECT * FROM {s}.mock_paper_attempt_snapshots WHERE attempt_id=$1",fresh))==1
    assert query(f"SELECT * FROM {s}.mock_paper_attempt_snapshots WHERE attempt_id=ANY($1::uuid[])",[legacy,phased])==[]
