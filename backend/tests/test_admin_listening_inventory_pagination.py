"""Exercise the inventory endpoint across timestamp ties and exact-count failures."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from routers import listening


class Query:
    def __init__(self, store, table):
        self.store, self.table = store, table
        self.orders, self.filters = [], []
        self.bounds = None

    def select(self, *args, **kwargs):
        return self

    def order(self, column, desc=False):
        self.orders.append((column, desc))
        return self

    def range(self, start, end):
        self.bounds = (start, end)
        return self

    def eq(self, column, value):
        self.filters.append(lambda row: row.get(column) == value)
        return self

    def in_(self, column, values):
        self.filters.append(lambda row: row.get(column) in values)
        return self

    def ilike(self, column, value):
        self.filters.append(lambda row: value.strip('%').lower() in str(row.get(column)).lower())
        return self

    def execute(self):
        rows = [dict(row) for row in self.store.tables[self.table]
                if all(predicate(row) for predicate in self.filters)]
        # SQL does not promise an order for equal keys. Vary the input order on
        # each page so a single timestamp ordering reproduces the missing/dupe.
        if rows:
            shift = self.store.reads % len(rows)
            rows = rows[shift:] + rows[:shift]
        self.store.reads += 53
        for column, descending in reversed(self.orders):
            rows.sort(key=lambda row: row[column], reverse=descending)
        total = len(rows) if self.store.count_available else None
        if self.bounds:
            rows = rows[self.bounds[0]:self.bounds[1] + 1]
        return SimpleNamespace(data=rows, count=total)


class Store:
    def __init__(self, count_available=True):
        self.reads, self.count_available = 0, count_available
        # All 237 timestamps tie, covering two 100-item boundaries. The UUID
        # tie-breaker must retain newest timestamps in a mixed dataset too.
        self.tables = {'listening_tests': [
            {'id': f'{i:08x}-0000-0000-0000-000000000000',
             'test_id': f'BANK-{i:03d}', 'created_at': '2026-09-25T07:20:18Z',
             'status': 'published', 'test_type': 'practice'}
            for i in range(237)
        ] + [{'id': '00000000-0000-0000-0000-000000000001',
              'test_id': 'NEWEST', 'created_at': '2026-09-30T00:00:00Z',
              'status': 'draft', 'test_type': 'mini'}],
            'listening_content': []}

    def table(self, name):
        return Query(self, name)


async def admin(_authorization):
    return {'id': 'admin'}


def page(offset, **kwargs):
    return asyncio.run(listening.admin_list_listening_tests(
        status=kwargs.get('status', 'all'), search=kwargs.get('search', ''),
        test_type=kwargs.get('test_type', 'all'), limit=100, offset=offset,
        authorization='Bearer fake'))


def test_full_inventory_is_unique_complete_and_repeatable_across_tied_pages(monkeypatch):
    store = Store()
    monkeypatch.setattr(listening, 'supabase_admin', store)
    monkeypatch.setattr(listening, 'require_admin', admin)
    expected = sorted(store.tables['listening_tests'],
                      key=lambda row: (row['created_at'], row['id']), reverse=True)
    for _ in range(3):
        pages = [page(offset) for offset in (0, 100, 200)]
        actual = [row['id'] for response in pages for row in response['items']]
        assert actual == [row['id'] for row in expected]
        assert len(set(actual)) == 238
        assert {response['total'] for response in pages} == {238}
        assert [len(response['items']) for response in pages] == [100, 100, 38]
        assert page(300)['items'] == []


def test_inventory_filters_preserve_the_exact_scope(monkeypatch):
    monkeypatch.setattr(listening, 'supabase_admin', Store())
    monkeypatch.setattr(listening, 'require_admin', admin)
    result = page(0, status='published', test_type='practice', search='BANK-1')
    assert result['total'] == 100
    assert len(result['items']) == 100
    assert result['items'][0]['test_id'] == 'BANK-199'
    assert page(0, test_type='exam')['total'] == 1


@pytest.mark.parametrize('count_available', [False])
def test_missing_exact_count_is_unavailable_instead_of_empty(monkeypatch, count_available):
    monkeypatch.setattr(listening, 'supabase_admin', Store(count_available))
    monkeypatch.setattr(listening, 'require_admin', admin)
    with pytest.raises(HTTPException) as failure:
        page(0)
    assert failure.value.status_code == 503
