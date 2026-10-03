"""The twelve reviewed sources, bound to raw bytes and the real bank parser.

No DB transport, alternative YAML parser or permissive answer coercion here.
Source-only edits are separately reviewed; changing this manifest is not an
unrestricted managed-bank editing capability.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from services import quiz_import
from services.grammar_quiz_policy import GrammarQuizPolicyInvalid, guard_quiz_source


# Exact authored004ce bundle, approved on the base branch. The field allowlist
# was derived from the frozen canonical content snapshot and final reviewed wire;
# it is NOT fresh canonical history/extras proof or publication authorization.
APPROVED_SOURCE_MANIFEST_SHA256 = '004ce84fab271f98d2ae9c5d89c2e958b1038890cc2a931129cd529d50125b3e'
CANONICAL_FIELD_BASELINE_SHA256 = '9386274cbb93677d46c32d547bea992bd33d4d21721531c862bd88eab82fd7a7'
APPROVED_WIRE_PROOF_SHA256 = 'beae4c0a490c77565814fa51594a34eec54a58fcfbc1020b9a658e4184be7558'
REVIEWED_QUESTION_FIELDS = {
    'G-parts-of-speech-verbs': {
        'verb_stat_b1': frozenset(('explain',)),
        'verb_stat_b2': frozenset(('prompt', 'explain')),
        'verb_stat_i1': frozenset(('prompt', 'explain')),
        'verb_stat_i2': frozenset(('prompt', 'explain')),
        'verb_stat_a1': frozenset(('prompt', 'answer', 'explain')),
    },
    'G-sentence-structures-passive-voice': {
        'pv_form_b2': frozenset(('explain',)),
        'pv_use_i2': frozenset(('explain',)),
        'pv_intr_i2': frozenset(('prompt',)),
        'pv_err_i1': frozenset(('explain',)),
        'pv_err_i2': frozenset(('prompt',)),
        'pv_err_a1': frozenset(('prompt', 'explain')),
    },
    'G-tenses-past-continuous': {
        'pc_form_b1': frozenset(('prompt', 'explain')),
        'pc_form_b2': frozenset(('prompt', 'explain')),
        'pc_form_i1': frozenset(('prompt', 'explain')),
        'pc_form_i2': frozenset(('prompt', 'explain')),
        'pc_form_i3': frozenset(('prompt',)),
        'pc_interrupt_b1': frozenset(('prompt', 'explain')),
        'pc_interrupt_b2': frozenset(('prompt', 'explain')),
        'pc_interrupt_i1': frozenset(('prompt', 'explain')),
        'pc_interrupt_i2': frozenset(('prompt', 'explain')),
        'pc_interrupt_i3': frozenset(('prompt', 'explain')),
        'pc_interrupt_a1': frozenset(('prompt', 'answer', 'explain')),
        'pc_while_b1': frozenset(('prompt', 'explain')),
        'pc_while_b2': frozenset(('prompt', 'explain')),
        'pc_while_i1': frozenset(('prompt', 'options', 'explain')),
        'pc_while_i2': frozenset(('prompt', 'explain')),
        'pc_while_i3': frozenset(('prompt', 'explain')),
        'pc_while_a1': frozenset(('prompt', 'explain')),
        'pc_stative_b1': frozenset(('explain',)),
        'pc_stative_b2': frozenset(('prompt', 'explain')),
        'pc_stative_i1': frozenset(('explain',)),
        'pc_stative_i2': frozenset(('prompt', 'explain')),
        'pc_stative_i3': frozenset(('prompt', 'explain')),
        'pc_stative_a1': frozenset(('prompt', 'answer', 'explain')),
        'pc_stative_a2': frozenset(('explain',)),
    },
    'G-tenses-present-continuous': {
        'pc_form_b1': frozenset(('prompt', 'explain')),
        'pc_form_i1': frozenset(('prompt', 'explain')),
        'pc_form_i2': frozenset(('prompt',)),
        'pc_form_a2': frozenset(('explain',)),
        'pc_ing_i2': frozenset(('prompt',)),
        'pc_trend_b1': frozenset(('prompt', 'explain')),
        'pc_trend_i1': frozenset(('prompt', 'explain')),
        'pc_trend_i2': frozenset(('prompt', 'explain')),
        'pc_trend_a1': frozenset(('explain',)),
        'pc_trend_a2': frozenset(('explain',)),
        'pc_temp_b1': frozenset(('prompt', 'explain')),
        'pc_temp_i1': frozenset(('prompt', 'explain')),
        'pc_temp_i2': frozenset(('prompt', 'explain')),
        'pc_temp_a1': frozenset(('prompt', 'explain')),
        'pc_temp_a2': frozenset(('prompt', 'options', 'explain')),
        'pc_stative_b1': frozenset(('explain',)),
        'pc_stative_b2': frozenset(('prompt', 'explain')),
        'pc_stative_i1': frozenset(('explain',)),
        'pc_stative_i2': frozenset(('prompt', 'explain')),
        'pc_stative_a1': frozenset(('prompt', 'answer', 'explain')),
        'pc_stative_a2': frozenset(('prompt', 'explain')),
    },
    'G-tenses-present-perfect-continuous': {
        'ppc_form_b1': frozenset(('prompt', 'explain')),
        'ppc_form_i1': frozenset(('prompt', 'explain')),
        'ppc_form_i2': frozenset(('prompt',)),
        'ppc_forsince_i2': frozenset(('prompt', 'explain')),
        'ppc_vspp_b1': frozenset(('prompt', 'explain')),
        'ppc_vspp_i1': frozenset(('prompt', 'explain')),
        'ppc_vspp_i2': frozenset(('prompt', 'explain')),
        'ppc_vspp_a1': frozenset(('explain',)),
        'ppc_vspp_a2': frozenset(('prompt', 'explain')),
        'ppc_stative_b1': frozenset(('explain',)),
        'ppc_stative_i1': frozenset(('prompt', 'options', 'explain')),
        'ppc_stative_i2': frozenset(('prompt', 'explain')),
        'ppc_stative_a1': frozenset(('explain',)),
        'ppc_stative_a2': frozenset(('answer', 'explain')),
        'ppc_vspc_b1': frozenset(('prompt', 'explain')),
        'ppc_vspc_i2': frozenset(('prompt',)),
        'ppc_vspc_a1': frozenset(('prompt', 'explain')),
        'ppc_vspc_a2': frozenset(('prompt', 'explain')),
    },
    'G-tenses-present-simple': {
        'ps_3s_b1': frozenset(('prompt', 'explain')),
        'ps_3s_i2': frozenset(('prompt',)),
        'ps_3s_i3': frozenset(('prompt',)),
        'ps_dd_i2': frozenset(('prompt',)),
        'ps_dd_i3': frozenset(('prompt',)),
        'ps_truth_b1': frozenset(('prompt', 'explain')),
        'ps_truth_i1': frozenset(('explain',)),
        'ps_truth_i2': frozenset(('prompt',)),
        'ps_truth_i3': frozenset(('prompt',)),
        'ps_truth_a1': frozenset(('prompt', 'explain')),
        'ps_adv_i1': frozenset(('prompt', 'explain')),
        'ps_adv_i2': frozenset(('prompt',)),
        'ps_adv_i3': frozenset(('prompt', 'explain')),
        'ps_adv_a1': frozenset(('prompt', 'answer', 'explain')),
        'ps_vspc_b1': frozenset(('explain',)),
        'ps_vspc_i1': frozenset(('prompt', 'explain')),
        'ps_vspc_i2': frozenset(('prompt',)),
        'ps_vspc_a1': frozenset(('prompt', 'answer', 'explain')),
        'ps_vspc_a2': frozenset(('prompt', 'answer', 'explain')),
    },
    'G-grammar-for-reading-participle-clauses': {
        'pc_ving_b1': frozenset(('prompt', 'explain')),
        'pc_ving_i1': frozenset(('prompt', 'explain')),
        'pc_ving_i2': frozenset(('prompt', 'explain')),
        'pc_v3_b1': frozenset(('prompt', 'explain')),
        'pc_v3_i1': frozenset(('prompt', 'explain')),
        'pc_v3_i2': frozenset(('prompt', 'explain')),
        'pc_having_b1': frozenset(('prompt', 'explain')),
        'pc_having_i1': frozenset(('prompt', 'explain')),
        'pc_having_i2': frozenset(('prompt',)),
        'pc_meaning_b1': frozenset(('explain',)),
        'pc_meaning_i2': frozenset(('prompt', 'explain')),
        'pc_meaning_a1': frozenset(('prompt', 'explain')),
    },
    'G-grammar-for-reading-long-sentence-untangling': {
        'lsu_main_b1': frozenset(('prompt', 'explain')),
        'lsu_main_b2': frozenset(('prompt', 'explain')),
        'lsu_main_i1': frozenset(('explain',)),
        'lsu_main_i2': frozenset(('prompt', 'explain')),
        'lsu_main_a1': frozenset(('explain',)),
        'lsu_main_a2': frozenset(('prompt', 'explain')),
        'lsu_strip_b1': frozenset(('prompt', 'explain')),
        'lsu_strip_b2': frozenset(('prompt', 'explain')),
        'lsu_strip_i1': frozenset(('prompt', 'explain')),
        'lsu_strip_i2': frozenset(('prompt', 'accept', 'explain')),
        'lsu_strip_a1': frozenset(('prompt', 'explain')),
        'lsu_strip_a2': frozenset(('prompt', 'explain')),
        'lsu_pitfall_i3': frozenset(('prompt', 'accept', 'explain')),
        'lsu_pitfall_a2': frozenset(('explain',)),
    },
    'G-grammar-for-reading-reduced-relative-clauses': {
        'rrc_ving_b1': frozenset(('prompt', 'explain')),
        'rrc_ving_i1': frozenset(('options', 'explain')),
        'rrc_ving_i2': frozenset(('prompt', 'explain')),
        'rrc_v3_b1': frozenset(('prompt', 'explain')),
        'rrc_v3_i1': frozenset(('prompt', 'explain')),
        'rrc_v3_i2': frozenset(('prompt', 'accept', 'explain')),
        'rrc_v3_a1': frozenset(('explain',)),
        'rrc_main_i2': frozenset(('prompt', 'explain')),
        'rrc_main_a1': frozenset(('explain',)),
    },
    'G-tenses-past-perfect': {
        'pqp_form_b2': frozenset(('prompt', 'explain')),
        'pqp_form_i1': frozenset(('prompt', 'explain')),
        'pqp_form_i2': frozenset(('prompt',)),
        'pqp_seq_i2': frozenset(('prompt', 'explain')),
        'pqp_seq_a2': frozenset(('prompt', 'explain')),
        'pqp_bytime_b1': frozenset(('prompt', 'explain')),
        'pqp_bytime_i1': frozenset(('prompt', 'explain')),
        'pqp_bytime_i2': frozenset(('prompt', 'explain')),
        'pqp_bytime_a1': frozenset(('prompt', 'explain')),
        'pqp_cond3_b1': frozenset(('prompt',)),
        'pqp_cond3_i1': frozenset(('prompt',)),
        'pqp_cond3_i2': frozenset(('prompt',)),
        'pqp_reported_b1': frozenset(('prompt', 'explain')),
        'pqp_reported_i1': frozenset(('prompt', 'explain')),
        'pqp_reported_i2': frozenset(('prompt', 'explain')),
        'pqp_reported_a1': frozenset(('prompt', 'explain')),
    },
    'G-foundations-phrase-vs-clause': {
        'pvc_pc_b1': frozenset(('prompt', 'explain')),
        'pvc_pc_b2': frozenset(('prompt', 'explain')),
        'pvc_pc_i2': frozenset(('explain',)),
        'pvc_pc_a1': frozenset(('prompt', 'explain')),
        'pvc_frag_i1': frozenset(('prompt', 'explain')),
        'pvc_frag_i2': frozenset(('prompt', 'explain')),
        'pvc_frag_a1': frozenset(('explain',)),
        'pvc_run_i2': frozenset(('prompt',)),
        'pvc_dang_i2': frozenset(('prompt', 'accept', 'explain')),
    },
    'G-error-clinic-dangling-modifiers': {
        'dm_part_b2': frozenset(('prompt', 'explain')),
        'dm_part_i2': frozenset(('prompt', 'explain')),
        'dm_part_a1': frozenset(('explain',)),
        'dm_subj_b2': frozenset(('prompt', 'explain')),
        'dm_subj_i1': frozenset(('explain',)),
        'dm_subj_i2': frozenset(('prompt', 'explain')),
        'dm_subj_a2': frozenset(('prompt', 'explain')),
        'dm_clause_b1': frozenset(('prompt', 'explain')),
        'dm_clause_b2': frozenset(('prompt', 'explain')),
        'dm_clause_i1': frozenset(('prompt', 'explain')),
        'dm_clause_i2': frozenset(('prompt', 'accept', 'explain')),
        'dm_clause_a2': frozenset(('prompt', 'explain')),
        'dm_toinf_b1': frozenset(('explain',)),
        'dm_toinf_b2': frozenset(('prompt', 'explain')),
        'dm_toinf_i2': frozenset(('prompt', 'explain')),
        'dm_toinf_a1': frozenset(('prompt', 'explain')),
        'dm_toinf_a2': frozenset(('prompt', 'explain')),
    },
}
REVIEWED_SOURCES = {
    'G-parts-of-speech-verbs': ('36e8b94fa47dfb8fc2316a1e1cab6003d79639e1e593f7c42d2d660b258afc9d',
        frozenset(REVIEWED_QUESTION_FIELDS['G-parts-of-speech-verbs'])),
    'G-sentence-structures-passive-voice': ('2299da1f37da6ab306821c0eb34dc5735837156dfac4a7a8a480e3861fe5d866',
        frozenset(REVIEWED_QUESTION_FIELDS['G-sentence-structures-passive-voice'])),
    'G-tenses-past-continuous': ('1d75f48d70c9e476423383ec269f2a55fcc9eb8ca01307c45c4050c861bb11a6',
        frozenset(REVIEWED_QUESTION_FIELDS['G-tenses-past-continuous'])),
    'G-tenses-present-continuous': ('711e42becddee32bfee93f6d0b691a318403b1b4ffef01302d28d2dbed1c037a',
        frozenset(REVIEWED_QUESTION_FIELDS['G-tenses-present-continuous'])),
    'G-tenses-present-perfect-continuous': ('67ffbc97e73fdb1d43a88644a77d0ebfbb93b845b8f2dd6c8575dec93d84ef3a',
        frozenset(REVIEWED_QUESTION_FIELDS['G-tenses-present-perfect-continuous'])),
    'G-tenses-present-simple': ('97d6af8d735ff80ca24c7e499a7443c53218444d804273e28d6c304eb6634670',
        frozenset(REVIEWED_QUESTION_FIELDS['G-tenses-present-simple'])),
    'G-grammar-for-reading-participle-clauses': ('f63edb03e73d2e657a82d16b4adfff004b01b9bf2e7bb9f2a93b3a6e3eb4a730',
        frozenset(REVIEWED_QUESTION_FIELDS['G-grammar-for-reading-participle-clauses'])),
    'G-grammar-for-reading-long-sentence-untangling': ('f272f1d183cb766746c269510f0d226bf88036606dbdb2c3dfa246b716c6fcf0',
        frozenset(REVIEWED_QUESTION_FIELDS['G-grammar-for-reading-long-sentence-untangling'])),
    'G-grammar-for-reading-reduced-relative-clauses': ('f9c0cab2ce4292531dfeda4d8353f6044d5d77d55d38068e8567f83730d3884d',
        frozenset(REVIEWED_QUESTION_FIELDS['G-grammar-for-reading-reduced-relative-clauses'])),
    'G-tenses-past-perfect': ('297a5ae369e3bc727601e4c39157b32f43b759d2e33872201cc1df8e58222183',
        frozenset(REVIEWED_QUESTION_FIELDS['G-tenses-past-perfect'])),
    'G-foundations-phrase-vs-clause': ('66dfacf3a82258a91252cb33c3624967183c9313291b958b02ef64648a619dd9',
        frozenset(REVIEWED_QUESTION_FIELDS['G-foundations-phrase-vs-clause'])),
    'G-error-clinic-dangling-modifiers': ('8606094f523bdd1a95666ebeb6139a3e71d1efd6f712aecba06e5bfebd20dec4',
        frozenset(REVIEWED_QUESTION_FIELDS['G-error-clinic-dangling-modifiers'])),
}
REVIEWED_TEXT_MAPS = {
    'G-parts-of-speech-verbs': {qid: 'exact' for qid in ('verb_stat_i2', 'verb_sva_i2', 'verb_pp_i2')},
    'G-sentence-structures-passive-voice': {qid: 'exact' for qid in ('pv_form_i2', 'pv_use_a1', 'pv_intr_i2', 'pv_err_i2')},
    'G-tenses-past-continuous': {qid: 'exact' for qid in ('pc_form_i2', 'pc_form_i3', 'pc_interrupt_i2', 'pc_interrupt_i3', 'pc_while_i2', 'pc_while_i3', 'pc_stative_i2', 'pc_stative_i3')},
    'G-tenses-present-continuous': {qid: 'exact' for qid in ('pc_form_i2', 'pc_ing_i2', 'pc_trend_i2', 'pc_temp_i2', 'pc_stative_i2')},
    'G-tenses-present-perfect-continuous': {qid: 'exact' for qid in ('ppc_form_i2', 'ppc_vspp_i2', 'ppc_stative_i2', 'ppc_vspc_i2')},
    'G-tenses-present-simple': {qid: 'exact' for qid in ('ps_3s_i2', 'ps_3s_i3', 'ps_dd_i2', 'ps_dd_i3', 'ps_truth_i2', 'ps_truth_i3', 'ps_adv_i2', 'ps_adv_i3', 'ps_vspc_i2')},
    'G-grammar-for-reading-participle-clauses': {qid: 'exact' for qid in ('pc_ving_i2', 'pc_v3_i2', 'pc_having_i2')},
    'G-grammar-for-reading-long-sentence-untangling': {qid: 'exact' for qid in ()},
    'G-grammar-for-reading-reduced-relative-clauses': {qid: 'exact' for qid in ('rrc_ving_i2', 'rrc_v3_i2', 'rrc_main_i2')},
    'G-tenses-past-perfect': {qid: 'exact' for qid in ('pqp_form_i2', 'pqp_seq_i2', 'pqp_bytime_i2', 'pqp_cond3_i2', 'pqp_reported_i2')},
    'G-foundations-phrase-vs-clause': {qid: 'exact' for qid in ('pvc_frag_i2', 'pvc_dang_i2')},
    'G-error-clinic-dangling-modifiers': {qid: 'exact' for qid in ('dm_subj_i2', 'dm_clause_i2', 'dm_toinf_i2')},
}
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
    if raw_hash != REVIEWED_SOURCES[code][0]:
        raise GrammarSourceInvalid('Source bytes differ from the reviewed correction')
    # Real importer runs all duplicate-qid, key/input, pool/mastery and local
    # article-link gates. dry_run does not query topic/audio or persist anything.
    validation = quiz_import.import_quiz_file(source, dry_run=True)
    if validation['validation_errors']:
        raise GrammarSourceInvalid('The reviewed source failed current parser validation')
    metadata = validation['meta']
    if metadata['code'] != code or metadata['skill_area'] != 'grammar':
        raise GrammarSourceInvalid('Source identity differs from its canonical article')
    if metadata['meta'].get('text_match_by_qid', {}) != REVIEWED_TEXT_MAPS[code]:
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
    return GrammarSource(code, raw_hash, metadata, rows, _hash(manifest))


def compare_reviewed_questions(source: GrammarSource, original: list[dict]) -> list[dict]:
    """No wider question-set/mastery change can enter this one-time cutover."""
    expected = source.questions
    if len(original) != len(expected) or [q['qid'] for q in original] != [q['qid'] for q in expected]:
        raise GrammarSourceInvalid('Canonical question identity/order differs from reviewed source')
    changes = []
    allowed_fields = REVIEWED_QUESTION_FIELDS[source.code]
    for before, after in zip(original, expected):
        left = {key: before.get(key) for key in QUESTION_FIELDS}
        fields = sorted(key for key in QUESTION_FIELDS if left[key] != after[key])
        if fields and (after['qid'] not in allowed_fields
                       or not set(fields) <= allowed_fields[after['qid']]):
            raise GrammarSourceInvalid('Unreviewed canonical question change')
        if fields:
            changes.append({'qid': after['qid'], 'fields': fields,
                            'before_sha256': _hash(left), 'after_sha256': _hash(after)})
    return changes
