"""The learner profile's Học tập tab (ADMINIA-0074 FR-025; plan 5.4
``GET /admin/learners/{ref}/attempts``; G09-T04c).

Every attempt of the learner across the skills, newest first, one row each:

* ``speaking`` — ``sessions`` (``user_id``) that are not part of a mock
  sitting. ``kind`` is ``full_test`` when the session belongs to a Full Test,
  otherwise ``practice``.
* ``writing`` — ``writing_essays`` of the learner's student rows that are not
  part of a mock sitting and not deleted. A band shows only once the essay is
  delivered and not flagged, as on the Tổng quan tab.
* ``reading`` / ``listening`` — ``reading_test_attempts`` /
  ``listening_test_attempts`` (``user_id``).
* ``mock`` — ``mock_exam_sittings`` (``user_id``); the Overall shows only
  once the review is released.

User-key columns, checked in the migrations: ``listening_test_attempts.user_id``
(068), ``reading_test_attempts.user_id`` (087), ``mock_exam_sittings.user_id``
(146), ``sessions.user_id``; Writing is keyed by ``writing_essays.student_id``.

``open_href`` is the admin view that opens the row, the same links the class
submissions table uses (``admin-class-submissions.tsx``): a reading or
listening review only exists once the attempt is submitted, so before that
it is ``null``.

States: ``in_progress``, ``submitted`` (handed in, result not out yet),
``done``, ``failed``, ``abandoned``; a status this module does not know is
``other``, never a guess. Each source is read on its own; a failed read names
the skill in ``sources_failed`` and the others still answer.

Two insights reuse the rules the learner already sees, so admin and learner
never disagree:

* ``writing_repeated_errors`` — ``writing_history.count_recurring`` (the rule
  the Writing grader feeds back as recurring patterns) over the current
  feedback of the learner's newest five essays: a ``mistakeType`` that
  repeats at least twice. ``null`` until the learner has five graded essays
  (the grader's own floor), or without a student profile. The learner's
  sentences are not copied.
* ``weak_grammar_groups`` — ``grammar_weak_areas.weak_areas`` (the learner's
  grammar dashboard ``weak_areas``) over the last 30 days of
  ``grammar_recommendations``. ``null`` without an account.

A failed insight read is ``null`` and named in ``sources_failed``. No AI
call; no band is recomputed here.
"""

from __future__ import annotations

import base64
import json
import logging
from datetime import datetime, timezone
from typing import Any, Callable, Optional
from urllib.parse import quote

from database import supabase_admin
from services import grammar_weak_areas, writing_history
from services.admin_learner_directory import Person
from services.listening_test_grader import score_fields

logger = logging.getLogger(__name__)

SKILLS = ("speaking", "writing", "reading", "listening", "mock")
STATES = ("in_progress", "submitted", "done", "failed", "abandoned", "other")
PAGE_SIZE = 30
_PAGE = 1000
_CHUNK = 200

_SPEAKING_STATE = {"in_progress": "in_progress", "active": "in_progress", "submitted": "submitted",
                   "completed": "done", "analysis_failed": "failed", "grading_failed": "failed",
                   "abandoned": "abandoned"}
_WRITING_STATE = {"pending": "submitted", "grading": "submitted", "graded": "submitted", "reviewed": "submitted",
                  "delivered": "done", "failed": "failed"}
_TEST_STATE = {"in_progress": "in_progress", "submitted": "done", "abandoned": "abandoned"}
_MOCK_STATE = {"registered": "in_progress", "lrw_in_progress": "in_progress", "speaking_pending": "in_progress",
               "lrw_submitted": "submitted", "all_submitted": "submitted", "under_review": "submitted",
               "reviewed": "submitted", "released": "done", "void": "abandoned"}
_TASK = {"task1_academic": "Writing Task 1 (Academic)", "task1_general": "Writing Task 1 (General)",
         "task2": "Writing Task 2"}


class BadCursor(ValueError):
    pass


def _paged(build: Callable[[], Any]) -> list[dict]:
    rows: list[dict] = []
    start = 0
    while True:
        page = build().order("id").range(start, start + _PAGE - 1).execute().data or []
        rows.extend(page)
        if len(page) < _PAGE:
            return rows
        start += _PAGE


def _chunks(ids: list[str]):
    for start in range(0, len(ids), _CHUNK):
        yield ids[start:start + _CHUNK]


def _at(value: Any) -> Optional[str]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    parsed = parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _band(value: Any) -> Optional[str]:
    try:
        return None if value is None else f"Band {float(value):.1f}"
    except (TypeError, ValueError):
        return None


def _titles(table: str, ids: set[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for chunk in _chunks(sorted(ids)):
        for r in (supabase_admin.table(table).select("id, title").in_("id", chunk).execute().data or []):
            out[str(r["id"])] = r.get("title") or ""
    return out


def _row(skill: str, kind: str, rid: Any, title: str, state: str, result: Optional[str],
         submitted: Any, started: Any, href: Optional[str]) -> dict:
    return {"skill": skill, "kind": kind, "id": str(rid), "title": title, "state": state, "result_text": result,
            "submitted_at": _at(submitted), "open_href": href,
            # Sort key: when handed in, else when started.
            "_at": _at(submitted) or _at(started) or ""}


def _speaking(person: Person) -> list[dict]:
    if not person.user:
        return []
    uid = str(person.user["id"])
    out = []
    for s in _paged(lambda: supabase_admin.table("sessions")
                    .select("id, part, topic, status, overall_band, started_at, completed_at, full_test_attempt_id")
                    .eq("user_id", uid).is_("sitting_id", "null")):
        state = _SPEAKING_STATE.get(str(s.get("status") or ""), "other")
        part, topic = s.get("part"), (s.get("topic") or "").strip()
        title = " · ".join(p for p in (f"Speaking Part {part}" if part else "Speaking", topic) if p)
        out.append(_row("speaking", "full_test" if s.get("full_test_attempt_id") else "practice", s["id"], title,
                        state, _band(s.get("overall_band")) if state == "done" else None,
                        s.get("completed_at") if state == "done" else None, s.get("started_at"),
                        f"/admin/speaking/sessions?session={quote(str(s['id']))}"))
    return out


def _writing(person: Person, student_ids: list[str]) -> list[dict]:
    out = []
    for chunk in _chunks(student_ids):
        for e in _paged(lambda c=chunk: supabase_admin.table("writing_essays")
                        .select("id, task_type, status, is_flagged, created_at, delivered_at, "
                                "writing_feedback:writing_feedback_current(overall_band_score)")
                        .in_("student_id", c).is_("deleted_at", "null").is_("sitting_id", "null")):
            state = _WRITING_STATE.get(str(e.get("status") or ""), "other")
            result = None
            if state == "done" and not e.get("is_flagged"):
                fb = e.get("writing_feedback")
                fb = fb[0] if isinstance(fb, list) and fb else fb
                result = _band(fb.get("overall_band_score")) if isinstance(fb, dict) else None
            out.append(_row("writing", "essay", e["id"], _TASK.get(str(e.get("task_type") or ""), "Writing"), state,
                            result, e.get("created_at"), e.get("created_at"),
                            f"/admin/writing/grade?essay_id={quote(str(e['id']))}"))
    return out


def _test(person: Person, skill: str) -> list[dict]:
    if not person.user:
        return []
    uid = str(person.user["id"])
    table, tests = (("reading_test_attempts", "reading_tests") if skill == "reading"
                    else ("listening_test_attempts", "listening_tests"))
    cols = "id, test_id, status, score, band_estimate, grading_details, started_at, submitted_at"
    if skill == "listening":
        cols += ", scoring_policy"
    rows = _paged(lambda: supabase_admin.table(table).select(cols).eq("user_id", uid))
    titles = _titles(tests, {str(r["test_id"]) for r in rows if r.get("test_id")})
    out = []
    for r in rows:
        state = _TEST_STATE.get(str(r.get("status") or ""), "other")
        result = None
        # A programme attempt scored report-only has no score by design.
        if state == "done" and r.get("scoring_policy") != "report_only":
            # The denominator the review page shows: every graded question on
            # Reading (a mini test is shorter than 40), ``score_fields`` on
            # Listening (self-check items are not scored).
            graded = r.get("grading_details") if isinstance(r.get("grading_details"), list) else []
            if skill == "reading":
                raw, total = r.get("score"), len(graded)
            else:
                fields = score_fields(r.get("score"), graded)
                raw, total = fields["score"], fields["max_score"]
            score = f"{raw}/{total}" if raw is not None and total else None
            result = " · ".join(p for p in (_band(r.get("band_estimate")), score) if p) or None
        href = (f"/{skill}/review?attempt_id={quote(str(r['id']))}&from=admin" if state == "done" else None)
        out.append(_row(skill, "test", r["id"], titles.get(str(r.get("test_id")), "") or skill.capitalize(), state,
                        result, r.get("submitted_at") if state == "done" else None, r.get("started_at"), href))
    return out


def _mock(person: Person) -> list[dict]:
    if not person.user:
        return []
    uid = str(person.user["id"])
    rows = _paged(lambda: supabase_admin.table("mock_exam_sittings")
                  .select("id, mock_exam_id, status, created_at").eq("user_id", uid))
    titles = _titles("mock_exams", {str(r["mock_exam_id"]) for r in rows if r.get("mock_exam_id")})
    released = [str(r["id"]) for r in rows if r.get("status") == "released"]
    overall: dict[str, tuple[Optional[str], Any]] = {}
    for chunk in _chunks(released):
        for rv in _paged(lambda c=chunk: supabase_admin.table("mock_exam_reviews")
                         .select("id, sitting_id, final_bands, released_at")
                         .in_("sitting_id", c).eq("status", "released")):
            overall[str(rv["sitting_id"])] = (_band((rv.get("final_bands") or {}).get("overall")),
                                              rv.get("released_at"))
    out = []
    for r in rows:
        state = _MOCK_STATE.get(str(r.get("status") or ""), "other")
        result, released_at = overall.get(str(r["id"]), (None, None)) if state == "done" else (None, None)
        exam = str(r.get("mock_exam_id") or "")
        out.append(_row("mock", "sitting", r["id"], titles.get(exam, "") or "Thi thử", state, result,
                        released_at, r.get("created_at"),
                        f"/admin/mock-reviews?mock_exam_id={quote(exam)}" if exam else None))
    return out


def _repeated_errors(person: Person) -> Optional[list[dict]]:
    if not person.student_id:
        return None
    sid = person.student_id
    essays = [str(e["id"]) for e in _paged(lambda: supabase_admin.table("writing_essays").select("id")
                                           .eq("student_id", sid).is_("deleted_at", "null")) if e.get("id")]
    rows: list[dict] = []
    for chunk in _chunks(essays):
        rows.extend(_paged(lambda c=chunk: supabase_admin.table("writing_feedback_current")   # GV-1a: current only
                           .select("id, essay_id, feedback_json, created_at").in_("essay_id", c)))
    rows.sort(key=lambda r: _at(r.get("created_at")) or "", reverse=True)
    rows = rows[:writing_history.HISTORY_WINDOW]
    if len(rows) < writing_history.MIN_HISTORY_ESSAYS:
        return None
    return [{"mistake_type": p["mistakeType"], "count": p["count"], "criterion": p["criterion"] or None}
            for p in writing_history.count_recurring(rows)]


def _weak_grammar(person: Person, now: datetime) -> Optional[list[dict]]:
    from datetime import timedelta

    from services.grammar_content import grammar_service

    if not person.user:
        return None
    uid = str(person.user["id"])
    since = (now - timedelta(days=grammar_weak_areas.WINDOW_DAYS)).isoformat()
    rows = _paged(lambda: supabase_admin.table("grammar_recommendations")
                  .select("id, recommended_slug, created_at").eq("user_id", uid).gte("created_at", since))
    return grammar_weak_areas.weak_areas(rows, grammar_service.get_article_by_slug)


def _encode(item: dict) -> str:
    raw = json.dumps([item["_at"], item["skill"], item["id"]], separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def _decode(cursor: str) -> tuple[str, str, str]:
    try:
        at, skill, rid = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode())
    except Exception as exc:
        raise BadCursor() from exc
    if not all(isinstance(v, str) for v in (at, skill, rid)) or skill not in SKILLS:
        raise BadCursor()
    return at, skill, rid


def _after(item: dict, cursor: tuple[str, str, str]) -> bool:
    at, skill, rid = cursor
    if item["_at"] != at:
        return item["_at"] < at
    if item["skill"] != skill:
        return item["skill"] > skill
    return item["id"] < rid


def attempts(person: Person, *, skill: Optional[str] = None, state: Optional[str] = None,
             cursor: Optional[str] = None, page_size: int = PAGE_SIZE) -> dict[str, Any]:
    after = _decode(cursor) if cursor else None
    student_ids: list[str] = []
    failed: list[str] = []
    wanted = [skill] if skill else list(SKILLS)
    if "writing" in wanted:
        try:
            ids = {person.student_id} if person.student_id else set()
            if person.user:
                uid = str(person.user["id"])
                ids |= {str(r["id"]) for r in _paged(lambda: supabase_admin.table("students").select("id")
                                                     .eq("user_id", uid)) if r.get("id")}
            student_ids = sorted(ids)
        except Exception as exc:
            logger.warning("learner attempts: student rows failed (%s)", type(exc).__name__)
            failed.append("writing")
            wanted = [s for s in wanted if s != "writing"]
    readers: dict[str, Callable[[], list[dict]]] = {
        "speaking": lambda: _speaking(person),
        "writing": lambda: _writing(person, student_ids),
        "reading": lambda: _test(person, "reading"),
        "listening": lambda: _test(person, "listening"),
        "mock": lambda: _mock(person),
    }
    items: list[dict] = []
    for name in wanted:
        try:
            items.extend(readers[name]())
        except Exception as exc:
            logger.warning("learner attempts: source %s failed (%s)", name, type(exc).__name__)
            failed.append(name)
    insights: dict[str, Optional[list[dict]]] = {}
    for name, read in (("writing_repeated_errors", lambda: _repeated_errors(person)),
                       ("weak_grammar_groups", lambda: _weak_grammar(person, datetime.now(timezone.utc)))):
        try:
            insights[name] = read()
        except Exception as exc:
            logger.warning("learner attempts: insight %s failed (%s)", name, type(exc).__name__)
            insights[name] = None
            failed.append(name)
    if state:
        items = [i for i in items if i["state"] == state]
    items.sort(key=lambda i: i["id"], reverse=True)
    items.sort(key=lambda i: i["skill"])
    items.sort(key=lambda i: i["_at"], reverse=True)
    if after:
        items = [i for i in items if _after(i, after)]
    page = items[:page_size]
    more = len(items) > page_size
    next_cursor = _encode(page[-1]) if more and page else None
    for i in page:
        i.pop("_at")
    return {"items": page, "next_cursor": next_cursor, **insights, "sources_failed": sorted(set(failed))}
