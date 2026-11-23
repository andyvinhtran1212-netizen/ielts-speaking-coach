"""LEARNERCORE-0063 amendment 4 (G07-T31) FR-106/FR-107: personal review notes.

  GET /api/review-notes?skill=listening|reading&attempt_id=<uuid>
      → {"notes": [{"q_num", "body", "updated_at"}]} of the caller for the
        test of that attempt.
  PUT /api/review-notes  {skill, attempt_id, q_num, body}
      → {"q_num", "body" | null, "updated_at" | null}; an empty body (after
        trimming) deletes the note.

Sign-in is required (an anonymous Reading share-link attempt has no notes).
Ownership is checked with the same helper as ``/api/feedback``: another
user's attempt is 403, an unknown one 404. The test comes from the caller's
attempt, never from the client. Note bodies are never logged. Both routes sit
behind the activation gate like every learner route.
"""
from __future__ import annotations

import asyncio
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from database import supabase_admin
from routers.auth import get_supabase_user
from routers.feedback import _fetch_owned_attempt
from services import review_notes as notes

router = APIRouter(prefix="/api", tags=["review-notes"])

_NO_STORE = {"Cache-Control": "private, no-store"}
Skill = Literal["listening", "reading"]


class ReviewNoteOut(BaseModel):
    q_num: int
    body: str
    updated_at: Optional[str] = None


class ReviewNotesOut(BaseModel):
    notes: list[ReviewNoteOut]


class ReviewNoteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    skill: Skill
    attempt_id: UUID
    q_num: int = Field(ge=1)
    body: str = ""


class ReviewNoteSavedOut(BaseModel):
    q_num: int
    body: Optional[str] = None
    updated_at: Optional[str] = None


def _owned_attempt(skill: str, attempt_id: str, user: dict) -> dict:
    row = _fetch_owned_attempt(skill, attempt_id, user, None)
    # _fetch_owned_attempt selects only the ownership columns; the note needs
    # the attempt's test and its graded question numbers.
    table = "listening_test_attempts" if skill == "listening" else "reading_test_attempts"
    full = (
        supabase_admin.table(table)
        .select("id,user_id,test_id,grading_details")
        .eq("id", attempt_id).eq("user_id", user["id"]).limit(1)
        .execute().data or []
    )
    if not full or not row.get("test_id"):
        raise HTTPException(404, "Attempt not found", headers=_NO_STORE)
    return full[0]


def _list(skill: str, attempt_id: str, user: dict) -> dict:
    attempt = _owned_attempt(skill, attempt_id, user)
    return {"notes": notes.list_notes(supabase_admin, user_id=user["id"], skill=skill,
                                      test_uuid=attempt["test_id"])}


def _save(body: ReviewNoteIn, user: dict) -> dict:
    attempt = _owned_attempt(body.skill, str(body.attempt_id), user)
    try:
        return notes.save_note(supabase_admin, user_id=user["id"], skill=body.skill,
                               attempt=attempt, q_num=body.q_num, body=body.body)
    except notes.NoteTooLong:
        raise HTTPException(422, {"error": "note_too_long",
                                  "message": "Ghi chú tối đa 500 ký tự."},
                            headers=_NO_STORE) from None
    except notes.QuestionNotInTest:
        raise HTTPException(422, {"error": "q_num_invalid",
                                  "message": "Câu này không có trong đề."},
                            headers=_NO_STORE) from None


@router.get("/review-notes", response_model=ReviewNotesOut)
async def list_review_notes(
    skill: Skill = Query(...),
    attempt_id: UUID = Query(...),
    authorization: str | None = Header(default=None),
):
    user = await get_supabase_user(authorization)
    return await asyncio.to_thread(_list, skill, str(attempt_id), user)


@router.put("/review-notes", response_model=ReviewNoteSavedOut)
async def save_review_note(
    body: ReviewNoteIn,
    authorization: str | None = Header(default=None),
):
    user = await get_supabase_user(authorization)
    return await asyncio.to_thread(_save, body, user)
