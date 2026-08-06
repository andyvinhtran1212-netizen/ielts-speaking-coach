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


def _load(name: str) -> dict:
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


def test_thu_muc_fixture_ton_tai():
    """Đường dẫn hỏng ⇒ mọi khẳng định dưới thành xanh-rỗng."""
    found = sorted(p.name for p in FIXTURES.glob("*.json"))
    assert found, f"không thấy fixture nào ở {FIXTURES}"


@pytest.mark.parametrize("name", ["listening-mcq"])
def test_payload_qua_duoc_bo_kiem_that(name):
    fx = _load(name)
    # Không bắt HTTPException: bộ kiểm ném ra là chốt này ĐỎ, kèm nguyên văn lý
    # do của production — đúng thứ cần đọc.
    _validate_mcq_payload(fx["payload"])


@pytest.mark.parametrize("name", ["listening-mcq"])
def test_id_la_uuid(name):
    """`feedback.py:119-125` trả 422 nếu `content_id` không phải UUID, nên một
    fixture dùng chuỗi tự nghĩ đang mô tả trạng thái backend luôn từ chối."""
    fx = _load(name)
    for key in ("content_id", "exercise_id"):
        uuid.UUID(fx[key])
