"""Canonical multi-class roster helpers.

``student_cohort_memberships`` is the source of truth. ``students.cohort_id``
is retained only as a legacy primary-class pointer during the additive rollout.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List

_PAGE = 1000
_ID_CHUNK = 100


def _paged(query_factory) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    start = 0
    while True:
        page = query_factory().order("id").range(start, start + _PAGE - 1).execute().data or []
        rows.extend(page)
        if len(page) < _PAGE:
            return rows
        start += _PAGE


def active_memberships_for_student(db, student_id: str) -> List[Dict[str, Any]]:
    return _paged(lambda: db.table("student_cohort_memberships")
                  .select("id, student_id, cohort_id, joined_at")
                  .eq("student_id", student_id).eq("is_active", True))


def active_cohort_ids_for_student(db, student: Dict[str, Any]) -> List[str]:
    try:
        rows = active_memberships_for_student(db, str(student["id"]))
    except Exception:
        if student.get("cohort_id"):
            return [str(student["cohort_id"])]
        raise
    ids = list(dict.fromkeys(str(row["cohort_id"]) for row in rows if row.get("cohort_id")))
    # Compatibility with test/dev databases (and a rolling deploy before the
    # backfill): only fall back when the normalized source has no row at all.
    # Once any active membership exists, the legacy pointer cannot broaden it.
    if not ids and student.get("cohort_id"):
        ids.append(str(student["cohort_id"]))
    return ids


def active_memberships_for_students(db, student_ids: Iterable[str]) -> List[Dict[str, Any]]:
    ids = list(dict.fromkeys(str(value) for value in student_ids if value))
    rows: List[Dict[str, Any]] = []
    for offset in range(0, len(ids), _ID_CHUNK):
        chunk = ids[offset:offset + _ID_CHUNK]
        rows.extend(_paged(lambda c=chunk: db.table("student_cohort_memberships")
                           .select("id, student_id, cohort_id, joined_at")
                           .in_("student_id", c).eq("is_active", True)))
    return rows


def active_memberships_for_cohorts(db, cohort_ids: Iterable[str]) -> List[Dict[str, Any]]:
    ids = list(dict.fromkeys(str(value) for value in cohort_ids if value))
    rows: List[Dict[str, Any]] = []
    for offset in range(0, len(ids), _ID_CHUNK):
        chunk = ids[offset:offset + _ID_CHUNK]
        rows.extend(_paged(lambda c=chunk: db.table("student_cohort_memberships")
                           .select("id, student_id, cohort_id, joined_at")
                           .in_("cohort_id", c).eq("is_active", True)))
    if not rows and ids:
        # Additive rollout compatibility. Migration 217 backfills every legacy
        # pointer, and its remove RPC updates that pointer atomically, so this
        # path disappears after migration without reviving ended memberships.
        legacy: List[Dict[str, Any]] = []
        for offset in range(0, len(ids), _ID_CHUNK):
            chunk = ids[offset:offset + _ID_CHUNK]
            for student in _paged(lambda c=chunk: db.table("students")
                                  .select("id, cohort_id").in_("cohort_id", c)):
                if student.get("id") and student.get("cohort_id"):
                    legacy.append({
                        "id": f"legacy:{student['id']}:{student['cohort_id']}",
                        "student_id": student["id"], "cohort_id": student["cohort_id"],
                        "joined_at": None,
                    })
        return legacy
    return rows


def active_student_ids_for_cohort(db, cohort_id: str) -> List[str]:
    ids = [str(row["student_id"])
           for row in active_memberships_for_cohorts(db, [cohort_id])]
    if ids:
        return ids
    legacy = (db.table("students").select("id").eq("cohort_id", cohort_id)
              .execute().data) or []
    return [str(row["id"]) for row in legacy if isinstance(row, dict) and row.get("id")]


def active_students_for_cohort(db, cohort_id: str, columns: str = "*") -> List[Dict[str, Any]]:
    ids = active_student_ids_for_cohort(db, cohort_id)
    if not ids:
        # Same rollout compatibility as active_memberships_for_cohorts, using
        # the legacy query shape directly so older clients/test doubles work.
        legacy = (db.table("students").select(columns)
                  .eq("cohort_id", cohort_id).execute().data) or []
        return legacy if isinstance(legacy, list) else []
    rows: List[Dict[str, Any]] = []
    for offset in range(0, len(ids), _ID_CHUNK):
        chunk = ids[offset:offset + _ID_CHUNK]
        rows.extend(_paged(lambda c=chunk: db.table("students").select(columns).in_("id", c)))
    return rows


def student_is_active_in_cohort(db, student_id: str, cohort_id: str,
                                legacy_cohort_id: str | None = None) -> bool:
    try:
        rows = (db.table("student_cohort_memberships").select("id")
                .eq("student_id", student_id).eq("cohort_id", cohort_id)
                .eq("is_active", True).limit(1).execute().data) or []
    except Exception:
        # Rolling deploy only: pre-migration databases have no membership table.
        return bool(legacy_cohort_id and str(legacy_cohort_id) == str(cohort_id))
    return bool(rows)


def add_student(db, *, student_id: str, cohort_id: str, added_by: str | None) -> None:
    db.rpc("fn_add_student_cohort_membership", {
        "p_student_id": student_id, "p_cohort_id": cohort_id, "p_added_by": added_by,
    }).execute()


def add_students(db, *, student_ids: List[str], cohort_id: str,
                 added_by: str | None) -> int:
    rows = db.rpc("fn_add_students_cohort_membership", {
        "p_student_ids": student_ids, "p_cohort_id": cohort_id, "p_added_by": added_by,
    }).execute().data
    if isinstance(rows, int):
        return rows
    if isinstance(rows, list) and rows:
        value = rows[0]
        if isinstance(value, dict):
            return int(next(iter(value.values()), 0))
        return int(value)
    return 0


def remove_student(db, *, student_id: str, cohort_id: str) -> bool:
    value = db.rpc("fn_remove_student_cohort_membership", {
        "p_student_id": student_id, "p_cohort_id": cohort_id,
    }).execute().data
    if isinstance(value, bool):
        return value
    if isinstance(value, list) and value:
        row = value[0]
        return bool(next(iter(row.values()))) if isinstance(row, dict) else bool(row)
    return False
