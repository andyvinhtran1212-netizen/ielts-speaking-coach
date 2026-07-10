"""reading_solution_depth — the STRICTER content gate for reading solutions
(audit Giai đoạn 3, #6).

`reading_solution.validate_solution_structure` is deliberately lenient: a thin
one-step solution is "structurally valid" so nothing had to be re-authored. That
lenience is exactly why coverage stalled at 1/40 (audit finding #6). This module
adds the DEPTH bar the audit asks for:

  * every graded question needs a real solution: ≥ 2 `solution_steps`, each with
    a non-empty `instruction_vi`;
  * every distractor-bearing question (MCQ / matching / T-F-NG / Y-N-NG) needs
    `distractor_analysis` covering EVERY wrong option with a non-empty
    `why_wrong_vi` — the "vì sao đáp án nhiễu sai" the audit says is missing.

Pure (no IO), so it unit-tests cleanly and can gate a generator's drafts, an
import, or a coverage report without touching the DB. It is NOT auto-wired into
CI yet — current content is ~1/40, so enforcement would red the build; run it on
new/backfilled content and flip it to a hard gate once coverage lands.
"""

from __future__ import annotations

from services.reading_solution import validate_solution_structure

# Question types whose wrong answers form a fixed, enumerable distractor set.
_OPTION_TYPES: frozenset[str] = frozenset((
    "multiple_choice", "matching_headings", "matching_information",
    "matching_features", "matching_paragraphs", "matching_sentence_endings",
))
# Fixed-verdict types: options are implicit, not listed in the YAML.
_FIXED_OPTIONS: dict[str, tuple[str, ...]] = {
    "true_false_not_given": ("TRUE", "FALSE", "NOT GIVEN"),
    "yes_no_not_given":     ("YES", "NO", "NOT GIVEN"),
}


def _norm(v) -> str:
    return str(v or "").strip().upper()


def wrong_options(question: dict) -> list[str] | None:
    """The wrong-option labels for a question, or None if the type has no fixed
    distractor set (gap-fill / short-answer — nothing to write a distractor
    analysis against)."""
    qtype = (question.get("question_type") or "").strip()
    answer = _norm(question.get("answer"))

    if qtype in _FIXED_OPTIONS:
        return [o for o in _FIXED_OPTIONS[qtype] if _norm(o) != answer]

    if qtype in _OPTION_TYPES:
        opts = question.get("options") or []
        labels = [str(o.get("label")) for o in opts if isinstance(o, dict) and o.get("label") is not None]
        return [lab for lab in labels if _norm(lab) != answer]

    return None


def validate_solution_depth(question: dict, label: str, *, require_distractors: bool = True) -> list[str]:
    """Return a list of depth-gap messages (empty = passes the depth bar)."""
    errs: list[str] = []
    sol = question.get("solution")
    if not isinstance(sol, dict):
        return [f"{label}: thiếu 'solution' (cần giải chi tiết, không để trống)."]

    # base structural validity first (kp_ref/microcheck shapes, etc.)
    errs += validate_solution_structure(sol, label)

    steps = sol.get("solution_steps")
    if not isinstance(steps, list) or len(steps) < 2:
        errs.append(f"{label}.solution_steps: cần ≥ 2 bước (giải một-bước là chưa đủ sâu).")
    else:
        for i, step in enumerate(steps):
            if not (isinstance(step, dict) and str(step.get("instruction_vi") or "").strip()):
                errs.append(f"{label}.solution_steps[{i}]: 'instruction_vi' trống.")

    wrongs = wrong_options(question)
    if require_distractors and wrongs:
        da = sol.get("distractor_analysis")
        da = da if isinstance(da, list) else []
        covered = {_norm(d.get("option")) for d in da if isinstance(d, dict)}
        missing = [w for w in wrongs if _norm(w) not in covered]
        if missing:
            errs.append(
                f"{label}.distractor_analysis: thiếu giải thích cho phương án nhiễu {missing} "
                f"(mỗi đáp án sai cần một 'why_wrong_vi')."
            )
        for i, d in enumerate(da):
            if isinstance(d, dict) and not str(d.get("why_wrong_vi") or "").strip():
                errs.append(f"{label}.distractor_analysis[{i}]: 'why_wrong_vi' trống.")

    return errs


def is_deep(question: dict) -> bool:
    """Convenience: True when the question passes the depth bar."""
    return not validate_solution_depth(question, "q")
