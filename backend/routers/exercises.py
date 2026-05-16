"""
routers/exercises.py — Phase D Wave 1: D1 fill-blank user + admin endpoints.

User endpoints (prefix /api/exercises) are auth-required AND feature-flag-gated.
Admin endpoints (prefix /admin/exercises) require role='admin' and never
auto-publish — every exercise must be reviewed manually before going public.

D3 endpoints land in Wave 2 — this file deliberately scopes itself to D1.
"""

import logging
import random
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from supabase import create_client

from config import settings
from database import supabase_admin
from routers.admin import require_admin
from routers.auth import get_supabase_user
from services.analytics import fire_event
from services.d1_content_gen import GeminiBatchError, generate_d1_exercises
from services.feature_flags import is_d1_enabled
from services.rate_limit import rate_limit_exercise
from services.srs import update_srs

logger = logging.getLogger(__name__)


user_router = APIRouter(prefix="/api/exercises", tags=["exercises"])
admin_router = APIRouter(prefix="/admin/exercises", tags=["exercises-admin"])


# ── Helpers ───────────────────────────────────────────────────────────────────


def _require_d1_enabled(user_id: str) -> None:
    if not is_d1_enabled(user_id, settings.D1_ENABLED):
        raise HTTPException(403, "D1 exercises are not enabled for your account.")


def _bearer_token(authorization: str | None) -> str:
    """Strip 'Bearer ' from the Authorization header, raising 401 on a bad header."""
    if not authorization:
        raise HTTPException(401, "Missing Authorization header")
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(401, "Invalid Authorization header")
    return parts[1]


def _user_sb(token: str):
    """
    Return a Supabase client bound to the caller's JWT so RLS is enforced.
    Same pattern as routers/vocabulary_bank._user_sb — service-role MUST NOT
    be used on user-facing exercise routes.
    """
    client = create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)
    client.postgrest.auth(token)
    return client


def _safe_event(event_name: str, payload: dict, user_id: str) -> None:
    try:
        fire_event(event_name, payload, user_id)
    except Exception as e:
        logger.debug("[exercises] analytics fire failed (non-fatal): %s", e)


def _grade_d1(user_answer: str, correct_answer: str) -> bool:
    return (user_answer or "").strip().lower() == (correct_answer or "").strip().lower()


# Sprint 10.3 — D1 → SRS wire-up floor. Wrong answers on a mastered
# card should NOT push interval below the 1-week buffer. Andy Q3 lock,
# 2026-05-15. Lifted to module-level constant so tests can pin the
# value without re-implementing the rule.
_D1_SRS_FLOOR_DAYS = 7


def _apply_d1_srs_update(
    sb,
    user_id: str,
    vocab_id: str,
    rating: str,
) -> bool:
    """Sprint 10.3 — upsert flashcard_reviews from a D1 first-attempt
    outcome, then sync the mastery column. Returns True on success
    (SRS state written) so the response can carry srs_updated=true.

    Fail-soft: any Supabase exception logs a WARNING and returns
    False — the attempt log already succeeded and the user-facing
    grading is unchanged. The next D1 attempt on a different exercise
    targeting the same vocab will retry.

    Defaults mirror flashcard_reviews column defaults (migration 027)
    when no prior row exists: ease_factor=2.5, interval_days=1,
    review_count=0, lapse_count=0. update_srs increments review_count
    by 1 on every call, so the first wire-up lands the row at
    review_count=1.
    """
    try:
        existing = (
            sb.table("flashcard_reviews")
            .select("ease_factor, interval_days, review_count, lapse_count")
            .eq("user_id", user_id)
            .eq("vocabulary_id", vocab_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.warning(
            "[exercises] flashcard_reviews fetch failed for vocab_id=%s "
            "(skipping SRS wire-up): %s",
            vocab_id, e,
        )
        return False

    if existing.data:
        prev = SimpleNamespace(**existing.data[0])
    else:
        prev = SimpleNamespace(
            ease_factor=2.5,
            interval_days=1,
            review_count=0,
            lapse_count=0,
        )

    try:
        new_state = update_srs(prev, rating, floor=_D1_SRS_FLOOR_DAYS)
    except Exception as e:
        logger.warning(
            "[exercises] update_srs failed for vocab_id=%s rating=%s: %s",
            vocab_id, rating, e,
        )
        return False

    upsert_row = {
        "user_id":          user_id,
        "vocabulary_id":    vocab_id,
        "interval_days":    new_state["interval_days"],
        "ease_factor":      new_state["ease_factor"],
        "review_count":     new_state["review_count"],
        "lapse_count":      new_state["lapse_count"],
        "last_reviewed_at": new_state["last_reviewed_at"],
        "next_review_at":   new_state["next_review_at"],
        "updated_at":       new_state["last_reviewed_at"],
    }
    try:
        sb.table("flashcard_reviews").upsert(
            upsert_row, on_conflict="user_id,vocabulary_id",
        ).execute()
    except Exception as e:
        logger.warning(
            "[exercises] flashcard_reviews upsert failed for vocab_id=%s: %s",
            vocab_id, e,
        )
        return False

    # Sprint 10.6 (migration 055) — mastery_status column dropped. The
    # response shape's derived `mastery_status` is computed on-the-fly
    # from flashcard_reviews via services.mastery.derive_mastery_status,
    # so there's nothing to sync back to user_vocabulary anymore.
    return True


def _public_view(row: dict) -> dict:
    """
    User-facing view of an exercise.  Removes the `answer`/`word` fields and
    instead returns a deterministically shuffled `options` array containing the
    answer mixed in with the distractors — so the UI has 4 choices to render
    without ever knowing which one is correct.
    """
    payload = dict(row.get("content_payload") or {})
    answer = payload.pop("answer", None)
    payload.pop("word", None)
    distractors = list(payload.pop("distractors", []) or [])

    options = list(distractors)
    if answer:
        options.append(answer)
    # Per-row deterministic shuffle keyed on the row id keeps the option order
    # stable across the GET-list and the GET-by-id calls (same id → same order).
    rng = random.Random(str(row.get("id")))
    rng.shuffle(options)
    payload["options"] = options

    return {
        "id": row["id"],
        "exercise_type": row["exercise_type"],
        "content": payload,
    }


# ── Pydantic schemas ──────────────────────────────────────────────────────────


class D1AttemptRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_answer: str = Field(min_length=1, max_length=80)
    # Optional — links this attempt to the session the user was inside when
    # they submitted, for the per-session summary in /sessions/{id}/complete.
    # Legacy clients omit it and the column stays NULL (see migration 024).
    session_id: str | None = None


class StartSessionRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    size: int = Field(default=10, ge=1, le=20)


class AdminGenerateBatchRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    words: list[str] = Field(default_factory=list, max_length=100)
    count: int = Field(default=10, ge=1, le=100)


class AdminPatchExerciseRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    content_payload: dict[str, Any] | None = None


# ── User: D1 list ─────────────────────────────────────────────────────────────


@user_router.get("/d1")
async def list_d1_exercises(
    limit: int = 5,
    authorization: str | None = Header(default=None),
):
    """
    Return up to `limit` published D1 exercises the user has NOT attempted yet.

    Production smoke surfaced an infinite-loop bug: the queue handed back the
    same exercises a user had already submitted, so 'Next exercise' never ran
    out.  Fix is server-side (audit's anti-pattern: never put gating logic
    only in the frontend) — pull the user's attempted exercise_ids first,
    then exclude them from the published-D1 list.

    When the user has finished every published exercise the response is an
    empty array; the frontend translates that into the 'all done' empty
    state instead of looping.
    """
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]
    _require_d1_enabled(user_id)
    sb = _user_sb(_bearer_token(authorization))

    limit = max(1, min(int(limit or 5), 20))

    # Step 1: gather every D1 exercise this user has already attempted.
    # RLS on vocabulary_exercise_attempts (SELECT USING auth.uid()=user_id)
    # means we never leak another user's attempts here.
    try:
        attempted_res = (
            sb.table("vocabulary_exercise_attempts")
            .select("exercise_id")
            .eq("exercise_type", "D1")
            .execute()
        )
        attempted_ids = list({
            row["exercise_id"] for row in (attempted_res.data or [])
            if row.get("exercise_id")
        })
    except Exception as e:
        logger.warning(
            "[exercises] list_d1 attempts lookup failed (falling back to no-exclude): %s", e,
        )
        attempted_ids = []

    # Step 2: published D1 exercises NOT in the attempted set.  Pull more than
    # `limit` and shuffle in memory so the user gets a fresh random ordering
    # each call — Supabase REST doesn't expose ORDER BY random().
    try:
        builder = (
            sb.table("vocabulary_exercises")
            .select("id, exercise_type, content_payload, created_at")
            .eq("exercise_type", "D1")
            .eq("status", "published")
        )
        if attempted_ids:
            # PostgREST's not.in.() needs a non-empty list — branch when empty
            # to avoid a 400 from the API.
            builder = builder.not_.in_("id", attempted_ids)
        res = (
            builder
            .order("created_at", desc=True)
            .limit(limit * 4)
            .execute()
        )
    except Exception as e:
        logger.error("[exercises] list_d1 failed: %s", e)
        raise HTTPException(500, "Could not load exercises.")

    rows = list(res.data or [])
    random.shuffle(rows)
    return [_public_view(r) for r in rows[:limit]]


# ── User: D1 fetch one ────────────────────────────────────────────────────────


@user_router.get("/d1/{exercise_id}")
async def get_d1_exercise(
    exercise_id: str,
    authorization: str | None = Header(default=None),
):
    auth_user = await get_supabase_user(authorization)
    _require_d1_enabled(auth_user["id"])
    sb = _user_sb(_bearer_token(authorization))

    try:
        # RLS only returns the row when it is published OR the caller is admin
        # (per migration 021 vocab_exercises_select).  Non-admins requesting a
        # draft therefore get an empty result, which we surface as 404 below.
        res = (
            sb.table("vocabulary_exercises")
            .select("id, exercise_type, content_payload, status")
            .eq("id", exercise_id)
            .eq("exercise_type", "D1")
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.error("[exercises] get_d1 failed: %s", e)
        raise HTTPException(500, "Could not load exercise.")

    if not res.data or res.data[0].get("status") != "published":
        raise HTTPException(404, "Exercise not found.")
    return _public_view(res.data[0])


# ── User: D1 attempt ──────────────────────────────────────────────────────────


@user_router.post("/d1/{exercise_id}/attempt")
@rate_limit_exercise(exercise_type="D1", daily_limit=50)
async def submit_d1_attempt(
    exercise_id: str,
    body: D1AttemptRequest,
    authorization: str | None = Header(default=None),
):
    """
    D1 free tier: 50 attempts/day to prevent abuse.

    The decorator above runs BEFORE this handler and raises HTTP 429 with a
    machine-readable detail (error, limit, used, reset_at) once the user has
    submitted 50 D1 attempts in the current UTC day.

    Sprint 10.5 Phase 2 — exercise_id may reference either a personalized
    question (user_d1_questions) or an admin-pool exercise
    (vocabulary_exercises). The handler tries personalized first; on miss,
    falls back to admin pool. exercise_source on the attempt row records
    which table the id came from (migration 054).
    """
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]
    _require_d1_enabled(user_id)
    sb = _user_sb(_bearer_token(authorization))

    # ── Resolve exercise_id polymorphically ─────────────────────────────────
    #
    # Try the personalized table first. RLS scopes the SELECT to the
    # caller's own rows automatically. If not found, fall back to the
    # admin pool — RLS / status filter there handles published vs draft.
    exercise_source: str = "personalized"
    correct_answer: str = ""
    target_vocab_id: str | None = None

    try:
        pers_res = (
            sb.table("user_d1_questions")
            .select("id, vocabulary_id, target_answer, options, is_active")
            .eq("id", exercise_id)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.warning(
            "[exercises] personalized lookup failed for exercise_id=%s "
            "(falling through to admin pool): %s",
            exercise_id, e,
        )
        pers_res = None

    if pers_res and pers_res.data:
        prow = pers_res.data[0]
        exercise_source = "personalized"
        correct_answer = prow.get("target_answer") or ""
        target_vocab_id = prow.get("vocabulary_id")
        # Synthesize a `row` dict so the downstream code can share the
        # admin-pool variable name.
        row = {"id": prow["id"]}
    else:
        try:
            # RLS already prevents non-admins from reading drafts; we still filter
            # by status so the explicit "Exercise not found" branch is unambiguous
            # for admins inadvertently submitting against an unpublished id.
            # Sprint 10.3 — also select target_vocab_id so the attempt can wire
            # the outcome back to flashcard_reviews (SRS state).
            res = (
                sb.table("vocabulary_exercises")
                .select("id, exercise_type, content_payload, status, target_vocab_id")
                .eq("id", exercise_id)
                .eq("exercise_type", "D1")
                .limit(1)
                .execute()
            )
        except Exception as e:
            logger.error("[exercises] attempt fetch failed: %s", e)
            raise HTTPException(500, "Could not load exercise.")

        if not res.data or res.data[0].get("status") != "published":
            raise HTTPException(404, "Exercise not found.")

        row = res.data[0]
        payload = row.get("content_payload") or {}
        exercise_source = "admin"
        correct_answer = payload.get("answer") or ""
        target_vocab_id = row.get("target_vocab_id")

    is_correct = _grade_d1(body.user_answer, correct_answer)
    score = 1.0 if is_correct else 0.0

    # Sprint 10.3 — first-attempt detection. The COUNT must run BEFORE
    # the attempt insert below; otherwise the just-inserted row gets
    # counted and the first attempt always looks like a retry. We use
    # the user-scoped client so RLS gates the query — a caller can
    # only see their own attempts. If the count query itself fails,
    # log a warning and treat the attempt as a retry (conservative
    # default — better to skip the SRS update than to write the wrong
    # state).
    is_first_attempt = False
    try:
        prior_attempts = (
            sb.table("vocabulary_exercise_attempts")
            .select("id")
            .eq("user_id", user_id)
            .eq("exercise_id", row["id"])
            .limit(1)
            .execute()
        )
        is_first_attempt = not (prior_attempts.data or [])
    except Exception as e:
        logger.warning(
            "[exercises] first-attempt count failed for exercise_id=%s "
            "(treating as retry → SRS skip): %s",
            row["id"], e,
        )

    feedback = {
        "is_correct": is_correct,
        "correct_answer": correct_answer,
        "your_answer": body.user_answer.strip(),
    }

    # Validate session_id (when provided) — must belong to this user AND list
    # the exercise_id in its snapshot.  Invalid links are dropped (still log
    # the attempt) so a stale or forged id can't poison a real session.
    linked_session_id: str | None = None
    if body.session_id:
        try:
            sess = (
                sb.table("d1_sessions")
                .select("id, exercise_ids")
                .eq("id", body.session_id)
                .limit(1)
                .execute()
            )
            if sess.data:
                row_ids = sess.data[0].get("exercise_ids") or []
                if row["id"] in row_ids:
                    linked_session_id = body.session_id
                else:
                    logger.warning(
                        "[exercises] attempt session_id=%s does not list exercise_id=%s — dropping link",
                        body.session_id, row["id"],
                    )
            else:
                # RLS hides another user's session, so empty data == not yours.
                logger.warning(
                    "[exercises] attempt session_id=%s not visible to user=%s — dropping link",
                    body.session_id, user_id,
                )
        except Exception as e:
            logger.warning("[exercises] attempt session lookup failed: %s", e)

    try:
        # User-scoped client so the WITH CHECK on user_id is enforced — a
        # caller cannot insert an attempt that claims another user's id.
        # Sprint 10.5 Phase 2 — exercise_source records whether the
        # exercise_id points at user_d1_questions or vocabulary_exercises
        # (migration 054 dropped the FK to make this polymorphism possible).
        sb.table("vocabulary_exercise_attempts").insert({
            "user_id":         user_id,
            "exercise_id":     row["id"],
            "exercise_type":   "D1",
            "exercise_source": exercise_source,
            "user_answer":     body.user_answer.strip(),
            "is_correct":      is_correct,
            "score":           score,
            "feedback":        feedback,
            "session_id":      linked_session_id,
        }).execute()
    except Exception as e:
        logger.warning("[exercises] attempt insert failed (non-fatal): %s", e)

    # ── Sprint 10.3 — D1 → SRS feedback loop ────────────────────────────
    #
    # Wire the attempt outcome into flashcard_reviews so productive
    # recall (writing the word in context) actually feeds the SRS
    # schedule. Two safeguards (Andy Q2 + Q3):
    #
    #   1. First-attempt-only — retries log but don't fire SRS. Prevents
    #      "spam retry to recover rating" gaming. is_first_attempt was
    #      computed via the COUNT-before-insert pattern above.
    #
    #   2. Gated demotion floor — wrong answers map to rating='again'
    #      and the SRS update passes floor=7 so the SM-2 reset (which
    #      drops interval to 0) is clamped UP to a 1-week buffer.
    #      Sprint 10.3.1-hotfix correction: the original Sprint 10.3
    #      Q4 lock chose 'hard' assuming it was a "softer demote", but
    #      SM-2 'hard' is actually slower-growth (×1.2), not demotion
    #      — a wrong on a mastered card (interval=25) grew to ~30 and
    #      the floor was a no-op. With 'again', the floor is the
    #      single safeguard at the right layer: any wrong → drop to
    #      interval=7, lapse_count+1, mastery flips to 'learning'.
    #      lapse_count++ is the desired side-effect of 'again' — it's
    #      what gates the mastery threshold (Sprint 10.2 derivation).
    #
    # Skip the wire-up entirely when:
    #   - target_vocab_id is null (exercise not bound to a user vocab row)
    #   - this is not the first attempt
    #   - the user_vocabulary row is archived (don't update state for
    #     items the user has chosen to hide)
    srs_updated = False
    srs_rating: str | None = None
    if is_first_attempt and target_vocab_id:
        srs_rating = "good" if is_correct else "again"
        try:
            vocab_row = (
                sb.table("user_vocabulary")
                .select("id, is_archived, is_pending")
                .eq("id", target_vocab_id)
                .eq("user_id", user_id)
                .limit(1)
                .execute()
            )
            # Sprint 10.4: pending vocab is not yet in the bank — D1
            # outcomes for pending items must not feed SRS until the
            # user confirms via the result.html pending panel.
            vocab_alive = (
                bool(vocab_row.data)
                and not vocab_row.data[0].get("is_archived")
                and not vocab_row.data[0].get("is_pending")
            )
        except Exception as e:
            logger.warning(
                "[exercises] vocab lookup failed for target_vocab_id=%s "
                "(skipping SRS wire-up): %s",
                target_vocab_id, e,
            )
            vocab_alive = False

        if vocab_alive:
            srs_updated = _apply_d1_srs_update(
                sb, user_id, target_vocab_id, srs_rating,
            )
        if not srs_updated:
            # The handler skipped or fail-softed; clear the rating so
            # the response shape stays honest. Frontend keys off
            # srs_updated; srs_rating=null avoids implying a write
            # that didn't happen.
            srs_rating = None

    _safe_event(
        "exercise_completed",
        {
            "type": "D1",
            "exercise_id": row["id"],
            "is_correct": is_correct,
            "score": score,
            "srs_updated": srs_updated,
            "srs_rating": srs_rating,
        },
        user_id,
    )

    return {
        "is_correct": is_correct,
        "correct_answer": correct_answer,
        "score": score,
        # Sprint 10.3 — new fields. Backwards compat: pre-10.3 frontends
        # ignore unknown keys; post-10.3 d1-exercise.js renders the
        # "✓ Đã ghi nhận" / "📝 Lưu ý" indicator when srs_updated=true.
        "srs_updated": srs_updated,
        "srs_rating":  srs_rating,
    }


# ── User: D1 session lifecycle ────────────────────────────────────────────────
#
# Sessions exist so the UI can show progress, an end-of-session summary, and a
# 'review my wrong answers' loop without losing context.  The list/detail
# endpoints above are kept for backwards compatibility but the new flow goes
# through these three routes.


def _session_exercise_view(row: dict) -> dict:
    """
    Session-context view of an ADMIN-pool exercise. Unlike _public_view,
    this INCLUDES the answer so the frontend can grade locally for
    instant feedback — PHASE_D §5 (D1 redesign): 'D1 không phải exam —
    local grade an toàn'. The backend POST /attempt still re-grades
    server-side for analytics.

    Sprint 10.5 Phase 2 — gained a `source: 'admin_fallback'` tag so
    the frontend can label admin-pool questions distinctly from
    personalized ones.
    """
    payload = dict(row.get("content_payload") or {})
    answer = payload.get("answer")
    payload.pop("word", None)
    distractors = list(payload.pop("distractors", []) or [])

    options = list(distractors)
    if answer and answer not in options:
        options.append(answer)
    rng = random.Random(str(row.get("id")))
    rng.shuffle(options)

    return {
        "id":       row["id"],
        "sentence": payload.get("sentence", ""),
        "options":  options,
        "answer":   answer,
        "source":   "admin_fallback",
        "target_vocabulary_id": row.get("target_vocab_id"),
    }


def _personalized_session_view(row: dict) -> dict:
    """Sprint 10.5 Phase 2 — session view for a user_d1_questions row.

    Builds the same shape as _session_exercise_view so the frontend
    can render both sources with one rendering path. The
    context_sentence has the target word replaced with `___` (the
    blank marker the existing UI expects); options come pre-shuffled
    from the generator's deterministic Random(headword) seed.

    The `answer` field is included for the same local-grade pattern
    the admin pool uses (PHASE_D §5). Spec falsification (41): the
    Phase 2 spec asked for `target_answer` to be omitted for cheating
    prevention. Phase 2 keeps the local-grade pattern for consistency
    with admin pool — switching both to server-grade is a deferred
    polish item (10.5.x) once admin pool sunset begins.
    """
    sentence = (row.get("context_sentence") or "")
    start = row.get("blank_position_start")
    end = row.get("blank_position_end")
    target_answer = row.get("target_answer") or ""
    options = list(row.get("options") or [])

    # Render the blank marker. Defensive: if blank positions are
    # malformed, fall back to substring replace on the target word.
    if (
        isinstance(start, int) and isinstance(end, int)
        and 0 <= start < end <= len(sentence)
    ):
        rendered = sentence[:start] + "___" + sentence[end:]
    else:
        rendered = sentence.replace(target_answer, "___", 1) if target_answer else sentence

    return {
        "id":       row["id"],
        "sentence": rendered,
        "options":  options,
        "answer":   target_answer,
        "source":   "personalized",
        "target_vocabulary_id": row.get("vocabulary_id"),
        "hint":     row.get("hint"),
    }


@user_router.post("/d1/sessions", status_code=201)
async def start_d1_session(
    body: StartSessionRequest,
    authorization: str | None = Header(default=None),
):
    """
    Pick `size` D1 exercises (default 10), preferring personalized questions
    from the user's own vocab bank (Sprint 10.5 Phase 2 — user_d1_questions);
    fall back to the admin pool (vocabulary_exercises) when personalized
    stock runs short. Within each source, prefer items the user has not yet
    attempted so they get fresh practice; repeat older items when the
    unattempted pool is too thin (intended behaviour for review).

    Response includes the answer for each exercise so the frontend can grade
    locally; the backend still authoritatively grades on /attempt. Each
    exercise carries a `source` tag (`personalized` | `admin_fallback`) so
    the UI can label them distinctly.

    Sprint 10.5 Phase 2 deferred items (10.5.x):
      - 70/30 due/new split per SRS state (would need a JOIN with
        flashcard_reviews; Phase 2 just prefers all personalized items
        regardless of SRS due date)
      - Server-grade only (target_answer omitted from response) once the
        admin pool sunset begins (PHASE_D §5 local-grade pattern still in
        effect for compatibility).
    """
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]
    _require_d1_enabled(user_id)
    sb = _user_sb(_bearer_token(authorization))
    size = max(1, min(body.size, 20))

    # Step 1: collect attempted IDs once. The same column carries both
    # vocabulary_exercises.id and user_d1_questions.id (migration 054
    # dropped the FK on exercise_id), so the dedup-against-attempted
    # check is source-agnostic.
    try:
        attempted_res = (
            sb.table("vocabulary_exercise_attempts")
            .select("exercise_id")
            .eq("exercise_type", "D1")
            .execute()
        )
        attempted_ids = list({
            r["exercise_id"] for r in (attempted_res.data or []) if r.get("exercise_id")
        })
    except Exception as e:
        logger.warning("[exercises] start_session attempts lookup failed: %s", e)
        attempted_ids = []

    # ── Step 2: personalized pool first ─────────────────────────────────────
    #
    # MCQ-ready rows only — len(options) must be 4. Rows with options=[]
    # are awaiting the Phase 2 backfill script (or evidence-fallback
    # leftovers from Phase 1); session endpoint skips them so the UI
    # always renders a full 4-option card. Done in-memory because
    # PostgREST doesn't expose jsonb_array_length over the REST API
    # cleanly.
    personalized: list[dict] = []
    try:
        pers_res = (
            sb.table("user_d1_questions")
            .select("id, vocabulary_id, context_sentence, blank_position_start, "
                    "blank_position_end, target_answer, options, hint, is_active")
            .eq("is_active", True)
            .execute()
        )
        pers_rows = [
            r for r in (pers_res.data or [])
            if r.get("options") and len(r["options"]) == 4
        ]
        # Prefer unattempted personalized first, then attempted as
        # review fill.
        unattempted = [r for r in pers_rows if r["id"] not in attempted_ids]
        attempted_pool = [r for r in pers_rows if r["id"] in attempted_ids]
        random.shuffle(unattempted)
        random.shuffle(attempted_pool)
        personalized = (unattempted + attempted_pool)[:size]
    except Exception as e:
        logger.warning(
            "[exercises] start_session personalized lookup failed (falling back to admin pool only): %s", e,
        )
        personalized = []

    # ── Step 3: admin pool fallback when personalized is short ──────────────

    def _pull_admin(exclude_attempted: bool, take: int) -> list[dict]:
        """Pull up to `take * 4` admin-pool candidate rows then
        in-memory shuffle. Supabase REST has no ORDER BY random()."""
        builder = (
            sb.table("vocabulary_exercises")
            .select("id, exercise_type, content_payload, status, target_vocab_id")
            .eq("exercise_type", "D1")
            .eq("status", "published")
        )
        if exclude_attempted and attempted_ids:
            builder = builder.not_.in_("id", attempted_ids)
        res = builder.limit(take * 4).execute()
        rows = list(res.data or [])
        random.shuffle(rows)
        return rows[:take]

    admin_rows: list[dict] = []
    deficit = size - len(personalized)
    if deficit > 0:
        admin_rows = _pull_admin(exclude_attempted=True, take=deficit)
        if len(admin_rows) < deficit:
            chosen_ids = {r["id"] for r in admin_rows}
            extra = [
                r for r in _pull_admin(exclude_attempted=False, take=deficit + len(chosen_ids))
                if r["id"] not in chosen_ids
            ]
            admin_rows = admin_rows + extra[: deficit - len(admin_rows)]

    if not personalized and not admin_rows:
        raise HTTPException(
            status_code=503,
            detail={"error": "no_exercises", "message": "No D1 exercises available."},
        )

    # ── Step 4: build the unified session payload ───────────────────────────
    exercises: list[dict] = [_personalized_session_view(r) for r in personalized]
    exercises.extend(_session_exercise_view(r) for r in admin_rows)
    exercise_ids = [e["id"] for e in exercises]

    # Step 5: persist the session row. RLS WITH CHECK on user_id means a
    # caller cannot create a session for someone else even if they fake
    # the body.
    try:
        sess = sb.table("d1_sessions").insert({
            "user_id":      user_id,
            "exercise_ids": exercise_ids,
            "total_count":  len(exercise_ids),
        }).execute()
    except Exception as e:
        logger.error("[exercises] start_session insert failed: %s", e)
        raise HTTPException(500, "Could not start session.")

    if not sess.data:
        raise HTTPException(500, "Could not start session.")

    _safe_event("d1_session_started", {
        "session_id":           sess.data[0]["id"],
        "size":                 len(exercise_ids),
        "personalized_count":   len(personalized),
        "admin_fallback_count": len(admin_rows),
    }, user_id)

    return {
        "session_id": sess.data[0]["id"],
        "exercises":  exercises,
        "total":      len(exercise_ids),
    }


@user_router.get("/d1/sessions/{session_id}")
async def get_d1_session(
    session_id: str,
    authorization: str | None = Header(default=None),
):
    """
    Fetch a session for resume/review.  Returns the session row (RLS already
    scopes to the caller) plus any attempts already linked to it so the UI
    can pick up where it left off.
    """
    auth_user = await get_supabase_user(authorization)
    _require_d1_enabled(auth_user["id"])
    sb = _user_sb(_bearer_token(authorization))

    try:
        sess = (
            sb.table("d1_sessions")
            .select("*")
            .eq("id", session_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.error("[exercises] get_session failed: %s", e)
        raise HTTPException(500, "Could not load session.")

    if not sess.data:
        # RLS hides other users' sessions; treat as not-found from the caller's view.
        raise HTTPException(404, "Session not found.")

    try:
        attempts = (
            sb.table("vocabulary_exercise_attempts")
            .select("exercise_id, user_answer, is_correct, attempted_at")
            .eq("session_id", session_id)
            .order("attempted_at", desc=False)
            .execute()
        )
    except Exception as e:
        logger.warning("[exercises] get_session attempts lookup failed: %s", e)
        attempts = type("S", (), {"data": []})()

    return {
        "session": sess.data[0],
        "attempts": list(attempts.data or []),
    }


@user_router.post("/d1/sessions/{session_id}/complete")
async def complete_d1_session(
    session_id: str,
    authorization: str | None = Header(default=None),
):
    """
    Mark a session completed and return a per-item correct/wrong summary so
    the UI can render the results screen without making a separate request.

    Idempotent: calling this twice on the same session just re-derives the
    summary from the attempt rows; the second update is a no-op.
    """
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]
    _require_d1_enabled(user_id)
    sb = _user_sb(_bearer_token(authorization))

    try:
        sess_res = (
            sb.table("d1_sessions")
            .select("id, exercise_ids, total_count, status")
            .eq("id", session_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.error("[exercises] complete_session fetch failed: %s", e)
        raise HTTPException(500, "Could not load session.")

    if not sess_res.data:
        raise HTTPException(404, "Session not found.")

    session_row = sess_res.data[0]
    exercise_ids: list[str] = list(session_row.get("exercise_ids") or [])

    # Pull all attempts linked to this session so we can build the summary.
    try:
        att_res = (
            sb.table("vocabulary_exercise_attempts")
            .select("exercise_id, user_answer, is_correct")
            .eq("session_id", session_id)
            .execute()
        )
    except Exception as e:
        logger.error("[exercises] complete_session attempts fetch failed: %s", e)
        raise HTTPException(500, "Could not load attempts.")

    attempts_by_id: dict[str, dict] = {}
    for a in (att_res.data or []):
        # If the same exercise was answered twice in one session (edge case)
        # the latest insert wins — we don't have attempted_at in this query,
        # but list iteration order from PostgREST is insertion-stable.
        attempts_by_id[a["exercise_id"]] = a

    # Resolve exercise content for the summary cards.  RLS allows reading
    # published rows; if any have since been unpublished/deleted, the
    # session simply omits them from the summary.
    ex_rows: dict[str, dict] = {}
    if exercise_ids:
        try:
            ex_res = (
                sb.table("vocabulary_exercises")
                .select("id, content_payload")
                .in_("id", exercise_ids)
                .execute()
            )
            for r in (ex_res.data or []):
                ex_rows[r["id"]] = r
        except Exception as e:
            logger.warning("[exercises] complete_session ex fetch failed: %s", e)

    correct_items: list[dict] = []
    wrong_items: list[dict] = []

    for ex_id in exercise_ids:
        ex = ex_rows.get(ex_id) or {}
        payload = ex.get("content_payload") or {}
        sentence = payload.get("sentence", "")
        correct_answer = payload.get("answer", "")
        att = attempts_by_id.get(ex_id)
        if att is None:
            continue  # user skipped this exercise — neither correct nor wrong
        if att.get("is_correct"):
            correct_items.append({
                "exercise_id": ex_id,
                "sentence":    sentence,
                "answer":      correct_answer,
            })
        else:
            wrong_items.append({
                "exercise_id":    ex_id,
                "sentence":       sentence,
                "user_answer":    att.get("user_answer", ""),
                "correct_answer": correct_answer,
            })

    correct_count = len(correct_items)
    total_count = session_row.get("total_count") or len(exercise_ids)

    # Update the session row.  WITH CHECK ensures the user can only update
    # their own session.  Idempotent: re-completing produces the same values.
    try:
        sb.table("d1_sessions").update({
            "completed_at":  datetime.now(timezone.utc).isoformat(),
            "correct_count": correct_count,
            "status":        "completed",
        }).eq("id", session_id).execute()
    except Exception as e:
        logger.warning("[exercises] complete_session update failed (non-fatal): %s", e)

    _safe_event(
        "d1_session_completed",
        {"session_id": session_id, "correct": correct_count, "total": total_count},
        user_id,
    )

    return {
        "session_id":    session_id,
        "correct_count": correct_count,
        "total_count":   total_count,
        "correct":       correct_items,
        "wrong":         wrong_items,
    }


# ── Admin: list ───────────────────────────────────────────────────────────────


@admin_router.get("")
async def admin_list_exercises(
    status: str = "draft",
    exercise_type: str = "D1",
    limit: int = 50,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)

    if status not in ("draft", "published", "rejected"):
        raise HTTPException(400, "Invalid status filter.")
    if exercise_type not in ("D1", "D3"):
        raise HTTPException(400, "Invalid exercise_type.")
    limit = max(1, min(int(limit or 50), 200))

    try:
        res = (
            supabase_admin.table("vocabulary_exercises")
            .select("id, exercise_type, content_payload, status, created_at, reviewed_at")
            .eq("status", status)
            .eq("exercise_type", exercise_type)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
    except Exception as e:
        logger.error("[admin/exercises] list failed: %s", e)
        raise HTTPException(500, "Could not load exercises.")

    return res.data or []


# ── Admin: status transitions ─────────────────────────────────────────────────


def _admin_set_status(exercise_id: str, new_status: str, reviewer_id: str) -> dict:
    update = {
        "status":       new_status,
        "reviewed_at":  datetime.now(timezone.utc).isoformat(),
        "reviewed_by":  reviewer_id,
    }
    try:
        res = (
            supabase_admin.table("vocabulary_exercises")
            .update(update)
            .eq("id", exercise_id)
            .execute()
        )
    except Exception as e:
        logger.error("[admin/exercises] status update failed: %s", e)
        raise HTTPException(500, "Status update failed.")

    if not res.data:
        raise HTTPException(404, "Exercise not found.")
    return res.data[0]


@admin_router.patch("/{exercise_id}/publish")
async def admin_publish_exercise(
    exercise_id: str,
    authorization: str | None = Header(default=None),
):
    auth_user = await require_admin(authorization)
    row = _admin_set_status(exercise_id, "published", auth_user["id"])
    _safe_event("admin_exercise_reviewed", {"action": "publish", "exercise_id": exercise_id}, auth_user["id"])
    return row


@admin_router.patch("/{exercise_id}/reject")
async def admin_reject_exercise(
    exercise_id: str,
    authorization: str | None = Header(default=None),
):
    auth_user = await require_admin(authorization)
    row = _admin_set_status(exercise_id, "rejected", auth_user["id"])
    _safe_event("admin_exercise_reviewed", {"action": "reject", "exercise_id": exercise_id}, auth_user["id"])
    return row


@admin_router.patch("/{exercise_id}/unpublish")
async def admin_unpublish_exercise(
    exercise_id: str,
    authorization: str | None = Header(default=None),
):
    """
    Pull a published exercise back into draft for re-review.  Used when an
    admin spots a problem after publishing — without this, the only recovery
    path was to reject (terminal) and re-generate from scratch.
    """
    auth_user = await require_admin(authorization)
    row = _admin_set_status(exercise_id, "draft", auth_user["id"])
    _safe_event("admin_exercise_reviewed", {"action": "unpublish", "exercise_id": exercise_id}, auth_user["id"])
    return row


@admin_router.patch("/{exercise_id}")
async def admin_edit_exercise(
    exercise_id: str,
    body: AdminPatchExerciseRequest,
    authorization: str | None = Header(default=None),
):
    """Edit content_payload while still in 'draft' / 'rejected' state."""
    await require_admin(authorization)
    if body.content_payload is None:
        raise HTTPException(400, "content_payload is required.")
    try:
        res = (
            supabase_admin.table("vocabulary_exercises")
            .update({"content_payload": body.content_payload})
            .eq("id", exercise_id)
            .execute()
        )
    except Exception as e:
        logger.error("[admin/exercises] edit failed: %s", e)
        raise HTTPException(500, "Edit failed.")
    if not res.data:
        raise HTTPException(404, "Exercise not found.")
    return res.data[0]


# ── Admin: bulk transitions ───────────────────────────────────────────────────


class AdminBulkActionRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    ids: list[str] = Field(min_length=1, max_length=200)
    action: str  # 'publish' | 'reject'


@admin_router.post("/bulk")
async def admin_bulk_action(
    body: AdminBulkActionRequest,
    authorization: str | None = Header(default=None),
):
    auth_user = await require_admin(authorization)
    if body.action not in ("publish", "reject"):
        raise HTTPException(400, "Invalid bulk action.")

    new_status = "published" if body.action == "publish" else "rejected"
    update = {
        "status":      new_status,
        "reviewed_at": datetime.now(timezone.utc).isoformat(),
        "reviewed_by": auth_user["id"],
    }

    try:
        res = (
            supabase_admin.table("vocabulary_exercises")
            .update(update)
            .in_("id", body.ids)
            .execute()
        )
    except Exception as e:
        logger.error("[admin/exercises] bulk action failed: %s", e)
        raise HTTPException(500, "Bulk action failed.")

    affected = len(res.data or [])
    _safe_event(
        "admin_exercise_reviewed",
        {"action": body.action, "bulk": True, "count": affected},
        auth_user["id"],
    )
    return {"action": body.action, "affected": affected, "ids": [r["id"] for r in (res.data or [])]}


# ── Admin: generate batch via Gemini ──────────────────────────────────────────


import math


def _insert_chunk_as_drafts(items: list[dict], admin_id: str) -> int:
    """Insert one chunk's worth of validated items as drafts.  Returns the
    number of rows actually written.  A DB error is logged and re-raised so
    the surrounding generate_d1_exercises loop can move on to the next chunk."""
    if not items:
        return 0
    rows = [
        {
            "exercise_type":   "D1",
            "status":          "draft",
            "content_payload": item,
            "created_by":      admin_id,
        }
        for item in items
    ]
    supabase_admin.table("vocabulary_exercises").insert(rows).execute()
    logger.info(
        "[admin/exercises] chunk insert: +%d drafts (admin=%s)", len(rows), admin_id,
    )
    return len(rows)


def _generate_and_insert_batch(words: list[str], count: int, admin_id: str) -> dict:
    """
    Drive chunked generation and incremental insert.  Returns a stats dict
    used by the endpoint's response body:

        {
          "inserted_count":  total rows actually written,
          "total_chunks":    chunks attempted,
          "successful_chunks": chunks that returned ≥1 validated item,
          "failed_chunks":   chunks that raised GeminiBatchError,
        }

    Propagates GeminiBatchError ONLY when every chunk fails (the
    "all chunks failed" case from generate_d1_exercises).
    """
    inserted_count = 0
    successful_chunks = 0

    def _on_chunk(items: list[dict]) -> None:
        nonlocal inserted_count, successful_chunks
        n = _insert_chunk_as_drafts(items, admin_id)
        inserted_count += n
        if n > 0:
            successful_chunks += 1

    # generate_d1_exercises does the chunking; the callback persists per chunk.
    # Its return value is the aggregated list, but we don't need it here —
    # the callback already inserted every successful chunk.
    items = generate_d1_exercises(words, count=count, on_chunk_validated=_on_chunk)

    # Compute total/failed chunks from the same shape generate_d1_exercises uses.
    word_count_clamped = max(1, min(count, len(words), 100))
    total_chunks = max(1, math.ceil(word_count_clamped / 10))  # CHUNK_SIZE=10
    failed_chunks = total_chunks - successful_chunks

    logger.info(
        "[admin/exercises] batch summary: inserted=%d, chunks ok=%d/%d, items_returned=%d (admin=%s)",
        inserted_count, successful_chunks, total_chunks, len(items), admin_id,
    )
    return {
        "inserted_count":    inserted_count,
        "total_chunks":      total_chunks,
        "successful_chunks": successful_chunks,
        "failed_chunks":     failed_chunks,
    }


@admin_router.post("/d1/generate-batch", status_code=202)
async def admin_generate_d1_batch(
    body: AdminGenerateBatchRequest,
    authorization: str | None = Header(default=None),
):
    """
    Synchronous + chunked.  Generate in groups of 10 (services.d1_content_gen
    .CHUNK_SIZE) so each Gemini call stays well under its truncation limit,
    and persist drafts incrementally so a failure in chunk N doesn't lose
    chunks 1..N-1.  100 words → 10 chunks → ~120s max, well within Railway's
    response timeout.

    Response shape:
      All chunks ok      → 202, status='completed',  total_chunks==successful_chunks
      Some chunks fail   → 202, status='partial',    failed_chunks > 0
      Every chunk fails  → 502, GeminiBatchError detail (existing api.js path)
    """
    auth_user = await require_admin(authorization)
    if not body.words:
        raise HTTPException(400, "Provide at least one word.")

    # Cost estimate per PHASE_D_V3_PLAN §19: ~$0.0005 / item for Gemini Flash.
    estimated_cost_usd = round(0.0005 * body.count, 4)
    job_id = str(uuid.uuid4())

    logger.info(
        "[admin/exercises] start batch job=%s admin=%s words=%d count=%d",
        job_id, auth_user["id"], len(body.words), body.count,
    )

    try:
        stats = _generate_and_insert_batch(body.words, body.count, auth_user["id"])
    except GeminiBatchError as e:
        logger.error("[admin/exercises] batch job=%s FAILED: %s", job_id, e)
        raise HTTPException(
            status_code=502,
            detail=f"Generation failed: {e}",
        )
    except Exception as e:
        logger.error("[admin/exercises] batch job=%s unexpected error: %s", job_id, e)
        raise HTTPException(
            status_code=500,
            detail=f"Batch insert failed: {e}",
        )

    inserted = stats["inserted_count"]
    failed_chunks = stats["failed_chunks"]
    total_chunks = stats["total_chunks"]
    successful_chunks = stats["successful_chunks"]

    if failed_chunks == 0:
        status = "completed"
        message = f"{inserted} draft(s) inserted across {total_chunks} chunk(s)."
    else:
        status = "partial"
        message = (
            f"{inserted} draft(s) inserted across {successful_chunks}/{total_chunks} "
            f"chunk(s); {failed_chunks} chunk(s) failed (see server logs)."
        )

    return {
        "job_id":             job_id,
        "status":             status,
        "inserted_count":     inserted,
        "requested_count":    body.count,
        "word_count":         len(body.words),
        "total_chunks":       total_chunks,
        "successful_chunks":  successful_chunks,
        "failed_chunks":      failed_chunks,
        "estimated_cost_usd": estimated_cost_usd,
        "message":            message,
    }
