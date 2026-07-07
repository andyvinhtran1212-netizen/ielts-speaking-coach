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
from services.listening_grader import (
    grade_dictation, proper_noun_hints, split_sentences, split_turns,
)


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


def test_split_turns_one_unit_per_turn_not_sentence_split():
    # split_turns keeps a whole turn as ONE unit (audio-aligned granularity)
    # — unlike split_sentences which breaks a turn into sentences.
    transcript = (
        "**Helen (Course coordinator):** Good afternoon. How may I help you?\n\n"
        "**Daniel (Customer):** I'd like to enrol."
    )
    assert split_turns(transcript) == [
        "Good afternoon. How may I help you?",   # one turn = one unit
        "I'd like to enrol.",
    ]
    # And it aligns 1:1 with the turn count (for pairing with timings.turns).
    assert len(split_turns(transcript)) == 2


def test_split_sentences_strips_speaker_labels_and_respects_turns():
    # The stored transcript is blank-line-separated speaker turns prefixed
    # with "**Name (role):**". The label must NOT leak into the dictation
    # reference, and each turn must sentence-split independently.
    transcript = (
        "**Helen (Course coordinator):** Good afternoon. How may I help you?\n\n"
        "**Daniel (Customer):** I'd like to enrol please."
    )
    out = split_sentences(transcript)
    assert out == [
        "Good afternoon.",
        "How may I help you?",
        "I'd like to enrol please.",
    ]
    # No "**", no "(role)" label fragments anywhere.
    assert all("**" not in s and "coordinator" not in s.lower() for s in out)


def test_split_sentences_strips_production_cues_and_answer_markers():
    # Defensive: display copy already drops cues, but the fullscript/v1.1
    # fallback may carry "[pause]" cues + "(Q2)" markers — never dictate them.
    out = split_sentences("**M:** The address is [pause] Brighton (Q2). That's it.")
    assert len(out) == 2
    joined = " ".join(out)
    assert "[" not in joined and "(Q" not in joined and "**" not in joined
    assert "Brighton" in joined and "That's it." in out[-1]


def test_split_sentences_strips_spaced_answer_markers():
    # The converter supports the spaced marker form "( Q 33 )"; the splitter
    # must strip it too, not just compact "(Q33)".
    out = split_sentences("**M:** The answer is crime ( Q 33 ). Next point.")
    joined = " ".join(out)
    assert "Q" not in joined and "(" not in joined and ")" not in joined
    assert "crime" in joined


def test_split_sentences_handles_crlf_turn_separators():
    # A Solution.md uploaded with Windows CRLF stores "\r\n\r\n" between
    # turns. The splitter must still see two turns and strip BOTH labels —
    # otherwise a later "**Name:**" label leaks into the reference.
    transcript = (
        "**Helen (Course coordinator):** Good afternoon.\r\n\r\n"
        "**Daniel (Customer):** I'd like to enrol."
    )
    out = split_sentences(transcript)
    assert out == ["Good afternoon.", "I'd like to enrol."]
    assert all("Daniel" not in s and "Helen" not in s and "**" not in s for s in out)


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


def _seed_section(fake, test_id, section_num, transcript, metadata=None):
    fake.tables["listening_content"].append({
        "id":          f"content-{section_num}",
        "test_id":     test_id,
        "section_num": section_num,
        "title":       f"Section {section_num}",
        "transcript":  transcript,
        "metadata":    metadata,
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


# ── Filler leniency + proper-noun hints ────────────────────────────────────


def test_ignore_fillers_forgives_missed_hesitations():
    ref = "Oh, hello. Um, I would like to book."
    lenient = grade_dictation(reference_transcript=ref,
                              user_transcript="hello, I would like to book.",
                              ignore_fillers=True)
    assert lenient["is_correct"] is True and lenient["score"] == 1.0
    # The forgiven fillers are flagged (not counted in the denominator).
    forgiven = [d for d in lenient["diff"] if d.get("filler")]
    assert {d["expected"].lower().strip(",.") for d in forgiven} == {"oh", "um"}


def test_default_still_penalises_fillers():
    # Regression pin: content-based dictation (no ignore_fillers) unchanged.
    ref = "Oh, hello. Um, I would like to book."
    strict = grade_dictation(reference_transcript=ref,
                             user_transcript="hello, I would like to book.")
    assert strict["is_correct"] is False
    assert not any(d.get("filler") for d in strict["diff"])


def test_ignore_fillers_forgives_filler_to_filler_substitution():
    # "Um" typed as "uh" collapses to a `wrong` op, but both sides are pure
    # hesitations → forgiven, not penalised.
    r = grade_dictation(reference_transcript="Um, hello.",
                        user_transcript="uh hello", ignore_fillers=True)
    assert r["is_correct"] is True and r["score"] == 1.0
    assert any(d["op"] == "wrong" and d.get("filler") for d in r["diff"])


def test_ignore_fillers_still_penalises_real_substitution():
    # A real content-word substitution is NOT a filler swap — still counts.
    r = grade_dictation(reference_transcript="the cat sat",
                        user_transcript="the dog sat", ignore_fillers=True)
    assert r["is_correct"] is False
    assert not any(d.get("filler") for d in r["diff"])


def test_ignore_fillers_does_not_forgive_real_words():
    # A missed CONTENT word still counts; only pure hesitations are forgiven.
    r = grade_dictation(reference_transcript="Um, the address is Brighton.",
                        user_transcript="the address is", ignore_fillers=True)
    assert r["is_correct"] is False   # 'Brighton' still missing


def test_proper_noun_hints_catches_names_skips_initial_and_I():
    hints = proper_noun_hints("Good morning, Pawsley Salon, Meghan speaking. How can I help?")
    assert "Pawsley" in hints and "Meghan" in hints
    assert "Good" not in hints   # sentence-initial
    assert "How" not in hints    # sentence-initial (after '.')
    assert "I" not in hints


def test_proper_noun_hints_empty_when_none():
    assert proper_noun_hints("how are you today") == []


def test_dictation_boot_returns_proper_noun_hints(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    _seed_section(fake, test["id"], 1, "**M:** Good morning, Pawsley Salon, Meghan speaking.")
    out = _run(listening_router.get_listening_test_dictation(
        test_id=test["id"], authorization=authz))
    sec = out["sections"][0]
    assert sec["hints"] is not None
    flat = [h for hs in sec["hints"] if hs for h in hs]
    assert "Pawsley" in flat and "Meghan" in flat


def test_grade_endpoint_forgives_fillers(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    _seed_section(fake, test["id"], 1, "**M:** Um, hello there.")
    # sentence 0 = "Um, hello there." → user drops the 'Um'
    out = _grade(test["id"], 1, 0, "hello there", authz)
    assert out["is_correct"] is True and out["score"] == 1.0


_SEGMENTS = [
    {"idx": 0, "start": 48.24, "end": 56.22, "text": "Good afternoon."},
    {"idx": 1, "start": 56.51, "end": 63.57, "text": "How may I help you?"},
]


def test_dictation_boot_returns_timings_from_segments(monkeypatch):
    # When a section has metadata.dictation_segments (backfilled from
    # timings.json turns), the boot endpoint serves the segment text +
    # per-sentence audio windows so the player can auto-clip.
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    _seed_section(fake, test["id"], 1, "ignored full transcript here.",
                  metadata={"dictation_segments": _SEGMENTS})
    out = _run(listening_router.get_listening_test_dictation(
        test_id=test["id"], authorization=authz))
    sec = out["sections"][0]
    assert sec["sentences"] == ["Good afternoon.", "How may I help you?"]
    assert sec["timings"] == [
        {"start": 48.24, "end": 56.22},
        {"start": 56.51, "end": 63.57},
    ]


def test_dictation_boot_timings_null_without_segments(monkeypatch):
    # No segments → free-scrub: sentences from transcript, timings = null.
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    _seed_section(fake, test["id"], 1, "Hello there. How are you today?")
    out = _run(listening_router.get_listening_test_dictation(
        test_id=test["id"], authorization=authz))
    sec = out["sections"][0]
    assert sec["sentences"] == ["Hello there.", "How are you today?"]
    assert sec["timings"] is None


def test_grade_uses_segment_text_when_timed(monkeypatch):
    # The grade endpoint must resolve the reference from the SAME timed
    # units the boot served (segment[idx].text), not re-split the raw blob.
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    _seed_section(fake, test["id"], 1, "ignored full transcript here.",
                  metadata={"dictation_segments": _SEGMENTS})
    out = _grade(test["id"], 1, 1, "how may i help you", authz)  # segment 1
    assert out["is_correct"] is True and out["score"] == 1.0


def test_grade_sentence_404_for_draft_test(monkeypatch):
    # Security: a draft test's transcript must not be extractable via the
    # grade diff. The endpoint gates on published status BEFORE reading the
    # section transcript (the boot endpoint already 404s on drafts).
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake, status="draft")
    _seed_section(fake, test["id"], 1, "Secret draft transcript here.")
    with pytest.raises(HTTPException) as excinfo:
        _grade(test["id"], 1, 0, "", authz)                # empty submit → would leak diff
    assert excinfo.value.status_code == 404
