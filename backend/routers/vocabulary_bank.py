"""
routers/vocabulary_bank.py — Phase B: Personal Vocab Bank API

All endpoints require Auth (JWT Bearer).
Feature flag check: VOCAB_BANK_FEATURE_FLAG_ENABLED env var + users.feature_flags.vocab_enabled.
Prefix: /api/vocabulary/bank
"""

import csv
import io
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict
from supabase import create_client

from config import settings
from routers.auth import get_supabase_user
from services.analytics import fire_event
from services.feature_flags import is_vocab_bank_enabled
from services.mastery import (
    MASTERED_MIN_INTERVAL_DAYS,
    MASTERED_MIN_REVIEW_COUNT,
    derive_mastery_status,
    sync_mastery_column,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/vocabulary/bank", tags=["vocabulary-bank"])


# ── User-scoped Supabase client (enforces RLS) ────────────────────────────────

def _user_sb(token: str):
    """Return a Supabase client scoped to the user's JWT so RLS is enforced."""
    client = create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)
    client.postgrest.auth(token)
    return client


def _token_from_header(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(401, "Missing Authorization header")
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(401, "Invalid Authorization header")
    return parts[1]


# ── Feature flag check ────────────────────────────────────────────────────────

def _vocab_bank_enabled(user_id: str) -> bool:
    return is_vocab_bank_enabled(user_id, settings.VOCAB_BANK_FEATURE_FLAG_ENABLED)


async def _require_auth(authorization: str | None) -> dict:
    user = await get_supabase_user(authorization)
    return user


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class VocabManualAddRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    headword: str
    context_sentence: str | None = None
    definition_vi: str | None = None
    category: str | None = None


class VocabUpdateStatusRequest(BaseModel):
    """Sprint 10.2 — PATCH /{vocab_id} body changed from a status enum
    to a boolean toggle. The handler writes to flashcard_reviews (SRS
    state), not to the deprecated user_vocabulary.mastery_status
    column. Naming the field `mastered` (verb-state, not noun-status)
    nudges callers toward thinking of it as an SRS write."""

    model_config = ConfigDict(extra="ignore")

    mastered: bool


class VocabFPReportRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    reason: str | None = None


# ── Analytics helper ──────────────────────────────────────────────────────────

def _fire_event(event_name: str, event_data: dict, user_id: str) -> None:
    fire_event(event_name, event_data, user_id)


# ── Sprint 10.2 — Mastery-SRS derivation helpers ──────────────────────────────


def _fetch_srs_lookup(sb, user_id: str) -> dict:
    """Return a {vocabulary_id: srs_row} dict for all flashcard_reviews
    rows owned by `user_id`. One round-trip; avoids N+1 against the
    bank list.

    Caller passes the user-scoped Supabase client so RLS gates the
    query — a malicious caller can't trick us into leaking another
    user's review state.
    """
    result = (
        sb.table("flashcard_reviews")
        .select(
            "vocabulary_id, interval_days, lapse_count, review_count, "
            "ease_factor, next_review_at, last_reviewed_at",
        )
        .eq("user_id", user_id)
        .execute()
    )
    return {row["vocabulary_id"]: row for row in (result.data or [])}


def _apply_derived_mastery(rows: list[dict], srs_lookup: dict) -> list[dict]:
    """Mutate each row's `mastery_status` to the derived value. The
    column on disk may be stale during the Sprint 10.2 deprecation
    window — the response shape always reflects current SRS state."""
    for row in rows:
        srs = srs_lookup.get(row.get("id"))
        row["mastery_status"] = derive_mastery_status(srs)
    return rows


# ── GET / — List ──────────────────────────────────────────────────────────────

@router.get("/")
async def list_vocab(
    status: str | None = None,
    source_type: str | None = None,
    authorization: str | None = Header(default=None),
):
    user = await _require_auth(authorization)
    user_id = user["id"]

    if not _vocab_bank_enabled(user_id):
        raise HTTPException(403, "Vocab Bank feature is not enabled for this account")

    token = _token_from_header(authorization)
    sb = _user_sb(token)
    query = (
        sb.table("user_vocabulary")
        .select("*")
        .eq("user_id", user_id)
        .eq("is_archived", False)
        .eq("is_skipped", False)  # PR-A: triage skips hide everywhere
        .order("created_at", desc=True)
    )

    # Sprint 10.2 — `status` filter is honoured AFTER deriving mastery
    # from SRS (the column on disk may be stale during the deprecation
    # window). Filtering at the DB level on a deprecated column would
    # silently drop rows whose SRS state disagrees with the column.
    if source_type:
        query = query.eq("source_type", source_type)
    else:
        # Sprint 10.1.5 — default-exclude needs_review from the main bank.
        # The dedicated GET /needs-review endpoint surfaces those items
        # on a separate "Needs Review" tab. When the caller passes an
        # explicit source_type the filter is honoured (admins / tests
        # can still inspect needs_review rows via ?source_type=needs_review).
        query = query.neq("source_type", "needs_review")

    result = query.execute()
    rows = result.data or []

    # Sprint 10.2 — derive mastery from flashcard_reviews. Single
    # round-trip lookup keyed by vocabulary_id.
    srs_lookup = _fetch_srs_lookup(sb, user_id)
    rows = _apply_derived_mastery(rows, srs_lookup)

    if status:
        rows = [r for r in rows if r.get("mastery_status") == status]

    _fire_event("vocab_bank_viewed", {"source": "api"}, user_id)
    return rows


# ── GET /needs-review — Sprint 10.1.5 dedicated Needs Review surface ──────────

# Sprint 10.1.5 — separates "items the learner used correctly" (main vocab
# bank) from "items flagged by Claude as misused / non-standard" (this
# endpoint). The two surfaces serve different pedagogical purposes:
# main bank rewards correct usage and seeds flashcards; Needs Review is
# a learning-from-mistakes triage list with the AI's suggestion attached.
#
# Sprint 6.0 archived needs_review entirely; Sprint 10.1.5 reverses that
# archival via re-enabling persistence in routers/grading.py and routing
# the items here instead of letting them pollute the main bank.
@router.get("/needs-review")
async def list_needs_review(authorization: str | None = Header(default=None)):
    user = await _require_auth(authorization)
    user_id = user["id"]

    if not _vocab_bank_enabled(user_id):
        raise HTTPException(403, "Vocab Bank feature is not enabled for this account")

    token = _token_from_header(authorization)
    sb = _user_sb(token)
    result = (
        sb.table("user_vocabulary")
        .select("*")
        .eq("user_id", user_id)
        .eq("source_type", "needs_review")
        .eq("is_archived", False)
        .eq("is_skipped", False)
        .order("created_at", desc=True)
        .execute()
    )
    rows = result.data or []

    # Sprint 10.2 — derive mastery_status for parity with the main bank.
    # Needs-review items rarely have flashcard_reviews rows in practice
    # (they're triage candidates, not yet reviewed), but the API shape
    # must stay consistent so the frontend can render without surface
    # branching.
    srs_lookup = _fetch_srs_lookup(sb, user_id)
    rows = _apply_derived_mastery(rows, srs_lookup)

    _fire_event("vocab_needs_review_viewed", {"source": "api"}, user_id)
    return rows


# ── POST /{vocab_id}/restore — Sprint 10.1.5 un-archive a soft-deleted row ────

# Soft-delete contract: DELETE /{vocab_id} sets is_archived=true; this
# endpoint flips it back to false. Owner-only; no source_type gate (a
# user may want to restore something they archived accidentally,
# regardless of which surface it came from).
@router.post("/{vocab_id}/restore")
async def restore_vocab(
    vocab_id: str,
    authorization: str | None = Header(default=None),
):
    user = await _require_auth(authorization)
    user_id = user["id"]

    if not _vocab_bank_enabled(user_id):
        raise HTTPException(403, "Vocab Bank feature is not enabled for this account")

    token = _token_from_header(authorization)
    sb = _user_sb(token)

    existing = (
        sb.table("user_vocabulary")
        .select("id, is_archived")
        .eq("id", vocab_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )

    if not existing.data:
        raise HTTPException(404, "Vocab entry not found")

    if not existing.data[0].get("is_archived"):
        # Idempotent: restoring an already-alive row is a no-op success.
        return {"ok": True, "vocab_id": vocab_id, "already_alive": True}

    sb.table("user_vocabulary").update(
        {"is_archived": False}
    ).eq("id", vocab_id).execute()

    _fire_event("vocab_restored", {"vocab_id": vocab_id}, user_id)
    return {"ok": True, "vocab_id": vocab_id}


# ── GET /stats ────────────────────────────────────────────────────────────────

@router.get("/stats")
async def get_vocab_stats(authorization: str | None = Header(default=None)):
    user = await _require_auth(authorization)
    user_id = user["id"]

    if not _vocab_bank_enabled(user_id):
        raise HTTPException(403, "Vocab Bank feature is not enabled for this account")

    # Sprint 10.2 — counters must reflect SRS-derived mastery, not the
    # deprecated column. Same pattern as the list endpoint: one query
    # for vocab rows, one for SRS rows, derive in Python. Keeps the
    # stats card on home.html consistent with what the bank list shows.
    token = _token_from_header(authorization)
    sb = _user_sb(token)
    rows = (
        sb.table("user_vocabulary")
        .select("id")
        .eq("user_id", user_id)
        .eq("is_archived", False)
        .eq("is_skipped", False)  # PR-A: skipped rows don't count anywhere
        .execute()
    )
    vocab_rows = rows.data or []
    srs_lookup = _fetch_srs_lookup(sb, user_id)

    total = len(vocab_rows)
    mastered = sum(
        1 for r in vocab_rows
        if derive_mastery_status(srs_lookup.get(r["id"])) == "mastered"
    )
    return {"total": total, "learning": total - mastered, "mastered": mastered}


# ── GET /recent — Items from a specific session ───────────────────────────────

@router.get("/recent")
async def get_recent_vocab(
    session_id: str | None = None,
    authorization: str | None = Header(default=None),
):
    """Return vocab items added from a specific session (for toast notification)."""
    user = await _require_auth(authorization)
    user_id = user["id"]

    if not _vocab_bank_enabled(user_id):
        raise HTTPException(403, "Vocab Bank feature is not enabled for this account")

    if not session_id:
        raise HTTPException(422, "session_id query parameter is required")

    token = _token_from_header(authorization)
    sb = _user_sb(token)
    result = (
        sb.table("user_vocabulary")
        .select("id, headword, source_type, mastery_status")
        .eq("user_id", user_id)
        .eq("session_id", session_id)
        .eq("is_archived", False)
        .eq("is_skipped", False)  # PR-A: skipped vocab hidden from session lookups too
        .order("created_at", desc=False)
        .execute()
    )

    # Sprint 10.2 — toast notification shows mastery, derive for parity.
    # Recent-from-session items rarely have SRS rows yet (capture
    # happens before any review), so most rows derive to 'learning';
    # still cheaper + simpler than branching the response shape.
    rows = result.data or []
    srs_lookup = _fetch_srs_lookup(sb, user_id)
    return _apply_derived_mastery(rows, srs_lookup)


# ── GET /recent-updates — Aggregate of recent vocab events ───────────────────
#
# Powers the dashboard "Cập nhật từ vựng gần đây" widget.  Returns recent
# additions grouped by session so a single practice extraction shows up as
# one event with N words instead of N separate cards.  Uncategorized rows
# (manual adds, legacy rows without session_id) are bucketed together.
#
# Registered BEFORE `/{vocab_id}` for the same reason as `/export` — FastAPI
# matches routes in registration order and the path param would otherwise
# swallow the literal path.


@router.get("/recent-updates")
async def get_recent_vocab_updates(
    limit: int = Query(10, ge=1, le=50),
    authorization: str | None = Header(default=None),
):
    """Recent vocab events grouped by session for the dashboard widget."""
    user = await _require_auth(authorization)
    user_id = user["id"]

    if not _vocab_bank_enabled(user_id):
        raise HTTPException(403, "Vocab Bank feature is not enabled for this account")

    token = _token_from_header(authorization)
    # Pull more rows than the event limit so multi-session days still produce
    # `limit` distinct events after grouping.  RLS scopes to caller via JWT.
    fetch_n = max(limit * 5, 50)
    result = (
        _user_sb(token).table("user_vocabulary")
        .select("id, headword, source_type, session_id, created_at")
        .eq("user_id", user_id)
        .eq("is_archived", False)
        .eq("is_skipped", False)  # PR-A: skipped rows don't appear in dashboard widget
        .order("created_at", desc=True)
        .limit(fetch_n)
        .execute()
    )
    rows = result.data or []

    # Group by session_id; rows without a session collapse into a single
    # "manual" bucket so the widget doesn't render one event per loose row.
    groups: dict[str, list[dict]] = {}
    for row in rows:
        key = row.get("session_id") or "__manual__"
        groups.setdefault(key, []).append(row)

    events: list[dict] = []
    for key, group in groups.items():
        events.append({
            "type": "extraction",
            "session_id": None if key == "__manual__" else key,
            "vocab_count": len(group),
            "vocab_preview": [v.get("headword") for v in group[:3] if v.get("headword")],
            "timestamp": max(v.get("created_at") for v in group if v.get("created_at")),
        })

    events.sort(key=lambda e: e["timestamp"] or "", reverse=True)
    return {"events": events[:limit]}


# ── GET /export — User-initiated full backup as CSV or JSON ───────────────────
#
# Phase 2.5 — UX self-service export.  Returns *every* vocab row owned by the
# caller, including archived rows (a backup should be lossless).  RLS is
# enforced through `_user_sb(token)`.
#
# IMPORTANT: this route is registered BEFORE `/{vocab_id}` on purpose — FastAPI
# matches in registration order and `/{vocab_id}` would happily swallow
# `/export` as a fake UUID, dispatching it to the detail handler instead.

_EXPORT_COLUMNS = (
    "headword",
    "definition_vi",
    "definition_en",
    "ipa",
    "example_sentence",
    "context_sentence",
    "category",
    "topic",
    "source_type",
    "is_archived",
    "created_at",
)


def _export_filename(fmt: str) -> str:
    return f"vocab_export_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M')}.{fmt}"


def _rows_to_csv_text(rows: list[dict]) -> str:
    """Serialize rows to a UTF-8 CSV string with a leading BOM.

    The BOM gets Excel to render Vietnamese diacritics correctly when the
    user double-clicks the file.  Without it, Excel reads the bytes as
    Windows-1252 and mangles every đ/ô/ư.
    """
    buf = io.StringIO()
    buf.write("\ufeff")  # UTF-8 BOM for Excel
    writer = csv.DictWriter(buf, fieldnames=_EXPORT_COLUMNS, quoting=csv.QUOTE_ALL)
    writer.writeheader()
    for row in rows:
        clean = {k: ("" if row.get(k) is None else row.get(k)) for k in _EXPORT_COLUMNS}
        writer.writerow(clean)
    return buf.getvalue()


@router.get("/export")
async def export_user_vocabulary(
    format: str = Query("csv", pattern="^(csv|json)$"),
    authorization: str | None = Header(default=None),
):
    """Download the caller's full vocab bank as CSV (default) or JSON.

    Includes archived rows on purpose — a backup should be lossless on the
    "is this entry valid" axis.  Skipped rows (PR-A migration 030) ARE
    excluded though: skipping is a forward-looking "I don't want to learn
    this" decision, and the user's stated mental model of export is "what
    I'm currently learning", not "everything I've ever seen".  Same
    feature-flag gate as every other vocab-bank endpoint.
    """
    auth_user = await _require_auth(authorization)
    user_id = auth_user["id"]

    if not _vocab_bank_enabled(user_id):
        raise HTTPException(403, "Vocab Bank feature is not enabled for this account")

    token = _token_from_header(authorization)

    try:
        result = (
            _user_sb(token)
            .table("user_vocabulary")
            .select(",".join(_EXPORT_COLUMNS))
            .eq("is_skipped", False)  # PR-A: skipped rows excluded from export
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as exc:
        logger.error("[vocab/export] query failed for user=%s: %s", user_id, exc)
        raise HTTPException(500, f"Export query failed: {exc}")

    rows = result.data or []
    _fire_event("vocab_exported", {"format": format, "count": len(rows)}, user_id)

    if format == "json":
        payload = {
            "exported_at":  datetime.now(timezone.utc).isoformat(),
            "total_count":  len(rows),
            "vocabulary":   rows,
        }
        return JSONResponse(
            content=payload,
            headers={
                "Content-Disposition": f'attachment; filename="{_export_filename("json")}"',
            },
        )

    csv_text = _rows_to_csv_text(rows)
    return StreamingResponse(
        iter([csv_text]),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{_export_filename("csv")}"',
        },
    )


# ── GET /{id} — Detail ────────────────────────────────────────────────────────

@router.get("/{vocab_id}")
async def get_vocab_detail(
    vocab_id: str,
    authorization: str | None = Header(default=None),
):
    user = await _require_auth(authorization)
    user_id = user["id"]

    if not _vocab_bank_enabled(user_id):
        raise HTTPException(403, "Vocab Bank feature is not enabled for this account")

    token = _token_from_header(authorization)
    sb = _user_sb(token)
    row = (
        sb.table("user_vocabulary")
        .select("*")
        .eq("id", vocab_id)
        .eq("user_id", user_id)
        .eq("is_skipped", False)  # PR-A: skipped rows 404 just like archived
        .limit(1)
        .execute()
    )

    if not row.data:
        raise HTTPException(404, "Vocab entry not found")

    # Sprint 10.2 — derive mastery from SRS for detail-page parity with
    # the list endpoint. One extra round-trip on the detail path is
    # acceptable (single-row latency budget is loose).
    srs_lookup = _fetch_srs_lookup(sb, user_id)
    detail = _apply_derived_mastery([row.data[0]], srs_lookup)[0]

    _fire_event("vocab_bank_entry_clicked", {"vocab_id": vocab_id, "status": detail.get("mastery_status")}, user_id)
    return detail


# ── POST / — Manual Add ───────────────────────────────────────────────────────

@router.post("/", status_code=201)
async def add_vocab_manual(
    body: VocabManualAddRequest,
    authorization: str | None = Header(default=None),
):
    user = await _require_auth(authorization)
    user_id = user["id"]

    if not _vocab_bank_enabled(user_id):
        raise HTTPException(403, "Vocab Bank feature is not enabled for this account")

    if not body.headword.strip():
        raise HTTPException(422, "headword is required")

    headword = body.headword.strip()

    # Sprint 10.1 — compute lemma + POS at write time so the manual-add
    # path stays consistent with the auto-capture path (both populate
    # surface_form / lemma / pos / lemma_version on the row). Fail-soft:
    # spaCy load failure leaves the lemma columns NULL and the backfill
    # script will retry. The DB UNIQUE constraint on lower(headword) is
    # the existing dedup safety net; lemma-equality dedup is a separate
    # Sprint 10.6 follow-up.
    try:
        from services.lemmatizer import lemmatize, lemma_version
        new_lemma, new_pos = lemmatize(headword)
        new_lemma_version = lemma_version()
    except Exception:
        new_lemma, new_pos, new_lemma_version = None, None, None

    row = {
        "user_id":         user_id,
        "headword":        headword,
        "surface_form":    headword,
        "lemma":           new_lemma,
        "pos":             new_pos,
        "lemma_version":   new_lemma_version,
        "context_sentence": body.context_sentence,
        "definition_vi":   body.definition_vi,
        "category":        body.category,
        "source_type":     "manual",
        "mastery_status":  "learning",
        "is_archived":     False,
    }

    token = _token_from_header(authorization)
    try:
        result = _user_sb(token).table("user_vocabulary").insert(row).execute()
    except Exception as e:
        err = str(e)
        if "unique" in err.lower() or "duplicate" in err.lower():
            raise HTTPException(409, f"'{body.headword}' is already in your vocab bank")
        raise HTTPException(500, f"Failed to save vocab entry: {e}")

    return result.data[0] if result.data else row


# ── PATCH /{id} — Sprint 10.2: write SRS, not user_vocabulary column ─────────

# Pre-10.2: this handler wrote `mastery_status` directly to
# user_vocabulary. Sprint 10.2 makes flashcard_reviews the single
# source of truth, so the handler now upserts an SRS row that — when
# fed back through derive_mastery_status() — yields the requested
# state. The frontend's "Đánh dấu đã thuộc" button hits this path; the
# SM-2 review loop (Sprint 10.3+) will hit POST /api/flashcards/...
# directly. Both ultimately mutate flashcard_reviews; no other code
# path should write to user_vocabulary.mastery_status after 10.2.
#
# Mastered upsert recipe (Andy Q1 lock):
#   interval_days = 21 (exactly meets the threshold)
#   lapse_count   = 0  (any prior lapse cleared — Mark as known is
#                       a user-attested override)
#   review_count  = max(existing, 3)  (preserve real history if
#                       higher; otherwise bump to threshold)
#   ease_factor   = max(existing, 2.5)  (default SM-2)
#   next_review_at = now + 21 days
#   last_reviewed_at = now
#
# Unmark recipe:
#   interval_days = 1
#   lapse_count   = 0  (we DON'T fabricate a lapse — un-marking is a
#                       triage gesture, not a forgetting event)
#   review_count  = max(existing, 0)  (preserve)
#   ease_factor   = unchanged
#   next_review_at = now
#   last_reviewed_at = unchanged (we don't fake a review)
@router.patch("/{vocab_id}")
async def update_vocab_status(
    vocab_id: str,
    body: VocabUpdateStatusRequest,
    authorization: str | None = Header(default=None),
):
    user = await _require_auth(authorization)
    user_id = user["id"]

    if not _vocab_bank_enabled(user_id):
        raise HTTPException(403, "Vocab Bank feature is not enabled for this account")

    token = _token_from_header(authorization)
    sb = _user_sb(token)

    # Ownership gate: confirm the vocab row exists and belongs to the
    # caller (RLS would also block, but a 404 is clearer than an
    # empty-update silent-success).
    existing_vocab = (
        sb.table("user_vocabulary")
        .select("id")
        .eq("id", vocab_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not existing_vocab.data:
        raise HTTPException(404, "Vocab entry not found")

    existing_srs_lookup = _fetch_srs_lookup(sb, user_id)
    existing_srs = existing_srs_lookup.get(vocab_id)
    mastery_before = derive_mastery_status(existing_srs)

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    if body.mastered:
        # Bump to mastered threshold.
        days_ahead = MASTERED_MIN_INTERVAL_DAYS
        next_review = (now + timedelta(days=days_ahead)).isoformat()
        existing_reviews = (existing_srs or {}).get("review_count") or 0
        existing_ease = (existing_srs or {}).get("ease_factor") or 2.5
        upsert_row = {
            "user_id":          user_id,
            "vocabulary_id":    vocab_id,
            "interval_days":    days_ahead,
            "lapse_count":      0,
            "review_count":     max(existing_reviews, MASTERED_MIN_REVIEW_COUNT),
            "ease_factor":      max(existing_ease, 2.5),
            "next_review_at":   next_review,
            "last_reviewed_at": now_iso,
            "updated_at":       now_iso,
        }
    else:
        # Demote to learning. Preserve last_reviewed_at + ease_factor
        # (we are NOT fabricating a forgetting event).
        existing_reviews = (existing_srs or {}).get("review_count") or 0
        existing_ease = (existing_srs or {}).get("ease_factor") or 2.5
        existing_last_review = (existing_srs or {}).get("last_reviewed_at")
        upsert_row = {
            "user_id":          user_id,
            "vocabulary_id":    vocab_id,
            "interval_days":    1,
            "lapse_count":      0,
            "review_count":     max(existing_reviews, 0),
            "ease_factor":      existing_ease,
            "next_review_at":   now_iso,
            "last_reviewed_at": existing_last_review,
            "updated_at":       now_iso,
        }

    try:
        sb.table("flashcard_reviews").upsert(
            upsert_row,
            on_conflict="user_id,vocabulary_id",
        ).execute()
    except Exception as e:
        logger.error("[vocab_bank PATCH] flashcard_reviews upsert failed for %s: %s", vocab_id, e)
        raise HTTPException(500, f"Failed to update review state: {e}")

    # Sprint 10.2.1-hotfix → Sprint 10.3 — sync the deprecated column
    # via the shared helper. Same fail-soft contract as before
    # (logged WARN on failure; backfill_mastery reconciles); now
    # shared with routers/exercises.py D1 attempt handler so the
    # sync rule lives in one place. See services/mastery.py for the
    # rationale on keeping the column in sync during deprecation.
    mastery_after = sync_mastery_column(sb, vocab_id, upsert_row)

    _fire_event("vocab_bank_entry_reviewed", {
        "vocab_id":       vocab_id,
        "mastered":       body.mastered,
        "mastery_before": mastery_before,
        "mastery_after":  mastery_after,
    }, user_id)

    return {"ok": True, "mastery_status": mastery_after}


# ── DELETE /{id} — Archive ────────────────────────────────────────────────────

@router.delete("/{vocab_id}")
async def archive_vocab(
    vocab_id: str,
    authorization: str | None = Header(default=None),
):
    user = await _require_auth(authorization)
    user_id = user["id"]

    if not _vocab_bank_enabled(user_id):
        raise HTTPException(403, "Vocab Bank feature is not enabled for this account")

    token = _token_from_header(authorization)
    sb = _user_sb(token)

    existing = (
        sb.table("user_vocabulary")
        .select("id")
        .eq("id", vocab_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )

    if not existing.data:
        raise HTTPException(404, "Vocab entry not found")

    sb.table("user_vocabulary").update(
        {"is_archived": True}
    ).eq("id", vocab_id).execute()

    return {"ok": True}


# ── POST /{id}/accept — Promote upgrade suggestion + add to default stack ──
#
# Day 2 dogfood: users didn't realise that `upgrade_suggested` rows are
# already in their bank — they read "gợi ý" as a separate proposal list and
# expected an explicit opt-in step.  This endpoint flips source_type from
# `upgrade_suggested` → `manual`, which is the cheapest signal we can give
# the UI ("this is mine now, not just a suggestion") without inventing a
# new column.  Idempotent: calling on a row that's already `manual` is a
# no-op success.
#
# PR #24 (post-#23 polish): the original report asked for a single
# gesture that both promotes AND enrolls the word in flashcards.  We
# auto-create a manual stack named "Từ vựng đã chấp nhận" the first
# time, then reuse it for every subsequent accept.  Stack/card writes
# are best-effort: a failure there does not reverse the promote, and
# the response carries `flashcard_added` so the UI can word the toast
# accurately.

DEFAULT_ACCEPT_STACK_NAME = "Từ vựng đã chấp nhận"


def _ensure_default_accept_stack(sb, user_id: str) -> str | None:
    """Find-or-create the default accept stack.  Returns its UUID, or None
    if the lookup/create fails so the caller can fall back to promote-only.

    Stack name is unique-per-user by convention (not enforced at DB level
    — a duplicate name would just be ignored on the next call), and short
    enough to fit the VARCHAR(50) + length(trim(...)) >= 3 constraints in
    migration 025.
    """
    try:
        existing = (
            sb.table("flashcard_stacks")
            .select("id")
            .eq("user_id", user_id)
            .eq("name", DEFAULT_ACCEPT_STACK_NAME)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.warning("[accept] default-stack lookup failed: %s", exc)
        return None

    if existing.data:
        return existing.data[0].get("id")

    try:
        created = (
            sb.table("flashcard_stacks")
            .insert({
                "user_id": user_id,
                "name":    DEFAULT_ACCEPT_STACK_NAME,
                "type":    "manual",
            })
            .execute()
        )
    except Exception as exc:
        logger.warning("[accept] default-stack create failed: %s", exc)
        return None

    return (created.data or [{}])[0].get("id")


def _add_card_if_absent(sb, stack_id: str, vocab_id: str) -> bool:
    """Insert (stack_id, vocab_id) into flashcard_cards unless already there.
    Returns True on success (already-present is also success — idempotent),
    False on any error so the caller can mark `flashcard_added=False`."""
    try:
        dup = (
            sb.table("flashcard_cards")
            .select("id")
            .eq("stack_id", stack_id)
            .eq("vocabulary_id", vocab_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.warning("[accept] card duplicate-check failed: %s", exc)
        return False
    if dup.data:
        return True

    try:
        sb.table("flashcard_cards").insert({
            "stack_id":      stack_id,
            "vocabulary_id": vocab_id,
        }).execute()
    except Exception as exc:
        logger.warning("[accept] card insert failed: %s", exc)
        return False
    return True


@router.post("/{vocab_id}/accept")
async def accept_suggestion(
    vocab_id: str,
    add_to_default_stack: bool = Query(default=True),
    authorization: str | None = Header(default=None),
):
    user = await _require_auth(authorization)
    user_id = user["id"]

    if not _vocab_bank_enabled(user_id):
        raise HTTPException(403, "Vocab Bank feature is not enabled for this account")

    token = _token_from_header(authorization)
    sb = _user_sb(token)

    existing = (
        sb.table("user_vocabulary")
        .select("id, source_type")
        .eq("id", vocab_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )

    if not existing.data:
        raise HTTPException(404, "Vocab entry not found")

    current_source = existing.data[0].get("source_type")
    promoted = False

    if current_source == "upgrade_suggested":
        sb.table("user_vocabulary").update(
            {"source_type": "manual"}
        ).eq("id", vocab_id).execute()
        promoted = True
    elif current_source == "manual":
        # Idempotent: already-promoted rows skip the update but still get
        # the optional flashcard add below — useful when a previous accept
        # promoted but failed to enroll the card and the user retries.
        promoted = False
    else:
        # `used_well` / `needs_review` are AI verdicts the user shouldn't
        # overwrite via an "accept" gesture.
        raise HTTPException(
            409,
            f"Cannot accept entry with source_type={current_source!r}; only 'upgrade_suggested' is promotable",
        )

    flashcard_added = False
    stack_id: str | None = None
    stack_name: str | None = None
    if add_to_default_stack:
        stack_id = _ensure_default_accept_stack(sb, user_id)
        if stack_id:
            flashcard_added = _add_card_if_absent(sb, stack_id, vocab_id)
            if flashcard_added:
                stack_name = DEFAULT_ACCEPT_STACK_NAME
            else:
                stack_id = None  # don't return a stack_id we couldn't write to

    _fire_event("vocab_suggestion_accepted", {
        "vocab_id":        vocab_id,
        "promoted":        promoted,
        "flashcard_added": flashcard_added,
    }, user_id)

    return {
        "ok":              True,
        "source_type":     "manual",
        "promoted":        promoted,
        "flashcard_added": flashcard_added,
        "stack_id":        stack_id,
        "stack_name":      stack_name,
    }


# ── POST /{id}/mark-fixed — Promote needs_review after the user fixed it ─────
#
# Wave 2 Day 1 dogfood: the auto-stack "Cần ôn tập" used to render
# `needs_review` vocab as study cards, which encouraged learners to memorise
# AI-flagged-as-incorrect forms.  The new triage view lets the user review
# the suggestion, fix the underlying grammar/usage themselves, then click
# "Đã sửa" — which calls this endpoint.
#
# Mirrors POST /accept but the source-type gate flips: only `needs_review`
# rows are promotable here, and they always go to the same default stack
# ("Từ vựng đã chấp nhận") so accept + mark-fixed share one bucket and the
# dashboard widget can keep counting them as one event family.


@router.post("/{vocab_id}/mark-fixed")
async def mark_vocab_fixed(
    vocab_id: str,
    add_to_default_stack: bool = Query(default=True),
    authorization: str | None = Header(default=None),
):
    user = await _require_auth(authorization)
    user_id = user["id"]

    if not _vocab_bank_enabled(user_id):
        raise HTTPException(403, "Vocab Bank feature is not enabled for this account")

    token = _token_from_header(authorization)
    sb = _user_sb(token)

    existing = (
        sb.table("user_vocabulary")
        .select("id, source_type")
        .eq("id", vocab_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )

    if not existing.data:
        raise HTTPException(404, "Vocab entry not found")

    current_source = existing.data[0].get("source_type")
    promoted = False

    if current_source == "needs_review":
        sb.table("user_vocabulary").update(
            {"source_type": "manual"}
        ).eq("id", vocab_id).execute()
        promoted = True
    elif current_source == "manual":
        # Idempotent retry: row was already promoted on a prior call but the
        # flashcard write may have failed — let the second half run again.
        promoted = False
    else:
        # `used_well` / `upgrade_suggested` use the /accept endpoint or
        # already represent a "no fix needed" verdict, so reject 409 to
        # keep the two flows symmetric and reduce the chance of a misuse
        # silently flipping a non-needs_review row.
        raise HTTPException(
            409,
            f"Cannot mark-fixed entry with source_type={current_source!r}; only 'needs_review' is promotable here",
        )

    flashcard_added = False
    stack_id: str | None = None
    stack_name: str | None = None
    if add_to_default_stack:
        stack_id = _ensure_default_accept_stack(sb, user_id)
        if stack_id:
            flashcard_added = _add_card_if_absent(sb, stack_id, vocab_id)
            if flashcard_added:
                stack_name = DEFAULT_ACCEPT_STACK_NAME
            else:
                stack_id = None

    _fire_event("vocab_marked_fixed", {
        "vocab_id":        vocab_id,
        "promoted":        promoted,
        "flashcard_added": flashcard_added,
    }, user_id)

    return {
        "ok":              True,
        "source_type":     "manual",
        "promoted":        promoted,
        "flashcard_added": flashcard_added,
        "stack_id":        stack_id,
        "stack_name":      stack_name,
    }


# ── POST /{id}/skip — Persistent triage skip ────────────────────────────────
#
# Pre-PR #25 the triage view's "🗑️ Bỏ qua" button was a local-only DOM
# remove — the row reappeared on next visit, which testers reported as
# the action not working at all.  This endpoint persists the decision
# via the `is_skipped` column added in migration 030.
#
# Distinct from /report (false-positive flag): skip means "this vocab is
# correct but I don't want to learn it right now"; report means "this
# vocab is wrong, get rid of it".  The two flags compose — a row can be
# both, and downstream filters honour both.
#
# Idempotent on already-skipped rows (returns success without writing).


@router.post("/{vocab_id}/skip")
async def skip_vocab(
    vocab_id: str,
    authorization: str | None = Header(default=None),
):
    user = await _require_auth(authorization)
    user_id = user["id"]

    if not _vocab_bank_enabled(user_id):
        raise HTTPException(403, "Vocab Bank feature is not enabled for this account")

    token = _token_from_header(authorization)
    sb = _user_sb(token)

    existing = (
        sb.table("user_vocabulary")
        .select("id, is_skipped")
        .eq("id", vocab_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )

    if not existing.data:
        raise HTTPException(404, "Vocab entry not found")

    if existing.data[0].get("is_skipped"):
        return {"ok": True, "vocab_id": vocab_id, "already_skipped": True}

    sb.table("user_vocabulary").update(
        {"is_skipped": True}
    ).eq("id", vocab_id).execute()

    _fire_event("vocab_skipped", {"vocab_id": vocab_id}, user_id)

    return {"ok": True, "vocab_id": vocab_id, "already_skipped": False}


# ── POST /{id}/report — False Positive Report ────────────────────────────────

@router.post("/{vocab_id}/report")
async def report_false_positive(
    vocab_id: str,
    body: VocabFPReportRequest,
    authorization: str | None = Header(default=None),
):
    user = await _require_auth(authorization)
    user_id = user["id"]

    if not _vocab_bank_enabled(user_id):
        raise HTTPException(403, "Vocab Bank feature is not enabled for this account")

    token = _token_from_header(authorization)
    sb = _user_sb(token)

    existing = (
        sb.table("user_vocabulary")
        .select("id")
        .eq("id", vocab_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )

    if not existing.data:
        raise HTTPException(404, "Vocab entry not found")

    _fire_event("vocab_fp_reported", {
        "vocab_id": vocab_id,
        "reason": body.reason,
    }, user_id)

    sb.table("user_vocabulary").update(
        {"is_archived": True}
    ).eq("id", vocab_id).execute()

    return {"ok": True}
