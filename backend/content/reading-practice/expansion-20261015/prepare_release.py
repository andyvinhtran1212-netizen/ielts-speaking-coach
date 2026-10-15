"""Prepare only this Reading content release. Offline; never connects to a DB."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import uuid
from pathlib import Path

from compile_local import compile_batch


PASSAGE_COLUMNS = ('id', 'slug', 'title', 'library', 'status', 'body_markdown',
                   'metadata', 'glossary', 'image_url', 'difficulty_level',
                   'topic_tags', 'skill_focus', 'word_count', 'estimated_minutes')
QUESTION_COLUMNS = ('id', 'passage_id', 'q_num', 'question_type', 'prompt',
                    'payload', 'answer', 'explanation', 'skill_tag', 'sub_skill', 'order_num')
EXCLUDED = {'completion-how-a-battery-works', 'inference-psychology-of-colour',
            'matching-movements-in-art', 'the-tragedy-of-the-commons'}


def stage_id(kind: str, source_id: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f'aver-reading-expansion-20261015/{kind}/{source_id}'))


def sql_for(packet: dict, environment: str) -> str:
    payload = json.dumps(packet, ensure_ascii=False, indent=2)
    assert '$packet$' not in payload
    return f'''-- Reading expansion: {environment} ONLY. Requires explicit user release approval.
-- Content transaction, not a schema migration. No learner or Full Test mutation.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
DO $reading$
DECLARE packet jsonb := $packet${payload}$packet$::jsonb;
        patch jsonb; row jsonb; affected integer;
BEGIN
  -- Same lock key as the repository migration runner; held through COMMIT.
  PERFORM pg_advisory_xact_lock(173204, 1);
  FOR patch IN SELECT value FROM jsonb_array_elements(packet->'updates') LOOP
    UPDATE public.reading_passages SET
      metadata = metadata || (patch->'changes'->'metadata'),
      image_url = patch->'changes'->>'image_url'
    WHERE id = (patch->>'passage_id')::uuid AND slug = patch->>'slug'
      AND library = patch->>'library' AND library IN ('l1_vocab','l2_skill')
      AND status = 'published' AND test_id IS NULL
      AND body_markdown = patch->>'source_body_markdown'
      AND metadata = patch->'expected_metadata'
      AND image_url IS NOT DISTINCT FROM (patch->>'expected_image_url');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
      RAISE EXCEPTION 'Reading changed, missing or outside practice: %', patch->>'slug';
    END IF;
  END LOOP;
  FOR row IN SELECT value FROM jsonb_array_elements(packet->'insert_passages') LOOP
    IF row->>'library' NOT IN ('l1_vocab','l2_skill') OR row->>'status' <> 'published' THEN
      RAISE EXCEPTION 'Non-practice staging copy refused';
    END IF;
    IF EXISTS (SELECT 1 FROM public.reading_passages
               WHERE id=(row->>'id')::uuid OR slug=row->>'slug') THEN
      RAISE EXCEPTION 'Staging copy would overwrite content: %', row->>'slug';
    END IF;
    INSERT INTO public.reading_passages(id,slug,title,library,status,body_markdown,
      metadata,glossary,image_url,difficulty_level,topic_tags,skill_focus,word_count,estimated_minutes)
    VALUES((row->>'id')::uuid,row->>'slug',row->>'title',row->>'library','published',
      row->>'body_markdown',row->'metadata',row->'glossary',row->>'image_url',
      row->>'difficulty_level',ARRAY(SELECT jsonb_array_elements_text(row->'topic_tags')),
      row->>'skill_focus',(row->>'word_count')::integer,(row->>'estimated_minutes')::integer);
  END LOOP;
  FOR row IN SELECT value FROM jsonb_array_elements(packet->'insert_questions') LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(packet->'insert_passages') p
                   WHERE p->>'id'=row->>'passage_id') THEN
      RAISE EXCEPTION 'Question outside new staging copies';
    END IF;
    INSERT INTO public.reading_questions(id,passage_id,q_num,question_type,prompt,
      payload,answer,explanation,skill_tag,sub_skill,order_num)
    VALUES((row->>'id')::uuid,(row->>'passage_id')::uuid,(row->>'q_num')::integer,
      row->>'question_type',row->>'prompt',row->'payload',row->'answer',
      row->>'explanation',row->>'skill_tag',row->>'sub_skill',(row->>'order_num')::integer);
  END LOOP;
END $reading$;
COMMIT;
'''


def prepare(snapshots: Path, output: Path) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    rows = compile_batch(snapshots / 'production-passages.json', snapshots / 'draft-content.json')
    production = {p['slug']: p for p in json.loads((snapshots / 'production-passages.json').read_text())}
    staging = {p['slug']: p for p in json.loads((snapshots / 'staging-passages.json').read_text())}
    questions = json.loads((snapshots / 'production-questions.json').read_text())
    stage_questions = json.loads((snapshots / 'staging-questions.json').read_text())
    targets = {r['slug'] for r in rows}
    assert len(rows) == len(targets) == 196
    assert targets == set(production) - EXCLUDED
    assert all(set(r['changes']) == {'metadata', 'image_url'} and
               set(r['changes']['metadata']) == {'translation_vi', 'practice_support'} for r in rows)
    prod_packet = {'updates': rows, 'insert_passages': [], 'insert_questions': []}
    stage_packet = {'updates': [], 'insert_passages': [], 'insert_questions': []}
    for patch in rows:
        slug = patch['slug']
        if slug in staging:
            before = staging[slug]
            assert before['library'] == patch['library'] and before['status'] == 'published'
            assert before['body_markdown'] == patch['source_body_markdown'], slug
            assert before['metadata'] == patch['expected_metadata'], slug
            sq = [{k: q[k] for k in QUESTION_COLUMNS[2:]} for q in stage_questions if q['passage_id'] == before['id']]
            pq = [{k: q[k] for k in QUESTION_COLUMNS[2:]} for q in questions if q['passage_id'] == patch['passage_id']]
            assert sorted(sq, key=lambda q: q['q_num']) == sorted(pq, key=lambda q: q['q_num']), slug
            mapped = copy.deepcopy(patch)
            mapped.update(passage_id=before['id'], expected_metadata=before['metadata'],
                          expected_image_url=before.get('image_url'))
            stage_packet['updates'].append(mapped)
        else:
            original = production[slug]
            new = {k: copy.deepcopy(original[k]) for k in PASSAGE_COLUMNS}
            new['id'] = stage_id('passage', original['id'])
            new['metadata'].update(patch['changes']['metadata'])
            new['image_url'] = patch['changes']['image_url']
            stage_packet['insert_passages'].append(new)
            for question in questions:
                if question['passage_id'] == original['id']:
                    q = {k: copy.deepcopy(question[k]) for k in QUESTION_COLUMNS}
                    q.update(id=stage_id('question', q['id']), passage_id=new['id'])
                    stage_packet['insert_questions'].append(q)
    assert [len(stage_packet[k]) for k in stage_packet] == [19, 177, 1018]
    files = {}
    for environment, packet in [('production', prod_packet), ('staging', stage_packet)]:
        path = output / f'{environment}-apply.sql'
        path.write_text(sql_for(packet, environment))
        files[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest = {'articles': len(rows),
                'sentence_units': sum(len(r['changes']['metadata']['practice_support']['units']) for r in rows),
                'phrase_pairs': sum(len(u['phrases']) for r in rows for u in r['changes']['metadata']['practice_support']['units']),
                'illustrations': len({r['changes']['image_url'] for r in rows}),
                'production': {'updates': 196, 'question_mutations': 0},
                'staging': {'updates': 19, 'new_copies': 177, 'copied_questions': 1018},
                'excluded_already_aligned': sorted(EXCLUDED), 'sql_sha256': files}
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshots', type=Path, required=True)
    parser.add_argument('--out', type=Path, default=Path(__file__).parent / 'release')
    args = parser.parse_args()
    print(json.dumps(prepare(args.snapshots, args.out), ensure_ascii=False, indent=2))
