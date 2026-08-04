"""services/speaking_flags.py — bài Speaking nào cần người xem lại.

MỘT bộ luật, dùng cho CẢ hai loại bài (hằng ngày và sau buổi học). Hai loại chỉ
khác nhau ở nguồn đề và cách đặt hạn; còn "bài này có vấn đề không" thì không có
lý do gì để trả lời khác nhau.

VÌ SAO TÁCH LÀM HAI HỌ, KHÔNG TRỘN. Một bài bị gắn cờ có thể vì hai chuyện hoàn
toàn khác nhau, và admin làm hai việc khác nhau:

  · BÀI HỎNG (kỹ thuật) — bản ghi không dùng được, chấm hỏng, quá ngắn. Việc cần
    làm là chấm lại hoặc bảo em ấy ghi lại. Điểm số ở đây KHÔNG nói gì về trình
    độ.
  · HỌC VIÊN ĐANG ĐUỐI (sư phạm) — điểm tụt so với chính em ấy, bỏ bài liên tiếp.
    Việc cần làm là nhắn cho em, không phải sửa dữ liệu.

Gộp cả hai vào một danh sách "cần xem lại" sẽ khiến admin đọc xong không biết
phải làm gì — và cái nào nhiều hơn sẽ chôn cái kia.

NGƯỠNG ĐO TRÊN DỮ LIỆU THẬT, không phải cảm tính (prod 04/08/2026, 6.219 bài):

    grading_status='failed'      53 bài  (0,8%)
    score_confidence='low'       44 bài  (0,7%) — band trung bình 3.13 so với
                                 5.98 của nhóm 'high'
    duration < 10 giây           37 bài  — phân vị 1 là 14,4s, nên mốc này nằm
                                 DƯỚI 1% ngắn nhất
    trung vị độ dài              43,4 giây

Nghĩa là cờ này HIẾM và CÓ NGHĨA. Một danh sách cảnh báo mà tuần nào cũng đầy
thì tuần sau không ai mở nữa.

KHÔNG SUY RA TỪ DỮ LIỆU ĐÃ BỊ XOÁ. `transcript` bị dọn ở mốc 60 ngày
(jobs/retention_sweep.py), nên với bài cũ nó là None. None ở đây là KHÔNG BIẾT,
không phải "không có tiếng" — gắn cờ theo nó sẽ biến mọi bài cũ thành đáng ngờ.
"""

from __future__ import annotations

from statistics import median
from typing import Any, Dict, List, Optional

# Dưới mốc này thì câu trả lời quá ngắn để chấm có nghĩa. Cùng con số mà
# `_compute_score_confidence` trong routers/grading.py đang dùng — một luật, một
# số. Đo lại trên prod: nằm dưới phân vị 1 của độ dài (14,4 giây).
MIN_ANSWER_SECONDS = 10.0

# Bản chép ngắn hơn thế này thì gần như không có tiếng nói nào. Một câu trả lời
# thật ngắn nhất trong kho cũng dài hơn nhiều.
MIN_TRANSCRIPT_CHARS = 15

# Tụt bao nhiêu band so với CHÍNH MÌNH thì đáng nhìn. 1.0 là một bậc thang thật
# trong IELTS; 0.5 nằm trong khoảng dao động bình thường giữa hai bài.
BAND_DROP = 1.0

# Cần ít nhất chừng này bài cũ mới nói được "so với chính em ấy". Ít hơn thì
# trung vị chỉ là một con số ngẫu nhiên.
BAND_HISTORY_MIN = 3

# Bỏ/trễ bao nhiêu lần trong bao nhiêu bài gần nhất thì đáng nhắn.
MISS_WINDOW = 5
MISS_COUNT = 2

# Thứ tự nghiêm trọng, để sắp xếp. Không dùng số trần trong mã.
_RANK = {"high": 0, "medium": 1}


def _flag(code: str, severity: str, label: str, why: str, action: str) -> Dict[str, Any]:
    """Một cờ luôn mang ĐỦ ba thứ: chuyện gì, vì sao, và làm gì tiếp.

    Cờ chỉ tô đỏ mà không nói việc phải làm sẽ bị bỏ qua sau vài lần — người ta
    không mở một danh sách mà mình không hành động được.
    """
    return {"code": code, "severity": severity, "label": label,
            "why": why, "action": action}


def flag_response(r: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Cờ KỸ THUẬT cho một câu trả lời. Rỗng nghĩa là không có gì bất thường."""
    out: List[Dict[str, Any]] = []

    # 1. Chấm hỏng. Nặng nhất, và cũng là thứ duy nhất ở đây KHÔNG phải lỗi của
    #    học viên — em ấy đã nộp bài mà hệ thống không trả được điểm.
    status = (r.get("grading_status") or "").strip()
    if status == "failed" or (r.get("submitted") and r.get("overall_band") is None):
        out.append(_flag(
            "grading_failed", "high", "Chưa chấm được",
            "Học viên đã nộp nhưng hệ thống không trả được điểm.",
            "Chấm lại bài này. Nếu vẫn hỏng, nghe thử bản ghi xem có tải lên đủ không."))
        # Không gắn thêm cờ chất lượng: chưa có điểm thì mọi phán đoán về chất
        # lượng đều dựa trên số không tồn tại.
        return out

    # 2. Bản ghi không đủ rõ để tin điểm.
    if (r.get("score_confidence") or "") == "low":
        out.append(_flag(
            "low_confidence", "high", "Điểm không đáng tin",
            "Bản chép lời không rõ hoặc phát âm quá khó nghe, nên điểm chấm ra "
            "có thể lệch nhiều.",
            "Nghe lại bản ghi trước khi dùng điểm này để đánh giá em ấy."))

    # 3. Quá ngắn. Đứng riêng vì nó nói về THỨ EM ẤY LÀM, không phải về chất
    #    lượng bản ghi — và cách xử lý khác hẳn.
    dur = r.get("duration_seconds")
    if dur is not None and dur < MIN_ANSWER_SECONDS:
        out.append(_flag(
            "too_short", "medium", "Trả lời quá ngắn",
            f"Chỉ {int(dur)} giây — ngắn hơn 99% bài trong kho.",
            "Nhắc em ấy nói đủ ý; câu quá ngắn thì bộ chấm không có gì để chấm."))

    # 4. Gần như không có tiếng. CHỈ xét khi còn bản chép: sau mốc 60 ngày cột
    #    này bị dọn, và None là KHÔNG BIẾT chứ không phải "không có tiếng".
    tr = r.get("transcript")
    if tr is not None and len(tr.strip()) < MIN_TRANSCRIPT_CHARS:
        out.append(_flag(
            "no_speech", "high", "Gần như không có tiếng",
            "Bản ghi có gửi lên nhưng gần như không nghe ra lời nào.",
            "Nghe thử bản ghi. Thường là micro hỏng hoặc ghi nhầm trong im lặng."))

    return out


def flag_student(*, submitted_bands: List[float],
                 recent_states: List[str]) -> List[Dict[str, Any]]:
    """Cờ SƯ PHẠM cho một học viên, suy từ chính lịch sử của em ấy.

    `submitted_bands` theo thứ tự thời gian (cũ → mới). `recent_states` là trạng
    thái của những bài gần nhất theo thứ tự ấy: 'submitted' | 'late' | 'missing'.

    So với CHÍNH EM ẤY chứ không so với lớp: một em band 5.0 ổn định không có
    vấn đề gì, còn một em từ 7.0 tụt xuống 6.0 thì có — dù em thứ hai vẫn cao
    hơn. Xếp hạng trong lớp trả lời một câu hỏi khác.
    """
    out: List[Dict[str, Any]] = []

    if len(submitted_bands) >= BAND_HISTORY_MIN + 1:
        *before, latest = submitted_bands
        base = median(before)
        drop = base - latest
        if drop >= BAND_DROP:
            out.append(_flag(
                "band_drop", "high", "Điểm tụt so với chính em ấy",
                f"Bài mới nhất {latest:.1f}, trong khi {len(before)} bài trước "
                f"trung vị {base:.1f} — tụt {drop:.1f} band.",
                "Xem bài mới nhất trước: nếu bản ghi vẫn tốt thì đây là chuyện "
                "học, không phải chuyện kỹ thuật."))

    window = recent_states[-MISS_WINDOW:]
    missed = sum(1 for s in window if s in ("missing", "late"))
    if missed >= MISS_COUNT:
        out.append(_flag(
            "falling_behind", "medium", "Nộp trễ hoặc bỏ bài",
            f"{missed}/{len(window)} bài gần nhất bị trễ hạn hoặc không nộp.",
            "Nhắn cho em ấy — bỏ bài liên tiếp thường là dấu hiệu sớm của bỏ học."))

    return out


def worst(flags: List[Dict[str, Any]]) -> Optional[str]:
    """Mức nghiêm trọng cao nhất trong danh sách, hoặc None nếu sạch.

    Dùng để sắp xếp và tô màu ở một chỗ: mỗi nơi hiển thị tự nghĩ ra thứ tự
    riêng sẽ cho hai bảng nói khác nhau về cùng một học viên.
    """
    if not flags:
        return None
    return min((f.get("severity") for f in flags),
               key=lambda s: _RANK.get(s, len(_RANK)))
