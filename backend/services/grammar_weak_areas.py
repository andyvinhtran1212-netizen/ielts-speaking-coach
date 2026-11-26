"""The learner's weak grammar areas: one rule for the learner's grammar
dashboard (``GET /grammar/dashboard-data`` ``weak_areas``) and the admin
learner profile's Học tập tab (``weak_grammar_groups``, ADMINIA-0074 FR-025).

A grammar article recommended to the learner at least twice in the last 30
days (``grammar_recommendations``, written per Speaking response by
``grading.py``) is a weak area; the five most frequent are shown. Rows whose
article is no longer in the content index are dropped, never deleted.
"""

from __future__ import annotations

from collections import Counter
from typing import Any, Callable, Optional

WINDOW_DAYS = 30
MIN_OCCURRENCES = 2
TOP = 5


def weak_areas(rows: list[dict], get_article: Callable[[Any], Optional[dict]]) -> list[dict]:
    """``rows``: the learner's ``grammar_recommendations`` of the window
    (``recommended_slug``, ``created_at``)."""
    rows = [r for r in rows if get_article(r.get("recommended_slug"))]
    counts = Counter(r["recommended_slug"] for r in rows if r.get("recommended_slug"))
    last_seen: dict[str, str] = {}
    for r in rows:
        slug = r.get("recommended_slug")
        if slug and (slug not in last_seen or r["created_at"] > last_seen[slug]):
            last_seen[slug] = r["created_at"]
    return [
        {
            "tag": slug,
            "label_vi": (get_article(slug) or {}).get("title", slug),
            "category": (get_article(slug) or {}).get("category", ""),
            "occurrence_count": count,
            "last_seen_at": last_seen.get(slug),
        }
        for slug, count in counts.most_common(TOP)
        if count >= MIN_OCCURRENCES
    ]
