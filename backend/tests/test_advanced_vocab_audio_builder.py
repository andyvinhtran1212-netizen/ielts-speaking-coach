from __future__ import annotations

import json
from pathlib import Path

import pytest

import services.advanced_vocab_audio_builder as audio_builder
from services.advanced_vocab_package_builder import (
    DEFAULT_COMMON_ERROR_OVERRIDES,
    load_common_error_overrides,
    load_vocab_audio_bundle,
)


def _cards() -> list[dict]:
    return [
        {
            "lesson_lexeme_id": "ADV-T01__lex_alpha",
            "headword": "Alpha",
            "example": "Alpha appears here.",
        },
        {
            "lesson_lexeme_id": "ADV-T02__lex_alpha",
            "headword": "Alpha",
            "example": "A different example.",
        },
    ]


def test_common_error_overlay_has_exactly_88_precise_entries():
    overrides, metadata = load_common_error_overrides(DEFAULT_COMMON_ERROR_OVERRIDES)

    assert len(overrides) == 88
    assert metadata["item_count"] == 88
    assert all(len(value) >= 40 for value in overrides.values())


def test_kokoro_bundle_deduplicates_text_and_maps_both_card_clips(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
):
    source = tmp_path / "source"
    output = tmp_path / "audio"
    source.mkdir()
    monkeypatch.setattr(
        audio_builder, "collect_core_vocabulary_cards", lambda _root: _cards()
    )
    rendered: list[tuple[str, str]] = []

    def fake_renderer(text: str, voice: str) -> bytes:
        rendered.append((text, voice))
        return b"ID3" + text.encode("utf-8")

    audio_builder.generate_vocab_audio_bundle(
        source, output, renderer=fake_renderer, voice="bf_emma"
    )
    manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))

    assert manifest["engine"] == "kokoro"
    assert manifest["voice"] == "bf_emma"
    assert manifest["card_count"] == 2
    assert manifest["clip_count"] == 3
    assert len(rendered) == 3
    first = manifest["cards"]["ADV-T01__lex_alpha"]
    second = manifest["cards"]["ADV-T02__lex_alpha"]
    assert first["headword"]["clip_id"] == second["headword"]["clip_id"]
    assert first["example"]["clip_id"] != second["example"]["clip_id"]
    assert len(list((output / "clips").glob("*.mp3"))) == 3


def test_audio_bundle_integrity_check_rejects_tampered_clip(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
):
    source = tmp_path / "source"
    output = tmp_path / "audio"
    source.mkdir()
    monkeypatch.setattr(
        audio_builder, "collect_core_vocabulary_cards", lambda _root: _cards()
    )
    audio_builder.generate_vocab_audio_bundle(
        source, output, renderer=lambda text, _voice: b"ID3" + text.encode()
    )
    clip = next((output / "clips").glob("*.mp3"))
    clip.write_bytes(b"tampered")

    with pytest.raises(ValueError, match="checksum mismatch"):
        load_vocab_audio_bundle(output)


def test_failed_audio_generation_cleans_private_staging(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
):
    source = tmp_path / "source"
    output = tmp_path / "audio"
    source.mkdir()
    monkeypatch.setattr(
        audio_builder, "collect_core_vocabulary_cards", lambda _root: _cards()
    )

    with pytest.raises(RuntimeError, match="render failed"):
        audio_builder.generate_vocab_audio_bundle(
            source,
            output,
            renderer=lambda _text, _voice: (_ for _ in ()).throw(
                RuntimeError("render failed")
            ),
        )

    assert not output.exists()
    assert list(tmp_path.glob(".audio.building-*")) == []
