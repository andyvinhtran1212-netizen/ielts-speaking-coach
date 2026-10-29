"""Exercise migrations 234--238 together on disposable, loopback PostgreSQL.

TEST_PG_URL selects the local cluster; REQUIRE_PG=1 makes its absence fatal.
Each case owns and drops a fresh schema. Product functions/triggers are loaded
from the migrations, including the shared timestamp trigger from migration 033.
"""

import json
import os
import re
from pathlib import Path
from uuid import uuid4

import pytest

from test_migration_240_core_attempt_evidence import psql


MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
FILES = (
    "234_vocab_curated_identity_and_editorial.sql",
    "235_vocab_curated_tasks_attempts_mastery.sql",
    "236_vocab_curated_recommendations_and_flags.sql",
    "237_vocab_curated_speaking_signal_maps.sql",
    "238_vocab_curated_pilot_metrics.sql",
)
REVIEW_TYPES = ("language", "pedagogy", "assessment")
TASK_DIMENSIONS = (
    ("meaning_recall", "meaning_recall"),
    ("error_repair", "usage_control"),
    ("controlled_gap", "usage_control"),
    ("productive_transfer", "productive_transfer"),
)


def _literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, (dict, list)):
        return _literal(json.dumps(value, ensure_ascii=False)) + "::jsonb"
    return "'" + str(value).replace("'", "''") + "'"


def _tasks():
    return [
        dict(task_type=kind, dimension=dimension, prompt=f"Synthetic task {i}",
             answer_key={"accepted": ["take part in"]}, explanation_vi="Tham gia.")
        for i, (kind, dimension) in enumerate(TASK_DIMENSIONS, 1)
    ]


def _build(schema):
    # Only pre-234 dependencies. Never load the application or connect Supabase.
    dependencies = f"""
        CREATE SCHEMA {schema};
        SET search_path = {schema}, pg_temp;
        DO $$ BEGIN
            CREATE ROLE anon;
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        DO $$ BEGIN
            CREATE ROLE authenticated;
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        DO $$ BEGIN
            CREATE ROLE service_role BYPASSRLS;
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        CREATE TABLE users (id uuid PRIMARY KEY, feature_flags jsonb);
        CREATE TABLE knowledge_points (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            kp_type text NOT NULL CHECK (kp_type IN ('grammar', 'vocab', 'skill')),
            ref_slug text NOT NULL, anchor text NOT NULL DEFAULT '',
            level text NOT NULL DEFAULT '', UNIQUE (kp_type, ref_slug, anchor)
        );
        CREATE TABLE vocab_cards (id uuid PRIMARY KEY);
        CREATE TABLE runtime_flags (key text PRIMARY KEY, enabled boolean, note text);
        CREATE TABLE sessions (id uuid PRIMARY KEY, user_id uuid REFERENCES users(id));
        CREATE TABLE responses (id uuid PRIMARY KEY, session_id uuid REFERENCES sessions(id));
    """
    shared_sql = (MIGRATIONS / "033_writing_coach_tables.sql").read_text()
    timestamp_function = re.search(
        r"CREATE OR REPLACE FUNCTION update_updated_at_column\(\).*?\$\$ LANGUAGE plpgsql;",
        shared_sql, re.S,
    )
    assert timestamp_function, "Shared timestamp trigger must come from migration 033"
    sql = dependencies + timestamp_function.group()
    for filename in FILES:
        sql += "\n" + (MIGRATIONS / filename).read_text().replace(
            "public.", f"{schema}."
        ).replace("search_path = public,", f"search_path = {schema},")
    sql += f"""
        GRANT USAGE ON SCHEMA {schema} TO service_role;
        GRANT ALL ON ALL TABLES IN SCHEMA {schema} TO service_role;
    """
    psql(sql)


class Catalog:
    def __init__(self, schema):
        self.schema = schema
        self.reviewers = [str(uuid4()) for _ in REVIEW_TYPES]
        self.author, self.learner, self.other = (str(uuid4()) for _ in range(3))
        ids = self.reviewers + [self.author, self.learner, self.other]
        psql(f"INSERT INTO {schema}.users (id) VALUES " +
             ",".join(f"('{user}')" for user in ids))

    def query(self, sql):
        return psql(f"SET search_path = {self.schema}, pg_temp; " + sql)

    def rpc(self, function, *args, now=False):
        arguments = [_literal(value) for value in args]
        if now:
            arguments.append("now()")
        return json.loads(self.query(
            f"SET ROLE service_role; SELECT {function}({','.join(arguments)})"
        ))

    def rows(self, table, where="true"):
        return json.loads(self.query(
            f"SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]') "
            f"FROM {table} t WHERE {where}"
        ))

    def unit(self):
        slug = "take-part-" + uuid4().hex
        return self.rpc(
            "fn_create_vocab_learning_unit", slug, "take part in", "learning_unit",
            "participate", "take-part-in", "describe participation", slug, "B1",
            None, None, self.author,
        )

    def version(self, unit, tasks=None):
        return self.rpc(
            "fn_create_vocab_unit_version", unit["id"], {"title": "Tham gia"},
            uuid4().hex, [{"url": "https://example.org/reference"}],
            _tasks() if tasks is None else tasks, "Synthetic revision", self.author,
        )

    def approve(self, version, reviewers=None, types=REVIEW_TYPES):
        reviewers = self.reviewers if reviewers is None else reviewers
        values = ",".join(
            f"('{version['id']}', '{reviewer}', '{kind}', 'approved')"
            for reviewer, kind in zip(reviewers, types)
        )
        self.query("INSERT INTO vocab_unit_version_reviews "
                   "(version_id, reviewer_id, review_type, decision) VALUES " + values)

    def publish(self, version):
        return self.rpc("fn_publish_vocab_unit_version", version["id"], self.author, now=True)

    def published(self):
        unit = self.unit()
        version = self.version(unit)["version"]
        self.approve(version)
        result = self.publish(version)
        tasks = sorted(self.rows("vocab_unit_tasks", f"version_id='{version['id']}'"),
                       key=lambda task: task["sequence"])
        return result["unit"], result["version"], tasks

    def record_sql(self, task, *, attempt=None, response=None, score=1, correct=True):
        args = [self.learner, task["id"], attempt or str(uuid4()),
                {"answer": "take part in"} if response is None else response,
                {"feedback": "Synthetic server result"}, score, correct, "test-grader-v1"]
        return "SELECT fn_record_vocab_unit_attempt(" + ",".join(map(_literal, args)) + ",now())"

    def record(self, task, **kwargs):
        return json.loads(self.query("SET ROLE service_role; " + self.record_sql(task, **kwargs)))

    def recommendation(self, unit, *, status="pending", user=None):
        rid = str(uuid4())
        self.query(f"""INSERT INTO vocab_unit_recommendations
            (id, user_id, unit_id, source_kind, source_id, reason_vi, status)
            VALUES ('{rid}', '{user or self.learner}', '{unit['id']}',
                    'manual', '{rid}', 'Luyện cách diễn đạt tham gia.', '{status}')""")
        # AFTER INSERT changes are canonical in a subsequent statement, not the
        # outer INSERT RETURNING tuple.
        return self.rows("vocab_unit_recommendations", f"id='{rid}'")[0]


@pytest.fixture
def db():
    try:
        available = psql("SELECT 1") == "1"
    except RuntimeError:
        available = False
    if not available:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Disposable local PostgreSQL required for curated vocabulary tests")
        pytest.skip("Disposable local PostgreSQL unavailable")
    assert psql("SELECT usesuper FROM pg_user WHERE usename=current_user") == "t"
    schema = "vocab_curated_" + uuid4().hex
    try:
        _build(schema)
        yield Catalog(schema)
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


@pytest.mark.parametrize("status", ["draft", "in_review"])
def test_create_review_publish_with_all_guards_and_timestamp_triggers(db, status):
    unit = db.unit()
    assert unit["status"] == "draft" and unit["current_published_version_id"] is None
    assert unit["problem_tags"] == unit["learner_tags"] == []
    kp = db.rows("knowledge_points", f"id='{unit['kp_id']}'")[0]
    assert (kp["kp_type"], kp["ref_slug"], kp["level"]) == ("vocab_unit", unit["unit_slug"], "B1")
    created = db.version(unit)
    version = created["version"]
    assert created["task_count"] == 4
    assert version["status"] == "draft" and version["version_number"] == 1
    assert version["authored_by"] == db.author and version["content"] == {"title": "Tham gia"}
    db.query(f"UPDATE vocab_unit_versions SET status='{status}' WHERE id='{version['id']}'")
    db.approve(version)
    result = db.publish(version)
    published, current = result["version"], result["unit"]
    assert published == db.rows("vocab_unit_versions")[0]
    assert current == db.rows("vocab_learning_units")[0]
    assert published["status"] == current["status"] == "published"
    assert current["current_published_version_id"] == published["id"] == version["id"]
    assert published["published_by"] == db.author and published["published_at"] is not None
    assert published["updated_at"] >= version["updated_at"]
    assert current["updated_at"] >= unit["updated_at"]
    assert db.query("SELECT bool_and(updated_at >= created_at AND updated_at <= now()) "
                    "FROM vocab_unit_versions") == "t"
    tasks = db.rows("vocab_unit_tasks")
    assert len(tasks) == 4 and all(task["status"] == "active" for task in tasks)
    assert {(t["task_type"], t["dimension"]) for t in tasks} == set(TASK_DIMENSIONS)
    reviews = db.rows("vocab_unit_version_reviews")
    assert {r["reviewer_id"] for r in reviews} == set(db.reviewers)
    assert {r["review_type"] for r in reviews} == set(REVIEW_TYPES)
    event, = db.rows("vocab_unit_publication_events")
    assert (event["unit_id"], event["version_id"], event["action"], event["actor_id"]) == (
        unit["id"], version["id"], "publish", db.author)
    assert event["created_at"] == published["published_at"]


@pytest.mark.parametrize("table,operation,error", [
    ("vocab_unit_versions", "update", "published_vocab_version_is_immutable"),
    ("vocab_unit_versions", "delete", "published_vocab_version_is_immutable"),
    *[(table, operation, error)
      for table, error in [("vocab_unit_version_reviews", "published_vocab_review_is_immutable"),
                           ("vocab_unit_tasks", "published_vocab_task_is_immutable")]
      for operation in ("insert", "update", "delete")],
])
def test_published_artifacts_reject_mutations(db, table, operation, error):
    _, version, _ = db.published()
    before = db.rows(table)
    if operation == "insert":
        if table == "vocab_unit_version_reviews":
            sql = f"""INSERT INTO {table} (version_id, reviewer_id, review_type, decision)
                VALUES ('{version['id']}', '{db.author}', 'language', 'approved')"""
        else:
            sql = f"""INSERT INTO {table}
                (version_id, sequence, task_type, dimension, prompt, answer_key, explanation_vi)
                VALUES ('{version['id']}', 5, 'meaning_recall', 'meaning_recall', 'new', '{{}}', 'Mới')"""
    elif operation == "delete":
        sql = f"DELETE FROM {table} WHERE id='{before[0]['id']}'"
    else:
        column, value = {
            "vocab_unit_versions": ("change_note", "modified"),
            "vocab_unit_version_reviews": ("notes", "modified"),
            "vocab_unit_tasks": ("prompt", "modified"),
        }[table]
        sql = f"UPDATE {table} SET {column}='{value}' WHERE id='{before[0]['id']}'"
    with pytest.raises(RuntimeError, match=error):
        db.query("SET ROLE service_role; " + sql)
    assert db.rows(table) == before


@pytest.mark.parametrize("table,error", [
    ("vocab_unit_version_reviews", "published_vocab_review_is_immutable"),
    ("vocab_unit_tasks", "published_vocab_task_is_immutable"),
])
def test_published_children_cannot_be_moved_to_draft_version(db, table, error):
    unit, published, _ = db.published()
    # An empty draft avoids unrelated sequence/reviewer uniqueness conflicts.
    draft = db.version(unit, tasks=[])["version"]
    child = db.rows(table, f"version_id='{published['id']}'")[0]
    before = db.rows(table)
    with pytest.raises(RuntimeError, match=error):
        db.query(f"SET ROLE service_role; UPDATE {table} "
                 f"SET version_id='{draft['id']}' WHERE id='{child['id']}'")
    assert db.rows(table) == before


def test_reviewed_draft_can_still_be_edited_and_deleted(db):
    unit, published, _ = db.published()
    draft = db.version(unit)["version"]
    assert draft["version_number"] == 2
    db.approve(draft)
    db.query(f"""UPDATE vocab_unit_versions SET change_note='edited draft' WHERE id='{draft['id']}';
        UPDATE vocab_unit_version_reviews SET notes='edited review' WHERE version_id='{draft['id']}';
        UPDATE vocab_unit_tasks SET prompt='edited task' WHERE version_id='{draft['id']}';""")
    assert db.rows("vocab_unit_versions", f"id='{draft['id']}'")[0]["change_note"] == "edited draft"
    assert all(r["notes"] == "edited review" for r in db.rows(
        "vocab_unit_version_reviews", f"version_id='{draft['id']}'"))
    assert all(t["prompt"] == "edited task" for t in db.rows(
        "vocab_unit_tasks", f"version_id='{draft['id']}'"))
    db.query(f"""DELETE FROM vocab_unit_version_reviews WHERE version_id='{draft['id']}';
        DELETE FROM vocab_unit_tasks WHERE version_id='{draft['id']}';
        DELETE FROM vocab_unit_versions WHERE id='{draft['id']}';""")
    assert db.rows("vocab_unit_versions") == [published]


def test_publish_second_version_then_rollback_only_changes_unit_and_event(db):
    unit, first, _ = db.published()
    second = db.version(unit)["version"]
    db.approve(second)
    assert db.publish(second)["unit"]["current_published_version_id"] == second["id"]
    before = db.rows("vocab_unit_versions")
    # Every UPDATE, even setting the same value, would fail the active guard.
    rolled = db.rpc("fn_rollback_vocab_unit_version", unit["id"], first["id"], db.author, now=True)
    assert rolled == db.rows("vocab_learning_units")[0]
    assert rolled["status"] == "published" and rolled["current_published_version_id"] == first["id"]
    assert rolled["updated_at"] >= unit["updated_at"]
    assert db.rows("vocab_unit_versions") == before
    events = db.rows("vocab_unit_publication_events")
    assert sorted((e["version_id"], e["action"]) for e in events) == sorted([
        (first["id"], "publish"), (second["id"], "publish"), (first["id"], "rollback")])
    assert all(e["unit_id"] == unit["id"] and e["actor_id"] == db.author for e in events)


@pytest.mark.parametrize("gate", REVIEW_TYPES)
def test_publish_requires_each_approval(db, gate):
    version = db.version(db.unit())["version"]
    db.approve(version, types=[kind for kind in REVIEW_TYPES if kind != gate])
    with pytest.raises(RuntimeError, match=f"missing_approval:{gate}"):
        db.publish(version)
    assert db.rows("vocab_unit_publication_events") == []


@pytest.mark.parametrize("state", ["missing", "published", "archived"])
def test_publish_rejects_unpublishable_version(db, state):
    if state == "published":
        _, version, _ = db.published()
    elif state == "archived":
        version = db.version(db.unit())["version"]
        db.query(f"UPDATE vocab_unit_versions SET status='archived' WHERE id='{version['id']}'")
    else:
        version = {"id": str(uuid4())}
    before = db.rows("vocab_unit_publication_events")
    with pytest.raises(RuntimeError, match="version_not_publishable"):
        db.publish(version)
    assert db.rows("vocab_unit_publication_events") == before


@pytest.mark.parametrize("error", [
    "changes_requested", "reviewers_must_be_distinct", "missing_task_count",
    "missing_task_dimension", "task_dimension_mismatch",
])
def test_publish_validation_is_atomic(db, error):
    unit = db.unit()
    tasks = _tasks()
    if error == "missing_task_count":
        tasks.pop()
    elif error == "missing_task_dimension":
        tasks[-1] = tasks[0].copy()
    elif error == "task_dimension_mismatch":
        # Keep all three dimensions present so the preceding gate passes.
        tasks[1]["dimension"] = "meaning_recall"
    version = db.version(unit, tasks)["version"]
    db.approve(version, [db.reviewers[0]] * 3 if error == "reviewers_must_be_distinct" else None)
    if error == "changes_requested":
        db.query(f"""INSERT INTO vocab_unit_version_reviews
            (version_id, reviewer_id, review_type, decision)
            VALUES ('{version['id']}', '{db.author}', 'language', 'changes_requested')""")
    before = db.rows("vocab_unit_versions")
    with pytest.raises(RuntimeError, match=error):
        db.publish(version)
    assert db.rows("vocab_unit_versions") == before
    assert db.rows("vocab_learning_units") == [unit]
    assert db.rows("vocab_unit_publication_events") == []


@pytest.mark.parametrize("error", ["unit_not_found", "tasks_must_be_array"])
def test_create_version_rejects_invalid_input_without_partial_rows(db, error):
    unit = db.unit() if error == "tasks_must_be_array" else {"id": str(uuid4())}
    with pytest.raises(RuntimeError, match=error):
        db.version(unit, {} if error == "tasks_must_be_array" else None)
    assert db.rows("vocab_unit_versions") == db.rows("vocab_unit_tasks") == []


@pytest.mark.parametrize("target", ["missing", "draft", "other_unit"])
def test_rollback_requires_published_version_of_same_unit(db, target):
    unit, first, _ = db.published()
    if target == "draft":
        version = db.version(unit)["version"]
    elif target == "other_unit":
        _, version, _ = db.published()
    else:
        version = {"id": str(uuid4())}
    before = db.rows("vocab_unit_publication_events")
    with pytest.raises(RuntimeError, match="published_version_not_found"):
        db.rpc("fn_rollback_vocab_unit_version", unit["id"], version["id"], db.author, now=True)
    assert db.rows("vocab_learning_units", f"id='{unit['id']}'")[0]["current_published_version_id"] == first["id"]
    assert db.rows("vocab_unit_publication_events") == before


def test_rollback_defensive_missing_unit_error(db):
    # The FK normally makes this branch unreachable. Seed one orphan only in
    # this disposable schema, with replication mode restored before the RPC.
    unit_id, version_id = str(uuid4()), str(uuid4())
    db.query(f"""BEGIN; SET LOCAL session_replication_role = replica;
        INSERT INTO vocab_unit_versions (id, unit_id, version_number, status, content, content_hash)
        VALUES ('{version_id}', '{unit_id}', 1, 'published', '{{}}', 'orphan'); COMMIT;""")
    assert db.query("SHOW session_replication_role") == "origin"
    with pytest.raises(RuntimeError, match="unit_not_found"):
        db.rpc("fn_rollback_vocab_unit_version", unit_id, version_id, db.author, now=True)
    assert db.rows("vocab_unit_publication_events") == []


def test_record_attempt_replay_preserves_receipt_and_mastery_after_new_publication(db):
    unit, _, tasks = db.published()
    attempt = str(uuid4())
    first = db.record(tasks[0], attempt=attempt)
    assert first["duplicate"] is False
    assert first["attempt"]["task_id"] == tasks[0]["id"]
    assert first["attempt"]["response"] == {"answer": "take part in"}
    assert first["attempt"]["result"] == {"feedback": "Synthetic server result"}
    assert first["attempt"]["score"] == 1 and first["attempt"]["is_correct"] is True
    mastery = first["mastery"]
    assert (mastery["user_id"], mastery["kp_id"], mastery["dimension"]) == (
        db.learner, unit["kp_id"], "meaning_recall")
    assert (mastery["state"], mastery["attempt_count"], mastery["success_count"]) == ("acquiring", 1, 1)
    assert mastery["last_attempt_at"] == mastery["last_success_at"] == first["attempt"]["created_at"]
    assert db.query("SELECT next_review_at = last_attempt_at + interval '2 days' "
                    "FROM user_kp_dimension_mastery") == "t"
    replay = db.record(tasks[0], attempt=attempt)
    assert replay == {**first, "duplicate": True}
    second = db.version(unit)["version"]
    db.approve(second)
    db.publish(second)
    assert db.record(tasks[0], attempt=attempt) == replay
    assert db.rows("vocab_unit_attempts") == [first["attempt"]]
    assert db.rows("user_kp_dimension_mastery") == [mastery]


@pytest.mark.parametrize("error", [
    "score_out_of_range", "attempt_id_reused_for_different_task",
    "attempt_id_reused_for_different_payload", "attempt_task_missing", "task_not_active",
])
def test_record_attempt_rejections_do_not_change_attempts_or_mastery(db, error):
    unit, _, tasks = db.published()
    kwargs = {}
    task = tasks[0]
    if error.startswith("attempt_"):
        kwargs["attempt"] = str(uuid4())
        saved = db.record(task, **kwargs)
        if error == "attempt_id_reused_for_different_task":
            task = tasks[1]
        elif error == "attempt_id_reused_for_different_payload":
            kwargs["response"] = {"answer": "changed"}
        else:
            # Both FKs remain valid, but the task/version pair is inconsistent.
            other_version = db.version(unit)["version"]
            db.query(f"UPDATE vocab_unit_attempts SET version_id='{other_version['id']}' "
                     f"WHERE id='{saved['attempt']['id']}'")
    elif error == "score_out_of_range":
        kwargs["score"] = 1.01
    else:
        task = db.rows("vocab_unit_tasks", f"version_id='{db.version(unit)['version']['id']}'")[0]
    attempts, mastery = db.rows("vocab_unit_attempts"), db.rows("user_kp_dimension_mastery")
    with pytest.raises(RuntimeError, match=error):
        db.record(task, **kwargs)
    assert db.rows("vocab_unit_attempts") == attempts
    assert db.rows("user_kp_dimension_mastery") == mastery


@pytest.mark.parametrize("initial_status", ["pending", "opened"])
def test_final_attempt_completes_recommendation_inside_same_transaction(db, initial_status):
    unit, _, tasks = db.published()
    rec = db.recommendation(unit, status=initial_status)
    other = db.recommendation(unit, user=db.other)
    dismissed = db.recommendation(unit, status="dismissed")
    for task in tasks[:-1]:
        db.record(task)
        current = db.rows("vocab_unit_recommendations", f"id='{rec['id']}'")[0]
        assert current["status"] == initial_status and current["completed_at"] is None
    # Repeating one task cannot stand in for attempting the final distinct task.
    db.record(tasks[0])
    assert db.rows("vocab_unit_recommendations", f"id='{rec['id']}'")[0] == current
    sql = db.record_sql(tasks[-1], score=0, correct=False)
    observed = db.query(f"""BEGIN; SET LOCAL ROLE service_role;
        DO $$ BEGIN PERFORM {sql.removeprefix('SELECT ')}; END $$;
        SELECT jsonb_build_object('recommendation', to_jsonb(r),
            'last_attempt_at', (SELECT max(created_at) FROM vocab_unit_attempts))
        FROM vocab_unit_recommendations r WHERE id='{rec['id']}'; ROLLBACK;""")
    observed = json.loads(observed)
    completed = observed["recommendation"]
    assert completed["status"] == "completed"
    assert completed["completed_at"] == observed["last_attempt_at"]
    assert completed["updated_at"] > current["updated_at"]
    # The attempt and lifecycle UPDATE both roll back; no background job is involved.
    assert db.rows("vocab_unit_recommendations", f"id='{rec['id']}'")[0] == current
    final = db.record(tasks[-1], score=0, correct=False)
    persisted = db.rows("vocab_unit_recommendations", f"id='{rec['id']}'")[0]
    assert persisted["status"] == "completed"
    assert persisted["completed_at"] == final["attempt"]["created_at"]
    assert db.rows("vocab_unit_recommendations", f"id='{other['id']}'")[0] == other
    assert db.rows("vocab_unit_recommendations", f"id='{dismissed['id']}'")[0] == dismissed


def test_recommendation_insert_after_all_tasks_completes_immediately(db):
    unit, _, tasks = db.published()
    for task in tasks:
        db.record(task)
    rec = db.recommendation(unit)
    assert rec["status"] == "completed"
    assert rec["completed_at"] == rec["created_at"]
    assert rec["updated_at"] >= rec["created_at"]
    result = db.rpc("fn_open_vocab_unit_recommendation", db.learner, rec["id"], unit["unit_slug"], now=True)
    assert result["status"] == "completed" and result["opened_at"] is None
    assert db.rows("vocab_unit_recommendations")[0] == rec


def test_open_recommendation_is_idempotent_and_preserves_first_open_time(db):
    unit, _, _ = db.published()
    rec = db.recommendation(unit)
    result = db.rpc("fn_open_vocab_unit_recommendation", db.learner, rec["id"], unit["unit_slug"], now=True)
    assert result["status"] == "opened" and result["opened_at"] is not None
    assert result["completed_at"] is None
    opened = db.rows("vocab_unit_recommendations")[0]
    assert opened["opened_at"] == result["opened_at"]
    assert opened["updated_at"] > rec["updated_at"]
    assert db.rpc("fn_open_vocab_unit_recommendation", db.learner, rec["id"], unit["unit_slug"], now=True) == result
    assert db.rows("vocab_unit_recommendations")[0] == opened


@pytest.mark.parametrize("mismatch", ["id", "owner", "slug"])
def test_open_recommendation_requires_matching_identity_owner_and_slug(db, mismatch):
    unit, _, _ = db.published()
    rec = db.recommendation(unit)
    with pytest.raises(RuntimeError, match="recommendation_not_found"):
        db.rpc("fn_open_vocab_unit_recommendation",
               db.other if mismatch == "owner" else db.learner,
               str(uuid4()) if mismatch == "id" else rec["id"],
               "wrong-slug" if mismatch == "slug" else unit["unit_slug"], now=True)
    assert db.rows("vocab_unit_recommendations")[0] == rec


def test_set_cohort_persists_flags_and_audit_events(db):
    db.query(f"UPDATE users SET feature_flags='{{\"unrelated\": true}}' WHERE id='{db.learner}'")
    for enabled in (True, False):
        result = db.rpc("fn_set_vocab_curated_cohort", db.learner, enabled, db.author, now=True)
        assert result["user_id"] == db.learner and result["vocab_curated_enabled"] is enabled
        assert db.rows("users", f"id='{db.learner}'")[0]["feature_flags"] == {
            "unrelated": True, "vocab_curated_enabled": enabled}
        events = db.rows("vocab_curated_cohort_events")
        event, = [event for event in events if event["enabled"] is enabled]
        assert (event["user_id"], event["changed_by"], event["created_at"]) == (
            db.learner, db.author, result["changed_at"])
    assert len(events) == 2
    # Existing users may have NULL feature_flags, as on this untouched fixture user.
    db.rpc("fn_set_vocab_curated_cohort", db.other, True, db.author, now=True)
    assert db.rows("users", f"id='{db.other}'")[0]["feature_flags"] == {"vocab_curated_enabled": True}


def test_set_cohort_rejects_unknown_user_without_event(db):
    before = db.rows("users")
    with pytest.raises(RuntimeError, match="user_not_found"):
        db.rpc("fn_set_vocab_curated_cohort", str(uuid4()), True, db.author, now=True)
    assert db.rows("users") == before
    assert db.rows("vocab_curated_cohort_events") == []
