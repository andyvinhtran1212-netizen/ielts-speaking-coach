"""Read-only classification of persisted Dictation counters; never regrade scores."""
from __future__ import annotations

from collections import Counter


def classify_trends(rows: list[dict]) -> dict:
    counters = {kind: {bucket: Counter() for bucket in ('lexical', 'punctuation', 'missing')}
                for kind in ('missed', 'wrong')}
    complete_sessions = unavailable_sessions = 0
    for row in rows:
        trends = row.get('error_trends')
        if trends is None:
            unavailable_sessions += 1
            continue
        if not isinstance(trends, dict):
            raise ValueError('Invalid persisted trend object')
        if any(trends.get(kind) is None for kind in counters):
            unavailable_sessions += 1
            continue
        complete_sessions += 1
        for kind, buckets in counters.items():
            source = trends.get(kind)
            if not isinstance(source, dict):
                raise ValueError('Invalid persisted trend counter')
            for token, count in source.items():
                if not isinstance(token, str) or not isinstance(count, int) or isinstance(count, bool) or count < 0:
                    raise ValueError('Invalid persisted trend entry')
                if not count:
                    continue
                # Alphanumeric text includes contractions, hyphenated words,
                # numbers and non-Latin scripts; a standalone dash is punctuation.
                bucket = ('missing' if not token.strip() else
                          'lexical' if any(char.isalnum() for char in token) else 'punctuation')
                buckets[bucket][token] += count

    def top(counter, label):
        return [{label: token, 'count': count}
                for token, count in sorted(counter.items(), key=lambda item: (-item[1], item[0]))[:15]]

    return {
        'trend_classification': 'lexical-v1',
        'trend_complete_session_count': complete_sessions,
        'trend_unavailable_session_count': unavailable_sessions,
        'top_missed': top(counters['missed']['lexical'], 'word'),
        'top_wrong': top(counters['wrong']['lexical'], 'expected'),
        'punctuation_missed': top(counters['missed']['punctuation'], 'token'),
        'punctuation_wrong': top(counters['wrong']['punctuation'], 'token'),
        'punctuation_missed_total': sum(counters['missed']['punctuation'].values()),
        'punctuation_wrong_total': sum(counters['wrong']['punctuation'].values()),
        'missing_token_missed_total': sum(counters['missed']['missing'].values()),
        'missing_token_wrong_total': sum(counters['wrong']['missing'].values()),
    }
