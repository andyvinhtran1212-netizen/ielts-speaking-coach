"""routers/admin_overview.py — Sprint 12.4 (DEBT-ADMIN-IA-REFACTOR 4/8).

Cross-module aggregator for the Tổng quan admin landing. Returns a
single JSON blob with everything the dashboard needs in one round trip:
student counts (total + 7d/30d active + by cohort), per-skill activity,
error log counts, access-code totals, and a 20-row recent activity feed.

Cached server-side via `Cache-Control: max-age=300` (5 min) since the
dashboard doesn't need real-time freshness — admin always has a manual
"Tải lại" button.

Schema dependencies (all confirmed against migrations 009, 033, 056,
057, 060-062 in Sprint 12.4 Discovery):
  - students (id, user_id, cohort_id NULLABLE post-12.2)
  - cohorts (id, name, is_active)
  - sessions (id, user_id, mode, status, overall_band, created_at,
    completed_at)
  - writing_essays (id, student_id, status, delivered_at, created_at)
  - listening_attempts (id, user_id, exercise_id, score, created_at,
    segment_idx)
  - user_vocabulary (id, user_id, mastery_status, is_archived,
    created_at)
  - error_logs (id, level, dismissed_at, occurred_at)
  - access_codes (id, code_type, is_active, is_revoked)

Sprint 11.5.1 first-attempt rule applied for listening avg_score
aggregation — retries should not inflate quality signals.
"""

from __future__ import annotations

import logging
from collections import Counter
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse

from database import supabase_admin
from routers.admin import require_admin

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin", "overview"])


_RECENT_ACTIVITY_LIMIT = 20
_CACHE_MAX_AGE_SECONDS = 300


# ── Helpers ───────────────────────────────────────────────────────────


def _safe_select(q):
    """Run a Supabase query and return rows, swallowing transient errors.

    Aggregator failures must NOT escalate to a 500 — a partial dashboard
    with one zero tile is better than a totally blank screen. Each
    individual metric is wrapped so one table outage degrades gracefully.
    """
    try:
        res = q.execute()
        return res.data or []
    except Exception as exc:
        logger.warning("[admin_overview] partial fetch failed: %s", exc)
        return []


def _first_attempt_only(rows: list[dict]) -> list[dict]:
    """Sprint 11.5.1 carryover — dedupe listening_attempts rows to
    canonical first attempt per (exercise_id, segment_idx). Used here
    for listening avg_score so retries don't distort the dashboard.
    """
    first_by_key: dict[tuple, dict] = {}
    for r in rows:
        key = (r.get("exercise_id"), r.get("segment_idx"))
        prev = first_by_key.get(key)
        if prev is None or (r.get("created_at") or "") < (prev.get("created_at") or ""):
            first_by_key[key] = r
    return list(first_by_key.values())


def _bucket_students_by_cohort(students: list[dict], cohort_name_by_id: dict[str, str]) -> list[dict]:
    """Group students by cohort_id. Students with NULL cohort_id bucket
    into the synthetic "Đại trà" group (matches Andy's vocabulary)."""
    counts: Counter = Counter()
    for s in students:
        cid = s.get("cohort_id")
        counts[cid] += 1
    out: list[dict] = []
    for cid, n in counts.items():
        out.append({
            "cohort_id":   cid,
            "cohort_name": cohort_name_by_id.get(cid) if cid else "Đại trà",
            "count":       n,
        })
    # Sort: Đại trà last, real cohorts alphabetical.
    out.sort(key=lambda r: (r["cohort_id"] is None, (r["cohort_name"] or "").lower()))
    return out


# ── Endpoint ──────────────────────────────────────────────────────────


@router.get("/admin/overview")
async def get_admin_overview(authorization: str | None = Header(default=None)):
    """Cross-module dashboard aggregator. Admin only. Cache-Control: 300s."""
    await require_admin(authorization)

    now = datetime.now(timezone.utc)
    iso_7d  = (now - timedelta(days=7)).isoformat()
    iso_24h = (now - timedelta(hours=24)).isoformat()
    iso_30d = (now - timedelta(days=30)).isoformat()

    # ── Students + cohorts ─────────────────────────────────────────
    students = _safe_select(
        supabase_admin.table("students").select("id, user_id, cohort_id, created_at")
    )
    cohorts = _safe_select(
        supabase_admin.table("cohorts").select("id, name").eq("is_active", True)
    )
    cohort_name_by_id = {c["id"]: c.get("name") or "" for c in cohorts}

    # Sessions provides Speaking activity AND active-user signal.
    sessions_recent = _safe_select(
        supabase_admin.table("sessions")
        .select("id, user_id, overall_band, created_at, completed_at, status")
        .gte("created_at", iso_30d)
    )
    sessions_total_row = _safe_select(supabase_admin.table("sessions").select("id"))

    # Writing essays + pending feedback signal.
    essays_recent = _safe_select(
        supabase_admin.table("writing_essays")
        .select("id, student_id, status, delivered_at, created_at")
        .gte("created_at", iso_30d)
    )
    essays_total_row = _safe_select(supabase_admin.table("writing_essays").select("id"))
    essays_pending = _safe_select(
        supabase_admin.table("writing_essays")
        .select("id")
        .is_("delivered_at", "null")
    )

    # Listening attempts (last 30d for activity + avg) + total count.
    listening_recent = _safe_select(
        supabase_admin.table("listening_attempts")
        .select("id, user_id, exercise_id, segment_idx, score, created_at")
        .gte("created_at", iso_30d)
    )
    listening_total_row = _safe_select(supabase_admin.table("listening_attempts").select("id"))
    listening_content_row = _safe_select(
        supabase_admin.table("listening_content").select("id").eq("status", "published")
    )

    # Vocab — total entries + due-for-review approximation (all
    # `mastery_status='learning'` non-archived rows; precise SRS window
    # is computed client-side per Sprint 10.2 mastery–SRS unification).
    vocab_total_row = _safe_select(supabase_admin.table("user_vocabulary").select("id"))
    vocab_learning = _safe_select(
        supabase_admin.table("user_vocabulary")
        .select("id")
        .eq("mastery_status", "learning")
        .eq("is_archived", False)
    )

    # Grammar — proxy for "articles viewed 7d": grammar_recommendations
    # written in last 7d (every practice response writes one set).
    grammar_recent = _safe_select(
        supabase_admin.table("grammar_recommendations")
        .select("id, created_at")
        .gte("created_at", iso_7d)
    )

    # Error logs — three counts.
    err_undismissed = _safe_select(
        supabase_admin.table("error_logs").select("id").is_("dismissed_at", "null")
    )
    err_24h = _safe_select(
        supabase_admin.table("error_logs").select("id").gte("occurred_at", iso_24h)
    )
    err_7d = _safe_select(
        supabase_admin.table("error_logs").select("id").gte("occurred_at", iso_7d)
    )

    # Access codes — counts by type + active total.
    ac_rows = _safe_select(
        supabase_admin.table("access_codes")
        .select("id, code_type, is_active, is_revoked")
    )
    ac_active = sum(
        1 for r in ac_rows
        if r.get("is_active") and not r.get("is_revoked")
    )
    ac_by_type: Counter = Counter()
    for r in ac_rows:
        if r.get("is_active") and not r.get("is_revoked"):
            ac_by_type[r.get("code_type") or "mass"] += 1

    # ── Compute derived metrics ────────────────────────────────────

    def _user_ids_in(rows: list[dict], since_iso: str) -> set:
        out = set()
        for r in rows:
            ts = r.get("created_at") or ""
            if ts and ts >= since_iso and r.get("user_id"):
                out.add(r["user_id"])
        return out

    active_7d = (
        _user_ids_in(sessions_recent, iso_7d)
        | _user_ids_in(listening_recent, iso_7d)
    )
    # Writing essays use student_id — resolve via the students roster.
    student_user_by_id = {s["id"]: s.get("user_id") for s in students}
    for e in essays_recent:
        ts = e.get("created_at") or ""
        if ts >= iso_7d:
            uid = student_user_by_id.get(e.get("student_id"))
            if uid:
                active_7d.add(uid)

    active_30d = (
        _user_ids_in(sessions_recent, iso_30d)
        | _user_ids_in(listening_recent, iso_30d)
    )
    for e in essays_recent:
        uid = student_user_by_id.get(e.get("student_id"))
        if uid:
            active_30d.add(uid)

    # Speaking avg band — only sessions with overall_band populated +
    # status=completed (defensive — pending sessions can carry NULL).
    speaking_bands = [
        s["overall_band"] for s in sessions_recent
        if s.get("overall_band") is not None and s.get("status") == "completed"
        and (s.get("created_at") or "") >= iso_7d
    ]
    speaking_avg_band = (
        round(sum(speaking_bands) / len(speaking_bands), 1)
        if speaking_bands else None
    )

    sessions_7d = sum(
        1 for s in sessions_recent
        if (s.get("created_at") or "") >= iso_7d
    )
    essays_7d = sum(
        1 for e in essays_recent
        if (e.get("created_at") or "") >= iso_7d
    )

    # Listening avg_score — first-attempt only (Sprint 11.5.1 rule).
    listening_first = _first_attempt_only([
        r for r in listening_recent
        if (r.get("created_at") or "") >= iso_7d
    ])
    listening_scores = [r["score"] for r in listening_first if r.get("score") is not None]
    listening_avg = (
        round(sum(listening_scores) / len(listening_scores), 2)
        if listening_scores else None
    )
    listening_7d = sum(
        1 for r in listening_recent
        if (r.get("created_at") or "") >= iso_7d
    )

    # ── Recent activity feed ───────────────────────────────────────
    # Normalize across surfaces, sort by timestamp DESC, cap at 20.

    activity: list[dict] = []
    for s in sessions_recent:
        if not s.get("completed_at"):
            continue
        activity.append({
            "timestamp":  s["completed_at"],
            "user_id":    s.get("user_id"),
            "skill":      "speaking",
            "action":     "Hoàn thành buổi Speaking",
            "score":      s.get("overall_band"),
            "link":       f"/pages/result.html?session_id={s['id']}",
        })
    for r in listening_recent:
        activity.append({
            "timestamp":  r.get("created_at"),
            "user_id":    r.get("user_id"),
            "skill":      "listening",
            "action":     "Hoàn thành bài Listening",
            "score":      r.get("score"),
            "link":       None,  # listening attempt detail not addressable yet
        })
    for e in essays_recent:
        if not e.get("created_at"):
            continue
        uid = student_user_by_id.get(e.get("student_id"))
        activity.append({
            "timestamp":  e["created_at"],
            "user_id":    uid,
            "skill":      "writing",
            "action":     f"Nộp bài Writing ({e.get('status') or 'pending'})",
            "score":      None,
            "link":       f"/pages/admin/writing/grade.html?essay_id={e['id']}",
        })

    activity = [a for a in activity if a.get("timestamp")]
    activity.sort(key=lambda a: a["timestamp"] or "", reverse=True)
    activity = activity[:_RECENT_ACTIVITY_LIMIT]

    # Email enrichment — single batch lookup over all involved user_ids.
    uids_in_activity = list({a["user_id"] for a in activity if a.get("user_id")})
    email_by_uid: dict[str, str] = {}
    if uids_in_activity:
        urows = _safe_select(
            supabase_admin.table("users")
            .select("id, email")
            .in_("id", uids_in_activity)
        )
        for u in urows:
            email_by_uid[u["id"]] = u.get("email") or ""
    for a in activity:
        a["user_email"] = email_by_uid.get(a.get("user_id"), "")

    # ── Assemble + cache ───────────────────────────────────────────

    body = {
        "students": {
            "total":      len(students),
            "active_7d":  len(active_7d),
            "active_30d": len(active_30d),
            "by_cohort":  _bucket_students_by_cohort(students, cohort_name_by_id),
        },
        "skills": {
            "speaking": {
                "sessions_total": len(sessions_total_row),
                "sessions_7d":    sessions_7d,
                "avg_band_7d":    speaking_avg_band,
            },
            "writing": {
                "essays_total":     len(essays_total_row),
                "essays_7d":        essays_7d,
                "feedback_pending": len(essays_pending),
            },
            "listening": {
                "attempts_total": len(listening_total_row),
                "attempts_7d":    listening_7d,
                "content_count":  len(listening_content_row),
                "avg_score_7d":   listening_avg,
            },
            "vocab": {
                "words_total":       len(vocab_total_row),
                "due_review_today":  len(vocab_learning),
            },
            "grammar": {
                "articles_viewed_7d": len(grammar_recent),
            },
        },
        "errors": {
            "undismissed": len(err_undismissed),
            "last_24h":    len(err_24h),
            "last_7d":     len(err_7d),
        },
        "access_codes": {
            "active": ac_active,
            "by_type": {
                "mass":   ac_by_type.get("mass", 0),
                "direct": ac_by_type.get("direct", 0),
                "staff":  ac_by_type.get("staff", 0),
            },
        },
        "recent_activity": activity,
        "generated_at":    now.isoformat(),
    }

    return JSONResponse(
        content=body,
        headers={"Cache-Control": f"max-age={_CACHE_MAX_AGE_SECONDS}"},
    )
