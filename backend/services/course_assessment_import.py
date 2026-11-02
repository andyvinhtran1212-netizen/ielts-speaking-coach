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
# The midterm covers B01–B11; an end-of-course final covers more lessons.  The
# operator declares the range and every question must fall inside it.
DEFAULT_SCOPE = "B01-B11"
_SCOPE_RE = re.compile(r"B(\d{2})-B(\d{2})")
_LESSON_RE = re.compile(r"B(\d{2})")


class AssessmentValidationError(ValueError):
    """Every per-question problem found in one pass over the source.

    Subclasses ``ValueError`` so callers that catch ``ValueError`` keep
    working; ``str(exc)`` is the messages joined by newlines.
    """

    def __init__(self, errors: list[str]):
        self.errors = list(errors)
        super().__init__("\n".join(self.errors))


def _required_text(value, label: str, qid: str, errors: list[str]) -> str | None:
    text = str(value or "").strip()
    if not text:
        errors.append(f"[{qid}] thiếu {label}.")
        return None
    return text


def parse_lesson_scope(scope: str) -> tuple[int, int]:
    """``"B01-B20"`` → ``(1, 20)``; anything else is refused."""
    match = _SCOPE_RE.fullmatch(str(scope or "").strip())
    start, end = (int(match.group(1)), int(match.group(2))) if match else (0, 0)
    if not match or start < 1 or end < start:
        raise ValueError(
            f"phạm vi buổi không hợp lệ: {scope!r} (dạng B01-B20).")
    return start, end


def canonical_lesson_scope(scope: str) -> str:
    """``" B01-B20 "`` → ``"B01-B20"``, the form stored in bank metadata."""
    first, last = parse_lesson_scope(scope)
    return f"B{first:02d}-B{last:02d}"


def normalize_assessment_rows(
    rows: list[dict], *, expected_count: int, scope: str = DEFAULT_SCOPE,
) -> list[dict]:
    """Validate the complete source before returning any warehouse rows.

    Bank-level problems (bad scope, wrong question count, not a list) stop at
    once.  Question-level problems are collected for every question and raised
    together as one ``AssessmentValidationError`` so an author can fix the
    whole file in one pass; no rows are returned while any problem remains.
    """
    first, last = parse_lesson_scope(scope)
    scope_label = f"B{first:02d}–B{last:02d}"
    if not isinstance(rows, list) or len(rows) != expected_count:
        actual = len(rows) if isinstance(rows, list) else "không phải danh sách"
        raise ValueError(f"Bộ đề cần đúng {expected_count} câu, hiện có {actual}.")

    output: list[dict] = []
    all_errors: list[str] = []
    seen_ids: set[str] = set()
    seen_items: set[tuple[str, tuple[str, ...]]] = set()
    for order, source in enumerate(rows):
        if not isinstance(source, dict):
            all_errors.append(f"Câu thứ {order + 1} không phải object JSON.")
            continue
        if source.get("kind") in {"reading", "listening", "pronunciation"}:
            all_errors.append(
                "Đề giữa kỳ chỉ nhận câu trắc nghiệm, không nhận section phụ.")
            continue

        errors: list[str] = []
        qid = _required_text(source.get("id"), "id", f"câu {order + 1}", errors)
        if qid is None:
            all_errors.extend(errors)
            continue
        if qid in seen_ids:
            errors.append(f"id {qid!r} xuất hiện hai lần.")
        seen_ids.add(qid)

        prompt = _required_text(source.get("de"), "đề", qid, errors)

        subtype = _required_text(source.get("dang"), "mã dạng", qid, errors)
        if subtype is not None and subtype not in ALLOWED_SUBTYPES:
            errors.append(f"[{qid}] mã dạng không hợp lệ: {subtype!r}.")
        if source.get("loai_cau_hoi") != "multiple_choice_5":
            errors.append(f"[{qid}] loai_cau_hoi phải là multiple_choice_5.")
        if source.get("so_phuong_an") != OPTION_COUNT:
            errors.append(f"[{qid}] so_phuong_an phải bằng {OPTION_COUNT}.")
        lesson = _required_text(source.get("lesson_primary"), "buổi chính", qid, errors)
        if lesson is not None:
            lesson_match = _LESSON_RE.fullmatch(lesson)
            if not lesson_match or not first <= int(lesson_match.group(1)) <= last:
                errors.append(f"[{qid}] buổi chính phải nằm trong {scope_label}.")
        if source.get("classroom_alignment") is not True:
            errors.append(f"[{qid}] chưa được xác nhận khớp nội dung lớp học.")

        # ``None`` below means "already reported"; later checks that need the
        # value are skipped instead of adding follow-on noise.
        clean_options: list[str] | None = None
        options = source.get("pa")
        if not isinstance(options, list) or len(options) != OPTION_COUNT:
            actual = len(options) if isinstance(options, list) else "không có"
            errors.append(
                f"[{qid}] cần đúng {OPTION_COUNT} phương án, hiện có {actual}.")
        else:
            checked = [_required_text(value, f"phương án {i + 1}", qid, errors)
                       for i, value in enumerate(options)]
            if None not in checked:
                clean_options = checked
        if clean_options is not None:
            normalized_options = [" ".join(value.split()).casefold()
                                  for value in clean_options]
            if len(set(normalized_options)) != OPTION_COUNT:
                errors.append(f"[{qid}] có phương án trùng nhau.")
            elif prompt is not None:
                # Repeated instructional prompts such as "Chọn câu đúng" are
                # valid; the assessable item is the prompt plus its answer
                # choices.  Sort the choices for duplicate detection so merely
                # shuffling A–E cannot hide a duplicated question.
                item_key = (
                    " ".join(prompt.split()).casefold(),
                    tuple(sorted(normalized_options)),
                )
                if item_key in seen_items:
                    errors.append(f"[{qid}] trùng nguyên nội dung với một câu trước.")
                seen_items.add(item_key)

        answer = source.get("dap_an")
        if isinstance(answer, bool) or not isinstance(answer, int) \
                or not 0 <= answer < OPTION_COUNT:
            errors.append(f"[{qid}] đáp án không hợp lệ: {answer!r}.")
            answer = None
        elif source.get("dap_an_chu") != "ABCDE"[answer]:
            errors.append(f"[{qid}] dap_an_chu không khớp dap_an.")
            answer = None

        traps = source.get("bay")
        if not isinstance(traps, list) or len(traps) != OPTION_COUNT:
            errors.append(f"[{qid}] bay phải có đúng {OPTION_COUNT} ô.")
            traps = None
        trap_codes = source.get("ma_bay")
        if not isinstance(trap_codes, list) or len(trap_codes) != OPTION_COUNT:
            errors.append(f"[{qid}] ma_bay phải có đúng {OPTION_COUNT} ô.")
            trap_codes = None
        visible_traps: list[str] = []
        if answer is not None and traps is not None and trap_codes is not None:
            if str(traps[answer] or "").strip() or str(trap_codes[answer] or "").strip():
                errors.append(f"[{qid}] ô bẫy của đáp án đúng phải để trống.")
            traps_complete = True
            for index in range(OPTION_COUNT):
                if index == answer:
                    continue
                if not str(traps[index] or "").strip() \
                        or not str(trap_codes[index] or "").strip():
                    errors.append(
                        f"[{qid}] phương án sai {index + 1} thiếu bẫy hoặc mã bẫy.")
                    traps_complete = False
            if traps_complete:
                wrong_codes = [str(trap_codes[index]).strip().casefold()
                               for index in range(OPTION_COUNT) if index != answer]
                if len(set(wrong_codes)) != OPTION_COUNT - 1:
                    errors.append(
                        f"[{qid}] bốn phương án sai phải dùng bốn cơ chế bẫy khác nhau.")
            visible_traps = [
                str(traps[index] or "").strip()
                for index in range(OPTION_COUNT) if index != answer
            ]

        explanation = _required_text(source.get("giai_thich"), "giải thích", qid, errors)
        learner_visible = " ".join(
            text for text in [prompt, *(clean_options or []), explanation, *visible_traps]
            if text
        )
        if _INTERNAL_MARKER.search(learner_visible):
            errors.append(f"[{qid}] còn mã nội bộ trong nội dung học viên nhìn thấy.")

        try:
            points = int(source.get("muc") or 1)
        except (TypeError, ValueError):
            errors.append(f"[{qid}] mức độ không hợp lệ.")
        else:
            if points not in (1, 2, 3):
                errors.append(f"[{qid}] mức độ phải là 1, 2 hoặc 3.")

        item_key = _required_text(
            source.get("truc") or source.get("diem_day"), "trục kiến thức", qid, errors)
        skill = _required_text(source.get("truc_nhom"), "nhóm trục", qid, errors)
        if errors:
            all_errors.extend(errors)
            continue

        why_wrong = {
            str(index): str(traps[index]).strip()
            for index in range(OPTION_COUNT) if index != answer
        }
        mapped = {
            "qid": qid,
            "item_key": item_key,
            "type": "mcq",
            "subtype": subtype,
            "input": "choice",
            "skill": skill,
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
        why_wrong_errors = quiz_why_wrong.validate_why_wrong(mapped, qid, required=True)
        if why_wrong_errors:
            all_errors.append(f"[{qid}] " + " · ".join(why_wrong_errors))
            continue
        output.append(mapped)
    if all_errors:
        raise AssessmentValidationError(all_errors)
    return output


def source_sha256(rows: list[dict]) -> str:
    payload = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
