"""B9 (#44) — pronunciation endpoints had no integration tests. Pin the auth +
session/response ownership guards (the IDOR contract) for both routes. The Azure
assessment path is not exercised — these cover the ownership checks that run
before any provider call.

The fake query builder APPLIES every .eq(col, val) predicate AND records it, so a
regression that drops `.eq("user_id", user_id)` (or `.eq("session_id", ...)`) is
caught two ways: the canned row stops being filtered out (data-driven), and the
explicit predicate assertion fails (PR #599 review).
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi import HTTPException

from routers import pronunciation as pron


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class _Q:
    def __init__(self, rows, recorder):
        self._rows = rows
        self._filters = []
        self._rec = recorder

    def select(self, *_a, **_k): return self

    def eq(self, col, val):
        self._filters.append((col, val))
        self._rec.append((col, val))
        return self

    def limit(self, *_a, **_k): return self

    def execute(self):
        data = [r for r in self._rows if all(r.get(c) == v for c, v in self._filters)]
        return type("_R", (), {"data": data})()


class _DB:
    """Applies + records .eq predicates per table so ownership filters are
    actually exercised and assertable."""
    def __init__(self, tables):
        self._t = tables
        self.eq_calls: dict[str, list] = {}

    def table(self, name):
        self.eq_calls.setdefault(name, [])
        return _Q(self._t.get(name, []), self.eq_calls[name])


def _auth_ok(monkeypatch, uid="u1"):
    async def _user(_a):
        return {"id": uid}
    monkeypatch.setattr(pron, "get_supabase_user", _user)


# Audit 2026-07-02 — the single-response on-demand endpoint
# (assess_response_pronunciation) was removed: per-response pronunciation is now
# measured server-side during grading. Its ownership-guard tests went with it.
# Only the full-test endpoint remains.


def test_full_pron_requires_auth(monkeypatch):
    async def _deny(_a):
        raise HTTPException(401, "no token")
    monkeypatch.setattr(pron, "get_supabase_user", _deny)
    with pytest.raises(HTTPException) as ei:
        _run(pron.assess_full_test_pronunciation("s1", authorization=None))
    assert ei.value.status_code == 401


def test_part2_segment_reports_only_the_audio_sent_to_azure(monkeypatch):
    source = b"source-webm"
    converted = b"converted-wav"
    sample = pron.SelectedSample(
        response_id="r1", part=2, duration_seconds=90.0,
        selection_reason="segment", audio_start_s=10.0, audio_end_s=45.0,
    )
    monkeypatch.setattr(
        pron, "extract_audio_segment", lambda *_args: converted,
    )

    audio, content_type, seconds = pron._prepare_assessment_audio(
        source, "audio/webm; codecs=opus", sample,
    )

    assert audio is converted
    assert content_type == "audio/wav"
    assert seconds == 35.0


def test_part2_extraction_fallback_keeps_original_metadata(monkeypatch):
    source = b"source-webm"
    sample = pron.SelectedSample(
        response_id="r1", part=2, duration_seconds=90.0,
        selection_reason="segment", audio_start_s=10.0, audio_end_s=45.0,
    )
    monkeypatch.setattr(
        pron, "extract_audio_segment", lambda audio, *_args: audio,
    )

    audio, content_type, seconds = pron._prepare_assessment_audio(
        source, "audio/webm; codecs=opus", sample,
    )

    assert audio is source
    assert content_type == "audio/webm; codecs=opus"
    assert seconds == 90.0
