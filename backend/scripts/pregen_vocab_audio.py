"""scripts/pregen_vocab_audio.py — Kokoro-only Vocabulary audio preparation.

For every vocab_cards row missing the current bf_emma audio: TTS the headword (+ example) → upload to
the `vocab-audio` bucket (content-addressed, hash-skip) → stamp audio_headword /
audio_example / audio_status='final'. After rows are stamped, the local vocab
service is reloaded and Next's `public:vocabulary` cache is invalidated through the
same signed helper the admin write path uses (skip with --no-invalidate). The
deployed backend's in-memory index has no remote reload hook: the script prints
the manual step for it.

    cd backend && python -m scripts.pregen_vocab_audio              # DRY-RUN (default)
    cd backend && python -m scripts.pregen_vocab_audio --commit     # actually synth + write
    cd backend && python -m scripts.pregen_vocab_audio --commit --headword-only
    cd backend && python -m scripts.pregen_vocab_audio --commit --no-invalidate   # local run
    cd backend && python -m scripts.pregen_vocab_audio --commit --regen   # re-synth ALL (after the padding fix)
    cd backend && python -m scripts.pregen_vocab_audio --commit --regen \
        --topic-cards-only --engine kokoro --voice bf_emma

DRY-RUN (default) calls NO TTS and writes NOTHING — it prints how many audios
would be generated + an estimated char count / cost so the operator can sanity-
check the run. --commit then does the work;
hash-skip means a re-run regenerates nothing already done (idempotent).

PREREQUISITE: a local Kokoro runtime, ffmpeg and the public `vocab-audio` bucket. If it is
missing, --commit fails LOUDLY on the first upload (Bucket not found) rather than
silently — fix the bucket and re-run.
"""

from __future__ import annotations

import argparse
import asyncio
import logging

from database import supabase_admin
from services import tts_audio
from services.public_cache_invalidation import VOCABULARY_CACHE_TAG, invalidate_vocabulary_cache
from services.vocab_content import vocab_service

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("pregen_vocab_audio")

_ENGINE = "kokoro"
_VOICE = "bf_emma"


_PAGE = 1000   # PostgREST caps a single response at ~1000 rows

_MANUAL_NEXT_INVALIDATION = (
    'cd backend && python -c "from services.public_cache_invalidation import '
    'invalidate_vocabulary_cache as f; raise SystemExit(0 if f() else 1)"'
)
_MANUAL_BACKEND_RELOAD = (
    "send one no-op PATCH /admin/vocabulary/{id} (unchanged value) to the deployed "
    "backend — it reloads that process and re-invalidates Next — or restart the deployment"
)


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
    return [r for r in rows if _needs(r, "headword") or _needs(r, "example")
            or r.get("audio_status") != "final"]


def _expected(text: str) -> str:
    return tts_audio.public_url(tts_audio.audio_path(text.strip(), _VOICE, _ENGINE))


def _needs(row: dict, field: str, regen: bool = False) -> bool:
    text = (row.get(field) or "").strip()
    return bool(text) and (regen or row.get("audio_" + field) != _expected(text))


def _resolved_voice(engine: str, voice: str | None) -> str:
    if engine != _ENGINE or voice not in (None, _VOICE):
        raise ValueError("Vocabulary audio requires Kokoro bf_emma")
    return _VOICE


async def _get_or_create(text: str, *, engine: str, voice: str) -> tuple[str, bool]:
    _resolved_voice(engine, voice)
    return tts_audio.get_or_create_audio_sync(text, engine, voice)


def _dry_run(
    rows: list[dict],
    *,
    headword_only: bool,
    regen: bool = False,
    engine: str = "kokoro",
    voice: str | None = None,
) -> None:
    n_words = 0
    total_chars = 0
    n_audios = 0
    for r in rows:
        hw = (r.get("headword") or "").strip()
        ex = (r.get("example") or "").strip()
        will = 0
        if _needs(r, "headword", regen):
            total_chars += len(hw); will += 1
        if not headword_only and _needs(r, "example", regen):
            total_chars += len(ex); will += 1
        if will:
            n_words += 1
            n_audios += will
    cost = 0.0
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
    engine: str = "kokoro",
    voice: str | None = None,
    invalidate: bool = True,
) -> None:
    gen = skip = errors = stamped = 0
    resolved_voice = _resolved_voice(engine, voice)
    for r in rows:
        slug = r["slug"]
        hw = (r.get("headword") or "").strip()
        ex = (r.get("example") or "").strip()
        stamp: dict = {}
        try:
            if _needs(r, "headword", regen):
                url, did = await _get_or_create(hw, engine=engine, voice=resolved_voice)
                stamp["audio_headword"] = url
                if did:
                    gen += 1
                else:
                    skip += 1

            if not headword_only and _needs(r, "example", regen):
                url, did = await _get_or_create(ex, engine=engine, voice=resolved_voice)
                stamp["audio_example"] = url
                if did:
                    gen += 1
                else:
                    skip += 1

            # Mark 'final' only when the headword audio exists AND the example is
            # not still pending (either generated, none to gen, or — in
            # --headword-only mode — deliberately deferred → stays non-final).
            has_hw = bool(hw) and (stamp.get("audio_headword") or r.get("audio_headword")) == _expected(hw)
            example_pending = bool(ex) and (stamp.get("audio_example") or r.get("audio_example")) != _expected(ex)
            if has_hw and not example_pending:
                stamp["audio_status"] = "final"
            elif stamp:
                stamp["audio_status"] = "pending"

            if stamp:
                # Stamp by stable id, not slug: a slug may now be shared across
                # categories (mig 122), and example audio differs per card — an
                # eq("slug") update would clobber the wrong row's example audio.
                query = supabase_admin.table("vocab_cards").update(stamp).eq("id", r["id"])
                # A long render must not attach old speech after an admin edits
                # the word/example. Leave that row for a fresh batch instead.
                for field in ("headword", "example"):
                    value = r.get(field)
                    query = query.is_(field, "null") if value is None else query.eq(field, value)
                result = query.execute()
                if len(result.data or []) != 1 or result.data[0].get("id") != r["id"]:
                    raise RuntimeError("Source changed during audio preparation; reload and retry")
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
        logger.info("Local vocab_service reloaded.")
    except Exception as exc:  # noqa: BLE001
        logger.warning("reload after pregen failed (non-fatal): %s", exc)
    _refresh_deployed_readers(stamped, invalidate=invalidate)
    if errors:
        raise RuntimeError(f"{errors} Vocabulary audio row(s) failed; rerun to resume")


def _refresh_deployed_readers(stamped: int, *, invalidate: bool) -> None:
    """Expire Next's public vocabulary reads after a write, like the admin path.

    Best-effort: a failed or unconfigured invalidation never changes the batch
    outcome (the rows are already written), but it is reported with the manual
    command. The deployed backend keeps its own in-memory index and has no remote
    reload hook, so its manual step is always printed after a write.
    """
    if not stamped:
        logger.info("No rows stamped; deployed caches left untouched.")
        return
    if not invalidate:
        logger.warning("--no-invalidate: Next cache tag %s NOT invalidated. Run with the "
                       "target environment's config: %s", VOCABULARY_CACHE_TAG,
                       _MANUAL_NEXT_INVALIDATION)
    else:
        try:
            ok = invalidate_vocabulary_cache()
        except Exception as exc:  # noqa: BLE001 — cache freshness must not undo DB writes
            logger.warning("Next cache invalidation raised %s", type(exc).__name__)
            ok = False
        if ok:
            logger.info("Next cache tag %s invalidated.", VOCABULARY_CACHE_TAG)
        else:
            logger.warning("WARNING: Next cache tag %s NOT invalidated (unconfigured or "
                           "request failed). Run with the target environment's config: %s",
                           VOCABULARY_CACHE_TAG, _MANUAL_NEXT_INVALIDATION)
    logger.warning("Deployed backend still serves its previous in-memory vocabulary index; "
                   "to publish the new audio %s.", _MANUAL_BACKEND_RELOAD)


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
    ap.add_argument("--engine", choices=("kokoro",), default="kokoro",
                    help="Vocabulary uses Kokoro only.")
    ap.add_argument("--voice", choices=("bf_emma",), default="bf_emma",
                    help="Vocabulary uses British bf_emma only.")
    ap.add_argument("--topic-cards-only", action="store_true",
                    help="limit the run to cards visible in Vocabulary Hub topics; "
                         "exclude pure exam-list imports.")
    ap.add_argument("--no-invalidate", action="store_true",
                    help="skip the Next public:vocabulary cache invalidation after "
                         "--commit (local runs); the manual command is printed instead.")
    args = ap.parse_args()

    if args.regen and args.headword_only:
        ap.error("--regen cannot use --headword-only; regenerate both clips")

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
                        engine=args.engine, voice=args.voice,
                        invalidate=not args.no_invalidate))


if __name__ == "__main__":
    main()
