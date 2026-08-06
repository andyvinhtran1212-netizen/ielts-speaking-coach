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
    # Chắn nay là `_course_work_is_done`, hỏi CẢ hai điều: bộ đề có phần viết
    # không, VÀ đã đủ số chặng chưa. Chốt chi tiết của luật ấy nằm ở
    # `test_end_session_marks_only_when_done.py`.
    #
    # Neo vào LỆNH GỌI, không phải chữ `mark_item_submitted` — chữ ấy còn nằm
    # trong một lời chú đứng TRƯỚC cả khối, nên tìm chữ sẽ trúng lời chú.
    i = src.index("            mark_item_submitted(")
    assert "_course_work_is_done(" in src[:i], "chắn phải đứng TRƯỚC lệnh chốt sổ"
    gate = inspect.getsource(qs._course_work_is_done)
    assert "if writing:" in gate, "phải hỏi phần tự luận TỪ CÙNG lượt đọc bộ đề"


def test_an_unreadable_bank_fails_the_way_that_does_not_STICK():
    """Bản đầu trả `True` với lý lẽ "chặt hơn là an toàn hơn: chốt sổ chậm một
    nhịp thôi". Lý lẽ ấy SAI — với bộ đề KHÔNG có tự luận thì không có nhịp nào
    sau cả: `end_session` là đường chốt sổ duy nhất, và
    `reconcile_ledger_from_sessions` chỉ vá từ bảng `sessions` (Speaking), không
    đọc `quiz_sessions`. Một lần đọc hỏng để lại bài giao KẸT VĨNH VIỄN.

    Hỏng chiều ngược lại thì có giới hạn: một bài bị đóng dấu sớm MỘT lần, và
    bảng "Chi tiết làm bài" vẫn nói đúng vì nó đọc thẳng
    `course_writing_submissions` (codex PR 952).
    """
    src = inspect.getsource(qs.bank_has_writing)
    j = src.index("except Exception")
    assert "return False" in src[j:]
    assert "return True" not in src[j:]


def test_the_writing_flag_is_NOT_cached_across_calls():
    """Bộ nhập bài tập theo buổi cập nhật lại ĐÚNG `bank_id` rồi thay bộ câu
    hỏi, và nó chạy ở tiến trình KHÁC nên không xoá cache hộ được. Một giá trị
    nhớ từ trước re-import sai theo cả hai chiều: nhớ "có" thì bài kẹt vĩnh viễn
    khi phần viết bị bỏ; nhớ "không" thì chốt sổ trước phần viết vừa thêm
    (codex cục bộ 06/08)."""
    src = inspect.getsource(qs.bank_has_writing)
    assert "memo" in src, "chỉ được nhớ trong MỘT lượt gọi"
    assert not hasattr(qs, "_WRITING_CACHE"), "không được có cache dài hạn"

def test_a_bank_without_writing_still_closes_on_the_stage():
    """Đừng bắt lớp không có phần viết kẹt lại ở "chưa nộp" mãi mãi."""
    src = inspect.getsource(qs.bank_has_writing)
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
    # Cắt tới HẾT vòng lặp, không đếm ký tự: thêm vài dòng chú thích là mốc
    # cần soi trôi ra ngoài cửa sổ (bẫy đã lặp nhiều lần trong phiên này).
    seg = src[i:src.index("now = datetime.now", i)]
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


# ── Vòng bot PR 952 ─────────────────────────────────────────────────────────

def test_the_report_recomputes_correctness_from_the_stored_answer():
    """`log_progress` nhận nguyên cờ `is_correct` do CLIENT gửi. `course_verdict`
    đã tự chấm lại từ lâu vì đúng lý do này; báo cáo tin cờ client thì một
    payload sửa tay biến câu sai thành câu đúng và giấu luôn đáp án thật."""
    src = _src()
    assert "ok = (picked == correct) if (picked is not None and correct is not None)" in src
    assert '"is_correct": ok,' in src
    # Không so được thì mới dùng cờ đã lưu — thà giữ nguyên còn hơn kết luận bừa.
    assert 'else bool(a.get("is_correct"))' in src


def test_the_class_table_recomputes_it_too():
    """Hai mặt đọc phải chấm bằng CÙNG một thước."""
    table = inspect.getsource(qs.course_attempt_report)
    assert "def _ok(a: dict) -> bool:" in table
    assert 'int(a.get("answer_given")) == want' in table
    assert 'a["is_correct"] = _ok(a)' in table


def test_time_totals_come_from_the_SAME_set_as_the_median():
    """`active_sec`/`idle_sec` đếm mọi lượt trong khi trung vị chỉ đếm lượt đầu
    ⇒ một chặng làm lại được tính hai lần, và hai con số cạnh nhau tự mâu thuẫn."""
    src = _src()
    assert "for a in first.values()" in src
    assert "for a in attempts]" not in src


# ── Xem lại bài CHỈ mở sau khi ĐÃ ĐẠT ───────────────────────────────────────
#
# Màn này phát ra đáp án đúng của TỪNG câu kèm lời giải, mà kỳ kiểm tra lại bốc
# mẫu từ chính bộ câu ấy. Mở trước khi đạt là đưa trọn bộ đáp án cho một em sắp
# phải làm lại — và "đạt" sau đó không còn nghĩa gì.

from unittest.mock import patch


def _gate(*, passed_at, threshold=75, item=True, boom=False):
    class _Q:
        def __init__(self, rows):
            self._rows = rows

        def select(self, *_a, **_k):
            return self

        def eq(self, *_a):
            return self

        def limit(self, *_a):
            return self

        def execute(self):
            class R:
                pass
            r = R()
            r.data = self._rows
            return r

    class _DB:
        def table(self, name):
            if boom:
                raise RuntimeError("đọc hỏng")
            if name == "class_assignment_items":
                return _Q([{"passed_at": passed_at}])
            return _Q([{"id": "a1", "content_config": {"pass_pct": threshold}}])

    with patch.object(qs, "supabase_admin", _DB()), \
            patch.object(qs, "_assignment_item_for",
                         lambda *_a, **_k: {"id": "i1", "assignment_id": "a1"} if item else None):
        return qs._course_review_gate("bank-1", "u1")


def test_a_student_who_has_NOT_passed_cannot_read_the_answers():
    g = _gate(passed_at=None)
    assert g and g["locked"] is True and g["threshold"] == 75, \
        "chưa đạt mà đọc được đáp án thì kỳ kiểm tra lại vô nghĩa"


def test_a_student_who_HAS_passed_can():
    assert _gate(passed_at="2026-08-06T01:00:00+00:00") is None


def test_the_threshold_comes_from_the_assignment_not_a_constant():
    """Ngưỡng do giáo viên đặt. Chép một con số vào đây là hai nơi nói hai luật."""
    g = _gate(passed_at=None, threshold=60)
    assert g["threshold"] == 60


def test_a_bank_outside_any_class_assignment_is_untouched():
    """Bài tập tự luyện không có khái niệm 'đạt' — chặn nó là chặn nhầm người."""
    assert _gate(passed_at=None, item=False) is None


def test_a_read_failure_lets_the_student_through():
    """Đây là màn ÔN TẬP. Chặn một em đã đạt khỏi bài của chính em ấy vì một
    lượt đọc phụ trợ là cái giá đắt hơn — và rủi ro ngược lại chỉ xảy ra khi cơ
    sở dữ liệu đang lỗi, lúc ấy em ấy cũng không làm bài được."""
    assert _gate(passed_at=None, boom=True) is None


def test_the_gate_runs_only_on_the_STUDENT_path():
    """Giáo viên chấm bài, không làm bài — chặn họ là chặn đúng lúc cần đọc."""
    src = _src()
    i = src.index("_course_review_gate")
    assert "if not assignment_id:" in src[max(0, i - 400):i]
