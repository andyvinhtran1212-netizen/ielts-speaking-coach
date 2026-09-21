"""scripts/pregen_vocab_audio.py — Slice-2 vocab audio pregen.

For every vocab_cards row missing audio: TTS the headword (+ example) → upload to
the `vocab-audio` bucket (content-addressed, hash-skip) → stamp audio_headword /
audio_example / audio_status='final'. After a commit run, vocab_service.reload()
so the grid serves the new audio_url without a restart (G1).

    cd backend && python -m scripts.pregen_vocab_audio              # DRY-RUN (default)
    cd backend && python -m scripts.pregen_vocab_audio --commit     # actually synth + write
    cd backend && python -m scripts.pregen_vocab_audio --commit --headword-only
    cd backend && python -m scripts.pregen_vocab_audio --commit --regen   # re-synth ALL (after the padding fix)
    cd backend && python -m scripts.pregen_vocab_audio --commit --regen \
        --topic-cards-only --engine kokoro --voice bf_emma

DRY-RUN (default) calls NO TTS and writes NOTHING — it prints how many audios
would be generated + an estimated char count / cost so the operator can sanity-
check the run. --commit then does the work;
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
            .select("id,slug,headword,example,lists,source,audio_headword,audio_example,audio_status")
            .order("id").range(start, start + _PAGE - 1).execute()
        )
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < _PAGE:
            return rows
        start += _PAGE


def _rows_needing_audio(
    regen: bool = False,
    *,
    topic_cards_only: bool = False,
) -> list[dict]:
    rows = _all_vocab_rows()
    if topic_cards_only:
        # Match the canonical topic-surface gate in vocab_content: pure exam-list
        # imports are not shown under /vocabulary/hub#vocab-topics, while curated
        # lesson cards that also belong to an exam list stay visible.
        rows = [r for r in rows if not vocab_service._is_exam_only(r)]
    if regen:
        # --regen: reprocess EVERY row with a headword so existing (possibly
        # edge-clipped) audio is re-synthesised at the new padded path + re-stamped.
        return [r for r in rows if (r.get("headword") or "").strip()]
    # A word needs work unless it's already 'final' with a headword audio URL.
    return [r for r in rows
            if r.get("audio_status") != "final" or not r.get("audio_headword")]


def _resolved_voice(engine: str, voice: str | None) -> str:
    if voice:
        return voice
    if engine == "kokoro":
        return tts_audio.KOKORO_DEFAULT_VOICE
    return tts_audio.DEFAULT_VOICE


async def _get_or_create(text: str, *, engine: str, voice: str) -> tuple[str, bool]:
    if engine == "openai":
        return await tts_audio.get_or_create_audio(text, voice)
    # Kokoro is a local/blocking sync path. This operator script intentionally
    # renders one clip at a time so a single shared model is reused safely and
    # each completed card is durably checkpointed in the DB.
    return tts_audio.get_or_create_audio_sync(text, engine, voice)


def _dry_run(
    rows: list[dict],
    *,
    headword_only: bool,
    regen: bool = False,
    engine: str = "openai",
    voice: str | None = None,
) -> None:
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
    cost = total_chars / 1000 * _TTS_PER_1K_USD if engine == "openai" else 0.0
    logger.info("DRY-RUN — no TTS calls, nothing written.")
    logger.info("  engine / voice      : %s / %s", engine, _resolved_voice(engine, voice))
    logger.info("  words needing audio : %d", n_words)
    logger.info("  audio clips to gen  : %d (%s)", n_audios,
                "headword only" if headword_only else "headword + example")
    logger.info("  est. characters     : %d", total_chars)
    logger.info("  est. cost            : ~$%.4f%s", cost,
                " (local Kokoro)" if engine == "kokoro" else "")
    logger.info("Re-run with --commit to generate.")


async def _commit(
    rows: list[dict],
    *,
    headword_only: bool,
    regen: bool = False,
    engine: str = "openai",
    voice: str | None = None,
) -> None:
    gen = skip = errors = stamped = 0
    resolved_voice = _resolved_voice(engine, voice)
    for r in rows:
        slug = r["slug"]
        hw = (r.get("headword") or "").strip()
        ex = (r.get("example") or "").strip()
        stamp: dict = {}
        try:
            if hw and (regen or not r.get("audio_headword")):
                url, did = await _get_or_create(hw, engine=engine, voice=resolved_voice)
                stamp["audio_headword"] = url
                if did:
                    gen += 1
                    if engine == "openai":
                        ai_usage_logger.log_tts(user_id=None, session_id=None,
                                                model="tts-1", text_chars=len(hw))
                else:
                    skip += 1

            if not headword_only and ex and (regen or not r.get("audio_example")):
                url, did = await _get_or_create(ex, engine=engine, voice=resolved_voice)
                stamp["audio_example"] = url
                if did:
                    gen += 1
                    if engine == "openai":
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

    logger.info("Done. engine=%s voice=%s generated=%d skip(hash-hit)=%d rows-stamped=%d errors=%d",
                engine, resolved_voice, gen, skip, stamped, errors)
    # G1 — refresh the in-memory grid so the new audio URLs are served live.
    try:
        vocab_service.reload()
        logger.info("vocab_service reloaded — grid serves new audio without restart.")
    except Exception as exc:  # noqa: BLE001
        logger.warning("reload after pregen failed (non-fatal): %s", exc)


def main() -> None:
    ap = argparse.ArgumentParser(description="Pregenerate vocab headword/example audio.")
    ap.add_argument("--commit", action="store_true",
                    help="call the selected TTS engine and write results (default: dry-run).")
    ap.add_argument("--headword-only", action="store_true",
                    help="generate only headword audio (defer examples).")
    ap.add_argument("--regen", action="store_true",
                    help="re-synthesise audio for ALL rows (even already-final) and "
                         "re-stamp the URLs — use after a synth/post-process change "
                         "(e.g. the silence-padding fix) to replace existing clipped clips.")
    ap.add_argument("--engine", choices=("openai", "kokoro"),
                    default="openai", help="TTS engine (default: openai).")
    ap.add_argument("--voice", default=None,
                    help="Voice id; defaults to bf_emma for Kokoro and nova for OpenAI.")
    ap.add_argument("--topic-cards-only", action="store_true",
                    help="limit the run to cards visible in Vocabulary Hub topics; "
                         "exclude pure exam-list imports.")
    args = ap.parse_args()

    if (args.engine == "openai" and args.voice
            and args.voice not in tts_audio.OPENAI_VOICES):
        allowed = ", ".join(sorted(tts_audio.OPENAI_VOICES))
        ap.error(f"unsupported OpenAI voice {args.voice!r}; choose one of: {allowed}")

    # A partial engine switch can leave one OpenAI clip and one Kokoro clip on
    # the same card because the persisted URLs do not record their engine. Keep
    # Kokoro an all-audio replacement so every card has a consistent voice.
    if args.engine == "kokoro" and (not args.regen or args.headword_only):
        ap.error("--engine kokoro requires --regen and cannot use --headword-only")

    rows = _rows_needing_audio(
        regen=args.regen,
        topic_cards_only=args.topic_cards_only,
    )
    logger.info("Found %d vocab_cards row(s) %s.", len(rows),
                "to regenerate" if args.regen else "needing audio")
    if not args.commit:
        _dry_run(rows, headword_only=args.headword_only, regen=args.regen,
                 engine=args.engine, voice=args.voice)
        return
    asyncio.run(_commit(rows, headword_only=args.headword_only, regen=args.regen,
                        engine=args.engine, voice=args.voice))


if __name__ == "__main__":
    main()
