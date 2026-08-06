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
import uuid
from pathlib import Path

import pytest

from routers.listening import _validate_mcq_payload

FIXTURES = Path(__file__).resolve().parents[2] / "frontend/tooling/write-flows/fixtures"


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
VALIDATORS = {"listening-mcq": _validate_mcq_payload}


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
    VALIDATORS[kind](fx["payload"])


@pytest.mark.parametrize("name", ALL)
def test_id_la_uuid(name):
    """`feedback.py:119-125` trả 422 nếu `content_id` không phải UUID, nên một
    fixture dùng chuỗi tự nghĩ đang mô tả trạng thái backend luôn từ chối."""
    fx = _load(name)
    for key in ("content_id", "exercise_id"):
        uuid.UUID(fx[key])
