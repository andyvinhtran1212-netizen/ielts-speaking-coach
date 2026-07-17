"""User feedback for Reading + Listening tests (feature: Feedback) — foundation.

Three feedback types, ONE polymorphic table (user_feedback, migration 100):
  • rating — post-review survey: rating_de (1-5) [+ rating_audio (1-5) listening]
  • report — "báo lỗi đề" modal: category + note (+ optional q_num)
  • flag   — per-question "flag bài giải": q_num (+ optional note)

Endpoints:
  POST  /api/feedback                  — submit (auth OR X-Reading-Anon for reading anon)
  GET   /api/admin/feedback            — admin inbox, grouped by test, filter skill/type/status/test_id
  PATCH /api/admin/feedback/{id}       — admin: set status new|resolved

Identity is NEVER taken from the body: created_by comes from the verified
session, anon_id from the X-Reading-Anon capability token. The attempt's
ownership is enforced (you can only give feedback on an attempt you own), and
test_id (text) is resolved server-side from the attempt for admin grouping.
"""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel

from database import supabase_admin
from routers.admin import require_admin
from routers.auth import get_supabase_user

router = APIRouter(prefix="/api", tags=["feedback"])

_TYPES = {"rating", "report", "flag"}
_SKILLS = {"reading", "listening"}
_STATUSES = {"new", "resolved"}
_ATTEMPT_TABLE = {"reading": "reading_test_attempts", "listening": "listening_test_attempts"}
_TEST_TABLE = {"reading": "reading_tests", "listening": "listening_tests"}


class FeedbackIn(BaseModel):
    type: str
    skill: str
    # Anchor 1 — test attempt (full/mini/drill review). Anchor 2 — practice
    # content (2026-07-17 audit: flag mở rộng cho L1/L2 practice + listening
    # exercise lẻ): passage_slug (reading) HOẶC content_id (listening).
    # Đúng một anchor phải có mặt.
    attempt_id: Optional[str] = None
    passage_slug: Optional[str] = None
    content_id: Optional[str] = None
    q_num: Optional[int] = None
    rating_de: Optional[int] = None
    rating_audio: Optional[int] = None
    category: Optional[str] = None
    note: Optional[str] = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _optional_user(authorization: str | None) -> Optional[dict]:
    """Verified auth user, or None when no/invalid token (so an anonymous
    reading taker can still submit via the anon_id capability token). Never
    raises on a missing token — ownership is enforced downstream."""
    if not authorization:
        return None
    try:
        return await get_supabase_user(authorization)
    except HTTPException:
        return None


def _fetch_owned_attempt(skill: str, attempt_id: str, user: Optional[dict], anon_id: str | None) -> dict:
    """Fetch the attempt and enforce ownership for BOTH kinds (mirrors
    reading_student._fetch_attempt_owned): an authed attempt requires the
    caller's user_id to match; an anonymous (reading) attempt requires the
    matching secret anon_id. Listening attempts are always user-owned."""
    if user is None and not anon_id:
        raise HTTPException(401, "Authentication required")
    res = (
        supabase_admin.table(_ATTEMPT_TABLE[skill])
        .select("id, user_id, test_id" + (", anon_id" if skill == "reading" else ""))
        .eq("id", attempt_id).limit(1).execute()
    )
    if not res.data:
        raise HTTPException(404, "Attempt not found")
    row = res.data[0]
    owner = row.get("user_id")
    if owner:
        if not user or user.get("id") != owner:
            raise HTTPException(403, "Attempt belongs to another user")
    else:
        stored = row.get("anon_id")
        if not anon_id or not stored or not secrets.compare_digest(str(anon_id), str(stored)):
            raise HTTPException(403, "Attempt belongs to another session")
    return row


def _resolve_practice_ref(skill: str, passage_slug: str | None, content_id: str | None) -> str:
    """Validate a practice/exercise anchor and return the denormalised
    test_id label for admin grouping: ``practice:<slug>`` (reading L1/L2)
    hoặc ``exercise:<content_uuid>`` (listening standalone exercise). The
    referenced row must exist — a flag on nothing is a 404, not a row."""
    if skill == "reading":
        slug = (passage_slug or "").strip()
        if not slug:
            raise HTTPException(422, "passage_slug is required for reading practice feedback")
        res = (
            supabase_admin.table("reading_passages")
            .select("id").eq("slug", slug)
            .in_("library", ["l1_vocab", "l2_skill"])
            .limit(1).execute()
        )
        if not res.data:
            raise HTTPException(404, "Passage not found")
        return f"practice:{slug}"
    # listening
    cid = (content_id or "").strip()
    if not cid:
        raise HTTPException(422, "content_id is required for listening exercise feedback")
    try:
        uuid.UUID(cid)
    except ValueError:
        raise HTTPException(422, "content_id must be a UUID")
    res = (
        supabase_admin.table("listening_content")
        .select("id").eq("id", cid).limit(1).execute()
    )
    if not res.data:
        raise HTTPException(404, "Content not found")
    return f"exercise:{cid}"


def _resolve_test_id(skill: str, test_uuid: str | None) -> str | None:
    """attempt.test_id (UUID) → the human test_id (TEXT) used for admin grouping."""
    if not test_uuid:
        return None
    t = (
        supabase_admin.table(_TEST_TABLE[skill])
        .select("test_id").eq("id", test_uuid).limit(1).execute()
    )
    return (t.data[0].get("test_id") if t.data else None)


@router.post("/feedback")
async def submit_feedback(
    body: FeedbackIn,
    authorization: str | None = Header(default=None),
    x_reading_anon: str | None = Header(default=None),
):
    if body.type not in _TYPES:
        raise HTTPException(422, f"type must be one of {sorted(_TYPES)}")
    if body.skill not in _SKILLS:
        raise HTTPException(422, f"skill must be one of {sorted(_SKILLS)}")

    user = await _optional_user(authorization)
    # anon_id only meaningful for reading (listening attempts are always authed)
    anon_id = (x_reading_anon or "").strip() or None if body.skill == "reading" else None

    if body.attempt_id:
        # Ownership: you may only give feedback on an attempt you own.
        attempt = _fetch_owned_attempt(body.skill, body.attempt_id, user, anon_id)
        test_id = _resolve_test_id(body.skill, attempt.get("test_id"))
    else:
        # Practice/exercise mode — flag/report anchored on the content itself
        # (reading L1/L2 practice, listening standalone exercise). No attempt
        # row exists, so: login required (no anon capability token here) and
        # rating is not applicable (ratings are one-per-attempt).
        if user is None:
            raise HTTPException(401, "Authentication required")
        if body.type == "rating":
            raise HTTPException(422, "rating requires an attempt_id")
        anon_id = None
        test_id = _resolve_practice_ref(body.skill, body.passage_slug, body.content_id)

    # ── per-type validation ──────────────────────────────────────────────────
    def _check_rating(v, name):
        if v is None:
            return
        if not isinstance(v, int) or not (1 <= v <= 5):
            raise HTTPException(422, f"{name} must be an integer 1-5")

    rating_de = body.rating_de
    rating_audio = body.rating_audio
    q_num = body.q_num
    category = (body.category or "").strip() or None
    note = (body.note or "").strip() or None

    if body.type == "rating":
        _check_rating(rating_de, "rating_de")
        _check_rating(rating_audio, "rating_audio")
        if rating_de is None:
            raise HTTPException(422, "rating_de is required for a rating")
        if body.skill == "reading" and rating_audio is not None:
            raise HTTPException(422, "rating_audio is only valid for listening")
        q_num = None  # a rating is test-level
        # ONE rating per attempt per identity (the unique index is the race-safe
        # backstop; this pre-check gives a clean 409 + message).
        existing = supabase_admin.table("user_feedback").select("id") \
            .eq("attempt_id", body.attempt_id).eq("type", "rating")
        existing = existing.eq("created_by", user["id"]) if user else existing.eq("anon_id", anon_id)
        if existing.execute().data:
            raise HTTPException(409, "Bạn đã đánh giá đề này rồi.")
    elif body.type == "report":
        if not category and not note:
            raise HTTPException(422, "report requires a category or a note")
        rating_de = rating_audio = None
    else:  # flag
        # Attempt-anchored flags target one review card → q_num bắt buộc.
        # Practice/exercise flags may be content-level → q_num optional.
        if q_num is None and body.attempt_id:
            raise HTTPException(422, "flag requires q_num")
        rating_de = rating_audio = None

    row = {
        "id": str(uuid.uuid4()),
        "type": body.type,
        "skill": body.skill,
        "attempt_id": body.attempt_id,
        "test_id": test_id,
        "q_num": q_num,
        "rating_de": rating_de,
        "rating_audio": rating_audio,
        "category": category,
        "note": note,
        "status": "new",
        "created_by": user["id"] if user else None,
        "anon_id": anon_id if not user else None,
        "created_at": _now(),
    }
    try:
        supabase_admin.table("user_feedback").insert(row).execute()
    except Exception as exc:  # unique-index backstop for a racing double-rating
        msg = str(exc).lower()
        if "uq_feedback_rating" in msg or "duplicate key" in msg or "23505" in msg:
            raise HTTPException(409, "Bạn đã đánh giá đề này rồi.")
        raise HTTPException(500, f"Không lưu được feedback: {exc}")

    return {"id": row["id"], "status": "new"}


@router.get("/admin/feedback")
async def admin_list_feedback(
    skill: str | None = Query(default=None),
    type: str | None = Query(default=None),
    status: str | None = Query(default=None),
    test_id: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    if skill is not None and skill not in _SKILLS:
        raise HTTPException(422, f"skill must be one of {sorted(_SKILLS)}")
    if type is not None and type not in _TYPES:
        raise HTTPException(422, f"type must be one of {sorted(_TYPES)}")
    if status is not None and status not in _STATUSES:
        raise HTTPException(422, f"status must be one of {sorted(_STATUSES)}")

    q = supabase_admin.table("user_feedback").select("*").order("created_at", desc=True)
    if skill is not None:
        q = q.eq("skill", skill)
    if type is not None:
        q = q.eq("type", type)
    if status is not None:
        q = q.eq("status", status)
    if test_id is not None:
        q = q.eq("test_id", test_id)
    rows = q.execute().data or []

    # Group by test for the inbox (preserve newest-first order of first appearance).
    groups: list[dict] = []
    index: dict[str, dict] = {}
    for r in rows:
        key = r.get("test_id") or "(unknown)"
        g = index.get(key)
        if g is None:
            g = {"test_id": r.get("test_id"), "skill": r.get("skill"),
                 "new_count": 0, "items": []}
            index[key] = g
            groups.append(g)
        g["items"].append(r)
        if r.get("status") == "new":
            g["new_count"] += 1

    return {"items": rows, "count": len(rows), "groups": groups}


class StatusIn(BaseModel):
    status: str


@router.patch("/admin/feedback/{feedback_id}")
async def admin_patch_feedback_status(
    feedback_id: str,
    body: StatusIn,
    authorization: str | None = Header(default=None),
):
    admin = await require_admin(authorization)
    if body.status not in _STATUSES:
        raise HTTPException(422, f"status must be one of {sorted(_STATUSES)}")

    patch = {"status": body.status}
    if body.status == "resolved":
        patch["resolved_at"] = _now()
        patch["resolved_by"] = admin.get("id") if isinstance(admin, dict) else None
    else:
        patch["resolved_at"] = None
        patch["resolved_by"] = None

    res = (
        supabase_admin.table("user_feedback").update(patch)
        .eq("id", feedback_id).execute()
    )
    if not res.data:
        raise HTTPException(404, "Feedback not found")
    return {"id": feedback_id, "status": body.status}
