"""Unscored source questions, bound to the already reviewed native presentation."""
from functools import lru_cache
import json
from pathlib import Path
from fastapi import HTTPException
from models.listening_source_collection import SourceSupplementalQuestion

CONTENT = Path(__file__).resolve().parents[1] / 'content/listening/80-days-supplements-v1.json'

@lru_cache(maxsize=1)
def catalog():
    data = json.loads(CONTENT.read_text(encoding='utf-8'))
    if data.get('schema') != '80-days-supplements/1' or [row['day'] for row in data['days']] != list(range(1,81)):
        raise ValueError('Invalid supplemental source inventory')
    return data


def supplemental_questions(manifest: str, day: int, blocks: list[dict], positions: list[dict]) -> tuple[list[dict], int | None]:
    content = catalog()
    if manifest != content['source_manifest_sha256']:
        return [], None
    rows = [row for row in content['questions'] if row['day'] == day]
    limitations = {row['item_id']: row for row in positions}
    if {row['item_id'] for row in rows} != set(limitations):
        raise HTTPException(503, 'Danh sách câu bổ sung chưa khớp phiên bản bài học.')
    native = {block['block_id']: {question['item_id']: question for question in (block.get('native') or {}).get('questions', [])} for block in blocks}
    result=[]
    for row in rows:
        question = native.get(row['block_id'], {}).get(row['item_id'])
        if not question or any(row[key] != limitations[row['item_id']][key] for key in ('part_id','block_id')):
            raise HTTPException(503, 'Chưa có nội dung chữ và hình cho câu bổ sung.')
        result.append(SourceSupplementalQuestion.model_validate({**question, **row, 'reason_vi': limitations[row['item_id']]['reason_vi']}).model_dump())
    return result, content['days'][day-1]['response_field_count']
