"""routers/admin_instructors.py — W-8-core admin oversight metrics.

Admin-only aggregate: per-instructor #students / #graded / #regraded / token+cost.
Admin is the super-tenant here — this is a DIRECT aggregate (no per-instructor
scoping needed). The per-instructor DRILL-DOWN is NOT a new endpoint: the admin
re-uses /instructor/* with ?as_instructor=X (the single audited impersonation
override in routers.instructor._me).

Owner-derivation REUSES services.instructor_access.instructor_owned_essay_ids so
the metrics can never drift from what the accessor actually scopes (2-branch:
assignment.assigned_by=X ∪ student.instructor_id=X).

⚠ token/cost come from writing_feedback (tokens_input/tokens_output/cost_usd) —
writing grading does NOT write ai_usage_logs (§0b⑤), so that source would be empty.
"""

from __future__ import annotations

from fastapi import APIRouter, Header

from database import supabase_admin
from routers.admin import require_admin
from services.instructor_access import instructor_owned_essay_ids

router = APIRouter(prefix="/admin/instructors", tags=["admin"])


@router.get("")
async def list_instructor_metrics(authorization: str | None = Header(None)):
    """Per-instructor oversight metrics. Admin-only (direct aggregate)."""
    await require_admin(authorization)

    instructors = (
        supabase_admin.table("users")
        .select("id, email, display_name")
        .eq("role", "instructor")
        .execute()
    ).data or []

    out = []
    for ins in instructors:
        x = ins["id"]

        # #students — direct column-owner count.
        srows = (supabase_admin.table("students").select("id")
                 .eq("instructor_id", x).execute()).data or []

        # Fix-3 (D-C) — #prompts authored by this instructor (created_by=X,
        # the writing_prompts owner column the accessor stamps). NOT a count of
        # admin/other-authored prompts.
        prows = (supabase_admin.table("writing_prompts").select("id")
                 .eq("created_by", x).execute()).data or []

        # owned essays — SAME 2-branch derivation as the accessor (no drift).
        owned = instructor_owned_essay_ids(x)

        n_graded = n_regraded = regrade_events = 0
        tokens = 0
        cost = 0.0
        if owned:
            essays = (supabase_admin.table("writing_essays")
                      .select("id, status, regrade_count")
                      .in_("id", owned).execute()).data or []
            n_graded = sum(1 for e in essays if e.get("status") == "delivered")
            n_regraded = sum(1 for e in essays if (e.get("regrade_count") or 0) > 0)
            regrade_events = sum((e.get("regrade_count") or 0) for e in essays)

            # GV-1a SPEND-analytics exception: read the BASE table (ALL versions),
            # NOT writing_feedback_current — token/cost here is total spend across
            # every grade/regrade version, so a current-only view would undercount.
            fb = (supabase_admin.table("writing_feedback")
                  .select("tokens_input, tokens_output, cost_usd")
                  .in_("essay_id", owned).execute()).data or []
            tokens = sum((f.get("tokens_input") or 0) + (f.get("tokens_output") or 0) for f in fb)
            cost = sum(float(f.get("cost_usd") or 0) for f in fb)

        out.append({
            "instructor_id":  x,
            "email":          ins.get("email"),
            "display_name":   ins.get("display_name"),
            "students":       len(srows),
            "prompts":        len(prows),          # writing_prompts created_by X (D-C)
            "graded":         n_graded,            # delivered, owned by X
            # HEADLINE: essays ON X's roster that were regraded (by anyone) — NOT
            # "X regraded N" (per-regrade attribution needs a regrade audit → defer).
            "regraded":       n_regraded,
            "regrade_events": regrade_events,      # volume (sum of regrade_count)
            "tokens":         tokens,              # writing_feedback (NOT ai_usage_logs)
            "cost_usd":       round(cost, 4),
        })
    return out
