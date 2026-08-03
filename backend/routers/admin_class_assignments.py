"""routers/admin_class_assignments.py — giao bài cho lớp (GĐ 2).

Giai đoạn 2 của docs/CLASS_MANAGEMENT_PLAN_2026-08-02.md.

GĐ 2 ships Speaking only — the daily task the centre actually runs, due 19:00 —
because it is the narrowest path that exercises the whole loop: admin gives →
student sees → student submits → admin sees who has not. The other skills reuse
the same tables in GĐ 5.

Mounted under the same `/admin/cohorts` prefix as routers/cohorts.py; FastAPI
matches on the full path and `/assignments` cannot collide with `/members`,
`/students` or `/lessons`.

DELETE is allowed only while nothing has been submitted. Past that, removing the
row would erase the record that work was asked for and done — the admin archives
the assignment instead.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field, model_validator

from database import supabase_admin
from routers.admin import require_admin
from services.class_assignment_service import (
    EmptyRosterError,
    create_class_assignment,
    parse_due_time,
    progress_for_assignments,
    reconcile_ledger_from_sessions,
    reconcile_test_attempts,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/cohorts", tags=["admin", "class-assignments"])

# The speaking modes a class assignment may use. A SUBSET of what POST /sessions
# accepts, and deliberately so: `test_full` is excluded.
#
# A Full Test is a chain of THREE sessions (practice.js `_startNextPartInFullTest`
# creates parts 2 and 3), and its real result is the aggregate that
# get_full_test_summary() computes across all three. Only the opening session
# would carry `class_assignment_item_id`, so the ledger would record Part 1's
# band as the homework score — deterministically wrong for every assigned Full
# Test. Codex review round 3 found this; supporting it properly means threading
# the link across the chain and recording only on final aggregation, which is a
# feature of its own rather than a detail of "bài Speaking hằng ngày".
#
# Giving a half-working Full Test is worse than not offering it, so GĐ 2 offers
# the two single-session modes and rejects the third with a reason.
_SPEAKING_MODES = ("practice", "test_part")


# Skills a class assignment can carry today. Writing is absent on purpose: it
# has its own grading pipeline (writing_assignments, mig 036) and giving it means
# creating rows there too and linking them back — a different shape of work, kept
# out so this change stays reviewable. GĐ 5b.
_TEST_SKILLS = {"reading": "reading_tests", "listening": "listening_tests"}


class AssignmentCreate(BaseModel):
    """Speaking (a topic + mode) or Reading/Listening (a published paper).

    The two shapes share one payload because they share one ledger; which fields
    matter is decided by `skill`.
    """
    skill:        Literal["speaking", "reading", "listening"] = "speaking"
    title:        str = Field(min_length=1, max_length=300)
    # Speaking: `content_id` is now a TOPIC from the library (mig 002), not a
    # free-text subject. `topic` survives only as the display label the admin
    # saw when picking — the questions come from the bank, so what is assigned
    # is fixed at give time instead of being generated per student later.
    topic:        Optional[str] = Field(default=None, max_length=300)
    mode:         str = "practice"
    part:         int = Field(default=1, ge=1, le=3)
    # The paper (Reading/Listening) or the topic (Speaking) being assigned
    content_id:   Optional[str] = None
    due_date:     Optional[str] = None      # ISO date
    # Giờ hạn, giờ VN. Mặc định 19:00 nhưng admin đổi được — một lớp học buổi
    # tối cần hạn khác lớp học buổi sáng, và cho tới nay giờ này bị đóng cứng
    # trong backend nên không lớp nào đổi được.
    due_time:     Optional[str] = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    instructions: Optional[str] = Field(default=None, max_length=2000)
    lesson_id:    Optional[str] = None

    @model_validator(mode="after")
    def _check_shape(self):
        if self.skill == "speaking":
            # SHAPE of the task first, then WHICH task. An admin who picked Full
            # Test needs to hear why that shape is refused — telling them to pick
            # a topic instead sends them off to fix the wrong thing.
            if self.mode == "test_full":
                raise ValueError(
                    "Chưa giao được Full Test cho lớp: một lượt Full Test gồm ba phiên "
                    "nối nhau và điểm thật là điểm tổng hợp của cả ba. Hãy giao Luyện "
                    "tập hoặc Luyện từng Part."
                )
            if self.mode not in _SPEAKING_MODES:
                raise ValueError(f"mode phải là một trong: {sorted(_SPEAKING_MODES)}")
            if not (self.content_id or "").strip():
                raise ValueError("Bài Speaking cần chọn một chủ đề từ kho đề.")
        else:
            if not (self.content_id or "").strip():
                raise ValueError("Bài Reading/Listening cần chọn một đề.")
        return self

    @model_validator(mode="after")
    def _blank_date_is_none(self):
        # An emptied <input type=date> posts "" — that means "no deadline", not
        # an invalid date.
        if not self.due_date:
            self.due_date = None
        return self


def _require_cohort(cohort_id: str) -> None:
    rows = (
        supabase_admin.table("cohorts").select("id")
        .eq("id", cohort_id).limit(1).execute().data
    ) or []
    if not rows:
        raise HTTPException(404, "Không tìm thấy lớp")


@router.get("/{cohort_id}/assignments")
async def list_assignments(
    cohort_id: str,
    authorization: str | None = Header(default=None),
):
    """Assignments of one class, newest deadline first, each with its progress.

    `late` and `missing` are computed from timestamps at read time — there is no
    column for either, so they cannot go stale when a deadline moves.
    """
    await require_admin(authorization)
    _require_cohort(cohort_id)

    try:
        rows = (
            supabase_admin.table("class_assignments").select("*")
            .eq("cohort_id", cohort_id)
            .order("created_at", desc=True)
            .execute().data
        ) or []
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải bài giao: {exc}")

    # Repair any hand-in whose ledger write failed at completion time. The
    # student's completed session is the durable evidence; the practice page
    # fires PATCH /complete once and redirects, so there is no client retry, and
    # this is the moment the wrong number would otherwise be read.
    #
    # The list still renders if the repair fails — but it says so. Silently
    # computing progress from an unrepaired ledger returns "0 đã nộp" / "chưa
    # nộp" that look canonical while completed sessions exist, which is exactly
    # the false-but-plausible number this endpoint is supposed to prevent.
    reconcile_failed = False
    try:
        reconcile_ledger_from_sessions(supabase_admin, [a["id"] for a in rows])
        # Reading/Listening have no completion hook of their own — the test page
        # submits without knowing the class ledger exists — so their hand-ins are
        # detected from the attempt rows here.
        reconcile_test_attempts(supabase_admin, rows)
    except Exception as exc:
        reconcile_failed = True
        logger.warning("[class] ledger reconcile failed: %s", exc)

    try:
        progress = progress_for_assignments(supabase_admin, rows)
    except Exception as exc:
        # Say so rather than rendering zeros: "0 đã nộp" is a claim about the
        # class that a failed query has not earned.
        raise HTTPException(500, f"Lỗi khi tính tiến độ nộp bài: {exc}")

    result: dict[str, Any] = {
        "assignments": [{**a, "progress": progress.get(a["id"])} for a in rows]
    }
    if reconcile_failed:
        result["reconcile_failed"] = True
    return result


# Part 1 giao 2 câu, Part 3 giao 1 câu, Part 2 là một cue card.
#
# Not a style choice — it mirrors the exam. Part 1 is a short warm-up exchange,
# Part 3 is one discussion question explored in depth, and Part 2 is the long
# turn off a single card. Assigning six Part-1 questions at once would train a
# rhythm the test never asks for.
_QUESTIONS_PER_PART = {1: 2, 2: 1, 3: 1}


def _resolve_speaking_topic(cohort_id: str, body: "AssignmentCreate") -> tuple[str, dict]:
    """Chọn đề Speaking từ kho + chốt sẵn câu hỏi ngay lúc giao.

    Questions are picked HERE, not when the student opens the task. Generating
    them per student meant two learners on the same give could answer different
    questions, and the teacher could not see what they had actually set — so
    "did they do the assigned work?" had no answer.

    Part 1 and Part 3 are handed over as AUDIO with the text hidden, so a
    question with no rendered audio cannot be given: the student would open a
    task with nothing to listen to and no way to learn what was asked.
    """
    rows = (
        supabase_admin.table("topics").select("id, title, part, is_active")
        .eq("id", body.content_id).limit(1).execute().data
    ) or []
    if not rows:
        raise HTTPException(404, "Không tìm thấy chủ đề này trong kho đề.")
    topic = rows[0]
    if not topic.get("is_active"):
        raise HTTPException(400, "Chủ đề này đã tắt — hãy bật lại trước khi giao.")

    # Đã giao chủ đề này cho lớp chưa. There is a unique index behind this
    # (mig 182) because two admin tabs can pass this check at the same moment;
    # the check exists so the ADMIN gets a sentence instead of a 23505.
    dup = (
        supabase_admin.table("class_assignments").select("id, title, created_at")
        .eq("cohort_id", cohort_id).eq("skill", "speaking")
        .eq("content_id", body.content_id).limit(1).execute().data
    ) or []
    if dup:
        raise HTTPException(
            409,
            f"Lớp này đã được giao chủ đề \"{topic['title']}\" rồi "
            f"(bài giao \"{dup[0].get('title')}\"). Chọn chủ đề khác để học viên "
            f"không phải trả lời lại đúng câu đã làm.",
        )

    want = _QUESTIONS_PER_PART.get(body.part, 1)
    qs = (
        supabase_admin.table("topic_questions")
        .select("id, part, order_num, question_text, audio_url, "
                "cue_card_bullets, cue_card_reflection")
        .eq("topic_id", body.content_id).eq("part", body.part)
        .eq("is_active", True).order("order_num").execute().data
    ) or []
    if len(qs) < want:
        raise HTTPException(
            400,
            f"Chủ đề này chỉ có {len(qs)} câu Part {body.part}, cần {want}.",
        )

    if body.part in (1, 3):
        missing = [q for q in qs[:want] if not (q.get("audio_url") or "").strip()]
        if missing:
            raise HTTPException(
                400,
                f"Part {body.part} giao bằng audio (học viên không được xem chữ), "
                f"nhưng {len(missing)} câu của chủ đề này chưa có bản đọc đề. "
                f"Hãy tạo audio trước khi giao.",
            )

    chosen = qs[:want]
    return body.content_id, {
        "topic":        topic["title"],          # nhãn hiển thị, nguồn thật là content_id
        "mode":         body.mode,
        "part":         body.part,
        # Chốt sẵn ĐÚNG những câu này. Storing the ids rather than re-querying at
        # open time is what makes the give reproducible: editing the bank later
        # cannot silently change homework already handed out.
        "question_ids": [q["id"] for q in chosen],
    }


@router.post("/{cohort_id}/assignments", status_code=status.HTTP_201_CREATED)
async def create_assignment(
    cohort_id: str,
    body: AssignmentCreate,
    authorization: str | None = Header(default=None),
):
    """Give one task to every student on the roster.

    Returns `student_count` and `unactivated_count`. The UI must surface the
    second one: those students have no account, so nothing is ever shown to them
    and they will read as simply not having done the work.
    """
    admin = await require_admin(authorization)
    _require_cohort(cohort_id)

    content_id = None
    if body.skill == "speaking":
        content_id, content_config = _resolve_speaking_topic(cohort_id, body)
    else:
        # The paper must exist and be published before it is given: assigning an
        # unpublished or deleted test hands students a task that opens to an
        # error, and the ledger would still count them as owing it.
        table = _TEST_SKILLS[body.skill]
        cols = "id, title, status, exam_only"
        if body.skill == "listening":
            # Published is not the same as playable: a test whose assembled
            # audio was cleared (section audio replaced) still reads published,
            # but the student endpoint answers 422 "chưa có audio sẵn sàng".
            cols += ", full_audio_storage_path, assembled_audio_storage_path"
        rows = (
            supabase_admin.table(table).select(cols)
            .eq("id", body.content_id).limit(1).execute().data
        ) or []
        if not rows:
            raise HTTPException(404, "Không tìm thấy đề này.")
        if (rows[0].get("status") or "") != "published":
            raise HTTPException(400, "Đề này chưa xuất bản — hãy xuất bản trước khi giao.")
        if rows[0].get("exam_only"):
            # Reserved for mock sittings (mig 170): the student endpoints answer
            # 404 to anyone without one. Published is not the same as openable,
            # and the ledger would count the class as owing a paper none of them
            # can reach. Most of the Cambridge library is flagged this way.
            raise HTTPException(
                400,
                "Đề này dành riêng cho kỳ thi thử — không giao làm bài tập lớp được.",
            )
        if body.skill == "listening" and not (
            rows[0].get("assembled_audio_storage_path")
            or rows[0].get("full_audio_storage_path")
        ):
            raise HTTPException(
                400,
                "Đề nghe này chưa có audio sẵn sàng — không giao được.",
            )
        content_id = body.content_id
        content_config = {"test_title": rows[0].get("title")}

    try:
        result = create_class_assignment(
            supabase_admin,
            cohort_id=cohort_id,
            skill=body.skill,
            title=body.title,
            assigned_by=admin["id"],
            lesson_id=body.lesson_id,
            content_id=content_id,
            content_config=content_config,
            due_date=body.due_date,
            due_time=parse_due_time(body.due_time),
            instructions=body.instructions,
        )
    except EmptyRosterError as exc:
        # Raised BEFORE anything is inserted, so no orphan give is left behind.
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi giao bài: {exc}")

    return result


class AssignmentPatch(BaseModel):
    """Only `status` for now. Deadline/instruction edits would change what was
    asked of students who have already answered, which needs its own thinking."""
    status: Literal["published", "archived"]


@router.patch("/{cohort_id}/assignments/{assignment_id}")
async def update_assignment(
    cohort_id: str,
    assignment_id: str,
    body: AssignmentPatch,
    authorization: str | None = Header(default=None),
):
    """Archive (or re-publish) a give.

    This is the action DELETE tells the admin to use once anyone has submitted —
    and until now it did not exist, so a cancelled or mistaken assignment with
    one hand-in could never be closed and stayed startable forever. Archiving
    hides it from the student endpoints (`is_assignment_open`) while keeping
    every submission and its evidence.

    Both ids are in the WHERE clause so a stale tab cannot archive an assignment
    that now belongs to another class.
    """
    await require_admin(authorization)

    try:
        r = (
            supabase_admin.table("class_assignments")
            .update({"status": body.status})
            .eq("id", assignment_id).eq("cohort_id", cohort_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi cập nhật bài giao: {exc}")

    if not r.data:
        raise HTTPException(404, "Không tìm thấy bài giao trong lớp này")
    return r.data[0]


@router.delete("/{cohort_id}/assignments/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_assignment(
    cohort_id: str,
    assignment_id: str,
    authorization: str | None = Header(default=None),
):
    """Delete a give — only while nothing has been handed in.

    Both ids are in the WHERE clause so a stale tab cannot delete an assignment
    that now belongs to another class.
    """
    await require_admin(authorization)

    # Check-then-delete happens inside one locking transaction (mig 179). As two
    # PostgREST calls, a student completing their session in between was recorded
    # as submitted and then erased by ON DELETE CASCADE — destroying exactly the
    # evidence this guard exists to preserve.
    try:
        deleted = supabase_admin.rpc(
            "fn_delete_class_assignment_if_unsubmitted",
            {"p_assignment_id": assignment_id, "p_cohort_id": cohort_id},
        ).execute().data
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi xoá bài giao: {exc}")

    if deleted is None:
        raise HTTPException(404, "Không tìm thấy bài giao trong lớp này")
    if deleted is False:
        raise HTTPException(
            409,
            "Đã có học viên nộp bài này — không xoá được. Hãy lưu trữ bài giao thay vì xoá.",
        )
