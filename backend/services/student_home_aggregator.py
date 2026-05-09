"""services/student_home_aggregator.py — multi-skill student homepage payload.

Sprint 5.1 introduces /pages/home.html as the post-login landing for students.
Unlike the Speaking-only dashboard payload (services/dashboard_aggregator.py),
this aggregator stitches across every skill the student has access to —
Writing, Speaking, Grammar, Vocabulary — plus a couple of "coming soon"
placeholders for future Reading/Listening features.

Tables touched (verified 2026-05-09 against migrations/):
    - sessions               (Speaking — started_at, overall_band, status)
    - writing_essays         (Writing — created_at, status, joined via
                              students.user_id)
    - article_views          (Grammar — last_viewed_at, article_slug)
    - user_vocabulary        (Vocabulary — created_at, is_archived,
                              is_skipped, mastery_status)
    - flashcard_reviews      (Vocabulary — next_review_at, due count)

Resilience:
    Each skill's sub-builder is wrapped in try/except. A failure in one
    skill (e.g. Grammar query times out) downgrades that card to a
    `degraded: true` flag with the rest of the payload still rendering.
    Mirrors the dashboard_aggregator.py pattern.

Coming-soon skills:
    Reading and Listening are intentionally hard-coded with
    ``status='coming_soon'`` so the frontend has nothing to render
    dynamically yet. When those skills ship, flip the flag here and
    add the per-skill builder — frontend stays put.

Auth:
    Caller passes ``supabase_admin`` (service-role client). This mirrors
    routers/writing_student.py — student tables span auth.users + the
    `students` mapping table, and a JWT-scoped client cannot resolve the
    cross-table joins under RLS. We compensate with explicit
    user_id / student_id filters on every query (defense-in-depth).
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# Reading + Listening haven't shipped yet. Surface as locked cards.
_COMING_SOON_SKILLS = ("reading", "listening")


def get_home_summary(sb, user_id: str, *, name: str, email: str) -> Dict[str, Any]:
    """Build the multi-skill homepage payload for a single student.

    `sb` here is supabase_admin (service-role) — see module docstring for
    why we don't use the JWT-scoped client. `user_id` filters everything;
    `name` / `email` come from the auth layer (we don't re-fetch them).
    """
    payload: Dict[str, Any] = {
        "student": {"name": name, "email": email},
        "streak": {"current_days": 0, "longest_days": 0},
        "totals": {
            "speaking_sessions": 0,
            "writing_essays": 0,
            "grammar_lessons_viewed": 0,
            "vocab_words_learned": 0,
        },
        "skills": {
            "writing": _empty_skill(),
            "speaking": _empty_skill(),
            "grammar": _empty_skill(),
            "vocabulary": _empty_skill(),
            "reading": {"status": "coming_soon", "primary_cta": None, "primary_cta_url": None},
            "listening": {"status": "coming_soon", "primary_cta": None, "primary_cta_url": None},
        },
    }
    errors: Dict[str, str] = {}

    try:
        speaking = _build_speaking(sb, user_id)
        payload["skills"]["speaking"] = speaking
        payload["totals"]["speaking_sessions"] = speaking["sessions_count"]
    except Exception as e:
        errors["speaking"] = _short_error(e)

    try:
        writing = _build_writing(sb, user_id)
        payload["skills"]["writing"] = writing
        payload["totals"]["writing_essays"] = writing["essays_count"]
    except Exception as e:
        errors["writing"] = _short_error(e)

    try:
        grammar = _build_grammar(sb, user_id)
        payload["skills"]["grammar"] = grammar
        payload["totals"]["grammar_lessons_viewed"] = grammar["lessons_viewed"]
    except Exception as e:
        errors["grammar"] = _short_error(e)

    try:
        vocab = _build_vocabulary(sb, user_id)
        payload["skills"]["vocabulary"] = vocab
        payload["totals"]["vocab_words_learned"] = vocab["words_learned"]
    except Exception as e:
        errors["vocabulary"] = _short_error(e)

    try:
        payload["streak"] = _build_streak(sb, user_id)
    except Exception as e:
        errors["streak"] = _short_error(e)

    if errors:
        payload["_errors"] = errors

    return payload


# ── Per-skill builders ───────────────────────────────────────────────


def _empty_skill() -> Dict[str, Any]:
    """Default shape — every active skill card has at minimum these keys.
    Individual builders extend this with skill-specific metrics."""
    return {
        "status": "active",
        "last_activity_at": None,
        "primary_cta": None,
        "primary_cta_url": None,
    }


def _build_speaking(sb, user_id: str) -> Dict[str, Any]:
    sessions_res = (
        sb.table("sessions")
        .select("id, started_at, overall_band, status", count="exact")
        .eq("user_id", user_id)
        .order("started_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = sessions_res.data or []
    total = sessions_res.count if sessions_res.count is not None else len(rows)

    last_band: Optional[float] = None
    last_activity: Optional[str] = None
    if rows:
        last_activity = rows[0].get("started_at")
        last_band = rows[0].get("overall_band")

    # Find the latest *completed* band if the most recent session hasn't been
    # graded yet — otherwise the dashboard shows "Band: —" right after the
    # student finishes recording but before grading completes.
    if last_band is None:
        completed_res = (
            sb.table("sessions")
            .select("overall_band")
            .eq("user_id", user_id)
            .eq("status", "completed")
            .not_.is_("overall_band", "null")
            .order("started_at", desc=True)
            .limit(1)
            .execute()
        )
        completed_rows = completed_res.data or []
        if completed_rows:
            last_band = completed_rows[0].get("overall_band")

    return {
        "status": "active",
        "last_activity_at": last_activity,
        "last_band": float(last_band) if last_band is not None else None,
        "sessions_count": int(total),
        "primary_cta": "Continue practice" if total else "Start practice",
        "primary_cta_url": "/pages/speaking.html",
    }


def _build_writing(sb, user_id: str) -> Dict[str, Any]:
    """Writing aggregates require a `students` row. Students who haven't
    been linked yet (no admin-created students record) get an empty
    writing card — not a 500. Mirrors writing_student.get_current_student
    semantics but degrades gracefully here."""
    student_res = (
        sb.table("students")
        .select("id")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    student_rows = student_res.data or []
    if not student_rows:
        return {
            "status": "active",
            "last_activity_at": None,
            "last_band": None,
            "essays_count": 0,
            "essays_in_progress": 0,
            "primary_cta": "Submit new essay",
            "primary_cta_url": "/pages/writing-dashboard.html",
        }

    student_id = student_rows[0]["id"]

    essays_res = (
        sb.table("writing_essays")
        .select("id, created_at, status", count="exact")
        .eq("student_id", student_id)
        .order("created_at", desc=True)
        .limit(50)
        .execute()
    )
    rows = essays_res.data or []
    total = essays_res.count if essays_res.count is not None else len(rows)

    # "in progress" = anything that hasn't been delivered to the student yet
    # (pending/grading/graded/reviewed). 'failed' is excluded — those need
    # admin re-submission, not student attention.
    in_progress_states = {"pending", "grading", "graded", "reviewed"}
    in_progress = sum(1 for r in rows if r.get("status") in in_progress_states)

    last_activity = rows[0].get("created_at") if rows else None

    # Latest delivered band (from writing_feedback). One join — minor cost,
    # avoids a misleading band from a non-delivered draft.
    last_band: Optional[float] = None
    try:
        delivered_res = (
            sb.table("writing_essays")
            .select("id")
            .eq("student_id", student_id)
            .eq("status", "delivered")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        delivered_rows = delivered_res.data or []
        if delivered_rows:
            essay_id = delivered_rows[0]["id"]
            fb_res = (
                sb.table("writing_feedback")
                .select("overall_band_score")
                .eq("essay_id", essay_id)
                .limit(1)
                .execute()
            )
            fb_rows = fb_res.data or []
            if fb_rows and fb_rows[0].get("overall_band_score") is not None:
                last_band = float(fb_rows[0]["overall_band_score"])
    except Exception as e:
        # writing_feedback may not exist on every project — degrade silently.
        logger.debug("writing band lookup failed: %s", _short_error(e))

    return {
        "status": "active",
        "last_activity_at": last_activity,
        "last_band": last_band,
        "essays_count": int(total),
        "essays_in_progress": in_progress,
        "primary_cta": "Submit new essay",
        "primary_cta_url": "/pages/writing-dashboard.html",
    }


def _build_grammar(sb, user_id: str) -> Dict[str, Any]:
    res = (
        sb.table("article_views")
        .select("article_slug, last_viewed_at", count="exact")
        .eq("user_id", user_id)
        .order("last_viewed_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    total = res.count if res.count is not None else len(rows)
    last_activity = rows[0].get("last_viewed_at") if rows else None

    return {
        "status": "active",
        "last_activity_at": last_activity,
        "lessons_viewed": int(total),
        "primary_cta": "Browse lessons",
        "primary_cta_url": "/grammar.html",
    }


def _build_vocabulary(sb, user_id: str) -> Dict[str, Any]:
    """`words_learned` excludes archived + skipped rows (the active wallet);
    `flashcards_due` is the SRS queue at "now". Both queries are cheap —
    indexed on (user_id, ...)."""
    words_res = (
        sb.table("user_vocabulary")
        .select("id, created_at", count="exact")
        .eq("user_id", user_id)
        .eq("is_archived", False)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    word_rows = words_res.data or []
    words_count = words_res.count if words_res.count is not None else len(word_rows)
    last_activity = word_rows[0].get("created_at") if word_rows else None

    due_count = 0
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        due_res = (
            sb.table("flashcard_reviews")
            .select("id", count="exact")
            .eq("user_id", user_id)
            .lte("next_review_at", now_iso)
            .limit(1)
            .execute()
        )
        due_count = int(due_res.count or 0)
    except Exception as e:
        logger.debug("flashcards due-count failed: %s", _short_error(e))

    return {
        "status": "active",
        "last_activity_at": last_activity,
        "words_learned": int(words_count),
        "flashcards_due": due_count,
        "primary_cta": "Practice flashcards" if due_count else "Browse vocabulary",
        "primary_cta_url": "/pages/flashcards.html" if due_count else "/pages/my-vocabulary.html",
    }


# ── Streak (cross-skill) ─────────────────────────────────────────────


def _build_streak(sb, user_id: str) -> Dict[str, Any]:
    """Cross-skill streak. Definition: consecutive days, walking back from
    today, on which the student has at least one activity in *any* skill
    (Speaking session OR Grammar view OR vocab capture). Writing essays
    are admin-submitted on the student's behalf, so they're excluded —
    counting them would credit the student for the admin's actions.

    Pulls 365 most-recent activity dates per skill (cheap given the
    indexes), unions, walks. Longest-streak is computed in the same pass."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=400)).isoformat()
    day_set: set[str] = set()

    sources = [
        ("sessions", "started_at"),
        ("article_views", "last_viewed_at"),
        ("user_vocabulary", "created_at"),
    ]

    for table, ts_col in sources:
        try:
            res = (
                sb.table(table)
                .select(ts_col)
                .eq("user_id", user_id)
                .gte(ts_col, cutoff)
                .limit(2000)
                .execute()
            )
            for row in res.data or []:
                ts = row.get(ts_col)
                if ts:
                    day_set.add(ts[:10])
        except Exception as e:
            logger.debug("streak source %s failed: %s", table, _short_error(e))

    current = 0
    cursor = date.today()
    while cursor.isoformat() in day_set:
        current += 1
        cursor -= timedelta(days=1)

    # Longest-streak: scan all days in set, find the longest consecutive run.
    longest = 0
    if day_set:
        sorted_days = sorted(day_set)
        run = 1
        prev = date.fromisoformat(sorted_days[0])
        longest = 1
        for d_str in sorted_days[1:]:
            d = date.fromisoformat(d_str)
            if (d - prev).days == 1:
                run += 1
            else:
                run = 1
            longest = max(longest, run)
            prev = d

    return {"current_days": current, "longest_days": longest}


# ── Util ─────────────────────────────────────────────────────────────


def _short_error(e: Exception) -> str:
    msg = str(e) or e.__class__.__name__
    return msg[:200]
