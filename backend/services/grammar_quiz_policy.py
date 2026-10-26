"""Bounded bank-local Grammar text policy; no grading or persistence owner."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import yaml
from yaml.nodes import MappingNode, ScalarNode, SequenceNode
from yaml.tokens import AliasToken, AnchorToken, KeyToken, ScalarToken

TEXT_MATCH_POLICY = 'qid-exact-v1'
POLICY_KEY = 'text_match_by_qid'
CANONICAL_CODES = frozenset(json.loads(Path(__file__).with_name('grammar_quiz_reviewed_sources.json').read_text()))
MAX_MAP_BYTES = 16 * 1024
MAX_MAP_ENTRIES = 200
MAX_SOURCE_BYTES = 256 * 1024
_RESERVED = frozenset({'__proto__', 'prototype', 'constructor'})
_TEXT_TYPES = frozenset({'gap_text', 'spelling', 'missing_letters'})
_FENCE = re.compile(r'^---[ \t]*$')
_STRING_TAG = 'tag:yaml.org,2002:str'


class GrammarQuizPolicyInvalid(ValueError):
    pass


def validate_text_match_policy(meta: object, questions: list[dict], *,
                               code: str | None = None,
                               skill_area: str | None = None) -> dict[str, str] | None:
    """Absence stays absent; a present invalid map never becomes legacy."""
    if not isinstance(meta, dict):
        raise GrammarQuizPolicyInvalid('Bank META must be an object')
    if POLICY_KEY not in meta:
        return None
    policy = meta[POLICY_KEY]
    if type(policy) is not dict:
        raise GrammarQuizPolicyInvalid('text_match_by_qid must be an object')
    if len(policy) > MAX_MAP_ENTRIES:
        raise GrammarQuizPolicyInvalid('text_match_by_qid exceeds 200 entries')
    owned = {}
    for question in questions:
        if not isinstance(question, dict) or type(question.get('qid')) is not str or not question['qid']:
            raise GrammarQuizPolicyInvalid('Question identity is invalid')
        if question['qid'] in owned:
            raise GrammarQuizPolicyInvalid('Question identity is duplicated')
        owned[question['qid']] = question
    def valid_accept(value):
        if type(value) is not str or not value.strip():
            return False
        try:
            value.encode('utf-8')
        except UnicodeError:
            return False
        return True

    eligible = {qid for qid, q in owned.items()
                if q.get('input') == 'text' and q.get('type') in _TEXT_TYPES
                and isinstance(q.get('accept'), list) and q['accept']
                and all(valid_accept(a) for a in q['accept'])}
    if len(policy) > len(eligible):
        raise GrammarQuizPolicyInvalid('Policy exceeds the eligible text question count')
    for qid, mode in policy.items():
        if (type(qid) is not str or not qid or qid in _RESERVED
                or qid not in eligible or type(mode) is not str
                or mode not in ('exact', 'typo_tolerant')):
            raise GrammarQuizPolicyInvalid('Policy must name an eligible owned text question and literal mode')
    try:
        encoded = json.dumps(policy, ensure_ascii=False, sort_keys=True,
                             separators=(',', ':'), allow_nan=False).encode('utf-8')
    except (ValueError, TypeError, UnicodeError):
        raise GrammarQuizPolicyInvalid('Policy must contain valid UTF-8 JSON') from None
    if len(encoded) > MAX_MAP_BYTES:
        raise GrammarQuizPolicyInvalid('text_match_by_qid exceeds 16KiB UTF-8 JSON')
    if policy and (code not in CANONICAL_CODES or skill_area != 'grammar'):
        raise GrammarQuizPolicyInvalid('Nonempty Grammar policy requires a reviewed canonical bank')
    return dict(policy)


def _root_values(node: MappingNode, key: str) -> list:
    return [v for k, v in node.value if isinstance(k, ScalarNode) and k.value == key]


def _is_meta(node: MappingNode) -> bool:
    return any(isinstance(v, ScalarNode) and v.tag == _STRING_TAG
               and v.value.strip().lower() == 'quiz' for v in _root_values(node, 'kind'))


def _unique_structure(node: Any) -> None:
    if isinstance(node, MappingNode):
        seen = set()
        for key, value in node.value:
            if not isinstance(key, ScalarNode):
                raise GrammarQuizPolicyInvalid('YAML mapping keys must be scalar')
            identity = (key.tag, key.value)
            if identity in seen or key.value == '<<':
                raise GrammarQuizPolicyInvalid('Duplicate YAML keys and merges are not supported')
            seen.add(identity)
            _unique_structure(value)
    elif isinstance(node, SequenceNode):
        for child in node.value:
            _unique_structure(child)


def _declares_key(fragment: str, name: str) -> bool:
    previous = None
    try:
        for token in yaml.scan(fragment):
            if isinstance(previous, KeyToken) and isinstance(token, ScalarToken) and token.value == name:
                return True
            previous = token
    except yaml.YAMLError:
        # A malformed declaration cannot vanish into the absent-map legacy
        # path just because composition failed. Valid scalar/body text is not
        # scanned by this fallback.
        return bool(re.search(r'(?m)^\s*[\'\"]?' + re.escape(name) + r'[\'\"]?\s*:', fragment))
    return False


def guard_quiz_source(text: str, *, bounded: bool = False) -> None:
    """Inspect raw nodes BEFORE the shared splitter/frontmatter safe_load calls.

    Consecutive fences are the same candidate intervals the real splitter probes.
    Composition retains duplicates and key tags; it does not construct dicts or
    collapse keys. Unmanaged absent-policy sources retain their old parser.
    """
    if not isinstance(text, str):
        raise GrammarQuizPolicyInvalid('Quiz source must be text')
    lines = text.lstrip('\ufeff').splitlines()
    fences = [i for i, line in enumerate(lines) if _FENCE.fullmatch(line)]
    candidates = []
    malformed_frontmatter = False
    declared = False
    for left, right in zip(fences, fences[1:]):
        fragment = '\n'.join(lines[left + 1:right])
        policy_declared = _declares_key(fragment, POLICY_KEY)
        declared = declared or policy_declared
        try:
            node = yaml.compose(fragment, Loader=yaml.SafeLoader)
        except yaml.YAMLError:
            # Undefined aliases also fail composition, so they must not vanish
            # from scoped question/META checks before the splitter safe_loads.
            # Markdown body intervals have no frontmatter identity and retain
            # their existing handling.
            malformed_frontmatter = malformed_frontmatter or policy_declared or \
                _declares_key(fragment, 'kind') or _declares_key(fragment, 'id')
            continue
        if isinstance(node, MappingNode):
            candidates.append((fragment, node))
    scoped = bounded or declared
    if not scoped:
        return
    if malformed_frontmatter:
        raise GrammarQuizPolicyInvalid('Scoped quiz frontmatter has malformed YAML')
    try:
        size = len(text.encode('utf-8'))
    except UnicodeError:
        raise GrammarQuizPolicyInvalid('Quiz source must contain valid UTF-8') from None
    if not text or size > MAX_SOURCE_BYTES:
        raise GrammarQuizPolicyInvalid('Scoped quiz source must contain 1..256KiB UTF-8 bytes')
    metas = [node for _, node in candidates if _is_meta(node)]
    if len(metas) != 1:
        raise GrammarQuizPolicyInvalid('Scoped quiz source requires exactly one quiz META')
    for fragment, node in candidates:
        if any(isinstance(token, (AliasToken, AnchorToken)) for token in yaml.scan(fragment)):
            raise GrammarQuizPolicyInvalid('Scoped quiz YAML aliases and anchors are not supported')
        _unique_structure(node)
        if not _is_meta(node) and _root_values(node, POLICY_KEY):
            raise GrammarQuizPolicyInvalid('Text policy belongs only to quiz META')
        if not _is_meta(node) and _root_values(node, 'id'):
            if any(not isinstance(v, ScalarNode) or v.tag != _STRING_TAG or not v.value.strip()
                   for v in _root_values(node, 'id')):
                raise GrammarQuizPolicyInvalid('Scoped question id must be a nonempty string')
