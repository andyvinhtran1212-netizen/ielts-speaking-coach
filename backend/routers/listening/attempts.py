"""routers.listening.attempts — Listening test attempts (BACKENDSPLIT-0076 T008).

The last block of the former single-file routers/listening.py (lines
7702–9558), cut and pasted unchanged: the two admin attempt read routes and
the student attempt lifecycle (start, save answers, playback-started,
renderer-affinity, check, submit, review, practice windows, Black Eye U1).
The package re-exports every name; tests patch ``routers.listening``, never
this module (see __init__.py).
"""

from __future__ import annotations

from services.listening_test_grader import score_fields as listening_score_fields
import asyncio
import json
import time
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Any, Literal, Optional
from fastapi import (
    APIRouter, File, Header, HTTPException, Query,
    UploadFile,
)
from postgrest.exceptions import APIError
from pydantic import BaseModel, ConfigDict, Field
from models.listening_blackeye import (
    BlackEyeLearnerBinding, BlackEyeAttemptState, BlackEyeActivityReview,
    BlackEyeUnitPublic, BlackEyeSaveAck, BlackEyeInProgress,
)
from services import listening_blackeye as blackeye
from starlette.concurrency import run_in_threadpool
from database import supabase_admin
from services.core_attempt_observation import (
    admit_start, bind_owned_attempt, note_abandoned_dictation_attempt, note_abandoned_exam_attempts, note_persisted_exam_result, observe_operation,
    record_explicit_exam_abandonment,
)
from services.class_assignment_service import (
    active_exam_assignment_references,
    DeadlinePassedError,
    ItemNotFoundError,
    TaskMismatchError,
    validate_class_item_for_test,
)
from services.class_archive_service import require_class_attempt_accepts_work
from services.pg_search import ilike_or_filter
from models.admin_listening_attempts import (
    AdminListeningAttemptDetailResponse,
    AdminListeningAttemptListResponse,
)
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
    _assemble_listening_review, _fetch_attempt_or_404, _rebase_audio_window,
    _require_auth, _rows_by_id, admin_router, logger, require_admin, user_router,
)
from .student_fulltest import (
    PracticeCheckRequest, TestAttemptAnswerPatchRequest,
    _ListeningAttemptPlaybackStartedRequest, _ListeningAttemptRendererAffinityRequest,
    _ListeningAttemptStartRequest, _assert_listening_exam_content_allowed,
)
from .dictation import (
    _dictation_attempt_or_404,
)


# ── Admin: lượt làm bài nghe của học viên (mini/drill/full) ──────────────────
# Audit 2026-07-17 (AUDIT_LISTENING_ACTIVITY_REPORTING): listening_test_attempts
# giữ toàn bộ hoạt động thật của học viên nhưng không có mặt đọc admin nào —
# 2 endpoint dưới đây trả lời "ai làm bài nào, bao lâu, đúng bao nhiêu, sai ở đâu".


def _iso_to_dt(s):
    from datetime import datetime
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None


def _attempt_duration_seconds(row: dict) -> int | None:
    """Thời lượng làm bài = submitted_at - started_at (None khi chưa nộp)."""
    a = _iso_to_dt(row.get("started_at"))
    b = _iso_to_dt(row.get("submitted_at"))
    if not a or not b:
        return None
    return max(0, int((b - a).total_seconds()))


def _attempt_public_shape(r: dict, users: dict, tests: dict) -> dict:
    from services.listening_test_grader import scored_question_count
    gd = r.get("grading_details") or []
    total_q = scored_question_count(gd) if gd else None
    score = r.get("score")
    u = users.get(r.get("user_id")) or {}
    t = tests.get(r.get("test_id")) or {}
    # Never infer a historical attempt's policy from an edited current test.
    # Unversioned legacy rows use the same diagnostic default as submit/review.
    scoring_policy = r.get("scoring_policy") or "diagnostic"
    if scoring_policy not in {"diagnostic", "report_only"}:
        raise HTTPException(503, "Không đọc được chế độ tính điểm đã lưu của lượt làm bài.")
    return {
        "id":               r.get("id"),
        "status":           r.get("status"),
        "scoring_policy":   scoring_policy,
        **listening_score_fields(score, gd),
        "total_questions":  total_q,
        "accuracy":         (round(score / total_q, 4)
                             if score is not None and total_q else None),
        "duration_seconds": _attempt_duration_seconds(r),
        # KHÔNG trả audio_duration_listened_seconds: chưa có write path nào ghi
        # nó (luôn = default 0 của mig 068) — hiện "Đã nghe 0s" là misleading.
        # Thêm lại khi có tracking playback thật (review P1, PR #808).
        "started_at":       r.get("started_at"),
        "submitted_at":     r.get("submitted_at"),
        "created_at":       r.get("created_at"),
        "user": {"id": r.get("user_id"), "email": u.get("email"),
                 "display_name": u.get("display_name")},
        "test": {"id": r.get("test_id"), "test_id": t.get("test_id"),
                 "title": t.get("title"), "test_type": t.get("test_type")},
    }


@admin_router.get("/attempts", response_model=AdminListeningAttemptListResponse)
async def admin_list_listening_attempts(
    user_query: str | None = Query(default=None),
    test_query: str | None = Query(default=None),
    test_type: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    authorization: str | None = Header(default=None),
):
    """Admin: list lượt làm bài nghe (newest first) kèm danh tính học viên + bài.

    - user_query: khớp email/display_name (ilike) — admin gõ tên/email, không UUID.
    - test_query: khớp test_id ngoài (ILR-LIS-…) hoặc title (ilike).
    - test_type: full | mini | drill | practice. status: in_progress | submitted | abandoned.
    Trả {items, total, limit, offset}; item KHÔNG mang grading_details (xem detail).
    """
    await require_admin(authorization)

    if status and status not in {"in_progress", "submitted", "abandoned"}:
        raise HTTPException(422, "status phải là in_progress | submitted | abandoned.")
    # Mọi giá trị test_type mà listening_tests cho phép (CHECK, migration 173)
    # đều phải lọc được ở đây — nếu không, lượt làm bài của loại mới vẫn nằm
    # trong listening_test_attempts nhưng admin không có cách nào lọc ra.
    if test_type and test_type not in {"full", "mini", "drill", "practice"}:
        raise HTTPException(422, "test_type phải là full | mini | drill | practice.")

    # Resolve các filter dạng text → danh sách id TRƯỚC khi query attempts.
    user_ids: list | None = None
    if user_query:
        u_res = (supabase_admin.table("users").select("id")
                 .or_(ilike_or_filter(["email", "display_name"], user_query.strip()))
                 .limit(200).execute())
        user_ids = [r["id"] for r in (u_res.data or [])]
        if not user_ids:
            return {
                "items": [], "total": 0, "limit": limit, "offset": offset,
                "association_lookup_failed": False,
                "association_lookup_failures": [],
            }

    test_ids: list | None = None
    if test_query or test_type:
        t_q = supabase_admin.table("listening_tests").select("id")
        if test_query:
            t_q = t_q.or_(ilike_or_filter(["test_id", "title"], test_query.strip()))
        if test_type:
            t_q = t_q.eq("test_type", test_type)
        t_res = t_q.limit(1000).execute()
        test_ids = [r["id"] for r in (t_res.data or [])]
        if not test_ids:
            return {
                "items": [], "total": 0, "limit": limit, "offset": offset,
                "association_lookup_failed": False,
                "association_lookup_failures": [],
            }

    q = (supabase_admin.table("listening_test_attempts")
         .select("id,user_id,test_id,status,score,grading_details,started_at,"
                 "submitted_at,created_at,scoring_policy", count="exact"))
    if status:
        q = q.eq("status", status)
    if user_ids is not None:
        q = q.in_("user_id", user_ids)
    if test_ids is not None:
        q = q.in_("test_id", test_ids)
    q = await run_in_threadpool(blackeye.exclude_tests, supabase_admin, q, key="test_id")
    res = q.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
    rows = res.data or []

    lookup_failures: set[str] = set()
    users = _rows_by_id("users", [r.get("user_id") for r in rows],
                        "id,email,display_name", lookup_failures=lookup_failures)
    tests = _rows_by_id("listening_tests", [r.get("test_id") for r in rows],
                        "id,test_id,title,test_type", lookup_failures=lookup_failures)
    return {
        "items": [_attempt_public_shape(r, users, tests) for r in rows],
        "total": getattr(res, "count", None) or 0,
        "limit": limit, "offset": offset,
        # Không được biến lỗi join thành danh tính/bài thật sự trống. UI admin
        # cần phân biệt canonical absence với visibility/read failure.
        "association_lookup_failed": bool(lookup_failures),
        "association_lookup_failures": sorted(lookup_failures),
    }


@admin_router.get("/attempts/{attempt_id}", response_model=AdminListeningAttemptDetailResponse)
async def admin_get_listening_attempt(
    attempt_id: str,
    authorization: str | None = Header(default=None),
):
    """Admin: chi tiết 1 lượt làm bài — per-question grading_details (học viên trả
    lời gì, đáp án, trap caught/missed) + trap_analytics + band ước lượng."""
    await require_admin(authorization)
    await run_in_threadpool(blackeye.guard_generic_target, supabase_admin, attempt_id=attempt_id)
    res = (supabase_admin.table("listening_test_attempts").select("*")
           .eq("id", attempt_id).limit(1).execute())
    if not res.data:
        raise HTTPException(404, "Không tìm thấy lượt làm bài.")
    r = res.data[0]
    lookup_failures: set[str] = set()
    users = _rows_by_id("users", [r.get("user_id")], "id,email,display_name",
                        lookup_failures=lookup_failures)
    tests = _rows_by_id("listening_tests", [r.get("test_id")],
                        "id,test_id,title,test_type", lookup_failures=lookup_failures)
    out = _attempt_public_shape(r, users, tests)
    out["grading_details"] = r.get("grading_details") or []
    out["trap_analytics"] = r.get("trap_analytics") or {}
    out["band_estimate"] = r.get("band_estimate")
    out["association_lookup_failed"] = bool(lookup_failures)
    out["association_lookup_failures"] = sorted(lookup_failures)
    return out


@user_router.get("/tests/{test_id}/attempts/in-progress", response_model=BlackEyeInProgress | dict[str, Any])
async def get_in_progress_listening_attempt(
    test_id: str,
    sitting_id: str | None = None,
    class_item: str | None = None,
    authorization: str | None = Header(default=None),
    standalone: bool = False,
):
    """The caller's still-open attempt at this test, or null.

    Exists so a Listening runner can RESUME instead of starting over. Without
    it the only path to an attempt was POST /attempts, which abandons the
    previous one and mints an empty replacement — so a refresh (or, inside a
    4-skill mock, the embed's automatic start-click) silently destroyed every
    answer the student had given.

    `sitting_id` SCOPES the lookup to one mock sitting, and the mock runner
    always sends it. Without that scope the query matched on (user, test,
    in_progress) alone, so a student who already had a STANDALONE practice
    attempt open on a test later reused by a mock exam would have the embed
    auto-resume that practice attempt and attach_attempt bind it to the sealed
    sitting — pulling practice answers into a real exam and corrupting both.
    Legacy callers keep the unscoped class lookup. New free-practice runners
    send `standalone=true`, which excludes both class and mock attempts.

    Deliberately a separate endpoint rather than a field on the shared test
    bundle: that bundle is served to several callers and is cacheable, while
    this is per-user and must never be cached.
    """
    user = await _require_auth(authorization)
    if standalone and (class_item or sitting_id):
        raise HTTPException(422, "standalone cannot be combined with class_item or sitting_id")
    target = await run_in_threadpool(blackeye.test_identity, supabase_admin, test_id, missing_status=None)
    if blackeye.is_blackeye(target):
        await run_in_threadpool(blackeye.require_published, supabase_admin, target)
        if class_item or sitting_id or not standalone:
            blackeye.assignment_seam()
        rows = await run_in_threadpool(lambda: (supabase_admin.table("listening_test_attempts").select("*")
                .eq("user_id", user["id"]).eq("test_id", test_id)
                .eq("status", "in_progress").is_("class_assignment_item_id", "null")
                .is_("sitting_id", "null").order("created_at", desc=True).limit(1).execute().data or []))
        if not rows:
            raise HTTPException(404, "Black Eye attempt unavailable.")
        from fastapi.encoders import jsonable_encoder
        from starlette.responses import JSONResponse
        state = await run_in_threadpool(blackeye.state, supabase_admin, rows[0])
        return JSONResponse({"attempt": jsonable_encoder(state)},
                            headers={"Cache-Control": "private, no-store"})
    query = (
        supabase_admin.table("listening_test_attempts")
        .select(
            "id, started_at, created_at, answers, renderer_affinity, "
            "resume_expires_at, status, playback_started_at,user_id,test_id,sitting_id,"
            "class_assignment_item_id,attempt_purpose,paper_revision,policy_revision"
        )
        .eq("user_id", user["id"])
        .eq("test_id", test_id)
        .eq("status", "in_progress")
    )
    # `class_item` scopes to ONE homework, for the same reason `sitting_id`
    # scopes to one sitting. Resuming is the only path that skips attempt
    # creation, and creation is where the class link is stamped — so without
    # this a student opening their homework would be offered an unfinished
    # free-practice attempt on the same test, resume it, submit it, and the
    # class would still show the task as owed.
    #
    # ONE-WAY, like nothing else here: opening the test from the library
    # (no class_item) may still resume a LINKED homework attempt. The student is
    # finishing work they started, and the link they already earned stands.
    if standalone:
        query = query.is_("class_assignment_item_id", "null")
    elif class_item:
        query = query.eq("class_assignment_item_id", class_item)
    elif not sitting_id:
        test_query = supabase_admin.table("listening_tests").select("test_type").eq("id", test_id).limit(1)
        kind = (await run_in_threadpool(test_query.execute)).data or []
        if kind and kind[0].get("test_type") == "drill":
            query = query.is_("class_assignment_item_id", "null")


    if sitting_id:
        query = query.eq("sitting_id", sitting_id)
    else:
        # STANDALONE must exclude mock attempts, or the mirror of the bug above
        # opens: a student with a live mock attempt who opens the same published
        # test from the normal Listening library would resume the SEALED exam
        # attempt. MockHook is inactive there, so they could replay the audio
        # from the start and edit exam answers outside the runner — and pressing
        # "Bắt đầu test" would abandon their mock attempt outright
        # (Codex review, PR #834).
        query = query.is_("sitting_id", "null")
    res = query.order("created_at", desc=True).limit(1).execute()
    if not res.data or not is_resume_active(res.data[0]):
        return {"attempt": None}
    row = res.data[0]
    from services.mock_paper_policy import guard_owned_attempt, attempt_receipt
    guard_owned_attempt(supabase_admin, "listening", row, purpose="resume")
    from services.mock_attempt_flags import review_flag_state
    return {
        "attempt": {
            **attempt_receipt(row),
            **review_flag_state(supabase_admin, "listening", row),
            "attempt_id": row["id"],
            "started_at": row.get("started_at") or row.get("created_at"),
            # Only answers with real content — a blank row is not progress and
            # would make the resume screen overstate what was recovered.
            "answers": [
                a for a in (row.get("answers") or [])
                if str(a.get("user_answer") or "").strip()
            ],
            "renderer_affinity": row.get("renderer_affinity"),
            "resume_expires_at": row.get("resume_expires_at"),
            "playback_started_at": row.get("playback_started_at"),
        }
    }


@user_router.post("/tests/{test_id}/attempts", response_model=BlackEyeAttemptState | dict[str, Any])
@observe_operation("listening_test", "start", correlate_by=("test_id", "body", "class_item"))
async def start_listening_test_attempt(
    test_id: str,
    body: _ListeningAttemptStartRequest | None = None,
    class_item: str | None = None,
    authorization: str | None = Header(default=None),
    standalone: bool = False,
):
    """Open a student attempt session.

    Standalone report-only programme forms atomically resume-or-create their
    canonical active attempt in Postgres. Other Listening surfaces retain the
    explicit start-over contract: any previous open attempt for the same
    (user, test) is abandoned before a replacement is created.

    NOTE: outside the standalone report-only path this remains destructive by
    design. A caller that wants to CONTINUE must first check GET
    /tests/{test_id}/attempts/in-progress — see that endpoint's docstring.
    """
    user = await _require_auth(authorization)
    if standalone and class_item:
        raise HTTPException(422, "standalone cannot be combined with class_item")

    # Verify the test is published + has audio.
    test_res = (
        supabase_admin.table("listening_tests")
        .select("id,status,exam_only,is_public,public_practice_enabled,full_audio_storage_path,"
                "assembled_audio_storage_path,scoring_policy,content_package_id,test_type,programme_id,metadata")
        .eq("id", test_id)
        .limit(1)
        .execute()
    )
    if not test_res.data or test_res.data[0].get("status") != "published":
        raise HTTPException(404, "Test bundle not found or not published")
    test_row = test_res.data[0]
    if blackeye.is_blackeye(test_row):
        # Reuse the trusted row; no second test read or generic assembler.
        result = await run_in_threadpool(blackeye.start, supabase_admin, test_row, user["id"], body.blackeye_binding if body else None,
            standalone=standalone, class_item=class_item, purpose=body.purpose if body else None,
            sitting_id=body.mock_sitting_id if body else None,
            protocol=body.renderer_affinity_protocol if body else None)
        from fastapi.encoders import jsonable_encoder
        from starlette.responses import JSONResponse
        return JSONResponse(jsonable_encoder(result), headers={"Cache-Control": "private, no-store"})
    if body and body.blackeye_binding is not None:
        raise HTTPException(422, "Black Eye binding does not match target.")
    decision = _assert_listening_exam_content_allowed(test_row, user.get("id"), class_item,
        purpose=body.purpose if body and body.purpose else "delivery",
        sitting_id=body.mock_sitting_id if body else None, allow_admission=True)
    if not (test_row.get("full_audio_storage_path")
            or test_row.get("assembled_audio_storage_path")):
        raise HTTPException(422, "Test chưa có audio sẵn sàng.")

    if decision["attempt_purpose"] == "mock_delivery":
        if standalone or class_item:
            raise HTTPException(422, "mock_delivery cannot be combined with standalone or class_item")
        from services.mock_paper_policy import admit_mock_attempt
        admit_start()
        admitted = admit_mock_attempt(supabase_admin, "listening", test_id, user["id"],
            decision["mock_sitting_id"], affinity_protocol=body.renderer_affinity_protocol if body else None)
        bind_owned_attempt({"id": admitted["attempt_id"], "test_id": test_id,
            "user_id": user["id"], "status": admitted["status"]}, started=not admitted.get("acquired_existing"))
        from services.mock_attempt_flags import review_flag_state
        return {**admitted, **review_flag_state(supabase_admin, "listening", {"id": admitted["attempt_id"]})}

    # Imported programme forms have one canonical standalone resume-or-create
    # path. The legacy start-over path abandons the previous row before its
    # INSERT; a drain-trigger rejection there would erase a valid old attempt.
    if (test_row.get("content_package_id")
            and test_row.get("scoring_policy") == "report_only"
            and not standalone):
        raise HTTPException(422, "Bài trong chương trình Listening cần mở ở chế độ luyện tập.")

    if class_item:
        try:
            validate_class_item_for_test(
                supabase_admin, user["id"], class_item,
                skill="listening", test_id=test_id,
            )
        except DeadlinePassedError as exc:
            # 409, cùng mã với /start: hạn có thể trôi qua GIỮA lúc trang lớp
            # gọi /start và lúc trang đề tạo lượt làm bài. Không bắt ở đây thì
            # học viên nhận 500 — đọc ra là lỗi hệ thống chứ không phải
            # "em hết giờ rồi".
            raise HTTPException(409, str(exc))
        except (ItemNotFoundError, TaskMismatchError) as exc:
            raise HTTPException(400, str(exc))

    admit_start()
    affinity_aware = body is not None and body.renderer_affinity_protocol == "claim-v1"
    if standalone and test_row.get("scoring_policy") == "report_only":
        try:
            acquired = supabase_admin.rpc(
                "fn_acquire_listening_programme_attempt_v2",
                {
                    "p_test_id": test_id,
                    "p_user_id": user["id"],
                    "p_renderer_affinity_protocol": (
                        "claim-v1" if affinity_aware else "legacy"
                    ),
                },
            ).execute()
        except Exception as exc:
            if "listening_programme_new_starts_paused" in str(exc):
                raise HTTPException(
                    409,
                    "Chương trình đang chuyển phiên bản. Bạn vẫn có thể hoàn thành lượt đang dở.",
                ) from exc
            logger.error(
                "[listening-programme-attempt] acquire failed test=%s user=%s: %s",
                test_id,
                user["id"],
                exc,
            )
            raise HTTPException(
                500, "Không thể mở lượt luyện nghe. Hãy thử lại."
            ) from exc

        rows = acquired.data or []
        if len(rows) != 1:
            raise HTTPException(500, "Không thể xác định lượt luyện nghe.")
        acquired_row = rows[0]
        created = acquired_row.get("created") is True
        attempt_id = str(acquired_row.get("attempt_id") or "")
        if not attempt_id:
            raise HTTPException(500, "Lượt luyện nghe không có định danh hợp lệ.")
        observation_row = {
            "id": attempt_id,
            "test_id": test_id,
            "user_id": user["id"],
            "status": acquired_row.get("attempt_status") or "in_progress",
            "renderer_affinity": acquired_row.get("attempt_renderer_affinity"),
        }
        bind_owned_attempt(observation_row, started=created)
        canonical = _fetch_attempt_or_404(attempt_id, user["id"])
        from services.mock_paper_policy import attempt_receipt, guard_owned_attempt
        from services.mock_attempt_flags import review_flag_state
        guard_owned_attempt(supabase_admin, "listening", canonical, purpose="resume")
        return {
            **attempt_receipt(canonical),
            **review_flag_state(supabase_admin, "listening", canonical),
            "attempt_id": attempt_id,
            "status": observation_row["status"],
            "started_at": acquired_row.get("attempt_started_at"),
            "resume_expires_at": acquired_row.get("attempt_resume_expires_at"),
            "answers": acquired_row.get("attempt_answers") or [],
            "renderer_affinity": acquired_row.get("attempt_renderer_affinity"),
            "playback_started_at": acquired_row.get(
                "attempt_playback_started_at"
            ),
            "acquired_existing": not created,
        }

    # Abandon any open attempts for this (user, test).
    abandon_query = (
        supabase_admin.table("listening_test_attempts")
        .update({"status": "abandoned"})
        .eq("user_id", user["id"])
        .eq("test_id", test_id)
        .eq("status", "in_progress")
    )
    if standalone:
        abandon_query = (
            abandon_query
            .is_("class_assignment_item_id", "null")
            .is_("sitting_id", "null")
        )
    if test_row.get("test_type") == "drill":
        abandon_query = (abandon_query.eq("class_assignment_item_id", class_item) if class_item
                         else abandon_query.is_("class_assignment_item_id", "null"))
        abandon_query = abandon_query.is_("sitting_id", "null")
    abandoned_result = abandon_query.execute()
    note_abandoned_exam_attempts(abandoned_result, test_id=test_id, user_id=user["id"])

    attempt_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc).isoformat()
    expires_at = resume_expires_at(started_at)
    payload = {
        "id":      attempt_id,
        "test_id": test_id,
        "user_id": user["id"],
        "attempt_purpose": decision["attempt_purpose"],
        "status":  "in_progress",
        "answers": [],
        "scoring_policy": test_row.get("scoring_policy") or "diagnostic",
        "started_at": started_at,
        "resume_expires_at": expires_at,
    }
    if affinity_aware:
        payload["renderer_affinity"] = None
    # Class homework: stamp WHICH task this is being done for, so the ledger
    # never has to work it out afterwards (mig 181).
    if class_item:
        payload["class_assignment_item_id"] = class_item
    inserted = (
        supabase_admin.table("listening_test_attempts")
        .insert(payload)
        .execute()
    )
    bind_owned_attempt(payload, started=True)
    from services.mock_paper_policy import attempt_receipt
    from services.mock_attempt_flags import review_flag_state
    canonical = inserted.data[0] if inserted.data else payload
    return {
        **attempt_receipt(canonical),
        **review_flag_state(supabase_admin, "listening", canonical),
        "attempt_id": attempt_id,
        "status": "in_progress",
        "started_at": started_at,
        "resume_expires_at": expires_at,
        "renderer_affinity": None if affinity_aware else "legacy",
        "playback_started_at": None,
    }


class DrillPlaybackCheckpoint(BaseModel):
    stage: Literal["listening", "dictation"]
    page_id: uuid.UUID
    plays: int = Field(ge=0, le=120)
    played_ms: int = Field(ge=0, le=3600000)


_drill_checkpoint_requests: dict[str, deque[float]] = {}


def _limit_drill_checkpoint_requests(user_id: str) -> None:
    now = time.monotonic()
    cutoff = now - 60
    if len(_drill_checkpoint_requests) > 4096:
        for key in [key for key, hits in _drill_checkpoint_requests.items() if not hits or hits[-1] <= cutoff]:
            del _drill_checkpoint_requests[key]
    hits = _drill_checkpoint_requests.setdefault(user_id, deque())
    while hits and hits[0] <= cutoff:
        hits.popleft()
    if len(hits) >= 60:
        retry = max(1, int(hits[0] - cutoff) + 1)
        raise HTTPException(429, "Đang gửi quá nhiều cập nhật audio.", headers={"Retry-After": str(retry)})
    hits.append(now)


@user_router.post("/skill-drill-playback/{attempt_id}", status_code=204)
async def record_skill_drill_playback(
    attempt_id: uuid.UUID, body: DrillPlaybackCheckpoint,
    authorization: str | None = Header(default=None),
):
    user = await _require_auth(authorization)
    _limit_drill_checkpoint_requests(user["id"])
    await run_in_threadpool(_record_skill_drill_playback, str(attempt_id), body, user["id"])


def _record_skill_drill_playback(attempt_id: str, body: DrillPlaybackCheckpoint, user_id: str) -> None:
    from services.listening_drill_homework import drill_config
    lookup = _fetch_attempt_or_404 if body.stage == "listening" else _dictation_attempt_or_404
    attempt = lookup(attempt_id, user_id)
    item_id = attempt.get("class_assignment_item_id")
    if not item_id:
        raise HTTPException(404, "Lượt làm không thuộc bài luyện kỹ năng được giao.", headers={"Cache-Control": "private, no-store"})
    if body.stage == "listening":
        if blackeye.attempt_is_blackeye(supabase_admin, attempt):
            raise HTTPException(404, "Black Eye resource unavailable.", headers={"Cache-Control": "private, no-store"})
    else:
        blackeye.guard_generic_target(supabase_admin, test_id=attempt.get("test_id"))
    if attempt.get("status") != "in_progress":
        raise HTTPException(409, "Lượt làm bài đã kết thúc.", headers={"Cache-Control": "private, no-store"})
    try:
        assignment = validate_class_item_for_test(
            supabase_admin, user_id, item_id, skill="listening", test_id=attempt["test_id"])
    except (ItemNotFoundError, TaskMismatchError) as exc:
        raise HTTPException(404, str(exc), headers={"Cache-Control": "private, no-store"}) from exc
    except DeadlinePassedError as exc:
        raise HTTPException(409, str(exc), headers={"Cache-Control": "private, no-store"}) from exc
    if drill_config(assignment) is None:
        raise HTTPException(404, "Lượt làm không thuộc bài luyện kỹ năng được giao.", headers={"Cache-Control": "private, no-store"})
    try:
        supabase_admin.rpc("fn_record_listening_drill_playback_v2", {
            "p_item_id": item_id, "p_stage": body.stage, "p_attempt_id": attempt_id,
            "p_page_id": str(body.page_id), "p_plays": body.plays, "p_played_ms": body.played_ms,
        }).execute()
    except APIError as exc:
        if exc.code == "55000" and exc.message == "skill_drill_attempt_inactive":
            raise HTTPException(409, "Lượt làm bài đã kết thúc.", headers={"Cache-Control": "private, no-store"}) from exc
        if exc.code == "55000" and exc.message == "skill_drill_checkpoint_scope":
            raise HTTPException(404, "Không tìm thấy trang phát audio của lượt làm bài.", headers={"Cache-Control": "private, no-store"}) from exc
        raise

@user_router.post("/tests/attempts/{attempt_id}/playback-started")
async def acknowledge_listening_attempt_playback_started(
    attempt_id: uuid.UUID,
    body: _ListeningAttemptPlaybackStartedRequest,
    authorization: str | None = Header(default=None),
):
    """Atomically persist the single-play start for a report-only attempt.

    The browser calls this only after ``HTMLMediaElement.play()`` resolves.
    ``playback_claim_id`` makes a lost response safely retryable from the same
    page, while a second browser/device receives ``accepted=false`` and must
    stop its player. Once persisted, the player bundle no longer contains a
    signed audio URL for this attempt.
    """
    user = await _require_auth(authorization)
    attempt = _fetch_attempt_or_404(str(attempt_id), user["id"])
    if await run_in_threadpool(blackeye.attempt_is_blackeye, supabase_admin, attempt):
        raise HTTPException(503, "Black Eye player contract unavailable.")
    if attempt.get("status") != "in_progress":
        raise HTTPException(422, "Attempt không còn hoạt động.")
    require_resume_active(attempt)
    test_rows = (
        supabase_admin.table("listening_tests")
        .select("id,replay_policy,scoring_policy")
        .eq("id", attempt.get("test_id"))
        .limit(1)
        .execute().data or []
    )
    if not test_rows:
        raise HTTPException(404, "Test bundle not found")
    test = test_rows[0]
    if test.get("replay_policy") != "once" or test.get("scoring_policy") != "report_only":
        raise HTTPException(422, "Attempt này không dùng chính sách nghe một lượt.")

    claim_id = str(body.playback_claim_id)
    started_at = datetime.now(timezone.utc).isoformat()
    claimed = (
        supabase_admin.table("listening_test_attempts")
        .update({
            "playback_started_at": started_at,
            "playback_claim_id": claim_id,
        })
        .eq("id", str(attempt_id))
        .eq("user_id", user["id"])
        .eq("status", "in_progress")
        .is_("playback_started_at", "null")
        .execute().data or []
    )
    if claimed:
        return {
            "attempt_id": str(attempt_id),
            "accepted": True,
            "playback_started_at": claimed[0].get("playback_started_at") or started_at,
        }

    canonical = _fetch_attempt_or_404(str(attempt_id), user["id"])
    if canonical.get("status") != "in_progress":
        raise HTTPException(422, "Attempt không còn hoạt động.")
    require_resume_active(canonical)
    canonical_started_at = canonical.get("playback_started_at")
    if not canonical_started_at:
        raise HTTPException(503, "Không thể xác nhận lượt nghe — hãy thử lại.")
    return {
        "attempt_id": str(attempt_id),
        "accepted": canonical.get("playback_claim_id") == claim_id,
        "playback_started_at": canonical_started_at,
    }


@user_router.post("/tests/attempts/{attempt_id}/renderer-affinity")
async def claim_listening_attempt_renderer_affinity(
    attempt_id: uuid.UUID,
    body: _ListeningAttemptRendererAffinityRequest,
    authorization: str | None = Header(default=None),
):
    """Claim a stable Listening player on first boot; never move it later."""
    user = await _require_auth(authorization)
    owned_attempt = _fetch_attempt_or_404(str(attempt_id), user["id"])
    if await run_in_threadpool(blackeye.attempt_is_blackeye, supabase_admin, owned_attempt):
        raise HTTPException(503, "Black Eye player contract unavailable.")
    require_resume_active(owned_attempt)
    try:
        result = supabase_admin.rpc(
            "fn_claim_listening_attempt_renderer_affinity",
            {
                "p_attempt_id": str(attempt_id),
                "p_user_id": user["id"],
                "p_renderer_affinity": body.renderer_affinity,
            },
        ).execute()
    except Exception as exc:
        logger.error(
            "[listening-renderer-affinity] claim failed attempt=%s renderer=%s: %s",
            attempt_id,
            body.renderer_affinity,
            exc,
        )
        if is_active_player_expired_error(exc):
            require_resume_active(owned_attempt)
            raise HTTPException(410, "Attempt đã hết thời gian tiếp tục.") from exc
        raise HTTPException(
            500, "Không thể xác nhận phiên bản player. Hãy tải lại trang."
        )

    rows = result.data or []
    if len(rows) != 1:
        raise HTTPException(404, "Attempt không tồn tại")
    affinity = rows[0].get("renderer_affinity")
    if affinity not in {"legacy", "next"}:
        raise HTTPException(500, "Attempt chưa có renderer hợp lệ")
    return {"attempt_id": str(attempt_id), "renderer_affinity": affinity}


async def _is_admin(authorization: str | None) -> bool:
    """Soft admin check — returns bool, never raises (mirrors routers/health.py
    and the analogous helper added to reading_student.py, 2026-07-12)."""
    if not authorization:
        return False
    from routers.admin import require_admin as _staff_admin_guard
    try:
        await _staff_admin_guard(authorization)
        return True
    except Exception:
        return False


def _mock_sealed(attempt: dict) -> bool:
    """True when this attempt belongs to a still-sealed 4-skill mock sitting.

    The submit/result/review endpoints check this to withhold scores until an
    admin releases the sitting — the server-side seal, not a hidden button."""
    sitting_id = attempt.get("sitting_id")
    if not sitting_id:
        return False
    from services import mock_exam_service
    return mock_exam_service.is_sealed(sitting_id)


@user_router.patch("/tests/attempts/{attempt_id}/answers", response_model=BlackEyeSaveAck | dict[str, Any])
# This shared route accepts Black Eye answers: retry correlation must never
# retain an answer-derived digest. The client operation ID scopes each intent.
@observe_operation("listening_test", "save", correlate_by=("attempt_id",))
async def patch_listening_test_attempt_answer(
    attempt_id: str,
    body: TestAttemptAnswerPatchRequest,
    authorization: str | None = Header(default=None),
):
    """Incrementally save a single answer. The frontend debounces per gap; the
    backend treats this as an upsert keyed by ``q_num``.

    A4b — the merge happens inside ONE statement (fn_upsert_listening_answer,
    mig 161), not as a Python read-modify-write of the whole JSONB array. The
    old shape lost answers whenever two questions were saved at the same moment:
    both requests read the same array and both wrote their own version back, so
    the second silently erased the first. That is the NORMAL case, not an edge
    one — the client debounces per question, so concurrent saves of different
    q_nums are exactly what a fast typist produces.
    """
    user = await _require_auth(authorization)
    attempt = _fetch_attempt_or_404(attempt_id, user["id"])   # ownership gate
    bind_owned_attempt(attempt)
    if await run_in_threadpool(blackeye.attempt_is_blackeye, supabase_admin, attempt):
        from starlette.responses import JSONResponse
        saved = await run_in_threadpool(blackeye.save, supabase_admin, attempt, body.q_num, body.user_answer)
        ack = BlackEyeSaveAck.model_validate(saved)
        return JSONResponse(ack.model_dump(), headers={"Cache-Control": "private, no-store"})
    if attempt.get("status") != "in_progress":
        raise HTTPException(422, "Attempt đã submit hoặc abandoned — không thể edit.")
    require_resume_active(attempt)
    # CLASSARCHIVE-0030 FR-004: an archived class takes no new answer either,
    # also on an attempt started before the archive (same gate as submit).
    await asyncio.to_thread(
        require_class_attempt_accepts_work, supabase_admin, attempt, surface="listening")
    if not (1 <= body.q_num <= 40):
        raise HTTPException(422, "q_num must be in 1..40")
    # A practice attempt is scored on the FIRST answer to each question, which
    # this route cannot express: fn_upsert_listening_answer replaces by q_num.
    # Left open, it is a way around the whole rule — answer wrong through
    # /check, PATCH the right answer, submit, score inflated. The Luyện nhanh
    # runner never calls this; refuse rather than quietly overwrite.
    if ((attempt.get("scoring_policy") or "diagnostic") == "diagnostic"
            and _attempt_test_type(attempt) == "practice"):
        raise HTTPException(
            422,
            "Luyện nhanh chấm từng câu theo lần trả lời đầu — dùng POST .../check.",
        )

    res = supabase_admin.rpc("fn_upsert_listening_answer", {
        "p_attempt_id":  attempt_id,
        "p_q_num":       body.q_num,
        "p_user_answer": body.user_answer,
    }).execute()
    count = res.data
    if count is None:
        # The RPC also enforces status='in_progress', so a NULL here means the
        # attempt was submitted between the check above and the write — a real
        # race, and the honest answer is that the edit did not land.
        require_resume_active(attempt)
        raise HTTPException(422, "Attempt đã submit hoặc abandoned — không thể edit.")
    from services import mock_correction_service
    performance_event_recorded = mock_correction_service.record_answer_commit(
        "listening", attempt_id, attempt.get("user_id"), body.q_num,
        body.user_answer or "",
    )
    return {
        "attempt_id": attempt_id,
        "answer_count": count,
        "performance_event_recorded": performance_event_recorded,
    }


def _attempt_test_type(attempt: dict) -> str:
    """The test_type behind an attempt.

    Fails CLOSED. An unresolvable test row used to come back as None, which
    every caller compares against "practice" and finds unequal — so the exact
    moment the lookup breaks is the moment a practice attempt slips past the
    guard built on it. There is no safe default here, so raise: refusing an
    answer save is recoverable, silently overwriting a canonical first answer
    is not.

    Costs one small indexed read per call. That is a real cost on the PATCH
    autosave path (once per answer); paid deliberately, because the shared
    attempt lookup returns the attempt row alone and widening it would change
    a shape half the Listening endpoints depend on.
    """
    res = (
        supabase_admin.table("listening_tests")
        .select("test_type").eq("id", attempt.get("test_id")).limit(1).execute()
    )
    kind = (res.data[0].get("test_type") if res.data else None)
    if not kind:
        raise HTTPException(500, "Không xác định được loại bài của lượt làm này.")
    return kind


def _source_required_for_test(test_id: str) -> bool:
    rows = (supabase_admin.table("listening_tests").select("programme_id")
            .eq("id", test_id).limit(1).execute().data or [])
    if len(rows) != 1:
        raise HTTPException(503, "Không xác định được chương trình của lượt làm; hãy thử lại.")
    return rows[0].get("programme_id") == SOURCE_PROGRAMME


def _practice_exercise_payloads(test_id: str, *, published_only: bool = False) -> list[dict]:
    """Every exercise payload belonging to a test, via its section rows."""
    sections = supabase_admin.table("listening_content").select("id").eq("test_id", test_id)
    if published_only:
        sections = sections.eq("status", "published")
    sec_res = sections.execute()
    section_ids = [r["id"] for r in (sec_res.data or [])]
    if not section_ids:
        raise HTTPException(500, "Test bundle thiếu section rows.")
    exercises = supabase_admin.table("listening_exercises").select("payload").in_("content_id", section_ids)
    if published_only:
        exercises = exercises.eq("status", "published")
    ex_res = exercises.execute()
    return ex_res.data or []


def _programme_guided_context(attempt: dict) -> tuple[dict, list[dict]]:
    """Check the report-only programme boundary before reading protected keys."""
    if blackeye.attempt_is_blackeye(supabase_admin, attempt):
        raise HTTPException(422, "Black Eye guided feedback unavailable.")
    if attempt.get("status") != "in_progress":
        raise HTTPException(409, "Bài luyện đã kết thúc; hãy mở phần đối chiếu sau bài.")
    require_resume_active(attempt)
    if (attempt.get("scoring_policy") != "report_only"
            or attempt.get("class_assignment_item_id")
            or attempt.get("sitting_id")):
        raise HTTPException(422, "Đối chiếu từng câu không áp dụng cho bài này.")
    from services.mock_paper_policy import guard_owned_attempt, load_marking_snapshot
    guard_owned_attempt(supabase_admin, "listening", attempt, purpose="guided_feedback")
    snapshot = load_marking_snapshot(supabase_admin, "listening", attempt)
    result = (
        supabase_admin.table("listening_tests")
        .select("id,status,is_public,scoring_policy,programme_id,replay_policy,content_package_id,metadata")
        .eq("id", attempt["test_id"]).limit(1).execute()
    )
    test = snapshot["paper_row"] if snapshot else (result.data[0] if result.data else None)
    if (not test or test.get("status") != "published"
            or not test.get("is_public")
            or test.get("scoring_policy") != "report_only"
            or test.get("programme_id") not in {
                "general-listening-practice", "ielts-listening-practice", SOURCE_PROGRAMME,
            }
            or not test.get("content_package_id")):
        raise HTTPException(422, "Bài luyện này chưa hỗ trợ đối chiếu từng câu.")
    package = (
        supabase_admin.table("listening_content_packages")
        .select("status").eq("id", test["content_package_id"])
        .limit(1).execute()
    )
    if not package.data or package.data[0].get("status") != "published":
        raise HTTPException(422, "Nội dung bài luyện hiện không khả dụng.")
    return test, snapshot["marking_rows"] if snapshot else _practice_exercise_payloads(attempt["test_id"], published_only=True)


def _programme_guided_item(
    reveal: dict, exercise_rows: list[dict], replay_policy: str, *, source_required: bool = False,
    audio_granularity: str | None = None,
) -> dict:
    from services.listening_programme_feedback import (
        FeedbackUnavailable, build_guided_feedback,
    )

    try:
        feedback = build_guided_feedback(
            int(reveal["q_num"]), str(reveal["first_answer"]),
            exercise_rows, replay_policy, source_required=source_required, audio_granularity=audio_granularity,
        )
    except FeedbackUnavailable:
        logger.error("[listening-programmes] revealed item has no review material")
        raise HTTPException(503, "Chưa tải được nội dung đối chiếu. Hãy thử lại.") from None
    return {**feedback, "revealed_at": str(reveal["revealed_at"])}


@user_router.get(
    "/tests/attempts/{attempt_id}/guided-state",
    response_model=ListeningGuidedStateResponse,
)
async def get_listening_programme_guided_state(
    attempt_id: uuid.UUID,
    authorization: str | None = Header(default=None),
):
    """Resume only the questions whose keys this learner already revealed."""
    user = await _require_auth(authorization)
    attempt_id_str = str(attempt_id)
    attempt = _fetch_attempt_or_404(attempt_id_str, user["id"])
    test, exercise_rows = await run_in_threadpool(_programme_guided_context, attempt)
    result = (
        supabase_admin.table("listening_programme_feedback_reveals")
        .select("q_num,first_answer,revealed_at")
        .eq("attempt_id", attempt_id_str).order("q_num").execute()
    )
    items = [
        _programme_guided_item(row, exercise_rows, test.get("replay_policy") or "allowed", source_required=test.get("programme_id") == SOURCE_PROGRAMME,
            audio_granularity=(test.get("metadata") or {}).get("timing_granularity") if test.get("programme_id") == SOURCE_PROGRAMME else None)
        for row in (result.data or [])
    ]
    return {"attempt_id": attempt_id_str, "assisted": bool(items), "items": items}


@user_router.post(
    "/tests/attempts/{attempt_id}/questions/{q_num}/reveal",
    response_model=ListeningGuidedStateResponse,
)
async def reveal_listening_programme_question(
    attempt_id: uuid.UUID,
    q_num: int,
    authorization: str | None = Header(default=None),
):
    """Atomically snapshot a saved first answer, then reveal that question."""
    from services.listening_programme_feedback import (
        FeedbackUnavailable, build_guided_feedback,
    )

    user = await _require_auth(authorization)
    attempt_id_str = str(attempt_id)
    attempt = _fetch_attempt_or_404(attempt_id_str, user["id"])
    test, exercise_rows = await run_in_threadpool(_programme_guided_context, attempt)
    if q_num <= 0:
        raise HTTPException(422, "Câu hỏi không hợp lệ.")
    # Reject broken/missing authored keys before recording any reveal. The RPC
    # performs the membership and persisted-answer checks again under row lock.
    try:
        build_guided_feedback(
            q_num, "content-check", exercise_rows,
            test.get("replay_policy") or "allowed", source_required=test.get("programme_id") == SOURCE_PROGRAMME,
        )
    except FeedbackUnavailable:
        raise HTTPException(503, "Câu này chưa có nội dung đối chiếu hợp lệ.") from None
    try:
        result = supabase_admin.rpc(
            "fn_record_listening_programme_feedback_reveal",
            {"p_attempt_id": attempt_id_str, "p_user_id": user["id"], "p_q_num": q_num},
        ).execute()
    except Exception as exc:
        signal = str(exc)
        if "listening_programme_feedback_answer_required" in signal:
            raise HTTPException(422, "Hãy lưu câu trả lời trước khi đối chiếu.") from None
        if "listening_programme_feedback_question_not_found" in signal:
            raise HTTPException(404, "Không tìm thấy câu hỏi trong bài này.") from None
        if "listening_programme_feedback_attempt_closed" in signal:
            raise HTTPException(409, "Bài luyện đã kết thúc; hãy tải lại trạng thái.") from None
        if "listening_programme_feedback_not_available" in signal:
            raise HTTPException(422, "Bài này không hỗ trợ đối chiếu từng câu.") from None
        logger.warning("[listening-programmes] guided reveal unavailable: %s", type(exc).__name__)
        raise HTTPException(503, "Chưa đối chiếu được câu này. Hãy thử lại.") from None
    rows = result.data if isinstance(result.data, list) else [result.data]
    reveal = rows[0] if rows and isinstance(rows[0], dict) else None
    if not reveal or not reveal.get("first_answer") or not reveal.get("revealed_at"):
        raise HTTPException(503, "Chưa xác minh được câu trả lời đã lưu. Hãy thử lại.")
    item = _programme_guided_item(
        {"q_num": q_num, **reveal}, exercise_rows,
        test.get("replay_policy") or "allowed", source_required=test.get("programme_id") == SOURCE_PROGRAMME,
        audio_granularity=(test.get("metadata") or {}).get("timing_granularity") if test.get("programme_id") == SOURCE_PROGRAMME else None,
    )
    return {"attempt_id": attempt_id_str, "assisted": True, "items": [item]}


@user_router.get("/tests/{test_id}/practice-windows")
async def get_practice_audio_windows(
    test_id: str,
    authorization: str | None = Header(default=None),
):
    """Per-question audio windows for a Luyện nhanh drill — PRACTICE ONLY.

    The runner plays one question at a time, scoped to that question's few
    seconds of audio. It needs the windows before the learner answers, and
    `GET /tests/{id}` deliberately no longer carries them: a window says where
    in the recording the answer is, which on an exam is most of the skill.

    Practice is the deliberate exception, not an oversight. These clips are
    30–90 seconds holding ~10 questions, and what they drill is hearing a trap
    as it goes past — not scanning a recording for where the answer might be.
    Playing the whole clip for every question made the surface unusable: the
    audio simply ran out, and from question two on there was nothing to hear.

    Returns `{q_num: {start, end}}` and nothing else — no answers, no
    solutions, no transcript. Refused outright for full / mini / drill, so the
    exam guarantee is unchanged and this exception stays visible in one place.
    """
    _user = await _require_auth(authorization)
    target = await run_in_threadpool(blackeye.test_identity, supabase_admin, test_id, missing_status=None)
    if blackeye.is_blackeye(target):
        raise HTTPException(503, "Black Eye player contract unavailable.")

    res = (
        supabase_admin.table("listening_tests")
        .select("id,test_type,status,scoring_policy,metadata")
        .eq("id", test_id).limit(1).execute()
    )
    if not res.data or res.data[0].get("status") != "published":
        raise HTTPException(404, "Test bundle not found or not published")
    test_row = res.data[0]
    if (test_row.get("test_type") != "practice"
            or test_row.get("scoring_policy") != "diagnostic"):
        raise HTTPException(422, "Chỉ bài Luyện nhanh mới có cửa sổ audio theo câu.")

    _assert_listening_exam_content_allowed(test_row, _user["id"], purpose="practice")

    windows: dict[str, dict] = {}
    offsets = (test_row.get("metadata") or {}).get("section_offsets") or {}
    for row in _practice_exercise_payloads(test_id):
        payload = row.get("payload") or {}
        for q, win in (payload.get("audio_windows") or {}).items():
            # Same rebase the review player and /check use. A practice pack is a
            # single section premixed alone (offsets {sid: 0}), so this is a
            # pass-through today — routed through the shared helper so all three
            # readers move together if that ever stops being true.
            rebased = _rebase_audio_window(win, True, offsets)
            if rebased and rebased.get("start") is not None:
                windows[str(int(q))] = {"start": rebased["start"], "end": rebased["end"]}

    return {"test_id": test_id, "windows": windows}


@user_router.post("/tests/attempts/{attempt_id}/check")
@observe_operation("listening_test", "grade", correlate_by=("attempt_id", "body"))
async def check_listening_practice_answer(
    attempt_id: str,
    body: PracticeCheckRequest,
    authorization: str | None = Header(default=None),
):
    """Grade ONE question mid-attempt, for the Luyện nhanh runner.

    Luyện nhanh is a 30–90s drill, not an exam: the learner answers a question,
    finds out immediately, and on a miss the player loops that question's audio
    window until they hear it. Two rules keep that from turning into a way to
    farm a perfect score, or into a hole in exam integrity:

    **practice only.** A full / mini / drill attempt is refused outright. Those
    surfaces are graded once, at submit, precisely so a student cannot probe the
    key answer-by-answer while the recording is still in front of them.

    **first answer is canonical.** The write goes through
    fn_insert_listening_answer_once (mig 174), which appends only when that
    q_num has no answer yet. Retries are graded and returned for the learner's
    benefit but never overwrite the record, so the attempt's eventual score,
    band and trap analytics describe the first listen — the thing worth
    measuring — not the tenth.

    Grading reuses ``grade_attempt`` over the attempt's stored answers with this
    one substituted in, i.e. the SAME path submit takes. A separate
    single-question comparison here would be free to drift from the final score,
    and the learner would be told "correct" by one and "wrong" by the other.

    Returns ``{q_num, correct, canonical_correct, recorded, audio_window, …}``;
    ``expected`` / ``solution`` appear only on a granted reveal.
    """
    from services import listening_test_grader as grader

    user = await _require_auth(authorization)
    attempt = _fetch_attempt_or_404(attempt_id, user["id"])       # ownership gate
    if await run_in_threadpool(blackeye.attempt_is_blackeye, supabase_admin, attempt):
        raise HTTPException(422, "Black Eye practice feedback unavailable.")
    if attempt.get("sitting_id") or attempt.get("attempt_purpose") == "mock_delivery":
        raise HTTPException(404, "Practice feedback unavailable")
    if not body.reveal:
        # A per-question grade is an operation, never a new attempt or final
        # result. Reveal is read-only and must not claim mutation evidence.
        bind_owned_attempt(attempt)
    if attempt.get("status") != "in_progress":
        raise HTTPException(422, "Attempt đã submit hoặc abandoned — không thể chấm thêm.")
    require_resume_active(attempt)
    if not body.reveal:
        # CLASSARCHIVE-0030 FR-004: a check records the first answer, so it
        # takes the answer PATCH/submit gate; a reveal stays a read. Re-read
        # after the await so the stored answers graded below are not older
        # than the gate.
        await asyncio.to_thread(
            require_class_attempt_accepts_work, supabase_admin, attempt, surface="listening")
        attempt = await asyncio.to_thread(_fetch_attempt_or_404, attempt_id, user["id"])
        if attempt.get("status") != "in_progress":
            raise HTTPException(422, "Attempt đã submit hoặc abandoned — không thể chấm thêm.")
        require_resume_active(attempt)

    from services.mock_paper_policy import guard_owned_attempt, load_marking_snapshot, frozen_answer_key
    guard_owned_attempt(supabase_admin, "listening", attempt, purpose="practice_feedback")
    snapshot = load_marking_snapshot(supabase_admin, "listening", attempt)
    test_res = (
        supabase_admin.table("listening_tests")
        .select("id,test_type,metadata")
        .eq("id", attempt["test_id"]).limit(1).execute()
    )
    if not test_res.data:
        raise HTTPException(404, "Test bundle not found")
    test_row = snapshot["paper_row"] if snapshot else test_res.data[0]
    if (attempt.get("scoring_policy") or "diagnostic") == "report_only":
        raise HTTPException(
            422,
            "Bài này đối chiếu từng câu ngay trong màn luyện tập. Chấm nhanh chỉ dành cho Luyện nhanh.",
        )
    if test_row.get("test_type") != "practice":
        raise HTTPException(
            422,
            "Chấm từng câu chỉ dành cho Luyện nhanh. Bài thi chấm một lần khi nộp.",
        )

    payloads = snapshot["marking_rows"] if snapshot else _practice_exercise_payloads(attempt["test_id"])
    answer_key = frozen_answer_key(supabase_admin, "listening", attempt)
    if answer_key is None:
        answer_key = grader.collect_answer_key(payloads)
    key_row = next((k for k in answer_key if k.get("q_num") == body.q_num), None)
    if key_row is None:
        raise HTTPException(404, f"Câu {body.q_num} không thuộc bài này.")

    stored = list(attempt.get("answers") or [])
    prior = next((a for a in stored if a.get("q_num") == body.q_num), None)

    recorded = False
    if not body.reveal:
        wrote = supabase_admin.rpc("fn_insert_listening_answer_once", {
            "p_attempt_id":  attempt_id,
            "p_q_num":       body.q_num,
            "p_user_answer": body.user_answer,
        }).execute().data
        if wrote is None:
            # The RPC re-checks status, so NULL means the attempt was submitted
            # between our read and the write. Say so instead of returning a
            # grade for an answer that was never stored.
            require_resume_active(attempt)
            raise HTTPException(422, "Attempt đã submit hoặc abandoned — không thể chấm thêm.")
        if type(wrote) is not bool:
            raise HTTPException(503, "Chưa xác minh được đáp án đã lưu. Hãy thử lại.")
        recorded = wrote
        if recorded:
            prior = {"q_num": body.q_num, "user_answer": body.user_answer}
        elif prior is None:
            # The RPC refused, yet our snapshot showed no answer — a concurrent
            # check won the write between the two. Re-read instead of reporting
            # canonical_correct=False off the stale snapshot, which would tell
            # the learner this question is lost while submit scores it correct.
            fresh = (
                supabase_admin.table("listening_test_attempts")
                .select("answers").eq("id", attempt_id).limit(1).execute()
            )
            stored = list((fresh.data[0].get("answers") if fresh.data else None) or [])
            prior = next((a for a in stored if a.get("q_num") == body.q_num), None)
            if prior is None:
                # FALSE also covers a lost conditional UPDATE when the attempt
                # was submitted concurrently, not only a rival answer. Without
                # a canonical answer, neither a successful check nor its
                # canonical correctness can be asserted.
                raise HTTPException(409, "Bài làm vừa thay đổi. Hãy tải lại để kiểm tra đáp án đã lưu.")

    def _grade(ans_text: str) -> bool:
        merged = [a for a in stored if a.get("q_num") != body.q_num]
        merged.append({"q_num": body.q_num, "user_answer": ans_text})
        res = grader.grade_attempt(merged, answer_key)
        row = next((r for r in res["per_question"] if r.get("q_num") == body.q_num), None)
        return bool(row and row.get("correct"))

    correct = _grade(body.user_answer) if not body.reveal else False
    # What the final score will say for this question — the first answer, which
    # may not be the one just submitted.
    canonical_correct = _grade(prior.get("user_answer") or "") if prior else False

    windows: dict[int, dict] = {}
    solutions: dict[int, dict] = {}
    for row in payloads:
        p = row.get("payload") or {}
        for q, w in (p.get("audio_windows") or {}).items():
            windows[int(q)] = w
        for q, s in (p.get("solutions") or {}).items():
            solutions[int(q)] = s
    # Practice packs are a single section premixed alone with section_offsets
    # {sid: 0}, so this is a pass-through today. Routed through the shared
    # helper anyway: if practice ever gains a nonzero offset, the replay window
    # rebases with the review player instead of silently seeking past the answer.
    win = _rebase_audio_window(
        windows.get(body.q_num),
        (test_row.get("test_type") in ("mini", "practice")),
        (test_row.get("metadata") or {}).get("section_offsets") or {},
    )

    out = {
        "q_num":             body.q_num,
        "correct":           correct,
        "canonical_correct": canonical_correct,
        "recorded":          recorded,        # did THIS call set the canonical answer
        "answered_before":   prior is not None and not recorded,
        "audio_window":      win,
    }

    # Reveal is gated on the canonical answer already being on file AND wrong.
    # That makes it harmless: the score for this question is settled before the
    # key is ever handed out, so seeing it cannot buy back a point.
    if body.reveal:
        if prior is None:
            raise HTTPException(422, "Hãy thử trả lời trước khi xem đáp án.")
        if canonical_correct:
            raise HTTPException(422, "Câu này bạn đã trả lời đúng.")
        out["expected"]     = key_row.get("answer") or ""
        out["alternatives"] = key_row.get("alternatives") or []
        out["solution"]     = solutions.get(body.q_num) or {}
        out["revealed"]     = True
    return out


@user_router.post("/tests/attempts/{attempt_id}/submit", response_model=BlackEyeAttemptState | dict[str, Any])
@observe_operation("listening_test", "submit", correlate_by=("attempt_id",))
async def submit_listening_test_attempt(
    attempt_id: str,
    authorization: str | None = Header(default=None),
):
    """Finalize a student attempt: load the test's answer key, grade
    each user answer, roll up trap analytics, write the grading
    payload back to the attempt row, and return the result.
    """
    from datetime import datetime, timezone

    from services import listening_test_grader as grader

    user = await _require_auth(authorization)
    attempt = _fetch_attempt_or_404(attempt_id, user["id"])
    bind_owned_attempt(attempt)
    if await run_in_threadpool(blackeye.attempt_is_blackeye, supabase_admin, attempt):
        from fastapi.encoders import jsonable_encoder
        from starlette.responses import JSONResponse
        result = await run_in_threadpool(blackeye.submit, supabase_admin, attempt, user["id"])
        return JSONResponse(jsonable_encoder(result),
                            headers={"Cache-Control": "private, no-store"})
    if attempt.get("status") == "submitted":
        if (attempt.get("scoring_policy") or "diagnostic") == "report_only":
            exercise_rows = _practice_exercise_payloads(attempt["test_id"])
            report = grader.grade_report_only_attempt(
                attempt.get("answers") or [], exercise_rows, source_required=_source_required_for_test(attempt["test_id"]),
            )
            stored_summary = attempt.get("result_summary") or {}
            stored_details = attempt.get("grading_details") or []
            if stored_summary:
                report.update(stored_summary)
            if stored_details:
                report["per_question"] = stored_details
            return {
                "attempt_id": attempt_id,
                "scoring_policy": "report_only",
                "status": "submitted",
                **report,
            }
        # Lost-ACK reconciliation for the 4-skill mock parent. Retrying a
        # committed sealed submit must return the same opaque receipt; normal
        # attempts keep the historical 422 and never expose a second result.
        if _mock_sealed(attempt):
            receipt = {
                "received": True, "sitting_id": attempt["sitting_id"], "sealed": True
            }
            from services import mock_correction_service
            capture = mock_correction_service.capture_required_envelope(
                "listening", attempt, attempt.get("grading_details") or []
            )
            if capture:
                receipt.update(capture)
            return receipt
        raise HTTPException(422, "Attempt đã submit rồi — không thể submit lại.")
    if attempt.get("status") != "in_progress":
        raise HTTPException(422, "Attempt status không hợp lệ.")
    require_resume_active(attempt)
    # CLASSARCHIVE-0030 FR-004: an archived class takes no hand-in, also from
    # an attempt started before the archive. The submitted replay above stays.
    await asyncio.to_thread(
        require_class_attempt_accepts_work, supabase_admin, attempt, surface="listening")
    # An answer PATCH (fn_upsert_listening_answer) can commit while the gate
    # above awaits. Grade the answers of this re-read (the last await before
    # grading), and bind both finalize UPDATEs to exactly that array: a save
    # landing after it misses the CAS and the submit 409s, never a grade that
    # drops the answer.
    attempt = await asyncio.to_thread(_fetch_attempt_or_404, attempt_id, user["id"])
    if attempt.get("status") != "in_progress":
        raise HTTPException(409, "Attempt đã thay đổi; hãy tải lại trạng thái.")
    require_resume_active(attempt)
    graded_answers = attempt.get("answers") or []

    # Pull the test's exercises + extract the answer key.
    test_id = attempt["test_id"]
    from services.mock_paper_policy import load_marking_snapshot, guard_owned_attempt
    guard_owned_attempt(supabase_admin, "listening", attempt, purpose="submit")
    marking_snapshot = load_marking_snapshot(supabase_admin, "listening", attempt)
    if marking_snapshot is not None:
        from types import SimpleNamespace
        ex_res = SimpleNamespace(data=marking_snapshot["marking_rows"])
    else:
        sec_res = (
            supabase_admin.table("listening_content")
            .select("id")
            .eq("test_id", test_id)
            .execute()
        )
        section_ids = [r["id"] for r in (sec_res.data or [])]
        if not section_ids:
            raise HTTPException(500, "Test bundle thiếu section rows.")

        ex_res = (
            supabase_admin.table("listening_exercises")
            .select("payload")
            .in_("content_id", section_ids)
            .execute()
        )
    if (attempt.get("scoring_policy") or "diagnostic") == "report_only":
        report = grader.grade_report_only_attempt(
            graded_answers, ex_res.data or [], source_required=_source_required_for_test(test_id),
        )
        summary = {
            key: report[key] for key in (
                "checked_count", "correct_count", "unscored_count",
                "blank_count", "technical_error_count", "completion_count",
                "item_count",
            )
        }
        now_iso = datetime.now(timezone.utc).isoformat()
        finalized = (
            supabase_admin.table("listening_test_attempts")
            .update({
                "status": "submitted",
                "score": None,
                "band_estimate": None,
                "grading_details": report["per_question"],
                "trap_analytics": {},
                "result_summary": summary,
                "submitted_at": now_iso,
            })
            .eq("id", attempt_id)
            .eq("status", "in_progress")
            .eq("answers", json.dumps(graded_answers))
            .gt("resume_expires_at", now_iso)
            .execute()
        )
        if not finalized.data:
            fresh = _fetch_attempt_or_404(attempt_id, user["id"])
            if fresh.get("status") == "in_progress":
                require_resume_active(fresh)
            raise HTTPException(409, "Attempt đã thay đổi; hãy tải lại trạng thái.")
        return {
            "attempt_id": attempt_id,
            "scoring_policy": "report_only",
            "status": "submitted",
            **report,
        }
    from services import mock_correction_service
    from services.mock_paper_policy import frozen_answer_key
    answer_key = frozen_answer_key(supabase_admin, "listening", attempt)
    if answer_key is None:
        answer_key = grader.collect_answer_key(ex_res.data or [])
        from services import mock_correction_service
        answer_key = mock_correction_service.apply_scoring_overrides(
            "listening", test_id, answer_key
        )

    result = grader.grade_attempt(graded_answers, answer_key)
    now_iso = datetime.now(timezone.utc).isoformat()

    finalized = (
        supabase_admin.table("listening_test_attempts")
        .update({
            "status":          "submitted",
            "score":           result["score"],
            "grading_details": result["per_question"],
            "trap_analytics":  result["trap_analytics"],
            "band_estimate":   result["band_estimate"],
            "submitted_at":    now_iso,
        })
        .eq("id", attempt_id)
        .eq("status", "in_progress")
        .eq("answers", json.dumps(graded_answers))
        .gt("resume_expires_at", now_iso)
        .execute()
    )
    if not finalized.data:
        fresh = _fetch_attempt_or_404(attempt_id, user["id"])
        if fresh.get("status") == "in_progress":
            require_resume_active(fresh)
        raise HTTPException(409, "Attempt đã thay đổi; hãy tải lại trạng thái.")

    note_persisted_exam_result(finalized.data[0], expected_questions=answer_key)
    submitted_attempt = {
        **attempt,
        "status": "submitted",
        "score": result["score"],
        "grading_details": result["per_question"],
        "trap_analytics": result["trap_analytics"],
        "band_estimate": result["band_estimate"],
        "submitted_at": now_iso,
    }
    performance_finalized = mock_correction_service.finalize_item_observations(
        "listening", submitted_attempt, result["per_question"]
    )
    # Sealed 4-skill mock: grade + persist above (the admin's draft), but never
    # expose the score to the student until the sitting is released.
    if _mock_sealed(attempt):
        receipt = {"received": True, "sitting_id": attempt["sitting_id"], "sealed": True}
        capture = mock_correction_service.capture_required_envelope(
            "listening", submitted_attempt, result["per_question"]
        )
        if capture:
            receipt.update(capture)
        return receipt

    capture = mock_correction_service.capture_required_envelope(
        "listening", submitted_attempt, result["per_question"]
    )
    if capture:
        capture["performance_finalized"] = performance_finalized
        return capture

    return {
        "attempt_id":        attempt_id,
        **grader.score_fields(result["score"], result["per_question"]),
        "band_estimate":     result["band_estimate"],
        "section_breakdown": result["section_breakdown"],
        "trap_analytics":    result["trap_analytics"],
        "per_question":      result["per_question"],
        "performance_finalized": performance_finalized,
    }


class ListeningAttemptAbandonResponse(BaseModel):
    """EXAMLISTENT-0070 FR-012: the attempt is closed with no result."""

    model_config = ConfigDict(extra="forbid")

    attempt_id: str
    status: Literal["abandoned"]


_NO_STORE = {"Cache-Control": "private, no-store"}


def _abandon_conflict(reason: str) -> HTTPException:
    return HTTPException(409, {"reason": reason}, headers=_NO_STORE)


def _abandon_listening_attempt(attempt_id: str, user_id: str) -> tuple[dict, list, str]:
    """One conditional UPDATE (CAS on status), then a re-read to explain a miss.

    Only the learner's own self-selected attempt closes: no class item, no
    mock sitting, still ``in_progress`` and inside its resume window. The
    UPDATE is not bound to ``answers`` (abandoning drops the whole attempt),
    while both finalize UPDATEs of ``submit`` require ``status='in_progress'``,
    so exactly one of a racing submit and abandon writes. ``updated_at`` moves
    with the status, in the same UPDATE.

    Returns the body, the rows the UPDATE acknowledged (empty on a repeat) and
    the attempt's ``test_id``, for the evidence receipt.
    """
    attempt = _fetch_attempt_or_404(attempt_id, user_id)
    if blackeye.attempt_is_blackeye(supabase_admin, attempt):
        # The Black Eye unit has its own two-state lifecycle (in_progress,
        # submitted); it is not a self-selected exam-room test.
        raise _abandon_conflict("not_self_selected")
    now_iso = datetime.now(timezone.utc).isoformat()
    closed = (
        supabase_admin.table("listening_test_attempts")
        .update({"status": "abandoned", "updated_at": now_iso})
        .eq("id", attempt_id)
        .eq("user_id", user_id)
        .eq("status", "in_progress")
        .is_("sitting_id", "null")
        .is_("class_assignment_item_id", "null")
        .gt("resume_expires_at", now_iso)
        .execute().data or []
    )
    body = {"attempt_id": attempt_id, "status": "abandoned"}
    if closed:
        return body, closed, str(attempt.get("test_id"))
    fresh = _fetch_attempt_or_404(attempt_id, user_id)
    status = fresh.get("status")
    if status == "abandoned":
        return body, [], str(attempt.get("test_id"))
    if status == "submitted":
        raise _abandon_conflict("already_submitted")
    if fresh.get("sitting_id") or fresh.get("class_assignment_item_id"):
        raise _abandon_conflict("not_self_selected")
    if status == "in_progress" and not is_resume_active(fresh):
        raise _abandon_conflict("resume_expired")
    raise _abandon_conflict("attempt_changed")


@user_router.post(
    "/tests/attempts/{attempt_id}/abandon",
    response_model=ListeningAttemptAbandonResponse,
)
async def abandon_listening_test_attempt(
    attempt_id: uuid.UUID,
    authorization: str | None = Header(default=None),
):
    """EXAMLISTENT-0070 FR-012: abandon a self-selected Listening test.

    200 ``{attempt_id, status: "abandoned"}``, also when repeated. 404 when the
    attempt is not the caller's. 409 ``{"reason": ...}`` with
    ``already_submitted``, ``not_self_selected`` (class item, mock sitting,
    Black Eye unit) or ``resume_expired``. An abandoned attempt has no result;
    "Start test" creates a new attempt.
    """
    user = await _require_auth(authorization)
    result, closed, test_id = await asyncio.to_thread(_abandon_listening_attempt, str(attempt_id), user["id"])
    if closed:
        # The same core-evidence receipt as the start-over path
        # (note_abandoned_exam_attempts), written after the committed write.
        await record_explicit_exam_abandonment(
            closed, surface="listening_test", attempt_id=str(attempt_id), test_id=test_id, user_id=user["id"],
        )
    from starlette.responses import JSONResponse
    return JSONResponse(result, headers=_NO_STORE)


@user_router.get("/tests/attempts/{attempt_id}", response_model=BlackEyeAttemptState | dict[str, Any])
async def get_listening_test_attempt(
    attempt_id: str,
    authorization: str | None = Header(default=None),
):
    """Fetch a past attempt's grading. Owner-only (admin bypass not
    wired here — admins use ``/admin/listening/tests/{id}`` for the
    bundle view; per-attempt admin surfaces land in a future sprint).
    """
    user = await _require_auth(authorization)
    attempt = _fetch_attempt_or_404(attempt_id, user["id"])
    if await run_in_threadpool(blackeye.attempt_is_blackeye, supabase_admin, attempt):
        from fastapi.encoders import jsonable_encoder
        from starlette.responses import JSONResponse
        result = await run_in_threadpool(blackeye.state, supabase_admin, attempt)
        return JSONResponse(jsonable_encoder(result),
                            headers={"Cache-Control": "private, no-store"})
    if _mock_sealed(attempt):
        raise HTTPException(403, "Kết quả đang chờ giám khảo duyệt.")
    return {
        "attempt_id":      attempt["id"],
        "test_id":         attempt["test_id"],
        "status":          attempt["status"],
        **listening_score_fields(
            attempt.get("score"), attempt.get("grading_details") or []),
        "band_estimate":   attempt.get("band_estimate"),
        "answers":         attempt.get("answers") or [],
        "grading_details": attempt.get("grading_details") or [],
        "trap_analytics":  attempt.get("trap_analytics") or {},
        "scoring_policy":  attempt.get("scoring_policy") or "diagnostic",
        "result_summary":  attempt.get("result_summary") or {},
        "started_at":      attempt.get("started_at"),
        "submitted_at":    attempt.get("submitted_at"),
    }


@user_router.get(
    "/tests/attempts/{attempt_id}/review",
    response_model=BlackEyeActivityReview | ListeningAttemptReviewResponse,
)
async def get_listening_test_attempt_review(
    attempt_id: uuid.UUID,
    authorization: str | None = Header(default=None),
):
    """listening-review-ui (Phase B) — post-submit chữa-bài for a listening
    full test. Owner-only + HARD-gated on status=='submitted' (409 otherwise).
    Joins the attempt's grading_details (q_num · correct · user_answer ·
    expected) with each question's rich solution + audio replay window (stored
    in listening_exercises.payload.solutions / .audio_windows by the import),
    the per-section transcripts, the band-conversion table, the section offsets,
    and a signed URL for the full premixed audio (so the review player can seek
    each answer's window). Mirrors the reading review contract.

    Admin bypass (2026-07-12): an admin may open ANY submitted attempt's
    review — including a still-sealed 4-skill mock — so the mock-review
    console can reuse this same rich view while deciding the band, before
    releasing results. Everyone else keeps the existing ownership + seal
    gate unchanged."""
    user = await _require_auth(authorization)
    attempt_id = str(attempt_id)
    is_admin = await _is_admin(authorization)
    if is_admin:
        res = supabase_admin.table("listening_test_attempts").select("*").eq(
            "id", attempt_id,
        ).limit(1).execute()
        if not res.data:
            raise HTTPException(404, "Attempt not found", headers={"Cache-Control": "private, no-store"})
        attempt = res.data[0]
    else:
        attempt = _fetch_attempt_or_404(attempt_id, user["id"])
    if attempt.get("user_id") != user["id"]:
        target = await run_in_threadpool(blackeye.test_identity, supabase_admin, attempt["test_id"], missing_status=None)
        if blackeye.is_blackeye(target):
            raise HTTPException(404, "Attempt not found", headers={"Cache-Control": "private, no-store"})
    if await run_in_threadpool(blackeye.attempt_is_blackeye, supabase_admin, attempt):
        from fastapi.encoders import jsonable_encoder
        from starlette.responses import JSONResponse
        if attempt.get("user_id") != user["id"]:
            raise HTTPException(404, "Attempt not found", headers={"Cache-Control": "private, no-store"})
        result = await run_in_threadpool(blackeye.review, supabase_admin, attempt)
        return JSONResponse(jsonable_encoder(result),
                            headers={"Cache-Control": "private, no-store"})
    if attempt.get("status") != "submitted":
        raise HTTPException(409, "Chưa có chữa bài — attempt chưa submit.")
    if not is_admin and _mock_sealed(attempt):
        raise HTTPException(
            403, "Kết quả đang chờ giám khảo duyệt — chưa thể xem chữa bài.")

    if not is_admin:
        from services import mock_correction_service
        if mock_correction_service.capture_required_envelope(
            "listening", attempt, attempt.get("grading_details") or []
        ):
            raise HTTPException(
                409, "Hãy hoàn tất confidence trước khi xem đáp án và chữa bài."
            )

    return _assemble_listening_review(attempt, attempt_id)


@user_router.get("/source-collections/blackeye-v5-upper/units/U1", response_model=BlackEyeUnitPublic)
async def get_blackeye_unit(authorization: str | None = Header(default=None)):
    await _require_auth(authorization)
    from fastapi.encoders import jsonable_encoder
    from starlette.responses import JSONResponse
    inventory = await run_in_threadpool(blackeye.public_inventory, supabase_admin)
    unit = BlackEyeUnitPublic.model_validate(inventory)
    return JSONResponse(jsonable_encoder(unit), headers={"Cache-Control": "private, no-store"})

