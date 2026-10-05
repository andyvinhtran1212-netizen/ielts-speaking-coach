"""Lost acknowledgements and out-of-order takes preserve the canonical grade."""
from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from services.speaking_submission import (
    SubmissionReplay, check_submission, save_response, submission_revision,
)
from routers.grading import _persist_response_with_fallback

A = '11111111-1111-4111-8111-111111111111'
B = '22222222-2222-4222-8222-222222222222'
def path(token, digest='a'):
    return f'user/session/question.{token}.{digest * 64}.wav'
def row(token, score=7):
    return dict(id='response', session_id='session', question_id='question',
                audio_storage_path=path(token), overall_band=score)

class DB:
    def __init__(self, current=None):
        self.current = current
        self.before_write = None
        self.writes = 0
    def table(self, table):
        assert table == 'responses'
        return Query(self)
class Query:
    def __init__(self, db):
        self.db, self.filters, self.action = db, [], 'select'
    def select(self, columns): return self
    def limit(self, n): return self
    def eq(self, field, value): self.filters.append((field, value)); return self
    def is_(self, field, value): assert value == 'null'; return self.eq(field, None)
    def update(self, data): self.action, self.data = 'update', data; return self
    def insert(self, data): self.action, self.data = 'insert', data; return self
    def execute(self):
        db = self.db
        if self.action != 'select' and db.before_write:
            hook, db.before_write = db.before_write, None
            hook()
        if self.action == 'insert':
            if db.current: raise RuntimeError('23505 unique session/question')
            db.current = {'id': 'response', **self.data}; db.writes += 1
            return SimpleNamespace(data=[db.current.copy()])
        matches = db.current and all(db.current.get(k) == v for k, v in self.filters)
        if matches and self.action == 'update':
            db.current.update(self.data); db.writes += 1
        return SimpleNamespace(data=[db.current.copy()] if matches else [])

@pytest.mark.parametrize('existing', [False, True])
def test_same_audio_replay_never_overwrites_canonical_grade(existing):
    baseline = row(B) if existing else None
    db = DB(baseline.copy() if baseline else None)
    revision = submission_revision(baseline)
    incoming = row(A, 6)
    assert save_response(db, incoming, baseline=baseline, token=A,
                         storage_path=path(A), expected_revision=revision) == 'response'
    with pytest.raises(SubmissionReplay) as replay:
        save_response(db, row(A, 3), baseline=baseline, token=A,
                      storage_path=path(A), expected_revision=revision)
    assert replay.value.response_id == 'response'
    assert db.current['overall_band'] == 6
    assert db.writes == 1

@pytest.mark.parametrize('existing', [False, True])
def test_late_old_take_cannot_replace_new_take_even_between_read_and_write(existing):
    baseline = {'id': 'response', 'session_id': 'session', 'question_id': 'question',
                'audio_storage_path': 'legacy.wav'} if existing else None
    db = DB(baseline.copy() if baseline else None)
    db.before_write = lambda: setattr(db, 'current', row(B, 8))
    with pytest.raises(HTTPException) as error:
        save_response(db, row(A, 4), baseline=baseline, token=A,
                      storage_path=path(A), expected_revision=submission_revision(baseline))
    assert error.value.status_code == 409
    assert db.current == row(B, 8)
    assert db.writes == 0

def test_same_key_cannot_change_audio():
    with pytest.raises(HTTPException) as error:
        check_submission(row(A), A, path(A, 'b'), 'absent')
    assert error.value.detail['code'] == 'submission_audio_changed'

@pytest.mark.parametrize('exception', [SubmissionReplay('response'), HTTPException(409, 'superseded')])
def test_replay_and_conflict_never_enter_metadata_fallback(exception):
    calls = []
    def save(data): calls.append(data); raise exception
    with pytest.raises(type(exception)):
        _persist_response_with_fallback(row(A), {'audio_storage_path'}, save,
                                       session_id='session', question_id='question')
    assert len(calls) == 1

@pytest.mark.asyncio
@pytest.mark.parametrize('sealed', [False, True])
async def test_endpoint_replays_receipt_without_regrading_or_leaking_sealed_feedback(monkeypatch, sealed):
    import hashlib
    import io
    from fastapi import UploadFile
    from starlette.datastructures import Headers
    from routers import grading
    async def auth(value): return {'id': 'user'}
    count = 0
    async def execute(query):
        nonlocal count
        count += 1
        data = {'id': 'session', 'part': 2, 'mode': 'practice',
                'sitting_id': 'sealed-sitting' if sealed else None} if count == 1 else {'id': 'question', 'question_text': 'cake'}
        return SimpleNamespace(data=[data])
    audio = b'recorded audio'
    saved = {'id': 'response', 'audio_storage_path': f'user/session/question.{A}.{hashlib.sha256(audio).hexdigest()}.wav'}
    monkeypatch.setattr(grading, 'get_supabase_user', auth)
    monkeypatch.setattr(grading, 'aexecute', execute)
    monkeypatch.setattr(grading, 'require_resume_active', lambda session: None)
    monkeypatch.setattr(grading, 'bind_owned_attempt', lambda session: None)
    monkeypatch.setattr(grading, 'load_response', lambda *args: saved)
    monkeypatch.setattr(grading, 'enforce_grading_rate_limit', lambda *args: pytest.fail('replay must not regrade'))
    result = await grading.grade_response_endpoint(
        'session', question_id='question',
        audio_file=UploadFile(io.BytesIO(audio), filename='audio.wav', headers=Headers({'content-type': 'audio/wav'})),
        authorization='test', submission_id=A, expected_revision='absent',
    )
    assert result['response_id'] == 'response' and result['_replayed'] is True
    assert set(result) == {'response_id', '_replayed', 'backend_release_sha'}
