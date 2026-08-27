"""HTTP routes for curated Vocab Wiki learning units.

Reference-card routes in ``routers/vocabulary.py`` remain public and unchanged.
Curated reads are guarded by a hot runtime switch; learner queues and attempts
also require the per-user cohort flag. Admin editorial endpoints use the
canonical ``require_admin`` database-role check.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, model_validator

from routers.admin import require_admin
from routers.auth import get_supabase_user
from services import runtime_flags, vocab_units
from services.feature_flags import is_vocab_curated_enabled

logger = logging.getLogger(__name__)
router = APIRouter(tags=["vocabulary-learning-units"])


class LearnerAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    answer: str = Field(min_length=1, max_length=1200)


class AttemptRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    attempt_id: UUID
    response: LearnerAnswer


class UnitCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    unit_slug: str = Field(min_length=3, max_length=120, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    display_headword: str = Field(min_length=1, max_length=160)
    unit_type: Literal["learning_unit", "clinic"] = "learning_unit"
    sense_key: str = Field(min_length=1, max_length=200)
    construction_key: str = Field(min_length=1, max_length=200)
    communicative_function: str = Field(min_length=1, max_length=200)
    context_key: str = Field(min_length=1, max_length=200)
    target_level: str = Field(min_length=1, max_length=30)
    problem_tags: list[str] = Field(default_factory=list, max_length=20)
    learner_tags: list[str] = Field(default_factory=list, max_length=20)


class TaskCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task_type: Literal[
        "meaning_recall", "error_repair", "controlled_gap", "productive_transfer"
    ]
    dimension: Literal["meaning_recall", "usage_control", "productive_transfer"]
    prompt: str = Field(min_length=1, max_length=1200)
    options: list[Any] = Field(default_factory=list, max_length=12)
    answer_key: dict[str, Any]
    explanation_vi: str = Field(min_length=1, max_length=2000)


class VersionCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: dict[str, Any]
    sources: list[dict[str, Any]] = Field(min_length=1, max_length=20)
    tasks: list[TaskCreateRequest] = Field(min_length=1, max_length=20)
    change_note: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def bounded_editorial_payload(self):
        size = len(json.dumps(self.model_dump(), ensure_ascii=False).encode("utf-8"))
        if size > 300_000:
            raise ValueError("Version payload vượt giới hạn 300 KB")
        return self


class ReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    review_type: Literal["language", "pedagogy", "assessment"]
    decision: Literal["approved", "changes_requested"]
    notes: str | None = Field(default=None, max_length=3000)


class RollbackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version_id: UUID


def _read_switch() -> None:
    if not runtime_flags.is_enabled("vocab_units_read", default=False):
        raise HTTPException(
            status_code=503,
            detail={
                "error_code": "feature_disabled",
                "flag": "vocab_units_read",
                "message": "Kho học từ curated đang tạm đóng.",
            },
        )


def _require_learner_gate(user_id: str, *, write: bool = False) -> None:
    if not is_vocab_curated_enabled(user_id):
        raise HTTPException(status_code=403, detail="Tài khoản chưa thuộc nhóm thử nghiệm Vocab Curated")
    key = "vocab_unit_attempts_write" if write else "vocab_units_read"
    if not runtime_flags.is_enabled(key, default=False):
        raise HTTPException(
            status_code=503,
            detail={
                "error_code": "feature_disabled",
                "flag": key,
                "message": "Tính năng học từ curated đang tạm khóa.",
            },
        )


def _translate_domain_error(exc: Exception) -> HTTPException:
    if isinstance(exc, vocab_units.VocabUnitNotFound):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, vocab_units.VocabUnitConflict):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, vocab_units.VocabUnitValidationError):
        return HTTPException(
            status_code=422,
            detail={"message": str(exc), "errors": exc.errors},
        )
    logger.exception("[vocab_units] unexpected service error")
    return HTTPException(status_code=500, detail="Không xử lý được Vocab Curated lúc này")


# Public because published learning content is part of Vocab Wiki. Direct DB
# access remains blocked by RLS; the hot switch defaults off during rollout.
@router.get("/api/vocabulary/units", dependencies=[Depends(_read_switch)])
async def list_learning_units(
    level: str | None = Query(default=None, max_length=30),
    unit_type: Literal["learning_unit", "clinic"] | None = Query(default=None),
    problem_tag: str | None = Query(default=None, max_length=80),
):
    try:
        items = vocab_units.list_units(
            level=level, unit_type=unit_type, problem_tag=problem_tag,
        )
        return {"count": len(items), "units": items}
    except Exception as exc:
        raise _translate_domain_error(exc) from exc


@router.get("/api/vocabulary/units/{unit_slug}", dependencies=[Depends(_read_switch)])
async def get_learning_unit(unit_slug: str):
    try:
        return vocab_units.get_unit(unit_slug)
    except Exception as exc:
        raise _translate_domain_error(exc) from exc


@router.get("/api/vocabulary/pathways", dependencies=[Depends(_read_switch)])
async def list_learning_pathways():
    try:
        items = vocab_units.list_pathways()
        return {"count": len(items), "pathways": items}
    except Exception as exc:
        raise _translate_domain_error(exc) from exc


@router.get("/api/me/vocabulary/today")
async def get_my_vocab_today(authorization: str | None = Header(default=None)):
    user = await get_supabase_user(authorization)
    _require_learner_gate(user["id"])
    try:
        return vocab_units.get_today(
            user["id"],
            include_recommendations=runtime_flags.is_enabled(
                "vocab_unit_recommendations", default=False,
            ),
        )
    except Exception as exc:
        raise _translate_domain_error(exc) from exc


@router.get("/api/me/vocabulary/unit-mastery")
async def get_my_vocab_mastery(
    page: int = Query(default=1, ge=1, le=10_000),
    page_size: int = Query(default=50, ge=1, le=100),
    authorization: str | None = Header(default=None),
):
    user = await get_supabase_user(authorization)
    _require_learner_gate(user["id"])
    try:
        return vocab_units.get_user_mastery(
            user["id"], page=page, page_size=page_size,
        )
    except Exception as exc:
        raise _translate_domain_error(exc) from exc


@router.post("/api/vocabulary/tasks/{task_id}/attempt")
async def submit_vocab_task_attempt(
    task_id: UUID,
    body: AttemptRequest,
    authorization: str | None = Header(default=None),
):
    user = await get_supabase_user(authorization)
    _require_learner_gate(user["id"], write=True)
    try:
        return vocab_units.submit_attempt(
            user["id"], str(task_id), str(body.attempt_id), body.response.model_dump(),
        )
    except Exception as exc:
        raise _translate_domain_error(exc) from exc


@router.get("/admin/vocabulary/editorial/units")
async def admin_list_vocab_editorial_units(
    status: Literal["draft", "published", "archived"] | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    try:
        return vocab_units.list_editorial_units(
            status=status, offset=offset, limit=limit,
        )
    except Exception as exc:
        raise _translate_domain_error(exc) from exc


@router.get("/admin/vocabulary/editorial/units/{unit_id}")
async def admin_get_vocab_editorial_unit(
    unit_id: UUID,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    try:
        return vocab_units.get_editorial_unit(str(unit_id))
    except Exception as exc:
        raise _translate_domain_error(exc) from exc


@router.post("/admin/vocabulary/units", status_code=201)
async def admin_create_vocab_unit(
    body: UnitCreateRequest,
    authorization: str | None = Header(default=None),
):
    admin = await require_admin(authorization)
    try:
        return vocab_units.create_unit(body.model_dump(), admin["id"])
    except Exception as exc:
        raise _translate_domain_error(exc) from exc


@router.post("/admin/vocabulary/units/{unit_id}/versions", status_code=201)
async def admin_create_vocab_version(
    unit_id: UUID,
    body: VersionCreateRequest,
    authorization: str | None = Header(default=None),
):
    admin = await require_admin(authorization)
    try:
        return vocab_units.create_version(
            str(unit_id),
            content=body.content,
            sources=body.sources,
            tasks=[task.model_dump() for task in body.tasks],
            change_note=body.change_note,
            admin_id=admin["id"],
        )
    except Exception as exc:
        raise _translate_domain_error(exc) from exc


@router.post("/admin/vocabulary/versions/{version_id}/validate")
async def admin_validate_vocab_version(
    version_id: UUID,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    try:
        return vocab_units.validate_version(str(version_id))
    except Exception as exc:
        raise _translate_domain_error(exc) from exc


@router.post("/admin/vocabulary/versions/{version_id}/reviews")
async def admin_review_vocab_version(
    version_id: UUID,
    body: ReviewRequest,
    authorization: str | None = Header(default=None),
):
    admin = await require_admin(authorization)
    try:
        return vocab_units.review_version(
            str(version_id), review_type=body.review_type, decision=body.decision,
            notes=body.notes, admin_id=admin["id"],
        )
    except Exception as exc:
        raise _translate_domain_error(exc) from exc


@router.post("/admin/vocabulary/versions/{version_id}/publish")
async def admin_publish_vocab_version(
    version_id: UUID,
    authorization: str | None = Header(default=None),
):
    admin = await require_admin(authorization)
    try:
        return vocab_units.publish_version(str(version_id), admin["id"])
    except Exception as exc:
        raise _translate_domain_error(exc) from exc


@router.post("/admin/vocabulary/units/{unit_id}/rollback")
async def admin_rollback_vocab_version(
    unit_id: UUID,
    body: RollbackRequest,
    authorization: str | None = Header(default=None),
):
    admin = await require_admin(authorization)
    try:
        return vocab_units.rollback_version(
            str(unit_id), str(body.version_id), admin["id"],
        )
    except Exception as exc:
        raise _translate_domain_error(exc) from exc
