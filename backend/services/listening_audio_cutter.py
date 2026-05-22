"""services/listening_audio_cutter.py — Sprint 13.6.

Carve a full pre-mixed listening MP3 into N timestamped segments via
ffmpeg's stream-copy codec (no re-encoding, no quality loss). The
admin audio-cutter UI drives this layer through two endpoints:

  * ``detect_silence_boundaries`` — analyse the source MP3 with
    ``ffmpeg -af silencedetect`` and propose 4 section boundaries
    (longest 3 silent gaps split the audio into 4 ranges).
  * ``cut_segments`` — for each admin-confirmed segment, run
    ``ffmpeg -ss start -i source -t duration -c copy`` to produce a
    new MP3 that lives next to the source in Supabase Storage.

Design choices:

* **Pure functions over a mocked ffmpeg surface.** Tests patch
  ``run_ffmpeg`` at the module boundary so no real ffmpeg call fires
  in unit tests. The endpoint layer wraps the helpers with auth +
  storage + DB writes.
* **Stream-copy.** ``-c copy`` reuses the source codec frames — fast
  and lossless. Cuts may align to the nearest keyframe (~1s); for
  IELTS section boundaries this drift is well below the silent gap.
* **Default thresholds.** ``silence_threshold_db = -40``,
  ``min_silence_duration = 2.0``. Both are tunable per request so
  admin can adjust for noisy / quiet source audio.
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
from dataclasses import dataclass
from typing import Sequence

logger = logging.getLogger(__name__)


# ── Defaults ───────────────────────────────────────────────────────────────


DEFAULT_SILENCE_THRESHOLD_DB: float = -40.0
DEFAULT_MIN_SILENCE_DURATION: float = 2.0

# Minimum segment duration we will emit. Anything shorter is almost
# certainly noise (admin slipped while dragging the region), so we
# skip silently rather than burning storage on a < 1 s blip.
MIN_SEGMENT_DURATION_SECONDS: float = 1.0


# ── Data shapes ────────────────────────────────────────────────────────────


@dataclass
class Boundary:
    """One proposed section boundary (start..end, both inclusive)."""

    start: float
    end: float


@dataclass
class Segment:
    """One admin-confirmed segment ready to cut."""

    label: str
    start: float
    end: float


# ── ffmpeg boundary (mocked in tests) ──────────────────────────────────────


def run_ffmpeg(
    args: Sequence[str],
    *,
    timeout_seconds: int = 120,
) -> subprocess.CompletedProcess[str]:
    """Run an ffmpeg / ffprobe command and return the completed
    process. Patched in tests so no real binary needs to fire.
    """
    return subprocess.run(
        list(args),
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
    )


# ── Silence detection ──────────────────────────────────────────────────────


_SILENCE_START_RE = re.compile(r"silence_start:\s*([\d.]+)")
_SILENCE_END_RE = re.compile(r"silence_end:\s*([\d.]+)")
_DURATION_RE = re.compile(
    r"Duration:\s*(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)",
)


def parse_silence_output(stderr: str) -> list[Boundary]:
    """Extract ``(silence_start, silence_end)`` pairs from ffmpeg's
    silencedetect stderr. Returns the list ordered by ``start``.

    ffmpeg prints ``silence_start: X`` first and ``silence_end: Y``
    later for each gap; if the audio ends inside a silent gap the
    end line may be missing — we drop those incomplete pairs because
    a section boundary mid-silence isn't usable.
    """
    starts = [float(m.group(1)) for m in _SILENCE_START_RE.finditer(stderr)]
    ends = [float(m.group(1)) for m in _SILENCE_END_RE.finditer(stderr)]
    pairs: list[Boundary] = []
    for s, e in zip(starts, ends):
        if e > s:
            pairs.append(Boundary(start=s, end=e))
    return pairs


def parse_audio_duration(stderr: str) -> float | None:
    """ffmpeg writes ``Duration: HH:MM:SS.cc`` on its banner line.
    Return seconds, or ``None`` if the banner is missing (rare).
    """
    m = _DURATION_RE.search(stderr)
    if not m:
        return None
    h = int(m.group(1))
    mm = int(m.group(2))
    s = float(m.group(3))
    return h * 3600 + mm * 60 + s


def detect_silence(
    audio_path: str,
    *,
    silence_threshold_db: float = DEFAULT_SILENCE_THRESHOLD_DB,
    min_silence_duration: float = DEFAULT_MIN_SILENCE_DURATION,
) -> tuple[list[Boundary], float | None]:
    """Run ``ffmpeg -af silencedetect`` against ``audio_path`` and
    return ``(silent_gaps, audio_duration_seconds_or_none)``.

    Raises ``RuntimeError`` if ffmpeg exits non-zero with no parseable
    output so the endpoint can return a clean 500.
    """
    cmd = [
        "ffmpeg",
        "-i", audio_path,
        "-af", (
            f"silencedetect="
            f"noise={silence_threshold_db}dB:"
            f"d={min_silence_duration}"
        ),
        "-f", "null", "-",
    ]
    result = run_ffmpeg(cmd)
    # ffmpeg writes silencedetect output to stderr even on success
    # (it always returns non-zero when no real output file is written;
    # we treat any non-empty stderr as parseable).
    stderr = result.stderr or ""
    if not stderr.strip():
        raise RuntimeError(
            "ffmpeg silencedetect produced no output — is the file readable?",
        )
    gaps = parse_silence_output(stderr)
    duration = parse_audio_duration(stderr)
    return gaps, duration


def propose_section_boundaries(
    gaps: list[Boundary],
    *,
    audio_duration: float,
    target_section_count: int = 4,
) -> list[Boundary]:
    """Pick the ``target_section_count - 1`` longest silent gaps and
    use them to split the audio into ``target_section_count`` ranges.

    Returns a list of ``Boundary(start, end)`` ranges sorted by start.
    Always returns ``target_section_count`` ranges (the last range
    covers from the final gap's end to ``audio_duration``).
    """
    if audio_duration <= 0:
        return []
    splits_needed = max(0, target_section_count - 1)
    longest = sorted(gaps, key=lambda g: g.end - g.start, reverse=True)
    splits = sorted(longest[:splits_needed], key=lambda g: g.start)

    out: list[Boundary] = []
    prev_end: float = 0.0
    for gap in splits:
        out.append(Boundary(start=prev_end, end=gap.start))
        prev_end = gap.end
    out.append(Boundary(start=prev_end, end=audio_duration))
    return out


# ── Segment cutting ────────────────────────────────────────────────────────


_LABEL_SANITIZER_RE = re.compile(r"[^a-z0-9_-]")


def sanitize_label(label: str) -> str:
    """Lower-case + collapse anything outside ``[a-z0-9_-]`` into
    underscores. Used to build storage paths from admin-supplied
    labels without exposing path-traversal characters.
    """
    cleaned = _LABEL_SANITIZER_RE.sub("_", (label or "").lower()).strip("_")
    return cleaned or "segment"


def cut_segment_to_path(
    *,
    source_path: str,
    output_path: str,
    start_seconds: float,
    duration_seconds: float,
) -> None:
    """Run ``ffmpeg -ss start -i source -t duration -c copy output``.

    Uses stream-copy so there's no re-encoding (fast + lossless).
    Cuts may snap to the nearest keyframe — IELTS section boundaries
    have ~2s of silence around them so the drift is invisible.

    Raises ``RuntimeError`` on non-zero exit.
    """
    cmd = [
        "ffmpeg",
        "-y",                                  # overwrite
        "-ss", f"{start_seconds:.3f}",
        "-i", source_path,
        "-t", f"{duration_seconds:.3f}",
        "-c", "copy",
        output_path,
    ]
    result = run_ffmpeg(cmd, timeout_seconds=60)
    if result.returncode != 0:
        raise RuntimeError(
            f"ffmpeg cut failed (exit {result.returncode}): "
            f"{(result.stderr or '').strip()[:500]}",
        )


def validate_segments(segments: Sequence[Segment]) -> list[Segment]:
    """Drop segments shorter than ``MIN_SEGMENT_DURATION_SECONDS`` and
    return the kept list in input order. The caller surfaces the
    skipped count to the admin so a silent skip can't hide a tooling
    bug.
    """
    return [
        seg for seg in segments
        if (seg.end - seg.start) >= MIN_SEGMENT_DURATION_SECONDS
    ]


def build_storage_path(
    *,
    test_id: str,
    content_id: str,
    index: int,
    label: str,
) -> str:
    """``{test_id}/{content_id}/cut_{index}_{slug}.mp3`` — lives in
    the same ``listening-audio`` bucket as the source so storage
    cleanup tooling sweeps both with one prefix.
    """
    slug = sanitize_label(label)
    return f"{test_id}/{content_id}/cut_{index}_{slug}.mp3"
