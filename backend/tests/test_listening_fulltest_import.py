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
    # Q1 (S1, offset 31.22): 95.1+31.22 = 126.32
    assert by_q[1]["audio_window"] == {"start": 126.32, "end": 135.64, "section": "S1"}
    # Q7 & Q8 share a window (two answers in one turn)
    assert by_q[7]["audio_window"]["start"] == 339.32
    assert by_q[8]["audio_window"] == by_q[7]["audio_window"]
    # Q11 (S2, offset 452.6): 61.33+452.6 = 513.93
    assert by_q[11]["audio_window"]["start"] == 513.93


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
        "audio://full_test.mp3?start=126.32&end=135.64&q=1&section=S1", "")
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
