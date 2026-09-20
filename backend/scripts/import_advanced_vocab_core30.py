#!/usr/bin/env python3
"""Validate or import all 30 assignment-only Advanced Vocabulary banks.

Dry-run is the default. Add ``--commit`` only after the Advanced Vocabulary
migration set (281, 282, and 287–293) is applied.
The import is idempotent for unchanged content. A content revision is rejected
once an assignment references that bank so its frozen lesson checksum cannot be
orphaned; revised lessons require a separately versioned bank/content release.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from services.advanced_vocab_service import (  # noqa: E402
    build_quiz_rows,
    controlled_rewrite_parts,
    load_lesson,
)
from services.advanced_vocab_package_validator import lesson_content_checksum  # noqa: E402

LESSON_IDS = tuple(f"ADV-T{number:02d}" for number in range(1, 31))


def _admin():
    """Initialize Supabase only for ``--commit`` operations."""
    from database import supabase_admin

    return supabase_admin


def _checksum(lesson: dict) -> str:
    declared = str((lesson.get("provenance") or {}).get("content_checksum") or "")
    actual = lesson_content_checksum(lesson)
    if declared != actual:
        raise SystemExit(
            f"{lesson.get('lesson_id')}: nội dung không khớp content_checksum."
        )
    return actual


def lesson_spec(lesson_id: str, *, course_id: str | None = None) -> dict:
    lesson = load_lesson(lesson_id)
    rows = build_quiz_rows(lesson)
    activities = {row["activity_type"]: row for row in lesson["activities"]}
    reading = activities["reading_lab"]
    listening = activities["listening_lab"]
    checksum = _checksum(lesson)
    number = int(lesson_id[-2:])
    return {
        "lesson": lesson,
        "rows": rows,
        "checksum": checksum,
        "summary": {
            "lesson_id": lesson_id,
            "title": lesson["title"],
            "vocabulary": len(lesson["vocabulary"]),
            "practice": len(rows),
            "reading": len(reading["content"]["questions"]),
            "listening": len(listening["content"]["questions"]),
        },
        "payload": {
            "code": f"C5-{lesson_id}",
            "title": f"Advanced Vocabulary T{number:02d} — {lesson['title']}",
            "skill_area": "course",
            "course_id": course_id,
            # Advanced Vocabulary is supplementary content, not the class's
            # canonical numbered lesson. Keeping this NULL avoids the unique
            # (course_id, lesson_no) slot owned by the scheduled C5 bank.
            "lesson_no": None,
            "words_count": len(lesson["vocabulary"]),
            "source": "advanced-vocab-core30-v6-t11-map-locked",
            "version": 1,
            # Course banks are opened by an assignment, never public listing.
            "is_published": False,
            "meta": {
                "runtime": {
                    "kind": "advanced_vocab",
                    "contract_version": 1,
                    "lesson_id": lesson_id,
                    "content_checksum": checksum,
                    "practice_question_ids": [row["qid"] for row in rows],
                    "completion_policy": "required_interactions",
                    "required_stages": [
                        "vocabulary", "practice_1", "practice_2", "reading",
                        "controlled_rewrite", "listening",
                    ],
                    "score_policy": "none",
                    "writing_submittable": False,
                    "speaking_graded_by_default": False,
                },
            },
        },
    }


def _validate_spec(spec: dict) -> None:
    lesson = spec["lesson"]
    activities = {row["activity_type"]: row for row in lesson["activities"]}
    if len(lesson.get("vocabulary") or []) != 24:
        raise SystemExit(f"{lesson['lesson_id']}: cần đúng 24 từ.")
    if not all(str(word.get("common_error") or "").strip()
               for word in lesson["vocabulary"]):
        raise SystemExit(f"{lesson['lesson_id']}: có từ thiếu common_error.")
    if activities["writing_reference"].get("submittable") is not False:
        raise SystemExit(f"{lesson['lesson_id']}: Writing phải là reference-only.")
    if activities["writing_reference"].get("grading_policy") != "none":
        raise SystemExit(f"{lesson['lesson_id']}: Writing không được chấm mặc định.")
    if activities["speaking_practice"].get("graded_by_default") is not False:
        raise SystemExit(f"{lesson['lesson_id']}: Speaking không được chấm mặc định.")
    if len(controlled_rewrite_parts(lesson)["prompts"]) != 20:
        raise SystemExit(f"{lesson['lesson_id']}: controlled rewrite chưa đủ 20 câu.")


def _course() -> dict:
    courses = (_admin().table("courses").select("id,code,name")
               .eq("code", "C5").limit(1).execute().data) or []
    if not courses:
        raise SystemExit("Không tìm thấy khóa học C5.")
    return courses[0]


def _upsert_bank(spec: dict, *, publish: bool = False) -> tuple[str, str, int]:
    payload = {**spec["payload"]}
    try:
        response = _admin().rpc("upsert_advanced_vocab_bank", {
            "p_payload": payload,
            "p_rows": spec["rows"],
            "p_publish": publish,
        }).execute().data or []
    except Exception as exc:  # noqa: BLE001
        if "advanced_vocab_bank_revision_in_use" in str(exc):
            raise SystemExit(
                f"{payload['code']}: không thể cập nhật nội dung tại chỗ vì "
                "đã có assignment; hãy phát hành bank/content version mới."
            ) from exc
        raise
    row = response[0] if isinstance(response, list) and response else response
    if not isinstance(row, dict) or not row.get("bank_id"):
        raise SystemExit(f"{payload['code']}: import atomically không trả về bank.")
    count = int(row.get("written") or 0)
    if count != len(spec["rows"]):
        raise SystemExit(
            f"{payload['code']}: chỉ ghi được {count}/{len(spec['rows'])} câu."
        )
    if publish and row.get("is_published") is not True:
        raise SystemExit(f"{payload['code']}: trạng thái xuất bản không khớp.")
    action = str(row.get("action") or "")
    if action not in {"created", "updated"}:
        raise SystemExit(f"{payload['code']}: kết quả import không hợp lệ.")
    return action, str(row["bank_id"]), count


def _verify_banks(specs: list[dict], course_id: str, *, require_published: bool) -> None:
    for spec in specs:
        expected = spec["payload"]
        banks = (_admin().table("quiz_banks")
                 .select("id,code,lesson_no,is_published,words_count,meta")
                 .eq("course_id", course_id).eq("code", expected["code"])
                 .limit(2).execute().data) or []
        if len(banks) != 1:
            raise SystemExit(
                f"VERIFY {expected['code']}: cần đúng 1 bank, hiện có {len(banks)}."
            )
        bank = banks[0]
        runtime = (bank.get("meta") or {}).get("runtime") or {}
        if (bank.get("lesson_no") is not None
                or not isinstance(bank.get("is_published"), bool)
                or (require_published and bank.get("is_published") is not True)
                or int(bank.get("words_count") or 0) != 24
                or runtime.get("lesson_id") != spec["lesson"]["lesson_id"]
                or runtime.get("content_checksum") != spec["checksum"]
                or runtime.get("score_policy") != "none"):
            raise SystemExit(f"VERIFY {expected['code']}: metadata bank không khớp.")
        response = (_admin().table("quiz_questions")
                    .select("id", count="exact").eq("bank_id", bank["id"])
                    .limit(1).execute())
        if int(response.count or 0) != 48:
            raise SystemExit(
                f"VERIFY {expected['code']}: cần 48 câu, hiện có {response.count}."
            )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commit", action="store_true")
    parser.add_argument(
        "--publish", action="store_true",
        help=("Đánh dấu các bank sẵn sàng để admin giao. Chỉ dùng cùng "
              "--commit sau khi đã preview/verify nội dung."),
    )
    parser.add_argument(
        "--lesson", action="append", choices=LESSON_IDS,
        help="Chỉ kiểm tra/import lesson này; có thể lặp lại. Mặc định là đủ 30 lesson.",
    )
    args = parser.parse_args()
    if args.publish and not args.commit:
        parser.error("--publish chỉ được dùng cùng --commit")
    lesson_ids = tuple(dict.fromkeys(args.lesson or LESSON_IDS))
    course = _course() if args.commit else None
    specs = [lesson_spec(lesson_id, course_id=course["id"] if course else None)
             for lesson_id in lesson_ids]
    for spec in specs:
        _validate_spec(spec)
        summary = spec["summary"]
        print(
            f"OK {summary['lesson_id']} — {summary['vocabulary']} từ, "
            f"{summary['practice']} câu practice, {summary['reading']} câu Reading, "
            f"{summary['listening']} câu Listening — {spec['checksum']}"
        )
    if not args.commit:
        print(
            f"THỬ KHÔ: {len(specs)}/{len(LESSON_IDS)} lesson hợp lệ; "
            "thêm --commit để ghi các bank C5-ADV-T01…C5-ADV-T30."
        )
        return 0

    for spec in specs:
        action, bank_id, count = _upsert_bank(spec, publish=args.publish)
        print(f"{action} {spec['payload']['code']} ({bank_id}); đã ghi {count} câu.")
    _verify_banks(specs, str(course["id"]), require_published=args.publish)
    print(
        f"HOÀN TẤT + VERIFY: {len(specs)} bank assignment-only, "
        "mỗi bank 48 câu, không có điểm tổng mặc định."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
