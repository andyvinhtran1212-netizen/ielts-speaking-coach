"""Báo cáo bài làm chi tiết: câu nào sai, em chọn gì, đáp án là gì.

Trước đó giáo viên chỉ thấy MỘT con số phần trăm, và học viên không xem lại
được bài mình. Cùng một bộ dựng phục vụ cả hai mặt đọc — hai bộ dựng cho cùng
một nội dung là hai chỗ để trôi khỏi nhau.
"""

from __future__ import annotations

import inspect

from services import quiz_service as qs


def _src():
    return inspect.getsource(qs.course_answer_report)


def test_it_answers_all_four_questions_a_learner_asks():
    """"câu nào đúng · câu nào sai · em chọn gì · đáp án là gì"."""
    src = _src()
    for k in ('"is_correct"', '"picked_text"', '"answer_text"', '"why_wrong"'):
        assert k in src, f"thiếu {k}"


def test_the_chosen_option_is_resolved_to_TEXT_not_just_an_index():
    """`answer_given` là một CHỈ SỐ. Hiện "bạn chọn 1" thì không ai đọc được."""
    src = _src()
    assert "opts[picked]" in src and "opts[correct]" in src


def test_a_non_numeric_answer_never_crashes_the_report():
    """Dữ liệu cũ có thể lưu dạng khác — một báo cáo đổ vỡ tệ hơn một ô trống."""
    src = _src()
    assert "except (TypeError, ValueError)" in src


def test_only_the_FIRST_attempt_at_each_question_counts():
    """Làm lại chặng (đóng tab giữa chừng) sinh lượt thứ hai, và cái giáo viên
    muốn đọc là lần em ấy thật sự nghĩ."""
    src = _src()
    assert "if a.get(\"qid\") and a[\"qid\"] not in first:" in src
    assert 'sorted(attempts, key=lambda x: x.get("created_at")' in src, \
        "lượt ĐẦU chỉ đúng nếu duyệt theo THỜI GIAN"


def test_retake_sessions_are_excluded():
    """Kiểm tra lại TRỘN thứ tự đáp án — cùng một câu sẽ hiện hai chỉ số khác
    nhau và báo cáo tự mâu thuẫn."""
    src = _src()
    assert 'x.get("kind") or "run"' in src


def test_writing_questions_are_not_in_the_multiple_choice_report():
    src = _src()
    assert 'q.get("type") == "writing"' in src


def test_the_time_per_question_is_a_median_not_a_mean():
    """Một câu bỏ dở 29 phút kéo trung bình đi xa khỏi mọi câu thật."""
    src = _src()
    assert "times[len(times) // 2]" in src


def test_idle_time_is_labelled_as_an_ESTIMATE_with_its_threshold():
    """`response_time_ms` GỘP cả suy nghĩ lẫn rời máy, và dữ liệu không tách
    được hai thứ. Hiệu "đồng hồ treo tường trừ thời gian trả lời" thì luôn ÂM.
    Nên phải ước lượng bằng phần vượt ngưỡng — và nói ra ngưỡng ấy."""
    src = _src()
    assert "IDLE_CUTOFF_SEC" in src
    assert '"idle_cutoff_sec"' in src, "phải TRẢ RA ngưỡng, đừng giấu nó trong mã"
    assert qs.IDLE_CUTOFF_SEC == 180


def test_the_class_table_and_the_single_report_count_time_the_same_way():
    """Hai con số khác nhau cho CÙNG một em thì giáo viên không biết tin cái
    nào. Cả hai phải lấy lượt ĐẦU của mỗi câu."""
    table = inspect.getsource(qs.course_attempt_report)
    assert "seen_q" in table and "key2 in seen_q" in table
    assert 'all_rows.sort(key=lambda x: x.get("created_at")' in table, \
        "lượt đầu chỉ đúng nếu sắp theo thời gian"
    assert "IDLE_CUTOFF_SEC" in table


def test_the_report_never_writes():
    src = _src()
    for bad in (".update(", ".insert(", ".upsert(", ".delete(", ".rpc("):
        assert bad not in src


def test_a_read_failure_is_flagged_not_silently_empty():
    src = _src()
    assert src.count('out["stale"] = True') >= src.count("except Exception")


# ── Xong chặng CHƯA PHẢI nộp bài ────────────────────────────────────────────

def test_finishing_a_stage_does_not_close_an_assignment_that_has_writing():
    """`end_session` đóng dấu "đã nộp" ngay từ chặng ĐẦU TIÊN. Với bộ đề có phần
    tự luận, một em làm hết 9 chặng rồi dừng vẫn hiện là đã hoàn thành — đúng ca
    đã xảy ra với em Phương Anh Nguyễn (9/9 chặng, 0 câu viết, sổ ghi `graded`
    80 điểm), và giáo viên không có cách nào biết cần nhắc em ấy.
    """
    src = inspect.getsource(qs.end_session)
    assert "_bank_has_writing" in src
    # Neo vào LỆNH GỌI, không phải chữ `mark_item_submitted` — chữ ấy còn nằm
    # trong một lời chú đứng TRƯỚC cả khối, nên tìm chữ sẽ trúng lời chú.
    i = src.index("            mark_item_submitted(")
    assert "not _bank_has_writing" in src[:i], "chắn phải đứng TRƯỚC lệnh chốt sổ"


def test_an_unreadable_bank_is_treated_as_having_writing():
    """Chặt hơn là an toàn hơn: coi nhầm "có phần viết" chỉ làm lượt chốt sổ
    chậm một nhịp; coi nhầm "không có" thì đóng dấu đã-nộp cho một bài còn mười
    câu chưa động tới."""
    src = inspect.getsource(qs._bank_has_writing)
    j = src.index("except Exception")
    assert "return True" in src[j:]


def test_a_bank_without_writing_still_closes_on_the_stage():
    """Đừng bắt lớp không có phần viết kẹt lại ở "chưa nộp" mãi mãi."""
    src = inspect.getsource(qs._bank_has_writing)
    assert "if not bank_id:" in src and "return False" in src


# ── Vòng soát cục bộ 06/08 ──────────────────────────────────────────────────

def test_the_teacher_path_does_not_go_through_the_learner_gate():
    """Cổng học viên đòi bài giao CÒN MỞ và CÒN HẠN. Đi qua nó thì giáo viên mở
    "Bài từng em" cho một bài đã quá hạn hay đã đóng sẽ nhận 404 — đúng lúc cần
    đọc nhất. Quyền đã kiểm ở tầng tuyến (require_admin)."""
    src = _src()
    assert '({} if assignment_id else _bank_meta_or_404(' in src


def test_one_rule_for_axes_scores_and_time():
    """Em làm Q1 đúng, đóng tab, làm lại và trả lời Q1 sai: "Bài từng em" nói
    Q1 đúng, còn "Chi tiết làm bài" lại tăng lỗi trục và lệch số đúng/tổng nếu
    mỗi bên đếm một kiểu."""
    src = inspect.getsource(qs.course_attempt_report)
    i = src.index("if not uid or not a.get(\"qid\") or key2 in seen_q:")
    seg = src[i:i + 700]
    assert "wrong[key] = wrong.get(key, 0) + 1" in seg, "trục cũng phải lấy lượt đầu"
    assert "slow.setdefault" in seg, "thời gian mỗi trục cũng vậy"
    assert "asked = len(firsts)" in src, "số câu lấy từ lượt đầu, không cộng tổng phiên"
    assert 'sum(int(x.get("total_questions")' not in src


def test_attempts_are_sorted_ACROSS_batches_not_inside_each():
    """`seen_q` dùng chung cho mọi lô, nên sắp trong từng lô sẽ để một lượt MỚI
    hơn ở lô đầu chặn mất lượt CŨ hơn ở lô sau — lớp trên 100 phiên là gặp."""
    src = inspect.getsource(qs.course_attempt_report)
    i = src.index("all_rows.sort")
    assert "for i in range(0, len(sessions), _REPORT_IDS)" in src[:i], \
        "phải THU hết rồi mới sắp"
    assert "rows.sort" not in src.split("all_rows.sort")[0], "không sắp trong từng lô"
