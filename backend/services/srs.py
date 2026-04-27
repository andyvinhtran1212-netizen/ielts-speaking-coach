"""
services/srs.py — Phase D Wave 2: spaced-repetition algorithm.

Simplified SM-2.  Pure function, no DB I/O — the caller (routers/flashcards.py)
is responsible for fetching the current review row, calling update_srs(), and
upserting the result.  Keeping side effects out of this module is what makes
test_srs_algorithm.py able to lock the algorithm contract with a deterministic
sequential walk.

Algorithm (matches PHASE_D_WAVE_2_PLAN.md §4):

    rating='again' →  interval=0, ease=max(1.3, e-0.2),     lapse++
    rating='hard'  →  interval=max(1, int(i * 1.2)),        ease=max(1.3, e-0.15)
    rating='good'  →  interval=max(1, int(i * e)),          ease unchanged
    rating='easy'  →  interval=max(1, int(i * e * 1.3)),    ease=min(3.0, e+0.15)

ease_factor floor 1.3 / cap 3.0 mirror the CHECK constraint in migration 027.
review_count always increments by 1; lapse_count only on 'again'.

Interval is capped at _INTERVAL_CAP days (~100 years, same number Anki uses)
so a long unbroken streak of 'easy' ratings can't grow `now + timedelta(days=…)`
past datetime's range.  Without the cap, ~20 'easy' ratings starting from
interval=1 push the schedule out to 10^11 days and OverflowError.
"""

from datetime import datetime, timedelta, timezone
from typing import Any

# Public so frontend / docs can list the supported ratings without duplicating
# the literal in two places.
VALID_RATINGS = ("again", "hard", "good", "easy")

_EASE_FLOOR = 1.3
_EASE_CAP = 3.0
_INTERVAL_CAP = 36500  # days — matches Anki's default upper bound.


def update_srs(review: Any, rating: str) -> dict:
    """
    Compute the next SRS state given the prior `review` row and the user's
    self-rating.

    Args:
        review: any object exposing the four fields ease_factor, interval_days,
                review_count, lapse_count.  A SimpleNamespace, a Pydantic model,
                or a row dict wrapped in types.SimpleNamespace all work.  Duck
                typing is intentional — keeps the function decoupled from the
                ORM/Pydantic shape used by the router.
        rating: one of 'again' | 'hard' | 'good' | 'easy'.

    Returns:
        A dict with the six fields the caller needs to upsert into
        flashcard_reviews:
            interval_days, ease_factor, lapse_count, review_count,
            last_reviewed_at (ISO UTC), next_review_at (ISO UTC).

    Raises:
        ValueError: when `rating` is not one of VALID_RATINGS.
    """
    if rating not in VALID_RATINGS:
        raise ValueError(f"Invalid rating: {rating!r} (expected one of {VALID_RATINGS})")

    ease = float(review.ease_factor)
    interval = int(review.interval_days)
    lapse = int(review.lapse_count)
    rcount = int(review.review_count)

    if rating == "again":
        new_interval = 0
        new_ease = max(_EASE_FLOOR, ease - 0.2)
        new_lapse = lapse + 1
    elif rating == "hard":
        new_interval = max(1, int(interval * 1.2))
        new_ease = max(_EASE_FLOOR, ease - 0.15)
        new_lapse = lapse
    elif rating == "good":
        new_interval = max(1, int(interval * ease))
        new_ease = ease
        new_lapse = lapse
    else:  # 'easy' — guarded by the membership check above
        new_interval = max(1, int(interval * ease * 1.3))
        new_ease = min(_EASE_CAP, ease + 0.15)
        new_lapse = lapse

    if new_interval > _INTERVAL_CAP:
        new_interval = _INTERVAL_CAP

    now = datetime.now(timezone.utc)
    return {
        "interval_days": new_interval,
        "ease_factor": new_ease,
        "lapse_count": new_lapse,
        "review_count": rcount + 1,
        "last_reviewed_at": now.isoformat(),
        "next_review_at": (now + timedelta(days=new_interval)).isoformat(),
    }
