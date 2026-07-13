"""services/mock_exam_assignment_service.py — per-student retake assignment.

A retake mock exam (exam_mode='retake', migration 154) is NOT opened to a whole
cohort; it is ASSIGNED to specific students, each with their own skill subset +
time window. The admin UI builds the rows from the source exam's
retest_summary() (who needs retest + which skills) and posts them here. Mirrors
writing_assignments' per-student model + a shared assignment_group_id per batch.

Module-level supabase_admin (like the other mock_* services) so the FakeSupabase
test double can patch it via the shared fake_db fixture.
"""
from __future__ import annotations

import logging
from datetime import datetime
from uuid import uuid4

from database import supabase_admin

logger = logging.getLogger(__name__)


class InvalidWindowError(ValueError):
    """open_until is earlier than open_from — an impossible availability window."""


# v1 retake covers Listening/Reading/Writing only (Speaking is session-based,
# added later — the skills array leaves room). Order-stable canonical list.
_RETAKE_SKILLS = ("listening", "reading", "writing")


def _clean_skills(skills) -> list:
    """Keep only known v1 retake skills, order-stable + deduped."""
    seen, out = set(), []
    for s in (skills or []):
        if s in _RETAKE_SKILLS and s not in seen:
            seen.add(s)
            out.append(s)
    return out


def _parse_ts(value):
    """ISO timestamp string → datetime (None passthrough). Tolerates a 'Z'
    suffix. Raises InvalidWindowError on an unparseable value."""
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise InvalidWindowError(f"Thời điểm không hợp lệ: {value!r}") from exc


def _validate_window(open_from, open_until) -> None:
    """Reject an inverted window (open_until < open_from) — it would lock the
    assigned student out entirely once the retake runner enforces the bounds."""
    f, u = _parse_ts(open_from), _parse_ts(open_until)
    if f is not None and u is not None and u < f:
        raise InvalidWindowError("Khung giờ không hợp lệ: 'đóng lúc' sớm hơn 'mở từ'.")


def assign(exam_id, rows, *, created_by, source_exam_id=None) -> dict:
    """Upsert one assignment per (exam_id, user) from `rows`
    [{user_id, skills, open_from, open_until}]. A user already assigned to this
    exam is UPDATED (skills/window/group refreshed) — re-running an assign is
    safe (idempotent per user). A row with no valid skill is skipped. All rows
    in one call share one assignment_group_id.

    Returns {"group_id", "assigned": [user_id...], "skipped": [user_id...]}.
    """
    # Coalesce duplicate user_ids within ONE request. retest_summary is
    # per-SITTING, so a user with >1 flagged sitting arrives more than once —
    # without merging, the second occurrence would take the insert path and hit
    # the UNIQUE(exam_id, user_id) constraint, failing the whole batch. Union
    # the skills across occurrences; keep the first non-null window bound.
    merged: dict = {}
    order: list = []
    for row in rows:
        uid = row.get("user_id")
        if not uid:
            continue
        uid = str(uid)
        if uid not in merged:
            merged[uid] = {"skills": [], "open_from": None, "open_until": None}
            order.append(uid)
        for s in _clean_skills(row.get("skills")):
            if s not in merged[uid]["skills"]:
                merged[uid]["skills"].append(s)
        if merged[uid]["open_from"] is None:
            merged[uid]["open_from"] = row.get("open_from")
        if merged[uid]["open_until"] is None:
            merged[uid]["open_until"] = row.get("open_until")

    # Validate every window up-front so a bad one fails the request cleanly
    # (400) instead of persisting a subset then raising mid-batch.
    for uid in order:
        _validate_window(merged[uid]["open_from"], merged[uid]["open_until"])

    group_id = str(uuid4())
    assigned, skipped = [], []
    existing = {
        r["user_id"]: r["id"]
        for r in (supabase_admin.table("mock_exam_assignments")
                  .select("id, user_id").eq("exam_id", str(exam_id))
                  .execute().data or [])
    }
    for uid in order:
        info = merged[uid]
        if not info["skills"]:
            skipped.append(uid)
            continue
        payload = {
            "exam_id":             str(exam_id),
            "user_id":             uid,
            "skills":              info["skills"],
            "open_from":           info["open_from"],
            "open_until":          info["open_until"],
            "assignment_group_id": group_id,
            "source_exam_id":      str(source_exam_id) if source_exam_id else None,
            "created_by":          str(created_by),
        }
        if uid in existing:
            supabase_admin.table("mock_exam_assignments").update(payload).eq(
                "id", existing[uid]).execute()
        else:
            supabase_admin.table("mock_exam_assignments").insert(payload).execute()
        assigned.append(uid)

    logger.info("[retake] assign exam=%s assigned=%d skipped=%d group=%s",
                exam_id, len(assigned), len(skipped), group_id)
    return {"group_id": group_id, "assigned": assigned, "skipped": skipped}


def list_assignments(exam_id) -> list:
    """All assignments for an exam, each enriched with student_name."""
    from services.mock_review_workflow import resolve_display_names
    rows = (supabase_admin.table("mock_exam_assignments").select("*")
            .eq("exam_id", str(exam_id)).execute().data or [])
    names = resolve_display_names(r.get("user_id") for r in rows)
    for r in rows:
        r["student_name"] = names.get(r.get("user_id"), "—")
    return rows


def remove(exam_id, user_id) -> None:
    """Un-assign one user from a retake exam."""
    supabase_admin.table("mock_exam_assignments").delete().eq(
        "exam_id", str(exam_id)).eq("user_id", str(user_id)).execute()
    logger.info("[retake] unassign exam=%s user=%s", exam_id, user_id)
