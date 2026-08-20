"""Báo cáo bài làm chi tiết: câu nào sai, em chọn gì, đáp án là gì.

Trước đó giáo viên chỉ thấy MỘT con số phần trăm, và học viên không xem lại
được bài mình. Cùng một bộ dựng phục vụ cả hai mặt đọc — hai bộ dựng cho cùng
một nội dung là hai chỗ để trôi khỏi nhau.
"""

from __future__ import annotations

import inspect
from unittest.mock import patch

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


def test_an_unreadable_bank_is_unknown_not_a_false_no_writing_claim():
    """Trang lớp dùng cờ này để nói học viên còn phần tự luận hay không. Một
    lượt đếm hỏng không chứng minh được số câu là 0, nên phải giữ trạng thái
    thứ ba để route bật ``homework_stale``."""
    class _Broken:
        def select(self, *_a, **_k): return self
        def eq(self, *_a): return self
        def limit(self, *_a): return self
        def execute(self): raise RuntimeError("count unavailable")

    db = type("DB", (), {"table": lambda self, _name: _Broken()})()
    memo = {}
    with patch.object(qs, "supabase_admin", db):
        assert qs.bank_has_writing("b1", memo=memo) is None
        assert memo["b1"] is None, "đừng lặp một truy vấn hỏng cho từng dòng"


def test_a_real_zero_writing_count_stays_false():
    """Không có câu viết thật là dữ liệu chính thức, không được bật cảnh báo."""
    class _Empty:
        def select(self, *_a, **_k): return self
        def eq(self, *_a): return self
        def limit(self, *_a): return self
        def execute(self): return type("Resp", (), {"count": 0})()

    db = type("DB", (), {"table": lambda self, _name: _Empty()})()
    with patch.object(qs, "supabase_admin", db):
        assert qs.bank_has_writing("b1") is False


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
    assert '({} if assignment_id else _bank_meta_for_review_or_404(' in src


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

def test_all_THREE_surfaces_grade_with_the_SAME_helper():
    """`log_progress` nhận nguyên cờ `is_correct` do CLIENT gửi, nên cả ba mặt
    đọc phải tự chấm lại — và phải chấm bằng CÙNG một thước.

    Trước đây ba nơi chấm ba kiểu: lượt xét so CHUỖI, báo cáo parse SỐ, bảng lớp
    parse SỐ rồi lùi về cờ client. `answer_given="01"` cho hai kết quả trái
    nhau (codex #970). Ghim LỜI GỌI, không ghim biểu thức: bản trước ghim đúng
    chuỗi `int(a.get("answer_given")) == want`, nên gom về một hàm chung — việc
    ĐÚNG — lại làm chốt đỏ.
    """
    for fn in (qs.course_verdict, qs.course_answer_report, qs.course_attempt_report):
        assert "grade_attempt(" in inspect.getsource(fn), fn.__name__


def test_the_grader_never_falls_back_to_the_client_flag_when_the_bank_HAS_an_answer():
    """Một payload sửa tay khai `answer_given="x"` kèm `is_correct=true` từng
    được hai trong ba mặt đọc tính là ĐÚNG."""
    assert qs.grade_attempt("x", 1) is False
    assert qs.grade_attempt(None, 1) is False


def test_leading_zeros_and_spaces_are_the_same_choice():
    """`"01"` là lựa chọn số 1, không phải một chuỗi lạ. Bản cũ của lượt xét so
    chuỗi nên gọi nó là SAI, còn báo cáo gọi là ĐÚNG."""
    for given in ("1", "01", " 1 ", "  01"):
        assert qs.grade_attempt(given, 1) is True, given
    assert qs.grade_attempt("2", 1) is False


def test_a_question_with_no_usable_answer_returns_None():
    """Câu tự luận, hay đề thiếu đáp án: lúc ấy thật sự không còn gì tốt hơn cờ
    đã lưu, nên trả None để nơi gọi tự lo."""
    assert qs.grade_attempt("1", None) is None
    assert qs.grade_attempt("1", "1") is None, "đáp án phải là SỐ mới so được"


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
    assert "if not assignment_id else None" in src, \
        "cổng phải TẮT khi có assignment_id (đường giáo viên)"


def test_the_redaction_lists_the_kept_fields_INSTEAD_of_deleting_the_rest():
    """Xoá bớt khoá thì thêm một trường mới ở trên mà quên xoá ở đây sẽ khiến nó
    tự động lọt ra ngoài. Danh sách giữ-lại thì mặc định là KÍN."""
    src = _src()
    i = src.index("if locked:")
    seg = src[i:i + 700]
    assert '"item_key": r["item_key"]' in seg
    for leak in ("prompt", "answer", "explain", "why_wrong", "options", "picked"):
        assert f'"{leak}"' not in seg, f"trường lộ đáp án lọt vào bản rút gọn: {leak}"


# ── Hai mức: trục yếu mở luôn, từng câu chờ đạt ────────────────────────────
#
# Em CHƯA đạt mới là em cần biết mình yếu chỗ nào nhất — nên khoá cả hai mức
# là sai chiều. Nhưng chi tiết từng câu thì phải chờ: kỳ kiểm tra lại bốc mẫu
# từ chính bộ câu ấy.

def _report(*, passed):
    """Chạy trọn `course_answer_report` với một cơ sở dữ liệu giả."""
    QS = [{"qid": "q0", "type": "mcq", "subtype": "gap", "item_key": "chia động từ",
           "prompt": "She ___ to school.", "options": ["go", "goes"], "answer": 1,
           "explain": "ngôi thứ ba số ít", "why_wrong": {"0": "thiếu -es"}, "order": 0},
          {"qid": "q1", "type": "mcq", "subtype": "gap", "item_key": "mạo từ",
           "prompt": "___ apple", "options": ["a", "an"], "answer": 1,
           "explain": "trước nguyên âm", "why_wrong": {"0": "a đi với phụ âm"}, "order": 1}]

    class _Q:
        def __init__(self, rows, cols="*"):
            self._rows, self._cols = list(rows), cols

        def eq(self, c, v): return _Q([r for r in self._rows if r.get(c) == v], self._cols)
        def in_(self, c, vs): return _Q([r for r in self._rows if r.get(c) in set(vs)], self._cols)
        def order(self, c, **_k): return _Q(sorted(self._rows, key=lambda r: r.get(c) or 0), self._cols)
        def limit(self, *_a): return self
        def range(self, a, b): return _Q(self._rows[a:b + 1], self._cols)

        def execute(self):
            class R: pass
            r = R()
            want = ([c.strip() for c in self._cols.replace("\n", " ").split(",")]
                    if self._cols != "*" else None)
            r.data = ([{k: x.get(k) for k in want} for x in self._rows] if want
                      else [dict(x) for x in self._rows])
            return r

    class _DB:
        def table(self, name):
            rows = {
                "quiz_sessions": [{"id": "s1", "user_id": "u1", "kind": "run",
                                   "bank_id": "b1",
                                   "class_assignment_item_id": "i1",
                                   "duration_sec": 60, "ended_at": "2026-08-06T01:00:00+00:00"}],
                "quiz_attempts": [{"session_id": "s1", "qid": "q0", "is_correct": False,
                                   "answer_given": "0", "response_time_ms": 9000,
                                   "created_at": "2026-08-06T00:59:00+00:00"},
                                  {"session_id": "s1", "qid": "q1", "is_correct": True,
                                   "answer_given": "1", "response_time_ms": 4000,
                                   "created_at": "2026-08-06T00:59:30+00:00"}],
                "quiz_questions": [{**q, "bank_id": "b1"} for q in QS],
                "class_assignment_items": [{"id": "i1", "assignment_id": "a1",
                                            "passed_at": "2026-08-06T02:00:00+00:00" if passed else None,
                                            "mastery": {"threshold": 75, "attempts": [
                                                {"phase": "run", "pct": 70,
                                                 "at": "2026-08-06T01:10:00+00:00",
                                                 "sessions": ["s1"],
                                                 "next_action": "retake"},
                                            ]}}],
                "class_assignments": [{"id": "a1", "content_config": {"pass_pct": 75}}],
                "quiz_banks": [{"id": "b1", "title": "Buổi 1"}],
            }.get(name, [])

            class T:
                def select(self, cols="*", **_k): return _Q(rows, cols)
            return T()

    with patch.object(qs, "supabase_admin", _DB()), \
            patch.object(qs, "_bank_meta_or_404", lambda *_a, **_k: {"id": "b1", "title": "Buổi 1"}), \
            patch.object(qs, "_assignment_item_for",
                         lambda *_a, **_k: {"id": "i1", "assignment_id": "a1"}):
        return qs.course_answer_report(user_id="u1", bank_id="b1")


def test_a_student_who_has_not_passed_STILL_learns_which_axis_is_weak():
    """Bản trước khoá cả hai mức. Sai chiều: em chưa đạt mới là em cần biết
    mình yếu chỗ nào nhất, và tên trục không lộ đáp án nào."""
    d = _report(passed=False)
    assert d["locked"] is True and d["threshold"] == 75
    axes = {q["item_key"] for q in d["questions"]}
    assert axes == {"chia động từ", "mạo từ"}, "trục phải còn nguyên"
    assert d["totals"]["answered"] == 2 and d["totals"]["correct"] == 1


def test_the_locked_row_has_EXACTLY_three_keys():
    """Ghim TẬP KHOÁ, không ghim một danh sách cấm.

    Danh sách cấm chỉ chặn những tên đã biết: thêm một trường nhạy cảm mang tên
    mới ở đường đầy đủ là nó lọt qua mà chốt vẫn xanh (codex 06/08). Tập khoá
    chính xác thì mặc định là kín.
    """
    d = _report(passed=False)
    assert d["questions"], "không có câu nào thì chốt này không chứng minh gì"
    for q in d["questions"]:
        assert set(q) == {"item_key", "is_correct", "seconds"}, sorted(q)


def test_a_student_who_HAS_passed_gets_everything():
    d = _report(passed=True)
    assert not d.get("locked")
    q0 = next(q for q in d["questions"] if q["qid"] == "q0")
    assert q0["answer_text"] == "goes"
    assert q0["why_wrong"] == "thiếu -es"
    assert q0["explain"] == "ngôi thứ ba số ít"


def test_the_learner_report_uses_the_canonical_mastery_history():
    d = _report(passed=True)
    assert d["history"] == [{
        "number": 1,
        "phase": "run",
        "pct": 70.0,
        "at": "2026-08-06T01:10:00+00:00",
        "session_count": 1,
        "next_action": "retake",
    }]


def test_history_shape_does_not_expose_raw_session_ids():
    row = qs._course_attempt_history([{
        "phase": "retake", "pct": "80", "at": "now",
        "sessions": ["secret-session-id", "secret-session-id"],
        "next_action": "passed",
    }], 75)[0]
    assert row["session_count"] == 1
    assert "sessions" not in row


def test_a_read_failure_in_the_gate_still_hides_the_answers():
    """Cổng đọc hỏng thì mặc định là ĐÓNG mức hai, không phải mở.

    `_course_review_gate` cố ý fail-open để một em ĐÃ ĐẠT không bị chặn khỏi bài
    của chính mình vì một lượt đọc phụ trợ. Nhưng đó là quyết định về hàm ấy,
    còn ở đây phải nói rõ hậu quả: đọc hỏng ⇒ mở cả mức hai. Ghim nó để lần sau
    ai đổi chiều thì thấy ngay mình đang đổi cái gì (codex 06/08).
    """
    g = _gate(passed_at=None, boom=True)
    assert g is None, ("đây là hành vi ĐANG CÓ: đọc hỏng thì cho xem. "
                       "Đổi nó là đổi một đánh đổi có chủ ý, không phải sửa lỗi")


def test_the_BANK_payload_still_ships_every_mcq_answer():
    """LỖ ĐÃ BIẾT, ghim lại để nó không âm thầm biến mất khỏi trí nhớ.

    `/api/quiz/banks/{id}` gửi `select("*")`, nên `answer` + `explain` +
    `why_wrong` của mọi câu TRẮC NGHIỆM đã nằm trong tab Network từ lúc học viên
    mở bài — cái giá của việc chấm ngay tại trang để phản hồi từng câu.

    Nghĩa là cổng hai mức bỏ đi con đường TIỆN, không bỏ được con đường CÓ.
    Chốt này sẽ ĐỎ vào ngày ai đó chấm phía máy chủ và cắt đáp án khỏi payload —
    và đó là ngày nên sửa lại lời hứa trong chú thích, chứ không phải xoá chốt.
    """
    src = inspect.getsource(qs)
    i = src.index('if q.get("type") == "writing":')
    seg = src[i:i + 400]
    assert 'q["explain"] = None' in seg
    assert 'q["answer"] = None' in seg
    # …nhưng CHỈ cho câu tự luận. Câu trắc nghiệm đi nguyên.
    assert 'if q.get("type") == "writing":' in src, \
        "nếu điều kiện này đổi thì lời hứa ở `course_answer_report` phải đổi theo"
