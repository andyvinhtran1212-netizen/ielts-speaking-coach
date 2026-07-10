"""quiz_why_wrong — per-distractor "vì sao đáp án nhiễu sai" for grammar quizzes
(audit Giai đoạn 3, #7a).

Quiz `explain` states the rule + why the CORRECT answer is right, but never why
the option the learner actually picked is wrong — so a learner who chooses a
distractor learns nothing about their own mistake (audit finding #7a). This adds
an OPTIONAL, backward-compatible `why_wrong` field and a pure validator for it:

    type: "mcq"
    options: ["affects", "effects", "affect's", "affection"]
    answer: 0
    explain: "..."                       # unchanged — rule + correct answer
    why_wrong:                            # NEW — one entry per WRONG option index
      "1": "'effects' là danh từ, không dùng làm động từ ở đây."
      "2": "'affect's' là sở hữu cách — sai loại từ."
      "3": "'affection' = tình cảm — sai nghĩa."

Pure (no IO). Old banks without `why_wrong` stay valid; when present it must
cover every wrong option with a non-empty reason. Not auto-enforced in CI (no
bank has it yet — that would red the build); run the coverage report and flip
it to a hard gate once backfill lands.
"""

from __future__ import annotations

_CHOICE_TYPES = frozenset(("mcq", "gap_mcq"))


def wrong_option_indices(question: dict) -> list[int] | None:
    """Indices of the wrong options for a choice question, or None if the
    question isn't an index-answered choice type (e.g. boolean, typed-input)."""
    if question.get("type") not in _CHOICE_TYPES:
        return None
    options = question.get("options")
    answer = question.get("answer")
    if not isinstance(options, list) or not isinstance(answer, int):
        return None
    if isinstance(answer, bool):  # bool is an int subclass — exclude
        return None
    return [i for i in range(len(options)) if i != answer]


def has_why_wrong(question: dict) -> bool:
    ww = question.get("why_wrong")
    return isinstance(ww, dict) and len(ww) > 0


def validate_why_wrong(question: dict, label: str, *, required: bool = False) -> list[str]:
    """Validate a question's `why_wrong` block.

    required=False (default): only validate the block IF present (schema check).
    required=True: also fail when it's missing on a choice question — the
    coverage-gate mode used by the backfill.
    """
    errs: list[str] = []
    wrongs = wrong_option_indices(question)
    ww = question.get("why_wrong")

    if ww is None:
        if required and wrongs:
            errs.append(f"[{label}] thiếu 'why_wrong' — cần giải thích vì sao mỗi phương án nhiễu sai.")
        return errs

    if not isinstance(ww, dict):
        return [f"[{label}] 'why_wrong' phải là dict {{chỉ-số-phương-án: lý do}}."]

    if not ww:  # present but empty
        if required and wrongs:
            errs.append(f"[{label}] 'why_wrong' rỗng — cần giải thích cho mỗi phương án nhiễu.")
        return errs

    if wrongs is None:
        # why_wrong on a non-choice question — allowed but nothing to cross-check
        return errs

    keys = {str(k) for k in ww}
    for i in wrongs:
        if str(i) not in keys:
            errs.append(f"[{label}] 'why_wrong' thiếu phương án sai index {i}.")
    for k, v in ww.items():
        if not str(v or "").strip():
            errs.append(f"[{label}] 'why_wrong[{k}]' trống.")
        if not str(k).isdigit() or int(k) not in range(len(question.get("options") or [])):
            errs.append(f"[{label}] 'why_wrong' có key '{k}' không phải chỉ-số phương án hợp lệ.")
        elif int(k) == question.get("answer"):
            errs.append(f"[{label}] 'why_wrong[{k}]' trỏ vào ĐÁP ÁN ĐÚNG, không phải phương án nhiễu.")
    return errs
