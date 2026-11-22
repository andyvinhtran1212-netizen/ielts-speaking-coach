"""Quick search for the admin and teacher frames (ADMINIA-0074 FR-075,
FR-102; plan 5.4 "Tìm nhanh"; G09-T05). Read only.

Groups, at most three rows each, every row ``{title, meta, href}``:

* ``learners``: the T03 directory people (``services.admin_learner_directory``),
  matched the way the directory search matches (name, e-mail, learner code,
  without Vietnamese accents). Activation-code ownership is not searched here,
  for admins or teachers: that lookup stays on ``GET /admin/learners?q=``.
* ``classes``: ``cohorts`` by name or code prefix.
* ``submissions``: ``writing_essays`` of the matched learners, newest first.
* ``content`` (admin only): Writing prompts, Speaking topics, Reading
  passages and Listening tests by title.
* ``orders`` (admin only): G04 enrollment orders. G04 has no read API yet, so
  the group is always empty and named in ``unavailable``.

Matching is a substring test in Python over folded text, never a SQL
``LIKE``/``ilike`` pattern, so ``%``, ``_`` and PostgREST's ``*`` in ``q`` are
plain characters and can never act as wildcards.

A teacher (``cohort_ids`` set) sees only: learners who are active members of
one of their classes, their classes, and Writing work given to one of their
classes (``writing_assignments.cohort_id``). Practice essays belong to no
class, so a teacher does not see them (the same rule as the T03 summary).

A group whose read fails is empty and named in ``sources_failed``, so the
palette can say "could not search here" instead of "no result". Everything
here is synchronous; the routes call it through ``asyncio.to_thread``.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Optional
from urllib.parse import quote

from database import supabase_admin
from services import admin_learner_directory as directory
from services.class_membership_service import active_memberships_for_cohorts

logger = logging.getLogger(__name__)

GROUP_LIMIT = 3
MIN_QUERY = 2
MAX_QUERY = 128
_ID_CHUNK = 200

_TASK_LABEL = {"task1_academic": "Task 1 Academic", "task1_general": "Task 1 General", "task2": "Task 2"}
_ESSAY_STATE = {"pending": "Chờ chấm", "grading": "Đang chấm", "graded": "Chờ duyệt",
                "reviewed": "Đã duyệt", "delivered": "Đã trả", "failed": "Chấm lỗi"}


def _row(title: Any, meta: Any, href: str) -> dict[str, Any]:
    return {"title": str(title or "").strip() or "—", "meta": str(meta or "").strip() or None, "href": href}


def _q(value: Any) -> str:
    return quote(str(value), safe="")


def _join(*parts: Any) -> str:
    return " · ".join(str(p).strip() for p in parts if p is not None and str(p).strip())


def _scope_student_ids(cohort_ids: frozenset[str]) -> set[str]:
    rows = active_memberships_for_cohorts(supabase_admin, sorted(cohort_ids)) if cohort_ids else []
    return {str(r["student_id"]) for r in rows if r.get("student_id")}


# ── Groups ─────────────────────────────────────────────────────────────────

def learners(needle: str, *, cohort_ids: Optional[frozenset[str]], hide_test: bool,
             scope_students: Optional[set[str]]) -> tuple[list[dict], list[directory.Person]]:
    """The first three matches for the palette, and every match (submissions
    look up the matched learners' work)."""
    people = [p for p in directory.load_people(hide_test=hide_test) if directory._matches(p, needle, set())]
    if cohort_ids is not None:
        people = [p for p in people if p.student_id and p.student_id in (scope_students or set())]
    people.sort(key=directory.sort_key)
    shown = people[:GROUP_LIMIT]
    cohorts = directory.cohorts_of(shown) if shown else {}
    rows = []
    for p in shown:
        classes = [c for c in cohorts.get(p.student_id or "", [])
                   if cohort_ids is None or c["id"] in cohort_ids]
        code = (p.student or {}).get("student_code")
        meta = _join(code, ", ".join(c["name"] or "" for c in classes) or None)
        if p.student and p.student.get("archived_at"):
            meta = _join(meta, "Đã lưu trữ")
        # The teacher dashboard has no learner deep link yet: it opens on
        # its roster.
        href = f"/admin/learners/{_q(p.ref)}" if cohort_ids is None else "/instructor"
        rows.append(_row(p.name, meta, href))
    return rows, people


def classes(needle: str, *, cohort_ids: Optional[frozenset[str]]) -> list[dict]:
    if cohort_ids is not None and not cohort_ids:
        return []
    found: list[dict] = []
    ids = sorted(cohort_ids) if cohort_ids is not None else [None]
    for offset in range(0, len(ids), _ID_CHUNK):
        chunk = ids[offset:offset + _ID_CHUNK]

        def build(c=chunk):
            query = supabase_admin.table("cohorts").select("id, name, code_prefix, is_active").order("id")
            return query if c == [None] else query.in_("id", c)

        found += [r for r in directory._paged(build)
                  if needle in directory.fold(r.get("name")) or needle in directory.fold(r.get("code_prefix"))]
    # Open classes first, then by name.
    found.sort(key=lambda r: (r.get("is_active") is False, directory.fold(r.get("name")), str(r["id"])))
    return [_row(r.get("name"), _join(r.get("code_prefix"), None if r.get("is_active", True) else "Đã lưu trữ"),
                 f"/admin/classes/{_q(r['id'])}" if cohort_ids is None else "/instructor")
            for r in found[:GROUP_LIMIT]]


def submissions(people: list[directory.Person], *, cohort_ids: Optional[frozenset[str]]) -> list[dict]:
    # Every matched learner: the three newest essays may belong to anyone in
    # the match, not only to the first names in alphabetical order.
    by_student = {p.student_id: p for p in people if p.student_id}
    if not by_student:
        return []
    ids = list(by_student)
    essay_ids: Optional[set[str]] = None
    if cohort_ids is not None:
        # A teacher: only Writing work given to one of their classes.
        if not cohort_ids:
            return []
        essay_ids = set()
        for offset in range(0, len(ids), _ID_CHUNK):
            given = (supabase_admin.table("writing_assignments").select("essay_id, cohort_id")
                     .in_("student_id", ids[offset:offset + _ID_CHUNK])
                     .in_("cohort_id", sorted(cohort_ids)).not_.is_("essay_id", "null").execute().data or [])
            essay_ids |= {str(r["essay_id"]) for r in given if r.get("essay_id")}
        if not essay_ids:
            return []
    # Chunked by learner (admin) or by essay (teacher, already limited to the
    # matched learners' class work), so no URL grows with the history.
    column, keys = ("student_id", ids) if essay_ids is None else ("id", sorted(essay_ids))
    essays: list[dict] = []
    for offset in range(0, len(keys), _ID_CHUNK):
        essays += (supabase_admin.table("writing_essays").select("id, student_id, task_type, status, created_at")
                   .in_(column, keys[offset:offset + _ID_CHUNK]).is_("deleted_at", "null")
                   .order("created_at", desc=True).limit(GROUP_LIMIT).execute().data or [])
    essays.sort(key=lambda e: (str(e.get("created_at") or ""), str(e.get("id"))), reverse=True)
    rows = []
    for e in essays[:GROUP_LIMIT]:
        person = by_student.get(str(e.get("student_id")))
        title = _join("Writing", _TASK_LABEL.get(e.get("task_type") or ""), person.name if person else None)
        meta = _join(_ESSAY_STATE.get(e.get("status") or "", e.get("status")), str(e.get("created_at") or "")[:10] or None)
        href = (f"/admin/writing/grade?essay_id={_q(e['id'])}" if cohort_ids is None
                # The teacher grading page finds the review from the queue.
                else f"/instructor/grade?essay_id={_q(e['id'])}")
        rows.append(_row(title, meta, href))
    return rows


# (table, columns, title column, label, href builder)
_CONTENT: list[tuple[str, str, str, str, Callable[[dict], str]]] = [
    ("writing_prompts", "id, title, task_type, is_active", "title", "Đề Writing",
     lambda r: f"/admin/writing/prompts?q={_q(r.get('title') or '')}"),
    ("topics", "id, title, part, is_active", "title", "Chủ đề Speaking",
     lambda r: f"/admin/speaking/topics?part={_q(r.get('part') or 1)}&topic={_q(r['id'])}"),
    ("reading_passages", "id, title, library", "title", "Bài đọc",
     lambda r: f"/admin/reading/content?library={_q(r.get('library') or '')}"),
    ("listening_tests", "id, title, test_id", "title", "Đề Listening",
     lambda r: f"/admin/listening/tests/{_q(r['id'])}"),
]


def content(needle: str) -> tuple[list[dict], list[str]]:
    """Admin only. A failed table is skipped and named; the others still
    answer."""
    rows: list[dict] = []
    failed: list[str] = []
    for table, cols, title_col, label, href in _CONTENT:
        if len(rows) >= GROUP_LIMIT:
            break
        try:
            found = [r for r in directory._paged(lambda t=table, c=cols: supabase_admin.table(t).select(c).order("id"))
                     if needle in directory.fold(r.get(title_col))]
        except Exception as exc:
            logger.warning("admin search: %s read failed (%s)", table, type(exc).__name__)
            failed.append(f"content:{table}")
            continue
        found.sort(key=lambda r: (r.get("is_active") is False, directory.fold(r.get(title_col)), str(r["id"])))
        for r in found:
            extra = _TASK_LABEL.get(r.get("task_type") or "") or (f"Part {r['part']}" if r.get("part") else None) \
                or r.get("test_id")
            rows.append(_row(r.get(title_col), _join(label, extra, None if r.get("is_active", True) else "Đã ẩn"),
                             href(r)))
    return rows[:GROUP_LIMIT], failed


# ── Entry point ────────────────────────────────────────────────────────────

def search(q: str, *, cohort_ids: Optional[frozenset[str]], hide_test: bool) -> dict[str, Any]:
    """``cohort_ids`` None: an admin. Otherwise a teacher's classes."""
    needle = directory.fold(q)
    failed: list[str] = []
    out: dict[str, Any] = {"learners": [], "classes": [], "submissions": []}

    def attempt(name: str, fn: Callable[[], Any], default: Any) -> Any:
        try:
            return fn()
        except Exception as exc:
            logger.warning("admin search: %s failed (%s)", name, type(exc).__name__)
            failed.append(name)
            return default

    scope_students: Optional[set[str]] = None
    if cohort_ids is not None:
        # The teacher's roster decides learners and their work: unreadable,
        # both groups fail rather than show nothing as "no result".
        scope_students = attempt("learners", lambda: _scope_student_ids(cohort_ids), None)
    people: list[directory.Person] = []
    if cohort_ids is None or scope_students is not None:
        out["learners"], people = attempt(
            "learners", lambda: learners(needle, cohort_ids=cohort_ids, hide_test=hide_test,
                                         scope_students=scope_students), ([], []))
    if "learners" in failed:
        failed.append("submissions")
    else:
        out["submissions"] = attempt("submissions", lambda: submissions(people, cohort_ids=cohort_ids), [])
    out["classes"] = attempt("classes", lambda: classes(needle, cohort_ids=cohort_ids), [])
    unavailable: list[str] = []
    if cohort_ids is None:
        out["content"], content_failed = attempt("content", lambda: content(needle), ([], []))
        failed += content_failed
        out["orders"] = []
        unavailable.append("orders")   # G04 has no read API yet
    out["sources_failed"] = sorted(set(failed))
    out["unavailable"] = unavailable
    return out


def counts(result: dict[str, Any]) -> dict[str, int]:
    return {k: len(v) for k, v in result.items() if isinstance(v, list) and k not in ("sources_failed", "unavailable")}

