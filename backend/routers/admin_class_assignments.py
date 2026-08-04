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
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field, model_validator

from database import supabase_admin
from services import speaking_question_audio as sqa
from services import tts_audio
from routers.admin import require_admin
from services.class_assignment_service import (
    EmptyRosterError,
    create_class_assignment,
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
    # Speaking: giáo viên tự chọn câu. Bỏ trống = web bốc ngẫu nhiên.
    #
    # Hai lựa chọn, không phải ba: "lấy N câu đầu" (hành vi cũ) không phải một
    # lựa chọn ai muốn — nó chỉ là thứ xảy ra khi không ai quyết.
    question_ids: Optional[list[str]] = None
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
    try:
        reconcile_ledger_from_sessions(supabase_admin, [assignment_id])
        reconcile_test_attempts(supabase_admin, [assignment])
    except Exception as exc:
        stale = True
        logger.warning("[class] tally reconcile failed asg=%s: %s", assignment_id, exc)

    items = _paged(
        supabase_admin, "class_assignment_items",
        "id, student_id, submitted_at, score, state",
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

    out = []
    for it in items:
        s = students.get(it["student_id"]) or {}
        submitted_at = _at(it.get("submitted_at"))
        if not s.get("user_id"):
            # Chưa kích hoạt tài khoản: em ấy CHƯA TỪNG thấy bài. Khác hẳn "lười"
            # — lẫn hai thứ này là nhắc nhầm người.
            status_ = "no-account"
        elif submitted_at:
            status_ = "late" if (due and submitted_at > due) else "submitted"
        else:
            status_ = "missing" if sealed else "pending"
        out.append({
            "student_id":   it["student_id"],
            "name":         s.get("full_name") or "",
            "student_code": s.get("student_code"),
            "status":       status_,
            "submitted_at": it.get("submitted_at"),
            "score":        it.get("score"),
        })
    # Chưa nộp lên đầu: đó là danh sách việc cần làm của giáo viên.
    _ORDER = {"missing": 0, "pending": 1, "no-account": 2, "late": 3, "submitted": 4}
    out.sort(key=lambda r: (_ORDER.get(r["status"], 9), r["name"].lower()))

    result = {
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
        },
    }
    if stale:
        result["homework_stale"] = True
    return result


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
