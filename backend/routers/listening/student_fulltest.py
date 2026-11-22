"""routers.listening.student_fulltest — student full-test layer (BACKENDSPLIT-0076 T006).

The "student full-test layer" block of the former single-file
routers/listening.py (lines 5192–6424), cut and pasted unchanged: published
test browse and detail, overview, lessons, player payloads and package status.
The package re-exports every name; tests patch ``routers.listening``, never
this module (see __init__.py).
"""

from __future__ import annotations

from services.listening_test_grader import score_fields as listening_score_fields
import asyncio
import uuid
from datetime import datetime, timezone
from functools import partial
from typing import Any, Literal, Optional
from fastapi import (
    APIRouter, File, Header, HTTPException, Query,
    UploadFile,
)
from pydantic import BaseModel, ConfigDict, Field
from models.listening_blackeye import (
    BlackEyeLearnerBinding, BlackEyeAttemptState, BlackEyeActivityReview,
    BlackEyeUnitPublic, BlackEyeSaveAck, BlackEyeInProgress,
)
from services import listening_blackeye as blackeye
from starlette.concurrency import run_in_threadpool
from config import settings
from database import supabase_admin
from services.class_assignment_service import (
    active_exam_assignment_references,
    DeadlinePassedError,
    ItemNotFoundError,
    TaskMismatchError,
    validate_class_item_for_test,
)
from services import test_data_visibility
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

from ._common import (
    _EXERCISE_TYPES, _fetch_attempt_or_404, _is_standalone_authoring_exercise,
    _require_auth, _sign_map_image_url, _student_audio_url_for_test, admin_router,
    logger, require_admin, user_router,
)
from .admin_audit import _sign_programme_visual_url


# ── Sprint 13.5 — student full-test layer ──────────────────────────────────


class TestAttemptAnswerPatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    q_num:       int
    user_answer: str


class PracticeCheckRequest(BaseModel):
    """One question of a Luyện nhanh run: answer it, or ask to be shown it."""
    model_config = ConfigDict(extra="forbid")
    q_num:       int
    user_answer: str = ""
    # Set on the "Xem đáp án" escape hatch. Never records an answer — the
    # canonical first answer must already be on file (and wrong) for the
    # server to hand the key over.
    reveal:      bool = False


class _ListeningAttemptStartRequest(BaseModel):
    """Opt in to first-player renderer claiming for a new attempt.

    A missing body is the N-1 contract and stays pinned to the database's
    Legacy default. ``claim-v1`` inserts NULL so the stable player URL can
    atomically own the attempt before any answer mutation.
    """

    renderer_affinity_protocol: Literal["claim-v1"] | None = None
    purpose: Literal["practice", "assigned_practice", "mock_delivery"] | None = None
    mock_sitting_id: uuid.UUID | None = None
    blackeye_binding: BlackEyeLearnerBinding | None = None


class _ListeningAttemptRendererAffinityRequest(BaseModel):
    renderer_affinity: Literal["legacy", "next"]


class _ListeningAttemptPlaybackStartedRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    playback_claim_id: uuid.UUID


# A row is audio-ready when EITHER path is present AND non-blank. The blank
# check matters: `''` is not NULL, so a bare `not.is.null` would count the row
# in SQL while the Python guard (`r.get(...)` falsy) and the signer both treat
# it as missing — reopening the very count-vs-list gap this endpoint closes.
# Nested and() inside or() is valid PostgREST and verified against the live DB.
_AUDIO_READY_OR = (
    "and(full_audio_storage_path.not.is.null,full_audio_storage_path.neq.),"
    "and(assembled_audio_storage_path.not.is.null,assembled_audio_storage_path.neq.)"
)
# Columns needed to judge readiness (below). Kept next to the rule so the two
# cannot drift.
_EXERCISE_READY_COLS = "content_id,exercise_type,segments,payload"


def _exercise_is_ready(row: dict) -> bool:
    """Can the mode page actually RUN this exercise, or only greet it?

    `status='published'` is not enough. `_ensure_dictation_exercise` inserts a
    published dictation row with an empty `segments` array the first time any
    user posts an attempt, and each mode page refuses its own empty shape:

        dictation   listening-dictation.js  needs segments[].length  > 0
        true_false  listening-tf.js         needs payload.statements[] > 0
        mcq         listening-mcq.js        needs payload.questions[]  > 0
        gist        _grade_and_save_gist    needs payload.model_answer

    Advertising a mode whose page then shows "chưa được phân câu" is the same
    dead end this module was reorganised to remove, one level down. So the
    availability check mirrors what the page requires.

    Gist is the nastiest of the four: its page RENDERS fine without a rubric
    (prompt_text falls back to a default), and only the submit 422s with
    "missing model_answer" — after the learner has written their summary. So
    readiness follows the GRADER's requirement, not the page's.
    """
    def _filled_list(v) -> bool:
        # The pages test `Array.isArray(x) && x.length`, so a truthiness check
        # here would pass malformed JSONB (an object, a string) that the page
        # then refuses — advertising a mode whose page shows its empty state.
        return isinstance(v, list) and len(v) > 0

    etype = row.get("exercise_type")
    payload = row.get("payload")
    if not isinstance(payload, dict):
        payload = {}
    if etype == "dictation":
        return _filled_list(row.get("segments"))
    if etype == "true_false":
        return _filled_list(payload.get("statements"))
    if etype == "mcq":
        return _filled_list(payload.get("questions"))
    if etype == "programme_form":
        return (payload.get("variant") == "programme_form_v1"
                and _filled_list(payload.get("questions")))
    if etype == "gist":
        return bool(str(payload.get("model_answer") or "").strip())
    return False


def _published_content_rows(*, accent_tag: str | None = None, cefr_level: str | None = None,
                            ielts_section: int | None = None, newest_first: bool = False) -> list[dict]:
    """Every published listening_content id, paged past the PostgREST cap.

    A bare `.select()` silently stops at 1000 rows, which would under-count
    the exercise-mode tiles the moment the library grows. Page explicitly.
    """
    out: list[dict] = []
    start, step = 0, 1000
    while True:
        query = (
            supabase_admin.table("listening_content")
            .select("id,test_id,audio_storage_path")
            .eq("status", "published")
            .neq("source_type", "programme_form")
        )
        if accent_tag:
            query = query.eq("accent_tag", accent_tag)
        if cefr_level:
            query = query.eq("cefr_level", cefr_level)
        if ielts_section is not None:
            query = query.eq("ielts_section", ielts_section)
        if newest_first:
            query = query.order("created_at", desc=True)
        # A unique tie-breaker keeps the metadata walk and card page aligned.
        res = query.order("id").range(start, start + step - 1).execute()
        rows = res.data or []
        out.extend(r for r in rows if r.get("id"))
        if len(rows) < step:
            return out
        start += step


def _published_content_ids() -> list[str]:
    return [row["id"] for row in _published_content_rows()]


_PROGRAMME_COPY = {
    SOURCE_PROGRAMME: {"title": "80 ngày luyện Listening", "description": "Bài luyện và tài liệu nguồn theo 80 ngày; không tính band IELTS."},
    "general-listening-practice": {
        "title": "General Listening",
        "description": "Luyện nghe theo bài học, tình huống và mục tiêu cụ thể.",
    },
    "ielts-listening-practice": {
        "title": "IELTS Listening Practice",
        "description": "Nghe, trả lời và đối chiếu từng câu. Bài luyện này không tính band IELTS.",
    },
}
_PROGRAMME_ORDER = {
    SOURCE_PROGRAMME: 2,
    "general-listening-practice": 0,
    "ielts-listening-practice": 1,
}


def _assisted_programme_attempt_ids(attempt_ids: list[str]) -> set[str]:
    """Read persisted reveal evidence with deterministic pagination.

    Do not infer assistance from a client flag or from a result-summary copy.
    The query is scoped to attempt IDs already owned by the authenticated
    learner at its caller; this service-role lookup never accepts raw client
    IDs on its own.
    """
    assisted: set[str] = set()
    for batch_start in range(0, len(attempt_ids), 100):
        batch = attempt_ids[batch_start:batch_start + 100]
        offset = 0
        while True:
            rows = (
                supabase_admin.table("listening_programme_feedback_reveals")
                .select("id,attempt_id").in_("attempt_id", batch)
                .order("id").range(offset, offset + 999).execute().data or []
            )
            assisted.update(str(row["attempt_id"]) for row in rows)
            if len(rows) < 1000:
                break
            offset += 1000
    return assisted


def _programme_attempt_state(user_id: str, test_rows: list[dict]) -> tuple[dict, bool]:
    """Canonical completion and resumable state per programme form.

    A current retake must not erase the learner's earlier completion. Keep the
    newest submitted attempt and the newest active free-practice attempt as
    independent facts so progress/history and resume actions can coexist.
    """
    test_ids = [str(row["id"]) for row in test_rows if row.get("id")]
    if not test_ids:
        return {}, False
    try:
        response = (
            supabase_admin.table("listening_test_attempts")
            .select(
                "id,test_id,status,answers,result_summary,started_at,submitted_at,"
                "resume_expires_at,created_at,class_assignment_item_id,sitting_id"
            )
            .eq("user_id", user_id)
            .in_("test_id", test_ids)
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as exc:  # deploy-order/partial-data state
        logger.warning("[listening-programmes] attempt progress unavailable: %s", exc)
        return {}, True
    try:
        assisted_ids = _assisted_programme_attempt_ids([
            str(row["id"]) for row in (response.data or [])
            if row.get("scoring_policy", "report_only") == "report_only"
            and not row.get("class_assignment_item_id")
            and not row.get("sitting_id")
        ])
    except Exception as exc:
        logger.warning("[listening-programmes] assistance lookup unavailable: %s", exc)
        return {}, True
    states: dict[str, dict[str, dict]] = {}
    for attempt in response.data or []:
        attempt = {**attempt, "assisted": str(attempt["id"]) in assisted_ids}
        # The programme hub is a free-practice surface. A class assignment or
        # mock sitting owns its own resume/navigation contract and must never
        # become the dominant hub CTA or recent free-practice activity.
        if attempt.get("class_assignment_item_id") or attempt.get("sitting_id"):
            continue
        if attempt.get("status") == "in_progress" and not is_resume_active(attempt):
            continue
        test_id = str(attempt.get("test_id") or "")
        if not test_id:
            continue
        status = str(attempt.get("status") or "")
        slot = "completed" if status == "submitted" else "in_progress" if status == "in_progress" else ""
        if slot and slot not in states.setdefault(test_id, {}):
            states[test_id][slot] = attempt
        if status == "submitted" and not attempt["assisted"]:
            states.setdefault(test_id, {}).setdefault("independent_completed", attempt)
    return states, False


def _programme_attempt_time(attempt: dict, preferred_field: str) -> float:
    """Comparable timestamp for programme activity; malformed legacy rows sort last."""
    raw = attempt.get(preferred_field) or attempt.get("created_at") or attempt.get("started_at")
    if not raw:
        return 0.0
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError, OverflowError):
        return 0.0


def _load_programme_overview(user_id: str) -> tuple[list[dict], dict | None, list[dict], bool]:
    try:
        packages = (
            supabase_admin.table("listening_content_packages")
            .select("id,programme_id,title")
            .eq("status", "published")
            .execute().data or []
        )
        packages.sort(key=lambda row: _PROGRAMME_ORDER.get(str(row.get("programme_id")), 99))
        programme_ids = [str(row["programme_id"]) for row in packages]
        if not programme_ids:
            return [], None, [], False
        lessons = (
            supabase_admin.table("listening_lessons")
            .select("id,programme_id")
            .eq("status", "published")
            .in_("programme_id", programme_ids)
            .execute().data or []
        )
        tests = (
            supabase_admin.table("listening_public_practice_catalog")
            .select(
                "id,title,programme_id,listening_lesson_id,source_item_count,created_at"
            )
            .eq("status", "published")
            .eq("is_public", True)
            .eq("scoring_policy", "report_only")
            .in_("programme_id", programme_ids)
            .execute().data or []
        )
    except Exception as exc:  # migration may deploy after code; old overview remains usable
        logger.warning("[listening-programmes] canonical overview unavailable: %s", exc)
        return [], None, [], True
    attempt_states, partial = _programme_attempt_state(user_id, tests)
    lesson_counts: dict[str, int] = {}
    for lesson in lessons:
        pid = str(lesson.get("programme_id") or "")
        lesson_counts[pid] = lesson_counts.get(pid, 0) + 1
    form_counts: dict[str, int] = {}
    completed: dict[str, int] = {}
    independent_completed: dict[str, int] = {}
    in_progress: dict[str, int] = {}
    test_by_id = {str(test["id"]): test for test in tests}
    for test in tests:
        pid = str(test.get("programme_id") or "")
        form_counts[pid] = form_counts.get(pid, 0) + 1
        state = attempt_states.get(str(test["id"]), {})
        if state.get("completed"):
            completed[pid] = completed.get(pid, 0) + 1
        if state.get("independent_completed"):
            independent_completed[pid] = independent_completed.get(pid, 0) + 1
        if state.get("in_progress"):
            in_progress[pid] = in_progress.get(pid, 0) + 1
    cards = []
    for package in packages:
        pid = str(package["programme_id"])
        copy = _PROGRAMME_COPY.get(pid, {})
        cards.append({
            "id": pid,
            "title": copy.get("title") or package.get("title") or pid,
            "description": copy.get("description") or "Thư viện luyện nghe.",
            "lesson_count": lesson_counts.get(pid, 0),
            "form_count": form_counts.get(pid, 0),
            "completed_form_count": completed.get(pid, 0),
            "independent_completed_form_count": independent_completed.get(pid, 0),
            "in_progress_form_count": in_progress.get(pid, 0),
        })
    resume = None
    recent: list[dict] = []
    ordered_attempts = sorted(
        (
            (test_id, state["completed"])
            for test_id, state in attempt_states.items()
            if state.get("completed")
        ),
        key=lambda item: _programme_attempt_time(item[1], "submitted_at"),
        reverse=True,
    )
    resume_attempts = sorted(
        (
            (test_id, attempt)
            for test_id, state in attempt_states.items()
            if (attempt := state.get("in_progress"))
        ),
        key=lambda item: _programme_attempt_time(item[1], "created_at"),
        reverse=True,
    )
    if resume_attempts:
        test_id, attempt = resume_attempts[0]
        test = test_by_id.get(test_id)
        if test:
            pid = str(test.get("programme_id") or "")
            answers = [
                value for value in (attempt.get("answers") or [])
                if str(value.get("user_answer") or "").strip()
            ]
            resume = {
                "attempt_id": str(attempt["id"]),
                "test_id": test_id,
                "title": str(test.get("title") or "Bài nghe đang làm"),
                "programme_id": pid,
                "lesson_id": str(test.get("listening_lesson_id") or ""),
                "answered_count": len(answers),
                "assisted": bool(attempt.get("assisted")),
                "item_count": int(test.get("source_item_count") or 0),
                "resume_expires_at": attempt.get("resume_expires_at"),
                "href": f"/listening/programmes/form/{test_id}",
            }
    for test_id, attempt in ordered_attempts:
        test = test_by_id.get(test_id)
        if not test:
            continue
        pid = str(test.get("programme_id") or "")
        summary = attempt.get("result_summary") or {}
        if attempt.get("status") == "submitted" and len(recent) < 3:
            recent.append({
                "attempt_id": str(attempt["id"]),
                "test_id": test_id,
                "title": str(test.get("title") or "Bài nghe"),
                "programme_id": pid,
                "status": "submitted",
                "submitted_at": attempt.get("submitted_at"),
                "checked_count": int(summary.get("checked_count") or 0),
                "correct_count": int(summary.get("correct_count") or 0),
                "unscored_count": int(summary.get("unscored_count") or 0),
                "assisted": bool(attempt.get("assisted")),
                "href": f"/listening/programmes/result/{attempt['id']}",
            })
    return cards, resume, recent, partial


_NO_HIDDEN: tuple[frozenset, frozenset] = (frozenset(), frozenset())


def _hidden_listening_ids(user: dict) -> tuple[frozenset, frozenset]:
    """TASK B2 — (test ids, content ids) of staging test data this viewer's
    catalogue drops. Content is matched by its own title or its parent test's,
    since section rows carry codes ("GATE-E-…") rather than the marked title."""
    if not test_data_visibility.hide_for(email=user.get("email"), user_id=user.get("id")):
        return _NO_HIDDEN
    return (frozenset(test_data_visibility.hidden_title_ids("listening_tests")),
            frozenset(test_data_visibility.hidden_title_ids("listening_content")))


def _drop_hidden_content(rows: list[dict], hidden: tuple[frozenset, frozenset]) -> list[dict]:
    hidden_tests, hidden_content = hidden
    if not hidden_tests and not hidden_content:
        return rows
    return [row for row in rows
            if str(row.get("id")) not in hidden_content
            and str(row.get("test_id") or "") not in hidden_tests]


def _published_test_counts(
    hidden_test_ids: frozenset = frozenset(),
) -> tuple[dict[str, int], dict[str, int], set[str]]:
    """Count all diagnostic shelves in one paged metadata read, without keys."""
    tests = {kind: 0 for kind in ("full", "mini", "drill", "practice")}
    groups: dict[str, int] = {}
    public_test_ids: set[str] = set()
    offset = 0
    while True:
        rows = (
            supabase_admin.table("listening_public_practice_catalog")
            .select("id,test_type,practice_group:metadata->>practice_group")
            .eq("status", "published")
            .eq("scoring_policy", "diagnostic")
            .eq("is_public", True)
            .or_(_AUDIO_READY_OR)
            .order("id")
            .range(offset, offset + 999)
            .execute().data or []
        )
        for row in rows:
            kind = row.get("test_type")
            if kind not in tests or str(row["id"]) in hidden_test_ids:
                continue
            tests[kind] += 1
            public_test_ids.add(str(row["id"]))
            if kind == "practice":
                group = (row.get("practice_group") or "").strip()
                if group:
                    groups[group] = groups.get(group, 0) + 1
        if len(rows) < 1000:
            return tests, groups, public_test_ids
        offset += 1000


def _browse_public_parents(content_rows: list[dict]) -> dict[str, dict]:
    parents: dict[str, dict] = {}
    parent_ids = sorted({str(row["test_id"]) for row in content_rows if row.get("test_id")})
    for start in range(0, len(parent_ids), 100):
        rows = (
            supabase_admin.table("listening_public_practice_catalog")
            .select("id,test_type")
            .in_("id", parent_ids[start:start + 100])
            .eq("status", "published")
            .eq("is_public", True)
            .eq("scoring_policy", "diagnostic")
            .or_(_AUDIO_READY_OR)
            .execute().data or []
        )
        parents.update({str(row["id"]): row for row in rows
                        if row.get("test_type") in {"full", "mini", "drill", "practice"}})
    return parents


def _published_content_modes(content_ids: list[str]) -> tuple[dict[str, list[str]], dict[str, int]]:
    modes = {kind: 0 for kind in sorted(_EXERCISE_TYPES)}
    by_content: dict[str, list[str]] = {}
    # Restrict before reading JSON: programme/source form payloads are large
    # and do not belong to this standalone library. UUID batches bound URL size.
    for batch_start in range(0, len(content_ids), 100):
        batch = content_ids[batch_start:batch_start + 100]
        offset = 0
        while True:
            rows = (
                supabase_admin.table("listening_exercises")
                .select(_EXERCISE_READY_COLS)
                .eq("status", "published")
                .in_("content_id", batch)
                .in_("exercise_type", sorted(_EXERCISE_TYPES - {"mini_test"}))
                .order("id")
                .range(offset, offset + 999)
                .execute().data or []
            )
            for row in rows:
                kind = row.get("exercise_type")
                if kind in modes and _exercise_is_ready(row):
                    modes[kind] += 1
                    bucket = by_content.setdefault(str(row["content_id"]), [])
                    if kind not in bucket:
                        bucket.append(kind)
            if len(rows) < 1000:
                break
            offset += 1000
    return by_content, modes


def _published_library_counts(
    hidden: tuple[frozenset, frozenset] = _NO_HIDDEN,
) -> tuple[list[dict], dict[str, int], set[str]]:
    content_rows = _drop_hidden_content(_published_content_rows(), hidden)
    audio_content_ids = [row["id"] for row in content_rows
                         if str(row.get("audio_storage_path") or "").strip()]
    by_content, modes = _published_content_modes(audio_content_ids)
    standalone_modes = {"dictation", "gist", "true_false", "mcq"}
    runnable_ids = {content_id for content_id, kinds in by_content.items()
                    if standalone_modes.intersection(kinds)}
    return content_rows, modes, runnable_ids


@user_router.get("/overview", response_model=ListeningOverviewResponse)
async def listening_overview(authorization: str | None = Header(default=None)):
    """Canonical counts and account-owned activity, without serial I/O stalls.

    The existing wire shape and published/audio/public-policy predicates remain
    unchanged. Independent reads run in worker threads: synchronous PostgREST
    must not block the application event loop or unrelated learner pages.
    """
    user = await _require_auth(authorization)
    hidden = await run_in_threadpool(_hidden_listening_ids, user)
    test_counts = (partial(_published_test_counts, hidden[0]) if hidden[0]
                   else _published_test_counts)
    library_counts = (partial(_published_library_counts, hidden) if hidden != _NO_HIDDEN
                      else _published_library_counts)
    (tests, practice_groups, public_test_ids), (content_rows, modes, runnable_ids), programme_data = await asyncio.gather(
        run_in_threadpool(test_counts),
        run_in_threadpool(library_counts),
        run_in_threadpool(_load_programme_overview, user["id"]),
    )
    programmes, resume, recent, partial_data = programme_data
    runnable_ids.update(str(row["id"]) for row in content_rows
                        if str(row.get("test_id") or "") in public_test_ids)
    return {
        "tests": tests,
        "practice_groups": practice_groups,
        "content": len(content_rows),
        "playable_content": len(runnable_ids),
        "exercise_modes": modes,
        "programmes": programmes,
        "resume": resume,
        "recent": recent,
        "partial_data": partial_data,
    }


@user_router.get(
    "/programmes/{programme_id}/lessons",
    response_model=ListeningLessonListResponse,
)
async def list_listening_programme_lessons(
    programme_id: str,
    progress: str = Query(default="all"),
    limit: int = Query(default=24, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    authorization: str | None = Header(default=None),
):
    user = await _require_auth(authorization)
    if programme_id == blackeye.PROGRAMME:
        blackeye.unavailable()
    if programme_id not in _PROGRAMME_COPY:
        raise HTTPException(404, "Listening programme not found")
    if progress not in {"all", "new", "in_progress", "completed"}:
        raise HTTPException(422, "progress must be all, new, in_progress or completed")
    lessons_response = (
        supabase_admin.table("listening_lessons")
        .select("id,source_lesson_id,title,instructions,outcomes,sequence_num", count="exact")
        .eq("programme_id", programme_id)
        .eq("status", "published")
        .order("sequence_num")
        .execute()
    )
    all_lessons = lessons_response.data or []
    lesson_ids = [str(row["id"]) for row in all_lessons]
    forms = (
        supabase_admin.table("listening_public_practice_catalog")
        .select("id,listening_lesson_id")
        .eq("programme_id", programme_id)
        .eq("status", "published")
        .eq("is_public", True)
        .eq("scoring_policy", "report_only")
        .execute().data or []
    )
    attempt_states, partial = _programme_attempt_state(user["id"], forms)
    by_lesson: dict[str, list[dict]] = {lesson_id: [] for lesson_id in lesson_ids}
    for form in forms:
        lesson_id = str(form.get("listening_lesson_id") or "")
        if lesson_id in by_lesson:
            by_lesson[lesson_id].append(form)

    items: list[dict] = []
    for lesson in all_lessons:
        lesson_forms = by_lesson.get(str(lesson["id"]), [])
        completed_count = sum(
            bool(attempt_states.get(str(form["id"]), {}).get("completed"))
            for form in lesson_forms
        )
        independent_completed_count = sum(
            bool(attempt_states.get(str(form["id"]), {}).get("independent_completed"))
            for form in lesson_forms
        )
        in_progress_count = sum(
            bool(attempt_states.get(str(form["id"]), {}).get("in_progress"))
            for form in lesson_forms
        )
        state = (
            "completed" if lesson_forms and completed_count == len(lesson_forms)
            else "in_progress" if completed_count or in_progress_count
            else "new"
        )
        if progress != "all" and state != progress:
            continue
        items.append({
            **lesson,
            "form_count": len(lesson_forms),
            "completed_form_count": completed_count,
            "independent_completed_form_count": independent_completed_count,
            "in_progress_form_count": in_progress_count,
        })
    paged = items[offset:offset + limit]
    return {
        "programme_id": programme_id,
        "items": paged,
        "total": len(items),
        "limit": limit,
        "offset": offset,
        "partial_data": partial,
    }


@user_router.get(
    "/lessons/{lesson_id}",
    response_model=ListeningLessonDetailResponse,
)
async def get_listening_programme_lesson(
    lesson_id: uuid.UUID,
    authorization: str | None = Header(default=None),
):
    user = await _require_auth(authorization)
    rows = (
        supabase_admin.table("listening_lessons")
        .select("id,programme_id,source_lesson_id,title,instructions,outcomes")
        .eq("id", str(lesson_id))
        .eq("status", "published")
        .limit(1)
        .execute().data or []
    )
    if not rows:
        raise HTTPException(404, "Listening lesson not found")
    lesson = rows[0]
    if lesson.get("programme_id") == blackeye.PROGRAMME:
        blackeye.unavailable()
    forms = (
        supabase_admin.table("listening_public_practice_catalog")
        .select(
            "id,test_id,source_form_id,title,form_purpose,replay_policy,"
            "support_policy,scoring_policy,source_item_count,"
            "full_audio_duration_seconds,metadata,created_at"
        )
        .eq("listening_lesson_id", str(lesson_id))
        .eq("status", "published")
        .eq("is_public", True)
        .order("created_at")
        .execute().data or []
    )
    attempt_states, partial = _programme_attempt_state(user["id"], forms)
    form_cards = []
    for form in forms:
        attempt_state = attempt_states.get(str(form["id"]), {})
        attempt = attempt_state.get("in_progress") or attempt_state.get("completed")
        status = "new"
        if attempt_state.get("in_progress"):
            status = "in_progress"
        elif attempt_state.get("completed"):
            status = "completed"
        form_cards.append({
            "id": str(form["id"]),
            "test_id": str(form.get("test_id") or ""),
            "source_form_id": str(form.get("source_form_id") or ""),
            "title": str(form.get("title") or "Bài nghe"),
            "purpose": str(form.get("form_purpose") or "practice"),
            "replay_policy": str(form.get("replay_policy") or "allowed"),
            "support_policy": str(form.get("support_policy") or "separate_mode"),
            "scoring_policy": str(form.get("scoring_policy") or "report_only"),
            "item_count": int(form.get("source_item_count") or 0),
            "duration_seconds": int(form.get("full_audio_duration_seconds") or 0),
            "checked_item_count": int((form.get("metadata") or {}).get("checked_item_count") or 0),
            "self_review_item_count": int((form.get("metadata") or {}).get("self_review_item_count") or 0),
            "status": status,
            "assisted": bool(attempt.get("assisted")) if attempt else False,
            "attempt_id": str(attempt["id"]) if attempt else None,
        })
    return {**lesson, "forms": form_cards, "partial_data": partial}


async def _change_listening_package_status(
    package_id: str,
    action: str,
    body: ListeningPackageStatusRequest,
    authorization: str | None,
) -> dict:
    actor = await require_admin(authorization)
    from services.listening_package_import import (
        PackageValidationError,
        set_package_status,
    )

    try:
        return set_package_status(
            supabase_admin,
            package_id=package_id,
            manifest_sha256=body.manifest_sha256,
            action=action,
            actor=str(actor.get("id")) if isinstance(actor, dict) and actor.get("id") else None,
            bucket_name=settings.LISTENING_AUDIO_BUCKET,
        )
    except PackageValidationError as exc:
        raise HTTPException(409, str(exc)) from exc
    except Exception as exc:
        message = str(exc)
        if "not_found" in message:
            raise HTTPException(404, "Listening package not found") from exc
        if "manifest_mismatch" in message:
            raise HTTPException(409, "Package manifest does not match") from exc
        logger.error("[listening-package] %s failed for %s: %s", action, package_id, exc)
        raise HTTPException(503, "Không thể đổi trạng thái package; hãy thử lại.") from exc


@admin_router.post(
    "/packages/{package_id}/publish",
    response_model=ListeningPackageStatusResponse,
)
async def publish_listening_package(
    package_id: str,
    body: ListeningPackageStatusRequest,
    authorization: str | None = Header(default=None),
):
    return await _change_listening_package_status(package_id, "publish", body, authorization)


@admin_router.post(
    "/packages/{package_id}/archive",
    response_model=ListeningPackageStatusResponse,
)
async def archive_listening_package(
    package_id: str,
    body: ListeningPackageStatusRequest,
    authorization: str | None = Header(default=None),
):
    return await _change_listening_package_status(package_id, "archive", body, authorization)


@user_router.get("/tests", response_model=ListeningTestListResponse)
async def list_published_listening_tests(
    test_type: str | None = Query(default=None),
    programme_id: str | None = Query(default=None),
    practice_group: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    authorization: str | None = Header(default=None),
):
    """Student-facing list of published Cambridge IELTS test bundles.

    Hard-filters ``status='published'`` AND audio satisfied (full or
    assembled present). Each row carries the calling user's best score
    + total/submitted attempt counts so the tests list can render truthful
    "Bắt đầu" vs "Làm lại" CTAs without a follow-up round-trip.

    test_type segregates the full-test, mini-test and skill-drill libraries,
    reading the real ``test_type`` column (mig 157 — NOT NULL, CHECK
    full|mini|drill; legacy NULL-metadata rows were backfilled to 'full'):
      - "mini"  → ONLY mini tests.
      - "drill" → ONLY skill drills (listening Skills Practice).
      - "full" / omitted (default) → ONLY full tests.
    """
    user = await _require_auth(authorization)
    # Validate only a real string value. When the handler is called directly
    # (unit tests), an omitted Query() param arrives as its FieldInfo sentinel,
    # not None — `isinstance str` keeps that from tripping a false 422.
    if isinstance(test_type, str) and test_type not in ("mini", "full", "drill", "practice"):
        raise HTTPException(422, "test_type must be 'mini', 'full', 'drill' or 'practice'")
    explicit_programme = programme_id if isinstance(programme_id, str) else None
    if explicit_programme not in {None, "ielts", *_PROGRAMME_COPY}:
        raise HTTPException(422, "programme_id is not supported")
    hidden_test_ids = (await run_in_threadpool(_hidden_listening_ids, user))[0]

    q = (
        supabase_admin.table("listening_public_practice_catalog")
        .select("*", count="exact")
        .eq("status", "published")
        # Audio-readiness is filtered in SQL, BEFORE .range(). It used to be a
        # Python post-filter over the fetched page, which quietly made
        # pagination wrong: a page of `limit` rows could shed no-audio rows and
        # return fewer, with no way for the caller to tell short-page from
        # last-page. It also broke the /overview invariant — the tile counts
        # over the whole filtered set, so a no-audio row inside page 1 made the
        # badge disagree with the page. Same predicate, evaluated in one place.
        .eq("is_public", True)
        .or_(_AUDIO_READY_OR)
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
    )
    if explicit_programme in _PROGRAMME_COPY:
        q = q.eq("programme_id", explicit_programme).eq("scoring_policy", "report_only")
    else:
        # Omitted programme_id (and the legacy `ielts` value) keep the deployed
        # scored-library behavior exactly as before.
        q = q.eq("scoring_policy", "diagnostic")
        if explicit_programme:
            q = q.eq("programme_id", explicit_programme)

    selected_type = test_type if isinstance(test_type, str) else None
    if selected_type in ("mini", "drill", "practice"):
        q = q.eq("test_type", selected_type)
    elif explicit_programme in _PROGRAMME_COPY:
        # Imported programme forms are practice units. This default applies
        # only when the caller explicitly requests a programme, so the legacy
        # omitted-test_type contract remains the Full Test list.
        q = q.eq("test_type", "practice")
    else:
        q = q.eq("test_type", "full")
    # Practice is one library with three tabs; `group` narrows to a tab. Applied
    # in SQL so paging stays correct per tab (a Python filter over an already
    # paged result would shed rows and shorten pages).
    if selected_type == "practice" and isinstance(practice_group, str) and practice_group:
        q = q.eq("metadata->>practice_group", practice_group)
    if hidden_test_ids:
        # Staging test data (TASK B2) — excluded in SQL so total/paging hold.
        q = q.not_.in_("id", sorted(hidden_test_ids))
    res = q.execute()
    # Audio-readiness is already applied in SQL above; this repeat is a cheap
    # backstop so a row could never reach a student with no file to play, even
    # if the `.or_()` expression were mangled. It is a no-op in normal service.
    rows = [
        r for r in (res.data or [])
        if r.get("full_audio_storage_path") or r.get("assembled_audio_storage_path")
    ]

    # Per-user stats — single round trip across all visible test IDs.
    test_ids = [r["id"] for r in rows]
    user_best:            dict[str, int] = {}
    user_score_fields: dict[str, dict] = {}
    user_count:           dict[str, int] = {}
    user_submitted_count: dict[str, int] = {}
    if test_ids:
        try:
            attempt_query = (
                supabase_admin.table("listening_test_attempts")
                .select("test_id,score,status,grading_details")
                .eq("user_id", user["id"])
                .in_("test_id", test_ids)
            )
            if selected_type == "drill":
                attempt_query = attempt_query.is_("class_assignment_item_id", "null").is_("sitting_id", "null")
            att_res = attempt_query.execute()
            for att in att_res.data or []:
                tid = att.get("test_id")
                if not tid:
                    continue
                user_count[tid] = user_count.get(tid, 0) + 1
                if att.get("status") == "submitted":
                    user_submitted_count[tid] = user_submitted_count.get(tid, 0) + 1
                if att.get("status") == "submitted":
                    fields = listening_score_fields(att.get("score"), att.get("grading_details") or [])
                    if tid not in user_score_fields:
                        user_score_fields[tid] = fields
                if att.get("status") == "submitted" and fields["score"] is not None:
                    prev = user_best.get(tid)
                    if prev is None or att["score"] > prev:
                        user_best[tid] = att["score"]
                        user_score_fields[tid] = fields
        except Exception as exc:                                             # pragma: no cover
            logger.warning("[listening] attempts lookup failed: %s", exc)

    out_items: list[dict] = []
    for r in rows:
        md = r.get("metadata") or {}
        out_items.append({
            "id":                   r["id"],
            "test_id":              r.get("test_id"),
            "title":                r.get("title"),
            "band_target":          r.get("band_target"),
            "themes":               r.get("themes") or {},
            "accent_profile":       r.get("accent_profile") or [],
            "audio_assembly_mode":  r.get("audio_assembly_mode"),
            # Skill-drill discriminators — let the Skills-Practice page group by
            # type + level without a per-row round-trip. Null for full/mini.
            "drill_type":           md.get("drill_type"),
            "practice_group":       md.get("practice_group"),
            "trap":                 md.get("trap"),
            "level":                md.get("level"),
            "task":                 md.get("task"),
            "programme_id":         r.get("programme_id") or "ielts",
            "listening_lesson_id":  r.get("listening_lesson_id"),
            "source_form_id":       r.get("source_form_id"),
            "form_purpose":         r.get("form_purpose"),
            "scoring_policy":       r.get("scoring_policy") or "diagnostic",
            "replay_policy":        r.get("replay_policy"),
            "support_policy":       r.get("support_policy"),
            "claim_policy":         r.get("claim_policy"),
            "source_item_count":    r.get("source_item_count"),
            "user_best_score":              user_best.get(r["id"]),
            **{k: v for k, v in user_score_fields.get(r["id"], {}).items() if k != "score"},
            "user_attempt_count":           user_count.get(r["id"], 0),
            "user_submitted_attempt_count": user_submitted_count.get(r["id"], 0),
        })

    return {
        "items":  out_items,
        "total":  res.count if res.count is not None else len(out_items),
        "limit":  limit,
        "offset": offset,
    }


def _listening_test_is_public(test: dict) -> bool:
    """Canonical visibility, with a deploy-order fallback for old rows/fakes."""
    if "is_public" in test:
        return bool(test.get("is_public"))
    return bool(test.get("public_practice_enabled")) or not bool(test.get("exam_only"))


def _assert_listening_exam_content_allowed(
    test: dict, user_id, class_item: str | None = None, *, allow_public: bool = True,
    purpose="delivery", sitting_id=None, allow_admission=False
) -> dict:
    """A test reserved for mock exams is served ONLY to a student sitting one.

    Hiding it from the browse list is not enough — a direct link went straight
    through the detail / dictation / attempt-start endpoints. But the mock runner
    loads Listening through these SAME student endpoints, so a blanket refusal
    would break the exam this flag protects: the entitlement is the sitting
    (mig 170).

    404, not 403: to anyone without a sitting the paper does not exist, and
    "forbidden" would confirm the test id is real.
    """
    from services.mock_paper_policy import authorize
    return authorize(supabase_admin, "listening", test["id"], user_id,
        purpose=purpose if allow_public else "dictation", class_item_id=class_item,
        sitting_id=sitting_id, allow_admission=allow_admission)


def _assemble_listening_player_payload(test: dict, *, include_audio: bool = True, snapshot=None) -> dict:
    """Build the student-safe player contract for public and admin preview."""
    if blackeye.is_blackeye(test):
        raise HTTPException(503, "Black Eye player contract unavailable.")
    from services import listening_test_grader as grader

    test_id = str(test["id"])
    audio_duration = test.get("full_audio_duration_seconds")
    audio_url = None
    audio_path = None
    if include_audio:
        audio_url, audio_path, audio_duration = _student_audio_url_for_test(test)
        if not audio_url:
            raise HTTPException(422, "Test chưa có audio sẵn sàng — vui lòng quay lại sau.")

    if snapshot is not None:
        from services.mock_player_context import listening_snapshot_sources
        section_rows, raw_exercises = listening_snapshot_sources(snapshot)
        raw_exercises = [exercise for exercise in raw_exercises if not _is_standalone_authoring_exercise(exercise)]
    else:
        section_rows = (
            supabase_admin.table("listening_content")
            .select("id,section_num,title,transcript,metadata")
            .eq("test_id", test_id).order("section_num").execute().data or []
        )
        section_ids = [section["id"] for section in section_rows]
        exercises_res = (
            supabase_admin.table("listening_exercises")
            .select("id,content_id,exercise_type,payload,order_num")
            .in_("content_id", section_ids).order("order_num").execute()
            if section_ids else None
        )
        raw_exercises = [exercise for exercise in ((exercises_res.data if exercises_res else []) or [])
                         if not _is_standalone_authoring_exercise(exercise)]
    source_required = test.get("programme_id") == SOURCE_PROGRAMME
    if source_required and (not raw_exercises or any((exercise.get("payload") or {}).get("source_contract") != SOURCE_CONTRACT for exercise in raw_exercises)):
        raise HTTPException(503, "Hợp đồng nội dung nguồn chưa hợp lệ.")
    from services.mock_player_context import without_private_marking
    exercises = grader.strip_answer_keys(without_private_marking(raw_exercises))
    source_fields = {}
    if source_required:
        from services.listening_source_collection import sign_source_block
        source_manifest = None
        if test.get("content_package_id"):
            try:
                packages = (supabase_admin.table("listening_content_packages").select("manifest_sha256")
                            .eq("id", test["content_package_id"]).eq("programme_id", SOURCE_PROGRAMME)
                            .eq("status", "published").limit(1).execute().data or [])
            except Exception as exc:
                raise HTTPException(503, "Không xác định được phiên bản đề nguồn; hãy thử lại.") from exc
            if len(packages) == 1:
                source_manifest = packages[0].get("manifest_sha256")
        for exercise in exercises:
            payload = exercise["payload"]
            payload["source_blocks"] = [sign_source_block(block, _sign_programme_visual_url,
                manifest_sha256=source_manifest,
                runtime_questions=[question for question in payload.get("questions") or []
                                   if question.get("source_block_id") == block.get("block_id")])
                for block in payload.get("source_blocks") or []]
            source_fields = {"source_collection_id": "80-days", "source_day": payload.get("source_day"),
                "source_part_label": payload.get("source_part_label"), "audio_granularity": (test.get("metadata") or {}).get("timing_granularity", "whole_day"),
                "source_blocks": payload["source_blocks"]}

    for exercise in exercises:
        payload = exercise.get("payload") or {}
        if payload.get("variant") == "programme_form_v1":
            payload = dict(payload)
            questions = []
            for raw_question in payload.get("questions") or []:
                question = dict(raw_question) if isinstance(raw_question, dict) else {}
                if source_required:
                    # After native binding: digests stay on the original options.
                    from services.listening_source_text_overrides import override_question_options
                    question = override_question_options(question, manifest_sha256=source_manifest)
                question.pop("visual_url", None)
                storage_path = question.pop("visual_storage_path", None)
                if storage_path and not source_required:
                    visual_url = _sign_programme_visual_url(storage_path)
                    if not visual_url:
                        raise HTTPException(
                            503,
                            "Không thể tải sơ đồ của bài nghe — vui lòng thử lại sau.",
                        )
                    question["visual_url"] = visual_url
                raw_translation = question.pop("editorial_translation", None)
                if isinstance(raw_translation, dict):
                    # Only display fields cross the pre-submit boundary. The
                    # importer controls this shape, but persisted JSONB may be
                    # malformed or changed independently of an import.
                    translation = {
                        key: raw_translation[key]
                        for key in (
                            "status", "source_item_id", "source_language",
                            "target_language", "source_prompt", "source_options",
                            "prompt", "options", "unchanged_options_reviewed",
                            "visual_accessibility",
                        )
                        if key in raw_translation
                    }
                    translated_storage_path = raw_translation.get("visual_storage_path")
                    if translated_storage_path and not source_required:
                        translated_url = _sign_programme_visual_url(translated_storage_path)
                        if not translated_url:
                            raise HTTPException(
                                503,
                                "Không thể tải sơ đồ của bài nghe — vui lòng thử lại sau.",
                            )
                        translation["visual_url"] = translated_url
                    question["editorial_translation"] = translation
                questions.append(question)
            payload["questions"] = questions
            exercise["payload"] = payload
        is_plan = (
            payload.get("variant") == "mcq_letter_label"
            or payload.get("template_kind") == "plan_label"
        )
        storage_path = payload.get("map_image_storage_path")
        signed_url = _sign_map_image_url(storage_path, expires_in=7200) if storage_path else None
        if is_plan or signed_url:
            payload = dict(payload)
            if signed_url:
                payload["map_image_url"] = signed_url
            if is_plan:
                payload.pop("map_description", None)
                payload.pop("map_image_custom_prompt", None)
                if isinstance(payload.get("metadata"), dict):
                    payload["metadata"] = dict(payload["metadata"])
                    payload["metadata"].pop("map_description", None)
                    payload["metadata"].pop("map_image_custom_prompt", None)
            exercise["payload"] = payload

    by_content: dict[str, list[dict]] = {}
    for exercise in exercises:
        by_content.setdefault(exercise["content_id"], []).append(exercise)
    sections = []
    for section in section_rows:
        metadata = section.get("metadata") or {}
        sections.append({
            "section_num": section.get("section_num"),
            "title": section.get("title"),
            "narrator_intro": metadata.get("narrator_intro"),
            "context": metadata.get("context"),
            "exercises": by_content.get(section["id"], []),
        })
    return {
        **source_fields,
        "id": test["id"],
        "test_id": test.get("test_id"),
        "title": test.get("title"),
        "test_type": test.get("test_type"),
        "programme_id": test.get("programme_id") or "ielts",
        "listening_lesson_id": test.get("listening_lesson_id"),
        "source_form_id": test.get("source_form_id"),
        "form_purpose": test.get("form_purpose"),
        "scoring_policy": test.get("scoring_policy") or "diagnostic",
        "replay_policy": test.get("replay_policy"),
        "support_policy": test.get("support_policy"),
        "claim_policy": test.get("claim_policy"),
        "source_item_count": test.get("source_item_count"),
        "themes": test.get("themes") or {},
        "audio_url": audio_url,
        "audio_storage_path": audio_path,
        "audio_duration_seconds": audio_duration,
        "cue_points": test.get("cue_points") or [],
        "sections": sections,
    }


@admin_router.get("/tests/{test_id}/player-preview")
async def admin_listening_player_preview(
    test_id: uuid.UUID,
    authorization: str | None = Header(default=None),
):
    """Render any lifecycle state with the exact student player contract."""
    await require_admin(authorization)
    rows = (
        supabase_admin.table("listening_tests").select("*")
        .eq("id", str(test_id)).limit(1).execute().data or []
    )
    if not rows:
        raise HTTPException(404, "Test bundle not found")
    return _assemble_listening_player_payload(rows[0])


@user_router.get("/tests/{test_id}", response_model=ListeningPlayerResponse)
async def get_published_listening_test(
    test_id: uuid.UUID,
    class_item: str | None = None,
    attempt_id: uuid.UUID | None = None,
    sitting_id: uuid.UUID | None = None,
    authorization: str | None = Header(default=None),
):
    """Fetch a published test bundle for the student player.

    Includes a signed audio URL (2h TTL — covers test duration with buffer),
    section rows with narrator intros, and exercises **with answer keys
    stripped**. A ``replay_policy=once`` form additionally requires its owned
    active ``attempt_id``; after playback has started, the same safe bundle is
    returned without another audio URL.
    """
    _user = await _require_auth(authorization)
    test_id = str(test_id)

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
        await run_in_threadpool(blackeye.require_published, supabase_admin, test)
        raise HTTPException(503, "Black Eye player contract unavailable.")
    free_drill = test.get("test_type") == "drill" and test.get("is_public") and not class_item and not sitting_id
    # The generic delivery resolver considers all open class and public
    # attempts when no class_item is passed. Select the public scope
    # explicitly so a simultaneous homework attempt is never ambiguous.
    decision = _assert_listening_exam_content_allowed(
        test, _user.get("id"), class_item, sitting_id=sitting_id,
        purpose="practice" if free_drill else "delivery")
    if free_drill and not attempt_id:
        free_query = (supabase_admin.table("listening_test_attempts").select("id")
                      .eq("user_id", _user["id"]).eq("test_id", test_id).eq("status", "in_progress")
                      .is_("class_assignment_item_id", "null").is_("sitting_id", "null")
                      .gt("resume_expires_at", datetime.now(timezone.utc).isoformat())
                      .order("created_at", desc=True).limit(1))
        free_attempts = (await run_in_threadpool(free_query.execute)).data or []
        if free_attempts:
            decision["attempt_id"] = free_attempts[0]["id"]
    from services.mock_paper_policy import owned_delivery_snapshot, attempt_receipt
    attempt, snapshot = owned_delivery_snapshot(supabase_admin, "listening", test_id, _user["id"], decision,
                                               attempt_id=attempt_id)
    if (attempt is not None and test.get("test_type") == "drill" and not sitting_id
            and decision["attempt_purpose"] != "mock_delivery"
            and attempt.get("class_assignment_item_id") != class_item):
        raise HTTPException(404, "Lượt làm không thuộc ngữ cảnh bài nghe này.")
    if snapshot is not None:
        test = snapshot["paper_row"]
    include_audio = True
    if test.get("replay_policy") == "once":
        if attempt_id is None:
            raise HTTPException(409, "Bài nghe một lượt cần một attempt đang hoạt động.")
        attempt = attempt or _fetch_attempt_or_404(str(attempt_id), _user["id"])
        if str(attempt.get("test_id")) != test_id:
            raise HTTPException(422, "Attempt không thuộc bài nghe này.")
        if attempt.get("status") != "in_progress":
            raise HTTPException(422, "Attempt không còn hoạt động.")
        require_resume_active(attempt)
        include_audio = not bool(attempt.get("playback_started_at"))
    payload = _assemble_listening_player_payload(test, include_audio=include_audio, snapshot=snapshot)
    if attempt is not None:
        from services.mock_attempt_flags import review_flag_state
        payload.update(attempt_receipt(attempt))
        payload.update(review_flag_state(supabase_admin, "listening", attempt))
    if class_item:
        from services.listening_drill_homework import drill_config
        try:
            assignment = await run_in_threadpool(
                validate_class_item_for_test, supabase_admin, _user["id"], class_item,
                skill="listening", test_id=test_id)
        except (ItemNotFoundError, TaskMismatchError) as exc:
            raise HTTPException(404, str(exc)) from exc
        except DeadlinePassedError as exc:
            raise HTTPException(409, str(exc)) from exc
        if config := drill_config(assignment):
            payload["skill_drill_homework"] = config
    return payload
