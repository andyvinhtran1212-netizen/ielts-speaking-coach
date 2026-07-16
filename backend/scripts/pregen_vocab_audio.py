"""scripts/pregen_vocab_audio.py — Slice-2 vocab audio pregen.

For every vocab_cards row missing audio: TTS the headword (+ example) → upload to
the `vocab-audio` bucket (content-addressed, hash-skip) → stamp audio_headword /
audio_example / audio_status='final'. After a commit run, vocab_service.reload()
so the grid serves the new audio_url without a restart (G1).

    cd backend && python -m scripts.pregen_vocab_audio              # DRY-RUN (default)
    cd backend && python -m scripts.pregen_vocab_audio --commit     # actually synth + write
    cd backend && python -m scripts.pregen_vocab_audio --commit --headword-only
    cd backend && python -m scripts.pregen_vocab_audio --commit --regen   # re-synth ALL (after the padding fix)

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


_PAGE = 1000   # PostgREST caps a single response at ~1000 rows


def _all_vocab_rows() -> list[dict]:
    """Every vocab_cards row, paged.

    A bare select() is capped at ~1000 rows by PostgREST and truncates SILENTLY:
    the script then logs a plausible count and finishes green while never even
    CONSIDERING the rest. Measured 2026-07-16: 1000 of 1835 rows seen, 835
    invisible — including 4 lesson words the vocab quiz actually serves, whose
    audio therefore never got generated. Same cap class as PR #666
    (vocab_content._load_from_db).
    """
    rows: list[dict] = []
    start = 0
    while True:
        # order() on the PK gives a STABLE total order across page requests —
        # without it PostgREST/Postgres don't guarantee row order, so a
        # concurrent import could shift a row between offsets and duplicate one
        # while skipping another.
        res = (
            supabase_admin.table("vocab_cards")
            .select("id,slug,headword,example,audio_headword,audio_example,audio_status")
            .order("id").range(start, start + _PAGE - 1).execute()
        )
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < _PAGE:
            return rows
        start += _PAGE


def _rows_needing_audio(regen: bool = False) -> list[dict]:
    rows = _all_vocab_rows()
    if regen:
        # --regen: reprocess EVERY row with a headword so existing (possibly
        # edge-clipped) audio is re-synthesised at the new padded path + re-stamped.
        return [r for r in rows if (r.get("headword") or "").strip()]
    # A word needs work unless it's already 'final' with a headword audio URL.
    return [r for r in rows
            if r.get("audio_status") != "final" or not r.get("audio_headword")]


def _dry_run(rows: list[dict], *, headword_only: bool, regen: bool = False) -> None:
    n_words = 0
    total_chars = 0
    n_audios = 0
    for r in rows:
        hw = (r.get("headword") or "").strip()
        ex = (r.get("example") or "").strip()
        will = 0
        if hw and (regen or not r.get("audio_headword")):
            total_chars += len(hw); will += 1
        if not headword_only and ex and (regen or not r.get("audio_example")):
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


async def _commit(rows: list[dict], *, headword_only: bool, regen: bool = False) -> None:
    gen = skip = errors = stamped = 0
    for r in rows:
        slug = r["slug"]
        hw = (r.get("headword") or "").strip()
        ex = (r.get("example") or "").strip()
        stamp: dict = {}
        try:
            if hw and (regen or not r.get("audio_headword")):
                url, did = await tts_audio.get_or_create_audio(hw)
                stamp["audio_headword"] = url
                if did:
                    gen += 1
                    ai_usage_logger.log_tts(user_id=None, session_id=None,
                                            model="tts-1", text_chars=len(hw))
                else:
                    skip += 1

            if not headword_only and ex and (regen or not r.get("audio_example")):
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
                # Stamp by stable id, not slug: a slug may now be shared across
                # categories (mig 122), and example audio differs per card — an
                # eq("slug") update would clobber the wrong row's example audio.
                supabase_admin.table("vocab_cards").update(stamp).eq("id", r["id"]).execute()
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
    ap.add_argument("--regen", action="store_true",
                    help="re-synthesise audio for ALL rows (even already-final) and "
                         "re-stamp the URLs — use after a synth/post-process change "
                         "(e.g. the silence-padding fix) to replace existing clipped clips.")
    args = ap.parse_args()

    rows = _rows_needing_audio(regen=args.regen)
    logger.info("Found %d vocab_cards row(s) %s.", len(rows),
                "to regenerate" if args.regen else "needing audio")
    if not args.commit:
        _dry_run(rows, headword_only=args.headword_only, regen=args.regen)
        return
    asyncio.run(_commit(rows, headword_only=args.headword_only, regen=args.regen))


if __name__ == "__main__":
    main()
