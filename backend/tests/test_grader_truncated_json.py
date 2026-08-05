"""Bộ chấm ngừng viết giữa chừng — nguyên nhân gốc của 3,8% lượt chấm hỏng.

Truy từ dữ liệu prod, không đoán:

  · 38/1000 lượt gần nhất hỏng, rải đều 11/07 → 05/08 (không phải sự cố)
  · cả 38 đều: STT xong, transcript >100 ký tự, ghi ≥10s — giống hệt 962 lượt
    thành công, nên KHÔNG phải lỗi âm thanh
  · sổ `grading_events`: 36/38 gọi bộ chấm ĐÚNG HAI LẦN, cả hai đều `success`
    ở tầng mạng (lượt chấm được: 163/200 chỉ gọi một lần) — đúng dấu vân tay
    của đường thử-lại rồi ném `ValueError`
  · `ai_usage_logs`: output_tokens trung vị 773, cao nhất 1114/4096 — giả
    thuyết chạm-trần-token BỊ BÁC

Dựng lại được trên chính bài đã hỏng: gemini-3.5-flash trả `finish_reason=STOP`
với 953/4096 token nhưng JSON chưa đóng. 2/14 lượt trên một bài Part 2 thật.
Ràng buộc `response_schema` giảm còn 1/14 — giảm mạnh nhưng KHÔNG diệt hẳn, nên
chốt chặn phải nằm ở lớp đọc và lớp thử lại.

Hai bản thô trong `fixtures/gemini_truncated_grading.json` là output THẬT của
mô hình, chụp lại nguyên văn.
"""

from __future__ import annotations

import inspect
import json
import pathlib

from services import claude_grader as cg

_FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "gemini_truncated_grading.json"


def _raws() -> list[str]:
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))


def test_the_fixtures_really_are_broken_json():
    """Nếu chúng tự hợp lệ thì mọi chốt dưới đây chẳng chứng minh điều gì."""
    for raw in _raws():
        try:
            json.loads(raw)
        except json.JSONDecodeError:
            continue
        raise AssertionError("bản thô này vốn đã hợp lệ — không dùng làm chứng được")


def test_a_json_missing_only_its_closing_brace_is_recovered_in_full():
    """Bản chỉ thiếu dấu đóng: nội dung phía trước còn nguyên, phải cứu TRỌN."""
    recovered = [cg._parse_and_validate_practice(raw)[0] for raw in _raws()]
    good = [r for r in recovered if r]
    assert good, "không cứu được bản nào — lớp vá không chạy"
    for r in good:
        assert 1.0 <= r["overall_band"] <= 9.0
        assert r["sample_answer"], "cứu mà mất câu mẫu thì chưa gọi là cứu"


def test_a_truncation_that_ate_a_required_field_is_still_refused():
    """Bịa một điểm số cho phần mô hình chưa kịp viết là thứ không được phép."""
    outs = [cg._parse_and_validate_practice(raw) for raw in _raws()]
    refused = [err for res, err in outs if res is None]
    assert refused, "phải còn ít nhất một bản BỊ TỪ CHỐI, không cứu bằng mọi giá"
    assert any("thiếu field" in str(e) for e in refused), \
        "từ chối thì phải nói rõ thiếu gì"


def test_the_repair_is_a_no_op_on_balanced_text():
    """Không có gì để đóng thì không đụng vào — tránh vá nhầm một JSON lành."""
    assert cg._close_unterminated_json('{"a": 1}') is None
    assert cg._close_unterminated_json('{"a": [1, 2]}') is None
    # Ngoặc NẰM TRONG chuỗi không phải ngoặc.
    assert cg._close_unterminated_json('{"a": "{[ chưa đóng"}') is None


def test_the_repair_closes_in_the_right_nesting_order():
    out = cg._close_unterminated_json('{"a": [{"b": 1')
    assert out is not None and json.loads(out) == {"a": [{"b": 1}]}


def test_a_dangling_comma_does_not_survive_the_repair():
    out = cg._close_unterminated_json('{"a": ["x",')
    assert out is not None and json.loads(out) == {"a": ["x"]}


def test_an_unterminated_string_is_closed_too():
    out = cg._close_unterminated_json('{"a": "chưa đóng')
    assert out is not None and json.loads(out) == {"a": "chưa đóng"}


def test_the_retry_asks_a_DIFFERENT_model():
    """Hỏi lại đúng mô hình vừa ngừng viết là lặp lại cùng một xúc xắc — đo trên
    prod: 36/38 lượt hỏng gọi hai lần, cả hai lần đều 'thành công'."""
    src = inspect.getsource(cg.grade_response)
    assert "_retry_order" in src, "lần thử lại phải có thứ tự nhà cung cấp riêng"
    assert "GRADING_PROVIDER_ORDER[1:]" in src, \
        "phải BỎ QUA mô hình chính ở lần hai"
    i = src.index("_retry_order")
    assert "order=_retry_order" in src[i:], "khai ra rồi phải THỰC SỰ truyền đi"


def test_the_retry_order_never_ends_up_empty():
    """Một ngày nào đó chuỗi chỉ còn một nhà cung cấp — cắt đi là không còn ai
    để hỏi, và lượt chấm hỏng vì một phép cắt danh sách."""
    src = inspect.getsource(cg.grade_response)
    assert "or GRADING_PROVIDER_ORDER" in src
