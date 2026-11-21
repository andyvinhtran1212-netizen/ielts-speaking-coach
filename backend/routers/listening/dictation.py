"""routers.listening.dictation — test-linked dictation (BACKENDSPLIT-0076 T007).

The "Test-linked dictation" block of the former single-file
routers/listening.py (lines 6425–7701), cut and pasted unchanged: dictation
sessions, attempts, grading, resume and the admin dictation reports. The
package re-exports every name; tests patch ``routers.listening``, never this
module (see __init__.py).
"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Literal, Optional
from fastapi import (
    APIRouter, File, Header, HTTPException, Query,
    UploadFile,
)
from postgrest.exceptions import APIError
from pydantic import BaseModel, ConfigDict, Field
from services import listening_blackeye as blackeye
from starlette.concurrency import run_in_threadpool
from config import settings
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
from services.pg_search import ilike_or_filter
from services.dictation_trends import classify_trends
from models.listening_dictation import (
    AdminDictationReportDetailResponse, AdminDictationReportListResponse,
    DictationAggregateResponse,
)
from services.listening_grader import (
    aggregate_dictation_report,
    grade_dictation,
    grade_mcq,
    grade_true_false,
    proper_noun_hints,
    split_sentences,
)
from services.active_player_lifecycle import (
    is_active_player_expired_error,
    is_resume_active,
    require_resume_active,
    resume_expires_at,
)

from ._common import (
    _is_dictation_attempt_conflict, _is_unique_violation, _require_auth, _rows_by_id,
    _student_audio_url_for_test, admin_router, logger, require_admin, user_router,
)
from .student_fulltest import _assert_listening_exam_content_allowed


# ── Test-linked dictation (chép chính tả) ────────────────────────────
#
# Reuses a listening test's audio + per-section transcripts. Unlike the
# content-based dictation (listening_exercises.segments with per-sentence
# audio timing), tests have no per-sentence timestamps, so we split the
# real section transcript into sentences and let the section audio play
# with free scrub. No timing is fabricated; grading compares the typed
# sentence to the real transcript sentence via the shared grade_dictation.


def _has_keep_change(value) -> bool:
    if isinstance(value, dict):
        type_keys = ("type", "qtype", "q_type", "question_type", "exercise_type", "template_kind", "variant")
        return (any(value.get(key) == "keep_change" for key in type_keys)
                or any(_has_keep_change(child) for child in value.values() if isinstance(child, (dict, list))))
    return isinstance(value, list) and any(_has_keep_change(child) for child in value)


def _dictation_units_for_content(section: dict) -> list[dict]:
    # Section transcripts have no reliable question-to-sentence mapping. Omit
    # a mixed KEEP/CHANGE section rather than transcribe its printed values.
    exercises = (supabase_admin.table("listening_exercises").select("exercise_type,payload")
                 .eq("content_id", section["id"]).execute().data or [])
    return _dictation_units({**section, "exercises": exercises})


def _dictation_units(section: dict) -> list[dict]:
    """Resolve a section's dictation units → ``[{text, start, end}]``.

    Prefers per-turn TIMED segments (``metadata.dictation_segments``, written
    by scripts/backfill_dictation_segments.py from the test's timings.json
    turns) so the player can auto-clip each unit to its exact audio window
    (which also skips the section intro — turns start after the preread).
    Falls back to sentence-splitting the raw transcript (start/end = None →
    free scrub) when no timing exists. Boot + grade both call this so their
    indices always agree.
    """
    if _has_keep_change(section):
        return []
    segs = (section.get("metadata") or {}).get("dictation_segments")
    if isinstance(segs, list) and segs:
        units = [
            {"text": (s.get("text") or "").strip(),
             "start": s.get("start"), "end": s.get("end")}
            for s in segs if (s.get("text") or "").strip()
        ]
        if units:
            return units
    return [{"text": t, "start": None, "end": None}
            for t in split_sentences(section.get("transcript") or "")]


def _section_cue_start(cue_points: list, section_num) -> float | None:
    """Earliest ``section_start`` cue timestamp for a section, so the
    dictation UI can seek the audio to the start of the chosen section.
    Returns None when no cue exists (audio starts at 0)."""
    best = None
    for cue in (cue_points or []):
        if (isinstance(cue, dict)
                and cue.get("type") == "section_start"
                and cue.get("section_num") == section_num):
            ts = cue.get("timestamp_seconds")
            if isinstance(ts, (int, float)) and (best is None or ts < best):
                best = float(ts)
    return best


@user_router.get("/tests/{test_id}/dictation")
async def get_listening_test_dictation(
    test_id: str,
    authorization: str | None = Header(default=None),
    class_item: str | None = None,
):
    """Boot test-linked dictation.

    Returns the test's audio + each section's transcript split into
    sentences. This endpoint DELIBERATELY exposes the transcript (the
    dictation reference) — it is separate from the player endpoint
    (``GET /tests/{id}``) which strips transcripts to prevent students
    reading the answers during a graded attempt.
    """
    _user = await _require_auth(authorization)

    res = (
        supabase_admin.table("listening_tests")
        .select("*")
        .eq("id", test_id)
        .eq("status", "published")
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Test bundle not found or not published")
    test = res.data[0]
    if blackeye.is_blackeye(test):
        raise HTTPException(422, "Black Eye dictation requires separate release.")
    _assert_listening_exam_content_allowed(test, _user.get("id"), class_item, allow_public=False)

    config = None
    done = {}
    if class_item:
        config = await run_in_threadpool(_class_drill_dictation_config, _user["id"], class_item, test_id)
        done = await run_in_threadpool(_class_drill_dictation_done, class_item)

    audio_url, audio_path, audio_duration = _student_audio_url_for_test(test)
    if not audio_url:
        raise HTTPException(
            422, "Test chưa có audio sẵn sàng — vui lòng quay lại sau.",
        )

    sec_res = (
        supabase_admin.table("listening_content")
        .select("id,section_num,title,transcript,metadata")
        .eq("test_id", test_id)
        .order("section_num")
        .execute()
    )
    cue_points = test.get("cue_points") or []
    sections_out: list[dict] = []
    for s in (sec_res.data or []):
        if config is not None and s["section_num"] not in config["sections"]:
            continue
        units = await run_in_threadpool(_dictation_units_for_content, s)
        sentences = [u["text"] for u in units]
        # Per-sentence audio windows (turn timing) when available → the
        # player auto-clips each sentence. null when the section has no
        # timing (→ free scrub of the whole section).
        timings = [
            {"start": u["start"], "end": u["end"]} if u["start"] is not None else None
            for u in units
        ]
        # Light proper-noun spelling hints per sentence (null when none) so
        # the learner isn't stuck spelling unfamiliar names from audio.
        hints = [proper_noun_hints(txt) or None for txt in sentences]
        sections_out.append({
            "section_num": s.get("section_num"),
            "title":       s.get("title"),
            "cue_start":   _section_cue_start(cue_points, s.get("section_num")),
            "sentences":   sentences,
            "timings":     timings if any(timings) else None,
            "hints":       hints if any(hints) else None,
        })

    return {
        "id":                     test["id"],
        "test_id":                test.get("test_id"),
        "title":                  test.get("title"),
        "audio_url":              audio_url,
        "audio_duration_seconds": audio_duration,
        "cue_points":             cue_points,
        "sections":               sections_out,
        **({"completed_sections": done, "dictation_required": config["dictation_required"]}
           if config is not None else {}),
    }


class ListeningTestDictationGradeRequest(BaseModel):
    test_id:         str
    section_num:     int
    sentence_idx:    int = Field(ge=0)
    user_transcript: str = Field(default="", max_length=10_000)
    grading_version: Literal["legacy-whitespace-v1"] | None = None


@user_router.post("/tests/dictation/grade", response_model=DictationGrade, response_model_exclude_unset=True)
async def grade_listening_test_dictation(
    body: ListeningTestDictationGradeRequest,
    authorization: str | None = Header(default=None),
    class_item: str | None = None,
):
    """Grade one sentence of test-linked dictation.

    Stateless (v1 — no persistence): re-splits the section transcript on
    the server and grades ``sentences[sentence_idx]`` against the typed
    text. Returns the same shape as the content-based dictation grader so
    the frontend diff renderer is reused verbatim.
    """
    _user = await _require_auth(authorization)

    # Gate on published status BEFORE reading any transcript. grade_dictation
    # echoes the missed reference words back in the diff, so an authenticated
    # user with a draft test ID could otherwise extract its transcript
    # sentence by sentence — even though the boot endpoint 404s on drafts.
    # Shared loader: published + exam_only, both BEFORE any transcript read.
    _published_test_for_dictation(body.test_id, _user.get("id"), class_item)
    if class_item:
        await run_in_threadpool(_validate_class_dictation_section, _user["id"], class_item, body.test_id, body.section_num)

    sec_res = (
        supabase_admin.table("listening_content")
        .select("id,transcript,metadata")
        .eq("test_id", body.test_id)
        .eq("section_num", body.section_num)
        .limit(1)
        .execute()
    )
    if not sec_res.data:
        raise HTTPException(404, "Section không tồn tại cho test này.")

    # Same unit resolution as the boot endpoint (timed segments → sentence
    # fallback) so the index the frontend submits maps to the right reference.
    units = await run_in_threadpool(_dictation_units_for_content, sec_res.data[0])
    if body.sentence_idx >= len(units):
        raise HTTPException(
            422,
            f"sentence_idx {body.sentence_idx} ngoài phạm vi "
            f"(section có {len(units)} câu).",
        )

    grade = grade_dictation(
        reference_transcript=units[body.sentence_idx]["text"],
        user_transcript=body.user_transcript,
        ignore_fillers=True,   # don't penalise missed hesitations (um / er / oh)
    )
    return {**grade, "grading_version": LEGACY_POLICY_VERSION,
            "reference_sha256": None,
            "sentence_reference_sha256": text_sha256(units[body.sentence_idx]["text"])}


# ── Dictation completion report (persisted) + content flags ──────────


def _published_test_for_dictation(test_id: str, user_id=None, class_item: str | None = None) -> dict:
    """Fetch a published test row (id, test_id, title) or 404 — and enforce the
    exam_only reservation and live assignment dictation configuration.

    THE ONE loader for every dictation route. Dictation is built from the
    section TRANSCRIPT, i.e. the answer key read aloud, and `grade_dictation()`
    returns the missed `expected` words — so a caller who can hit these routes
    can reconstruct the paper one sentence index at a time. Gating only the boot
    route left grade/session/flag wide open (Codex adversarial review,
    2026-07-26).

    `exam_only` MUST be in the projection: the gate reads it off this row, and a
    column the query never fetched is always None. That exact mistake shipped
    four times in this feature.
    """
    res = (
        supabase_admin.table("listening_tests")
        .select("id,test_id,title,status,exam_only,is_public,public_practice_enabled,programme_id,metadata")
        .eq("id", test_id).eq("status", "published").limit(1).execute()
    )
    if not res.data:
        raise HTTPException(404, "Test bundle not found or not published")
    if blackeye.is_blackeye(res.data[0]):
        raise HTTPException(422, "Black Eye dictation requires separate release.")
    _assert_listening_exam_content_allowed(res.data[0], user_id, class_item, allow_public=False)
    if class_item:
        _class_drill_dictation_config(user_id, class_item, test_id)
    return res.data[0]


class DictationSentenceSubmit(BaseModel):
    sentence_idx:    int = Field(ge=0)
    user_transcript: str = Field(default="", max_length=10_000)
    listen_count:    int = Field(default=0, ge=0)
    time_seconds:    int | None = Field(default=None, ge=0)


class DictationAttemptStartRequest(BaseModel):
    renderer_affinity_protocol: Literal["claim-v1"] | None = None
    grading_version: Literal["legacy-whitespace-v1", "lexical-v2"] | None = None


class DictationAttemptAnswerRequest(BaseModel):
    user_transcript: str = Field(default="", max_length=10_000)
    listen_count:    int = Field(default=0, ge=0)
    time_seconds:    int | None = Field(default=None, ge=0)
    grading_version: Literal["legacy-whitespace-v1", "lexical-v2"] | None = None
    reference_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")


class DictationAttemptRendererAffinityRequest(BaseModel):
    renderer_affinity: Literal["legacy", "next"]


class DictationSessionRequest(BaseModel):
    attempt_id:         uuid.UUID | None = None
    test_id:            str = Field(min_length=1, max_length=100)
    section_num:        int = Field(ge=1)
    client_request_id:  uuid.UUID | None = None
    started_at:         str | None = None
    total_time_seconds: int | None = Field(default=None, ge=0)
    sentences:          list[DictationSentenceSubmit] = Field(default_factory=list, max_length=200)
    grading_version: Literal["legacy-whitespace-v1", "lexical-v2"] | None = None
    reference_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")


_DICTATION_POLICY_ERRORS = {code: {"model": DictationPolicyErrorResponse}
                            for code in (409, 422, 503)}


def _dictation_policy(action, *args, **kwargs):
    try:
        return action(*args, **kwargs)
    except DictationPolicyError as exc:
        raise HTTPException(exc.status_code, {"error_code": exc.code, "message": exc.message}) from None


@user_router.get("/tests/dictation/capabilities", response_model=DictationCapabilities)
async def dictation_grading_capabilities(authorization: str | None = Header(default=None)):
    await _require_auth(authorization)
    return {"new_start_versions": [LEGACY_POLICY_VERSION] + (
        [LEXICAL_POLICY_VERSION] if settings.DICTATION_LEXICAL_V2_ENABLED else []),
        "readable_versions": [LEGACY_POLICY_VERSION, LEXICAL_POLICY_VERSION]}


def _dictation_submission_fingerprint(body: DictationSessionRequest) -> str:
    """Bind an idempotency key to one exact canonical submission payload."""
    exclude = {"client_request_id"}
    if body.grading_version != LEXICAL_POLICY_VERSION:
        # Old receipts must keep their exact byte identity, including explicit
        # legacy ACKs added by a new consumer. No historical fingerprint rewrite.
        exclude.update({"grading_version", "reference_sha256"})
    payload = body.model_dump(mode="json", exclude=exclude)
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _dictation_session_response(row: dict, test_title: str | None = None) -> dict:
    """Return the stable completion contract from a persisted canonical row."""
    return {
        **_dictation_policy(session_contract, row),
        "session_id":         row.get("id"),
        "attempt_id":         row.get("attempt_id"),
        "client_request_id":  row.get("client_request_id"),
        "test_title":         test_title,
        "section_num":        row.get("section_num"),
        "total_time_seconds": row.get("total_time_seconds"),
        "total_sentences":    row.get("total_sentences", 0),
        "correct_count":      row.get("correct_count", 0),
        "accuracy":           row.get("accuracy", 0),
        "total_words":        row.get("total_words", 0),
        "correct_words":      row.get("correct_words", 0),
        "error_trends":       row.get("error_trends") or {},
        "results":            row.get("results") or [],
    }


def _dictation_attempt_or_404(
    attempt_id: str,
    user_id: str,
    *,
    require_in_progress: bool = False,
) -> dict:
    res = (
        supabase_admin.table("dictation_attempts").select("*")
        .eq("id", attempt_id).eq("user_id", user_id).limit(1).execute()
    )
    if not res.data:
        raise HTTPException(404, "Không tìm thấy lượt chép chính tả.", headers={"Cache-Control": "private, no-store"})
    row = res.data[0]
    if require_in_progress and row.get("status") != "in_progress":
        raise HTTPException(409, "Lượt chép chính tả này đã kết thúc.", headers={"Cache-Control": "private, no-store"})
    if require_in_progress:
        require_resume_active(row)
    return row


def _dictation_attempt_answers(attempt_id: str) -> list[dict]:
    res = (
        supabase_admin.table("dictation_attempt_answers").select("*")
        .eq("attempt_id", attempt_id).order("sentence_idx").execute()
    )
    return res.data or []


def _dictation_attempt_response(row: dict) -> dict:
    contract = _dictation_policy(frozen_contract, row)
    answers = []
    for answer in _dictation_attempt_answers(str(row.get("id"))):
        version = (LEGACY_POLICY_VERSION if answer.get("grading_version") is None
                   else answer["grading_version"])
        if version != contract["grading_version"] or (
                version == LEXICAL_POLICY_VERSION
                and answer.get("reference_sha256") != contract["reference_sha256"]):
            raise HTTPException(503, {"error_code": "dictation_policy_evidence_unavailable",
                                     "message": "Chính sách của câu đã lưu chưa khớp lượt Dictation."})
        answers.append({**answer, "grading_version": version})
    return {
        **contract,
        "attempt_id": row.get("id"),
        "test_id": row.get("test_id"),
        "section_num": row.get("section_num"),
        "status": row.get("status"),
        "renderer_affinity": row.get("renderer_affinity"),
        "started_at": row.get("started_at") or row.get("created_at"),
        "resume_expires_at": row.get("resume_expires_at"),
        "units": row.get("units_snapshot") or [],
        "answers": answers,
    }


def _class_drill_dictation_config(user_id: str, class_item: str, test_id: str) -> dict:
    from services.listening_drill_homework import drill_config

    try:
        assignment = validate_class_item_for_test(
            supabase_admin, user_id, class_item, skill="listening", test_id=test_id)
    except (ItemNotFoundError, TaskMismatchError) as exc:
        raise HTTPException(404, str(exc)) from exc
    except DeadlinePassedError as exc:
        raise HTTPException(409, str(exc)) from exc
    config = drill_config(assignment)
    if config is None or not config.get("sections"):
        raise HTTPException(404, "Bài giao không có phần chép chính tả.")
    submitted = (supabase_admin.table("listening_test_attempts").select("id")
                 .eq("class_assignment_item_id", class_item).eq("user_id", user_id)
                 .eq("test_id", test_id).eq("status", "submitted").limit(1).execute().data)
    if not submitted:
        raise HTTPException(409, "Hãy nộp phần nghe trước khi chép chính tả.")
    return config


def _assert_class_dictation_report_allowed(row: dict, user_id: str) -> None:
    """Authorize persisted results only, independently of live work gates.

    Reports contain references already returned at completion. A deadline,
    closed assignment, or departure from the class must not prevent recovery.
    New submissions and transcript readers still use the full live gate.
    """
    if row.get("user_id") != user_id:
        raise HTTPException(404, "Không tìm thấy phiên chép chính tả.")
    if class_item := row.get("class_assignment_item_id"):
        student = (supabase_admin.table("students").select("id")
                   .eq("user_id", user_id).limit(1).execute().data)
        owned = (supabase_admin.table("class_assignment_items").select("id")
                 .eq("id", class_item).eq("student_id", student[0]["id"])
                 .limit(1).execute().data) if student else []
        if not owned:
            raise HTTPException(404, "Bài tập không thuộc về học viên này")


def _class_drill_dictation_done(class_item: str) -> dict[int, str]:
    from services.listening_drill_homework import evidence_by_item

    reports = evidence_by_item(supabase_admin, [class_item]).get(class_item, [])
    return {row["section_num"]: row["id"] for row in reports}


def _validate_class_dictation_section(user_id: str, class_item: str, test_id: str, section_num: int) -> None:
    config = _class_drill_dictation_config(user_id, class_item, test_id)
    if section_num not in config["sections"]:
        raise HTTPException(404, "Đoạn này không thuộc bài chép chính tả được giao.")


def _find_latest_in_progress_dictation_attempt(
    user_id: str, test_id: str, section_num: int, class_item: str | None = None,
) -> dict | None:
    def query():
        return (supabase_admin.table("dictation_attempts").select("*")
                .eq("user_id", user_id).eq("test_id", test_id)
                .eq("section_num", section_num).eq("status", "in_progress")
                .order("created_at", desc=True).limit(1))

    try:
        scoped = (query().eq("class_assignment_item_id", class_item) if class_item
                  else query().is_("class_assignment_item_id", "null"))
        res = scoped.execute()
    except APIError as exc:
        # Older databases have only the public attempt scope. Never use the
        # unfiltered read for homework or on an unrelated database failure.
        if class_item or exc.code != "42703" or "class_assignment_item_id" not in str(exc.message):
            raise
        res = query().execute()
    return res.data[0] if res.data else None


def _find_in_progress_dictation_attempt(
    user_id: str, test_id: str, section_num: int, class_item: str | None = None,
) -> dict | None:
    """Read-only resume lookup; expired audit rows are not resumable."""
    row = _find_latest_in_progress_dictation_attempt(user_id, test_id, section_num, class_item)
    return row if row and is_resume_active(row) else None


def _dictation_section_units_snapshot(test_id: str, section_num: int) -> list[dict]:
    sec_res = (
        supabase_admin.table("listening_content").select("id,transcript,metadata")
        .eq("test_id", test_id).eq("section_num", section_num)
        .limit(1).execute()
    )
    if not sec_res.data:
        raise HTTPException(404, "Section không có nội dung chép chính tả.")
    units = _dictation_units_for_content(sec_res.data[0])
    if not units:
        raise HTTPException(404, "Section không có nội dung chép chính tả.")
    return [
        {
            "text": unit["text"],
            "start": unit.get("start"),
            "end": unit.get("end"),
            "hints": proper_noun_hints(unit["text"]) or [],
        }
        for unit in units
    ]


@user_router.get("/tests/{test_id}/dictation/attempts/in-progress", response_model=DictationResumeResponse,
                 response_model_exclude_unset=True, responses=_DICTATION_POLICY_ERRORS)
async def get_in_progress_dictation_attempt(
    test_id: str,
    section_num: int = Query(ge=1),
    authorization: str | None = Header(default=None),
    class_item: str | None = None,
):
    user = await _require_auth(authorization)
    _published_test_for_dictation(test_id, user.get("id"), class_item)
    if class_item:
        await run_in_threadpool(_validate_class_dictation_section, user["id"], class_item, test_id, section_num)
    row = _find_in_progress_dictation_attempt(user["id"], test_id, section_num, class_item)
    return {"attempt": _dictation_attempt_response(row) if row else None}


@user_router.post("/tests/{test_id}/dictation/attempts", response_model=DictationAttemptStartResponse,
                 response_model_exclude_unset=True, responses=_DICTATION_POLICY_ERRORS)
@observe_operation("listening_dictation", "start", correlate_by=("test_id", "section_num", "body"))
async def start_dictation_attempt(
    test_id: str,
    section_num: int = Query(ge=1),
    body: DictationAttemptStartRequest | None = None,
    authorization: str | None = Header(default=None),
    class_item: str | None = None,
):
    """Resume the one active section attempt, or create it without destroying progress."""
    user = await _require_auth(authorization)
    _published_test_for_dictation(test_id, user.get("id"), class_item)
    if class_item:
        await run_in_threadpool(_validate_class_dictation_section, user["id"], class_item, test_id, section_num)
    if class_item and section_num in await run_in_threadpool(_class_drill_dictation_done, class_item):
        raise HTTPException(409, "Đoạn chính tả này đã nộp.")
    previous = _find_latest_in_progress_dictation_attempt(
        user["id"], test_id, section_num, class_item,
    )
    if previous and is_resume_active(previous):
        bind_owned_attempt(previous)
        return {**_dictation_attempt_response(previous), "created": False}
    requested_version = body.grading_version if body else None
    if requested_version == LEXICAL_POLICY_VERSION and not settings.DICTATION_LEXICAL_V2_ENABLED:
        raise HTTPException(503, {"error_code": "dictation_new_policy_disabled",
                                 "message": "Chính sách chấm từ mới chưa được mở cho lượt mới."})
    # V2 author/content gates run before retiring an expired parent or any
    # write. Default legacy retains its deployed retirement/error ordering.
    units_snapshot = None
    frozen_hash = None
    if requested_version == LEXICAL_POLICY_VERSION:
        units_snapshot = _dictation_section_units_snapshot(test_id, section_num)
        frozen_hash = _dictation_policy(validate_new_lexical_source, units_snapshot)
    admit_start()
    if previous:
        # Preserve every answer row, but retire the expired parent from the
        # partial one-active index before creating a fresh attempt. This stays
        # on POST; the GET resume lookup above remains strictly read-only.
        previous_id = previous["id"]
        abandoned_result = None
        try:
            abandoned_result = supabase_admin.table("dictation_attempts").update({
                "status": "abandoned",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", previous_id).eq("status", "in_progress").execute()
        finally:
            # A missing acknowledgement leaves commit state unknown. Record
            # only a diagnostic gap, then preserve the original exception.
            note_abandoned_dictation_attempt(
                abandoned_result, attempt_id=previous_id, test_id=test_id,
                user_id=user["id"], section_num=section_num,
            )

    if units_snapshot is None:
        units_snapshot = _dictation_section_units_snapshot(test_id, section_num)
        if requested_version:
            frozen_hash = _dictation_policy(reference_sha256, units_snapshot)
    now = datetime.now(timezone.utc).isoformat()
    expires_at = resume_expires_at(now)
    attempt_id = str(uuid.uuid4())
    payload = {
        "id": attempt_id,
        "user_id": user["id"],
        "test_id": test_id,
        "section_num": section_num,
        "status": "in_progress",
        "units_snapshot": units_snapshot,
        "started_at": now,
        "resume_expires_at": expires_at,
        "created_at": now,
        "updated_at": now,
    }
    if class_item:
        payload["class_assignment_item_id"] = class_item
    if requested_version:
        payload.update(grading_version=requested_version, reference_sha256=frozen_hash)
    affinity_aware = body is not None and body.renderer_affinity_protocol == "claim-v1"
    if affinity_aware:
        payload["renderer_affinity"] = None
    try:
        supabase_admin.table("dictation_attempts").insert(payload).execute()
    except Exception as exc:
        if not _is_unique_violation(exc):
            logger.error("[dictation-attempt] create failed: %s", exc)
            raise HTTPException(500, "Không tạo được lượt chép chính tả.")
        existing = _find_in_progress_dictation_attempt(user["id"], test_id, section_num, class_item)
        if not existing:
            raise HTTPException(409, "Không thể xác định lượt chép chính tả đang mở.")
        bind_owned_attempt(existing)
        return {**_dictation_attempt_response(existing), "created": False}
    bind_owned_attempt(payload, started=True)
    return {
        **_dictation_attempt_response(payload),
        "renderer_affinity": None if affinity_aware else "legacy",
        "created": True,
    }


@user_router.post("/tests/dictation/attempts/{attempt_id}/renderer-affinity")
async def claim_dictation_attempt_renderer_affinity(
    attempt_id: uuid.UUID,
    body: DictationAttemptRendererAffinityRequest,
    authorization: str | None = Header(default=None),
):
    user = await _require_auth(authorization)
    owned_attempt = _dictation_attempt_or_404(
        str(attempt_id), user["id"], require_in_progress=True,
    )
    await run_in_threadpool(_published_test_for_dictation, owned_attempt["test_id"], user["id"],
                            owned_attempt.get("class_assignment_item_id"))
    try:
        result = supabase_admin.rpc(
            "fn_claim_dictation_attempt_renderer_affinity",
            {
                "p_attempt_id": str(attempt_id),
                "p_user_id": user["id"],
                "p_renderer_affinity": body.renderer_affinity,
            },
        ).execute()
    except Exception as exc:
        logger.error("[dictation-affinity] claim failed attempt=%s: %s", attempt_id, exc)
        if is_active_player_expired_error(exc):
            require_resume_active(owned_attempt)
            raise HTTPException(410, "Lượt chép chính tả đã hết thời gian tiếp tục.") from exc
        raise HTTPException(500, "Không thể xác nhận phiên bản Dictation.")
    rows = result.data or []
    if len(rows) != 1:
        raise HTTPException(404, "Lượt chép chính tả không còn hoạt động.")
    affinity = rows[0].get("renderer_affinity")
    if affinity not in {"legacy", "next"}:
        raise HTTPException(500, "Lượt chép chính tả chưa có renderer hợp lệ.")
    return {"attempt_id": str(attempt_id), "renderer_affinity": affinity}


@user_router.post("/tests/dictation/attempts/{attempt_id}/sentences/{sentence_idx}",
                 response_model=DictationSentenceGrade, response_model_exclude_unset=True,
                 responses=_DICTATION_POLICY_ERRORS)
@observe_operation("listening_dictation", "save", correlate_by=("attempt_id", "sentence_idx", "body"))
async def grade_and_save_dictation_attempt_sentence(
    attempt_id: uuid.UUID,
    sentence_idx: int,
    body: DictationAttemptAnswerRequest,
    authorization: str | None = Header(default=None),
):
    """Grade and atomically upsert the latest canonical state of one sentence."""
    if sentence_idx < 0:
        raise HTTPException(422, "sentence_idx phải từ 0 trở lên.")
    user = await _require_auth(authorization)
    attempt = _dictation_attempt_or_404(
        str(attempt_id), user["id"], require_in_progress=True,
    )
    bind_owned_attempt(attempt)
    if class_item := attempt.get("class_assignment_item_id"):
        await run_in_threadpool(_validate_class_dictation_section, user["id"], class_item,
                                attempt["test_id"], attempt["section_num"])
    _published_test_for_dictation(attempt["test_id"], user.get("id"),
                                  attempt.get("class_assignment_item_id"))
    units = attempt.get("units_snapshot") or []
    if not units:
        raise HTTPException(409, "Lượt làm bài thiếu snapshot nội dung; vui lòng bắt đầu lại.")
    if sentence_idx >= len(units):
        raise HTTPException(422, f"sentence_idx {sentence_idx} ngoài phạm vi.")
    grade = _dictation_policy(grade_frozen_sentence, attempt, sentence_idx, body.user_transcript,
        grading_version=body.grading_version, acknowledged_reference_sha256=body.reference_sha256)
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "attempt_id": str(attempt_id),
        "sentence_idx": sentence_idx,
        "user_transcript": body.user_transcript,
        "score": grade["score"],
        "correct_words": grade["correct_words"],
        "total_words": grade["total_words"],
        "diff": grade["diff"],
        "listen_count": body.listen_count,
        "time_seconds": body.time_seconds,
        "updated_at": now,
    }
    if grade["grading_version"] == LEXICAL_POLICY_VERSION:
        row.update(grading_version=LEXICAL_POLICY_VERSION, reference_sha256=grade["reference_sha256"],
                   sentence_reference_sha256=grade["sentence_reference_sha256"], grading_evidence=grade)
    try:
        supabase_admin.table("dictation_attempt_answers").upsert(
            row, on_conflict="attempt_id,sentence_idx",
        ).execute()
        supabase_admin.table("dictation_attempts").update({"updated_at": now}) \
            .eq("id", str(attempt_id)).eq("user_id", user["id"]) \
            .eq("status", "in_progress").execute()
    except Exception as exc:
        logger.error("[dictation-attempt] sentence save failed attempt=%s: %s", attempt_id, exc)
        if is_active_player_expired_error(exc):
            require_resume_active(attempt)
            raise HTTPException(410, "Lượt chép chính tả đã hết thời gian tiếp tục.") from exc
        if _is_dictation_attempt_conflict(exc):
            raise HTTPException(409, "Lượt làm bài đã thay đổi; hãy tải lại tiến độ.")
        raise HTTPException(500, "Không lưu được tiến độ câu này.")
    return {**grade, **row}


def _dictation_session_by_request(user_id: str, request_id: uuid.UUID) -> dict | None:
    res = (
        supabase_admin.table("dictation_sessions").select("*")
        .eq("user_id", user_id).eq("client_request_id", str(request_id))
        .limit(1).execute()
    )
    return res.data[0] if res.data else None


def _dictation_session_by_attempt(user_id: str, attempt_id: uuid.UUID) -> dict | None:
    res = (
        supabase_admin.table("dictation_sessions").select("*")
        .eq("user_id", user_id).eq("attempt_id", str(attempt_id))
        .limit(1).execute()
    )
    return res.data[0] if res.data else None


def _assert_dictation_request_replay(
    row: dict,
    body: DictationSessionRequest,
    fingerprint: str,
) -> None:
    # Even a pre-fingerprint receipt cannot accept an old-client write to v2.
    contract = _dictation_policy(session_contract, row)
    _dictation_policy(require_write_contract, {
        **contract, "grading_version": row.get("grading_version"),
        "units_snapshot": [{"text": item["reference"]} for item in sorted(
            row.get("results") or [], key=lambda item: item.get("sentence_idx", -1))]
        if contract["reference_sha256"] else None,
    }, grading_version=body.grading_version, acknowledged_reference_sha256=body.reference_sha256)
    if row.get("test_id") != body.test_id or row.get("section_num") != body.section_num:
        raise HTTPException(409, "Mã gửi lại đã được dùng cho một bài chép chính tả khác.")
    if body.attempt_id and row.get("attempt_id") != str(body.attempt_id):
        raise HTTPException(409, "Mã gửi lại đã được dùng cho một lượt chép chính tả khác.")
    stored_fingerprint = row.get("submission_fingerprint")
    if stored_fingerprint and stored_fingerprint != fingerprint:
        raise HTTPException(409, "Nội dung gửi lại không khớp với lần nộp đầu tiên.")


def _assert_dictation_attempt_submission(
    attempt: dict,
    body: DictationSessionRequest,
) -> None:
    if attempt.get("test_id") != body.test_id \
            or attempt.get("section_num") != body.section_num:
        raise HTTPException(409, "Lượt chép chính tả không khớp bài hoặc section.")
    saved = _dictation_attempt_answers(str(attempt["id"]))
    submitted = sorted(body.sentences, key=lambda item: item.sentence_idx)
    if len(saved) != len(submitted):
        raise HTTPException(409, "Vẫn còn câu chưa được máy chủ xác nhận.")
    for canonical, incoming in zip(saved, submitted):
        if canonical.get("sentence_idx") != incoming.sentence_idx \
                or canonical.get("user_transcript") != incoming.user_transcript \
                or int(canonical.get("listen_count") or 0) != incoming.listen_count \
                or canonical.get("time_seconds") != incoming.time_seconds:
            raise HTTPException(409, "Tiến độ canonical không khớp payload hoàn tất.")


def _mark_dictation_attempt_completed(row: dict, user_id: str) -> None:
    attempt_id = row.get("attempt_id")
    if not attempt_id:
        return
    now = row.get("completed_at") or datetime.now(timezone.utc).isoformat()
    mutation_observed_at = datetime.now(timezone.utc).isoformat()
    try:
        updated = (
            supabase_admin.table("dictation_attempts")
            .update({"status": "completed", "completed_at": now, "updated_at": now})
            .eq("id", attempt_id).eq("user_id", user_id)
            .eq("status", "in_progress")
            .gt("resume_expires_at", mutation_observed_at)
            .execute()
        )
        if updated.data:
            return
        current = _dictation_attempt_or_404(str(attempt_id), user_id)
        if current.get("status") == "completed":
            return
        if current.get("status") == "in_progress":
            require_resume_active(current)
        raise HTTPException(409, "Lượt làm bài đã thay đổi; hãy tải lại trạng thái.")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[dictation-attempt] completion reconciliation failed: %s", exc)
        raise HTTPException(500, "Kết quả đã ghi nhưng chưa đóng được lượt làm bài; hãy thử xác nhận lại.")


@user_router.post("/tests/dictation/session", response_model=DictationSessionResponse,
                 response_model_exclude_unset=True, responses=_DICTATION_POLICY_ERRORS)
@observe_operation("listening_dictation", "submit", correlate_by=("body",))
async def submit_listening_dictation_session(
    body: DictationSessionRequest,
    authorization: str | None = Header(default=None),
):
    """Persist a completed dictation section + return its summary report.

    The server RE-GRADES every sentence from the submitted text (canonical
    truth — never trusts client-computed scores) via the same units + grader
    the grade endpoint uses, rolls up accuracy + error trends, and stores one
    dictation_sessions row. Returns the report the completion screen renders.
    """
    user = await _require_auth(authorization)
    if not body.sentences:
        raise HTTPException(422, "Chưa có câu nào để tổng kết.")

    fingerprint = _dictation_submission_fingerprint(body)
    if body.client_request_id:
        existing = _dictation_session_by_request(user["id"], body.client_request_id)
        if existing:
            await run_in_threadpool(_assert_class_dictation_report_allowed, existing, user["id"])
            _assert_dictation_request_replay(existing, body, fingerprint)
            _mark_dictation_attempt_completed(existing, user["id"])
            if existing.get("attempt_id"):
                bind_owned_attempt({"id": existing["attempt_id"], "user_id": user["id"]})
            return _dictation_session_response(existing)

    attempt = None
    if body.attempt_id:
        existing = _dictation_session_by_attempt(user["id"], body.attempt_id)
        if existing:
            await run_in_threadpool(_assert_class_dictation_report_allowed, existing, user["id"])
            _assert_dictation_request_replay(existing, body, fingerprint)
            _mark_dictation_attempt_completed(existing, user["id"])
            bind_owned_attempt({"id": existing.get("attempt_id"), "user_id": user["id"]})
            return _dictation_session_response(existing)
        attempt = _dictation_attempt_or_404(
            str(body.attempt_id), user["id"], require_in_progress=True,
        )
        bind_owned_attempt(attempt)
        if attempt.get("status") != "in_progress":
            raise HTTPException(409, "Lượt chép chính tả này đã kết thúc.")
        _dictation_policy(require_write_contract, attempt, grading_version=body.grading_version,
                          acknowledged_reference_sha256=body.reference_sha256)
        if class_item := attempt.get("class_assignment_item_id"):
            await run_in_threadpool(_validate_class_dictation_section, user["id"], class_item,
                                    body.test_id, body.section_num)
        _assert_dictation_attempt_submission(attempt, body)
    elif body.grading_version == LEXICAL_POLICY_VERSION or body.reference_sha256 is not None:
        raise HTTPException(409, {"error_code": "dictation_versioned_attempt_required",
                                 "message": "Chính sách mới cần một lượt Dictation đã lưu; hãy tải lại."})

    test = _published_test_for_dictation(body.test_id, user.get("id"),
                                          (attempt or {}).get("class_assignment_item_id"))
    sec_res = (
        supabase_admin.table("listening_content")
        .select("id,title,transcript,metadata")
        .eq("test_id", body.test_id).eq("section_num", body.section_num)
        .limit(1).execute()
    )
    if not sec_res.data and not attempt:
        raise HTTPException(404, "Section không tồn tại cho test này.")
    units = ((attempt.get("units_snapshot") or []) if attempt
             else await run_in_threadpool(_dictation_units_for_content, sec_res.data[0]))
    if not units:
        raise HTTPException(409, "Lượt làm bài thiếu snapshot nội dung; vui lòng bắt đầu lại.")

    # A completion report must cover the WHOLE section exactly once. Reject a
    # subset / duplicate / out-of-range index set so a client can't persist a
    # partial run as "total_sentences=1, accuracy=100%" and corrupt the report
    # + admin analytics.
    submitted = sorted(s.sentence_idx for s in body.sentences)
    if submitted != list(range(len(units))):
        raise HTTPException(
            422, f"Phải nộp đúng tất cả {len(units)} câu của phần này, mỗi câu một lần.")

    graded: list[dict] = []
    results: list[dict] = []
    for s in body.sentences:
        reference = units[s.sentence_idx]["text"]
        g = (_dictation_policy(grade_frozen_sentence, attempt, s.sentence_idx, s.user_transcript,
             grading_version=body.grading_version, acknowledged_reference_sha256=body.reference_sha256)
             if attempt else grade_dictation(reference_transcript=reference,
                                             user_transcript=s.user_transcript, ignore_fillers=True))
        graded.append(g)
        ops = {"miss": 0, "wrong": 0, "extra": 0}
        for op in g["diff"]:
            if not op.get("filler") and op["op"] in ops:
                ops[op["op"]] += 1
        results.append({
            "sentence_idx":  s.sentence_idx,
            "reference":     reference,
            "user_text":     s.user_transcript,
            "score":         g["score"],
            "correct_words": g["correct_words"],
            "total_words":   g["total_words"],
            "diff":          g["diff"],
            "listen_count":  s.listen_count,
            "time_seconds":  s.time_seconds,
            "ops":           ops,
        })
        if g.get("grading_version") == LEXICAL_POLICY_VERSION:
            results[-1].update(grading_version=LEXICAL_POLICY_VERSION,
                reference_sha256=g["reference_sha256"], sentence_reference_sha256=g["sentence_reference_sha256"],
                grading_evidence=g)

    report = aggregate_dictation_report(graded)
    session_id = str(uuid.uuid4())
    row = {
        "id":                 session_id,
        "attempt_id":         str(body.attempt_id) if body.attempt_id else None,
        "user_id":            user["id"],
        "test_id":            body.test_id,
        "test_id_external":   test.get("test_id"),
        "section_num":        body.section_num,
        "section_title":      sec_res.data[0].get("title") if sec_res.data else None,
        "total_sentences":    report["total_sentences"],
        "correct_count":      report["correct_count"],
        "accuracy":           report["accuracy"],
        "total_words":        report["total_words"],
        "correct_words":      report["correct_words"],
        "total_time_seconds": body.total_time_seconds,
        "results":            results,
        "error_trends":       report["error_trends"],
        "started_at":         body.started_at,
        "completed_at":       datetime.now(timezone.utc).isoformat(),
    }
    if attempt and attempt.get("class_assignment_item_id"):
        row["class_assignment_item_id"] = attempt["class_assignment_item_id"]
    if attempt and attempt.get("grading_version"):
        row.update(grading_version=attempt["grading_version"], reference_sha256=attempt.get("reference_sha256"))
    # Preserve the legacy no-receipt write shape during a migration-first
    # rollout: old clients keep working even if code reaches an instance before
    # migration 210, while the dark Next route remains gated until schema-ready.
    if body.client_request_id:
        row.update({
            "client_request_id": str(body.client_request_id),
            "submission_fingerprint": fingerprint,
        })
    try:
        supabase_admin.table("dictation_sessions").insert(row).execute()
    except Exception as exc:  # pragma: no cover
        if is_active_player_expired_error(exc):
            raise HTTPException(
                410, "Lượt chép chính tả đã hết thời gian tiếp tục."
            ) from exc
        if _is_unique_violation(exc):
            existing = (
                _dictation_session_by_request(user["id"], body.client_request_id)
                if body.client_request_id else None
            )
            if not existing and body.attempt_id:
                existing = _dictation_session_by_attempt(user["id"], body.attempt_id)
            if existing:
                await run_in_threadpool(_assert_class_dictation_report_allowed, existing, user["id"])
                _assert_dictation_request_replay(existing, body, fingerprint)
                _mark_dictation_attempt_completed(existing, user["id"])
                return _dictation_session_response(existing, test.get("title"))
        if _is_dictation_attempt_conflict(exc):
            raise HTTPException(409, "Tiến độ vừa thay đổi ở phiên khác; hãy tải lại rồi hoàn tất lại.")
        logger.error("[dictation] session insert failed: %s", exc)
        raise HTTPException(500, "Không lưu được kết quả chép chính tả.")

    _mark_dictation_attempt_completed(row, user["id"])
    return _dictation_session_response(row, test.get("title"))


@user_router.get("/tests/dictation/session/by-request/{client_request_id}", response_model=DictationSessionResponse,
                 response_model_exclude_unset=True, responses=_DICTATION_POLICY_ERRORS)
async def get_listening_dictation_session_by_request(
    client_request_id: uuid.UUID,
    authorization: str | None = Header(default=None),
):
    """Reconcile an ambiguous completion POST by its durable client receipt."""
    user = await _require_auth(authorization)
    row = _dictation_session_by_request(user["id"], client_request_id)
    if not row:
        raise HTTPException(404, "Chưa tìm thấy phiên cho mã gửi này.")
    await run_in_threadpool(_assert_class_dictation_report_allowed, row, user["id"])
    _mark_dictation_attempt_completed(row, user["id"])
    return _dictation_session_response(row)


@user_router.get("/tests/dictation/session/{session_id}", response_model=DictationStoredSessionResponse,
                 response_model_exclude_unset=True, responses=_DICTATION_POLICY_ERRORS)
async def get_listening_dictation_session(
    session_id: str,
    authorization: str | None = Header(default=None),
):
    """Re-read a dictation session report (owner only)."""
    user = await _require_auth(authorization)
    res = (
        supabase_admin.table("dictation_sessions").select("*")
        .eq("id", session_id).eq("user_id", user["id"]).limit(1).execute()
    )
    if not res.data:
        raise HTTPException(404, "Không tìm thấy phiên chép chính tả.")
    row = res.data[0]
    await run_in_threadpool(_assert_class_dictation_report_allowed, row, user["id"])
    return {**row, **_dictation_policy(session_contract, row)}


class DictationFlagRequest(BaseModel):
    test_id:      str
    section_num:  int
    sentence_idx: int | None = None
    category:     str | None = None
    note:         str | None = Field(default=None, max_length=2_000)


@user_router.post("/tests/dictation/flag")
async def flag_listening_dictation(
    body: DictationFlagRequest,
    authorization: str | None = Header(default=None),
    class_item: str | None = None,
):
    """Report a content error in a dictation sentence. Reuses the shared
    user_feedback inbox (type='report', skill='listening') so it shows up in
    the existing /admin/feedback admin — no dictation-specific admin needed."""
    from datetime import datetime, timezone

    user = await _require_auth(authorization)
    category = (body.category or "").strip() or None
    note = (body.note or "").strip() or None
    if not category and not note:
        raise HTTPException(422, "Cần chọn loại lỗi hoặc nhập mô tả.")

    test = _published_test_for_dictation(body.test_id, user.get("id"), class_item)
    if class_item:
        await run_in_threadpool(_validate_class_dictation_section, user["id"], class_item, body.test_id, body.section_num)
    context = f"[chép chính tả · section {body.section_num}"
    context += f" · câu {body.sentence_idx + 1}]" if body.sentence_idx is not None else "]"
    flag_id = str(uuid.uuid4())
    try:
        supabase_admin.table("user_feedback").insert({
            "id":         flag_id,
            "type":       "report",
            "skill":      "listening",
            "attempt_id": None,             # dictation is attempt-free (nullable, no FK)
            "test_id":    test.get("test_id"),
            "q_num":      (body.sentence_idx + 1) if body.sentence_idx is not None else None,
            "category":   category,
            "note":       f"{context} {note}".strip() if note else context,
            "status":     "new",
            "created_by": user["id"],
            "created_at": datetime.now(timezone.utc).isoformat(),
        }).execute()
    except Exception as exc:  # pragma: no cover
        logger.error("[dictation] flag insert failed: %s", exc)
        raise HTTPException(500, "Không gửi được báo lỗi.")
    return {"id": flag_id, "status": "new"}


def _all_dictation_user_ids(user_query: str) -> list:
    """Resolve every matching learner ID without a silent search cap."""
    user_ids: list = []
    page_size = 1000
    offset = 0
    while True:
        page = (supabase_admin.table("users").select("id")
                .or_(ilike_or_filter(["email", "display_name"], user_query.strip()))
                .order("id")
                .range(offset, offset + page_size - 1).execute().data or [])
        user_ids.extend(row["id"] for row in page if row.get("id"))
        if len(page) < page_size:
            return list(dict.fromkeys(user_ids))
        offset += page_size


_DICTATION_USER_FILTER_BATCH_SIZE = 100


def _dictation_user_batches(user_ids: list | None) -> list[list | None]:
    """Keep PostgREST ``in`` filters below practical URL-length limits."""
    if user_ids is None:
        return [None]
    return [user_ids[start:start + _DICTATION_USER_FILTER_BATCH_SIZE]
            for start in range(0, len(user_ids), _DICTATION_USER_FILTER_BATCH_SIZE)]


def _dictation_list_rows_for_users(
    select_fields: str,
    test_id: str | None,
    user_ids: list,
    candidate_limit: int,
) -> tuple[list[dict], int]:
    """Read ordered per-batch candidates and sum disjoint exact totals.

    The global first N rows must be contained in the first N rows of every
    disjoint user batch, so this avoids loading the entire filtered history.
    """
    rows: list[dict] = []
    total = 0
    page_size = 1000
    for user_batch in _dictation_user_batches(user_ids):
        offset = 0
        remaining = candidate_limit
        batch_total: int | None = None
        while remaining > 0:
            take = min(page_size, remaining)
            q = supabase_admin.table("dictation_sessions").select(select_fields, count="exact")
            if test_id:
                q = q.eq("test_id_external", test_id)
            response = (q.in_("user_id", user_batch)
                        .order("created_at", desc=True).order("id", desc=True)
                        .range(offset, offset + take - 1).execute())
            page = response.data or []
            if batch_total is None:
                batch_total = getattr(response, "count", None) or 0
                total += batch_total
            rows.extend(page)
            if len(page) < take:
                break
            offset += take
            remaining -= take
    return rows, total


@admin_router.get("/dictation-reports", response_model=AdminDictationReportListResponse,
                  response_model_exclude_unset=True,
                  responses={503: {"model": DictationPolicyErrorResponse}})
async def admin_list_dictation_reports(
    test_id: str | None = Query(default=None),
    user_query: str | None = Query(default=None),
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    authorization: str | None = Header(default=None),
):
    """Admin: list dictation sessions (newest first), filter theo external test
    id và/hoặc học viên (user_query ilike email/tên). Mỗi item kèm danh tính
    học viên (audit 2026-07-17: list từng trả user_id trần — admin không biết
    "học viên nào"). Returns {items, total, limit, offset}."""
    await require_admin(authorization)
    select_fields = ("id,user_id,test_id_external,section_num,section_title,"
                     "total_sentences,correct_count,accuracy,total_time_seconds,"
                     "completed_at,created_at,grading_version,reference_sha256")
    if user_query:
        uids = _all_dictation_user_ids(user_query)
        if not uids:
            return {"items": [], "total": 0, "limit": limit, "offset": offset,
                    "association_lookup_failed": False,
                    "association_lookup_failures": []}
        matching_rows, total = _dictation_list_rows_for_users(
            select_fields, test_id, uids, offset + limit)
        matching_rows.sort(
            key=lambda row: (str(row.get("created_at") or ""), str(row.get("id") or "")),
            reverse=True,
        )
        items = matching_rows[offset:offset + limit]
    else:
        q = supabase_admin.table("dictation_sessions").select(select_fields, count="exact")
        if test_id:
            q = q.eq("test_id_external", test_id)
        res = (q.order("created_at", desc=True).order("id", desc=True)
               .range(offset, offset + limit - 1).execute())
        items = res.data or []
        total = getattr(res, "count", None) or 0
    items = [{**row, **_dictation_policy(persisted_policy_identity, row)} for row in items]
    lookup_failures: set[str] = set()
    users = _rows_by_id("users", [r.get("user_id") for r in items],
                        "id,email,display_name", lookup_failures=lookup_failures)
    for r in items:
        u = users.get(r.get("user_id")) or {}
        r["user"] = {"id": r.get("user_id"), "email": u.get("email"),
                     "display_name": u.get("display_name")}
    return {"items": items, "total": total,
            "limit": limit, "offset": offset,
            "association_lookup_failed": bool(lookup_failures),
            "association_lookup_failures": sorted(lookup_failures)}


def _all_dictation_aggregate_rows(test_id: str | None, user_ids: list | None) -> list[dict]:
    """Read the complete aggregate scope in bounded ID and row pages."""
    rows: list[dict] = []
    page_size = 1000
    for user_batch in _dictation_user_batches(user_ids):
        offset = 0
        while True:
            q = supabase_admin.table("dictation_sessions").select(
                "test_id_external,section_num,accuracy,total_sentences,error_trends,grading_version,reference_sha256")
            if test_id:
                q = q.eq("test_id_external", test_id)
            if user_batch is not None:
                q = q.in_("user_id", user_batch)
            page = q.order("id").range(
                offset, offset + page_size - 1).execute().data or []
            rows.extend(page)
            if len(page) < page_size:
                break
            offset += page_size
    return rows


@admin_router.get("/dictation-reports/aggregate", response_model=DictationAggregateResponse,
                  responses={503: {"model": DictationPolicyErrorResponse}})
async def admin_dictation_reports_aggregate(
    test_id: str | None = Query(default=None),
    user_query: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    """Admin: per-test analytics — mean accuracy + the words most often missed
    or typed wrong across sessions, so weak/ambiguous content surfaces.
    Nhận CÙNG bộ lọc với list (test_id + user_query) — số tổng hợp phải cùng
    phạm vi với bảng phiên, không được lệch (review P2, PR #809)."""
    await require_admin(authorization)
    user_ids = None
    if user_query:
        user_ids = _all_dictation_user_ids(user_query)
        if not user_ids:
            return {"session_count": 0, "mean_accuracy": 0.0,
                    "mean_accuracy_basis": "mean_of_session_sentence_scores",
                    "versions": [],
                    **classify_trends([])}
    rows = _all_dictation_aggregate_rows(test_id, user_ids)

    # Classify the complete persisted counters before top-N truncation. This
    # changes only the analytics projection, never reference diffs or grades.
    try:
        classified = classify_trends(rows)
    except ValueError:
        raise HTTPException(503, "Dữ liệu lỗi Dictation cần kiểm tra. Không thể tổng hợp chính xác.")
    accs = []
    by_version: dict[str, list[float]] = {}
    for row in rows:
        version = _dictation_policy(persisted_policy_identity, row)['grading_version']
        # NULL/missing/bool/non-finite accuracy cannot masquerade as a clean zero.
        value = row.get('accuracy')
        try:
            accuracy = float(value)
        except (TypeError, ValueError, OverflowError):
            raise HTTPException(503, 'Chưa xác minh được điểm Dictation đã lưu.') from None
        if isinstance(value, bool) or not 0 <= accuracy <= 1:
            raise HTTPException(503, 'Chưa xác minh được điểm Dictation đã lưu.')
        accs.append(accuracy)
        by_version.setdefault(version, []).append(accuracy)

    return {
        "session_count": len(rows),
        "mean_accuracy": round(sum(accs) / len(accs), 4) if accs else 0.0,
        "mean_accuracy_basis": "mean_of_session_sentence_scores",
        "versions": [{"grading_version": version, "session_count": len(scores),
                      "mean_accuracy": round(sum(scores) / len(scores), 4)}
                     for version, scores in sorted(by_version.items())],
        **classified,
    }


@admin_router.get("/dictation-reports/{session_id}", response_model=AdminDictationReportDetailResponse,
                  response_model_exclude_unset=True,
                  responses={503: {"model": DictationPolicyErrorResponse}})
async def admin_get_dictation_report(
    session_id: str,
    authorization: str | None = Header(default=None),
):
    """Admin: one session's full report (per-sentence detail + trends)."""
    await require_admin(authorization)
    res = (supabase_admin.table("dictation_sessions").select("*")
           .eq("id", session_id).limit(1).execute())
    if not res.data:
        raise HTTPException(404, "Không tìm thấy phiên chép chính tả.")
    row = dict(res.data[0])
    row.update(_dictation_policy(session_contract, row))
    lookup_failures: set[str] = set()
    users = _rows_by_id("users", [row.get("user_id")], "id,email,display_name",
                        lookup_failures=lookup_failures)
    user = users.get(row.get("user_id")) or {}
    row["user"] = {"id": row.get("user_id"), "email": user.get("email"),
                   "display_name": user.get("display_name")}
    row["association_lookup_failed"] = bool(lookup_failures)
    row["association_lookup_failures"] = sorted(lookup_failures)
    return row
