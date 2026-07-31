"""scripts/fix_vocab_quiz_accepts.py — widen `accept` on vocab Quick-Check items.

Audit 2026-07-28 (§B2). Text answers are graded against `quiz_questions.accept`
by quiz-engine.gradeText(). Two properties of that grader make a narrow accept
list ungradeable in practice:

  1. `type='spelling'` DISABLES the 1-edit typo tolerance (textFuzzyAllowed) —
     these items are graded strictly, by design (orthography).
  2. normalizeText() strips punctuation only at the two ENDS of the string, so
     internal "/" and "(...)" must be typed verbatim.

Together those turned "either-or" headwords into items nobody can answer:
`in the red / in the black`, `corporate social responsibility (csr)`,
`lenient / permissive`, `steeped in history/tradition`, `import / export` — the
learner must type the slash. Prod evidence: "Corporate Social Responsibility
(CSR)" is the single most-missed item in the whole system (24 wrong answers) and
sits at status='carried_over' with production_done=false for 5 different
learners. Same defect class as the `plant(s) / mustard` reading answers.

This does NOT loosen grading: every variant generated here is a form that is
already CORRECT for the item. Nothing is removed, only added.

    cd backend && python -m scripts.fix_vocab_quiz_accepts            # DRY-RUN
    cd backend && python -m scripts.fix_vocab_quiz_accepts --commit
"""

from __future__ import annotations

import argparse
import logging
import re

from database import supabase_admin

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("fix_vocab_quiz_accepts")

_PAGE = 1000
# Leading markers that a recall prompt never requires the learner to reproduce.
_LEAD = ("to ", "a ", "an ", "the ")
# Possessive placeholder in dictionary-form idioms ("speak one's mind"). A learner
# typing "speak my mind" is right; the placeholder is lexicographic notation.
_POSSESSIVES = ("my", "your", "his", "her", "their", "our", "someone's", "somebody's")


def _split_slash(s: str) -> list[str]:
    """Expand "/" alternatives.

    "in the red / in the black" → both halves (a spaced slash separates whole
    alternatives). "steeped in history/tradition" → the slash sits inside one
    token, so only that token alternates.
    """
    if " / " in s:
        return [p.strip() for p in s.split(" / ") if p.strip()]
    if "/" not in s:
        return []
    out: list[str] = []
    toks = s.split()
    for i, t in enumerate(toks):
        if "/" in t:
            for alt in t.split("/"):
                if alt.strip():
                    out.append(" ".join(toks[:i] + [alt.strip()] + toks[i + 1:]))
            break
    return out


def _split_paren(s: str) -> list[str]:
    """"corporate social responsibility (csr)" → the phrase alone AND the
    abbreviation alone (both are the right answer in real usage)."""
    m = re.search(r"\(([^)]+)\)", s)
    if not m:
        return []
    without = re.sub(r"\s*\([^)]*\)\s*", " ", s).strip()
    inner = m.group(1).strip()
    return [x for x in (without, inner) if x]


def _hyphen_forms(s: str) -> list[str]:
    """double-edged → "double edged" / "doubleedged". Mirrors the variants the
    bank already carries for some items (state-of-the-art), applied uniformly."""
    if "-" not in s:
        return []
    return [s.replace("-", " "), s.replace("-", "")]


def _apostrophe_forms(s: str) -> list[str]:
    """A typed answer uses the straight quote; some canonical forms carry the
    curly one (or vice versa). normalizeText() does not fold them together."""
    out = []
    if "’" in s:
        out.append(s.replace("’", "'"))
    if "'" in s:
        out.append(s.replace("'", "’"))
    return out


def _lead_forms(s: str) -> list[str]:
    """DROP a leading infinitive marker or article — never add one.

    "to run in the family" → "run in the family" is the same answer typed without
    dictionary notation. The reverse is not safe: prepending "to " to a headword
    like "lenient" or "in the red" invents a form that is not English, and an
    accept list must only ever contain forms that are actually correct.
    """
    low = s.lower()
    for lead in _LEAD:
        if low.startswith(lead):
            rest = s[len(lead):].strip()
            return [rest] if rest else []
    return []


def _possessive_forms(s: str) -> list[str]:
    if "one's" not in s.lower():
        return []
    return [re.sub(r"one's", p, s, flags=re.I) for p in _POSSESSIVES]


def _variants(answer: str, *, recall: bool) -> list[str]:
    """All forms that are ALSO correct for `answer`.

    `recall=True` (type='spelling') — the prompt is "type the English word that
    means X", so leading-marker and possessive forms are equally right.
    `recall=False` (gap_text) — the sentence fixes the grammar, so those two
    families are NOT applied: "He's gradually ____" must not accept "to climb
    the corporate ladder".
    """
    seen: list[str] = []
    frontier = [answer]
    # Two passes so a slash-expanded half also gets its hyphen/apostrophe forms.
    for _ in range(2):
        nxt: list[str] = []
        for s in frontier:
            gen = _split_slash(s) + _split_paren(s) + _hyphen_forms(s) + _apostrophe_forms(s)
            if recall:
                gen += _lead_forms(s) + _possessive_forms(s)
            for g in gen:
                g = re.sub(r"\s+", " ", g).strip()
                if g and g not in seen:
                    seen.append(g)
                    nxt.append(g)
        frontier = nxt
        if not frontier:
            break
    return seen


def _norm(s: str) -> str:
    """The engine's own comparison key — a variant that normalizes to an already
    accepted form adds nothing, so don't write it."""
    t = re.sub(r"\s+", " ", str(s or "").strip())
    t = re.sub(r"^[\s\"'.,;:!?(){}\[\]]+|[\s\"'.,;:!?(){}\[\]]+$", "", t)
    return t.lower()


def _vocab_text_questions() -> list[dict]:
    bank_ids = [
        r["id"] for r in (
            supabase_admin.table("quiz_banks").select("id")
            .eq("skill_area", "vocab").execute()
        ).data or []
    ]
    rows: list[dict] = []
    for bid in bank_ids:
        start = 0
        while True:
            page = (
                supabase_admin.table("quiz_questions")
                .select("id, qid, bank_id, item_key, type, input, accept")
                .eq("bank_id", bid).eq("input", "text")
                .order("order").range(start, start + _PAGE - 1).execute()
            ).data or []
            rows.extend(page)
            if len(page) < _PAGE:
                break
            start += _PAGE
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--commit", action="store_true", help="write (default: dry-run)")
    args = ap.parse_args()

    rows = _vocab_text_questions()
    logger.info("vocab text questions: %d", len(rows))

    planned = []
    for q in rows:
        accept = [str(a) for a in (q.get("accept") or []) if str(a).strip()]
        if not accept:
            continue
        recall = q.get("type") == "spelling"
        have = {_norm(a) for a in accept}
        add: list[str] = []
        for a in accept:
            for v in _variants(a, recall=recall):
                if _norm(v) and _norm(v) not in have:
                    have.add(_norm(v))
                    add.append(v)
        if add:
            planned.append((q, accept + add, add))

    logger.info("questions gaining accepted forms: %d", len(planned))
    ungradeable = [p for p in planned
                   if any(c in p[0]["accept"][0] for c in ("/", "("))]
    logger.info("  of which previously UNGRADEABLE (slash/paren answer): %d", len(ungradeable))
    for q, _new, add in ungradeable:
        logger.info("    %s [%s] %r += %s", q["qid"], q["type"], q["accept"][0], add)
    for q, _new, add in planned[:12]:
        logger.info("  %s [%s] %r += %s", q["qid"], q["type"], q["accept"][0], add)

    if not args.commit:
        logger.info("DRY-RUN — nothing written. Re-run with --commit.")
        return

    ok = fail = 0
    for q, new_accept, _add in planned:
        try:
            supabase_admin.table("quiz_questions").update(
                {"accept": new_accept}).eq("id", q["id"]).execute()
            ok += 1
        except Exception as exc:  # noqa: BLE001 — one bad row must not stop the batch
            fail += 1
            logger.error("  ✗ %s — %s", q["qid"], exc)
    logger.info("Done. updated=%d failed=%d", ok, fail)


if __name__ == "__main__":
    main()
