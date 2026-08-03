"""services/cohort_progress_aggregator.py — tiến độ 4 kỹ năng của cả lớp (GĐ 4).

Giai đoạn 4 của docs/CLASS_MANAGEMENT_PLAN_2026-08-02.md.

Builds the student × skill matrix the admin class page renders: for each student
on the roster, how much Speaking / Writing / Reading / Listening they have done,
their most recent band, and when they were last active.

── Why this is batched, not per-student ────────────────────────────────────

A class of 30 asked skill-by-skill per student is 120 round-trips, and it grows
with the roster. Every skill here is ONE query over the whole class, keyed by the
ids collected up front, then folded in Python.

── Two join keys, on purpose ───────────────────────────────────────────────

Writing hangs off `students.id`; Speaking, Reading and Listening hang off
`students.user_id` — the auth account. A student with `user_id IS NULL` has never
activated, so those three are genuinely empty for them rather than zero-by-error.
The caller gets `activated: false` on that row so the page can say which it is;
rendering "0 lượt" for someone who has no account yet reads as "did nothing",
which is the same lie this programme keeps having to design around.

── Failure is reported, never rounded to zero ──────────────────────────────

Each skill is fetched independently and a failure marks that skill `degraded`.
"0 lượt Reading" is a claim about a student that a query which errored has not
earned — and unlike a slow page, a wrong zero is invisible.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Iterable, List, Optional, Set

logger = logging.getLogger(__name__)

_PAGE = 1000     # PostgREST caps an un-ranged select at this
_ID_CHUNK = 100  # bounds the generated `in.(...)` URL — see class_assignment_service

SKILLS = ("speaking", "writing", "reading", "listening")


def _chunks(items: List[str], size: int = _ID_CHUNK) -> Iterable[List[str]]:
    for i in range(0, len(items), size):
        yield items[i:i + size]


def _paged(db, table: str, columns: str, apply_filters) -> List[Dict[str, Any]]:
    """Every matching row, a page at a time, ordered by id for a stable window."""
    rows: List[Dict[str, Any]] = []
    start = 0
    while True:
        page = (
            apply_filters(db.table(table).select(columns))
            .order("id")
            .range(start, start + _PAGE - 1)
            .execute()
            .data
        ) or []
        rows.extend(page)
        if len(page) < _PAGE:
            return rows
        start += _PAGE


def _fetch_by_ids(db, table: str, columns: str, key: str, ids: List[str],
                  extra=None) -> List[Dict[str, Any]]:
    """All rows of `table` whose `key` is in `ids` — ids chunked, rows paged."""
    if not ids:
        return []
    out: List[Dict[str, Any]] = []
    for chunk in _chunks(ids):
        def apply(q, c=chunk):
            q = q.in_(key, c)
            return extra(q) if extra else q
        out.extend(_paged(db, table, columns, apply))
    return out


def _latest(rows: List[Dict[str, Any]], when: str) -> Optional[Dict[str, Any]]:
    dated = [r for r in rows if r.get(when)]
    return max(dated, key=lambda r: r[when]) if dated else None


def _fold(rows: List[Dict[str, Any]], key: str, when: str,
          band: Optional[str]) -> Dict[str, Dict[str, Any]]:
    """owner id → {attempts, last_activity, last_band}."""
    by_owner: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        owner = r.get(key)
        if owner:
            by_owner.setdefault(owner, []).append(r)

    out: Dict[str, Dict[str, Any]] = {}
    for owner, rs in by_owner.items():
        newest = _latest(rs, when)
        # The most recent band that HAS one — the newest attempt may be ungraded,
        # and showing "—" for a student who has bands is worse than showing the
        # last real one.
        with_band = [r for r in rs if band and r.get(band) is not None]
        newest_banded = _latest(with_band, when) if with_band else None
        out[owner] = {
            "attempts":      len(rs),
            "last_activity": newest.get(when) if newest else None,
            "last_band":     newest_banded.get(band) if newest_banded else None,
        }
    return out


def _writing_bands(db, essay_ids: List[str]) -> Dict[str, Optional[float]]:
    """essay_id → current overall band.

    The band lives in `writing_feedback_current` (the current-version view), not
    on the essay. Reading it here is what stops the Writing column showing "no
    band" for students who have been graded.
    """
    if not essay_ids:
        return {}
    rows = _fetch_by_ids(
        db, "writing_feedback_current", "id, essay_id, overall_band_score",
        "essay_id", essay_ids,
    )
    return {r["essay_id"]: r.get("overall_band_score") for r in rows if r.get("essay_id")}


def _empty() -> Dict[str, Any]:
    return {"attempts": 0, "last_activity": None, "last_band": None}


def cohort_progress(db, cohort_id: str) -> Dict[str, Any]:
    """Per-student progress across the four skills for one class.

    Returns {students: [...], degraded: [...]}. `degraded` names the skills whose
    query failed; those cells come back as None rather than zero so the page can
    show "không đọc được" instead of inventing a fact.
    """
    students = _paged(
        db, "students", "id, student_code, full_name, user_id",
        lambda q: q.eq("cohort_id", cohort_id),
    )
    if not students:
        return {"students": [], "degraded": []}

    student_ids = [s["id"] for s in students]
    user_ids = [s["user_id"] for s in students if s.get("user_id")]

    degraded: List[str] = []
    folded: Dict[str, Dict[str, Dict[str, Any]]] = {}

    def gather(skill: str, table: str, columns: str, key: str, ids: List[str],
               when: str, band: Optional[str], extra=None) -> None:
        try:
            rows = _fetch_by_ids(db, table, columns, key, ids, extra)
            folded[skill] = _fold(rows, key, when, band)
        except Exception as exc:
            logger.warning("[cohort-progress] %s failed: %s", skill, exc)
            degraded.append(skill)

    gather("speaking", "sessions", "id, user_id, started_at, overall_band, status",
           "user_id", user_ids, "started_at", "overall_band",
           extra=lambda q: q.eq("status", "completed"))

    # Writing keys off students.id, not the auth account — a student can have
    # essays entered by an admin before they ever activate.
    #
    # Soft-deleted essays are excluded and the band comes from
    # writing_feedback_current, matching what admin_writing_cohorts already
    # shows. Counting deleted rows, or leaving the band blank, would put two
    # admin screens at odds about the same student.
    try:
        essays = _fetch_by_ids(
            db, "writing_essays", "id, student_id, created_at, status",
            "student_id", student_ids,
            extra=lambda q: q.is_("deleted_at", "null"),
        )
        bands = _writing_bands(db, [e["id"] for e in essays])
        for e in essays:
            e["_band"] = bands.get(e["id"])
        folded["writing"] = _fold(essays, "student_id", "created_at", "_band")
    except Exception as exc:
        logger.warning("[cohort-progress] writing failed: %s", exc)
        degraded.append("writing")

    gather("reading", "reading_test_attempts",
           "id, user_id, submitted_at, band_estimate",
           "user_id", user_ids, "submitted_at", "band_estimate",
           extra=lambda q: q.eq("status", "submitted"))

    # Listening = full tests PLUS dictation. services/student_service calls that
    # pair the canonical source, so folding only the tests would make this matrix
    # disagree with the student profile for anyone who practises by dictation —
    # they would read as "—" here and active there.
    #
    # The BAND stays test-only: dictation reports accuracy, not an IELTS band.
    try:
        tests = _fetch_by_ids(
            db, "listening_test_attempts", "id, user_id, submitted_at, band_estimate",
            "user_id", user_ids, extra=lambda q: q.eq("status", "submitted"),
        )
        dictation = _fetch_by_ids(
            db, "dictation_sessions", "id, user_id, completed_at",
            "user_id", user_ids, extra=lambda q: q.not_.is_("completed_at", "null"),
        )
        listening = _fold(tests, "user_id", "submitted_at", "band_estimate")
        for owner, extra_rows in _fold(dictation, "user_id", "completed_at", None).items():
            cur = listening.setdefault(owner, _empty())
            cur["attempts"] += extra_rows["attempts"]
            cur["last_activity"] = max(
                [x for x in (cur["last_activity"], extra_rows["last_activity"]) if x],
                default=None,
            )
        folded["listening"] = listening
    except Exception as exc:
        logger.warning("[cohort-progress] listening failed: %s", exc)
        degraded.append("listening")

    out = []
    for s in students:
        uid = s.get("user_id")
        row: Dict[str, Any] = {
            "student_id":   s["id"],
            "student_code": s.get("student_code"),
            "name":         s.get("full_name") or "",
            # No account = the three user-keyed skills are genuinely empty, not
            # zero-by-error. The page says which.
            "activated":    bool(uid),
            "skills":       {},
        }
        for skill in SKILLS:
            if skill in degraded:
                row["skills"][skill] = None      # unknown, NOT zero
                continue
            owner = s["id"] if skill == "writing" else uid
            row["skills"][skill] = folded.get(skill, {}).get(owner) or _empty()
        out.append(row)

    return {"students": out, "degraded": degraded}
