"""services/instructor_workflow.py — Instructor tier review queue (Sprint 2.7d.1).

Lifecycle for an Instructor-tier essay:

  1. Student submits essay (tier=instructor).
  2. AI Standard Pass 1 grades the essay → writing_feedback row written.
  3. `create_review(essay_id)` inserts an instructor_reviews row with
     status='queued'. Idempotent — duplicate calls return the existing row.
  4. Admin claims the row (`claim`) — atomic UPDATE WHERE status='queued'
     so concurrent claim attempts only succeed once. Loser gets ConflictError.
  5. Admin edits feedback via the existing admin-writing-grade page (PATCH
     /admin/writing/essays/{id}/feedback). Edits don't transition the
     review status by themselves — the optional `mark_edited` helper lets
     the admin mark the review as 'edited' to surface "ready to deliver".
  6. Admin delivers (`deliver`) — flips review to 'delivered', mirrors the
     instructor_note onto writing_essays.instructor_note (the existing
     student-facing note column), flips writing_essays.status='delivered',
     and stamps writing_feedback.prompt_version='-instructor'.

Atomic claim contract:

  Postgres UPDATE WHERE atomic at the row level. The `.update()` call
  with `.eq("status", "queued")` is the WHERE clause; the loser sees
  zero affected rows. We assert that the response contains exactly one
  row before declaring success.

Errors raised:

  ConflictError      — claim attempt against a non-queued review
                       (e.g., another instructor got there first)
  PermissionError    — release/deliver attempt by a non-owner
                       (only the claimant can release or deliver)
  NotFoundError      — review_id doesn't exist
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Iterable, Optional
from uuid import UUID

from database import supabase_admin
from models.instructor_review import (
    InstructorQueueItem,
    InstructorReview,
    InstructorReviewStatus,
)

logger = logging.getLogger(__name__)


# ── Errors ────────────────────────────────────────────────────────────


class InstructorWorkflowError(Exception):
    """Base for instructor-workflow errors."""


class ConflictError(InstructorWorkflowError):
    """Atomic claim lost the race (or status didn't allow the transition)."""


class NotFoundError(InstructorWorkflowError):
    """Review row not found."""


# ── Helpers ───────────────────────────────────────────────────────────


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_review(row: dict) -> InstructorReview:
    """Coerce a DB row into the Pydantic model. Pydantic handles
    UUID + datetime parsing from the strings Supabase returns."""
    return InstructorReview(**row)


# ── Workflow ──────────────────────────────────────────────────────────


def create_review(essay_id: UUID) -> InstructorReview:
    """Insert a new review row with status='queued'.

    Idempotent: if a row already exists for this essay (the
    one_review_per_essay UNIQUE constraint catches it), return the
    existing row instead of raising. This matters for retries from
    `_bg_grade_essay` after a partial failure.
    """
    existing = supabase_admin.table("instructor_reviews").select("*").eq(
        "essay_id", str(essay_id),
    ).limit(1).execute()
    if existing.data:
        logger.info(
            "[instructor-review] essay=%s already has review id=%s status=%s "
            "— idempotent return",
            essay_id, existing.data[0]["id"], existing.data[0]["status"],
        )
        return _row_to_review(existing.data[0])

    inserted = supabase_admin.table("instructor_reviews").insert({
        "essay_id": str(essay_id),
        "status":   InstructorReviewStatus.QUEUED.value,
    }).execute()

    if not inserted.data:
        raise InstructorWorkflowError(
            f"Insert returned no row for essay_id={essay_id}",
        )
    logger.info(
        "[instructor-review] created review id=%s for essay=%s",
        inserted.data[0]["id"], essay_id,
    )
    return _row_to_review(inserted.data[0])


def get_instructor_queue(
    me, status_filter: Optional[Iterable[InstructorReviewStatus]] = None,
) -> list[InstructorQueueItem]:
    """W-4 — instructor-ROLE queue: reviews on essays I own (2-branch), NOT just
    reviews I've claimed. This surfaces the claimable (queued) rows for my essays
    plus the ones I've already claimed. Admin uses get_queue() (see-all) — unchanged."""
    from services.instructor_access import instructor_owned_essay_ids  # local — avoid cycle
    owned = instructor_owned_essay_ids(me)
    if not owned:
        return []
    return get_queue(status_filter=status_filter, essay_ids=owned)


def claim(review_id: UUID, instructor_id: UUID, *, owner_id=None) -> InstructorReview:
    """Atomically lock a queued review for `instructor_id`.

    The Postgres UPDATE WHERE behaviour is the lock: two concurrent
    callers see the same `status='queued'` row, both issue the UPDATE,
    only the first transaction's UPDATE matches (the second now sees
    `status='claimed'` and matches zero rows). The loser raises
    ConflictError so the queue UI can surface "already claimed".

    W-4 — when `owner_id` is set (instructor-role path), assert the review's
    essay is owned by that instructor BEFORE the lock (seam-defect #2). Raises
    PermissionError on a non-owned essay → 403. `owner_id=None` = admin path
    (admin_instructor_queue.py), unchanged.
    """
    if owner_id is not None:
        rev = supabase_admin.table("instructor_reviews").select(
            "id, essay_id",
        ).eq("id", str(review_id)).limit(1).execute()
        essay_id = (rev.data or [{}])[0].get("essay_id")
        from services.instructor_access import instructor_owned_essay_ids  # local — avoid cycle
        if not essay_id or str(essay_id) not in set(instructor_owned_essay_ids(owner_id)):
            # uniform with non-existent review → no existence leak
            raise PermissionError("review's essay not owned by this instructor")

    response = supabase_admin.table("instructor_reviews").update({
        "status":     InstructorReviewStatus.CLAIMED.value,
        "claimed_by": str(instructor_id),
        "claimed_at": _now_iso(),
    }).eq("id", str(review_id)).eq(
        "status", InstructorReviewStatus.QUEUED.value,
    ).execute()

    if not response.data:
        # Either the review doesn't exist or it's not in 'queued' state.
        # Distinguish by re-fetching so the error message is useful.
        existing = supabase_admin.table("instructor_reviews").select(
            "id, status, claimed_by",
        ).eq("id", str(review_id)).limit(1).execute()
        if not existing.data:
            raise NotFoundError(f"Review {review_id} not found")
        current_status = existing.data[0]["status"]
        raise ConflictError(
            f"Review {review_id} is in status={current_status!r}, "
            f"cannot claim. Another instructor may have claimed it first."
        )

    logger.info(
        "[instructor-review] claimed review=%s by instructor=%s",
        review_id, instructor_id,
    )
    return _row_to_review(response.data[0])


def release(review_id: UUID, instructor_id: UUID) -> InstructorReview:
    """Return a claimed review to the queue.

    Only the current claimant can release. Atomicity here is less
    important than authorisation — we filter on `claimed_by =
    instructor_id` so a different admin can't yank someone else's
    claim. The status flips back to 'queued' and claimed_by/claimed_at
    are cleared.
    """
    response = supabase_admin.table("instructor_reviews").update({
        "status":     InstructorReviewStatus.QUEUED.value,
        "claimed_by": None,
        "claimed_at": None,
    }).eq("id", str(review_id)).eq(
        "claimed_by", str(instructor_id),
    ).execute()

    if not response.data:
        # Could be: review doesn't exist, or it's claimed by someone else,
        # or it's already delivered/queued. PermissionError captures the
        # "not yours" case which is the common one.
        existing = supabase_admin.table("instructor_reviews").select(
            "id, status, claimed_by",
        ).eq("id", str(review_id)).limit(1).execute()
        if not existing.data:
            raise NotFoundError(f"Review {review_id} not found")
        raise PermissionError(
            f"Review {review_id} is not claimed by instructor {instructor_id} "
            f"(current claimed_by={existing.data[0].get('claimed_by')!r}, "
            f"status={existing.data[0]['status']!r})"
        )

    logger.info(
        "[instructor-review] released review=%s by instructor=%s",
        review_id, instructor_id,
    )
    return _row_to_review(response.data[0])


def deliver(
    review_id: UUID,
    instructor_id: UUID,
    instructor_note: Optional[str] = None,
) -> InstructorReview:
    """Mark the review delivered and surface the note to the student.

    Three-step write (best-effort sequential — Supabase Python client
    doesn't expose a transaction handle, but each step is idempotent
    and the deliver step is the gate the queue UI presents only when
    the row is in claimed/edited state):

      1. Update instructor_reviews:
           status='delivered', delivered_at=NOW(), instructor_note=note
      2. Mirror the note + flip essay status:
           writing_essays.instructor_note = note
           writing_essays.status = 'delivered'
      3. Stamp the feedback row:
           writing_feedback.prompt_version = '<existing>-instructor'
           (idempotent — only adds the suffix if not already present)

    Step 1 is filtered on `claimed_by = instructor_id` so the auth
    check is enforced inside the UPDATE — same pattern as `release`.
    """
    # Step 1: mark the review delivered (auth filter inside the WHERE).
    review_response = supabase_admin.table("instructor_reviews").update({
        "status":          InstructorReviewStatus.DELIVERED.value,
        "delivered_at":    _now_iso(),
        "instructor_note": instructor_note,
    }).eq("id", str(review_id)).eq(
        "claimed_by", str(instructor_id),
    ).execute()

    if not review_response.data:
        existing = supabase_admin.table("instructor_reviews").select(
            "id, status, claimed_by",
        ).eq("id", str(review_id)).limit(1).execute()
        if not existing.data:
            raise NotFoundError(f"Review {review_id} not found")
        raise PermissionError(
            f"Review {review_id} cannot be delivered by instructor "
            f"{instructor_id} (current claimed_by="
            f"{existing.data[0].get('claimed_by')!r}, "
            f"status={existing.data[0]['status']!r}). Only the "
            f"current claimant can deliver."
        )

    delivered = _row_to_review(review_response.data[0])

    # Step 2: mirror student-facing note + flip essay status. Note
    # mirrored only when explicitly provided — None means "no note",
    # don't clobber any existing writing_essays.instructor_note set
    # via the legacy PATCH /instructor-note path.
    essay_update: dict = {
        "status":       "delivered",
        "delivered_at": _now_iso(),
    }
    if instructor_note is not None:
        essay_update["instructor_note"] = instructor_note
    supabase_admin.table("writing_essays").update(
        essay_update,
    ).eq("id", str(delivered.essay_id)).execute()

    # Step 3: stamp the feedback row. Idempotent — fetch current
    # version, append '-instructor' if missing.
    # GV-1a: read the CURRENT version's stamp via the view (was an arbitrary
    # version with limit(1)-no-order).
    fb_resp = supabase_admin.table("writing_feedback_current").select(
        "prompt_version, version",
    ).eq("essay_id", str(delivered.essay_id)).limit(1).execute()
    if fb_resp.data:
        current = fb_resp.data[0].get("prompt_version") or ""
        cur_version = fb_resp.data[0].get("version")
        # Strip any pending suffix from Pass 1 ('-instructor-pending') so
        # the final stamp is just '<base>-instructor', not '<base>-
        # instructor-pending-instructor'.
        base = current.replace("-instructor-pending", "").replace(
            "-instructor", "",
        )
        new_stamp = f"{base}-instructor"
        if new_stamp != current:
            # GV-1a: stamp ONLY the current version row. The UPDATE is on the
            # base table (a view isn't writable); without the version filter it
            # would stamp EVERY version row once multi-version exists.
            upd = supabase_admin.table("writing_feedback").update({
                "prompt_version": new_stamp,
            }).eq("essay_id", str(delivered.essay_id))
            if cur_version is not None:
                upd = upd.eq("version", cur_version)
            upd.execute()

    logger.info(
        "[instructor-review] delivered review=%s by instructor=%s "
        "(essay=%s, note_set=%s)",
        review_id, instructor_id, delivered.essay_id,
        instructor_note is not None,
    )
    return delivered


def sync_revoke_review(essay_id: UUID) -> Optional[InstructorReview]:
    """Fix-1 (D2) — keep the review row coherent when an essay is pulled
    delivered→reviewed.

    Both revoke paths (instructor `revoke_delivery`, admin `_revoke_essay`)
    flip writing_essays delivered→reviewed but historically left the review
    row at 'delivered'. The instructor queue's default filter is
    {queued, claimed}, so a 'delivered' review is invisible — the revoked
    essay could not be re-found and re-delivered (the desync this closes).

    Fix: flip the review 'delivered' → 'claimed' (NOT 'edited' — 'claimed'
    is inside the default queue filter so it re-surfaces) and clear
    delivered_at, KEEPING claimed_by so it returns to the SAME instructor's
    active queue, ready to re-deliver.

    Conditional on status='delivered': a standard/admin essay with no review
    row — or a review not currently delivered — is a 0-row no-op, so the
    admin/mass-code path is untouched. Returns the updated review or None.
    """
    response = supabase_admin.table("instructor_reviews").update({
        "status":       InstructorReviewStatus.CLAIMED.value,
        "delivered_at": None,
    }).eq("essay_id", str(essay_id)).eq(
        "status", InstructorReviewStatus.DELIVERED.value,
    ).execute()
    if not response.data:
        return None
    logger.info(
        "[instructor-review] revoke-sync essay=%s review→claimed (re-deliverable)",
        essay_id,
    )
    return _row_to_review(response.data[0])


def get_review(review_id: UUID) -> Optional[InstructorReview]:
    """Fetch a review by id; returns None if missing."""
    response = supabase_admin.table("instructor_reviews").select("*").eq(
        "id", str(review_id),
    ).limit(1).execute()
    if not response.data:
        return None
    return _row_to_review(response.data[0])


def get_review_for_essay(essay_id: UUID) -> Optional[InstructorReview]:
    """Fetch the (single) review row for an essay; None if missing.

    The student-facing status endpoint uses this to gate feedback
    visibility for Instructor-tier essays. Standard / Deep tiers
    have no row here so callers must handle the None case (treat
    as "no instructor flow involved").
    """
    response = supabase_admin.table("instructor_reviews").select("*").eq(
        "essay_id", str(essay_id),
    ).limit(1).execute()
    if not response.data:
        return None
    return _row_to_review(response.data[0])


def get_queue(
    status_filter: Optional[Iterable[InstructorReviewStatus]] = None,
    instructor_id: Optional[UUID] = None,
    essay_id: Optional[UUID] = None,
    essay_ids: Optional[list] = None,
) -> list[InstructorQueueItem]:
    """Return queue items joined with student email + essay metadata.

    `status_filter` defaults to {queued, claimed} — the active queue.
    Passing {delivered} retrieves the recent-delivered list for the
    queue page's history tab.

    `instructor_id`, when set, filters to only reviews claimed by that
    instructor. Useful for a "my claims" view.

    `essay_id`, when set, returns at most one item — the review for
    that essay (or empty list if none exists). Sprint 2.7d.2: the
    grading page uses this to fetch the review row for the essay it's
    editing without scanning the full queue. Cheaper than a dedicated
    `by-essay` endpoint and avoids a router proliferation.

    Sort: created_at ASC so the oldest queued essays surface first
    (FIFO is the right default for a review queue).
    """
    if status_filter is None:
        status_filter = [
            InstructorReviewStatus.QUEUED,
            InstructorReviewStatus.CLAIMED,
        ]

    status_values = [s.value if hasattr(s, "value") else s for s in status_filter]

    q = supabase_admin.table("instructor_reviews").select("*").in_(
        "status", status_values,
    )
    if instructor_id is not None:
        q = q.eq("claimed_by", str(instructor_id))
    if essay_id is not None:
        q = q.eq("essay_id", str(essay_id))
    if essay_ids is not None:
        # W-4 — instructor-role queue: scope to reviews on essays I own. The
        # claimable view (status='queued', claimed_by NULL) is NOT reachable via
        # claimed_by, so essay-ownership is the scope. Empty owned-set → no rows.
        q = q.in_("essay_id", essay_ids or ["00000000-0000-0000-0000-000000000000"])
    response = q.order("created_at", desc=False).execute()

    if not response.data:
        return []

    # Hydrate essay + student fields. We do one batched lookup per table
    # rather than N round trips so the queue scales to dozens of rows.
    #
    # Sprint 2.7d.1.1 hotfix: the column on `writing_essays` is named
    # `analysis_level` (per migration 033 line 99), NOT `level`. The
    # original 2.7d.1 implementation crashed in production with
    # "column writing_essays.level does not exist" — the in-memory
    # FakeSupabase test fixture didn't enforce real schema, so the
    # 30 backend tests passed with mock data while production failed.
    # See TECH_DEBT.md anti-pattern #37.
    essay_ids = [row["essay_id"] for row in response.data]
    essays_resp = supabase_admin.table("writing_essays").select(
        "id, student_id, analysis_level, task_type, created_at",
    ).in_("id", essay_ids).is_("deleted_at", "null").execute()   # exclude soft-deleted
    essays_by_id = {e["id"]: e for e in (essays_resp.data or [])}

    student_ids = list({
        e["student_id"] for e in essays_by_id.values() if e.get("student_id")
    })
    students_resp = (
        supabase_admin.table("students").select("id, user_id").in_(
            "id", student_ids,
        ).execute() if student_ids else None
    )
    students_by_id = {s["id"]: s for s in (
        (students_resp.data if students_resp else []) or [])
    }

    user_ids = list({s["user_id"] for s in students_by_id.values() if s.get("user_id")})
    users_resp = (
        supabase_admin.table("users").select("id, email").in_(
            "id", user_ids,
        ).execute() if user_ids else None
    )
    email_by_user = {u["id"]: u.get("email") for u in (
        (users_resp.data if users_resp else []) or [])
    }

    items: list[InstructorQueueItem] = []
    for row in response.data:
        # A soft-deleted essay drops out of essays_by_id → skip its queue item
        # (don't surface a review row pointing at a deleted essay).
        if row["essay_id"] not in essays_by_id:
            continue
        review = _row_to_review(row)
        essay = essays_by_id.get(row["essay_id"], {})
        student = students_by_id.get(essay.get("student_id"), {})
        student_email = email_by_user.get(student.get("user_id"))

        items.append(InstructorQueueItem(
            review=review,
            essay_id=review.essay_id,
            student_email=student_email,
            # Sprint 2.7d.1.1 hotfix: source column is `analysis_level`
            # (see SELECT above). The Pydantic field on
            # InstructorQueueItem stays `student_level` for frontend
            # backward compat.
            student_level=essay.get("analysis_level") or 1,
            task_type=essay.get("task_type") or "task2",
            submitted_at=essay.get("created_at") or review.created_at,
            age_hours=review.age_hours,
            is_overdue=review.is_overdue,
        ))
    return items
