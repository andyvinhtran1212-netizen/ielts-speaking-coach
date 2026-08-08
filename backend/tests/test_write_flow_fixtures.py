"""Dữ liệu giả của cổng đường-ghi phải qua được BỘ KIỂM THẬT của backend.

VÌ SAO CÓ TỆP NÀY — và vì sao nó nằm ở backend chứ không ở frontend:

Cổng đường-ghi chặn mạng và trả dữ liệu sẵn, nên bản khai vẫn XANH kể cả khi dữ
liệu giả mô tả một trạng thái production không thể tồn tại. Trong PR #962 điều
đó xảy ra BA lần liên tiếp, mỗi lần do người review bắt, mỗi lần tôi chỉ vá đúng
chỗ được nêu:

  1. `prompt` thay cho `stem`, và 3 lựa chọn thay vì 4 (`listening.py:163-171`)
  2. `content_id = 'ct-1'`, trong khi backend đòi UUID (`feedback.py:119-125`)
  3. thiếu `answer_idx`, trường mà `_validate_mcq_payload` bắt buộc

Ba lần cùng MỘT LOẠI sai là tín hiệu hỏng thiết kế, không phải ba việc phải vá.
Gốc rễ: dữ liệu giả nằm trong tệp JS, còn định nghĩa "hợp lệ" nằm trong Python —
không gì nối hai đầu, nên chúng trôi khỏi nhau âm thầm.

Chốt này nối lại bằng cách gọi CHÍNH bộ kiểm production, không viết lại nó. Viết
lại là tạo ra bản sao thứ hai để trôi tiếp.
"""
import json
import re
import uuid
from pathlib import Path

import pytest

from routers.listening import (
    TestAttemptAnswerPatchRequest,
    _validate_gist_payload,
    _validate_mcq_payload,
    _validate_true_false_payload,
)

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "frontend/tooling/write-flows/fixtures"


# QUÉT THƯ MỤC, không liệt kê tay. Trang này là THÍ ĐIỂM cho 27 trang có-ghi còn
# lại (`listening-tf`, `listening-gist` dùng lại y khuôn), nên một danh sách viết
# cứng nghĩa là fixture thứ hai ra đời mà không ai kiểm — đúng cái lỗ chốt này
# sinh ra để bịt. (bot bắt ở #962 vòng 5)
ALL = sorted(p.stem for p in FIXTURES.glob("*.json"))


def _load(name: str) -> dict:
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


def test_thu_muc_fixture_ton_tai():
    """Đường dẫn hỏng ⇒ mọi khẳng định dưới thành xanh-rỗng."""
    assert ALL, f"không thấy fixture nào ở {FIXTURES}"


# Mỗi loại fixture nối tới ĐÚNG bộ kiểm production của nó. Quét thư mục rồi chạy
# tất cả qua bộ kiểm MCQ sẽ sai ngay khi có fixture của trang khác; còn "loại lạ
# thì bỏ qua" thì fixture mới lặng lẽ không được kiểm — đúng lỗ đang vá.
def _reading_question_types_from_migration() -> set[str]:
    """Danh sách loại câu hỏi Đọc, ĐỌC TỪ ràng buộc CHECK thật của bảng.

    Không chép danh sách vào đây: bản sao thứ hai rồi sẽ trôi khỏi bản gốc, mà
    trôi im lặng thì chốt này thành trang trí.

    BỎ CHÚ THÍCH TRƯỚC KHI ĐỌC, và khoanh vào đúng khối `CREATE TABLE
    reading_questions`. Bản đầu quét thẳng SQL thô, nên một ràng buộc đã bị chú
    thích ra vẫn khớp, và một loại chỉ nằm trong chú thích vẫn được nhận — chốt
    FAIL-OPEN mà `len >= 10` không phát hiện được (codex cục bộ #969).
    """
    sql = (ROOT / "backend/migrations/086_reading_module_foundation.sql").read_text(
        encoding="utf-8")
    sql = re.sub(r"--[^\n]*", "", sql)          # chú thích dòng
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.S)  # chú thích khối

    block = re.search(r"CREATE TABLE[^;]*?reading_questions\b(.*?);", sql, re.S)
    assert block, "không thấy khối CREATE TABLE reading_questions — migration đã đổi?"

    m = re.search(r"question_type\s+TEXT NOT NULL CHECK \(question_type IN \((.*?)\)\)",
                  block.group(1), re.S)
    assert m, "không đọc được ràng buộc CHECK question_type — migration đã đổi?"
    types = set(re.findall(r"'([a-z_]+)'", m.group(1)))
    assert len(types) >= 10, f"chỉ đọc được {len(types)} loại — biểu thức hỏng?"
    return types


def _check_reading_review(fx: dict) -> None:
    """Fixture trang chữa bài phải là thứ MÁY CHỦ THẬT dựng ra được.

    Ba ràng buộc, đều gọi CHÍNH hàm production:
      · `validate_solution_structure` — lời giải đúng hình dạng tác giả (hành
        động phải nằm trong danh sách đóng: bản đầu tôi viết `scan`, không tồn
        tại);
      · `build_stepper(solution)` phải BẰNG ĐÚNG `stepper` trong fixture — vì
        `stepper` là thứ máy chủ DỰNG RA từ `solution` (`reading_student.py:1364`),
        không phải trường độc lập. Bịa một `stepper` rời là mô tả một response
        không bao giờ trả về;
      · `resolve_ref` phải giải được KP — bản đầu tôi dùng slug `thi-hien-tai-don`
        không có bài nào, nên production sẽ BỎ QUA lặng lẽ (`recorded: 0`) và bản
        khai vẫn xanh dù chẳng ghi được gì.
    (codex cục bộ #985)
    """
    from services.kp_registry import resolve_ref
    from services.reading_solution import build_stepper, validate_solution_structure

    errs = validate_solution_structure(fx["solution"], "fixture")
    assert errs == [], f"lời giải sai hình dạng tác giả: {errs}"

    kp = fx["kp"]
    reason = resolve_ref(kp["type"], kp["slug"], kp.get("anchor", ""))
    assert reason is None, f"KP không giải được ⇒ production bỏ qua lặng lẽ: {reason}"

    built = build_stepper(fx["solution"])
    assert built == fx["stepper"], (
        "`stepper` trong fixture KHÁC thứ `build_stepper()` dựng ra — tức nó mô "
        "tả một response máy chủ không bao giờ trả về."
    )
    assert built["steps"][0].get("microcheck"), "mất micro-check thì luồng không có gì để bấm"


def _check_reading_exam(fx: dict) -> None:
    """Fixture Đọc mô tả thứ MÁY CHỦ TRẢ VỀ TRÌNH DUYỆT, không phải hình dạng
    tác giả — nên KHÔNG dùng `validate_reading_questions` (bộ đó đòi `answer`,
    thứ tuyệt đối không được có trong response học viên; xem #967).

    Ràng buộc đúng tầng: `question_type` phải nằm trong CHECK của bảng, và câu
    hỏi KHÔNG được mang đáp án.
    """
    # Trường BẮT BUỘC, lấy theo thứ trang THẬT SỰ ĐỌC — không phải theo trí nhớ.
    # Bản đầu fixture ghi `body` trong khi cột và trang đều dùng `body_markdown`
    # (`migrations/086:105`, `reading-exam.js:499`), nên đoạn đọc render RỖNG mà
    # luồng vẫn xanh: nó chỉ cần ô nhập. Chốt này khi đó chỉ kiểm loại câu hỏi
    # nên không thấy gì (codex cục bộ #969).
    for p in fx["test"]["passages"]:
        for key in ("passage_order", "title", "body_markdown"):
            assert p.get(key), f"đoạn đọc thiếu «{key}» — trang sẽ render rỗng"

    allowed = _reading_question_types_from_migration()
    questions = fx["test"]["questions"]
    assert questions, "fixture không có câu hỏi nào"
    for q in questions:
        for key in ("q_num", "prompt", "question_type"):
            assert q.get(key), f"câu hỏi thiếu «{key}» (`reading-exam.js:1109-1197`)"
    for q in questions:
        assert q["question_type"] in allowed, (
            f"question_type={q['question_type']!r} không có trong CHECK của bảng")
        assert "answer" not in q and "answers" not in q, (
            f"fixture mang đáp án — response học viên không bao giờ có (câu {q['q_num']})")


def _check_listening_test(fx):
    """Bài nghe ĐẦY ĐỦ làm theo bài giao.

    Nối tới CHÍNH model production nhận thân request lưu đáp án
    (`TestAttemptAnswerPatchRequest`) và CHÍNH chốt khoảng của route
    (`routers/listening.py:5194` — `1 <= q_num <= 40`). Không viết lại bộ kiểm:
    một bản sao thứ hai rồi cũng trôi khỏi bản gốc.
    """
    from pydantic import ValidationError

    answers = fx["answers"]
    assert answers, "fixture không có đáp án nào — luồng sẽ xanh mà chưa ghi gì"
    for a in answers:
        # `extra="forbid"`: thừa một trường là 422, tức bản khai đang mô tả một
        # request backend luôn từ chối.
        try:
            m = TestAttemptAnswerPatchRequest(**a)
        except ValidationError as e:
            raise AssertionError(f"đáp án {a!r} không qua được model thật: {e}") from e
        assert 1 <= m.q_num <= 40, (
            f"q_num={m.q_num} ngoài khoảng route chấp nhận (routers/listening.py:5194)")

    # Câu hỏi trong đề phải PHỦ đúng các q_num mà luồng sẽ gõ; thiếu thì bước
    # `fill` không tìm thấy ô nhập và luồng đỏ vì lý do sai.
    q_nums = {
        q["q_num"]
        for sec in fx["test"]["sections"]
        for ex in sec["exercises"]
        for q in ex["payload"]["questions"]
    }
    for a in answers:
        assert a["q_num"] in q_nums, (
            f"đáp án cho câu {a['q_num']} nhưng đề không có câu đó")


def _check_instructor_deliver(fx):
    """Trang chấm bài của giảng viên: lưu nhận xét rồi trả bài.

    Nối tới CHÍNH model production nhận thân request (`InstructorNoteBody`) và
    chốt vai trò của trang (`instructor-grade.js:45` phản chiếu
    `require_instructor`). Không viết lại bộ kiểm.
    """
    from pydantic import ValidationError

    from routers.instructor import InstructorNoteBody

    try:
        m = InstructorNoteBody(instructor_note=fx["instructor_note"])
    except ValidationError as e:
        raise AssertionError(f"nhận xét không qua được model thật: {e}") from e
    assert m.instructor_note.strip(), (
        "fixture dùng nhận xét RỖNG — luồng sẽ xanh mà không chứng minh được chữ "
        "trong ô có tới nơi hay không"
    )

    # Vai trò: trang đá về /home nếu không phải instructor/admin, khi đó KHÔNG có
    # đường ghi nào để kiểm và luồng xanh vì lý do sai.
    assert fx["me"]["role"] in ("instructor", "admin"), (
        f"role={fx['me']['role']!r} sẽ bị trang chuyển hướng đi (instructor-grade.js:45)"
    )

    # MƯỢN DANH chỉ CÓ THẬT khi người gọi là ADMIN và mục tiêu là người KHÁC.
    # `_me()` (routers/instructor.py:101-113) BỎ QUA `?as_instructor` với người
    # gọi không phải admin — nên fixture để `/auth/me` trùng luôn id mượn danh
    # đang mô tả đúng cái ca mà tham số ấy VÔ TÁC DỤNG, trong khi bản khai tuyên
    # bố nó bảo vệ việc quy trách nhiệm. Xanh vì lý do sai (bot bắt ở #1011).
    assert fx["me"]["role"] == "admin", (
        "luồng khai `as_instructor` nên người gọi phải là ADMIN; "
        f"role={fx['me']['role']!r} thì backend bỏ qua tham số đó"
    )
    assert fx["me"]["id"] != fx["as_instructor"], (
        "người gọi trùng mục tiêu mượn danh — không mô hình hoá được đường quy trách nhiệm"
    )

    # `delivered_at` phải là None: bài ĐÃ trả thì nút Trả bài không phải đường
    # đang kiểm, và fixture đang mô tả một màn hình khác.
    assert fx["essay"].get("delivered_at") is None, "fixture mô tả bài ĐÃ trả rồi"

    # PHẢN HỒI ĐỌC cũng phải đúng hợp đồng. Bộ kiểm bản đầu chỉ soi thân request
    # GHI, nên một `feedback` sai hình dạng vẫn qua — và trang khi đó đi nhánh
    # "chưa có phân tích AI", tức luồng chạy trên MỘT MÀN HÌNH KHÁC với màn hình
    # nó tuyên bố kiểm.
    #
    # `essay_service.get_essay_with_feedback()` gắn NGUYÊN một dòng
    # `writing_feedback_current` vào khoá `feedback`; `renderEssay()`
    # (instructor-grade.js:77-98) đọc `overall_band_score` và `feedback_json`.
    fb = fx["essay"].get("feedback")
    assert isinstance(fb, dict), "`feedback` phải là một dòng writing_feedback_current"
    for k in ("overall_band_score", "feedback_json", "version"):
        assert k in fb, f"`feedback` thiếu «{k}» — renderEssay sẽ đi nhánh rỗng"
    assert isinstance(fb["feedback_json"], dict) and fb["feedback_json"], (
        "`feedback_json` rỗng ⇒ trang hiện 'Chưa có phân tích AI.'"
    )
    st = fx["essay"].get("student")
    assert isinstance(st, dict) and st.get("full_name"), (
        "thiếu `student` — renderEssay:74-75 đọc nó để hiện tên học viên"
    )


VALIDATORS = {
    "listening-mcq": lambda fx: _validate_mcq_payload(fx["payload"]),
    "listening-tf": lambda fx: _validate_true_false_payload(fx["payload"]),
    "listening-gist": lambda fx: _validate_gist_payload(fx["payload"]),
    "reading-exam": _check_reading_exam,
    "reading-review": _check_reading_review,
    "listening-test": _check_listening_test,
    "instructor-deliver": _check_instructor_deliver,
}


@pytest.mark.parametrize("name", ALL)
def test_payload_qua_duoc_bo_kiem_that(name):
    fx = _load(name)
    kind = fx.get("kind")
    assert kind in VALIDATORS, (
        f"fixture «{name}» khai kind={kind!r} — chưa nối tới bộ kiểm nào. Thêm nó vào "
        f"VALIDATORS; ĐỎ ở đây là cố ý, vì bỏ qua nghĩa là fixture mới không được kiểm."
    )
    # Không bắt HTTPException: bộ kiểm ném ra là chốt này ĐỎ, kèm nguyên văn lý
    # do của production — đúng thứ cần đọc.
    VALIDATORS[kind](fx)


# Khoá nào phải là UUID — theo ĐÚNG kiểu cột, không theo cảm giác "id thì là UUID".
#   listening_content.id / listening_exercises.id  → UUID  (mig 056)
#   reading_test_attempts.id                        → UUID  (mig 086)
#   reading_tests.test_id                           → TEXT  (mig 086:50) — mã dạng
#     `ILR-LIS-001`, KHÔNG phải UUID. Ghim nó thành UUID là bắt fixture mô tả một
#     giá trị production không bao giờ có.
UUID_KEYS = {
    "listening-mcq": ("content_id", "exercise_id"),
    "listening-tf": ("content_id", "exercise_id"),
    "listening-gist": ("content_id", "exercise_id"),
    "reading-exam": ("attempt_id",),
    "reading-review": ("attempt_id",),
    # `listening_tests.id`, `listening_test_attempts.id`, `class_items.id` đều UUID.
    "listening-test": ("test_id", "attempt_id", "class_item"),
    # `writing_essays.id`, `instructor_reviews.id`, `profiles.id` đều UUID.
    "instructor-deliver": ("essay_id", "review_id", "as_instructor"),
}


@pytest.mark.parametrize("name", ALL)
def test_id_la_uuid(name):
    """`feedback.py:119-125` trả 422 nếu `content_id` không phải UUID, nên một
    fixture dùng chuỗi tự nghĩ đang mô tả trạng thái backend luôn từ chối."""
    fx = _load(name)
    keys = UUID_KEYS.get(fx.get("kind"))
    assert keys, f"kind={fx.get('kind')!r} chưa khai khoá UUID nào — thêm vào UUID_KEYS"
    for key in keys:
        uuid.UUID(fx[key])
