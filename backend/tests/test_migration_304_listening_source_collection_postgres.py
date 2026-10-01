"""Run source namespace/timing/reveal contracts on disposable PostgreSQL only."""
from copy import deepcopy
import json
from pathlib import Path
from uuid import uuid4
import pytest
from test_migration_295_listening_content_programmes_postgres import programme_probe, _literal
from test_migration_240_core_attempt_evidence import psql

BASE=Path(__file__).resolve().parents[1]/'migrations'

def _args(values):
    return ','.join(_literal(json.dumps(value))+'::JSONB' for value in values)

@pytest.fixture(scope='module')
def source_probe(programme_probe):
    schema=programme_probe['schema']
    for filename in ['296_listening_programme_feedback_reveals.sql','304_listening_80_days_source_collection.sql']:
        sql=(BASE/filename).read_text().replace('public.',schema+'.').replace('search_path = public,','search_path = '+schema+',').replace('search_path=public,','search_path='+schema+',')
        psql(sql)
    package=deepcopy(programme_probe['package'])
    package.update(package_id='fixture-source-v1',programme_id='ielts-80-days-listening',manifest_sha256='e'*64)
    package['source_counts'].update(lessons=2,timing_segments=0)
    lessons=deepcopy(programme_probe['lessons'])+[{'source_lesson_id':'resource-day','title':'Vocabulary resource','sequence_num':2}]
    stimuli=deepcopy(programme_probe['stimuli'])
    stimuli[0].update(source_timing_path=None,source_timing_sha256=None,controlled_transcript_path='source-collections/source/transcript.json',metadata={'timing_segment_count':0})
    forms=deepcopy(programme_probe['forms'])
    forms[0].update(test_id='source-form-fixture',exercise_payload={'variant':'programme_form_v1','source_contract':'source_book_v1','questions':[{'q_num':1}]})
    args=_args([package,lessons,stimuli,forms])
    assert psql(f'SELECT action FROM {schema}.import_listening_content_package_atomic({args})')=='created'
    yield programme_probe|{'source_package':package,'source_lessons':lessons,'source_stimuli':stimuli,'source_forms':forms,'source_args':args}


def test_source_optional_timing_idempotency_and_zero_form_lesson(source_probe):
    schema=source_probe['schema']
    assert psql(f"SELECT action FROM {schema}.import_listening_content_package_atomic({source_probe['source_args']})")=='reused'
    assert psql(f"SELECT count(*) FROM {schema}.listening_lessons WHERE source_lesson_id='resource-day'")=='1'
    assert psql(f"SELECT count(*) FROM {schema}.listening_tests WHERE source_lesson_id='resource-day'")== '0'
    assert psql(f"SELECT (source_timing_path IS NULL AND source_timing_sha256 IS NULL AND controlled_transcript_sha256 IS NOT NULL)::TEXT FROM {schema}.listening_package_stimuli s JOIN {schema}.listening_content_packages p ON p.id=s.package_id WHERE p.package_id='fixture-source-v1'")=='true'


def test_generic_provenance_semantics_preserved_and_incomplete_source_rolls_back(source_probe):
    schema=source_probe['schema']
    # Original generic contract permits absent controlled_path but requires its hash.
    package=deepcopy(source_probe['package']);package.update(package_id='fixture-generic-after304',manifest_sha256='f'*64)
    forms=deepcopy(source_probe['forms']);forms[0]['test_id']='generic-after304'
    assert psql(f"SELECT action FROM {schema}.import_listening_content_package_atomic({_args([package,source_probe['lessons'],source_probe['stimuli'],forms])})")=='created'
    bad=deepcopy(source_probe['source_package']);bad.update(package_id='fixture-source-invalid',manifest_sha256='9'*64)
    bad_stimuli=deepcopy(source_probe['source_stimuli']);bad_stimuli[0]['source_timing_sha256']='c'*64
    with pytest.raises(RuntimeError,match='listening_source_provenance_pair_mismatch'):
        psql(f"SELECT action FROM {schema}.import_listening_content_package_atomic({_args([bad,source_probe['source_lessons'],bad_stimuli,source_probe['source_forms']])})")
    assert psql(f"SELECT count(*) FROM {schema}.listening_content_packages WHERE package_id='fixture-source-invalid'")=='0'
    bad.update(package_id='fixture-source-no-transcript')
    bad_stimuli=deepcopy(source_probe['source_stimuli']);bad_stimuli[0]['controlled_transcript_path']=None
    with pytest.raises(RuntimeError,match='listening_source_provenance_pair_mismatch'):
        psql(f"SELECT action FROM {schema}.import_listening_content_package_atomic({_args([bad,source_probe['source_lessons'],bad_stimuli,source_probe['source_forms']])})")


def test_namespace_publication_reveal_owner_lock_and_archive_preserve_attempt(source_probe):
    schema=source_probe['schema']
    for package,sha in [('fixture-general-v1','a'*64),('fixture-source-v1','e'*64)]:
        assert psql(f"SELECT status FROM {schema}.set_listening_content_package_status('{package}','{sha}','publish',NULL)")=='published'
    owner,other,attempt=[str(uuid4()) for _ in range(3)]
    psql(f"INSERT INTO {schema}.users(id) VALUES ('{owner}'),('{other}'); INSERT INTO {schema}.listening_test_attempts(id,test_id,user_id,status,answers,scoring_policy) SELECT '{attempt}',id,'{owner}','in_progress','[{{\"q_num\":1,\"user_answer\":\"A\"}}]'::JSONB,'report_only' FROM {schema}.listening_tests WHERE test_id='source-form-fixture'")
    with pytest.raises(RuntimeError,match='feedback_not_available'):
        psql(f"SELECT first_answer FROM {schema}.fn_record_listening_programme_feedback_reveal('{attempt}','{other}',1)")
    assert psql(f"SELECT first_answer FROM {schema}.fn_record_listening_programme_feedback_reveal('{attempt}','{owner}',1)")=='A'
    psql(f"UPDATE {schema}.listening_test_attempts SET answers='[{{\"q_num\":1,\"user_answer\":\"B\"}}]'::JSONB WHERE id='{attempt}'")
    assert psql(f"SELECT first_answer FROM {schema}.fn_record_listening_programme_feedback_reveal('{attempt}','{owner}',1)")=='A'
    with pytest.raises(RuntimeError,match='reveal_immutable'):
        psql(f"UPDATE {schema}.listening_programme_feedback_reveals SET first_answer='B' WHERE attempt_id='{attempt}'")
    assert psql(f"SELECT status FROM {schema}.set_listening_content_package_status('fixture-source-v1','{'e'*64}','archive',NULL)")=='archived'
    assert psql(f"SELECT count(*) FROM {schema}.listening_test_attempts WHERE id='{attempt}'")=='1'
    assert psql(f"SELECT first_answer FROM {schema}.listening_programme_feedback_reveals WHERE attempt_id='{attempt}'")=='A'
