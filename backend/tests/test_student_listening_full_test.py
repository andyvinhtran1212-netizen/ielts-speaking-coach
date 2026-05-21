"""Tests for Sprint 13.5 — student full-test layer.

Covers:
  * services.listening_test_grader      — pure-function grading
  * GET    /api/listening/tests          — published-only list with audio
  * GET    /api/listening/tests/{id}     — answer-key strip + signed URL
  * POST   /api/listening/tests/{id}/attempts
  * PATCH  /api/listening/tests/attempts/{id}/answers
  * POST   /api/listening/tests/attempts/{id}/submit
  * GET    /api/listening/tests/attempts/{id}
"""

from __future__ import annotations

import asyncio
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
        self._range: tuple[int, int] | None = None

    def select(self, *_a, **_kw): self._mode = "select"; return self
    def insert(self, p): self._mode = "insert"; self._payload = p; return self
    def update(self, p): self._mode = "update"; self._payload = p; return self
    def delete(self): self._mode = "delete"; return self
    def eq(self, c, v): self._eq.append((c, v)); return self
    def in_(self, c, vs): self._in.append((c, list(vs))); return self
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
