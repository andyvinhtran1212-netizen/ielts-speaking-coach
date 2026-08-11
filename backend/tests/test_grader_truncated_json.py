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

import asyncio
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
    assert any(
        "thiếu field" in str(e) or "no JSON object found" in str(e)
        for e in refused
    ), "phải từ chối ở lớp cấu trúc hoặc vì thiếu field, không nhận bản bị cụt"


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


def test_an_unterminated_string_is_refused_instead_of_saved_as_complete():
    raw = '{"a": "This learner-facing sentence was cut in the mid'
    assert cg._close_unterminated_json(raw) is None
    parsed, error = cg._parse_json_response(raw)
    assert parsed is None
    assert "no JSON object found" in str(error)


def _valid_test_grade() -> dict:
    return {
        "band_fc": 6,
        "band_lr": 6,
        "band_gra": 6,
        "overall_band": 6.0,
        "fc_feedback": "Nói khá trôi chảy.",
        "lr_feedback": "Từ vựng ổn.",
        "gra_feedback": "Ngữ pháp ổn.",
        "strengths": ["Phát triển ý tốt"],
        "improvements": ["Dùng từ đa dạng hơn"],
        "improved_response": (
            "I really love reading books because reading helps me relax "
            "after a long day at work."
        ),
        "rubric_version": "v3",
    }


class _TwoResponseOrchestrator:
    def __init__(self, responses: list[str]):
        self._responses = iter(responses)
        self.calls = 0

    async def invoke(self, system_prompt, user_message, *,
                     user_id=None, session_id=None, order=None):
        self.calls += 1
        return next(self._responses), []


def test_mid_sentence_truncation_retries_provider_and_keeps_full_retry(monkeypatch):
    valid_raw = json.dumps(_valid_test_grade())
    cut_at = valid_raw.index("reading helps") + len("reading hel")
    truncated_raw = valid_raw[:cut_at]
    fake = _TwoResponseOrchestrator([truncated_raw, valid_raw])
    monkeypatch.setattr(cg, "_get_orchestrator", lambda: fake)
    monkeypatch.setattr(cg, "_get_client", lambda: None)

    result = asyncio.run(cg.grade_response(
        question="What do you do after work?",
        transcript="I really love reading books because reading helps me relax after work.",
        part=1,
        mode="test",
    ))

    assert fake.calls == 2
    assert result["improved_response"] == _valid_test_grade()["improved_response"]


def test_the_retry_asks_a_DIFFERENT_model():
    """Hỏi lại đúng mô hình vừa ngừng viết là lặp lại cùng một xúc xắc — đo trên
    prod: 36/38 lượt hỏng gọi hai lần, cả hai lần đều 'thành công'."""
    src = inspect.getsource(cg.grade_response)
    assert "_retry_order" in src, "lần thử lại phải có thứ tự nhà cung cấp riêng"
    i = src.index("_retry_order")
    assert "order=_retry_order" in src[i:], "khai ra rồi phải THỰC SỰ truyền đi"
    # Và phải TÍNH thứ tự ấy từ bên đã trả lời, không cắt cứng danh sách. Ghim
    # riêng hàm `_order_after` là ghim một hàm không ai gọi: bản phá-thử đổi
    # đúng dòng này vẫn xanh cho tới khi thêm chốt này.
    assert "_order_after(fallback_events)" in src, \
        "thứ tự thử lại phải suy từ bên vừa trả lời"
    assert "GRADING_PROVIDER_ORDER[1:]" not in src, \
        "cắt cứng đầu danh sách là sai khi bên đầu không phải bên đã trả lời"


def _ev(provider: str, outcome: str):
    from services.grading_providers.errors import FallbackEvent
    return FallbackEvent(provider=provider, attempt=0, outcome=outcome, latency_ms=1)


def test_the_retry_skips_the_model_that_actually_answered():
    """Bỏ mô hình ĐẦU DANH SÁCH là sai khi nó không phải bên đã trả lời: nếu
    `grading_primary` vắng mặt (không cấu hình / thiếu khoá) thì chuỗi hỏng đến
    từ `claude_haiku`, mà cắt `[1:]` lại bắt đầu đúng ở `claude_haiku` — hỏi lại
    chính nó (codex PR 945 vòng 4)."""
    from services.grading_orchestrator import GRADING_PROVIDER_ORDER as ORDER
    got = cg._order_after([_ev("grading_primary", "non_retryable"),
                           _ev("claude_haiku", "success")])
    assert "claude_haiku" not in got, "không được hỏi lại đúng bên vừa trả lời"
    assert got, "và vẫn phải còn ai đó để hỏi"

    got2 = cg._order_after([_ev("grading_primary", "success")])
    assert got2[0] != "grading_primary"
    assert set(got2) <= set(ORDER)


def test_the_last_provider_in_the_chain_wraps_around():
    """Bên trả lời là bên CUỐI chuỗi thì phía sau không còn ai — quay lại từ
    đầu, bỏ chính nó, thay vì trả về rỗng rồi hỏng cả lượt chấm."""
    got = cg._order_after([_ev("claude_sonnet", "success")])
    assert got and "claude_sonnet" not in got


def test_the_retry_order_never_ends_up_empty():
    """Cắt hết danh sách nghĩa là không còn ai để hỏi, và lượt chấm hỏng vì một
    phép cắt."""
    assert cg._order_after([]) 
    assert cg._order_after([_ev("mô-hình-lạ", "success")])
    assert cg._order_after(None)
