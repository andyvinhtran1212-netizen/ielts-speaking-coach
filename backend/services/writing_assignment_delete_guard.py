"""services/writing_assignment_delete_guard.py — refuse to hard-delete a
writing assignment the student has already started (A-08).

`writing_drafts.assignment_id` is ON DELETE CASCADE (mig 037) and
`writing_assignments.essay_id` is ON DELETE SET NULL (mig 036), and
`writing_assignments` has no soft-delete column, so a hard delete of a
started assignment silently destroys the student's draft. `status` alone
is not a sufficient guard: the student draft PATCH upserts the draft
before (and non-fatally) flipping pending → in_progress, so a "pending"
row can already own a draft.

An assignment is deletable only while status='pending', started_at IS
NULL, essay_id IS NULL and no writing_drafts row exists. The DELETE
itself repeats the row-level conditions so a concurrent start/submit
between the read and the delete makes the delete match nothing (→ 409)
instead of cascading. A draft inserted between the draft check and the
delete is protected by migration 324 (A-08B, ASSIGNDRAFT-0027): the FK is
ON DELETE NO ACTION, so Postgres refuses the DELETE with 23503 and this
helper maps that to the same 409. Before 324 is applied the 23503 branch
never fires.

Callers pass builder factories so each router keeps its own access path
(the instructor router MUST go through the owner-scoped accessor) and
its own patchable `supabase_admin`.
"""

from __future__ import annotations

import re
from typing import Any, Callable

from fastapi import HTTPException

ASSIGNMENT_STARTED_DETAIL = "Học viên đã bắt đầu làm bài nên không xóa được bài giao này."


def _is_foreign_key_violation(exc: Exception) -> bool:
    """Recognize a Postgres 23503 across PostgREST client exception shapes
    by SQLSTATE, not prose."""
    code = getattr(exc, "code", None)
    if code is None and exc.args and isinstance(exc.args[0], dict):
        code = exc.args[0].get("code")
    return str(code or "") == "23503" or bool(re.search(r"\b23503\b", str(exc)))


def delete_unstarted_assignment(
    assignment_id: str,
    *,
    assignments: Callable[[], Any],
    drafts: Callable[[], Any],
    not_found_detail: str,
) -> None:
    """Delete the assignment iff the student has not started it.

    Raises 404 (`not_found_detail`) when the row is absent/out of scope
    and 409 (`ASSIGNMENT_STARTED_DETAIL`) when it was started."""
    check = (
        assignments()
        .select("id,status,started_at,essay_id")
        .eq("id", assignment_id)
        .limit(1)
        .execute()
    )
    if not check.data:
        raise HTTPException(404, not_found_detail)

    row = check.data[0]
    if (
        row.get("status") != "pending"
        or row.get("started_at") is not None
        or row.get("essay_id") is not None
    ):
        raise HTTPException(409, ASSIGNMENT_STARTED_DETAIL)

    has_draft = (
        drafts()
        .select("id")
        .eq("assignment_id", assignment_id)
        .limit(1)
        .execute()
    )
    if has_draft.data:
        raise HTTPException(409, ASSIGNMENT_STARTED_DETAIL)

    try:
        deleted = (
            assignments()
            .delete()
            .eq("id", assignment_id)
            .eq("status", "pending")
            .is_("started_at", "null")
            .is_("essay_id", "null")
            .execute()
        )
    except Exception as exc:
        # A draft committed after the draft check: the NO ACTION FK (mig 324)
        # refused the delete and the draft survives.
        if _is_foreign_key_violation(exc):
            raise HTTPException(409, ASSIGNMENT_STARTED_DETAIL) from exc
        raise
    if deleted.data:
        return

    # Nothing matched: either the row changed under us (started) or it was
    # deleted concurrently. Re-read so a vanished row keeps 404 semantics.
    again = assignments().select("id").eq("id", assignment_id).limit(1).execute()
    if not again.data:
        raise HTTPException(404, not_found_detail)
    raise HTTPException(409, ASSIGNMENT_STARTED_DETAIL)
