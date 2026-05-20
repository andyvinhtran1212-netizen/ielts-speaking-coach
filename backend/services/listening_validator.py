"""
backend/services/listening_validator.py — Sprint 13.2
(DEBT-ADMIN-LISTENING-AUTHORING 2/N).

Pure validation helpers consumed by the admin upload endpoints
(POST /admin/listening/upload, /upload/bulk, /upload/validate).

Returns a `ValidationResult` shape: a dict with two lists, `errors` and
`warnings`. Errors block the upload at the router layer (422); warnings
allow the upload but bubble back to the admin UI so the operator can
fix in a follow-up PATCH if needed.

Auto-validate fail-soft policy (Sprint 13.2 commission §Style): if a
helper raises unexpectedly, the caller should log + treat as
"warnings: [...], errors: []" so a validator bug never blocks an
otherwise-correct upload.

Pure-helper discipline (Sprint 11.x pattern): no I/O, no Supabase
calls, no logging side-effects. Inputs are bytes / strings / ints;
outputs are plain dicts. Easy to unit-test under node:test? — no, we
test under pytest, but the same "no I/O" rule still applies.
"""

from __future__ import annotations

import re
from typing import Iterable, TypedDict


# ── ValidationResult shape ────────────────────────────────────────────────────


class _Issue(TypedDict):
    code: str
    message: str
    field: str
    severity: str  # "error" | "warning"


class ValidationResult(TypedDict):
    errors:   list[_Issue]
    warnings: list[_Issue]


def empty_result() -> ValidationResult:
    return {"errors": [], "warnings": []}


def merge_results(*results: ValidationResult) -> ValidationResult:
    out = empty_result()
    for r in results:
        out["errors"].extend(r.get("errors", []))
        out["warnings"].extend(r.get("warnings", []))
    return out


def _issue(code: str, message: str, field: str, severity: str) -> _Issue:
    return {"code": code, "message": message, "field": field, "severity": severity}


# ── Audio metadata validation ─────────────────────────────────────────────────


_MIN_AUDIO_BYTES = 50 * 1024            # 50 KB — anything smaller is almost
                                        # certainly truncated or empty.
_MAX_AUDIO_BYTES = 50 * 1024 * 1024     # 50 MB — Vercel function payload cap.
_MP3_MAGIC_PREFIXES = (
    b"\xff\xfb", b"\xff\xf3", b"\xff\xfa", b"\xff\xf2",  # MPEG-1/2 Layer 3 sync
    b"ID3",                                              # ID3v2 tag
)


def validate_audio_metadata(
    file_bytes: bytes,
    declared_duration_seconds: int | None = None,
) -> ValidationResult:
    """Auto-checks the uploaded audio bytes.

    Checks:
      - File size sanity: 50 KB ≤ size ≤ 50 MB
      - MP3 magic bytes (ID3 tag or MPEG sync). Soft warning if absent
        — some valid MP3s may start with junk bytes before the first
        sync frame, but it's rare enough to flag.
      - Declared-vs-inferred duration drift ±20%. We don't ship a real
        MP3 frame walker (mutagen isn't a hard dep); the duration probe
        infers a coarse rate from byte size. The drift band is wide
        because the inference itself is coarse.

    Args:
      file_bytes: raw upload bytes.
      declared_duration_seconds: what the caller said the audio is. If
        None, the duration check is skipped.
    """
    result = empty_result()
    size = len(file_bytes)

    if size == 0:
        result["errors"].append(_issue(
            "audio_empty",
            "File audio rỗng — không có byte nào được upload.",
            "audio_file", "error",
        ))
        return result  # nothing else makes sense

    if size < _MIN_AUDIO_BYTES:
        result["errors"].append(_issue(
            "audio_too_small",
            f"File audio quá nhỏ ({size} bytes) — kỳ vọng ≥ {_MIN_AUDIO_BYTES} bytes.",
            "audio_file", "error",
        ))
    elif size > _MAX_AUDIO_BYTES:
        result["errors"].append(_issue(
            "audio_too_large",
            f"File audio quá lớn ({size} bytes) — giới hạn {_MAX_AUDIO_BYTES} bytes (~50 MB).",
            "audio_file", "error",
        ))

    head = file_bytes[:3]
    if not any(file_bytes.startswith(p) for p in _MP3_MAGIC_PREFIXES):
        result["warnings"].append(_issue(
            "audio_not_mp3_signature",
            "File audio không có MP3 magic bytes (ID3 / MPEG sync) ở đầu file. "
            "Vẫn upload được, nhưng nên kiểm tra lại định dạng.",
            "audio_file", "warning",
        ))

    # Coarse duration probe: mirror the router's existing size→seconds
    # heuristic (≈128 kbps ⇒ 16 KB/sec). This is intentionally simple;
    # the segments editor (Sprint 11.3+) probes via <audio>.duration
    # on the client and writes the precise duration back.
    inferred_seconds = max(1, round(size / 16_000))
    if (
        declared_duration_seconds is not None
        and declared_duration_seconds > 0
    ):
        diff = abs(declared_duration_seconds - inferred_seconds)
        tolerance = max(2, int(declared_duration_seconds * 0.20))
        if diff > tolerance:
            result["warnings"].append(_issue(
                "duration_drift",
                f"Duration khai báo ({declared_duration_seconds}s) lệch nhiều "
                f"so với suy luận từ file size ({inferred_seconds}s, ±{tolerance}s). "
                "Có thể duration sai hoặc bitrate ngoài 128 kbps.",
                "audio_duration_seconds", "warning",
            ))

    _ = head  # appeasing linters — head reserved for future signature checks.
    return result


def infer_duration_seconds(file_bytes: bytes) -> int:
    """Convenience wrapper mirroring the existing
    `routers/listening.py` heuristic — exported so the bulk endpoint
    can share the same inference path before validation runs.
    """
    if not file_bytes:
        return 0
    return max(1, round(len(file_bytes) / 16_000))


# ── Transcript quality validation ─────────────────────────────────────────────


_MIN_TRANSCRIPT_CHARS = 20
_MAX_TRANSCRIPT_CHARS = 50_000
_WORD_RE = re.compile(r"[\w']+", re.UNICODE)

# Allowed words-per-minute band. IELTS native-speaker prose averages
# 120-180 wpm; we widen to 60-220 to absorb slow narration + fast news.
_MIN_WPM = 60
_MAX_WPM = 220


def _word_count(s: str) -> int:
    return len(_WORD_RE.findall(s or ""))


def validate_transcript_quality(
    transcript: str,
    declared_duration_seconds: int | None = None,
) -> ValidationResult:
    """Auto-checks the transcript text.

    Checks:
      - Min length (20 chars) — catches obvious empty / placeholder.
      - Max length (50 000 chars) — catches runaway pastes.
      - Word-count plausibility vs declared duration (60-220 wpm band).
        Outside the band → warning (not error — IELTS Section 1
        timetable announcements can be sparse).

    Args:
      transcript: the admin-supplied text.
      declared_duration_seconds: when None, the wpm plausibility check
        is skipped.
    """
    result = empty_result()
    text = (transcript or "").strip()

    if not text:
        result["errors"].append(_issue(
            "transcript_empty",
            "Transcript trống.",
            "transcript", "error",
        ))
        return result

    if len(text) < _MIN_TRANSCRIPT_CHARS:
        result["errors"].append(_issue(
            "transcript_too_short",
            f"Transcript quá ngắn ({len(text)} ký tự) — tối thiểu {_MIN_TRANSCRIPT_CHARS}.",
            "transcript", "error",
        ))
    elif len(text) > _MAX_TRANSCRIPT_CHARS:
        result["errors"].append(_issue(
            "transcript_too_long",
            f"Transcript quá dài ({len(text)} ký tự) — tối đa {_MAX_TRANSCRIPT_CHARS}.",
            "transcript", "error",
        ))

    if (
        declared_duration_seconds is not None
        and declared_duration_seconds > 0
        and not result["errors"]   # don't double up on already-broken text
    ):
        words = _word_count(text)
        minutes = declared_duration_seconds / 60.0
        wpm = words / minutes if minutes > 0 else 0
        if words < 3:
            result["warnings"].append(_issue(
                "transcript_too_few_words",
                f"Transcript chỉ có {words} từ — kiểm tra lại có phải là transcript đầy đủ chưa.",
                "transcript", "warning",
            ))
        elif wpm < _MIN_WPM:
            result["warnings"].append(_issue(
                "transcript_low_wpm",
                f"Mật độ từ thấp: {words} từ / {declared_duration_seconds}s = {wpm:.0f} wpm "
                f"(thấp hơn band {_MIN_WPM}-{_MAX_WPM} wpm thông thường).",
                "transcript", "warning",
            ))
        elif wpm > _MAX_WPM:
            result["warnings"].append(_issue(
                "transcript_high_wpm",
                f"Mật độ từ cao: {words} từ / {declared_duration_seconds}s = {wpm:.0f} wpm "
                f"(cao hơn band {_MIN_WPM}-{_MAX_WPM} wpm — duration có thể sai).",
                "transcript", "warning",
            ))

    return result


# ── Combined entry point used by the routers ──────────────────────────────────


def validate_upload(
    *,
    file_bytes: bytes,
    transcript: str,
    declared_duration_seconds: int | None = None,
) -> ValidationResult:
    """One-shot helper that runs both audio + transcript checks and
    merges the result. Routers call this and then translate `errors`
    into HTTP 422 + return `warnings` to the client.
    """
    return merge_results(
        validate_audio_metadata(file_bytes, declared_duration_seconds),
        validate_transcript_quality(transcript, declared_duration_seconds),
    )


def has_errors(result: ValidationResult) -> bool:
    return bool(result.get("errors"))


__all__ = [
    "ValidationResult",
    "empty_result",
    "merge_results",
    "validate_audio_metadata",
    "validate_transcript_quality",
    "validate_upload",
    "infer_duration_seconds",
    "has_errors",
]
