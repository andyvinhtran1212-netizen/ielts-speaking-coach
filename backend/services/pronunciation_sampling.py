"""
services/pronunciation_sampling.py — Sample selection for full-test pronunciation assessment

For each full-test session, selects exactly 3 representative audio samples:
  - Part 1: 1 response, prefer duration_seconds >= 12
  - Part 2: 1 response with a time-window segment extracted
  - Part 3: 1 response, prefer duration_seconds >= 15

Segment rules for Part 2:
  - duration >= 45s  → extract [10s, 45s]  (skip intro, grab body)
  - 25s <= dur < 45s → extract middle third
  - dur < 25s        → use full audio, flag low_confidence_sample=True
"""

import logging
import random
import subprocess
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class SelectedSample:
    response_id:        str
    part:               int
    duration_seconds:   Optional[float]
    selection_reason:   str              # human-readable note for result page
    audio_start_s:      Optional[float]  # None = use full audio
    audio_end_s:        Optional[float]  # None = use full audio
    low_confidence_sample: bool = False


# ── Part selectors ─────────────────────────────────────────────────────────────

def select_part1_sample(responses: list[dict]) -> Optional[SelectedSample]:
    """
    Pick one Part 1 response.
    Prefer duration >= 12s (random among qualifiers); fall back to longest.
    """
    if not responses:
        return None

    qualifiers = [r for r in responses if (r.get("duration_seconds") or 0) >= 12]

    if qualifiers:
        chosen = random.choice(qualifiers)
        reason = "Random sample from Part 1 answers ≥12 s"
    else:
        chosen = max(responses, key=lambda r: r.get("duration_seconds") or 0)
        reason = "Longest available Part 1 answer (all < 12 s)"

    return SelectedSample(
        response_id=chosen["id"],
        part=1,
        duration_seconds=chosen.get("duration_seconds"),
        selection_reason=reason,
        audio_start_s=None,
        audio_end_s=None,
    )


def _part2_segment(duration_s: float) -> tuple[Optional[float], Optional[float], bool]:
    """
    Determine (start_s, end_s, low_confidence) for a Part 2 audio.
    Returns (None, None, False) when the full clip should be used without concern.
    """
    if duration_s >= 45:
        return 10.0, 45.0, False
    elif duration_s >= 25:
        # Middle third
        third = duration_s / 3
        start = round(third, 1)
        end   = round(third * 2, 1)
        return start, end, False
    else:
        # Too short — use everything but flag it
        return None, None, True


def select_part2_sample(responses: list[dict]) -> Optional[SelectedSample]:
    """
    Pick one Part 2 response and determine the audio segment to assess.
    Prefer the longest response (most speech to sample from).
    """
    if not responses:
        return None

    chosen = max(responses, key=lambda r: r.get("duration_seconds") or 0)
    duration = chosen.get("duration_seconds") or 0

    start_s, end_s, low_conf = _part2_segment(duration)

    if low_conf:
        reason = f"Part 2 answer only {duration:.0f} s — full audio used (low confidence)"
    elif start_s is not None:
        reason = f"Segment {start_s:.0f}s–{end_s:.0f}s of Part 2 answer ({duration:.0f} s total)"
    else:
        reason = f"Full Part 2 answer ({duration:.0f} s)"

    return SelectedSample(
        response_id=chosen["id"],
        part=2,
        duration_seconds=duration,
        selection_reason=reason,
        audio_start_s=start_s,
        audio_end_s=end_s,
        low_confidence_sample=low_conf,
    )


def select_part3_sample(responses: list[dict]) -> Optional[SelectedSample]:
    """
    Pick one Part 3 response.
    Prefer duration >= 15s (random among qualifiers); fall back to longest.
    """
    if not responses:
        return None

    qualifiers = [r for r in responses if (r.get("duration_seconds") or 0) >= 15]

    if qualifiers:
        chosen = random.choice(qualifiers)
        reason = "Random sample from Part 3 answers ≥15 s"
    else:
        chosen = max(responses, key=lambda r: r.get("duration_seconds") or 0)
        reason = "Longest available Part 3 answer (all < 15 s)"

    return SelectedSample(
        response_id=chosen["id"],
        part=3,
        duration_seconds=chosen.get("duration_seconds"),
        selection_reason=reason,
        audio_start_s=None,
        audio_end_s=None,
    )


# ── Audio segment extraction ───────────────────────────────────────────────────

def extract_audio_segment(
    audio_bytes: bytes,
    start_s: Optional[float],
    end_s:   Optional[float],
) -> bytes:
    """
    Trim audio to [start_s, end_s] and return WAV PCM 16kHz mono 16-bit bytes.
    If start_s/end_s are None, still converts to WAV (no trimming).
    Returns original bytes unchanged only if ffmpeg is unavailable.
    """
    cmd = [
        "ffmpeg", "-y",
        "-i", "pipe:0",
        "-ar", "16000",
        "-ac", "1",
        "-sample_fmt", "s16",
    ]

    if start_s is not None:
        cmd += ["-ss", str(start_s)]
    if end_s is not None:
        cmd += ["-to", str(end_s)]

    cmd += ["-f", "wav", "pipe:1"]

    try:
        proc = subprocess.run(
            cmd,
            input=audio_bytes,
            capture_output=True,
            timeout=30,
        )
        if proc.returncode == 0 and len(proc.stdout) > 44:
            logger.info(
                "[sampling] segment extract OK: start=%s end=%s  %dB → %dB",
                start_s, end_s, len(audio_bytes), len(proc.stdout),
            )
            return proc.stdout
        else:
            logger.warning(
                "[sampling] ffmpeg segment extract returned code %d  stderr=%s",
                proc.returncode,
                proc.stderr.decode(errors="replace")[:300],
            )
            return audio_bytes
    except FileNotFoundError:
        logger.warning("[sampling] ffmpeg not found — returning original bytes")
        return audio_bytes
    except subprocess.TimeoutExpired:
        logger.warning("[sampling] ffmpeg segment extract timed out")
        return audio_bytes
    except Exception as exc:
        logger.warning("[sampling] ffmpeg segment extract error: %s", exc)
        return audio_bytes
