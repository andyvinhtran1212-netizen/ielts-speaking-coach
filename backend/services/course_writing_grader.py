"""Chấm phần TỰ LUẬN của bài tập theo buổi — thuần NGỮ PHÁP + CHÍNH TẢ.

Việc của bộ này hẹp một cách cố ý: đọc câu học viên viết, sửa lỗi ngữ pháp và
lỗi chính tả, trả lại câu ĐÚNG. **Không nâng cấp câu.** Không đổi từ vựng cho
"hay hơn", không viết lại cho "tự nhiên hơn", không rút gọn, không bình luận về
văn phong.

Vì sao ranh giới ấy quan trọng đến mức phải nói ba lần trong prompt: học viên ở
Khoá 1 đang học ô S/V/O/C và ràng buộc cơ bản. Một bản sửa "hay hơn" trả về một
câu các em chưa học tới sẽ dạy sai trọng tâm buổi ấy, và tệ hơn — nó khiến một
câu ĐÚNG trông như câu sai. Câu đúng phải được trả lại NGUYÊN VĂN.

Lỗi HÌNH THỨC (viết hoa đầu câu, dấu chấm cuối câu, khoảng trắng thừa) vẫn được
báo nhưng KHÔNG tính vào ô đúng/sai — xem `_classify`. Đây là bài tập ngữ pháp;
một câu dựng đúng khung mà bị chấm sai vì chữ "t" thường ở đầu dòng thì con số
trả về nói sai về học viên.

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
# Sáu câu giữ response JSON cách xa trần output ngay cả khi mỗi câu có nhiều
# lỗi. Buổi 08 có 15 câu: bản cũ gom 12 câu vào mẻ đầu; response mẻ ấy không
# parse được nhưng mẻ 3 câu sau vẫn qua, tạo một bản chấm giả 3/15. Mẻ hỏng còn
# được chia nhỏ/chấm lại ở `grade`, nên con số này là giới hạn bình thường chứ
# không phải điểm lỗi duy nhất.
_MAX_ITEMS_PER_CALL = 6
_BATCH_PROVIDER_FAILURE = "provider"
_BATCH_RESPONSE_FAILURE = "response"
# Trần độ dài một câu. `quiz_service` TỪ CHỐI câu vượt trần trước khi tới đây —
# cắt rồi chấm phần đầu nghĩa là phần đuôi model chưa từng đọc sẽ hiện ra như bị
# xoá ở bản so sai→sửa. Lát cắt dưới đây chỉ còn là lưới an toàn cuối.
MAX_ANSWER_CHARS = 600   # công khai: tầng gọi TỪ CHỐI trước, không cắt âm thầm

_PROMPT = """Bạn là bộ soát lỗi cho học viên tiếng Anh MỚI BẮT ĐẦU.

NHIỆM VỤ DUY NHẤT: sửa lỗi NGỮ PHÁP và lỗi CHÍNH TẢ trong câu học viên viết.

TUYỆT ĐỐI KHÔNG:
- KHÔNG nâng cấp câu, không làm câu "hay hơn" hay "tự nhiên hơn".
- KHÔNG thay từ vựng bằng từ đồng nghĩa cao cấp hơn.
- KHÔNG viết lại cấu trúc nếu cấu trúc đang dùng vốn ĐÚNG ngữ pháp.
- KHÔNG thêm hoặc bớt ý so với câu học viên viết.
- KHÔNG nhận xét về văn phong.

`corrected` phải giữ NGUYÊN toàn bộ câu trả lời: đủ mọi dòng, kể cả dòng giải
thích bằng tiếng Việt. Chỉ sửa đúng phần tiếng Anh có lỗi. Không được trả riêng
câu tiếng Anh rồi làm mất dòng giải thích.

Câu đã ĐÚNG ngữ pháp và ĐÚNG chính tả thì trả lại NGUYÊN VĂN, issues rỗng —
kể cả khi bạn nghĩ có cách viết hay hơn.

Với mỗi câu, trả về:
- "corrected": câu sau khi sửa (hoặc nguyên văn nếu không có lỗi)
- "issues": danh sách lỗi, mỗi lỗi gồm
    "type": "grammar", "spelling", hoặc "mechanics"
           — "mechanics" là lỗi HÌNH THỨC: viết hoa đầu câu, đại từ I, thiếu
             dấu chấm cuối câu, thừa khoảng trắng. Vẫn phải báo, nhưng nó KHÔNG
             phải lỗi ngữ pháp và không làm câu bị tính là sai.
    "before": phần sai (nguyên văn, ngắn)
    "after": phần đã sửa
    "note": MỘT câu tiếng Việt ngắn nói vì sao sai
- "ok": true nếu không có lỗi nào

Chỉ trả JSON đúng dạng: {"results":[{"qid":"…","corrected":"…","issues":[…],"ok":true}]}

Các câu cần soát:
"""


def _model():
    # Mặc định THẬT nằm ở `config.py`; chuỗi dưới đây chỉ là lưới đỡ cho lúc
    # trường ấy vắng mặt. Giữ hai nơi cùng một giá trị — bản trước để lệch nhau
    # và bản vá vào chỗ này không bao giờ tới lượt (06/08).
    name = getattr(settings, "COURSE_WRITING_MODEL", None) or "gemini-3.1-flash-lite"
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
        "explain":   it.get("explain", ""),
        "answer":    it.get("answer", ""),
        "corrected": None,
        "issues":    [],
        "ok":        None,          # None = CHƯA CHẤM ĐƯỢC, khác hẳn False
        "error":     reason,
    } for it in items]


# Mã trạng thái KHÔNG tự khỏi. Phân loại theo STATUS, không theo chuỗi:
#   · 400 tên model sai · 401/403 khoá hoặc quyền sai · 404 model ngừng cấp
# Bản trước dò chuỗi "404" + "not found", nên gọi mọi 404 là model chết và gọi
# 401/403 là "tạm thời" — hai lỗi vĩnh viễn nằm chờ tự khỏi (codex 06/08).
_CONFIG_STATUS = {400, 401, 403, 404}


def _is_config_error(exc: Exception) -> bool:
    """Lỗi này sẽ lặp lại y hệt ở lần gọi sau chứ không tự khỏi.

    Ưu tiên `code` có cấu trúc của SDK Google; chỉ dò chuỗi khi không có, vì một
    câu lỗi đổi chữ là phép dò chuỗi im lặng ngừng hoạt động.
    """
    code = getattr(exc, "code", None)
    if isinstance(code, int):
        return code in _CONFIG_STATUS
    status = getattr(getattr(exc, "response", None), "status_code", None)
    if isinstance(status, int):
        return status in _CONFIG_STATUS
    head = str(exc)[:80]
    return any(str(c) in head for c in _CONFIG_STATUS)


# ── Lỗi HÌNH THỨC vs lỗi NGỮ PHÁP ────────────────────────────────────────────
#
# Em Lê Ngọc Hà Linh nộp 10 câu ngày 07/08 và nhận 0/10. Tám câu bị trừ vì viết
# thường đầu câu; NĂM trong số đó không có lỗi nào khác. Một em viết đúng cả
# khung SVOC mà đọc được con số "0" thì con số ấy nói sai về chính em ấy — và
# đây là bài tập NGỮ PHÁP, không phải bài tập gõ chữ hoa.
#
# Lỗi hình thức vẫn được BÁO (viết hoa đầu câu là thói quen phải sửa), chỉ là
# không tính vào ô đúng/sai.
MECHANICS = "mechanics"
_COUNTED_TYPES = {"grammar", "spelling"}

# ĐÚNG BA phép, không hơn — mỗi phép ứng với một thứ đã nêu tên ở trên là "hình
# thức": khoảng trắng, dấu KẾT CÂU, và hoa/thường.
#
# Bản đầu cắt sạch `[\W_]` rồi so. Rộng quá, và rộng đúng về phía nguy hiểm:
# `its`→`it's`, `students`→`student's`, `alot`→`a lot`, `in to`→`into` đều cho
# hai lõi giống hệt nhau, nên bốn lỗi CHÍNH TẢ/NGỮ PHÁP thật lọt vào nhóm
# không-tính-điểm và được ghi lại là câu đúng (codex #1000, P1). Dấu lược và
# ranh giới từ MANG NGHĨA; khoảng trắng thừa và dấu chấm cuối câu thì không.
_WS = re.compile(r"\s+")
# Dấu KẾT CÂU ở cuối. Cố ý KHÔNG có dấu phẩy: thiếu phẩy có thể là lỗi ngữ pháp
# thật (câu ghép dính), và chiều an toàn ở đây là TÍNH ĐIỂM.
_SENT_END = ".!?…"


def _presentation_only(before: Any, after: Any) -> bool:
    """Hai chuỗi này chỉ khác nhau ở cách TRÌNH BÀY?

    Khác nhau ở chữ, ở dấu lược, ở chỗ tách/dính từ ⇒ KHÔNG. Đó là những thứ
    đổi nghĩa hoặc đổi mặt chữ, tức là bài học viên sai thật.
    """
    a, b = str(before or ""), str(after or "")
    if a == b:
        return False                      # không có gì đổi
    # 1. Khoảng trắng: gộp dãy, bỏ hai đầu. `found  the` → `found the`.
    a, b = _WS.sub(" ", a).strip(), _WS.sub(" ", b).strip()
    # 2. Dấu kết câu ở CUỐI: `autumn` ↔ `autumn.`
    a, b = a.rstrip(_SENT_END).rstrip(), b.rstrip(_SENT_END).rstrip()
    # 3. Hoa/thường: `the` ↔ `The`, `i` ↔ `I`.
    return a.casefold() == b.casefold()


def _classify(issue: Dict[str, Any]) -> str:
    """Loại THẬT của một lỗi — suy từ chính cặp (before, after), không tin nhãn.

    Hai chiều đều phải chặn, và chỉ một phép so lo được cả hai:

      · model gắn nhãn "grammar" cho một chỗ chỉ khác mỗi chữ hoa (chuyện xảy ra
        THẬT: 8/10 câu của em Hà Linh) — ở đây thành `mechanics`;
      · model gắn nhãn "mechanics" cho một chỗ đổi hẳn từ (`make` → `makes`) và
        qua đó giấu một lỗi ngữ pháp thật khỏi ô đúng/sai — ở đây thành lỗi có
        tính điểm.

    Nhãn `mechanics` vì thế KHÔNG BAO GIỜ do model đặt; nó chỉ do phép so này
    đặt. Nhãn model tự khai chỉ còn dùng để phân biệt grammar với spelling.

    Không so được thì coi là lỗi CÓ TÍNH ĐIỂM: `before`/`after` cùng rỗng nghĩa
    là chỉ còn lời ghi chú, và đoán rằng một lời ghi chú không đọc được là lỗi
    hình thức sẽ âm thầm nâng điểm.
    """
    before, after = issue.get("before"), issue.get("after")
    declared = str(issue.get("type") or "").strip().lower()
    if (before or after) and _presentation_only(before, after):
        return MECHANICS
    return declared if declared in _COUNTED_TYPES else "grammar"


def _keeps_all_answer_lines(answer: Any, corrected: Any) -> bool:
    """Bản sửa không được làm biến mất cả một dòng học viên đã viết.

    Một số câu Buổi 08 yêu cầu ``câu đã sửa`` + ``lý do một dòng``. Model từng
    trả riêng câu tiếng Anh, bỏ sạch lý do tiếng Việt nhưng vẫn khai ``ok=true``.
    Không đoán nội dung lý do đúng/sai ở đây; chỉ chặn sự mất dữ liệu có thể
    chứng minh được từ hình dạng hai chuỗi.
    """
    before = [line for line in str(answer or "").splitlines() if line.strip()]
    after = [line for line in str(corrected or "").splitlines() if line.strip()]
    return len(after) >= len(before)


async def _grade_batch(
    batch: List[Dict[str, Any]],
) -> tuple[List[Dict[str, Any]], str | None, str | None]:
    # Dựng client TRONG lớp bảo vệ: thiếu khoá API / tên model sai là lỗi cấu
    # hình, và nó phải thành một lời nhắn đọc được như mọi đường hỏng khác —
    # không phải một 500 nuốt mất lượt nộp DUY NHẤT của học viên.
    try:
        name, model = _model()
    except Exception as exc:  # noqa: BLE001
        logger.error("[course-writing] không dựng được client: %s", exc)
        return (_fallback(batch, "Bộ chấm chưa sẵn sàng."), None,
                _BATCH_PROVIDER_FAILURE)

    payload = [{"qid": it["qid"],
                "de": (it.get("prompt") or "")[:400],
                "cau_hoc_vien_viet": (it.get("answer") or "")[:MAX_ANSWER_CHARS]}
               for it in batch]
    prompt = _PROMPT + json.dumps(payload, ensure_ascii=False, indent=1)

    try:
        resp = await asyncio.wait_for(
            model.generate_content_async(prompt), timeout=_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        logger.error("[course-writing] model quá hạn %ss", _TIMEOUT_SECONDS)
        return (_fallback(batch, "Bộ chấm không phản hồi kịp."), name,
                _BATCH_PROVIDER_FAILURE)
    except Exception as exc:  # noqa: BLE001
        # Lỗi thô của SDK ở lại log; học viên nhận một câu đọc được.
        #
        # PHÂN BIỆT HỎNG TẠM VỚI HỎNG HẲN. Model bị ngừng cấp trả 404 và sẽ trả
        # 404 mãi mãi — gọi nó là "tạm thời" khiến ai đọc log cũng đợi nó tự
        # khỏi, và bộ chấm nằm chết nhiều ngày. Đây đúng là chuyện đã xảy ra:
        # `gemini-2.5-flash-lite` ngừng cấp, em Lê Chinh mất lượt nộp duy nhất.
        if _is_config_error(exc):
            logger.error("[course-writing] HỎNG CẤU HÌNH (%s): %s — sửa "
                         "COURSE_WRITING_MODEL / khoá API, nó sẽ KHÔNG tự khỏi", name, exc)
            return (_fallback(batch, "Bộ chấm đang lỗi cấu hình, đã báo quản trị. "
                                     "Bài của em vẫn được lưu."), name,
                    _BATCH_PROVIDER_FAILURE)
        logger.error("[course-writing] gọi model hỏng: %s", exc)
        return (_fallback(batch, "Bộ chấm tạm thời không dùng được."), name,
                _BATCH_PROVIDER_FAILURE)

    try:
        data = json.loads(_strip_fences(resp.text))
        results = data.get("results") if isinstance(data, dict) else data
        by_qid = {r.get("qid"): r for r in (results or []) if isinstance(r, dict)}
    except Exception as exc:  # noqa: BLE001
        logger.error("[course-writing] không đọc được JSON: %s", exc)
        return (_fallback(batch, "Bộ chấm trả về kết quả không đọc được."), name,
                _BATCH_RESPONSE_FAILURE)

    out: List[Dict[str, Any]] = []
    failure_kind = None
    for it in batch:
        r = by_qid.get(it["qid"])
        if not r:
            # Thiếu MỘT câu không được kéo cả cụm xuống — nói riêng câu ấy.
            out.append(_fallback([it], "Bộ chấm bỏ sót câu này.")[0])
            failure_kind = _BATCH_RESPONSE_FAILURE
            continue
        issues = [{**x, "type": _classify(x)}
                  for x in (r.get("issues") or []) if isinstance(x, dict)][:6]
        corrected = (r.get("corrected") or "").strip() or it.get("answer", "")
        if not _keeps_all_answer_lines(it.get("answer"), corrected):
            logger.error("[course-writing] corrected làm mất dòng qid=%s", it["qid"])
            out.append(_fallback(
                [it], "Bộ chấm trả về kết quả không nhất quán.")[0])
            failure_kind = _BATCH_RESPONSE_FAILURE
            continue
        out.append({
            "qid":       it["qid"],
            "prompt":    it.get("prompt", ""),
            "explain":   it.get("explain", ""),
            "answer":    it.get("answer", ""),
            "corrected": corrected,
            "issues":    issues,
            # `ok` suy từ ISSUES, không tin cờ `ok` của model: model hay trả
            # ok=true kèm một danh sách lỗi không rỗng, và khi hai thứ mâu
            # thuẫn thì danh sách lỗi mới là thứ học viên đọc.
            #
            # Lỗi HÌNH THỨC không vào phép đếm này — xem `_classify`. Câu vẫn
            # hiện đủ lời nhắc, chỉ là ô đúng/sai nói về ngữ pháp, đúng thứ bài
            # tập này dạy.
            "ok":        not any(x["type"] in _COUNTED_TYPES for x in issues),
        })
    return out, name, failure_kind


async def grade(items: List[Dict[str, Any]]) -> tuple[List[Dict[str, Any]], str | None]:
    """Chấm cả cụm câu tự luận. Trả (kết quả theo đúng thứ tự đầu vào, tên model).

    `items`: [{qid, prompt, answer}]. Không ném ra ngoài — mọi đường hỏng đều
    thành một dòng `ok=None` kèm lý do, vì lượt nộp này là DUY NHẤT và không
    được biến mất chỉ vì nhà cung cấp model chập.
    """
    if not items:
        return [], None
    async def resilient(batch: List[Dict[str, Any]]):
        """Chỉ gọi lại những câu chưa đọc được; mẻ hỏng cả cụm thì chẻ đôi.

        Không lặp vô hạn: mẻ một câu là lá. Nếu lá vẫn hỏng, tầng nộp sẽ trả
        503 và giữ nguyên nháp thay vì ghi một kết quả một phần.
        """
        first, first_model, failure_kind = await _grade_batch(batch)
        failed = [item for item, result in zip(batch, first)
                  if result.get("ok") is None]
        # Timeout/429/5xx/config sẽ lặp lại cho mọi kích thước mẻ. Không chẻ
        # chúng xuống từng câu: một mẻ sáu câu có thể thành 11 lượt gọi tuần tự
        # và kéo endpoint gần chín phút. Chỉ response JSON hỏng/bỏ sót qid mới
        # có khả năng được cứu bằng mẻ nhỏ hơn.
        if (not failed or len(batch) == 1
                or failure_kind != _BATCH_RESPONSE_FAILURE):
            return first, first_model

        # Hỏng cả response thường là JSON bị cắt/hỏng: gọi lại nguyên mẻ có
        # cùng kích thước dễ tái tạo đúng lỗi. Chẻ đôi để response ngắn đi.
        if len(failed) == len(batch):
            mid = max(1, len(failed) // 2)
            groups = [failed[:mid], failed[mid:]]
        else:
            # Model chỉ bỏ sót vài qid: chấm lại đúng phần thiếu, không tốn tiền
            # và không làm thay đổi các câu đã có kết quả.
            groups = [failed]

        repaired: Dict[str, Dict[str, Any]] = {}
        model_name = first_model
        for group in groups:
            if not group:
                continue
            retried, retry_model = await resilient(group)
            model_name = retry_model or model_name
            repaired.update({str(row.get("qid")): row for row in retried})
        return ([repaired.get(str(row.get("qid")), row) for row in first],
                model_name)

    out: List[Dict[str, Any]] = []
    model_name = None
    for i in range(0, len(items), _MAX_ITEMS_PER_CALL):
        part, part_model = await resilient(items[i:i + _MAX_ITEMS_PER_CALL])
        model_name = part_model or model_name
        out.extend(part)
    return out, model_name
