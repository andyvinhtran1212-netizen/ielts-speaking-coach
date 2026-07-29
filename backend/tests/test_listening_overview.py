"""GET /api/listening/overview — the counts that drive the landing tiles.

The Listening landing used to hard-code six mode cards. Four of them pointed
at surfaces with zero published rows, so a learner clicking "Nghe ý chính"
landed on an empty page. The landing now renders a card only when this
endpoint reports a non-zero count for it.

That inverts the failure mode: a WRONG count is now worse than no count. If
`overview` counted more loosely than the list endpoint filters, a tile would
promise content its own page refuses to show — the exact confusion the reorg
removes. So the headline test here is CONSISTENCY: for the same dataset,
`overview["tests"][k]` must equal `len(list_published_listening_tests(k))`.

Fake Supabase: an in-memory table store supporting the predicate shapes both
endpoints use — eq / in_ / not_.in_ / or_ / range / count="exact".
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest


# ── Fake Supabase ────────────────────────────────────────────────────────────


class _Res:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


class _Not:
    def __init__(self, q):
        self._q = q

    def in_(self, col, vals):
        self._q._preds.append(lambda r: r.get(col) not in set(vals))
        return self._q


class _Query:
    def __init__(self, rows):
        self._rows = rows
        self._preds = []
        self._exact = False
        self._range = None
        self._limit = None

    def select(self, *_a, **kw):
        self._exact = kw.get("count") == "exact"
        return self

    def eq(self, col, val):
        self._preds.append(lambda r, c=col, v=val: r.get(c) == v)
        return self

    def in_(self, col, vals):
        s = set(vals)
        self._preds.append(lambda r, c=col: r.get(c) in s)
        return self

    @property
    def not_(self):
        return _Not(self)

    def or_(self, expr):
        # Only the audio-ready shape is used: "<col>.not.is.null,<col>.not.is.null"
        cols = []
        for clause in expr.split(","):
            col, _, rest = clause.partition(".")
            assert rest == "not.is.null", f"unsupported or_ clause: {clause}"
            cols.append(col)
        self._preds.append(lambda r, cs=tuple(cols): any(r.get(c) for c in cs))
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, n):
        self._limit = n
        return self

    def range(self, lo, hi):
        self._range = (lo, hi)
        return self

    def execute(self):
        matched = [r for r in self._rows if all(p(r) for p in self._preds)]
        total = len(matched)
        page = matched
        if self._range is not None:
            lo, hi = self._range
            page = matched[lo:hi + 1]
        elif self._limit is not None:
            page = matched[:self._limit]
        return _Res([dict(r) for r in page], total if self._exact else None)


class _FakeSB:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return _Query(self.tables.get(name, []))


def _test_row(i, kind, **over):
    row = {
        "id": f"t{i}", "test_id": f"ILR-{i}", "title": f"Test {i}",
        "test_type": kind, "status": "published", "exam_only": False,
        "full_audio_storage_path": f"a/{i}.mp3",
        "assembled_audio_storage_path": None,
        "created_at": f"2026-01-{i:02d}", "metadata": {},
        "band_target": None, "themes": {}, "accent_profile": [],
        "audio_assembly_mode": None,
    }
    row.update(over)
    return row


def _dataset():
    tests = (
        [_test_row(i, "full") for i in range(1, 6)]                       # 5 full
        + [_test_row(i, "mini") for i in range(6, 9)]                     # 3 mini
        + [_test_row(i, "drill") for i in range(9, 11)]                   # 2 drill
        # Excluded by each of the four filters, one row apiece:
        + [_test_row(20, "full", status="draft")]
        + [_test_row(21, "full", exam_only=True)]
        + [_test_row(22, "full", full_audio_storage_path=None)]           # no audio
        + [_test_row(23, "full")]                                         # reserved
        # Assembled-only audio still counts (the list endpoint accepts either).
        + [_test_row(24, "mini", full_audio_storage_path=None,
                     assembled_audio_storage_path="b/24.mp3")]
    )
    content = [
        {"id": "c1", "status": "published"},
        {"id": "c2", "status": "published"},
        {"id": "c3", "status": "draft"},
    ]
    seg = [{"idx": 0, "start_sec": 0, "end_sec": 3, "transcript": "hi"}]
    exercises = [
        {"id": "e1", "content_id": "c1", "exercise_type": "dictation",
         "status": "published", "segments": seg, "payload": {}},
        {"id": "e2", "content_id": "c2", "exercise_type": "dictation",
         "status": "published", "segments": seg, "payload": {}},
        {"id": "e3", "content_id": "c1", "exercise_type": "mcq",
         "status": "draft", "segments": [], "payload": {"questions": [{"q": 1}]}},
        {"id": "e4", "content_id": "c3", "exercise_type": "gist",
         "status": "published", "segments": [], "payload": {"model_answer": "m"}},
        # Published, but never curated: `_ensure_dictation_exercise` inserts
        # exactly this shape on a user's first attempt. The page cannot run it.
        {"id": "e5", "content_id": "c2", "exercise_type": "true_false",
         "status": "published", "segments": [], "payload": {}},
    ]
    return {
        "listening_tests": tests,
        "listening_content": content,
        "listening_exercises": exercises,
        "listening_test_attempts": [],
    }


RESERVED = {"t23"}


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _patched(fn):
    from routers import listening as mod
    import services.mock_exam_service as mes
    with patch.object(mod, "supabase_admin", _FakeSB(_dataset())), \
         patch.object(mod, "_require_auth", AsyncMock(return_value={"id": "u"})), \
         patch.object(mes, "reserved_test_ids", lambda _skill: set(RESERVED)):
        return fn(mod)


# ── Tests ────────────────────────────────────────────────────────────────────


def test_overview_counts_published_audio_ready_tests():
    out = _patched(lambda m: _run(m.listening_overview(authorization="Bearer x")))
    # full: 5 valid; the draft / exam_only / no-audio / reserved rows drop out.
    # mini: 3 + the assembled-only row.
    assert out["tests"] == {"full": 5, "mini": 4, "drill": 2}


def test_overview_counts_only_published_exercises_on_published_content():
    out = _patched(lambda m: _run(m.listening_overview(authorization="Bearer x")))
    modes = out["exercise_modes"]
    assert modes["dictation"] == 2, "two published dictations on published content"
    assert modes["mcq"] == 0, "a draft exercise must not be counted"
    assert modes["gist"] == 0, "a published exercise on DRAFT content must not be counted"
    assert modes["true_false"] == 0, "published but uncurated (empty payload) is not runnable"
    # Every known mode is reported, so the client can rely on the key existing.
    assert set(modes) == {"dictation", "gist", "true_false", "mcq", "mini_test"}


@pytest.mark.parametrize("row,ready", [
    ({"exercise_type": "dictation", "segments": [{"idx": 0}], "payload": {}}, True),
    ({"exercise_type": "dictation", "segments": [], "payload": {}}, False),
    ({"exercise_type": "dictation", "segments": None, "payload": {}}, False),
    ({"exercise_type": "true_false", "segments": [], "payload": {"statements": [1]}}, True),
    ({"exercise_type": "true_false", "segments": [], "payload": {"statements": []}}, False),
    ({"exercise_type": "true_false", "segments": [], "payload": {}}, False),
    ({"exercise_type": "mcq", "segments": [], "payload": {"questions": [1]}}, True),
    ({"exercise_type": "mcq", "segments": [], "payload": {}}, False),
    # Gist renders without a rubric but 422s at SUBMIT, after the learner has
    # written their summary — readiness follows the grader, not the page.
    ({"exercise_type": "gist", "segments": [], "payload": {"model_answer": "x"}}, True),
    ({"exercise_type": "gist", "segments": [], "payload": {"model_answer": "  "}}, False),
    ({"exercise_type": "gist", "segments": [], "payload": {"prompt_text": "q"}}, False),
    ({"exercise_type": "gist", "segments": [], "payload": {}}, False),
    # A malformed payload must not crash the availability scan.
    ({"exercise_type": "mcq", "segments": [], "payload": None}, False),
    ({"exercise_type": "mcq", "segments": [], "payload": "junk"}, False),
    ({"exercise_type": "mini_test", "segments": [], "payload": {}}, False),
    ({"exercise_type": "wat", "segments": [], "payload": {}}, False),
])
def test_exercise_readiness_mirrors_what_each_mode_page_requires(row, ready):
    """Published != runnable.

    `_ensure_dictation_exercise` publishes a dictation row with no segments on
    a user's first attempt, and listening-dictation.js then refuses it. If
    availability ignored that, the browse card would offer a link straight into
    "Bài này chưa được phân câu" — the dead end this module removed.
    """
    from routers import listening as mod
    assert mod._exercise_is_ready(row) is ready


def test_overview_reports_published_content_count():
    out = _patched(lambda m: _run(m.listening_overview(authorization="Bearer x")))
    assert out["content"] == 2


@pytest.mark.parametrize("kind", ["full", "mini", "drill"])
def test_counts_consistent_with_list(kind):
    """The headline invariant: a tile's number is what its page will show.

    If these ever diverge, the landing advertises material the list page
    filters out — the regression this endpoint exists to prevent.
    """
    def both(m):
        ov = _run(m.listening_overview(authorization="Bearer x"))
        listed = _run(m.list_published_listening_tests(
            test_type=kind, limit=100, offset=0, authorization="Bearer x"))
        return ov["tests"][kind], len(listed["items"])

    count, listed = _patched(both)
    assert count == listed, f"{kind}: overview says {count}, list returns {listed}"


def test_a_no_audio_row_early_in_the_order_does_not_shorten_the_page():
    """Regression: audio-readiness must be filtered in SQL, before paging.

    It used to be a Python post-filter over the already-paged result. A
    published-but-audioless row sitting inside page 1 was fetched, then
    dropped — so a page of `limit=3` returned 2 items while /overview counted
    over the whole filtered set. The badge and the page disagreed, which is
    exactly the promise the count-driven landing makes.
    """
    from routers import listening as mod
    import services.mock_exam_service as mes

    tables = _dataset()
    # Put the audioless row FIRST so a post-filter would eat a page slot.
    tables["listening_tests"].insert(0, _test_row(30, "full", full_audio_storage_path=None))

    with patch.object(mod, "supabase_admin", _FakeSB(tables)), \
         patch.object(mod, "_require_auth", AsyncMock(return_value={"id": "u"})), \
         patch.object(mes, "reserved_test_ids", lambda _s: set(RESERVED)):
        page = _run(mod.list_published_listening_tests(
            test_type="full", limit=3, offset=0, authorization="Bearer x"))

    assert len(page["items"]) == 3, "a full page must not be shortened by a dropped row"
    assert all(i["id"] != "t30" for i in page["items"])


def test_reserved_exam_papers_are_excluded():
    """A paper held for a mock exam is invisible to the practice library, so
    it must not inflate the tile either."""
    def without_reserved(m):
        import services.mock_exam_service as mes
        with patch.object(mes, "reserved_test_ids", lambda _s: set()):
            return _run(m.listening_overview(authorization="Bearer x"))["tests"]["full"]

    assert _patched(without_reserved) == 6, "the reserved row reappears when unreserved"


def test_published_content_ids_pages_past_the_1000_row_cap():
    """PostgREST caps a bare select at 1000 rows. The helper must page, or the
    library tile silently under-counts once the corpus grows."""
    from routers import listening as mod
    rows = [{"id": f"c{i}", "status": "published"} for i in range(2500)]
    with patch.object(mod, "supabase_admin", _FakeSB({"listening_content": rows})):
        assert len(mod._published_content_ids()) == 2500
