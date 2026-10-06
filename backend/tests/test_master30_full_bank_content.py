"""Full package trust boundary; fixture text is not a content approval."""
import hashlib
import json

import pytest
from pydantic import ValidationError

from routers.grammar_lesson import AnswerBody, Question
from services.grammar_lesson_content import public_lesson
from services.grammar_lesson_full_content import load_full_package, _sha, _review_full_read

EXTRAS={14:1,15:4,16:5,17:5,19:2,20:3,21:10,22:1,23:9,24:10,25:10,26:20,27:10,29:10}


def test_exact_senior_read_evidence_schemas_reject_partial_or_contradictory_parallel_fields():
    short=dict(ids_and_order_preserved=True,read_coverage=dict(prompt=120,
        mcq_all_four_options_key_and_why_wrong=90,written_model_variants_rubric_output=30))
    verbose=dict(original_ids_and_order_preserved=True,read_coverage=dict(full_corrected_records_read=120,
        all_four_options_keys_and_wrong_feedback_read=90,
        all_written_models_variants_explanations_rubrics_and_output_read=30))
    assert _review_full_read(short,120,30) and _review_full_read(verbose,120,30)
    both={**short,**verbose,'read_coverage':{**short['read_coverage'],**verbose['read_coverage']}}
    assert _review_full_read(both,120,30)
    both['read_coverage']['prompt']=119
    assert not _review_full_read(both,120,30)
    assert not _review_full_read({**verbose,'ids_and_order_preserved':True},120,30)
    assert not _review_full_read({**short,'original_ids_and_order_preserved':False},120,30)
    assert not _review_full_read({},120,30)

def save(path,value):
    path.write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8')

@pytest.fixture
def package(tmp_path):
    manifest={'version':'v3','lessons':{}}
    review={'version':'v3','decision':'approved','reviewer_role':'senior_content_gate','lessons':{}}
    teaching={'lessons':{}}
    exposure={'schema':'master30-source-exposure-v1','qmatrix_sha256':'f'*64,'items':{}}
    for number in range(1,31):
        lid=f'M30-B{number:02d}'; prefix=f'B{number:02d}'; rows=[]
        for i in range(90):
            rows.append(dict(id=f'{prefix}-A1-{i:03d}',dang='A1',de='Choose the correct form.',
                             pa=['correct','wrong1','wrong2','wrong3'],dap_an=0,bay=['','why1','why2','why3'],giai_thich='Rule.'))
        for i in range(10+EXTRAS.get(number,0)):
            row=dict(id=f'{prefix}-E1-{i:03d}',dang='E1',de='Write and explain.',giai_thich='Explanation.',
                     yeu_cau_dau_ra='Two sentences.',dap_an_mau='Reference answer.',bien_the_chap_nhan=['Valid variant.'],
                     tieu_chi='Meaning and grammar.',tieu_chi_chi_tiet='Detailed criterion.',nang_luc_viet='Accuracy')
            if i>=10: row['backport_from_tm20']=True
            rows.append(row)
        path=tmp_path/f'{lid}.jsonl'
        path.write_text('\n'.join(json.dumps(row,ensure_ascii=False) for row in rows)+'\n',encoding='utf-8')
        sha=hashlib.sha256(path.read_bytes()).hexdigest()
        manifest['lessons'][lid]=dict(source_file=path.name,corrected_sha256=sha,original_sha256='a'*64,original_ids_sha256=_sha([row['id'] for row in rows]))
        review['lessons'][lid]=dict(decision='approved',corrected_file_sha256=sha,canonical_records_sha256=_sha(rows),
            original_file_sha256='a'*64,ids_and_order_preserved=True,unresolved_findings=[],item_count=len(rows),
            mcq_count=90,core_count=100,written_count=len(rows)-90,extra_count=len(rows)-100,
            read_coverage=dict(prompt=len(rows),mcq_all_four_options_key_and_why_wrong=90,written_model_variants_rubric_output=len(rows)-90))
        teaching['lessons'][lid]=dict(title=lid,focus='Accuracy',lesson_notes='Teaching.',learning_objectives=['Accuracy'],article=None)
        for row in rows:
            exposure['items'][row['id']]=dict(item_ids=[row['id']],stimulus_families=[f'family-{number}'],parallel_set_ids=[])
    save(tmp_path/'exposure.json',exposure)
    manifest['exposure_map']=dict(file='exposure.json',sha256=hashlib.sha256((tmp_path/'exposure.json').read_bytes()).hexdigest())
    save(tmp_path/'v3.json',manifest); save(tmp_path/'v3-review.json',review)
    return tmp_path,teaching,manifest,review,exposure

def test_full_counts_original_raw_fields_and_before_after_writing_secrecy(package):
    root,teaching,*_=package
    loaded=load_full_package(root,teaching)
    assert len(loaded['lessons'])==30
    assert sum(len(l['questions']) for l in loaded['lessons'].values())==3100
    lesson=loaded['lessons']['M30-B26']
    assert len(lesson['questions'])==120
    before=public_lesson(lesson)
    q=before['questions'][90]; assert q['output_requirements']=='Two sentences.'
    for secret in ('model_answer','writing_feedback','source_record','correct_index','explanation'):
        assert secret not in q
    assert 'practice_exposure' not in before
    saved=public_lesson(lesson,{q['id']:{'answer_text':'Text with a real error.'}})['questions'][90]
    assert saved['writing_feedback']['model_answer']=='Reference answer.'
    assert saved['answer_text']=='Text with a real error.' and 'is_correct' not in saved
    assert Question.model_validate(saved).type=='writing'
    assert lesson['questions'][90]['source_record']['dap_an_mau']=='Reference answer.'

@pytest.mark.parametrize('mutation',['partial','unread','wrong_hash','open_finding','escaped_file','missing_mapping'])
def test_incomplete_or_changed_approval_fails_closed(package,mutation):
    root,teaching,manifest,review,exposure=package
    approved=review['lessons']['M30-B01']
    if mutation=='partial': review['decision']='partial_not_release_ready'
    if mutation=='unread': approved['read_coverage']['prompt']=12
    if mutation=='wrong_hash': approved['corrected_file_sha256']='b'*64
    if mutation=='open_finding': approved['unresolved_findings']=['Ambiguous key']
    if mutation=='escaped_file': manifest['lessons']['M30-B01']['source_file']='../outside.jsonl'
    if mutation=='missing_mapping':
        del exposure['items']['B01-A1-000']; save(root/'exposure.json',exposure)
        manifest['exposure_map']['sha256']=hashlib.sha256((root/'exposure.json').read_bytes()).hexdigest()
    save(root/'v3.json',manifest);save(root/'v3-review.json',review)
    with pytest.raises(ValueError): load_full_package(root,teaching)

@pytest.mark.parametrize('payload',[{}, {'selected_index':0,'answer_text':'Text'}, {'answer_text':' \n '}, {'answer_text':'x'*8001}])
def test_answer_body_requires_exactly_one_typed_answer(payload):
    with pytest.raises(ValidationError): AnswerBody(question_id='B01-E1-01',**payload)

def test_raw_writing_text_and_legacy_choice_remain_valid():
    assert AnswerBody(question_id='e',answer_text='  Raw text.\nReason.  ').answer_text=='  Raw text.\nReason.  '
    assert AnswerBody(question_id='a',selected_index=0).selected_index==0


def test_mapping_follows_complete_transitive_family_parallel_closure_and_keeps_E():
    from scripts.build_master30_full_bank_package import exposure_closure
    matrix={'items':[
        {'item_id':'original','stimulus_family':'f1','parallel_set_id':'p1'},
        {'item_id':'parallel','stimulus_family':'f2','parallel_set_id':'p1'},
        {'item_id':'family','stimulus_family':'f2','parallel_set_id':'p2'},
        {'item_id':'next','stimulus_family':'f3','parallel_set_id':'p2'},
        {'item_id':'E','stimulus_family':'','parallel_set_id':'ep'},
        {'item_id':'unrelated','stimulus_family':'other','parallel_set_id':'other'},
    ]}
    value=exposure_closure(matrix,{'original','E'})
    assert value['original']=={'item_ids':['family','next','original','parallel'],
                               'stimulus_families':['f1','f2','f3'],'parallel_set_ids':['p1','p2']}
    assert value['E']=={'item_ids':['E'],'stimulus_families':[],'parallel_set_ids':['ep']}
    with pytest.raises(ValueError):exposure_closure(matrix,{'missing'})
