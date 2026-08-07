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
import random
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field, model_validator

from database import supabase_admin
from services import speaking_flags
from services import speaking_question_audio as sqa
from services import tts_audio
from routers.admin import require_admin
from services.quiz_service import (
    bank_has_mcq,
    course_hand_in_score,
    reconcile_course_items,
)
from services.class_assignment_service import (
    CLASS_TZ,
    EmptyRosterError,
    AssignmentNotFoundError,
    SubsetNeedsStudentsError,
    backfill_assignment_items,
    create_class_assignment,
    mark_item_submitted,
    _ID_CHUNK,
    _at,
    _paged,
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


# Hạn của bài sau buổi học tính bằng NGÀY. Trần 90 ngày: quá đó thì "bài tập của
# buổi" đã thành một thứ khác, và một số gõ nhầm (700 thay vì 7) sẽ tạo ra bài
# giao không bao giờ trễ — tức là bảng tổng kết vĩnh viễn không có ai "chưa nộp".
_MAX_DUE_DAYS = 90


class AssignmentCreate(BaseModel):
    """Speaking (a topic + mode) or Reading/Listening (a published paper).

    The two shapes share one payload because they share one ledger; which fields
    matter is decided by `skill`.
    """
    skill:        Literal["speaking", "reading", "listening", "course"] = "speaking"
    # 'daily'  — bài hằng ngày: đề từ kho chung, hạn là một mốc trong ngày.
    # 'lesson' — bài sau buổi học: đề từ kho theo buổi, hạn tính bằng số ngày.
    kind:         Literal["daily", "lesson"] = "daily"
    # Chỉ dùng cho kind='lesson'. Hạn = ngày giao + N ngày, tại `due_time`.
    due_days:     Optional[int] = Field(default=None, ge=1, le=_MAX_DUE_DAYS)
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
    # Speaking: giáo viên tự chọn câu. Bỏ trống = web bốc ngẫu nhiên.
    #
    # Hai lựa chọn, không phải ba: "lấy N câu đầu" (hành vi cũ) không phải một
    # lựa chọn ai muốn — nó chỉ là thứ xảy ra khi không ai quyết.
    question_ids: Optional[list[str]] = None
    instructions: Optional[str] = Field(default=None, max_length=2000)
    lesson_id:    Optional[str] = None
    # Cổng thuộc-bài (chỉ skill='course'): dưới ngưỡng thì học viên kiểm tra
    # lại bằng mẫu `retake_size` câu tới khi đạt. Bỏ trống = mặc định của
    # quiz_service (80% / 20 câu). Dải trùng với mastery_config để giá trị nhập
    # tay không bị kẹp lệch đi một cách im lặng.
    pass_pct:     Optional[int] = Field(default=None, ge=50, le=100)
    # Giao cho MỘT NHÓM trong lớp. Bỏ trống = cả lớp (hành vi cũ, không đổi).
    #
    # Danh sách này được hàm SQL giao với `cohort_id` nên một id lớp khác lọt
    # vào sẽ bị bỏ — chốt nằm trong giao dịch, không phải ở tầng này.
    student_ids:  Optional[list[str]] = None
    retake_size:  Optional[int] = Field(default=None, ge=5, le=100)

    @model_validator(mode="after")
    def _check_kind(self):
        """Loại bài quyết định cách nhập HẠN, và hai cách không trộn được.

        Bài hằng ngày có một MỐC (giao sáng, hạn 7h tối cùng ngày). Bài sau buổi
        học có một KHOẢNG ("nộp trong 7 ngày"). Nhận cả hai cùng lúc thì phải
        chọn hộ người dùng cái nào thắng — và dù chọn thế nào cũng có một nửa số
        admin bị đặt sai hạn mà không biết.
        """
        if self.skill == "course":
            # Bài tập theo buổi: `content_id` là một BANK trong kho giáo trình.
            # Không có mode/part — bộ đề của buổi quyết định tất cả.
            if not (self.content_id or "").strip():
                raise ValueError("Bài tập theo buổi cần chọn một bộ bài tập.")
            return self
        if self.kind == "lesson":
            if self.skill != "speaking":
                raise ValueError(
                    "Bài sau buổi học hiện chỉ có cho Speaking. "
                    "Reading/Listening vẫn giao theo ngày.")
            if not self.due_days:
                raise ValueError("Bài sau buổi học cần số ngày được nộp.")
            if self.due_date:
                raise ValueError(
                    "Bài sau buổi học đặt hạn bằng SỐ NGÀY, không phải một ngày "
                    "cụ thể. Bỏ trống ngày hạn đi.")
        elif self.due_days:
            raise ValueError(
                "Số ngày chỉ dùng cho bài sau buổi học. Bài hằng ngày đặt hạn "
                "bằng ngày + giờ.")
        return self

    @model_validator(mode="after")
    def _check_shape(self):
        if self.kind == "lesson":
            # Đề của bài theo buổi là một BỘ ĐỀ, không phải chủ đề — và số câu do
            # bộ quyết, nên `part` ở payload không có nghĩa gì. Kiểm ở
            # `_resolve_speaking_lesson_set`.
            if not (self.content_id or "").strip():
                raise ValueError("Bài sau buổi học cần chọn một bộ đề của buổi.")
            if self.mode not in _SPEAKING_MODES:
                raise ValueError(f"mode phải là một trong: {sorted(_SPEAKING_MODES)}")
            return self
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
    # MỖI BỘ ĐỐI CHIẾU MỘT KHỐI RIÊNG. Ba bộ này đọc ba nguồn bằng chứng rời
    # nhau, nên gộp chung một `try` nghĩa là bộ Speaking hỏng thì bài theo buổi
    # KHÔNG ĐƯỢC THỬ VÁ dù mọi bảng nó cần vẫn khoẻ — trang bật cờ cảnh báo rồi
    # đứng yên, trong khi việc hoàn toàn làm được (codex cục bộ 06/08 vòng 4).
    reconcile_failed = False
    ids = [a["id"] for a in rows]
    for what, fn in (
        ("speaking", lambda: reconcile_ledger_from_sessions(supabase_admin, ids)),
        # Reading/Listening have no completion hook of their own — the test page
        # submits without knowing the class ledger exists — so their hand-ins are
        # detected from the attempt rows here.
        ("test-attempts", lambda: reconcile_test_attempts(supabase_admin, rows)),
        # Bài tập theo buổi có bảng riêng (`quiz_sessions`), mà đường vá của
        # Speaking chỉ đọc bảng `sessions` — một lượt ghi sổ hỏng ở chặng CUỐI
        # khi ấy không có gì cứu (codex PR 954).
        ("course", lambda: reconcile_course_items(supabase_admin, ids)),
    ):
        try:
            fn()
        except Exception as exc:
            reconcile_failed = True
            logger.warning("[class] ledger reconcile failed (%s): %s", what, exc)

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


def _audio_matches(q: dict, topic_title: str) -> bool:
    """Bản đọc có ĐÚNG là bản đọc của câu hỏi HIỆN TẠI không.

    Không chỉ hỏi "có audio chưa". Đường lưu audio là băm của chính câu đọc, nên
    sửa lời câu hỏi làm băm đổi — và một hàng còn giữ `audio_path` cũ nghĩa là
    file đang nói một đề khác với đề bộ chấm sẽ đọc.

    Chốt ở đầu GHI (xoá audio khi sửa lời) đã có, nhưng chốt này bắt cả những
    hàng ĐÃ lệch từ trước khi có chốt kia — dữ liệu cũ không tự sửa mình.

    Không đọc được đường thì coi như KHÔNG khớp: thà một chủ đề hiện là chưa sẵn
    sàng (admin chạy lại mẻ render là xong) còn hơn giao một bài mà học viên nghe
    một đằng bị chấm một nẻo.
    """
    if not (q.get("audio_url") or "").strip():
        return False
    stored = (q.get("audio_path") or "").strip()
    if not stored:
        # Hàng render trước khi có cột `audio_path`: không đối chiếu được, nhưng
        # cũng không có bằng chứng là lệch. Tin nó — mẻ render sau sẽ điền vào.
        return True
    try:
        script = sqa.script_fingerprint(sqa.build_script(
            part=q["part"], topic_title=topic_title,
            question_text=q.get("question_text") or ""))
        return stored == tts_audio.audio_path(script, sqa.VOICE, sqa.ENGINE)
    except Exception as exc:
        logger.warning("[class] audio-path check failed q=%s: %s", q.get("id"), exc)
        return False


def _not_enough(part: int, n_eligible: int, n_total: int, want: int) -> HTTPException:
    """Câu báo lỗi phân biệt THIẾU CÂU với THIẾU AUDIO — hai việc admin làm khác
    nhau: một cái phải soạn thêm đề, một cái chỉ cần chạy mẻ render."""
    if part in (1, 3) and n_total >= want:
        return HTTPException(
            400,
            f"Chủ đề này có {n_total} câu Part {part} nhưng chỉ {n_eligible} câu "
            f"đã có bản đọc đề, cần {want}. Hãy tạo audio trước khi giao.",
        )
    return HTTPException(
        400, f"Chủ đề này chỉ có {n_total} câu Part {part}, cần {want}.")


def _pick_chosen_questions(body: "AssignmentCreate", eligible: list, qs: list,
                           want: int) -> list:
    """Giáo viên tự chọn câu — kiểm rồi mới nhận.

    Danh sách đến từ trình duyệt, nên mọi điều kiện phải kiểm lại ở đây: một tab
    mở lâu có thể gửi id của câu đã bị tắt, hoặc câu vừa được sửa lời nên bản đọc
    hết giá trị.
    """
    ids = list(dict.fromkeys(body.question_ids or []))   # bỏ trùng, giữ thứ tự
    if len(ids) != len(body.question_ids or []):
        raise HTTPException(400, "Có câu bị chọn hai lần.")
    if len(ids) != want:
        raise HTTPException(
            400, f"Part {body.part} cần đúng {want} câu, bạn đã chọn {len(ids)}.")

    in_topic = {q["id"]: q for q in qs}
    unknown = [i for i in ids if i not in in_topic]
    if unknown:
        raise HTTPException(
            400, "Có câu không thuộc chủ đề/Part này (hoặc đã bị tắt).")

    ok = {q["id"] for q in eligible}
    no_audio = [i for i in ids if i not in ok]
    if no_audio:
        raise HTTPException(
            400,
            f"{len(no_audio)} câu bạn chọn chưa có bản đọc đề khớp với lời hiện "
            f"tại. Hãy chạy lại mẻ tạo audio rồi chọn lại.",
        )

    # Theo ĐÚNG thứ tự giáo viên chọn: họ vừa sắp mạch hội thoại, đừng sắp lại.
    return [in_topic[i] for i in ids]


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
        .select("id, part, order_num, question_text, question_type, level, "
                "audio_url, audio_path, cue_card_bullets, cue_card_reflection")
        .eq("topic_id", body.content_id).eq("part", body.part)
        .eq("is_active", True).order("order_num").execute().data
    ) or []

    # GIAO ĐƯỢC = còn bật, VÀ (với Part 1/3) có bản đọc KHỚP lời hiện tại.
    # Lọc trước khi chọn, thay vì chọn rồi mới kiểm: bản cũ lấy N câu đầu rồi báo
    # lỗi nếu chúng thiếu audio — nên một chủ đề có 7 câu mà đúng câu số 1 chưa
    # render sẽ không giao được, dù 6 câu còn lại sẵn sàng.
    eligible = ([q for q in qs if _audio_matches(q, topic["title"])]
                if body.part in (1, 3) else qs)

    if body.question_ids:
        chosen = _pick_chosen_questions(body, eligible, qs, want)
    else:
        if len(eligible) < want:
            raise _not_enough(body.part, len(eligible), len(qs), want)
        # NGẪU NHIÊN, chốt MỘT LẦN lúc giao. Bốc lại cho từng học viên sẽ làm hai
        # em cùng một bài giao trả lời hai bộ câu khác nhau — đúng thứ việc chốt
        # đề lúc giao đã bỏ đi.
        chosen = random.sample(eligible, want)
        # Giữ thứ tự gốc trong chủ đề: Part 1 là một mạch hội thoại, bốc ngẫu
        # nhiên là chọn CÂU NÀO, không phải đảo mạch.
        chosen.sort(key=lambda q: (q.get("order_num") or 0))
    return body.content_id, {
        "topic":        topic["title"],          # nhãn hiển thị, nguồn thật là content_id
        "mode":         body.mode,
        "part":         body.part,
        "question_ids": [q["id"] for q in chosen],
        # CHỤP NỘI DUNG, KHÔNG CHỈ ID. Chỉ lưu id thì lúc học viên mở bài, hệ
        # thống vẫn đọc lại `topic_questions` đang sống — nên admin sửa lời một
        # câu hoặc render lại audio sau khi giao sẽ khiến em mở TRƯỚC và em mở
        # SAU nhận nội dung khác nhau dưới cùng một bài giao.
        #
        # Bản chụp này là thứ khiến câu "hai em cùng một bài giao trả lời cùng
        # một bộ câu" đúng — trước đó nó chỉ là một lời hứa trong commit message.
        "questions": [{
            "id":                  q["id"],
            "part":                q.get("part"),
            "question_text":       q.get("question_text"),
            "question_type":       q.get("question_type"),
            "audio_url":           q.get("audio_url"),
            "cue_card_bullets":    q.get("cue_card_bullets"),
            "cue_card_reflection": q.get("cue_card_reflection"),
        } for q in chosen],
    }


# ── Bài sau buổi học: kho đề theo buổi ───────────────────────────────────────

_SET_COLS = "id, course_id, lesson_no, part, title, description, is_active"
_SET_Q_COLS = ("id, set_id, order_num, question_text, question_type, level, "
               "topic_label, audio_url, audio_path, cue_card_bullets, "
               "cue_card_reflection")


def _due_date_from_days(days: int) -> str:
    """N ngày → NGÀY hạn (ISO), tính theo hôm nay GIỜ VIỆT NAM.

    Ngày được chốt Ở ĐÂY rồi ghép với giờ hạn thành một MỐC TUYỆT ĐỐI — không
    lưu "còn N ngày" rồi đếm lúc đọc. Đếm lúc đọc sẽ làm hạn trôi theo thời điểm
    học viên mở bài, nên hai em cùng một bài giao có hai hạn khác nhau.

    `date.today()` của máy chủ là ngày UTC. Với người dùng UTC+7, từ 0h tới 7h
    sáng nó vẫn là hôm qua — nên "nộp trong 7 ngày" giao lúc 6h sáng sẽ ra hạn
    sớm hơn một ngày. Lỗi này vô hình với CI chạy ở UTC.
    """
    today = datetime.now(CLASS_TZ).date()
    return (today + timedelta(days=days)).isoformat()


def _cohort_course_id(cohort_id: str) -> str:
    """Khoá mà lớp này thuộc về.

    Lớp chưa gắn khoá thì KHÔNG trả danh sách rỗng: rỗng đọc như "khoá này chưa
    ai soạn đề", còn sự thật là "lớp này chưa được gắn vào khoá nào" — hai việc
    khác hẳn, và chỉ một trong hai admin sửa được ngay. (Trên prod hiện vẫn còn
    lớp có `course_id` NULL.)
    """
    rows = (supabase_admin.table("cohorts").select("id, name, course_id")
            .eq("id", cohort_id).limit(1).execute().data) or []
    course_id = (rows[0].get("course_id") if rows else None)
    if not course_id:
        raise HTTPException(
            400,
            "Lớp này chưa được gắn vào khoá nào, nên chưa có kho đề theo buổi. "
            "Hãy gắn lớp vào một khoá trước.")
    return course_id


def _lesson_set_questions(set_id: str, part: int) -> list[dict]:
    """Câu còn bật của một bộ, mỗi câu MANG SẴN `part`.

    `part` nằm ở bộ đề chứ không ở câu, nhưng mọi thứ phía sau — dựng câu đọc,
    đối chiếu băm audio, bản chụp đề — đều đọc `q["part"]`. Bơm vào ở ĐÂY, một
    chỗ, thay vì bắt từng nơi dùng tự nhớ.
    """
    rows = (supabase_admin.table("speaking_lesson_set_questions")
            .select(_SET_Q_COLS).eq("set_id", set_id).eq("is_active", True)
            .order("order_num").execute().data) or []
    return [{**r, "part": part} for r in rows]


def _set_question_ready(q: dict) -> bool:
    """Câu này giao được chưa — CÙNG LUẬT với kho chung.

    Dùng lại `_audio_matches` chứ không viết bản thứ hai: luật ở đây không phải
    "có audio chưa" mà "bản đọc có đúng là bản đọc của LỜI HIỆN TẠI không", và
    hai bản chép của cùng một luật sẽ trôi khỏi nhau.

    Chủ đề để dựng câu đọc là `topic_label` của RIÊNG câu đó, có thể là None.
    """
    if q.get("part") not in sqa.AUDIO_PARTS:
        return True                    # Part 2 là cue card, không cần audio
    return _audio_matches(q, q.get("topic_label") or None)


def _resolve_speaking_lesson_set(cohort_id: str, body: "AssignmentCreate") -> tuple[str, dict]:
    """Chọn bộ đề của một buổi + chốt sẵn câu hỏi ngay lúc giao.

    Cùng hình dạng trả về với `_resolve_speaking_topic`, nên mọi thứ phía sau —
    sổ cái, bảng tổng kết, phiếu làm bài, chốt che chữ — không phải phân biệt hai
    loại. Khác nhau chỉ ở NGUỒN đề và ở chỗ SỐ CÂU do bộ quyết chứ không cố định.
    """
    course_id = _cohort_course_id(cohort_id)

    rows = (supabase_admin.table("speaking_lesson_sets").select(_SET_COLS)
            .eq("id", body.content_id).limit(1).execute().data) or []
    if not rows:
        raise HTTPException(404, "Không tìm thấy bộ đề này.")
    st = rows[0]
    if not st.get("is_active"):
        raise HTTPException(400, "Bộ đề này đã tắt — hãy bật lại trước khi giao.")
    if st.get("course_id") != course_id:
        # Bộ đề thuộc về KHOÁ. Giao bộ của khoá khác nghĩa là giao nội dung lớp
        # này chưa học — và nó lọt được vào đây vì id đến từ trình duyệt.
        raise HTTPException(
            400, "Bộ đề này thuộc một khoá khác, không giao cho lớp này được.")

    dup = (supabase_admin.table("class_assignments").select("id, title")
           .eq("cohort_id", cohort_id).eq("skill", "speaking")
           .eq("content_id", body.content_id).limit(1).execute().data) or []
    if dup:
        raise HTTPException(
            409,
            f"Lớp này đã được giao bộ đề \"{st['title']}\" rồi "
            f"(bài giao \"{dup[0].get('title')}\"). Chọn buổi khác để học viên "
            f"không phải trả lời lại đúng câu đã làm.")

    part = st["part"]
    qs = _lesson_set_questions(body.content_id, part)
    if not qs:
        raise HTTPException(400, "Bộ đề này chưa có câu hỏi nào.")

    eligible = [q for q in qs if _set_question_ready(q)]
    if body.question_ids:
        chosen = _pick_set_questions(body, eligible, qs)
    else:
        # MẶC ĐỊNH LÀ CẢ BỘ. Bộ đề được soạn cho một buổi cụ thể, nên bốc ngẫu
        # nhiên trong đó là bỏ đi chính việc người soạn đã làm.
        if len(eligible) < len(qs):
            missing = len(qs) - len(eligible)
            raise HTTPException(
                400,
                f"Bộ đề có {len(qs)} câu nhưng {missing} câu chưa có bản đọc khớp "
                f"lời hiện tại. Hãy chạy mẻ tạo audio rồi giao lại.")
        chosen = eligible

    return body.content_id, {
        "topic":        st["title"],          # nhãn hiển thị
        "mode":         body.mode,
        "part":         part,
        "lesson_no":    st["lesson_no"],
        "question_ids": [q["id"] for q in chosen],
        # CHỤP NỘI DUNG, KHÔNG CHỈ ID — cùng lý do với kho chung: sửa bộ đề sau
        # khi giao sẽ khiến em mở TRƯỚC và em mở SAU nhận nội dung khác nhau dưới
        # cùng một bài giao.
        "questions": [{
            "id":                  q["id"],
            "part":                part,
            "question_text":       q.get("question_text"),
            "question_type":       q.get("question_type"),
            "audio_url":           q.get("audio_url"),
            "cue_card_bullets":    q.get("cue_card_bullets"),
            "cue_card_reflection": q.get("cue_card_reflection"),
        } for q in chosen],
    }


def _pick_set_questions(body: "AssignmentCreate", eligible: list, qs: list) -> list:
    """Giáo viên bớt câu khỏi bộ — kiểm rồi mới nhận.

    Khác kho chung ở một chỗ: không có SỐ CÂU cố định để đối chiếu, vì bộ đề dài
    ngắn tuỳ buổi. Nên chỉ đòi "ít nhất một câu, và mọi câu đều thuộc bộ này".
    """
    ids = list(dict.fromkeys(body.question_ids or []))
    if len(ids) != len(body.question_ids or []):
        raise HTTPException(400, "Có câu bị chọn hai lần.")
    if not ids:
        raise HTTPException(400, "Hãy chọn ít nhất một câu.")

    in_set = {q["id"]: q for q in qs}
    if [i for i in ids if i not in in_set]:
        raise HTTPException(400, "Có câu không thuộc bộ đề này (hoặc đã bị tắt).")

    ok = {q["id"] for q in eligible}
    no_audio = [i for i in ids if i not in ok]
    if no_audio:
        raise HTTPException(
            400,
            f"{len(no_audio)} câu bạn chọn chưa có bản đọc đề khớp với lời hiện "
            f"tại. Hãy chạy lại mẻ tạo audio rồi chọn lại.")

    # Theo THỨ TỰ TRONG BỘ, không theo thứ tự bấm chuột: người soạn đã sắp mạch
    # từ dễ tới khó, và một cú bấm lộn không nên đảo mạch ấy.
    return [in_set[i] for i in sorted(ids, key=lambda i: in_set[i].get("order_num") or 0)]


def _resolve_course_bank(cohort_id: str, body: "AssignmentCreate") -> tuple[str, dict]:
    """Chọn một bộ bài tập theo buổi từ kho của khoá mà lớp thuộc về.

    Bank giáo trình KHÔNG được xuất bản và không nằm trong danh sách tự chọn —
    bài giao này là cửa DUY NHẤT mở nó ra (services/quiz_service). Nên mọi điều
    kiện phải kiểm ở đây; không có lớp bảo vệ nào phía sau.
    """
    course_id = _cohort_course_id(cohort_id)

    rows = (supabase_admin.table("quiz_banks")
            .select("id, code, title, skill_area, course_id, lesson_no, words_count")
            .eq("id", body.content_id).limit(1).execute().data) or []
    if not rows:
        raise HTTPException(404, "Không tìm thấy bộ bài tập này.")
    bank = rows[0]
    if bank.get("skill_area") != "course":
        # Chặn việc giao nhầm một bank từ vựng/ngữ pháp qua đường này: chúng là
        # nội dung tự chọn, và giao chúng sẽ mở một trang không dựng cho chúng.
        raise HTTPException(400, "Bộ này không phải bài tập theo buổi.")
    if bank.get("course_id") != course_id:
        raise HTTPException(
            400, "Bộ bài tập này thuộc một khoá khác, không giao cho lớp này được.")

    # Bank rỗng vẫn "tồn tại". Giao nó nghĩa là học viên mở ra một trang trắng và
    # không có gì nói vì sao.
    n = (supabase_admin.table("quiz_questions").select("id", count="exact")
         .eq("bank_id", bank["id"]).limit(1).execute())
    if not (n.count or 0):
        raise HTTPException(400, "Bộ bài tập này chưa có câu hỏi nào.")

    dup = (supabase_admin.table("class_assignments").select("id, title")
           .eq("cohort_id", cohort_id).eq("skill", "course")
           .eq("content_id", body.content_id).limit(1).execute().data) or []
    if dup:
        raise HTTPException(
            409,
            f"Lớp này đã được giao \"{bank['title']}\" rồi "
            f"(bài giao \"{dup[0].get('title')}\").")

    cfg = {
        # Chỉ nhãn để hiển thị. Câu hỏi KHÔNG chụp vào đây: khác kho Speaking,
        # đề bài tập tới tay học viên qua endpoint quiz đã có cổng riêng, và chụp
        # thêm một bản ở đây là tạo ra một nguồn sự thật thứ hai để trôi.
        "test_title": bank["title"],
        "lesson_no":  bank.get("lesson_no"),
        "bank_code":  bank.get("code"),
    }
    # Cổng thuộc-bài: chỉ ghi khi admin ĐẶT — vắng mặt nghĩa là "theo mặc định
    # hiện hành", và mặc định được phép tiến hoá mà không phải sửa bài giao cũ.
    if body.pass_pct is not None:
        cfg["pass_pct"] = body.pass_pct
    if body.retake_size is not None:
        cfg["retake_size"] = body.retake_size
    return bank["id"], cfg


@router.get("/{cohort_id}/course-banks")
async def list_course_banks(
    cohort_id: str,
    authorization: str | None = Header(default=None),
):
    """Kho bài tập theo buổi của khoá mà lớp này thuộc về.

    Trả CẢ bộ không giao được kèm lý do — `already_given` là việc đã xong, còn
    `question_count = 0` là việc CHƯA làm (nạp tệp JSONL của buổi ấy).
    """
    await require_admin(authorization)
    _require_cohort(cohort_id)
    course_id = _cohort_course_id(cohort_id)

    banks = (supabase_admin.table("quiz_banks")
             .select("id, code, title, lesson_no, words_count")
             .eq("skill_area", "course").eq("course_id", course_id)
             .order("lesson_no").execute().data) or []
    if not banks:
        return {"items": []}

    given = {
        r["content_id"] for r in (
            supabase_admin.table("class_assignments").select("content_id")
            .eq("cohort_id", cohort_id).eq("skill", "course")
            .execute().data or []
        ) if r.get("content_id")
    }
    counts: dict = {}
    ids = [b["id"] for b in banks]
    for chunk in (ids[i:i + _ID_CHUNK] for i in range(0, len(ids), _ID_CHUNK)):
        for q in _paged(supabase_admin, "quiz_questions", "id, bank_id",
                        lambda q2, c=chunk: q2.in_("bank_id", c)):
            counts[q["bank_id"]] = counts.get(q["bank_id"], 0) + 1

    return {"items": [{
        "id":             b["id"],
        "code":           b.get("code"),
        "lesson_no":      b.get("lesson_no"),
        "title":          b.get("title"),
        "question_count": counts.get(b["id"], 0),
        "already_given":  b["id"] in given,
        "ready":          counts.get(b["id"], 0) > 0,
    } for b in banks]}


@router.get("/{cohort_id}/speaking-lesson-sets")
async def list_speaking_lesson_sets(
    cohort_id: str,
    authorization: str | None = Header(default=None),
):
    """Bộ đề theo buổi của khoá mà lớp này thuộc về.

    Trả CẢ bộ không giao được kèm lý do, đúng như danh sách chủ đề: `already_given`
    là việc đã xong, `ready: false` là việc CHƯA làm (chạy mẻ render).
    """
    await require_admin(authorization)
    _require_cohort(cohort_id)
    course_id = _cohort_course_id(cohort_id)

    sets = (supabase_admin.table("speaking_lesson_sets").select(_SET_COLS)
            .eq("course_id", course_id).eq("is_active", True)
            .order("lesson_no").execute().data) or []
    if not sets:
        return {"items": []}

    given = {
        r["content_id"] for r in (
            supabase_admin.table("class_assignments").select("content_id")
            .eq("cohort_id", cohort_id).eq("skill", "speaking")
            .execute().data or []
        ) if r.get("content_id")
    }

    part_of = {s["id"]: s["part"] for s in sets}
    by_set: dict[str, list] = {}
    ids = [s["id"] for s in sets]
    for chunk in (ids[i:i + _ID_CHUNK] for i in range(0, len(ids), _ID_CHUNK)):
        for q in (supabase_admin.table("speaking_lesson_set_questions")
                  .select(_SET_Q_COLS).in_("set_id", chunk).eq("is_active", True)
                  .order("order_num").execute().data or []):
            by_set.setdefault(q["set_id"], []).append(
                {**q, "part": part_of.get(q["set_id"])})

    items = []
    for s in sets:
        rows = by_set.get(s["id"], [])
        ready_n = sum(1 for q in rows if _set_question_ready(q))
        items.append({
            "id":             s["id"],
            "lesson_no":      s["lesson_no"],
            "part":           s["part"],
            "title":          s["title"],
            "description":    s.get("description"),
            "question_count": len(rows),
            "already_given":  s["id"] in given,
            # CẢ BỘ phải sẵn sàng: mặc định là giao trọn bộ, nên thiếu một câu là
            # chưa giao được. Nói ra số câu còn thiếu để admin biết việc còn bao xa.
            "ready":          bool(rows) and ready_n == len(rows),
            "missing_audio":  len(rows) - ready_n,
        })
    return {"items": items}


@router.get("/{cohort_id}/speaking-lesson-sets/{set_id}/questions")
async def list_lesson_set_questions(
    cohort_id: str,
    set_id: str,
    authorization: str | None = Header(default=None),
):
    """Câu trong một bộ, để giáo viên xem và nghe thử trước khi giao."""
    await require_admin(authorization)
    _require_cohort(cohort_id)
    course_id = _cohort_course_id(cohort_id)

    rows = (supabase_admin.table("speaking_lesson_sets").select(_SET_COLS)
            .eq("id", set_id).limit(1).execute().data) or []
    if not rows or rows[0].get("course_id") != course_id:
        raise HTTPException(404, "Không tìm thấy bộ đề này trong khoá của lớp.")
    st = rows[0]

    qs = _lesson_set_questions(set_id, st["part"])
    return {
        "set": {"id": st["id"], "lesson_no": st["lesson_no"], "part": st["part"],
                "title": st["title"], "description": st.get("description")},
        "items": [{
            "id":            q["id"],
            "order_num":     q.get("order_num"),
            "question_text": q.get("question_text"),
            "question_type": q.get("question_type"),
            "level":         q.get("level"),
            "topic_label":   q.get("topic_label"),
            # Đường nghe thử. Admin ĐƯỢC xem chữ — chốt che chữ áp cho học viên,
            # còn người giao bài phải biết mình đang giao gì.
            "audio_url":     q.get("audio_url"),
            "ready":         _set_question_ready(q),
        } for q in qs],
    }


@router.get("/{cohort_id}/speaking-topics")
async def list_speaking_topics(
    cohort_id: str,
    part: int = 1,
    authorization: str | None = Header(default=None),
):
    """Chủ đề Speaking giao được cho lớp này, ở một Part.

    Trả CẢ những chủ đề không giao được, kèm lý do — chứ không lặng lẽ bỏ đi.
    Hai lý do khác hẳn nhau và admin làm được hai việc khác nhau:

      * `already_given` — lớp này đã làm rồi. Việc đã xong, chọn chủ đề khác.
      * `ready: false`  — chưa có bản đọc đề. Việc CHƯA làm: chạy mẻ render
                          (`scripts/pregen_speaking_question_audio.py`) là dùng
                          được. Gộp hai thứ vào một chữ "không khả dụng" sẽ giấu
                          mất một việc đang chờ người làm.
    """
    await require_admin(authorization)
    _require_cohort(cohort_id)

    topics = (
        supabase_admin.table("topics").select("id, title, part")
        .eq("part", part).eq("is_active", True).order("title").execute().data
    ) or []
    if not topics:
        return {"items": [], "part": part}

    given = {
        r["content_id"] for r in (
            supabase_admin.table("class_assignments").select("content_id")
            .eq("cohort_id", cohort_id).eq("skill", "speaking")
            .execute().data or []
        ) if r.get("content_id")
    }

    want = _QUESTIONS_PER_PART.get(part, 1)
    # ĐÚNG NHỮNG CÂU SẼ ĐƯỢC CHỌN, không phải "đủ số câu có audio".
    #
    # Lệnh giao lấy `want` câu ĐẦU theo `order_num` và đòi CHÍNH chúng có audio.
    # Nếu ở đây chỉ đếm tổng số câu có audio thì một chủ đề mà câu 1 chưa render
    # xong nhưng câu 3, 4 đã có sẽ hiện là "sẵn sàng" — admin chọn rồi bị 400.
    # Hai đường phải chọn giống hệt nhau, nên cùng đọc `order_num` và cùng cắt
    # tiền tố.
    by_topic: dict[str, list] = {}
    titles = {t["id"]: t["title"] for t in topics}
    ids = [t["id"] for t in topics]
    for chunk in (ids[i:i + 100] for i in range(0, len(ids), 100)):
        for q in (
            supabase_admin.table("topic_questions")
            .select("topic_id, part, order_num, question_text, audio_url, audio_path")
            .eq("part", part)
            .eq("is_active", True).in_("topic_id", chunk)
            .order("order_num").execute().data or []
        ):
            by_topic.setdefault(q["topic_id"], []).append(q)

    counts: dict[str, int] = {}
    audio_ok: dict[str, int] = {}
    for tid, rows in by_topic.items():
        # Sắp lại ở Python: `.order()` áp cho cả truy vấn, còn ta gom theo chủ đề
        # nên thứ tự trong mỗi nhóm chỉ đúng nếu không có chủ đề nào xen kẽ —
        # một giả định không cần thiết phải tin.
        rows.sort(key=lambda r: (r.get("order_num") or 0))
        counts[tid] = len(rows)
        # ĐẾM TRÊN CẢ CHỦ ĐỀ, không phải trên `want` câu đầu.
        #
        # Lệnh giao nay LỌC trước rồi mới bốc/chọn trong số câu đã có bản đọc —
        # nên một chủ đề mà hai câu đầu chưa render nhưng hai câu sau đã xong
        # VẪN giao được. Đếm theo tiền tố ở đây sẽ báo "chưa sẵn sàng" và ẩn nó
        # khỏi ô chọn, trong khi POST hoàn toàn nhận.
        #
        # (Ở vòng review trước tôi sửa NGƯỢC lại — bắt chỗ này dùng tiền tố cho
        # khớp lệnh giao. Rồi lệnh giao đổi cách chọn, và hai bên lại lệch từ
        # phía kia. Hai đường quyết định cùng một việc thì phải cùng một luật,
        # không phải cùng một dòng mã.)
        audio_ok[tid] = sum(1 for r in rows
                            if _audio_matches(r, titles.get(tid, "")))

    needs_audio = part in (1, 3)
    items = []
    for t in topics:
        enough = counts.get(t["id"], 0) >= want
        voiced = (not needs_audio) or audio_ok.get(t["id"], 0) >= want
        items.append({
            "id": t["id"],
            "title": t["title"],
            "question_count": counts.get(t["id"], 0),
            "already_given": t["id"] in given,
            "ready": enough and voiced,
            "missing_audio": needs_audio and enough and not voiced,
        })
    return {"items": items, "part": part, "questions_per_give": want}


@router.get("/{cohort_id}/speaking-topics/{topic_id}/questions")
async def list_topic_questions(
    cohort_id: str,
    topic_id: str,
    part: int = 1,
    authorization: str | None = Header(default=None),
):
    """Câu hỏi của MỘT chủ đề, để giáo viên tự chọn.

    Trả CẢ câu chưa giao được, kèm `giveable` + lý do — chứ không lặng lẽ giấu.
    Giáo viên cần thấy "chủ đề này có 7 câu, 5 câu chọn được, 2 câu chờ tạo
    audio"; giấu đi thì họ chỉ thấy một danh sách ngắn không rõ vì sao ngắn.

    Với Part 1/3, `giveable` đòi bản đọc KHỚP lời hiện tại — không chỉ "có audio".
    Sửa lời câu hỏi làm bản đọc cũ hết giá trị, và giao nó nghĩa là học viên nghe
    một đằng bị chấm một nẻo.
    """
    await require_admin(authorization)
    _require_cohort(cohort_id)

    topics = (
        supabase_admin.table("topics").select("id, title, part, is_active")
        .eq("id", topic_id).limit(1).execute().data
    ) or []
    if not topics:
        raise HTTPException(404, "Không tìm thấy chủ đề này trong kho đề.")
    topic = topics[0]

    rows = (
        supabase_admin.table("topic_questions")
        .select("id, part, order_num, question_text, question_type, level, "
                "audio_url, audio_path, cue_card_bullets, cue_card_reflection")
        .eq("topic_id", topic_id).eq("part", part)
        .eq("is_active", True).order("order_num").execute().data
    ) or []

    needs_audio = part in (1, 3)
    items = []
    for q in rows:
        voiced = _audio_matches(q, topic["title"]) if needs_audio else True
        items.append({
            "id":            q["id"],
            "order_num":     q.get("order_num"),
            "question_text": q.get("question_text"),
            "question_type": q.get("question_type"),
            "level":         q.get("level"),
            "giveable":      voiced,
            # Giáo viên ĐƯỢC xem chữ — đây là màn admin. Chỉ học viên bị giấu.
            "blocked_by":    None if voiced else "audio",
            "audio_url":     q.get("audio_url") if voiced else None,
            "cue_card_bullets": q.get("cue_card_bullets"),
        })
    return {
        "topic": {"id": topic["id"], "title": topic["title"]},
        "part": part,
        "questions_per_give": _QUESTIONS_PER_PART.get(part, 1),
        "items": items,
    }


def _response_flags_for(items: list[dict]) -> dict[str, list]:
    """Cờ kỹ thuật cho từng phiên, gom về theo `artifact_id`.

    MỘT lượt đọc cho cả lớp, không phải một lượt cho mỗi học viên: một lớp 40 em
    sẽ thành 40 request và bảng tổng kết mở mất vài giây.

    Chỉ đọc phiên của những mục ĐÃ NỘP. Mục chưa nộp không có gì để gắn cờ, và
    `artifact_id` của chúng thường là None.
    """
    sids = list({
        it["artifact_id"] for it in items
        if it.get("artifact_id") and (it.get("artifact_kind") or "session") == "session"
        and it.get("submitted_at")
    })
    if not sids:
        return {}

    rows: list[dict] = []
    for chunk in (sids[i:i + _ID_CHUNK] for i in range(0, len(sids), _ID_CHUNK)):
        rows.extend(_paged(
            supabase_admin, "responses",
            "id, session_id, overall_band, duration_seconds, transcript, "
            "grading_status, score_confidence",
            lambda q, c=chunk: q.in_("session_id", c),
        ))

    out: dict[str, list] = {}
    for r in rows:
        # `submitted=True`: những phiên này thuộc mục ĐÃ NỘP, nên "chưa có điểm"
        # ở đây là chấm hỏng chứ không phải bài đang làm dở.
        for f in speaking_flags.flag_response({**r, "submitted": True}):
            out.setdefault(r["session_id"], []).append(f)
    return out


def _course_writing_count(bank_id: str | None) -> tuple[int, bool]:
    """(số câu TỰ LUẬN, đọc-được-hay-không) của một bộ đề theo buổi.

    Bảng tổng kết cần con số này để nói được câu "em ấy CHƯA nộp tự luận". Không
    có nó thì chỗ đáng lẽ là một lời nhắc lại là một ô trống — đúng thứ khiến
    giáo viên tưởng tính năng hỏng chứ không phải học viên chưa làm.

    Trả kèm cờ ĐỌC ĐƯỢC chứ không nuốt lỗi thành `0`: đọc hỏng mà trả 0 thì mọi
    dòng mang `writing_expected: false` và lời nhắc biến mất y như thể bộ đề
    không có phần viết — tức là hỏng đúng mục tiêu của chính bản vá này (codex
    cục bộ, 05/08).
    """
    if not bank_id:
        return 0, True
    try:
        n = (supabase_admin.table("quiz_questions").select("id", count="exact")
             .eq("bank_id", bank_id).eq("type", "writing").limit(1).execute()).count or 0
        return n, True
    except Exception as exc:  # noqa: BLE001
        logger.warning("[class] writing count failed bank=%s: %s", bank_id, exc)
        return 0, False


def _hand_in_status(item: dict, student: dict, due, sealed: bool) -> str:
    """Một lượt nộp đang ở trạng thái nào — MỘT luật cho mọi mặt đọc.

    Bảng tổng kết và ngăn kéo học viên trả lời cùng một câu hỏi về cùng một
    dòng, nên chúng phải trả lời giống nhau. Để mỗi bên tự tính là dựng sẵn hai
    chỗ trôi khỏi nhau, và cái trôi ở đây không kêu: hai màn cùng nói về em ấy,
    một màn bảo "chưa nộp", màn kia bảo "nộp trễ".

    `no-account` đứng trước mọi thứ: em ấy CHƯA TỪNG thấy bài. Lẫn nó vào
    "chưa nộp" là nhắc nhầm người.
    """
    if not student.get("user_id"):
        return "no-account"
    submitted_at = _at(item.get("submitted_at"))
    if submitted_at:
        return "late" if (due and submitted_at > due) else "submitted"
    return "missing" if sealed else "pending"


@router.get("/{cohort_id}/assignments/{assignment_id}/tally")
async def assignment_tally(
    cohort_id: str,
    assignment_id: str,
    authorization: str | None = Header(default=None),
):
    """Bảng tổng kết nộp bài của MỘT bài giao — từng học viên một dòng.

    KHÔNG có bảng lưu sẵn. Sau hạn hệ thống không nhận bài nữa (mig 182 +
    `is_accepting_submissions`), nên trạng thái suy ra từ `submitted_at` vs
    `due_at` ĐÃ đứng yên — "chốt" là một sự thật về thời gian, không phải một
    bản ghi phải chụp lại. Chụp thêm một bản chỉ tạo ra thứ có thể lệch với sổ
    cái, đúng cái quy tắc "trễ hạn/bỏ bài là SUY RA, không lưu" (mig 177) đã bỏ.

    `sealed` cho giao diện biết vẽ trạng thái nào: trước hạn con số còn đổi, sau
    hạn thì không. Hai thứ đó phải phân biệt được bằng mắt.
    """
    await require_admin(authorization)
    _require_cohort(cohort_id)

    rows = (
        supabase_admin.table("class_assignments").select("*")
        .eq("id", assignment_id).eq("cohort_id", cohort_id)
        .limit(1).execute().data
    ) or []
    if not rows:
        raise HTTPException(404, "Không tìm thấy bài giao trong lớp này")
    assignment = rows[0]

    # Vá sổ trước khi đếm: Reading/Listening không có móc hoàn thành, nên bài đã
    # nộp chỉ vào sổ khi có ai đó đọc. Đây chính là lúc con số sai sẽ bị nhìn.
    stale = False
    # Một khối cho mỗi bộ: xem chú thích ở `list_assignments`.
    for what, fn in (
        ("speaking", lambda: reconcile_ledger_from_sessions(supabase_admin, [assignment_id])),
        ("test-attempts", lambda: reconcile_test_attempts(supabase_admin, [assignment])),
        ("course", lambda: reconcile_course_items(supabase_admin, [assignment_id])),
    ):
        try:
            fn()
        except Exception as exc:
            stale = True
            logger.warning("[class] tally reconcile failed (%s) asg=%s: %s",
                           what, assignment_id, exc)

    items = _paged(
        supabase_admin, "class_assignment_items",
        "id, student_id, submitted_at, score, state, artifact_kind, artifact_id, "
        "passed_at, mastery",
        lambda q: q.eq("assignment_id", assignment_id),
    )
    # Tra theo ĐÚNG những học viên có mục trong bài giao này, không theo sĩ số
    # lớp hiện tại. Mục bài tập CỐ Ý sống sót khi học viên chuyển lớp — lọc theo
    # `cohort_id` thì em đã chuyển đi hiện ra tên trống và trạng thái "chưa kích
    # hoạt", kể cả khi em có tài khoản và đã nộp bài. Bảng tổng kết khi đó nói
    # khác sổ cái.
    sids = list({i["student_id"] for i in items if i.get("student_id")})
    students: dict = {}
    for chunk in (sids[i:i + _ID_CHUNK] for i in range(0, len(sids), _ID_CHUNK)):
        for s in _paged(supabase_admin, "students",
                        "id, full_name, student_code, user_id",
                        lambda q, c=chunk: q.in_("id", c)):
            students[s["id"]] = s

    due = _at(assignment.get("due_at"))
    now = datetime.now(timezone.utc)
    sealed = bool(due and now > due)

    flags_by_session = _response_flags_for(items) if assignment.get("skill") == "speaking" else {}

    # Mục nào ĐÃ có bài tự luận. Một lượt đọc cho cả bảng, không hỏi từng dòng.
    # mục → bản nộp tự luận (id, giờ chấm, số câu sạch/tổng). Lấy đủ NGAY từ
    # đầu vì lượt vá sổ bên dưới cần chúng: đóng dấu bằng giờ MỞ BẢNG sẽ biến
    # một bài nộp đúng hạn thành nộp trễ chỉ vì giáo viên mở muộn.
    writing_total, writing_ok = _course_writing_count(assignment.get("content_id"))
    if not writing_ok:
        stale = True
    # Có câu TRẮC NGHIỆM không — quyết định điểm của mục là kết quả trắc nghiệm
    # hay độ sạch bài viết (`course_hand_in_score`). Đọc một lần cho cả bảng.
    # `bank_has_mcq` tự lo chiều an toàn khi đọc hỏng — `_course_bank_shape`
    # KHÔNG ném, nên một `try/except` ở đây không bắt được gì (codex #994).
    has_mcq = False
    if assignment.get("skill") == "course":
        has_mcq = bank_has_mcq(assignment.get("content_id"))
    writing_by_item: dict = {}
    if assignment.get("skill") == "course":
        ids = [i["id"] for i in items]
        for chunk in (ids[i:i + _ID_CHUNK] for i in range(0, len(ids), _ID_CHUNK)):
            try:
                for r in ((supabase_admin.table("course_writing_submissions")
                           .select("id, class_assignment_item_id, graded_at, clean, total")
                           .in_("class_assignment_item_id", chunk).execute().data) or []):
                    if r.get("class_assignment_item_id"):
                        writing_by_item[r["class_assignment_item_id"]] = r
            except Exception as exc:  # noqa: BLE001
                # Đọc hỏng thì KHÔNG hiện nút — nhưng phải NÓI RA. Im lặng ở đây
                # biến "chưa đọc được" thành "em ấy chưa nộp gì": bảng trông vẫn
                # đầy đủ, còn đường vào bài tự luận thì biến mất mà không ai
                # biết vì sao (codex #940).
                stale = True
                logger.warning("[class] đọc bài tự luận hỏng asg=%s: %s", assignment_id, exc)

        # VÁ SỔ, không vá hiển thị. Lượt chốt sổ lúc nộp là best-effort và có
        # nuốt lỗi, nên một bài tự luận ĐÃ CHẤM vẫn có thể thiếu `submitted_at`.
        # Không vá thì dòng ấy hiện "chưa nộp" mà lại có nút "Xem tự luận" —
        # hai thứ mâu thuẫn trên cùng một dòng — và số đếm ở dưới đếm thiếu.
        # Bản thân bài tự luận đã chấm LÀ bằng chứng của một lượt nộp.
        for it in items:
            w = writing_by_item.get(it["id"])
            if not w:
                continue
            if it.get("submitted_at"):
                # ĐIỀN BÙ. Đã chốt sổ nhưng ô điểm còn trống nghĩa là lượt chốt
                # trước đó KHÔNG đọc được hình dạng bộ đề nên giữ điểm lại theo
                # chiều an toàn. Với bộ đề chỉ-có-viết thì không có
                # `course_verdict` nào sẽ điền, mà cả hai đường vá đều bỏ qua
                # dòng đã có `submitted_at` — ô ấy trống VĨNH VIỄN, và cả trang
                # học viên lẫn bảng giáo viên đọc đúng cột ấy (codex #994 vòng 2).
                #
                # `mark_item_submitted` không dùng được: nó chỉ ghi khi
                # `submitted_at` còn trống. Ghi thẳng cột điểm.
                if it.get("score") is None:
                    pct = course_hand_in_score(has_mcq=has_mcq,
                                               clean=w.get("clean"), total=w.get("total"))
                    if pct is not None:
                        try:
                            res = (supabase_admin.table("class_assignment_items")
                                   .update({"score": pct}).eq("id", it["id"])
                                   .is_("score", "null").execute())
                            if res.data:
                                it["score"] = pct
                            else:
                                # Lượt ghi KHÔNG thắng: `course_verdict` đã điền
                                # ô ấy giữa lúc đọc và lúc ghi. Chép `pct` vào
                                # bản trong bộ nhớ khi ấy là bảng nói điểm bài
                                # viết trong khi sổ giữ điểm trắc nghiệm — hai
                                # thứ lệch nhau cho tới khi tải lại trang
                                # (codex #994 vòng 3). Hỏi lại sổ.
                                back = (supabase_admin.table("class_assignment_items")
                                        .select("score").eq("id", it["id"])
                                        .limit(1).execute().data) or []
                                if back:
                                    it["score"] = back[0].get("score")
                        except Exception as exc:  # noqa: BLE001
                            stale = True
                            logger.warning("[class] điền bù điểm tự luận hỏng "
                                           "item=%s: %s", it["id"], exc)
                continue
            # Đóng dấu bằng GIỜ CHẤM của chính bản nộp, không phải giờ mở bảng:
            # lượt vá này chạy bất kỳ lúc nào giáo viên mở bảng, nên lấy "bây
            # giờ" sẽ ghi một bài nộp đúng hạn thành nộp TRỄ. Cùng lý do
            # `_record_class_hand_in` so với giờ phiên hoàn thành.
            when = _at(w.get("graded_at")) or datetime.now(timezone.utc)
            # MỘT luật cho cả hai đường chốt sổ. Đường kia là
            # `reconcile_course_items`; hai chỗ tự tính độ sạch bài viết thành
            # điểm của mục là hai chỗ để trôi khỏi nhau — và cái trôi ở đây xoá
            # mất kết quả trắc nghiệm mà không kêu.
            # `writing_total > 0` + `mcq_total > 0` là hình dạng bộ đề, đọc một
            # lần cho cả bảng ở trên.
            pct = course_hand_in_score(has_mcq=has_mcq,
                                       clean=w.get("clean"), total=w.get("total"))
            try:
                # `artifact_id` trỏ vào BẢN NỘP, không phải vào chính dòng mục —
                # nó là thứ nói cho mọi mặt đọc biết phải mở cái gì.
                if mark_item_submitted(
                    supabase_admin, item_id=it["id"],
                    artifact_kind="course_writing", artifact_id=w["id"],
                    score=pct, now=when,
                ):
                    # Sửa luôn dòng đang cầm trên tay: đọc lại cả bảng chỉ để
                    # lấy vài cột là một vòng gọi mạng không cần thiết.
                    it["submitted_at"] = when.isoformat()
                    it["state"] = "graded" if pct is not None else "submitted"
                    if pct is not None and it.get("score") is None:
                        it["score"] = pct
                    it["artifact_kind"] = "course_writing"
                    it["artifact_id"] = w["id"]
            except Exception as exc:  # noqa: BLE001
                stale = True
                logger.warning("[class] vá sổ tự luận hỏng item=%s: %s", it["id"], exc)

    out = []
    for it in items:
        s = students.get(it["student_id"]) or {}
        status_ = _hand_in_status(it, s, due, sealed)
        flags = flags_by_session.get(it.get("artifact_id")) or []
        out.append({
            "student_id":   it["student_id"],
            "name":         s.get("full_name") or "",
            "student_code": s.get("student_code"),
            "status":       status_,
            "submitted_at": it.get("submitted_at"),
            "score":        it.get("score"),
            # Cờ đi KÈM DÒNG, không nằm ở một bảng thứ hai: giáo viên đang đọc
            # danh sách này để biết ai cần mình, nên "bài của em này có vấn đề"
            # phải nằm ngay cạnh tên em ấy.
            "flags":        flags,
            "flag_level":   speaking_flags.worst(flags),
            # Cổng thuộc bài (chỉ bài course có): đạt/chưa + số lần kiểm tra
            # lại. "Trượt 2 lần rồi mới đạt" là tín hiệu cần kèm cặp — nó phải
            # tới mắt giáo viên, không nằm im trong jsonb.
            "passed_at":    it.get("passed_at"),
            "retakes":      sum(1 for a in ((it.get("mastery") or {}).get("attempts") or [])
                                if a.get("phase") == "retake"),
            # Số lượt ĐÃ XÉT. mark_item_submitted đóng dấu submitted ngay chặng
            # đầu, nên "đã nộp mà chưa passed_at" chưa chắc là trượt — có thể
            # em ấy đang làm dở. Chỉ khi đã có ít nhất một lượt xét mới được
            # nói "chưa đạt" (codex R6).
            "verdicts":     len(((it.get("mastery") or {}).get("attempts")) or []),
            # Đường mở thẳng bài làm: nghe audio + đọc nhận xét. Không có nó thì
            # giáo viên phải tự mò trong danh sách phiên toàn hệ thống, nên trên
            # thực tế không ai nghe bài của học viên mình cả. `artifact_kind` đi
            # kèm vì mỗi kỹ năng mở ở một trang khác — đoán từ id là đoán sai.
            "artifact_kind": it.get("artifact_kind"),
            "artifact_id":   it.get("artifact_id"),
            # Có bài tự luận để đọc không. Chỉ hiện nút khi THẬT SỰ có — một
            # liên kết mở ra "chưa nộp gì" tệ hơn không có liên kết.
            "has_writing":   it["id"] in writing_by_item,
            # Bộ đề này CÓ phần tự luận hay không — đi theo TỪNG DÒNG chứ không
            # nằm ở một biến toàn cục của trang: bộ vẽ một dòng phải tự đủ để
            # vẽ dòng ấy. Thiếu nó thì trang không phân biệt được "bài này không
            # có phần viết" với "em ấy chưa nộp phần viết", và cả hai hiện ra
            # như nhau: một ô trống không giải thích gì.
            "writing_expected": writing_total > 0,
        })
    # Chưa nộp lên đầu: đó là danh sách việc cần làm của giáo viên.
    _ORDER = {"missing": 0, "pending": 1, "no-account": 2, "late": 3, "submitted": 4}
    out.sort(key=lambda r: (_ORDER.get(r["status"], 9), r["name"].lower()))

    result = {
        "writing_total": writing_total,
        "assignment": {
            "id": assignment_id, "title": assignment.get("title"),
            "skill": assignment.get("skill"), "due_at": assignment.get("due_at"),
        },
        "sealed": sealed,
        "students": out,
        "counts": {
            "total":     len(out),
            "submitted": sum(1 for r in out if r["status"] in ("submitted", "late")),
            "late":      sum(1 for r in out if r["status"] == "late"),
            "missing":   sum(1 for r in out if r["status"] == "missing"),
            "no_account": sum(1 for r in out if r["status"] == "no-account"),
            # Đếm riêng, KHÔNG cộng vào "đã nộp": một bài nộp rồi mà chấm hỏng
            # vẫn là đã nộp. Trộn hai con số sẽ khiến giáo viên tưởng em ấy chưa
            # làm bài, trong khi lỗi nằm ở phía hệ thống.
            "flagged":   sum(1 for r in out if r["flags"]),
        },
    }
    if stale:
        result["homework_stale"] = True
    return result


@router.get("/{cohort_id}/assignments/{assignment_id}/writing/{student_id}")
async def student_course_writing(
    cohort_id: str,
    assignment_id: str,
    student_id: str,
    authorization: str | None = Header(default=None),
):
    """Bài TỰ LUẬN của MỘT học viên trong một bài giao theo buổi.

    Dữ liệu vốn đã được ghi đủ từ lúc chấm (`course_writing_submissions.items`
    giữ nguyên văn đề, bài học viên viết, bản sửa, danh sách lỗi, đáp án mẫu) —
    thứ thiếu là một mặt ĐỌC. Trước đó giáo viên chỉ thấy MỘT con số phần trăm
    trên bảng tổng kết và không có cách nào biết em ấy viết gì, sai gì.

    Đọc theo MỤC BÀI GIAO chứ không theo (bank, học viên): giao lại cùng bộ bài
    là một lượt khác, và trộn hai lượt vào nhau sẽ cho giáo viên đọc bài của
    lần giao trước (cùng lý do mig 192).
    """
    await require_admin(authorization)
    _require_cohort(cohort_id)

    rows = (supabase_admin.table("class_assignments")
            .select("id, cohort_id, title, skill")
            .eq("id", assignment_id).limit(1).execute().data) or []
    # Bài giao phải thuộc CHÍNH lớp trên đường dẫn — thiếu chốt này thì id của
    # một lớp khác vẫn đọc được qua đường của lớp mình.
    if not rows or rows[0].get("cohort_id") != cohort_id:
        raise HTTPException(404, "Không tìm thấy bài giao của lớp này")

    items = (supabase_admin.table("class_assignment_items")
             .select("id, student_id")
             .eq("assignment_id", assignment_id).eq("student_id", student_id)
             .limit(1).execute().data) or []
    if not items:
        raise HTTPException(404, "Học viên này không có mục trong bài giao")

    st = (supabase_admin.table("students")
          .select("id, full_name, student_code")
          .eq("id", student_id).limit(1).execute().data) or []

    subs = (supabase_admin.table("course_writing_submissions")
            .select("items, total, clean, model, graded_at")
            .eq("class_assignment_item_id", items[0]["id"])
            .limit(1).execute().data) or []

    return {
        "student": {
            "id":   student_id,
            "name": (st[0].get("full_name") if st else "") or "",
            "code": (st[0].get("student_code") if st else None),
        },
        "assignment": {"id": assignment_id, "title": rows[0].get("title")},
        # None = CHƯA NỘP. Khác hẳn "đã nộp mà rỗng" — trang phải nói được hai
        # chuyện ấy bằng hai câu khác nhau.
        "submission": (subs[0] if subs else None),
    }


def _longest_missing_run(cells: list[dict]) -> int:
    """Quãng BỎ BÀI liên tiếp dài nhất.

    Tổng số bài bỏ không phân biệt được hai em rất khác nhau: bỏ 3 bài rải rác
    là quên, bỏ 3 bài liên tiếp là đã rời đi. Câu hỏi của giáo viên ("ba tuần
    qua em nào ĐỨT QUÃNG") hỏi đúng con số này.

    Ô "không được giao" KHÔNG cắt quãng: em không có bài để bỏ thì đó không
    phải một lần quay lại. Nhưng cũng không kéo dài quãng.
    """
    best = run = 0
    for c in cells:
        st = c.get("state")
        if st == "missing":
            run += 1
            best = max(best, run)
        elif st == "none":
            continue
        else:
            run = 0
    return best


@router.get("/{cohort_id}/students/{student_id}/work")
async def student_work(
    cohort_id: str,
    student_id: str,
    authorization: str | None = Header(default=None),
):
    """Mọi bài giao của lớp mà MỘT em có phần — kèm đường mở thẳng bài đã làm.

    Vì sao cần một đường riêng thay vì gọi `tally` từng bài: giáo viên bấm vào
    tên một em để hỏi "em này đã làm gì", chứ không phải "bài này ai làm". Hỏi
    ngược bằng cách quét N bảng tổng kết là N lượt gọi mạng cho một câu hỏi,
    mỗi lượt kéo cả lớp về để lấy đúng một dòng.

    Trả về THEO BÀI GIAO, kể cả bài em ấy chưa đụng tới: "chưa làm" cũng là câu
    trả lời, và một danh sách chỉ có bài đã nộp thì không nói được em ấy đang
    thiếu gì.

    Trạng thái tính bằng `_hand_in_status` — CÙNG hàm bảng tổng kết dùng. Hai
    màn cùng nói về một em mà một màn bảo "chưa nộp", màn kia bảo "nộp trễ", là
    lỗi không kêu thành tiếng.
    """
    await require_admin(authorization)
    _require_cohort(cohort_id)

    # Lọc theo CẢ `cohort_id`. Chỉ lọc theo id thì bất kỳ admin nào đoán được
    # một id học viên đều đọc được bài của em ấy qua đường của lớp mình — và
    # mục bài tập CỐ Ý sống sót khi học viên chuyển lớp, nên một em đã rời đi
    # vẫn còn dòng ở lớp này để lộ ra. Sổ điểm danh là `students.cohort_id`
    # (WF-1), đúng thứ `_roster_student_ids` dùng để phát bài (codex cục bộ).
    students = (
        supabase_admin.table("students")
        .select("id, full_name, student_code, user_id")
        .eq("id", student_id).eq("cohort_id", cohort_id)
        .limit(1).execute().data
    ) or []
    if not students:
        raise HTTPException(404, "Không tìm thấy học viên trong lớp này")
    student = students[0]

    assignments = _paged(
        supabase_admin, "class_assignments",
        "id, title, skill, due_at, status, content_id, content_config, created_at",
        lambda q: q.eq("cohort_id", cohort_id),
    )
    if not assignments:
        return {"student": _student_brief(student), "items": []}

    # Vá sổ trước khi đọc, ĐÚNG bộ ba và đúng phạm vi `list_assignments` dùng.
    # Không vá thì một lượt ghi sổ hỏng biến thành "em ấy chưa làm bài", và đây
    # là màn giáo viên mở ra để kết luận đúng điều đó.
    stale = False
    asg_ids = [a["id"] for a in assignments]
    for what, fn in (
        ("speaking", lambda: reconcile_ledger_from_sessions(supabase_admin, asg_ids)),
        ("test-attempts", lambda: reconcile_test_attempts(supabase_admin, assignments)),
        ("course", lambda: reconcile_course_items(supabase_admin, asg_ids)),
    ):
        try:
            fn()
        except Exception as exc:  # noqa: BLE001
            stale = True
            logger.warning("[class] student-work reconcile failed (%s) sid=%s: %s",
                           what, student_id, exc)

    # Khoá theo bài giao là AN TOÀN, không phải phép đoán: mig 177 khai
    # `UNIQUE (assignment_id, student_id)` — mỗi em đúng một mục mỗi bài, để
    # chạy lại lượt phát bài là việc không-làm-gì chứ không phải bản sao thứ hai.
    items_by_asg: dict[str, dict] = {}
    for chunk in (asg_ids[i:i + _ID_CHUNK] for i in range(0, len(asg_ids), _ID_CHUNK)):
        for it in _paged(
            supabase_admin, "class_assignment_items",
            "id, assignment_id, student_id, submitted_at, score, state, "
            "artifact_kind, artifact_id, passed_at, mastery",
            lambda q, c=chunk: q.eq("student_id", student_id).in_("assignment_id", c),
        ):
            items_by_asg[it["assignment_id"]] = it

    # Mục nào có bài TỰ LUẬN đã chấm — một lượt đọc cho cả danh sách.
    item_ids = [it["id"] for it in items_by_asg.values()]
    writing_items: set = set()
    for chunk in (item_ids[i:i + _ID_CHUNK] for i in range(0, len(item_ids), _ID_CHUNK)):
        try:
            for r in ((supabase_admin.table("course_writing_submissions")
                       .select("class_assignment_item_id")
                       .in_("class_assignment_item_id", chunk).execute().data) or []):
                if r.get("class_assignment_item_id"):
                    writing_items.add(r["class_assignment_item_id"])
        except Exception as exc:  # noqa: BLE001
            # Nói ra. Im lặng ở đây biến "chưa đọc được" thành "em ấy chưa nộp
            # tự luận", và đường vào bài viết biến mất mà không ai biết vì sao.
            stale = True
            logger.warning("[class] student-work đọc tự luận hỏng sid=%s: %s",
                           student_id, exc)

    now = datetime.now(timezone.utc)
    out = []
    for a in assignments:
        it = items_by_asg.get(a["id"])
        if it is None:
            # Bài giao KHÔNG có phần của em ấy: bỏ hẳn, không vẽ dòng trống.
            # Bài giao chỉ THÊM người nhận, nên thiếu mục nghĩa là em ấy vào lớp
            # sau khi bài được giao — nói "chưa nộp" ở đây là buộc tội oan.
            continue
        due = _at(a.get("due_at"))
        out.append({
            "assignment_id": a["id"],
            "title":         a.get("title"),
            "skill":         a.get("skill"),
            "due_at":        a.get("due_at"),
            # Đi kèm vì nhóm KHÔNG HẠN xếp theo nó. Không mang ra thì phép xếp
            # bên dưới đọc `None` cho mọi dòng và trở thành một lệnh rỗng —
            # xanh mà không làm gì.
            "created_at":    a.get("created_at"),
            "archived":      a.get("status") == "archived",
            "status":        _hand_in_status(it, student, due, bool(due and now > due)),
            "submitted_at":  it.get("submitted_at"),
            "score":         it.get("score"),
            # `artifact_kind` đi kèm vì mỗi kỹ năng mở ở một trang khác — đoán
            # từ hình dạng id là đoán sai.
            "artifact_kind": it.get("artifact_kind"),
            "artifact_id":   it.get("artifact_id"),
            "has_writing":   it["id"] in writing_items,
            "bank_id":       a.get("content_id") if a.get("skill") == "course" else None,
        })
    # Mới nhất lên đầu: giáo viên hỏi "gần đây em ấy làm gì". Bài KHÔNG HẠN
    # xuống cuối chứ không lẫn lên đầu.
    #
    # Tách hai nhóm rồi nối, không dùng một khoá ghép cộng `reverse=True`: khoá
    # ghép `(due_at is None, due_at)` đảo ngược sẽ đẩy nhóm không-hạn lên TRƯỚC,
    # vì `True > False` — đúng ngược ý, và là loại lỗi đọc mã không thấy.
    dated = [r for r in out if r["due_at"]]
    undated = [r for r in out if not r["due_at"]]
    dated.sort(key=lambda r: r["due_at"], reverse=True)
    # Nhóm không-hạn cũng phải MỚI TRƯỚC. Bỏ nguyên thứ tự đầu vào là xếp theo
    # `id` — `_paged` sắp theo id để cửa sổ phân trang ổn định, mà id là UUID
    # ngẫu nhiên. Một danh sách hứa "mới nhất lên đầu" mà nửa dưới xếp ngẫu
    # nhiên thì nửa dưới ấy không đọc được (codex #989 vòng 2).
    undated.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    out = dated + undated

    result = {"student": _student_brief(student), "items": out}
    if stale:
        result["homework_stale"] = True
    return result


def _student_brief(s: dict) -> dict:
    return {
        "id": s.get("id"),
        "name": s.get("full_name") or "",
        "student_code": s.get("student_code"),
        "activated": bool(s.get("user_id")),
    }


@router.get("/{cohort_id}/speaking-daily")
async def speaking_daily_board(
    cohort_id: str,
    days: int = 21,
    authorization: str | None = Header(default=None),
):
    """Bảng tổng kết bài Speaking HẰNG NGÀY: học viên × ngày, xong hay chưa.

    Vì sao là một mặt đọc riêng chứ không phải bảng tổng kết của từng bài giao:
    lớp có bài gần như MỖI NGÀY, nên câu hỏi thật của giáo viên không phải "bài
    hôm nay ai nộp" mà là "ba tuần qua em nào đứt quãng". Trả lời được câu ấy
    bằng cách mở hai chục bảng tổng kết là không trả lời được.

    CHỈ `kind='daily'`. Bài sau buổi học có nhịp khác (hạn tính bằng ngày, một
    buổi một bài) nên xếp chung vào lưới theo ngày sẽ tạo ra những cột trống
    đọc như bỏ bài.

    Ngày là NGÀY VIỆT NAM của hạn nộp (`CLASS_TZ`), không phải ngày UTC: một
    bài hạn 19:00 giờ VN rơi vào 12:00Z — lấy ngày UTC vẫn đúng ở đây, nhưng
    hạn 07:00 sáng thì thành ngày HÔM TRƯỚC, và cả cột lệch đi một ngày.
    """
    await require_admin(authorization)
    _require_cohort(cohort_id)

    days = max(1, min(int(days or 21), 120))

    assignments = _paged(
        supabase_admin, "class_assignments",
        "id, title, kind, status, due_at, created_at",
        lambda q: q.eq("cohort_id", cohort_id).eq("skill", "speaking").eq("kind", "daily"),
    )
    # Đã lưu trữ thì không đếm là bỏ bài — nó bị đóng vì một quyết định của
    # giáo viên, không phải vì em ấy không làm.
    assignments = [a for a in assignments if (a.get("status") or "") != "archived"]
    if not assignments:
        return {"tasks": [], "students": [], "assignment_count": 0, "stale": False}

    def _day(a: dict) -> str | None:
        at = _at(a.get("due_at")) or _at(a.get("created_at"))
        return at.astimezone(CLASS_TZ).date().isoformat() if at else None

    dated = [(d, a) for a in assignments if (d := _day(a))]
    if not dated:
        return {"tasks": [], "students": [], "assignment_count": len(assignments),
                "stale": False}

    # Mới nhất bên phải, và chỉ giữ `days` ngày gần nhất — một lưới 200 cột
    # không đọc được, và câu hỏi là về nhịp gần đây.
    day_list = sorted({d for d, _ in dated})[-days:]
    keep = set(day_list)
    by_day: dict = {}
    for d, a in dated:
        if d in keep:
            by_day.setdefault(d, []).append(a["id"])

    # Cột là BÀI GIAO, xếp theo hạn rồi theo tên để thứ tự ổn định giữa hai lần
    # tải (hai bài cùng hạn mà đảo chỗ thì giáo viên đọc nhầm cột).
    picked = sorted(((d, a) for d, a in dated if d in keep),
                    key=lambda x: (x[0], x[1].get("due_at") or "", x[1].get("title") or ""))
    tasks = [{"id": a["id"], "title": a.get("title") or "", "day": d,
              "due_at": a.get("due_at")} for d, a in picked]
    aids = [t["id"] for t in tasks]
    keep_ids = set(aids)

    # VÁ SỔ TRƯỚC KHI ĐẾM — y như bảng tổng kết từng bài đang làm.
    #
    # Móc chốt sổ lúc hoàn thành phiên là best-effort (hỏng thì chỉ log). Đọc
    # thẳng sổ nghĩa là một phiên ĐÃ XONG vẫn hiện ✕ cho tới khi có ai đó mở
    # bảng tổng kết của đúng bài ấy — bảng này thì lại là chỗ giáo viên nhìn
    # trước, nên nó sẽ là chỗ đầu tiên nói sai (codex #931).
    stale = False
    try:
        reconcile_ledger_from_sessions(supabase_admin, aids)
    except Exception as exc:  # noqa: BLE001
        stale = True
        logger.warning("[class] daily board reconcile failed cohort=%s: %s", cohort_id, exc)

    items: list[dict] = []
    for chunk in (aids[i:i + _ID_CHUNK] for i in range(0, len(aids), _ID_CHUNK)):
        items.extend(_paged(
            supabase_admin, "class_assignment_items",
            "id, assignment_id, student_id, submitted_at, score, artifact_kind, artifact_id",
            lambda q, c=chunk: q.in_("assignment_id", c),
        ))

    sids = list({i["student_id"] for i in items if i.get("student_id")})
    students: dict = {}
    for chunk in (sids[i:i + _ID_CHUNK] for i in range(0, len(sids), _ID_CHUNK)):
        for st in _paged(supabase_admin, "students",
                         "id, full_name, student_code, user_id",
                         lambda q, c=chunk: q.in_("id", c)):
            students[st["id"]] = st

    due_of = {a["id"]: _at(a.get("due_at")) for _d, a in dated}
    now = datetime.now(timezone.utc)
    # (student, BÀI GIAO) → ô. Trước đây khoá theo NGÀY rồi gộp nhiều bài trong
    # cùng ngày thành một ô — nên một ngày giao hai bài chỉ hiện được một, và
    # một em nộp bài A mà bỏ bài B đọc thành "ngày ấy có làm". Cột nay là BÀI,
    # nên không còn phép gộp nào che mất bài thứ hai.
    cells: dict = {}
    for it in items:
        aid = it["assignment_id"]
        if aid not in keep_ids:
            continue
        sub = _at(it.get("submitted_at"))
        due = due_of.get(aid)
        if sub:
            state = "late" if (due and sub > due) else "done"
        elif due and now > due:
            state = "missing"
        else:
            state = "pending"     # chưa tới hạn — chưa phải là bỏ bài
        cells[(it["student_id"], aid)] = {
            "state": state,
            "score": it.get("score"),
            "session_id": (it.get("artifact_id")
                           if it.get("artifact_kind") == "session" else None),
        }

    rows = []
    for sid, st in students.items():
        line = [cells.get((sid, t["id"]))
                or {"state": "none", "score": None, "session_id": None}
                for t in tasks]
        graded = [c["score"] for c in line if c.get("score") is not None]
        rows.append({
            "student_id":   sid,
            "name":         st.get("full_name") or "",
            "student_code": st.get("student_code"),
            "activated":    bool(st.get("user_id")),
            "cells":        line,
            "done":         sum(1 for c in line if c["state"] in ("done", "late")),
            "missing":      sum(1 for c in line if c["state"] == "missing"),
            # Quãng đứt DÀI NHẤT — khác hẳn tổng số bài bỏ. Bỏ 3 bài rải rác là
            # một chuyện, bỏ 3 bài liên tiếp là em ấy đã rời đi.
            "streak":       _longest_missing_run(line),
            "avg_band":     round(sum(graded) / len(graded), 2) if graded else None,
        })

    # Quãng đứt dài nhất lên đầu, rồi mới tới tổng số bài bỏ — đây là danh sách
    # việc, không phải bảng xếp hạng.
    rows.sort(key=lambda r: (-r["streak"], -r["missing"], r["name"].lower()))
    return {
        "tasks": tasks,
        "students": rows,
        "assignment_count": len(tasks),
        # Nói RA khi con số có thể còn thiếu. Im lặng ở đây là để giáo viên nhắc
        # nhầm một em đã nộp.
        "stale": stale,
    }


@router.get("/{cohort_id}/speaking-performance")
async def speaking_performance(
    cohort_id: str,
    authorization: str | None = Header(default=None),
):
    """Học viên nào đang khá lên, ai đang đuối — trải CẢ hai loại bài Speaking.

    Một bảng, không phải hai. Bài hằng ngày và bài sau buổi học khác nhau ở
    nguồn đề và cách đặt hạn; còn "em này đang tiến bộ hay tụt" thì không có lý
    do gì để trả lời riêng cho từng loại. Tách ra sẽ giấu mất đúng cái so sánh
    quan trọng nhất.

    SO VỚI CHÍNH EM ẤY, không so với lớp. Một em band 5.0 đều đặn không có vấn
    đề gì; một em từ 7.0 tụt xuống 6.0 thì có — dù em thứ hai vẫn cao hơn. Xếp
    hạng trong lớp trả lời một câu hỏi khác, và ở đây nó sẽ chôn mất em thứ hai.
    """
    await require_admin(authorization)
    _require_cohort(cohort_id)

    assignments = _paged(
        supabase_admin, "class_assignments",
        "id, title, kind, status, due_at, created_at",
        lambda q: q.eq("cohort_id", cohort_id).eq("skill", "speaking"),
    )
    if not assignments:
        return {"items": [], "assignment_count": 0}

    # Cũ → mới. Nhịp học là một chuỗi thời gian, nên mọi thứ dưới đây phụ thuộc
    # vào thứ tự này đúng.
    assignments.sort(key=lambda a: (a.get("due_at") or a.get("created_at") or ""))
    order = {a["id"]: i for i, a in enumerate(assignments)}
    due_of = {a["id"]: _at(a.get("due_at")) for a in assignments}
    # Bài đã LƯU TRỮ không đếm vào "trễ / bỏ bài".
    #
    # Lưu trữ là cách đóng một bài giao khi xoá đã bị chặn (đã có người nộp) —
    # giao nhầm, đổi kế hoạch, lớp nghỉ. Đếm những em còn lại là "bỏ bài" ở đó là
    # trách các em vì một quyết định của giáo viên, và đủ hai lần như vậy thì cờ
    # "đang đuối" nổ oan.
    #
    # Nhưng bài ĐÃ NỘP trong một bài giao đã lưu trữ vẫn là việc thật các em đã
    # làm, nên ĐIỂM vẫn được tính. Chỉ bỏ phần trạng thái trễ/thiếu.
    archived = {a["id"] for a in assignments if (a.get("status") or "") == "archived"}

    aids = [a["id"] for a in assignments]
    items: list[dict] = []
    for chunk in (aids[i:i + _ID_CHUNK] for i in range(0, len(aids), _ID_CHUNK)):
        items.extend(_paged(
            supabase_admin, "class_assignment_items",
            "id, assignment_id, student_id, submitted_at, score, artifact_id, artifact_kind",
            lambda q, c=chunk: q.in_("assignment_id", c),
        ))
    if not items:
        return {"items": [], "assignment_count": len(assignments)}

    sids = list({i["student_id"] for i in items if i.get("student_id")})
    students: dict = {}
    for chunk in (sids[i:i + _ID_CHUNK] for i in range(0, len(sids), _ID_CHUNK)):
        for s in _paged(supabase_admin, "students",
                        "id, full_name, student_code, user_id",
                        lambda q, c=chunk: q.in_("id", c)):
            students[s["id"]] = s

    flags_by_session = _response_flags_for(items)

    now = datetime.now(timezone.utc)
    by_student: dict = {}
    for it in items:
        by_student.setdefault(it["student_id"], []).append(it)

    out = []
    for sid, rows in by_student.items():
        s = students.get(sid) or {}
        rows.sort(key=lambda r: order.get(r["assignment_id"], 0))

        bands, states, broken = [], [], []
        for r in rows:
            due = due_of.get(r["assignment_id"])
            sub = _at(r.get("submitted_at"))
            if sub:
                late = bool(due and sub > due) and r["assignment_id"] not in archived
                states.append("late" if late else "submitted")
                # `assignments` đã lọc skill='speaking' ở truy vấn đầu hàm, nên
                # score ở đây LUÔN là band — điểm % của bài course không có
                # đường vào. Nới bộ lọc skill ấy thì phải lọc lại ở đây, vì
                # flag_student tính median band và một điểm 85 sẽ làm nó nổ.
                if r.get("score") is not None:
                    bands.append(float(r["score"]))
            elif r["assignment_id"] in archived:
                states.append("pending")     # xem ghi chú `archived` ở trên
            elif due and now > due:
                states.append("missing")
            else:
                # Chưa tới hạn thì CHƯA phải là bỏ bài. Đếm nó vào sẽ gắn cờ cho
                # cả những em đang còn thời gian làm.
                states.append("pending")
            broken.extend(flags_by_session.get(r.get("artifact_id")) or [])

        # Cờ sư phạm không áp cho em chưa kích hoạt tài khoản: em ấy CHƯA TỪNG
        # thấy bài nào, nên "bỏ bài" là nói sai về em.
        person = (speaking_flags.flag_student(
            submitted_bands=bands,
            recent_states=[st for st in states if st != "pending"])
            if s.get("user_id") else [])

        # Hai họ cờ GIỮ RIÊNG. Một bên là "sửa dữ liệu", một bên là "nhắn cho
        # em ấy" — gộp lại thì đọc xong không biết làm gì.
        all_flags = person + broken
        out.append({
            "student_id":   sid,
            "name":         s.get("full_name") or "",
            "student_code": s.get("student_code"),
            "activated":    bool(s.get("user_id")),
            "assigned":     len(rows),
            "submitted":    sum(1 for st in states if st in ("submitted", "late")),
            "late":         sum(1 for st in states if st == "late"),
            "missing":      sum(1 for st in states if st == "missing"),
            "bands":        bands,
            "latest_band":  bands[-1] if bands else None,
            "avg_band":     round(sum(bands) / len(bands), 2) if bands else None,
            "student_flags": person,
            "work_flags":    broken,
            "flag_level":    speaking_flags.worst(all_flags),
        })

    # Ai cần chú ý lên đầu — đây là danh sách việc, không phải bảng xếp hạng.
    _LEVEL = {"high": 0, "medium": 1, None: 2}
    out.sort(key=lambda r: (_LEVEL.get(r["flag_level"], 2),
                            -(r["missing"] + r["late"]), r["name"].lower()))
    return {
        "items": out,
        "assignment_count": len(assignments),
        "kinds": sorted({(a.get("kind") or "daily") for a in assignments}),
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
    due_date = body.due_date
    if body.kind == "lesson":
        content_id, content_config = _resolve_speaking_lesson_set(cohort_id, body)
        due_date = _due_date_from_days(body.due_days)
    elif body.skill == "course":
        content_id, content_config = _resolve_course_bank(cohort_id, body)
    elif body.skill == "speaking":
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
            due_date=due_date,
            due_time=parse_due_time(body.due_time),
            instructions=body.instructions,
            kind=body.kind,
            student_ids=body.student_ids,
        )
    except EmptyRosterError as exc:
        # Raised BEFORE anything is inserted, so no orphan give is left behind.
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi giao bài: {exc}")

    return result


class BackfillBody(BaseModel):
    """Bỏ trống = mọi em đang trong lớp mà chưa có dòng."""
    student_ids: Optional[list[str]] = None


@router.post("/{cohort_id}/assignments/{assignment_id}/backfill")
async def backfill_assignment(
    cohort_id: str,
    assignment_id: str,
    body: BackfillBody,
    authorization: str | None = Header(default=None),
):
    """Thêm người nhận còn thiếu vào một bài ĐÃ GIAO.

    Em vào lớp sau ngày giao vốn không có dòng nào trong `class_assignment_items`
    nên bài ấy vô hình với em, còn bảng của giáo viên đếm em vào mẫu số mà không
    bao giờ thấy bài nộp. Chỉ THÊM, không bao giờ xoá — bài đã nộp là chuyện đã
    xảy ra. Gọi lại bao nhiêu lần cũng vô hại.
    """
    await require_admin(authorization)
    _require_cohort(cohort_id)
    # Bài giao phải THUỘC lớp trên đường dẫn: thiếu chốt này thì một admin của
    # lớp A bù được người nhận cho bài của lớp B chỉ bằng cách đoán id.
    owner = (
        supabase_admin.table("class_assignments").select("id, cohort_id")
        .eq("id", assignment_id).limit(1).execute().data
    ) or []
    if not owner or owner[0].get("cohort_id") != cohort_id:
        raise HTTPException(404, "Không tìm thấy bài giao này trong lớp.")
    try:
        return backfill_assignment_items(
            supabase_admin,
            assignment_id=assignment_id,
            student_ids=body.student_ids,
        )
    except AssignmentNotFoundError as exc:
        raise HTTPException(404, str(exc))
    except SubsetNeedsStudentsError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi bù người nhận: {exc}")


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
