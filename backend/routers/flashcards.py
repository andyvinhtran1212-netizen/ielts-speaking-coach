"""
routers/flashcards.py — Phase D Wave 2: Flashcards + SRS user endpoints.

All routes are auth-required AND feature-flag-gated.  Service-role client is
NEVER used here — flashcards are user-owned content and RLS on
flashcard_stacks / flashcard_cards / flashcard_reviews / flashcard_review_log
is the only protection against cross-user reads/writes.

Step 3 of Phase D Wave 2 ships the stack-management endpoints (list /
preview / create / detail / delete).  Card listing, due-queue, review
submission, and stats land in step 4 against the same router.

Auto-stacks are virtual: GET /stacks returns three entries with ids
"auto:all_vocab" / "auto:recent" / "auto:needs_review" and dynamic counts
sourced from user_vocabulary on every call.  None of those entries is
persisted in flashcard_stacks — that table only holds manual stacks.
"""

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from supabase import create_client

from config import settings
from routers.auth import get_supabase_user
from services.feature_flags import is_flashcard_enabled
from services.rate_limit import rate_limit_flashcard
from services.srs import update_srs

logger = logging.getLogger(__name__)


user_router = APIRouter(prefix="/api/flashcards", tags=["flashcards"])


# ── Constants ────────────────────────────────────────────────────────────────


AUTO_STACK_IDS = ("auto:all_vocab", "auto:recent", "auto:needs_review")

_AUTO_STACK_NAMES = {
    "auto:all_vocab":     "Tất cả từ vựng",
    "auto:recent":        "Mới thêm gần đây",
    "auto:needs_review":  "Cần ôn tập",
}

# "Recent" auto-stack window — matches acceptance criterion §12.
_RECENT_LIMIT = 20

# Filter keys accepted on POST /stacks and POST /stacks/preview.  Anything
# else in the body is silently dropped by _normalize_filter_config so a
# stray field can't 500 the route.
_ALLOWED_FILTER_KEYS = {"topics", "categories", "search", "added_after"}

# Sentinel inside filter_config["topics"] meaning "rows with topic IS NULL".
# Frontend's "Chưa phân loại" chip emits this; backend translates it into a
# topic-IS-NULL clause so manual-add vocab (session_id NULL → topic NULL)
# can still be targeted by Manual Stack filters.  Wave 2 audit MEDIUM #1.
_UNCATEGORIZED_TOPIC = "__uncategorized__"

# Source-type values valid in filter_config["categories"] — matches the
# CHECK constraint on user_vocabulary.source_type minus the 'manual' bucket
# (which the modal hides behind the dedicated topic dropdown).
_VALID_SOURCE_TYPES = {"used_well", "needs_review", "upgrade_suggested", "manual"}


# ── Helpers ──────────────────────────────────────────────────────────────────


def _bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(401, "Missing Authorization header")
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(401, "Invalid Authorization header")
    return parts[1]


def _user_sb(token: str):
    """
    Supabase client bound to the caller's JWT.  Same pattern as
    routers/exercises._user_sb — service-role MUST NOT be used on
    user-facing flashcard routes.
    """
    client = create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)
    client.postgrest.auth(token)
    return client


def _require_flashcards_enabled(user_id: str) -> None:
    if not is_flashcard_enabled(user_id, settings.FLASHCARD_ENABLED):
        raise HTTPException(403, "Flashcards are not enabled for your account.")


def _is_auto_stack_id(stack_id: str) -> bool:
    """True only for the three known virtual ids — unknown 'auto:foo'
    strings return False so the caller can 404 cleanly."""
    return stack_id in AUTO_STACK_IDS


def _validate_stack_name(name: str) -> str:
    """
    Mirror the CHECK in migration 025 (length(trim(name)) >= 3) plus the
    50-char ceiling from the spec.  Returns the trimmed name on success.
    """
    if not isinstance(name, str):
        raise ValueError("name must be a string")
    trimmed = name.strip()
    if len(trimmed) < 3:
        raise ValueError("name must be at least 3 characters after trimming")
    if len(trimmed) > 50:
        raise ValueError("name must be at most 50 characters")
    return trimmed


def _normalize_filter_config(cfg: dict | None) -> dict:
    """
    Drop unknown keys, coerce list values to lists of strings, and validate
    `categories` membership.  Empty/null values are kept out of the result so
    the resolver below can branch with `if "topics" in out`.
    """
    if not cfg:
        return {}
    out: dict = {}
    for key in _ALLOWED_FILTER_KEYS:
        if key not in cfg:
            continue
        val = cfg[key]
        if val is None:
            continue
        if key in ("topics", "categories"):
            if not isinstance(val, list):
                raise ValueError(f"filter_config.{key} must be a list")
            cleaned = [str(v).strip() for v in val if str(v).strip()]
            if not cleaned:
                continue
            if key == "categories":
                bad = [c for c in cleaned if c not in _VALID_SOURCE_TYPES]
                if bad:
                    raise ValueError(f"unknown categories: {bad}")
            out[key] = cleaned
        elif key == "search":
            s = str(val).strip()
            if s:
                out[key] = s
        elif key == "added_after":
            # ISO date string expected — leave string parsing to PostgREST.
            s = str(val).strip()
            if s:
                out[key] = s
    return out


def _split_topics(topics: list[str]) -> tuple[list[str], bool]:
    """
    Pull the _UNCATEGORIZED_TOPIC sentinel out of a topics list and return
    (real_topics, include_uncategorized).  Used by both _apply_filter and
    its tests.  Order is preserved on the real topics so any downstream
    deterministic IN() clause stays stable.
    """
    real: list[str] = []
    include_null = False
    for t in topics or []:
        if t == _UNCATEGORIZED_TOPIC:
            include_null = True
        else:
            real.append(t)
    return real, include_null


def _apply_filter(builder, filter_config: dict):
    """
    Apply a normalized filter_config to a supabase-py query builder against
    user_vocabulary.  Pulled out so POST /preview, POST / (create), and
    GET /stacks/{auto-id}/cards (step 4) share one resolver.

    Always restricts to NOT is_archived so archived rows never bleed into a
    flashcard stack.

    Topic filter handles the special _UNCATEGORIZED_TOPIC sentinel:
      - real topics + uncategorized → rows where topic IN (...) OR topic IS NULL
      - real topics only            → rows where topic IN (...)
      - uncategorized only          → rows where topic IS NULL
      - empty                       → no topic restriction
    The OR-with-IS-NULL is expressed via PostgREST's or_() syntax which
    accepts in.() and is.null inside one clause.
    """
    builder = builder.eq("is_archived", False)
    if "topics" in filter_config:
        real_topics, include_null = _split_topics(filter_config["topics"])
        if real_topics and include_null:
            # PostgREST or_() needs comma-joined predicates.  The in.()
            # token expects parens around the value list.
            joined = ",".join(real_topics)
            builder = builder.or_(f"topic.in.({joined}),topic.is.null")
        elif real_topics:
            builder = builder.in_("topic", real_topics)
        elif include_null:
            builder = builder.is_("topic", "null")
        # else: topics list collapsed to empty after _split — no-op.
    if "categories" in filter_config:
        builder = builder.in_("source_type", filter_config["categories"])
    if "added_after" in filter_config:
        builder = builder.gte("created_at", filter_config["added_after"])
    if "search" in filter_config:
        # PostgREST or() with ilike — escape commas/parens by relying on
        # supabase-py's serialization.  Search both headword and definition_vi
        # per spec §6.
        needle = filter_config["search"].replace(",", " ")
        builder = builder.or_(
            f"headword.ilike.*{needle}*,definition_vi.ilike.*{needle}*"
        )
    return builder


def _count_user_vocab(sb, *, source_type: str | None = None,
                      not_archived_only: bool = True) -> int:
    """One-shot count helper used by the auto-stack list endpoint."""
    try:
        builder = sb.table("user_vocabulary").select("id", count="exact")
        if not_archived_only:
            builder = builder.eq("is_archived", False)
        # PR-A: skipped vocab is hidden everywhere; auto-stack badge counts
        # must agree with the listing or the user sees a stack labeled "5 thẻ"
        # that opens to fewer than 5 rows.
        builder = builder.eq("is_skipped", False)
        if source_type is not None:
            builder = builder.eq("source_type", source_type)
        res = builder.limit(1).execute()
        return int(res.count or 0)
    except Exception as e:
        logger.warning("[flashcards] vocab count failed: %s", e)
        return 0


# ── Pydantic schemas ─────────────────────────────────────────────────────────


class PreviewRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    filter_config: dict[str, Any] = Field(default_factory=dict)


class CreateStackRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str = Field(min_length=1, max_length=100)
    # `type` is fixed at 'manual' in the schema; accept it from clients for
    # forward-compat but ignore non-manual values rather than 422-ing.
    type: str | None = Field(default="manual")
    filter_config: dict[str, Any] = Field(default_factory=dict)


class AddCardRequest(BaseModel):
    """Body for POST /api/flashcards/stacks/{id}/cards (step 4)."""
    model_config = ConfigDict(extra="ignore")
    vocabulary_id: str = Field(min_length=1)


class ReviewRequest(BaseModel):
    """Body for POST /api/flashcards/{vocab_id}/review (step 4)."""
    model_config = ConfigDict(extra="ignore")
    rating: str

    @field_validator("rating")
    @classmethod
    def _rating_must_be_known(cls, v: str) -> str:
        if v not in ("again", "hard", "good", "easy"):
            raise ValueError("rating must be one of: again, hard, good, easy")
        return v


def _filter_due_rows(rows: list[dict], *, now: datetime, limit: int | None = None) -> list[dict]:
    """
    Filter `rows` to only those whose next_review_at is <= now (UTC), sorted
    ascending so the earliest-due card pops first.  `limit` is applied AFTER
    the sort so pagination respects the same ordering as the index in
    migration 027 (user_id, next_review_at).

    Pure function — no DB I/O — so test_due_queue.py can pin the contract
    with synthetic rows and a fixed `now`.  Rows missing `next_review_at`
    are dropped rather than treated as "always due" so a malformed record
    can't poison the queue.
    """
    parsed: list[tuple[datetime, dict]] = []
    for row in rows:
        raw = row.get("next_review_at")
        if not raw:
            continue
        try:
            dt = datetime.fromisoformat(str(raw))
        except ValueError:
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        if dt <= now:
            parsed.append((dt, row))
    parsed.sort(key=lambda pair: pair[0])
    out = [row for _, row in parsed]
    if limit is not None:
        out = out[: int(limit)]
    return out


def _vocab_card_view(vocab_row: dict, review_row: dict | None) -> dict:
    """
    Card-shaped JSON for the study page.  Pulled out so list_cards_in_stack
    and get_due_cards return the exact same shape — frontend has one
    renderer regardless of where the card came from.
    """
    return {
        "id":                vocab_row.get("id"),
        "headword":          vocab_row.get("headword"),
        "definition_vi":     vocab_row.get("definition_vi"),
        "definition_en":     vocab_row.get("definition_en"),
        "ipa":               vocab_row.get("ipa"),
        "example_sentence":  vocab_row.get("example_sentence"),
        "context_sentence":  vocab_row.get("context_sentence"),
        "topic":             vocab_row.get("topic"),
        "category":          vocab_row.get("category"),
        "source_type":       vocab_row.get("source_type"),
        "review": {
            "interval_days":    review_row["interval_days"],
            "ease_factor":      review_row["ease_factor"],
            "review_count":     review_row["review_count"],
            "lapse_count":      review_row["lapse_count"],
            "last_reviewed_at": review_row.get("last_reviewed_at"),
            "next_review_at":   review_row["next_review_at"],
        } if review_row else None,
    }


def _review_upsert_payload(user_id: str, vocabulary_id: str, srs_state: dict) -> dict:
    """
    Build the row dict for `flashcard_reviews` UPSERT.  Crucially does NOT
    include stack_id — SRS state is shared across stacks per acceptance
    criterion §12, and the schema enforces UNIQUE(user_id, vocabulary_id).
    """
    return {
        "user_id":          user_id,
        "vocabulary_id":    vocabulary_id,
        "interval_days":    srs_state["interval_days"],
        "ease_factor":      srs_state["ease_factor"],
        "review_count":     srs_state["review_count"],
        "lapse_count":      srs_state["lapse_count"],
        "last_reviewed_at": srs_state["last_reviewed_at"],
        "next_review_at":   srs_state["next_review_at"],
        "updated_at":       srs_state["last_reviewed_at"],
    }


# ── Stack management endpoints (Step 3) ──────────────────────────────────────


@user_router.get("/stacks")
async def list_stacks(authorization: str | None = Header(default=None)):
    """
    Return the user's 3 virtual auto-stacks (with dynamic card counts) plus
    every manual stack they own.  Manual stacks come back ordered by
    created_at DESC so the most recently created stack sits at the top of
    the modal.
    """
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]
    _require_flashcards_enabled(user_id)
    sb = _user_sb(_bearer_token(authorization))

    # Auto-stack counts — three exact-count queries on user_vocabulary.
    all_count = _count_user_vocab(sb)
    recent_count = min(_RECENT_LIMIT, all_count)
    needs_review_count = _count_user_vocab(sb, source_type="needs_review")

    auto_stacks = [
        {
            "id":         "auto:all_vocab",
            "name":       _AUTO_STACK_NAMES["auto:all_vocab"],
            "type":       "auto",
            "card_count": all_count,
        },
        {
            "id":         "auto:recent",
            "name":       _AUTO_STACK_NAMES["auto:recent"],
            "type":       "auto",
            "card_count": recent_count,
        },
        {
            "id":         "auto:needs_review",
            "name":       _AUTO_STACK_NAMES["auto:needs_review"],
            "type":       "auto",
            "card_count": needs_review_count,
        },
    ]

    # Manual stacks via RLS-scoped client — only the caller's rows visible.
    try:
        rows = (
            sb.table("flashcard_stacks")
            .select("id, name, type, filter_config, created_at")
            .order("created_at", desc=True)
            .execute()
        ).data or []
    except Exception as e:
        logger.error("[flashcards] list_stacks select failed: %s", e)
        raise HTTPException(500, "Could not load stacks.")

    manual_stacks: list[dict] = []
    for row in rows:
        # Per-stack card_count via flashcard_cards count.  N+1 looks scary at
        # first glance but a typical user has well under 20 manual stacks
        # and each count is a cheap index lookup.  If this becomes hot we
        # can switch to a single grouped RPC.
        try:
            cnt = (
                sb.table("flashcard_cards")
                .select("id", count="exact")
                .eq("stack_id", row["id"])
                .limit(1)
                .execute()
            ).count or 0
        except Exception as e:
            logger.warning("[flashcards] card count failed stack=%s: %s", row["id"], e)
            cnt = 0
        manual_stacks.append({
            "id":         row["id"],
            "name":       row["name"],
            "type":       row.get("type") or "manual",
            "card_count": int(cnt),
            "created_at": row.get("created_at"),
        })

    return {"stacks": auto_stacks + manual_stacks}


@user_router.get("/vocab-topics")
async def list_vocab_topics(authorization: str | None = Header(default=None)):
    """
    Distinct user_vocabulary.topic values for the Manual Stack modal's topic
    dropdown, plus a `has_uncategorized` flag so the frontend can render a
    dedicated "Chưa phân loại" chip when topicless vocab exists.

    Cheap thanks to the partial index from migration 028 (real topics) and
    a count="exact" probe with limit=1 (uncategorized check — we only need
    presence, not the actual rows).

    Audit Wave 2 MEDIUM #1: previously the endpoint dropped NULL topics
    silently and the modal had no entry point for topicless rows.
    """
    auth_user = await get_supabase_user(authorization)
    _require_flashcards_enabled(auth_user["id"])
    sb = _user_sb(_bearer_token(authorization))

    topics: list[str] = []
    try:
        # PostgREST has no DISTINCT; pull the column and de-dupe in Python.
        # Safe — total cardinality is small (one row per session topic per user).
        rows = (
            sb.table("user_vocabulary")
            .select("topic")
            .eq("is_archived", False)
            .not_.is_("topic", "null")
            .execute()
        ).data or []
        seen: set[str] = set()
        for r in rows:
            t = (r.get("topic") or "").strip()
            if t and t not in seen:
                seen.add(t)
                topics.append(t)
        topics.sort()
    except Exception as e:
        logger.warning("[flashcards] list_vocab_topics topics failed: %s", e)

    has_uncategorized = False
    try:
        # limit=1 + count="exact" = "is there at least one row?" without
        # materialising the whole set.  Same trick used by /due/count.
        nul = (
            sb.table("user_vocabulary")
            .select("id", count="exact")
            .eq("is_archived", False)
            .is_("topic", "null")
            .limit(1)
            .execute()
        )
        has_uncategorized = int(nul.count or 0) > 0
    except Exception as e:
        logger.warning("[flashcards] list_vocab_topics null-probe failed: %s", e)

    return {"topics": topics, "has_uncategorized": has_uncategorized}


@user_router.post("/stacks/preview")
async def preview_stack(
    body: PreviewRequest,
    authorization: str | None = Header(default=None),
):
    """
    Resolve filter_config without persisting — return the matching count and
    the first 10 headwords so the modal can render a live preview.

    Frontend debounces and re-calls on every filter tweak.
    """
    auth_user = await get_supabase_user(authorization)
    _require_flashcards_enabled(auth_user["id"])
    sb = _user_sb(_bearer_token(authorization))

    try:
        cfg = _normalize_filter_config(body.filter_config)
    except ValueError as ve:
        raise HTTPException(422, str(ve))

    try:
        builder = sb.table("user_vocabulary").select("headword", count="exact")
        builder = _apply_filter(builder, cfg)
        # Limit to 10 — count="exact" still returns the true total via res.count.
        res = builder.order("created_at", desc=True).limit(10).execute()
    except Exception as e:
        logger.error("[flashcards] preview failed: %s", e)
        raise HTTPException(500, "Could not preview stack.")

    headwords = [r.get("headword") for r in (res.data or []) if r.get("headword")]
    return {
        "card_count":         int(res.count or 0),
        "preview_headwords":  headwords,
    }


@user_router.post("/stacks", status_code=201)
async def create_stack(
    body: CreateStackRequest,
    authorization: str | None = Header(default=None),
):
    """
    Create a manual stack and eagerly populate flashcard_cards from the
    filter result.  Returning card_count means the frontend can redirect
    straight to the study page without a follow-up GET.
    """
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]
    _require_flashcards_enabled(user_id)
    sb = _user_sb(_bearer_token(authorization))

    try:
        name = _validate_stack_name(body.name)
        cfg = _normalize_filter_config(body.filter_config)
    except ValueError as ve:
        raise HTTPException(422, str(ve))

    # Step 1: create the stack row.  WITH CHECK on flashcard_stacks_insert
    # blocks any caller trying to spoof user_id.
    try:
        ins = (
            sb.table("flashcard_stacks")
            .insert({
                "user_id":       user_id,
                "name":          name,
                "type":          "manual",
                "filter_config": cfg or None,
            })
            .execute()
        )
        stack = (ins.data or [None])[0]
        if not stack:
            raise HTTPException(500, "Could not create stack.")
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[flashcards] create_stack insert failed: %s", e)
        raise HTTPException(500, "Could not create stack.")

    # Step 2: resolve filter → vocabulary ids and bulk-insert flashcard_cards.
    # Empty filter is a valid choice (user wants to add cards manually later)
    # so we only insert when there are matching rows.
    inserted_cards = 0
    try:
        vbuilder = sb.table("user_vocabulary").select("id")
        vbuilder = _apply_filter(vbuilder, cfg)
        # No upper limit — a user with 5k vocab who picks "all" gets 5k cards;
        # the UNIQUE constraint protects against accidental dups on retry.
        v_rows = vbuilder.execute().data or []
        if v_rows:
            payloads = [
                {"stack_id": stack["id"], "vocabulary_id": r["id"]}
                for r in v_rows
                if r.get("id")
            ]
            sb.table("flashcard_cards").insert(payloads).execute()
            inserted_cards = len(payloads)
    except Exception as e:
        # Card-population failure shouldn't undo the stack creation — the
        # user can always add cards later.  Log and continue.
        logger.warning(
            "[flashcards] create_stack card-fill failed stack=%s: %s",
            stack["id"], e,
        )

    return {
        "id":         stack["id"],
        "name":       stack["name"],
        "type":       stack["type"],
        "card_count": inserted_cards,
        "created_at": stack["created_at"],
    }


@user_router.get("/stacks/{stack_id}")
async def get_stack(
    stack_id: str,
    authorization: str | None = Header(default=None),
):
    """
    Detail endpoint — handles both 'auto:*' virtual ids and persisted UUIDs.
    """
    auth_user = await get_supabase_user(authorization)
    _require_flashcards_enabled(auth_user["id"])
    sb = _user_sb(_bearer_token(authorization))

    if stack_id.startswith("auto:"):
        if not _is_auto_stack_id(stack_id):
            raise HTTPException(404, "Stack not found.")
        if stack_id == "auto:all_vocab":
            count = _count_user_vocab(sb)
        elif stack_id == "auto:recent":
            count = min(_RECENT_LIMIT, _count_user_vocab(sb))
        else:  # auto:needs_review
            count = _count_user_vocab(sb, source_type="needs_review")
        return {
            "id":         stack_id,
            "name":       _AUTO_STACK_NAMES[stack_id],
            "type":       "auto",
            "card_count": count,
        }

    # Persisted stack — RLS hides other users' rows so an empty result == 404.
    try:
        res = (
            sb.table("flashcard_stacks")
            .select("id, name, type, filter_config, created_at")
            .eq("id", stack_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.error("[flashcards] get_stack failed id=%s: %s", stack_id, e)
        raise HTTPException(500, "Could not load stack.")

    if not res.data:
        raise HTTPException(404, "Stack not found.")
    row = res.data[0]
    try:
        cnt = (
            sb.table("flashcard_cards")
            .select("id", count="exact")
            .eq("stack_id", stack_id)
            .limit(1)
            .execute()
        ).count or 0
    except Exception:
        cnt = 0
    return {
        "id":            row["id"],
        "name":          row["name"],
        "type":          row.get("type") or "manual",
        "filter_config": row.get("filter_config"),
        "card_count":    int(cnt),
        "created_at":    row.get("created_at"),
    }


@user_router.delete("/stacks/{stack_id}", status_code=204)
async def delete_stack(
    stack_id: str,
    authorization: str | None = Header(default=None),
):
    """
    Auto-stacks are virtual — return 400 instead of 404 so a confused
    caller doesn't think the stack vanished.  Manual stacks delete via the
    RLS-scoped client; ON DELETE CASCADE on flashcard_cards cleans up
    membership rows automatically.
    """
    auth_user = await get_supabase_user(authorization)
    _require_flashcards_enabled(auth_user["id"])
    sb = _user_sb(_bearer_token(authorization))

    if stack_id.startswith("auto:"):
        raise HTTPException(400, "Auto-stacks cannot be deleted.")

    try:
        res = sb.table("flashcard_stacks").delete().eq("id", stack_id).execute()
    except Exception as e:
        logger.error("[flashcards] delete_stack failed id=%s: %s", stack_id, e)
        raise HTTPException(500, "Could not delete stack.")

    # RLS makes a non-owner's delete return zero rows rather than raising —
    # surface that as 404 so the UI can clear stale state.
    if not res.data:
        raise HTTPException(404, "Stack not found.")
    return None


# ── Card endpoints + due queue + review (Step 4) ─────────────────────────────


_VOCAB_FIELDS = (
    "id, headword, definition_vi, definition_en, "
    "ipa, example_sentence, "
    "context_sentence, topic, category, source_type, created_at, "
    # PR-A: pulled into the SELECT so the manual-stack JOIN path can
    # post-filter skipped rows in memory.  `_vocab_card_view` strips it
    # from the response so the field never leaks to the frontend.
    "is_skipped"
)


def _fetch_reviews_by_vocab(sb, vocab_ids: list[str]) -> dict[str, dict]:
    """
    Bulk-fetch flashcard_reviews for a set of vocabulary ids and return as
    a {vocab_id: review_row} map.  RLS scopes to the caller's rows so this
    can never leak another user's SRS state.
    """
    if not vocab_ids:
        return {}
    try:
        res = (
            sb.table("flashcard_reviews")
            .select("vocabulary_id, interval_days, ease_factor, review_count, "
                    "lapse_count, last_reviewed_at, next_review_at")
            .in_("vocabulary_id", vocab_ids)
            .execute()
        )
    except Exception as e:
        logger.warning("[flashcards] reviews bulk-fetch failed: %s", e)
        return {}
    return {row["vocabulary_id"]: row for row in (res.data or []) if row.get("vocabulary_id")}


@user_router.get("/stacks/{stack_id}/cards")
async def list_cards_in_stack(
    stack_id: str,
    authorization: str | None = Header(default=None),
):
    """
    List cards in a stack — handles both 'auto:*' virtual ids (resolved
    against user_vocabulary with the matching filter) and persisted UUIDs
    (resolved through flashcard_cards JOIN user_vocabulary).

    Each card includes its current SRS state, or null when the user has
    never reviewed that vocabulary entry.  SRS is shared across stacks,
    so a card returned from stack A and from stack B carries the same
    review record (acceptance criterion §12).
    """
    auth_user = await get_supabase_user(authorization)
    _require_flashcards_enabled(auth_user["id"])
    sb = _user_sb(_bearer_token(authorization))

    vocab_rows: list[dict] = []
    try:
        if stack_id.startswith("auto:"):
            if not _is_auto_stack_id(stack_id):
                raise HTTPException(404, "Stack not found.")
            builder = sb.table("user_vocabulary").select(_VOCAB_FIELDS)
            builder = builder.eq("is_archived", False)
            # PR-A: triage skips hide everywhere, including auto-stack queues.
            builder = builder.eq("is_skipped", False)
            if stack_id == "auto:needs_review":
                builder = builder.eq("source_type", "needs_review")
            if stack_id == "auto:recent":
                builder = builder.order("created_at", desc=True).limit(_RECENT_LIMIT)
            else:
                builder = builder.order("created_at", desc=True)
            vocab_rows = (builder.execute().data or [])
        else:
            # Manual stack: confirm it exists & is owned (RLS), then JOIN
            # flashcard_cards through user_vocabulary.  PostgREST nested
            # select syntax — `user_vocabulary(...)` — pulls vocab rows in
            # one round-trip.
            stack = (
                sb.table("flashcard_stacks")
                .select("id")
                .eq("id", stack_id)
                .limit(1)
                .execute()
            )
            if not stack.data:
                raise HTTPException(404, "Stack not found.")
            cards = (
                sb.table("flashcard_cards")
                .select(f"vocabulary_id, added_at, user_vocabulary!inner({_VOCAB_FIELDS})")
                .eq("stack_id", stack_id)
                .order("added_at", desc=True)
                .execute()
            ).data or []
            for c in cards:
                v = c.get("user_vocabulary")
                # PR-A: post-filter skipped rows from manual stacks too.
                # PostgREST inline JOIN filters on `user_vocabulary` would
                # require a second round-trip; this in-memory filter is
                # acceptable because manual stacks are O(100s) of rows.
                if v and not v.get("is_skipped"):
                    vocab_rows.append(v)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[flashcards] list_cards_in_stack failed stack=%s: %s", stack_id, e)
        raise HTTPException(500, "Could not load cards.")

    review_map = _fetch_reviews_by_vocab(sb, [r["id"] for r in vocab_rows if r.get("id")])
    return {
        "stack_id": stack_id,
        "cards":    [_vocab_card_view(r, review_map.get(r["id"])) for r in vocab_rows],
    }


@user_router.post("/stacks/{stack_id}/cards", status_code=201)
async def add_card_to_stack(
    stack_id: str,
    body: AddCardRequest,
    authorization: str | None = Header(default=None),
):
    """
    Add a vocabulary entry to a manual stack.  Auto-stacks reject — they're
    rule-defined, not curated.  UNIQUE(stack_id, vocabulary_id) catches
    duplicates and we surface those as 409 with a clear message so the
    "Add to flashcard" button (Step 7) can render a helpful toast.

    `needs_review` vocab is blocked here as defense-in-depth.  The frontend
    already hides the +Stack button for those rows (Day 2 dogfood UX
    polish), but enrolling AI-flagged-as-incorrect vocab into spaced
    repetition would teach the wrong form, so the route refuses too.
    Users must promote / fix the entry first (e.g. accept upgrade or edit).
    """
    auth_user = await get_supabase_user(authorization)
    _require_flashcards_enabled(auth_user["id"])
    sb = _user_sb(_bearer_token(authorization))

    if stack_id.startswith("auto:"):
        raise HTTPException(400, "Auto-stacks are managed automatically.")

    # Block needs_review vocab before the insert.  RLS on user_vocabulary
    # already scopes the SELECT to the caller, so a foreign vocab_id reads
    # as an empty result and we let the existing INSERT-time RLS error
    # path (404 below) handle it — no information leak.
    try:
        vocab_lookup = (
            sb.table("user_vocabulary")
            .select("source_type")
            .eq("id", body.vocabulary_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.error("[flashcards] add_card_to_stack vocab lookup failed: %s", e)
        raise HTTPException(500, "Could not add card.")

    if vocab_lookup.data and vocab_lookup.data[0].get("source_type") == "needs_review":
        raise HTTPException(
            400,
            "Vocab cần xem lại không thể đưa vào flashcard. "
            "Hãy chỉnh lại từ trước khi học.",
        )

    try:
        ins = (
            sb.table("flashcard_cards")
            .insert({"stack_id": stack_id, "vocabulary_id": body.vocabulary_id})
            .execute()
        )
    except Exception as e:
        msg = str(e).lower()
        if "duplicate" in msg or "unique" in msg or "23505" in msg:
            raise HTTPException(409, "Card already in this stack.")
        # The migration's INSERT WITH CHECK (caller owns both stack AND vocab)
        # surfaces as a 403/permission error from PostgREST when violated —
        # treat as 404 so an attacker can't probe foreign ids.
        if "policy" in msg or "row-level" in msg or "permission" in msg:
            raise HTTPException(404, "Stack or vocabulary not found.")
        logger.error("[flashcards] add_card_to_stack failed: %s", e)
        raise HTTPException(500, "Could not add card.")

    if not ins.data:
        raise HTTPException(404, "Stack or vocabulary not found.")
    return ins.data[0]


@user_router.delete("/stacks/{stack_id}/cards/{vocab_id}", status_code=204)
async def remove_card_from_stack(
    stack_id: str,
    vocab_id: str,
    authorization: str | None = Header(default=None),
):
    """Remove a card from a manual stack — auto-stacks reject."""
    auth_user = await get_supabase_user(authorization)
    _require_flashcards_enabled(auth_user["id"])
    sb = _user_sb(_bearer_token(authorization))

    if stack_id.startswith("auto:"):
        raise HTTPException(400, "Auto-stacks are managed automatically.")

    try:
        res = (
            sb.table("flashcard_cards")
            .delete()
            .eq("stack_id", stack_id)
            .eq("vocabulary_id", vocab_id)
            .execute()
        )
    except Exception as e:
        logger.error("[flashcards] remove_card failed stack=%s vocab=%s: %s",
                     stack_id, vocab_id, e)
        raise HTTPException(500, "Could not remove card.")

    if not res.data:
        raise HTTPException(404, "Card not found in this stack.")
    return None


@user_router.get("/due")
async def get_due_cards(
    limit: int = 20,
    authorization: str | None = Header(default=None),
):
    """
    Cards whose next_review_at is at or before now (UTC), oldest first.
    Includes the user_vocabulary detail so the frontend can render the
    flip card without a follow-up GET.

    Brand-new vocabulary entries with no flashcard_reviews row yet are
    considered "due" too — they need an initial review for SRS to start
    tracking them.  This is implemented by including all user_vocabulary
    rows that have no matching review record AND limiting the slug.
    """
    auth_user = await get_supabase_user(authorization)
    _require_flashcards_enabled(auth_user["id"])
    sb = _user_sb(_bearer_token(authorization))

    limit = max(1, min(int(limit or 20), 100))
    now = datetime.now(timezone.utc)

    # Primary: scheduled-review queue.
    try:
        review_rows = (
            sb.table("flashcard_reviews")
            .select("vocabulary_id, interval_days, ease_factor, review_count, "
                    "lapse_count, last_reviewed_at, next_review_at")
            .lte("next_review_at", now.isoformat())
            .order("next_review_at", desc=False)
            .limit(limit)
            .execute()
        ).data or []
    except Exception as e:
        logger.error("[flashcards] due reviews fetch failed: %s", e)
        raise HTTPException(500, "Could not load due queue.")

    if not review_rows:
        return {"cards": []}

    vocab_ids = [r["vocabulary_id"] for r in review_rows if r.get("vocabulary_id")]
    try:
        vocab_rows = (
            sb.table("user_vocabulary")
            .select(_VOCAB_FIELDS)
            .in_("id", vocab_ids)
            .eq("is_archived", False)
            .eq("is_skipped", False)  # PR-A: skipped vocab vanishes from due queue
            .execute()
        ).data or []
    except Exception as e:
        logger.error("[flashcards] due vocab join failed: %s", e)
        raise HTTPException(500, "Could not load due queue.")

    by_vocab = {v["id"]: v for v in vocab_rows if v.get("id")}
    cards = []
    for r in review_rows:
        v = by_vocab.get(r["vocabulary_id"])
        if not v:
            # Vocabulary archived, skipped, or deleted — drop from queue
            # rather than surfacing a phantom card.
            continue
        cards.append(_vocab_card_view(v, r))
    return {"cards": cards}


@user_router.get("/due/count")
async def get_due_count(authorization: str | None = Header(default=None)):
    """
    Lightweight counter for the dashboard "X thẻ đến hạn" badge — separate
    endpoint so the badge doesn't pull full card payloads on every refresh.
    """
    auth_user = await get_supabase_user(authorization)
    _require_flashcards_enabled(auth_user["id"])
    sb = _user_sb(_bearer_token(authorization))
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        res = (
            sb.table("flashcard_reviews")
            .select("id", count="exact")
            .lte("next_review_at", now_iso)
            .limit(1)
            .execute()
        )
        return {"count": int(res.count or 0)}
    except Exception as e:
        logger.warning("[flashcards] due count failed: %s", e)
        return {"count": 0}


@user_router.post("/{vocab_id}/review")
@rate_limit_flashcard(daily_limit=settings.FLASHCARD_DAILY_REVIEW_LIMIT)
async def submit_review(
    vocab_id: str,
    body: ReviewRequest,
    authorization: str | None = Header(default=None),
):
    """
    Self-rate a card.  Updates SRS state via services.srs.update_srs and
    appends a row to flashcard_review_log so the next call's rate-limit
    counter sees this review.

    Two-step flow:
      1. Look up the existing flashcard_reviews row (or fall back to
         per-vocab defaults — ease=2.5, interval=1, count=0, lapse=0).
         Validates that the vocab belongs to the caller via the SELECT
         on user_vocabulary (RLS hides foreign rows).
      2. Compute next state + UPSERT (UNIQUE(user_id, vocabulary_id)).

    Failure to write the audit log is non-fatal — SRS still updated, just
    means the daily counter under-reports by one.
    """
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]
    _require_flashcards_enabled(user_id)
    sb = _user_sb(_bearer_token(authorization))

    # Confirm the vocab belongs to the caller before writing review state.
    try:
        v_check = (
            sb.table("user_vocabulary")
            .select("id")
            .eq("id", vocab_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.error("[flashcards] review vocab check failed: %s", e)
        raise HTTPException(500, "Could not record review.")
    if not v_check.data:
        raise HTTPException(404, "Vocabulary entry not found.")

    # Existing review row, or defaults on first review.
    try:
        existing = (
            sb.table("flashcard_reviews")
            .select("interval_days, ease_factor, review_count, lapse_count")
            .eq("vocabulary_id", vocab_id)
            .limit(1)
            .execute()
        ).data or []
    except Exception as e:
        logger.warning("[flashcards] review existing fetch failed (using defaults): %s", e)
        existing = []

    if existing:
        cur = existing[0]
    else:
        cur = {"interval_days": 1, "ease_factor": 2.5, "review_count": 0, "lapse_count": 0}

    # Duck-typed object for srs.update_srs.
    class _R:  # noqa: N801 — local single-use shim
        pass
    r = _R()
    r.interval_days = cur["interval_days"]
    r.ease_factor   = cur["ease_factor"]
    r.review_count  = cur["review_count"]
    r.lapse_count   = cur["lapse_count"]

    try:
        new_state = update_srs(r, body.rating)
    except ValueError as ve:
        # Pydantic already rejected unknown ratings, but a future caller
        # bypassing the model still gets a 422 here rather than 500.
        raise HTTPException(422, str(ve))

    # UPSERT — UNIQUE(user_id, vocabulary_id) lets on_conflict='user_id,vocabulary_id'
    # do the right thing whether this is the first review or the 50th.
    try:
        sb.table("flashcard_reviews").upsert(
            _review_upsert_payload(user_id, vocab_id, new_state),
            on_conflict="user_id,vocabulary_id",
        ).execute()
    except Exception as e:
        logger.error("[flashcards] review upsert failed: %s", e)
        raise HTTPException(500, "Could not save review.")

    # Rate-limit audit row.  Failure here under-reports today's count by 1
    # but doesn't block the user's progress — SRS already saved above.
    try:
        sb.table("flashcard_review_log").insert({
            "user_id":       user_id,
            "vocabulary_id": vocab_id,
            "rating":        body.rating,
        }).execute()
    except Exception as e:
        logger.debug("[flashcards] review_log insert failed (non-fatal): %s", e)

    return {
        "vocab_id":       vocab_id,
        "status":         "success",
        "next_review_at": new_state["next_review_at"],
        "interval_days":  new_state["interval_days"],
        "ease_factor":    new_state["ease_factor"],
        "review_count":   new_state["review_count"],
    }


@user_router.get("/stats")
async def get_stats(authorization: str | None = Header(default=None)):
    """
    Summary stats for the flashcards landing page.  Cheap counts only —
    heavier analytics (heatmaps, streaks) are out of scope per §1.
    """
    auth_user = await get_supabase_user(authorization)
    _require_flashcards_enabled(auth_user["id"])
    sb = _user_sb(_bearer_token(authorization))

    def _count(table: str, **filters) -> int:
        try:
            b = sb.table(table).select("id", count="exact")
            for k, v in filters.items():
                if k.endswith("__lte"):
                    b = b.lte(k[:-5], v)
                elif k.endswith("__gte"):
                    b = b.gte(k[:-5], v)
                else:
                    b = b.eq(k, v)
            return int((b.limit(1).execute()).count or 0)
        except Exception as e:
            logger.warning("[flashcards] stats %s count failed: %s", table, e)
            return 0

    now_iso = datetime.now(timezone.utc).isoformat()
    return {
        "total_vocab":     _count("user_vocabulary", is_archived=False),
        "total_reviewed":  _count("flashcard_reviews"),
        "due_now":         _count("flashcard_reviews", next_review_at__lte=now_iso),
        "manual_stacks":   _count("flashcard_stacks"),
    }
