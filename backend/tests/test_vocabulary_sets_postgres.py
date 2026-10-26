"""Real transaction/RLS tests; only a task-owned loopback aver_ux_ database."""
import asyncio
import json
import os
from pathlib import Path
from uuid import uuid4
import asyncpg
import pytest
import pytest_asyncio
from sqlalchemy.engine import make_url

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def pg():
    raw = os.environ.get("VOCABULARY_SETS_TEST_DATABASE_URL")
    if not raw:
        pytest.skip("explicit Vocabulary loopback PostgreSQL database not configured")
    url = make_url(raw)
    if url.drivername != "postgresql+asyncpg" or url.host not in ("127.0.0.1", "localhost", "::1") or not (url.database or "").startswith("aver_ux_"):
        pytest.fail("Vocabulary tests require an aver_ux_ loopback database")
    kwargs = dict(user=url.username, host=url.host, port=url.port or 5432, database=url.database, password=url.password)
    c = await asyncpg.connect(**kwargs)
    schema = "vocab_test_" + uuid4().hex
    await c.execute(f"CREATE SCHEMA {schema}; SET search_path={schema}")
    for role in ("anon", "authenticated", "service_role"):
        await c.execute(f"DO $$ BEGIN CREATE ROLE {role}; EXCEPTION WHEN duplicate_object THEN NULL; END $$")
    await c.execute(f"GRANT USAGE ON SCHEMA {schema} TO anon,authenticated,service_role")
    await c.execute("""CREATE TABLE users(id uuid PRIMARY KEY); CREATE TABLE courses(id uuid PRIMARY KEY,name text,is_active boolean);
      CREATE TABLE cohorts(id uuid PRIMARY KEY,name text,course_id uuid,is_active boolean);
      CREATE TABLE students(id uuid PRIMARY KEY,user_id uuid,cohort_id uuid);
      CREATE TABLE student_cohort_memberships(id uuid PRIMARY KEY,student_id uuid,cohort_id uuid,is_active boolean);
      CREATE TABLE vocab_cards(id uuid PRIMARY KEY,slug text,category text,headword text,gloss_vi text,definition_en text,
        pronunciation text,part_of_speech text,level text,example text,audio_headword text,audio_example text);""")
    sql = (Path(__file__).parents[1] / "migrations/317_vocabulary_class_sets.sql").read_text()
    sql = sql.replace("auth.users", "users").replace("public,pg_temp", f"{schema},pg_temp")
    await c.execute(sql)
    await c.execute(sql)  # additive replay must preserve accepted state
    await c.set_type_codec("jsonb", schema="pg_catalog", encoder=json.dumps, decoder=json.loads)
    try:
        yield c, schema, kwargs
    finally:
        await c.execute("RESET ROLE")
        await c.execute(f"DROP SCHEMA {schema} CASCADE")
        await c.close()


async def seed(pg, library=False):
    c, _, _ = pg
    admin, u1, u2, denied, course, cohort, set_id, card = [uuid4() for _ in range(8)]
    for u in (admin, u1, u2, denied):
        await c.execute("INSERT INTO users VALUES($1)", u)
    await c.execute("INSERT INTO courses VALUES($1,'C2',true)", course)
    await c.execute("INSERT INTO cohorts VALUES($1,'C2 evening',$2,true)", cohort, course)
    for u, active in ((u1, True), (u2, True), (denied, False)):
        student = uuid4()
        await c.execute("INSERT INTO students VALUES($1,$2,$3)", student, u, cohort)
        await c.execute("INSERT INTO student_cohort_memberships VALUES($1,$2,$3,$4)", uuid4(), student, cohort, active)
    await c.execute("INSERT INTO vocab_cards(id,slug,category,headword,gloss_vi,example) VALUES($1,'acquire','study','acquire','tiếp thu','We acquire skills.')", card)
    data = dict(title="Class vocabulary", description="Synthetic", card_ids=[str(card)], library=library, course_ids=[str(course)], cohort_ids=[])
    row = await c.fetchval("SELECT fn_save_vocabulary_set($1,$2,0,$3,'save')", set_id, admin, data)
    row = await c.fetchval("SELECT fn_save_vocabulary_set($1,$2,$3,'{}','publish')", set_id, admin, row["version"])
    return dict(admin=admin,u1=u1,u2=u2,denied=denied,course=course,cohort=cohort,set_id=set_id,card=card,data=data,row=row)


async def start(c, s, user=None, id=None, mode="learn"):
    id = id or uuid4()
    items = [{"card_id": str(s["card"]), "prompt": "tiếp thu", "expected": "acquire", "card": {"id": str(s["card"]), "headword": "acquire"}}]
    return await c.fetchval("SELECT fn_start_vocabulary_session($1,$2,$3,1,$4,$5,$6)", user or s["u1"], id, s["set_id"], mode, {"mode":mode}, items)


def change(s, version=0):
    return dict(card_id=str(s["card"]),expected_version=version,familiar=False,recall_attempts=1,recall_correct=1,
                interval_days=1,ease_factor=2.5,lapse_count=0,review_count=1,
                last_reviewed_at="2026-10-14T00:00:00Z",next_review_at="2026-10-15T00:00:00Z")


async def answer(c, s, session, client=None, user=None, payload=None, version=0):
    return await c.fetchval("SELECT fn_answer_vocabulary_session($1,$2,$3,$4,$5,$6)", user or s["u1"],
        session, client or uuid4(), payload or {"answer":"acquire"}, [{"index":0,"answer":"acquire","expected":"acquire","correct":True}], [change(s,version)])


async def test_scope_denies_inactive_canonical_membership_even_with_legacy_pointer(pg):
    s = await seed(pg); c = pg[0]
    assert await c.fetchval("SELECT fn_vocabulary_set_visible($1,$2)", s["u1"], s["set_id"])
    assert not await c.fetchval("SELECT fn_vocabulary_set_visible($1,$2)", s["denied"], s["set_id"])
    with pytest.raises(asyncpg.PostgresError, match="set_denied"):
        await start(c,s,s["denied"])
    row = await start(c,s)
    await c.execute("UPDATE student_cohort_memberships SET is_active=false")
    with pytest.raises(asyncpg.PostgresError, match="set_denied"):
        await answer(c,s,UUID(row["id"]))
    assert await c.fetchval("SELECT count(*) FROM vocabulary_shared_progress") == 0


from uuid import UUID


async def test_receipt_replay_is_atomic_and_conflicting_payload_is_rejected(pg):
    s = await seed(pg); c = pg[0]; row = await start(c,s); client = uuid4()
    saved = await answer(c,s,UUID(row["id"]),client)
    replay = await answer(c,s,UUID(row["id"]),client)
    assert saved == replay and saved["completed"]
    assert await c.fetchval("SELECT review_count FROM vocabulary_shared_progress WHERE user_id=$1", s["u1"]) == 1
    with pytest.raises(asyncpg.PostgresError, match="replay_conflict"):
        await answer(c,s,UUID(row["id"]),client,payload={"answer":"changed"})
    with pytest.raises(asyncpg.PostgresError, match="session_missing"):
        await answer(c,s,UUID(row["id"]),user=s["u2"])
    assert await c.fetchval("SELECT count(*) FROM vocabulary_set_receipts") == 1


async def test_snapshot_and_published_audience_survive_draft_edits_and_archival(pg):
    s = await seed(pg); c = pg[0]; row = await start(c,s,mode="test")
    await c.execute("UPDATE vocab_cards SET headword='changed'")
    edited = {**s["data"],"title":"New draft", "course_ids":[], "library":True}
    draft = await c.fetchval("SELECT fn_save_vocabulary_set($1,$2,$3,$4,'save')", s["set_id"],s["admin"],s["row"]["version"],edited)
    assert not await c.fetchval("SELECT fn_vocabulary_set_visible($1,$2)",s["denied"],s["set_id"])
    await c.fetchval("SELECT fn_save_vocabulary_set($1,$2,$3,'{}','publish')",s["set_id"],s["admin"],draft["version"])
    saved = await answer(c,s,UUID(row["id"]))
    assert saved["items"][0]["expected"] == "acquire" and saved["revision"] == 1
    await c.execute("UPDATE vocabulary_sets SET status='archived'")
    assert await c.fetchval("SELECT answers FROM vocabulary_set_sessions WHERE id=$1",UUID(row["id"])) == saved["answers"]


async def test_start_replay_and_two_accounts_have_independent_progress(pg):
    s = await seed(pg); c = pg[0]; id = uuid4()
    a = await start(c,s,id=id); assert await start(c,s,id=id) == a
    with pytest.raises(asyncpg.PostgresError, match="replay_conflict"):
        await start(c,s,s["u2"],id=id)
    b = await start(c,s,s["u2"])
    await answer(c,s,UUID(a["id"]))
    assert await c.fetchval("SELECT count(*) FROM vocabulary_shared_progress WHERE user_id=$1",s["u2"]) == 0
    await answer(c,s,UUID(b["id"]),user=s["u2"])
    assert await c.fetchval("SELECT count(*) FROM vocabulary_shared_progress") == 2


async def test_admin_save_replays_only_identical_next_state_and_stale_changes_conflict(pg):
    s = await seed(pg); c=pg[0]
    edited = {**s["data"], "title":"Revised draft"}
    args=(s["set_id"],s["admin"],s["row"]["version"],edited)
    saved = await c.fetchval("SELECT fn_save_vocabulary_set($1,$2,$3,$4,'save')",*args)
    assert await c.fetchval("SELECT fn_save_vocabulary_set($1,$2,$3,$4,'save')",*args) == saved
    with pytest.raises(asyncpg.PostgresError,match="set_conflict"):
        await c.fetchval("SELECT fn_save_vocabulary_set($1,$2,$3,$4,'save')",s["set_id"],s["admin"],s["row"]["version"],{**edited,"title":"Conflicting"})


async def test_concurrent_sessions_cannot_overwrite_progress_or_commit_receipt_on_cas_failure(pg):
    s = await seed(pg); c, schema, kwargs = pg; a = await start(c,s); b = await start(c,s)
    other = await asyncpg.connect(**kwargs, server_settings={"search_path":schema})
    await other.set_type_codec("jsonb",schema="pg_catalog",encoder=json.dumps,decoder=json.loads)
    try:
        results = await asyncio.gather(answer(c,s,UUID(a["id"])),answer(other,s,UUID(b["id"])),return_exceptions=True)
        assert sum(isinstance(x,dict) for x in results) == 1
        assert any("progress_conflict" in str(x) for x in results if isinstance(x,Exception))
        assert await c.fetchval("SELECT count(*) FROM vocabulary_set_receipts") == 1
        assert await c.fetchval("SELECT count(*) FROM vocabulary_set_sessions WHERE completed") == 1
    finally:
        await other.close()


@pytest.mark.parametrize("role", ["anon","authenticated"])
async def test_direct_clients_cannot_read_private_answers_or_call_service_rpcs(pg,role):
    s = await seed(pg); c = pg[0]
    await c.execute(f"SET ROLE {role}")
    for table in ("vocabulary_sets","vocabulary_set_revisions","vocabulary_set_sessions","vocabulary_shared_progress","vocabulary_set_receipts"):
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await c.fetch(f"SELECT * FROM {table}")
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        await c.fetchval("SELECT fn_vocabulary_set_visible($1,$2)",s["u1"],s["set_id"])
    await c.execute("RESET ROLE")
