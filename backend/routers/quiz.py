"""routers/quiz.py — Quick-Check player (student-facing, Pha 2).

Auth: get_supabase_user (Bearer JWT). The bank is served WITH answers so the
client grades instantly (QĐ-5); the Adaptive Mastery loop runs in the browser
and posts progress back here.

  GET   /api/quiz/banks?skill_area=&topic_id=   — list published banks.
  GET   /api/quiz/progress?skill_area=           — own per-bank mastery + sessions.
  GET   /api/quiz/mistakes?skill_area=           — own wrong answers, by word.
  GET   /api/quiz/banks/{bank_id}               — bank META + questions (+answers).
  GET   /api/quiz/banks/{bank_id}/resume        — carry-over word_stats.
  POST  /api/quiz/banks/{bank_id}/reset          — wipe mastery cache, restart the bank.
  POST  /api/quiz/sessions                       — start a session (+resume).
  POST  /api/quiz/sessions/{id}/progress         — batch log attempts + word_stats.
  PATCH /api/quiz/sessions/{id}                  — end a session (totals).
"""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Header, Query
from pydantic import BaseModel

from routers.auth import get_supabase_user
from services import quiz_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/quiz", tags=["quiz-player"])


class StartSessionBody(BaseModel):
    bank_id: str
    # 'retake' = phiên kiểm tra lại của cổng thuộc-bài (chỉ bank giáo trình).
    kind: str = "run"


class CourseVerdictBody(BaseModel):
    bank_id: str
    # Các phiên của lượt vừa làm — server tự cộng điểm từ dòng nó giữ.
    session_ids: list[str]


class ProgressBody(BaseModel):
    attempts: list[dict] = []
    word_stats: list[dict] = []


class EndSessionBody(BaseModel):
    duration_sec: int | None = None
    total_questions: int = 0
    total_correct: int = 0
    total_wrong: int = 0
    words_mastered: int = 0
    words_carried_over: int = 0
    ended_by: str | None = None


@router.get("/banks")
async def list_banks(
    skill_area: str | None = Query(default=None),
    topic_id: str | None = Query(default=None),
    authorization: str | None = Header(None),
):
    await get_supabase_user(authorization)
    return quiz_service.list_published_banks(skill_area=skill_area, topic_id=topic_id)


@router.get("/progress")
async def my_progress(
    skill_area: str | None = Query(default=None),
    authorization: str | None = Header(None),
):
    """The caller's own quiz progress — per-bank mastery + recent sessions.

    `skill_area` scopes it: the Vocabulary page's "📊 Tiến độ luyện tập" link
    must not list the learner's grammar banks (audit 2026-07-28 §C3).
    """
    user = await get_supabase_user(authorization)
    return quiz_service.student_progress(user_id=user["id"], skill_area=skill_area)


@router.get("/mistakes")
async def my_mistakes(
    skill_area: str | None = Query(default=None),
    authorization: str | None = Header(None),
):
    """The caller's own wrong answers, grouped by word.

    The in-session "Xem lại bài làm" list only ever existed in the tab's memory,
    so leaving the result screen destroyed it (audit 2026-07-28 §C2). The attempts
    were persisted all along — this is the missing read path.
    """
    user = await get_supabase_user(authorization)
    return quiz_service.student_mistakes(user["id"], skill_area=skill_area)


@router.get("/banks/{bank_id}")
async def get_bank(bank_id: UUID, authorization: str | None = Header(None)):
    user = await get_supabase_user(authorization)
    return quiz_service.get_bank_for_play(str(bank_id), user_id=user["id"])


@router.get("/banks/{bank_id}/resume")
async def resume(bank_id: UUID, authorization: str | None = Header(None)):
    user = await get_supabase_user(authorization)
    return quiz_service.get_resume(user_id=user["id"], bank_id=str(bank_id))


@router.get("/banks/{bank_id}/course-resume")
async def course_resume(bank_id: UUID, authorization: str | None = Header(None)):
    """Chỗ đang làm dở của bài tập theo buổi. Chỉ ĐỌC — không chốt gì cả."""
    user = await get_supabase_user(authorization)
    return quiz_service.get_course_resume(user_id=user["id"], bank_id=str(bank_id))


@router.post("/banks/{bank_id}/reset")
async def reset_progress(bank_id: UUID, authorization: str | None = Header(None)):
    """Wipe the caller's mastery cache for one bank so the adaptive test starts
    over from scratch. Session/attempt history is untouched (append-only log)."""
    user = await get_supabase_user(authorization)
    return quiz_service.reset_progress(user_id=user["id"], bank_id=str(bank_id))


@router.post("/sessions", status_code=201)
async def start_session(body: StartSessionBody, authorization: str | None = Header(None)):
    user = await get_supabase_user(authorization)
    return quiz_service.start_session(
        user_id=user["id"], bank_id=body.bank_id, kind=body.kind,
    )


class CourseWritingBody(BaseModel):
    bank_id: str
    # {qid: câu học viên viết}
    answers: dict[str, str] = {}


@router.get("/course/writing")
async def course_writing_state(bank_id: str, authorization: str | None = Header(None)):
    """Đề tự luận của bank + bản chấm nếu đã nộp."""
    user = await get_supabase_user(authorization)
    return quiz_service.course_writing_state(user_id=user["id"], bank_id=bank_id)


@router.post("/course/writing")
async def submit_course_writing(body: CourseWritingBody,
                                authorization: str | None = Header(None)):
    """Nộp CẢ CỤM tự luận — một lượt duy nhất cho mỗi học viên mỗi bank."""
    user = await get_supabase_user(authorization)
    return await quiz_service.submit_course_writing(
        user_id=user["id"], bank_id=body.bank_id, answers=body.answers,
    )


@router.post("/course/writing/draft")
async def save_course_writing_draft(
    body: CourseWritingBody, authorization: str | None = Header(None),
):
    """Lưu bản NHÁP phần tự luận. Không chấm, không chốt, gọi lại vô hại.

    Có đường này thì bản nháp sống qua đổi máy và xoá bộ nhớ trình duyệt —
    trước đó nó chỉ nằm trong `localStorage` của đúng một trình duyệt.
    """
    user = await get_supabase_user(authorization)
    return quiz_service.save_course_writing_draft(
        user_id=user["id"], bank_id=body.bank_id, answers=body.answers,
    )


@router.get("/course/report")
async def course_answer_report(bank_id: str, authorization: str | None = Header(None)):
    """Bài làm chi tiết của CHÍNH học viên: câu nào sai, em chọn gì, đáp án gì.

    Cùng một bộ dựng với mặt đọc của giáo viên — hai bộ dựng cho cùng một nội
    dung là hai chỗ để trôi khỏi nhau.
    """
    user = await get_supabase_user(authorization)
    return quiz_service.course_answer_report(user_id=user["id"], bank_id=bank_id)


@router.post("/course/verdict")
async def course_verdict(body: CourseVerdictBody, authorization: str | None = Header(None)):
    """Xét đạt/chưa đạt bài tập buổi sau một lượt (10 chặng hoặc 1 kiểm tra lại)."""
    user = await get_supabase_user(authorization)
    return quiz_service.course_verdict(
        user_id=user["id"], bank_id=body.bank_id, session_ids=body.session_ids,
    )


@router.post("/sessions/{session_id}/progress")
async def log_progress(
    session_id: UUID, body: ProgressBody, authorization: str | None = Header(None)
):
    user = await get_supabase_user(authorization)
    return quiz_service.log_progress(
        user_id=user["id"], session_id=str(session_id),
        attempts=body.attempts, word_stats=body.word_stats,
    )


@router.patch("/sessions/{session_id}")
async def end_session(
    session_id: UUID, body: EndSessionBody, authorization: str | None = Header(None)
):
    user = await get_supabase_user(authorization)
    return quiz_service.end_session(
        user_id=user["id"], session_id=str(session_id), data=body.model_dump(),
    )
