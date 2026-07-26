"""Xem trước đề bằng ĐÚNG giao diện chữa bài của học viên (Đợt 2).

An admin has to be able to check a paper before it becomes an exam — the
questions, the answer key, the explanations, and for Listening the audio. The
existing admin reading preview is a data-verification table, not what the
student sees, and there was nothing at all for Listening.

TWO PROPERTIES DECIDE WHETHER THIS IS ANY GOOD:

  1. It renders the SAME payload the student page renders. A second, admin-only
     renderer drifts from the real one, and then the preview stops answering the
     only question it exists to answer. So the student review builder is SHARED,
     not copied.
  2. It creates NOTHING. A preview that consumes an attempt slot, or appears in
     somebody's history, is a trap for the admin using it.
"""

from __future__ import annotations

import inspect
import re
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]


def _src(rel: str) -> str:
    return (BACKEND / rel).read_text(encoding="utf-8")


# ── The builder is shared, not duplicated ─────────────────────────────


def test_the_student_review_body_was_extracted_not_copied():
    """If the preview rebuilt the payload itself, the two would drift silently.
    The student endpoint must now be a one-line delegation to the shared
    builder — that is the proof there is only one renderer."""
    import routers.listening as L
    import routers.reading_student as R

    for fn, helper in ((L.get_listening_test_attempt_review, "_assemble_listening_review"),
                       (R.review_reading_test_attempt, "_assemble_reading_review")):
        src = inspect.getsource(fn)
        assert f"return {helper}(attempt, attempt_id)" in src, fn.__name__


def test_the_previews_call_that_same_builder():
    assert "_assemble_listening_review(synthetic, None)" in _src("routers/listening.py")
    assert "_assemble_reading_review(synthetic, None)" in _src("routers/admin_reading.py")


def test_the_builders_authorise_nothing_themselves():
    """The split moved the ownership/seal gates OUT of the shared code, so the
    student endpoint must still hold them — otherwise extracting the body would
    have quietly opened a sealed mock paper to its owner mid-exam."""
    import routers.listening as L
    import routers.reading_student as R

    lis = inspect.getsource(L.get_listening_test_attempt_review)
    assert "_fetch_attempt_or_404" in lis and "_mock_sealed" in lis
    rd = inspect.getsource(R.review_reading_test_attempt)
    assert "_fetch_attempt_owned" in rd and "is_sealed" in rd


# ── Nothing is created ────────────────────────────────────────────────


def _preview_src(rel: str, fn: str) -> str:
    src = _src(rel)
    body = src[src.index(f"async def {fn}("):]
    nxt = body.find("\n@")
    return body[:nxt] if nxt > 0 else body


def test_neither_preview_writes_anything():
    """A preview that consumes an attempt slot or lands in a student's history
    is a trap for the admin using it."""
    for rel, fn in (("routers/listening.py", "admin_preview_listening_test"),
                    ("routers/admin_reading.py", "admin_preview_reading_test")):
        body = _preview_src(rel, fn)
        assert ".insert(" not in body, f"{fn} inserts"
        assert ".update(" not in body, f"{fn} updates"
        assert ".delete(" not in body, f"{fn} deletes"


def test_both_previews_are_admin_only():
    for rel, fn in (("routers/listening.py", "admin_preview_listening_test"),
                    ("routers/admin_reading.py", "admin_preview_reading_test")):
        assert "require_admin(authorization)" in _preview_src(rel, fn), fn


def test_both_previews_404_a_missing_test():
    for rel, fn in (("routers/listening.py", "admin_preview_listening_test"),
                    ("routers/admin_reading.py", "admin_preview_reading_test")):
        assert "404" in _preview_src(rel, fn), fn


# ── The synthetic attempt is honest ───────────────────────────────────


def test_the_synthetic_carries_no_score():
    """Showing a score for a paper nobody sat would be a fabricated result."""
    for rel, fn in (("routers/listening.py", "admin_preview_listening_test"),
                    ("routers/admin_reading.py", "admin_preview_reading_test")):
        body = _preview_src(rel, fn)
        assert re.search(r'"score":\s*None', body), fn
        assert re.search(r'"band_estimate":\s*None', body), fn


def test_the_response_says_it_is_a_preview():
    """So the page can label itself rather than looking like a real result."""
    for rel, fn in (("routers/listening.py", "admin_preview_listening_test"),
                    ("routers/admin_reading.py", "admin_preview_reading_test")):
        assert 'out["preview"] = True' in _preview_src(rel, fn), fn


def test_reading_grades_an_empty_submission_with_the_real_grader():
    """Hand-building the per-question rows would let the preview's shape drift
    from what a real attempt produces. Running the actual grader over an empty
    submission cannot."""
    body = _preview_src("routers/admin_reading.py", "admin_preview_reading_test")
    assert "grader.collect_answer_key(" in body
    assert re.search(r"grader\.grade_attempt\(\s*\[\]", body), "must grade an EMPTY submission"


def test_listening_builds_its_key_from_the_graders_own_source():
    body = _preview_src("routers/listening.py", "admin_preview_listening_test")
    assert "grader.collect_answer_key(" in body
    assert '"user_answer": ""' in body, "nobody sat this — the answers must be blank"


# ── The two student pages accept the preview, without changing ────────


def _js(name: str) -> str:
    return (BACKEND.parent / "frontend" / "public" / "js" / name).read_text(encoding="utf-8")


def test_both_review_pages_read_the_preview_param():
    for name in ("listening-review.js", "reading-review.js"):
        assert "admin_test_id" in _js(name), name


def test_both_pages_boot_without_an_attempt():
    """An admin preview has no attempt — that IS the point. Requiring one would
    make the page show its empty state instead of the paper."""
    for name in ("listening-review.js", "reading-review.js"):
        js = _js(name)
        assert "if (!id && !preview) { showState('empty'); return; }" in js, name


def test_the_student_branch_is_untouched():
    """The preview must be an added branch, not a rewrite of the path every
    student uses to see their own marked paper."""
    lis = _js("listening-review.js")
    assert "/api/listening/tests/attempts/' + encodeURIComponent(attemptId) + '/review'" in lis
    rd = _js("reading-review.js")
    assert "/api/reading/test/attempts/' + encodeURIComponent(attemptId) + '/review'" in rd


def test_the_preview_urls_match_the_endpoints_that_exist():
    """A path typo here is invisible until an admin clicks it."""
    assert "/admin/listening/tests/' + encodeURIComponent(previewId) + '/preview'" in _js("listening-review.js")
    assert '@admin_router.get("/tests/{test_id}/preview")' in _src("routers/listening.py")

    assert "/admin/reading/content/tests/' + encodeURIComponent(previewId) + '/preview'" in _js("reading-review.js")
    rd = _src("routers/admin_reading.py")
    assert 'prefix="/admin/reading/content"' in rd
    assert '@router.get("/tests/{test_uuid}/preview")' in rd
