"""Sprint 10.5 Phase 2 — augment user_d1_questions rows with MCQ options.

Phase 1 generated rows with sentence + target_answer + acceptable_variants
+ hint. Phase 2 adds an `options` JSONB column (migration 053). This
script walks rows where `options=[]` (i.e. Phase 2 hasn't run yet for
that row) and calls a cheaper distractor-only AI prompt to fill in 3
plausible distractors, then UPDATEs `options` with the shuffled
4-element array.

Cost: ~half the tokens of Phase 1 generation (no new sentence — we
reuse the existing context_sentence). 48 rows × ~1s = ~1 min runtime.

Idempotent: rows with len(options) == 4 are skipped. Re-running after
a partial-failure run picks up where it left off.

Failure modes:
  * AI returns invalid JSON / fewer than 3 distractors / distractor
    equals target → log + skip the row (counts as `errored`). Next run
    retries.
  * Supabase UPDATE fails → log + skip.

Run:
    cd backend && python -m scripts.backfill_d1_questions_mcq

Parallel pattern with backfill_d1_questions.py (Phase 1) — both walk
the table once, use admin client to bypass RLS, sleep 100ms between
AI calls.
"""

from __future__ import annotations

import json
import logging
import re
import sys
import time
from pathlib import Path

# Allow running as `python -m scripts.backfill_d1_questions_mcq` or
# directly — same path-stitch as backfill_d1_questions.py.
_BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("backfill_d1_questions_mcq")


_SLEEP_MS = 100
_HAIKU_MODEL = "claude-haiku-4-5-20251001"


_DISTRACTOR_SYSTEM_PROMPT = """You are augmenting an existing IELTS practice question with 3 multiple-choice distractor options.

Given the existing sentence and the correct answer, generate 3 distractors that:
- Are the same part of speech as the correct answer
- Would fit grammatically in the sentence where the correct answer appears
- Are clearly WRONG semantically (do NOT mean the same thing)
- Are NOT synonyms or near-synonyms of the correct answer
- Are common IELTS-level vocabulary (no obscure words)
- Are 3 DISTINCT words (no duplicates between distractors, no overlap with the correct answer)

Return STRICT JSON only (no prose, no markdown fences), exactly this shape:
{
  "distractors": ["<distractor1>", "<distractor2>", "<distractor3>"]
}"""


def _strip_json_fences(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```\s*$", "", raw)
    return raw.strip()


def _generate_distractors_for_row(row: dict) -> list[str] | None:
    """Call Haiku with the distractor-only prompt. Returns 3 cleaned
    distractors or None on any failure (caller logs + continues)."""
    try:
        import anthropic
        from config import settings
        from services.d1_question_generator import _normalize_distractors
    except Exception as e:
        logger.error("[backfill-mcq] import failed: %s", e)
        return None

    if not settings.ANTHROPIC_API_KEY:
        logger.debug("[backfill-mcq] skip — no ANTHROPIC_API_KEY")
        return None

    target = (row.get("target_answer") or "").strip().lower()
    sentence = (row.get("context_sentence") or "").strip()
    if not target or not sentence:
        return None

    user_prompt = (
        f'Sentence: "{sentence}"\n'
        f'Correct answer: "{target}"'
    )

    try:
        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        msg = client.messages.create(
            model=_HAIKU_MODEL,
            max_tokens=256,
            system=[{"type": "text", "text": _DISTRACTOR_SYSTEM_PROMPT}],
            messages=[{"role": "user", "content": user_prompt}],
        )
        raw = msg.content[0].text if msg.content else ""
    except Exception as e:
        logger.warning("[backfill-mcq] AI call failed for row id=%s: %s",
                       row.get("id"), e)
        return None

    try:
        payload = json.loads(_strip_json_fences(raw))
    except Exception as e:
        logger.warning("[backfill-mcq] invalid JSON for row id=%s: %s — head=%r",
                       row.get("id"), e, raw[:200])
        return None

    if not isinstance(payload, dict):
        return None

    return _normalize_distractors(payload.get("distractors"), target)


def _shuffled_for_row(target: str, distractors: list[str], seed: str) -> list[str]:
    """Same deterministic shuffle as the Phase 1 generator —
    Random(seed) with the headword/target as the seed string."""
    import random
    options = [target] + list(distractors)
    random.Random(seed).shuffle(options)
    return options


def main() -> int:
    from database import supabase_admin

    logger.info("Sprint 10.5 Phase 2 backfill — augment user_d1_questions with MCQ options")

    # Fetch rows without options. JSONB '[]' (empty array) is the
    # default value from migration 053; rows already filled by the
    # generator's Haiku/Gemini paths land with len(options)==4 and
    # don't need augmentation.
    rows_resp = (
        supabase_admin.table("user_d1_questions")
        .select("id, user_id, vocabulary_id, context_sentence, target_answer, options")
        .eq("is_active", True)
        .execute()
    )
    all_rows = rows_resp.data or []

    todo = [r for r in all_rows if not r.get("options") or len(r.get("options") or []) != 4]
    skipped = len(all_rows) - len(todo)

    logger.info("total alive=%d, already-have-4-options=%d → todo=%d",
                len(all_rows), skipped, len(todo))

    if not todo:
        logger.info("nothing to backfill — all rows already MCQ-ready")
        return 0

    augmented = 0
    errored = 0

    for idx, row in enumerate(todo, start=1):
        target = (row.get("target_answer") or "").strip().lower()

        distractors = _generate_distractors_for_row(row)
        if not distractors:
            errored += 1
            logger.warning("[%d/%d] row id=%s — distractor generation failed",
                           idx, len(todo), row.get("id"))
        else:
            options = _shuffled_for_row(target, distractors, seed=target)
            try:
                supabase_admin.table("user_d1_questions").update({
                    "options": options,
                }).eq("id", row["id"]).execute()
                augmented += 1
                logger.info("[%d/%d] row id=%s target=%r — augmented",
                            idx, len(todo), row.get("id"), target)
            except Exception as e:
                errored += 1
                logger.error("[%d/%d] row id=%s — UPDATE failed: %s",
                             idx, len(todo), row.get("id"), e)

        if _SLEEP_MS > 0:
            time.sleep(_SLEEP_MS / 1000.0)

        if idx % 10 == 0:
            logger.info("progress: augmented=%d errored=%d", augmented, errored)

    logger.info("DONE: todo=%d augmented=%d errored=%d already-ready=%d",
                len(todo), augmented, errored, skipped)
    return 0


if __name__ == "__main__":
    sys.exit(main())
