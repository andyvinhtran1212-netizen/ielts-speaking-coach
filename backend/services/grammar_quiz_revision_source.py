"""The exact approved Grammar sources, bound to raw bytes and the real bank parser.

No DB transport, alternative YAML parser or permissive answer coercion here.
Source-only edits are separately reviewed; changing this manifest is not an
unrestricted managed-bank editing capability.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any
from pathlib import Path

from services import quiz_import
from services.grammar_quiz_policy import GrammarQuizPolicyInvalid, guard_quiz_source


# Exact authored004ce bundle, approved on the base branch. The field allowlist
# was derived from the frozen canonical content snapshot and final reviewed wire;
# it is NOT fresh canonical history/extras proof or publication authorization.
APPROVED_SOURCE_MANIFEST_SHA256 = '004ce84fab271f98d2ae9c5d89c2e958b1038890cc2a931129cd529d50125b3e'
CANONICAL_FIELD_BASELINE_SHA256 = '9386274cbb93677d46c32d547bea992bd33d4d21721531c862bd88eab82fd7a7'
APPROVED_WIRE_PROOF_SHA256 = 'beae4c0a490c77565814fa51594a34eec54a58fcfbc1020b9a658e4184be7558'
# GRAMMARAUDIT-0019 adds exact approved identities while retaining every
# 0014/0015 binding. An old receipt/source remains valid after a new approval.
REVIEWED_BINDINGS = json.loads(Path(__file__).with_name('grammar_quiz_reviewed_sources.json').read_text())
REVIEWED_SOURCES = {
    code: (entry['active_source_sha256'], frozenset(entry['bindings'][entry['active_source_sha256']]['allowed_fields']))
    for code, entry in REVIEWED_BINDINGS.items()
}
REVIEWED_QUESTION_FIELDS = {
    code: {qid: frozenset(fields) for qid, fields in entry['bindings'][entry['active_source_sha256']]['allowed_fields'].items()}
    for code, entry in REVIEWED_BINDINGS.items()
}
REVIEWED_TEXT_MAPS = {
    code: entry['bindings'][entry['active_source_sha256']]['metadata']['meta'].get('text_match_by_qid', {})
    for code, entry in REVIEWED_BINDINGS.items()
}
FOLLOWUP_CODE = 'G-grammar-for-reading-long-sentence-untangling'


def reviewed_binding(code: str, raw_sha256: str) -> dict | None:
    return REVIEWED_BINDINGS.get(code, {}).get('bindings', {}).get(raw_sha256)


QUESTION_FIELDS = (
    'qid', 'item_key', 'type', 'subtype', 'input', 'skill', 'pair',
    'counts_toward_mastery', 'prompt', 'hint', 'options', 'answer', 'accept',
    'segments', 'mask', 'pairs', 'explain', 'points', 'audio_url',
    'grammar_article_slug', 'order',
)
EDITABLE_FIELDS = frozenset({'prompt', 'hint', 'options', 'answer', 'accept', 'explain'})


class GrammarSourceInvalid(ValueError):
    pass


@dataclass(frozen=True)
class GrammarSource:
    code: str
    raw_sha256: str
    metadata: dict[str, Any]
    questions: list[dict[str, Any]]
    manifest_sha256: str


def _hash(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True,
                     separators=(',', ':'), allow_nan=False)
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


def parse_reviewed_source(code: str, source: str) -> GrammarSource:
    if code not in REVIEWED_SOURCES or not isinstance(source, str):
        raise GrammarSourceInvalid('Unsupported Grammar correction')
    try:
        guard_quiz_source(source, bounded=True)
        raw_hash = hashlib.sha256(source.encode('utf-8')).hexdigest()
    except (GrammarQuizPolicyInvalid, UnicodeError) as exc:
        raise GrammarSourceInvalid(str(exc)) from None
    binding = reviewed_binding(code, raw_hash)
    if binding is None:
        raise GrammarSourceInvalid('Source bytes differ from the reviewed correction')
    # Real importer runs all duplicate-qid, key/input, pool/mastery and local
    # article-link gates. dry_run does not query topic/audio or persist anything.
    validation = quiz_import.import_quiz_file(source, dry_run=True)
    if validation['validation_errors']:
        raise GrammarSourceInvalid('The reviewed source failed current parser validation')
    metadata = validation['meta']
    if metadata['code'] != code or metadata['skill_area'] != 'grammar':
        raise GrammarSourceInvalid('Source identity differs from its canonical article')
    if metadata['meta'].get('text_match_by_qid', {}) != binding['metadata']['meta'].get('text_match_by_qid', {}):
        raise GrammarSourceInvalid('Source policy differs from the reviewed bank-local selection')
    metas, rows = 0, []
    for chunk in quiz_import.split_word_blocks(source):
        frontmatter, _ = quiz_import._split_frontmatter(chunk)
        if quiz_import._is_meta_block(frontmatter):
            metas += 1
            continue
        question = quiz_import.parse_quiz_question(frontmatter)
        boolean = frontmatter.get('answer')
        if isinstance(boolean, bool):
            question['answer'] = int(boolean)
        # This is the same source-row shape built by the real atomic importer;
        # no source changes or default transport are enabled by this helper.
        question['audio_url'] = None
        question['order'] = len(rows)
        rows.append({key: question.get(key) for key in QUESTION_FIELDS})
    if metas != 1 or len(rows) != len(validation['questions']):
        raise GrammarSourceInvalid('Ambiguous source structure')
    manifest = {'metadata': metadata, 'questions': rows}
    if metadata != binding['metadata'] or _hash(manifest) != binding['manifest_sha256']:
        raise GrammarSourceInvalid('Parsed source differs from its frozen reviewed binding')
    return GrammarSource(code, raw_hash, metadata, rows, _hash(manifest))


def compare_reviewed_questions(source: GrammarSource, original: list[dict], *, followup=False) -> list[dict]:
    """No wider question-set/mastery change can enter this one-time cutover."""
    expected = source.questions
    if len(original) != len(expected) or [q['qid'] for q in original] != [q['qid'] for q in expected]:
        raise GrammarSourceInvalid('Canonical question identity/order differs from reviewed source')
    changes = []
    binding = reviewed_binding(source.code, source.raw_sha256)
    allowed_fields = binding.get('followup_fields', {}) if followup else binding['allowed_fields']
    for before, after in zip(original, expected):
        left = {key: before.get(key) for key in QUESTION_FIELDS}
        fields = sorted(key for key in QUESTION_FIELDS if left[key] != after[key])
        if fields and (after['qid'] not in allowed_fields
                       or not set(fields) <= set(allowed_fields[after['qid']])):
            raise GrammarSourceInvalid('Unreviewed canonical question change')
        if fields:
            changes.append({'qid': after['qid'], 'fields': fields,
                            'before_sha256': _hash(left), 'after_sha256': _hash(after)})
    return changes
