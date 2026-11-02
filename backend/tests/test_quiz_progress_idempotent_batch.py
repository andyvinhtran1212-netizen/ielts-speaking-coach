"""PC-J435: batched /progress is idempotent per ``client_id``.

The browser now holds up to five answers of a timed single-attempt Course test
and replays a batch after a lost response, a keepalive on pagehide or a reload
from its outbox. Every replay must store each answer once, count its KP
evidence once, and still ACK the number of rows sent (``course-runner.js``
treats ``ack.attempts !== batch.length`` as a failed save).

Two layers:
* ``log_progress`` against a stateful fake that applies the same
  ``ON CONFLICT (client_id) DO NOTHING RETURNING`` rule as both write paths
  (timed RPC and untimed PostgREST upsert);
* the real migration-279 RPC on a local PostgreSQL, so the fake's rule is the
  database's rule (skipped without PostgreSQL, required in CI via REQUIRE_PG).
"""

from __future__ import annotations

import json
import uuid

import pytest

from services import quiz_service
from tests.test_migration_279_superseded_timed_course_progress import (
    _SCHEMA as _SCHEMA_279,
    _SCHEMA_NAME as _SCHEMA_NAME_279,
    _function_sql as _function_sql_279,
    _have_pg,
    _psql,
)

_USER = "11111111-1111-1111-1111-111111111111"
_BANK = "22222222-2222-2222-2222-222222222222"
_KEY = {f"q{i}": i % 4 for i in range(1, 9)}


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db: "_StatefulDb", table: str):
        self.db, self.table = db, table
        self.op, self.filters, self.rows = "select", [], None

    def select(self, _columns):
        self.op = "select"
        return self

    def eq(self, column, value):
        self.filters.append((column, {value}))
        return self

    def in_(self, column, values):
        self.filters.append((column, set(values)))
        return self

    def upsert(self, rows, on_conflict=None, ignore_duplicates=False):
        assert on_conflict == "client_id" and ignore_duplicates is True
        self.op, self.rows = "upsert", rows
        return self

    def execute(self):
        if self.op == "upsert":
            assert self.table == "quiz_attempts"
            self.db.writes.append(("upsert", len(self.rows)))
            return _Result(self.db.insert(self.rows))
        source = self.db.questions if self.table == "quiz_questions" else self.db.attempts
        return _Result([dict(row) for row in source
                        if all(str(row.get(col)) in {str(v) for v in values}
                               for col, values in self.filters)])


class _Rpc:
    def __init__(self, db, params):
        self.db, self.params = db, params

    def execute(self):
        self.db.writes.append(("rpc", len(self.params["p_attempts"])))
        return _Result(self.db.insert(self.params["p_attempts"]))


class _StatefulDb:
    """``quiz_attempts`` with the mig-119 unique ``client_id``."""

    def __init__(self):
        self.attempts: list[dict] = []
        self.writes: list[tuple[str, int]] = []
        self.questions = [{"bank_id": _BANK, "qid": qid, "answer": answer,
                           "explain": "giải thích " + qid, "why_wrong": None}
                          for qid, answer in _KEY.items()]

    def table(self, name):
        return _Query(self, name)

    def rpc(self, name, params):
        assert name == "quiz_insert_timed_course_attempts"
        return _Rpc(self, params)

    def insert(self, rows):
        # INSERT ... ON CONFLICT (client_id) DO NOTHING RETURNING *: a row whose
        # client_id is already stored — by an earlier call or earlier in this
        # same statement — is skipped and not returned.
        seen = {row["client_id"] for row in self.attempts}
        inserted = []
        for row in rows:
            if row["client_id"] in seen:
                continue
            seen.add(row["client_id"])
            stored = dict(row)
            self.attempts.append(stored)
            inserted.append(dict(stored))
        return inserted


@pytest.fixture()
def course(monkeypatch):
    db = _StatefulDb()
    evidence: list[list[dict]] = []
    state = {"policy": None}

    def owned(session_id, user_id):
        return {"id": session_id, "user_id": user_id, "bank_id": _BANK,
                "class_assignment_item_id": "item-1", "grammar_reset_at": None}

    monkeypatch.setattr(quiz_service, "supabase_admin", db)
    monkeypatch.setattr(quiz_service, "_owned_session", owned)
    monkeypatch.setattr(quiz_service, "_grammar_bank_for_session", lambda session: None)
    monkeypatch.setattr(quiz_service, "_assert_quiz_progress_writable",
                        lambda session: dict(state["policy"]))
    monkeypatch.setattr(quiz_service, "_record_quiz_kp_evidence",
                        lambda user_id, bank_id, rows: evidence.append(list(rows)))

    def configure(*, timed: bool, mode: str):
        state["policy"] = {"timed": timed, "course": True, "completion_mode": mode}

    def send(rows, session_id="sess-1"):
        return quiz_service.log_progress(
            user_id=_USER, session_id=session_id,
            attempts=[dict(row) for row in rows], word_stats=[],
        )

    return {"db": db, "evidence": evidence, "configure": configure, "send": send}


def _rows(qids, *, given="1"):
    return [{
        "client_id": str(uuid.uuid5(uuid.NAMESPACE_URL, qid)),
        "item_key": "k-" + qid, "qid": qid, "skill": "B01", "type": "mcq",
        "subtype": "B1", "is_correct": False, "answer_given": given,
        "response_time_ms": 900.5, "attempt_no": 1,
    } for qid in qids]


_PATHS = [
    pytest.param(True, quiz_service.COURSE_COMPLETION_SINGLE_ATTEMPT, "rpc",
                 id="timed-single-attempt-rpc"),
    pytest.param(False, quiz_service.COURSE_COMPLETION_SINGLE_ATTEMPT, "upsert",
                 id="untimed-single-attempt-upsert"),
    pytest.param(False, quiz_service.COURSE_COMPLETION_MASTERY, "upsert",
                 id="mastery-upsert"),
]


@pytest.mark.parametrize("timed, mode, path", _PATHS)
def test_replayed_batch_stores_each_answer_once_and_acks_the_rows_sent(course, timed, mode, path):
    course["configure"](timed=timed, mode=mode)
    batch = _rows(["q1", "q2", "q3", "q4", "q5"])
    first = course["send"](batch)
    replay = course["send"](batch)          # lost ACK / keepalive / outbox replay
    assert [kind for kind, _ in course["db"].writes] == [path, path]
    assert len(course["db"].attempts) == 5
    assert len({row["client_id"] for row in course["db"].attempts}) == 5
    # The browser's ACK check compares with the rows it SENT, so a pure replay
    # must not look like a failed save.
    assert first["attempts"] == replay["attempts"] == 5
    # KP evidence sees only newly inserted rows: no double count on replay.
    assert [len(rows) for rows in course["evidence"]] == [5, 0]
    if mode == quiz_service.COURSE_COMPLETION_MASTERY:
        # Mastery replays still get the stored verdict of every row (J411R2).
        assert len(replay["feedback"]) == 5
    else:
        assert "feedback" not in first and "feedback" not in replay


@pytest.mark.parametrize("timed, mode, path", _PATHS)
def test_overlapping_batches_store_the_union(course, timed, mode, path):
    course["configure"](timed=timed, mode=mode)
    first = course["send"](_rows(["q1", "q2", "q3", "q4", "q5"]))
    second = course["send"](_rows(["q3", "q4", "q5", "q6", "q7", "q8"]))
    assert sorted(row["qid"] for row in course["db"].attempts) == [
        "q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"]
    assert (first["attempts"], second["attempts"]) == (5, 6)
    assert [sorted(row["qid"] for row in rows) for rows in course["evidence"]] == [
        ["q1", "q2", "q3", "q4", "q5"], ["q6", "q7", "q8"]]


@pytest.mark.parametrize("timed, mode, path", _PATHS)
def test_duplicate_client_id_inside_one_batch_is_stored_once(course, timed, mode, path):
    course["configure"](timed=timed, mode=mode)
    row = _rows(["q1"])[0]
    out = course["send"]([row, dict(row)])
    assert len(course["db"].attempts) == 1
    assert out["attempts"] == 2
    assert [len(rows) for rows in course["evidence"]] == [1]


@pytest.mark.parametrize("timed", [True, False])
def test_single_attempt_batch_is_graded_like_single_row_requests(course, timed):
    course["configure"](timed=timed, mode=quiz_service.COURSE_COMPLETION_SINGLE_ATTEMPT)
    qids = ["q1", "q2", "q3", "q4", "q5"]
    picks = ["1", "0", "3", "0", "2"]
    batch = []
    for qid, given in zip(qids, picks):
        row = _rows([qid], given=given)[0]
        row["is_correct"] = True            # a client claim the server must ignore
        batch.append(row)
    course["send"](batch, session_id="sess-batch")
    for row in batch:
        single = {**row, "client_id": str(uuid.uuid4())}
        course["send"]([single], session_id="sess-single")
    graded = {}
    for row in course["db"].attempts:
        graded.setdefault(row["session_id"], {})[row["qid"]] = row["is_correct"]
    expected = {qid: int(given) == _KEY[qid] for qid, given in zip(qids, picks)}
    assert graded["sess-batch"] == expected
    assert graded["sess-single"] == expected
    assert True in expected.values() and False in expected.values()


# ── The real migration-279 RPC ─────────────────────────────────────────────

_SCHEMA_NAME = "progress_probe_j435"
pg = pytest.mark.skipif(not _have_pg(), reason="local PostgreSQL is required for the RPC probe")


@pytest.fixture()
def timed_rpc():
    schema = _SCHEMA_279.replace(_SCHEMA_NAME_279, _SCHEMA_NAME)
    function = _function_sql_279().replace(_SCHEMA_NAME_279, _SCHEMA_NAME)
    _psql(schema + function)
    user_id, student_id, cohort_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    bank_id, assignment_id, item_id, session_id = (
        uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4())
    _psql(f"""
    SET search_path = {_SCHEMA_NAME};
    INSERT INTO quiz_banks VALUES ('{bank_id}', 'course');
    INSERT INTO class_assignments VALUES (
        '{assignment_id}', '{cohort_id}', '{bank_id}', 'course', 'published',
        NULL, NULL, '{{"time_limit_minutes": 60}}'::jsonb);
    INSERT INTO students VALUES ('{student_id}', '{user_id}');
    INSERT INTO student_cohort_memberships VALUES ('{student_id}', '{cohort_id}', TRUE);
    INSERT INTO class_assignment_items (id, assignment_id, student_id, opened_at, mastery)
    VALUES ('{item_id}', '{assignment_id}', '{student_id}',
            clock_timestamp() - interval '5 minutes', '{{}}'::jsonb);
    INSERT INTO quiz_sessions (id, user_id, bank_id, class_assignment_item_id, kind)
    VALUES ('{session_id}', '{user_id}', '{bank_id}', '{item_id}', 'run');
    """)

    def call(rows) -> int:
        payload = json.dumps(rows).replace("'", "''")
        out = _psql(
            f"SELECT count(*) FROM {_SCHEMA_NAME}.quiz_insert_timed_course_attempts("
            f"'{session_id}', '{user_id}', '{payload}'::jsonb);")
        return int(out.stdout.strip())

    def stored() -> list[str]:
        out = _psql(f"SELECT qid FROM {_SCHEMA_NAME}.quiz_attempts ORDER BY qid;")
        return out.stdout.split()

    try:
        yield {"call": call, "stored": stored}
    finally:
        _psql(f"DROP SCHEMA IF EXISTS {_SCHEMA_NAME} CASCADE;", check=False)


def _rpc_rows(qids):
    return [{key: row[key] for key in (
        "client_id", "item_key", "qid", "skill", "type", "subtype",
        "is_correct", "answer_given", "attempt_no")} | {"response_time_ms": 900}
        for row in _rows(qids)]


@pg
def test_timed_rpc_replay_overlap_and_inner_duplicate_insert_each_answer_once(timed_rpc):
    first = _rpc_rows(["q1", "q2", "q3", "q4", "q5"])
    assert timed_rpc["call"](first) == 5
    assert timed_rpc["call"](first) == 0, "a replayed batch RETURNs no new row"
    assert timed_rpc["call"](_rpc_rows(["q3", "q4", "q5", "q6", "q7", "q8"])) == 3
    duplicate = _rpc_rows(["q9"])
    assert timed_rpc["call"](duplicate + duplicate) == 1, (
        "DO NOTHING skips a duplicate inside one statement instead of failing it")
    assert timed_rpc["stored"]() == [f"q{i}" for i in range(1, 10)]
