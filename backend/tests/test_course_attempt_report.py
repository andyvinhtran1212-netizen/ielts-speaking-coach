"""Mặt đọc: học viên làm bài tập theo buổi TRONG BAO LÂU, vướng ở đâu.

Cho tới nay `quiz_attempts` không có mặt đọc nào cho bài tập theo buổi, nên ba
câu hỏi của giáo viên đều không trả lời được — và quan trọng nhất là "em ấy
đang làm dở hay đã bỏ cuộc", vốn trốn chung trong đám "chưa nộp".
"""

from __future__ import annotations

import inspect

from services import quiz_service as qs


def _src():
    return inspect.getsource(qs.course_attempt_report)


def test_time_comes_from_finished_stages_not_wall_clock():
    """Đóng tab rồi mở lại hôm sau thì `ended_at - started_at` là "một ngày
    rưỡi": đúng về đồng hồ, vô nghĩa về việc học."""
    src = _src()
    assert 'x.get("duration_sec")' in src
    assert "ended_at" in src and "started_at" in src
    # KHÔNG được lấy hiệu hai mốc ấy làm thời lượng.
    assert 'x["ended_at"] - x["started_at"]' not in src


def test_the_four_states_are_all_distinguished():
    src = _src()
    for st in ("doing", "done", "stalled", "untouched"):
        assert f'"{st}"' in src, f"thiếu trạng thái {st}"


def test_stalled_needs_a_real_silence_not_just_an_open_session():
    """Tải lại trang đẻ ra phiên mới; gọi mọi phiên mở là "bỏ dở" sẽ báo động
    giả cho cả lớp."""
    src = _src()
    assert "timedelta(hours=24)" in src


def test_empty_sessions_do_not_count_as_in_progress():
    """Phiên rỗng do tải lại trang từng nhiều hơn phiên thật."""
    src = _src()
    assert "with_work" in src
    i = src.index("live = ")
    assert "with_work" in src[i:i + 160], "đang-làm-dở phải đòi phiên CÓ BÀI"


def test_retake_sessions_are_excluded():
    """Phiên kiểm tra lại là mẫu nhỏ ngẫu nhiên — trộn vào là làm sai cả thời
    lượng lẫn số chặng."""
    src = _src()
    assert 'x.get("kind") or "run"' in src


def test_ids_are_chunked_and_rows_are_paged():
    """Hai giới hạn KHÁC NHAU: PostgREST cắt ở 1000 dòng mà không báo, còn
    `in.(...)` quá dài làm mặt đọc 500 thay vì hiện được gì."""
    src = _src()
    assert "_REPORT_IDS" in src
    assert "_report_pages" in src
    pager = inspect.getsource(qs._report_pages)
    assert ".range(" in pager, "không phân trang thì im lặng mất dòng thứ 1001"


def test_the_report_never_writes():
    src = _src()
    for bad in (".update(", ".insert(", ".upsert(", ".delete("):
        assert bad not in src, f"mặt ĐỌC không được {bad}"


def test_a_read_failure_returns_an_empty_report_not_a_500():
    src = _src()
    assert "except Exception" in src and "return out" in src


def test_the_axes_carry_both_how_wrong_and_how_slow():
    """"Sai nhiều" và "tốn thời gian" là hai vấn đề khác nhau: câu sai nhiều là
    chưa hiểu, câu chậm mà đúng là chưa thạo."""
    src = _src()
    assert '"wrong"' in src and '"median_sec"' in src


def test_stalled_students_sort_to_the_top():
    """Dòng giáo viên cần nhìn thấy trước là dòng đã bỏ cuộc, rồi tới dòng
    xong-chặng-mà-chưa-nộp-viết. Bảng này là danh sách VIỆC."""
    src = _src()
    i = src.index("_ORDER = {")
    order = eval(src[i + len("_ORDER = "):src.index("}", i) + 1])  # noqa: S307
    assert order["stalled"] < order["awaiting_writing"] < order["done"]
    assert order["doing"] < order["done"]


# ── Vòng 1 codex PR 945 ─────────────────────────────────────────────────────

def test_the_report_is_anchored_to_one_assignment_not_the_bank():
    """Cùng một bộ đề giao được cho NHIỀU LỚP. Đọc theo bank thì lượt làm của
    lớp khác trộn vào cả bảng lẫn trục vướng."""
    src = _src()
    assert "assignment_id" in inspect.signature(qs.course_attempt_report).parameters
    assert 'table("class_assignment_items"' in src or "class_assignment_items" in src
    assert 'x.get("class_assignment_item_id") in item_ids' in src, \
        "phiên phải thuộc ĐÚNG bài giao này"


def test_students_who_never_opened_the_task_still_get_a_row():
    """Bỏ họ đi là bỏ đúng thứ giáo viên đi tìm."""
    src = _src()
    assert "roster.items()" in src
    i = src.index("roster.items()")
    assert "untouched" in src or "by_user[uid] = []" in src[i:i + 200]


def test_done_means_every_stage_not_just_one():
    """Làm xong 1/10 chặng rồi dừng không phải là xong — và nhánh cũ gọi nó là
    'done', giấu đi đúng những lượt dở dang bảng này sinh ra để tìm."""
    src = _src()
    assert "stages_total" in src
    assert "len(done) >= total_stages" in src


def test_an_unknown_stage_count_never_reports_done():
    """Không đếm được số chặng thì KHÔNG được kết luận "xong": đoán ở đây là
    báo với giáo viên rằng một em đã hoàn thành trong khi không ai biết."""
    src = _src()
    i = src.index("total_stages")
    seg = src[i:i + 260]
    assert "if total_stages and" in seg, "0 = chưa biết, và chưa biết thì không xong"
    stage_src = inspect.getsource(qs._course_stage_count)
    assert "return 0" in stage_src, "đọc hỏng phải trả 0, không phải đoán"


def test_the_stage_count_excludes_writing_questions():
    """Câu tự luận nằm ngoài vòng chặng (không chấm máy), tính vào là đòi thêm
    một chặng không tồn tại và không ai 'xong' được nữa."""
    src = inspect.getsource(qs._course_stage_count)
    assert '"writing"' in src and "total - writing" in src


def test_a_partial_read_is_flagged_not_silently_smoothed_over():
    """Đọc hỏng mà trả bảng rỗng là vẽ ra một báo cáo trông bình thường mà sai:
    lượt ĐANG LÀM đọc thành "chưa mở", và trục vướng biến mất sạch (codex PR
    945 vòng 2)."""
    src = _src()
    assert '"stale": False' in src, "phải có cờ nói ra sự thiếu"
    # MỌI nhánh đọc hỏng đều phải bật cờ — vá một nhánh rồi sót nhánh khác thì
    # đúng nhánh ấy vẫn nói dối trong im lặng.
    n_except = src.count("except Exception")
    n_flag = src.count('out["stale"] = True')
    assert n_flag >= n_except, f"{n_except} nhánh đọc hỏng nhưng chỉ {n_flag} chỗ bật cờ"


def test_paged_reads_are_ordered_so_pages_line_up():
    """`range()` không đi một mình được: không có ORDER BY thì Postgres không
    hứa gì về thứ tự giữa hai truy vấn, nên trang thứ hai không neo vào trang
    thứ nhất — dòng bị lặp hoặc bị bỏ mà báo cáo vẫn trông đầy đủ (codex PR 945
    vòng 3). Một lớp 30 em × 100 câu vượt 1000 dòng dễ dàng."""
    src = inspect.getsource(qs._report_pages)
    i = src.index(".range(")
    assert ".order(" in src[:i], "phải ORDER trước khi cắt trang"


def test_recipients_without_an_account_still_get_a_row():
    """Lọc theo `user_id` vứt các em chưa kích hoạt đi: bảng đếm thiếu sĩ số,
    hoặc báo "chưa ai mở" cho một lớp toàn em chưa kích hoạt (codex PR 945)."""
    src = _src()
    assert "list(roster.items())" in src, "một dòng cho mỗi HỌC VIÊN được giao"
    assert '"student_id":  sid' in src, "dòng phải mang danh tính học viên"
    # Và KHÔNG được lọc bỏ theo user_id nữa.
    assert "if uid and uid not in by_user" not in src


def test_a_student_removed_after_submitting_is_still_shown():
    """Bài ấy đã xảy ra thật — giấu đi là làm sổ nói dối."""
    src = _src()
    assert "seen_uids" in src and "uid not in seen_uids" in src


# ── Xong CHẶNG chưa phải xong BÀI ───────────────────────────────────────────

def test_finishing_every_stage_is_not_finishing_the_task():
    """Phần tự luận nằm NGOÀI vòng chặng. Gộp hai chuyện lại là báo với giáo
    viên rằng một em đã hoàn thành trong khi em ấy còn mười câu chưa động tới.

    Ca thật: em Phương Anh Nguyễn — 9/9 chặng, 0 câu tự luận, mục bài giao đã
    `graded` 80 điểm. Nhìn từ phía giáo viên em ấy trông như đã xong, và không
    có mặt đọc nào nói khác đi.
    """
    src = _src()
    assert '"awaiting_writing"' in src
    i = src.index("total_stages and len(done) >= total_stages")
    seg = src[i:i + 420]
    assert 'out["writing_total"]' in seg and "wrote" in seg, \
        "'xong' phải hỏi CẢ phần tự luận"


def test_a_bank_without_writing_still_reaches_done():
    """Bộ đề không có câu tự luận thì xong chặng LÀ xong — đừng bắt cả lớp kẹt
    ở một trạng thái không lối ra."""
    src = _src()
    assert 'not out["writing_total"] or wrote' in src


def test_the_writing_lookup_is_scoped_to_the_assignment_item():
    """Giao lại cùng bộ bài là một lượt khác (mig 192) — đọc theo (bank, học
    viên) sẽ tính lượt nộp của lần giao TRƯỚC là đã xong lần này."""
    src = _src()
    i = src.index("course_writing_submissions")
    seg = src[i:i + 420]
    assert 'class_assignment_item_id' in seg and "item_ids" in seg


def test_a_failed_writing_read_is_flagged_too():
    src = _src()
    i = src.index("course_writing_submissions")
    assert 'out["stale"] = True' in src[i:i + 700]


def test_work_to_do_sorts_above_finished_work():
    """Bảng này là danh sách VIỆC. Em đã xong nằm cuối, em cần nhắc nằm đầu."""
    src = _src()
    assert '_ORDER = {"stalled": 0, "awaiting_writing": 1' in src
    assert '"done": 4' in src


def test_every_helper_that_swallows_a_read_error_also_reports_it():
    """Tôi bắt "mọi lượt đọc hỏng phải bật cờ stale" rồi để sót đúng hai HÀM PHỤ
    — chúng nuốt lỗi thành `0` và trả về như một con số thật (codex cục bộ
    05/08). Đọc hỏng khi đếm câu hỏi ⇒ báo cáo hiện `stale: false` rồi diễn giải
    tiến độ bằng dữ liệu thiếu, và cột tự luận biến mất như thể bộ đề không có
    phần viết.

    Ghim theo HÌNH DẠNG TRẢ VỀ: hàm phụ nào nuốt lỗi cũng phải trả kèm cờ
    đọc-được, chứ không phải chỉ con số.
    """
    src = inspect.getsource(qs._course_stage_count)
    assert "-> tuple[int, int, bool]" in src, "phải trả kèm cờ đọc-được"
    j = src.index("except Exception")
    assert "return 0, 0, False" in src[j:], "nhánh hỏng phải nói ra"
    caller = _src()
    assert "_count_ok" in caller and 'out["stale"] = True' in caller[
        caller.index("_count_ok"):caller.index("_count_ok") + 200]
