"""Activation RPC boundary for router fakes; PostgreSQL tests verify the SQL.

Internal table operations remain observable to enrollment/promote fixtures.
Rollback restores the transaction snapshot without application undo statements.
"""
from copy import deepcopy
from datetime import datetime, timezone
from types import SimpleNamespace
import threading


def activation_rpc(db, name, params):
    assert name == 'fn_activation_serialize'
    if not hasattr(db, 'activation_lock'):
        db.activation_lock = threading.RLock()

    def execute():
        before = getattr(db, 'before_transaction', None)
        if before:
            before(params)
        with db.activation_lock:
            receipt = getattr(db, 'transaction_receipt', None)
            if receipt is not None:
                return SimpleNamespace(data=deepcopy(receipt))
            if getattr(db, 'transaction_unconfirmed', False):
                raise RuntimeError('unconfirmed activation transaction')
            storage = next((getattr(db, k) for k in ('tables', 'store', 'select_data')
                            if isinstance(getattr(db, k, None), dict)), None)
            snapshot = deepcopy(storage)
            try:
                result = run(db, params)
            except Exception as exc:
                message = getattr(exc, 'message', None) or str(exc)
                result = {'status': message if message in ('cohort_archived', 'student_archived', 'account_suspended')
                          else 'activation_conflict' if db.phase == 'claim' else 'activation_error'}
            if result['status'] != 'ok' and storage is not None:
                storage.clear()
                storage.update(snapshot)
            after = getattr(db, 'after_transaction', None)
            if after:
                after(params, result)
            return SimpleNamespace(data=result)
    return SimpleNamespace(execute=execute)


def run(db, p):
    def rows(table, **where):
        q = db.table(table).select('*')
        for k, v in where.items():
            q = q.eq(k, v)
        return q.limit(20).execute().data or []

    uid, code = p['p_user_id'], p['p_code']
    db.phase = 'activation'
    codes = rows('access_codes', id=p['p_code_id'])
    if not codes:
        return {'status': 'invalid_code'}
    c = codes[0]
    users = rows('users', id=uid)
    user = users[0] if users else {'id': uid, 'role': 'user'}
    if user.get('suspended_at'):
        return {'status': 'account_suspended'}
    if c.get('is_used'):
        return {'status': 'ok' if c.get('used_by') == uid else 'lost_claim', 'role': user.get('role')}
    linked = [s for s in rows('students', user_id=uid) if s.get('user_id') == uid]
    by_code = rows('students', student_code=code)
    target = next((s for s in linked if not s.get('archived_at')), None)
    if not target and by_code and by_code[0].get('user_id') in (None, uid):
        target = by_code[0]
    if (linked and not any(not s.get('archived_at') for s in linked)) or (target and target.get('archived_at')):
        return {'status': 'student_archived'}
    issuer = rows('users', id=c['issued_by']) if c.get('issued_by') else []
    owner = c['issued_by'] if issuer and issuer[0].get('role') == 'instructor' else None
    if target and target.get('instructor_id') and owner and target['instructor_id'] != owner:
        return {'status': 'enroll_reassign_rejected', 'current_owner': target['instructor_id'], 'attempted_owner': owner}
    cohort = (rows('cohorts', id=c['cohort_id']) or [{}])[0] if c.get('cohort_id') else {}
    if cohort.get('is_active') is False and cohort.get('archived_at'):
        return {'status': 'cohort_archived'}
    if not users:
        db.table('users').insert({'id': uid, 'email': p['p_email'], 'role': 'user', 'is_active': False}).execute()
    db.table('users').update({'is_active': True, 'access_code_used': code,
        'permissions': c.get('permissions') or ['practice_single', 'practice_part', 'practice_full']}).eq('id', uid).execute()
    db.phase = 'enrollment'
    student_id, enroll_owner = None, owner or cohort.get('created_by')
    if target:
        values = {}
        if not target.get('user_id'):
            values['user_id'] = uid
        if c.get('cohort_id'):
            values['cohort_id'] = c['cohort_id']
        if enroll_owner and not target.get('instructor_id'):
            values['instructor_id'] = enroll_owner
        if values:
            db.table('students').update(values).eq('id', target['id']).execute()
        student_id = target['id']
    elif not by_code and (owner or c.get('cohort_id')):
        metadata = p['p_metadata']
        inserted = db.table('students').insert({
            'user_id': uid, 'student_code': code,
            'full_name': metadata.get('full_name') or metadata.get('name') or (p['p_email'] or '').split('@')[0] or 'Học viên',
            'created_by': c.get('issued_by'), 'instructor_id': enroll_owner, 'cohort_id': c.get('cohort_id'),
        }).execute().data
        student_id = inserted[0].get('id') if inserted else None
    db.phase = 'claim'
    claim = db.table('access_codes').update({'is_used': True, 'used_by': uid,
        'used_at': datetime.now(timezone.utc).isoformat()}).eq('id', c['id']).eq('is_used', False).execute().data
    if not claim:
        fresh = (rows('access_codes', id=c['id']) or [{}])[0]
        if fresh.get('is_used') and fresh.get('used_by') != uid:
            return {'status': 'lost_claim'}
    return {'status': 'ok', 'role': user.get('role'), 'student_id': student_id, 'promote_role': c.get('grants_role')}
