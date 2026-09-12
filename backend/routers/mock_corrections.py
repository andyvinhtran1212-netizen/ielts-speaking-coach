"""Cambridge Reading/Listening correction capture and release controls.

The learner route records confidence/attribution before any new explanation is
revealed. Admin routes mutate only explicit policy fields and leave the source
paper, score and historical attempts untouched.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from routers.admin import require_admin
from routers.auth import get_supabase_user
from services import mock_correction_service as svc

router = APIRouter(prefix="/api/mock-corrections", tags=["mock-corrections"])
admin_router = APIRouter(prefix="/admin/mock-corrections", tags=["admin-mock-corrections"])


class CaptureItem(BaseModel):
    question_number: int = Field(ge=1, le=40)
    confidence: int = Field(ge=1, le=5)
    self_attribution: list[str] = Field(default_factory=list, max_length=2)


class CaptureBody(BaseModel):
    items: list[CaptureItem] = Field(default_factory=list, max_length=40)


class PracticePolicyPatch(BaseModel):
    web_explanation_mode: Literal[
        "disabled", "immediate_after_capture", "admin_release"
    ] | None = None
    content_version: str | None = None
    post_test_capture_required: bool | None = None
    release_now: bool = False


class MockPolicyPatch(BaseModel):
    web_explanation_mode: Literal["disabled", "with_result", "admin_release"] | None = None
    content_version: str | None = None
    post_test_capture_required: bool | None = None
    release_now: bool = False


class PublicPolicyPatch(BaseModel):
    is_public: bool | None = None
    public_practice_enabled: bool | None = None
    web_explanation_mode: Literal[
        "disabled", "immediate_after_capture", "admin_release"
    ] | None = None
    content_version: str | None = None
    release_now: bool = False


class ContentApprovalBody(BaseModel):
    rights_approved: bool = False
    editorial_approved: bool = False
    reason: str | None = Field(default=None, max_length=1000)


class CorrectionEventBody(BaseModel):
    event_id: UUID
    event_name: Literal[
        "correction_result_seen",
        "evidence_attempt_submitted",
        "hint_revealed",
        "full_explanation_opened",
        "correction_output_submitted",
    ]
    client_occurred_at: datetime | None = None
    client_version: str | None = Field(default=None, max_length=120)
    payload: dict[str, Any] = Field(default_factory=dict)


def _service_error(exc: Exception) -> HTTPException:
    if isinstance(exc, svc.NotFoundError):
        return HTTPException(404, str(exc))
    if isinstance(exc, svc.CaptureConflictError):
        return HTTPException(409, str(exc))
    if isinstance(exc, svc.EventConflictError):
        return HTTPException(409, str(exc))
    if isinstance(exc, svc.PolicyError):
        return HTTPException(422, str(exc))
    return HTTPException(500, str(exc))


@router.post("/{skill}/attempts/{attempt_id}/post-test-capture")
async def submit_post_test_capture(
    skill: Literal["reading", "listening"],
    attempt_id: str,
    body: CaptureBody,
    authorization: str | None = Header(default=None),
):
    user = await get_supabase_user(authorization)
    try:
        recorded = svc.record_post_test_capture(
            skill,
            attempt_id,
            user["id"],
            [item.model_dump() for item in body.items],
        )
        attempt = recorded["attempt"]
        access = svc.explanation_access(skill, attempt)
        return {
            "capture": recorded["capture"],
            "replayed": recorded["replayed"],
            "result": svc.learner_result_payload(skill, attempt),
            "web_explanation_access": svc.public_access_metadata(access),
        }
    except svc.CorrectionError as exc:
        raise _service_error(exc) from exc


@router.post("/{skill}/attempts/{attempt_id}/items/{question_number}/events")
async def submit_correction_event(
    skill: Literal["reading", "listening"],
    attempt_id: str,
    question_number: int,
    body: CorrectionEventBody,
    authorization: str | None = Header(default=None),
):
    user = await get_supabase_user(authorization)
    try:
        return svc.record_correction_event(
            skill,
            attempt_id,
            user["id"],
            question_number,
            event_id=str(body.event_id),
            event_name=body.event_name,
            payload=body.payload,
            client_occurred_at=(body.client_occurred_at.isoformat()
                                if body.client_occurred_at else None),
            client_version=body.client_version,
        )
    except svc.CorrectionError as exc:
        raise _service_error(exc) from exc


@admin_router.patch("/class-assignments/{assignment_id}")
async def patch_class_policy(
    assignment_id: str,
    body: PracticePolicyPatch,
    authorization: str | None = Header(default=None),
):
    admin = await require_admin(authorization)
    patch = body.model_dump(exclude_none=True)
    if "content_version" in patch:
        patch["content_version"] = patch.pop("content_version")
    try:
        return svc.update_class_assignment_policy(assignment_id, patch, admin["id"])
    except svc.CorrectionError as exc:
        raise _service_error(exc) from exc


@admin_router.patch("/mock-exams/{exam_id}")
async def patch_mock_policy(
    exam_id: str,
    body: MockPolicyPatch,
    authorization: str | None = Header(default=None),
):
    admin = await require_admin(authorization)
    patch = body.model_dump(exclude_none=True)
    if "content_version" in patch:
        patch["web_explanation_content_version"] = patch.pop("content_version")
    try:
        return svc.update_mock_exam_policy(exam_id, patch, admin["id"])
    except svc.CorrectionError as exc:
        raise _service_error(exc) from exc


@admin_router.patch("/public-tests/{skill}/{test_id}")
async def patch_public_policy(
    skill: Literal["reading", "listening"],
    test_id: str,
    body: PublicPolicyPatch,
    authorization: str | None = Header(default=None),
):
    admin = await require_admin(authorization)
    patch = body.model_dump(exclude_none=True)
    if "content_version" in patch:
        patch["web_explanation_content_version"] = patch.pop("content_version")
    try:
        return svc.update_public_test_policy(skill, test_id, patch, admin["id"])
    except svc.CorrectionError as exc:
        raise _service_error(exc) from exc


@admin_router.post("/content-versions/{content_version}/approve")
async def approve_content_version(
    content_version: str,
    body: ContentApprovalBody,
    authorization: str | None = Header(default=None),
):
    admin = await require_admin(authorization)
    try:
        return svc.approve_content_version(
            content_version,
            admin["id"],
            rights_approved=body.rights_approved,
            editorial_approved=body.editorial_approved,
            reason=body.reason,
        )
    except svc.CorrectionError as exc:
        raise _service_error(exc) from exc


@admin_router.get("/content-versions/{content_version}/health")
async def content_version_health(
    content_version: str,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    return svc.content_health(content_version)


@admin_router.get("/content-health")
async def all_content_health(authorization: str | None = Header(default=None)):
    await require_admin(authorization)
    return svc.content_health()


@admin_router.get("/items/{item_attempt_id}/timeline")
async def item_timeline(
    item_attempt_id: str,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    try:
        return svc.admin_item_timeline(item_attempt_id)
    except svc.CorrectionError as exc:
        raise _service_error(exc) from exc


@admin_router.get("/performance")
async def performance_summary(
    learner_id: str | None = Query(default=None),
    skill: Literal["reading", "listening"] | None = Query(default=None),
    class_assignment_id: str | None = Query(default=None),
    mock_exam_id: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    try:
        return svc.admin_performance_summary(
            learner_id=learner_id,
            skill=skill,
            class_assignment_id=class_assignment_id,
            mock_exam_id=mock_exam_id,
        )
    except svc.CorrectionError as exc:
        raise _service_error(exc) from exc
