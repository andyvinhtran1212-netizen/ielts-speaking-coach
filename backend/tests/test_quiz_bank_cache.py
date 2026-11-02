"""PC-J434: versioned per-bank content cache behind `get_bank_for_play`.

30 learners opening the same 300-question FINAL used to re-read and re-parse
the whole question set (~500 KB) on every open. The content is the same for
every learner, so it is cached per process under the bank's content version,
which is read fresh with the bank row on every request.

Pinned here:
  (a) a warm open no longer reads `quiz_questions`, `vocab_cards` (within the
      TTL) or counts writing questions;
  (b) stripping/sealing/URL attachment never reaches the cached copy;
  (c) every version change, and the TTL, reloads; the course importer's
      two-step write cannot pin old questions to the new bank timestamp;
  (d) concurrent cold opens load once and never mix learners;
  (e) the payload is the same as without the cache for every bank kind.
"""
from __future__ import annotations

import copy
import json
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from fastapi import HTTPException
from unittest.mock import MagicMock

import database
import test_quiz_bank_student_payload as payload_tests
from services import quiz_service
from services.quiz_bank_cache import VersionedContentCache

BANK = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
TOPIC = "tttttttt-0000-4000-8000-000000000001"
T0 = "2026-10-30T12:00:00+00:00"
T1 = "2026-10-30T13:00:00+00:00"
T2 = "2026-10-30T14:00:00+00:00"


def _question(n, **over):
    row = {
        "id": f"row-{n}", "qid": f"q{n}", "item_key": f"word{n}", "type": "mcq",
        "subtype": "B1", "input": "choice", "skill": "B01", "pair": None,
        "counts_toward_mastery": True, "prompt": f"Prompt {n}",
        "options": [{"text": "a", "tags": ["x"]}, {"text": "b", "tags": []}],
        "segments": ["s", "eg"], "mask": "s_", "points": 1, "order": n,
        "audio_url": None, "grammar_article_slug": None, "answer": 1,
        "accept": ["b"], "explain": f"Because {n}.",
        "why_wrong": {"0": {"why": "trap"}}, "hint": "h", "pairs": [["l", "r"]],
        "created_at": T0,
    }
    row.update(over)
    return row


class _Clock:
    def __init__(self): self.now = 1000.0
    def __call__(self): return self.now


class _DB:
    """Fake of the PostgREST reads `get_bank_for_play` makes. Unlike the older
    fakes it answers the version embeds (`qn`/`qmax`) from its own question
    rows, the way PostgREST does, and returns a fresh JSON copy per read."""

    def __init__(self, bank, questions, cards=(), item_row=None, assignment=None):
        self.bank = dict(bank)
        self.questions = [dict(q) for q in questions]
        self.cards = [dict(c) for c in cards]
        self.item_row = item_row
        self.assignment = assignment
        self.calls: Counter = Counter()
        self.question_delay = 0.0
        self.fail_questions = False
        self.fail_cards = False
        self._lock = threading.Lock()

    def table(self, name):
        return _Query(self, name)

    def rpc(self, name, params):
        self.record(("rpc", name))
        return MagicMock(execute=lambda: MagicMock(data=[]))

    def record(self, key):
        with self._lock:
            self.calls[key] += 1


class _Query:
    def __init__(self, db, table):
        self.db, self.table_name = db, table
        self.columns, self.count, self.filters = "", None, {}

    def select(self, *columns, count=None, **_k):
        self.columns, self.count = ",".join(columns), count
        return self

    def eq(self, column, value):
        self.filters[column] = value
        return self

    def order(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self

    def execute(self):
        db, name = self.db, self.table_name
        if name == "quiz_banks":
            db.record(("quiz_banks", "select"))
            row = copy.deepcopy(db.bank)
            if "qn:quiz_questions(count)" in self.columns:
                newest = max((q["created_at"] for q in db.questions), default=None)
                row["qn"] = [{"count": len(db.questions)}]
                row["qmax"] = [{"created_at": newest}] if newest else []
            return MagicMock(data=[row])
        if name == "quiz_questions":
            if self.count is not None:  # bank_has_writing
                db.record(("quiz_questions", "count"))
                n = sum(1 for q in db.questions if q.get("type") == self.filters.get("type"))
                return MagicMock(data=[], count=n)
            db.record(("quiz_questions", "select"))
            if db.question_delay:
                time.sleep(db.question_delay)
            if db.fail_questions:
                raise RuntimeError("questions read failed")
            rows = [{k: v for k, v in q.items() if k != "created_at"} for q in db.questions]
            return MagicMock(data=json.loads(json.dumps(rows)))
        if name == "vocab_cards":
            db.record(("vocab_cards", "select"))
            if db.fail_cards:
                raise RuntimeError("vocab read failed")
            return MagicMock(data=json.loads(json.dumps(db.cards)))
        if name == "class_assignment_items":
            db.record((name, "select"))
            return MagicMock(data=[copy.deepcopy(db.item_row)] if db.item_row else [])
        if name == "class_assignments":
            db.record((name, "select"))
            return MagicMock(data=[copy.deepcopy(db.assignment)] if db.assignment else [])
        raise AssertionError(f"unexpected table {name}")


def _vocab_db():
    bank = {"id": BANK, "code": "V-L01", "skill_area": "vocab", "topic_id": TOPIC,
            "is_published": True, "meta": {}, "updated_at": T0,
            "grammar_new_starts_enabled": True}
    questions = [
        _question(1, prompt="Listen {{audio}} and type", audio_url="old.mp3"),
        _question(2, grammar_article_slug="present-perfect"),
        _question(3),
    ]
    cards = [{"headword": "word1", "audio_headword": "new.mp3", "lists": None,
              "source": "L01 Group A", "collocations": ["c1"]}]
    return _DB(bank, questions, cards)


def _grammar_db():
    bank = {"id": BANK, "code": "G-1", "skill_area": "grammar", "topic_id": TOPIC,
            "is_published": True, "meta": {}, "updated_at": T0,
            "grammar_canonical_code": None, "grammar_new_starts_enabled": True}
    return _DB(bank, [_question(1), _question(2)])


def _course_item(user="u", *, passed=False):
    return {
        "id": f"item-{user}", "assignment_id": "asg-1", "opened_at": None,
        "due_at": None, "accepting": True,
        "passed_at": "2026-10-30T01:00:00Z" if passed else None,
        "submitted_at": None, "mastery": {"attempts": []},
        "content_config": {"completion_mode": "single_attempt", "time_limit_minutes": 30},
    }


def _course_db(*, passed=False):
    bank = {"id": BANK, "code": "C1-FINAL", "skill_area": "course", "topic_id": None,
            "is_published": False, "meta": {"assessment_kind": "final"},
            "updated_at": T0, "grammar_new_starts_enabled": True}
    questions = [_question(n) for n in range(1, 6)] + [
        _question(6, type="writing", input="text")]
    item = _course_item(passed=passed)
    return _DB(bank, questions,
               item_row={k: item[k] for k in ("passed_at", "submitted_at", "mastery")}
               | {"score": None},
               assignment={"id": "asg-1", "status": "published", "publish_at": None,
                           "due_at": None, "content_config": item["content_config"]})


@pytest.fixture
def course_helpers(monkeypatch):
    """Per-learner helpers (unchanged by PC-J434) keyed by user id."""
    seen = {"writing_expected": []}

    def item_for(bank_id, user_id, assignment_item_id=None):
        return _course_item(user_id, passed=seen.get("passed", False))

    def action(item, assignment, *, bank_id, user_id, writing_expected=None, **_k):
        seen["writing_expected"].append(writing_expected)
        return "continue"

    monkeypatch.setattr(quiz_service, "_assignment_item_for_review", item_for)
    monkeypatch.setattr(quiz_service, "course_assignment_action_with_session_truth", action)
    monkeypatch.setattr(quiz_service, "_ensure_timed_course_session",
                        lambda it, *, user_id, **_k: (it, f"sess-{user_id}"))
    return seen


def _play(monkeypatch, db, user=None):
    monkeypatch.setattr(quiz_service, "supabase_admin", db)
    return quiz_service.get_bank_for_play(BANK, user_id=user)


def _stable(payload):
    """Drop the timer's wall-clock sample, the only field that differs
    between two reads of the same state."""
    out = copy.deepcopy(payload)
    (out.get("mastery") or {}).pop("sampled_at", None)
    return out


def _cached_rows():
    return json.loads(quiz_service._bank_content_cache._entries[BANK].blob)


# ── (a) DB queries per request ──────────────────────────────────────────────

def _requests(monkeypatch, db, user=None):
    out = []
    for _ in range(2):
        db.calls.clear()
        _play(monkeypatch, db, user)
        out.append(dict(db.calls))
    return out


def test_a_warm_self_study_open_reads_only_the_bank_row(monkeypatch):
    db = _vocab_db()
    cold, warm = _requests(monkeypatch, db)
    assert cold == {("quiz_banks", "select"): 1, ("quiz_questions", "select"): 1,
                    ("vocab_cards", "select"): 1}
    assert warm == {("quiz_banks", "select"): 1}


def test_a_warm_grammar_open_reads_only_the_bank_row(monkeypatch):
    cold, warm = _requests(monkeypatch, _grammar_db())
    assert cold == {("quiz_banks", "select"): 1, ("quiz_questions", "select"): 1}
    assert warm == {("quiz_banks", "select"): 1}


def test_a_warm_course_open_keeps_learner_reads_and_drops_content_reads(
        monkeypatch, course_helpers):
    course_helpers["passed"] = True  # passed, not submitted: asks "has writing?"
    db = _course_db(passed=True)
    cold, warm = _requests(monkeypatch, db, user="u1")
    learner = {("class_assignment_items", "select"): 1,
               ("class_assignments", "select"): 1}
    assert cold == {("quiz_banks", "select"): 1, ("quiz_questions", "select"): 1,
                    **learner}
    assert warm == {("quiz_banks", "select"): 1, **learner}
    # `bank_has_writing` (a second quiz_questions read) is gone from this path,
    # and the answer it gave is unchanged.
    assert ("quiz_questions", "count") not in cold
    # Each open asks twice: the preflight (no writing argument), then the
    # canonical refresh with the answer.
    assert course_helpers["writing_expected"] == [None, True, None, True]


def test_a_writing_check_read_failure_stays_unknown(monkeypatch, course_helpers):
    course_helpers["passed"] = True
    db = _course_db(passed=True)
    db.fail_questions = True
    monkeypatch.setattr(quiz_service, "supabase_admin", db)
    with pytest.raises(HTTPException) as exc:
        quiz_service.get_bank_for_play(BANK, user_id="u1")
    assert exc.value.status_code == 500
    assert exc.value.detail == "Lỗi truy vấn câu hỏi. Vui lòng thử lại."
    assert None in course_helpers["writing_expected"]
    assert BANK not in quiz_service._bank_content_cache._entries


def test_a_real_client_sends_one_light_version_query(monkeypatch):
    """The pinned postgrest client: the version rides on the bank read
    (`qmax.order`/`qmax.limit` = newest `created_at` only), and a warm open
    sends no `quiz_questions` request at all."""
    client = database.supabase_admin
    seen = []
    rows = [{k: v for k, v in _question(n).items() if k != "created_at"} for n in (1, 2)]

    def handle(request):
        seen.append(request.url)
        table = request.url.path.rsplit("/", 1)[-1]
        if table == "quiz_banks":
            return httpx.Response(200, json=[{
                "id": BANK, "code": "G-1", "skill_area": "grammar", "topic_id": None,
                "is_published": True, "meta": {}, "updated_at": T0,
                "grammar_canonical_code": None, "grammar_new_starts_enabled": True,
                "qn": [{"count": 2}], "qmax": [{"created_at": T0}],
            }])
        if table == "quiz_questions":
            return httpx.Response(200, json=rows)
        raise AssertionError(table)

    with httpx.Client(transport=httpx.MockTransport(handle), http1=True, http2=False) as transport:
        monkeypatch.setattr(client, "_postgrest", client._init_postgrest_client(
            rest_url=str(client.rest_url), headers=client.options.headers,
            schema=client.options.schema,
            timeout=client.options.postgrest_client_timeout, http_client=transport,
        ))
        monkeypatch.setattr(quiz_service, "supabase_admin", client)
        first = quiz_service.get_bank_for_play(BANK)
        second = quiz_service.get_bank_for_play(BANK)

    assert [u.path.rsplit("/", 1)[-1] for u in seen] == [
        "quiz_banks", "quiz_questions", "quiz_banks"]
    params = seen[0].params
    assert params["select"].startswith(
        quiz_service._STUDENT_BANK_COLUMNS.replace(" ", "") + ",")
    assert params["select"].endswith(
        ",qn:quiz_questions(count),qmax:quiz_questions(created_at)")
    assert params["qmax.order"] == "created_at.desc"
    assert params["qmax.limit"] == "1"
    assert params["limit"] == "1"
    assert first == second
    assert "qn" not in first["bank"] and "qmax" not in first["bank"]


# ── (b) the cache is never poisoned by the per-request steps ────────────────

def test_b_course_sealing_and_payload_mutation_never_reach_the_cache(
        monkeypatch, course_helpers):
    db = _course_db()
    stored = [{k: v for k, v in q.items() if k != "created_at"} for q in db.questions]
    first = _play(monkeypatch, db, user="u1")
    assert all(not ({"answer", "accept", "explain", "why_wrong", "hint", "pairs",
                     "mask", "segments"} & set(q)) for q in first["questions"])
    # The entry is exactly what the DB returned, writing model answer included.
    assert _cached_rows() == stored
    assert quiz_service._bank_content_cache._entries[BANK].extra is True
    expected = _stable(first)

    for q in first["questions"]:
        q["options"][0]["text"] = "MUTATED"
        q["options"][0]["tags"].append("MUTATED")
        q["prompt"] = None
    first["bank"]["meta"]["assessment_kind"] = "MUTATED"

    second = _play(monkeypatch, db, user="u1")
    assert _stable(second) == expected
    assert _cached_rows() == stored


def test_b_a_self_study_open_after_a_sealed_one_keeps_its_keys(
        monkeypatch, course_helpers):
    course = _course_db()
    _play(monkeypatch, course, user="u1")
    grammar = _grammar_db()
    grammar.bank["id"] = BANK
    # Same process, same bank id, new content version (different DB).
    grammar.bank["updated_at"] = T1
    out = _play(monkeypatch, grammar, user="u1")
    for q in out["questions"]:
        for key in ("answer", "accept", "explain", "why_wrong", "hint", "mask", "segments"):
            assert key in q, key


def test_b_strip_writing_and_url_steps_work_on_a_copy(monkeypatch):
    db = _vocab_db()
    db.questions.append(_question(4, type="writing"))
    first = _play(monkeypatch, db)
    by_qid = {q["qid"]: q for q in first["questions"]}
    assert by_qid["q1"]["audio_url"] == "new.mp3"       # resolved from the card
    assert by_qid["q4"]["explain"] is None and by_qid["q4"]["answer"] is None
    cached = {q["qid"]: q for q in _cached_rows()}
    assert cached["q1"]["audio_url"] == "old.mp3"
    assert cached["q4"]["explain"] == "Because 4." and cached["q4"]["answer"] == 1
    assert "article_url" not in cached["q2"]

    first["word_cards"]["word1"]["collocations"].append("MUTATED")
    first["word_cards"]["word1"]["audio_headword"] = "MUTATED"
    second = _play(monkeypatch, db)
    assert second["word_cards"]["word1"]["collocations"] == ["c1"]
    assert {q["qid"]: q for q in second["questions"]}["q1"]["audio_url"] == "new.mp3"


# ── (c) version and TTL ─────────────────────────────────────────────────────

def _loads(db):
    return db.calls[("quiz_questions", "select")]


@pytest.mark.parametrize("change", [
    "updated_at", "count_down", "count_up", "newest_created_at", "new_starts_flag",
])
def test_c_every_version_field_reloads(monkeypatch, change):
    db = _vocab_db()
    _play(monkeypatch, db)
    _play(monkeypatch, db)
    assert _loads(db) == 1
    if change == "updated_at":
        db.bank["updated_at"] = T1
    elif change == "count_down":
        db.questions.pop()
    elif change == "count_up":
        db.questions.append(_question(9))
    elif change == "newest_created_at":
        db.questions[0]["created_at"] = T1
    else:
        db.bank["grammar_new_starts_enabled"] = False
    _play(monkeypatch, db)
    assert _loads(db) == 2


def test_c_course_importer_two_step_write_shows_the_new_questions(monkeypatch):
    """`import_course_exercise_bank.py`: UPDATE quiz_banks, then (separate
    request) `quiz_replace_questions`. An open in between must not pin the old
    questions to the new bank timestamp."""
    db = _grammar_db()
    _play(monkeypatch, db)
    db.bank["updated_at"] = T1                                  # step 1
    between = _play(monkeypatch, db)
    assert [q["prompt"] for q in between["questions"]] == ["Prompt 1", "Prompt 2"]
    db.questions = [_question(1, prompt="New 1", created_at=T2),  # step 2
                    _question(2, prompt="New 2", created_at=T2)]
    after = _play(monkeypatch, db)
    assert [q["prompt"] for q in after["questions"]] == ["New 1", "New 2"]


def test_c_in_place_update_is_bounded_by_the_ttl(monkeypatch):
    """Offline fix scripts UPDATE a question row in place: no version field
    moves, so the TTL is what bounds the stale window."""
    clock = _Clock()
    monkeypatch.setattr(quiz_service._bank_content_cache, "_clock", clock)
    db = _grammar_db()
    _play(monkeypatch, db)
    db.questions[0]["explain"] = "Fixed."
    clock.now += quiz_service._BANK_CONTENT_TTL_SECONDS - 1
    assert _play(monkeypatch, db)["questions"][0]["explain"] == "Because 1."
    clock.now += 1
    assert _play(monkeypatch, db)["questions"][0]["explain"] == "Fixed."
    assert _loads(db) == 2
    assert quiz_service._BANK_CONTENT_TTL_SECONDS <= 300


def test_c_word_cards_follow_tts_pregen_within_their_ttl(monkeypatch):
    clock = _Clock()
    monkeypatch.setattr(quiz_service._word_cards_cache, "_clock", clock)
    db = _vocab_db()
    _play(monkeypatch, db)
    db.cards[0]["audio_headword"] = "pregen.mp3"
    clock.now += quiz_service._WORD_CARDS_TTL_SECONDS - 1
    assert _play(monkeypatch, db)["word_cards"]["word1"]["audio_headword"] == "new.mp3"
    clock.now += 1
    out = _play(monkeypatch, db)
    assert out["word_cards"]["word1"]["audio_headword"] == "pregen.mp3"
    assert out["questions"][0]["audio_url"] == "pregen.mp3"
    assert quiz_service._WORD_CARDS_TTL_SECONDS <= 120


def test_c_a_failed_read_is_not_cached(monkeypatch):
    db = _vocab_db()
    db.fail_questions = True
    with pytest.raises(HTTPException) as exc:
        _play(monkeypatch, db)
    assert exc.value.status_code == 500
    assert exc.value.detail == "Lỗi truy vấn câu hỏi. Vui lòng thử lại."
    db.fail_questions = False
    assert len(_play(monkeypatch, db)["questions"]) == 3


def test_c_failed_word_card_read_degrades_and_is_not_cached(monkeypatch):
    db = _vocab_db()
    db.fail_cards = True
    assert _play(monkeypatch, db)["word_cards"] == {}
    db.fail_cards = False
    assert "word1" in _play(monkeypatch, db)["word_cards"]


# ── (d) many threads ────────────────────────────────────────────────────────

def test_d_concurrent_cold_opens_load_once_and_never_mix_learners(
        monkeypatch, course_helpers):
    db = _course_db()
    db.question_delay = 0.05
    monkeypatch.setattr(quiz_service, "supabase_admin", db)
    users = [f"u{i}" for i in range(32)]
    barrier = threading.Barrier(len(users))
    expected_questions = None

    def learner(user):
        barrier.wait(timeout=10)
        results = []
        for _ in range(20):
            results.append(quiz_service.get_bank_for_play(BANK, user_id=user))
        return user, results

    with ThreadPoolExecutor(max_workers=len(users)) as pool:
        outcomes = list(pool.map(learner, users))

    assert db.calls[("quiz_questions", "select")] == 1
    for user, results in outcomes:
        for out in results:
            assert out["mastery"]["item_id"] == f"item-{user}"
            assert out["mastery"]["initial_session_id"] == f"sess-{user}"
            if expected_questions is None:
                expected_questions = out["questions"]
            assert out["questions"] == expected_questions
    assert len(expected_questions) == 6


def test_d_waiters_retry_after_a_failed_load():
    cache = VersionedContentCache("t", ttl_seconds=60, max_entries=4)
    calls = []
    gate = threading.Event()

    def loader():
        calls.append(1)
        if len(calls) == 1:
            gate.wait(5)
            raise RuntimeError("first load fails")
        return {"ok": True}, None

    def get():
        try:
            return cache.get("k", 1, loader)[0]
        except RuntimeError as exc:
            return str(exc)

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(get) for _ in range(4)]
        time.sleep(0.1)
        gate.set()
        results = [f.result(timeout=10) for f in futures]
    assert results.count("first load fails") == 1
    assert results.count({"ok": True}) == 3
    assert len(calls) == 2


# ── cache mechanics ─────────────────────────────────────────────────────────

def test_lru_is_bounded_and_unknown_version_bypasses_the_cache():
    cache = VersionedContentCache("t", ttl_seconds=60, max_entries=2)
    for key in ("a", "b", "c"):
        cache.get(key, 1, lambda: ([key], None))
    assert list(cache._entries) == ["b", "c"]
    loads = []
    for _ in range(2):
        cache.get("x", None, lambda: (loads.append(1) or [], None))
    assert len(loads) == 2 and "x" not in cache._entries


def test_bank_content_cache_limits():
    assert quiz_service._bank_content_cache.max_entries <= 32
    assert quiz_service._bank_content_cache.ttl_seconds <= 300


def test_cache_logs_loads_without_content(monkeypatch, caplog):
    db = _grammar_db()
    with caplog.at_level("INFO", logger="services.quiz_bank_cache"):
        _play(monkeypatch, db)
        _play(monkeypatch, db)
    lines = [r.getMessage() for r in caplog.records
             if r.name == "services.quiz_bank_cache"]
    assert len(lines) == 1 and "reason=cold" in lines[0]
    assert "Because" not in lines[0] and "Prompt" not in lines[0]


# ── (e) payload identical to the uncached read ──────────────────────────────

class _VersionedRecordingFake(payload_tests._RecordingFake):
    """The J411R2 payload fake, answering the version embeds like PostgREST."""

    def __init__(self, responses=None):
        responses = dict(responses or {})
        questions = responses.get(("quiz_questions", "select")) or []
        responses[("quiz_banks", "select")] = [
            {**row, "qn": [{"count": len(questions)}],
             "qmax": [{"created_at": max(q["created_at"] for q in questions)}]}
            for row in responses.get(("quiz_banks", "select")) or []
        ]
        super().__init__(responses)


@pytest.mark.parametrize("case", sorted(payload_tests._CASES))
def test_e_payload_is_unchanged_by_the_cache(monkeypatch, case):
    baseline, plain = payload_tests._get_bank(monkeypatch, case)
    assert baseline.status_code == 200, baseline.text
    assert BANK not in quiz_service._bank_content_cache._entries  # no version → no cache

    monkeypatch.setattr(payload_tests, "_RecordingFake", _VersionedRecordingFake)
    cold, fake = payload_tests._get_bank(monkeypatch, case)
    assert BANK in quiz_service._bank_content_cache._entries
    warm, warm_fake = payload_tests._get_bank(monkeypatch, case)
    assert cold.status_code == warm.status_code == 200
    assert _stable(cold.json()) == _stable(baseline.json())
    assert _stable(warm.json()) == _stable(baseline.json())
    assert not any(c["table"] == "quiz_questions" for c in warm_fake.calls)
