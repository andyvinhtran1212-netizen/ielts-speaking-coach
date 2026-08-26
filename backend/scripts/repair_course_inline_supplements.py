"""Repair course supplements that were accidentally stored as quiz rows.

Dry-run is the default.  The command converts ``course_reading``,
``course_listening`` and ``course_pronunciation`` rows back to the canonical
multi-section storage used by the learner player, removes the answer-bearing
inline rows, refreshes assignment section snapshots, and reopens completed
two-section ledgers as a continuation that keeps their Grammar/Writing work.

The repair intentionally refuses to commit against an expired assignment
unless a new ISO-8601 ``--due-at`` is supplied.  Reopening learner state while
the submission gate stays closed would leave the class unable to finish.
"""

from __future__ import annotations

import argparse
import json
import re
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlparse

from services.course_pronunciation_manifest import pronunciation_content_hash
from services.quiz_service import course_section_weight_snapshot


INLINE_TYPES = {"course_reading", "course_listening", "course_pronunciation"}
REPAIR_REASON = "restore_missing_course_sections_2026_08_26"
SECTION_TITLES = {
    "A": ("sound", "Nhận diện âm", "question_audio"),
    "B": ("spelling", "Nghe chữ và từ", "question_audio"),
    "C": ("sentence", "Nghe câu và chọn phản hồi", "question_audio"),
    "D": ("content", "Nghe hiểu nội dung", "section_audio"),
}


def _required(value, label: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"Thiếu {label}.")
    return text


def _prefix(qid: str, suffix: str) -> str:
    match = re.fullmatch(rf"(.+)-{suffix}", qid)
    if not match:
        raise ValueError(f"qid không đúng cấu trúc: {qid!r}.")
    return match.group(1)


def reading_meta(rows: list[dict]) -> dict:
    rows = sorted(rows, key=lambda row: int(row.get("order") or 0))
    if not rows:
        raise ValueError("Không có câu Đọc hiểu inline.")
    reading_id = _prefix(_required(rows[0].get("qid"), "qid đọc"), r"R\d+")
    shared = (rows[0].get("segments") or {}).get("shared") or {}
    passage = _required(shared.get("passage"), "bài đọc")
    vocabulary = []
    for item in shared.get("vocabulary") or []:
        vocabulary.append({
            "term": _required(item.get("term") or item.get("tu"), "từ vựng"),
            "part_of_speech": _required(
                item.get("part_of_speech") or item.get("loai"), "loại từ"),
            "meaning": _required(item.get("meaning") or item.get("nghia"), "nghĩa"),
        })
    if not vocabulary:
        raise ValueError("Bài đọc không có từ vựng.")

    specs = (
        ("content", "Đọc hiểu", "tfng", "READ-CONTENT"),
        ("structure", "Soi cấu trúc câu", "short_text", "READ-STRUCTURE"),
    )
    groups, answers = [], []
    number = 1
    for group_id, title, input_type, subtype in specs:
        selected = [row for row in rows if row.get("subtype") == subtype]
        if not selected:
            raise ValueError(f"Bài đọc thiếu nhóm {title}.")
        questions = []
        for row in selected:
            qid = f"{reading_id}-{number:02d}"
            questions.append({
                "id": qid, "number": number,
                "prompt": _required(row.get("prompt"), f"đề đọc câu {number}"),
            })
            if input_type == "tfng":
                options = row.get("options") or []
                index = row.get("answer")
                if options != ["T", "F", "NG"] or not isinstance(index, int):
                    raise ValueError(f"Đáp án T/F/NG câu {number} không hợp lệ.")
                answer = options[index]
            else:
                accepted = row.get("accept") or []
                if not isinstance(accepted, list) or not accepted:
                    raise ValueError(f"Câu đọc {number} không có đáp án chấp nhận.")
                answer = _required(accepted[0], f"đáp án đọc câu {number}")
            answers.append({
                "id": qid, "number": number, "answer": answer,
                "explanation": _required(
                    row.get("explain"), f"giải thích đọc câu {number}"),
            })
            number += 1
        groups.append({
            "id": group_id, "title": title, "input_type": input_type,
            "questions": questions,
        })

    return {
        "id": reading_id,
        "role": "bài về nhà",
        "title": _required(shared.get("title"), "chủ đề đọc"),
        "focus": _required(shared.get("focus"), "trọng tâm đọc"),
        "word_count": len(passage.split()),
        "passage": passage,
        "vocabulary": vocabulary,
        "question_groups": groups,
        "translation": _required(shared.get("translation"), "bản dịch bài đọc"),
        "answers": answers,
    }


def _audio_path(row: dict) -> str:
    segments = row.get("segments") or {}
    path = _required(segments.get("course_audio_path"), "đường dẫn audio nghe")
    if not path.startswith("course/") or ".." in Path(path).parts:
        raise ValueError(f"Đường dẫn audio nghe không an toàn: {path!r}.")
    return path


def listening_meta(rows: list[dict], *, title: str, focus: str) -> dict:
    rows = sorted(rows, key=lambda row: int(row.get("order") or 0))
    if not rows:
        raise ValueError("Không có câu Nghe hiểu inline.")
    listening_id = _prefix(
        _required(rows[0].get("qid"), "qid nghe"), r"[ABCD]\d+",
    )
    sections, answers = [], []
    for label, (section_id, section_title, mode) in SECTION_TITLES.items():
        selected = [row for row in rows
                    if (row.get("segments") or {}).get("section") == label]
        if not selected:
            raise ValueError(f"Bài nghe thiếu phần {label}.")
        questions = []
        section_path = None
        for number, row in enumerate(selected, 1):
            options = row.get("options") or []
            index = row.get("answer")
            if not isinstance(options, list) or not isinstance(index, int) \
                    or not 0 <= index < len(options):
                raise ValueError(f"Đáp án nghe {label}{number} không hợp lệ.")
            qid = f"{listening_id}-{label}{number}"
            question = {"id": qid, "number": number, "options": options}
            path = _audio_path(row)
            if mode == "question_audio":
                question["audio_storage_path"] = path
            else:
                section_path = section_path or path
                if section_path != path:
                    raise ValueError("Các câu phần D không dùng chung một audio.")
                question["prompt"] = _required(
                    row.get("prompt"), f"đề nghe {label}{number}")
            questions.append(question)
            answer = {"id": qid, "answer": options[index] if label == "D"
                      else chr(ord("A") + index)}
            if label != "D":
                explanation = _required(
                    row.get("explain"), f"transcript nghe {label}{number}")
                answer["transcript"] = re.sub(
                    r"^Bạn nghe được:\s*", "", explanation, flags=re.IGNORECASE)
            answers.append(answer)
        section = {
            "id": section_id, "label": label, "title": section_title,
            "mode": mode, "questions": questions,
        }
        if section_path:
            section["audio_storage_path"] = section_path
        sections.append(section)

    d_shared = ((next(row for row in rows
                       if (row.get("segments") or {}).get("section") == "D")
                 .get("segments") or {}).get("shared") or {})
    return {
        "id": listening_id,
        "role": "bài luyện nghe",
        "title": title,
        "focus": focus,
        "language": "en-GB",
        "sections": sections,
        "solution": {
            "answers": answers,
            "talk_transcript": _required(d_shared.get("transcript"), "transcript phần D"),
            "talk_translation": _required(d_shared.get("translation"), "bản dịch phần D"),
        },
    }


def pronunciation_payload(
    rows: list[dict], manifest: dict, *, bank_id: str,
) -> tuple[dict, dict]:
    rows = sorted(rows, key=lambda row: int(row.get("order") or 0))
    source = manifest.get("sentences") or []
    if len(rows) != len(source) or not rows:
        raise ValueError("Số câu phát âm inline không khớp manifest.")
    sentences = []
    for expected, (row, item) in enumerate(zip(rows, source), 1):
        text = _required(row.get("prompt"), f"câu phát âm {expected}")
        if item.get("order") != expected or _required(
                item.get("text"), f"manifest phát âm {expected}") != text:
            raise ValueError(f"Câu phát âm {expected} không khớp manifest.")
        url = urlparse(_required(row.get("audio_url"), f"audio phát âm {expected}"))
        marker = "/vocab-audio/"
        if marker not in url.path:
            raise ValueError(f"Audio phát âm {expected} không thuộc vocab-audio.")
        storage_path = unquote(url.path.split(marker, 1)[1])
        if not storage_path or "/" in storage_path or not storage_path.endswith(".mp3"):
            raise ValueError(f"Đường dẫn audio phát âm {expected} không hợp lệ.")
        sentences.append({
            "id": _required(item.get("id"), f"id phát âm {expected}"),
            "order": expected,
            "text": text,
            "audio_storage_path": storage_path,
        })

    locale = _required(manifest.get("locale"), "locale phát âm")
    engine = _required(manifest.get("voice_engine"), "engine phát âm")
    voice = _required(manifest.get("voice"), "voice phát âm")
    content_hash = pronunciation_content_hash(
        sentences=[row["text"] for row in sentences], locale=locale,
        voice_engine=engine, voice=voice,
    )
    set_payload = {
        "bank_id": bank_id,
        "title": _required(manifest.get("title"), "tiêu đề phát âm"),
        "locale": locale,
        "provider": _required(manifest.get("provider"), "provider phát âm"),
        "voice_engine": engine,
        "voice": voice,
        "content_hash": content_hash,
        "playback_rates": manifest.get("playback_rates") or [0.85, 1.0],
        "sentences": sentences,
        "is_active": True,
    }
    requirement = {
        "id": _prefix(_required(rows[0].get("qid"), "qid phát âm"), r"P\d+"),
        "role": "bài luyện phát âm — nghe và nhắc lại",
        "locale": locale,
        "voice_engine": engine,
        "voice": voice,
        "sentence_count": len(sentences),
        "content_hash": content_hash,
    }
    return set_payload, requirement


def continued_mastery(item: dict, weights: dict[str, float], writing_attempt: int) -> dict:
    mastery = deepcopy(item.get("mastery") or {})
    attempts = list(mastery.get("attempts") or [])
    if not attempts:
        return mastery
    latest = attempts[-1]
    sections = latest.get("sections") or {}
    carried = {}
    for name in ("quiz", "writing"):
        result = sections.get(name)
        if isinstance(result, dict) and result.get("completed"):
            carried[name] = {**result, "weight": weights[name], "carried": True}
    if not carried:
        raise ValueError(f"Item {item.get('id')} đã nộp nhưng không có Quiz/Viết để nối tiếp.")
    attempts.append({
        "phase": "run",
        "attempt_no": writing_attempt,
        "sessions": [],
        "sections": carried,
        "completed": False,
        "pct": None,
        "at": None,
        "duration_sec": sum(int(row.get("duration_sec") or 0) for row in carried.values()),
        "repair_reason": REPAIR_REASON,
    })
    return {
        **mastery,
        "attempts": attempts,
        "active_section_attempt_no": writing_attempt,
        "section_attempt_pending": False,
    }


def _parse_due_at(value: str | None) -> str | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("--due-at phải có timezone, ví dụ +07:00.")
    if parsed.astimezone(timezone.utc) <= datetime.now(timezone.utc):
        raise ValueError("--due-at phải nằm trong tương lai.")
    return parsed.astimezone(timezone.utc).isoformat()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bank-code", default="C1-B06")
    parser.add_argument(
        "--pronunciation-file", default="data/course_pronunciation/C1-B06.json")
    parser.add_argument("--due-at", help="Hạn mới ISO-8601; bắt buộc nếu hạn cũ đã qua.")
    parser.add_argument("--commit", action="store_true")
    args = parser.parse_args()

    from database import supabase_admin

    banks = (supabase_admin.table("quiz_banks").select("*")
             .eq("code", args.bank_code).eq("skill_area", "course")
             .limit(1).execute().data) or []
    if not banks:
        raise SystemExit(f"Không tìm thấy bank {args.bank_code}.")
    bank = banks[0]
    questions = (supabase_admin.table("quiz_questions").select("*")
                 .eq("bank_id", bank["id"]).order("order").execute().data) or []
    inline = {kind: [row for row in questions if row.get("type") == kind]
              for kind in INLINE_TYPES}
    inline_presence = {kind for kind, rows in inline.items() if rows}
    if inline_presence and inline_presence != INLINE_TYPES:
        raise SystemExit("Bank chỉ còn một phần supplement inline; từ chối repair dở dang.")
    existing_sets = (supabase_admin.table("course_pronunciation_sets").select("*")
                     .eq("bank_id", bank["id"]).eq("is_active", True)
                     .limit(1).execute().data) or []

    try:
        if inline_presence:
            manifest = json.loads(Path(args.pronunciation_file).read_text(encoding="utf-8"))
            reading = reading_meta(inline["course_reading"])
            listening = listening_meta(
                inline["course_listening"], title=reading["title"], focus=reading["focus"])
            pronunciation_set, requirement = pronunciation_payload(
                inline["course_pronunciation"], manifest, bank_id=bank["id"])
            meta = {
                **(bank.get("meta") or {}),
                "short_reading": reading,
                "short_listening": listening,
                "pronunciation_requirement": requirement,
            }
            repair_mode = "convert-inline"
        else:
            meta = bank.get("meta") or {}
            reading = meta.get("short_reading")
            listening = meta.get("short_listening")
            requirement = meta.get("pronunciation_requirement")
            if not all(isinstance(value, dict) for value in (
                    reading, listening, requirement)) or not existing_sets:
                raise ValueError(
                    "Bank không có inline rows và cũng chưa đủ canonical metadata/set.")
            pronunciation_set = existing_sets[0]
            repair_mode = "resume-canonical"
        canonical_questions = [row for row in questions
                               if row.get("type") not in INLINE_TYPES]
        snapshot = course_section_weight_snapshot(
            questions=canonical_questions, meta=meta,
            pronunciation_sets=[pronunciation_set],
        )
        due_at = _parse_due_at(args.due_at)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise SystemExit(str(exc)) from exc

    assignments = (supabase_admin.table("class_assignments").select("*")
                   .eq("content_id", bank["id"]).execute().data) or []
    expired = [row for row in assignments if row.get("due_at")
               and datetime.fromisoformat(row["due_at"].replace("Z", "+00:00"))
               <= datetime.now(timezone.utc)]
    if args.commit and expired and not due_at:
        raise SystemExit("Bài giao đã hết hạn; cần --due-at để học viên hoàn thành ba phần.")

    assignment_plans = []
    for assignment in assignments:
        items = (supabase_admin.table("class_assignment_items").select("*")
                 .eq("assignment_id", assignment["id"]).execute().data) or []
        item_ids = [row["id"] for row in items]
        writing_rows = ((supabase_admin.table("course_writing_submissions")
                         .select("class_assignment_item_id, attempt_no")
                         .in_("class_assignment_item_id", item_ids).execute().data)
                        if item_ids else []) or []
        writing_attempt: dict[str, int] = {}
        for row in writing_rows:
            item_id = row["class_assignment_item_id"]
            writing_attempt[item_id] = max(
                writing_attempt.get(item_id, 0), int(row.get("attempt_no") or 1))
        item_patches = []
        for item in items:
            if not item.get("mastery"):
                continue
            latest = ((item.get("mastery") or {}).get("attempts") or [{}])[-1]
            latest_sections = latest.get("sections") or {}
            if (latest.get("repair_reason") == REPAIR_REASON
                    or any(name in latest_sections for name in (
                        "reading", "listening", "pronunciation"))):
                continue
            attempt_no = writing_attempt.get(item["id"])
            if not attempt_no:
                raise SystemExit(
                    f"Item {item['id']} có mastery nhưng thiếu submission Viết.")
            item_patches.append((item["id"], continued_mastery(
                item, snapshot["section_weights"], attempt_no)))
        assignment_plans.append((assignment, item_patches))

    print(json.dumps({
        "bank": args.bank_code,
        "before_questions": len(questions),
        "after_questions": len(canonical_questions),
        "section_counts": snapshot["section_counts"],
        "section_weights": snapshot["section_weights"],
        "assignments": len(assignments),
        "expired_assignments": len(expired),
        "new_due_at": due_at,
        "repair_mode": repair_mode,
        "items_to_reopen": sum(len(plan[1]) for plan in assignment_plans),
        "mode": "commit" if args.commit else "dry-run",
    }, ensure_ascii=False, indent=2))
    if not args.commit:
        return 0

    # Prepare every canonical reader before removing answer-bearing inline rows.
    if inline_presence:
        supabase_admin.table("course_pronunciation_sets").upsert(
            pronunciation_set, on_conflict="bank_id").execute()
    supabase_admin.table("quiz_banks").update({
        "meta": meta, "words_count": len(canonical_questions),
    }).eq("id", bank["id"]).execute()
    if inline_presence:
        (supabase_admin.table("quiz_questions").delete().eq("bank_id", bank["id"])
         .in_("type", sorted(INLINE_TYPES)).execute())

    for assignment, item_patches in assignment_plans:
        config = {**(assignment.get("content_config") or {}), **snapshot}
        patch = {"content_config": config}
        if due_at:
            patch["due_at"] = due_at
        supabase_admin.table("class_assignments").update(patch) \
            .eq("id", assignment["id"]).execute()

        for item_id, next_mastery in item_patches:
            supabase_admin.table("class_assignment_items").update({
                "mastery": next_mastery,
                "score": None,
                "passed_at": None,
                "submitted_at": None,
                "artifact_kind": None,
                "artifact_id": None,
            }).eq("id", item_id).execute()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
