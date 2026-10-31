"""A-06: normalize at write boundaries; stored timestamps compare as instants."""
from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.cohort_assignment_service import (
    _deadline_is_open, fan_out_assignment, normalize_deadline, parse_deadline,
)

OWNER = '00000000-0000-0000-0000-000000000001'
PROMPT = '00000000-0000-0000-0000-000000000002'
STUDENT = '00000000-0000-0000-0000-000000000003'
COHORT = '00000000-0000-0000-0000-000000000004'
ASSIGNMENT = '00000000-0000-0000-0000-000000000005'
EQUIVALENTS = ['2026-10-27T23:00', '2026-10-27T23:00:00+07:00', '2026-10-27T16:00:00Z']
EXPECTED = datetime(2026, 10, 27, 16, tzinfo=timezone.utc)


@pytest.mark.parametrize('value', EQUIVALENTS + [datetime(2026, 10, 27, 23)])
def test_normalize_deadline_same_instant(value):
    actual = normalize_deadline(value)
    assert actual.tzinfo is not None
    assert actual == EXPECTED


@pytest.mark.parametrize('value', ['2026-10-27', date(2026, 10, 27)])
def test_date_only_uses_class_default_1900_vietnam(value):
    from services.class_assignment_service import compose_due_at
    assert normalize_deadline(value).isoformat() == compose_due_at('2026-10-27')
    assert normalize_deadline(value) == datetime(2026, 10, 27, 12, tzinfo=timezone.utc)


@pytest.mark.parametrize('value', ['', 'nonsense', '2026-02-30T23:00', '2026-10-27T25:00', 123, [], {}])
def test_normalize_deadline_invalid(value):
    with pytest.raises(ValueError):
        normalize_deadline(value)


def test_clear_and_read_semantics_are_preserved():
    assert normalize_deadline(None) is None
    assert parse_deadline('2026-10-27T23:00') == datetime(2026, 10, 27, 23, tzinfo=timezone.utc)
    aware = datetime.fromisoformat('2026-10-27T11:00:00-05:00')
    assert normalize_deadline(aware) is aware


@pytest.fixture
def api():
    from routers import instructor, admin_writing_assignments as admin
    app = FastAPI()
    app.include_router(instructor.router)
    app.include_router(admin.router)
    db = MagicMock()
    # Ownership reads and duplicate lookups use a fluent chain; writes capture
    # the actual payload at insert/update/RPC, without network or real DB writes.
    query = db.table.return_value
    for name in ('select', 'eq', 'in_', 'limit'):
        getattr(query, name).return_value = query
    query.execute.return_value = MagicMock(data=[{'id': PROMPT, 'created_by': OWNER}])
    query.insert.return_value.execute.return_value = MagicMock(data=[{'id': ASSIGNMENT}])
    query.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[{'id': ASSIGNMENT}])
    db.rpc.return_value.execute.return_value = MagicMock(data={
        'created': [{'id': ASSIGNMENT}], 'created_count': 1,
        'group_id': COHORT, 'duplicates_warning': [],
        # INSTRUCTORGIVE-0044 receipt keys (individual row + fan-out counts).
        'assignment': {'id': ASSIGNMENT}, 'student_count': 1, 'assignment_ids': [ASSIGNMENT],
    })
    with patch.object(instructor, '_me', AsyncMock(return_value=OWNER)), \
         patch.object(instructor, 'instructor_db', return_value=db), \
         patch.object(instructor, 'supabase_admin', db), \
         patch.object(admin, 'require_admin', AsyncMock(return_value={'id': OWNER})), \
         patch.object(admin, 'supabase_admin', db), \
         patch.object(admin, '_read_assignment_request_receipt', return_value=None), \
         patch('services.instructor_give_service.replay_give', return_value=None), \
         patch.object(admin, 'active_student_ids_for_cohort', return_value=[STUDENT]), \
         patch('services.cohort_assignment_service.active_students_for_cohort',
               return_value=[{'id': STUDENT, 'instructor_id': OWNER}]):
        yield TestClient(app), db


@pytest.mark.parametrize('deadline', EQUIVALENTS + ['2026-10-27'])
@pytest.mark.parametrize('path', ['instructor-create', 'instructor-fanout', 'instructor-patch',
                                 'admin-patch', 'admin-create-rpc', 'admin-fanout-rpc'])
def test_api_deadline_write(api, path, deadline):
    client, db = api
    prefix = '/instructor/assignments' if path.startswith('instructor') else '/admin/writing/assignments'
    body = {'deadline': deadline}
    if 'patch' in path:
        response = client.patch(f'{prefix}/{ASSIGNMENT}', json=body)
        written = db.table.return_value.update.call_args.args[0]['deadline']
    else:
        body['prompt_ids' if 'fanout' in path or path.startswith('admin') else 'prompt_id'] = [PROMPT] if 'fanout' in path or path.startswith('admin') else PROMPT
        body['cohort_id' if 'fanout' in path else 'student_ids' if path.startswith('admin') else 'student_id'] = COHORT if 'fanout' in path else [STUDENT] if path.startswith('admin') else STUDENT
        # Every give writes through an idempotent RPC (admin PC-J37, instructor 0044).
        body['request_id'] = ASSIGNMENT
        response = client.post(prefix + ('/fan-out' if 'fanout' in path else ''), json=body)
        assert response.status_code == 201, response.text
        written = db.rpc.call_args.args[1]['p_deadline']
        assert parse_deadline(db.rpc.call_args.args[1]['p_request_payload']['deadline']) == parse_deadline(written)
        db.table.return_value.insert.assert_not_called()
    assert response.status_code in (200, 201), response.text
    assert datetime.fromisoformat(written).utcoffset() is not None
    assert parse_deadline(written) == (datetime(2026, 10, 27, 12, tzinfo=timezone.utc) if deadline == '2026-10-27' else EXPECTED)


@pytest.mark.parametrize('prefix', ['/instructor/assignments', '/admin/writing/assignments'])
@pytest.mark.parametrize('operation', ['create', 'fanout', 'patch'])
@pytest.mark.parametrize('bad', ['bad', '', '2026-02-30T23:00', 123, {}])
def test_api_invalid_deadline_is_422_before_write(api, prefix, operation, bad):
    client, db = api
    body = {'deadline': bad, 'prompt_id': PROMPT, 'student_id': STUDENT,
            'student_ids': [STUDENT], 'cohort_id': COHORT, 'request_id': ASSIGNMENT}
    if operation == 'fanout':
        body['prompt_ids'] = [PROMPT]
    response = (client.patch(f'{prefix}/{ASSIGNMENT}', json=body) if operation == 'patch'
                else client.post(prefix + ('/fan-out' if operation == 'fanout' else ''), json=body))
    assert response.status_code == 422, response.text
    db.table.return_value.insert.assert_not_called()
    db.table.return_value.update.assert_not_called()
    db.rpc.assert_not_called()


@pytest.mark.parametrize('prefix', ['/instructor/assignments', '/admin/writing/assignments'])
def test_patch_clear_and_omitted_deadline(api, prefix):
    client, db = api
    assert client.patch(f'{prefix}/{ASSIGNMENT}', json={'deadline': None}).status_code == 200
    assert db.table.return_value.update.call_args.args[0]['deadline'] is None
    assert client.patch(f'{prefix}/{ASSIGNMENT}', json={'instructions': 'Keep the date'}).status_code == 200
    assert 'deadline' not in db.table.return_value.update.call_args.args[0]


def test_direct_fanout_normalizes_naive_datetime(api):
    _, db = api
    fan_out_assignment(db, prompt_ids=[PROMPT], cohort_id=COHORT, assigned_by=OWNER,
                       deadline=datetime(2026, 10, 27, 23))
    payload = db.table.return_value.insert.call_args.args[0]
    assert parse_deadline(payload[0]['deadline']) == EXPECTED


@pytest.mark.parametrize('value', EQUIVALENTS)
@pytest.mark.parametrize('clock,open_now', [('22:59', True), ('23:01', False)])
def test_vietnam_deadline_boundaries(value, clock, open_now):
    from routers.class_student import _due_sort_key
    from routers.admin_writing_cohorts import _is_overdue
    due = normalize_deadline(value).isoformat()
    now = datetime.fromisoformat(f'2026-10-27T{clock}:00+07:00')
    assert _deadline_is_open(due, now) is open_now
    assert _is_overdue(due, now) is (not open_now)
    key = lambda stamp: _due_sort_key({'item_id': 'a', 'assignment': {'due_at': stamp}})
    assert key(due)[1] == EXPECTED
    assert (key(now.isoformat()) < key(due)) is open_now
    assert key(due) < key(None)
