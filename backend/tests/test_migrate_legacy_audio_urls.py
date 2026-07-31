"""Unit tests for scripts.migrate_legacy_audio_urls pure helpers.

The network/DB legs (`run`) are exercised operationally against prod as a dry
run; here we pin the URL parsing + rewrite logic, because a wrong storage path
would make the script re-upload a legacy object over a good current one.
"""

from __future__ import annotations

from scripts.migrate_legacy_audio_urls import (
    LEGACY_HOST,
    content_type_for,
    host_of,
    partition_rows,
    remaining_legacy_rows,
    storage_path_of,
    to_current,
)

_CUR = "huwsmtubwulikhlmcirx.supabase.co"
_PUB = "/storage/v1/object/public"


def _legacy(bucket: str, path: str) -> str:
    return f"https://{LEGACY_HOST}{_PUB}/{bucket}/{path}"


def test_host_of_parses_and_degrades():
    assert host_of(_legacy("audio-responses", "a/b/c.webm")) == LEGACY_HOST
    assert host_of(None) is None
    assert host_of("") is None
    assert host_of("not a url") is None


def test_storage_path_of_extracts_nested_path():
    url = _legacy("audio-responses", "user/session/question.webm")
    assert storage_path_of(url, "audio-responses") == "user/session/question.webm"


def test_storage_path_of_strips_trailing_question_mark():
    """Older supabase-py get_public_url appended a bare '?'. 28 prod rows carry
    it; leaving it on would miss the real object and trigger a needless copy."""
    url = _legacy("audio-responses", "u/s/q.webm") + "?"
    assert storage_path_of(url, "audio-responses") == "u/s/q.webm"


def test_storage_path_of_strips_query_and_fragment():
    assert storage_path_of(_legacy("vocab-audio", "x.mp3") + "?t=1", "vocab-audio") == "x.mp3"
    assert storage_path_of(_legacy("vocab-audio", "x.mp3") + "#f", "vocab-audio") == "x.mp3"


def test_storage_path_of_rejects_wrong_bucket_and_non_public_urls():
    assert storage_path_of(_legacy("vocab-audio", "x.mp3"), "audio-responses") is None
    assert storage_path_of(f"https://{LEGACY_HOST}/storage/v1/object/sign/vocab-audio/x.mp3",
                           "vocab-audio") is None
    assert storage_path_of(f"https://{LEGACY_HOST}{_PUB}/vocab-audio/", "vocab-audio") is None


def test_to_current_is_a_pure_host_swap():
    """Bucket + path must survive untouched, otherwise the rewritten URL points
    at an object that was never copied."""
    old = _legacy("audio-responses", "u/s/q.webm")
    assert to_current(old, _CUR) == f"https://{_CUR}{_PUB}/audio-responses/u/s/q.webm"


def test_to_current_is_idempotent_for_already_current_urls():
    already = f"https://{_CUR}{_PUB}/vocab-audio/x.mp3"
    assert to_current(already, _CUR) == already


def _row(new_url, rid="r1"):
    return {"table": "responses", "column": "audio_url", "id": rid,
            "old": "legacy", "path": "p", "new": new_url}


def test_failed_copy_rows_are_held_back_by_default():
    """A row whose target object is missing must NOT be rewritten: its legacy
    URL may still work, so repointing it at a confirmed-404 breaks live audio."""
    ok, bad = _row("https://cur/ok.webm", "a"), _row("https://cur/bad.webm", "b")
    safe, held = partition_rows([ok, bad], {"https://cur/bad.webm"})
    assert safe == [ok]
    assert held == [bad]


def test_partition_rows_passes_everything_through_when_nothing_blocked():
    rows = [_row("https://cur/a.webm", "a"), _row("https://cur/b.webm", "b")]
    safe, held = partition_rows(rows, set())
    assert safe == rows and held == []


def test_partition_rows_can_block_every_row():
    rows = [_row("https://cur/a.webm", "a")]
    safe, held = partition_rows(rows, {"https://cur/a.webm"})
    assert safe == [] and held == rows


def test_remaining_rows_dry_run_reports_everything_outstanding():
    """A dry run writes nothing, so the whole set is still outstanding — the
    exit code must not signal 'safe to decommission'."""
    assert remaining_legacy_rows(execute=False, total_legacy=5835, written=0) == 5835


def test_remaining_rows_zero_only_when_all_written():
    assert remaining_legacy_rows(execute=True, total_legacy=100, written=100) == 0
    # Held-back rows / failed writes / --limit truncation all leave a remainder.
    assert remaining_legacy_rows(execute=True, total_legacy=100, written=80) == 20
    assert remaining_legacy_rows(execute=True, total_legacy=100, written=0) == 100


def test_remaining_rows_never_negative():
    assert remaining_legacy_rows(execute=True, total_legacy=5, written=9) == 0


def test_content_type_from_extension_and_fallbacks():
    assert content_type_for("u/s/q.webm", None) == "audio/webm"
    assert content_type_for("x.MP3", None) == "audio/mpeg"
    # Unknown extension → trust an audio/* response header…
    assert content_type_for("x.bin", "audio/ogg") == "audio/ogg"
    # …but never a non-audio one.
    assert content_type_for("x.bin", "text/html") == "application/octet-stream"
    assert content_type_for("noext", None) == "application/octet-stream"
