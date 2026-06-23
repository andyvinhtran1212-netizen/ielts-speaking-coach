"""scripts/pregen_vocab_audio.py — Slice-2 vocab audio pregen.

For every vocab_cards row missing audio: TTS the headword (+ example) → upload to
the `vocab-audio` bucket (content-addressed, hash-skip) → stamp audio_headword /
audio_example / audio_status='final'. After a commit run, vocab_service.reload()
so the grid serves the new audio_url without a restart (G1).

    cd backend && python -m scripts.pregen_vocab_audio              # DRY-RUN (default)
    cd backend && python -m scripts.pregen_vocab_audio --commit     # actually synth + write
    cd backend && python -m scripts.pregen_vocab_audio --commit --headword-only

DRY-RUN (default) calls NO TTS and writes NOTHING — it prints how many audios
would be generated + an estimated char count / cost so the operator can sanity-
check spend before paying for real OpenAI calls. --commit then does the work;
hash-skip means a re-run regenerates nothing already done (idempotent).

PREREQUISITE: Andy creates the public `vocab-audio` bucket by hand first. If it's
missing, --commit fails LOUDLY on the first upload (Bucket not found) rather than
silently — fix the bucket and re-run.
"""

from __future__ import annotations

import argparse
import asyncio
import logging

from database import supabase_admin
from services import ai_usage_logger, tts_audio
from services.vocab_content import vocab_service

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("pregen_vocab_audio")

_TTS_PER_1K_USD = 0.015   # tts-1 pricing


def _rows_needing_audio() -> list[dict]:
    res = (
        supabase_admin.table("vocab_cards")
        .select("slug,headword,example,audio_headword,audio_example,audio_status")
        .execute()
    )
    rows = res.data or []
    # A word needs work unless it's already 'final' with a headword audio URL.
    return [r for r in rows
            if r.get("audio_status") != "final" or not r.get("audio_headword")]


def _dry_run(rows: list[dict], *, headword_only: bool) -> None:
    n_words = 0
    total_chars = 0
    n_audios = 0
    for r in rows:
        hw = (r.get("headword") or "").strip()
        ex = (r.get("example") or "").strip()
        will = 0
        if hw and not r.get("audio_headword"):
            total_chars += len(hw); will += 1
        if not headword_only and ex and not r.get("audio_example"):
            total_chars += len(ex); will += 1
        if will:
            n_words += 1
            n_audios += will
    cost = total_chars / 1000 * _TTS_PER_1K_USD
    logger.info("DRY-RUN — no TTS calls, nothing written.")
    logger.info("  words needing audio : %d", n_words)
    logger.info("  audio clips to gen  : %d (%s)", n_audios,
                "headword only" if headword_only else "headword + example")
    logger.info("  est. characters     : %d", total_chars)
    logger.info("  est. cost (tts-1)   : ~$%.4f", cost)
    logger.info("Re-run with --commit to generate.")


async def _commit(rows: list[dict], *, headword_only: bool) -> None:
    gen = skip = errors = stamped = 0
    for r in rows:
        slug = r["slug"]
        hw = (r.get("headword") or "").strip()
        ex = (r.get("example") or "").strip()
        stamp: dict = {}
        try:
            if hw and not r.get("audio_headword"):
                url, did = await tts_audio.get_or_create_audio(hw)
                stamp["audio_headword"] = url
                if did:
                    gen += 1
                    ai_usage_logger.log_tts(user_id=None, session_id=None,
                                            model="tts-1", text_chars=len(hw))
                else:
                    skip += 1

            if not headword_only and ex and not r.get("audio_example"):
                url, did = await tts_audio.get_or_create_audio(ex)
                stamp["audio_example"] = url
                if did:
                    gen += 1
                    ai_usage_logger.log_tts(user_id=None, session_id=None,
                                            model="tts-1", text_chars=len(ex))
                else:
                    skip += 1

            # Mark 'final' only when the headword audio exists AND the example is
            # not still pending (either generated, none to gen, or — in
            # --headword-only mode — deliberately deferred → stays non-final).
            has_hw = bool(r.get("audio_headword") or stamp.get("audio_headword"))
            example_pending = bool(ex) and not (r.get("audio_example") or stamp.get("audio_example"))
            if has_hw and not example_pending:
                stamp["audio_status"] = "final"

            if stamp:
                supabase_admin.table("vocab_cards").update(stamp).eq("slug", slug).execute()
                stamped += 1
                logger.info("  ✓ %s — %s", slug, ", ".join(sorted(stamp)))
        except Exception as exc:  # noqa: BLE001 — one bad word shouldn't stop the batch
            errors += 1
            logger.error("  ✗ %s — %s", slug, exc)

    logger.info("Done. generated=%d skip(hash-hit)=%d rows-stamped=%d errors=%d",
                gen, skip, stamped, errors)
    # G1 — refresh the in-memory grid so the new audio URLs are served live.
    try:
        vocab_service.reload()
        logger.info("vocab_service reloaded — grid serves new audio without restart.")
    except Exception as exc:  # noqa: BLE001
        logger.warning("reload after pregen failed (non-fatal): %s", exc)


def main() -> None:
    ap = argparse.ArgumentParser(description="Pregenerate vocab headword/example audio.")
    ap.add_argument("--commit", action="store_true",
                    help="actually call OpenAI TTS + write (default: dry-run).")
    ap.add_argument("--headword-only", action="store_true",
                    help="generate only headword audio (defer examples).")
    args = ap.parse_args()

    rows = _rows_needing_audio()
    logger.info("Found %d vocab_cards row(s) needing audio.", len(rows))
    if not args.commit:
        _dry_run(rows, headword_only=args.headword_only)
        return
    asyncio.run(_commit(rows, headword_only=args.headword_only))


if __name__ == "__main__":
    main()
