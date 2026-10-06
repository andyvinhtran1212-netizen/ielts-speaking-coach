"""Package all original records only after exact independent full-bank approval.

No database writes. The original library is read-only. This deliberately keeps
the source IDs and complete family/parallel closure, including non-runtime E.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.grammar_lesson_content import PRACTICE_ROOT, load_version
from services.grammar_lesson_full_content import EXPECTED_LESSONS, _sha, load_full_package


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def records(raw: bytes) -> list[dict]:
    return [json.loads(line) for line in raw.decode('utf-8').splitlines() if line.strip()]


def exposure_closure(qmatrix: dict, source_ids: set[str]) -> dict:
    rows=qmatrix.get('items') or []
    index={row['item_id']:row for row in rows}
    if len(index)!=len(rows) or not source_ids.issubset(index):
        raise ValueError('Q-matrix has duplicate or missing original identities')
    families=defaultdict(set);parallel=defaultdict(set)
    for item_id,row in index.items():
        if row.get('stimulus_family'):families[row['stimulus_family']].add(item_id)
        if row.get('parallel_set_id'):parallel[row['parallel_set_id']].add(item_id)
    result={}
    for original in sorted(source_ids):
        seen=set();todo=[original]
        while todo:
            item_id=todo.pop()
            if item_id in seen:continue
            seen.add(item_id);row=index[item_id]
            todo.extend((families[row.get('stimulus_family')] | parallel[row.get('parallel_set_id')])-seen)
        result[original]={
            'item_ids':sorted(seen),
            'stimulus_families':sorted({index[i]['stimulus_family'] for i in seen if index[i].get('stimulus_family')}),
            'parallel_set_ids':sorted({index[i]['parallel_set_id'] for i in seen if index[i].get('parallel_set_id')}),
        }
    return result


def build(source_root: Path, author_roots: list[Path], review_path: Path, qmatrix_path: Path,
          output: Path, *, write: bool=False) -> dict:
    if output.resolve().is_relative_to(source_root.resolve()):
        raise ValueError('Output must not modify the original library')
    review_raw=review_path.read_bytes();review=json.loads(review_raw)
    if (review.get('decision')!='approved' or review.get('reviewer_role')!='senior_content_gate'
            or set(review.get('lessons',{}))!=EXPECTED_LESSONS):
        raise ValueError('All thirty full banks need independent approval before packaging')
    files={};identities={};source_ids=set()
    for lid in sorted(EXPECTED_LESSONS):
        number=lid[-2:];original=source_root/f'Buoi-{number}'/f'KBT-buoi-{number}.jsonl'
        candidates=[root/f'{lid}.jsonl' for root in author_roots if (root/f'{lid}.jsonl').is_file()]
        if len(candidates)!=1:raise ValueError(f'Need exactly one corrected bank: {lid}')
        original_raw=original.read_bytes();corrected_raw=candidates[0].read_bytes()
        source=records(original_raw);corrected=records(corrected_raw);approval=review['lessons'][lid]
        ids=[row['id'] for row in source]
        if ([row['id'] for row in corrected]!=ids or digest(original_raw)!=approval.get('original_file_sha256')
                or digest(corrected_raw)!=approval.get('corrected_file_sha256')):
            raise ValueError(f'Original IDs/order or approved bytes changed: {lid}')
        for old,new in zip(source,corrected):
            if not set(old).issubset(new) or old['dang']!=new['dang'] or old.get('backport_from_tm20')!=new.get('backport_from_tm20'):
                raise ValueError(f'Original structure/provenance dropped: {old["id"]}')
        if len(set(ids))!=len(ids) or source_ids.intersection(ids):raise ValueError('Duplicate original ID')
        source_ids.update(ids);name=f'v3-banks/{lid}.jsonl';files[name]=corrected_raw
        identities[lid]=dict(source_file=name,original_source=str(original.relative_to(source_root)),
                             original_sha256=digest(original_raw),corrected_sha256=digest(corrected_raw),
                             original_ids_sha256=_sha(ids))
    if len(source_ids)!=3100:raise ValueError('Original inventory is not3100')
    qraw=qmatrix_path.read_bytes();qmatrix=json.loads(qraw)
    if len(qmatrix.get('items',[]))!=3338:raise ValueError('Expected complete3338-row q-matrix')
    mapping=dict(schema='master30-source-exposure-v1',qmatrix_sha256=digest(qraw),
                 items=exposure_closure(qmatrix,source_ids))
    files['v3-exposure.json']=(json.dumps(mapping,ensure_ascii=False,sort_keys=True,indent=2)+'\n').encode()
    manifest=dict(version='v3',lessons=identities,
                  exposure_map=dict(file='v3-exposure.json',sha256=digest(files['v3-exposure.json'])))
    files['v3.json']=(json.dumps(manifest,ensure_ascii=False,sort_keys=True,indent=2)+'\n').encode()
    files['v3-review.json']=review_raw
    # Fully validate a candidate before placing any file in the serving tree.
    with tempfile.TemporaryDirectory(prefix='master30-full-validated-') as directory:
        candidate=Path(directory)
        for name,raw in files.items():
            path=candidate/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
        package=load_full_package(candidate,load_version('v2'))
    if write:
        for name,raw in files.items():
            path=output/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
    return dict(lessons=len(package['lessons']),items=len(source_ids),
                manifest_sha256=digest(files['v3.json']),qmatrix_sha256=digest(qraw),written=write)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root',type=Path,required=True)
    parser.add_argument('--author-root',type=Path,action='append',required=True)
    parser.add_argument('--review',type=Path,required=True)
    parser.add_argument('--qmatrix',type=Path,required=True)
    parser.add_argument('--output',type=Path,default=PRACTICE_ROOT)
    parser.add_argument('--write',action='store_true')
    args=parser.parse_args()
    print(json.dumps(build(args.source_root,args.author_root,args.review,args.qmatrix,args.output,write=args.write)))
