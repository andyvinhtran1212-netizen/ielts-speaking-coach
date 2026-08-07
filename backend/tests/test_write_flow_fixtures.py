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


VALIDATORS = {
    "listening-mcq": lambda fx: _validate_mcq_payload(fx["payload"]),
    "listening-tf": lambda fx: _validate_true_false_payload(fx["payload"]),
    "listening-gist": lambda fx: _validate_gist_payload(fx["payload"]),
    "reading-exam": _check_reading_exam,
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
