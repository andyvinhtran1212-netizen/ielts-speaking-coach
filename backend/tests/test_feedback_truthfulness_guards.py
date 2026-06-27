"""B3 — feedback-truthfulness guards in claude_grader.

Mục 7: an article/determiner flag with no quoted noun phrase can't be validated
against the transcript, so it's dropped rather than surfaced unchecked (false
article flags are the project's top feedback-quality concern).

Mục 19: when the transcript has no content words, sample-relevance falls back to
QUESTION overlap instead of blindly returning 1.0 ("assume relevant") — so an
off-topic sample is still caught while an on-topic one is kept.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.claude_grader import (
    _filter_false_article_flags,
    _validate_sample_relevance,
    _RELEVANCE_THRESHOLD,
)


# ── Mục 7 — article false-positive guard ──────────────────────────────


def test_unquoted_article_flag_is_dropped():
    """An article-issue keyword with NO quoted noun → unvalidatable → dropped."""
    issues = ["Thiếu mạo từ trước danh từ"]          # matches "mạo từ", no quotes
    assert _filter_false_article_flags(issues, "I went to school yesterday") == []


def test_non_article_issue_passes_through_untouched():
    """A non-article issue is never touched by the article guard."""
    issues = ["Sai thì: 'go' nên là 'went'"]
    out = _filter_false_article_flags(issues, "yesterday I go to school")
    assert out == issues


def test_quoted_article_flag_without_determiner_is_kept():
    """A real article issue (quoted noun, no determiner before it in the
    transcript) is still surfaced — the guard only drops the unvalidatable ones."""
    issues = ["Thiếu mạo từ trước 'museum'"]
    out = _filter_false_article_flags(issues, "I visited museum last week")
    assert out == issues


def test_quoted_article_flag_with_determiner_in_transcript_is_dropped():
    """The original false-positive case still works: the noun already has a
    determiner in the transcript → drop."""
    issues = ["Thiếu mạo từ trước 'museum'"]
    out = _filter_false_article_flags(issues, "I visited the museum last week")
    assert out == []


# ── Mục 19 — sample relevance with empty-transcript question fallback ──


def test_relevance_uses_transcript_overlap_when_present():
    score = _validate_sample_relevance("I really love my dog", "A dog is a loyal pet")
    assert score > 0.0


def test_empty_transcript_keeps_on_topic_sample_via_question():
    """Transcript is only stopwords → fall back to QUESTION overlap. An on-topic
    sample scores above the regen threshold (kept); off-topic scores below it."""
    q = "Do you enjoy travel?"
    on_topic = _validate_sample_relevance("um the a", "Travel broadens the mind", question=q)
    off_topic = _validate_sample_relevance("um the a", "Cooking pasta is a useful skill", question=q)
    assert on_topic > off_topic
    assert on_topic >= _RELEVANCE_THRESHOLD     # not wrongly regenerated/removed
    assert off_topic < _RELEVANCE_THRESHOLD     # off-topic still caught


def test_empty_transcript_and_question_assumes_relevant():
    """Nothing to measure against → 1.0 (no evidence of drift), don't remove."""
    assert _validate_sample_relevance("um a the", "anything at all", question="") == 1.0
