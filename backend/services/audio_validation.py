"""
services/audio_validation.py — Sprint 14.2

Per-question minimum-duration gate for speaking responses. Andy's commission
cap-table:

    Part 1 → 15 s · Part 2 → 80 s · Part 3 → 25 s

Why a hard floor (HTTP 422) instead of letting the heuristic cap in
`grading._apply_heuristic_caps` handle it?

  The cap covers *content sparsity* (low word count → band ceiling). It
  cannot detect *intent failures* — a 2-second clip is not a band-3
  answer, it is "user did not answer". Returning a band score for that
  trains learners to game the system. The hard floor rejects the clip
  before Claude is invoked and tells the user, in their own language,
  what threshold they missed.

Why duration rather than word count?

  Recording length is what the *user* controls. Word count is what
  *Whisper* extracts. The same 5-second clip can transcribe to zero
  words (silence / hiss) or eight words (mumbled). The gate must
  measure the dimension the user can correct: pressing the record
  button for longer.

Duration source

  Post-Whisper `duration_seconds`. Whisper decodes the audio bytes to
  measure length, so its value is authoritative against the actual
  payload — independent of any client-side `MediaRecorder` clock
  (which is broken on Chrome < 115; see Sprint 14.2 pre-flight PF1).
  An ffprobe wrapper would duplicate the same measurement; deferred
  to a later sprint if/when STT-bypass paths appear.
"""

from __future__ import annotations


MIN_DURATION_BY_PART: dict[int, int] = {
    1: 15,
    2: 80,
    3: 25,
}


class AudioTooShortError(Exception):
    """Raised when a recorded answer is below the per-part minimum.

    Attributes are surfaced verbatim by the grading endpoint as a
    structured HTTP 422 detail body so the frontend can render an
    actionable re-record prompt ("Cần thêm Xs nữa") without parsing
    a free-form message.
    """

    def __init__(self, *, duration_seconds: float, part: int, min_seconds: int):
        self.duration_seconds = float(duration_seconds)
        self.part = int(part)
        self.min_seconds = int(min_seconds)
        super().__init__(
            f"Audio quá ngắn cho Part {part}: "
            f"{duration_seconds:.1f}s < {min_seconds}s tối thiểu."
        )

    def to_detail(self) -> dict:
        """Structured HTTP 422 detail body — pinned by frontend sentinel.

        Keys: code, part, duration_seconds, min_seconds, message.
        Frontend dispatches on `code == 'audio_too_short'` so renaming
        any key here is a breaking change and must update the sentinel.
        """
        return {
            "code":             "audio_too_short",
            "part":             self.part,
            "duration_seconds": round(self.duration_seconds, 2),
            "min_seconds":      self.min_seconds,
            "message":          str(self),
        }


def validate_audio_duration(duration_seconds: float, part: int) -> None:
    """Raise :class:`AudioTooShortError` if duration is below the per-part minimum.

    Returns ``None`` on success. The grading endpoint calls this right
    after the Whisper STT step (which gives us the authoritative
    duration) and catches the error to re-raise as a structured 422.

    Defensive: parts not in :data:`MIN_DURATION_BY_PART` are treated as
    no-op. The only caller is the grading endpoint, whose `part` is
    sourced from `sessions.part` (always 1, 2, or 3); a value outside
    that range means schema drift, not user error, and the heuristic
    caps in :mod:`grading` will still apply.
    """
    min_seconds = MIN_DURATION_BY_PART.get(int(part))
    if min_seconds is None:
        return
    if float(duration_seconds) < min_seconds:
        raise AudioTooShortError(
            duration_seconds=duration_seconds,
            part=part,
            min_seconds=min_seconds,
        )
