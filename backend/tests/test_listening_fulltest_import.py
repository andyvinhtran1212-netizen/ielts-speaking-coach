"""tests/test_listening_fulltest_import.py — listening-fulltest-md-import Phase A.

Lesson 20: assert the REAL parsed VALUES from the committed sample pack
(docs/content-samples/listening-full-test/ILR-LIS-001) — not "parser ran".
Plus the FAIL-LOUD validation (missing answer / missing window / audio↔timings
divergence) and the admin-gated dry-run endpoint.
"""

from __future__ import annotations

import asyncio
import copy
import json
import pathlib

import pytest
from fastapi import HTTPException

from services import listening_fulltest_import as imp
from routers import listening as listening_module

_PACK = (pathlib.Path(__file__).parent.parent.parent
         / "docs/content-samples/listening-full-test/ILR-LIS-001")


def _load():
    qp = (_PACK / "ILR_LIS_001_Question_Paper.md").read_text(encoding="utf-8")
    sol = (_PACK / "ILR_LIS_001_Solution.md").read_text(encoding="utf-8")
    tim = json.loads((_PACK / "timings.json").read_text(encoding="utf-8"))
    return qp, sol, tim


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── Parse: real values from the sample (Lesson 20) ────────────────────

def test_parse_clean_pack_has_40_questions_4_sections_no_errors():
    qp, sol, tim = _load()
    r = imp.parse_fulltest(qp, sol, tim)
    assert r.ok, r.errors
    assert len(r.questions) == 40
    assert len(r.sections) == 4
    assert [s["question_count"] for s in r.sections] == [10, 10, 10, 10]
    assert r.metadata["test_id"] == "ILR-LIS-001"
    assert r.metadata["band_target"] == 5.5


def test_parse_answers_match_quick_answer_key():
    qp, sol, tim = _load()
    by_q = {q["q_num"]: q for q in imp.parse_fulltest(qp, sol, tim).questions}
    assert by_q[1]["answer"] == "Brighton"
    assert by_q[11]["answer"] == "C"
    assert by_q[21]["answer"] == "B"
    assert by_q[31]["answer"] == "crime"
    assert by_q[40]["answer"] == "surveillance"


def test_parse_audio_windows_are_full_test_absolute():
    qp, sol, tim = _load()
    by_q = {q["q_num"]: q for q in imp.parse_fulltest(qp, sol, tim).questions}
    # v1.2 pack (render-exact, S1 offset 29.34): Q1 = 117.67–124.66
    assert by_q[1]["audio_window"] == {"start": 117.67, "end": 124.66, "section": "S1"}
    # Q7 & Q8 share a window (two answers in one turn)
    assert by_q[7]["audio_window"]["start"] == 330.27
    assert by_q[8]["audio_window"] == by_q[7]["audio_window"]
    # Q11 (S2): 507.25 ; Q31 (S4): 1357.61
    assert by_q[11]["audio_window"]["start"] == 507.25
    assert by_q[31]["audio_window"]["start"] == 1357.61


def test_parse_map_question_keeps_img_prompt():
    qp, sol, tim = _load()
    by_q = {q["q_num"]: q for q in imp.parse_fulltest(qp, sol, tim).questions}
    assert by_q[16]["question_type"] == "mcq_letter_label"
    assert by_q[16]["img_prompt"] and "floor plan" in by_q[16]["img_prompt"].lower()


def test_parse_rich_solution_fields_captured():
    qp, sol, tim = _load()
    by_q = {q["q_num"]: q for q in imp.parse_fulltest(qp, sol, tim).questions}
    s1 = by_q[1]["solution"]
    # the translation field must NOT be mis-captured as the answer (it contains
    # "đáp án" in its label) — collision-free classification
    assert "Brighton" in (s1.get("translation_vi") or "")
    assert "/ˈbraɪ.tən/" in (s1.get("vocab_focus") or "")   # vocab list w/ IPA
    s21 = by_q[21]["solution"]
    assert s21.get("why_correct") and s21.get("script")


def test_parse_audio_link_unit():
    link = imp.parse_audio_link("audio://full_test.mp3?start=126.32&end=135.64&q=1&section=S1")
    assert link == {"file": "full_test.mp3", "start": 126.32, "end": 135.64, "q": 1, "section": "S1"}
    assert imp.parse_audio_link("audio://x?start=foo") is None


def test_band_conversion_and_topic_distribution_parsed():
    qp, sol, tim = _load()
    r = imp.parse_fulltest(qp, sol, tim)
    assert len(r.metadata["band_conversion"]) == 10
    assert r.metadata["topic_distribution"]["s1"].startswith("Cookery")


# ── Fail-loud validation ──────────────────────────────────────────────

def test_validation_flags_audio_timings_divergence():
    qp, sol, tim = _load()
    bad = copy.deepcopy(tim)
    # shift Q1's section-relative start by 5s → abs window diverges from audio://
    bad["sections"][0]["questions"]["1"]["start"] += 5.0
    r = imp.parse_fulltest(qp, sol, bad)
    assert not r.ok
    assert any("Q1" in e and "lệch" in e for e in r.errors), r.errors


def test_validation_flags_missing_answer():
    qp, sol, tim = _load()
    broken = sol.replace("**1.** Brighton", "**1.** ")   # blank the QAK cell for Q1
    r = imp.parse_fulltest(qp, broken, tim)
    assert not r.ok
    assert any("Q1" in e and "đáp án" in e for e in r.errors), r.errors


def test_validation_flags_missing_audio_window():
    qp, sol, tim = _load()
    broken = sol.replace(
        "audio://full_test.mp3?start=117.67&end=124.66&q=1&section=S1", "")
    r = imp.parse_fulltest(qp, broken, tim)
    assert not r.ok
    assert any("Q1" in e and "audio" in e.lower() for e in r.errors), r.errors


# ── Dry-run endpoint (admin-gated, no DB writes) ──────────────────────

class _DupNone:
    def table(self, *a, **k): return self
    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def neq(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def execute(self): return type("R", (), {"data": []})()


def test_dry_run_endpoint_requires_admin(monkeypatch):
    async def _deny(_a): raise HTTPException(403, "forbidden")
    monkeypatch.setattr(listening_module, "require_admin", _deny)
    from fastapi import UploadFile
    import io
    with pytest.raises(HTTPException) as e:
        _run(listening_module.admin_import_fulltest_dry_run(
            question_paper=UploadFile(filename="q.md", file=io.BytesIO(b"x")),
            solution=UploadFile(filename="s.md", file=io.BytesIO(b"x")),
            timings=UploadFile(filename="t.json", file=io.BytesIO(b"{}")),
            authorization=None))
    assert e.value.status_code == 403


def test_dry_run_endpoint_returns_preview_for_admin(monkeypatch):
    import io
    from fastapi import UploadFile
    async def _ok(_a): return {"id": "admin", "role": "admin"}
    monkeypatch.setattr(listening_module, "require_admin", _ok)
    monkeypatch.setattr(listening_module, "supabase_admin", _DupNone())
    qp, sol, tim = _load()
    out = _run(listening_module.admin_import_fulltest_dry_run(
        question_paper=UploadFile(filename="ILR_LIS_001_Question_Paper.md", file=io.BytesIO(qp.encode())),
        solution=UploadFile(filename="ILR_LIS_001_Solution.md", file=io.BytesIO(sol.encode())),
        timings=UploadFile(filename="timings.json", file=io.BytesIO(json.dumps(tim).encode())),
        authorization="x"))
    assert out["ok"] is True
    assert out["question_count"] == 40
    assert out["metadata"]["test_id"] == "ILR-LIS-001"


# ── A2: persistence builders + grader compatibility ───────────────────

def test_answer_variants_split():
    assert imp.split_answer_variants("12 / twelve") == ("12", ["twelve"])
    assert imp.split_answer_variants("(the) police") == ("police", ["the police"])
    assert imp.split_answer_variants("Brighton") == ("Brighton", [])


def test_build_section_persistence_shapes():
    qp, sol, tim = _load()
    r = imp.parse_fulltest(qp, sol, tim)
    secs = imp.build_section_persistence(r, qp)
    assert len(secs) == 4
    s1 = secs[0]
    assert s1["content_row"]["source_type"] == "test_section"
    assert s1["content_row"]["ielts_section"] == 1
    # block-shaped: S1 has 3 blocks (form 1-6, table 7-8, short 9-10)
    assert len(s1["exercise_rows"]) == 3
    ex0 = s1["exercise_rows"][0]
    assert ex0["q_range"] == (1, 6)
    # grader-compatible answers + review enrichment in the SAME payload
    assert [a["answer"] for a in ex0["payload"]["answers"]][0] == "Brighton"
    assert set(ex0["payload"]["audio_windows"].keys()) == {"1", "2", "3", "4", "5", "6"}
    assert "1" in ex0["payload"]["solutions"]


def test_v12_full_transcript_parsed_per_section():
    """v1.2: the `# Transcript (bản đọc)` block ingests as the per-section
    display transcript — real values from the pack, not 'block exists'."""
    qp, sol, tim = _load()
    r = imp.parse_fulltest(qp, sol, tim)
    assert r.metadata["format_version"] == "listening-fulltest-v1.2"
    assert r.metadata["transcript_source"] == "fulltext"
    disp = r.display_transcript
    assert sorted(disp) == [1, 2, 3, 4]
    assert all(len(disp[s]) > 0 for s in disp)            # every section non-empty
    # real content from the pack
    assert any("Daniel Brennan" in p for p in disp[1])
    assert any(p.startswith("**Helen (Course coordinator):**") for p in disp[1])


def test_v12_transcript_anchors_cover_all_40_and_point_to_the_right_paragraph():
    """Lesson 20: each anchor must land on the CORRECT display paragraph,
    verified by value — not merely present."""
    qp, sol, tim = _load()
    r = imp.parse_fulltest(qp, sol, tim)
    anchors = r.transcript_anchors
    assert len(anchors) == 40 and not [q["q_num"] for q in r.questions
                                       if q["q_num"] not in anchors]
    disp = r.display_transcript
    # Q1 → the Daniel turn that spells Brighton
    p1 = disp[1][anchors[1]]
    assert "Brighton" in p1 and "B-R-I-G-H-T-O-N" in p1
    # Q7 & Q8 share ONE turn → same paragraph index (structural dedup)
    assert anchors[7] == anchors[8]
    p78 = disp[1][anchors[7]].lower()
    assert "meat" in p78 and "pastry" in p78


def test_v12_anchor_stored_in_payload_and_transcript_is_full_copy():
    qp, sol, tim = _load()
    r = imp.parse_fulltest(qp, sol, tim)
    secs = imp.build_section_persistence(r, qp)
    s1 = secs[0]
    # the section transcript is the full bản đọc (multi-paragraph), not joined extracts
    assert s1["content_row"]["transcript"].count("**") >= 10      # many speaker labels
    assert s1["content_row"]["metadata"]["transcript_source"] == "fulltext"
    assert s1["content_row"]["metadata"]["source_format"] == "listening-fulltest-v1.2"
    # per-question anchor rides the payload (Pattern #15, no migration)
    ex0 = s1["exercise_rows"][0]
    assert "1" in ex0["payload"]["transcript_anchors"]
    assert isinstance(ex0["payload"]["transcript_anchors"]["1"], int)


def test_v11_backward_compat_falls_back_when_no_transcript_block():
    """A pack WITHOUT the v1.2 transcript block must not hard-fail: fallback to
    joined-extracts + a dry-run warning (legacy v1.1 packs keep importing)."""
    qp, sol, tim = _load()
    # strip both transcript blocks (simulate a v1.1 pack)
    cut = sol.split("\n# Transcript (bản đọc")[0]
    r = imp.parse_fulltest(qp, cut, tim)
    assert not r.errors                                   # still parses
    assert r.display_transcript == {}
    assert r.metadata["transcript_source"] == "joined-extracts"
    assert any("fallback joined-extracts" in w for w in r.warnings)
    secs = imp.build_section_persistence(r, qp)
    assert secs[0]["content_row"]["transcript"]          # synthesised, non-empty


def test_built_exercises_are_gradeable_by_existing_grader():
    """The enriched block payloads must still grade via the existing
    listening_test_grader (collect_answer_key reads payload.answers)."""
    from services import listening_test_grader as grader
    qp, sol, tim = _load()
    r = imp.parse_fulltest(qp, sol, tim)
    exercise_rows = [ex for sec in imp.build_section_persistence(r, qp)
                     for ex in sec["exercise_rows"]]
    key = grader.collect_answer_key(exercise_rows)
    assert len(key) == 40
    # a perfect attempt scores 40; Q10 accepts the "twelve" alternative
    user = [{"q_num": k["q_num"], "user_answer": k["answer"]} for k in key]
    user_q10 = next(u for u in user if u["q_num"] == 10)
    user_q10["user_answer"] = "twelve"   # alternative of "12"
    result = grader.grade_attempt(user, key)
    assert result["score"] == 40, [pq for pq in result["per_question"] if not pq["correct"]]


def test_cue_points_from_offsets():
    cp = imp.build_cue_points({"S1": 31.22, "S2": 452.6, "S3": 845.66, "S4": 1261.55})
    assert cp == [
        {"type": "section", "section_num": 1, "timestamp_seconds": 31.22},
        {"type": "section", "section_num": 2, "timestamp_seconds": 452.6},
        {"type": "section", "section_num": 3, "timestamp_seconds": 845.66},
        {"type": "section", "section_num": 4, "timestamp_seconds": 1261.55},
    ]


# ── A2: commit endpoint (mocked supabase + audio) ─────────────────────

class _CommitStub:
    def __init__(self):
        self.inserts: list[tuple] = []
        self.deletes: list[str] = []
    def table(self, name): self._t = name; return self
    def select(self, *a, **k): return self
    def eq(self, *a, **k): self._eq = a; return self
    def neq(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def insert(self, payload): self.inserts.append((self._t, payload)); return self
    def delete(self): self._del = True; return self
    def execute(self):
        if getattr(self, "_del", False):
            self._del = False
            return type("R", (), {"data": []})()
        return type("R", (), {"data": []})()   # dup-check → none


def test_commit_endpoint_persists_fulltest(monkeypatch):
    import io
    from fastapi import UploadFile
    from services import listening_audio

    async def _ok(_a): return {"id": "admin", "role": "admin"}
    monkeypatch.setattr(listening_module, "require_admin", _ok)
    stub = _CommitStub()
    monkeypatch.setattr(listening_module, "supabase_admin", stub)
    monkeypatch.setattr(listening_module, "_upload_audio_to_bucket", lambda path, b: None)
    monkeypatch.setattr(listening_audio, "validate_full_audio",
                        lambda b: {"duration_seconds": 1657, "size_bytes": len(b), "errors": [], "warnings": []})

    qp, sol, tim = _load()
    out = _run(listening_module.admin_import_fulltest_commit(
        question_paper=UploadFile(filename="qp.md", file=io.BytesIO(qp.encode())),
        solution=UploadFile(filename="sol.md", file=io.BytesIO(sol.encode())),
        timings=UploadFile(filename="t.json", file=io.BytesIO(json.dumps(tim).encode())),
        audio=UploadFile(filename="full_test.mp3", file=io.BytesIO(b"x" * 5000)),
        authorization="x"))

    assert out["test_id"] == "ILR-LIS-001"
    assert out["sections_created"] == 4
    # one row per Question-Paper block: S1=3, S2=2, S3=2, S4=3 = 10 (carrying 40 answers)
    assert out["exercises_created"] == 10

    tests_rows = [p for (t, p) in stub.inserts if t == "listening_tests"]
    assert len(tests_rows) == 1
    tr = tests_rows[0]
    assert tr["audio_assembly_mode"] == "full_premixed"
    assert tr["full_audio_storage_path"].endswith("/full.mp3")
    assert tr["full_audio_duration_seconds"] == 1657
    assert len(tr["cue_points"]) == 4
    assert tr["status"] == "draft"
    content_rows = [p for (t, p) in stub.inserts if t == "listening_content"]
    assert len(content_rows) == 4


class _RollbackStub:
    """Raises on the configured table's INSERT; records deletes + storage
    removes so the test can assert a FULL rollback (no orphan)."""
    def __init__(self, fail_on):
        self.fail_on = fail_on
        self.inserts: list = []
        self.deletes: list = []
        self.removed: list = []
        self.storage = self
    def table(self, n): self._t = n; return self
    def from_(self, b): return self
    def select(self, *a, **k): return self
    def eq(self, *a, **k): self._eq = a; return self
    def neq(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def insert(self, payload):
        if self._t == self.fail_on:
            raise RuntimeError(f"boom inserting {self._t}")
        self.inserts.append((self._t, payload)); return self
    def delete(self): self._del = True; return self
    def remove(self, paths): self.removed.extend(paths); return self
    def execute(self):
        if getattr(self, "_del", False):
            self._del = False
            self.deletes.append((self._t, getattr(self, "_eq", None)))
            return type("R", (), {"data": []})()
        return type("R", (), {"data": []})()


def test_commit_rolls_back_fully_on_insert_failure(monkeypatch):
    """An insert failure mid-persist must leave NO orphan: test row, content,
    exercises, and the uploaded mp3 are all removed (the prod-500 fix)."""
    import io
    from fastapi import UploadFile
    from services import listening_audio
    async def _ok(_a): return {"id": "admin", "role": "admin"}
    monkeypatch.setattr(listening_module, "require_admin", _ok)
    stub = _RollbackStub(fail_on="listening_exercises")     # fail on first exercise insert
    monkeypatch.setattr(listening_module, "supabase_admin", stub)
    monkeypatch.setattr(listening_module, "_upload_audio_to_bucket", lambda p, b: None)
    monkeypatch.setattr(listening_audio, "validate_full_audio",
                        lambda b: {"duration_seconds": 1657, "size_bytes": len(b), "errors": [], "warnings": []})
    qp, sol, tim = _load()
    with pytest.raises(HTTPException) as e:
        _run(listening_module.admin_import_fulltest_commit(
            question_paper=UploadFile(filename="qp.md", file=io.BytesIO(qp.encode())),
            solution=UploadFile(filename="sol.md", file=io.BytesIO(sol.encode())),
            timings=UploadFile(filename="t.json", file=io.BytesIO(json.dumps(tim).encode())),
            audio=UploadFile(filename="a.mp3", file=io.BytesIO(b"x" * 5000)),
            authorization="x"))
    assert e.value.status_code == 500
    deleted_tables = {d[0] for d in stub.deletes}
    assert "listening_tests" in deleted_tables          # orphan test row removed
    assert "listening_content" in deleted_tables        # content removed
    assert "listening_exercises" in deleted_tables      # exercises removed
    assert stub.removed and stub.removed[0].endswith("/full.mp3")   # mp3 removed


def test_commit_endpoint_requires_admin(monkeypatch):
    import io
    from fastapi import UploadFile
    async def _deny(_a): raise HTTPException(403, "forbidden")
    monkeypatch.setattr(listening_module, "require_admin", _deny)
    with pytest.raises(HTTPException) as e:
        _run(listening_module.admin_import_fulltest_commit(
            question_paper=UploadFile(filename="q.md", file=io.BytesIO(b"x")),
            solution=UploadFile(filename="s.md", file=io.BytesIO(b"x")),
            timings=UploadFile(filename="t.json", file=io.BytesIO(b"{}")),
            audio=UploadFile(filename="a.mp3", file=io.BytesIO(b"x")),
            authorization=None))
    assert e.value.status_code == 403


# ── W-0 no-silent-drop (fix L02) ──────────────────────────────────────

def test_orphan_heading_is_a_hard_error_not_a_silent_drop():
    """A `### Question(s) …` heading the parser can't read drops every item
    under it. The importer must FAIL LOUD (red banner / blocked commit), never
    swallow the questions."""
    import re
    qp, sol, tim = _load()
    # Corrupt the first range heading "### Questions 1-6" → "### Questions 1 to 6"
    # (lenient heading match, but the strict block parser rejects "to").
    broken_qp = re.sub(r"^(###\s+Questions?\s+\d+)\s*-\s*(\d+)\s*$",
                       r"\1 to \2", qp, count=1, flags=re.MULTILINE)
    assert broken_qp != qp, "fixture did not corrupt a heading"
    r = imp.parse_fulltest(broken_qp, sol, tim)
    assert not r.ok
    assert any("không tạo được câu hỏi" in e for e in r.errors), r.errors


def test_tail_truncation_surfaces_via_answer_key_cross_check():
    """The contiguity check only catches HOLES (1..max). A TAIL-drop (Q5/Q6 lost)
    leaves 1..max contiguous and passes silently — the Answer-Key cross-check is
    what makes it loud. Orphan answered q_num with no parsed question → error."""
    res = imp.FullTestParseResult()
    qak = {1: "a", 2: "b", 3: "c"}      # answer key declares 3 answers
    seen_q = {1, 2}                       # but only 2 questions parsed (tail-drop of 3)
    imp._validate(res, qak, {}, {"questions": {}}, seen_q)
    assert any("Answer Key" in e and "3" in e for e in res.errors), res.errors


def test_clean_pack_has_no_orphan_drop_errors():
    """Regression — the real 001 pack (all `### Questions N-M` ranges) must stay
    error-free under the new W-0 checks (optional-group widening is backward-compat)."""
    qp, sol, tim = _load()
    r = imp.parse_fulltest(qp, sol, tim)
    assert r.ok, r.errors
    assert not any("không tạo được câu hỏi" in e or "Answer Key" in e for e in r.errors)
