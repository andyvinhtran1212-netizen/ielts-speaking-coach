"""Model của bộ chấm tự luận phải là model CÒN HIỆU LỰC.

Chuyện thật 06/08: `gemini-2.5-flash-lite` bị ngừng cấp — gọi nó trả 404 "no
longer available to new users", TRONG KHI `list_models()` vẫn liệt kê nó. Nhìn
danh sách không thấy gì bất thường, còn học viên nhận "Bộ chấm tạm thời không
dùng được" và mất lượt nộp DUY NHẤT của mình (em Lê Chinh).

Không gọi mạng ở đây: CI không có khoá, và một chốt phụ thuộc dịch vụ ngoài sẽ
đỏ vì lý do chẳng liên quan. Ghim thứ kiểm được ngoại tuyến — model đã chết thì
không được nằm trong mã, và một 404 phải đọc ra là hỏng CẤU HÌNH, không phải
hỏng tạm thời.
"""

from __future__ import annotations

import inspect

from config import Settings
from services import course_writing_grader as g

# Model đã biết là chết. Thêm vào đây khi Google ngừng cấp cái tiếp theo.
RETIRED = {"gemini-2.5-flash-lite"}

# Danh sách CHO PHÉP, không phải danh sách cấm. Danh sách cấm một phần tử thì
# `gemini-typo` cũng qua (codex 06/08); ở đây đổi model là phải sửa cả chốt, và
# lúc ấy người sửa buộc phải đi thử gọi model mới.
KNOWN_LIVE = {
    "gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3-flash-preview",
    "gemini-2.5-flash", "gemini-3.5-flash",
}


def test_the_configured_model_is_one_we_have_actually_called():
    m = Settings().COURSE_WRITING_MODEL
    assert m not in RETIRED
    assert m in KNOWN_LIVE, (
        f"{m} chưa có trong danh sách model ĐÃ THỬ GỌI. Thử gọi thật rồi thêm "
        "vào KNOWN_LIVE — `list_models()` VẪN liệt kê model đã ngừng cấp.")


def test_the_in_code_fallback_agrees_with_the_config_default():
    """Hai nơi giữ hai giá trị là hai luật.

    Bản vá đầu của tôi sửa chuỗi trong `_model()` và tưởng xong — nhưng mặc định
    THẬT nằm ở `config.py`, nên bản vá ấy không bao giờ tới lượt (06/08).
    """
    src = inspect.getsource(g._model)
    i = src.index('COURSE_WRITING_MODEL", None) or "')
    fallback = src[i:].split('"')[2]
    assert fallback == Settings().COURSE_WRITING_MODEL, \
        f"lưới đỡ ({fallback}) khác mặc định ({Settings().COURSE_WRITING_MODEL})"
    assert fallback in KNOWN_LIVE


def _grade_with_error(msg):
    """Gọi THẬT `_grade_batch` với một model chỉ biết ném lỗi."""
    import asyncio
    from unittest.mock import patch

    class _Boom:
        async def generate_content_async(self, _p):
            raise RuntimeError(msg)

    with patch.object(g, "_model", lambda: ("model-thử", _Boom())):
        out, _ = asyncio.run(g._grade_batch(
            [{"qid": "w1", "prompt": "đề", "answer": "câu em viết"}]))
    return out[0]


def test_a_dead_model_reads_as_a_CONFIG_failure_not_a_transient_one():
    """Model bị ngừng cấp sẽ trả 404 MÃI MÃI. Gọi nó là "tạm thời" khiến ai đọc
    log cũng đợi nó tự khỏi, và bộ chấm nằm chết nhiều ngày.

    GỌI THẬT, không soi chữ: bản trước ghim các chuỗi trong mã nguồn, nên đổi
    `if dead_model:` thành `if False:` vẫn xanh — chốt canh một nhánh không bao
    giờ chạy (06/08).
    """
    r = _grade_with_error(
        "404 This model models/gemini-2.5-flash-lite is no longer available to new users.")
    assert "cấu hình" in (r.get("error") or ""), r.get("error")
    assert "tạm thời" not in (r.get("error") or "")


def test_a_genuinely_transient_error_still_reads_as_transient():
    """Nới nhánh mới không được nuốt luôn nhánh cũ: hết hạn mức, mạng chập —
    những thứ ấy thật sự tự khỏi."""
    r = _grade_with_error("503 The service is currently unavailable.")
    assert "tạm thời" in (r.get("error") or ""), r.get("error")


def test_the_student_is_told_their_work_is_SAFE():
    """Lượt nộp tự luận chỉ có MỘT. Một lời nhắn không nói bài còn hay mất sẽ
    khiến em ấy tưởng phải viết lại từ đầu."""
    r = _grade_with_error("404 model not found")
    assert "vẫn được lưu" in (r.get("error") or "")


def test_a_failed_grade_is_ok_None_not_ok_False():
    """`None` = CHƯA CHẤM ĐƯỢC. `False` = đã chấm và SAI. Trộn hai cái là báo
    với học viên rằng câu đúng của em ấy bị sai."""
    src = inspect.getsource(g._fallback)
    assert '"ok":        None' in src


# ── Phân loại theo MÃ TRẠNG THÁI, không theo chuỗi ─────────────────────────
#
# Bản trước dò chuỗi "404" + "not found", nên gọi mọi 404 là model chết và gọi
# 401/403 là "tạm thời" — hai lỗi vĩnh viễn nằm chờ tự khỏi (codex 06/08).

import pytest


class _Err(RuntimeError):
    def __init__(self, msg, code=None):
        super().__init__(msg)
        if code is not None:
            self.code = code


@pytest.mark.parametrize("code,expect_config", [
    (400, True),    # tên model sai
    (401, True),    # thiếu khoá
    (403, True),    # khoá không đủ quyền
    (404, True),    # model ngừng cấp
    (429, False),   # hết hạn mức — tự khỏi
    (500, False),
    (503, False),   # dịch vụ chập
])
def test_config_errors_are_told_apart_from_transient_ones(code, expect_config):
    assert g._is_config_error(_Err("bất kỳ chữ gì", code=code)) is expect_config


def test_it_falls_back_to_the_text_when_the_sdk_gives_no_code():
    """Không phải lỗi nào cũng mang `code`. Nhưng chỉ dò trong 80 ký tự ĐẦU —
    một con số 404 nằm lọt trong thân câu lỗi không biến nó thành lỗi cấu hình."""
    assert g._is_config_error(_Err("404 model not found")) is True
    assert g._is_config_error(_Err("503 service unavailable")) is False


def test_a_config_error_message_says_it_will_NOT_fix_itself():
    r = _grade_with_error("403 permission denied")
    assert "cấu hình" in (r.get("error") or "")
    assert "vẫn được lưu" in (r.get("error") or "")
