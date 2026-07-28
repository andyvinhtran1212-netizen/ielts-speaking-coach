"""scripts/gen_vocab_listening_questions.py — add a listen-and-choose item per word.

Audit 2026-07-28 (§ audio coverage). Every one of the 1 835 vocab cards has a
working pregenerated mp3 (3 569 URLs, all HTTP 200), but the Quick-Check banks
use audio on exactly ONE question per word — the `spelling` item, 1 of ~12. A
learner can master a whole lesson having heard each word once.

This adds a second audio item per word: hear the word, choose its Vietnamese
meaning. Nothing is invented — the prompt is fixed, the correct option is the
word's own meaning, and the distractors are meanings of OTHER words in the same
bank (the same pool the existing meaning MCQ draws from). The distractor picks
and the answer position are derived from the qid, so re-running is idempotent
and produces identical rows.

`skill` is a NEW value, `listening`. That matters: mastery needs
`correct_to_master` DISTINCT skills, so a new skill only ever widens the paths
to mastery — it can never strand a word that could previously be mastered.

    cd backend && python -m scripts.gen_vocab_listening_questions            # DRY-RUN
    cd backend && python -m scripts.gen_vocab_listening_questions --commit
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import re

from database import supabase_admin

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("gen_vocab_listening_questions")

_PAGE = 1000
_LESSON_SRC_RE = re.compile(r"^L\d")
_QID_SUFFIX = "_listen"
_N_OPTIONS = 4
_PROMPT = "Nghe và chọn nghĩa đúng của từ bạn vừa nghe:  {{audio}}"


def _norm(s) -> str:
    return re.sub(r"\s+", " ", str(s or "").strip().lower())


def _stable(seed: str, n: int) -> int:
    """Deterministic 0..n-1 from a string — same input, same row, every run."""
    return int(hashlib.sha256(seed.encode("utf-8")).hexdigest(), 16) % n


def _meaning(card: dict) -> str:
    return (card.get("definition_vi") or card.get("gloss_vi") or "").strip().rstrip(".")


def _cards_by_topic() -> dict[str, list[dict]]:
    rows: list[dict] = []
    start = 0
    while True:
        page = (
            supabase_admin.table("vocab_cards")
            .select("headword, topic_id, definition_vi, gloss_vi, audio_headword, "
                    "lists, source")
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


def build_rows(bank: dict, questions: list[dict], cards: list[dict]) -> list[dict]:
    """One listening item per word in the bank that has audio AND a meaning."""
    existing_qids = {q["qid"] for q in questions}
    next_order = max((q.get("order") or 0) for q in questions) + 1 if questions else 1

    # The bank's words, in bank order, paired with their card.
    by_head = {_norm(c.get("headword")): c for c in cards}
    seen: list[str] = []
    for q in sorted(questions, key=lambda x: x.get("order") or 0):
        k = q.get("item_key")
        if k and k not in seen:
            seen.append(k)

    # Meaning pool for distractors — every word in THIS bank that has one.
    pool = [(k, _meaning(by_head.get(_norm(k), {}))) for k in seen]
    pool = [(k, m) for k, m in pool if m]

    rows: list[dict] = []
    for item_key in seen:
        card = by_head.get(_norm(item_key))
        if not card:
            continue
        meaning, audio = _meaning(card), (card.get("audio_headword") or "").strip()
        if not meaning or not audio:
            continue
        # Base qid from the word's own questions, so the new one sorts with them.
        base = next((q["qid"].rsplit("_v", 1)[0] for q in questions
                     if q.get("item_key") == item_key and "_v" in q.get("qid", "")), None)
        if not base:
            continue
        qid = base + _QID_SUFFIX
        if qid in existing_qids:
            continue                     # already generated — idempotent re-run

        # Distractors: walk the bank's meaning pool from a qid-derived offset so
        # the set is stable but differs from the written meaning MCQ's.
        others = [m for k, m in pool
                  if _norm(k) != _norm(item_key) and _norm(m) != _norm(meaning)]
        if len(others) < _N_OPTIONS - 1:
            continue                     # too small a bank to build a real MCQ
        start = _stable(qid + ":offset", len(others))
        picked: list[str] = []
        i = 0
        while len(picked) < _N_OPTIONS - 1 and i < len(others):
            cand = others[(start + i) % len(others)]
            if cand not in picked:
                picked.append(cand)
            i += 1
        if len(picked) < _N_OPTIONS - 1:
            continue

        answer = _stable(qid + ":pos", _N_OPTIONS)
        options = list(picked)
        options.insert(answer, meaning)

        rows.append({
            "bank_id": bank["id"], "qid": qid, "item_key": item_key,
            "type": "mcq", "subtype": "listen_meaning", "input": "choice",
            "skill": "listening", "pair": "meaning",
            "counts_toward_mastery": True,
            "prompt": _PROMPT,
            "options": options, "answer": answer,
            "explain": "%s — %s." % (item_key, meaning),
            "points": 1,
            "audio_url": audio,
            "order": next_order,
        })
        next_order += 1
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--commit", action="store_true", help="write (default: dry-run)")
    args = ap.parse_args()

    banks = (
        supabase_admin.table("quiz_banks").select("id, code, topic_id")
        .eq("skill_area", "vocab").execute()
    ).data or []
    cards_by_topic = _cards_by_topic()

    all_rows: list[dict] = []
    for b in sorted(banks, key=lambda x: x.get("code") or ""):
        questions: list[dict] = []
        start = 0
        while True:
            page = (
                supabase_admin.table("quiz_questions")
                .select("qid, item_key, order").eq("bank_id", b["id"])
                .order("order").range(start, start + _PAGE - 1).execute()
            ).data or []
            questions.extend(page)
            if len(page) < _PAGE:
                break
            start += _PAGE
        rows = build_rows(b, questions, cards_by_topic.get(b.get("topic_id") or "", []))
        words = len({q.get("item_key") for q in questions})
        logger.info("%-5s %3d/%3d words get a listening item", b.get("code"), len(rows), words)
        all_rows.extend(rows)

    logger.info("listening questions to insert: %d", len(all_rows))
    for r in all_rows[:5]:
        logger.info("  %s | %r | ans=%d | %s", r["qid"], r["options"], r["answer"],
                    r["audio_url"].rsplit("/", 1)[-1])

    if not args.commit:
        logger.info("DRY-RUN — nothing written. Re-run with --commit.")
        return

    ok = fail = 0
    for i in range(0, len(all_rows), 200):
        chunk = all_rows[i:i + 200]
        try:
            supabase_admin.table("quiz_questions").insert(chunk).execute()
            ok += len(chunk)
        except Exception as exc:  # noqa: BLE001
            fail += len(chunk)
            logger.error("  ✗ chunk %d — %s", i // 200, exc)
    logger.info("Done. inserted=%d failed=%d", ok, fail)


if __name__ == "__main__":
    main()
