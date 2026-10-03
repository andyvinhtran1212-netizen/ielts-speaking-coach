"""307's actual CAS RPC on CI or a task-owned disposable local PostgreSQL.

TEST_PG_URL accepts only loopback databases, matching the existing CI service.
All product-shaped data lives in one random schema, never a hosted database.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import time
from urllib.parse import urlparse
from uuid import uuid4

import pytest

BACKEND = Path(__file__).resolve().parents[1]
CONTAINER = os.environ.get("MOCK_FLAGS_LOCAL_PG_CONTAINER")
DB = os.environ.get("TEST_PG_URL", "")
DOCKER = ["docker", "--context", "colima-listening80-qa"]
OWNER = "01a0fa28-41bd-7c63-8d79-be3dab777496"


def psql_command():
    if DB:
        parsed = urlparse(DB)
        if (parsed.scheme not in {"postgres", "postgresql"}
                or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
                or parsed.query or parsed.fragment):
            raise RuntimeError("Review flag tests require a loopback disposable PostgreSQL URL without overrides")
        return ["psql", DB, "-X", "-v", "ON_ERROR_STOP=1", "-tAq"]
    return DOCKER + ["exec", "-i", CONTAINER, "psql", "-U", "postgres",
                     "-d", "aver_mock_qa", "-X", "-v", "ON_ERROR_STOP=1", "-tAq"]


# Do not let ambient libpq options redirect the explicitly local CI target.
PG_ENV = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
PG_ENV["PGCONNECT_TIMEOUT"] = "3"


def sql(query):
    process = subprocess.run(psql_command(), input=query,
        capture_output=True, text=True, timeout=30, env=PG_ENV)
    if process.returncode:
        raise RuntimeError(process.stderr)
    return process.stdout.strip()


def literal(value):
    return "NULL" if value is None else "'" + str(value).replace("'", "''") + "'"


@pytest.fixture(scope="module")
def schema():
    if not DB and not CONTAINER:
        if os.environ.get("REQUIRE_PG") == "1": pytest.fail("Local PostgreSQL required for migration 307 verification")
        pytest.skip("Local PostgreSQL not requested")
    if not DB:
        check = subprocess.run(DOCKER + ["inspect", "--format", '{{ index .Config.Labels "codex.task" }}',
            CONTAINER], capture_output=True, text=True, timeout=10)
        assert check.returncode == 0 and check.stdout.strip() == OWNER, "Wrong local PG owner"
    assert sql("SELECT 1") == "1", "Local PostgreSQL unavailable"
    assert sql("SELECT usesuper FROM pg_user WHERE usename=current_user") == "t", "Disposable local fixture requires superuser"
    sql("""DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $$;""")
    name = "flags307_" + uuid4().hex
    admission = Path(os.environ.get("MOCK_FLAGS_ADMISSION_SQL", str(BACKEND / "migrations/306_mock_paper_policy_and_admission.sql")))
    # Use the actual306 dependency implementation, not an advisory-lock mock.
    dependency_names = ["fn_lock_mock_paper", "fn_mock_paper_error", "fn_mock_paper_row",
        "fn_mock_section_valid", "fn_mock_paper_dependencies", "fn_mock_protected_references",
        "fn_mock_overlap_valid", "fn_resolve_mock_paper_access", "fn_guard_owned_mock_attempt"]
    dependencies = []
    for function in dependency_names:
        dependencies.append(re.search(r"CREATE OR REPLACE FUNCTION public\."+function+r"\(.*?\$\$;",
            admission.read_text(),re.S).group(0))
    setup = f"""
    CREATE SCHEMA {name};
    CREATE TABLE {name}.reading_test_attempts(id uuid PRIMARY KEY,test_id uuid,user_id uuid,
        anon_id text,status text,resume_expires_at timestamptz,paper_revision bigint,
        answers jsonb,grading_details jsonb,started_at timestamptz,sitting_id uuid);
    CREATE TABLE {name}.listening_test_attempts(LIKE {name}.reading_test_attempts INCLUDING ALL);
    CREATE TABLE {name}.mock_paper_attempt_snapshots(skill text,attempt_id uuid,
        marking_rows jsonb,paper_row jsonb DEFAULT '{{}}',PRIMARY KEY(skill,attempt_id));
    CREATE TABLE {name}.reading_passages(id uuid,test_id uuid,library text);
    CREATE TABLE {name}.reading_questions(id uuid,passage_id uuid,q_num int);
    CREATE TABLE {name}.listening_content(id uuid,test_id uuid);
    CREATE TABLE {name}.listening_exercises(id uuid,content_id uuid,payload jsonb);
    CREATE TABLE {name}.reading_tests(id uuid PRIMARY KEY,status text,is_public boolean,
        mock_content_revision bigint,policy_revision bigint);
    CREATE TABLE {name}.listening_tests(LIKE {name}.reading_tests INCLUDING ALL);
    CREATE TABLE {name}.mock_exams(id uuid PRIMARY KEY,reading_test_id uuid,listening_test_id uuid,
        status text,exam_mode text,active_section text,code text,config jsonb);
    CREATE TABLE {name}.mock_exam_sittings(id uuid PRIMARY KEY,mock_exam_id uuid,user_id uuid,
        status text,reading_attempt_id uuid,listening_attempt_id uuid);
    CREATE TABLE {name}.mock_exam_assignments(id uuid DEFAULT gen_random_uuid(),exam_id uuid,skills text[],open_until timestamptz);
    CREATE TABLE {name}.class_assignments(id uuid,title text,skill text,content_id uuid,
        status text,publish_at timestamptz,due_at timestamptz,content_config jsonb);
    CREATE TABLE {name}.class_assignment_items(id uuid,student_id uuid,assignment_id uuid);
    CREATE TABLE {name}.students(id uuid,user_id uuid);
    GRANT USAGE ON SCHEMA {name} TO service_role,anon,authenticated;
    """
    migration = (BACKEND / "migrations/307_mock_attempt_review_flags.sql").read_text()
    localized = lambda text: text.replace("public.", name + ".").replace("search_path = public,", f"search_path = {name},").replace("search_path=public,", f"search_path={name},")
    try:
        sql(setup + localized("\n".join(dependencies))); sql(localized(migration)); sql(localized(migration))
        yield name
    finally:
        sql(f"DROP SCHEMA IF EXISTS {name} CASCADE;")


def attempt(schema, skill="reading", *, anon=False, pinned=True, status="in_progress", expired=False):
    aid, uid, tid = uuid4(), uuid4(), uuid4()
    answers = [{"q_num": n, "user_answer": f"saved-{n}"} for n in range(1,41)]
    marks = [{"id": f"original-q{n}", "q_num": n} for n in range(1,41)]
    if skill == "listening": marks = [{"id": "exercise-original", "payload": {"questions": marks}}]
    sql(f"INSERT INTO {schema}.{skill}_tests VALUES('{tid}','published',true,1,1);")
    sql(f"INSERT INTO {schema}.{skill}_test_attempts VALUES ({literal(aid)},{literal(tid)},"
        f"{literal(None if anon else uid)},'anonymous-secret',{literal(status)},"
        f"now() {'-' if expired else '+'} interval '1 day',{1 if pinned else 'NULL'},"
        f"{literal(json.dumps(answers))}::jsonb,'[]',now(),NULL);")
    if pinned:
        sql(f"INSERT INTO {schema}.mock_paper_attempt_snapshots(skill,attempt_id,marking_rows) VALUES({literal(skill)},"
            f"{literal(aid)},{literal(json.dumps(marks))}::jsonb);")
    else:
        pid, qid = uuid4(), uuid4()
        assert skill == "reading"
        sql(f"INSERT INTO {schema}.reading_passages VALUES('{pid}','{tid}','l3_test');"
            f"INSERT INTO {schema}.reading_questions VALUES('{qid}','{pid}',20);")
    return aid, None if anon else uid


def query(schema, aid, uid, *, skill="reading", q=20, flag=True, revision=0, operation=None, anon=None):
    values = [literal(skill),literal(aid),literal(uid),literal(anon),str(q),str(flag).lower(),
              str(revision),literal(operation or uuid4())]
    return f"SET ROLE service_role; SELECT {schema}.fn_patch_mock_attempt_review_flag(" + ",".join(values) + ");"


def write(schema, aid, uid, **kw): return json.loads(sql(query(schema, aid, uid, **kw)))


@pytest.mark.parametrize("skill", ["reading", "listening"])
def test_flag_unflag_replay_conflict_and_all40_answers_survive(schema, skill):
    aid,uid = attempt(schema, skill)
    before = sql(f"SELECT to_jsonb(a) FROM {schema}.{skill}_test_attempts a WHERE id='{aid}'")
    operation = uuid4()
    first = write(schema,aid,uid,skill=skill,operation=operation)
    assert first["accepted"] and first["revision"] == 1 and first["question_id"] == "original-q20"
    replay = write(schema,aid,uid,skill=skill,operation=operation)
    assert replay["reason"] == "replayed" and replay["revision"] == 1
    stale = write(schema,aid,uid,skill=skill,flag=False,revision=0)
    assert not stale["accepted"] and stale["flagged"] and stale["revision"] == 1
    second = write(schema,aid,uid,skill=skill,flag=False,revision=1)
    assert second["accepted"] and not second["flagged"] and second["revision"] == 2
    delayed = write(schema,aid,uid,skill=skill,operation=operation)
    assert not delayed["accepted"] and delayed["revision"] == 2 and not delayed["flagged"]
    # Flags do not modify answers, submitted grades, started_at or sitting.
    assert sql(f"SELECT to_jsonb(a) FROM {schema}.{skill}_test_attempts a WHERE id='{aid}'") == before


def test_submitted_expired_owner_and_anon_capability_boundaries(schema):
    aid,uid = attempt(schema)
    with pytest.raises(RuntimeError,match="owner_mismatch"): write(schema,aid,uuid4())
    for kwargs,marker in [({"status":"submitted"},"attempt_closed"),({"expired":True},"active_player_expired")]:
        aid,uid = attempt(schema,**kwargs)
        with pytest.raises(RuntimeError,match=marker): write(schema,aid,uid)
    aid,uid = attempt(schema,anon=True)
    with pytest.raises(RuntimeError,match="owner_mismatch"): write(schema,aid,uuid4(),anon="anonymous-secret")
    with pytest.raises(RuntimeError,match="owner_mismatch"): write(schema,aid,uid,anon="other-secret")
    assert write(schema,aid,uid,anon="anonymous-secret")["accepted"]


def test_pinned_identity_survives_deleted_current_source_and_legacy_is_not_backfilled(schema):
    aid,uid = attempt(schema)
    # No current question exists at all: the frozen revision still owns q20.
    assert write(schema,aid,uid)["question_id"] == "original-q20"
    aid,uid = attempt(schema,pinned=False)
    result = write(schema,aid,uid)
    assert result["question_id"] != "original-q20"
    assert sql(f"SELECT count(*) FROM {schema}.mock_paper_attempt_snapshots WHERE attempt_id='{aid}'") == "0"


def test_duplicate_question_identity_and_reused_operation_fail_closed(schema):
    aid,uid = attempt(schema)
    operation=uuid4(); write(schema,aid,uid,operation=operation)
    with pytest.raises(RuntimeError,match="operation_reused"):
        write(schema,aid,uid,operation=operation,flag=False,revision=1)
    aid,uid=attempt(schema)
    sql(f"UPDATE {schema}.mock_paper_attempt_snapshots SET marking_rows=marking_rows||marking_rows WHERE attempt_id='{aid}'")
    with pytest.raises(RuntimeError,match="question_missing"): write(schema,aid,uid)


def test_direct_client_roles_cannot_read_or_call(schema):
    for role in ["anon","authenticated"]:
        with pytest.raises(RuntimeError,match="permission denied"):
            sql(f"SET ROLE {role}; SELECT * FROM {schema}.mock_attempt_review_flags;")
        assert sql(f"SELECT has_function_privilege('{role}',"
            f"'{schema}.fn_patch_mock_attempt_review_flag(text,uuid,uuid,text,integer,boolean,bigint,uuid)','EXECUTE')") == "f"


def test_new_protected_reference_is_rechecked_inside_flag_transaction(schema):
    aid,uid=attempt(schema)
    tid=sql(f"SELECT test_id FROM {schema}.reading_test_attempts WHERE id='{aid}'")
    # A draft reservation added after a prior HTTP decision makes continued
    # unbound practice ambiguous. The RPC's own306 guard denies the write.
    sql(f"INSERT INTO {schema}.mock_exams(id,reading_test_id,status) VALUES('{uuid4()}','{tid}','draft')")
    with pytest.raises(RuntimeError,match="ambiguous_orphan"): write(schema,aid,uid)
    assert sql(f"SELECT count(*) FROM {schema}.mock_attempt_review_flags WHERE attempt_id='{aid}'") == "0"


def test_unverified_purpose_receipt_cannot_acknowledge_a_flag(schema):
    aid,uid=attempt(schema)
    admission=Path(os.environ.get("MOCK_FLAGS_ADMISSION_SQL",str(BACKEND / "migrations/306_mock_paper_policy_and_admission.sql")))
    original=re.search(r"CREATE OR REPLACE FUNCTION public\.fn_guard_owned_mock_attempt\(.*?\$\$;",
        admission.read_text(),re.S).group(0).replace("public.",schema+".").replace("search_path=public,",f"search_path={schema},")
    try:
        sql(f"CREATE OR REPLACE FUNCTION {schema}.fn_guard_owned_mock_attempt(p_skill TEXT,p_attempt JSONB,p_purpose TEXT) RETURNS JSONB LANGUAGE sql AS $$ SELECT '{{\"allowed\":false}}'::jsonb $$;")
        with pytest.raises(RuntimeError,match="review_flag_policy_unavailable"): write(schema,aid,uid)
        assert sql(f"SELECT count(*) FROM {schema}.mock_attempt_review_flags WHERE attempt_id='{aid}'") == "0"
    finally:
        sql(original)


def test_attempt_row_contention_is_retryable_without_deadlocking(schema):
    aid,uid=attempt(schema); appname="flags307_parent_"+uuid4().hex
    holder=subprocess.Popen(psql_command(), env=PG_ENV,
        stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    holder.stdin.write(f"SET application_name='{appname}'; BEGIN; SELECT id FROM {schema}.reading_test_attempts WHERE id='{aid}' FOR UPDATE; SELECT pg_sleep(3); COMMIT;")
    holder.stdin.close()
    try:
        locked=False
        for _ in range(30):
            locked=sql(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{appname}' AND state='active' AND query LIKE '%pg_sleep(3)%'") != "0"
            if locked: break
            time.sleep(.02)
        assert locked
        with pytest.raises(RuntimeError,match="could not obtain lock"): write(schema,aid,uid)
        holder.wait(timeout=10)
        assert holder.returncode==0,holder.stderr.read()
        assert write(schema,aid,uid)["accepted"]
    finally:
        if holder.poll() is None: holder.kill(); holder.wait()


@pytest.mark.parametrize("same_question", [False,True])
def test_overlapping_clients_preserve_other_questions_and_conflict_same_question(schema,same_question):
    aid,uid=attempt(schema)
    # First real connection owns paper+parent locks until PostgreSQL proves
    # the second operation is waiting, then commits; no timing-only race.
    appname="flags307_"+uuid4().hex
    first_query = f"SET application_name='{appname}'; BEGIN;" + query(schema,aid,uid) + "SELECT pg_sleep(5); COMMIT;"
    first = subprocess.Popen(psql_command(), env=PG_ENV,
        stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    first.stdin.write(first_query); first.stdin.close()
    second=None
    try:
        for _ in range(30):
            if sql(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{appname}' AND state='active' AND query LIKE '%pg_sleep(5)%'") != "0": break
            time.sleep(.02)
        second=subprocess.Popen(psql_command(), env=PG_ENV,
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        second.stdin.write(f"SET application_name='{appname}_second';"+query(schema,aid,uid,q=20 if same_question else 29)); second.stdin.close()
        blocked=False
        for _ in range(30):
            blocked=sql(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{appname}_second' AND cardinality(pg_blocking_pids(pid))>0") != "0"
            if blocked: break
            time.sleep(.02)
        assert blocked,"second flag RPC did not actually overlap the first lock"
        first.wait(timeout=10); second.wait(timeout=10)
        assert first.returncode==second.returncode==0,first.stderr.read()+second.stderr.read()
        result=json.loads(second.stdout.read().strip())
        assert result["accepted"] is (not same_question)
        assert sql(f"SELECT count(*) FROM {schema}.mock_attempt_review_flags WHERE attempt_id='{aid}'") == ("1" if same_question else "2")
    finally:
        for process in [first,second]:
            if process is not None and process.poll() is None: process.kill(); process.wait()
