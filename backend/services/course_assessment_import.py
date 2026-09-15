"""Validate and map five-option Course assessments into the quiz warehouse.

This is deliberately separate from ``import_course_exercise_bank``.  Lesson
banks have four choices plus optional writing/reading/listening/pronunciation
sections; a midterm is a quiz-only assessment whose source contract is exactly
five choices.  Sharing a permissive normaliser would make both contracts weaker.
"""

from __future__ import annotations

import hashlib
import json
import re

from services import quiz_why_wrong


ALLOWED_SUBTYPES = {
    "A1", "A2", "A3", "B1", "B2", "B3",
    "C1", "C2", "C3", "C4", "D1", "D2", "D3", "D4",
}
OPTION_COUNT = 5
_INTERNAL_MARKER = re.compile(r"\[(?:C|U)\]|\bN[1-6]\b|bậc\s+[23]", re.IGNORECASE)


def _required_text(value, label: str, qid: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"[{qid}] thiếu {label}.")
    return text


def normalize_assessment_rows(
    rows: list[dict], *, expected_count: int,
) -> list[dict]:
    """Validate the complete source before returning any warehouse rows."""
    if not isinstance(rows, list) or len(rows) != expected_count:
        actual = len(rows) if isinstance(rows, list) else "không phải danh sách"
        raise ValueError(f"Bộ đề cần đúng {expected_count} câu, hiện có {actual}.")

    output: list[dict] = []
    seen_ids: set[str] = set()
    seen_items: set[tuple[str, tuple[str, ...]]] = set()
    for order, source in enumerate(rows):
        if not isinstance(source, dict):
            raise ValueError(f"Câu thứ {order + 1} không phải object JSON.")
        if source.get("kind") in {"reading", "listening", "pronunciation"}:
            raise ValueError("Đề giữa kỳ chỉ nhận câu trắc nghiệm, không nhận section phụ.")

        qid = _required_text(source.get("id"), "id", f"câu {order + 1}")
        if qid in seen_ids:
            raise ValueError(f"id {qid!r} xuất hiện hai lần.")
        seen_ids.add(qid)

        prompt = _required_text(source.get("de"), "đề", qid)

        subtype = _required_text(source.get("dang"), "mã dạng", qid)
        if subtype not in ALLOWED_SUBTYPES:
            raise ValueError(f"[{qid}] mã dạng không hợp lệ: {subtype!r}.")
        if source.get("loai_cau_hoi") != "multiple_choice_5":
            raise ValueError(f"[{qid}] loai_cau_hoi phải là multiple_choice_5.")
        if source.get("so_phuong_an") != OPTION_COUNT:
            raise ValueError(f"[{qid}] so_phuong_an phải bằng {OPTION_COUNT}.")
        lesson = _required_text(source.get("lesson_primary"), "buổi chính", qid)
        if not re.fullmatch(r"B(?:0[1-9]|1[01])", lesson):
            raise ValueError(f"[{qid}] buổi chính phải nằm trong B01–B11.")
        if source.get("classroom_alignment") is not True:
            raise ValueError(f"[{qid}] chưa được xác nhận khớp nội dung lớp học.")

        options = source.get("pa")
        if not isinstance(options, list) or len(options) != OPTION_COUNT:
            actual = len(options) if isinstance(options, list) else "không có"
            raise ValueError(f"[{qid}] cần đúng {OPTION_COUNT} phương án, hiện có {actual}.")
        clean_options = [_required_text(value, f"phương án {i + 1}", qid)
                         for i, value in enumerate(options)]
        if len({value.casefold() for value in clean_options}) != OPTION_COUNT:
            raise ValueError(f"[{qid}] có phương án trùng nhau.")
        # Repeated instructional prompts such as "Chọn câu đúng" are valid;
        # the assessable item is the prompt plus its answer choices.  Sort the
        # choices for duplicate detection so merely shuffling A–E cannot hide
        # a duplicated question.
        item_key = (
            " ".join(prompt.split()).casefold(),
            tuple(sorted(" ".join(value.split()).casefold()
                         for value in clean_options)),
        )
        if item_key in seen_items:
            raise ValueError(f"[{qid}] trùng nguyên nội dung với một câu trước.")
        seen_items.add(item_key)

        answer = source.get("dap_an")
        if isinstance(answer, bool) or not isinstance(answer, int) \
                or not 0 <= answer < OPTION_COUNT:
            raise ValueError(f"[{qid}] đáp án không hợp lệ: {answer!r}.")
        if source.get("dap_an_chu") != "ABCDE"[answer]:
            raise ValueError(f"[{qid}] dap_an_chu không khớp dap_an.")

        traps = source.get("bay")
        if not isinstance(traps, list) or len(traps) != OPTION_COUNT:
            raise ValueError(f"[{qid}] bay phải có đúng {OPTION_COUNT} ô.")
        trap_codes = source.get("ma_bay")
        if not isinstance(trap_codes, list) or len(trap_codes) != OPTION_COUNT:
            raise ValueError(f"[{qid}] ma_bay phải có đúng {OPTION_COUNT} ô.")
        if str(traps[answer] or "").strip() or str(trap_codes[answer] or "").strip():
            raise ValueError(f"[{qid}] ô bẫy của đáp án đúng phải để trống.")
        for index in range(OPTION_COUNT):
            if index == answer:
                continue
            if not str(traps[index] or "").strip() \
                    or not str(trap_codes[index] or "").strip():
                raise ValueError(f"[{qid}] phương án sai {index + 1} thiếu bẫy hoặc mã bẫy.")
        wrong_codes = [str(trap_codes[index]).strip().casefold()
                       for index in range(OPTION_COUNT) if index != answer]
        if len(set(wrong_codes)) != OPTION_COUNT - 1:
            raise ValueError(f"[{qid}] bốn phương án sai phải dùng bốn cơ chế bẫy khác nhau.")

        explanation = _required_text(source.get("giai_thich"), "giải thích", qid)
        learner_visible = " ".join([prompt, *clean_options, explanation])
        if _INTERNAL_MARKER.search(learner_visible):
            raise ValueError(f"[{qid}] còn mã nội bộ trong nội dung học viên nhìn thấy.")

        try:
            points = int(source.get("muc") or 1)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"[{qid}] mức độ không hợp lệ.") from exc
        if points not in (1, 2, 3):
            raise ValueError(f"[{qid}] mức độ phải là 1, 2 hoặc 3.")

        why_wrong = {
            str(index): str(traps[index]).strip()
            for index in range(OPTION_COUNT) if index != answer
        }
        mapped = {
            "qid": qid,
            "item_key": _required_text(
                source.get("truc") or source.get("diem_day"), "trục kiến thức", qid),
            "type": "mcq",
            "subtype": subtype,
            "input": "choice",
            "skill": _required_text(source.get("truc_nhom"), "nhóm trục", qid),
            "pair": source.get("chieu"),
            "counts_toward_mastery": True,
            "prompt": prompt,
            "hint": None,
            "options": clean_options,
            "answer": answer,
            "accept": None,
            # Midterm is explicitly quiz-only.  English in the stem is not a
            # listening prompt and must not trigger the Course audio gate.
            "segments": None,
            "mask": None,
            "pairs": None,
            "explain": explanation,
            "why_wrong": why_wrong,
            "points": points,
            "audio_url": None,
            "grammar_article_slug": None,
            "order": order,
        }
        errors = quiz_why_wrong.validate_why_wrong(mapped, qid, required=True)
        if errors:
            raise ValueError(f"[{qid}] " + " · ".join(errors))
        output.append(mapped)
    return output


def source_sha256(rows: list[dict]) -> str:
    payload = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
