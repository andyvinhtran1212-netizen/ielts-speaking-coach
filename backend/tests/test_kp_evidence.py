"""Phase 1 — the rule-based mastery engine (pure parts, no DB).

Locks the §2.3 model: weight ordering (microcheck > exam_item > implicit),
time-decay (recent evidence counts more), and the score→status buckets.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from services import kp_evidence as ke

NOW = datetime(2026, 7, 4, tzinfo=timezone.utc)


def _row(signal, weight, days_ago):
    return {"signal": signal, "weight": weight,
            "created_at": (NOW - timedelta(days=days_ago)).isoformat()}


def test_weight_ordering_matches_spec():
    # microcheck > exam_item/quiz/srs > implicit (distractor/speaking/writing).
    assert ke.WEIGHTS["microcheck"] > ke.WEIGHTS["exam_wrong"]
    assert ke.WEIGHTS["exam_wrong"] == ke.WEIGHTS["quiz"] == ke.WEIGHTS["srs_review"]
    assert ke.WEIGHTS["exam_wrong"] > ke.WEIGHTS["distractor_chosen"]
    assert ke.WEIGHTS["speaking_feedback"] == ke.WEIGHTS["distractor_chosen"]


def test_decay_halves_at_half_life():
    assert ke._decay(0) == 1.0
    assert abs(ke._decay(ke.HALF_LIFE_DAYS) - 0.5) < 1e-9
    assert ke._decay(-5) == 1.0  # clock skew clamps to fresh


def test_empty_evidence_is_neutral_learning():
    agg = ke.compute_mastery([], NOW)
    assert agg["status"] == "learning"
    assert agg["score"] == 0
    assert agg["evidence_count"] == 0
    assert agg["last_evidence_at"] is None


def test_two_fresh_correct_answers_reach_strong():
    agg = ke.compute_mastery([_row(1, 2.0, 0), _row(1, 2.0, 0)], NOW)
    assert agg["score"] == 4.0
    assert agg["status"] == "strong"


def test_fresh_wrong_answer_is_weak():
    agg = ke.compute_mastery([_row(-1, 2.0, 0)], NOW)
    assert agg["score"] == -2.0
    assert agg["status"] == "weak"


def test_single_implicit_signal_stays_learning():
    # one -1 implicit (speaking_feedback weight 1.0) is not enough for 'weak'.
    agg = ke.compute_mastery([_row(-1, 1.0, 0)], NOW)
    assert agg["status"] == "learning"


def test_decay_demotes_stale_mastery():
    # A single +1 exam signal one half-life old contributes only 1.0 → below the
    # strong threshold, so mastery has faded back to 'learning'.
    agg = ke.compute_mastery([_row(1, 2.0, ke.HALF_LIFE_DAYS)], NOW)
    assert abs(agg["score"] - 1.0) < 1e-6
    assert agg["status"] == "learning"


def test_last_evidence_at_is_the_most_recent():
    agg = ke.compute_mastery([_row(1, 2.0, 10), _row(-1, 1.0, 2)], NOW)
    assert agg["last_evidence_at"] == (NOW - timedelta(days=2)).isoformat()


def test_srs_rating_signal_mapping():
    assert ke._SRS_SIGNAL == {"good": 1, "easy": 1, "hard": -1, "again": -1}
