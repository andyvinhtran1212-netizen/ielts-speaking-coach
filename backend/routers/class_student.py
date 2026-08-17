"""routers/class_student.py — bài tập của lớp, phía học viên (GĐ 2).

Giai đoạn 2 của docs/CLASS_MANAGEMENT_PLAN_2026-08-02.md.

  GET  /api/class/my-assignments            — bài của tôi, kèm trạng thái trễ hạn
  POST /api/class/assignments/{id}/start    — mở bài Speaking → tạo session

The student class PAGE is GĐ 3; these are the endpoints it will read, shipped
now so the loop admin-gives → student-submits → admin-sees closes in one phase.

Auth: standard Supabase JWT. The handlers run under supabase_admin
(service-role) because resolving auth.users → students → cohort spans tables a
JWT-scoped client cannot join under RLS — the same reason routers/student_home.py
gives. Every query carries an explicit student_id filter derived from the token,
never from the request body.

Lateness is computed here, not stored (migration 177): a flag written at submit
time disagrees with reality the moment an admin moves a deadline.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from urllib.parse import quote
from typing import Any, Dict, Optional

from fastapi import APIRouter, Header, HTTPException

from database import supabase_admin
from routers.auth import get_supabase_user
from services.quiz_service import bank_has_writing
from services.quiz_service import reconcile_course_items
from services.class_assignment_service import (
    _ID_CHUNK,
    is_accepting_submissions,
    is_assignment_open,
    reconcile_test_attempts,
)

logger = logging.getLogger(__name__)

# Caps HISTORY only. Outstanding work is never capped — see my_assignments().
_MAX_HISTORY = 200
_PAGE = 1000


def _paged_items(apply_filters) -> list:
    """Every matching item row, a page at a time (PostgREST caps un-ranged
    selects at ~1000). Ordered by id: an unordered range is not a stable window,
    and here a skipped row is homework the student is never shown."""
    rows: list = []
    start = 0
    while True:
        page = (
            apply_filters(supabase_admin.table("class_assignment_items").select("*"))
            .order("id").range(start, start + _PAGE - 1).execute().data
        ) or []
        rows.extend(page)
        if len(page) < _PAGE:
            return rows
        start += _PAGE

router = APIRouter(prefix="/api/class", tags=["class-student"])


def _existing_speaking_session(item_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    """Phiên Speaking đã dựng cho mục bài giao này, nếu có.

    Của CHÍNH em ấy (`user_id`) chứ không chỉ theo mục: mục là của một học viên,
    nhưng lọc thêm cho khớp với mọi đường đọc phiên khác — và một dòng lạc do
    dữ liệu cũ không được biến thành phiên của người khác.

    PHIÊN CÓ BÀI THẮNG PHIÊN MỚI. Hành vi cũ (mỗi lần bấm "Làm bài" dựng một
    phiên mới) đã để lại những phiên TRỐNG mới hơn phiên thật trên chính prod —
    chọn theo `started_at` thôi thì mở lại vẫn ra phiếu trắng, đúng cái lỗi hàm
    này sinh ra để chữa (codex #931). Thứ tự ưu tiên:

      1. đã hoàn thành  (`completed_at`) — bài đã chốt
      2. có câu trả lời đã lưu           — đang làm dở nhưng có thật
      3. mới nhất                        — chưa có gì, mở cái nào cũng như nhau

    Đọc hỏng → None: rơi về đường tạo phiên mới như trước, chứ không chặn em ấy
    làm bài vì một truy vấn chập.
    """
    try:
        rows = (
            supabase_admin.table("sessions").select(
                "id, started_at, completed_at, status, renderer_affinity"
            )
            .eq("class_assignment_item_id", item_id).eq("user_id", user_id)
            .order("started_at", desc=True).limit(20).execute().data
        ) or []
        if not rows:
            return None

        done = [r for r in rows
                if r.get("completed_at") or r.get("status") == "completed"]
        if done:
            winner = done[0]
            return {
                "id": winner["id"],
                "renderer_affinity": winner.get("renderer_affinity"),
            }

        # Phiên nào ĐANG GIỮ bài. Một lượt đọc cho tất cả, không hỏi từng phiên.
        ids = [r["id"] for r in rows]
        with_work = {
            x["session_id"] for x in
            ((supabase_admin.table("responses").select("session_id")
              .in_("session_id", ids).execute().data) or [])
        }
        for r in rows:                      # rows đã mới→cũ
            if r["id"] in with_work:
                return {
                    "id": r["id"],
                    "renderer_affinity": r.get("renderer_affinity"),
                }
        winner = rows[0]
        return {
            "id": winner["id"],
            "renderer_affinity": winner.get("renderer_affinity"),
        }
    except Exception as exc:  # noqa: BLE001
        logger.warning("[class] existing session lookup failed item=%s: %s", item_id, exc)
        return None


def _student_for_user(user_id: str) -> Optional[Dict[str, Any]]:
    rows = (
        supabase_admin.table("students")
        .select("id, full_name, student_code, cohort_id")
        .eq("user_id", user_id).limit(1).execute().data
    ) or []
    return rows[0] if rows else None


# Những trường của `content_config` được phép xuống trình duyệt học viên.
# Cố ý KHÔNG có `questions` (bản chụp đề) và `question_ids`: cái đầu chứa nguyên
# văn câu hỏi, cái sau đủ để tra ra chúng.
# `lesson_no` an toàn để hiện: nó là "Buổi 3", không phải nội dung đề.
_DISPLAY_CONFIG_FIELDS = ("topic", "mode", "part", "test_title", "lesson_no")


def _display_config(cfg: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Lọc `content_config` xuống mức an toàn để hiển thị.

    Danh sách CHO PHÉP chứ không phải danh sách loại trừ — xem ghi chú ở chỗ gọi.
    """
    src = cfg or {}
    return {k: src[k] for k in _DISPLAY_CONFIG_FIELDS if k in src}


def _decorate(item: Dict[str, Any], assignment: Dict[str, Any], now: datetime,
              writing_memo: Dict[str, bool | None] | None = None) -> Dict[str, Any]:
    """Attach the two derived states the UI needs. Both come from timestamps, so
    they stay correct without any job keeping them so."""
    due_raw = assignment.get("due_at")
    due = datetime.fromisoformat(due_raw) if due_raw else None
    submitted_at = item.get("submitted_at")

    is_late = bool(submitted_at and due and datetime.fromisoformat(submitted_at) > due)
    is_missing = bool(not submitted_at and due and due < now)

    return {
        "item_id":      item["id"],
        "state":        item["state"],
        "submitted_at": submitted_at,
        "score":        item.get("score"),
        # Cổng thuộc bài (chỉ bài course có): trang lớp hiện "85% · đã đạt"
        # thay vì "Band 85.0" — một con số không tồn tại trên thang IELTS.
        "passed_at":    item.get("passed_at"),
        # Bộ đề này CÓ phần tự luận không — trang không được SUY từ
        # `passed_at && !submitted_at`: một lượt ghi sổ hỏng (best-effort) ở bộ
        # đề KHÔNG có tự luận cũng cho ra đúng hình dạng ấy, và học viên đọc
        # thành "còn phần tự luận" cho một phần không tồn tại (codex cục bộ).
        "writing_expected": (
            bank_has_writing(assignment.get("content_id"), memo=writing_memo)
            if assignment.get("skill") == "course" else False),
        "is_late":      is_late,
        "is_missing":   is_missing,
        "assignment": {
            "id":             assignment["id"],
            "title":          assignment.get("title"),
            "skill":          assignment.get("skill"),
            "instructions":   assignment.get("instructions"),
            "due_at":         due_raw,
            # CHỈ những trường an toàn để HIỂN THỊ. `content_config` còn giữ
            # bản chụp đề (chữ câu hỏi, cue-card bullets) để lúc dựng phiên khỏi
            # phải đọc lại kho — nhưng trả nguyên cả khối xuống đây thì học viên
            # đọc được đề ngay trong phản hồi đầu tiên của trang lớp, và cả lớp
            # chắn chữ ở endpoint câu hỏi thành vô nghĩa.
            #
            # DANH SÁCH CHO PHÉP, không phải danh sách loại trừ: thêm một trường
            # mới vào bản chụp sau này sẽ tự động KHÔNG lọt, thay vì lọt cho tới
            # khi có người nhớ ra phải chặn nó.
            "content_config": _display_config(assignment.get("content_config")),
        },
    }


def _visible_assignments(student: Dict[str, Any], now: datetime) -> tuple[list, bool]:
    """This student's assignments — outstanding in full, history capped.

    Shared by /my-assignments and /me so the two can never disagree about what
    the student owes.

    OUTSTANDING WORK IS NEVER CAPPED. Two earlier shapes both dropped work still
    owed: capping item rows hid an older unsubmitted task behind 200 newer ones,
    and capping assignments did too because 200 newer *completed* gives sort
    ahead of one old unsubmitted one. A student must never be shown "nothing to
    do" while an unanswered task exists.
    """
    outstanding = _paged_items(
        lambda q: q.eq("student_id", student["id"]).is_("submitted_at", "null")
    )
    history = (
        supabase_admin.table("class_assignment_items")
        .select("*")
        .eq("student_id", student["id"])
        .not_.is_("submitted_at", "null")
        .order("submitted_at", desc=True)
        .limit(_MAX_HISTORY)
        .execute().data
    ) or []

    items = outstanding + history
    if not items:
        return [], False

    a_ids = list({i["assignment_id"] for i in items})
    by_id: Dict[str, Dict[str, Any]] = {}
    for chunk in (a_ids[i:i + _ID_CHUNK] for i in range(0, len(a_ids), _ID_CHUNK)):
        for a in ((supabase_admin.table("class_assignments")
                   .select("*")
                   .in_("id", chunk)
                   .eq("cohort_id", student["cohort_id"])   # CURRENT class only
                   .execute().data) or []):
            # Items are created eagerly at give time, so `publish_at` is the only
            # thing keeping a give scheduled for next week off the list;
            # `status` keeps draft and archived ones off it.
            #
            # The cohort filter matters because moving a student between classes
            # only rewrites students.cohort_id — their old class's item rows
            # stay. Without it, class A's homework vanishes while the student has
            # no class and REAPPEARS when they join class B.
            if is_assignment_open(a, now=now):
                by_id[a["id"]] = a

    # Record any Reading/Listening hand-in before deciding what this student
    # still owes: their test submission does not touch the class ledger, so
    # without this they would see work they have already done sitting under
    # "Cần nộp".
    #
    # Showing the list anyway when the repair fails is right — a broken repair
    # must not blank the page. Showing it WITHOUT SAYING SO is not: the one
    # thing that can go wrong here is a finished task still listed as owed, and
    # a student who trusts that list retakes work they have already handed in.
    #
    # Một khối riêng cho mỗi bộ đối chiếu: chúng đọc hai nguồn bằng chứng rời
    # nhau, nên gộp chung nghĩa là bộ này hỏng thì bộ kia không được thử.
    stale = False
    for what, fn in (
        ("test-attempts", lambda: reconcile_test_attempts(
            supabase_admin, list(by_id.values()))),
        # Bài tập theo buổi cũng vậy, và còn nặng hơn: `end_session` ghi sổ
        # best-effort nên một lượt hỏng ở chặng CUỐI để bài nằm mãi ở "Cần nộp"
        # cho tới khi giáo viên tình cờ mở bảng. Em ấy thì thấy bài mình vừa
        # làm xong vẫn đang nợ.
        ("course", lambda: reconcile_course_items(supabase_admin, list(by_id))),
    ):
        try:
            fn()
        except Exception as exc:
            stale = True
            logger.warning("[class] reconcile skipped (%s): %s", what, exc)
    # Đọc lại SAU cả hai bộ, và ngoài khối bắt lỗi của chúng: một bộ hỏng vẫn
    # phải lấy được kết quả của bộ kia.
    try:
        items = _reread_items(student["id"], [i["id"] for i in items]) or items
    except Exception as exc:
        stale = True
        logger.warning("[class] reread items failed: %s", exc)

    # MỘT chỗ nhớ cho cả lượt gọi: trang lớp hỏi cùng một bank cho nhiều mục,
    # và một lượt đọc là đủ cho cả trang.
    writing_memo: Dict[str, bool | None] = {}
    out = [_decorate(i, by_id[i["assignment_id"]], now, writing_memo)
           for i in items if i["assignment_id"] in by_id]
    # ``None`` khác hẳn ``False``: truy vấn hình dạng bộ đề hỏng, chứ không phải
    # đã chứng minh bộ đề không có phần viết. Giữ danh sách dùng được nhưng bật
    # cùng cờ stale mà hai đường vá sổ dùng, để học viên không coi nhãn tạm thời
    # "Cần hoàn thành" là trạng thái chính thức.
    if any(row.get("writing_expected") is None for row in out):
        stale = True
    # Nearest deadline FIRST — this is a to-do list, so what is due today has to
    # be at the top. A give with no deadline is never urgent, so it sorts last
    # via its own key rather than by abusing the empty string.
    out.sort(key=lambda r: (r["assignment"]["due_at"] is None,
                            r["assignment"]["due_at"] or ""))
    return out, stale


@router.get("/my-assignments")
async def my_assignments(authorization: str | None = Header(default=None)):
    """Bài tập của học viên đang đăng nhập.

    A user with no linked student row, or a student in no class, gets an empty
    list and `has_class: false` — not a 404. Not being in a class is an ordinary
    state, and the home page needs to tell the two apart to decide whether to
    show the class card at all.
    """
    auth_user = await get_supabase_user(authorization)
    student = _student_for_user(auth_user["id"])

    if not student or not student.get("cohort_id"):
        return {"has_class": False, "assignments": []}

    now = datetime.now(timezone.utc)
    try:
        rows, stale = _visible_assignments(student, now)
        out: Dict[str, Any] = {"has_class": True, "assignments": rows}
        if stale:
            out["homework_stale"] = True
        return out
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải bài tập: {exc}")


@router.post("/assignments/{item_id}/start")
async def start_assignment(
    item_id: str,
    authorization: str | None = Header(default=None),
):
    """Mở một bài Speaking được giao — trả về tham số để tạo session.

    Deliberately does NOT create the session itself. POST /sessions owns quota,
    daily caps and permission checks; duplicating any of that here would mean two
    places to keep in step, and the one here would be the one nobody remembers to
    update. The client posts to /sessions with these values plus
    `class_assignment_item_id`, and the completion hook closes the loop.

    Marks the item `opened` on first use — a stored fact (it happened), unlike
    late/missed which are derived.
    """
    auth_user = await get_supabase_user(authorization)
    student = _student_for_user(auth_user["id"])
    if not student:
        raise HTTPException(404, "Không tìm thấy hồ sơ học viên")

    rows = (
        supabase_admin.table("class_assignment_items").select("*")
        .eq("id", item_id).eq("student_id", student["id"])   # ownership in the query
        .limit(1).execute().data
    ) or []
    if not rows:
        raise HTTPException(404, "Không tìm thấy bài tập của bạn")
    item = rows[0]

    a_rows = (
        supabase_admin.table("class_assignments").select("*")
        .eq("id", item["assignment_id"]).limit(1).execute().data
    ) or []
    if not a_rows or not is_assignment_open(a_rows[0]):
        raise HTTPException(404, "Bài tập không còn mở")
    assignment = a_rows[0]

    # ── Thứ tự ba cổng dưới đây LÀ MỘT QUYẾT ĐỊNH, không phải ngẫu nhiên ──
    #
    #   1. ĐÚNG LỚP HIỆN TẠI  — chặn TẤT CẢ, kể cả xem lại.
    #   2. mở lại phiên cũ     — được phép cả khi đã quá hạn.
    #   3. quá hạn             — chỉ chặn việc DỰNG PHIÊN MỚI.
    #
    # Cohort phải đứng ĐẦU: mục bài tập cố ý sống sót khi học viên chuyển lớp,
    # nên đặt nó sau bước 2 thì một em đã chuyển đi vẫn mở (và nộp tiếp) bài
    # của lớp cũ — đúng thứ `/my-assignments` cố tình giấu đi (codex #931).
    if assignment.get("cohort_id") != student.get("cohort_id"):
        raise HTTPException(404, "Bài tập không thuộc lớp hiện tại của bạn")

    # Bài Speaking ĐÃ CÓ phiên thì mở lại CHÍNH phiên ấy — kể cả khi đã quá hạn.
    #
    # Trước đây mỗi lần bấm "Làm bài" là dựng một phiên MỚI, nên bài vừa nói
    # nằm lại phiên cũ và học viên mở ra thấy trắng trơn; và quá hạn thì 409
    # chặn luôn cả việc XEM. Hai thứ ấy khác nhau: hết hạn là không nhận bài
    # MỚI, không phải xoá quyền đọc bài mình đã làm. Cấm nộp vẫn nguyên vẹn —
    # nó nằm ở `_record_class_hand_in` (mốc so là giờ phiên hoàn thành) và ở
    # phiếu làm bài (đọc `class_task.accepting` từ chính hàm này).
    existing = _existing_speaking_session(item_id, auth_user["id"]) \
        if assignment.get("skill") == "speaking" else None
    if existing:
        return {
            "item_id":       item_id,
            "assignment_id": assignment["id"],
            "skill":         "speaking",
            "session_id":    existing["id"],
            "renderer_affinity": existing["renderer_affinity"],
            "accepting":     bool(is_accepting_submissions(assignment)),
        }

    # 409, not 404: the task exists and is theirs — it simply lapsed. Saying "not
    # found" would read as a bug to a student looking straight at it on the list.
    if not is_accepting_submissions(assignment):
        raise HTTPException(409, "Đã quá hạn nộp — bài tập này không còn nhận bài.")

    skill = assignment.get("skill")
    if skill not in ("speaking", "reading", "listening", "course"):
        raise HTTPException(400, "Bài tập này chưa hỗ trợ mở trực tiếp.")

    if item.get("state") == "assigned":
        try:
            supabase_admin.table("class_assignment_items").update({
                "state": "opened",
                "opened_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", item_id).eq("state", "assigned").execute()
        except Exception as exc:
            # Cosmetic: never block the student from starting their work.
            logger.warning("[class] could not mark item opened item=%s: %s", item_id, exc)

    cfg = assignment.get("content_config") or {}

    if skill == "course":
        # Bài tập theo buổi mở thẳng bằng id bank — không có phiên nào phải dựng
        # trước. Chính bài giao này là thứ cho phép `get_bank_for_play` mở bank
        # ấy ra (bank giáo trình không xuất bản và không nằm trong danh sách tự
        # chọn), nên trả id ở đây là đủ và không lộ thêm gì.
        return {
            "item_id":       item_id,
            "assignment_id": assignment["id"],
            "skill":         skill,
            "bank_id":       assignment.get("content_id"),
        }

    if skill == "speaking":
        # The client posts these to /sessions — which owns quota, the daily cap
        # and permissions — then lands on the practice page by session_id.
        return {
            "item_id":       item_id,
            "assignment_id": assignment["id"],
            "skill":         skill,
            "session_params": {
                "mode":  cfg.get("mode") or "practice",
                "part":  cfg.get("part") or 1,
                "topic": cfg.get("topic") or "",
                "class_assignment_item_id": item_id,
            },
        }

    # Reading/Listening open their existing test pages directly. No attempt is
    # created here — those pages own their own attempt lifecycle, and a parallel
    # "start" path would mean two places deciding when an attempt begins.
    #
    # `class_item` is what ties the two together. The page passes it back when
    # it creates the attempt, so the attempt row records WHICH homework it was
    # done for. Without it the ledger would have to infer ownership from the
    # paper and the clock, which cannot be made right: the same paper can be
    # given twice, given and reopened, or practised freely on the side.
    test_uuid = assignment.get("content_id")
    if not test_uuid:
        raise HTTPException(400, "Bài tập này chưa gắn đề.")

    # The paper was checked when the task was given, but that was days ago: it
    # can since have been unpublished, reserved for a mock sitting, or had its
    # audio cleared. Sending the student to a page that answers 404/422 while
    # the ledger keeps counting the task as owed is the worst of both — say so
    # here instead.
    if skill == "listening":
        rows = (
            supabase_admin.table("listening_tests")
            .select("id, status, exam_only, full_audio_storage_path, "
                    "assembled_audio_storage_path")
            .eq("id", test_uuid).limit(1).execute().data
        ) or []
        if not rows or (rows[0].get("status") or "") != "published":
            raise HTTPException(409, "Đề nghe của bài tập này hiện không mở được.")
        if rows[0].get("exam_only"):
            raise HTTPException(409, "Đề nghe của bài tập này hiện không mở được.")
        if not (rows[0].get("assembled_audio_storage_path")
                or rows[0].get("full_audio_storage_path")):
            raise HTTPException(409, "Đề nghe này chưa có audio sẵn sàng.")
        # listening-test.html?id= is the row id, the same value the attempt row
        # carries — one identifier throughout.
        url = (f"/pages/listening-test.html?id={quote(test_uuid)}"
               f"&class_item={quote(item_id)}")
    else:
        # Reading needs BOTH ids and they are different columns. The reader page
        # resolves ?test_id= against reading_tests.test_id (the public code,
        # mig 086), while reading_test_attempts.test_id stores the row UUID. The
        # ledger keeps the UUID because that is what the hand-in is matched on;
        # the link has to carry the code or the paper opens to a 404.
        row = (
            supabase_admin.table("reading_tests").select("test_id, status, exam_only")
            .eq("id", test_uuid).limit(1).execute().data
        ) or []
        code = (row[0].get("test_id") if row else None)
        if not code:
            raise HTTPException(404, "Không tìm thấy đề đọc của bài tập này.")
        if (row[0].get("status") or "") != "published" or row[0].get("exam_only"):
            raise HTTPException(409, "Đề đọc của bài tập này hiện không mở được.")
        url = (f"/pages/reading-exam.html?test_id={quote(code)}"
               f"&class_item={quote(item_id)}")
    return {
        "item_id":       item_id,
        "assignment_id": assignment["id"],
        "skill":         skill,
        "open_url":      url,
    }


@router.get("/me")
async def my_class(
    summary: bool = False,
    authorization: str | None = Header(default=None),
):
    """Trang lớp của học viên — lớp, buổi học, bài tập, tiến độ, trong một lượt gọi.

    `summary=true` trả bản GỌN cho thẻ ở trang chủ: chỉ tên lớp, khoá, và các con
    số tiến độ. Thẻ đó chỉ đọc bấy nhiêu, nhưng bản đầy đủ kéo về MỌI buổi học đã
    đăng — kể cả `body_md` không giới hạn độ dài và danh sách tài liệu — nên mỗi
    lần mở trang chủ lại nặng thêm theo lượng nội dung giảng viên soạn. Bản gọn
    bỏ hẳn phần buổi học và không trả mảng bài tập, chỉ trả phần đếm.

    Shaped for the page rather than the tables: one round-trip, because the class
    page shows all four together and three sequential fetches would make it
    flash through three half-states.

    `has_class: false` is an ordinary answer, not a 404 — most learners are on a
    mass code and belong to no class. The page shows a plain explanation and the
    home card hides itself.

    Each block is built independently and a failure downgrades only that block
    (`degraded: [...]`), mirroring services/student_home_aggregator: a class page
    that 500s because the lessons query hiccuped would hide the homework too,
    which is the part the student actually needs.
    """
    auth_user = await get_supabase_user(authorization)
    student = _student_for_user(auth_user["id"])

    if not student or not student.get("cohort_id"):
        return {"has_class": False}

    now = datetime.now(timezone.utc)
    degraded: list[str] = []

    cohort: Dict[str, Any] = {}
    try:
        rows = (
            supabase_admin.table("cohorts")
            .select("id, name, description, course_id")
            .eq("id", student["cohort_id"]).limit(1).execute().data
        ) or []
        cohort = rows[0] if rows else {}
        if cohort.get("course_id"):
            crows = (
                supabase_admin.table("courses").select("code, name")
                .eq("id", cohort["course_id"]).limit(1).execute().data
            ) or []
            cohort["course"] = crows[0] if crows else None
    except Exception as exc:
        logger.warning("[class] cohort read failed: %s", exc)
        degraded.append("class")

    lessons: list = []
    # Skipped entirely for the home strip: this is the unbounded part of the
    # payload and the strip never reads it.
    if not summary:
      try:
        lessons = _paged_items_of(
            "class_lessons",
            lambda q: q.eq("cohort_id", student["cohort_id"]).eq("is_published", True),
        )
        # Same ordering the admin list uses (lesson_no NULLS LAST, then date), so
        # a student and their teacher are always looking at the same sequence.
        lessons.sort(key=lambda r: (
            r.get("lesson_no") is None, r.get("lesson_no") or 0,
            r.get("lesson_date") or "", r.get("created_at") or "",
        ))
      except Exception as exc:
        logger.warning("[class] lessons read failed: %s", exc)
        degraded.append("lessons")

    assignments: list = []
    try:
        assignments, homework_stale = _visible_assignments(student, now)
        if homework_stale:
            # Same word the admin Progress tab uses for the same condition:
            # the rows are real, they may just be missing the newest hand-in.
            degraded.append("homework_stale")
    except Exception as exc:
        logger.warning("[class] assignments read failed: %s", exc)
        degraded.append("assignments")

    # Counts come from the same list the page renders, so the summary can never
    # disagree with the rows underneath it.
    progress = _progress_summary(assignments) if "assignments" not in degraded else None

    result: Dict[str, Any] = {
        "has_class": True,
        "class":     cohort,
        "progress":  progress,
    }
    if not summary:
        result["student"] = {"full_name": student.get("full_name"),
                             "student_code": student.get("student_code")}
        result["lessons"] = lessons
        result["assignments"] = assignments
    if degraded:
        result["degraded"] = degraded
    return result


def _progress_summary(assignments: list) -> Dict[str, Any]:
    """Counts for the header strip.

    `missing` is work whose deadline has passed with nothing submitted — the
    number worth acting on. Everything not yet due is `todo`, deliberately kept
    apart: a learner who sees "5 quá hạn" when nothing is actually late stops
    believing the number.
    """
    total = len(assignments)
    submitted = sum(1 for a in assignments if a["submitted_at"])
    late = sum(1 for a in assignments if a["is_late"])
    missing = sum(1 for a in assignments if a["is_missing"])
    return {
        "total":     total,
        "submitted": submitted,
        "todo":      total - submitted - missing,
        "missing":   missing,
        "late":      late,
        # Punctuality over recorded hand-ins only: dividing by `total` would
        # drag the figure down for work that is not due yet.
        "on_time_pct": (round((submitted - late) / submitted * 100) if submitted else None),
    }


def _paged_items_of(table: str, apply_filters) -> list:
    """Every matching row of `table`, paged (PostgREST caps un-ranged reads)."""
    rows: list = []
    start = 0
    while True:
        page = (
            apply_filters(supabase_admin.table(table).select("*"))
            .order("id").range(start, start + _PAGE - 1).execute().data
        ) or []
        rows.extend(page)
        if len(page) < _PAGE:
            return rows
        start += _PAGE


def _reread_items(student_id: str, item_ids: list) -> list:
    """Re-read the student's items after a reconciliation wrote to them.

    Without this the page renders the rows fetched BEFORE the repair, so a
    hand-in just recorded still shows as outstanding until the next load —
    which is the very thing the repair exists to prevent.
    """
    if not item_ids:
        return []
    out: list = []
    for chunk in (item_ids[i:i + _ID_CHUNK] for i in range(0, len(item_ids), _ID_CHUNK)):
        out.extend((
            supabase_admin.table("class_assignment_items").select("*")
            .eq("student_id", student_id).in_("id", chunk).execute().data
        ) or [])
    return out
