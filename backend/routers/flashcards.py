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
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from supabase import create_client

from config import settings
from routers.auth import get_supabase_user
from services.feature_flags import is_flashcard_enabled

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


def _apply_filter(builder, filter_config: dict):
    """
    Apply a normalized filter_config to a supabase-py query builder against
    user_vocabulary.  Pulled out so POST /preview, POST / (create), and
    GET /stacks/{auto-id}/cards (step 4) share one resolver.

    Always restricts to NOT is_archived so archived rows never bleed into a
    flashcard stack.
    """
    builder = builder.eq("is_archived", False)
    if "topics" in filter_config:
        builder = builder.in_("topic", filter_config["topics"])
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
