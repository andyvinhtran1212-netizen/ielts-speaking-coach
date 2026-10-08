"""Both admin inventories expose persisted revision state without changing it."""
import asyncio
from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4

import pytest

from routers import admin_quiz
from services import topic_service


@pytest.mark.parametrize('inventory', ['banks', 'topic_bundle'])
def test_admin_inventory_keeps_current_legacy_and_unmanaged_state(monkeypatch, inventory):
    topic_id = str(uuid4())
    topic = {'id': topic_id, 'skill_area': 'grammar', 'slug': 'tenses', 'title': 'Tenses'}
    base = {'topic_id': topic_id, 'skill_area': 'grammar', 'words_count': 13,
            'title': 'Present Simple', 'is_published': True, 'updated_at': None,
            'grammar_new_starts_enabled': True}
    banks = [
        {**base, 'id': str(uuid4()), 'code': 'G-tenses-present-simple',
         'grammar_canonical_code': 'G-tenses-present-simple', 'grammar_revision': 'a' * 64,
         'grammar_is_current': False},
        {**base, 'id': str(uuid4()), 'code': 'G-tenses-present-simple~' + 'b' * 16,
         'grammar_canonical_code': 'G-tenses-present-simple', 'grammar_revision': 'b' * 64,
         'grammar_is_current': True, 'grammar_new_starts_enabled': False},
        {**base, 'id': str(uuid4()), 'code': 'G-unmanaged', 'grammar_canonical_code': None,
         'grammar_revision': None, 'grammar_is_current': False},
    ]
    before = deepcopy(banks)
    reads = []

    class Query:
        def __init__(self, table):
            self.table_name = table
            self.columns = '*'

        def select(self, columns):
            self.columns = columns
            reads.append((self.table_name, columns))
            return self

        def eq(self, *_args): return self
        def order(self, *_args): return self
        def limit(self, *_args): return self

        def execute(self):
            rows = {'quiz_banks': banks, 'content_topics': [topic], 'vocab_cards': []}[self.table_name]
            return SimpleNamespace(data=deepcopy(rows) if self.columns == '*' else
                [{key: row.get(key) for key in self.columns.replace(' ', '').split(',')} for row in rows])

    database = SimpleNamespace(table=Query)
    if inventory == 'banks':
        async def authorized(_authorization): return {'id': str(uuid4())}
        monkeypatch.setattr(admin_quiz, 'require_admin', authorized)
        monkeypatch.setattr(admin_quiz, 'supabase_admin', database)
        result = asyncio.run(admin_quiz.list_banks(topic_id=topic_id, skill_area='grammar', authorization='test'))
    else:
        monkeypatch.setattr(topic_service, 'supabase_admin', database)
        result = topic_service.get_topic_bundle(topic_id)['quiz_banks']
    fields = ['grammar_canonical_code', 'grammar_revision', 'grammar_is_current', 'grammar_new_starts_enabled']
    assert [{key: row[key] for key in fields} for row in result] == [{key: row[key] for key in fields} for row in banks]
    assert [row['id'] for row in result] == [row['id'] for row in banks]
    assert banks == before
    assert all(key in next(columns for table, columns in reads if table == 'quiz_banks') for key in fields)
