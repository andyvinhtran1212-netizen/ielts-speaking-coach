"""scripts/fix_vocab_quiz_explains.py — make collocation feedback teach something.

Audit 2026-07-28 (§B4). All 719 collocation MCQs — every single one of that
subtype, 8% of the bank — explain a wrong answer with `Đúng: "<the answer>".`
The player has already printed `Đáp án đúng: <the answer>` on the line directly
above, so the explanation adds exactly zero information: the learner never finds
out why the three options they were choosing between are wrong.

The missing information is already in the data. Distractors are drawn from OTHER
words in the same bank, and every word's collocations sit on its `vocab_cards`
row, so each distractor can be traced back to the word it actually belongs to.
The rewritten explanation says (a) which other phrases go with this word, and
(b) which words the distractors belong to — both derived, neither invented.

    cd backend && python -m scripts.fix_vocab_quiz_explains            # DRY-RUN
    cd backend && python -m scripts.fix_vocab_quiz_explains --commit

Run this AFTER fix_vocab_quiz_leaks.py: that script repairs the 32 circular
collocation items, and this one then explains the repaired options.
"""

from __future__ import annotations

import argparse
import logging
import re

from database import supabase_admin

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("fix_vocab_quiz_explains")

_PAGE = 1000
_LESSON_SRC_RE = re.compile(r"^L\d")
_MAX_SIBLINGS = 2      # other collocations quoted for the same word


def _norm(s) -> str:
    return re.sub(r"\s+", " ", str(s or "").strip().lower())


def _cards_by_topic() -> dict[str, list[dict]]:
    rows: list[dict] = []
    start = 0
    while True:
        page = (
            supabase_admin.table("vocab_cards")
            .select("headword, topic_id, collocations, lists, source")
            .order("id").range(start, start + _PAGE - 1).execute()
        ).data or []
        rows.extend(page)
        if len(page) < _PAGE:
            break
        start += _PAGE
    out: dict[str, list[dict]] = {}
    for c in rows:
        if c.get("lists") and not _LESSON_SRC_RE.match((c.get("source") or "").strip()):
            continue
        if c.get("topic_id"):
            out.setdefault(c["topic_id"], []).append(c)
    return out


def _build_explain(headword: str, answer: str, distractors: list[str],
                   cards: list[dict]) -> str:
    """`Đúng: "X". Cụm khác với **H**: a, b. Ba phương án còn lại đi với: W1, W2.`

    Clauses are dropped when their data is missing rather than padded, so a word
    with no sibling collocation simply gets the shorter (still honest) sentence.
    """
    own = next((c for c in cards
                if _norm(c.get("headword")) == _norm(headword)), {}) or {}
    siblings = [
        str(c) for c in (own.get("collocations") or [])
        if _norm(c) not in (_norm(answer), _norm(headword))
    ][:_MAX_SIBLINGS]

    # Which word does each distractor actually belong to?
    owner_by_col: dict[str, str] = {}
    for c in cards:
        hw = str(c.get("headword") or "")
        for col in (c.get("collocations") or []):
            owner_by_col.setdefault(_norm(col), hw)
    owners: list[str] = []
    for d in distractors:
        w = owner_by_col.get(_norm(d))
        if w and _norm(w) != _norm(headword) and w not in owners:
            owners.append(w)

    parts = ['Đúng: "%s".' % answer]
    if siblings:
        parts.append("Cụm khác với **%s**: %s." % (headword, ", ".join(siblings)))
    if owners:
        parts.append("Các phương án còn lại đi với: %s." % ", ".join(owners))
    return " ".join(parts)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--commit", action="store_true", help="write (default: dry-run)")
    args = ap.parse_args()

    banks = (
        supabase_admin.table("quiz_banks").select("id, code, topic_id")
        .eq("skill_area", "vocab").execute()
    ).data or []
    cards_by_topic = _cards_by_topic()

    planned: list[tuple[dict, str]] = []
    unchanged = 0
    for b in sorted(banks, key=lambda x: x.get("code") or ""):
        questions: list[dict] = []
        start = 0
        while True:
            page = (
                supabase_admin.table("quiz_questions")
                .select("id, qid, item_key, subtype, input, options, answer, explain")
                .eq("bank_id", b["id"]).eq("subtype", "collocation")
                .order("order").range(start, start + _PAGE - 1).execute()
            ).data or []
            questions.extend(page)
            if len(page) < _PAGE:
                break
            start += _PAGE
        cards = cards_by_topic.get(b.get("topic_id") or "", [])

        for q in questions:
            opts, ans = q.get("options") or [], q.get("answer")
            if q.get("input") != "choice" or not isinstance(ans, int) or not (0 <= ans < len(opts)):
                continue
            answer = str(opts[ans])
            distractors = [str(o) for i, o in enumerate(opts) if i != ans]
            new = _build_explain(str(q.get("item_key") or ""), answer, distractors, cards)
            if _norm(new) == _norm(q.get("explain")):
                unchanged += 1
                continue
            planned.append((q, new))

    logger.info("collocation explanations to rewrite: %d (already fine: %d)",
                len(planned), unchanged)
    thin = [p for p in planned if p[1].count(".") <= 1]
    logger.info("  still single-clause (word has no sibling collocation and no "
                "traceable distractor): %d", len(thin))
    for q, new in planned[:15]:
        logger.info("  %-34s %r", q["qid"], new)

    if not args.commit:
        logger.info("DRY-RUN — nothing written. Re-run with --commit.")
        return

    ok = fail = 0
    for q, new in planned:
        try:
            supabase_admin.table("quiz_questions").update(
                {"explain": new}).eq("id", q["id"]).execute()
            ok += 1
        except Exception as exc:  # noqa: BLE001
            fail += 1
            logger.error("  ✗ %s — %s", q["qid"], exc)
    logger.info("Done. updated=%d failed=%d", ok, fail)


if __name__ == "__main__":
    main()
