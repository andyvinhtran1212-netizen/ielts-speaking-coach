"""Slice-2 — vocab audio pregen + tts_audio hash-skip.

No real OpenAI / Supabase: synthesize_mp3, the bucket helpers, and the DB are all
mocked. Covers: get_or_create_audio hash-skip (no synth when the object exists),
pregen --commit stamping audio_headword/audio_example/status=final, --headword-only
deferral, dry-run writing nothing, and the schema-aware col-match (#538) — the
stamp keys must be ⊆ migration 110 columns.
"""

from __future__ import annotations

import asyncio
import io
import re
import shutil
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import scripts.pregen_vocab_audio as pg
import services.tts_audio as ta

_ROW = {
    "slug": "holistic", "headword": "Holistic", "example": "A holistic approach helps.",
    "audio_headword": None, "audio_example": None, "audio_status": "pending",
}


# ── tts_audio: hash-skip ────────────────────────────────────────────────


def test_get_or_create_audio_hash_skip_no_synth():
    synth = AsyncMock()
    with patch("services.tts_audio.audio_exists", return_value=True), \
         patch("services.tts_audio.public_url", return_value="https://x/h.mp3"), \
         patch("services.tts_audio.synthesize_mp3", synth), \
         patch("services.tts_audio.upload_mp3") as up:
        url, did = asyncio.run(ta.get_or_create_audio("Holistic"))
    assert url == "https://x/h.mp3"
    assert did is False
    synth.assert_not_awaited()      # the expensive call is skipped
    up.assert_not_called()


def test_get_or_create_audio_synths_and_uploads_when_absent():
    with patch("services.tts_audio.audio_exists", return_value=False), \
         patch("services.tts_audio.public_url", return_value="https://x/h.mp3"), \
         patch("services.tts_audio.synthesize_mp3", AsyncMock(return_value=b"ID3mp3")) as synth, \
         patch("services.tts_audio.upload_mp3") as up:
        url, did = asyncio.run(ta.get_or_create_audio("Holistic"))
    assert did is True
    synth.assert_awaited_once()
    up.assert_called_once()


def test_audio_path_is_stable_and_voice_sensitive():
    a = ta.audio_path("Holistic", "nova")
    assert a == ta.audio_path("Holistic", "nova")        # deterministic
    assert a != ta.audio_path("Holistic", "onyx")        # voice in the hash
    assert a.endswith(".mp3")


# ── pregen --commit ─────────────────────────────────────────────────────


def _patched_commit(rows, *, headword_only, did_synth=True):
    db = MagicMock()
    goc = AsyncMock(return_value=("https://x/clip.mp3", did_synth))
    log = MagicMock()
    with patch("scripts.pregen_vocab_audio.supabase_admin", db), \
         patch("scripts.pregen_vocab_audio.tts_audio.get_or_create_audio", goc), \
         patch("scripts.pregen_vocab_audio.vocab_service.reload") as reload, \
         patch("scripts.pregen_vocab_audio.ai_usage_logger.log_tts", log):
        asyncio.run(pg._commit(rows, headword_only=headword_only))
    return db, goc, log, reload


def test_commit_stamps_both_audio_cols_and_final():
    db, goc, log, reload = _patched_commit([dict(_ROW)], headword_only=False)
    payload = db.table.return_value.update.call_args[0][0]
    assert payload["audio_headword"] == "https://x/clip.mp3"
    assert payload["audio_example"] == "https://x/clip.mp3"
    assert payload["audio_status"] == "final"
    assert goc.await_count == 2          # headword + example
    assert log.call_count == 2           # both synthesized → both logged
    reload.assert_called_once()          # G1


def test_commit_hash_skip_stamps_url_without_logging():
    # did_synth=False → object already existed; URL still stamped, no usage logged.
    db, goc, log, reload = _patched_commit([dict(_ROW)], headword_only=False, did_synth=False)
    payload = db.table.return_value.update.call_args[0][0]
    assert payload["audio_headword"] and payload["audio_example"]
    assert payload["audio_status"] == "final"
    log.assert_not_called()              # 0 synth → 0 TTS-usage rows


def test_headword_only_defers_example_and_is_not_final():
    db, goc, log, reload = _patched_commit([dict(_ROW)], headword_only=True)
    payload = db.table.return_value.update.call_args[0][0]
    assert "audio_headword" in payload
    assert "audio_example" not in payload          # example deferred
    assert payload.get("audio_status") != "final"  # still pending (example to come)
    assert goc.await_count == 1


def test_commit_idempotent_skips_already_stamped_fields():
    row = dict(_ROW, audio_headword="https://x/h.mp3")   # headword already done
    db, goc, log, reload = _patched_commit([row], headword_only=False)
    # only the example needs generating
    assert goc.await_count == 1
    payload = db.table.return_value.update.call_args[0][0]
    assert "audio_headword" not in payload      # not re-stamped
    assert payload["audio_example"] == "https://x/clip.mp3"
    assert payload["audio_status"] == "final"   # both present now


# ── pregen dry-run ──────────────────────────────────────────────────────


def test_dry_run_writes_nothing_and_calls_no_tts():
    db = MagicMock()
    with patch("scripts.pregen_vocab_audio.supabase_admin", db), \
         patch("scripts.pregen_vocab_audio.tts_audio.get_or_create_audio") as goc:
        pg._dry_run([dict(_ROW)], headword_only=False)
    db.table.assert_not_called()        # no DB write
    goc.assert_not_called()             # no synth


def _paged_db(rows, page=1000):
    """Fake Supabase that serves `rows` in PostgREST-style pages via
    select().order().range(a, b).execute() — so a reader that DOESN'T page sees
    only the first `page` rows, exactly like the real ~1000-row cap."""
    db = MagicMock()

    def _range(start, end):
        out = MagicMock()
        out.execute.return_value = MagicMock(data=rows[start:end + 1])
        return out

    db.table.return_value.select.return_value.order.return_value.range.side_effect = _range
    return db


def test_rows_needing_audio_filters_finalized():
    db = _paged_db([
        {"slug": "a", "audio_status": "final", "audio_headword": "u"},   # done → excluded
        {"slug": "b", "audio_status": "pending", "audio_headword": None}, # needs work
        {"slug": "c", "audio_status": "final", "audio_headword": None},   # final but no url → included
    ])
    with patch("scripts.pregen_vocab_audio.supabase_admin", db):
        rows = pg._rows_needing_audio()
    assert {r["slug"] for r in rows} == {"b", "c"}


def test_rows_needing_audio_pages_past_the_postgrest_1000_cap():
    """A bare select() is capped at ~1000 rows and truncates SILENTLY: the script
    logged a plausible count and finished green while never CONSIDERING the rest.
    Measured on prod 2026-07-16 — 1000 of 1835 rows seen, 835 invisible, including
    4 lesson words the vocab quiz serves, whose audio was therefore never made."""
    rows = [{"slug": f"w{i}", "headword": f"W{i}",
             "audio_status": "pending", "audio_headword": None} for i in range(2350)]
    db = _paged_db(rows)
    with patch("scripts.pregen_vocab_audio.supabase_admin", db):
        got = pg._rows_needing_audio()
    assert len(got) == 2350, "rows past the first page were silently dropped"
    assert got[-1]["slug"] == "w2349"


def test_dry_run_cost_estimate_covers_rows_past_the_cap(caplog):
    """The estimate is computed from _rows_needing_audio()'s list, so the cap made
    it UNDER-REPORT spend — the operator approved a number for 1000 rows while the
    real run would bill for 1835. Every headword must be counted."""
    table = [{"id": f"{i:05d}", "slug": f"w{i}", "headword": "Word",
              "example": "", "audio_status": "pending", "audio_headword": None}
             for i in range(1835)]
    db = _paged_db(table)
    with patch("scripts.pregen_vocab_audio.supabase_admin", db):
        rows = pg._rows_needing_audio()
        with caplog.at_level("INFO"):
            pg._dry_run(rows, headword_only=True)
    assert "est. characters     : %d" % (1835 * len("Word")) in caplog.text


def test_all_vocab_rows_stops_on_a_short_first_page():
    """A short first page ends paging — no needless second round-trip."""
    db = _paged_db([{"id": "1", "slug": "a"}])
    with patch("scripts.pregen_vocab_audio.supabase_admin", db):
        assert len(pg._all_vocab_rows()) == 1
    assert db.table.return_value.select.return_value.order.return_value.range.call_count == 1


def test_rows_needing_audio_orders_by_pk_for_stable_paging():
    """Without an explicit order() PostgREST/Postgres don't guarantee row order
    across page requests, so a concurrent import can shift a row between offsets
    and duplicate one while skipping another."""
    db = _paged_db([{"slug": "a", "audio_status": "pending", "audio_headword": None}])
    with patch("scripts.pregen_vocab_audio.supabase_admin", db):
        pg._rows_needing_audio()
    db.table.return_value.select.return_value.order.assert_called_with("id")


# ── schema-aware col-match (#538) — stamp keys ⊆ migration 110 columns ───


def test_pregen_stamp_keys_are_real_columns():
    mig = (Path(__file__).parent.parent / "migrations" / "110_vocab_cards.sql").read_text("utf-8")
    m = re.search(r"CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+vocab_cards\s*\((.*?)\n\);",
                  mig, re.IGNORECASE | re.DOTALL)
    cols = {mm.group(1) for mm in re.finditer(r'^\s*"?([a-z_]+)"?\s', m.group(1), re.MULTILINE)}
    stamp_keys = {"audio_headword", "audio_example", "audio_status"}
    assert stamp_keys <= cols, f"pregen stamps columns vocab_cards lacks: {stamp_keys - cols}"


# ── audio silence-padding (fix: short single-word edge clipping) ──────────


def test_audio_path_changed_by_post_tag():
    """The pad version is baked into the hash so existing (clipped) clips are
    regenerated at NEW keys instead of being reused."""
    import hashlib
    pre_pad_key = "Holistic|nova|openai-tts-1"               # key before the padding fix
    pre_pad = hashlib.sha256(pre_pad_key.encode("utf-8")).hexdigest() + ".mp3"
    assert ta.audio_path("Holistic", "nova", "openai") != pre_pad


def test_get_or_create_audio_pads_before_upload():
    captured = {}
    with patch("services.tts_audio.audio_exists", return_value=False), \
         patch("services.tts_audio.public_url", return_value="https://x/h.mp3"), \
         patch("services.tts_audio.synthesize_mp3", AsyncMock(return_value=b"RAW")), \
         patch("services.tts_audio.pad_silence_mp3", side_effect=lambda b, **k: b + b"+PAD"), \
         patch("services.tts_audio.upload_mp3", side_effect=lambda p, d: captured.update(data=d)):
        asyncio.run(ta.get_or_create_audio("Holistic"))
    assert captured["data"] == b"RAW+PAD"      # the PADDED bytes are what we upload


def test_get_or_create_audio_sync_pads_before_upload():
    captured = {}
    with patch("services.tts_audio.audio_exists", return_value=False), \
         patch("services.tts_audio.public_url", return_value="https://x/h.mp3"), \
         patch("services.tts_audio.synth_sync", return_value=b"RAW"), \
         patch("services.tts_audio.pad_silence_mp3", side_effect=lambda b, **k: b + b"+PAD"), \
         patch("services.tts_audio.upload_mp3", side_effect=lambda p, d: captured.update(data=d)):
        ta.get_or_create_audio_sync("Holistic", "openai")
    assert captured["data"] == b"RAW+PAD"


def test_pad_silence_best_effort_returns_original_on_bad_bytes():
    # Non-decodable input must never raise — return original so generation is safe.
    assert ta.pad_silence_mp3(b"not-an-mp3") == b"not-an-mp3"
    assert ta.pad_silence_mp3(b"") == b""


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg required for mp3 round-trip")
def test_pad_silence_adds_leading_and_trailing_margin():
    from pydub import AudioSegment
    # test_listening_audio_upload installs a fake `pydub` in sys.modules (global,
    # order-dependent). A real mp3 round-trip needs the real library — skip when
    # the fake is active; the wiring + best-effort behaviour is covered above.
    if AudioSegment.__name__ == "_FakeAudioSegment":
        pytest.skip("pydub is faked by test_listening_audio_upload in the full suite")
    base = AudioSegment.silent(duration=500, frame_rate=24000)
    buf = io.BytesIO(); base.export(buf, format="mp3")
    out = ta.pad_silence_mp3(buf.getvalue(), lead_ms=180, trail_ms=320)
    seg = AudioSegment.from_file(io.BytesIO(out), format="mp3")
    # 500 + 180 + 320 = 1000ms, minus mp3 encoder slack.
    assert len(seg) >= 500 + 180 + 320 - 120


# ── pregen --regen: re-create existing (clipped) audio ───────────────────


def test_regen_selects_all_rows_with_headword_even_final():
    db = _paged_db([
        {"slug": "a", "audio_status": "final", "audio_headword": "u", "headword": "A"},
        {"slug": "b", "audio_status": "pending", "audio_headword": None, "headword": "B"},
        {"slug": "c", "audio_status": "final", "audio_headword": "u", "headword": ""},   # no headword
    ])
    with patch("scripts.pregen_vocab_audio.supabase_admin", db):
        rows = pg._rows_needing_audio(regen=True)
    assert {r["slug"] for r in rows} == {"a", "b"}    # every headword row, incl. final 'a'


def test_regen_commit_resynths_and_restamps_finalized_row():
    row = {"slug": "h", "headword": "Holistic", "example": "A holistic approach.",
           "audio_headword": "https://old/clip.mp3", "audio_example": "https://old/ex.mp3",
           "audio_status": "final"}
    db = MagicMock()
    goc = AsyncMock(return_value=("https://new/clip.mp3", True))
    with patch("scripts.pregen_vocab_audio.supabase_admin", db), \
         patch("scripts.pregen_vocab_audio.tts_audio.get_or_create_audio", goc), \
         patch("scripts.pregen_vocab_audio.vocab_service.reload"), \
         patch("scripts.pregen_vocab_audio.ai_usage_logger.log_tts"):
        asyncio.run(pg._commit([row], headword_only=False, regen=True))
    assert goc.await_count == 2          # both re-synthesised despite already being 'final'
    payload = db.table.return_value.update.call_args[0][0]
    assert payload["audio_headword"] == "https://new/clip.mp3"
    assert payload["audio_example"] == "https://new/clip.mp3"
