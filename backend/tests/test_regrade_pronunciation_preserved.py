"""backend/tests/test_regrade_pronunciation_preserved.py — audit 2026-07-02 (P1)

The grader no longer scores pronunciation (Azure does, server-side during the
original grade). An admin regrade re-scores FC/LR/GRA only — but the audio is
unchanged, so it must RE-ATTACH the persisted Azure P band instead of dropping
it. Otherwise result/history pages and _regrade_compute_session_bands lose
pronunciation after a regrade (final_band_p + feedback.band_p both wiped).
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from routers import admin   # noqa: E402


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *_a, **_k):  return self
    def eq(self, *_a, **_k):      return self
    def limit(self, *_a, **_k):   return self
    def execute(self):           return _FakeResult(self._rows)


class _FakeDB:
    def __init__(self, rows):
        self._rows = rows

    def table(self, _name):
        return _FakeQuery(self._rows)


def test_reattach_sets_band_p_from_persisted_azure_score(monkeypatch):
    monkeypatch.setattr(admin, "supabase_admin",
                        _FakeDB([{"pronunciation_score": 75.0,
                                  "pronunciation_fluency": 75.0,
                                  "feedback": '{"p_feedback": "Phát âm rõ."}'}]))
    grading = {"band_fc": 6, "band_lr": 6, "band_gra": 6, "overall_band": 6.0}
    admin._reattach_pronunciation_for_regrade(grading, "r1", mode="test")
    # 75 → band 7; carried-over feedback text preserved
    assert grading["band_p"] == 7.0
    assert grading["pronunciation_source"] == "azure"
    assert grading["p_feedback"] == "Phát âm rõ."


def test_reattach_noop_when_never_assessed(monkeypatch):
    monkeypatch.setattr(admin, "supabase_admin",
                        _FakeDB([{"pronunciation_score": None,
                                  "pronunciation_fluency": None, "feedback": None}]))
    grading = {"band_fc": 6, "band_lr": 6, "band_gra": 6, "overall_band": 6.0}
    admin._reattach_pronunciation_for_regrade(grading, "r1", mode="test")
    assert "band_p" not in grading   # honest absence → "chưa đánh giá"


def test_reattach_noop_in_practice_mode(monkeypatch):
    # Must not even query in practice mode (no P criterion). Pass a DB that would
    # raise if queried to prove the early return.
    class _Boom:
        def table(self, *_a, **_k):
            raise AssertionError("should not query in practice mode")
    monkeypatch.setattr(admin, "supabase_admin", _Boom())
    grading = {"overall_band": 6.0}
    admin._reattach_pronunciation_for_regrade(grading, "r1", mode="practice")
    assert "band_p" not in grading


def test_regrade_apply_heuristic_caps_includes_reattached_p():
    # After reattach sets band_p, the regrade cap recomputes overall INCLUDING P.
    grading = {"band_fc": 6, "band_lr": 6, "band_gra": 6, "band_p": 8, "overall_band": 6.0}
    out = admin._regrade_apply_heuristic_caps(grading, word_count=120, part=1)
    # mean(6,6,6,8) = 6.5
    assert out["overall_band"] == 6.5
