"""scripts/verify_vocab_quiz_health.py — re-run the 2026-07-28 audit as a gate.

Every defect class the audit found, re-checked against live data. Exits non-zero
if any survives, so it works both as the post-fix verification and as a standing
regression check.

Checks (see docs/AUDIT_VOCAB_AUDIO_PRACTICE_2026-07-28.md):
  A  audio      every card has headword audio; every example with text has audio
  B1 cue-less   no text item whose prompt carries no lexical cue AND no hint
  B2 gradeable  no accept list whose only form contains "/" or "(...)"
  B3 leaks      no MCQ whose correct option appears in its own prompt
  B4 explains   no collocation explanation that only restates the answer
  M  mastery    every word keeps ≥2 distinct counting skills and ≥1 production
                item, so the adaptive loop can still finish it
  S  structure  answer indices in range, no duplicate/empty options, accept
                present on every typed item

    cd backend && python -m scripts.verify_vocab_quiz_health
"""

from __future__ import annotations

import collections
import logging
import re
import sys

from database import supabase_admin

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("verify_vocab_quiz_health")

_PAGE = 1000
_LESSON_SRC_RE = re.compile(r"^L\d")
_AUDIO_TOKEN = "{{audio}}"
_CUE_MIN_CHARS = 12
_SUPPORTED = {"choice", "text", "boolean", "syllable"}


def _norm(s) -> str:
    return re.sub(r"\s+", " ", str(s or "").strip().lower())


def _page(table: str, select: str, order: str = "id", **eq) -> list[dict]:
    rows, start = [], 0
    while True:
        q = supabase_admin.table(table).select(select)
        for k, v in eq.items():
            q = q.eq(k, v)
        batch = q.order(order).range(start, start + _PAGE - 1).execute().data or []
        rows.extend(batch)
        if len(batch) < _PAGE:
            return rows
        start += _PAGE


def main() -> int:
    failures: list[str] = []

    def check(name: str, bad: list, sample=lambda x: x) -> None:
        if bad:
            failures.append(name)
            logger.error("✗ %-46s %d", name, len(bad))
            for b in bad[:6]:
                logger.error("      %s", sample(b))
        else:
            logger.info("✓ %-46s 0", name)

    # ── A. audio coverage ────────────────────────────────────────────
    cards = _page("vocab_cards",
                  "id, headword, example, audio_headword, audio_example, "
                  "topic_id, lists, source, collocations, definition_vi, gloss_vi")
    logger.info("vocab_cards: %d", len(cards))
    check("A1 cards missing headword audio",
          [c for c in cards if not (c.get("audio_headword") or "").strip()],
          lambda c: c.get("headword"))
    check("A2 cards with an example but no example audio",
          [c for c in cards
           if (c.get("example") or "").strip() and not (c.get("audio_example") or "").strip()],
          lambda c: c.get("headword"))

    by_topic: dict[str, dict[str, dict]] = {}
    for c in cards:
        if c.get("lists") and not _LESSON_SRC_RE.match((c.get("source") or "").strip()):
            continue
        hw = _norm(c.get("headword"))
        if hw and c.get("topic_id"):
            by_topic.setdefault(c["topic_id"], {})[hw] = c

    # ── banks + questions ────────────────────────────────────────────
    banks = (supabase_admin.table("quiz_banks")
             .select("id, code, topic_id, meta").eq("skill_area", "vocab").execute()).data or []
    cueless, ungradeable, leaks, taut, structure = [], [], [], [], []
    no_prod, few_skills, audio_missing = [], [], []
    total_q = 0

    for b in sorted(banks, key=lambda x: x.get("code") or ""):
        qs = _page("quiz_questions",
                   "qid, item_key, prompt, hint, input, type, subtype, skill, options, "
                   "segments, answer, accept, explain, counts_toward_mastery, audio_url",
                   order="order", bank_id=b["id"])
        total_q += len(qs)
        cards_here = by_topic.get(b.get("topic_id") or "", {})
        meta = b.get("meta") or {}
        ctm = int(meta.get("correct_to_master", 2) or 2)

        pools: dict[str, list[dict]] = collections.defaultdict(list)
        for q in qs:
            tag = "%s/%s" % (b.get("code"), q.get("qid"))
            prompt = q.get("prompt") or ""
            opts, ans = q.get("options") or [], q.get("answer")
            accept = q.get("accept") or []
            if q.get("input") in _SUPPORTED:
                pools[q["item_key"]].append(q)

            # S. structure
            if q.get("input") == "choice":
                names = [_norm(o) for o in opts]
                if len(opts) < 2 or not isinstance(ans, int) or not (0 <= ans < len(opts)):
                    structure.append(tag + " (bad options/answer)")
                elif len(set(names)) != len(names) or any(not str(o).strip() for o in opts):
                    structure.append(tag + " (dup/empty option)")
            if q.get("input") == "text" and not [a for a in accept if str(a).strip()]:
                structure.append(tag + " (no accept)")

            # B1. cue-less typed item with no hint
            if q.get("input") == "text":
                ctx = len(re.sub(r"_{2,}", " ", prompt).strip(" .!?,;:'\"…"))
                if ctx < _CUE_MIN_CHARS and not str(q.get("hint") or "").strip():
                    cueless.append(tag + " " + repr(prompt))
                # B2. every accepted form needs the "/"-or-"()" escape hatch
                forms = [str(a) for a in accept if str(a).strip()]
                if forms and all(("/" in f or "(" in f) for f in forms):
                    ungradeable.append(tag + " " + repr(forms))

            # B3. leak — the correct option appears in the prompt
            if q.get("input") == "choice" and isinstance(ans, int) and 0 <= ans < len(opts):
                a = _norm(opts[ans])
                if len(a) > 3 and re.search(r"\b" + re.escape(a) + r"\b", _norm(prompt)):
                    leaks.append(tag + " ans=" + repr(opts[ans]))
                # B4. explanation that only restates the answer
                if q.get("subtype") == "collocation":
                    body = re.sub(r"^(đúng|đáp án)\s*[::]\s*", "",
                                  _norm(q.get("explain"))).strip('"“”. ')
                    if body == a:
                        taut.append(tag)

            # audio question with no resolvable source
            if _AUDIO_TOKEN in prompt:
                live = (cards_here.get(_norm(q.get("item_key")), {}) or {}).get("audio_headword")
                if not (live or q.get("audio_url")):
                    audio_missing.append(tag)

        # M. mastery reachability
        for key, pool in pools.items():
            counting = [q for q in pool if q.get("counts_toward_mastery") is not False]
            if not any(q["input"] == "text" for q in counting):
                no_prod.append("%s/%s" % (b.get("code"), key))
            if len({q.get("skill") for q in counting}) < ctm:
                few_skills.append("%s/%s" % (b.get("code"), key))

    logger.info("vocab banks: %d | questions: %d", len(banks), total_q)
    check("B1 cue-less typed items with no hint", cueless)
    check("B2 items whose every accepted form needs a slash/paren", ungradeable)
    check("B3 MCQs whose answer appears in the prompt", leaks)
    check("B4 collocation explanations that restate the answer", taut)
    check("M1 words with no production item (unmasterable)", no_prod)
    check("M2 words with too few distinct counting skills", few_skills)
    check("S1 structurally broken questions", structure)
    check("A3 audio questions with no resolvable audio", audio_missing)

    if failures:
        logger.error("\nFAILED: %d check(s) — %s", len(failures), ", ".join(failures))
        return 1
    logger.info("\nAll checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
