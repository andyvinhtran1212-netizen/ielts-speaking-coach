"""services/listening_audio.py — Sprint 13.4.3 audio assembly + duration probe.

Audio upload + assembly for Cambridge IELTS test bundles. Three modes
per Andy's 2026-05-21 Path 3 lock:

  * ``full_premixed``        — Andy uploads 1 pre-mixed 30-min audio. The
                               server probes duration and stores; no
                               concatenation needed.
  * ``parts_auto_assembled`` — Andy uploads 4 clean section audios; the
                               server renders narrator intros via
                               ElevenLabs (Sarah voice default) and
                               concatenates everything with Cambridge-
                               convention pauses via pydub/ffmpeg.
  * ``parts_only``           — 4 parts stored without assembly. Cannot
                               publish to students; Sprint 13.6 audio
                               cutter consumes these for exercise
                               snippets.

pydub is pinned in requirements.txt (Sprint 11.0). It shells out to
ffmpeg/ffprobe — Railway's nixpacks now installs ffmpeg in aptPkgs
(see ``backend/nixpacks.toml``).

The assembly function takes an ``elevenlabs_render_fn`` callable so
tests can mock the network without touching the ElevenLabs API. The
default implementation reuses ``services.listening_renderer.render_via
_elevenlabs`` which is the same code path Sprint 13.3 ships for the
single-script render UI.
"""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass
from typing import Any, Callable

logger = logging.getLogger(__name__)


# ── Constants ──────────────────────────────────────────────────────────────


# Pre-read + inter-section pauses (Cambridge IELTS convention).
PRE_READ_PAUSE_SECONDS       = 30
INTER_SECTION_PAUSE_SECONDS  = 5
END_PAUSE_SECONDS            = 30

# Full-audio guardrails. Hard min/max raise 422; warn-band warnings are
# surfaced but the upload still lands.
FULL_AUDIO_MIN_SECONDS  = 5 * 60      # 5 min hard floor
FULL_AUDIO_MAX_SECONDS  = 50 * 60     # 50 min hard ceiling
FULL_AUDIO_WARN_LO      = 25 * 60     # 25 min — Cambridge target band lo
FULL_AUDIO_WARN_HI      = 35 * 60     # 35 min — Cambridge target band hi
FULL_AUDIO_MIN_BYTES    = 50 * 1024
FULL_AUDIO_MAX_BYTES    = 100 * 1024 * 1024

# Per-section guardrails.
SECTION_AUDIO_MIN_SECONDS = 60        # 1 min hard floor
SECTION_AUDIO_MAX_SECONDS = 15 * 60   # 15 min hard ceiling
SECTION_WARN_LO           = 3 * 60    # 3 min — Cambridge target band lo
SECTION_WARN_HI           = 8 * 60    # 8 min — Cambridge target band hi
SECTION_AUDIO_MIN_BYTES   = 20 * 1024
SECTION_AUDIO_MAX_BYTES   = 30 * 1024 * 1024

DEFAULT_NARRATOR_VOICE = "EXAVITQu4vr4xnSDxMaL"     # Sarah (us_general)
DEFAULT_NARRATOR_MODEL = "eleven_multilingual_v2"

# Fallback narrator copy if Sprint 13.4.2 parser didn't pull a per-section
# intro out of the script file (older bundles).
_DEFAULT_INTRO_TEMPLATE = (
    "You will now hear section {section_num}. First, you have some "
    "time to look at the questions."
)
END_ANNOUNCEMENT_TEXT = "That is the end of the listening test."

# ElevenLabs multilingual_v2 = 2 credits/char (Sprint 11.0 cost table).
_CREDITS_PER_CHAR_MULTILINGUAL = 2

# MP3 magic-byte prefixes (mirrors services/listening_validator.py).
_MP3_MAGIC_PREFIXES = (
    b"\xff\xfb", b"\xff\xf3", b"\xff\xfa", b"\xff\xf2", b"ID3",
)


# ── Duration probe ─────────────────────────────────────────────────────────


def probe_mp3_duration_seconds(mp3_bytes: bytes) -> int:
    """Probe an MP3's duration via pydub. Returns int seconds (floor).

    Raises RuntimeError on decode failure (corrupt MP3 / ffmpeg missing).
    Sprint 13.4.3 Railway nixpacks ships ffmpeg, so a RuntimeError here
    means the file is corrupt rather than a deploy misconfiguration.
    """
    try:
        from pydub import AudioSegment                                     # type: ignore
    except ImportError as exc:                                              # pragma: no cover
        raise RuntimeError(f"pydub not available: {exc}") from exc
    try:
        seg = AudioSegment.from_file(io.BytesIO(mp3_bytes), format="mp3")
    except Exception as exc:                                                # pragma: no cover — covered via mocks
        raise RuntimeError(f"Cannot decode MP3: {exc}") from exc
    return int(len(seg) / 1000)


# ── Upload validation ──────────────────────────────────────────────────────


def validate_full_audio(file_bytes: bytes) -> dict[str, Any]:
    """Validate a pre-mixed full audio upload.

    Returns ``{duration_seconds, size_bytes, errors, warnings}``.
    Hard failures populate ``errors``; soft signals populate ``warnings``.
    The caller (router) treats any error as 422.
    """
    out: dict[str, Any] = {
        "duration_seconds": 0,
        "size_bytes":       len(file_bytes),
        "errors":           [],
        "warnings":         [],
    }
    n = len(file_bytes)
    if n < FULL_AUDIO_MIN_BYTES:
        out["errors"].append(
            f"File quá nhỏ ({n} bytes) — kỳ vọng ≥{FULL_AUDIO_MIN_BYTES // 1024} KB MP3.",
        )
        return out
    if n > FULL_AUDIO_MAX_BYTES:
        out["errors"].append(
            f"File vượt {FULL_AUDIO_MAX_BYTES // (1024 * 1024)}MB "
            f"({n // (1024 * 1024)} MB).",
        )
        return out
    if not any(file_bytes.startswith(p) for p in _MP3_MAGIC_PREFIXES):
        out["warnings"].append(
            "File không có MP3 magic bytes (ID3 / MPEG sync) ở đầu file. "
            "Audio vẫn được upload nhưng có thể không phải MP3 hợp lệ.",
        )

    try:
        duration = probe_mp3_duration_seconds(file_bytes)
        out["duration_seconds"] = duration
    except RuntimeError as exc:
        out["errors"].append(str(exc))
        return out

    if duration < FULL_AUDIO_MIN_SECONDS:
        out["errors"].append(
            f"Duration {duration}s < {FULL_AUDIO_MIN_SECONDS}s minimum — "
            f"audio quá ngắn, không phải full test.",
        )
    elif duration > FULL_AUDIO_MAX_SECONDS:
        out["errors"].append(
            f"Duration {duration}s > {FULL_AUDIO_MAX_SECONDS}s maximum.",
        )
    elif duration < FULL_AUDIO_WARN_LO or duration > FULL_AUDIO_WARN_HI:
        out["warnings"].append(
            f"Duration {duration}s ngoài 25-35 phút target Cambridge "
            f"(vẫn cho phép — chỉ là cảnh báo).",
        )
    return out


def validate_section_audio(file_bytes: bytes) -> dict[str, Any]:
    """Validate a per-section audio upload (3-8 min target band)."""
    out: dict[str, Any] = {
        "duration_seconds": 0,
        "size_bytes":       len(file_bytes),
        "errors":           [],
        "warnings":         [],
    }
    n = len(file_bytes)
    if n < SECTION_AUDIO_MIN_BYTES:
        out["errors"].append(f"File quá nhỏ ({n} bytes).")
        return out
    if n > SECTION_AUDIO_MAX_BYTES:
        out["errors"].append(
            f"File vượt {SECTION_AUDIO_MAX_BYTES // (1024 * 1024)}MB "
            f"({n // (1024 * 1024)} MB).",
        )
        return out
    if not any(file_bytes.startswith(p) for p in _MP3_MAGIC_PREFIXES):
        out["warnings"].append("File không có MP3 magic bytes.")

    try:
        duration = probe_mp3_duration_seconds(file_bytes)
        out["duration_seconds"] = duration
    except RuntimeError as exc:
        out["errors"].append(str(exc))
        return out

    if duration < SECTION_AUDIO_MIN_SECONDS or duration > SECTION_AUDIO_MAX_SECONDS:
        out["errors"].append(
            f"Section duration {duration}s ngoài 1-15 phút phạm vi hợp lệ.",
        )
    elif duration < SECTION_WARN_LO or duration > SECTION_WARN_HI:
        out["warnings"].append(
            f"Section duration {duration}s ngoài 3-8 phút target Cambridge.",
        )
    return out


# ── Assembly ───────────────────────────────────────────────────────────────


@dataclass
class AssemblyResult:
    """What ``assemble_test_audio`` returns to the router."""
    mp3_bytes:                bytes
    duration_seconds:         int
    cue_points:               list[dict[str, Any]]
    narrator_credit_estimate: int


def _default_elevenlabs_render(
    text: str, voice_id: str, model: str,
) -> bytes:
    """Default narrator-render adapter — reuses Sprint 13.3 renderer."""
    from services.listening_renderer import render_via_elevenlabs       # local import
    return render_via_elevenlabs(
        script_text=text, voice_id=voice_id, model=model,
    )


def assemble_test_audio(
    section_audios:   list[bytes],
    narrator_intros:  list[str | None],
    *,
    narrator_voice_id: str = DEFAULT_NARRATOR_VOICE,
    narrator_model:    str = DEFAULT_NARRATOR_MODEL,
    elevenlabs_render_fn: Callable[[str, str, str], bytes] | None = None,
    pre_read_pause:        int = PRE_READ_PAUSE_SECONDS,
    inter_section_pause:   int = INTER_SECTION_PAUSE_SECONDS,
    end_pause:             int = END_PAUSE_SECONDS,
) -> AssemblyResult:
    """Concatenate narrator intros + section audios + Cambridge pauses
    into a single test-length MP3.

    Sequence (per section, repeated 1-4):
        [narrator_intro][pre_read_pause][section_audio][inter_pause]

    After section 4: [end_pause][end_announcement] then test_end cue.

    Args:
        section_audios:   ordered [S1, S2, S3, S4] raw MP3 bytes.
        narrator_intros:  ordered [intro_S1..S4] narrator text. Falsy
                          entries are replaced with the default template.
        elevenlabs_render_fn: optional ``(text, voice_id, model) → mp3
                          bytes`` callable — tests inject a mock to
                          avoid hitting the real ElevenLabs API.

    Raises:
        AssertionError if section_audios or narrator_intros aren't len 4.
        RuntimeError if pydub/ffmpeg is unavailable in the runtime env.
    """
    from pydub import AudioSegment                                          # type: ignore

    if len(section_audios) != 4:
        raise ValueError(f"Expected 4 section audios, got {len(section_audios)}")
    if len(narrator_intros) != 4:
        raise ValueError(f"Expected 4 narrator intros, got {len(narrator_intros)}")

    render_fn = elevenlabs_render_fn or _default_elevenlabs_render

    timeline: list[Any] = []                    # list of AudioSegment
    cue_points: list[dict[str, Any]] = []
    cursor_ms = 0
    total_chars = 0

    for i, raw_section in enumerate(section_audios):
        section_num = i + 1
        intro_text = (narrator_intros[i] or "").strip() or \
            _DEFAULT_INTRO_TEMPLATE.format(section_num=section_num)
        total_chars += len(intro_text)

        intro_mp3 = render_fn(intro_text, narrator_voice_id, narrator_model)
        intro_seg = AudioSegment.from_file(io.BytesIO(intro_mp3),  format="mp3")
        section_seg = AudioSegment.from_file(io.BytesIO(raw_section), format="mp3")
        pre_read_seg = AudioSegment.silent(duration=pre_read_pause * 1000)

        cue_points.append({
            "type":              "narrator_intro_start",
            "section_num":       section_num,
            "timestamp_seconds": round(cursor_ms / 1000, 2),
        })
        timeline.append(intro_seg)
        cursor_ms += len(intro_seg)

        timeline.append(pre_read_seg)
        cursor_ms += len(pre_read_seg)
        cue_points.append({
            "type":              "section_start",
            "section_num":       section_num,
            "timestamp_seconds": round(cursor_ms / 1000, 2),
        })

        timeline.append(section_seg)
        cursor_ms += len(section_seg)
        cue_points.append({
            "type":              "section_end",
            "section_num":       section_num,
            "timestamp_seconds": round(cursor_ms / 1000, 2),
        })

        if section_num < 4:
            inter_seg = AudioSegment.silent(duration=inter_section_pause * 1000)
            timeline.append(inter_seg)
            cursor_ms += len(inter_seg)

    # End block: pause + announcement.
    end_pause_seg = AudioSegment.silent(duration=end_pause * 1000)
    timeline.append(end_pause_seg)
    cursor_ms += len(end_pause_seg)

    total_chars += len(END_ANNOUNCEMENT_TEXT)
    end_mp3 = render_fn(END_ANNOUNCEMENT_TEXT, narrator_voice_id, narrator_model)
    end_seg = AudioSegment.from_file(io.BytesIO(end_mp3), format="mp3")
    timeline.append(end_seg)
    cursor_ms += len(end_seg)
    cue_points.append({
        "type":              "test_end",
        "timestamp_seconds": round(cursor_ms / 1000, 2),
    })

    combined = timeline[0]
    for seg in timeline[1:]:
        combined = combined + seg

    out_buf = io.BytesIO()
    combined.export(out_buf, format="mp3", bitrate="192k")
    mp3_bytes = out_buf.getvalue()

    credit_estimate = total_chars * _CREDITS_PER_CHAR_MULTILINGUAL

    return AssemblyResult(
        mp3_bytes=mp3_bytes,
        duration_seconds=int(cursor_ms / 1000),
        cue_points=cue_points,
        narrator_credit_estimate=credit_estimate,
    )


# ── Publish gate ───────────────────────────────────────────────────────────


def can_publish(test_row: dict[str, Any]) -> tuple[bool, str | None]:
    """Sprint 13.4.3 publish-gate rule.

    Returns ``(allowed, reason_when_blocked)``. Allowed when at least one
    audio mode is satisfied:
      * ``full_premixed``         + ``full_audio_storage_path`` populated
      * ``parts_auto_assembled``  + ``assembled_audio_storage_path`` populated

    Mode ``parts_only`` is always blocked from publish (parts only
    support Sprint 13.6 exercise cutter workflow, not the full test
    surfaced to students).
    """
    mode = test_row.get("audio_assembly_mode")
    if mode == "full_premixed":
        if test_row.get("full_audio_storage_path"):
            return True, None
        return False, (
            "Mode 'full_premixed' yêu cầu full_audio_storage_path — "
            "tải audio đầy đủ trước khi publish."
        )
    if mode == "parts_auto_assembled":
        if test_row.get("assembled_audio_storage_path"):
            return True, None
        return False, (
            "Mode 'parts_auto_assembled' yêu cầu assembled_audio_storage_path — "
            "click 'Render & assemble' để tạo audio trước khi publish."
        )
    if mode == "parts_only":
        return False, (
            "Mode 'parts_only' chỉ hỗ trợ exercise mode (Sprint 13.6 cutter). "
            "Để publish full test, chuyển sang 'full_premixed' hoặc "
            "'parts_auto_assembled'."
        )
    return False, (
        "Chưa chọn audio_assembly_mode — tải audio trước khi publish."
    )
