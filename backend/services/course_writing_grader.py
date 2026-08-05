"""Chấm phần TỰ LUẬN của bài tập theo buổi — thuần NGỮ PHÁP + CHÍNH TẢ.

Việc của bộ này hẹp một cách cố ý: đọc câu học viên viết, sửa lỗi ngữ pháp và
lỗi chính tả, trả lại câu ĐÚNG. **Không nâng cấp câu.** Không đổi từ vựng cho
"hay hơn", không viết lại cho "tự nhiên hơn", không rút gọn, không bình luận về
văn phong.

Vì sao ranh giới ấy quan trọng đến mức phải nói ba lần trong prompt: học viên ở
Khoá 1 đang học ô S/V/O/C và ràng buộc cơ bản. Một bản sửa "hay hơn" trả về một
câu các em chưa học tới sẽ dạy sai trọng tâm buổi ấy, và tệ hơn — nó khiến một
câu ĐÚNG trông như câu sai. Câu đúng phải được trả lại NGUYÊN VĂN.

Model: `COURSE_WRITING_MODEL` (mặc định gemini-2.5-flash-lite — rẻ, và việc này
không cần suy luận sâu). Nhiệt độ 0: cùng một câu sai phải cho cùng một bản sửa,
vì hai học viên viết giống nhau mà nhận hai lời khác nhau là mất tin.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, Dict, List

import google.generativeai as genai

from config import settings

logger = logging.getLogger(__name__)

_TIMEOUT_SECONDS = 45.0
# Cả cụm 10 câu trong MỘT lượt gọi: rẻ hơn, và bản chấm nhất quán hơn so với
# mười lượt độc lập. Trần này chặn một bank soạn sai (200 câu tự luận) làm nổ
# ngữ cảnh — vượt trần thì chia mẻ.
_MAX_ITEMS_PER_CALL = 12
# Câu dài quá mức không phải bài tập viết câu — cắt để một lần dán cả bài luận
# không đốt hết ngữ cảnh của những câu còn lại.
_MAX_ANSWER_CHARS = 600

_PROMPT = """Bạn là bộ soát lỗi cho học viên tiếng Anh MỚI BẮT ĐẦU.

NHIỆM VỤ DUY NHẤT: sửa lỗi NGỮ PHÁP và lỗi CHÍNH TẢ trong câu học viên viết.

TUYỆT ĐỐI KHÔNG:
- KHÔNG nâng cấp câu, không làm câu "hay hơn" hay "tự nhiên hơn".
- KHÔNG thay từ vựng bằng từ đồng nghĩa cao cấp hơn.
- KHÔNG viết lại cấu trúc nếu cấu trúc đang dùng vốn ĐÚNG ngữ pháp.
- KHÔNG thêm hoặc bớt ý so với câu học viên viết.
- KHÔNG nhận xét về văn phong.

Câu đã ĐÚNG ngữ pháp và ĐÚNG chính tả thì trả lại NGUYÊN VĂN, issues rỗng —
kể cả khi bạn nghĩ có cách viết hay hơn.

Với mỗi câu, trả về:
- "corrected": câu sau khi sửa (hoặc nguyên văn nếu không có lỗi)
- "issues": danh sách lỗi, mỗi lỗi gồm
    "type": "grammar" hoặc "spelling"
    "before": phần sai (nguyên văn, ngắn)
    "after": phần đã sửa
    "note": MỘT câu tiếng Việt ngắn nói vì sao sai
- "ok": true nếu không có lỗi nào

Chỉ trả JSON đúng dạng: {"results":[{"qid":"…","corrected":"…","issues":[…],"ok":true}]}

Các câu cần soát:
"""


def _model():
    name = getattr(settings, "COURSE_WRITING_MODEL", None) or "gemini-2.5-flash-lite"
    return name, genai.GenerativeModel(
        model_name=name,
        generation_config=genai.types.GenerationConfig(
            response_mime_type="application/json",
            # 0, không phải 0.7: hai học viên viết giống nhau phải nhận cùng một
            # bản sửa. Đây là soát lỗi, không phải sáng tác.
            temperature=0.0,
            max_output_tokens=4096,
        ),
    )


def _strip_fences(text: str) -> str:
    t = (text or "").strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\s*", "", t)
        t = re.sub(r"\s*```$", "", t)
    return t.strip()


def _fallback(items: List[Dict[str, Any]], reason: str) -> List[Dict[str, Any]]:
    """Không chấm được thì NÓI RA, không trả `ok=True` giả.

    Trả `ok=True` khi model hỏng là nói với học viên "câu của em không có lỗi" —
    một lời khen bịa ra, và là thứ tệ nhất bộ này có thể làm.
    """
    return [{
        "qid":       it.get("qid"),
        "prompt":    it.get("prompt", ""),
        "answer":    it.get("answer", ""),
        "corrected": None,
        "issues":    [],
        "ok":        None,          # None = CHƯA CHẤM ĐƯỢC, khác hẳn False
        "error":     reason,
    } for it in items]


async def _grade_batch(batch: List[Dict[str, Any]]) -> tuple[List[Dict[str, Any]], str | None]:
    # Dựng client TRONG lớp bảo vệ: thiếu khoá API / tên model sai là lỗi cấu
    # hình, và nó phải thành một lời nhắn đọc được như mọi đường hỏng khác —
    # không phải một 500 nuốt mất lượt nộp DUY NHẤT của học viên.
    try:
        name, model = _model()
    except Exception as exc:  # noqa: BLE001
        logger.error("[course-writing] không dựng được client: %s", exc)
        return _fallback(batch, "Bộ chấm chưa sẵn sàng."), None

    payload = [{"qid": it["qid"],
                "de": (it.get("prompt") or "")[:400],
                "cau_hoc_vien_viet": (it.get("answer") or "")[:_MAX_ANSWER_CHARS]}
               for it in batch]
    prompt = _PROMPT + json.dumps(payload, ensure_ascii=False, indent=1)

    try:
        resp = await asyncio.wait_for(
            model.generate_content_async(prompt), timeout=_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        logger.error("[course-writing] model quá hạn %ss", _TIMEOUT_SECONDS)
        return _fallback(batch, "Bộ chấm không phản hồi kịp."), name
    except Exception as exc:  # noqa: BLE001
        # Lỗi thô của SDK ở lại log; học viên nhận một câu đọc được.
        logger.error("[course-writing] gọi model hỏng: %s", exc)
        return _fallback(batch, "Bộ chấm tạm thời không dùng được."), name

    try:
        data = json.loads(_strip_fences(resp.text))
        results = data.get("results") if isinstance(data, dict) else data
        by_qid = {r.get("qid"): r for r in (results or []) if isinstance(r, dict)}
    except Exception as exc:  # noqa: BLE001
        logger.error("[course-writing] không đọc được JSON: %s", exc)
        return _fallback(batch, "Bộ chấm trả về kết quả không đọc được."), name

    out: List[Dict[str, Any]] = []
    for it in batch:
        r = by_qid.get(it["qid"])
        if not r:
            # Thiếu MỘT câu không được kéo cả cụm xuống — nói riêng câu ấy.
            out.append(_fallback([it], "Bộ chấm bỏ sót câu này.")[0])
            continue
        issues = [x for x in (r.get("issues") or []) if isinstance(x, dict)]
        corrected = (r.get("corrected") or "").strip() or it.get("answer", "")
        out.append({
            "qid":       it["qid"],
            "prompt":    it.get("prompt", ""),
            "answer":    it.get("answer", ""),
            "corrected": corrected,
            "issues":    issues[:6],
            # `ok` suy từ ISSUES, không tin cờ `ok` của model: model hay trả
            # ok=true kèm một danh sách lỗi không rỗng, và khi hai thứ mâu
            # thuẫn thì danh sách lỗi mới là thứ học viên đọc.
            "ok":        len(issues) == 0,
        })
    return out, name


async def grade(items: List[Dict[str, Any]]) -> tuple[List[Dict[str, Any]], str | None]:
    """Chấm cả cụm câu tự luận. Trả (kết quả theo đúng thứ tự đầu vào, tên model).

    `items`: [{qid, prompt, answer}]. Không ném ra ngoài — mọi đường hỏng đều
    thành một dòng `ok=None` kèm lý do, vì lượt nộp này là DUY NHẤT và không
    được biến mất chỉ vì nhà cung cấp model chập.
    """
    if not items:
        return [], None
    out: List[Dict[str, Any]] = []
    model_name = None
    for i in range(0, len(items), _MAX_ITEMS_PER_CALL):
        part, model_name = await _grade_batch(items[i:i + _MAX_ITEMS_PER_CALL])
        out.extend(part)
    return out, model_name
