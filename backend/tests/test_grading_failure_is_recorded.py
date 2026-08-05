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
