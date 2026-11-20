"""routers.listening._common — shared head of the Listening package (BACKENDSPLIT-0076 T002).

Lines 22–710 of the former single-file routers/listening.py, cut and pasted
unchanged: imports, logger, route classes, user/admin routers, the Black Eye
admin guard, helpers and Pydantic schemas. The package re-exports every name;
tests patch ``routers.listening``, never this module (see __init__.py).
"""

from __future__ import annotations

from services.listening_test_grader import score_fields as listening_score_fields

import asyncio
import hashlib
import json
import logging
import re
import time
import uuid
from collections import deque
from contextvars import ContextVar
from datetime import datetime, timezone
from functools import partial
from typing import Any, Literal, Optional

from fastapi import (
    APIRouter, File, Header, HTTPException, Query,
    UploadFile,
)
from postgrest.exceptions import APIError
from pydantic import BaseModel, ConfigDict, Field
from fastapi.routing import APIRoute
from fastapi.exceptions import RequestValidationError
from models.listening_blackeye import (
    BlackEyeLearnerBinding, BlackEyeAttemptState, BlackEyeActivityReview,
    BlackEyeUnitPublic, BlackEyeSaveAck, BlackEyeInProgress,
)
from services import listening_blackeye as blackeye
from starlette.concurrency import run_in_threadpool

from config import settings
from services.errors import clip_user_value, describe_parse_error
from models.dictation_grading import (
    DictationAttemptStartResponse, DictationCapabilities, DictationGrade,
    DictationPolicyErrorResponse, DictationResumeResponse, DictationSentenceGrade,
    DictationSessionResponse, DictationStoredSessionResponse,
)
from services.dictation_grading_version import (
    DictationPolicyError, LEGACY_POLICY_VERSION, LEXICAL_POLICY_VERSION,
    frozen_contract, grade_frozen_sentence, persisted_policy_identity, reference_sha256,
    require_write_contract, session_contract, text_sha256, validate_new_lexical_source,
)
from database import supabase_admin
from services.core_attempt_observation import (
    admit_start, bind_owned_attempt, note_abandoned_dictation_attempt, note_abandoned_exam_attempts, note_persisted_exam_result, observe_operation,
)
from services.class_assignment_service import (
    active_exam_assignment_references,
    DeadlinePassedError,
    ItemNotFoundError,
    TaskMismatchError,
    validate_class_item_for_test,
)
from services.class_archive_service import require_class_attempt_accepts_work
from routers.admin import require_admin as _staff_admin_guard
from routers.auth import get_supabase_user
from services.listening_gist_grader import grade_gist_response
from services.rate_limit import (
    _utc_today_start,
    _utc_tomorrow_start,
    counted_rows,
    refuse_paid_ai,
    require_paid_ai_cap,
)
from services.pg_search import ilike_or_filter
from services.dictation_trends import classify_trends
from models.listening_dictation import (
    AdminDictationReportDetailResponse, AdminDictationReportListResponse,
    DictationAggregateResponse,
)
from models.admin_listening_attempts import (
    AdminListeningAttemptDetailResponse,
    AdminListeningAttemptListResponse,
)
from services.listening_grader import (
    aggregate_dictation_report,
    grade_dictation,
    grade_mcq,
    grade_true_false,
    proper_noun_hints,
    split_sentences,
)
from services import listening_fulltest_import
from services import test_data_visibility
from services import listening_drill_import
from services import listening_audit as listening_audit_svc
from services.active_player_lifecycle import (
    is_active_player_expired_error,
    is_resume_active,
    require_resume_active,
    resume_expires_at,
)
from models.listening_source_collection import SOURCE_PROGRAMME, SOURCE_CONTRACT
from models.listening_programmes import (
    ListeningAttemptReviewResponse,
    ListeningContentListResponse,
    ListeningGuidedStateResponse,
    ListeningLessonDetailResponse,
    ListeningLessonListResponse,
    ListeningOverviewResponse,
    ListeningPackageStatusRequest,
    ListeningPackageStatusResponse,
    ListeningPlayerResponse,
    ListeningTestListResponse,
)

logger = logging.getLogger("routers.listening")  # BACKENDSPLIT-0076 FR-010: keep the pre-split logger name


class _ListeningRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request):
            try:
                return await original(request)
            except RequestValidationError as exc:
                # Default Pydantic errors echo rejected values, creating an N2
                # answer-set oracle. Never echo nested Black Eye inputs.
                if any("blackeye_binding" in error.get("loc", ()) for error in exc.errors()):
                    raise HTTPException(422, "Invalid Black Eye binding.", headers={"Cache-Control": "private, no-store"}) from None
                raise
            except HTTPException as exc:
                if isinstance(exc.detail, str) and "Black Eye" in exc.detail:
                    exc.headers = {**(exc.headers or {}), "Cache-Control": "private, no-store"}
                raise
        return handler


user_router = APIRouter(prefix="/api/listening", tags=["listening"], route_class=_ListeningRoute)
_admin_targets = ContextVar("listening_admin_targets", default=None)


async def require_admin(authorization):
    """Canonical staff guard, followed by this request's Black Eye boundary."""
    actor = await _staff_admin_guard(authorization)
    context = _admin_targets.get()
    if context and not context["checked"]:
        if any(context["targets"].values()):
            await run_in_threadpool(blackeye.guard_generic_target, supabase_admin,
                                    denied_status=context["denied_status"],
                                    denied_detail=context["denied_detail"],
                                    external_test_code=context["external_test_code"], **context["targets"])
        context["checked"] = True
    return actor


class _ListeningAdminRoute(_ListeningRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request):
            # Set identity context only. The endpoint's first canonical staff
            # guard authenticates before this context may cause any database IO.
            targets = {}
            for key in ("test_id", "content_id", "exercise_id", "attempt_id",
                        "package_id", "drill_id", "session_id"):
                query_values = request.query_params.getlist(key)
                if len(query_values) > 20:
                    raise HTTPException(422, "Too many identity values.",
                                        headers={"Cache-Control": "private, no-store"})
                targets[key] = ([request.path_params[key]] if key in request.path_params else []) + [
                    value for value in query_values if value.strip()]
            path = self.path
            detail = "Test bundle not found"
            if "/content" in path or path.endswith("/exercises"):
                detail = "Listening content not found"
            elif "/exercises/" in path:
                detail = "Exercise not found"
            elif "/attempts" in path:
                detail = "Không tìm thấy lượt làm bài."
            elif "/dictation-reports" in path:
                detail = "Không tìm thấy phiên chép chính tả."
            elif "/packages/" in path:
                detail = "Listening package not found"
            elif "/drills/" in path:
                detail = "Skill drill not found"
            elif path.endswith("/audit"):
                detail = "Test not found"
            token = _admin_targets.set({"targets": targets, "checked": False,
                "denied_detail": detail,
                "external_test_code": request.url.path in {
                    "/admin/listening/dictation-reports", "/admin/listening/dictation-reports/aggregate"},
                "denied_status": 503 if request.url.path.endswith("/player-preview") else 404})
            try:
                return await original(request)
            finally:
                _admin_targets.reset(token)
        return handler


admin_router = APIRouter(prefix="/admin/listening", tags=["listening-admin"], route_class=_ListeningAdminRoute)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(401, "Missing Authorization header")
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(401, "Invalid Authorization header")
    return parts[1]


async def _require_auth(authorization: str | None) -> dict:
    return await get_supabase_user(authorization)


_ACCENT_VALUES = {"us_general", "uk_rp", "au", "ca", "other"}
_CEFR_VALUES = {"A2", "B1", "B2", "C1", "C2"}
_STATUS_VALUES = {"draft", "published", "archived"}
_EXERCISE_TYPES = {
    "dictation", "gist", "true_false", "mcq", "mini_test", "programme_form",
}


_TF_VALID = {"T", "F", "NG"}
MAX_LISTENING_SEGMENTS = 500
MAX_MCQ_STEM_LENGTH = 1_000
MAX_MCQ_OPTION_LENGTH = 500
_SINGLE_PUBLISHED_EXERCISE_TYPES = frozenset({"gist", "true_false", "mcq"})


def _is_standalone_authoring_exercise(row: dict) -> bool:
    """Identify legacy/native standalone blocks that must never join a test.

    Imported test blocks carry ``template_kind`` and q_num-based questions.
    Standalone authoring uses a separate gist/T-F/MCQ payload contract; mixing
    those rows into a test section produces blank or malformed player blocks.
    """
    payload = row.get("payload") or {}
    if not isinstance(payload, dict) or payload.get("template_kind"):
        return False
    exercise_type = row.get("exercise_type")
    if exercise_type == "gist":
        return "question" in payload
    if exercise_type == "true_false":
        return "statements" in payload
    if exercise_type == "mcq":
        questions = payload.get("questions")
        return isinstance(questions, list) and any(
            isinstance(question, dict) and ("idx" in question or "stem" in question)
            for question in questions
        )
    return False


def _is_unique_violation(exc: Exception) -> bool:
    """Recognize PostgREST/PostgreSQL uniqueness failures in both SDK shapes."""
    message = str(exc).lower()
    code = getattr(exc, "code", None)
    if code is None and exc.args and isinstance(exc.args[0], dict):
        code = exc.args[0].get("code")
    # SQLSTATE is stable across PostgREST client exception shapes. Do not infer
    # uniqueness from prose such as "duplicate key": that can misclassify an
    # unrelated future constraint as a block-identity conflict.
    return str(code or "") == "23505" or bool(re.search(r"\b23505\b", message))


def _is_dictation_attempt_conflict(exc: Exception) -> bool:
    """Recognize the migration-220 transaction guards across SDK shapes."""
    message = str(exc).lower()
    return "dictation_attempt_not_in_progress" in message \
        or "dictation_attempt_payload_mismatch" in message


def _published_standalone_orders(
    content_id: str,
    exercise_type: str,
    *,
    exclude_id: str | None = None,
) -> list[int]:
    """Return canonical live competitors for one standalone learner mode."""
    if exercise_type not in _SINGLE_PUBLISHED_EXERCISE_TYPES:
        return []
    result = (
        supabase_admin.table("listening_exercises")
        .select("id,order_num")
        .eq("content_id", content_id)
        .eq("exercise_type", exercise_type)
        .eq("status", "published")
        .execute()
    )
    orders: set[int] = set()
    for row in result.data or []:
        if exclude_id and str(row.get("id")) == exclude_id:
            continue
        try:
            orders.add(int(row.get("order_num")))
        except (TypeError, ValueError):
            continue
    return sorted(orders)


def _single_published_conflict_detail(exercise_type: str, live_orders: list[int]) -> str:
    return (
        f"Only one published {exercise_type} block is reachable per content. "
        f"Archive or draft the live block at order {live_orders} before publishing this one."
    )


def _same_timestamp(left: object, right: object) -> bool:
    """Compare Postgres timestamptz tokens without serialization false conflicts."""
    from datetime import datetime

    try:
        return datetime.fromisoformat(str(left).replace("Z", "+00:00")) == datetime.fromisoformat(
            str(right).replace("Z", "+00:00"),
        )
    except (TypeError, ValueError):
        return False


def _validate_gist_payload(payload: dict) -> dict:
    """Sprint 11.4 — gist exercise payload validation.

    Required: prompt_text (non-empty), model_answer (non-empty).
    Optional: rubric_keywords (list[str], default []).
    """
    if not isinstance(payload, dict):
        raise HTTPException(422, "Gist payload must be a JSON object.")
    prompt_value = payload.get("prompt_text")
    model_answer_value = payload.get("model_answer")
    if not isinstance(prompt_value, str):
        raise HTTPException(422, "Gist payload prompt_text must be a string.")
    if not isinstance(model_answer_value, str):
        raise HTTPException(422, "Gist payload model_answer must be a string.")
    prompt = prompt_value.strip()
    model_answer = model_answer_value.strip()
    if not prompt:
        raise HTTPException(422, "Gist payload missing prompt_text.")
    if not model_answer:
        raise HTTPException(422, "Gist payload missing model_answer.")
    if len(prompt) > 1_000:
        raise HTTPException(422, "Gist prompt_text must not exceed 1000 characters.")
    if len(model_answer) > 5_000:
        raise HTTPException(422, "Gist model_answer must not exceed 5000 characters.")
    raw_keywords = payload.get("rubric_keywords", [])
    if not isinstance(raw_keywords, list):
        raise HTTPException(422, "rubric_keywords must be a list of strings.")
    if len(raw_keywords) > 10:
        raise HTTPException(422, "rubric_keywords must contain at most 10 items.")
    keywords: list[str] = []
    seen: set[str] = set()
    for index, raw_keyword in enumerate(raw_keywords):
        if not isinstance(raw_keyword, str):
            raise HTTPException(422, f"rubric_keywords[{index}] must be a string.")
        keyword = raw_keyword.strip()
        if not keyword:
            raise HTTPException(422, f"rubric_keywords[{index}] must not be empty.")
        if len(keyword) > 100:
            raise HTTPException(422, f"rubric_keywords[{index}] must not exceed 100 characters.")
        normalized = keyword.casefold()
        if normalized in seen:
            raise HTTPException(422, f"rubric_keywords[{index}] duplicates another keyword.")
        seen.add(normalized)
        keywords.append(keyword)
    return {
        "prompt_text":     prompt,
        "model_answer":    model_answer,
        "rubric_keywords": keywords,
    }


def _validate_true_false_payload(payload: dict) -> dict:
    """Sprint 11.4 — true_false exercise payload validation.

    Required: statements[] of {idx, text, answer ∈ T/F/NG}.
      - 3 ≤ len ≤ 12 (IELTS standard range)
      - idx contiguous from 0
      - text non-empty
      - answer normalised to T / F / NG
    """
    if not isinstance(payload, dict):
        raise HTTPException(422, "true_false payload must be a JSON object.")
    if "statements" not in payload:
        raise HTTPException(422, "true_false payload missing statements.")
    raw = payload.get("statements")
    if not isinstance(raw, list):
        raise HTTPException(422, "true_false payload statements must be a list.")
    if not (3 <= len(raw) <= 12):
        raise HTTPException(
            422,
            f"true_false requires 3-12 statements; got {len(raw)} "
            "(IELTS standard range).",
        )
    out: list[dict] = []
    for i, raw_stmt in enumerate(raw):
        if not isinstance(raw_stmt, dict):
            raise HTTPException(422, f"Statement {i} must be a JSON object.")
        idx_v = raw_stmt.get("idx")
        if isinstance(idx_v, bool) or not isinstance(idx_v, int):
            raise HTTPException(422, f"Statement {i} idx invalid.")
        if idx_v != i:
            raise HTTPException(
                422,
                f"Statement idx must be contiguous from 0 — got idx={idx_v} at position {i}.",
            )
        text_value = raw_stmt.get("text")
        if not isinstance(text_value, str):
            raise HTTPException(422, f"Statement {i} text must be a string.")
        text = text_value.strip()
        if not text:
            raise HTTPException(422, f"Statement {i} text is empty.")
        if len(text) > 1_000:
            raise HTTPException(422, f"Statement {i} text must not exceed 1000 characters.")
        answer_value = raw_stmt.get("answer")
        if not isinstance(answer_value, str):
            raise HTTPException(422, f"Statement {i} answer must be a string.")
        ans = answer_value.upper().strip()
        if ans in {"TRUE"}: ans = "T"
        elif ans in {"FALSE"}: ans = "F"
        elif ans in {"NOT GIVEN", "NOTGIVEN", "N/G"}: ans = "NG"
        if ans not in _TF_VALID:
            raise HTTPException(
                422,
                f"Statement {i} answer must be T / F / NG (got '{clip_user_value(raw_stmt.get('answer'))}').",
            )
        out.append({"idx": idx_v, "text": text, "answer": ans})
    return {"statements": out}


def _validate_mcq_payload(payload: dict) -> dict:
    """Sprint 11.5 — MCQ exercise payload validation.

    Required: questions[] of {idx, stem, options[4], answer_idx}.
      - 1 ≤ len ≤ 20 (single-content MCQ exercise)
      - idx contiguous from 0
      - stem non-empty
      - options is a 4-element list of non-empty strings
      - answer_idx ∈ [0, 3]
    """
    if not isinstance(payload, dict):
        raise HTTPException(422, "mcq payload must be a JSON object.")
    if "questions" not in payload:
        raise HTTPException(422, "mcq payload missing questions.")
    raw = payload.get("questions")
    if not isinstance(raw, list):
        raise HTTPException(422, "mcq payload questions must be a list.")
    if not (1 <= len(raw) <= 20):
        raise HTTPException(
            422,
            f"mcq requires 1-20 questions; got {len(raw)}.",
        )
    out: list[dict] = []
    for i, raw_q in enumerate(raw):
        if not isinstance(raw_q, dict):
            raise HTTPException(422, f"Question {i} must be a JSON object.")
        idx_v = raw_q.get("idx")
        if isinstance(idx_v, bool) or not isinstance(idx_v, int):
            raise HTTPException(422, f"Question {i} idx invalid.")
        if idx_v != i:
            raise HTTPException(
                422,
                f"Question idx must be contiguous from 0 — got idx={idx_v} at position {i}.",
            )
        stem_value = raw_q.get("stem")
        if not isinstance(stem_value, str):
            raise HTTPException(422, f"Question {i} stem must be a string.")
        stem = stem_value.strip()
        if not stem:
            raise HTTPException(422, f"Question {i} stem is empty.")
        if len(stem) > MAX_MCQ_STEM_LENGTH:
            raise HTTPException(
                422,
                f"Question {i} stem must not exceed {MAX_MCQ_STEM_LENGTH} characters.",
            )
        opts_raw = raw_q.get("options")
        if not isinstance(opts_raw, list) or len(opts_raw) != 4:
            raise HTTPException(
                422,
                f"Question {i} requires exactly 4 options (got {len(opts_raw) if isinstance(opts_raw, list) else 'non-list'}).",
            )
        options: list[str] = []
        for j, raw_option in enumerate(opts_raw):
            if not isinstance(raw_option, str):
                raise HTTPException(422, f"Question {i} option {j} must be a string.")
            o = raw_option.strip()
            if not o:
                raise HTTPException(422, f"Question {i} option {j} is empty.")
            if len(o) > MAX_MCQ_OPTION_LENGTH:
                raise HTTPException(
                    422,
                    f"Question {i} option {j} must not exceed {MAX_MCQ_OPTION_LENGTH} characters.",
                )
            options.append(o)
        normalized_options = [option.casefold() for option in options]
        if len(set(normalized_options)) != len(normalized_options):
            raise HTTPException(422, f"Question {i} options must be distinct.")
        answer_idx = raw_q.get("answer_idx")
        if isinstance(answer_idx, bool) or not isinstance(answer_idx, int):
            raise HTTPException(422, f"Question {i} answer_idx invalid.")
        if not (0 <= answer_idx <= 3):
            raise HTTPException(
                422,
                f"Question {i} answer_idx must be 0-3 (got {answer_idx}).",
            )
        out.append({
            "idx":        idx_v,
            "stem":       stem,
            "options":    options,
            "answer_idx": answer_idx,
        })
    return {"questions": out}


def _validate_dictation_segments(
    segments: list[dict],
    *,
    audio_duration_seconds: float | int,
) -> list[dict]:
    """Sprint 11.3 — coerce + validate the segments JSONB.

    Returns a normalised copy (idx int, start/end floats, transcript
    stripped). Raises HTTPException(422) on the first violation so the
    admin editor surfaces a specific error message rather than a generic
    schema fail.
    """
    if not isinstance(segments, list) or not segments:
        raise HTTPException(422, "Dictation exercises require at least one segment.")
    if len(segments) > MAX_LISTENING_SEGMENTS:
        raise HTTPException(
            422,
            f"Dictation exercises support at most {MAX_LISTENING_SEGMENTS} segments.",
        )

    out: list[dict] = []
    prev_end = -1.0
    for i, raw in enumerate(segments):
        if not isinstance(raw, dict):
            raise HTTPException(422, f"Segment {i} must be a JSON object.")
        try:
            idx_v = int(raw.get("idx"))
            start_v = float(raw.get("start_sec"))
            end_v = float(raw.get("end_sec"))
        except (TypeError, ValueError):
            raise HTTPException(
                422,
                f"Segment {i} missing/invalid idx/start_sec/end_sec.",
            )
        if idx_v != i:
            raise HTTPException(
                422,
                f"Segment idx must be contiguous from 0 — got idx={idx_v} at position {i}.",
            )
        if start_v < 0:
            raise HTTPException(422, f"Segment {i} start_sec must be ≥ 0.")
        if end_v <= start_v:
            raise HTTPException(
                422,
                f"Segment {i} end_sec ({end_v}) must be > start_sec ({start_v}).",
            )
        if end_v > float(audio_duration_seconds) + 0.5:
            # 0.5s slack tolerates the renderer's coarse duration estimate.
            raise HTTPException(
                422,
                f"Segment {i} end_sec ({end_v}) exceeds content duration "
                f"({audio_duration_seconds}s).",
            )
        if start_v < prev_end - 0.05:
            raise HTTPException(
                422,
                f"Segment {i} overlaps previous segment "
                f"(start={start_v} < prev_end={prev_end}).",
            )
        transcript = str(raw.get("transcript", "")).strip()
        if not transcript:
            raise HTTPException(422, f"Segment {i} transcript is empty.")
        out.append({
            "idx":        idx_v,
            "start_sec":  round(start_v, 3),
            "end_sec":    round(end_v, 3),
            "transcript": transcript,
        })
        prev_end = end_v
    return out



# ── Pydantic schemas ──────────────────────────────────────────────────────────


class ListeningAttemptRequest(BaseModel):
    """User POST /api/listening/attempts body.

    Sprint 11.4 dispatches by `mode`:
      - dictation:  reads `user_transcript` (+ optional `segment_idx`)
                    against `exercise.segments[idx].transcript`.
      - gist:       reads `user_transcript` against
                    `exercise.payload.model_answer` + rubric_keywords.
      - true_false: reads `answers[]` against
                    `exercise.payload.statements[i].answer`.

    Either pass `exercise_id` directly (when the page knows it from a
    prior /exercises GET) OR pass `content_id` and let the router
    resolve the canonical published exercise for that content + mode.

    Backward compat with Sprint 11.2: omit `segment_idx` AND
    `exercise_id` for dictation and the router falls back to the
    whole-content transcript.
    """

    model_config = ConfigDict(extra="ignore")

    content_id: str | None = Field(default=None, max_length=64)
    exercise_id: str | None = Field(default=None, max_length=64)
    segment_idx: int | None = Field(default=None, ge=0, le=500)
    mode: str = Field(default="dictation")
    # Sprint 11.2/11.3 — user_transcript is used by dictation + gist.
    # Sprint 11.4 — true_false uses `answers` instead.
    user_transcript: str = Field(default="", max_length=10_000)
    answers: list[str] = Field(default_factory=list)
    # Sprint 11.5 — mcq carries int indices (0-3 per question).
    mcq_answers: list[int] = Field(default_factory=list)
    # Sprint 11.5 — mini-test runner links an attempt to a session row.
    listening_session_id: str | None = Field(default=None, max_length=64)
    listen_count: int = Field(default=1, ge=1, le=200)


class ListeningContentMetadataPatchRequest(BaseModel):
    """Admin PATCH /admin/listening/content/{id} body — Sprint 13.1.

    Editable metadata fields only. Every field is optional; only the
    keys present in the request body are updated. The storage path,
    audio bytes, audio_duration_seconds, alignment_data, and source_type
    are NOT editable here — those are derived at upload/render time and
    are immutable from the admin UI per Sprint 13.1 commission.

    Validation reuses the POST /upload rules: CEFR enum, accent enum,
    ielts_section 1-4, premium+NC license combo blocked.
    """

    model_config = ConfigDict(extra="ignore")

    title: str | None = Field(default=None, max_length=200)
    transcript: str | None = Field(default=None, max_length=20_000)
    accent_tag: str | None = Field(default=None)
    cefr_level: str | None = Field(default=None)
    ielts_section: int | None = Field(default=None)
    topic_tags: list[str] | None = Field(default=None)
    is_premium: bool | None = Field(default=None)
    external_license: str | None = Field(default=None, max_length=120)
    external_source_url: str | None = Field(default=None, max_length=500)
    expected_updated_at: str | None = Field(default=None, max_length=80)


class ListeningContentStatusPatchRequest(BaseModel):
    """Admin PATCH /admin/listening/content/{id}/status body — Sprint 13.1.

    Single-field status transition. Any-to-any direction is allowed by
    the commission (no workflow gate). Server validates that the new
    status is in `_STATUS_VALUES`.
    """

    model_config = ConfigDict(extra="ignore")

    status: str = Field(min_length=1)


class ListeningExerciseUpsertRequest(BaseModel):
    """Admin POST /admin/listening/exercises body.

    Creates or updates an exercise row for a given content. Sprint 11.3
    ships dictation segments only; gist / true_false / mcq payload
    shapes land in Sprint 11.4+. Server validates segments per the rules
    in `_validate_dictation_segments`:
      - idx contiguous from 0
      - start_sec < end_sec for every segment
      - end_sec <= parent content.audio_duration_seconds
      - non-overlapping in time (segment[i].end_sec <= segment[i+1].start_sec)
      - transcript non-empty
    """

    model_config = ConfigDict(extra="ignore")

    content_id: str = Field(min_length=1, max_length=64)
    exercise_id: str | None = Field(default=None, max_length=64)
    exercise_type: str = Field(default="dictation")
    segments: list[dict] = Field(default_factory=list)
    payload: dict = Field(default_factory=dict)
    order_num: int = Field(default=1, ge=1, le=200)
    status: str = Field(default="draft")
    expected_updated_at: str | None = Field(default=None, max_length=80)
    expected_absent: bool = Field(default=False)


