"""Mặt học viên của Reading không được gửi đáp án xuống trình duyệt.

VÌ SAO CÓ TỆP NÀY

Listening từng rò rỉ đúng lớp này (#967): route bài lẻ trả `select("*")` nên
`answer_idx`/`answer`/`model_answer` đi thẳng tới trình duyệt, và ba trang tự xoá
Ở CLIENT nên trên màn hình không thấy gì. Lượt rà Reading cho kết quả NGƯỢC LẠI:
đường Reading hiện đang SẠCH — schema cố ý tách `answer` ra CỘT RIÊNG (mig
086:171-186, chú thích ngay tại chỗ dẫn `strip_answer_keys` làm tiền lệ), cả ba
mặt học viên đều select tường minh KHÔNG có `answer`/`explanation`, và đều gọi
`_strip_solution_from_payload`.

Nhưng "sạch nhờ quy ước" không phải "sạch có bảo đảm": không chốt nào ghim, nên
một lần đổi `select` cho tiện là rò rỉ ngay mà mọi cổng vẫn xanh — đúng cách
Listening đã rò rỉ. Tệp này biến quy ước thành bảo đảm.

BỘ GIẢ PHẢI TÔN TRỌNG PHÉP CHIẾU. Ở Reading, chính DANH SÁCH CỘT là lớp phòng
thủ. Một bộ giả bỏ qua `.select(...)` — như bộ đang dùng cho Listening, nơi mọi
truy vấn đều `select("*")` nên vô hại — sẽ mù với đúng thứ tệp này định canh:
đổi `select` thành `"*"` mà test vẫn xanh.
"""
import asyncio

import pytest

from routers import reading_student as R

# Tên trường KHÔNG được xuất hiện ở BẤT KỲ độ sâu nào trong response học viên.
FORBIDDEN = ("answer", "answers", "alternatives", "explanation", "solution",
             "answer_key", "correct", "is_correct")

PASSAGE_ID = "11111111-1111-4111-8111-111111111111"
TEST_ROW_ID = "22222222-2222-4222-8222-222222222222"


def _keys_deep(node, found=None):
    found = found if found is not None else set()
    if isinstance(node, dict):
        for k, v in node.items():
            found.add(k)
            _keys_deep(v, found)
    elif isinstance(node, list):
        for v in node:
            _keys_deep(v, found)
    return found


# ── Bộ giả có TÔN TRỌNG phép chiếu ───────────────────────────────────────────

class _Q:
    def __init__(self, rows):
        self._rows = rows
        self._cols = None

    def select(self, cols="*", *a, **k):
        self._cols = None if cols.strip() == "*" else [
            c.strip() for c in cols.split(",") if c.strip()]
        return self

    # Bộ lọc không ảnh hưởng câu hỏi tệp này đặt ra — dữ liệu đã gieo đúng một bộ.
    def eq(self, *a, **k): return self
    def in_(self, *a, **k): return self
    def neq(self, *a, **k): return self
    def order(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def range(self, *a, **k): return self

    def execute(self):
        if self._cols is None:
            data = [dict(r) for r in self._rows]
        else:
            data = [{c: r[c] for c in self._cols if c in r} for r in self._rows]
        return type("Res", (), {"data": data})()


class _Fake:
    def __init__(self, tables): self.tables = tables
    def table(self, name): return _Q(self.tables.get(name, []))


def _question_row(q_num=1):
    """Một câu hỏi ĐẦY ĐỦ như trên production: đáp án ở cột riêng, và lời giải
    chi tiết nằm trong `payload.solution` (hình dạng có thật — lượt quét
    2026-08-07 thấy 1936/3165 câu mang khoá này, kèm `solution.solution_steps[]
    .microcheck.answer` lồng ba tầng)."""
    return {
        "id": f"q-{q_num}",
        "q_num": q_num,
        "question_type": "true_false_not_given",
        "prompt": "Câu hỏi?",
        "payload": {
            "options": [{"label": "A", "text": "Đúng"}],
            "solution": {
                "steps": ["bước 1"],
                "source_excerpt": "ĐÂY LÀ CHỖ CÓ ĐÁP ÁN",
                "solution_steps": [{"microcheck": {"answer": "TRUE", "prompt": "?"}}],
            },
        },
        "answer": {"answer": "TRUE", "alternatives": ["T"]},
        "explanation": "Vì đoạn 2 nói …",
        "skill_tag": "tfng",
        "sub_skill": "x",
        "order_num": q_num,
        "passage_id": PASSAGE_ID,
    }


def _patch(monkeypatch, tables):
    monkeypatch.setattr(R, "supabase_admin", _Fake(tables))

    async def _auth(_a=None, *args, **kw):
        return {"id": "user-1"}
    monkeypatch.setattr(R, "_require_auth", _auth)
    monkeypatch.setattr(R, "_fetch_published_passage",
                        lambda slug, lib: {"id": PASSAGE_ID, "slug": slug, "title": "T",
                                           "body_markdown": "nội dung"})


def _run(c): return asyncio.run(c)


# ── Ba mặt học viên ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("fn_name", ["get_vocab_passage", "get_skill_exercise"])
def test_mat_luyen_tap_khong_gui_dap_an(monkeypatch, fn_name):
    _patch(monkeypatch, {"reading_questions": [_question_row(1), _question_row(2)]})
    res = _run(getattr(R, fn_name)("slug-x", authorization="Bearer x"))

    assert len(res["questions"]) == 2, res          # seed phải tới được response
    assert res["questions"][0]["prompt"], "mất luôn nội dung câu hỏi?"

    leaked = sorted(_keys_deep(res["questions"]) & set(FORBIDDEN))
    assert leaked == [], (
        f"{fn_name} gửi đáp án xuống trình duyệt: {leaked}. Cột `answer`/"
        f"`explanation` phải nằm ngoài `select`, và `payload.solution` phải bị lọc."
    )


def test_de_l3_khong_gui_dap_an(monkeypatch):
    _patch(monkeypatch, {
        "reading_passages": [{"id": PASSAGE_ID, "slug": "p1", "title": "P1",
                              "body_markdown": "nội dung", "passage_order": 1,
                              "word_count": 10, "estimated_minutes": 1,
                              "topic_tags": []}],
        "reading_questions": [_question_row(1), _question_row(2)],
    })
    detail = R._assemble_test_detail({"id": TEST_ROW_ID, "test_id": "T1",
                                      "metadata": {"gì đó": 1}})

    assert len(detail["questions"]) == 2 and len(detail["passages"]) == 1, detail
    assert detail["passages"][0]["body_markdown"], "mất luôn bài đọc?"

    leaked = sorted(_keys_deep(detail) & set(FORBIDDEN))
    assert leaked == [], f"đề L3 gửi đáp án xuống trình duyệt: {leaked}"


def test_van_giu_thu_trang_can_de_ve(monkeypatch):
    """Chiều ngược: lọc quá tay là trang trắng. Ghim đúng trường UI ĐỌC
    (`reading-exam.js:1109-1197`, `:493-499`)."""
    _patch(monkeypatch, {
        "reading_passages": [{"id": PASSAGE_ID, "slug": "p1", "title": "P1",
                              "body_markdown": "nội dung", "passage_order": 1,
                              "word_count": 10, "estimated_minutes": 1,
                              "topic_tags": []}],
        "reading_questions": [_question_row(1)],
    })
    detail = R._assemble_test_detail({"id": TEST_ROW_ID, "test_id": "T1", "metadata": {}})
    q = detail["questions"][0]
    for key in ("q_num", "question_type", "prompt", "payload", "passage_order"):
        assert key in q, f"thiếu «{key}» — trang sẽ không vẽ được câu hỏi"
    assert q["payload"]["options"], "mất luôn lựa chọn trả lời"
