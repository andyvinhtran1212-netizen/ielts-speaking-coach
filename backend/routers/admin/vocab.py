"""routers.admin.vocab — vocab monitor, enrichment backfill, flashcards, D1 curation and lemma overrides (BACKENDSPLIT-0076 T009).

Cut and pasted unchanged from the former single-file routers/admin.py. The
package re-exports every name; tests patch ``routers.admin``, never this module
(see __init__.py).
"""

from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Query, Response
from starlette.concurrency import run_in_threadpool
import uuid as _uuid
from typing import Any, Literal
from pydantic import BaseModel, Field, model_validator
from database import supabase_admin
from services.errors import clip_user_value, clip_user_values, new_ref, safe_error

from routers.admin import (  # noqa: E402 — defined above this block in the package
    logger,
    router,
    require_admin,
)


# ── VOCAB MONITOR ─────────────────────────────────────────────────────────────

@router.get("/vocab/stats")
async def admin_vocab_stats(authorization: str | None = Header(default=None)):
    """Return vocab bank aggregate stats for admin monitoring."""
    await require_admin(authorization)

    try:
        fp_res = (
            supabase_admin.table("analytics_events")
            .select("id", count="exact")
            .eq("event_name", "vocab_fp_reported")
            .execute()
        )
        fp_total = fp_res.count or 0
    except Exception:
        fp_total = 0

    try:
        bank_res = (
            supabase_admin.table("user_vocabulary")
            .select("id", count="exact")
            .eq("is_archived", False)
            .execute()
        )
        bank_total = bank_res.count or 0
    except Exception:
        bank_total = 0

    fp_rate = round(fp_total / bank_total * 100, 1) if bank_total > 0 else 0.0

    try:
        flag_res = supabase_admin.table("users").select("feature_flags").execute()
        enabled_count = sum(
            1 for u in (flag_res.data or [])
            if isinstance(u.get("feature_flags"), dict) and u["feature_flags"].get("vocab_enabled") is True
        )
    except Exception:
        enabled_count = 0

    return {
        "fp_reports_total": fp_total,
        "vocab_bank_total": bank_total,
        "fp_rate_percent": fp_rate,
        "users_with_vocab_enabled": enabled_count,
    }


class VocabFlagPayload(BaseModel):
    enabled: bool


@router.post("/users/{user_id}/vocab-flag")
async def admin_set_vocab_flag(
    user_id: str,
    payload: VocabFlagPayload,
    authorization: str | None = Header(default=None),
):
    """Toggle vocab_enabled feature flag for a specific user."""
    await require_admin(authorization)

    try:
        user_res = (
            supabase_admin.table("users")
            .select("id, feature_flags")
            .eq("id", user_id)
            .single()
            .execute()
        )
    except Exception as exc:
        # PC-J225: the driver text is not a user-facing message.
        logger.warning("[admin] feature-flag user lookup failed: %s", exc.__class__.__name__)
        raise HTTPException(404, "User not found")

    user_row = user_res.data
    if not user_row:
        raise HTTPException(404, "User not found")

    flags = user_row.get("feature_flags") or {}
    flags["vocab_enabled"] = payload.enabled

    supabase_admin.table("users").update({"feature_flags": flags}).eq("id", user_id).execute()

    action = "enabled" if payload.enabled else "disabled"
    logger.info("[admin] vocab flag %s for user %s", action, user_id)
    return {"ok": True, "message": f"Vocab bank {action} for user {user_id}."}


# ── POST /admin/vocab/backfill-enrichment ─────────────────────────────────────
#
# Phase D Wave 2 rich-content backfill.  Fills user_vocabulary.ipa,
# example_sentence, definition_vi and definition_en for rows where any of
# them is empty.  Uses the same Gemini batch service that the inline Phase B
# extractor uses, so the prompt + validation stays in one place.
#
# Implementation notes:
# - BackgroundTasks because the job can take 10-30s for ~100 cards (one
#   Gemini call per chunk of 10) and we don't want to block the admin's
#   browser.
# - Dedup by lower(headword) before calling Gemini — multiple users share
#   the same word frequently and we don't want to pay per duplicate.
# - service-role admin client is required: we UPDATE across many user_ids
#   in one job, so an RLS-scoped client wouldn't work.  This is the same
#   posture as the existing admin endpoints.
# - Cost estimate is conservative — Gemini Flash list pricing puts a chunk
#   of 10 enrichments around $0.0005, so 100 cards (10 chunks) ≈ $0.005;
#   the prompt's $0.10-0.15 figure is for cards-with-duplicates pre-dedup.
# - INACTIVEWRITE-0035 follow-up (owner decision 2026-10-28): one owner can
#   contribute at most _BACKFILL_MAX_ROWS_PER_OWNER rows per run, and rows of
#   owners whose users.is_active is false, NULL or missing are skipped, so
#   neither a single account's headwords nor an inactive account's can fill
#   the paid Gemini batch. The candidate scan pages past skipped rows; it is
#   bounded by _BACKFILL_SCAN_MAX_PAGES.
# - Fill-empty-only (owner decision 2026-10-28 15:07): a column is written
#   only when it is NULL, empty or whitespace; an existing value is never
#   overwritten.  Each write is a separate UPDATE guarded by the same
#   emptiness filter, so a value the learner saves between the scan and the
#   write is not overwritten either.  `dry_run=true` lists, per row, the
#   columns that would be filled, without calling Gemini or writing.

_BACKFILL_MAX_ROWS_PER_OWNER = 50
_BACKFILL_SCAN_PAGE_SIZE = 500
_BACKFILL_SCAN_MAX_PAGES = 20
_BACKFILL_OWNER_LOOKUP_CHUNK = 100
# Every column the enricher fills; the enricher's keys use the same names.
_BACKFILL_FIELDS = ("ipa", "example_sentence", "definition_vi", "definition_en")


def _backfill_empty_filter(col: str) -> str:
    """PostgREST or-filter for "NULL, empty or whitespace-only"."""
    return f"{col}.is.null,{col}.match.^\\s*$"


def _backfill_is_empty(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _backfill_empty_fields(row: dict) -> list[str]:
    """The enriched columns this row may receive, in _BACKFILL_FIELDS order."""
    return [c for c in _BACKFILL_FIELDS if _backfill_is_empty(row.get(c))]


def _backfill_select_candidates(job_id: str, limit: int) -> list[dict]:
    """Pick up to `limit` enrichment candidates, at most
    _BACKFILL_MAX_ROWS_PER_OWNER per owner, active owners only.

    Raises on any query failure: the caller then aborts the run before any
    Gemini call (an unverified owner must not be enriched).
    """
    selected: list[dict] = []
    per_owner: dict[str, int] = {}
    owner_active: dict[str, bool] = {}
    skipped_inactive = 0
    skipped_over_cap = 0

    for page in range(_BACKFILL_SCAN_MAX_PAGES):
        start = page * _BACKFILL_SCAN_PAGE_SIZE
        # Day 1 dogfood: idioms + multi-word phrases were arriving with
        # NULL definition_vi from the extractor.  Widen the candidate query
        # so we re-enrich rows whose definitions are missing too — Gemini
        # now generates Vietnamese + English glosses alongside IPA/example.
        batch = (
            supabase_admin.table("user_vocabulary")
            .select("id, headword, user_id, " + ", ".join(_BACKFILL_FIELDS))
            .eq("is_archived", False)
            .or_(",".join(_backfill_empty_filter(c) for c in _BACKFILL_FIELDS))
            .order("id")
            .range(start, start + _BACKFILL_SCAN_PAGE_SIZE - 1)
            .execute()
        ).data or []

        unknown = sorted({
            str(r["user_id"]) for r in batch
            if r.get("user_id") and str(r["user_id"]) not in owner_active
        })
        for i in range(0, len(unknown), _BACKFILL_OWNER_LOOKUP_CHUNK):
            chunk = unknown[i:i + _BACKFILL_OWNER_LOOKUP_CHUNK]
            users = (
                supabase_admin.table("users")
                .select("id, is_active")
                .in_("id", chunk)
                .execute()
            ).data or []
            found = {str(u["id"]): u.get("is_active") is True for u in users}
            for uid in chunk:
                # Missing row or NULL is inactive (activation_gate.lookup_is_active).
                owner_active[uid] = found.get(uid, False)

        for r in batch:
            if not _backfill_empty_fields(r):
                continue  # Nothing to fill; never re-enrich a complete row.
            uid = str(r.get("user_id") or "")
            if not owner_active.get(uid, False):
                skipped_inactive += 1
                continue
            if per_owner.get(uid, 0) >= _BACKFILL_MAX_ROWS_PER_OWNER:
                skipped_over_cap += 1
                continue
            per_owner[uid] = per_owner.get(uid, 0) + 1
            selected.append(r)
            if len(selected) >= limit:
                break

        if len(selected) >= limit or len(batch) < _BACKFILL_SCAN_PAGE_SIZE:
            break

    logger.info(
        "[backfill %s] selected %d rows from %d owners "
        "(skipped %d inactive-owner rows, %d over the %d-per-owner cap)",
        job_id, len(selected), len(per_owner),
        skipped_inactive, skipped_over_cap, _BACKFILL_MAX_ROWS_PER_OWNER,
    )
    return selected


def _backfill_dry_run(job_id: str, limit: int) -> dict:
    """Report the rows a real run would pick and, per row, the columns it
    would fill.  No Gemini call and no write.  Raises when the candidate
    query fails, so the caller can fail visibly.

    A listed column is filled only if Gemini returns a valid value for it
    (definitions are best-effort), so a real run can fill fewer.
    """
    rows = _backfill_select_candidates(job_id, limit)
    out = []
    for r in rows:
        would_fill = _backfill_empty_fields(r)
        logger.info(
            "[backfill %s] dry-run row=%s headword=%r would fill: %s",
            job_id, r["id"], r.get("headword"), ", ".join(would_fill),
        )
        out.append({
            "id":         r["id"],
            "user_id":    r.get("user_id"),
            "headword":   r.get("headword"),
            "would_fill": would_fill,
        })
    column_counts = {
        c: sum(c in row["would_fill"] for row in out) for c in _BACKFILL_FIELDS
    }
    logger.info(
        "[backfill %s] dry-run: %d rows, columns that would be filled: %s",
        job_id, len(out), column_counts,
    )
    return {"rows": out, "column_counts": column_counts}


def _backfill_run(job_id: str, limit: int) -> None:
    """
    Background task: enrich up to `limit` user_vocabulary rows with an empty
    IPA, example_sentence, definition_vi or definition_en, filling only the
    empty columns.  Runs synchronously inside FastAPI's BG worker — no
    asyncio dependencies, all Supabase calls are blocking.
    """
    from services.vocab_enrichment import enrich_vocabulary_batch, VocabEnrichmentError

    try:
        rows = _backfill_select_candidates(job_id, limit)
    except Exception as e:
        logger.error("[backfill %s] candidate query failed: %s", job_id, e)
        return

    if not rows:
        logger.info("[backfill %s] no rows to enrich", job_id)
        return

    # Group rows by lower(headword) so one Gemini call per unique word
    # back-fills every row that shares it (across users).
    by_word: dict[str, list[dict]] = {}
    for r in rows:
        key = (r.get("headword") or "").strip().lower()
        if not key:
            continue
        by_word.setdefault(key, []).append(r)

    unique_words = list(by_word.keys())
    logger.info(
        "[backfill %s] enriching %d unique headwords across %d rows",
        job_id, len(unique_words), len(rows),
    )

    try:
        enrichments = enrich_vocabulary_batch(unique_words)
    except VocabEnrichmentError as e:
        logger.error("[backfill %s] all chunks failed: %s", job_id, e)
        return

    enrich_map = {e["headword"].lower(): e for e in enrichments}

    updated = 0
    for low, group_rows in by_word.items():
        e = enrich_map.get(low)
        if not e:
            continue  # Word didn't make it through Gemini's validation.
        for row in group_rows:
            filled: list[str] = []
            kept: list[str] = []
            for col in _backfill_empty_fields(row):
                value = e.get(col)
                if _backfill_is_empty(value):
                    continue  # Gemini gave nothing usable; leave it empty.
                try:
                    res = (
                        supabase_admin.table("user_vocabulary")
                        .update({col: value})
                        .eq("id", row["id"])
                        .or_(_backfill_empty_filter(col))
                        .execute()
                    )
                except Exception as upd_err:
                    logger.warning(
                        "[backfill %s] update failed for row=%s column=%s: %s",
                        job_id, row["id"], col, upd_err,
                    )
                    continue
                # No row back = the column got a value after the scan; kept.
                (filled if res.data else kept).append(col)
            if kept:
                logger.info(
                    "[backfill %s] row=%s kept values written since the scan: %s",
                    job_id, row["id"], ", ".join(kept),
                )
            if filled:
                logger.info(
                    "[backfill %s] row=%s filled: %s",
                    job_id, row["id"], ", ".join(filled),
                )
                updated += 1

    logger.info(
        "[backfill %s] done: enriched %d unique words → updated %d/%d rows",
        job_id, len(enrich_map), updated, len(rows),
    )


@router.post("/vocab/backfill-enrichment")
async def backfill_vocab_enrichment(
    background_tasks: BackgroundTasks,
    limit: int = Query(default=100, ge=1, le=500),
    dry_run: bool = Query(default=False),
    authorization: str | None = Header(default=None),
):
    """
    Trigger a background job that enriches user_vocabulary rows with an
    empty `ipa`, `example_sentence`, `definition_vi` or `definition_en`
    (i.e. rows that pre-date migration 029 or whose Gemini call failed
    during Phase B extraction).  Only columns that are NULL, empty or
    whitespace are filled; existing values are never overwritten.

    `dry_run=true` runs the same row selection synchronously and returns,
    per row, the columns that would be filled.  It calls no model and
    writes nothing.

    Caps at 500/call so an admin can't accidentally fan out across the
    whole bank in one click.  Within a call, one owner contributes at most
    50 rows and inactive owners are skipped (INACTIVEWRITE-0035 follow-up).  Re-run the endpoint to process the next
    batch — the WHERE clause naturally moves forward as rows get filled.

    Cost estimate is best-effort: Gemini Flash batch is ~$0.0005 per
    chunk of 10 unique words.
    """
    await require_admin(authorization)
    job_id = _uuid.uuid4().hex[:12]
    if dry_run:
        try:
            plan = await run_in_threadpool(_backfill_dry_run, job_id, limit)
        except Exception as e:
            logger.error("[backfill %s] dry-run candidate query failed: %s", job_id, e)
            raise HTTPException(status_code=503, detail="Backfill dry-run could not read candidates.")
        return {
            "job_id":        job_id,
            "status":        "dry_run",
            "limit":         limit,
            "row_count":     len(plan["rows"]),
            "column_counts": plan["column_counts"],
            "rows":          plan["rows"],
            "note": "No model call and no write. A listed column is filled only if Gemini returns a valid value for it.",
        }
    background_tasks.add_task(_backfill_run, job_id, limit)
    estimated_cost_usd = round((max(1, limit) / 10) * 0.0005, 4)
    return {
        "job_id":             job_id,
        "status":             "queued",
        "limit":              limit,
        "estimated_cost_usd": estimated_cost_usd,
        "note": "Tail Railway logs for '[backfill <job_id>]' to track progress.",
    }


# ── GET /admin/flashcards/stats ────────────────────────────────────────────────
#
# Phase 2.5 dogfood support: aggregate flashcard usage metrics for SRS
# validation.  Read-only; uses service-role supabase_admin so no per-user
# RLS scoping (admin-only endpoint anyway).
#
# Schema notes (verified against migrations 025/026/027):
# - flashcard_review_log: per-review audit row, columns
#   (user_id, vocabulary_id, rating, reviewed_at).  NOT created_at — the
#   column name is reviewed_at; using the wrong name would 400 silently
#   under PostgREST.
# - flashcard_reviews: latest SRS state per (user_id, vocabulary_id) pair
#   — ease_factor REAL [1.3..3.0], interval_days INT, lapse_count INT.
# - Auto-stacks (All / Recent / Needs review) are virtual; total stack
#   count comes from flashcard_stacks (manual stacks only).


def _fc_compute_activity_stats() -> dict:
    """Total counts: manual stacks, cards in stacks, active reviewers, lifetime reviews."""
    stacks_res = (
        supabase_admin.table("flashcard_stacks")
        .select("id", count="exact")
        .limit(0)
        .execute()
    )
    cards_res = (
        supabase_admin.table("flashcard_cards")
        .select("id", count="exact")
        .limit(0)
        .execute()
    )

    # Unique reviewers + lifetime review count come from the same select so
    # we don't double-pull the table.
    reviews_res = (
        supabase_admin.table("flashcard_reviews")
        .select("user_id, review_count")
        .execute()
    )
    rows = reviews_res.data or []
    unique_users = len({r["user_id"] for r in rows if r.get("user_id")})
    total_reviews = sum(int(r.get("review_count") or 0) for r in rows)

    return {
        "total_manual_stacks":            int(stacks_res.count or 0),
        "total_cards_in_manual_stacks":   int(cards_res.count or 0),
        "total_active_users":             unique_users,
        "total_reviews_all_time":         total_reviews,
    }


def _fc_compute_srs_health(cutoff_iso: str) -> dict:
    """Rating distribution (last `days`), avg ease factor, mastery counts."""
    log_res = (
        supabase_admin.table("flashcard_review_log")
        .select("rating")
        .gte("reviewed_at", cutoff_iso)
        .execute()
    )
    ratings = [r["rating"] for r in (log_res.data or []) if r.get("rating")]
    total = len(ratings)

    if total == 0:
        rating_dist = {"again": 0.0, "hard": 0.0, "good": 0.0, "easy": 0.0}
    else:
        from collections import Counter as _Counter
        c = _Counter(ratings)
        # Round each separately, then absorb rounding drift in the largest
        # bucket so the four percentages always sum to exactly 100.0.
        raw = {k: (c.get(k, 0) / total) * 100 for k in ("again", "hard", "good", "easy")}
        rating_dist = {k: round(v, 1) for k, v in raw.items()}
        drift = round(100.0 - sum(rating_dist.values()), 1)
        if drift:
            biggest = max(rating_dist, key=rating_dist.get)
            rating_dist[biggest] = round(rating_dist[biggest] + drift, 1)

    reviews_res = (
        supabase_admin.table("flashcard_reviews")
        .select("ease_factor, interval_days, lapse_count")
        .execute()
    )
    reviews_data = reviews_res.data or []
    if reviews_data:
        avg_ease = round(
            sum(float(r.get("ease_factor") or 0) for r in reviews_data) / len(reviews_data),
            2,
        )
        cards_mastered = sum(1 for r in reviews_data if (r.get("interval_days") or 0) > 30)
        cards_lapsed = sum(1 for r in reviews_data if (r.get("lapse_count") or 0) > 0)
    else:
        avg_ease = 0.0
        cards_mastered = 0
        cards_lapsed = 0

    return {
        "rating_distribution_percent":  rating_dist,
        "rating_total_count":           total,
        "avg_ease_factor":              avg_ease,
        "cards_mastered_30plus_days":   cards_mastered,
        "cards_with_lapses":            cards_lapsed,
    }


def _fc_compute_engagement_stats(cutoff_iso: str) -> dict:
    """Avg reviews/user (last 7d), avg DAU (over period), top-10 reviewed words."""
    from collections import Counter as _Counter, defaultdict as _defaultdict

    log_res = (
        supabase_admin.table("flashcard_review_log")
        .select("user_id, vocabulary_id, reviewed_at")
        .gte("reviewed_at", cutoff_iso)
        .execute()
    )
    log_data = log_res.data or []

    week_ago_iso = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    week_logs = [l for l in log_data if (l.get("reviewed_at") or "") >= week_ago_iso]
    week_users = {l["user_id"] for l in week_logs if l.get("user_id")}
    avg_reviews_per_user = (
        round(len(week_logs) / len(week_users), 1) if week_users else 0.0
    )

    # Daily Active Users averaged across the period.  defaultdict(set) so
    # one user reviewing twice on the same day still counts as 1 DAU that day.
    dau_map: dict[str, set[str]] = _defaultdict(set)
    for log in log_data:
        ts = log.get("reviewed_at") or ""
        uid = log.get("user_id")
        if ts and uid:
            dau_map[ts[:10]].add(uid)
    avg_dau = (
        round(sum(len(u) for u in dau_map.values()) / len(dau_map), 1) if dau_map else 0.0
    )

    # Top 10 most-reviewed vocab in the period.
    word_counts = _Counter(l["vocabulary_id"] for l in log_data if l.get("vocabulary_id"))
    top_pairs = word_counts.most_common(10)
    top_vocab_ids = [vid for vid, _ in top_pairs]

    if top_vocab_ids:
        try:
            vocab_res = (
                supabase_admin.table("user_vocabulary")
                .select("id, headword")
                .in_("id", top_vocab_ids)
                .execute()
            )
            vocab_map = {v["id"]: v.get("headword") for v in (vocab_res.data or [])}
        except Exception as exc:
            logger.warning("[admin/flashcards/stats] top-words headword lookup failed: %s", exc)
            vocab_map = {}
        top_words = [
            {"headword": vocab_map.get(vid) or "(unknown)", "review_count": cnt}
            for vid, cnt in top_pairs
        ]
    else:
        top_words = []

    return {
        "avg_reviews_per_user_last_7_days":  avg_reviews_per_user,
        "avg_dau_last_30_days":              avg_dau,
        "top_reviewed_words":                top_words,
    }


def _fc_compute_reviews_timeseries(days: int) -> list[dict]:
    """Daily review counts over the last `days` days, including 0-count days."""
    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    log_res = (
        supabase_admin.table("flashcard_review_log")
        .select("reviewed_at")
        .gte("reviewed_at", cutoff_iso)
        .execute()
    )
    from collections import defaultdict as _defaultdict
    daily_counts: dict[str, int] = _defaultdict(int)
    for log in (log_res.data or []):
        ts = log.get("reviewed_at") or ""
        if ts:
            daily_counts[ts[:10]] += 1

    today = datetime.now(timezone.utc).date()
    series: list[dict] = []
    for i in range(days, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        series.append({"date": d, "reviews": int(daily_counts.get(d, 0))})
    return series


@router.get("/flashcards/stats")
async def admin_flashcard_stats(
    days: int = Query(default=30, ge=1, le=90),
    authorization: str | None = Header(default=None),
):
    """Aggregate flashcard usage metrics for the admin dashboard."""
    await require_admin(authorization)

    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    return {
        "stats": {
            "activity":   _fc_compute_activity_stats(),
            "srs_health": _fc_compute_srs_health(cutoff_iso),
            "engagement": _fc_compute_engagement_stats(cutoff_iso),
            "timeseries": _fc_compute_reviews_timeseries(days),
        },
        "period_days":  days,
        "computed_at":  datetime.now(timezone.utc).isoformat(),
    }


# ── Sprint 12.6 — admin curation for user_d1_questions ─────────────────────────
#
# Sprint 10.5 introduced `user_d1_questions` (personalized D1 fill-blank
# pre-generated from each user's vocab bank via Claude Haiku). Until now
# there was no admin tool to inspect, edit, or soft-delete these — only
# the user's own RLS-scoped queries reached them. Sprint 12.6 ships read /
# patch / soft-delete using the service-role admin client.
#
# Generated_by enum (from migration 052):
#   'haiku' | 'gemini' | 'fallback_evidence'
# `fallback_evidence` rows are the highest-priority for review — they mean
# the AI call failed and the generator reused the user's original evidence
# substring with the target word masked.


@router.get("/vocab/d1-questions")
async def admin_list_d1_questions(
    source: str | None = Query(default=None, description="filter by generated_by (haiku|gemini|fallback_evidence)"),
    active: str | None = Query(default=None, description="filter by is_active ('true'|'false'); default = all"),
    user_id: str | None = Query(default=None, description="restrict to one user's bank"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    authorization: str | None = Header(default=None),
):
    """List personalized D1 questions with filters + pagination.

    `total` is the server-side count for the active filter so the
    frontend can render "Tải thêm" when more pages remain. `items`
    carries the question payload joined against the source vocab row so
    admins can see which headword each question targets.
    """
    await require_admin(authorization)

    try:
        q = (
            supabase_admin.table("user_d1_questions")
            .select(
                "id, user_id, vocabulary_id, context_sentence, "
                "target_answer, acceptable_variants, hint, "
                "source_evidence_substring, generated_by, generated_at, "
                "is_active, attempt_count, last_used_at, created_at",
                count="exact",
            )
        )
        if source:
            q = q.eq("generated_by", source)
        if active == "true":
            q = q.eq("is_active", True)
        elif active == "false":
            q = q.eq("is_active", False)
        if user_id:
            q = q.eq("user_id", user_id)
        q = q.order("created_at", desc=True).range(offset, offset + limit - 1)
        res = q.execute()
    except Exception as exc:
        logger.error("[admin] d1 list failed: %s", exc)
        raise HTTPException(500, "Could not load D1 questions.")

    items = res.data or []

    # Hydrate with the vocab headword in one extra query — cheaper than
    # a polymorphic JOIN and the result set is bounded by `limit`.
    vocab_ids = list({i["vocabulary_id"] for i in items if i.get("vocabulary_id")})
    headword_map: dict[str, str] = {}
    if vocab_ids:
        try:
            vres = (
                supabase_admin.table("user_vocabulary")
                .select("id, headword")
                .in_("id", vocab_ids)
                .execute()
            )
            for row in vres.data or []:
                headword_map[row["id"]] = row.get("headword") or ""
        except Exception as exc:
            logger.warning("[admin] headword hydrate failed: %s", exc)

    for i in items:
        i["headword"] = headword_map.get(i.get("vocabulary_id"), "")

    return {
        "items":  items,
        "total":  res.count or 0,
        "offset": offset,
        "limit":  limit,
    }


class D1QuestionPatchPayload(BaseModel):
    context_sentence: str | None = None
    target_answer:    str | None = None
    hint:             str | None = None
    is_active:        bool | None = None


@router.patch("/vocab/d1-questions/{question_id}")
async def admin_patch_d1_question(
    question_id: str,
    payload: D1QuestionPatchPayload,
    authorization: str | None = Header(default=None),
):
    """Edit question text / answer / hint or toggle is_active.

    All fields are optional — only sent keys are written so the admin
    can flip is_active without re-sending the whole row.
    """
    await require_admin(authorization)

    update: dict = {}
    if payload.context_sentence is not None:
        update["context_sentence"] = payload.context_sentence
    if payload.target_answer is not None:
        update["target_answer"] = payload.target_answer
    if payload.hint is not None:
        update["hint"] = payload.hint
    if payload.is_active is not None:
        update["is_active"] = payload.is_active

    if not update:
        raise HTTPException(400, "No fields to update.")

    try:
        res = (
            supabase_admin.table("user_d1_questions")
            .update(update)
            .eq("id", question_id)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] D1 question update failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Không cập nhật được câu hỏi D1. Vui lòng thử lại.") from None

    if not res.data:
        raise HTTPException(404, "D1 question not found.")
    return {"ok": True, "id": question_id, "updated_fields": list(update.keys())}


@router.delete("/vocab/d1-questions/{question_id}", status_code=204)
async def admin_delete_d1_question(
    question_id: str,
    authorization: str | None = Header(default=None),
):
    """Soft-delete: flip is_active=False (Sprint 10.6 archive pattern).

    Hard deletes are intentionally not supported — the row tracks
    attempt_count + last_used_at, which is useful audit data even after
    an admin retires the question.
    """
    await require_admin(authorization)
    try:
        res = (
            supabase_admin.table("user_d1_questions")
            .update({"is_active": False})
            .eq("id", question_id)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] D1 question soft delete failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Không xoá được câu hỏi D1. Vui lòng thử lại.") from None
    if not res.data:
        raise HTTPException(404, "D1 question not found.")
    return None


# ── Sprint 12.6 — lemma override CRUD ──────────────────────────────────────────
#
# Backed by migration 063 (lemma_overrides table) + the lemmatizer hook
# in services/lemmatizer.py. After every mutation we call
# reload_overrides() so the running worker picks up the change without
# a restart.


@router.get("/vocab/lemmas/overrides")
async def admin_list_lemma_overrides(
    search: str | None = Query(default=None, description="prefix-match on original_word"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    authorization: str | None = Header(default=None),
):
    """List manual lemma overrides with optional search."""
    await require_admin(authorization)

    try:
        q = (
            supabase_admin.table("lemma_overrides")
            .select("id, original_word, lemma, pos_tag, notes, created_at",
                    count="exact")
        )
        if search:
            q = q.ilike("original_word", f"{search.strip().lower()}%")
        q = q.order("created_at", desc=True).range(offset, offset + limit - 1)
        res = q.execute()
    except Exception as exc:
        logger.error("[admin] lemma overrides list failed: %s", exc)
        raise HTTPException(500, "Could not load overrides.")

    return {
        "items":  res.data or [],
        "total":  res.count or 0,
        "offset": offset,
        "limit":  limit,
    }


class LemmaOverridePayload(BaseModel):
    original_word: str = Field(..., min_length=1, max_length=200)
    lemma:         str = Field(..., min_length=1, max_length=200)
    pos_tag:       str | None = None
    notes:         str | None = None


@router.post("/vocab/lemmas/overrides", status_code=201)
async def admin_create_lemma_override(
    payload: LemmaOverridePayload,
    authorization: str | None = Header(default=None),
):
    """Create a new lemma override. Lowercases the original_word so
    the lemmatize() lookup (which also lowercases) always hits."""
    user = await require_admin(authorization)

    insert = {
        "original_word": payload.original_word.strip().lower(),
        "lemma":         payload.lemma.strip(),
        "pos_tag":       (payload.pos_tag or "").strip() or None,
        "notes":         (payload.notes or "").strip() or None,
        "created_by":    user.get("id") if isinstance(user, dict) else None,
    }

    try:
        res = (
            supabase_admin.table("lemma_overrides")
            .insert(insert)
            .execute()
        )
    except Exception as exc:
        msg = str(exc)
        if "duplicate" in msg.lower() or "unique" in msg.lower():
            raise HTTPException(409, f"Override for '{clip_user_value(insert['original_word'])}' already exists.")
        logger.error("[admin] lemma override create failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Không tạo được lemma override. Vui lòng thử lại.") from None

    try:
        from services.lemmatizer import reload_overrides
        reload_overrides()
    except Exception as exc:
        logger.warning("[admin] reload_overrides failed: %s", exc)

    row = (res.data or [None])[0]
    return {"ok": True, "item": row}


@router.delete("/vocab/lemmas/overrides/{override_id}", status_code=204)
async def admin_delete_lemma_override(
    override_id: str,
    authorization: str | None = Header(default=None),
):
    """Hard-delete an override. The lemmatizer falls back to spaCy on
    the next capture for that word, which is the desired behaviour
    when an admin retracts a manual mapping."""
    await require_admin(authorization)

    try:
        res = (
            supabase_admin.table("lemma_overrides")
            .delete()
            .eq("id", override_id)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] lemma override delete failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Không xoá được lemma override. Vui lòng thử lại.") from None

    if not res.data:
        raise HTTPException(404, "Override not found.")

    try:
        from services.lemmatizer import reload_overrides
        reload_overrides()
    except Exception as exc:
        logger.warning("[admin] reload_overrides failed: %s", exc)
    return None
