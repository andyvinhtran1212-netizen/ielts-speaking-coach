"""services/speaking_progress.py — rút bản tóm BỀN từ một câu trả lời đã chấm.

`jobs/retention_sweep.py` dọn `transcript`, `feedback` và `pronunciation_payload`
ở mốc 60 ngày. Sau đó, thứ còn lại về một học viên là MỘT CON SỐ: thấy được em ấy
tụt từ 5.5 xuống 5.0, nhưng không còn cách nào biết vì sao.

Module này rút ra phần trả lời được câu "vì sao", ở dạng vài trăm byte, rồi ghi
sang một bảng mà cơ chế dọn không đụng tới (mig 185).

MỌI HÀM Ở ĐÂY LÀ HÀM THUẦN. Chúng nhận một dict và trả một dict — không đọc DB,
không ghi DB. Việc ấy khiến chúng kiểm được bằng dữ liệu thật mà không cần mạng,
và khiến cùng một luật dùng được cho CẢ đường chấm-trực-tiếp lẫn đường chạy-bù.

DỮ LIỆU THIẾU KHÔNG PHẢI DỮ LIỆU XẤU. Bài cũ có thể đã mất bản chép hoặc chưa
từng có đánh giá phát âm. Khi ấy trường tương ứng là None/rỗng — KHÔNG phải 0.
Ghi 0 sẽ kéo mọi phép trung bình xuống và bịa ra một xu hướng không có thật.
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

# Bao nhiêu âm vị / từ / nhãn lỗi thì đủ. Mục đích là thấy cái LẶP LẠI qua nhiều
# bài, không phải dựng lại toàn bộ bản đánh giá — giữ nhiều hơn chỉ làm bảng to
# ra mà không trả lời thêm câu hỏi nào.
TOP_N = 5

# Dưới mốc này thì Azure coi là phát âm sai rõ rệt. Không phải một ngưỡng tôi tự
# đặt: đây là mức mà `ErrorType` của chính Azure bắt đầu báo "Mispronunciation".
WEAK_PHONEME_SCORE = 60.0

_WORD = re.compile(r"[A-Za-z']+")


def _payload(raw: Any) -> Optional[Dict[str, Any]]:
    """Bóc `pronunciation_payload` ra dict.

    Trên prod cột này là một CHUỖI JSON nằm trong jsonb (4.696/4.696 dòng có
    `jsonb_typeof = 'string'`), chứ không phải một object. Đọc thẳng như dict sẽ
    im lặng không lấy được gì — và bảng tiến bộ sẽ trống ở đúng cột quan trọng
    nhất mà không có lỗi nào.
    """
    if raw is None:
        return None
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, (str, bytes)):
        try:
            out = json.loads(raw)
        except (ValueError, TypeError):
            return None
        return out if isinstance(out, dict) else None
    return None


def words_per_minute(transcript: Optional[str],
                     duration_seconds: Optional[float]) -> Optional[float]:
    """Tốc độ nói. None khi không tính được — KHÔNG phải 0.

    Đây là chỉ dấu trôi chảy mà một điểm band gộp lại không cho thấy: hai em cùng
    6.0 có thể một em nói đều, một em nói vội rồi tắc.

    Bài dưới 3 giây thì con số này vô nghĩa (một từ trong 2 giây thành 30 wpm),
    nên trả None thay vì một số gây hiểu nhầm.
    """
    if not transcript or not duration_seconds or duration_seconds < 3.0:
        return None
    n = len(_WORD.findall(transcript))
    if not n:
        return None
    return round(n / (duration_seconds / 60.0), 1)


def _nbest_words(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    nbest = payload.get("NBest") or []
    if not isinstance(nbest, list) or not nbest:
        return []
    first = nbest[0] if isinstance(nbest[0], dict) else {}
    words = first.get("Words") or []
    return [w for w in words if isinstance(w, dict)]


def weak_phonemes(payload_raw: Any, top_n: int = TOP_N) -> List[str]:
    """Âm vị bị chấm thấp nhất, tính TRUNG BÌNH qua mọi lần xuất hiện.

    Trung bình chứ không phải lần tệ nhất: một âm bị chấm 30 điểm đúng MỘT lần
    thường là lỗi nhận dạng, còn một âm đều đặn 55 điểm qua hai mươi lần là điều
    cần dạy lại. Bảng này sinh ra để thấy cái LẶP LẠI.
    """
    payload = _payload(payload_raw)
    if not payload:
        return []
    totals: Dict[str, List[float]] = {}
    for w in _nbest_words(payload):
        for ph in (w.get("Phonemes") or []):
            if not isinstance(ph, dict):
                continue
            name = (ph.get("Phoneme") or "").strip()
            score = ph.get("AccuracyScore")
            if not name or not isinstance(score, (int, float)):
                continue
            totals.setdefault(name, []).append(float(score))
    weak = [(n, sum(v) / len(v)) for n, v in totals.items()
            if sum(v) / len(v) < WEAK_PHONEME_SCORE]
    weak.sort(key=lambda t: (t[1], t[0]))
    return [n for n, _ in weak[:top_n]]


def mispronounced_words(payload_raw: Any, top_n: int = TOP_N) -> List[str]:
    """Từ mà Azure gắn nhãn lỗi phát âm, tệ nhất trước.

    Dùng `ErrorType` của Azure chứ không tự đặt ngưỡng trên `AccuracyScore`: đó
    là phán quyết của chính bộ chấm, và tự dựng một luật thứ hai sẽ cho ra danh
    sách khác với thứ học viên nhìn thấy trong bản đánh giá.
    """
    payload = _payload(payload_raw)
    if not payload:
        return []
    bad = []
    for w in _nbest_words(payload):
        err = (w.get("ErrorType") or "").strip()
        if err in ("", "None"):
            continue
        word = (w.get("Word") or "").strip()
        if not word:
            continue
        score = w.get("AccuracyScore")
        bad.append((word.lower(), float(score) if isinstance(score, (int, float)) else 100.0))
    bad.sort(key=lambda t: (t[1], t[0]))
    # Bỏ trùng, GIỮ thứ tự tệ-nhất-trước.
    seen, out = set(), []
    for word, _ in bad:
        if word in seen:
            continue
        seen.add(word)
        out.append(word)
        if len(out) >= top_n:
            break
    return out


def grammar_tags(recommendations: List[Dict[str, Any]], top_n: int = TOP_N) -> List[str]:
    """Nhãn lỗi ngữ pháp của câu này, từ `grammar_recommendations`.

    Dùng `recommended_slug` chứ không phải `grammar_issue`: slug là một danh mục
    ĐÓNG (nó phải trỏ tới một bài Grammar Wiki có thật), còn `grammar_issue` là
    câu chữ do mô hình sinh ra — hai lần chấm cùng một lỗi có thể ra hai chuỗi
    khác nhau, và khi ấy không đếm được cái gì lặp lại.
    """
    seen, out = set(), []
    for r in recommendations or []:
        slug = (r.get("recommended_slug") or "").strip()
        if not slug or slug in seen:
            continue
        seen.add(slug)
        out.append(slug)
        if len(out) >= top_n:
            break
    return out


def build_mark(*, response: Dict[str, Any], session: Dict[str, Any],
               recommendations: Optional[List[Dict[str, Any]]] = None,
               part: Optional[int] = None) -> Optional[Dict[str, Any]]:
    """Một dấu mốc từ một câu trả lời ĐÃ CHẤM, hoặc None nếu chưa chấm xong.

    Chưa có điểm thì chưa có gì để ghi vào sổ tiến bộ: một dấu mốc không điểm sẽ
    được đếm như một lần luyện tập trong khi nó là một lần chấm hỏng.
    """
    band = response.get("overall_band")
    if band is None:
        return None

    transcript = response.get("transcript")
    dur = response.get("duration_seconds")
    return {
        "response_id": response["id"],
        "session_id":  response.get("session_id") or session.get("id"),
        "user_id":     session.get("user_id"),
        "class_assignment_item_id": session.get("class_assignment_item_id"),
        "recorded_at": response.get("recorded_at") or session.get("started_at"),
        "part":        part if part is not None else session.get("part"),
        "band":        band,
        "band_p":      response.get("final_band_p"),
        "duration_seconds": dur,
        "words_per_minute": words_per_minute(transcript, dur),
        "weak_phonemes":       weak_phonemes(response.get("pronunciation_payload")),
        "mispronounced_words": mispronounced_words(response.get("pronunciation_payload")),
        "grammar_tags":        grammar_tags(recommendations or []),
        "score_confidence":    response.get("score_confidence"),
    }
