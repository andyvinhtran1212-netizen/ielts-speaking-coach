"""Owner-scoped canonical flags; no answer, source-key or result projection."""
from uuid import UUID

from fastapi import APIRouter, Header

from database import supabase_admin
from models.mock_attempt_flags import (
    ReviewFlagPatchRequest, ReviewFlagStateResponse, ReviewFlagWriteResponse,
)
from routers import listening, reading_student
from services.mock_attempt_flags import flag_state_response, patch_review_flag

router = APIRouter(tags=["attempt review flags"])


def _guard(skill, attempt, *, write):
    # The policy helper checks purpose only AFTER the existing auth/capability
    # resolver has proved ownership. Submitted GET exposes just flags.
    from services.mock_paper_policy import guard_owned_attempt
    guard_owned_attempt(supabase_admin, skill, attempt,
                        purpose="flags_write" if write else "flags_read")


async def _reading_owner(attempt_id, authorization, anon_id):
    user = await reading_student._optional_auth(authorization)
    return reading_student._fetch_attempt_owned(str(attempt_id), user, anon_id)


async def _listening_owner(attempt_id, authorization):
    user = await listening._require_auth(authorization)
    return listening._fetch_attempt_or_404(str(attempt_id), user["id"])


@router.get("/api/reading/test/attempts/{attempt_id}/review-flags",
            response_model=ReviewFlagStateResponse)
async def get_reading_review_flags(
    attempt_id: UUID, authorization: str | None = Header(default=None),
    x_reading_anon: str | None = Header(default=None, alias="X-Reading-Anon"),
):
    attempt = await _reading_owner(attempt_id, authorization, x_reading_anon)
    _guard("reading", attempt, write=False)
    return flag_state_response(supabase_admin, "reading", attempt)


@router.patch("/api/reading/test/attempts/{attempt_id}/review-flags",
              response_model=ReviewFlagWriteResponse)
async def patch_reading_review_flags(
    attempt_id: UUID, body: ReviewFlagPatchRequest,
    authorization: str | None = Header(default=None),
    x_reading_anon: str | None = Header(default=None, alias="X-Reading-Anon"),
):
    attempt = await _reading_owner(attempt_id, authorization, x_reading_anon)
    _guard("reading", attempt, write=True)
    owner = attempt.get("user_id")
    return patch_review_flag(supabase_admin, "reading", attempt, body,
                             user_id=owner, anon_id=x_reading_anon if owner is None else None)


@router.get("/api/listening/tests/attempts/{attempt_id}/review-flags",
            response_model=ReviewFlagStateResponse)
async def get_listening_review_flags(
    attempt_id: UUID, authorization: str | None = Header(default=None),
):
    attempt = await _listening_owner(attempt_id, authorization)
    _guard("listening", attempt, write=False)
    return flag_state_response(supabase_admin, "listening", attempt)


@router.patch("/api/listening/tests/attempts/{attempt_id}/review-flags",
              response_model=ReviewFlagWriteResponse)
async def patch_listening_review_flags(
    attempt_id: UUID, body: ReviewFlagPatchRequest,
    authorization: str | None = Header(default=None),
):
    attempt = await _listening_owner(attempt_id, authorization)
    _guard("listening", attempt, write=True)
    return patch_review_flag(supabase_admin, "listening", attempt, body,
                             user_id=attempt["user_id"])
