"""
routers/vocabulary_bank.py — Phase B: Personal Vocab Bank API

All endpoints require Auth (JWT Bearer).
Feature flag check: VOCAB_BANK_FEATURE_FLAG_ENABLED env var + users.feature_flags.vocab_enabled.
Prefix: /api/vocabulary/bank
"""

import logging

from fastapi import APIRouter, Header, HTTPException
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
