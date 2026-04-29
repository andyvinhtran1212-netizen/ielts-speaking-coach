"""
routers/vocabulary_bank.py — Phase B: Personal Vocab Bank API

All endpoints require Auth (JWT Bearer).
Feature flag check: VOCAB_BANK_FEATURE_FLAG_ENABLED env var + users.feature_flags.vocab_enabled.
Prefix: /api/vocabulary/bank
"""

import csv
import io
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict
from supabase import create_client

from config import settings
from routers.auth import get_supabase_user
from services.analytics import fire_event
from services.feature_flags import is_vocab_bank_enabled

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
    model_config = ConfigDict(extra="ignore")

    mastery_status: str


class VocabFPReportRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    reason: str | None = None


# ── Analytics helper ──────────────────────────────────────────────────────────

def _fire_event(event_name: str, event_data: dict, user_id: str) -> None:
    fire_event(event_name, event_data, user_id)


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
    query = (
        _user_sb(token).table("user_vocabulary")
        .select("*")
        .eq("user_id", user_id)
        .eq("is_archived", False)
        .order("created_at", desc=True)
    )

    if status:
        query = query.eq("mastery_status", status)
    if source_type:
        query = query.eq("source_type", source_type)

    result = query.execute()

    _fire_event("vocab_bank_viewed", {"source": "api"}, user_id)
    return result.data or []


# ── GET /stats ────────────────────────────────────────────────────────────────

@router.get("/stats")
async def get_vocab_stats(authorization: str | None = Header(default=None)):
    user = await _require_auth(authorization)
    user_id = user["id"]

    if not _vocab_bank_enabled(user_id):
        raise HTTPException(403, "Vocab Bank feature is not enabled for this account")

    token = _token_from_header(authorization)
    rows = (
        _user_sb(token).table("user_vocabulary")
        .select("mastery_status")
        .eq("user_id", user_id)
        .eq("is_archived", False)
        .execute()
    )

    total = len(rows.data or [])
    mastered = sum(1 for r in (rows.data or []) if r.get("mastery_status") == "mastered")
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
    result = (
        _user_sb(token).table("user_vocabulary")
        .select("id, headword, source_type, mastery_status")
        .eq("user_id", user_id)
        .eq("session_id", session_id)
        .eq("is_archived", False)
        .order("created_at", desc=False)
        .execute()
    )

    return result.data or []


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

    Includes archived rows on purpose — a backup should be lossless.  Same
    feature-flag gate as every other vocab-bank endpoint (default-deny per
    project rule).
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
    row = (
        _user_sb(token).table("user_vocabulary")
        .select("*")
        .eq("id", vocab_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )

    if not row.data:
        raise HTTPException(404, "Vocab entry not found")

    _fire_event("vocab_bank_entry_clicked", {"vocab_id": vocab_id, "status": row.data[0].get("mastery_status")}, user_id)
    return row.data[0]


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

    row = {
        "user_id":         user_id,
        "headword":        body.headword.strip(),
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


# ── PATCH /{id} — Update Status ──────────────────────────────────────────────

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

    if body.mastery_status not in ("learning", "mastered"):
        raise HTTPException(422, "mastery_status must be 'learning' or 'mastered'")

    token = _token_from_header(authorization)
    sb = _user_sb(token)

    existing = (
        sb.table("user_vocabulary")
        .select("id, mastery_status")
        .eq("id", vocab_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )

    if not existing.data:
        raise HTTPException(404, "Vocab entry not found")

    mastery_before = existing.data[0].get("mastery_status")

    sb.table("user_vocabulary").update(
        {"mastery_status": body.mastery_status}
    ).eq("id", vocab_id).execute()

    _fire_event("vocab_bank_entry_reviewed", {
        "vocab_id": vocab_id,
        "mastery_before": mastery_before,
        "mastery_after": body.mastery_status,
    }, user_id)

    return {"ok": True, "mastery_status": body.mastery_status}


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
