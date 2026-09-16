"""Build a local, content-addressed Kokoro audio bundle for core vocab cards."""

from __future__ import annotations

import hashlib
import io
import json
import shutil
import tempfile
from pathlib import Path
from typing import Any, Callable

from services.advanced_vocab_package_builder import collect_core_vocabulary_cards


AUDIO_BUNDLE_VERSION = "1.0.0"
KOKORO_MODEL_TAG = "v1.0"
KOKORO_POST_TAG = "pad1"
DEFAULT_VOICE = "bf_emma"
KOKORO_SAMPLE_RATE = 24000
PAD_LEAD_MS = 180
PAD_TRAIL_MS = 320
_PIPELINES: dict[str, Any] = {}


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _canonical_json(value: object) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _clip_id(text: str, voice: str) -> str:
    key = f"{text}|{voice}|kokoro-{KOKORO_MODEL_TAG}-{KOKORO_POST_TAG}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def _default_renderer(text: str, voice: str) -> bytes:
    """Standalone local renderer: package builds must not require Supabase env."""
    try:
        from kokoro import KPipeline
    except ImportError as exc:
        raise RuntimeError(
            "Kokoro is not installed. Install kokoro, soundfile and torch first."
        ) from exc
    import numpy as np
    from pydub import AudioSegment

    lang = (voice or DEFAULT_VOICE)[:1]
    if lang not in {"a", "b"}:
        lang = "b"
    if lang not in _PIPELINES:
        _PIPELINES[lang] = KPipeline(
            lang_code=lang,
            repo_id="hexgrad/Kokoro-82M",
        )
    pipeline = _PIPELINES[lang]
    chunks = [audio for _gs, _ps, audio in pipeline(text, voice=voice)]
    if not chunks:
        raise RuntimeError(f"Kokoro returned no audio for {text!r}")

    samples = np.concatenate([np.asarray(chunk, dtype="float32") for chunk in chunks])
    pcm16 = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    speech = AudioSegment(
        data=pcm16,
        sample_width=2,
        frame_rate=KOKORO_SAMPLE_RATE,
        channels=1,
    )
    rendered = (
        AudioSegment.silent(duration=PAD_LEAD_MS, frame_rate=KOKORO_SAMPLE_RATE)
        + speech
        + AudioSegment.silent(duration=PAD_TRAIL_MS, frame_rate=KOKORO_SAMPLE_RATE)
    )
    buffer = io.BytesIO()
    rendered.export(buffer, format="mp3")
    return buffer.getvalue()


def generate_vocab_audio_bundle(
    source_root: str | Path,
    output_root: str | Path,
    *,
    voice: str = DEFAULT_VOICE,
    renderer: Callable[[str, str], bytes] | None = None,
    progress: Callable[[int, int, str], None] | None = None,
) -> Path:
    """Render headword + example audio once per unique text, atomically."""
    source = Path(source_root).expanduser().resolve()
    output = Path(output_root).expanduser().resolve()
    if not source.is_dir():
        raise FileNotFoundError(f"Source root does not exist: {source}")
    if output.exists():
        raise FileExistsError(f"Refusing to overwrite existing output: {output}")
    if output == source or source in output.parents:
        raise ValueError("Audio output must be outside the canonical source tree")

    cards = collect_core_vocabulary_cards(source)
    card_texts: dict[str, tuple[str, str]] = {}
    unique_texts: dict[str, str] = {}
    for card in cards:
        lesson_lexeme_id = str(card["lesson_lexeme_id"])
        headword = str(card.get("headword") or "").strip()
        example = str(card.get("example") or "").strip()
        if not headword or not example:
            raise ValueError(f"Headword/example text missing for {lesson_lexeme_id}")
        card_texts[lesson_lexeme_id] = (headword, example)
        unique_texts[_clip_id(headword, voice)] = headword
        unique_texts[_clip_id(example, voice)] = example

    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(
        prefix=f".{output.name}.building-", dir=output.parent
    ))
    render = renderer or _default_renderer
    try:
        clips: dict[str, dict[str, object]] = {}
        ordered_clips = sorted(unique_texts.items())
        total = len(ordered_clips)
        for number, (clip_id, text) in enumerate(ordered_clips, start=1):
            data = render(text, voice)
            if not data:
                raise RuntimeError(f"Kokoro returned an empty clip for {text!r}")
            path = staging / "clips" / f"{clip_id}.mp3"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            clips[clip_id] = {
                "path": f"clips/{clip_id}.mp3",
                "checksum": _sha256_bytes(data),
                "byte_size": len(data),
                "text": text,
            }
            if progress is not None:
                progress(number, total, text)

        audio_cards: dict[str, dict[str, dict[str, str]]] = {}
        for lesson_lexeme_id, (headword, example) in card_texts.items():
            headword_id = _clip_id(headword, voice)
            example_id = _clip_id(example, voice)
            audio_cards[lesson_lexeme_id] = {
                "headword": {
                    "clip_id": headword_id,
                    "checksum": str(clips[headword_id]["checksum"]),
                },
                "example": {
                    "clip_id": example_id,
                    "checksum": str(clips[example_id]["checksum"]),
                },
            }

        manifest: dict[str, object] = {
            "schema_version": AUDIO_BUNDLE_VERSION,
            "engine": "kokoro",
            "model_tag": KOKORO_MODEL_TAG,
            "post_processing": KOKORO_POST_TAG,
            "voice": voice,
            "card_count": len(audio_cards),
            "clip_count": len(clips),
            "cards": audio_cards,
            "clips": clips,
        }
        manifest["bundle_checksum"] = _sha256_bytes(_canonical_json(manifest))
        _write_json(staging / "manifest.json", manifest)
        staging.rename(output)
    except Exception:
        shutil.rmtree(staging)
        raise
    return output
