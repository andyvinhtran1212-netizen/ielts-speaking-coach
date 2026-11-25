"""COURSEACCESS-0055 FR-035 / FR-036 (G04-T13, plan 5.16): pronunciation sample.

With the runtime flag `pron_sample_window` on, Azure (always fake here) hears
one middle window of every Part, Part 1 sessions send only one answer, and
the route records what Azure heard (migration 502 columns) and returns it as
``pronunciation.sample``. With the flag off the route is unchanged — the
pinned file tests/test_grading_pron_part2_segment.py runs unmodified.

The route tests execute the whole endpoint with fake DB/AI/storage (the
harness of test_core_speaking_grade_observation) and capture the row handed
to save_response.
"""

from __future__ import annotations

import asyncio
import sys
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import UploadFile

sys.path.insert(0, str(Path(__file__).parent.parent))

from routers import grading  # noqa: E402
from services.pronunciation_sampling import PronSample  # noqa: E402
from test_admin_speaking_sessions import _DB  # noqa: E402

AZURE = {"pronunciation_score": 80.0, "fluency_score": 80.0, "accuracy_score": 78.0,
         "completeness_score": 90.0, "short_summary": ["Phát âm khá rõ."], "raw_payload": {}}


def _fake_assess(calls):
    async def _fake(*, audio_bytes, content_type, locale, reference_text, **usage):
        calls.append({"bytes": audio_bytes, "ct": content_type, "audio_seconds": usage.get("audio_seconds")})
        return dict(AZURE)
    return _fake


# ── _assess_pronunciation_sampled (step 1) ──────────────────────────────────

def _sampled(monkeypatch, duration, extract):
    calls, cuts = [], []

    def fake_extract(audio, start, end):
        cuts.append((start, end))
        return extract(audio)

    monkeypatch.setattr(grading, "extract_audio_segment", fake_extract)
    monkeypatch.setattr(grading.azure_pronunciation, "assess_pronunciation", _fake_assess(calls))
    out = asyncio.run(grading._assess_pronunciation_sampled(
        b"AUDIO", "audio/webm", duration_sec=duration, sample_seconds=30,
        user_id="u", session_id="s", resource_type="question", resource_id="q"))
    return out, calls, cuts


def test_long_answer_sends_the_middle_window_as_wav(monkeypatch):
    (res, sample), calls, cuts = _sampled(monkeypatch, 120.0, lambda _a: b"WAV")
    assert cuts == [(45.0, 75.0)]
    assert calls == [{"bytes": b"WAV", "ct": "audio/wav", "audio_seconds": 30.0}]
    assert res["pronunciation_score"] == 80.0
    assert sample == PronSample("segment", 45.0, 75.0)


def test_short_answer_sends_whole_recording(monkeypatch):
    (_, sample), calls, cuts = _sampled(monkeypatch, 20.0, lambda _a: b"WAV")
    assert cuts == []
    assert calls[0]["bytes"] == b"AUDIO" and calls[0]["ct"] == "audio/webm"
    assert sample == PronSample("full")


def test_cut_failure_sends_whole_recording(monkeypatch):
    def boom(_a):
        raise RuntimeError("ffmpeg boom")
    (res, sample), calls, _ = _sampled(monkeypatch, 120.0, boom)
    assert calls[0]["bytes"] == b"AUDIO" and calls[0]["audio_seconds"] == 120.0
    assert res is not None and sample == PronSample("full")


def test_identity_return_keeps_original_label(monkeypatch):
    (_, sample), calls, _ = _sampled(monkeypatch, 120.0, lambda audio: audio)
    assert calls[0]["bytes"] == b"AUDIO" and calls[0]["ct"] == "audio/webm"
    assert sample == PronSample("full")


def test_azure_failure_still_reports_what_was_sent(monkeypatch):
    async def down(**_k):
        raise RuntimeError("azure down")
    monkeypatch.setattr(grading, "extract_audio_segment", lambda *_a: b"WAV")
    monkeypatch.setattr(grading.azure_pronunciation, "assess_pronunciation", down)
    res, sample = asyncio.run(grading._assess_pronunciation_sampled(
        b"AUDIO", "audio/webm", duration_sec=120.0, sample_seconds=30))
    assert res is None and sample == PronSample("segment", 45.0, 75.0)


# ── _merge_pronunciation_into_grading with a sample (step 3) ────────────────

def _grade():
    return {"band_fc": 6, "band_lr": 7, "band_gra": 6, "band_p": 9, "overall_band": 7.0,
            "p_feedback": "text-only guess"}


def test_not_sampled_test_mode_uses_three_criteria_and_its_own_text():
    g = _grade()
    detail = grading._merge_pronunciation_into_grading(
        g, None, is_practice=False, sample=PronSample("not_sampled"))
    assert g["band_p"] is None
    assert g["pronunciation_source"] == "not_sampled"
    assert g["p_feedback"] == grading._PRON_NOT_SAMPLED_FEEDBACK
    assert g["p_feedback"] != grading._PRON_UNAVAILABLE_FEEDBACK
    assert g["overall_band"] == grading._round_band((6 + 7 + 6) / 3)
    assert detail == {"status": "not_sampled", "provider": "azure",
                      "sample": {"scope": "not_sampled", "start_s": None, "end_s": None}}


def test_not_sampled_practice_mode_leaves_band_p_absent():
    g = {"overall_band": 6.0}
    detail = grading._merge_pronunciation_into_grading(
        g, None, is_practice=True, sample=PronSample("not_sampled"))
    assert "band_p" not in g and detail["status"] == "not_sampled"


def test_sampled_detail_carries_the_window():
    g = _grade()
    detail = grading._merge_pronunciation_into_grading(
        g, dict(AZURE), is_practice=False, sample=PronSample("segment", 45.0, 75.0))
    assert g["pronunciation_source"] == "azure" and g["band_p"] is not None
    assert detail["status"] == "completed"
    assert detail["sample"] == {"scope": "segment", "start_s": 45.0, "end_s": 75.0}


def test_no_sample_argument_keeps_the_old_detail_shape():
    detail = grading._merge_pronunciation_into_grading(_grade(), dict(AZURE), is_practice=False)
    assert "sample" not in detail


# ── _should_sample_pronunciation (step 2) ───────────────────────────────────

def _should(monkeypatch, rows, question, duration, *, fail=False):
    async def execute(builder):
        if fail:
            raise RuntimeError("db down")
        return builder(_DB(responses=rows)).execute()
    monkeypatch.setattr(grading, "aexecute", execute)
    return asyncio.run(grading._should_sample_pronunciation("s1", question, duration))


def _done(session, question, **extra):
    return {"session_id": session, "question_id": question, "pronunciation_status": "completed",
            "grading_status": "completed", "final_band_p": 7.0, **extra}


def test_should_sample_rules(monkeypatch):
    done_a = [_done("s1", "qa")]
    other_session = [_done("s2", "qa")]
    failed_a = [{"session_id": "s1", "question_id": "qa", "pronunciation_status": None}]
    assert _should(monkeypatch, [], "qb", 15.0) is True             # first long answer
    assert _should(monkeypatch, done_a, "qb", 20.0) is False        # another answer was assessed
    assert _should(monkeypatch, done_a, "qa", 5.0) is True          # re-record keeps its sample
    assert _should(monkeypatch, [], "qb", 8.0) is False             # shorter than 12 s: wait
    assert _should(monkeypatch, other_session, "qb", 8.0) is False  # other sessions don't count
    assert _should(monkeypatch, other_session, "qb", 15.0) is True
    assert _should(monkeypatch, failed_a, "qb", 15.0) is True       # Azure failed on qa → still open
    assert _should(monkeypatch, [], "qb", 0.0) is True              # unknown duration is not "short"
    assert _should(monkeypatch, done_a, "qb", 20.0, fail=True) is True  # read error → assess


def test_a_sample_without_a_usable_p_band_does_not_use_up_the_session(monkeypatch):
    # Codex P2 on #2514: Azure succeeded but the text grade failed → the row
    # is pronunciation 'completed' with final_band_p cleared.
    grader_failed = [_done("s1", "qa", grading_status="failed", final_band_p=None)]
    no_band = [_done("s1", "qa", final_band_p=None)]
    assert _should(monkeypatch, grader_failed, "qb", 20.0) is True
    assert _should(monkeypatch, no_band, "qb", 20.0) is True
    # Practice mode has no final_band_p: a graded practice answer counts.
    practice = [_done("s1", "qa", final_band_p=None)]

    async def execute(builder):
        return builder(_DB(responses=practice)).execute()
    monkeypatch.setattr(grading, "aexecute", execute)
    assert asyncio.run(grading._should_sample_pronunciation("s1", "qb", 20.0, is_practice=True)) is False
    grader_failed_practice = [_done("s1", "qa", grading_status="failed", final_band_p=None)]

    async def execute2(builder):
        return builder(_DB(responses=grader_failed_practice)).execute()
    monkeypatch.setattr(grading, "aexecute", execute2)
    assert asyncio.run(grading._should_sample_pronunciation("s1", "qb", 20.0, is_practice=True)) is True


def test_one_per_session_parts_parsing(monkeypatch):
    monkeypatch.setattr(grading.settings, "PRON_ONE_PER_SESSION_PARTS", " 1, 3 ,x,")
    assert grading._pron_one_per_session_parts() == frozenset({1, 3})
    monkeypatch.setattr(grading.settings, "PRON_ONE_PER_SESSION_PARTS", "")
    assert grading._pron_one_per_session_parts() == frozenset()


# ── The whole route (steps 1–4) ─────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _entitled(monkeypatch):
    monkeypatch.setattr(grading, "require_speaking_entitlement", lambda *_a: None)


def _route(monkeypatch, *, part, duration, flag, responses=(), extract=lambda _a: b"WAV",
           mode="test_part"):
    session = {"id": str(uuid4()), "user_id": str(uuid4()), "part": part, "mode": mode,
               "status": "in_progress", "full_test_attempt_id": None, "renderer_affinity": "next",
               "resume_expires_at": "2099-01-01T00:00:00Z"}
    question = {"id": str(uuid4()), "session_id": session["id"], "question_text": "Synthetic prompt"}
    existing = [dict(r, session_id=session["id"]) for r in responses]
    db = _DB(sessions=[session], questions=[question], responses=existing)
    db.storage = MagicMock()
    monkeypatch.setattr(grading, "supabase_admin", db)
    monkeypatch.setattr(grading, "get_supabase_user", AsyncMock(return_value={"id": session["user_id"]}))

    async def execute(builder):
        return builder(db).execute()
    monkeypatch.setattr(grading, "aexecute", execute)
    flags = []

    def is_enabled(key, default=True, *, on_error=None):
        flags.append((key, default, on_error))
        return flag
    monkeypatch.setattr(grading.runtime_flags, "is_enabled", is_enabled)
    monkeypatch.setattr(grading, "enforce_grading_rate_limit", lambda *args: None)
    monkeypatch.setattr(grading, "record_grading_attempt", lambda *args: None)
    monkeypatch.setattr(grading.ai_usage_logger, "log_whisper_async", AsyncMock())
    monkeypatch.setattr(grading, "_record_progress_mark", lambda *args: None)
    words = " ".join(["I usually spend my weekends reading books in the library near my house"] * 6)
    monkeypatch.setattr(grading, "transcribe_from_bytes", AsyncMock(return_value={
        "transcript": words, "duration_seconds": duration, "confidence": 0.9, "segments": [],
    }))
    monkeypatch.setattr(grading.claude_grader, "grade_response", AsyncMock(return_value={
        "band_fc": 6.0, "band_lr": 7.0, "band_gra": 6.0, "band_p": 9.0, "overall_band": 7.0,
        "fc_feedback": "", "lr_feedback": "", "gra_feedback": "", "p_feedback": "text-only guess",
        "grammar_issues": [], "vocabulary_issues": [], "strengths": [], "improvements": [],
    }))
    monkeypatch.setattr(grading, "get_judge", lambda: SimpleNamespace(judge=AsyncMock(return_value=None)))
    monkeypatch.setattr(grading, "get_grammar_check_service",
                        lambda: SimpleNamespace(check=AsyncMock(return_value=None)))
    calls, cuts = [], []

    def fake_extract(audio, start, end):
        cuts.append((start, end))
        return extract(audio)
    monkeypatch.setattr(grading, "extract_audio_segment", fake_extract)
    monkeypatch.setattr(grading.azure_pronunciation, "assess_pronunciation", _fake_assess(calls))
    saved = []
    response_id = str(uuid4())

    def fake_save(_db, row, **_kwargs):
        saved.append(dict(row))
        return response_id
    monkeypatch.setattr(grading, "save_response", fake_save)
    result = asyncio.run(grading.grade_response_endpoint(
        session["id"], question["id"], UploadFile(BytesIO(b"fake audio"), filename="a.wav")))
    return SimpleNamespace(result=result, row=saved[0], calls=calls, cuts=cuts, flags=flags,
                           question_id=question["id"])


SAMPLE_COLS = ("pronunciation_sample_scope", "pronunciation_sample_start_s", "pronunciation_sample_end_s")


def _cols(row):
    return tuple(row.get(c) for c in SAMPLE_COLS)


def test_route_flag_is_read_fail_closed(monkeypatch):
    r = _route(monkeypatch, part=2, duration=120.0, flag=False)
    assert ("pron_sample_window", False, False) in r.flags


def test_route_flag_off_is_unchanged(monkeypatch):
    r = _route(monkeypatch, part=2, duration=120.0, flag=False)
    assert r.cuts == [(10.0, 45.0)]                      # today's _part2_segment window
    assert not any(c in r.row for c in SAMPLE_COLS)       # 502 columns never written
    assert "sample" not in r.result["pronunciation"]
    assert r.result["pronunciation"]["status"] == "completed"


def test_route_part2_long_answer_is_cut_45_75(monkeypatch):
    r = _route(monkeypatch, part=2, duration=120.0, flag=True)
    assert r.cuts == [(45.0, 75.0)]
    assert r.calls[0]["bytes"] == b"WAV" and r.calls[0]["ct"] == "audio/wav"
    assert _cols(r.row) == ("segment", 45.0, 75.0)
    assert r.row["pronunciation_status"] == "completed" and r.row["final_band_p"] is not None
    assert r.result["pronunciation"]["sample"] == {"scope": "segment", "start_s": 45.0, "end_s": 75.0}


def test_route_part3_answer_is_cut_too(monkeypatch):
    r = _route(monkeypatch, part=3, duration=50.0, flag=True)
    assert r.cuts == [(10.0, 40.0)]
    assert _cols(r.row) == ("segment", 10.0, 40.0)


def test_route_part1_short_answer_is_sent_whole(monkeypatch):
    r = _route(monkeypatch, part=1, duration=20.0, flag=True)
    assert r.cuts == [] and len(r.calls) == 1 and r.calls[0]["bytes"] == b"fake audio"
    assert _cols(r.row) == ("full", None, None)
    assert r.result["pronunciation"]["sample"]["scope"] == "full"


def test_route_part1_second_answer_is_not_sampled(monkeypatch):
    done = [{"id": str(uuid4()), "question_id": str(uuid4()), "pronunciation_status": "completed",
             "grading_status": "completed", "final_band_p": 7.0}]
    r = _route(monkeypatch, part=1, duration=20.0, flag=True, responses=done)
    assert r.calls == []                                    # Azure (fake) never called
    assert _cols(r.row) == ("not_sampled", None, None)
    # Không lấy mẫu ⇒ không có P của Azure. `final_*` được ghi None (không
    # bỏ trống) để bản ghi âm lại không mang điểm của lần trước (săn lỗi B2-01).
    # Dữ liệu phát âm cũ cũng bị xoá (None), không còn "completed" (CR #2696).
    assert r.row["pronunciation_status"] is None and r.row["pronunciation_score"] is None
    assert r.row["final_band_p"] is None and r.row["final_overall_band"] is None
    assert r.result["band_p"] is None
    assert r.result["p_feedback"] == grading._PRON_NOT_SAMPLED_FEEDBACK
    assert r.result["overall_band"] == grading._round_band((6.0 + 7.0 + 6.0) / 3)
    assert r.result["pronunciation"] == {
        "status": "not_sampled", "provider": "azure",
        "sample": {"scope": "not_sampled", "start_s": None, "end_s": None}}


def test_route_failed_grade_with_azure_does_not_use_up_the_sample(monkeypatch):
    # Codex P2 regression: first answer's grader failed (P band cleared) →
    # the next answer is still sent to Azure and gets a P band.
    failed = [{"id": str(uuid4()), "question_id": str(uuid4()), "pronunciation_status": "completed",
               "grading_status": "failed", "final_band_p": None}]
    r = _route(monkeypatch, part=1, duration=20.0, flag=True, responses=failed)
    assert len(r.calls) == 1 and _cols(r.row) == ("full", None, None)
    assert r.row["final_band_p"] is not None and r.result["band_p"] is not None


def test_route_part1_first_answer_below_min_is_not_sampled(monkeypatch):
    # The spec's 8 s case cannot reach this point: validate_audio_duration
    # rejects Part 1 under 15 s with 422 before grading. Raise the minimum
    # instead so the route branch itself is exercised (unit case above: 8 s).
    monkeypatch.setattr(grading.settings, "PRON_ONE_PER_SESSION_MIN_SECONDS", 25)
    r = _route(monkeypatch, part=1, duration=20.0, flag=True)
    assert r.calls == [] and _cols(r.row) == ("not_sampled", None, None)


def test_route_part3_is_not_one_per_session_by_default(monkeypatch):
    done = [{"id": str(uuid4()), "question_id": str(uuid4()), "pronunciation_status": "completed",
             "grading_status": "completed", "final_band_p": 7.0}]
    r = _route(monkeypatch, part=3, duration=30.0, flag=True, responses=done)
    assert len(r.calls) == 1 and _cols(r.row) == ("full", None, None)


def test_route_cut_failure_sends_whole_recording(monkeypatch):
    def boom(_a):
        raise RuntimeError("ffmpeg boom")
    r = _route(monkeypatch, part=2, duration=120.0, flag=True, extract=boom)
    assert r.calls[0]["bytes"] == b"fake audio"
    assert _cols(r.row) == ("full", None, None)


def test_route_sample_columns_stay_outside_core_fallback(monkeypatch):
    # The core-row fallback must drop them when the schema lacks 502.
    import inspect
    src = inspect.getsource(grading.grade_response_endpoint)
    core = src[src.index("_CORE_COLUMNS = {"):src.index("}", src.index("_CORE_COLUMNS = {"))]
    assert not any(c in core for c in SAMPLE_COLS)
