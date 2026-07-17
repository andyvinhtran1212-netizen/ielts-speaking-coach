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
    build_turn_segments, grade_dictation, proper_noun_hints,
    split_sentences, split_turns,
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


def test_build_turn_segments_pairs_text_with_timing_and_offset():
    transcript = "**A:** Good morning.\n\n**B:** Hello there."
    turns = [{"start": 10.0, "end": 12.5}, {"start": 12.6, "end": 15.0}]
    segs = build_turn_segments(transcript, turns, offset=100.0)
    assert segs == [
        {"idx": 0, "start": 110.0, "end": 112.5, "text": "Good morning."},
        {"idx": 1, "start": 112.6, "end": 115.0, "text": "Hello there."},
    ]


def test_build_turn_segments_returns_empty_on_misalignment():
    # More turns than transcript paragraphs → no guessed timing, free scrub.
    transcript = "**A:** Only one turn."
    turns = [{"start": 0, "end": 1}, {"start": 1, "end": 2}]
    assert build_turn_segments(transcript, turns) == []
    assert build_turn_segments("", turns) == []
    assert build_turn_segments(transcript, None) == []


def test_build_turn_segments_rejects_invalid_windows():
    # A malformed window (end <= start, or negative start) must fall the whole
    # section back to free scrub, never persist an unplayable clip.
    t2 = "**A:** One.\n\n**B:** Two."
    assert build_turn_segments(t2, [{"start": 5, "end": 8}, {"start": 9, "end": 9}]) == []   # end == start
    assert build_turn_segments(t2, [{"start": 5, "end": 3}, {"start": 9, "end": 12}]) == []  # end < start
    assert build_turn_segments("**A:** One.", [{"start": -1, "end": 4}]) == []               # negative start
    # A negative start produced by the offset is also rejected.
    assert build_turn_segments("**A:** One.", [{"start": 2, "end": 4}], offset=-3) == []


def test_split_turns_ignores_markdown_horizontal_rule():
    # A "---" separator between/after turns is NOT speech — it must not count
    # as a turn (otherwise the transcript turns misalign with timings.turns
    # and no dictation segments generate).
    transcript = "**A:** Good morning.\n\n**B:** Hello there.\n\n---"
    assert split_turns(transcript) == ["Good morning.", "Hello there."]
    assert split_sentences(transcript) == ["Good morning.", "Hello there."]
    # Other rule styles too.
    assert split_turns("**A:** Hi.\n\n***\n\n**B:** Bye.") == ["Hi.", "Bye."]


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
        self._range: tuple[int, int] | None = None

    def select(self, *_a, **_kw): self._mode = "select"; return self
    def insert(self, p): self._mode = "insert"; self._payload = p; return self
    def update(self, p): self._mode = "update"; self._payload = p; return self
    def eq(self, c, v): self._eq.append((c, v)); return self
    def in_(self, c, vals): self._eq.append((c, ("__in__", list(vals)))); return self
    def or_(self, expr): self._or = expr; return self
    def limit(self, *_a, **_kw): return self
    def order(self, *_a, **_kw): return self
    def range(self, s, e): self._range = (s, e); return self

    def _match(self, r):
        for c, v in self._eq:
            if isinstance(v, tuple) and len(v) == 2 and v[0] == "__in__":
                if r.get(c) not in v[1]:
                    return False
            elif r.get(c) != v:
                return False
        # ilike_or_filter sinh 'col.ilike."%pat%"' (value quoted + escaped) —
        # strip cả ngoặc kép lẫn % để so substring, case-insensitive.
        if getattr(self, "_or", None):
            hit = False
            for part in self._or.split(","):
                col, _op, pat = part.split(".", 2)
                if pat.strip('"').strip("%").lower() in str(r.get(col) or "").lower():
                    hit = True
                    break
            if not hit:
                return False
        return True

    def execute(self):
        rows = self.fake.tables.setdefault(self.name, [])
        if self._mode == "insert":
            payloads = self._payload if isinstance(self._payload, list) else [self._payload]
            for p in payloads:
                rows.append(dict(p))
            return _Resp(payloads)
        matched = [r for r in rows if self._match(r)]
        total = len(matched)
        if self._range:
            s, e = self._range
            matched = matched[s:e + 1]
        return _Resp(matched, count=total)


class _StorageBucket:
    def __init__(self, name): self.name = name
    def create_signed_url(self, path, ttl):
        return {"signedURL": f"https://storage.test/{self.name}/{path}?ttl={ttl}"}


class _Storage:
    def from_(self, name): return _StorageBucket(name)


class _Fake:
    def __init__(self):
        self.tables = {"listening_tests": [], "listening_content": [],
                       "dictation_sessions": [], "user_feedback": []}
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

    async def _admin(_authz):
        return {"id": "admin-1"}
    monkeypatch.setattr(listening_router, "require_admin", _admin)
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
    test = _seed_test(fake, test_type="mini")   # mig 157 — cột thật
    out = _run(listening_router.get_published_listening_test(
        test_id=test["id"], authorization=authz))
    assert out["test_type"] == "mini"


def test_get_test_detail_surfaces_test_type_full(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake, test_type="full")   # mig 157: NULL đã backfill
    out = _run(listening_router.get_published_listening_test(
        test_id=test["id"], authorization=authz))
    assert out["test_type"] == "full"


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


# ── Completion report (dictation_sessions) + content flags ─────────────────


def test_aggregate_dictation_report_rolls_up_ops_and_top_words():
    from services.listening_grader import grade_dictation, aggregate_dictation_report
    g1 = grade_dictation(reference_transcript="the quick brown fox",
                         user_transcript="the quick fox", ignore_fillers=True)  # miss 'brown'
    g2 = grade_dictation(reference_transcript="she sells seashells",
                         user_transcript="she sells shells", ignore_fillers=True)  # wrong 'seashells'
    rep = aggregate_dictation_report([g1, g2])
    assert rep["total_sentences"] == 2
    assert rep["error_trends"]["op_counts"]["miss"] == 1
    assert rep["error_trends"]["op_counts"]["wrong"] == 1
    # FULL maps (not truncated) so cross-session admin aggregation isn't lossy.
    assert rep["error_trends"]["missed"] == {"brown": 1}
    assert rep["error_trends"]["wrong"] == {"seashells": 1}


def _submit_session(test_id, section_num, sentences, authz, **kw):
    body = listening_router.DictationSessionRequest(
        test_id=test_id, section_num=section_num,
        sentences=[listening_router.DictationSentenceSubmit(**s) for s in sentences], **kw)
    return _run(listening_router.submit_listening_dictation_session(
        body=body, authorization=authz))


def test_submit_dictation_session_persists_and_reports(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    _seed_section(fake, test["id"], 1, "The address is Brighton. It opens at ten.")
    out = _submit_session(test["id"], 1, [
        {"sentence_idx": 0, "user_transcript": "the address is brighton", "listen_count": 2},
        {"sentence_idx": 1, "user_transcript": "it opens at", "time_seconds": 9},   # miss 'ten'
    ], authz, total_time_seconds=42)
    assert out["total_sentences"] == 2
    assert out["correct_count"] == 1                       # sentence 0 perfect
    assert 0 < out["accuracy"] < 1.0
    assert out["error_trends"]["op_counts"]["miss"] >= 1
    assert out["total_time_seconds"] == 42
    # Persisted exactly one session row for this user.
    rows = fake.tables["dictation_sessions"]
    assert len(rows) == 1 and rows[0]["user_id"] == "user-1"
    assert rows[0]["test_id_external"] == test["test_id"]


def test_submit_dictation_session_rejects_partial_or_duplicate_coverage(monkeypatch):
    # A completion report must cover the whole section exactly once — a subset
    # (or a duplicate/out-of-range index) would persist a corrupt aggregate.
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    _seed_section(fake, test["id"], 1, "The address is Brighton. It opens at ten.")  # 2 units
    with pytest.raises(HTTPException) as e1:   # only 1 of 2
        _submit_session(test["id"], 1, [{"sentence_idx": 0, "user_transcript": "x"}], authz)
    assert e1.value.status_code == 422
    with pytest.raises(HTTPException) as e2:   # duplicate index
        _submit_session(test["id"], 1, [
            {"sentence_idx": 0, "user_transcript": "x"},
            {"sentence_idx": 0, "user_transcript": "y"}], authz)
    assert e2.value.status_code == 422
    with pytest.raises(HTTPException) as e3:   # out of range
        _submit_session(test["id"], 1, [
            {"sentence_idx": 0, "user_transcript": "x"},
            {"sentence_idx": 5, "user_transcript": "y"}], authz)
    assert e3.value.status_code == 422


def test_submit_dictation_session_empty_422(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    _seed_section(fake, test["id"], 1, "Hello there.")
    with pytest.raises(HTTPException) as e:
        _submit_session(test["id"], 1, [], authz)
    assert e.value.status_code == 422


def test_submit_dictation_session_404_for_draft(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake, status="draft")
    _seed_section(fake, test["id"], 1, "Hello there.")
    with pytest.raises(HTTPException) as e:
        _submit_session(test["id"], 1, [{"sentence_idx": 0, "user_transcript": "x"}], authz)
    assert e.value.status_code == 404


def test_get_dictation_session_owner_only(monkeypatch):
    fake, authz = _patch(monkeypatch)
    fake.tables["dictation_sessions"].append({"id": "s1", "user_id": "another-user"})
    with pytest.raises(HTTPException) as e:
        _run(listening_router.get_listening_dictation_session(session_id="s1", authorization=authz))
    assert e.value.status_code == 403


def test_flag_dictation_inserts_user_feedback(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    body = listening_router.DictationFlagRequest(
        test_id=test["id"], section_num=1, sentence_idx=2,
        category="audio_unclear", note="tiếng ồn ở giây 12")
    out = _run(listening_router.flag_listening_dictation(body=body, authorization=authz))
    assert out["status"] == "new"
    fb = fake.tables["user_feedback"]
    assert len(fb) == 1
    row = fb[0]
    assert row["type"] == "report" and row["skill"] == "listening"
    assert row["attempt_id"] is None                       # dictation is attempt-free
    assert row["test_id"] == test["test_id"] and row["q_num"] == 3
    assert "chép chính tả" in row["note"] and row["created_by"] == "user-1"


def test_flag_dictation_requires_category_or_note(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    body = listening_router.DictationFlagRequest(test_id=test["id"], section_num=1)
    with pytest.raises(HTTPException) as e:
        _run(listening_router.flag_listening_dictation(body=body, authorization=authz))
    assert e.value.status_code == 422


def test_admin_list_and_aggregate_dictation_reports(monkeypatch):
    fake, authz = _patch(monkeypatch)
    fake.tables["dictation_sessions"].extend([
        {"id": "a", "user_id": "u1", "test_id_external": "ILR-LIS-LSN-L01", "section_num": 3,
         "accuracy": 0.8, "created_at": "2026-07-07T01:00:00Z",
         "error_trends": {"missed": {"brighton": 2}, "wrong": {}}},
        {"id": "b", "user_id": "u2", "test_id_external": "ILR-LIS-LSN-L01", "section_num": 3,
         "accuracy": 0.6, "created_at": "2026-07-07T02:00:00Z",
         "error_trends": {"missed": {"brighton": 1}, "wrong": {}}},
    ])
    fake.tables["users"] = [
        {"id": "u1", "email": "u1@ex.com", "display_name": "Học Viên 1"},
        {"id": "u2", "email": "u2@ex.com", "display_name": "Học Viên 2"},
    ]
    lst = _run(listening_router.admin_list_dictation_reports(
        test_id=None, user_query=None, limit=30, offset=0, authorization=authz))
    assert lst["total"] == 2 and len(lst["items"]) == 2
    # audit 2026-07-17: item phải mang danh tính học viên, không chỉ user_id trần
    by_uid = {it["user"]["id"]: it["user"] for it in lst["items"]}
    assert by_uid["u1"]["email"] == "u1@ex.com"
    assert by_uid["u2"]["display_name"] == "Học Viên 2"
    # filter theo học viên (ilike email/tên)
    only_u1 = _run(listening_router.admin_list_dictation_reports(
        test_id=None, user_query="u1@ex", limit=30, offset=0, authorization=authz))
    assert only_u1["total"] == 1 and only_u1["items"][0]["user"]["id"] == "u1"
    agg = _run(listening_router.admin_dictation_reports_aggregate(
        test_id="ILR-LIS-LSN-L01", user_query=None, authorization=authz))
    assert agg["session_count"] == 2
    assert agg["mean_accuracy"] == 0.7
    assert agg["top_missed"][0] == {"word": "brighton", "count": 3}
    # aggregate phải CÙNG phạm vi với bảng khi lọc học viên (review P2 #809)
    agg_u1 = _run(listening_router.admin_dictation_reports_aggregate(
        test_id=None, user_query="u1@ex", authorization=authz))
    assert agg_u1["session_count"] == 1
    assert agg_u1["mean_accuracy"] == 0.8
    agg_none = _run(listening_router.admin_dictation_reports_aggregate(
        test_id=None, user_query="khong-ai-ca", authorization=authz))
    assert agg_none == {"session_count": 0, "mean_accuracy": 0.0,
                        "top_missed": [], "top_wrong": []}


def test_admin_dictation_reports_requires_admin(monkeypatch):
    fake, authz = _patch(monkeypatch)

    async def _deny(_authz):
        raise HTTPException(403, "Không có quyền truy cập")
    monkeypatch.setattr(listening_router, "require_admin", _deny)
    with pytest.raises(HTTPException) as e:
        _run(listening_router.admin_list_dictation_reports(
            test_id=None, user_query=None, limit=30, offset=0, authorization=authz))
    assert e.value.status_code == 403
