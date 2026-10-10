"""Bounded reviewed Grammar cutover using the existing configured SQL engine.

No pool, startup enrollment, learner-purpose backfill or history rewrite. Every
cohort read is bounded and stays inside the transaction/consistent snapshot.
"""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictStr, ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from models.grammar_quiz_revisions import (
    CanonicalCode, GrammarRevisionCommitRequest, GrammarRevisionCommitResult,
    GrammarRevisionFootprint, GrammarRevisionPreview, GrammarRevisionPreviewRequest,
    GrammarRevisionRead, Sha256,
)
from services.grammar_quiz_revision_classifier import CLASSIFY_OWNERS_SQL, FOLLOWUP_OWNERS_SQL
from services.grammar_quiz_policy import POLICY_KEY, GrammarQuizPolicyInvalid, validate_text_match_policy
from services.grammar_quiz_revision_source import (
    GrammarSource, GrammarSourceInvalid, REVIEWED_SOURCES, compare_reviewed_questions,
    parse_reviewed_source, reviewed_binding, FOLLOWUP_CODE, REVIEWED_BINDINGS,
)

ACTION = 'grammar_quiz_revision_cutover'
MAX_RECEIPT_BYTES = 1024 * 1024
LIMITS = {'quiz_sessions': 2048, 'quiz_word_stats': 8192, 'quiz_attempts': 32768}
ELIGIBLE = frozenset({'provably_unfinished_in_progress', 'provably_unfinished_paused',
    'provably_unfinished_completed_with_carryover', 'provably_unfinished_terminal_carryover'})


class GrammarRevisionError(ValueError):
    def __init__(self, status_code: int, code: str, message: str,
                 current_revision: str | None = None):
        self.status_code, self.code = status_code, code
        self.message, self.current_revision = message, current_revision
        super().__init__(message)


def _unavailable(code='grammar_revision_unavailable'):
    return GrammarRevisionError(503, code, 'Chưa xác minh được nguồn và lịch sử Grammar. Hãy tải lại hoặc yêu cầu kiểm tra.')


def _json(value: Any) -> str:
    """Exact finite Decimal JSON encoding; numbers never become float/strings."""
    if value is None or isinstance(value, (str, bool, int)):
        return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise _unavailable()
        return format(value, 'f')
    if isinstance(value, float):
        return json.dumps(value, ensure_ascii=False, allow_nan=False)
    if isinstance(value, (UUID, datetime)):
        return _json(str(value) if isinstance(value, UUID) else value.isoformat())
    if isinstance(value, list):
        return '[' + ','.join(_json(item) for item in value) + ']'
    if isinstance(value, dict) and all(isinstance(key, str) for key in value):
        return '{' + ','.join(_json(key) + ':' + _json(value[key]) for key in sorted(value)) + '}'
    raise _unavailable()


def _hash(value: Any) -> str:
    return hashlib.sha256(_json(value).encode('utf-8')).hexdigest()


def _payload_hash(code, source_sha256, expected_revision, preview_fingerprint, operation_id):
    # The exact source bytes are already SHA-bound. Keep this replay identity
    # reconstructable from the persisted receipt without storing raw source.
    return _hash({'code':code,'source_sha256':source_sha256,'expected_revision':expected_revision,
        'preview_fingerprint':preview_fingerprint,'operation_id':str(operation_id)})


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate key')
        result[key] = value
    return result


def _decoded(raw: str) -> dict:
    result = json.loads(raw, parse_float=Decimal, object_pairs_hook=_unique)
    if not isinstance(result, dict):
        raise ValueError('object required')
    return result


def _utc_timestamp(value: datetime | str) -> str:
    """Typed DB evidence only; arbitrary META strings keep their raw identity."""
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00')) if isinstance(value, str) else value
    if parsed.tzinfo is None:
        raise ValueError('timestamp offset required')
    result = parsed.astimezone(timezone.utc).isoformat()
    prefix = result[:-6]
    if '.' in prefix:
        prefix = prefix.rstrip('0').rstrip('.')
    return prefix + '+00:00'


def _physical_row(raw: str) -> dict:
    result = _decoded(raw)
    for key in ('created_at', 'updated_at', 'started_at', 'ended_at', 'grammar_retired_at',
                'grammar_mastery_completed_at', 'grammar_reset_at'):
        if key in result and result[key] is not None:
            result[key] = _utc_timestamp(result[key])
    return result


class _ProofModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class _OwnerProof(_ProofModel):
    user_id: UUID
    eligible: StrictBool
    classification: Literal['provably_unfinished_in_progress', 'provably_unfinished_paused',
        'provably_unfinished_completed_with_carryover', 'provably_unfinished_terminal_carryover',
        'genuinely_mastered', 'never_started', 'readonly_or_reset']
    predecessor_session_id: UUID
    session_ids: list[UUID] = Field(max_length=2048)
    stat_ids: list[UUID] = Field(max_length=8192)
    attempt_ids: list[UUID] = Field(max_length=32768)


class _Receipt(_ProofModel):
    schema_version: Literal[1]
    actor_id: UUID
    canonical_code: CanonicalCode
    operation_id: UUID
    payload_sha256: Sha256
    source_sha256: Sha256
    manifest_sha256: Sha256
    preview_fingerprint: Sha256
    expected_revision: Sha256
    committed_revision: Sha256
    topic_id: UUID
    original_bank_id: UUID
    corrected_bank_id: UUID
    original_revision: Sha256
    corrected_revision: Sha256
    original_questions_sha256: Sha256
    original_metadata_sha256: Sha256
    original_history_sha256: Sha256
    cohort: list[_OwnerProof] = Field(max_length=128)
    created_at: StrictStr
    integrity_sha256: Sha256


@dataclass
class _Scope:
    code: str
    original: dict
    current: dict
    questions: list[dict]
    current_questions: list[dict]
    topic: dict
    revision: str
    original_revision: str
    questions_hash: str
    metadata_hash: str
    root: dict | None = None
    banks: list[dict] = field(default_factory=list)
    question_sets: dict[str, list[dict]] = field(default_factory=dict)
    publication_available: bool = False


@dataclass
class _History:
    sessions: list[dict]
    stats: list[dict]
    attempts: list[dict]
    footprint: GrammarRevisionFootprint
    cohort: list[_OwnerProof]
    hash: str


async def _rows(c: AsyncConnection, sql: str, params=None) -> list[dict]:
    values = (await c.execute(text(sql), params or {})).scalars().all()
    return [_physical_row(value) for value in values]


async def _fence(c: AsyncConnection):
    """Storage guarantees are inspected, not inferred from migration files."""
    # Earlier draft306 receipt_data validated only a subset. A current Admin
    # owner must not trust that stale schema merely because its triggers exist.
    validator = (await c.execute(text("""SELECT p.prosecdef FROM pg_proc p
      WHERE p.oid=to_regprocedure('public.grammar_quiz_validate_receipt_envelope(jsonb,uuid,uuid)')"""))).scalar_one_or_none()
    binding = (await c.execute(text("SELECT to_regprocedure('public.grammar_quiz_audit_binding(text,text)') IS NOT NULL"))).scalar_one()
    if validator is not True or not binding:
        raise _unavailable('grammar_storage_guard_unavailable')
    fk = (await c.execute(text("""SELECT count(*) FROM pg_constraint
      WHERE conrelid='public.quiz_questions'::regclass AND confrelid='public.quiz_banks'::regclass
        AND contype='f' AND convalidated AND NOT condeferrable
        AND conkey=ARRAY[(SELECT attnum FROM pg_attribute
          WHERE attrelid='public.quiz_questions'::regclass AND attname='bank_id')]::smallint[]"""))).scalar_one()
    if fk != 1 or (await c.execute(text('SHOW session_replication_role'))).scalar_one() != 'origin':
        raise _unavailable('grammar_storage_guard_unavailable')
    for table in ('quiz_sessions','quiz_attempts','quiz_word_stats'):
        owner_fk = (await c.execute(text('''SELECT count(*) FROM pg_constraint
          WHERE conrelid=CAST(:table AS regclass) AND confrelid='auth.users'::regclass
            AND contype='f' AND convalidated AND NOT condeferrable AND confdeltype='c'
            AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=CAST(:table AS regclass)
              AND attname='user_id')]::smallint[]'''),{'table':'public.'+table})).scalar_one()
        if owner_fk!=1:
            raise _unavailable('grammar_storage_guard_unavailable')
    erasure_gate = (await c.execute(text("""SELECT tgenabled,tgtype FROM pg_trigger
      WHERE tgrelid='auth.users'::regclass AND tgname='grammar_quiz_account_erasure_gate' AND NOT tgisinternal"""))).one_or_none()
    if erasure_gate is None or erasure_gate[0] not in ('O',b'O') or erasure_gate[1]!=10:
        raise _unavailable('grammar_storage_guard_unavailable')
    expected = {'quiz_banks': ['grammar_quiz_statement_gate','zz_grammar_quiz_bank_guard'],
        'quiz_questions': ['grammar_quiz_statement_gate','grammar_quiz_question_guard'],
        'quiz_sessions': ['grammar_quiz_statement_gate','grammar_quiz_session_guard'],
        'quiz_attempts': ['grammar_quiz_statement_gate','grammar_quiz_attempt_guard'],
        'quiz_word_stats': ['grammar_quiz_statement_gate','zz_grammar_quiz_stats_guard'],
        'content_topics': ['grammar_quiz_statement_gate','grammar_quiz_topic_guard'],
        'governance_audit': ['grammar_quiz_statement_gate','grammar_quiz_receipt_guard']}
    for table, names in expected.items():
        for name in names:
            enabled = (await c.execute(text("""SELECT tgenabled FROM pg_trigger
              WHERE tgrelid=CAST(:table AS regclass) AND tgname=:name AND NOT tgisinternal"""),
                {'table': 'public.' + table, 'name': name})).scalar_one_or_none()
            if enabled not in ('O', b'O'):
                raise _unavailable('grammar_storage_guard_unavailable')


async def _scope(c: AsyncConnection, code: str, *, locking=False) -> _Scope:
    if code not in REVIEWED_SOURCES:
        raise GrammarRevisionError(404, 'grammar_revision_scope_not_found', 'Bài Grammar này không thuộc đợt sửa đã duyệt.')
    await _fence(c)
    banks = await _rows(c, """SELECT to_jsonb(b)::text FROM public.quiz_banks b
      WHERE skill_area='grammar' AND (code=:code OR grammar_canonical_code=:code)
      ORDER BY id LIMIT 4""", {'code': code})
    original = [bank for bank in banks if bank['code'] == code and bank['grammar_predecessor_bank_id'] is None]
    if len(original) != 1 or len(banks) > (3 if code == FOLLOWUP_CODE else 2):
        raise _unavailable('grammar_mapping_ambiguous')
    root = original[0]
    managed = root['grammar_canonical_code'] is not None
    active = [bank for bank in banks if bank['grammar_is_current']]
    chain = [root]
    if managed:
        if root['grammar_canonical_code'] != code or root['grammar_is_current'] or len(active) != 1:
            raise _unavailable('grammar_mapping_ambiguous')
        for _ in range(len(banks)-1):
            children = [b for b in banks if b['grammar_predecessor_bank_id'] == chain[-1]['id']]
            if len(children) != 1:
                raise _unavailable('grammar_mapping_ambiguous')
            child = children[0]
            valid_codes = {code+'~'+raw[:16] for raw in REVIEWED_BINDINGS[code]['bindings']}
            if (child['code'] not in valid_codes or child['topic_id'] != root['topic_id']
                    or child['grammar_canonical_code'] != code or child['version'] != chain[-1]['version']+1):
                raise _unavailable('grammar_mapping_ambiguous')
            chain.append(child)
        current = chain[-1]
        if current['id'] != active[0]['id'] or current['grammar_retired_at'] is not None or any(
                b['grammar_is_current'] or b['grammar_retired_at'] is None for b in chain[:-1]):
            raise _unavailable('grammar_mapping_ambiguous')
        if len(chain) == 3 and (chain[1]['code'] == code+'~'+REVIEWED_SOURCES[code][0][:16]
                or current['code'] != code+'~'+REVIEWED_SOURCES[code][0][:16]):
            raise _unavailable('grammar_mapping_ambiguous')
        followup = code == FOLLOWUP_CODE and len(chain) == 2 and current['code'] != code+'~'+REVIEWED_SOURCES[code][0][:16]
        old = current if followup else chain[-2]
        publication_available = followup
    else:
        if len(banks) != 1 or active:
            raise _unavailable('grammar_mapping_ambiguous')
        old = current = root
        publication_available = True
    if not old['is_published'] or not current['is_published'] or old['course_id'] is not None or old['lesson_no'] is not None:
        raise _unavailable('grammar_mapping_unavailable')
    topics = await _rows(c, 'SELECT to_jsonb(t)::text FROM public.content_topics t WHERE id=CAST(:id AS uuid)', {'id': old['topic_id']})
    if len(topics) != 1 or topics[0]['skill_area'] != 'grammar':
        raise _unavailable('grammar_topic_unavailable')
    if locking:
        await c.execute(text('SELECT id FROM public.content_topics WHERE id=CAST(:id AS uuid) FOR UPDATE'), {'id': old['topic_id']})
        for bank in sorted(banks, key=lambda value: value['id']):
            await c.execute(text('SELECT id FROM public.quiz_banks WHERE id=CAST(:id AS uuid) FOR UPDATE'), {'id': bank['id']})
            await c.execute(text('SELECT id FROM public.quiz_questions WHERE bank_id=CAST(:id AS uuid) ORDER BY id FOR UPDATE'), {'id': bank['id']})
    async def questions(bank):
        result = await _rows(c, 'SELECT to_jsonb(q)::text FROM public.quiz_questions q WHERE bank_id=CAST(:id AS uuid) ORDER BY "order",id LIMIT 201', {'id': bank['id']})
        if not result or len(result)>200 or any(not q['qid'].strip() or not q['item_key'].strip() for q in result):
            raise _unavailable('grammar_question_set_unavailable')
        return result
    question_sets = {bank['id']: await questions(bank) for bank in chain}
    original_questions = question_sets[old['id']]
    current_questions = question_sets[current['id']]
    if (not isinstance(root['meta'],dict) or root['meta'].get('correct_to_master')!=2
        or root['meta'].get('require_distinct_skill') is not True
        or root['meta'].get('require_production_to_master') is not True):
        raise _unavailable('grammar_mastery_state_unavailable')
    root_hash = _hash({'bank': {key:value for key,value in root.items() if not key.startswith('grammar_') and key!='updated_at'}, 'questions': question_sets[root['id']]})
    if managed and root['grammar_revision'] != root_hash:
        raise _unavailable('grammar_original_evidence_mismatch')
    original_hash = old['grammar_revision'] if old['grammar_predecessor_bank_id'] else root_hash
    revision = _hash({'original': old, 'current': current, 'questions': original_questions, 'current_questions': current_questions})
    return _Scope(code, old, current, original_questions, current_questions, topics[0], revision,
        original_hash, _hash(original_questions), _hash(old['meta']), root, chain, question_sets, publication_available)


def _edge_scope(scope: _Scope, original_id: str) -> _Scope:
    banks = scope.banks or [scope.original, scope.current]
    originals = [b for b in banks if b['id'] == original_id]
    children = [b for b in banks if b['grammar_predecessor_bank_id'] == original_id]
    if len(originals) != 1 or len(children) != 1:
        raise _unavailable('grammar_receipt_unavailable')
    old, current = originals[0], children[0]
    questions = scope.question_sets.get(old['id'], scope.questions)
    current_questions = scope.question_sets.get(current['id'], scope.current_questions)
    revision = _hash({'original': old, 'current': current, 'questions': questions, 'current_questions': current_questions})
    return _Scope(scope.code, old, current, questions, current_questions, scope.topic, revision,
        old['grammar_revision'], _hash(questions), _hash(old['meta']), scope.root, banks, scope.question_sets, False)



async def _history(c: AsyncConnection, scope: _Scope) -> _History:
    bid = {'bank': scope.original['id']}
    contents = {}
    for table, cap in LIMITS.items():
        count = (await c.execute(text(f'SELECT count(*) FROM (SELECT 1 FROM public.{table} WHERE bank_id=CAST(:bank AS uuid) LIMIT {cap+1}) bounded'), bid)).scalar_one()
        if count>cap:
            raise _unavailable('grammar_footprint_limit_exceeded')
        contents[table] = await _rows(c, f'SELECT to_jsonb(r)::text FROM public.{table} r WHERE bank_id=CAST(:bank AS uuid) ORDER BY id LIMIT {cap+1}', bid)
        if len(contents[table]) != count:
            raise _unavailable('grammar_footprint_unstable')
    sessions, stats, attempts = (contents[name] for name in LIMITS)
    owners = sorted({row['user_id'] for rows in contents.values() for row in rows})
    if len(owners)>128:
        raise _unavailable('grammar_footprint_limit_exceeded')
    now = (await c.execute(text('SELECT clock_timestamp()'))).scalar_one()
    classifications = (await c.execute(text(FOLLOWUP_OWNERS_SQL if scope.original['grammar_predecessor_bank_id'] else CLASSIFY_OWNERS_SQL), {'bank_id':scope.original['id'], 'cutover_at':now})).mappings().all()
    if {str(row['user_id']) for row in classifications} != set(owners):
        raise _unavailable('grammar_footprint_unavailable')
    reasons = {str(row['user_id']): row['classification'] for row in classifications}
    cohort = []
    if not any(reason.startswith('unknown_') for reason in reasons.values()):
        for owner in owners:
            owned = [row for row in sessions if row['user_id']==owner]
            if not owned:
                raise _unavailable('grammar_footprint_unavailable')
            candidates = [row for row in owned if row['grammar_admission_kind'] in ('run','continuation') and row['grammar_reset_at'] is None] if scope.original['grammar_predecessor_bank_id'] and reasons[owner] in ELIGIBLE else owned
            latest = max(candidates, key=lambda row:(row['started_at'],row['id']))
            cohort.append(_OwnerProof(user_id=owner,eligible=reasons[owner] in ELIGIBLE,
                classification=reasons[owner],predecessor_session_id=latest['id'],
                session_ids=[row['id'] for row in owned],stat_ids=[row['id'] for row in stats if row['user_id']==owner],
                attempt_ids=[row['id'] for row in attempts if row['user_id']==owner]))
    assignments = (await c.execute(text('SELECT count(*) FROM public.class_assignments WHERE content_id=CAST(:bank AS uuid)'), bid)).scalar_one()
    footprint = GrammarRevisionFootprint(actors=len(owners), sessions=len(sessions), stats=len(stats), attempts=len(attempts),
        assignments=assignments,open_sessions=sum(row['ended_at'] is None and row['ended_by'] is None for row in sessions),
        paused_sessions=sum(row['ended_at'] is not None and row['ended_by']=='paused' for row in sessions),
        classifications=dict(Counter(reasons.values())),authoritative_review_required=any(reason.startswith('unknown_') for reason in reasons.values()))
    return _History(sessions,stats,attempts,footprint,cohort,_hash(contents))


def _read(scope: _Scope, history: _History) -> GrammarRevisionRead:
    return GrammarRevisionRead(canonical_code=scope.code,original_bank_id=scope.original['id'],
        canonical_root_bank_id=(scope.root or scope.original)['id'], publication_available=scope.publication_available,
        bank_ids=[bank['id'] for bank in scope.banks] or [scope.original['id']],
        current_bank_id=scope.current['id'],topic_id=scope.original['topic_id'],revision=scope.revision,
        current_bank_revision=scope.current['grammar_revision'] or scope.original_revision,
        original_questions_sha256=scope.questions_hash,original_metadata_sha256=scope.metadata_hash,
        is_managed=scope.original['grammar_canonical_code'] is not None,
        new_starts_enabled=scope.current['grammar_new_starts_enabled'],footprint=history.footprint)


def _source(code: str, request: GrammarRevisionPreviewRequest) -> GrammarSource:
    if code not in REVIEWED_SOURCES:
        raise GrammarRevisionError(404,'grammar_revision_scope_not_found','Bài Grammar này không thuộc đợt sửa đã duyệt.')
    try:
        return parse_reviewed_source(code, request.source_markdown)
    except GrammarSourceInvalid:
        raise GrammarRevisionError(409,'grammar_reviewed_source_conflict','Nguồn không khớp bản sửa đã được duyệt.') from None


def _preview(scope: _Scope, history: _History, source: GrammarSource,
             request: GrammarRevisionPreviewRequest) -> GrammarRevisionPreview:
    if request.expected_revision != scope.revision:
        raise GrammarRevisionError(409,'grammar_revision_conflict','Nội dung Grammar đã thay đổi. Hãy tải lại trước khi sửa.',scope.revision)
    try:
        changes = compare_reviewed_questions(source, scope.questions, followup=scope.original['grammar_predecessor_bank_id'] is not None)
    except GrammarSourceInvalid:
        raise GrammarRevisionError(409,'grammar_canonical_source_conflict','Câu hỏi gốc không khớp phạm vi sửa đã duyệt.',scope.revision) from None
    # Every authored metadata identity stays bound; unrelated canonical extras
    # are preserved and included in the original/content fingerprints.
    # The real parser's meta_info is a bank payload with nested runtime/meta;
    # never compare/store that wrapper as quiz_banks.meta.
    runtime_metadata = source.metadata['meta']
    binding = reviewed_binding(scope.code, source.raw_sha256)
    exceptions = binding.get('metadata_changes', {})
    def metadata_matches(key):
        expected = source.metadata.get(key)
        actual = scope.original.get(key)
        if key == 'code' and scope.original['grammar_predecessor_bank_id']:
            return actual == scope.code+'~'+next(raw[:16] for raw in REVIEWED_BINDINGS[scope.code]['bindings'] if actual == scope.code+'~'+raw[:16])
        if key == 'version' and scope.original['grammar_predecessor_bank_id']:
            return actual == 2 and expected == 1
        return actual == expected or key in exceptions and actual == exceptions[key]['before'] and expected == exceptions[key]['after']
    if (any(scope.original['meta'].get(key) != value for key,value in runtime_metadata.items() if key != POLICY_KEY)
        or not all(metadata_matches(key) for key in ('code','title','skill_area','source','words_count','course_id','lesson_no','version'))):
        raise GrammarRevisionError(409,'grammar_metadata_conflict','Metadata gốc không khớp nguồn đã duyệt.',scope.revision)
    _corrected_metadata(scope, source)
    changed = {row['qid']: set(row['fields']) for row in changes}
    for original in scope.questions:
        if 'why_wrong' not in original or original['why_wrong'] is not None and not isinstance(original['why_wrong'], dict):
            raise _unavailable('grammar_question_extras_unavailable')
        if original['why_wrong'] and changed.get(original['qid'], set()) & {'answer', 'options', 'accept'}:
            raise GrammarRevisionError(409,'grammar_question_extras_conflict',
                'Giải thích phương án cũ cần được kiểm tra riêng trước khi đổi đáp án.',scope.revision)
    proposed = _hash({'manifest_sha256':source.manifest_sha256,'original_revision':scope.original_revision})
    fingerprint = _hash({'code':scope.code,'expected_revision':scope.revision,
        'source_sha256':source.raw_sha256,'manifest_sha256':source.manifest_sha256,
        'proposed_revision':proposed,'changes':changes})
    return GrammarRevisionPreview(canonical=_read(scope,history), source_sha256=source.raw_sha256,
        manifest_sha256=source.manifest_sha256,preview_fingerprint=fingerprint,proposed_revision=proposed,
        changed_questions=changes,validation_messages=['Giữ nguyên ID/câu hỏi gốc và lịch sử; chỉ tạo bản sửa đã duyệt.'])


def _corrected_metadata(scope: _Scope, source: GrammarSource) -> dict:
    """Only the approved map may differ; retain every canonical META extra."""
    original = scope.original['meta']
    try:
        old_policy = validate_text_match_policy(original, scope.questions,
            code=scope.code, skill_area='grammar')
        new_policy = validate_text_match_policy(source.metadata['meta'], source.questions,
            code=scope.code, skill_area='grammar')
    except GrammarQuizPolicyInvalid:
        raise _unavailable('grammar_policy_unavailable') from None
    if old_policy and (scope.original['grammar_predecessor_bank_id'] is None or old_policy != new_policy):
        # This owner creates one revision from an original absent/empty bank,
        # never a second opt-in or a malformed unmanaged publication.
        raise _unavailable('grammar_policy_unavailable')
    corrected = dict(original)
    if new_policy is not None:
        corrected[POLICY_KEY] = new_policy
    return corrected


async def _receipt(c: AsyncConnection, scope: _Scope, *, actor=None, operation=None) -> _Receipt | None:
    params = {'action':ACTION,'code': '"canonical_code"[[:space:]]*:[[:space:]]*"'+scope.code+'"'}
    where = 'action=:action AND detail ~ :code'
    if actor is not None:
        where += ' AND admin_id=CAST(:actor AS uuid) AND detail ~ :operation'
        params.update(actor=str(actor),operation='"operation_id"[[:space:]]*:[[:space:]]*"'+str(operation)+'"')
    else:
        where += ' AND detail ~ :original'
        params['original'] = '"original_bank_id"[[:space:]]*:[[:space:]]*"'+scope.original['id']+'"'
    rows = (await c.execute(text('SELECT admin_id,target_instructor,detail FROM public.governance_audit WHERE '+where+' ORDER BY id LIMIT 2'),params)).mappings().all()
    if not rows:
        return None
    if len(rows)!=1 or not isinstance(rows[0]['detail'],str) or len(rows[0]['detail'].encode('utf8'))>MAX_RECEIPT_BYTES:
        raise _unavailable('grammar_receipt_unavailable')
    try:
        data = _decoded(rows[0]['detail'])
        if type(data.get('schema_version')) is not int:
            raise ValueError('invalid receipt version type')
        receipt = _Receipt.model_validate(data)
        scope = _edge_scope(scope, str(receipt.original_bank_id))
        _utc_timestamp(receipt.created_at)
        checksum = (await c.execute(text("SELECT encode(sha256(convert_to((CAST(:data AS jsonb)-'integrity_sha256')::text,'UTF8')),'hex')"),{'data':_json(data)})).scalar_one()
        if receipt.integrity_sha256!=checksum or str(receipt.actor_id)!=str(rows[0]['admin_id']) or rows[0]['target_instructor'] is not None:
            raise ValueError('receipt identity/checksum mismatch')
        if str(receipt.original_bank_id)!=scope.original['id'] or str(receipt.topic_id)!=scope.original['topic_id'] or receipt.canonical_code!=scope.code:
            raise ValueError('receipt scope mismatch')
        if receipt.original_revision!=scope.original_revision or receipt.original_questions_sha256!=scope.questions_hash or receipt.original_metadata_sha256!=scope.metadata_hash:
            raise ValueError('original evidence mismatch')
        if str(receipt.corrected_bank_id)!=scope.current['id'] or receipt.corrected_revision!=scope.current['grammar_revision']:
            raise ValueError('corrected mapping mismatch')
        if (reviewed_binding(scope.code, receipt.source_sha256) is None
            or receipt.corrected_revision!=_hash({'manifest_sha256':receipt.manifest_sha256,'original_revision':receipt.original_revision})
            or receipt.payload_sha256!=_payload_hash(scope.code,receipt.source_sha256,receipt.expected_revision,
                receipt.preview_fingerprint,receipt.operation_id)):
            raise ValueError('source/payload binding mismatch')
        if len({owner.user_id for owner in receipt.cohort})!=len(receipt.cohort):
            raise ValueError('duplicate cohort owner')
        for owner in receipt.cohort:
            if owner.eligible != (owner.classification in ELIGIBLE) or owner.predecessor_session_id not in owner.session_ids:
                raise ValueError('invalid owner proof')
            for refs in (owner.session_ids,owner.stat_ids,owner.attempt_ids):
                if len(refs)!=len(set(refs)):
                    raise ValueError('duplicate proof reference')
        if any(sum(len(getattr(owner,key)) for owner in receipt.cohort)>cap
            for key,cap in [('session_ids',2048),('stat_ids',8192),('attempt_ids',32768)]):
            raise ValueError('oversized proof')
        for key in ('session_ids','stat_ids','attempt_ids'):
            references=[ref for owner in receipt.cohort for ref in getattr(owner,key)]
            if len(references)!=len(set(references)):
                raise ValueError('cross-owner proof reference')
        try:
            await c.execute(text('SELECT public.grammar_quiz_receipt_data(CAST(:bank AS uuid))'),
                {'bank':scope.original['id']})
        except Exception:
            raise ValueError('persisted cohort provenance unavailable') from None
        return receipt
    except (ValueError,TypeError,KeyError,ValidationError):
        raise _unavailable('grammar_receipt_unavailable') from None


async def _require_managed_proof(c: AsyncConnection,scope: _Scope):
    if scope.original['grammar_canonical_code'] is not None:
        for bank in scope.banks[:-1] or [scope.original]:
            edge = _edge_scope(scope, bank['id'])
            if await _receipt(c,edge) is None:
                raise _unavailable('grammar_receipt_unavailable')


async def _retained_history_hash(c: AsyncConnection, scope: _Scope) -> str:
    """Protect every predecessor, not only the cohort of the latest edge."""
    contents = {}
    totals = {table: 0 for table in LIMITS}
    owners = set()
    for bank in scope.banks:
        rows = {}
        for table, cap in LIMITS.items():
            values = await _rows(c, f'SELECT to_jsonb(r)::text FROM public.{table} r WHERE bank_id=CAST(:bank AS uuid) ORDER BY id LIMIT {cap+1}', {'bank': bank['id']})
            totals[table] += len(values)
            if totals[table] > cap:
                raise _unavailable('grammar_footprint_limit_exceeded')
            owners.update(row['user_id'] for row in values)
            if len(owners)>128:
                raise _unavailable('grammar_footprint_limit_exceeded')
            rows[table] = values
        contents[bank['id']] = rows
    return _hash(contents)


async def _transaction(engine, code, action, *, exclusive=False):
    if engine is None:
        raise _unavailable('grammar_storage_unavailable')
    try:
        async with engine.connect() as c:
            async with c.begin():
                if not exclusive:
                    await c.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'))
                await c.execute(text('SELECT pg_advisory_xact_lock'+('' if exclusive else '_shared')+'(306,1)'))
                await c.execute(text('SELECT pg_advisory_xact_lock(306,hashtext(:code))'),{'code':code})
                return await action(c)
    except GrammarRevisionError:
        raise
    except Exception:
        raise _unavailable('grammar_storage_unavailable') from None


async def read_revision(engine: AsyncEngine | None, canonical_code: str) -> GrammarRevisionRead:
    async def action(c):
        scope = await _scope(c,canonical_code)
        await _require_managed_proof(c,scope)
        return _read(scope,await _history(c,scope))
    return await _transaction(engine,canonical_code,action)


async def preview_revision(engine: AsyncEngine | None, canonical_code: str,
                           request: GrammarRevisionPreviewRequest) -> GrammarRevisionPreview:
    source = _source(canonical_code,request)
    async def action(c):
        scope = await _scope(c,canonical_code)
        await _require_managed_proof(c,scope)
        return _preview(scope,await _history(c,scope),source,request)
    return await _transaction(engine,canonical_code,action)


async def commit_revision(engine: AsyncEngine | None, canonical_code: str, actor_id: UUID | str,
                          request: GrammarRevisionCommitRequest) -> GrammarRevisionCommitResult:
    source = _source(canonical_code,request)
    actor = UUID(str(actor_id))
    payload_hash = _payload_hash(canonical_code,source.raw_sha256,request.expected_revision,
        request.preview_fingerprint,request.operation_id)
    async def action(c):
        scope = await _scope(c,canonical_code,locking=True)
        stored = await _receipt(c,scope,actor=actor,operation=request.operation_id)
        if stored:
            if stored.payload_sha256 != payload_hash:
                raise GrammarRevisionError(409,'grammar_operation_conflict','Mã thao tác đã được dùng với nội dung khác.',scope.revision)
            await _require_managed_proof(c,scope)
            return _result(stored,scope,await _history(c,scope),'already_applied')
        if not scope.publication_available:
            await _require_managed_proof(c,scope)
            raise GrammarRevisionError(409,'grammar_already_revised','Bài này đã có bản sửa. Hãy tải lại trạng thái.',scope.revision)
        await _require_managed_proof(c,scope)
        if source.raw_sha256 != REVIEWED_SOURCES[canonical_code][0]:
            raise GrammarRevisionError(409,'grammar_reviewed_source_conflict','Chỉ được xuất bản nguồn hiện hành đã duyệt.',scope.revision)
        retained_hash = await _retained_history_hash(c,scope)
        history = await _history(c,scope)
        preview = _preview(scope,history,source,request)
        if preview.preview_fingerprint!=request.preview_fingerprint:
            raise GrammarRevisionError(409,'grammar_preview_conflict','Bản xem trước không còn khớp. Hãy kiểm tra lại.',scope.revision)
        if history.footprint.authoritative_review_required:
            raise _unavailable('grammar_authoritative_review_required')
        new_id = uuid4()
        now_at = (await c.execute(text('SELECT clock_timestamp()'))).scalar_one()
        now = _utc_timestamp(now_at)
        proof = _Receipt(schema_version=1,actor_id=actor,canonical_code=canonical_code,operation_id=request.operation_id,
            payload_sha256=payload_hash,source_sha256=source.raw_sha256,manifest_sha256=source.manifest_sha256,
            preview_fingerprint=preview.preview_fingerprint,expected_revision=scope.revision,
            committed_revision='0'*64,topic_id=scope.original['topic_id'],original_bank_id=scope.original['id'],
            corrected_bank_id=new_id,original_revision=scope.original_revision,corrected_revision=preview.proposed_revision,
            original_questions_sha256=scope.questions_hash,original_metadata_sha256=scope.metadata_hash,
            original_history_sha256=history.hash,cohort=history.cohort,created_at=now,integrity_sha256='0'*64)
        # The final digest/current fingerprint are fixed-width; test actual
        # encoded proof size BEFORE the first content/publication write.
        if len(_json(proof.model_dump(mode='json')).encode('utf8'))>MAX_RECEIPT_BYTES:
            raise _unavailable('grammar_receipt_limit_exceeded')
        context = {'action':'cutover','actor':actor,'code':canonical_code,'old_bank':scope.original['id'],
            'bank':new_id,'old_revision':scope.original_revision,'new_revision':preview.proposed_revision,'source_sha256':source.raw_sha256}
        await c.execute(text("SELECT set_config('aver.grammar_quiz_context',:context,true)"),{'context':_json(context)})
        await c.execute(text('''UPDATE public.quiz_banks SET grammar_canonical_code=:code,grammar_revision=:revision,
          grammar_is_current=FALSE,grammar_retired_at=CAST(:now AS timestamptz) WHERE id=CAST(:old AS uuid)'''),
            {'code':canonical_code,'revision':scope.original_revision,'now':now_at,'old':scope.original['id']})
        new_bank = {**scope.original,'id':str(new_id),'code':canonical_code+'~'+source.raw_sha256[:16],
            'version':scope.original['version']+1,'created_at':now,'updated_at':now,'grammar_canonical_code':canonical_code,
            'grammar_revision':preview.proposed_revision,'grammar_is_current':True,'grammar_predecessor_bank_id':scope.original['id'],
            'grammar_retired_at':None,'grammar_new_starts_enabled':True,
            'meta':_corrected_metadata(scope,source), 'words_count':source.metadata['words_count']}
        # PostgreSQL canonicalizes typed timestamps (including fractional zero
        # digits). Encode the intended typed row BEFORE insert/triggers, then
        # compare full persisted rows; never waive fields to mask a lost map.
        expected_bank = _physical_row((await c.execute(text('SELECT to_jsonb(jsonb_populate_record(NULL::public.quiz_banks,CAST(:row AS jsonb)))::text'),
            {'row':_json(new_bank)})).scalar_one())
        await c.execute(text('INSERT INTO public.quiz_banks SELECT (jsonb_populate_record(NULL::public.quiz_banks,CAST(:row AS jsonb))).*'),{'row':_json(new_bank)})
        expected_questions = []
        for original,reviewed in zip(scope.questions,source.questions):
            cloned = {**original,**reviewed,'id':str(uuid4()),'bank_id':str(new_id),'created_at':now}
            expected_questions.append(_physical_row((await c.execute(text('SELECT to_jsonb(jsonb_populate_record(NULL::public.quiz_questions,CAST(:row AS jsonb)))::text'),
                {'row':_json(cloned)})).scalar_one()))
            await c.execute(text('INSERT INTO public.quiz_questions SELECT (jsonb_populate_record(NULL::public.quiz_questions,CAST(:row AS jsonb))).*'),{'row':_json(cloned)})
        updated = await _scope(c,canonical_code)
        if _hash(updated.current)!=_hash(expected_bank) or _hash(updated.current_questions)!=_hash(expected_questions):
            raise _unavailable('grammar_corrected_readback_mismatch')
        proof.committed_revision = updated.revision
        data = proof.model_dump(mode='json')
        proof.integrity_sha256 = (await c.execute(text("SELECT encode(sha256(convert_to((CAST(:data AS jsonb)-'integrity_sha256')::text,'UTF8')),'hex')"),{'data':_json(data)})).scalar_one()
        await c.execute(text('''INSERT INTO public.governance_audit(action,admin_id,detail)
          VALUES(:action,CAST(:actor AS uuid),:detail)'''),{'action':ACTION,'actor':str(actor),'detail':_json(proof.model_dump(mode='json'))})
        saved = await _receipt(c,updated,actor=actor,operation=request.operation_id)
        if saved is None:
            raise _unavailable('grammar_receipt_unavailable')
        verified = await _history(c,updated)
        retained = _Scope(**{**updated.__dict__, 'banks':scope.banks})
        if verified.hash!=history.hash or updated.questions_hash!=scope.questions_hash or await _retained_history_hash(c,retained)!=retained_hash:
            raise _unavailable('grammar_original_evidence_mismatch')
        return _result(saved,updated,verified,'applied')
    return await _transaction(engine,canonical_code,action,exclusive=True)


def _result(receipt: _Receipt,scope: _Scope,history: _History,outcome: str):
    return GrammarRevisionCommitResult(canonical_code=scope.code,operation_id=receipt.operation_id,outcome=outcome,
        original_bank_id=receipt.original_bank_id,corrected_bank_id=receipt.corrected_bank_id,
        source_sha256=receipt.source_sha256,committed_revision=receipt.committed_revision,current_revision=scope.revision,
        current_matches_committed=receipt.committed_revision==scope.revision,
        original_questions_sha256=receipt.original_questions_sha256,original_history_sha256=receipt.original_history_sha256,
        canonical=_read(scope,history))
