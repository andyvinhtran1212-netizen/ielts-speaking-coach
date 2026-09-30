import asyncio
from copy import deepcopy

import pytest

from models.listening_dictation import DictationAggregateResponse
from routers import listening
from services.dictation_trends import classify_trends


def test_classification_sums_all_counters_before_top_n_without_mutating_scores():
    rows = [{"accuracy": .5, "error_trends": {
        "missed": {"—": 2684, ".": 7, "the": 533, "don't": 12, "well-known": 2, "42": 3,
                   "": 4, **{f"word{i}": 1 for i in range(30)}},
        "wrong": {"—": 412, "a": 156}}},
        {"accuracy": 1.0, "error_trends": {"missed": {"the": 2, "—": 1}, "wrong": {}}}]
    original = deepcopy(rows)
    result = classify_trends(rows)
    assert result["top_missed"][0] == {"word": "the", "count": 535}
    assert len(result["top_missed"]) == 15
    assert all(any(c.isalnum() for c in row["word"]) for row in result["top_missed"])
    assert result["punctuation_missed"] == [{"token": "—", "count": 2685}, {"token": ".", "count": 7}]
    assert result["punctuation_missed_total"] == 2692
    assert result["punctuation_wrong_total"] == 412
    assert result["missing_token_missed_total"] == 4
    assert rows == original


@pytest.mark.parametrize('counter', [{'—': True}, {'a': -1}, {'b': '4'}, {None: 3}])
def test_malformed_persisted_counters_cannot_be_reported_as_clean(counter):
    with pytest.raises(ValueError):
        classify_trends([{'error_trends': {'missed': counter, 'wrong': {}}}])


@pytest.mark.parametrize('trends', [None, {}, {'missed': {}}, {'missed': {}, 'wrong': None}])
def test_missing_maps_remain_unknown_instead_of_clean(trends):
    result = classify_trends([{'accuracy': .5, 'error_trends': trends}])
    assert result['trend_complete_session_count'] == 0
    assert result['trend_unavailable_session_count'] == 1


def test_explicit_empty_maps_are_distinct_from_missing_evidence():
    result = classify_trends([{'error_trends': {'missed': {}, 'wrong': {}}}])
    assert result['trend_complete_session_count'] == 1
    assert result['trend_unavailable_session_count'] == 0


def test_route_keeps_the_existing_mean_of_session_scores(monkeypatch):
    rows = [{'accuracy': .8, 'error_trends': {'missed': {'—': 2, 'the': 1}, 'wrong': {}}},
            {'accuracy': .6, 'error_trends': {'missed': {}, 'wrong': {'—': 1, 'a': 3}}}]
    async def admin(_auth):
        return {'id': 'admin'}
    monkeypatch.setattr(listening, 'require_admin', admin)
    monkeypatch.setattr(listening, '_all_dictation_aggregate_rows', lambda test, users: rows)
    result = asyncio.run(listening.admin_dictation_reports_aggregate(
        test_id=None, user_query=None, authorization='Bearer fake'))
    validated = DictationAggregateResponse.model_validate(result)
    assert validated.mean_accuracy == .7
    assert validated.session_count == 2
    assert validated.punctuation_missed_total == 2
    assert validated.top_wrong[0].expected == 'a'
