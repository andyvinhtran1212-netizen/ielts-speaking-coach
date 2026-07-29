"""The Kokoro-bundle gate must not green-light a block with no playable audio.

The bundle's .md companions are generated from the corpus, so they exist
whether or not the TTS step ever ran for that block. An earlier version of
this gate read only the .md, which meant a block whose .wav was never
rendered could still come out UPLOADABLE — the exact failure the gate exists
to catch. These tests pin the disk check alongside the transcript check.
"""
from __future__ import annotations

import json
import sys
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from scripts.audit_kokoro_bundle import audit  # noqa: E402


TRANSCRIPT = "Welcome to Oakwood Centre. The library is on the left."
_RATE = 24_000


def _write_wav(path: Path, seconds: float, silent: bool = False) -> None:
    """A real, decodable mono WAV of the requested length.

    Non-silent by default: an all-zero payload is a legitimate REJECT, so the
    happy-path fixtures must carry actual signal or they would test nothing.
    """
    n = int(_RATE * seconds)
    frames = b"\0\0" * n if silent else bytes(
        b for i in range(n) for b in ((i * 37) % 251 + 1, (i * 11) % 251 + 1))
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(_RATE)
        w.writeframes(frames)


def _companion(block: str, secs: float = 40.0, audio: str | None = None) -> str:
    return (
        "---\n"
        f'id: "{block}"\n'
        'section: "Batch"\n'
        "part: 2\n"
        'task_types: ["note-completion"]\n'
        "question_count: 2\n"
        f'audio: "{audio or block + ".wav"}"\n'
        f"audio_seconds: {secs}\n"
        "---\n\n"
        f"# {block}\n\n"
        "## Transcript\n\n"
        "<details><summary>x</summary>\n\n"
        f"{TRANSCRIPT}\n\n"
        "</details>\n"
    )


def _bundle(tmp_path: Path, blocks: dict[str, float | None]) -> Path:
    """blocks: name -> wav length in seconds (None means: do not write it)."""
    audio_dir = tmp_path / "audio_output_kokoro" / "Batch"
    audio_dir.mkdir(parents=True)
    items = []
    for name, secs in blocks.items():
        (audio_dir / f"{name}.md").write_text(_companion(name), encoding="utf-8")
        if secs is not None:
            _write_wav(audio_dir / f"{name}.wav", secs)
        items += [
            {"id": f"{name}.1", "subsection": name, "script": TRANSCRIPT},
            {"id": f"{name}.2", "subsection": name, "script": "The library is on the left."},
        ]
    (tmp_path / "corpus_v2.json").write_text(json.dumps(items), encoding="utf-8")
    return tmp_path


def _verdicts(rows):
    return {r["block"]: r["verdict"] for r in rows}


def _wav_states(rows):
    return {r["block"]: r["wav"] for r in rows}


def test_block_with_real_wav_is_uploadable(tmp_path):
    rows = audit(str(_bundle(tmp_path, {"Blk_ok": 40.0})))
    assert _verdicts(rows) == {"Blk_ok": "UPLOADABLE"}


def test_missing_wav_is_not_uploadable(tmp_path):
    # Transcript covers every question, so ONLY the disk check can catch this.
    rows = audit(str(_bundle(tmp_path, {"Blk_nowav": None})))
    assert _verdicts(rows) == {"Blk_nowav": "NO_AUDIO_FILE"}
    assert _wav_states(rows) == {"Blk_nowav": "missing"}
    assert rows[0]["unheard"] == rows[0]["questions"]


def test_silent_length_wav_is_not_uploadable(tmp_path):
    rows = audit(str(_bundle(tmp_path, {"Blk_stub": 0.1})))
    assert _verdicts(rows) == {"Blk_stub": "NO_AUDIO_FILE"}
    assert _wav_states(rows) == {"Blk_stub": "empty"}


def test_undecodable_file_is_not_uploadable(tmp_path):
    """A big file is not a playable file — an aborted render leaves junk."""
    d = _bundle(tmp_path, {"Blk_junk": None})
    (d / "audio_output_kokoro" / "Batch" / "Blk_junk.wav").write_bytes(b"\0" * 500_000)
    rows = audit(str(d))
    assert _verdicts(rows) == {"Blk_junk": "NO_AUDIO_FILE"}
    assert _wav_states(rows) == {"Blk_junk": "unreadable"}


def test_header_only_truncated_wav_is_not_uploadable(tmp_path):
    """The RIFF header advertises the full length even when the write was cut
    short, so the header alone must not be believed — the payload is read."""
    d = _bundle(tmp_path, {"Blk_trunc": 40.0})
    wav = d / "audio_output_kokoro" / "Batch" / "Blk_trunc.wav"
    with open(wav, "r+b") as fh:
        fh.truncate(44 + 1000)        # keep the header, drop the audio
    rows = audit(str(d))
    assert _verdicts(rows) == {"Blk_trunc": "NO_AUDIO_FILE"}
    assert _wav_states(rows) in ({"Blk_trunc": "truncated"}, {"Blk_trunc": "empty"})


def test_all_silence_wav_is_not_uploadable(tmp_path):
    """A render that produced only zeros plays, and teaches nothing."""
    d = _bundle(tmp_path, {"Blk_silent": None})
    _write_wav(d / "audio_output_kokoro" / "Batch" / "Blk_silent.wav", 40.0, silent=True)
    rows = audit(str(d))
    assert _verdicts(rows) == {"Blk_silent": "NO_AUDIO_FILE"}
    assert _wav_states(rows) == {"Blk_silent": "silent"}


def test_wav_shorter_than_advertised_is_not_uploadable(tmp_path):
    """The companion says 40 s and the dictation windows are cut from that
    number; a 5 s file plays but every seek lands past the end."""
    rows = audit(str(_bundle(tmp_path, {"Blk_short": 5.0})))     # companion says 40.0
    assert _verdicts(rows) == {"Blk_short": "NO_AUDIO_FILE"}
    assert _wav_states(rows) == {"Blk_short": "duration_mismatch"}


def test_wav_named_by_frontmatter_is_the_one_checked(tmp_path):
    """The companion may name an audio file that is not <block>.wav."""
    d = _bundle(tmp_path, {})
    audio_dir = d / "audio_output_kokoro" / "Batch"
    (audio_dir / "Blk_alias.md").write_text(
        _companion("Blk_alias", audio="rendered_take2.wav"), encoding="utf-8")
    _write_wav(audio_dir / "Blk_alias.wav", 40.0)                # decoy
    (d / "corpus_v2.json").write_text(json.dumps(
        [{"id": "a", "subsection": "Blk_alias", "script": TRANSCRIPT}]), encoding="utf-8")

    assert _verdicts(audit(str(d))) == {"Blk_alias": "NO_AUDIO_FILE"}, \
        "the decoy <block>.wav must not satisfy a companion naming another file"

    _write_wav(audio_dir / "rendered_take2.wav", 40.0)
    assert _verdicts(audit(str(d))) == {"Blk_alias": "UPLOADABLE"}


def test_question_absent_from_transcript_downgrades_the_block(tmp_path):
    """The original defect class: text with no matching audio content."""
    d = _bundle(tmp_path, {"Blk_partial": 40.0})
    (d / "corpus_v2.json").write_text(json.dumps([
        {"id": "1", "subsection": "Blk_partial", "script": TRANSCRIPT},
        {"id": "2", "subsection": "Blk_partial",
         "script": "Adult annual membership costs thirty pounds a year."},
    ]), encoding="utf-8")
    rows = audit(str(d))
    assert rows[0]["verdict"] == "PARTIAL"
    assert rows[0]["unheard"] == 1
