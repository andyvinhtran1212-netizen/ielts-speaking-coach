"""Gắn nhãn độ khó (easy / medium / hard) cho câu hỏi Speaking trong kho đề.

    python -m scripts.label_speaking_question_levels --dry-run
    python -m scripts.label_speaking_question_levels --commit
    python -m scripts.label_speaking_question_levels --commit --relabel

VÌ SAO CẦN. `question_type` sẵn có (personal / opinion / comparison / …) tả KIỂU
hỏi, không phải ĐỘ KHÓ — nên nó không trả lời được câu "cho tôi một bộ đề trải
đều dễ đến khó". Cột `level` (mig 182) trả lời câu đó.

CĂN CỨ ÁNH XẠ — không phải ước lượng cảm tính. Trong IELTS Speaking, độ khó của
một câu hỏi là MỨC ĐÒI HỎI TƯ DUY nó đặt ra, và `question_type` đã ghi đúng thứ
đó:

    easy    personal, place, time
            Nhớ lại một sự việc về chính mình. Thì hiện tại đơn / quá khứ đơn,
            câu trả lời có sẵn trong đầu.
            "Where do you usually see advertisements?"

    medium  opinion
            Nêu ý kiến KÈM lý do. Cần mệnh đề nguyên nhân, từ nối, và một chút
            tự tổ chức ý.
            "Do you think advertisements influence what people buy?"

    hard    comparison, prediction, cause_effect, solution
            Đối chiếu, dự đoán, hoặc lập luận nhân-quả. Cần thì phức, thể giả
            định, và cấu trúc so sánh.
            "Do you think advertisements today are more effective than in the past?"

ĐÂY LÀ LƯỢT ĐẦU, KHÔNG PHẢI PHÁN QUYẾT. Ánh xạ theo kiểu hỏi đúng cho phần lớn
câu, nhưng một câu `personal` hỏi về một trải nghiệm hiếm vẫn có thể khó hơn một
câu `opinion` quen thuộc. Script CHỈ gắn cho câu chưa có nhãn (trừ khi
`--relabel`), nên admin sửa tay một câu thì lần chạy sau không ghi đè.

Mặc định là thử khô. Ghi thật phải nêu `--commit`.
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections import Counter

from database import supabase_admin

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("label-levels")

# Kiểu hỏi → độ khó. Xem phần CĂN CỨ trong docstring.
LEVEL_OF_TYPE = {
    "personal":     "easy",
    "place":        "easy",
    "time":         "easy",
    "opinion":      "medium",
    "comparison":   "hard",
    "prediction":   "hard",
    "cause_effect": "hard",
    "solution":     "hard",
}

# Part 2 là cue card: một tấm thẻ, không có nhiều câu để trải đều dễ–khó, nên
# gắn nhãn cho nó không phục vụ việc gì.
SKIP_TYPES = {"cuecard"}

_PAGE = 1000


def _all_questions() -> list[dict]:
    out: list[dict] = []
    start = 0
    while True:
        rows = (
            supabase_admin.table("topic_questions")
            .select("id, part, question_type, level, question_text")
            .order("id").range(start, start + _PAGE - 1).execute().data
        ) or []
        out.extend(rows)
        if len(rows) < _PAGE:
            return out
        start += _PAGE


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--commit", action="store_true", help="Ghi thật.")
    # Nhận --dry-run cho khớp thói quen, dù đó vốn là mặc định: gõ nhầm một cờ
    # rồi bị từ chối là chuyện nhỏ, nhưng gõ --dry-run và bị từ chối khiến người
    # ta nghĩ script này KHÔNG có chế độ thử.
    ap.add_argument("--dry-run", action="store_true",
                    help="Chỉ xem, không ghi (đây cũng là mặc định).")
    ap.add_argument("--relabel", action="store_true",
                    help="Ghi đè cả câu ĐÃ có nhãn (xoá cả sửa tay của admin).")
    args = ap.parse_args()

    rows = _all_questions()
    todo, skipped, unknown = [], 0, Counter()
    for q in rows:
        qtype = (q.get("question_type") or "").strip()
        if qtype in SKIP_TYPES:
            skipped += 1
            continue
        level = LEVEL_OF_TYPE.get(qtype)
        if not level:
            # Kiểu hỏi lạ: ĐẾM và nêu tên, đừng đoán bừa một mức. Đoán sai sẽ
            # trộn vào bộ đề "trải đều" một câu không đúng chỗ, và không ai biết.
            unknown[qtype or "(rỗng)"] += 1
            continue
        if q.get("level") and not args.relabel:
            skipped += 1
            continue
        todo.append((q, level))

    logger.info("Tổng câu: %d | cần gắn: %d | bỏ qua: %d", len(rows), len(todo), skipped)
    if unknown:
        logger.warning("Kiểu hỏi chưa có trong bảng ánh xạ (KHÔNG gắn): %s",
                       dict(unknown))

    spread = Counter(lvl for _q, lvl in todo)
    logger.info("Phân bố sẽ gắn: %s", dict(spread))
    by_part = Counter((q["part"], lvl) for q, lvl in todo)
    for (part, lvl), n in sorted(by_part.items()):
        logger.info("  Part %s · %-6s %d", part, lvl, n)

    if args.dry_run or not args.commit:
        logger.info("\n-- THỬ KHÔ. Vài ví dụ: --")
        for q, lvl in todo[:6]:
            logger.info("  [%s] P%s %s", lvl, q["part"], (q["question_text"] or "")[:64])
        logger.info("\nThêm --commit để ghi thật.")
        return 0

    done = failed = 0
    for q, lvl in todo:
        try:
            supabase_admin.table("topic_questions").update({"level": lvl}) \
                .eq("id", q["id"]).execute()
            done += 1
        except Exception as exc:                       # noqa: BLE001
            # Một câu hỏng không được làm đổ cả lượt: kho có hàng trăm câu và
            # chạy lại từ đầu là lãng phí. Nêu id để chạy bù.
            failed += 1
            logger.warning("  LỖI câu %s: %s", q["id"], exc)

    logger.info("\nXong: gắn %d | lỗi %d", done, failed)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
