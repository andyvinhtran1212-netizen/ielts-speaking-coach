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


def test_fallback_ignores_cue_card_scaffolding():
    """PR #591 review: a Part 2 question_text carries the full 'You should say:'
    + bullets prompt. The empty-transcript fallback must score against the TOPIC
    line only — otherwise the scaffolding inflates the denominator and an on-topic
    sample repeating one topic word drops below threshold and is wrongly removed."""
    cue_card = (
        "Describe a memorable trip you took.\n"
        "You should say:\n"
        "- where you went\n"
        "- who you went with\n"
        "- what you did there\n"
        "and explain why it was so memorable."
    )
    on_topic = _validate_sample_relevance(
        "um, the, a", "My trip to Da Nang was wonderful.", question=cue_card,
    )
    assert on_topic >= _RELEVANCE_THRESHOLD     # kept (would be < 0.15 against the full prompt)


def test_question_topic_words_strips_bullets_and_fillers():
    from services.claude_grader import _question_topic_words
    words = _question_topic_words(
        "Describe a memorable trip you took.\nYou should say:\n- where you went\n- who"
    )
    assert "trip" in words           # topic word kept
    assert "describe" not in words   # instruction filler dropped
    assert "went" not in words       # bullet content (line 2+) dropped


# ── Finding #6 — question overlap BOOSTS a grounded sample, never rescues ───

def test_grounded_paraphrase_boosted_by_question_overlap():
    """A sample that DOES echo the learner's ideas (touches the transcript) and
    is on-topic for the question is kept — question overlap boosts it so a
    legitimate paraphrase isn't false-dropped by low verbatim transcript overlap."""
    transcript = "I like reading books because it relaxes me after work"
    question   = "What hobbies do you enjoy in your free time?"
    sample = "Reading books is a great hobby that helps me relax."  # touches "reading"/"books"
    score = _validate_sample_relevance(transcript, sample, question=question)
    assert score >= _RELEVANCE_THRESHOLD


def test_zero_transcript_grounding_not_rescued_by_question():
    """P2 fix: when the transcript has content words, a sample that repeats only
    question-topic words (ZERO overlap with what the learner said) must NOT pass
    on question overlap alone — it ignores the learner's ideas, so it's below
    threshold → regenerated."""
    transcript = "I like reading books because it relaxes me after work"
    question   = "What hobbies do you enjoy in your free time?"
    sample = "Enjoying hobbies during free time is a great way to unwind."  # no reading/books
    score = _validate_sample_relevance(transcript, sample, question=question)
    assert score < _RELEVANCE_THRESHOLD   # caught despite matching the question topic


def test_sample_off_topic_to_both_still_caught():
    """Drifts from BOTH the transcript and the question topic → below threshold."""
    transcript = "I like reading books in the evening"
    question   = "What hobbies do you enjoy?"
    sample     = "Photosynthesis converts sunlight into chemical energy in plants."
    score = _validate_sample_relevance(transcript, sample, question=question)
    assert score < _RELEVANCE_THRESHOLD


def test_stopword_transcript_still_uses_question_overlap():
    """When the transcript is ONLY stopwords (no content words to ground on),
    question overlap is the only signal — unchanged fallback behavior."""
    on_topic  = _validate_sample_relevance("um, the, a", "I enjoy many hobbies daily.",
                                           question="What hobbies do you enjoy?")
    off_topic = _validate_sample_relevance("um, the, a", "Photosynthesis feeds plants.",
                                           question="What hobbies do you enjoy?")
    assert on_topic >= _RELEVANCE_THRESHOLD
    assert off_topic < _RELEVANCE_THRESHOLD
