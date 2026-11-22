"""LIBRARY-0061 T002: migration 400 offline contract plus a disposable LOCAL PostgreSQL run.

Set TEST_PG_URL to a local cluster and REQUIRE_PG=1 to require execution.
No hosted database is contacted; each test drops its own disposable database.
"""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from urllib.parse import urlparse
from uuid import uuid4

import pytest

from services import storage_limits as limits

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
NAME = "400_public_library.sql"
SQL = (MIGRATIONS / NAME).read_text()
DOWN = (MIGRATIONS / "rollback" / NAME).read_text()
CODE = re.sub(r"--[^\n]*", "", SQL)
TABLES = ("library_topics", "writing_samples", "writing_sample_slug_history", "speaking_samples", "library_marks")
MIB = 1024 * 1024


def test_transaction_rls_grants_and_bucket_contract():
    assert CODE.strip().startswith("BEGIN;") and CODE.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s';" in CODE
    for table in TABLES:
        assert f"CREATE TABLE IF NOT EXISTS public.{table} (" in CODE
        assert f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY;" in CODE
    assert "FROM PUBLIC, anon, authenticated, service_role;" in CODE
    # The only policy is the restrictive storage guard; the tables get none.
    assert re.findall(r"\bCREATE POLICY\s+(\w+)\s+ON\s+([\w.]+)", CODE, re.I) == [
        ("library_media_backend_only", "storage.objects")]
    assert "AS RESTRICTIVE FOR ALL TO PUBLIC" in CODE
    assert not re.search(r"\bGRANT\b[^;]*\bTO\b[^;]*\b(anon|authenticated|PUBLIC)\b", CODE, re.I)
    assert "'library-media', 'library-media', false" in CODE
    assert "SET public = false" in CODE
    assert "NOTIFY pgrst, 'reload schema';" in CODE


def test_register_policy_and_rollback_rows():
    register = [line.split("\t") for line in (MIGRATIONS / "register.tsv").read_text().splitlines()]
    assert [row[:3] for row in register if row[0] == "400"] == [["400", NAME, "present"]]
    policy = [line.split("\t") for line in (MIGRATIONS / "forward-policy.tsv").read_text().splitlines()
              if line.startswith(NAME)]
    assert len(policy) == 1 and policy[0][1:3] == ["pending_feature", "public_library"]
    assert "No apply on merge" in policy[0][3]
    for table in ("writing_samples", "speaking_samples", "writing_sample_slug_history", "library_marks"):
        assert f"EXISTS (SELECT 1 FROM public.{table})" in DOWN
    assert "bucket_id = 'library-media'" in DOWN
    assert "DROP POLICY IF EXISTS library_media_backend_only ON storage.objects;" in DOWN


def test_library_media_storage_policy_and_type_caps():
    assert limits.BUCKET_LIMITS["library-media"] == (
        10 * MIB, ("image/png", "image/webp", "audio/mpeg", "audio/mp4"))
    assert "10485760" in CODE and "ARRAY['image/png', 'image/webp', 'audio/mpeg', 'audio/mp4']" in CODE
    limits.check_upload("library-media", 2 * MIB, "image/png")
    limits.check_upload("library-media", 2 * MIB, "image/webp")
    limits.check_upload("library-media", 10 * MIB, "audio/mpeg")
    limits.check_upload("library-media", 10 * MIB, "audio/mp4")
    with pytest.raises(limits.StorageUploadError) as exc:
        limits.check_upload("library-media", 2 * MIB + 1, "image/webp")
    assert exc.value.status_code == 413 and exc.value.detail["max_bytes"] == 2 * MIB
    with pytest.raises(limits.StorageUploadError) as exc:
        limits.check_upload("library-media", 10 * MIB + 1, "audio/mpeg")
    assert exc.value.status_code == 413 and exc.value.detail["max_bytes"] == 10 * MIB
    for wrong in ("image/jpeg", "image/svg+xml", "audio/wav", "application/json"):
        with pytest.raises(limits.StorageUploadError) as exc:
            limits.check_upload("library-media", 10, wrong)
        assert exc.value.status_code == 415


@pytest.fixture
def pg():
    raw = os.environ.get("TEST_PG_URL", "")
    parsed = urlparse(raw)
    if not raw or not shutil.which("psql"):
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("400 requires a local PostgreSQL cluster")
        pytest.skip("TEST_PG_URL not configured")
    assert parsed.scheme in {"postgres", "postgresql"}
    assert parsed.hostname in {"127.0.0.1", "localhost", "::1"} and not parsed.query
    db = "library400_" + uuid4().hex
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    env["PGCONNECT_TIMEOUT"] = "5"

    def run(database, sql, check=True):
        url = parsed._replace(path="/" + database).geturl()
        result = subprocess.run(["psql", url, "-X", "-tAq", "-v", "ON_ERROR_STOP=1", "-f", "-"],
                                input=sql, capture_output=True, text=True, env=env, timeout=30)
        if check:
            assert result.returncode == 0, result.stderr
        return result

    run("postgres", f"CREATE DATABASE {db};")
    try:
        run(db, """
          DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
          DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
          DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
          ALTER ROLE service_role BYPASSRLS;  -- as on Supabase
          GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
          ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
          CREATE TABLE public.users (id uuid PRIMARY KEY);
          CREATE TABLE public.topics (id uuid PRIMARY KEY);
          CREATE SCHEMA storage;
          CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
                                        file_size_limit bigint, allowed_mime_types text[]);
          CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
          ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
          GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
          GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated, service_role;
          INSERT INTO storage.buckets (id, name, public) VALUES ('writing-images', 'writing-images', false);
        """)
        yield lambda sql, check=True: run(db, sql, check)
    finally:
        run("postgres", f"DROP DATABASE {db} WITH (FORCE);")


def _json(pg, sql):
    return json.loads(pg(sql).stdout.strip() or "null")


TOPIC = "INSERT INTO public.library_topics VALUES ('education', 'Giáo dục', ARRAY['writing','speaking'], 1);"
WRITING = """INSERT INTO public.writing_samples
  (source_key, slug, title_en, task_type, question_type, task1_subtype, topic_slug, prompt_text,
   prompt_image_path, essays, delta_75_70, delta_70_60, justification, content_hash, published)
  VALUES ('{key}', '{slug}', 'Remote learning for children', '{task}', {qt}, {st}, 'education', 'Prompt',
          {img}, '{{}}', '[]', '[]', '{{}}', 'h', {pub});"""


def writing(key="w1", slug="remote-learning", task="task2", qt="'opinion'", st="NULL", img="NULL", pub="false"):
    return WRITING.format(key=key, slug=slug, task=task, qt=qt, st=st, img=img, pub=pub)


def test_apply_twice_rls_no_client_access_private_bucket(pg):
    pg(SQL)
    pg(SQL)
    rls = _json(pg, """SELECT json_object_agg(relname, relrowsecurity) FROM pg_class
                       WHERE relnamespace = 'public'::regnamespace AND relname IN
                       ('library_topics','writing_samples','writing_sample_slug_history','speaking_samples','library_marks');""")
    assert rls == {table: True for table in TABLES}
    grants = _json(pg, """SELECT json_agg(grantee || ':' || table_name) FROM information_schema.role_table_grants
                          WHERE table_schema = 'public' AND grantee IN ('anon','authenticated','PUBLIC')
                            AND table_name IN ('library_topics','writing_samples','writing_sample_slug_history',
                                               'speaking_samples','library_marks');""")
    assert grants is None
    assert _json(pg, "SELECT json_agg(b) FROM storage.buckets b WHERE id = 'library-media';") == [{
        "id": "library-media", "name": "library-media", "public": False, "file_size_limit": 10 * MIB,
        "allowed_mime_types": ["image/png", "image/webp", "audio/mpeg", "audio/mp4"]}]
    pg(TOPIC)
    denied = pg("SET ROLE anon; SELECT count(*) FROM public.library_topics;", check=False)
    assert denied.returncode != 0 and "permission denied" in denied.stderr
    assert pg("SET ROLE service_role; SELECT count(*) FROM public.library_topics;").stdout.strip() == "1"


def test_reapply_makes_an_existing_public_bucket_private(pg):
    pg("INSERT INTO storage.buckets (id, name, public) VALUES ('library-media', 'library-media', true);")
    pg(SQL)
    assert _json(pg, "SELECT json_agg(public) FROM storage.buckets WHERE id = 'library-media';") == [False]


def test_permissive_policy_naming_library_media_aborts_the_migration(pg):
    pg("""CREATE POLICY leak ON storage.objects FOR SELECT TO anon USING (bucket_id = 'library-media');""")
    result = pg(SQL, check=False)
    assert result.returncode != 0 and "permissive storage.objects policy names library-media" in result.stderr
    assert _json(pg, "SELECT to_regclass('public.library_topics');") is None


OBJECTS = "SELECT coalesce(json_agg(bucket_id ORDER BY bucket_id), '[]') FROM storage.objects;"


@pytest.mark.parametrize("role", ["anon", "authenticated"])
def test_broad_client_policy_cannot_reach_library_media(pg, role):
    # A pre-existing over-broad policy (no bucket filter) must not expose this bucket.
    pg("""CREATE POLICY broad_read ON storage.objects FOR SELECT TO anon, authenticated USING (true);
          CREATE POLICY broad_write ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (true);
          CREATE POLICY broad_change ON storage.objects FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
          CREATE POLICY broad_delete ON storage.objects FOR DELETE TO anon, authenticated USING (true);
          INSERT INTO storage.objects (bucket_id, name) VALUES
            ('library-media', 'task1/draft.png'), ('writing-images', 'chart.png');""")
    pg(SQL)
    assert _json(pg, f"SET ROLE {role}; {OBJECTS}") == ["writing-images"]
    for sql in ("INSERT INTO storage.objects (bucket_id, name) VALUES ('library-media', 'x.png');",
                "UPDATE storage.objects SET bucket_id = 'library-media' WHERE bucket_id = 'writing-images';"):
        result = pg(f"SET ROLE {role}; {sql}", check=False)
        assert result.returncode != 0 and "row-level security" in result.stderr, sql
    pg(f"SET ROLE {role}; DELETE FROM storage.objects WHERE bucket_id = 'library-media';")
    assert _json(pg, OBJECTS) == ["library-media", "writing-images"]
    # Other buckets keep their client access; the backend role keeps full access.
    pg(f"SET ROLE {role}; INSERT INTO storage.objects (bucket_id, name) VALUES ('writing-images', 'b.png');")
    assert _json(pg, f"SET ROLE service_role; {OBJECTS}") == ["library-media", "writing-images", "writing-images"]
    pg("SET ROLE service_role; INSERT INTO storage.objects (bucket_id, name) VALUES ('library-media', 'a.mp3');")


@pytest.mark.parametrize("bad", [
    "INSERT INTO public.library_topics VALUES ('Bad Slug', 'x', ARRAY['writing'], 1);",
    "INSERT INTO public.library_topics VALUES ('empty', 'x', ARRAY[]::text[], 1);",
    "INSERT INTO public.library_topics VALUES ('reading', 'x', ARRAY['reading'], 1);",
    "INSERT INTO public.library_topics VALUES ('nulls', 'x', ARRAY[NULL]::text[], 1);",
    TOPIC + writing(task="task2", qt="NULL"),
    TOPIC + writing(task="task2", st="'bar'"),
    TOPIC + writing(task="task1_academic", qt="'opinion'", st="'bar'"),
    TOPIC + writing(task="task1_academic", qt="NULL", st="'bar'", pub="true"),
    TOPIC + writing(slug="Upper-Case"),
    TOPIC + writing(slug="a" * 81),
    TOPIC + writing(slug="x").replace("'Remote learning for children'", "'ab'"),
    TOPIC + writing().replace("'education'", "'missing-topic'"),
])
def test_writing_constraints_refuse_bad_rows(pg, bad):
    pg(SQL)
    result = pg(bad, check=False)
    assert result.returncode != 0, bad


def test_writing_valid_rows_slug_history_cascade(pg):
    pg(SQL)
    pg(TOPIC + writing() + writing(key="w2", slug="charts-1", task="task1_academic", qt="NULL", st="'bar'",
                                   img="'task1/charts-1.png'", pub="true"))
    pg("""INSERT INTO public.writing_sample_slug_history (old_slug, sample_id)
          SELECT 'old-remote', id FROM public.writing_samples WHERE slug = 'remote-learning';
          DELETE FROM public.writing_samples WHERE slug = 'remote-learning';""")
    assert _json(pg, "SELECT count(*) FROM public.writing_sample_slug_history;") == 0


SPEAKING = """INSERT INTO public.speaking_samples (source_id, slug, part, title_en, video_source, youtube_id,
               video_url, duration_s, transcript, sample_text, voice, content_hash)
              VALUES ('p2-001', 'describe-a-teacher', 2, 'Describe a teacher', {vs}, {yt}, {url}, {dur},
                      '[]', {text}, {voice}, 'h');"""


def speaking(vs="'youtube'", yt="'dQw4w9WgXcQ'", url="NULL", dur="90", text="'Sample'", voice="'synthetic'"):
    return SPEAKING.format(vs=vs, yt=yt, url=url, dur=dur, text=text, voice=voice)


@pytest.mark.parametrize("bad", [
    speaking(yt="NULL"),
    speaking(yt="'short'"),
    speaking(vs="'self_hosted'", yt="NULL"),
    speaking(vs="'self_hosted'", yt="NULL", url="'http://example.com/a.mp4'"),
    speaking(dur="0"),
    speaking(text="'   '"),
    speaking(voice="'human'"),
    speaking(vs="'vimeo'"),
    speaking().replace(", 2,", ", 4,"),
])
def test_speaking_constraints_refuse_bad_rows(pg, bad):
    pg(SQL)
    assert pg(bad, check=False).returncode != 0, bad


def test_speaking_defaults_and_valid_rows(pg):
    pg(SQL)
    pg(speaking())
    pg(speaking(vs="'self_hosted'", yt="NULL", url="'https://cdn.example.com/a.mp4'").replace(
        "'p2-001', 'describe-a-teacher'", "'p2-002', 'describe-a-place'"))
    row = _json(pg, "SELECT json_build_object('voice', voice, 'outline', outline, 'published', published) "
                    "FROM public.speaking_samples WHERE source_id = 'p2-001';")
    assert row == {"voice": "synthetic", "outline": [], "published": False}


def test_marks_primary_key_and_user_cascade(pg):
    pg(SQL)
    user = str(uuid4())
    pg(f"""INSERT INTO public.users VALUES ('{user}');
           INSERT INTO public.library_marks (user_id, shelf, item_key, kind) VALUES
             ('{user}', 'grammar_article', 'tenses/present-perfect', 'read'),
             ('{user}', 'grammar_article', 'tenses/present-perfect', 'saved');""")
    dup = pg(f"INSERT INTO public.library_marks (user_id, shelf, item_key, kind) "
             f"VALUES ('{user}', 'grammar_article', 'tenses/present-perfect', 'read');", check=False)
    assert dup.returncode != 0 and "duplicate key" in dup.stderr
    for shelf, kind in (("grammar", "read"), ("writing_sample", "liked")):
        bad = pg(f"INSERT INTO public.library_marks (user_id, shelf, item_key, kind) "
                 f"VALUES ('{user}', '{shelf}', 'x', '{kind}');", check=False)
        assert bad.returncode != 0
    pg(f"DELETE FROM public.users WHERE id = '{user}';")
    assert _json(pg, "SELECT count(*) FROM public.library_marks;") == 0


@pytest.mark.parametrize("content", [
    TOPIC + writing(pub="true"),
    speaking() + "UPDATE public.speaking_samples SET published = true;",
    TOPIC + writing() + """INSERT INTO public.writing_sample_slug_history (old_slug, sample_id)
        SELECT 'old-remote', id FROM public.writing_samples;""",
])
def test_rollback_refuses_content_without_marks_or_media(pg, content):
    # Task 2 and YouTube-only Speaking have no media; slug history is not in the manifests.
    pg(SQL)
    pg(content)
    count = ("SELECT (SELECT count(*) FROM public.writing_samples) + (SELECT count(*) FROM public.speaking_samples)"
             " + (SELECT count(*) FROM public.writing_sample_slug_history);")
    before = _json(pg, count)
    assert before > 0
    result = pg(DOWN, check=False)
    assert result.returncode != 0 and "keep schema and roll back the application" in result.stderr
    assert _json(pg, count) == before


def test_rollback_refuses_marks_or_objects_then_removes_everything(pg):
    pg(SQL)
    user = str(uuid4())
    pg(f"INSERT INTO public.users VALUES ('{user}'); INSERT INTO public.library_marks "
       f"(user_id, shelf, item_key, kind) VALUES ('{user}', 'writing_sample', 'remote-learning', 'saved');")
    result = pg(DOWN, check=False)
    assert result.returncode != 0 and "library_marks has learner rows" in result.stderr
    pg("DELETE FROM public.library_marks; INSERT INTO storage.objects (bucket_id, name) "
       "VALUES ('library-media', 'task1/a.png');")
    result = pg(DOWN, check=False)
    assert result.returncode != 0 and "still has objects" in result.stderr
    pg("DELETE FROM storage.objects;" + TOPIC)
    pg(DOWN)
    remaining = _json(pg, """SELECT json_agg(relname) FROM pg_class WHERE relnamespace = 'public'::regnamespace
                             AND relname IN ('library_topics','writing_samples','writing_sample_slug_history',
                                             'speaking_samples','library_marks');""")
    assert remaining is None
    assert _json(pg, "SELECT json_agg(id) FROM storage.buckets;") == ["writing-images"]
    assert _json(pg, "SELECT count(*) FROM pg_policy WHERE polrelid = 'storage.objects'::regclass;") == 0
    pg(SQL)
