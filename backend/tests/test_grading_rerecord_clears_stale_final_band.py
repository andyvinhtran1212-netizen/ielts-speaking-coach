"""Báo cáo săn lỗi B2-01: ghi âm lại mà Azure không chạy vẫn giữ band cũ.

`_upsert_response` chỉ ghi những khoá CÓ MẶT trong `db_row`. Câu từng chấm có
Azure nên dòng `responses` đang mang `final_overall_band` / `final_band_p`. Ghi
âm lại, lần này Azure không chạy (lỗi, không có khoá, hoặc không được lấy
mẫu): trước bản sửa `db_row` không nhắc tới hai cột ấy, giá trị CŨ ở lại, và
`_compute_session_bands` ưu tiên `final_*` hơn `overall_band` ⇒ học viên thấy
điểm của bản ghi âm trước.

Chạy cả route với DB/AI giả (bộ khung của test_grading_pron_sample_window).
"""

from __future__ import annotations

from uuid import uuid4

from routers import grading
from test_grading_pron_sample_window import _entitled, _route  # noqa: F401  (fixture)


def _old_row(question_id=None):
    return {"id": str(uuid4()), "question_id": question_id or str(uuid4()),
            "pronunciation_status": "completed", "grading_status": "completed",
            "overall_band": 7.0, "final_overall_band": 7.5, "final_band_p": 8.0}


def _azure_down(monkeypatch):
    async def down(**_k):
        raise RuntimeError("azure down")
    monkeypatch.setattr(grading.azure_pronunciation, "assess_pronunciation", down)


def test_rerecord_without_azure_clears_the_old_final_bands(monkeypatch):
    # `_route` gắn Azure giả ở cuối; bước cắt audio chạy ngay trước khi gọi
    # Azure, nên thay Azure bằng bản hỏng ở đó.
    def extract(_audio):
        _azure_down(monkeypatch)
        return b"WAV"
    r = _route(monkeypatch, part=2, duration=120.0, flag=False, extract=extract)
    assert r.result["pronunciation"]["status"] != "completed"
    assert "final_overall_band" in r.row and r.row["final_overall_band"] is None
    assert "final_band_p" in r.row and r.row["final_band_p"] is None
    assert r.row["overall_band"] is not None


def test_not_sampled_rerecord_clears_the_old_final_bands(monkeypatch):
    # Part 1, một câu khác đã được Azure nghe ⇒ câu này không được lấy mẫu.
    r = _route(monkeypatch, part=1, duration=20.0, flag=True, responses=[_old_row()])
    assert r.calls == []
    assert r.row.get("final_overall_band", "missing") is None
    assert r.row.get("final_band_p", "missing") is None


def test_azure_success_still_writes_its_own_final_bands(monkeypatch):
    r = _route(monkeypatch, part=2, duration=120.0, flag=False)
    assert r.result["pronunciation"]["status"] == "completed"
    assert r.row["final_band_p"] is not None
    assert r.row["final_overall_band"] is not None


def test_core_row_fallback_also_clears_final_bands_on_a_graded_rerecord():
    """Đường lùi core-row bỏ mọi cột ngoài `_CORE_COLUMNS`, kể cả hai lệnh xoá
    `final_*` vừa đặt. Lệnh dọn riêng phải chạy cả khi chấm ĐƯỢC mà không có
    Azure, không chỉ khi chấm hỏng."""
    import inspect
    src = inspect.getsource(grading)
    i = src.index("response_id, partial = _persist_response_with_fallback")
    seg = src[i:i + 1400]
    assert 'if partial and response_id and db_row.get("final_overall_band", 0) is None:' in seg
