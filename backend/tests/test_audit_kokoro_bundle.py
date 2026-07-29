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
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from scripts.audit_kokoro_bundle import audit  # noqa: E402


TRANSCRIPT = "Welcome to Oakwood Centre. The library is on the left."


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


def _bundle(tmp_path: Path, blocks: dict[str, int]) -> Path:
    """blocks: name -> wav size in bytes (0 means: do not write the file)."""
    audio_dir = tmp_path / "audio_output_kokoro" / "Batch"
    audio_dir.mkdir(parents=True)
    items = []
    for name, size in blocks.items():
        (audio_dir / f"{name}.md").write_text(_companion(name), encoding="utf-8")
        if size:
            (audio_dir / f"{name}.wav").write_bytes(b"\0" * size)
        items += [
            {"id": f"{name}.1", "subsection": name, "script": TRANSCRIPT},
            {"id": f"{name}.2", "subsection": name, "script": "The library is on the left."},
        ]
    (tmp_path / "corpus_v2.json").write_text(json.dumps(items), encoding="utf-8")
    return tmp_path


def _verdicts(rows):
    return {r["block"]: r["verdict"] for r in rows}


def test_block_with_real_wav_is_uploadable(tmp_path):
    rows = audit(str(_bundle(tmp_path, {"Blk_ok": 50_000})))
    assert _verdicts(rows) == {"Blk_ok": "UPLOADABLE"}


def test_missing_wav_is_not_uploadable(tmp_path):
    # Transcript covers every question, so ONLY the disk check can catch this.
    rows = audit(str(_bundle(tmp_path, {"Blk_nowav": 0})))
    assert _verdicts(rows) == {"Blk_nowav": "NO_AUDIO_FILE"}
    assert rows[0]["unheard"] == rows[0]["questions"]


def test_stub_sized_wav_is_not_uploadable(tmp_path):
    # A bare RIFF header (44 bytes) is not speech.
    rows = audit(str(_bundle(tmp_path, {"Blk_stub": 44})))
    assert _verdicts(rows) == {"Blk_stub": "NO_AUDIO_FILE"}


def test_wav_named_by_frontmatter_is_the_one_checked(tmp_path):
    """The companion may name an audio file that is not <block>.wav."""
    d = _bundle(tmp_path, {})
    audio_dir = d / "audio_output_kokoro" / "Batch"
    (audio_dir / "Blk_alias.md").write_text(
        _companion("Blk_alias", audio="rendered_take2.wav"), encoding="utf-8")
    (audio_dir / "Blk_alias.wav").write_bytes(b"\0" * 50_000)      # decoy
    (d / "corpus_v2.json").write_text(json.dumps(
        [{"id": "a", "subsection": "Blk_alias", "script": TRANSCRIPT}]), encoding="utf-8")

    assert _verdicts(audit(str(d))) == {"Blk_alias": "NO_AUDIO_FILE"}, \
        "the decoy <block>.wav must not satisfy a companion naming another file"

    (audio_dir / "rendered_take2.wav").write_bytes(b"\0" * 50_000)
    assert _verdicts(audit(str(d))) == {"Blk_alias": "UPLOADABLE"}


def test_question_absent_from_transcript_downgrades_the_block(tmp_path):
    """The original defect class: text with no matching audio content."""
    d = _bundle(tmp_path, {"Blk_partial": 50_000})
    (d / "corpus_v2.json").write_text(json.dumps([
        {"id": "1", "subsection": "Blk_partial", "script": TRANSCRIPT},
        {"id": "2", "subsection": "Blk_partial",
         "script": "Adult annual membership costs thirty pounds a year."},
    ]), encoding="utf-8")
    rows = audit(str(d))
    assert rows[0]["verdict"] == "PARTIAL"
    assert rows[0]["unheard"] == 1
