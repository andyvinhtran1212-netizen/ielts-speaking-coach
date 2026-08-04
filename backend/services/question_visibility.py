"""services/question_visibility.py — chữ của câu hỏi được phép rời máy chủ hay không.

MỘT bộ lọc, dùng ở MỌI đường trả câu hỏi cho học viên.

Bài tập lớp Part 1 và Part 3 giao bằng audio: học viên phải NGHE mới biết đề hỏi
gì. Điều đó chỉ đúng nếu chữ KHÔNG BAO GIỜ đi xuống trình duyệt — ẩn bằng CSS,
hay gửi xuống rồi mong người ta không nhìn, đều vô nghĩa: mở devtools hoặc xem
tab Network là đọc được.

VÌ SAO LÀ MỘT MODULE RIÊNG, KHÔNG PHẢI MỘT HÀM TRONG ROUTER. Câu hỏi của một
phiên đi ra ngoài qua BA đường khác nhau — `GET /sessions/{id}` (trang gọi đầu
tiên), `GET /sessions/{id}/questions`, và đường trả nhanh của
`POST .../questions/generate` khi phiên đã có câu. Lọc ở một đường và quên hai
đường kia thì bộ lọc trông như đang chạy trong khi chữ vẫn lọt — đúng cái đã xảy
ra ở bản đầu.

Chấm điểm không bị ảnh hưởng: việc đó chạy ở backend, đọc thẳng từ bảng, không
đi qua đây.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List

# Những trường mang nội dung đề. `question_text` là hiển nhiên; ba trường còn
# lại cũng lộ đề — một cue card bullet hay một subtopic đủ để đoán ra câu hỏi.
_CONTENT_FIELDS = ("cue_card_bullets", "cue_card_reflection", "subtopic")


# Trạng thái phiên mà ở đó chữ được phép hiện lại.
_DONE = "completed"


def should_reveal(session: Dict[str, Any] | None) -> bool:
    """Phiên đã LÀM XONG thì hiện lại chữ.

    Giấu đề là để bắt học viên NGHE mới biết hỏi gì. Khi phiên đã hoàn thành,
    việc ấy đã xảy ra: sổ cái ghi lần nộp ĐẦU (`mark_item_submitted` luỹ đẳng),
    nên đọc lại đề không giúp làm lại được gì.

    Giấu tiếp thì trang kết quả và bản PDF hiện câu hỏi TRỐNG — người học không
    xem lại được mình đã trả lời câu nào, và bản chấm mất luôn ngữ cảnh.

    Một hàm DUY NHẤT cho luật này: nó áp ở bốn đường khác nhau (trang kết quả,
    danh sách câu, chi tiết phiên, xuất PDF) và bốn bản chép sẽ trôi khỏi nhau.
    """
    return bool(session) and (session.get("status") or "") == _DONE


def redact_question(q: Dict[str, Any]) -> Dict[str, Any]:
    """Bỏ chữ của MỘT câu hỏi nếu câu đó giao bằng audio."""
    if not q or not q.get("listen_only"):
        return q
    out = dict(q)
    # Đặt RỖNG chứ không xoá khoá: frontend đọc `question_text` ở nhiều chỗ, và
    # một khoá biến mất sẽ hiện ra màn hình thành "undefined".
    out["question_text"] = ""
    for k in _CONTENT_FIELDS:
        out.pop(k, None)
    return out


def redact_questions(rows: Iterable[Dict[str, Any]] | None,
                     *, reveal: bool = False) -> List[Dict[str, Any]]:
    """Bỏ chữ cho cả danh sách. `None` → `[]` để caller không phải kiểm lại.

    `reveal=True` (phiên đã hoàn thành — xem should_reveal) trả nguyên văn.
    Mặc định là GIẤU: caller quên truyền thì lỗi nghiêng về phía an toàn.
    """
    rows = list(rows or [])
    return rows if reveal else [redact_question(q) for q in rows]
