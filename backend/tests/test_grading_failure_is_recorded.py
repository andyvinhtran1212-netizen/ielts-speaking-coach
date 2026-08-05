"""Chấm hỏng phải để lại DẤU VẾT.

Báo cáo thật: học viên thyanh0809, bài 12 câu — 11 câu chấm xong, 1 câu
`grading_status='failed'` với `feedback` rỗng. Trên prod 38/1000 lượt gần nhất
hỏng (3,8%), và KHÔNG dòng nào ghi lý do: `grading_error` được gán ở nhánh
except rồi không ai dùng nữa, nên mỗi lần điều tra là một lần đoán mò.
"""

from __future__ import annotations

import inspect
import json
import re

from routers import grading as g


def _src():
    return inspect.getsource(g)


def test_the_failure_reason_is_written_to_the_response_row():
    src = _src()
    i = src.index('db_row["feedback"]     = _serialize_feedback')
    tail = src[i:i + 900]
    assert "_failed" in tail, "dòng chấm hỏng phải tự nhận là hỏng"
    assert "grading_error" in tail, "và phải mang theo LÝ DO"


def test_the_reason_is_bounded_so_one_stack_trace_cannot_bloat_the_row():
    src = _src()
    m = re.search(r'"_reason": \(grading_error or ""\)\[:(\d+)\]', src)
    assert m and int(m.group(1)) <= 2000


def test_the_client_is_told_why_not_just_that():
    """Trang cần lý do để ghi lại được; câu chung chung không giúp ai điều tra."""
    src = _src()
    i = src.index('"_stub":               True')
    assert '"_reason"' in src[i:i + 400]


def test_the_stub_branch_still_reports_the_saved_recording():
    # Bài của học viên ĐÃ lên máy chủ — nói mất là nói sai.
    src = _src()
    i = src.index('"_stub":               True')
    seg = src[i:i + 600]
    assert "transcript" in seg and "response_id" in seg


def test_grading_status_failed_is_still_written():
    # Cột này là thứ lượt tải lại trang đọc để phân biệt chấm-hỏng với đang-chấm.
    assert '"grading_status":              "completed" if grading else "failed"' in _src()


# ── Nộp được khi bài ĐÃ LƯU mà chấm hỏng hết (codex #942) ───────────────────

def test_complete_separates_no_recording_from_no_grading():
    """Chốt cũ gộp hai chuyện: "chưa ghi âm gì" (từ chối là đúng) và "đã ghi đủ
    nhưng bộ chấm hỏng hết" (từ chối là NHỐT học viên). Với 3,8% lượt chấm hỏng
    trên prod, "hỏng cả lượt" không phải giả định xa vời."""
    from routers import sessions as se
    src = inspect.getsource(se.complete_session)
    i = src.index("all_band_vals = [overall_band]")
    seg = src[i:i + 2600]
    # Phải ĐẾM bài đã lưu trước khi từ chối.
    assert 'table("responses")' in seg and 'count="exact"' in seg
    # Chốt nay rộng hơn: từ chối khi KHÔNG có bài nào, HOẶC chưa trả lời đủ câu
    # (xem test_null_band_completion_requires_every_question_answered).
    assert "if not saved or" in seg, "chỉ từ chối khi thiếu bài, không phải khi thiếu ĐIỂM"
    # Và phải để lại dấu vết cho lượt hoàn thành không-band.
    assert "chấm hỏng hết" in seg


def test_a_failed_count_query_keeps_the_stricter_old_behaviour():
    from routers import sessions as se
    src = inspect.getsource(se.complete_session)
    i = src.index("all_band_vals = [overall_band]")
    seg = src[i:i + 2600]
    j = seg.index("except Exception")
    assert "saved = 0" in seg[j:j + 400], "đọc hỏng thì chặt hơn là an toàn hơn"


def test_null_band_completion_requires_every_question_answered():
    """Chỉ hỏi "có bài nào không" thì một client cũ gọi /complete sớm sẽ chốt cả
    bài 12 câu bằng đúng MỘT dòng hỏng — sổ giáo viên ghi "đã nộp" cho một bài
    làm dở (codex #942)."""
    from routers import sessions as se
    src = inspect.getsource(se.complete_session)
    i = src.index("all_band_vals = [overall_band]")
    seg = src[i:i + 2200]
    assert 'table("questions")' in seg, "phải đếm SỐ CÂU của phiên"
    assert "saved < asked" in seg, "và đòi trả lời đủ"
