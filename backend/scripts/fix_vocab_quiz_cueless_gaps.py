"""scripts/fix_vocab_quiz_cueless_gaps.py — make cue-less gap items answerable.

Audit 2026-07-28 (§B1). The `gap_reflex` subtype strips a sentence down to a
reflex drill, which works for a single word but collapses for an idiom: eleven
live items ask the learner to type a whole phrase from a prompt carrying no
lexical information at all —

    "I ____."   → burn the midnight oil
    "I ____."   → pass with flying colors        (SAME prompt, different answer)
    "____!"     → it's a small world
    "____."     → only time will tell

No learner can answer those, and in L02 two of them are indistinguishable from
each other. The prompt is deliberately left alone (the reflex drill is the
design); what was missing is the meaning cue. `quiz_questions.hint` exists for
exactly this since migration 159 and the player already renders it as a muted
"💡 …" line under the prompt — yet 0 of the 8 847 vocab questions use it.

The cue is the word's own Vietnamese meaning, read from `vocab_cards` (the same
topic-scoped lookup quiz_service._word_cards_for does), falling back to the
bank's own meaning MCQ when a card is missing.

    cd backend && python -m scripts.fix_vocab_quiz_cueless_gaps            # DRY-RUN
    cd backend && python -m scripts.fix_vocab_quiz_cueless_gaps --commit
"""

from __future__ import annotations

import argparse
import logging
import re

from database import supabase_admin

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("fix_vocab_quiz_cueless_gaps")

_PAGE = 1000
_LESSON_SRC_RE = re.compile(r"^L\d")
# Characters of real prompt text (blank removed) below which the item carries no
# lexical cue. "He ____." → 4. A genuine gap sentence sits far above this.
_CUE_MIN_CHARS = 12


def _context_len(prompt: str) -> int:
    return len(re.sub(r"_{2,}", " ", str(prompt or "")).strip(" .!?,;:'\"…"))


def _cards_by_topic() -> dict[str, dict[str, dict]]:
    rows: list[dict] = []
    start = 0
    while True:
        page = (
            supabase_admin.table("vocab_cards")
            .select("headword, topic_id, definition_vi, gloss_vi, lists, source")
            .order("id").range(start, start + _PAGE - 1).execute()
        ).data or []
        rows.extend(page)
        if len(page) < _PAGE:
            break
        start += _PAGE
    out: dict[str, dict[str, dict]] = {}
    for c in rows:
        # Exam-only imports share topics with curated lesson words; keep the
        # lesson side, exactly like quiz_service._word_cards_for.
        if c.get("lists") and not _LESSON_SRC_RE.match((c.get("source") or "").strip()):
            continue
        hw = (c.get("headword") or "").strip().lower()
        if hw and c.get("topic_id"):
            out.setdefault(c["topic_id"], {})[hw] = c
    return out


def _meaning_from_bank(questions: list[dict], item_key: str) -> str:
    """Fallback cue: the correct option of the word's meaning_en_vi MCQ is the
    Vietnamese gloss the bank itself already shows the learner."""
    for q in questions:
        if q.get("item_key") != item_key or q.get("subtype") != "meaning_en_vi":
            continue
        opts = q.get("options") or []
        ans = q.get("answer")
        if isinstance(ans, int) and 0 <= ans < len(opts):
            return str(opts[ans]).strip()
    return ""


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--commit", action="store_true", help="write (default: dry-run)")
    args = ap.parse_args()

    banks = (
        supabase_admin.table("quiz_banks").select("id, code, topic_id")
        .eq("skill_area", "vocab").execute()
    ).data or []
    cards_by_topic = _cards_by_topic()

    planned: list[tuple[dict, str, str]] = []
    for b in sorted(banks, key=lambda x: x.get("code") or ""):
        questions: list[dict] = []
        start = 0
        while True:
            page = (
                supabase_admin.table("quiz_questions")
                .select("id, qid, item_key, type, subtype, input, prompt, hint, "
                        "options, answer, accept")
                .eq("bank_id", b["id"]).order("order")
                .range(start, start + _PAGE - 1).execute()
            ).data or []
            questions.extend(page)
            if len(page) < _PAGE:
                break
            start += _PAGE

        cards = cards_by_topic.get(b.get("topic_id") or "", {})
        for q in questions:
            if q.get("input") != "text":
                continue
            if _context_len(q.get("prompt")) >= _CUE_MIN_CHARS:
                continue
            if str(q.get("hint") or "").strip():
                continue          # already cued — leave authored hints alone
            key = (q.get("item_key") or "").strip().lower()
            card = cards.get(key) or {}
            meaning = (card.get("definition_vi") or card.get("gloss_vi") or "").strip()
            if not meaning:
                meaning = _meaning_from_bank(questions, q.get("item_key"))
            if not meaning:
                logger.warning("  ! no meaning found for %s (%s) — skipped",
                               q["qid"], b.get("code"))
                continue
            planned.append((q, b.get("code") or "", 'Nghĩa: "%s"' % meaning.rstrip(".")))

    logger.info("cue-less text items needing a hint: %d", len(planned))
    for q, code, hint in planned:
        logger.info("  %-6s %-40s %-12r → %s", code, q["qid"], q["prompt"], hint)

    if not args.commit:
        logger.info("DRY-RUN — nothing written. Re-run with --commit.")
        return

    ok = fail = 0
    for q, _code, hint in planned:
        try:
            supabase_admin.table("quiz_questions").update(
                {"hint": hint}).eq("id", q["id"]).execute()
            ok += 1
        except Exception as exc:  # noqa: BLE001
            fail += 1
            logger.error("  ✗ %s — %s", q["qid"], exc)
    logger.info("Done. updated=%d failed=%d", ok, fail)


if __name__ == "__main__":
    main()
