"""Source practice contract tests: complete topology, review gates and leakage."""
from __future__ import annotations
import asyncio
from copy import deepcopy
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import wave
import pytest
from fastapi import HTTPException
from models.listening_source_collection import SOURCE_CONTRACT, SOURCE_PROGRAMME, ListeningSourceDayResponse
from services import listening_source_collection as service
from services import listening_source_package_import as importer
from services import listening_test_grader as grader
from services.listening_programme_feedback import FeedbackUnavailable, build_guided_feedback
from services.listening_package_import import PackageValidationError


def _dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding='utf-8')


def _bind(root):
    manifest = json.loads((root/'manifest.json').read_text())
    manifest['artifact_hashes'] = {p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest()
        for p in root.rglob('*') if p.is_file() and p.name != 'manifest.json'}
    _dump(root/'manifest.json', manifest)


def _certify(item):
    item.update(safe_for_grading=True, display_mode='objective_exact')
    item['objective_eligibility'] = {'status':'ACCEPTED', 'reviewer':'objective-fixture-reviewer',
        'eligible':True, 'reviewed_content_sha256':importer.objective_content_sha256(item)}


@pytest.fixture()
def release(tmp_path):
    root = tmp_path/'release'
    root.mkdir()
    pdf = root/'original.pdf'; pdf.write_bytes(b'%PDF-1.7\noriginal-source-fixture')
    pdfhash = hashlib.sha256(pdf.read_bytes()).hexdigest()
    audio = root/'audio.wav'
    with wave.open(str(audio),'wb') as handle:
        handle.setnchannels(1);handle.setsampwidth(2);handle.setframerate(24000)
        handle.writeframes(b'\x01\x00'*24000)
    audiohash = hashlib.sha256(audio.read_bytes()).hexdigest()
    paths=[]; source_count=0
    for day in range(1,81):
        group='short_practice' if day<=50 else 'teaching' if day<=60 else 'vocabulary' if day<=70 else 'mock'
        count=24 if day<=50 else 7 if day<=60 else 0 if day<=70 else 41
        source_count+=count
        day_id=f'80-days:day-{day:02d}'
        parts=[];blocks=[];items=[]
        ranges=[list(range(1,count+1))] if day<=60 else [] if day<=70 else [list(range(1,11)),list(range(11,21)),list(range(21,31)),list(range(31,42))]
        for ordinal,nums in enumerate(ranges,1):
            part_id=f'{day_id}:part-{ordinal}'
            block_id=part_id+':block-1'
            parts.append({'part_id':part_id,'source_label':f'Section {ordinal}' if day>70 else f'Part {ordinal}','question_numbers':nums})
            ids=[f'{day_id}:main:q-{q:02d}' for q in nums]
            blocks.append({'block_id':block_id,'part_id':part_id,'kind':'single_choice',
                'instruction':{'source_en':'Choose one letter.','student_vi':'Chọn một chữ cái.','select_count':1},
                'question_numbers':nums,'item_ids':ids,'source_assets':[]})
            for q,item_id in zip(nums,ids):
                items.append({'item_id':item_id,'part_id':part_id,'block_id':block_id,'source_question_number':q,'source_display_number':str(q),
                    'response':{'type':'single_choice','prompt':f'Question {q}','options':[{'id':'A','text':'One'},{'id':'B','text':'Two'}],'select_count':1},
                    'answer_provenance':{'editorial_answer':'A'},
                    'explanation_vi':{'answer':'A','why_vi':'Người nói nêu rõ One.',
                        'evidence':[{'source_kind':'printed_transcript','pdf_page':249,'quote':'One'}],
                        'distractors':[{'option':'B','reason_vi':'Two không được người nói nhắc đến.'}]},
                    'independent_review':{'status':'ACCEPTED','verdict':'CONFIRMED','reviewer':'independent-fixture',
                        'confidence':0.9,'instruction_checked':True,'alternatives_checked':True}})
        doc={'schema_version':'80-days-curated-day/1.0','day':day,'day_id':day_id,'group':group,'title_vi':f'Day {day}',
            'source_pdf_sha256':pdfhash,'question_count':count,'parts':parts,'blocks':blocks,'items':items,
            'audio':{'status':'MISSING' if day==77 or group=='vocabulary' else 'PARTIAL' if day==76 else 'AVAILABLE',
                'asset_path':'audio.wav','sha256':audiohash,'duration_seconds':1},
            'vocabulary_groups':[{'title':'Chủ đề','terms':[{'term':'course','meaning_vi':'khóa học','editorial':True}]}] if group=='vocabulary' else []}
        for item in items:
            _certify(item)
        if items:
            paragraphs=[{'part_id': part['part_id'], 'text': 'Exact source transcript text.', 'source_pdf_page':249, 'line_index_1_based': i} for i,part in enumerate(parts,1)]
            companion={'day_id':day_id,'source_pdf_sha256':pdfhash,'paragraphs':paragraphs}
            transcript_path=f'transcripts/day-{day:02d}.json';_dump(root/transcript_path,companion)
            doc['transcript']={'asset_path':transcript_path,'sha256':hashlib.sha256((root/transcript_path).read_bytes()).hexdigest(), 'independent_review_status':'ACCEPTED','reviewer':'independent-fixture','paragraphs':paragraphs}
        relative=f'days/day-{day:02d}.json';paths.append(relative);_dump(root/relative,doc)
    _dump(root/'manifest.json',{'schema_version':'80-days-source-release/1.0','programme_id':SOURCE_PROGRAMME,
        'package_id':'ielts-80-days-listening-v1.0.0','source_pdf_sha256':pdfhash,
        'source_bindings':[{'kind':'pdf','path':'original.pdf','sha256':pdfhash}],
        'days':paths,'counts':{'source_positions':source_count}})
    _bind(root)
    return root


def test_full_projection_preserves_resources_mock_positions_and_real_audio(release):
    plan=importer.build_source_import_plan(release)
    assert len(plan.lessons)==80
    assert not [form for form in plan.forms if form['source_lesson_id'] in {'80-days:day-61','80-days:day-77'}]
    assert sum(form['item_count'] for form in plan.forms if form['source_lesson_id']=='80-days:day-75')==41
    assert len([form for form in plan.forms if form['source_lesson_id']=='80-days:day-76'])==2
    assert all(form['item_count']<=40 for form in plan.forms)
    assert all(form['exercise_payload']['audio_windows']=={} for form in plan.forms)
    assert all(stimulus['source_timing_path'] is None for stimulus in plan.stimuli)
    assert plan.package['source_counts']['items']<plan.report['source_positions']
    assert len([asset for asset in plan.assets if asset["kind"]=="audio"])==1


@pytest.mark.parametrize('mutation,match',[
    (lambda day: day['items'][0]['independent_review'].update(status='PENDING'),'independent review'),
    (lambda day: day['items'][0]['independent_review'].update(alternatives_checked=False),'alternative review'),
    (lambda day: day['items'][0]['explanation_vi'].update(evidence=[]),'explanation evidence'),
    (lambda day: day['items'][0]['explanation_vi'].update(distractors=[]),'Unreviewed distractor'),
    (lambda day: day['blocks'][0]['item_ids'].append('unknown'),'coverage mismatch'),
])
def test_release_rejects_unreviewed_or_incomplete_content(release,mutation,match):
    path=release/'days/day-01.json';day=json.loads(path.read_text());mutation(day);_dump(path,day);_bind(release)
    with pytest.raises(PackageValidationError,match=match):importer.build_source_import_plan(release)


def test_candidate_choices_are_self_review_and_source_modes_fail_closed(release):
    path=release/'days/day-01.json';day=json.loads(path.read_text())
    day['items'][0]['independent_review']['verdict']='AMBIGUOUS';_dump(path,day);_bind(release)
    plan=importer.build_source_import_plan(release)
    payload=plan.forms[0]['exercise_payload'];rows=[{'payload':payload}]
    result=grader.grade_report_only_attempt([{'q_num':1,'user_answer':'A'}],rows,source_required=True)
    assert result['per_question'][0]['state']=='unscored'
    assert result['per_question'][0]['correct'] is None
    feedback=build_guided_feedback(1,'A',rows,'allowed',source_required=True)
    assert feedback['review_status']=='AMBIGUOUS' and feedback['explanation']['why_vi']
    assert feedback['expected']==[] and feedback['audio_window'] is None
    malformed=deepcopy(rows);del malformed[0]['payload']['source_contract']
    result=grader.grade_report_only_attempt([{'q_num':2,'user_answer':'A'}],malformed,source_required=True)
    assert all(item['state']=='technical_error' for item in result['per_question'])
    with pytest.raises(FeedbackUnavailable):build_guided_feedback(2,'A',malformed,'allowed',source_required=True)


def test_confirmed_objective_requires_protected_review_and_valid_option(release):
    payload=importer.build_source_import_plan(release).forms[0]['exercise_payload']
    for mutation in [lambda p:p['solutions']['1'].update(review_status='SUSPECT'),
                     lambda p:p['solutions']['1'].update(review_accepted=False),
                     lambda p:p['answers'][0].update(answers=['unknown'])]:
        value=deepcopy(payload);mutation(value)
        result=grader.grade_report_only_attempt([{'q_num':1,'user_answer':'A'}],[{'payload':value}],source_required=True)
        assert result['per_question'][0]['state']=='technical_error'
    good=grader.grade_report_only_attempt([{'q_num':1,'user_answer':'B'}],[{'payload':payload}],source_required=True)
    assert good['per_question'][0]['correct'] is False


def test_nested_authoring_answers_do_not_reach_safe_payload(release):
    payload=importer.build_source_import_plan(release).forms[0]['exercise_payload']
    payload['questions'][0]['explanation']={'answer':'SECRET'}
    payload['questions'][0]['fields']=[{'field_id':'one','prompt':'One','word_limit':2,'answer':'SECRET'}]
    payload['source_blocks'][0]['instruction']['answer']='SECRET'
    payload['source_blocks'][0]['explanation']={'answer':'SECRET'}
    safe=grader.strip_answer_keys([{'payload':payload}])[0]['payload']
    assert 'SECRET' not in str(safe) and 'solutions' not in safe and 'answers' not in safe
    assert safe['questions'][0]['source_block_id'] and safe['questions'][0]['fields'][0]['word_limit']==2


def test_unresolved_position_stays_in_inventory_without_inflating_denominator(release):
    path=release/'days/day-01.json';day=json.loads(path.read_text());item=day['items'][0]
    item['independent_review']['verdict']='UNRESOLVED'
    item['explanation_vi'].update(answer=None,source_answer_warning_vi='Nguồn không đủ bằng chứng.',next_action_vi='Cần bổ sung ngữ cảnh.')
    _dump(path,day);_bind(release)
    plan=importer.build_source_import_plan(release)
    lesson=plan.lessons[0];meta=lesson['metadata']['source_book']
    assert meta['source_position_count']==24 and meta['source_only_count']==1
    assert plan.forms[0]['item_count']==23
    assert meta['source_only_positions'][0]['item_id']==item['item_id']


def test_source_study_never_returns_practice_answers(release):
    plan=importer.build_source_import_plan(release)
    practice=plan.lessons[0]
    with pytest.raises(HTTPException) as error:service.study_response(practice,[practice['metadata']['source_book']['blocks'][0]['block_id']],lambda p:'signed')
    assert error.value.status_code==422
    resource=next(lesson for lesson in plan.lessons if lesson['sequence_num']==77)
    selected=resource['metadata']['source_book']['blocks'][0]['block_id']
    response=service.study_response(resource,[selected],lambda p:'signed')
    assert response['independent_practice'] is False and response['blocks'][0]['items'][0]['explanation']['answer']=='A'


def test_public_limitations_hide_evidence_and_keep_it_in_explicit_study(release):
    path=release/'days/day-01.json';day=json.loads(path.read_text());item=day['items'][0]
    warning='Đề hỏi 1990, transcript ghi 1900; số one kilogram không trả lời đúng năm được hỏi.'
    item['independent_review']['verdict']='UNRESOLVED'
    item['explanation_vi'].update(answer=None,source_answer_warning_vi=warning,next_action_vi='Cần kiểm tra năm.')
    _dump(path,day);_bind(release);plan=importer.build_source_import_plan(release)
    lesson=plan.lessons[0]|{'id':'lesson'};meta=lesson['metadata']['source_book']
    meta['source_only_positions'][0]['extra_private']={'answer':'SECRET_CANDIDATE'}
    original=deepcopy(lesson)
    before=service.day_response(plan.package,lesson,[],{},lambda _:'signed',False)
    position=before['source_only_positions'][0]
    assert position['reason_vi']==service.SOURCE_ONLY_UNRESOLVED
    assert warning not in str(before) and 'SECRET_CANDIDATE' not in str(before)
    assert set(position)=={'item_id','source_display_number','part_id','block_id','review_status','reason_vi'}
    study=service.study_response(lesson,[item['block_id']],lambda _:pytest.fail('mixed crop must remain private'))
    assert study['blocks'][0]['items'][0]['explanation']['source_answer_warning_vi']==warning
    assert [{key: row[key] for key in ('source_kind','pdf_page','quote')}
            for row in study['blocks'][0]['items'][0]['explanation']['evidence']]==item['explanation_vi']['evidence']
    assert lesson==original


def test_public_limitations_use_part_state_and_unresolved_precedence(release):
    plan=importer.build_source_import_plan(release)
    lesson=next(row for row in plan.lessons if row['sequence_num']==77)|{'id':'missing-audio'}
    meta=lesson['metadata']['source_book'];position=meta['source_only_positions'][0]
    position['reason_vi']='The printed key is A; One supports it.'
    for verdict,audio,expected in [
        ('CONFIRMED','missing',service.SOURCE_ONLY_MISSING_AUDIO),
        ('UNRESOLVED','missing',service.SOURCE_ONLY_UNRESOLVED),
        ('UNRESOLVED','available',service.SOURCE_ONLY_UNRESOLVED),
        ('AMBIGUOUS','available',service.SOURCE_ONLY_STUDY),
    ]:
        position['review_status']=verdict;meta['parts'][0]['audio_status']=audio
        before=service.day_response(plan.package,lesson,[],{},lambda _:pytest.fail('unopened image signed'),False)
        assert before['source_only_positions'][0]['reason_vi']==expected
        assert position['reason_vi'] not in str(before)


@pytest.mark.parametrize('mutation',[
    lambda position:position.update(review_status='UNKNOWN'),
    lambda position:position.update(part_id='unknown-part'),
    lambda position:position.pop('item_id'),
])
def test_invalid_public_source_position_is_a_visible_technical_error(release,mutation):
    plan=importer.build_source_import_plan(release)
    lesson=next(row for row in plan.lessons if row['sequence_num']==77)|{'id':'lesson'}
    mutation(lesson['metadata']['source_book']['source_only_positions'][0])
    with pytest.raises(HTTPException) as error:service.day_response(plan.package,lesson,[],{},lambda _:'signed',False)
    assert error.value.status_code==503


@pytest.mark.parametrize('title',['Lời giảng và bảng key E / H','Sơ đồ và key nguồn có lỗi spay tube'])
def test_unopened_study_metadata_hides_solved_titles_across_public_projections(release,title):
    plan=importer.build_source_import_plan(release)
    lesson=next(row for row in plan.lessons if row['sequence_num']==77)|{'id':'lesson'}
    block=lesson['metadata']['source_book']['blocks'][0]
    block.update(description=title,instruction={'source_en':'KEY A', 'student_vi':'One is the answer.',
        'word_limit':3,'select_count':1},shared_options=[{'id':'A','label':'SOLVED_RESOURCE_OPTION'}])
    original=deepcopy(lesson)
    before=service.day_response(plan.package,lesson,[],{},lambda _:pytest.fail('unopened image signed'),False)
    public=before['blocks'][0]
    assert public['description']==service.UNOPENED_STUDY_DESCRIPTION
    assert public['instruction']=={'source_en':'','student_vi':service.UNOPENED_STUDY_INSTRUCTION,
        'word_limit':None,'select_count':None}
    assert public['shared_options']==[] and public['images']==[]
    stripped=grader.strip_answer_keys([{'payload':{'source_contract':SOURCE_CONTRACT,'source_blocks':[block]}}])
    for protected in [title,'KEY A','One is the answer.','SOLVED_RESOURCE_OPTION']:
        assert protected not in str(before) and protected not in str(stripped)
    study=service.study_response(lesson,[block['block_id']],lambda _:'signed')
    opened=study['blocks'][0]
    assert opened['description']==title and opened['instruction']==block['instruction']
    assert opened['shared_options']==block['shared_options'] and opened['items'][0]['explanation']['answer']=='A'
    assert lesson==original


def test_safe_day_shapes_with_zero_forms_and_no_study_solution(release):
    plan=importer.build_source_import_plan(release)
    lesson=next(lesson for lesson in plan.lessons if lesson['sequence_num']==77)|{'id':'lesson-77'}
    package=plan.package|{'id':'package-id'}
    result=service.day_response(package,lesson,[],{},lambda path:'signed',False)
    wire=ListeningSourceDayResponse.model_validate(result).model_dump()
    assert wire['practice_item_count']==0 and all(part['form'] is None for part in wire['parts'])
    assert 'why_vi' not in str(wire) and all(block['images']==[] for block in wire['blocks'])


def test_original_binding_hash_changes_fail_before_plan(release):
    (release/'original.pdf').write_bytes(b'changed original')
    _bind(release)
    with pytest.raises(PackageValidationError,match='Original source hash'):importer.build_source_import_plan(release)


def test_vocabulary_adapter_retains_editorial_caveats():
    raw={'schema':'listening-source-vocabulary-day/1.0','day':61,'source_pdf_sha256':'0'*64,
        'review':{'status':'ACCEPTED','reviewer':'independent'},'source':{'derived_path':'vocab.png','visual_review':{'independent_review':'ACCEPTED'}},
        'groups':[{'title_vi':'Trình độ','source_heading':'Level','editorial_heading_en':'Level',
            'editorial_note_vi':'Secondary không đồng nghĩa intermediate.', 'source_layout_note_vi':'Nguồn dùng ngoặc.',
            'terms':[{'source_term':'secondary','meaning_vi':'trung học','provenance':'editorial_definition','source_ref':{'pdf_page':184,'line_index_1_based':4}}]}]}
    day=importer.adapt_vocabulary_document(raw)
    group=day['vocabulary_groups'][0]
    assert group['editorial_note_vi'] and group['source_layout_note_vi'] and group['source_heading']=='Level'
    assert group['terms'][0]['source_pdf_page']==184


def test_multi_blank_keeps_one_position_and_per_field_limits(release):
    path=release/'days/day-01.json';day=json.loads(path.read_text());item=day['items'][0]
    item['response']={'type':'multi_gap_completion','prompt':'Điền hai chỗ trống','fields':[{'field_id':'country','prompt':'Country','word_limit':2},{'field_id':'order','prompt':'Birth order','word_limit':2}]}
    item['explanation_vi']['answer']={'country':'Britain','order':'third'}
    item['answer_provenance']['editorial_answer']={'country':'Britain','order':'third'}
    _dump(path,day);_bind(release);plan=importer.build_source_import_plan(release)
    payload=plan.forms[0]['exercise_payload'];question=payload['questions'][0]
    assert question['response_type']=='multi_gap_completion' and len(question['fields'])==2
    assert plan.forms[0]['item_count']==24
    feedback=build_guided_feedback(1,'{"country":"Britain","order":"third"}',[{'payload':payload}],'allowed',source_required=True)
    assert feedback['correct'] is None and feedback['explanation']['answer']=={'country':'Britain','order':'third'}


def test_part_transcripts_are_bound_untimed_and_absent_before_submission(release):
    plan=importer.build_source_import_plan(release)
    form=next(form for form in plan.forms if form['source_lesson_id']=='80-days:day-75')
    payload=form['exercise_payload']
    transcript=next(iter(payload['controlled_transcripts'].values()))
    assert len(transcript)==1 and transcript[0]['pdf_page']==249 and transcript[0]['text']=='Exact source transcript text.'
    assert 'start' not in transcript[0] and 'end' not in transcript[0]
    assert 'controlled_transcripts' not in grader.strip_answer_keys([{'payload':payload}])[0]['payload']
    assert all(stimulus['controlled_transcript_path'] and len(stimulus['controlled_transcript_sha256'])==64 for stimulus in plan.stimuli)
    path=release/'days/day-01.json';day=json.loads(path.read_text());day['transcript']['paragraphs'][0]['text']='Unbound edited transcript'
    _dump(path,day);_bind(release)
    with pytest.raises(PackageValidationError,match='bound companion'):importer.build_source_import_plan(release)


def test_mixed_block_study_excludes_eligible_answers_and_whole_transcript(release):
    path=release/'days/day-01.json';day=json.loads(path.read_text());item=day['items'][0]
    item['independent_review']['verdict']='UNRESOLVED'
    item['explanation_vi'].update(answer=None,source_answer_warning_vi='Không đủ bằng chứng.',next_action_vi='Cần kiểm tra thêm.')
    _dump(path,day);_bind(release);plan=importer.build_source_import_plan(release);lesson=plan.lessons[0]
    block=lesson['metadata']['source_book']['blocks'][0]
    assert block['display_kind']=='practice' and block['study_available'] is True
    result=service.study_response(lesson,[block['block_id']],lambda _:pytest.fail('mixed crop must not be signed'))
    assert [value['item_id'] for value in result['blocks'][0]['items']]==[item['item_id']]
    assert result['blocks'][0]['images']==[] and result['blocks'][0]['transcript']==[]
    assert result['blocks'][0]['items'][0]['explanation']['evidence']
    contaminated=deepcopy(lesson)
    contaminated['metadata']['source_study'][block['block_id']]['items'].append({'item_id':day['items'][1]['item_id']})
    with pytest.raises(HTTPException) as error:service.study_response(contaminated,[block['block_id']],lambda _: 'signed')
    assert error.value.status_code==503


class AssetQuery:
    def __init__(self,rows):self.rows=rows
    def select(self,*a):return self
    def eq(self,key,value):self.rows=[row for row in self.rows if row.get(key)==value];return self
    def limit(self,n):self.rows=self.rows[:n];return self
    def execute(self):return SimpleNamespace(data=self.rows)


class AssetDB:
    def __init__(self,plan):
        self.package=plan.package|{'id':'package'}
        self.tables={'listening_content_packages':[self.package],
            'listening_lessons':[lesson|{'id':str(i),'package_id':'package'} for i,lesson in enumerate(plan.lessons)],
            'listening_tests':[form|{'id':str(i),'content_package_id':'package','programme_id':SOURCE_PROGRAMME,
                'source_item_count':form['item_count'],'full_audio_storage_path':form['audio_storage_path']} for i,form in enumerate(plan.forms)],
            'listening_package_stimuli':[row|{'package_id':'package'} for row in plan.stimuli]}
        self.bytes={asset['storage_path']:Path(asset['local_path']).read_bytes() for asset in plan.assets}
        self.storage=SimpleNamespace(from_=lambda _:SimpleNamespace(download=lambda path:self.bytes[path]))
    def table(self,name):return AssetQuery(deepcopy(self.tables[name]))


def test_publication_attests_all_private_runtime_bytes_and_database_projection(release):
    plan=importer.build_source_import_plan(release);db=AssetDB(plan)
    kwargs={'package_id':plan.package['package_id'],'manifest_sha256':plan.package['manifest_sha256'],'bucket_name':'private'}
    assert service.verify_source_package_assets(db,**kwargs)==len(plan.assets)
    path=plan.assets[0]['storage_path'];original=db.bytes[path];db.bytes[path]=b'conflicting bytes'
    with pytest.raises(PackageValidationError,match='attestation mismatch'):service.verify_source_package_assets(db,**kwargs)
    db.bytes[path]=original;db.tables['listening_tests'][0]['full_audio_storage_path']='unattested/private.wav'
    with pytest.raises(PackageValidationError,match='attested audio'):service.verify_source_package_assets(db,**kwargs)


def test_collection_routes_authorize_before_loading_or_signing(monkeypatch):
    from fastapi import FastAPI
    import httpx
    from routers import listening_source_collection as router
    app=FastAPI();app.include_router(router.router)
    async def denied(_):raise HTTPException(401,'signed-in required')
    monkeypatch.setattr(router,'get_supabase_user',denied)
    monkeypatch.setattr(router,'_context',lambda *_:pytest.fail('unauthorized DB read'))
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
            for route in ['/api/listening/source-collections/80-days','/api/listening/source-collections/80-days/days/1']:
                assert (await client.get(route)).status_code==401
            assert (await client.post('/api/listening/source-collections/80-days/days/1/study',json={'block_ids':['one']})).status_code==401
    asyncio.run(run())


def test_conflicting_key_explanation_and_missing_runtime_evidence_fail_closed(release):
    path=release/'days/day-01.json';day=json.loads(path.read_text());day['items'][0]['answer_provenance']['editorial_answer']='B'
    _certify(day['items'][0])
    _dump(path,day);_bind(release)
    with pytest.raises(PackageValidationError,match='key and explanation disagree'):importer.build_source_import_plan(release)
    day['items'][0]['answer_provenance']['editorial_answer']='A';_certify(day['items'][0]);_dump(path,day);_bind(release)
    payload=importer.build_source_import_plan(release).forms[0]['exercise_payload']
    payload['solutions']['1']['explanation']['evidence']=[]
    report=grader.grade_report_only_attempt([{'q_num':1,'user_answer':'A'}],[{'payload':payload}],source_required=True)
    assert report['per_question'][0]['state']=='technical_error'


def test_original_printed_key_is_separate_from_editorial_reference(release):
    path=release/'days/day-01.json';day=json.loads(path.read_text());item=day['items'][0]
    item['answer_provenance']['printed_key']={'answer':'B','source_pdf_page':399,'evidence_tier':'PRINTED','hidden_audit':'SECRET'}
    _certify(item)
    _dump(path,day);_bind(release);payload=importer.build_source_import_plan(release).forms[0]['exercise_payload']
    feedback=build_guided_feedback(1,'A',[{'payload':payload}],'allowed',source_required=True)
    assert feedback['expected']==['A'] and feedback['explanation']['printed_key']['answer']=='B'
    assert feedback['explanation']['printed_key']['source_pdf_page']==399
    assert 'SECRET' not in str(feedback)


@pytest.mark.parametrize('tier,provenance', [
    ('PRINTED_EMBEDDED_KEY', 'printed_key_verified'),
    ('EXPLANATION_DERIVED', 'explanation_derived_verified'),
    ('UNRECOGNISED_TIER', 'editorial_verified'),
])
def test_teaching_key_tier_and_all_source_citations_survive_protected_feedback(release,tier,provenance):
    path=release/'days/day-01.json';day=json.loads(path.read_text());item=day['items'][0]
    citations=[{'pdf_page':143,'line_index_1_based':27,'text':'source authoring text','arbitrary_answer':'SECRET'},
               {'pdf_page':144,'line_index_1_based':5,'bbox':['SECRET']}]
    item['answer_provenance']['printed_key']={'answer':'A','evidence_tier':tier,'source_lines':citations}
    _certify(item);_dump(path,day);_bind(release)
    payload=importer.build_source_import_plan(release).forms[0]['exercise_payload']
    safe=grader.strip_answer_keys([{'payload':payload}])[0]['payload']
    assert 'source_lines' not in str(safe) and 'printed_key' not in str(safe)
    feedback=build_guided_feedback(1,'A',[{'payload':payload}],'allowed',source_required=True)
    assert feedback['answer_provenance']==provenance
    key=feedback['explanation']['printed_key']
    assert key['evidence_tier']==tier
    assert key['source_lines']==[{'pdf_page':143,'line_index_1_based':27},{'pdf_page':144,'line_index_1_based':5}]
    assert 'SECRET' not in str(key) and 'source authoring text' not in str(key)


ROUND1 = Path(__file__).parent / 'fixtures/listening_source_round1'


def _real_excerpts():
    return json.loads((ROUND1/'authored-excerpts.json').read_text())


def _review_fixture(item):
    item['independent_review'] = {'status':'ACCEPTED','verdict':'CONFIRMED',
        'reviewer':'fixture-semantic-review', 'confidence':'high',
        'instruction_checked':True, 'alternatives_checked':True}


@pytest.mark.parametrize('opt_out', ['real_authored', 'safe_false', 'display_self', 'no_decision', 'eligible'])
def test_real_pilot_opt_out_and_separate_objective_eligibility_end_to_end(release, opt_out, monkeypatch):
    path=release/'days/day-01.json';day=json.loads(path.read_text())
    item=deepcopy(_real_excerpts()['day01_item']);_review_fixture(item)
    if opt_out != 'real_authored':
        _certify(item)
    if opt_out == 'safe_false': item['safe_for_grading']=False
    if opt_out == 'display_self': item['display_mode']='self_review'
    if opt_out == 'no_decision': del item['objective_eligibility']
    day['items'][0]=item;_dump(path,day);_bind(release)
    payload=importer.build_source_import_plan(release).forms[0]['exercise_payload'];rows=[{'payload':payload}]
    report=grader.grade_report_only_attempt([{'q_num':1,'user_answer':'C'}],rows,source_required=True)
    feedback=build_guided_feedback(1,'C',rows,'allowed',source_required=True)
    expected=True if opt_out == 'eligible' else None
    assert report['per_question'][0]['correct'] is expected and feedback['correct'] is expected
    assert feedback['explanation']['paraphrase_vi']==''
    assert 'explanation' not in grader.strip_answer_keys(rows)[0]['payload']['questions'][0]
    # Submitted retry uses the same canonical report without acquisition/write.
    from routers import listening as router
    async def auth(_):return {'id':'owner'}
    monkeypatch.setattr(router,'_require_auth',auth)
    monkeypatch.setattr(router,'_fetch_attempt_or_404',lambda *_:{'id':'submitted','test_id':'form',
        'status':'submitted','scoring_policy':'report_only','answers':[{'q_num':1,'user_answer':'C'}]})
    monkeypatch.setattr(router,'bind_owned_attempt',lambda *_:None)
    monkeypatch.setattr(router,'_practice_exercise_payloads',lambda _:rows)
    monkeypatch.setattr(router,'_source_required_for_test',lambda _:True)
    result=asyncio.run(router.submit_listening_test_attempt('submitted',authorization='token'))
    assert result['per_question'][0]['correct'] is expected and result['status']=='submitted'


def test_objective_certificate_stale_or_missing_in_payload_fails_closed(release):
    path=release/'days/day-01.json';day=json.loads(path.read_text())
    day['items'][0]['response']['prompt']='Changed after eligibility review';_dump(path,day);_bind(release)
    with pytest.raises(PackageValidationError,match='eligibility'):importer.build_source_import_plan(release)
    _certify(day['items'][0]);_dump(path,day);_bind(release)
    payload=importer.build_source_import_plan(release).forms[0]['exercise_payload']
    del payload['solutions']['1']['objective_eligibility']
    assert grader.grade_report_only_attempt([{'q_num':1,'user_answer':'A'}],[{'payload':payload}],source_required=True)['per_question'][0]['state']=='technical_error'


@pytest.mark.parametrize('change', [lambda e:e.update(why_vi=None), lambda e:e.update(evidence=[])])
def test_optional_null_normalization_never_weakens_required_evidence(change):
    item=deepcopy(_real_excerpts()['day01_item']);_review_fixture(item);change(item['explanation_vi'])
    with pytest.raises(PackageValidationError):importer._review(item)


def _original_image_binding(release, page):
    import shutil
    relative=f'page-images/pdf-page-{page:03}.jpg';target=release/relative
    target.parent.mkdir(exist_ok=True);shutil.copyfile(ROUND1/target.name,target)
    manifest=json.loads((release/'manifest.json').read_text())
    manifest['source_bindings'].append({'kind':'image','path':relative,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
    _dump(release/'manifest.json',manifest)


def test_real_day04_all_parts_and_scan_restored_null_index_survive(release):
    path=release/'days/day-04.json';day=json.loads(path.read_text())
    companion=deepcopy(_real_excerpts()['day04_companion'])
    # Use the real full paragraph topology; fixture PDF bytes get a separate binding.
    companion['source_pdf_sha256']=day['source_pdf_sha256']
    old=deepcopy(day['parts'][0]);old_block=deepcopy(day['blocks'][0]);day['parts']=[];day['blocks']=[]
    for number in range(1,4):
        part_id=f"80-days:day-04:part-{number}"
        nums=list(range((number-1)*8+1,number*8+1));block_id=part_id+':block-1'
        selected=[item for item in day['items'] if item['source_question_number'] in nums]
        for item in selected:item.update(part_id=part_id,block_id=block_id)
        day['parts'].append(old|{'part_id':part_id,'source_label':f'Part {number}', 'question_numbers':nums})
        day['blocks'].append(old_block|{'part_id':part_id,'block_id':block_id,'question_numbers':nums,'item_ids':[item['item_id'] for item in selected]})
    for row in companion['paragraphs']:row['source_pdf_sha256']=day['source_pdf_sha256']
    _original_image_binding(release,252)
    transcript_path=release/day['transcript']['asset_path'];_dump(transcript_path,companion)
    day['transcript'].update(paragraphs=companion['paragraphs'],sha256=hashlib.sha256(transcript_path.read_bytes()).hexdigest())
    _dump(path,day);_bind(release)
    plan=importer.build_source_import_plan(release)
    lesson=next(x for x in plan.lessons if x['sequence_num']==4)
    form=next(x for x in plan.forms if x['source_form_id']=='80-days:day-04:part-3:practice')
    playable=next(iter(form['exercise_payload']['controlled_transcripts'].values()))
    restored=next(x for x in companion['paragraphs'] if x['line_index_1_based'] is None)
    evidence=importer._paragraph_evidence(restored,json.loads((release/'manifest.json').read_text())['source_bindings'],day['source_pdf_sha256'])
    safe=service.safe_source_transcript([evidence])[0]
    assert safe['line_index_1_based'] is None and safe['source_image_sha256']==restored['source_image_sha256']
    assert safe['source_region']==restored['source_region'] and safe['line_index_unavailable_reason']
    projected=next(row for row in playable if row['line_index_1_based'] is None)
    assert projected['quote']==restored['text'] and projected['source_region']==restored['source_region']
    assert 'Pancho' not in str(grader.strip_answer_keys([{'payload':form['exercise_payload']}]))
    assert sum(len(next(iter(row['exercise_payload']['controlled_transcripts'].values()))) for row in plan.forms if row['source_lesson_id']=='80-days:day-04')==len(companion['paragraphs'])
    # Honest null requires a reviewed bound visual source; no manufactured OCR index.
    del restored['line_index_unavailable_reason']
    _dump(transcript_path,companion);day['transcript'].update(paragraphs=companion['paragraphs'],sha256=hashlib.sha256(transcript_path.read_bytes()).hexdigest())
    _dump(path,day);_bind(release)
    with pytest.raises(PackageValidationError,match='Null OCR'):importer.build_source_import_plan(release)


def test_real_day02_supplement_is_private_zero_item_study_and_requires_review(release):
    import shutil
    path=release/'days/day-02.json';day=json.loads(path.read_text())
    resource=deepcopy(_real_excerpts()['day02_supplement'])
    resource['review']={'status':'ACCEPTED','reviewer':'fixture-resource-review'}
    image=resource['source_assets'][0];image['visual_acceptance']['independent_review_status']='ACCEPTED'
    asset_path='assets/day-02-supplemental-story.png';(release/'assets').mkdir(exist_ok=True)
    shutil.copyfile(ROUND1/'day-02-supplemental-story.png',release/asset_path);image['asset_path']=asset_path
    _original_image_binding(release,16)
    day['supplemental_resources']=[resource];_dump(path,day);_bind(release)
    plan=importer.build_source_import_plan(release);lesson=next(x for x in plan.lessons if x['sequence_num']==2)
    before=service.day_response(plan.package,lesson|{'id':'lesson'},[],{},lambda _:pytest.fail('protected resource signed on GET'),False)
    assert resource['editorial_summary_vi'] not in str(before)
    signed=[];response=service.study_response(lesson,[resource['resource_id']],lambda path:signed.append(path) or 'private-signed')
    block=response['blocks'][0]
    assert block['description']==resource['editorial_summary_vi'] and block['items']==[] and signed==[] and block['images']==[]
    assert response['independent_practice'] is False
    assert sum(x['item_count'] for x in plan.forms if x['source_lesson_id']=='80-days:day-02')==24
    image['visual_acceptance']['independent_review_status']='PENDING';_dump(path,day);_bind(release)
    with pytest.raises(PackageValidationError,match='crop'):importer.build_source_import_plan(release)


def test_multi_image_vocabulary_solved_story_and_not_expected_audio(release):
    path=release/'days/day-61.json';fixture=json.loads(path.read_text())
    _original_image_binding(release,16);_original_image_binding(release,252)
    sources=[]
    for n in (16,252):
        image_path=f'page-images/pdf-page-{n:03}.jpg';sha=hashlib.sha256((release/image_path).read_bytes()).hexdigest()
        sources.append({'derived_path':image_path,'asset_path':image_path,'derived_sha256':sha,
            'source_pdf_page':n+1,'source_image_path':image_path,'source_image_sha256':sha,
            'visual_review':{'independent_review':'ACCEPTED'}})
    raw={'schema':'listening-source-vocabulary-day/1.0','day':61,'title_vi':'Từ vựng',
        'source_pdf_sha256':fixture['source_pdf_sha256'],'review':{'status':'ACCEPTED','reviewer':'fixture'},
        'source':sources[0],'source_assets':sources,'groups':[{'title_vi':'Trường học','terms':[{'source_term':'course'}]}],
        'study_resources':[{'resource_id':'80-days:day-61:solved-story','kind':'solved_story','title_vi':'Câu chuyện đã giải',
            'instruction_vi':'Đây là nội dung tự học đã giải trong sách.', 'editorial_note_vi':'Không tính điểm.',
            'source_assets':[sources[1]], 'paragraphs':[{'text':'Nguồn đã giải.', 'source_ref':{'pdf_page':253,'line_index_1_based':1}}],
            'review':{'status':'ACCEPTED','reviewer':'fixture'}}]}
    _dump(path,raw);_bind(release);plan=importer.build_source_import_plan(release)
    lesson=next(x for x in plan.lessons if x['sequence_num']==61)|{'id':'vocab'}
    response=service.day_response(plan.package,lesson,[],{},lambda _: 'signed',False)
    assert response['availability']['audio']=='not_expected' and response['availability']['printed_key']=='not_expected'
    assert len(lesson['metadata']['source_book']['blocks'][0]['images'])==2  # archival evidence retained
    assert response['blocks'][0]['images']==[] and response['practice_item_count']==0
    study=service.study_response(lesson,['80-days:day-61:solved-story'],lambda _: 'signed')
    assert study['blocks'][0]['images']==[] and study['blocks'][0]['transcript'][0]['quote']=='Nguồn đã giải.'
    assert study['blocks'][0]['items']==[] and 'Không tính điểm' in study['blocks'][0]['description']
    raw['source_assets'][1]['visual_review']['independent_review']='PENDING';_dump(path,raw);_bind(release)
    with pytest.raises(PackageValidationError,match='crop'):importer.build_source_import_plan(release)


def test_completed_source_form_links_exact_result_active_retake_resumes(release):
    plan=importer.build_source_import_plan(release);lesson=plan.lessons[0]|{'id':'lesson'}
    form=plan.forms[0]|{'id':'form','listening_lesson_id':'lesson','source_item_count':24}
    completed={'id':'saved-submission','assisted':False}
    result=service.day_response(plan.package,lesson,[form],{'form':{'completed':completed}},lambda _: 'signed',False)
    assert result['parts'][0]['form']['href']=='/listening/programmes/result/saved-submission'
    result=service.day_response(plan.package,lesson,[form],{'form':{'completed':completed,'in_progress':{'id':'retake'}}},lambda _: 'signed',False)
    assert result['parts'][0]['form']['status']=='in_progress' and result['parts'][0]['form']['attempt_id']=='retake'
    assert result['parts'][0]['form']['href']=='/listening/programmes/form/form'


@pytest.mark.parametrize('field', ['source_image_sha256','source_region','source_pdf_sha256','line_index_unavailable_reason','line_index_1_based'])
def test_restored_null_row_rejects_each_missing_visual_provenance_field(field):
    row=deepcopy(next(x for x in _real_excerpts()['day04_companion']['paragraphs'] if x['line_index_1_based'] is None))
    bindings=[{'kind':'image','path':row['source_image_path'],'sha256':row['source_image_sha256']}]
    pdf=row['source_pdf_sha256'];del row[field]
    with pytest.raises(PackageValidationError,match='Null OCR'):importer._paragraph_evidence(row,bindings,pdf)


def test_zero_item_study_cannot_be_forged_for_practice_block(release):
    plan=importer.build_source_import_plan(release);lesson=plan.lessons[0]
    block=lesson['metadata']['source_book']['blocks'][0];block['study_available']=True
    lesson['metadata']['source_study'][block['block_id']]={'resource_only':True,'items':[],'description':'SECRET'}
    with pytest.raises(HTTPException) as error:service.study_response(lesson,[block['block_id']],lambda _:pytest.fail('must reject before signing'))
    assert error.value.status_code==503
