"""Route bài LẺ không được gửi đáp án xuống trình duyệt.

VÌ SAO CÓ TỆP NÀY

Sprint 13.5 đã dựng chốt cho `/tests/{id}` (`strip_answer_keys`), nhưng route bài
lẻ `GET /api/listening/exercises` vẫn trả `select("*")` nguyên vẹn. Ba trang
mcq / true_false / gist tự xoá đáp án Ở CLIENT ("user must NOT see it in DOM",
`listening-mcq.js:81`) nên trên màn hình không thấy gì — còn tab Network thì thấy
đủ `answer_idx`, `answer`, `model_answer`.

VÌ SAO GHIM Ở ĐƯỜNG CHỨ KHÔNG Ở HÀM

Bộ lọc đã có test riêng (`test_grader_strip_answer_keys_removes_payload_answers`)
và nó vẫn xanh suốt thời gian route này rò rỉ — vì không ai ghim CHỖ GỌI. Nên các
khẳng định dưới đây gọi qua đúng hàm route và soi THÂN RESPONSE.

VÌ SAO SOI ĐỆ QUY

Bộ lọc cũ chỉ xoá khoá mức đỉnh, nên đáp án vẫn được phục vụ đầy đủ ở một tầng
sâu hơn — chính chú thích trong `listening_test_grader.py` kể lại lần sập bẫy đó.
Quét theo tên khoá ở MỌI độ sâu thì một khoá lồng mới sinh ra sau này cũng không
lọt.
"""
import asyncio
from uuid import uuid4

import pytest

from routers import listening as listening_router
from tests.test_student_listening_full_test import _Fake, _patch, _run

# Mọi tên khoá KHÔNG được xuất hiện ở bất kỳ độ sâu nào của response học viên.
FORBIDDEN = ("answer_idx", "model_answer", "rubric_keywords", "answers", "solutions")


def _keys_deep(node, found=None):
    """Mọi tên khoá xuất hiện ở mọi độ sâu."""
    found = found if found is not None else set()
    if isinstance(node, dict):
        for k, v in node.items():
            found.add(k)
            _keys_deep(v, found)
    elif isinstance(node, list):
        for v in node:
            _keys_deep(v, found)
    return found


def _seed(fake, exercise_type, payload, segments=None):
    cid = str(uuid4())
    fake.tables["listening_content"].append({
        "id": cid, "status": "published", "audio_duration_seconds": 60,
        "audio_storage_path": "x/y.mp3", "title": "Bài kiểm rò rỉ",
    })
    row = {
        "id": str(uuid4()), "content_id": cid, "exercise_type": exercise_type,
        "status": "published", "order_num": 1, "payload": payload,
    }
    # `segments` là CỘT MỨC ĐỈNH của `listening_exercises` (mig 057), KHÔNG nằm
    # trong `payload`. Trang đọc `e.segments` (`listening-dictation.js:101,112`).
    if segments is not None:
        row["segments"] = segments
    fake.tables["listening_exercises"].append(row)
    return cid


CASES = {
    "mcq": {"questions": [
        {"idx": 0, "stem": "Câu 1?", "options": ["a", "b", "c", "d"], "answer_idx": 2},
    ]},
    "true_false": {"statements": [
        {"idx": 0, "text": "Câu khẳng định.", "answer": "NG"},
    ]},
    "gist": {
        "prompt_text": "Tóm tắt đi.",
        "model_answer": "ĐÂY LÀ ĐÁP ÁN",
        "rubric_keywords": ["meeting"],
    },
}


@pytest.mark.parametrize("etype", sorted(CASES))
def test_route_bai_le_khong_gui_dap_an(monkeypatch, etype):
    fake, authz = _patch(monkeypatch)
    cid = _seed(fake, etype, CASES[etype])

    res = _run(listening_router.get_listening_exercises(
        content_id=cid, exercise_type=etype, authorization=authz))

    # Chốt-của-chốt: seed phải tới được response, nếu không mọi khẳng định dưới
    # đây thành xanh-rỗng.
    assert len(res["exercises"]) == 1, res

    leaked = sorted(_keys_deep(res) & set(FORBIDDEN))
    assert leaked == [], (
        f"route bài lẻ ({etype}) gửi đáp án xuống trình duyệt: {leaked}. "
        f"Trang tự xoá ở client là KHÔNG đủ — tab Network vẫn đọc được."
    )
    # `statements[].answer` không nằm trong FORBIDDEN vì "answer" quá chung; kiểm
    # riêng đúng chỗ nó ở.
    for ex in res["exercises"]:
        for st in (ex["payload"].get("statements") or []):
            assert "answer" not in st, f"đáp án T/F còn trong statements: {st}"


@pytest.mark.parametrize("etype", sorted(CASES))
def test_van_giu_thu_trang_can_de_ve(monkeypatch, etype):
    """Chiều ngược: lọc quá tay là trang trắng. Ghim đúng những trường UI ĐỌC."""
    fake, authz = _patch(monkeypatch)
    cid = _seed(fake, etype, CASES[etype])
    res = _run(listening_router.get_listening_exercises(
        content_id=cid, exercise_type=etype, authorization=authz))
    payload = res["exercises"][0]["payload"]

    if etype == "mcq":         # `listening-mcq.js:82-83`
        q = payload["questions"][0]
        assert q["stem"] and q["idx"] == 0 and len(q["options"]) == 4
    elif etype == "true_false":  # `listening-tf.js:79-80`
        st = payload["statements"][0]
        assert st["text"] and st["idx"] == 0
    else:                       # `listening-gist.js:74`
        assert payload["prompt_text"]


def test_chep_chinh_ta_chi_giu_timing_khong_gui_transcript(monkeypatch):
    """Learner boot needs clip timing, never the reference transcript."""
    fake, authz = _patch(monkeypatch)
    cid = _seed(fake, "dictation", {"variant": "dictation_gap_fill"},
                segments=[{
                    "idx": 0, "start_sec": 1.5, "end_sec": 4.25,
                    "transcript": "ĐÂY LÀ ĐÁP ÁN",
                }])
    res = _run(listening_router.get_listening_exercises(
        content_id=cid, exercise_type="dictation", authorization=authz))
    assert res["exercises"][0]["segments"] == [{
        "idx": 0, "start_sec": 1.5, "end_sec": 4.25,
    }]


def _seed_dictation_with_key(fake):
    """Chép chính tả dạng điền-chỗ-trống: `segments` để chạy bài, `answers` là ĐÁP ÁN.

    Bộ chuyển đổi xếp `dictation_gap_fill` / `dictation_short_answer` vào
    `exercise_type="dictation"` rồi cất đáp án chuẩn ở `payload.answers`
    (`services/listening_convert.py:1471,1510`) — nên đây là hình dạng CÓ THẬT
    trên production, không phải ca tôi bịa ra cho dễ đỏ.
    """
    return _seed(fake, "dictation", {
        "variant": "dictation_gap_fill",
        "questions": [{"q_num": 1, "prompt": "___ họp"}],
        "answers": ["ĐÁP ÁN CHUẨN"],
    }, segments=[{"idx": 0, "transcript": "giữ nguyên"}])


def test_route_boot_chep_chinh_ta_khong_gui_dap_an(monkeypatch):
    """Lỗ tôi BỎ SÓT ở lượt vá đầu: tôi xem route boot rồi kết luận "chép chính
    tả cần transcript nên không lọc được" — chỉ nghĩ tới `segments[].transcript`
    mà quên `payload.answers`, vốn là khoá mức đỉnh bộ lọc đã xoá sẵn từ Sprint
    13.5. Một lượt rà nửa vời trông y hệt một lượt rà đủ (codex cục bộ #967)."""
    fake, authz = _patch(monkeypatch)
    cid = _seed_dictation_with_key(fake)

    res = _run(listening_router.boot_listening_dictation(
        content_id=cid, authorization=authz))

    assert len(res["exercises"]) == 1, res
    leaked = sorted(_keys_deep(res["exercises"]) & set(FORBIDDEN))
    assert leaked == [], f"route boot gửi đáp án xuống trình duyệt: {leaked}"


def test_route_boot_giu_segment_identity_nhung_khong_gui_transcript(monkeypatch):
    """Boot preserves the iterator contract without exposing answer text."""
    fake, authz = _patch(monkeypatch)
    cid = _seed_dictation_with_key(fake)
    res = _run(listening_router.boot_listening_dictation(
        content_id=cid, authorization=authz))
    segs = res["exercises"][0]["segments"]
    assert segs and segs[0]["idx"] == 0
    assert "transcript" not in segs[0]


@pytest.mark.parametrize("bad", [None, "chuỗi json hợp lệ", 42, ["mảng"], True])
def test_payload_di_dang_khong_lam_sap_endpoint(monkeypatch, bad):
    """Cột khai `JSONB NOT NULL` nhưng KHÔNG ràng buộc phải là object
    (`migrations/056_listening_module_foundation.sql:133`), nên một chuỗi/số/mảng
    JSON hợp lệ từng làm `dict(...)` ném lỗi. Trước đây vô hại vì chỉ route
    full-test gọi tới; nay route bài lẻ cũng gọi nên nó sẽ thành 500."""
    fake, authz = _patch(monkeypatch)
    cid = _seed(fake, "mcq", bad)
    res = _run(listening_router.get_listening_exercises(
        content_id=cid, exercise_type="mcq", authorization=authz))
    # Đóng an toàn: dòng hỏng trả payload rỗng, không ném lỗi, không lộ gì.
    assert res["exercises"][0]["payload"] == {}
