"""One-field, transactional L1 correction using the existing configured engine.

No engine/schema/receipt store is created here. A passage lock serializes the
scope before receipt lookup/CAS; current question rows are locked separately.
Immediate validated FK enforcement fences new question INSERTs during a write.
Existing importers may still change content after this transaction settles.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, ValidationError, field_validator
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from models.reading_grammar_focus import (
    ReadingGrammarFocusEditRequest, ReadingGrammarFocusEditResult,
    ReadingGrammarFocusErrorDetail, ReadingGrammarFocusItem,
    ReadingGrammarFocusRead, Sha256,
)


ACTION = 'reading_grammar_focus_edit'


class ReadingGrammarFocusError(Exception):
    def __init__(self, status_code: int, error_code: str, message: str,
                 current_revision: str | None = None):
        self.status_code = status_code
        self.error_code = error_code
        self.message = message
        self.current_revision = current_revision
        super().__init__(message)

    def as_detail(self) -> dict[str, Any]:
        return ReadingGrammarFocusErrorDetail(
            error_code=self.error_code, message=self.message,
            current_revision=self.current_revision,
        ).model_dump(exclude_none=True)


def _invalid_state() -> ReadingGrammarFocusError:
    return ReadingGrammarFocusError(503, 'reading_grammar_focus_invalid_state',
                                   'Dữ liệu Reading hiện tại không đủ hợp lệ để sửa an toàn.')


def _unavailable() -> ReadingGrammarFocusError:
    return ReadingGrammarFocusError(503, 'reading_grammar_focus_unavailable',
                                   'Chưa có kết nối transaction Reading khả dụng. Chưa lưu thay đổi.')


def _receipt_invalid() -> ReadingGrammarFocusError:
    return ReadingGrammarFocusError(503, 'reading_grammar_focus_receipt_invalid',
                                   'Không xác minh được biên nhận Reading. Chưa áp dụng lại thay đổi.')


def _canonical_value(value: Any) -> Any:
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError('naive timestamp')
        return value.astimezone(timezone.utc).isoformat(timespec='microseconds')
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError('non-finite JSON number')
        return value
    if isinstance(value, dict):
        if any(not isinstance(key, str) for key in value):
            raise ValueError('non-string JSON key')
        return {key: _canonical_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_canonical_value(item) for item in value]
    return value


def _json(value: Any) -> str:
    def encode(item: Any) -> str:
        # JSONB numbers are arbitrary-precision decimals. Retain their numeric
        # type as well as every digit; converting them to float OR quoted text
        # can alias distinct canonical values and invalidate whole-state CAS.
        if isinstance(item, Decimal):
            return format(item, 'f')
        if isinstance(item, dict):
            return '{' + ','.join(encode(key) + ':' + encode(item[key])
                                  for key in sorted(item)) + '}'
        if isinstance(item, list):
            return '[' + ','.join(encode(element) for element in item) + ']'
        return json.dumps(item, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    return encode(_canonical_value(value))


def _exact_row(row: Any) -> dict[str, Any]:
    values = dict(row)
    try:
        # The ordinary asyncpg JSONB decoder has already converted fractions
        # to floats. Parse PostgreSQL's full row text separately, then retain
        # native UUID/timestamp scalars needed by parameterized SQL writes.
        raw = json.loads(values.pop('_canonical_row_json'), parse_float=Decimal)
        if not isinstance(raw, dict) or raw.keys() != values.keys():
            raise ValueError('incomplete canonical row')
        return {key: raw[key] if isinstance(raw[key], (dict, list, Decimal)) else value
                for key, value in values.items()}
    except (KeyError, TypeError, ValueError):
        raise _invalid_state() from None


def _hash(value: Any) -> str:
    return hashlib.sha256(_json(value).encode('utf-8')).hexdigest()


def _focus(value: Any) -> list[dict[str, str]]:
    if value is None:
        return []  # Existing student-read legacy empty state; never mutation.
    if not isinstance(value, list):
        raise _invalid_state()
    try:
        return [ReadingGrammarFocusItem.model_validate(item).model_dump()
                for item in value]
    except (ValidationError, TypeError, ValueError):
        raise _invalid_state() from None


@dataclass(frozen=True)
class _State:
    row: dict[str, Any]
    focus: list[dict[str, str]]
    source_sha256: str
    unrelated_metadata_sha256: str
    questions_sha256: str
    revision: str

    def public(self) -> ReadingGrammarFocusRead:
        return ReadingGrammarFocusRead(
            passage_id=self.row['id'], slug=self.row['slug'], library='l1_vocab',
            title=self.row['title'], status=self.row['status'],
            body_markdown=self.row['body_markdown'], grammar_focus=self.focus,
            updated_at=self.row['updated_at'], revision=self.revision,
            source_sha256=self.source_sha256,
            unrelated_metadata_sha256=self.unrelated_metadata_sha256,
            questions_sha256=self.questions_sha256,
        )


def _state(row: dict[str, Any], questions: list[dict[str, Any]]) -> _State:
    metadata = row.get('metadata')
    if not isinstance(metadata, dict):
        raise _invalid_state()
    try:
        focus = _focus(metadata.get('grammar_focus'))
        # Include ALL other passage values and ALL persisted question columns.
        # Hashes are returned; raw unrelated metadata/answer keys never are.
        source = {key: value for key, value in row.items()
                  if key not in ('metadata', 'updated_at')}
        source_hash = _hash(source)
        unrelated_hash = _hash({key: value for key, value in metadata.items()
                                if key != 'grammar_focus'})
        question_hash = _hash(questions)
        revision = _hash({'passage_id': row['id'], 'slug': row['slug'],
                          'library': row['library'], 'source_sha256': source_hash,
                          'metadata': metadata, 'updated_at': row['updated_at'],
                          'questions_sha256': question_hash})
        state = _State(row, focus, source_hash, unrelated_hash, question_hash, revision)
        state.public()  # Validate source/timestamp/identity before any write.
        if row['library'] != 'l1_vocab' or not row['slug']:
            raise ValueError('invalid source identity')
        return state
    except ReadingGrammarFocusError:
        raise
    except (ValidationError, KeyError, TypeError, ValueError):
        raise _invalid_state() from None


async def _limits(connection: AsyncConnection) -> None:
    await connection.execute(text("SELECT set_config('lock_timeout', '5s', true), "
                                  "set_config('statement_timeout', '15s', true)"))


async def _load_state(connection: AsyncConnection, slug: str, *, write: bool) -> _State:
    # Parent locks always precede child locks. Stable ID ordering avoids
    # self-inflicted row-lock order differences across concurrent editors.
    parent_lock = 'FOR UPDATE' if write else 'FOR SHARE'
    result = await connection.execute(text(
        "SELECT p.*, to_jsonb(p)::text AS _canonical_row_json FROM reading_passages p "
        "WHERE slug = :slug AND library = 'l1_vocab' "
        + parent_lock), {'slug': slug})
    row = result.mappings().one_or_none()
    if row is None:
        raise ReadingGrammarFocusError(404, 'reading_grammar_focus_not_found',
                                      'Không tìm thấy đoạn Reading L1 này.')
    questions = await connection.execute(text(
        'SELECT q.*, to_jsonb(q)::text AS _canonical_row_json FROM reading_questions q '
        'WHERE passage_id = :passage_id '
        'ORDER BY id FOR SHARE'), {'passage_id': row['id']})
    return _state(_exact_row(row), [_exact_row(item) for item in questions.mappings().all()])


async def _require_insert_fence(connection: AsyncConnection) -> None:
    # A deferrable FK can be deferred by another transaction and therefore is
    # not an INSERT fence. Verify the deployed constraint, not its assumed name.
    result = await connection.execute(text("""
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            WHERE c.contype = 'f' AND c.convalidated AND NOT c.condeferrable
              AND c.conrelid = to_regclass('reading_questions')
              AND c.confrelid = to_regclass('reading_passages')
              AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                  WHERE attrelid = c.conrelid AND attname = 'passage_id')]::smallint[]
              AND c.confkey = ARRAY[(SELECT attnum FROM pg_attribute
                  WHERE attrelid = c.confrelid AND attname = 'id')]::smallint[]
        ) AND current_setting('session_replication_role') = 'origin'
    """))
    if result.scalar_one() is not True:
        raise ReadingGrammarFocusError(503, 'reading_grammar_focus_lock_unavailable',
                                      'Chưa xác minh được khóa bảo toàn câu hỏi Reading. Chưa lưu.')


class _Receipt(BaseModel):
    model_config = ConfigDict(extra='forbid')
    schema_version: Literal[1]
    passage_id: UUID
    actor_id: UUID
    operation_id: UUID
    request_fingerprint: Sha256
    expected_revision: Sha256
    outcome: Literal['updated', 'unchanged']
    before_revision: Sha256
    after_revision: Sha256
    before_focus_sha256: Sha256
    after_focus_sha256: Sha256
    original_focus: list[ReadingGrammarFocusItem]
    new_focus: list[ReadingGrammarFocusItem]
    source_sha256: Sha256
    unrelated_metadata_sha256: Sha256
    questions_sha256: Sha256
    committed_updated_at: AwareDatetime
    integrity_sha256: Sha256

    @field_validator('schema_version', mode='before')
    @classmethod
    def actual_integer_version(cls, value):
        if type(value) is not int or value != 1:
            raise ValueError('invalid receipt version')
        return value


def _unique_receipt_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError('ambiguous receipt object')
        value[key] = item
    return value


async def _receipt(connection: AsyncConnection, state: _State, actor: UUID,
                   operation: UUID) -> _Receipt | None:
    # governance_audit.detail is TEXT and existing other actions store ordinary
    # non-JSON paths. Parameterized text predicates are safe on ALL rows; never
    # cast arbitrary audit detail to jsonb. UUIDs cannot inject regexp syntax.
    result = await connection.execute(text("""
        SELECT admin_id, target_instructor, detail FROM governance_audit
        WHERE action = :action AND admin_id = :actor
          AND detail ~ :passage_pattern AND detail ~ :operation_pattern
        ORDER BY id LIMIT 2
    """), {'action': ACTION, 'actor': actor,
           'passage_pattern': '"passage_id"[[:space:]]*:[[:space:]]*"' + str(state.row['id']) + '"',
           'operation_pattern': '"operation_id"[[:space:]]*:[[:space:]]*"' + str(operation) + '"'})
    rows = result.mappings().all()
    if not rows:
        return None
    if len(rows) != 1:
        raise _receipt_invalid()
    row = rows[0]
    try:
        # Reject duplicate keys at every depth before a decoder can discard
        # conflicting evidence. Key order and JSON whitespace are immaterial.
        receipt = _Receipt.model_validate(json.loads(
            row['detail'], object_pairs_hook=_unique_receipt_object))
        original = [item.model_dump() for item in receipt.original_focus]
        new = [item.model_dump() for item in receipt.new_focus]
        saved_payload_hash = _hash({'passage_id': receipt.passage_id,
                                   'actor_id': receipt.actor_id,
                                   'operation_id': receipt.operation_id,
                                   'expected_revision': receipt.expected_revision,
                                   'grammar_focus': new})
        if (row['admin_id'] != actor or row['target_instructor'] is not None
                or receipt.actor_id != actor or receipt.passage_id != state.row['id']
                or receipt.operation_id != operation
                or receipt.request_fingerprint != saved_payload_hash
                or receipt.expected_revision != receipt.before_revision
                or receipt.before_focus_sha256 != _hash(original)
                or receipt.after_focus_sha256 != _hash(new)
                or receipt.integrity_sha256 != _hash(receipt.model_dump(
                    mode='json', exclude={'integrity_sha256'}))
                or (receipt.outcome == 'unchanged' and
                    (receipt.before_revision != receipt.after_revision or original != new))
                or (receipt.outcome == 'updated' and
                    (receipt.before_revision == receipt.after_revision or original == new))):
            raise ValueError('inconsistent receipt')
        return receipt
    except (ValidationError, TypeError, ValueError):
        raise _receipt_invalid() from None


def _request_fingerprint(state: _State, actor: UUID,
                         request: ReadingGrammarFocusEditRequest) -> str:
    return _hash({'passage_id': state.row['id'], 'actor_id': actor,
                  **request.model_dump(mode='json')})


def _result(state: _State, receipt: _Receipt, outcome: str) -> ReadingGrammarFocusEditResult:
    return ReadingGrammarFocusEditResult(
        passage_id=state.row['id'], slug=state.row['slug'], library='l1_vocab',
        outcome=outcome, operation_id=receipt.operation_id,
        committed_revision=receipt.after_revision, current_revision=state.revision,
        current_matches_committed=state.revision == receipt.after_revision,
        updated_at=state.row['updated_at'], grammar_focus=state.focus,
        source_sha256=receipt.source_sha256,
        unrelated_metadata_sha256=receipt.unrelated_metadata_sha256,
        questions_sha256=receipt.questions_sha256,
        current_source_sha256=state.source_sha256,
        current_unrelated_metadata_sha256=state.unrelated_metadata_sha256,
        current_questions_sha256=state.questions_sha256,
    )


def _engine(engine: AsyncEngine | None) -> AsyncEngine:
    if engine is None or engine.dialect.name != 'postgresql':
        raise _unavailable()
    return engine


async def read_focus(engine: AsyncEngine | None, slug: str) -> ReadingGrammarFocusRead:
    engine = _engine(engine)
    try:
        async with engine.begin() as connection:
            await _limits(connection)
            return (await _load_state(connection, slug, write=False)).public()
    except (SQLAlchemyError, OSError):
        raise _unavailable() from None


async def edit_focus(engine: AsyncEngine | None, slug: str, actor_id: UUID | str,
                     request: ReadingGrammarFocusEditRequest) -> ReadingGrammarFocusEditResult:
    engine = _engine(engine)
    if not isinstance(request, ReadingGrammarFocusEditRequest):
        raise ReadingGrammarFocusError(422, 'reading_grammar_focus_request_invalid',
                                      'Yêu cầu sửa grammar focus chưa được xác thực.')
    try:
        actor = UUID(str(actor_id))
    except (TypeError, ValueError, AttributeError):
        raise _invalid_state() from None
    try:
        async with engine.begin() as connection:
            await _limits(connection)
            before = await _load_state(connection, slug, write=True)
            await _require_insert_fence(connection)
            fingerprint = _request_fingerprint(before, actor, request)
            saved = await _receipt(connection, before, actor, request.operation_id)
            if saved is not None:
                if saved.request_fingerprint != fingerprint:
                    raise ReadingGrammarFocusError(409, 'reading_grammar_focus_operation_conflict',
                                                  'Mã thao tác đã dùng cho nội dung hoặc revision khác.',
                                                  before.revision)
                return _result(before, saved, 'already_applied')
            if request.expected_revision != before.revision:
                raise ReadingGrammarFocusError(409, 'reading_grammar_focus_revision_conflict',
                                              'Reading đã thay đổi. Đọc và đối chiếu revision mới trước khi lưu.',
                                              before.revision)
            replacement = [item.model_dump() for item in request.grammar_focus]
            outcome = 'unchanged' if replacement == before.focus else 'updated'
            after = before
            if outcome == 'updated':
                updated = await connection.execute(text("""
                    UPDATE reading_passages SET metadata = jsonb_set(
                        metadata, '{grammar_focus}', CAST(:new_focus AS jsonb), true),
                        updated_at = clock_timestamp()
                    WHERE id = :passage_id AND slug = :slug AND library = 'l1_vocab'
                      AND metadata = CAST(:old_metadata AS jsonb)
                      AND updated_at = :old_updated_at AND title = :title
                      AND body_markdown = :body AND status = :status
                    RETURNING reading_passages.*,
                        to_jsonb(reading_passages)::text AS _canonical_row_json
                """), {'new_focus': _json(replacement),
                       'old_metadata': _json(before.row['metadata']),
                       'passage_id': before.row['id'], 'slug': before.row['slug'],
                       'old_updated_at': before.row['updated_at'], 'title': before.row['title'],
                       'body': before.row['body_markdown'], 'status': before.row['status']})
                row = updated.mappings().one_or_none()
                if row is None:
                    raise ReadingGrammarFocusError(409, 'reading_grammar_focus_revision_conflict',
                                                  'Reading đã thay đổi. Chưa lưu correction.', before.revision)
                questions = await connection.execute(text(
                    'SELECT q.*, to_jsonb(q)::text AS _canonical_row_json FROM reading_questions q '
                    'WHERE passage_id = :passage_id '
                    'ORDER BY id FOR SHARE'), {'passage_id': before.row['id']})
                after = _state(_exact_row(row), [_exact_row(item) for item in questions.mappings().all()])
                if (after.focus != replacement or after.source_sha256 != before.source_sha256
                        or after.unrelated_metadata_sha256 != before.unrelated_metadata_sha256
                        or after.questions_sha256 != before.questions_sha256
                        or after.row['updated_at'] == before.row['updated_at']):
                    raise _invalid_state()
            receipt = _Receipt(
                schema_version=1, passage_id=before.row['id'], actor_id=actor,
                operation_id=request.operation_id, request_fingerprint=fingerprint,
                expected_revision=request.expected_revision, outcome=outcome,
                before_revision=before.revision, after_revision=after.revision,
                before_focus_sha256=_hash(before.focus), after_focus_sha256=_hash(after.focus),
                original_focus=before.focus, new_focus=after.focus,
                source_sha256=after.source_sha256,
                unrelated_metadata_sha256=after.unrelated_metadata_sha256,
                questions_sha256=after.questions_sha256,
                committed_updated_at=after.row['updated_at'],
                integrity_sha256='0' * 64,
            )
            receipt = receipt.model_copy(update={'integrity_sha256': _hash(
                receipt.model_dump(mode='json', exclude={'integrity_sha256'}))})
            await connection.execute(text("""
                INSERT INTO governance_audit (action, admin_id, target_instructor, detail)
                VALUES (:action, :actor, NULL, :detail)
            """), {'action': ACTION, 'actor': actor, 'detail': _json(receipt.model_dump(mode='json'))})
            response = _result(after, receipt, outcome)
        # Exiting begin() confirms the update AND receipt committed before ACK.
        return response
    except (SQLAlchemyError, OSError):
        raise _unavailable() from None
