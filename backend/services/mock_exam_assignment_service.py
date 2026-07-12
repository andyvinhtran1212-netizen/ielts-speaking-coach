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
from uuid import uuid4

from database import supabase_admin

logger = logging.getLogger(__name__)

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


def assign(exam_id, rows, *, created_by, source_exam_id=None) -> dict:
    """Upsert one assignment per (exam_id, user) from `rows`
    [{user_id, skills, open_from, open_until}]. A user already assigned to this
    exam is UPDATED (skills/window/group refreshed) — re-running an assign is
    safe (idempotent per user). A row with no valid skill is skipped. All rows
    in one call share one assignment_group_id.

    Returns {"group_id", "assigned": [user_id...], "skipped": [user_id...]}.
    """
    group_id = str(uuid4())
    assigned, skipped = [], []
    existing = {
        r["user_id"]: r["id"]
        for r in (supabase_admin.table("mock_exam_assignments")
                  .select("id, user_id").eq("exam_id", str(exam_id))
                  .execute().data or [])
    }
    for row in rows:
        uid = row.get("user_id")
        skills = _clean_skills(row.get("skills"))
        if not uid or not skills:
            if uid:
                skipped.append(str(uid))
            continue
        payload = {
            "exam_id":             str(exam_id),
            "user_id":             str(uid),
            "skills":              skills,
            "open_from":           row.get("open_from"),
            "open_until":          row.get("open_until"),
            "assignment_group_id": group_id,
            "source_exam_id":      str(source_exam_id) if source_exam_id else None,
            "created_by":          str(created_by),
        }
        if str(uid) in existing:
            supabase_admin.table("mock_exam_assignments").update(payload).eq(
                "id", existing[str(uid)]).execute()
        else:
            supabase_admin.table("mock_exam_assignments").insert(payload).execute()
        assigned.append(str(uid))

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
