"""services/mock_review_workflow.py — 4-skill mock review queue (Phase 1).

A sitting-level clone of services/instructor_workflow.py. One review row per
sitting (mock_exam_reviews, mig 147); the atomic-claim / deliver lifecycle is
identical, kept in a SEPARATE module so the essay-level flow
(instructor_workflow.py) stays untouched.

Lifecycle for a sitting that reached `all_submitted`:

  1. `create_review(sitting_id, ai_draft)` inserts a mock_exam_reviews row with
     status='queued'. Idempotent — duplicate calls return the existing row
     (the one_review_per_sitting UNIQUE constraint backs this).
  2. Admin claims (`claim`) — atomic UPDATE WHERE status='queued' so concurrent
     claims only succeed once; the loser gets ConflictError.
  3. Admin enters the 4 final skill bands (`save_final_bands`) — the overall is
     computed by band_rounding.overall_from_criteria (the verified 4-arg mean),
     NOT taken from the AI draft. Status → 'reviewed'.
  4. Admin releases (`release_results`) — status='released', release audit
     stamped, AND the sitting is flipped to status='released' + sealed=False.
     That flip is the single moment scores become visible to the student.

final_bands is the source of truth for results; ai_draft is nháp only. Any gap
between them is a free human-vs-AI gold-set data point.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Iterable, Optional
from uuid import UUID

from database import supabase_admin
from services.band_rounding import overall_from_criteria

logger = logging.getLogger(__name__)

_SKILLS = ("listening", "reading", "writing", "speaking")


# ── Errors ────────────────────────────────────────────────────────────


class MockReviewError(Exception):
    """Base for mock-review-workflow errors."""


class ConflictError(MockReviewError):
    """Atomic claim lost the race (or status didn't allow the transition)."""


class NotFoundError(MockReviewError):
    """Review row not found."""


class ValidationError(MockReviewError):
    """Final bands incomplete / out of range."""


# ── Helpers ───────────────────────────────────────────────────────────


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _coerce_band(value) -> float:
    """A skill band must be a number in [0, 9]. Raises ValidationError otherwise."""
    try:
        b = float(value)
    except (TypeError, ValueError):
        raise ValidationError(f"band {value!r} is not a number")
    if not (0.0 <= b <= 9.0):
        raise ValidationError(f"band {b} out of range [0, 9]")
    return b


def compute_overall(final_bands: dict) -> float:
    """Overall = verified 4-arg mean of L/R/W/S, IELTS-rounded. All 4 required."""
    missing = [s for s in _SKILLS if final_bands.get(s) is None]
    if missing:
        raise ValidationError(f"final_bands missing skill(s): {', '.join(missing)}")
    return overall_from_criteria(
        _coerce_band(final_bands["listening"]),
        _coerce_band(final_bands["reading"]),
        _coerce_band(final_bands["writing"]),
        _coerce_band(final_bands["speaking"]),
    )


# ── Workflow ──────────────────────────────────────────────────────────


def create_review(sitting_id: UUID, ai_draft: Optional[dict] = None) -> dict:
    """Insert a queued review row for a sitting. Idempotent.

    If a row already exists (one_review_per_sitting), return it unchanged —
    this makes the all_submitted → create_review hook safe to retry.
    """
    existing = supabase_admin.table("mock_exam_reviews").select("*").eq(
        "sitting_id", str(sitting_id),
    ).limit(1).execute()
    if existing.data:
        logger.info(
            "[mock-review] sitting=%s already has review id=%s status=%s "
            "— idempotent return",
            sitting_id, existing.data[0]["id"], existing.data[0]["status"],
        )
        return existing.data[0]

    inserted = supabase_admin.table("mock_exam_reviews").insert({
        "sitting_id": str(sitting_id),
        "status":     "queued",
        "ai_draft":   ai_draft or {},
    }).execute()
    if not inserted.data:
        raise MockReviewError(f"Insert returned no row for sitting_id={sitting_id}")
    logger.info(
        "[mock-review] created review id=%s for sitting=%s",
        inserted.data[0]["id"], sitting_id,
    )
    return inserted.data[0]


def claim(review_id: UUID, admin_id: UUID) -> dict:
    """Atomically lock a queued review for `admin_id`.

    The Postgres UPDATE ... WHERE status='queued' is the lock: two concurrent
    callers both issue the UPDATE, only the first matches a row; the loser sees
    zero rows and raises ConflictError. Same contract as instructor_workflow.
    """
    response = supabase_admin.table("mock_exam_reviews").update({
        "status":     "claimed",
        "claimed_by": str(admin_id),
        "claimed_at": _now_iso(),
    }).eq("id", str(review_id)).eq("status", "queued").execute()

    if not response.data:
        existing = supabase_admin.table("mock_exam_reviews").select(
            "id, status, claimed_by",
        ).eq("id", str(review_id)).limit(1).execute()
        if not existing.data:
            raise NotFoundError(f"Review {review_id} not found")
        raise ConflictError(
            f"Review {review_id} is in status={existing.data[0]['status']!r}, "
            f"cannot claim. Another admin may have claimed it first."
        )
    # Mirror the claim onto the sitting so the student-facing status reflects
    # "under review" (the sitting status machine, mig 146).
    review = response.data[0]
    supabase_admin.table("mock_exam_sittings").update({
        "status": "under_review",
    }).eq("id", str(review["sitting_id"])).eq("status", "all_submitted").execute()
    logger.info("[mock-review] claimed review=%s by admin=%s", review_id, admin_id)
    return review


def release(review_id: UUID, admin_id: UUID) -> dict:
    """Return a claimed review to the queue (only the claimant may release)."""
    response = supabase_admin.table("mock_exam_reviews").update({
        "status":     "queued",
        "claimed_by": None,
        "claimed_at": None,
    }).eq("id", str(review_id)).eq("claimed_by", str(admin_id)).execute()
    if not response.data:
        existing = supabase_admin.table("mock_exam_reviews").select(
            "id, status, claimed_by",
        ).eq("id", str(review_id)).limit(1).execute()
        if not existing.data:
            raise NotFoundError(f"Review {review_id} not found")
        raise PermissionError(
            f"Review {review_id} is not claimed by admin {admin_id} "
            f"(current claimed_by={existing.data[0].get('claimed_by')!r})"
        )
    supabase_admin.table("mock_exam_sittings").update({
        "status": "all_submitted",
    }).eq("id", str(response.data[0]["sitting_id"])).eq(
        "status", "under_review",
    ).execute()
    logger.info("[mock-review] released review=%s by admin=%s", review_id, admin_id)
    return response.data[0]


def save_final_bands(
    review_id: UUID,
    admin_id: UUID,
    final_bands: dict,
    examiner_comment_vi: Optional[str] = None,
    per_skill_notes: Optional[dict] = None,
) -> dict:
    """Persist the admin's 4 skill bands + computed overall. Status → 'reviewed'.

    The overall is ALWAYS recomputed here (verified mean), never trusted from
    the client — same posture as writing overall bands. Auth: only the current
    claimant may save (filter inside the UPDATE).
    """
    overall = compute_overall(final_bands)
    stored = {s: _coerce_band(final_bands[s]) for s in _SKILLS}
    stored["overall"] = overall

    update: dict = {
        "status":      "reviewed",
        "final_bands": stored,
    }
    if examiner_comment_vi is not None:
        update["examiner_comment_vi"] = examiner_comment_vi
    if per_skill_notes is not None:
        update["per_skill_notes"] = per_skill_notes

    response = supabase_admin.table("mock_exam_reviews").update(update).eq(
        "id", str(review_id),
    ).eq("claimed_by", str(admin_id)).execute()
    if not response.data:
        existing = supabase_admin.table("mock_exam_reviews").select(
            "id, status, claimed_by",
        ).eq("id", str(review_id)).limit(1).execute()
        if not existing.data:
            raise NotFoundError(f"Review {review_id} not found")
        raise PermissionError(
            f"Review {review_id} is not claimed by admin {admin_id}; "
            f"cannot save final bands."
        )
    logger.info(
        "[mock-review] saved final bands review=%s overall=%s", review_id, overall,
    )
    return response.data[0]


def release_results(
    review_id: UUID, admin_id: UUID, channel: str = "in_app",
) -> dict:
    """Release results to the student — the single moment the seal is lifted.

    Requires the review to be in 'reviewed' (final bands entered). Flips the
    review to 'released' with a full audit stamp AND flips the sitting to
    status='released' + sealed=False. After this, the domain review/result
    endpoints (which check sitting.sealed) start returning scores.
    """
    if channel not in ("in_app", "email", "manual"):
        raise ValidationError(f"unknown release channel {channel!r}")

    response = supabase_admin.table("mock_exam_reviews").update({
        "status":          "released",
        "released_at":     _now_iso(),
        "released_by":     str(admin_id),
        "release_channel": channel,
        "delivered_at":    _now_iso(),
    }).eq("id", str(review_id)).eq("claimed_by", str(admin_id)).eq(
        "status", "reviewed",
    ).execute()

    if not response.data:
        existing = supabase_admin.table("mock_exam_reviews").select(
            "id, status, claimed_by",
        ).eq("id", str(review_id)).limit(1).execute()
        if not existing.data:
            raise NotFoundError(f"Review {review_id} not found")
        cur = existing.data[0]
        if cur.get("claimed_by") != str(admin_id):
            raise PermissionError(
                f"Review {review_id} not claimed by admin {admin_id}; cannot release."
            )
        raise ConflictError(
            f"Review {review_id} is in status={cur['status']!r}; must be 'reviewed' "
            f"(final bands entered) before release."
        )

    review = response.data[0]
    # Lift the seal on the sitting — scores become visible from here.
    supabase_admin.table("mock_exam_sittings").update({
        "status": "released",
        "sealed": False,
    }).eq("id", str(review["sitting_id"])).execute()
    logger.info(
        "[mock-review] RELEASED review=%s sitting=%s by admin=%s channel=%s",
        review_id, review["sitting_id"], admin_id, channel,
    )
    return review


def get_review(review_id: UUID) -> Optional[dict]:
    response = supabase_admin.table("mock_exam_reviews").select("*").eq(
        "id", str(review_id),
    ).limit(1).execute()
    return response.data[0] if response.data else None


def get_review_for_sitting(sitting_id: UUID) -> Optional[dict]:
    response = supabase_admin.table("mock_exam_reviews").select("*").eq(
        "sitting_id", str(sitting_id),
    ).limit(1).execute()
    return response.data[0] if response.data else None


def get_queue(status_filter: Optional[Iterable[str]] = None) -> list[dict]:
    """Active review queue (FIFO). Defaults to {queued, claimed}."""
    statuses = list(status_filter) if status_filter else ["queued", "claimed"]
    response = supabase_admin.table("mock_exam_reviews").select("*").in_(
        "status", statuses,
    ).order("created_at", desc=False).execute()
    return response.data or []
