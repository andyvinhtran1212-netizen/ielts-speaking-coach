"""Sync service-role facade for the bounded Grammar lifecycle SQL transactions.

No new pool and no fallback to direct writes on managed banks. Private proof
and newly inserted telemetry rows never enter a learner response.
"""
from __future__ import annotations

from uuid import UUID
import re
from fastapi import HTTPException
from pydantic import ValidationError

from models.grammar_quiz_revisions import ManagedGrammarSessionState
from services.grammar_quiz_revision_source import REVIEWED_SOURCES
from services.grammar_quiz_policy import POLICY_KEY, GrammarQuizPolicyInvalid, validate_text_match_policy

_RPCS = frozenset({'grammar_quiz_state','grammar_quiz_start_service',
    'grammar_quiz_progress_service','grammar_quiz_end_service','grammar_quiz_reset_service'})
_ERRORS = {
    'grammar_reset_stale': (409,'Tiến độ của lượt này đã được làm lại. Hãy mở lại bài trước khi tiếp tục.'),
    'grammar_text_match_policy_required': (409,'Bản Grammar này cần trình học hỗ trợ cách chấm đã lưu. Hãy tải lại.'),
    'grammar_text_match_policy_invalid': (422,'Xác nhận cách chấm Grammar không hợp lệ.'),
    'grammar_content_revised': (409,'Nội dung Grammar đã có bản sửa. Hãy tải lại để chọn lượt học.'),
    'grammar_new_starts_paused': (409,'Bản Grammar này đang tạm dừng lượt mới; lượt đã mở vẫn được giữ.'),
    'grammar_session_not_owned': (404,'Không tìm thấy lượt Grammar của bạn.'),
    'grammar_session_closed': (409,'Lượt Grammar đã kết thúc; đáp án mới chưa được ghi.'),
    'grammar_review_read_only': (409,'Chế độ xem lại không ghi đáp án hoặc tiến độ mới.'),
    'grammar_legacy_reset_forbidden': (409,'Tiến độ bản Grammar cũ được giữ nguyên. Hãy mở bản sửa như một lượt mới.'),
    'grammar_progress_payload_invalid': (422,'Dữ liệu tiến độ chưa khớp nội dung của lượt Grammar.'),
    'grammar_session_admission_invalid': (422,'Lựa chọn lượt Grammar không hợp lệ.'),
    'grammar_progress_batch_too_large': (413,'Batch tiến độ Grammar quá lớn.'),
    'grammar_attempt_identity_conflict': (409,'Đáp án này đã thuộc một lượt khác; chưa ghi thay đổi.'),
    'grammar_managed_session_context_invalid': (409,'Nội dung Grammar vừa thay đổi. Hãy tải lại trước khi mở lượt.'),
    'grammar_managed_write_required': (409,'Nội dung Grammar vừa thay đổi. Hãy tải lại trước khi mở lượt.'),
}


def unavailable():
    return HTTPException(503,{'error_code':'grammar_revision_unavailable',
        'message':'Chưa xác minh được phiên bản Grammar đã lưu. Hãy thử tải lại.'})


def storage_error(exc):
    # PostgREST's message is data, never instruction or a raw public traceback.
    message = str(getattr(exc,'message',exc))
    for code,(status,label) in _ERRORS.items():
        if code in message:
            return HTTPException(status,{'error_code':code,'message':label})
    return unavailable()


def is_managed(bank: dict) -> bool:
    code=bank.get('grammar_canonical_code')
    if code is None:
        if (any(bank.get(key) is not None for key in ('grammar_revision','grammar_predecessor_bank_id','grammar_retired_at'))
                or bank.get('grammar_is_current') is not None and bank.get('grammar_is_current') is not False):
            raise unavailable()
        return False
    if (code not in REVIEWED_SOURCES or bank.get('skill_area')!='grammar'
            or not isinstance(bank.get('grammar_revision'),str)
            or not re.fullmatch(r'[0-9a-f]{64}',bank['grammar_revision'])
            or type(bank.get('grammar_is_current')) is not bool):
        raise unavailable()
    return True


def validate_bank_policy(bank: dict, questions: list[dict] | None = None) -> dict | None:
    """Canonical bank.meta is the sole owner; unmanaged mapped data is unavailable."""
    meta = bank.get('meta')
    if not isinstance(meta, dict):
        if is_managed(bank):
            raise unavailable()
        return None
    if POLICY_KEY not in meta:
        return None
    raw = meta[POLICY_KEY]
    if type(raw) is not dict or raw and not is_managed(bank):
        raise unavailable()
    try:
        return validate_text_match_policy(meta, questions or [],
            code=bank.get('grammar_canonical_code') or bank.get('code'), skill_area=bank.get('skill_area'))
    except GrammarQuizPolicyInvalid:
        raise unavailable() from None


def state(raw: object, bank: dict | None=None) -> dict:
    try:
        value=ManagedGrammarSessionState.model_validate(raw)
        if bank is not None and (value.canonical_code!=bank['grammar_canonical_code']
                or str(value.bank_id)!=str(bank['id'])
                or value.bank_revision!=bank['grammar_revision']
                or value.content_state!=('current' if bank['grammar_is_current'] else 'legacy')
                or (bank['grammar_is_current'] and (str(value.current_bank_id)!=str(bank['id'])
                    or value.current_bank_revision!=value.bank_revision))
                or (not bank['grammar_is_current'] and str(value.current_bank_id)==str(bank['id']))):
            raise ValueError('state identity mismatch')
        result=value.model_dump(mode='json')
        # Omit only the new optional capability, preserving every existing
        # nullable/default field in the managed and legacy response contracts.
        if value.text_match_policy is None:
            result.pop('text_match_policy')
        return result
    except (ValidationError,ValueError,KeyError,TypeError):
        raise unavailable() from None


def rpc(client,name: str,params: dict) -> dict:
    if name not in _RPCS:
        raise RuntimeError('unapproved Grammar lifecycle RPC')
    try:
        raw=client.rpc(name,params).execute().data
    except Exception as exc:
        raise storage_error(exc) from exc
    if not isinstance(raw,dict):
        raise unavailable()
    return raw


def bank_state(client,user_id: str,bank: dict) -> dict | None:
    if not is_managed(bank): return None
    return state(rpc(client,'grammar_quiz_state',{'p_user':user_id,'p_bank':bank['id']}),bank)


def start(client,*,user_id: str,bank: dict,revision: str | None,admission_kind: str | None,
          text_match_policy: str | None = None) -> dict:
    params={'p_user':user_id,'p_bank':bank['id'],
            'p_revision':revision,'p_admission_kind':admission_kind}
    if text_match_policy is not None:
        params['p_text_match_policy']=text_match_policy
    # Actual stored-map admission is owned by the serialized SQL boundary.
    # No retry/default fallback may discard a supplied capability ACK.
    value=rpc(client,'grammar_quiz_start_service',params)
    try:
        UUID(value['session_id'])
        if set(value)!={'session_id','resume','grammar'} or not isinstance(value['resume'],list):
            raise ValueError('invalid start response')
    except (KeyError,ValueError,TypeError,AttributeError):
        raise unavailable() from None
    return {**value,'grammar':state(value['grammar'],bank)}


def progress(client,*,user_id: str,session: dict,bank: dict,attempts: list,stats: list) -> tuple[dict,list]:
    value=rpc(client,'grammar_quiz_progress_service',{'p_user':user_id,'p_session':session['id'],
        'p_attempts':attempts,'p_word_stats':stats})
    private=value.pop('newly_inserted_attempts',None)
    if (set(value)!={'ok','attempts','word_stats','grammar'} or value.get('ok') is not True
            or type(value.get('attempts')) is not int or not 0<=value['attempts']<=200
            or type(value.get('word_stats')) is not int or not 0<=value['word_stats']<=200
            or not isinstance(private,list) or len(private)!=value['attempts']
            or any(not isinstance(row,dict) or str(row.get('user_id'))!=user_id
                or str(row.get('session_id'))!=session['id'] or str(row.get('bank_id'))!=session['bank_id']
                or type(row.get('is_correct')) is not bool for row in private)):
        raise unavailable()
    return {**value,'grammar':state(value['grammar'],bank)},private


def end(client,*,user_id: str,session: dict,bank: dict,summary: dict) -> dict:
    value=rpc(client,'grammar_quiz_end_service',{'p_user':user_id,'p_session':session['id'],'p_summary':summary})
    if (str(value.get('id'))!=session['id'] or str(value.get('user_id'))!=user_id
            or str(value.get('bank_id'))!=session['bank_id'] or not value.get('ended_at')
            or value.get('ended_by') not in ('completed','paused','time_cap')
            or 'grammar_revision' not in value
            or value.get('grammar_revision') != session.get('grammar_revision')):
        raise unavailable()
    if 'grammar' not in value:
        # A concurrent end may already have terminalized this exact owned row.
        # Preserve original NULL and avoid consulting canonical current state.
        return value
    return {**value,'grammar':state(value.get('grammar'),bank)}


def reset(client,*,user_id: str,bank: dict) -> dict:
    value=rpc(client,'grammar_quiz_reset_service',{'p_user':user_id,'p_bank':bank['id']})
    if value.get('ok') is not True or set(value)!={'ok','grammar'}: raise unavailable()
    return {**value,'grammar':state(value['grammar'],bank)}
