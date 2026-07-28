"""scripts/fix_vocab_quiz_leaks.py — close the answer leaks in the vocab banks.

Audit 2026-07-28 (§B3 + §B1-leaks). 61 MCQs and 4 typed items can be answered
without knowing anything, because the answer is visible in the prompt. Three
distinct shapes, three distinct repairs — none of which invents content:

  1. CIRCULAR COLLOCATION (32). "Cụm nào đi ĐÚNG với **Throw in the towel**?" →
     the correct option IS "throw in the towel". The generator took
     `vocab_cards.collocations[0]`, which for an idiom is the idiom itself. Every
     one of those cards also carries a REAL collocation ("be ready to throw in the
     towel", "never cross one's mind", "cuts across the board"), so the repair is
     to promote that instead of the bare headword. The item becomes a genuine
     collocation test using data the card already had.

  2. HEADWORD-IN-PROMPT (24: 23 word_form + 1 synonym). "Trong họ từ của
     **Tuition fees**, dạng danh từ là từ nào?" → options
     [curricular, tuition, truant, peer]; only "tuition" appears in the bolded
     headword, so the answer is a string match. The repair replaces the headword
     in the prompt with the word's Vietnamese meaning, which keeps the question
     (do you know this word's family?) and removes the giveaway.

  3. HAND-FIXED PROMPTS (9). A definition whose TAIL repeats the blanked word
     ("the curved ____ … to move along such a path"), a gloss that spells the
     English answer out ("Gõ từ có nghĩa: 'Gen, gene'"), and two gap sentences
     that print the answer beside the blank. Each is corrected explicitly below
     rather than by a rule — there are nine, and a regex that rewrites English
     definitions in bulk is exactly the kind of thing that quietly breaks meaning.

    cd backend && python -m scripts.fix_vocab_quiz_leaks            # DRY-RUN
    cd backend && python -m scripts.fix_vocab_quiz_leaks --commit
"""

from __future__ import annotations

import argparse
import logging
import re

from database import supabase_admin

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("fix_vocab_quiz_leaks")

_PAGE = 1000
_LESSON_SRC_RE = re.compile(r"^L\d")


def _norm(s) -> str:
    return re.sub(r"\s+", " ", str(s or "").strip().lower())


# ── 3. hand-fixed prompts (qid → {field: new value}) ─────────────────────────
# Each entry states what leaked and what the corrected text is.
HAND_FIXES: dict[str, dict] = {
    # def_cloze: the clause AFTER the blank repeats the blanked word.
    "aquatic_v11": {"prompt": 'Chọn từ thích hợp nhất để hoàn tất định nghĩa của **Aquatic**:  "living or growing in ____, whether fresh or salt"'},
    "in_the_red_in_the_black_v8": {"prompt": 'Chọn từ thích hợp nhất để hoàn tất định nghĩa của **In the red / In the black**:  "in the red ____ losing money or in debt"'},
    "import_export_v9": {"prompt": 'Chọn từ thích hợp nhất để hoàn tất định nghĩa của **Import / Export**:  "to bring ____ into a country / to send them out to another country"'},
    "orbit_v10": {"prompt": 'Chọn từ thích hợp nhất để hoàn tất định nghĩa của **Orbit**:  "the curved ____ of an object around a star, planet or moon"'},
    # "Gen, gene" spells the English answer inside the Vietnamese gloss.
    "gene_v2": {"prompt": 'Từ/cụm nào mang nghĩa: "Đơn vị di truyền quy định một đặc điểm của cơ thể"?'},
    "gene_v11": {"prompt": 'Gõ từ tiếng Anh có nghĩa: "Đơn vị di truyền quy định một đặc điểm của cơ thể"  {{audio}}',
                 "explain": "Gene — đơn vị di truyền quy định một đặc điểm của cơ thể."},
    # gap sentences that print the answer next to the blank.
    "interpret_v5": {"prompt": "She works as a professional ____, turning diplomats' speeches into English in real time."},
    "processed_v13": {"prompt": "____ food is high in salt.",
                      "hint": 'Nghĩa: "Qua chế biến (công nghiệp)"'},
    "multinational_v12": {"prompt": "A ____ opened a factory here.",
                          "hint": 'Nghĩa: "công ty đa quốc gia"'},
}
# Card-level fixes. Applied to the loaded cards BEFORE planning (so the question
# repairs can use them) and persisted on --commit, because a future re-import
# would otherwise put the same defect straight back.
CARD_FIXES: dict[str, dict] = {
    # The gloss spells the English answer out ("Gen, gene").
    "Gene": {"definition_vi": "Đơn vị di truyền quy định một đặc điểm của cơ thể."},
    # Its only two collocations are the proverb itself and a prefix of it, so the
    # collocation MCQ had no non-circular option. Add the framing the content
    # pipeline already uses for the sibling proverb — "Prevention is better than
    # cure" carries "the saying 'prevention is better than cure'" — rather than
    # inventing a new phrase.
    "When in Rome, do as the Romans do": {"collocations": [
        "when in Rome, do as the Romans do",
        "when in Rome",
        "the saying 'when in Rome, do as the Romans do'",
    ]},
}
# gene_v1 asks "Từ **Gene** nghĩa là gì?" and its correct option was "Gen, gene" —
# the same spell-it-out leak, in an option rather than the prompt.
OPTION_FIXES: dict[str, tuple[str, str]] = {
    "gene_v1": ("Gen, gene", "Đơn vị di truyền quy định một đặc điểm của cơ thể"),
}


def _cards_by_topic() -> dict[str, dict[str, dict]]:
    rows: list[dict] = []
    start = 0
    while True:
        page = (
            supabase_admin.table("vocab_cards")
            .select("headword, topic_id, collocations, definition_vi, gloss_vi, "
                    "lists, source")
            .order("id").range(start, start + _PAGE - 1).execute()
        ).data or []
        rows.extend(page)
        if len(page) < _PAGE:
            break
        start += _PAGE
    out: dict[str, dict[str, dict]] = {}
    for c in rows:
        if c.get("lists") and not _LESSON_SRC_RE.match((c.get("source") or "").strip()):
            continue
        hw = (c.get("headword") or "").strip().lower()
        if hw and c.get("topic_id"):
            # Apply the card fixes here so the question repairs below plan against
            # the CORRECTED card (the collocation swap needs the added phrase).
            patch = CARD_FIXES.get(c.get("headword") or "")
            out.setdefault(c["topic_id"], {})[hw] = {**c, **patch} if patch else c
    return out


def _meaning(card: dict) -> str:
    return (card.get("definition_vi") or card.get("gloss_vi") or "").strip().rstrip(".")


def plan(banks: list[dict], cards_by_topic: dict) -> list[tuple[dict, dict, str]]:
    """→ [(question, patch, why)]."""
    out: list[tuple[dict, dict, str]] = []
    for b in sorted(banks, key=lambda x: x.get("code") or ""):
        questions: list[dict] = []
        start = 0
        while True:
            page = (
                supabase_admin.table("quiz_questions")
                .select("id, qid, item_key, prompt, hint, input, type, subtype, "
                        "options, answer, explain")
                .eq("bank_id", b["id"]).order("order")
                .range(start, start + _PAGE - 1).execute()
            ).data or []
            questions.extend(page)
            if len(page) < _PAGE:
                break
            start += _PAGE
        cards = cards_by_topic.get(b.get("topic_id") or "", {})

        for q in questions:
            qid = q["qid"]
            card = cards.get((q.get("item_key") or "").strip().lower()) or {}
            prompt, opts, ans = q.get("prompt") or "", q.get("options") or [], q.get("answer")

            # ── 3. hand fixes (also covers option text) ──
            if qid in HAND_FIXES:
                out.append((q, dict(HAND_FIXES[qid]), "hand-fixed prompt"))
                continue
            if qid in OPTION_FIXES and opts:
                old, new = OPTION_FIXES[qid]
                if old in opts:
                    fixed = [new if o == old else o for o in opts]
                    out.append((q, {"options": fixed}, "option spelled out the answer"))
                continue

            if q.get("input") != "choice" or not isinstance(ans, int) or not (0 <= ans < len(opts)):
                continue
            answer = _norm(opts[ans])
            if len(answer) <= 3 or not re.search(r"\b" + re.escape(answer) + r"\b", _norm(prompt)):
                continue      # no leak

            # ── 1. circular collocation ──
            if q.get("subtype") == "collocation":
                cols = [str(c) for c in (card.get("collocations") or []) if str(c).strip()]
                taken = {_norm(o) for i, o in enumerate(opts) if i != ans}
                better = next(
                    (c for c in cols
                     if _norm(c) != answer
                     and _norm(c) not in taken
                     and not re.search(r"\b" + re.escape(_norm(c)) + r"\b", _norm(prompt))),
                    None,
                )
                if better:
                    fixed = list(opts)
                    fixed[ans] = better
                    out.append((q, {"options": fixed,
                                    "explain": 'Đúng: "%s".' % better},
                                "circular collocation → real collocation"))
                else:
                    # No non-circular collocation on the card: the item cannot be
                    # made into a test, so stop it counting toward mastery rather
                    # than leaving a free credit in the loop.
                    out.append((q, {"counts_toward_mastery": False},
                                "circular collocation, no alternative → demoted"))
                continue

            # ── 2. headword in prompt (word_form / synonym / …) ──
            meaning = _meaning(card)
            if not meaning:
                logger.warning("  ! %s leaks but its card has no VN meaning — skipped", qid)
                continue
            # Replace the bolded headword with the meaning, keeping the rest of the
            # sentence (including the bolded part-of-speech) intact.
            new_prompt, n = re.subn(
                r"\*\*" + re.escape(q.get("item_key") or "") + r"\*\*",
                'từ mang nghĩa "%s"' % meaning,
                prompt, count=1,
            )
            if not n:
                logger.warning("  ! %s: headword not bolded in prompt — skipped", qid)
                continue
            out.append((q, {"prompt": new_prompt}, "headword in prompt → meaning"))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--commit", action="store_true", help="write (default: dry-run)")
    args = ap.parse_args()

    banks = (
        supabase_admin.table("quiz_banks").select("id, code, topic_id")
        .eq("skill_area", "vocab").execute()
    ).data or []
    planned = plan(banks, _cards_by_topic())

    by_why: dict[str, int] = {}
    for _q, _patch, why in planned:
        by_why[why] = by_why.get(why, 0) + 1
    logger.info("questions to repair: %d", len(planned))
    for why, n in sorted(by_why.items()):
        logger.info("  %-46s %d", why, n)
    for q, patch, why in planned:
        logger.info("  %-34s [%s]", q["qid"], why)
        for k, v in patch.items():
            logger.info("      %s: %r", k, v)

    if not args.commit:
        logger.info("DRY-RUN — nothing written. Re-run with --commit.")
        return

    ok = fail = 0
    for q, patch, _why in planned:
        try:
            supabase_admin.table("quiz_questions").update(patch).eq("id", q["id"]).execute()
            ok += 1
        except Exception as exc:  # noqa: BLE001
            fail += 1
            logger.error("  ✗ %s — %s", q["qid"], exc)
    for headword, patch in CARD_FIXES.items():
        try:
            supabase_admin.table("vocab_cards").update(patch).eq("headword", headword).execute()
            logger.info("  ✓ card %s — %s", headword, ", ".join(patch))
        except Exception as exc:  # noqa: BLE001
            fail += 1
            logger.error("  ✗ card %s — %s", headword, exc)
    logger.info("Done. updated=%d failed=%d", ok, fail)


if __name__ == "__main__":
    main()
