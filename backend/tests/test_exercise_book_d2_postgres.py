"""D1+D2 tests against a PRE-PROVISIONED disposable local 377/378 fixture.

This module never installs migrations or creates/seeds a schema. An authorized
fixture owner must supply TEST_PG_URL and EXERCISE_BOOK_TEST_MANIFEST (JSON with
schema, owner, nonowner, teacher, cohort, assignment, item, user, test UUIDs).
The assignment must be published, due in the future, with two ready synthetic
activities and an untouched recipient. Use a disposable fixture: grant/attempt
RPCs intentionally persist changes. No staging/production connections accepted.
"""
import asyncio
import json
import os
import re
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse
from uuid import UUID, uuid4

import asyncpg
import pytest

from test_exercise_book_api import book
from test_listening_blackeye import env
from models import listening_blackeye as dto
from routers import admin_class_assignments as ar, listening as lr
from services import exercise_book_api as svc, listening_blackeye as be


def ident(value):
    assert re.fullmatch(r"[a-z_][a-z0-9_]*", value), "invalid fixture identifier"
    return '"' + value + '"'


class LocalPG:
    def __init__(self, url, schema):
        self.url, self.schema = url, ident(schema)

    def fetch(self, sql, args=()):
        async def run():
            conn = await asyncpg.connect(self.url, timeout=3)
            try:
                await conn.set_type_codec('jsonb', encoder=json.dumps, decoder=json.loads, schema='pg_catalog')
                await conn.execute("SET ROLE service_role; SET request.jwt.claim.role='service_role'")
                return json.loads(await conn.fetchval(sql, *args))
            finally:
                await conn.close()
        try:
            return asyncio.run(run())
        except asyncpg.PostgresError as exc:
            # Exercise the production SQLSTATE mapper without exposing SQL/data.
            raise SimpleDBError(exc.sqlstate, exc.message) from None

    def rpc(self, name, params):
        assert name in svc.RPC_NAMES
        args = ','.join(ident(k) + ' => $' + str(n) for n, k in enumerate(params, 1))
        sql = f'SELECT coalesce(jsonb_agg(to_jsonb(r)),\'[]\'::jsonb)::text FROM {self.schema}.{ident(name)}({args}) r'
        values = [datetime.fromisoformat(v) if k in {'p_step_up_at', 'p_due_at'} and isinstance(v, str) else v
                  for k, v in params.items()]
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=self.fetch(sql, values)))

    def table(self, name):
        return LocalQuery(self, name)


class SimpleDBError(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message
        super().__init__('Local fixture database refusal')


class LocalQuery:
    def __init__(self, db, name):
        self.db, self.name, self.filters = db, ident(name), []
        self.columns, self.sort, self.offset, self.maximum = '*', '', 0, 1000

    def select(self, columns):
        self.columns = '*' if columns == '*' else ','.join(ident(k.strip()) for k in columns.split(','))
        return self

    def eq(self, column, value):
        self.filters.append((ident(column), value))
        return self

    def limit(self, maximum):
        self.maximum = int(maximum)
        return self

    def range(self, start, end):
        self.offset, self.maximum = int(start), int(end) - int(start) + 1
        return self

    def order(self, column, desc=False):
        self.sort = ' ORDER BY ' + ident(column) + (' DESC' if desc else ' ASC')
        return self

    def execute(self):
        # Cast filter columns to text: D2 supplies verified UUID strings.
        where = ' AND '.join(c + '::text=$' + str(n) for n, (c, _) in enumerate(self.filters, 1)) or 'true'
        sql = (f'SELECT coalesce(jsonb_agg(to_jsonb(r)),\'[]\'::jsonb)::text FROM '
               f'(SELECT {self.columns} FROM {self.db.schema}.{self.name} WHERE {where}'
               f'{self.sort} LIMIT {self.maximum} OFFSET {self.offset}) r')
        return SimpleNamespace(data=self.db.fetch(sql, [str(v) for _, v in self.filters]))


@pytest.fixture
def pg_book(book, monkeypatch):
    url, manifest = os.environ.get('TEST_PG_URL'), os.environ.get('EXERCISE_BOOK_TEST_MANIFEST')
    if not url or not manifest:
        if os.environ.get('REQUIRE_PG') == '1':
            pytest.fail('Pre-provisioned local 377/378 fixture and manifest required')
        pytest.skip('NOT RUN: authorized pre-provisioned local 377/378 fixture unavailable')
    parsed = urlparse(url)
    assert parsed.scheme in {'postgres', 'postgresql'} and parsed.hostname in {'127.0.0.1', 'localhost', '::1'}
    assert not parsed.query, 'connection overrides forbidden'
    data = json.loads(Path(manifest).read_text())
    for key in ('owner', 'nonowner', 'teacher', 'cohort', 'assignment', 'item', 'user', 'test'):
        data[key] = str(UUID(data[key]))
    assert data['schema'].startswith('exercise_book_test_'), 'disposable fixture schema required'
    db = LocalPG(url, data['schema'])
    monkeypatch.setattr(ar, 'supabase_admin', db)
    monkeypatch.setattr(lr, 'supabase_admin', db)
    book.db, book.pg = db, data
    book.actor['id'] = data['owner']
    book.claims['sub'] = data['owner']
    return book


@pytest.mark.parametrize('method,suffix', [('get', ''), ('get', '/log'), ('post', '')])
@pytest.mark.parametrize('owner,fresh,expected', [(False, False, 'not_owner'), (True, False, 'step_up_required'), (True, True, 'validation')])
def test_real_pg_grant_route_refusals(pg_book, method, suffix, owner, fresh, expected):
    b, d = pg_book, pg_book.pg
    b.actor['id'] = d['owner' if owner else 'nonowner']
    b.claims['sub'] = b.actor['id']
    if not fresh:
        b.claims['amr'][0]['timestamp'] -= 601
    body = dict(grantee_id=d['teacher'], role='assigner', action='grant', reason='Synthetic fixture', request_id=str(uuid4()))
    # Only POST has a grantee to reject. Fresh GETs exercise the real read RPCs.
    response = getattr(b.client, method)(f"/admin/cohorts/{d['cohort']}/exercise-book-grants{suffix}",
        **({'json': body} if method == 'post' else {}))
    if owner and fresh and method == 'get':
        assert response.status_code == 200, response.text
    else:
        assert response.status_code == (422 if expected == 'validation' else 403), response.text
        assert response.json()['code'] == expected
    assert response.headers['cache-control'] == 'private, no-store'


def test_real_pg_assignment_activity_join_and_submit(pg_book):
    b, d = pg_book, pg_book.pg
    receipt = svc.receipt(b.db, d['owner'], d['cohort'], d['assignment'])
    assert receipt.completion_denominator == 2
    context, parent, child = svc.assigned_context(b.db, d['user'], d['item'], d['test'])
    assert context.assignment_id == d['assignment'] and svc.book_parent(parent)
    before = b.db.table('class_assignment_items').select('*').eq('id', d['item']).execute().data
    public_binding = {k: v for k, v in child['binding'].items() if k != 'answer_set_revision'}
    acquired = svc.object_result(svc.rpc(b.db, 'fn_acquire_exercise_book_assigned_attempt', dict(
        p_user_id=d['user'], p_item_id=d['item'], p_test_id=d['test'], p_binding=public_binding,
        p_renderer_affinity_protocol='legacy')))
    attempt = b.db.table('listening_test_attempts').select('*').eq('id', acquired['id']).execute().data[0]
    snapshots = b.db.table('mock_paper_attempt_snapshots').select('*').eq('attempt_id', attempt['id']).execute().data
    state = be.submit(b.db, attempt, d['user'], dto.BlackEyeSubmitRequest(expected_answers=[], confirm_blank=True))
    assert state.status == 'submitted'
    review = be.teacher_review(b.db, d['owner'], d['cohort'], d['assignment'], d['item'], child['binding']['activity_id'])
    assert review.attempt.binding.activity_id == child['binding']['activity_id']
    assert b.db.table('class_assignment_items').select('*').eq('id', d['item']).execute().data == before
    assert b.db.table('mock_paper_attempt_snapshots').select('*').eq('attempt_id', attempt['id']).execute().data == snapshots
