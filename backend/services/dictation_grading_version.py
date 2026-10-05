"""Frozen test-linked Dictation policy contracts; legacy remains the default.

The reference fingerprint covers exact ordered UTF-8 texts. Timing and hints
stay in the immutable snapshot but never change the input used for grading.
"""
from __future__ import annotations

import hashlib
import re
from typing import Any

from services.dictation_lexical_policy import (
    LEXICAL_POLICY_VERSION, InvalidLexicalReference, grade_lexical, tokenize_lexical,
)
from services.listening_grader import grade_dictation

LEGACY_POLICY_VERSION = 'legacy-whitespace-v1'
SUPPORTED_POLICY_VERSIONS = frozenset({LEGACY_POLICY_VERSION, LEXICAL_POLICY_VERSION})
_SHA256 = re.compile(r'^[0-9a-f]{64}$')


class DictationPolicyError(ValueError):
    def __init__(self, status_code: int, code: str, message: str):
        self.status_code, self.code, self.message = status_code, code, message
        super().__init__(message)


def text_sha256(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def reference_sha256(units: Any) -> str:
    if (not isinstance(units, list) or not 1 <= len(units) <= 200
            or any(not isinstance(unit, dict) or not isinstance(unit.get('text'), str)
                   for unit in units)):
        raise DictationPolicyError(503, 'dictation_reference_unavailable',
                                   'Chưa xác minh được nội dung đã lưu của lượt Dictation.')
    # Fixed-length per-text digests cannot collide by changing word boundaries
    # between neighbouring units. The prefix distinguishes this contract.
    value = 'dictation-texts-v1\n' + ''.join(text_sha256(unit['text']) for unit in units)
    return text_sha256(value)


def validate_new_lexical_source(units: Any) -> str:
    fingerprint = reference_sha256(units)
    if sum(len(unit['text'].encode('utf-8')) for unit in units) > 256 * 1024:
        raise DictationPolicyError(422, 'dictation_reference_too_large',
                                   'Nội dung Dictation vượt giới hạn kiểm tra.')
    for index, unit in enumerate(units):
        tokens = tokenize_lexical(unit['text'])
        if not tokens.lexical:
            raise DictationPolicyError(422, 'dictation_reference_without_words',
                f'Câu {index + 1} chỉ có dấu hoặc ký hiệu; chưa thể bắt đầu chấm từ.')
        if tokens.ambiguities:
            raise DictationPolicyError(422, 'dictation_reference_needs_review',
                f'Câu {index + 1} có dấu nháy hoặc ngoặc cần tác giả kiểm tra trước khi chấm.')
    return fingerprint


def persisted_policy_identity(row: dict[str, Any]) -> dict[str, str | None]:
    """Validate a stored policy header for bounded analytics projections.

    This does not certify raw reference evidence; full attempt/report reads use
    frozen_contract/session_contract instead. Never infer a version from dates.
    """
    version, digest = row.get('grading_version'), row.get('reference_sha256')
    if version is None and digest is None:
        return {'grading_version': LEGACY_POLICY_VERSION, 'reference_sha256': None}
    if (not isinstance(version, str) or version not in SUPPORTED_POLICY_VERSIONS
            or (digest is None and version != LEGACY_POLICY_VERSION)
            or (digest is not None and (not isinstance(digest, str) or not _SHA256.fullmatch(digest)))):
        raise DictationPolicyError(503, 'dictation_policy_unavailable',
                                   'Chưa xác minh được chính sách chấm đã lưu.')
    return {'grading_version': version, 'reference_sha256': digest}


def frozen_contract(row: dict[str, Any]) -> dict[str, str | None]:
    version = row.get('grading_version')
    expected = row.get('reference_sha256')
    if version is None:
        if expected is not None:
            raise DictationPolicyError(503, 'dictation_policy_unavailable',
                                       'Dấu vân tay đã lưu thiếu chính sách chấm tương ứng.')
        return {'grading_version': LEGACY_POLICY_VERSION, 'reference_sha256': None}
    if not isinstance(version, str) or version not in SUPPORTED_POLICY_VERSIONS:
        raise DictationPolicyError(503, 'dictation_policy_unavailable',
                                   'Chưa xác minh được chính sách chấm đã lưu.')
    if version == LEGACY_POLICY_VERSION and expected is None:
        return {'grading_version': version, 'reference_sha256': None}
    if (not isinstance(expected, str) or not _SHA256.fullmatch(expected)
            or reference_sha256(row.get('units_snapshot')) != expected):
        raise DictationPolicyError(503, 'dictation_reference_unavailable',
                                   'Nội dung đã lưu không khớp dấu vân tay của lượt Dictation.')
    return {'grading_version': version, 'reference_sha256': expected}


def require_write_contract(row: dict[str, Any], *, grading_version: str | None,
                           acknowledged_reference_sha256: str | None) -> dict[str, str | None]:
    contract = frozen_contract(row)
    expected = contract['grading_version']
    if expected == LEXICAL_POLICY_VERSION:
        if grading_version != expected or acknowledged_reference_sha256 != contract['reference_sha256']:
            raise DictationPolicyError(409, 'dictation_policy_update_required',
                'Lượt này dùng chính sách chấm từ mới. Hãy tải lại nội dung trước khi lưu.')
    elif (grading_version not in (None, LEGACY_POLICY_VERSION)
          or acknowledged_reference_sha256 not in (None, contract['reference_sha256'])):
        raise DictationPolicyError(409, 'dictation_policy_conflict',
                                   'Giữ chính sách chấm cũ cho lượt đang làm; hãy tải lại.')
    return contract


def grade_frozen_sentence(row: dict[str, Any], sentence_idx: int, user_text: str, *,
                          grading_version: str | None,
                          acknowledged_reference_sha256: str | None) -> dict[str, Any]:
    contract = require_write_contract(row, grading_version=grading_version,
        acknowledged_reference_sha256=acknowledged_reference_sha256)
    units = row.get('units_snapshot')
    if not isinstance(units, list) or not 0 <= sentence_idx < len(units):
        raise DictationPolicyError(422, 'dictation_sentence_out_of_range',
                                   'Câu Dictation nằm ngoài nội dung đã lưu.')
    reference = units[sentence_idx].get('text') if isinstance(units[sentence_idx], dict) else None
    if not isinstance(reference, str):
        raise DictationPolicyError(503, 'dictation_reference_unavailable',
                                   'Không đọc được câu Dictation đã lưu.')
    scorer = grade_lexical if contract['grading_version'] == LEXICAL_POLICY_VERSION else grade_dictation
    try:
        grade = scorer(reference_transcript=reference, user_transcript=user_text, ignore_fillers=True)
    except InvalidLexicalReference:
        raise DictationPolicyError(422, 'dictation_reference_without_words',
                                   'Câu Dictation chỉ có dấu hoặc ký hiệu; chưa ghi kết quả.') from None
    return {**grade, **contract, 'sentence_reference_sha256': text_sha256(reference)}


def session_contract(row: dict[str, Any]) -> dict[str, str | None]:
    """Check persisted v2 reports from their own evidence, never current content.

    Legacy reports can lack original references and stay readable as legacy;
    that absence never qualifies them for a historical repair.
    """
    version = row.get('grading_version')
    digest = row.get('reference_sha256')
    if version is None and digest is None:
        return {'grading_version': LEGACY_POLICY_VERSION, 'reference_sha256': None}
    if version == LEGACY_POLICY_VERSION and digest is None:
        return {'grading_version': LEGACY_POLICY_VERSION, 'reference_sha256': None}
    if not isinstance(version, str) or version not in SUPPORTED_POLICY_VERSIONS:
        raise DictationPolicyError(503, 'dictation_policy_unavailable',
                                   'Chưa xác minh được chính sách của báo cáo đã lưu.')
    results = row.get('results')
    if (not isinstance(results, list) or not 1 <= len(results) <= 200
            or any(not isinstance(item, dict) or type(item.get('sentence_idx')) is not int
                   or not isinstance(item.get('reference'), str) for item in results)
            or sorted(item['sentence_idx'] for item in results) != list(range(len(results)))):
        raise DictationPolicyError(503, 'dictation_reference_unavailable',
                                   'Báo cáo đã lưu thiếu bằng chứng tham chiếu đầy đủ.')
    ordered = sorted(results, key=lambda item: item['sentence_idx'])
    contract = frozen_contract({'grading_version': version, 'reference_sha256': digest,
                               'units_snapshot': [{'text': item['reference']} for item in ordered]})
    if version == LEXICAL_POLICY_VERSION:
        for item in ordered:
            evidence = item.get('grading_evidence')
            if (not isinstance(evidence, dict)
                    or item.get('grading_version') != version
                    or item.get('reference_sha256') != digest
                    or item.get('sentence_reference_sha256') != text_sha256(item['reference'])
                    or any(evidence.get(key) != item.get(key) for key in (
                        'grading_version', 'reference_sha256', 'sentence_reference_sha256',
                        'reference', 'user_text', 'score', 'correct_words', 'total_words', 'diff'))):
                raise DictationPolicyError(503, 'dictation_policy_evidence_unavailable',
                                           'Bằng chứng chấm đã lưu chưa khớp báo cáo.')
    return contract
