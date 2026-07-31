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


# ── The preview must not fabricate a wrong-answer state ───────────────
#
# The synthetic attempt marks every question `correct: false` because nobody sat
# it. Rendered as a normal review that labelled every answer "Sai", derived the
# weakness summary from misses that never happened, and put "Bạn:" beside a
# blank — an admin checking a paper would read that as a broken paper
# (Codex review, PR #863).


def _css(name: str) -> str:
    return (BACKEND.parent / "frontend" / "public" / "css" / name).read_text(encoding="utf-8")


def _html(name: str) -> str:
    return (BACKEND.parent / "frontend" / "public" / "pages" / name).read_text(encoding="utf-8")


def test_both_pages_consume_the_preview_flag():
    """The backend has always SENT `preview: true`; nothing read it."""
    for name in ("listening-review.js", "reading-review.js"):
        js = _js(name)
        assert "function applyPreviewMode(d)" in js, name
        assert "if (!d || !d.preview) return;" in js, name
        assert "classList.add('is-exam-preview')" in js, name
        # …and it is actually CALLED. A defined-but-never-invoked helper is the
        # same bug with more code.
        assert "        applyPreviewMode(d);\n        render(d);" in js, \
            f"{name}: applyPreviewMode is not called before render"


def test_the_suppression_is_a_class_not_a_renderer_branch():
    """Branching the renderer is how the preview drifts from the student page.
    A class on <body> leaves the student path byte-identical."""
    for name in ("listening-review.css", "reading-review.css"):
        css = _css(name)
        assert ".is-exam-preview" in css, name
        assert "card__verdict" in css, name          # ✓ Đúng / ✗ Sai badges
        assert "display: none !important" in css, name


def test_the_score_summary_is_hidden_in_a_preview():
    """A score for a paper nobody sat is a fabricated result."""
    assert "#lr-summary" in _css("listening-review.css")
    assert "#rr-summary" in _css("reading-review.css")


def test_the_wrong_answer_styling_is_neutralised():
    """Not just the badge — the red card and the red nav square say "wrong" on
    their own."""
    for name in ("listening-review.css", "reading-review.css"):
        css = _css(name)
        seg = css[css.index(".is-exam-preview"):]
        assert seg.count("is-incorrect") >= 2, name


def test_each_page_says_out_loud_that_it_is_a_preview():
    for name in ("listening-review.js", "reading-review.js"):
        assert "XEM TRƯỚC" in _js(name), name
    assert 'id="lr-preview-banner"' in _html("listening-review.html")
    assert 'id="rr-preview-banner"' in _html("reading-review.html")


def test_the_banner_starts_hidden():
    """It must never show on a real student's review of their own paper."""
    for name, bid in (("listening-review.html", "lr-preview-banner"),
                      ("reading-review.html", "rr-preview-banner")):
        html = _html(name)
        at = html.index(f'id="{bid}"')
        tag = html[html.rindex("<", 0, at):html.index(">", at) + 1]
        assert "hidden" in tag, name


def test_the_reading_preview_accepts_the_id_the_admin_ui_shows():
    """_normalise_l3_test_row makes test_id the canonical identity across this
    admin surface, so keying only on the internal UUID 404'd from every link the
    admin list produces (Codex review, PR #863)."""
    body = _preview_src("routers/admin_reading.py", "admin_preview_reading_test")
    # Pin the LOOKUP line specifically. `.eq("test_id", …)` also appears in the
    # passages query, where test_id is reading_passages' UUID foreign key — a
    # loose substring match passes even when the lookup itself is wrong.
    assert '.eq("test_id", test_uuid).limit(1).execute()' in body, \
        "the lookup must resolve the HUMAN test_id first"
    assert '.eq("id", test_uuid).limit(1).execute()' in body, \
        "a UUID link must keep working too"
    assert 'test_uuid = test_res.data[0]["id"]' in body, \
        "everything downstream (passages) needs the UUID, not the human code"
