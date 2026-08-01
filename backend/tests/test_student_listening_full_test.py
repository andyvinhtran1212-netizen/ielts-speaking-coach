"""Tests for Sprint 13.5 — student full-test layer.

Covers:
  * services.listening_test_grader      — pure-function grading
  * GET    /api/listening/tests          — published-only list with audio
  * GET    /api/listening/tests/{id}     — answer-key strip + signed URL
  * POST   /api/listening/tests/{id}/attempts
  * PATCH  /api/listening/tests/attempts/{id}/answers
  * POST   /api/listening/tests/attempts/{id}/submit
  * POST   /api/listening/tests/attempts/{id}/check   — Luyện nhanh instant check
  * GET    /api/listening/tests/attempts/{id}
"""

from __future__ import annotations

import asyncio
import json
from uuid import uuid4

import pytest
from fastapi import HTTPException

from routers import listening as listening_router
from services import listening_test_grader as grader


# ── Grader: answer normalisation + matching ────────────────────────────────


def test_grader_normalize_strips_whitespace_and_lowercases():
    assert grader.normalize_answer("  Brighton  ") == "brighton"
    assert grader.normalize_answer("PASTA") == "pasta"


def test_grader_match_uk_us_spelling_variants():
    # User typed US, expected UK — accepted.
    assert grader.answer_matches("color", "colour", [])
    # User typed UK, expected US — accepted (canonicalised both ways).
    assert grader.answer_matches("colour", "color", [])
    # Unrelated word — rejected.
    assert not grader.answer_matches("colour", "brighton", [])


def test_grader_match_alternatives_slash_separated():
    # Answer key from Sprint 13.4.2 surfaces `30 / thirty` as
    # alternatives=["30", "thirty"].
    assert grader.answer_matches("30", "30", ["thirty"])
    assert grader.answer_matches("thirty", "30", ["thirty"])
    assert not grader.answer_matches("forty", "30", ["thirty"])


def test_grader_match_hyphenated_word_counts_as_one():
    # No special handling needed — normalise keeps the hyphen.
    assert grader.answer_matches("self-correction", "self-correction", [])
    assert grader.answer_matches("Self-Correction", "self-correction", [])


def test_grader_match_rejects_contractions():
    # Andy's marking guide rejects contractions even if expanded form matches.
    assert not grader.answer_matches("don't know", "do not know", [])
    assert grader.answer_matches("do not know", "do not know", [])


def test_grader_match_case_insensitive_and_punctuation_trimmed():
    assert grader.answer_matches("LIBRARY.", "library", [])
    assert grader.answer_matches('"BN1 6QR"', "BN1 6QR", [])


def test_grader_empty_user_answer_is_incorrect():
    assert not grader.answer_matches("", "anything", [])
    assert not grader.answer_matches(None, "anything", [])


def _mm_key():
    """collect_answer_key over a single mcq_multi exercise (Choose TWO: 21=B,
    22=D) → both rows tagged with a shared group_key + template_kind."""
    rows = [{
        "payload": {
            "template_kind": "mcq_multi",
            "answers": [
                {"q_num": 21, "answer": "B"},
                {"q_num": 22, "answer": "D"},
            ],
        },
    }]
    return grader.collect_answer_key(rows)


def test_p4_mcq_multi_collect_tags_group_key():
    ak = _mm_key()
    assert [a["q_num"] for a in ak] == [21, 22]
    assert all(a["template_kind"] == "mcq_multi" for a in ak)
    assert ak[0]["group_key"] == ak[1]["group_key"] and ak[0]["group_key"]


def test_p4_mcq_multi_any_order_full_credit():
    """Both letters correct in EITHER order → 2 points (any-order set)."""
    ak = _mm_key()
    res = grader.grade_attempt(
        [{"q_num": 21, "user_answer": "D"}, {"q_num": 22, "user_answer": "B"}], ak)
    assert res["score"] == 2, "swapped B/D still scores 2 (order-independent)"


def test_p4_mcq_multi_one_right_one_wrong_is_one_point():
    ak = _mm_key()
    res = grader.grade_attempt(
        [{"q_num": 21, "user_answer": "B"}, {"q_num": 22, "user_answer": "X"}], ak)
    assert res["score"] == 1, "per-letter: 1 correct + 1 wrong = 1 point"


def test_p4_mcq_multi_duplicate_pick_not_double_counted():
    ak = _mm_key()
    res = grader.grade_attempt(
        [{"q_num": 21, "user_answer": "B"}, {"q_num": 22, "user_answer": "B"}], ak)
    assert res["score"] == 1, "picking B twice consumes the single expected B once"


def test_grader_band_estimate_full_score():
    assert grader.band_estimate(40) == 9.0
    assert grader.band_estimate(39) == 9.0
    assert grader.band_estimate(35) == 8.0
    assert grader.band_estimate(26) == 6.5
    assert grader.band_estimate(10) == 4.0
    assert grader.band_estimate(9) is None


def test_grader_trap_rollup_counts_each_mechanism_separately():
    per_q = [
        {"q_num": 1, "correct": True,  "trap_mechanisms": ["paraphrase_t0"]},
        {"q_num": 2, "correct": False, "trap_mechanisms": ["self_correction", "paraphrase_t0"]},
        {"q_num": 3, "correct": True,  "trap_mechanisms": []},
        {"q_num": 4, "correct": False, "trap_mechanisms": ["self_correction"]},
    ]
    out = grader.rollup_trap_analytics(per_q)
    assert out["paraphrase_t0"]   == {"caught": 1, "missed": 1}
    assert out["self_correction"] == {"caught": 0, "missed": 2}
    assert "" not in out                                            # empty strings skipped


def test_grader_section_breakdown_bins_by_q_num_decade():
    per_q = [
        {"q_num": 1, "correct": True},  {"q_num": 5, "correct": False},
        {"q_num": 11, "correct": True}, {"q_num": 20, "correct": True},
        {"q_num": 21, "correct": False},
        {"q_num": 35, "correct": True}, {"q_num": 40, "correct": True},
    ]
    out = grader.section_breakdown(per_q)
    assert out["s1"] == {"correct": 1, "total": 2}
    assert out["s2"] == {"correct": 2, "total": 2}
    assert out["s3"] == {"correct": 0, "total": 1}
    assert out["s4"] == {"correct": 2, "total": 2}


def test_grader_grade_attempt_end_to_end_partial_score():
    answer_key = [
        {"q_num": 1, "answer": "Brighton",    "alternatives": [],          "trap_mechanisms": ["paraphrase_t0"]},
        {"q_num": 2, "answer": "BN1 6QR",     "alternatives": [],          "trap_mechanisms": ["self_correction"]},
        {"q_num": 3, "answer": "Tuesday",     "alternatives": [],          "trap_mechanisms": []},
        {"q_num": 4, "answer": "30",          "alternatives": ["thirty"],  "trap_mechanisms": []},
    ]
    user_answers = [
        {"q_num": 1, "user_answer": "brighton"},        # correct
        {"q_num": 2, "user_answer": "BN1 6QP"},         # incorrect (trap)
        {"q_num": 3, "user_answer": "Tuesday"},         # correct
        {"q_num": 4, "user_answer": "thirty"},          # correct (alternative)
    ]
    res = grader.grade_attempt(user_answers, answer_key)
    assert res["score"] == 3
    assert res["max_score"] == 4
    assert res["per_question"][1]["correct"] is False
    assert res["trap_analytics"]["paraphrase_t0"] == {"caught": 1, "missed": 0}
    assert res["trap_analytics"]["self_correction"] == {"caught": 0, "missed": 1}


def test_grader_strip_answer_keys_removes_payload_answers():
    rows = [{
        "id": "ex1", "content_id": "c1",
        "exercise_type": "dictation",
        "payload": {
            "variant":   "dictation_gap_fill",
            "questions": [{"q_num": 1, "prompt": "City"}],
            "answers":   [{"q_num": 1, "answer": "Brighton"}],
            "metadata":  {"map_description": "..."},
        },
    }]
    safe = grader.strip_answer_keys(rows)
    assert safe[0]["payload"].get("answers") is None or "answers" not in safe[0]["payload"]
    # questions + metadata preserved
    assert safe[0]["payload"]["questions"]
    assert safe[0]["payload"]["metadata"]
    # Original untouched.
    assert rows[0]["payload"]["answers"]


def test_grader_collect_answer_key_flattens_exercise_rows():
    rows = [
        {"payload": {"answers": [{"q_num": 1, "answer": "A"}, {"q_num": 2, "answer": "B"}]}},
        {"payload": {"answers": [{"q_num": 11, "answer": "B"}]}},
        {"payload": {}},                                # no answers — skipped
    ]
    flat = grader.collect_answer_key(rows)
    assert [r["q_num"] for r in flat] == [1, 2, 11]


# ── Router fake supabase ───────────────────────────────────────────────────


class _Resp:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


class _Q:
    def __init__(self, fake, name):
        self.fake = fake
        self.name = name
        self._mode = "select"
        self._payload = None
        self._eq: list[tuple[str, object]] = []
        self._in: list[tuple[str, list]] = []
        self._is: list[tuple[str, object]] = []
        self._range: tuple[int, int] | None = None

    def select(self, *_a, **_kw): self._mode = "select"; return self
    def insert(self, p): self._mode = "insert"; self._payload = p; return self
    def update(self, p): self._mode = "update"; self._payload = p; return self
    def delete(self): self._mode = "delete"; return self
    def eq(self, c, v): self._eq.append((c, v)); return self
    def in_(self, c, vs): self._in.append((c, list(vs))); return self
    # PostgREST `.is_(col, "null")` — how the standalone resume lookup excludes
    # mock attempts. Modelled rather than stubbed so the test exercises the real
    # filter: an absent key and an explicit None both count as NULL.
    def is_(self, c, v): self._is.append((c, v)); return self
    # Mig 157 — the list endpoint filters eq("test_type", ...) on the real
    # column; seed rows carry test_type='full' so the eq-match keeps them.
    def or_(self, *_a, **_kw): return self
    def limit(self, *_a, **_kw): return self
    def order(self, *_a, **_kw): return self
    def range(self, s, e): self._range = (s, e); return self

    def _match(self, r):
        for c, v in self._eq:
            if r.get(c) != v:
                return False
        for c, vs in self._in:
            if r.get(c) not in vs:
                return False
        for c, v in self._is:
            is_null = r.get(c) is None
            if str(v).lower() == "null" and not is_null:
                return False
            if str(v).lower() != "null" and is_null:
                return False
        return True

    def execute(self):
        rows = self.fake.tables.setdefault(self.name, [])
        if self._mode == "insert":
            payload = self._payload
            payloads = payload if isinstance(payload, list) else [payload]
            for p in payloads:
                rows.append(dict(p))
            return _Resp(payloads)
        if self._mode == "update":
            matched = [r for r in rows if self._match(r)]
            for r in matched:
                r.update(self._payload or {})
            return _Resp(matched)
        matched = [r for r in rows if self._match(r)]
        count = len(matched)
        if self._range:
            s, e = self._range
            matched = matched[s:e + 1]
        return _Resp(matched, count=count)


class _StorageBucket:
    def __init__(self, fake, name): self.fake = fake; self.name = name
    def create_signed_url(self, path, ttl):
        return {"signedURL": f"https://storage.test/{self.name}/{path}?ttl={ttl}"}


class _Storage:
    def __init__(self, fake): self.fake = fake
    def from_(self, name): return _StorageBucket(self.fake, name)


class _Fake:
    def __init__(self):
        self.tables = {
            "listening_tests":           [],
            "listening_content":         [],
            "listening_exercises":       [],
            "listening_test_attempts":   [],
        }
        self.storage = _Storage(self)

    def table(self, name): return _Q(self, name)

    # A4b (mig 161) — the answer write moved into a Postgres function so the
    # read-modify-write is atomic. The fake models the SAME semantics the SQL
    # implements, so these tests keep exercising real behaviour instead of
    # asserting against a stub: replace-by-q_num, keep sorted, only touch an
    # in_progress attempt, return the new count (None when nothing matched).
    def rpc(self, name, params):
        if name not in ("fn_upsert_listening_answer", "fn_insert_listening_answer_once"):
            raise AssertionError(f"unexpected rpc: {name}")
        rows = self.tables["listening_test_attempts"]
        row = next(
            (r for r in rows
             if r.get("id") == params["p_attempt_id"] and r.get("status") == "in_progress"),
            None,
        )
        if row is None:
            return _RpcResult(None)
        q = params["p_q_num"]

        # Mig 174 — first-attempt-wins sibling used by the Luyện nhanh runner.
        # Modelled to the SAME three-way contract as the SQL so these tests
        # exercise real behaviour: True = recorded, False = already answered,
        # None = no in_progress attempt (handled by the early return above).
        if name == "fn_insert_listening_answer_once":
            if any(str(a.get("q_num")) == str(q) for a in (row.get("answers") or [])):
                return _RpcResult(False)
            row["answers"] = (row.get("answers") or []) + [{
                "q_num": q,
                "user_answer": params["p_user_answer"] or "",
                "answered_at": "2026-01-01T00:00:00+00:00",
            }]
            row["answers"].sort(key=lambda a: a.get("q_num") or 0)
            return _RpcResult(True)

        answers = [a for a in (row.get("answers") or []) if str(a.get("q_num")) != str(q)]
        answers.append({
            "q_num": q,
            "user_answer": params["p_user_answer"] or "",
            "answered_at": "2026-01-01T00:00:00+00:00",
        })
        answers.sort(key=lambda a: a.get("q_num") or 0)
        row["answers"] = answers
        return _RpcResult(len(answers))


class _RpcResult:
    def __init__(self, data): self.data = data
    def execute(self): return self


def _patch(monkeypatch, user_id="user-1"):
    fake = _Fake()
    monkeypatch.setattr(listening_router, "supabase_admin", fake)
    monkeypatch.setattr(listening_router.settings, "LISTENING_AUDIO_BUCKET", "listening-audio")

    async def _user_auth(_authz):
        return {"id": user_id}
    monkeypatch.setattr(listening_router, "_require_auth", _user_auth)
    monkeypatch.setattr(listening_router, "get_supabase_user", _user_auth)
    return fake, "Bearer fake"


def _run(c): return asyncio.run(c)


def _seed_test(fake, **overrides):
    row = {
        "id":      str(uuid4()),
        "test_id": "ILR-LIS-001",
        "title":   "Pilot 01",
        "status":  "published",
        "themes":  {"s1": "Cookery", "s2": "Sports", "s3": "Project", "s4": "Lighting"},
        "accent_profile": ["BrE"],
        "band_target":    5.5,
        "audio_assembly_mode":          "full_premixed",
        "full_audio_storage_path":      "tests/x/full.mp3",
        "full_audio_duration_seconds":  1800,
        "assembled_audio_storage_path": None,
        "cue_points":                   [],
        "test_type":                    "full",   # mig 157 — cột thật
        # Mig 170 — NOT NULL DEFAULT false trong prod, nên seed phải có mặt:
        # thiếu khoá thì .eq("exam_only", False) không khớp và bài test xanh/đỏ
        # vì lý do sai, không phải vì hành vi.
        "exam_only":                    False,
        "created_at":                   "2026-05-21T00:00:00Z",
    }
    row.update(overrides)
    fake.tables["listening_tests"].append(row)
    return row


def _seed_sections_with_exercises(fake, test_id):
    """Seed 4 listening_content rows + 1 dictation exercise per section
    so the grader has an answer key to consume."""
    for n in (1, 2, 3, 4):
        content_id = f"content-{n}"
        fake.tables["listening_content"].append({
            "id":           content_id,
            "test_id":      test_id,
            "section_num":  n,
            "title":        f"Section {n}",
            "transcript":   "stub",
            "metadata":     {"narrator_intro": f"Section {n} intro."},
        })
        q_base = (n - 1) * 10
        fake.tables["listening_exercises"].append({
            "id":            f"ex-{n}",
            "content_id":    content_id,
            "exercise_type": "dictation",
            "order_num":     1,
            "payload": {
                "variant":     "dictation_gap_fill",
                "instruction": "Complete the form.",
                "questions":   [
                    {"q_num": q_base + i, "prompt": f"Q{q_base + i}"}
                    for i in range(1, 11)
                ],
                "answers": [
                    {"q_num": q_base + i, "answer": f"answer-{q_base + i}",
                     "alternatives": [], "trap_mechanisms": []}
                    for i in range(1, 11)
                ],
            },
        })


# ── GET /api/listening/tests ───────────────────────────────────────────────


def test_list_tests_excludes_drafts_and_no_audio(monkeypatch):
    fake, authz = _patch(monkeypatch)
    _seed_test(fake, test_id="A-1", status="published",
               full_audio_storage_path="tests/x/a.mp3")
    _seed_test(fake, test_id="A-2", status="draft",
               full_audio_storage_path="tests/x/draft.mp3")        # not published
    _seed_test(fake, test_id="A-3", status="published",
               full_audio_storage_path=None,
               assembled_audio_storage_path=None)                  # no audio

    out = _run(listening_router.list_published_listening_tests(
        limit=20, offset=0, authorization=authz,
    ))
    test_ids = {item["test_id"] for item in out["items"]}
    assert test_ids == {"A-1"}


def test_list_tests_carries_user_best_score_and_attempt_count(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    # Seed 2 attempts: one submitted score 35, one in-progress.
    fake.tables["listening_test_attempts"].extend([
        {"id": "a1", "test_id": test["id"], "user_id": "user-1",
         "status": "submitted",   "score": 35},
        {"id": "a2", "test_id": test["id"], "user_id": "user-1",
         "status": "in_progress", "score": None},
    ])
    out = _run(listening_router.list_published_listening_tests(
        limit=20, offset=0, authorization=authz,
    ))
    item = out["items"][0]
    assert item["user_best_score"] == 35
    assert item["user_attempt_count"] == 2


# ── GET /api/listening/tests/{id} ──────────────────────────────────────────


def test_get_test_detail_strips_answer_keys(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    _seed_sections_with_exercises(fake, test["id"])

    out = _run(listening_router.get_published_listening_test(
        test_id=test["id"], authorization=authz,
    ))
    # Audio URL present.
    assert out["audio_url"].startswith("https://storage.test/")
    # 4 sections.
    assert len(out["sections"]) == 4
    # Exercises returned WITHOUT answers.
    for sec in out["sections"]:
        for ex in sec["exercises"]:
            assert "answers" not in ex["payload"]
            assert ex["payload"].get("questions")


def test_get_test_detail_strips_map_description_from_plan_label(monkeypatch):
    """Sprint 13.5.8 — the student endpoint must remove ``map_description``
    (both at the payload root and under ``payload.metadata``) for every
    plan-label exercise. The description is admin-only AI-prompt input;
    leaking it would hand the student the answer key in prose.
    """
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)

    # Seed a single plan-label section with map_description present in
    # both locations so we can verify the strip covers both.
    fake.tables["listening_content"].append({
        "id":           "content-plan",
        "test_id":      test["id"],
        "section_num":  2,
        "title":        "Section 2",
        "transcript":   "stub",
        "metadata":     {"narrator_intro": "Section 2 intro."},
    })
    fake.tables["listening_exercises"].append({
        "id":            "ex-plan",
        "content_id":    "content-plan",
        "exercise_type": "plan_labelling",
        "order_num":     1,
        "payload": {
            "variant":          "mcq_letter_label",
            "template_kind":    "plan_label",
            "instruction":      "Label the map.",
            "map_description":  "A rectangular community hall with...",
            # Sprint 13.5.9 — curated AI prompt is admin-only metadata
            # and must be stripped alongside map_description.
            "map_image_custom_prompt": "## Curated prompt — north arrow at top-left.",
            "metadata": {
                "map_description": "duplicate at metadata level",
                "map_image_custom_prompt": "duplicate prompt at metadata level",
            },
            "questions": [
                {"q_num": 16 + i, "prompt": f"Q{16 + i}"} for i in range(5)
            ],
            "answers": [
                {"q_num": 16 + i, "answer": "A", "alternatives": [],
                 "trap_mechanisms": []}
                for i in range(5)
            ],
        },
    })

    out = _run(listening_router.get_published_listening_test(
        test_id=test["id"], authorization=authz,
    ))
    plan_ex = next(
        ex for sec in out["sections"] for ex in sec["exercises"]
        if ex["payload"].get("template_kind") == "plan_label"
    )
    # Defense-in-depth: payload.map_description AND
    # payload.metadata.map_description must be gone.
    assert "map_description" not in plan_ex["payload"], (
        "payload.map_description must be stripped from student response"
    )
    assert "map_description" not in (plan_ex["payload"].get("metadata") or {}), (
        "payload.metadata.map_description must be stripped from student response"
    )
    # Sprint 13.5.9 — same treatment for the curated AI prompt.
    assert "map_image_custom_prompt" not in plan_ex["payload"]
    assert "map_image_custom_prompt" not in (plan_ex["payload"].get("metadata") or {})
    # Original row must remain untouched (admin endpoints rely on it).
    seeded = fake.tables["listening_exercises"][0]
    assert seeded["payload"]["map_description"] == "A rectangular community hall with..."
    assert seeded["payload"]["metadata"]["map_description"] == "duplicate at metadata level"
    assert seeded["payload"]["map_image_custom_prompt"].startswith("## Curated prompt")
    assert seeded["payload"]["metadata"]["map_image_custom_prompt"] == (
        "duplicate prompt at metadata level"
    )


def test_get_test_detail_prefers_assembled_over_full(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(
        fake,
        audio_assembly_mode="parts_auto_assembled",
        full_audio_storage_path="tests/x/full.mp3",
        assembled_audio_storage_path="tests/x/assembled.mp3",
    )
    _seed_sections_with_exercises(fake, test["id"])
    out = _run(listening_router.get_published_listening_test(
        test_id=test["id"], authorization=authz,
    ))
    assert "assembled.mp3" in out["audio_url"]


def test_get_test_detail_404_for_draft(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake, status="draft")
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.get_published_listening_test(
            test_id=test["id"], authorization=authz,
        ))
    assert excinfo.value.status_code == 404


def test_get_test_detail_422_when_no_audio(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(
        fake,
        full_audio_storage_path=None,
        assembled_audio_storage_path=None,
    )
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.get_published_listening_test(
            test_id=test["id"], authorization=authz,
        ))
    assert excinfo.value.status_code == 422


# ── POST attempts ──────────────────────────────────────────────────────────


def test_start_attempt_inserts_row(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    out = _run(listening_router.start_listening_test_attempt(
        test_id=test["id"], authorization=authz,
    ))
    assert out["status"] == "in_progress"
    assert len(fake.tables["listening_test_attempts"]) == 1


def test_start_attempt_abandons_previous_in_progress(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    fake.tables["listening_test_attempts"].append({
        "id": "old", "test_id": test["id"], "user_id": "user-1",
        "status": "in_progress", "answers": [],
    })
    _run(listening_router.start_listening_test_attempt(
        test_id=test["id"], authorization=authz,
    ))
    by_id = {a["id"]: a for a in fake.tables["listening_test_attempts"]}
    assert by_id["old"]["status"] == "abandoned"
    # Plus a new in_progress row.
    assert any(a["status"] == "in_progress" for a in fake.tables["listening_test_attempts"])


# ── PATCH answers ──────────────────────────────────────────────────────────


def test_standalone_resume_never_returns_a_mock_attempt(monkeypatch):
    """Codex #834 (correct): scoping only the MOCK lookup left the mirror bug —
    a student with a live mock attempt opening the same test from the normal
    Listening library would resume the SEALED exam attempt, replay the audio,
    and edit exam answers outside the runner."""
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    fake.tables["listening_test_attempts"].append({
        "id": "mock-att", "test_id": test["id"], "user_id": "user-1",
        "status": "in_progress", "sitting_id": "sit-1", "answers": [],
    })
    out = _run(listening_router.get_in_progress_listening_attempt(
        test_id=test["id"], sitting_id=None, authorization=authz,
    ))
    assert out["attempt"] is None          # standalone must not see it

    # ...and the mock runner, scoped to its sitting, still does
    out2 = _run(listening_router.get_in_progress_listening_attempt(
        test_id=test["id"], sitting_id="sit-1", authorization=authz,
    ))
    assert out2["attempt"]["attempt_id"] == "mock-att"


def test_standalone_resume_still_finds_a_practice_attempt(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    fake.tables["listening_test_attempts"].append({
        "id": "solo", "test_id": test["id"], "user_id": "user-1",
        "status": "in_progress", "sitting_id": None, "answers": [],
    })
    out = _run(listening_router.get_in_progress_listening_attempt(
        test_id=test["id"], sitting_id=None, authorization=authz,
    ))
    assert out["attempt"]["attempt_id"] == "solo"


def test_patch_answer_upserts_by_q_num(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    fake.tables["listening_test_attempts"].append({
        "id": "att", "test_id": test["id"], "user_id": "user-1",
        "status": "in_progress",
        "answers": [{"q_num": 1, "user_answer": "first"}],
    })
    body = listening_router.TestAttemptAnswerPatchRequest(q_num=1, user_answer="second")
    out = _run(listening_router.patch_listening_test_attempt_answer(
        attempt_id="att", body=body, authorization=authz,
    ))
    assert out["answer_count"] == 1
    answers = fake.tables["listening_test_attempts"][0]["answers"]
    assert len(answers) == 1
    assert answers[0]["user_answer"] == "second"


def test_patch_answer_goes_through_the_atomic_rpc(monkeypatch):
    """A4b — the write must be the single-statement RPC, not a Python
    read-modify-write of the whole array. Pinned by asserting the route calls
    fn_upsert_listening_answer: that is the ONLY thing standing between two
    concurrent saves and a silently lost answer."""
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    fake.tables["listening_test_attempts"].append({
        "id": "att", "test_id": test["id"], "user_id": "user-1",
        "status": "in_progress", "answers": [],
    })
    seen = []
    real_rpc = fake.rpc
    fake.rpc = lambda n, p: (seen.append(n), real_rpc(n, p))[1]

    body = listening_router.TestAttemptAnswerPatchRequest(q_num=7, user_answer="x")
    _run(listening_router.patch_listening_test_attempt_answer(
        attempt_id="att", body=body, authorization=authz,
    ))
    assert seen == ["fn_upsert_listening_answer"]


def test_patch_answer_keeps_other_questions_untouched(monkeypatch):
    """The regression A4b fixes: saving q2 must not disturb q1. Under the old
    read-modify-write two concurrent saves each rewrote the FULL array, so the
    later write erased the earlier one's question entirely."""
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    fake.tables["listening_test_attempts"].append({
        "id": "att", "test_id": test["id"], "user_id": "user-1",
        "status": "in_progress",
        "answers": [{"q_num": 1, "user_answer": "keep-me"}],
    })
    body = listening_router.TestAttemptAnswerPatchRequest(q_num=2, user_answer="new")
    out = _run(listening_router.patch_listening_test_attempt_answer(
        attempt_id="att", body=body, authorization=authz,
    ))
    assert out["answer_count"] == 2
    answers = fake.tables["listening_test_attempts"][0]["answers"]
    assert [a["q_num"] for a in answers] == [1, 2]          # sorted, both present
    assert answers[0]["user_answer"] == "keep-me"


def test_patch_answer_422_when_attempt_submitted_mid_write(monkeypatch):
    """The RPC enforces status='in_progress' too, so it returns NULL if the
    attempt was submitted between the router's check and the write. That is a
    real race and the honest answer is that the edit did not land."""
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    fake.tables["listening_test_attempts"].append({
        "id": "att", "test_id": test["id"], "user_id": "user-1",
        "status": "in_progress", "answers": [],
    })
    # RPC sees a submitted attempt (the race) even though the router's read did not
    fake.rpc = lambda n, p: _RpcResult(None)

    body = listening_router.TestAttemptAnswerPatchRequest(q_num=1, user_answer="x")
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.patch_listening_test_attempt_answer(
            attempt_id="att", body=body, authorization=authz,
        ))
    assert excinfo.value.status_code == 422


def test_patch_answer_rejects_q_num_out_of_range(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    fake.tables["listening_test_attempts"].append({
        "id": "att", "test_id": test["id"], "user_id": "user-1",
        "status": "in_progress", "answers": [],
    })
    body = listening_router.TestAttemptAnswerPatchRequest(q_num=99, user_answer="x")
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.patch_listening_test_attempt_answer(
            attempt_id="att", body=body, authorization=authz,
        ))
    assert excinfo.value.status_code == 422


def test_patch_answer_403_when_not_owner(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    fake.tables["listening_test_attempts"].append({
        "id": "att", "test_id": test["id"], "user_id": "another-user",
        "status": "in_progress", "answers": [],
    })
    body = listening_router.TestAttemptAnswerPatchRequest(q_num=1, user_answer="x")
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.patch_listening_test_attempt_answer(
            attempt_id="att", body=body, authorization=authz,
        ))
    assert excinfo.value.status_code == 403


def test_patch_answer_blocked_after_submit(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    fake.tables["listening_test_attempts"].append({
        "id": "att", "test_id": test["id"], "user_id": "user-1",
        "status": "submitted", "answers": [],
    })
    body = listening_router.TestAttemptAnswerPatchRequest(q_num=1, user_answer="x")
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.patch_listening_test_attempt_answer(
            attempt_id="att", body=body, authorization=authz,
        ))
    assert excinfo.value.status_code == 422


# ── Submit ─────────────────────────────────────────────────────────────────


def test_submit_grades_and_writes_attempt_row(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    _seed_sections_with_exercises(fake, test["id"])
    # User answers all 40 correctly.
    fake.tables["listening_test_attempts"].append({
        "id": "att", "test_id": test["id"], "user_id": "user-1",
        "status": "in_progress",
        "answers": [
            {"q_num": i, "user_answer": f"answer-{i}"} for i in range(1, 41)
        ],
    })
    out = _run(listening_router.submit_listening_test_attempt(
        attempt_id="att", authorization=authz,
    ))
    assert out["score"] == 40
    assert out["band_estimate"] == 9.0
    assert sum(s["correct"] for s in out["section_breakdown"].values()) == 40
    # Row updated.
    row = fake.tables["listening_test_attempts"][0]
    assert row["status"] == "submitted"
    assert row["score"] == 40


def test_submit_blocks_re_submit(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    _seed_sections_with_exercises(fake, test["id"])
    fake.tables["listening_test_attempts"].append({
        "id": "att", "test_id": test["id"], "user_id": "user-1",
        "status": "submitted", "score": 30, "answers": [],
    })
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.submit_listening_test_attempt(
            attempt_id="att", authorization=authz,
        ))
    assert excinfo.value.status_code == 422


def test_submit_partial_score_returns_per_question(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    _seed_sections_with_exercises(fake, test["id"])
    # 20 correct + 20 wrong.
    user_answers = []
    for i in range(1, 41):
        ans = f"answer-{i}" if i <= 20 else f"wrong-{i}"
        user_answers.append({"q_num": i, "user_answer": ans})
    fake.tables["listening_test_attempts"].append({
        "id": "att", "test_id": test["id"], "user_id": "user-1",
        "status": "in_progress", "answers": user_answers,
    })
    out = _run(listening_router.submit_listening_test_attempt(
        attempt_id="att", authorization=authz,
    ))
    assert out["score"] == 20
    assert out["band_estimate"] == 5.5
    assert len(out["per_question"]) == 40


# ── GET attempt ────────────────────────────────────────────────────────────


def test_get_attempt_owner_only(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    fake.tables["listening_test_attempts"].append({
        "id": "att", "test_id": test["id"], "user_id": "another-user",
        "status": "submitted", "score": 33,
    })
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.get_listening_test_attempt(
            attempt_id="att", authorization=authz,
        ))
    assert excinfo.value.status_code == 403


def test_get_attempt_returns_grading(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    fake.tables["listening_test_attempts"].append({
        "id": "att", "test_id": test["id"], "user_id": "user-1",
        "status": "submitted", "score": 33,
        "band_estimate": 7.5,
        "grading_details": [{"q_num": 1, "correct": True}],
        "trap_analytics":  {"paraphrase_t0": {"caught": 5, "missed": 0}},
        "started_at":   "2026-05-21T00:00:00Z",
        "submitted_at": "2026-05-21T00:30:00Z",
    })
    out = _run(listening_router.get_listening_test_attempt(
        attempt_id="att", authorization=authz,
    ))
    assert out["score"] == 33
    assert out["band_estimate"] == 7.5
    assert out["trap_analytics"]["paraphrase_t0"]["caught"] == 5


# ── "Choose TWO" khi đáp án lưu cả cặp vào từng dòng ────────────────────
#
# The tests above build the key the way the grader WANTED it (one letter per
# slot). The Cambridge importer wrote the other shape — the whole set repeated
# in every row — and nothing here ever exercised it, so a grader that could not
# score a single one of those questions stayed green for months.
#
# Real damage: C2-FINAL-20260726 (Cambridge 15 Test 4) scored 0/14 students on
# each of Q17-20. Students who picked exactly the right two letters were marked
# wrong on both.


def _mm_key_wholeset(pair=("A", "D"), qs=(17, 18)):
    """The shape found in prod: every row carries the group's FULL set."""
    both = ", ".join(pair)
    rows = [{
        "payload": {
            "template_kind": "mcq_multi",
            "answers": [{"q_num": q, "answer": both} for q in qs],
        },
    }]
    return grader.collect_answer_key(rows)


def test_mm_wholeset_both_letters_score_two():
    ak = _mm_key_wholeset()
    res = grader.grade_attempt(
        [{"q_num": 17, "user_answer": "A"}, {"q_num": 18, "user_answer": "D"}], ak)
    assert res["score"] == 2, "picking exactly the expected two letters must score 2"
    assert [q["correct"] for q in res["per_question"]] == [True, True]


def test_mm_wholeset_any_order():
    ak = _mm_key_wholeset()
    res = grader.grade_attempt(
        [{"q_num": 17, "user_answer": "D"}, {"q_num": 18, "user_answer": "A"}], ak)
    assert res["score"] == 2, "the player fills slots in click order, not key order"


def test_mm_wholeset_one_right_one_wrong():
    ak = _mm_key_wholeset()
    res = grader.grade_attempt(
        [{"q_num": 17, "user_answer": "D"}, {"q_num": 18, "user_answer": "E"}], ak)
    assert res["score"] == 1


def test_mm_wholeset_duplicate_pick_counts_once():
    # Each expected letter is consumable once — two A's are not two marks.
    ak = _mm_key_wholeset()
    res = grader.grade_attempt(
        [{"q_num": 17, "user_answer": "A"}, {"q_num": 18, "user_answer": "A"}], ak)
    assert res["score"] == 1


def test_mm_wholeset_blank_scores_zero():
    ak = _mm_key_wholeset()
    res = grader.grade_attempt(
        [{"q_num": 17, "user_answer": ""}, {"q_num": 18, "user_answer": ""}], ak)
    assert res["score"] == 0


def test_mm_wholeset_case_and_spacing_insensitive():
    ak = _mm_key_wholeset()
    res = grader.grade_attempt(
        [{"q_num": 17, "user_answer": " a "}, {"q_num": 18, "user_answer": "d"}], ak)
    assert res["score"] == 2


def test_mm_mismatched_set_falls_back_not_guesses():
    """A set whose size does not match the slot count is data we do not
    understand — read each row as its own answer rather than inventing a rule."""
    rows = [{
        "payload": {
            "template_kind": "mcq_multi",
            "answers": [
                {"q_num": 17, "answer": "A, D"},
                {"q_num": 18, "answer": "A, D"},
                {"q_num": 19, "answer": "A, D"},
            ],
        },
    }]
    ak = grader.collect_answer_key(rows)
    res = grader.grade_attempt(
        [{"q_num": 17, "user_answer": "A"}, {"q_num": 18, "user_answer": "D"},
         {"q_num": 19, "user_answer": "A"}], ak)
    assert res["score"] == 0, "3 slots vs a 2-letter set: do not collapse"


def test_mm_rows_disagreeing_fall_back():
    rows = [{
        "payload": {
            "template_kind": "mcq_multi",
            "answers": [
                {"q_num": 17, "answer": "A, D"},
                {"q_num": 18, "answer": "B, C"},
            ],
        },
    }]
    ak = grader.collect_answer_key(rows)
    res = grader.grade_attempt(
        [{"q_num": 17, "user_answer": "A"}, {"q_num": 18, "user_answer": "D"}], ak)
    assert res["score"] == 0, "rows must agree before their set is trusted"


def test_mm_wholeset_rows_in_different_order_still_agree():
    """"A, D" and "D, A" are the same answer written two ways.

    Requiring string equality would drop the group to the fallback and score a
    fully correct student ZERO — the same failure this whole block exists to
    stop, reintroduced through a stricter-than-necessary agreement check.
    """
    rows = [{
        "payload": {
            "template_kind": "mcq_multi",
            "answers": [
                {"q_num": 17, "answer": "A, D"},
                {"q_num": 18, "answer": "D, A"},
            ],
        },
    }]
    ak = grader.collect_answer_key(rows)
    res = grader.grade_attempt(
        [{"q_num": 17, "user_answer": "A"}, {"q_num": 18, "user_answer": "D"}], ak)
    assert res["score"] == 2


def test_mm_wholeset_reordered_rows_still_consume_once():
    rows = [{
        "payload": {
            "template_kind": "mcq_multi",
            "answers": [
                {"q_num": 17, "answer": "A, D"},
                {"q_num": 18, "answer": "D, A"},
            ],
        },
    }]
    ak = grader.collect_answer_key(rows)
    res = grader.grade_attempt(
        [{"q_num": 17, "user_answer": "D"}, {"q_num": 18, "user_answer": "D"}], ak)
    assert res["score"] == 1, "one D expected, two picked — still one mark"


# ── POST /api/listening/tests/attempts/{id}/check — Luyện nhanh runner ──────
#
# Instant per-question feedback with unlimited retries. The two things worth
# pinning are the ones that would quietly rot the data rather than throw:
# scoring must follow the FIRST answer, and the surface must stay closed to
# real tests.


def _seed_practice(fake, *, user_id="user-1"):
    """A practice test with one 2-question exercise + an open attempt."""
    t = _seed_test(fake, test_type="practice", test_id="ILR-LIS-KKR-Gen-Number-p01",
                   metadata={"section_offsets": {"s1": 0}})
    fake.tables["listening_content"].append({
        "id": "pc-1", "test_id": t["id"], "section_num": 1,
        "title": "Trap 01", "transcript": "stub", "metadata": {},
    })
    fake.tables["listening_exercises"].append({
        "id": "pex-1", "content_id": "pc-1", "exercise_type": "notes_completion",
        "order_num": 1,
        "payload": {
            "variant": "notes_completion",
            "questions": [{"q_num": 1, "prompt": "Q1"}, {"q_num": 2, "prompt": "Q2"}],
            "answers": [
                {"q_num": 1, "answer": "nineteen", "alternatives": ["19"],
                 "trap_mechanisms": ["number"]},
                {"q_num": 2, "answer": "blue", "alternatives": [], "trap_mechanisms": []},
            ],
            "audio_windows": {"1": {"start": 3.5, "end": 9.0, "section": "s1"},
                              "2": {"start": 12.0, "end": 18.5, "section": "s1"}},
            "solutions": {"1": {"why": "Người nói sửa lại số."}},
        },
    })
    attempt_id = str(uuid4())
    fake.tables["listening_test_attempts"].append({
        "id": attempt_id, "test_id": t["id"], "user_id": user_id,
        "status": "in_progress", "answers": [],
    })
    return t, attempt_id


def _check(attempt_id, authz, **kw):
    body = listening_router.PracticeCheckRequest(**kw)
    return _run(listening_router.check_listening_practice_answer(
        attempt_id, body, authorization=authz))


def test_check_correct_answer_records_and_reports(monkeypatch):
    fake, authz = _patch(monkeypatch)
    _t, aid = _seed_practice(fake)
    out = _check(aid, authz, q_num=1, user_answer="nineteen")
    assert out["correct"] is True
    assert out["canonical_correct"] is True
    assert out["recorded"] is True
    assert out["audio_window"] == {"start": 3.5, "end": 9.0, "section": "s1"}


def test_check_accepts_the_same_alternatives_as_final_grading(monkeypatch):
    """"19" must be as right here as it is at submit — one grader, one verdict."""
    fake, authz = _patch(monkeypatch)
    _t, aid = _seed_practice(fake)
    assert _check(aid, authz, q_num=1, user_answer="19")["correct"] is True


def test_check_wrong_then_right_keeps_the_FIRST_answer_canonical(monkeypatch):
    fake, authz = _patch(monkeypatch)
    _t, aid = _seed_practice(fake)

    first = _check(aid, authz, q_num=1, user_answer="ninety")
    assert first["correct"] is False and first["recorded"] is True

    retry = _check(aid, authz, q_num=1, user_answer="nineteen")
    # The learner is told the truth about THIS try…
    assert retry["correct"] is True
    # …but the score still reflects the miss on the first listen.
    assert retry["canonical_correct"] is False
    assert retry["recorded"] is False
    assert retry["answered_before"] is True

    stored = fake.tables["listening_test_attempts"][0]["answers"]
    assert [a["user_answer"] for a in stored] == ["ninety"], "retry overwrote the record"


def test_check_retries_cannot_inflate_the_submitted_score(monkeypatch):
    """The end-to-end version of the rule: grind to all-correct, still score 0."""
    fake, authz = _patch(monkeypatch)
    _t, aid = _seed_practice(fake)
    for q in (1, 2):
        _check(aid, authz, q_num=q, user_answer="wrong")
        _check(aid, authz, q_num=q, user_answer="nineteen" if q == 1 else "blue")

    res = _run(listening_router.submit_listening_test_attempt(aid, authorization=authz))
    assert res["score"] == 0, "retries leaked into the final score"
    assert res["max_score"] == 2


def test_check_is_refused_on_a_real_test(monkeypatch):
    """Exam integrity: instant feedback must not exist for full/mini/drill.

    Otherwise a student probes the key answer-by-answer with the recording
    still in front of them, which is precisely what submit-once prevents.
    """
    for kind in ("full", "mini", "drill"):
        fake, authz = _patch(monkeypatch)
        t, aid = _seed_practice(fake)
        fake.tables["listening_tests"][0]["test_type"] = kind
        with pytest.raises(HTTPException) as ei:
            _check(aid, authz, q_num=1, user_answer="nineteen")
        assert ei.value.status_code == 422
        assert "Luyện nhanh" in ei.value.detail


def test_check_rejects_a_question_outside_the_test(monkeypatch):
    fake, authz = _patch(monkeypatch)
    _t, aid = _seed_practice(fake)
    with pytest.raises(HTTPException) as ei:
        _check(aid, authz, q_num=39, user_answer="x")
    assert ei.value.status_code == 404


def test_check_rejects_a_submitted_attempt(monkeypatch):
    fake, authz = _patch(monkeypatch)
    _t, aid = _seed_practice(fake)
    fake.tables["listening_test_attempts"][0]["status"] = "submitted"
    with pytest.raises(HTTPException) as ei:
        _check(aid, authz, q_num=1, user_answer="nineteen")
    assert ei.value.status_code == 422


def test_check_rejects_someone_elses_attempt(monkeypatch):
    fake, authz = _patch(monkeypatch)
    _t, aid = _seed_practice(fake, user_id="somebody-else")
    with pytest.raises(HTTPException) as ei:                 # _patch auth = user-1
        _check(aid, authz, q_num=1, user_answer="nineteen")
    assert ei.value.status_code == 403                       # shared ownership gate
    assert fake.tables["listening_test_attempts"][0]["answers"] == [], \
        "refused call must not write into someone else's attempt"


# ── Reveal ("Xem đáp án") ──────────────────────────────────────────────────


def test_reveal_requires_an_answer_on_file_first(monkeypatch):
    fake, authz = _patch(monkeypatch)
    _t, aid = _seed_practice(fake)
    with pytest.raises(HTTPException) as ei:
        _check(aid, authz, q_num=1, reveal=True)
    assert ei.value.status_code == 422
    assert fake.tables["listening_test_attempts"][0]["answers"] == [], \
        "a reveal must never record an answer"


def test_reveal_after_a_wrong_answer_returns_key_and_solution(monkeypatch):
    fake, authz = _patch(monkeypatch)
    _t, aid = _seed_practice(fake)
    _check(aid, authz, q_num=1, user_answer="ninety")
    out = _check(aid, authz, q_num=1, reveal=True)
    assert out["revealed"] is True
    assert out["expected"] == "nineteen"
    assert out["alternatives"] == ["19"]
    assert out["solution"]["why"].startswith("Người nói")
    assert out["audio_window"]["start"] == 3.5


def test_reveal_refused_when_already_correct(monkeypatch):
    """Nothing to reveal, and it keeps the endpoint from being a key dump."""
    fake, authz = _patch(monkeypatch)
    _t, aid = _seed_practice(fake)
    _check(aid, authz, q_num=1, user_answer="nineteen")
    with pytest.raises(HTTPException) as ei:
        _check(aid, authz, q_num=1, reveal=True)
    assert ei.value.status_code == 422


def test_check_never_leaks_the_key_without_reveal(monkeypatch):
    fake, authz = _patch(monkeypatch)
    _t, aid = _seed_practice(fake)
    out = _check(aid, authz, q_num=1, user_answer="ninety")
    for leaky in ("expected", "alternatives", "solution", "revealed"):
        assert leaky not in out, f"wrong answer response leaked {leaky}"


# ── Codex review round 4 — the ways the first-answer rule could still be lost ──


def test_patch_answers_is_refused_for_a_practice_attempt(monkeypatch):
    """The old answer-save route replaces by q_num, so leaving it open to
    practice is a way straight around the first-answer rule."""
    fake, authz = _patch(monkeypatch)
    _t, aid = _seed_practice(fake)
    _check(aid, authz, q_num=1, user_answer="ninety")            # canonical: wrong

    body = listening_router.TestAttemptAnswerPatchRequest(q_num=1, user_answer="nineteen")
    with pytest.raises(HTTPException) as ei:
        _run(listening_router.patch_listening_test_attempt_answer(
            aid, body, authorization=authz))
    assert ei.value.status_code == 422

    res = _run(listening_router.submit_listening_test_attempt(aid, authorization=authz))
    assert res["score"] == 0, "PATCH overwrote the canonical first answer"


def test_patch_answers_still_works_for_a_real_test(monkeypatch):
    """The refusal must be scoped to practice — this is the exam save path."""
    fake, authz = _patch(monkeypatch)
    t = _seed_test(fake)                                          # test_type='full'
    _seed_sections_with_exercises(fake, t["id"])
    aid = str(uuid4())
    fake.tables["listening_test_attempts"].append({
        "id": aid, "test_id": t["id"], "user_id": "user-1",
        "status": "in_progress", "answers": [],
    })
    body = listening_router.TestAttemptAnswerPatchRequest(q_num=1, user_answer="x")
    out = _run(listening_router.patch_listening_test_attempt_answer(
        aid, body, authorization=authz))
    assert out["answer_count"] == 1


def test_check_reports_the_canonical_verdict_even_when_it_lost_the_race(monkeypatch):
    """Concurrent checks: the loser must not report off its stale snapshot.

    The race must land BETWEEN the endpoint's read and its write, so the
    winning answer is planted from inside the RPC: the endpoint's snapshot saw
    no answer, and by the time it writes, one exists. Writing it beforehand
    would only reproduce the ordinary "already answered" path, which was never
    the bug.
    """
    fake, authz = _patch(monkeypatch)
    _t, aid = _seed_practice(fake)

    real_rpc = fake.rpc

    def racing_rpc(name, params):
        if name == "fn_insert_listening_answer_once":
            row = fake.tables["listening_test_attempts"][0]
            row["answers"] = [{"q_num": 1, "user_answer": "nineteen"}]   # rival won
            return _RpcResult(False)
        return real_rpc(name, params)

    fake.rpc = racing_rpc
    out = _check(aid, authz, q_num=1, user_answer="ninety")
    assert out["recorded"] is False
    assert out["canonical_correct"] is True, \
        "reported the stale snapshot — learner told it is lost, submit says correct"

    res = _run(listening_router.submit_listening_test_attempt(aid, authorization=authz))
    assert res["score"] == 1, "check and submit must agree"


# ── The student test payload must not carry the key, or where to find it ──


def test_get_test_detail_strips_solutions_and_windows(monkeypatch):
    """Sprint 13.5 stripped payload.answers only. The importer ALSO writes a
    per-question `solutions` record whose `answer` field is the key verbatim,
    so it was still being served on the same response — and audio_windows /
    transcript_anchors say exactly where in the recording to listen.
    """
    fake, authz = _patch(monkeypatch)
    t = _seed_test(fake)
    fake.tables["listening_content"].append({
        "id": "c-1", "test_id": t["id"], "section_num": 1,
        "title": "S1", "transcript": "stub", "metadata": {},
    })
    fake.tables["listening_exercises"].append({
        "id": "e-1", "content_id": "c-1", "exercise_type": "notes_completion",
        "order_num": 1,
        "payload": {
            "variant": "notes_completion",
            "questions": [{"q_num": 1, "prompt": "Q1"}],
            "answers":   [{"q_num": 1, "answer": "nineteen"}],
            "solutions": {"1": {"answer": "nineteen", "why": "…"}},
            "audio_windows": {"1": {"start": 3.5, "end": 9.0}},
            "transcript_anchors": {"1": 2},
        },
    })
    out = _run(listening_router.get_published_listening_test(t["id"], authorization=authz))
    payload = out["sections"][0]["exercises"][0]["payload"]
    for leaky in ("answers", "solutions", "audio_windows", "transcript_anchors"):
        assert leaky not in payload, f"student payload still carries {leaky}"
    assert payload["questions"], "stripping must not take the questions with it"
    assert "nineteen" not in json.dumps(out), "the answer is still reachable somewhere"
