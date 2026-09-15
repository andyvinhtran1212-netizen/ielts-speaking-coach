"""Import one five-option, quiz-only Course assessment bank.

Example (dry-run by default)::

    python -m scripts.import_course_assessment_bank \
      --file MIDTERM-B01-B11_120.json --course C1 \
      --code C1-MIDTERM-B01-B11-120 --title "Giữa kỳ B01–B11 · 120 câu" \
      --kind midterm --expected-count 120

Add ``--commit`` only after the dry-run passes.  Course banks stay private and
become available through a class assignment; ``is_published`` never opens them.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from services.course_assessment_import import normalize_assessment_rows, source_sha256


logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("import-course-assessment")


def _course(db, code: str) -> dict:
    rows = (db.table("courses").select("id, code, name")
            .eq("code", code).limit(1).execute().data) or []
    if not rows:
        raise SystemExit(f"Không có khoá nào mã {code!r}.")
    return rows[0]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", required=True)
    parser.add_argument("--course", required=True)
    parser.add_argument("--code", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--kind", choices=("midterm", "post_midterm_practice"), required=True)
    parser.add_argument("--expected-count", type=int, required=True)
    parser.add_argument("--commit", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    path = Path(args.file)
    if not path.is_file():
        raise SystemExit(f"Không thấy tệp {path}.")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        rows = normalize_assessment_rows(raw, expected_count=args.expected_count)
    except (json.JSONDecodeError, ValueError) as exc:
        raise SystemExit(str(exc)) from exc

    logger.info("Bank: %s · %s · %d câu trắc nghiệm × 5 đáp án",
                args.code, args.title, len(rows))
    by_lesson: dict[str, int] = {}
    for source in raw:
        lesson = str(source.get("lesson_primary") or "?")
        by_lesson[lesson] = by_lesson.get(lesson, 0) + 1
    logger.info("Phủ bài: %s", ", ".join(
        f"{key}×{value}" for key, value in sorted(by_lesson.items())))
    logger.info("Section phụ: 0 · audio bắt buộc: 0")
    if not args.commit or args.dry_run:
        logger.info("THỬ KHÔ PASS. Thêm --commit để ghi thật.")
        return 0

    # Keep database initialisation out of dry-run: content validation must be
    # usable offline and must not need production credentials.
    from database import supabase_admin

    course = _course(supabase_admin, args.course)
    logger.info("Khoá: %s — %s", course["code"], course["name"])
    existing = (supabase_admin.table("quiz_banks").select("id, code")
                .eq("course_id", course["id"]).eq("code", args.code)
                .limit(1).execute().data) or []
    payload = {
        "code": args.code,
        "title": args.title,
        "skill_area": "course",
        "course_id": course["id"],
        "lesson_no": None,
        "words_count": len(rows),
        "source": f"course-{course['code']}-assessment-json",
        "is_published": False,
        "meta": {
            "nguon": path.name,
            "assessment_kind": args.kind,
            "scope": "B01-B11",
            "question_format": "multiple_choice_5",
            "option_count": 5,
            "expected_question_count": args.expected_count,
            "sections": ["quiz"],
            "source_sha256": source_sha256(raw),
        },
    }
    if existing:
        bank_id = existing[0]["id"]
        supabase_admin.table("quiz_banks").update(payload).eq("id", bank_id).execute()
        logger.info("Bank đã có → cập nhật %s.", bank_id)
    else:
        inserted = supabase_admin.table("quiz_banks").insert(payload).execute().data or []
        if not inserted:
            raise SystemExit("Tạo bank không trả về id.")
        bank_id = inserted[0]["id"]
        logger.info("Đã tạo bank %s.", bank_id)

    try:
        written = supabase_admin.rpc(
            "quiz_replace_questions", {"p_bank_id": bank_id, "p_rows": rows},
        ).execute().data
    except Exception as exc:  # noqa: BLE001
        logger.error("Ghi câu hỏi hỏng; bank vẫn private: %s", exc)
        return 1
    logger.info("Đã ghi %s câu; bank private và sẵn sàng để admin giao.", written)
    return 0


if __name__ == "__main__":
    sys.exit(main())
