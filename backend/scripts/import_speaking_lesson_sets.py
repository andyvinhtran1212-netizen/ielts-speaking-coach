"""Nạp một bộ đề Speaking theo buổi từ tệp JSON vào kho.

    python -m scripts.import_speaking_lesson_sets --file content/speaking_lessons/c3_lesson01_part1.json
    python -m scripts.import_speaking_lesson_sets --file <...> --commit

MẶC ĐỊNH LÀ THỬ KHÔ. Ghi thật phải nêu `--commit`.

CHẠY LẠI ĐƯỢC. Bộ đề nhận diện bằng (khoá, buổi, part) — đúng khoá của chỉ mục
duy nhất trong mig 183 — nên nạp lại tệp đã sửa sẽ CẬP NHẬT bộ cũ chứ không tạo
bản thứ hai.

CÂU BỊ BỎ KHỎI TỆP THÌ BỊ TẮT, KHÔNG BỊ XOÁ. Một câu đã được giao cho lớp nào đó
mà biến mất khỏi bảng sẽ làm hỏng bản chụp đề của bài giao ấy. Tắt (`is_active =
false`) giữ được lịch sử mà vẫn không cho giao tiếp.

KHÔNG RENDER AUDIO. Việc đó là của `pregen_speaking_question_audio.py`, chạy
riêng sau khi nội dung đã chốt — trộn hai việc vào một lệnh nghĩa là mỗi lần sửa
một dấu phẩy lại phải chờ cả mẻ audio.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from database import supabase_admin
from scripts.label_speaking_question_levels import LEVEL_OF_TYPE

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("import-lesson-sets")

# Những khoá chỉ để chú thích trong tệp, không phải dữ liệu.
_COMMENT_KEYS = {"_note"}

_QUESTION_FIELDS = (
    "order_num", "question_text", "question_type", "topic_label", "level",
    "cue_card_bullets", "cue_card_reflection",
)

# Những trường ĐI VÀO CÂU ĐỌC. Sửa một trong hai là bản đọc cũ đang nói một đề
# khác ⇒ phải xoá con trỏ audio. (`part` cũng đi vào câu đọc nhưng nằm ở BỘ ĐỀ,
# xử lý riêng trong `_sync_questions`.)
_SCRIPT_FIELDS = ("question_text", "topic_label")

# Bản sao của CHECK trong mig 183. Để DB bắt nghĩa là bắt ở GIỮA vòng ghi.
_LEVELS = {"easy", "medium", "hard"}
_PARTS = {1, 2, 3}


def _load(path: Path) -> dict:
    doc = json.loads(path.read_text(encoding="utf-8"))
    for k in _COMMENT_KEYS:
        doc.pop(k, None)
    missing = [k for k in ("course_code", "lesson_no", "part", "title", "questions")
               if not doc.get(k)]
    if missing:
        raise SystemExit(f"Tệp thiếu trường bắt buộc: {', '.join(missing)}")
    return doc


def _resolve_course(code: str) -> dict:
    rows = (supabase_admin.table("courses").select("id, code, name")
            .eq("code", code).limit(1).execute().data) or []
    if not rows:
        raise SystemExit(f"Không có khoá nào mã {code!r}.")
    return rows[0]


def _normalise_questions(doc: dict) -> list[dict]:
    """Kiểm tệp TRƯỚC khi ghi bất cứ thứ gì.

    Một tệp hỏng nửa chừng sẽ để lại bộ đề thiếu câu mà vẫn giao được — tệ hơn
    hẳn so với việc từ chối ngay từ đầu.
    """
    if int(doc["part"]) not in _PARTS:
        raise SystemExit(f"part phải là một trong {sorted(_PARTS)}, tệp ghi {doc['part']!r}.")
    if int(doc["lesson_no"]) < 1:
        raise SystemExit(f"lesson_no phải ≥ 1, tệp ghi {doc['lesson_no']!r}.")

    out, seen = [], set()
    for i, q in enumerate(doc["questions"], 1):
        text = (q.get("question_text") or "").strip()
        if not text:
            raise SystemExit(f"Câu thứ {i} không có nội dung.")
        order = q.get("order_num") or i
        # `order_num >= 1` là một CHECK trong mig 183. Để DB bắt nó nghĩa là bắt
        # ở GIỮA vòng ghi, khi bộ đề và vài câu đầu đã nằm trong bảng — còn lại
        # một bộ `is_active` thiếu câu mà vẫn giao được.
        if not isinstance(order, int) or order < 1:
            raise SystemExit(f"Câu thứ {i} có order_num không hợp lệ: {order!r} (phải là số ≥ 1).")
        if order in seen:
            raise SystemExit(f"order_num {order} bị dùng hai lần.")
        seen.add(order)
        qtype = (q.get("question_type") or "").strip() or None
        # `level` suy ra từ kiểu hỏi bằng ĐÚNG bảng ánh xạ mà kho chung dùng —
        # chép một bảng thứ hai vào đây là hẹn ngày hai kho chấm độ khó khác nhau.
        level = q.get("level") or (LEVEL_OF_TYPE.get(qtype) if qtype else None)
        if level is not None and level not in _LEVELS:
            raise SystemExit(
                f"Câu thứ {i} có level không hợp lệ: {level!r} "
                f"(chỉ nhận {sorted(_LEVELS)}).")
        row = {
            "order_num":     order,
            "question_text": text,
            "question_type": qtype,
            "topic_label":   (q.get("topic_label") or "").strip() or None,
            "level":         level,
            "cue_card_bullets":    q.get("cue_card_bullets"),
            "cue_card_reflection": q.get("cue_card_reflection"),
        }
        out.append(row)
    out.sort(key=lambda r: r["order_num"])
    return out


def _upsert_set(course: dict, doc: dict, commit: bool) -> str | None:
    """Nhận diện bộ đề bằng (khoá, buổi, part) — đúng khoá của chỉ mục duy nhất
    trong mig 183, nên chạy lại tệp đã sửa sẽ CẬP NHẬT chứ không tạo bản thứ hai.

    Đổi `part` trong tệp = một bộ đề KHÁC theo chỉ mục ấy, nên nó tạo bộ mới thay
    vì sửa bộ cũ. Nói vậy để rõ: `part_changed` trong `_sync_questions` lo trường
    hợp bộ cũ bị sửa part bằng tay ở nơi khác, không phải trường hợp này.
    """
    key = {"course_id": course["id"], "lesson_no": int(doc["lesson_no"]),
           "part": int(doc["part"])}
    existing = (supabase_admin.table("speaking_lesson_sets").select("id, title, part")
                .eq("course_id", key["course_id"])
                .eq("lesson_no", key["lesson_no"])
                .eq("part", key["part"]).limit(1).execute().data) or []
    payload = {**key, "title": doc["title"],
               "description": doc.get("description"), "is_active": True}
    if existing:
        logger.info("Bộ đề đã có → cập nhật: %s", existing[0]["title"])
        if not commit:
            return existing[0]["id"]
        supabase_admin.table("speaking_lesson_sets").update(payload) \
            .eq("id", existing[0]["id"]).execute()
        return existing[0]["id"]
    logger.info("Tạo bộ đề mới: %s", doc["title"])
    if not commit:
        return None
    return supabase_admin.table("speaking_lesson_sets") \
        .insert(payload).execute().data[0]["id"]


def _sync_questions(set_id: str, rows: list[dict], commit: bool) -> tuple[int, int, int]:
    """Trả về (thêm, cập nhật, tắt).

    So SÁNH ĐỦ MỌI TRƯỜNG, không chỉ lời câu hỏi. Bản đầu chỉ so `question_text`,
    nên thêm `topic_label` cho một câu đã có audio sẽ bị bỏ qua trong im lặng —
    script báo "không cập nhật gì" trong khi tệp đã đổi thật.

    Nhưng chỉ XOÁ AUDIO khi thứ đi vào CÂU ĐỌC đổi (`question_text` hoặc
    `topic_label`). Sửa `level` hay `question_type` không đụng tới lời đọc, nên
    xoá audio ở đó là bắt render lại cả bộ vì một cái nhãn — tốn tiền và làm mồ
    côi file cũ trong Storage.

    `part` cũng đi vào câu đọc nhưng KHÔNG cần xét ở đây: nó nằm trong khoá nhận
    diện bộ đề, nên đổi part trong tệp tạo ra một bộ MỚI chứ không sửa bộ cũ.
    Trường hợp còn lại — ai đó sửa `part` thẳng trong DB — thuộc về chốt đối
    chiếu băm lúc GIAO BÀI (như `_audio_matches` của kho chung), không thuộc về
    bộ nạp.
    """
    live = (supabase_admin.table("speaking_lesson_set_questions")
            .select("id, order_num, question_text, question_type, topic_label, "
                    "level, cue_card_bullets, cue_card_reflection, "
                    "audio_url, audio_path, is_active")
            .eq("set_id", set_id).execute().data) or []
    by_order = {r["order_num"]: r for r in live if r.get("is_active")}

    added = updated = disabled = 0
    for row in rows:
        cur = by_order.pop(row["order_num"], None)
        if cur is None:
            added += 1
            if commit:
                supabase_admin.table("speaking_lesson_set_questions") \
                    .insert({**row, "set_id": set_id}).execute()
            continue

        diff = [f for f in _QUESTION_FIELDS if cur.get(f) != row.get(f)]
        if not diff:
            continue
        updated += 1
        payload = dict(row)
        if any(f in _SCRIPT_FIELDS for f in diff):
            # Bản đọc cũ đang nói một đề KHÁC. Xoá con trỏ ngay tại đây để mẻ
            # render sau nhận ra và làm lại — giữ nó nghĩa là học viên nghe một
            # đằng còn bộ chấm đọc một nẻo, và không ai nhìn ra.
            payload["audio_url"] = None
            payload["audio_path"] = None
        if commit:
            supabase_admin.table("speaking_lesson_set_questions") \
                .update(payload).eq("id", cur["id"]).execute()

    for leftover in by_order.values():
        disabled += 1
        if commit:
            supabase_admin.table("speaking_lesson_set_questions") \
                .update({"is_active": False}).eq("id", leftover["id"]).execute()
    return added, updated, disabled


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--file", required=True, help="Đường dẫn tệp JSON bộ đề.")
    ap.add_argument("--commit", action="store_true", help="Ghi thật.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Chỉ xem (đây cũng là mặc định).")
    args = ap.parse_args()

    doc = _load(Path(args.file))
    course = _resolve_course(doc["course_code"])
    rows = _normalise_questions(doc)
    commit = args.commit and not args.dry_run

    logger.info("Khoá: %s — %s", course["code"], course["name"])
    logger.info("Buổi %s · Part %s · %d câu", doc["lesson_no"], doc["part"], len(rows))

    set_id = _upsert_set(course, doc, commit)
    if set_id is None:
        logger.info("\n-- THỬ KHÔ. Các câu sẽ nạp: --")
        for r in rows:
            logger.info("  %2d. [%-6s] %s", r["order_num"], r["level"] or "?",
                        r["question_text"])
        logger.info("\nThêm --commit để ghi thật.")
        return 0

    added, updated, disabled = _sync_questions(set_id, rows, commit)
    verb = "Đã" if commit else "Sẽ"
    logger.info("%s thêm %d · cập nhật %d · tắt %d", verb, added, updated, disabled)
    if not commit:
        logger.info("\nTHỬ KHÔ — chưa ghi gì. Thêm --commit để ghi thật.")
        return 0
    logger.info("Xong. Bước tiếp: render audio bằng "
                "`python -m scripts.pregen_speaking_question_audio --lesson-set %s --commit`",
                set_id)
    return 0


if __name__ == "__main__":
    sys.exit(main())
