"""Tests for test-linked dictation (chép chính tả launched from a
listening test).

Covers:
  * services.listening_grader.split_sentences  — deterministic splitter
  * GET  /api/listening/tests/{id}             — new test_type field
  * GET  /api/listening/tests/{id}/dictation   — audio + section sentences
  * POST /api/listening/tests/dictation/grade  — stateless per-sentence grade
"""

from __future__ import annotations

import asyncio
from uuid import uuid4

import pytest
from fastapi import HTTPException

from routers import listening as listening_router
from services.listening_grader import split_sentences


# ── Unit: split_sentences ──────────────────────────────────────────────────


def test_split_sentences_multi():
    assert split_sentences("Hello there. How are you? I am fine.") == [
        "Hello there.", "How are you?", "I am fine.",
    ]


def test_split_sentences_keeps_abbreviations_together():
    # "Dr." and "St." must not end a sentence.
    assert split_sentences("Dr. Smith went to St. Mary. He was late.") == [
        "Dr. Smith went to St. Mary.", "He was late.",
    ]


def test_split_sentences_collapses_newlines():
    assert split_sentences("Line one is here.\nLine two follows.") == [
        "Line one is here.", "Line two follows.",
    ]


def test_split_sentences_empty_returns_empty_list():
    assert split_sentences("") == []
    assert split_sentences("   \n  ") == []


def test_split_sentences_no_terminator_is_one_sentence():
    assert split_sentences("just a fragment with no full stop") == [
        "just a fragment with no full stop",
    ]


# ── Router fake supabase (compact, self-contained) ─────────────────────────


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

    def select(self, *_a, **_kw): self._mode = "select"; return self
    def insert(self, p): self._mode = "insert"; self._payload = p; return self
    def update(self, p): self._mode = "update"; self._payload = p; return self
    def eq(self, c, v): self._eq.append((c, v)); return self
    def limit(self, *_a, **_kw): return self
    def order(self, *_a, **_kw): return self

    def _match(self, r):
        return all(r.get(c) == v for c, v in self._eq)

    def execute(self):
        rows = self.fake.tables.setdefault(self.name, [])
        matched = [r for r in rows if self._match(r)]
        return _Resp(matched, count=len(matched))


class _StorageBucket:
    def __init__(self, name): self.name = name
    def create_signed_url(self, path, ttl):
        return {"signedURL": f"https://storage.test/{self.name}/{path}?ttl={ttl}"}


class _Storage:
    def from_(self, name): return _StorageBucket(name)


class _Fake:
    def __init__(self):
        self.tables = {"listening_tests": [], "listening_content": []}
        self.storage = _Storage()

    def table(self, name): return _Q(self, name)


def _patch(monkeypatch, user_id="user-1"):
    fake = _Fake()
    monkeypatch.setattr(listening_router, "supabase_admin", fake)
    monkeypatch.setattr(
        listening_router.settings, "LISTENING_AUDIO_BUCKET", "listening-audio")

    async def _user_auth(_authz):
        return {"id": user_id}
    monkeypatch.setattr(listening_router, "_require_auth", _user_auth)
    return fake, "Bearer fake"


def _run(c): return asyncio.run(c)


def _seed_test(fake, **overrides):
    row = {
        "id":      str(uuid4()),
        "test_id": "ILR-LIS-001",
        "title":   "Pilot 01",
        "status":  "published",
        "metadata": {},
        "audio_assembly_mode":         "full_premixed",
        "full_audio_storage_path":     "tests/x/full.mp3",
        "full_audio_duration_seconds": 1800,
        "assembled_audio_storage_path": None,
        "cue_points": [],
    }
    row.update(overrides)
    fake.tables["listening_tests"].append(row)
    return row


def _seed_section(fake, test_id, section_num, transcript):
    fake.tables["listening_content"].append({
        "id":          f"content-{section_num}",
        "test_id":     test_id,
        "section_num": section_num,
        "title":       f"Section {section_num}",
        "transcript":  transcript,
    })


# ── GET /tests/{id} — new test_type field ──────────────────────────────────


def test_get_test_detail_surfaces_test_type_for_mini(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake, metadata={"test_type": "mini"})
    out = _run(listening_router.get_published_listening_test(
        test_id=test["id"], authorization=authz))
    assert out["test_type"] == "mini"


def test_get_test_detail_test_type_none_for_legacy_full(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake, metadata={})       # legacy full — no test_type
    out = _run(listening_router.get_published_listening_test(
        test_id=test["id"], authorization=authz))
    assert out["test_type"] is None


# ── GET /tests/{id}/dictation ──────────────────────────────────────────────


def test_get_dictation_returns_audio_and_sentences(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake, cue_points=[
        {"type": "section_start", "section_num": 1, "timestamp_seconds": 29.3},
    ])
    _seed_section(fake, test["id"], 1, "Hello there. How are you today?")
    out = _run(listening_router.get_listening_test_dictation(
        test_id=test["id"], authorization=authz))
    assert out["audio_url"].startswith("https://storage.test/")
    assert len(out["sections"]) == 1
    sec = out["sections"][0]
    assert sec["section_num"] == 1
    assert sec["sentences"] == ["Hello there.", "How are you today?"]
    assert sec["cue_start"] == 29.3


def test_get_dictation_blank_transcript_yields_no_sentences(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    _seed_section(fake, test["id"], 1, "")
    out = _run(listening_router.get_listening_test_dictation(
        test_id=test["id"], authorization=authz))
    assert out["sections"][0]["sentences"] == []


def test_get_dictation_404_for_draft(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake, status="draft")
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.get_listening_test_dictation(
            test_id=test["id"], authorization=authz))
    assert excinfo.value.status_code == 404


def test_get_dictation_422_when_no_audio(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(
        fake, full_audio_storage_path=None, assembled_audio_storage_path=None)
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.get_listening_test_dictation(
            test_id=test["id"], authorization=authz))
    assert excinfo.value.status_code == 422


# ── POST /tests/dictation/grade ────────────────────────────────────────────


def _grade(test_id, section_num, sentence_idx, user_transcript, authz):
    body = listening_router.ListeningTestDictationGradeRequest(
        test_id=test_id, section_num=section_num,
        sentence_idx=sentence_idx, user_transcript=user_transcript)
    return _run(listening_router.grade_listening_test_dictation(
        body=body, authorization=authz))


def test_grade_sentence_perfect(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    _seed_section(fake, test["id"], 1, "Hello there. How are you today?")
    out = _grade(test["id"], 1, 0, "hello there", authz)   # sentence 0, case-insensitive
    assert out["is_correct"] is True
    assert out["score"] == 1.0


def test_grade_sentence_partial_produces_diff(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    _seed_section(fake, test["id"], 1, "Hello there. How are you today?")
    out = _grade(test["id"], 1, 1, "how are you", authz)   # missing "today"
    assert out["is_correct"] is False
    assert 0 < out["score"] < 1.0
    assert any(op["op"] == "miss" for op in out["diff"])


def test_grade_sentence_idx_out_of_range_422(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    _seed_section(fake, test["id"], 1, "One sentence only.")
    with pytest.raises(HTTPException) as excinfo:
        _grade(test["id"], 1, 5, "whatever", authz)
    assert excinfo.value.status_code == 422


def test_grade_sentence_section_404(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    _seed_section(fake, test["id"], 1, "Only section one.")
    with pytest.raises(HTTPException) as excinfo:
        _grade(test["id"], 9, 0, "whatever", authz)        # no section 9
    assert excinfo.value.status_code == 404
