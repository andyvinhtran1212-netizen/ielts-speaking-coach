"""services/writing_assignment_status_sync.py — keep `writing_assignments.status`
in step with its submitted essay's lifecycle (W-ASSIGN-STATUS).

Before this module the only writer of `graded_at` / `delivered_at` was the admin
PATCH in `admin_writing_assignments.py`, so an assignment stayed `submitted`
forever after AI grading and after the essay was returned. The hooks below are
called from the essay lifecycle points:

  • AI grading finished (essay → graded)       → `mark_assignment_graded`
  • essay returned (essay → delivered)          → `mark_assignment_delivered`
      instructor_workflow.deliver, admin_writing._deliver_essay (single + bulk),
      essay_service.deliver_reviewed_essay (mock release)
  • delivery revoked (essay delivered→reviewed) → `revert_assignment_delivery`
      instructor_workflow.sync_revoke_review (both revoke paths call it)

Contract:
  • Best-effort — every function catches and logs; the grading / delivery /
    revoke flow that calls it never fails because of this sync.
  • Idempotent and forward-only — each UPDATE is guarded by the source status,
    so a re-run (same grading job, retried delivery) is a 0-row no-op and a
    regrade (essay back through grading → graded) never moves a `delivered`
    assignment backwards. Only an explicit revoke steps delivered → graded.
  • `pending` / `in_progress` assignments are never touched (no status guard
    admits them), and an essay without an assignment (self-practice, mock
    exam) matches 0 rows.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from database import supabase_admin

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def mark_assignment_graded(essay_id) -> None:
    """submitted → graded (+ graded_at) once AI grading has persisted."""
    try:
        supabase_admin.table("writing_assignments").update({
            "status":    "graded",
            "graded_at": _now_iso(),
        }).eq("essay_id", str(essay_id)).eq("status", "submitted").execute()
    except Exception as exc:  # noqa: BLE001 — best-effort, never break grading
        logger.warning(
            "[assignment-sync] mark graded failed essay=%s: %s", essay_id, exc,
        )


def mark_assignment_delivered(essay_id) -> None:
    """submitted|graded → delivered (+ delivered_at); back-fills graded_at when
    the assignment skipped the graded step (e.g. delivered before this sync
    existed, or the graded hook failed)."""
    try:
        now = _now_iso()
        flipped = supabase_admin.table("writing_assignments").update({
            "status":       "delivered",
            "delivered_at": now,
        }).eq("essay_id", str(essay_id)).in_(
            "status", ["submitted", "graded"],
        ).execute()
        if flipped.data:
            supabase_admin.table("writing_assignments").update({
                "graded_at": now,
            }).eq("essay_id", str(essay_id)).eq(
                "status", "delivered",
            ).is_("graded_at", "null").execute()
    except Exception as exc:  # noqa: BLE001 — best-effort, never break delivery
        logger.warning(
            "[assignment-sync] mark delivered failed essay=%s: %s", essay_id, exc,
        )


def revert_assignment_delivery(essay_id) -> None:
    """delivered → graded (delivered_at cleared) when a return is revoked.
    graded_at is kept: the essay is still graded, only no longer returned."""
    try:
        supabase_admin.table("writing_assignments").update({
            "status":       "graded",
            "delivered_at": None,
        }).eq("essay_id", str(essay_id)).eq("status", "delivered").execute()
    except Exception as exc:  # noqa: BLE001 — best-effort, never break revoke
        logger.warning(
            "[assignment-sync] revert delivery failed essay=%s: %s", essay_id, exc,
        )
