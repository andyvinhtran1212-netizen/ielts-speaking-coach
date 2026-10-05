"""Reading pages must neither overlap nor omit imports sharing created_at.

The hosted staging reproduction loaded24 then44 unique cards from two24-row
windows. This fake permits different physical ordering within an SQL tie for
each window; only the route's complete ordering may make those pages stable.
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient


class _WindowQuery:
    def __init__(self, rows):
        self.rows = rows
        self.filters = []
        self.orders = []
        self.start, self.end = 0, 0
        self.columns = []

    def select(self, columns, **_):
        self.columns = columns.split(',')
        return self

    def eq(self, field, value):
        self.filters.append(lambda row: row.get(field) == value)
        return self

    def contains(self, field, values):
        self.filters.append(lambda row: all(v in row.get(field, []) for v in values))
        return self

    def order(self, field, desc=False):
        self.orders.append((field, desc))
        return self

    def range(self, start, end):
        self.start, self.end = start, end
        return self

    def execute(self):
        rows = [r for r in self.rows if all(f(r) for f in self.filters)]
        # SQL does not promise physical ordering within equal sort keys.
        if self.start:
            rows = list(reversed(rows))
        for field, desc in reversed(self.orders):
            rows.sort(key=lambda row: row[field], reverse=desc)
        return SimpleNamespace(count=len(rows), data=[
            {key: row[key] for key in self.columns if key in row}
            for row in rows[self.start:self.end + 1]
        ])


@pytest.mark.parametrize('path,library,test_type,filters', [
    ('/api/reading/vocab', 'l1_vocab', 'full', {'difficulty': 'foundation', 'tag': 'food'}),
    ('/api/reading/skill', 'l2_skill', 'full', {'difficulty': 'foundation', 'skill': 'scanning'}),
    ('/api/reading/test', 'l3_test', 'full', {'module': 'academic', 'test_type': 'full'}),
    ('/api/reading/test', 'l3_test', 'mini', {'module': 'academic', 'test_type': 'mini'}),
])
def test_equal_timestamp_pages_cover_the_library_once(monkeypatch, path, library, test_type, filters):
    from main import app
    from routers import reading_student

    rows = [{
        'id': f'00000000-0000-0000-0000-{n:012x}', 'slug': f'qa-{n}',
        'test_id': f'QA-{n}', 'title': f'Synthetic{n}',
        'body_markdown': 'Synthetic passage', 'library': library,
        'difficulty_level': 'foundation', 'topic_tags': ['food'],
        'skill_focus': 'scanning', 'status': 'published', 'is_public': True,
        'test_type': test_type, 'module': 'academic',
        'created_at': '2026-10-05T00:00:00+00:00',
        'answer': 'PRIVATE_SENTINEL',
    } for n in range(1, 74)]
    expected = {row['id'] for row in rows}
    rows += [{**rows[0], 'id': 'draft', 'status': 'draft'},
             {**rows[0], 'id': 'filtered', 'difficulty_level': 'advanced',
              'module': 'general_training'},
             {**rows[0], 'id': 'other-library', 'library': 'other', 'is_public': False}]
    monkeypatch.setattr(reading_student, '_require_auth', AsyncMock(return_value={'id': 'qa-user'}))
    monkeypatch.setattr(reading_student, 'supabase_admin',
                        SimpleNamespace(table=lambda _: _WindowQuery(rows)))
    client = TestClient(app)
    pages = []
    for offset in (0, 24, 48, 72):
        response = client.get(path, params={**filters, 'offset': offset, 'limit': 24})
        assert response.status_code == 200
        page = response.json()
        assert page['total'] == 73
        assert 'PRIVATE_SENTINEL' not in response.text
        pages.append([item['id'] for item in page['items']])
    ids = [item for page in pages for item in page]
    assert len(ids) == len(set(ids)) == 73
    assert set(ids) == expected
    repeated = client.get(path, params={**filters, 'offset': 24, 'limit': 24}).json()
    assert [item['id'] for item in repeated['items']] == pages[1]
