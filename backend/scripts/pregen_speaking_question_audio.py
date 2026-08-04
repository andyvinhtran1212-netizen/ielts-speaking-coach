"""Render bản đọc đề Speaking (Part 1 & Part 3) cho cả kho đề, bằng Kokoro.

    python -m scripts.pregen_speaking_question_audio --dry-run
    python -m scripts.pregen_speaking_question_audio --commit
    python -m scripts.pregen_speaking_question_audio --commit --topic-id <uuid>
    python -m scripts.pregen_speaking_question_audio --commit --part 1 --limit 20

VÌ SAO PHẢI CÓ. Part 1 và Part 3 được giao BẰNG AUDIO và học viên không được xem
chữ — nên `topic_questions.audio_url` không phải tiện ích mà là điều kiện để giao
được một câu. Backend từ chối giao câu chưa có audio, và script này là thứ tạo ra
nó.

CHẠY LẠI ĐƯỢC BAO NHIÊU LẦN CŨNG ĐƯỢC. Đường lưu trữ là băm của (câu đọc, giọng,
engine): chạy lại trên kho đã render sẽ bỏ qua toàn bộ, không tốn gì. Sửa lời một
câu thì chỉ câu đó đổi băm và được render lại.

MẶC ĐỊNH LÀ THỬ KHÔ. Ghi thật phải nêu `--commit`. Một lần chạy nhầm trên cả kho
là hàng trăm lệnh upload — không đắt, nhưng vẫn nên là một lựa chọn có ý thức.
"""

from __future__ import annotations

import argparse
import logging
import sys

from database import supabase_admin
from services import speaking_question_audio as sqa

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("pregen-speaking-audio")

_PAGE = 1000          # PostgREST caps an un-ranged select at this


def _all_rows(table: str, columns: str, apply_filters) -> list[dict]:
    """Đọc hết, từng trang. Ordered by id: an unordered range is not a stable
    window, so two pages could repeat or skip rows."""
    out: list[dict] = []
    start = 0
    while True:
        q = apply_filters(supabase_admin.table(table).select(columns).order("id"))
        rows = q.range(start, start + _PAGE - 1).execute().data or []
        out.extend(rows)
        if len(rows) < _PAGE:
            return out
        start += _PAGE


def _lesson_set_work(set_id: str | None, parts: list[int]) -> tuple[list[dict], int]:
    """Câu cần render trong KHO THEO BUỔI, kèm số bộ đề đã quét.

    Trả về cùng hình dạng với đường kho chung — mỗi câu mang sẵn `part` (vốn nằm
    ở BỘ ĐỀ, không nằm ở câu) và `_title` là chủ đề để đọc.

    `_title` có thể là None, và None ở đây KHÁC rỗng: nó bảo `build_script` bỏ
    hẳn lời dẫn "Let's talk about …". Bộ đề một buổi rải khắp nhiều chủ đề nên
    thường không có gì để nêu.
    """
    sets = {
        s["id"]: s for s in _all_rows(
            "speaking_lesson_sets", "id, title, part, is_active",
            lambda q: q.eq("id", set_id) if set_id else q.eq("is_active", True),
        )
    }
    sets = {k: v for k, v in sets.items() if v.get("part") in parts}
    if not sets:
        return [], 0

    rows = _all_rows(
        "speaking_lesson_set_questions",
        "id, set_id, order_num, question_text, topic_label, audio_url, is_active",
        lambda q: q.eq("is_active", True),
    )
    out = []
    for r in rows:
        s = sets.get(r["set_id"])
        if not s:
            continue
        out.append({**r, "part": s["part"], "_title": r.get("topic_label") or None})
    out.sort(key=lambda r: (r["set_id"], r.get("order_num") or 0))
    return out, len(sets)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--commit", action="store_true",
                    help="Ghi thật. Không có cờ này thì chỉ thử khô.")
    # Nhận --dry-run cho khớp thói quen, dù đó vốn là mặc định — gõ cờ ấy rồi bị
    # từ chối khiến người ta nghĩ script KHÔNG có chế độ thử.
    ap.add_argument("--dry-run", action="store_true",
                    help="Chỉ xem, không ghi (đây cũng là mặc định).")
    ap.add_argument("--topic-id", help="Chỉ một chủ đề.")
    ap.add_argument("--lesson-set", nargs="?", const="all", default=None,
                    help="Render KHO THEO BUỔI thay vì kho chung. "
                         "Nêu id để chỉ làm một bộ, bỏ trống để làm tất cả.")
    ap.add_argument("--part", type=int, choices=sqa.AUDIO_PARTS,
                    help="Chỉ một phần (mặc định: cả Part 1 và Part 3).")
    ap.add_argument("--limit", type=int, help="Dừng sau N câu — để thử giọng.")
    ap.add_argument("--regen", action="store_true",
                    help="Render lại cả câu ĐÃ có audio (đổi giọng/model).")
    args = ap.parse_args()

    if args.lesson_set:
        return _run_lesson_sets(args)

    topics = {
        t["id"]: t for t in _all_rows(
            "topics", "id, title, is_active",
            lambda q: q.eq("id", args.topic_id) if args.topic_id else q,
        )
    }
    if not topics:
        logger.error("Không tìm thấy chủ đề nào.")
        return 1

    parts = [args.part] if args.part else list(sqa.AUDIO_PARTS)
    questions = _all_rows(
        "topic_questions",
        "id, topic_id, part, question_text, audio_url, is_active",
        lambda q: q.in_("part", parts).eq("is_active", True),
    )
    # Filter by topic in Python: the topic list is already narrowed above, and an
    # `in.(...)` over hundreds of ids would overrun the request URL.
    questions = [q for q in questions if q["topic_id"] in topics]
    if not args.regen:
        questions = [q for q in questions if not (q.get("audio_url") or "").strip()]
    if args.limit:
        questions = questions[: args.limit]

    logger.info("Chủ đề: %d | câu cần render: %d | engine=%s giọng=%s",
                len(topics), len(questions), sqa.ENGINE, sqa.VOICE)
    if not questions:
        logger.info("Không có gì để làm — cả kho đã có bản đọc.")
        return 0

    if args.dry_run or not args.commit:
        logger.info("\n-- THỬ KHÔ, không ghi gì. Vài câu đọc mẫu: --")
        for q in questions[:5]:
            logger.info("  [P%s] %s", q["part"], sqa.build_script(
                part=q["part"], topic_title=topics[q["topic_id"]]["title"],
                question_text=q["question_text"]))
        logger.info("\nThêm --commit để render thật.")
        return 0

    return _render_loop(questions, "topic_questions",
                        lambda q: topics[q["topic_id"]]["title"])


def _render_loop(questions: list[dict], table: str, title_of) -> int:
    """Render rồi ghi con trỏ, cho MỘT bảng bất kỳ.

    Hai kho dùng chung vòng lặp này vì phần khó của nó không phải là render mà là
    cách chịu lỗi: một câu hỏng không được làm đổ cả mẻ, và audio phải nằm trong
    bucket TRƯỚC khi bảng trỏ tới nó. Chép vòng lặp này ra bản thứ hai nghĩa là
    sớm muộn một trong hai bản sẽ mất một trong hai tính chất đó.
    """
    done = skipped = failed = 0
    for i, q in enumerate(questions, 1):
        title = title_of(q)
        try:
            res = sqa.render_question_audio(q, title)
        except Exception as exc:                       # noqa: BLE001
            # Một câu hỏng không được làm đổ cả lượt chạy: kho có hàng trăm câu
            # và render lại từ đầu là lãng phí. Nêu tên câu để chạy bù riêng.
            failed += 1
            logger.warning("  LỖI câu %s (%s): %s", q["id"], title, exc)
            continue
        if res is None:
            continue
        if res["synthesized"]:
            done += 1
        else:
            skipped += 1
        try:
            supabase_admin.table(table).update({
                "audio_url":  res["audio_url"],
                "audio_path": res["audio_path"],
            }).eq("id", q["id"]).execute()
        except Exception as exc:                       # noqa: BLE001
            # Audio đã nằm trong bucket nhưng bảng chưa trỏ tới — chạy lại sẽ
            # thấy ô trống, bỏ qua bước render (băm trùng) và chỉ ghi lại con trỏ.
            failed += 1
            logger.warning("  Ghi con trỏ hỏng cho câu %s: %s", q["id"], exc)
            continue
        if i % 25 == 0:
            logger.info("  … %d/%d", i, len(questions))

    logger.info("\nXong: render mới %d | bỏ qua (đã có) %d | lỗi %d",
                done, skipped, failed)
    return 1 if failed else 0


def _run_lesson_sets(args) -> int:
    """Đường chạy cho KHO THEO BUỔI. Cùng vòng lặp render, khác nguồn và khác
    bảng ghi lại."""
    parts = [args.part] if args.part else list(sqa.AUDIO_PARTS)
    set_id = None if args.lesson_set == "all" else args.lesson_set
    questions, n_sets = _lesson_set_work(set_id, parts)
    if not n_sets:
        logger.error("Không tìm thấy bộ đề nào (còn bật, đúng Part %s).",
                     "/".join(map(str, parts)))
        return 1

    if not args.regen:
        questions = [q for q in questions if not (q.get("audio_url") or "").strip()]
    if args.limit:
        questions = questions[: args.limit]

    logger.info("Bộ đề: %d | câu cần render: %d | engine=%s giọng=%s",
                n_sets, len(questions), sqa.ENGINE, sqa.VOICE)
    if not questions:
        logger.info("Không có gì để làm — cả kho đã có bản đọc.")
        return 0

    if args.dry_run or not args.commit:
        logger.info("\n-- THỬ KHÔ, không ghi gì. Vài câu đọc mẫu: --")
        for q in questions[:5]:
            logger.info("  [P%s] %s", q["part"], sqa.build_script(
                part=q["part"], topic_title=q["_title"],
                question_text=q["question_text"]))
        logger.info("\nThêm --commit để render thật.")
        return 0

    return _render_loop(questions, "speaking_lesson_set_questions",
                        lambda q: q["_title"])


if __name__ == "__main__":
    sys.exit(main())
