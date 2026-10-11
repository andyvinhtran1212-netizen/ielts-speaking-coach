"""Public timing-free clip projection; immutable original bindings stay private."""
from functools import lru_cache
import json
from pathlib import Path
from fastapi import HTTPException
from models.listening_source_audio import SourceQuestionClip

CONTENT = Path(__file__).resolve().parents[1] / 'content/listening/80-days-original-clips-v1.json'

@lru_cache(maxsize=1)
def clip_catalog():
    content = json.loads(CONTENT.read_text(encoding='utf-8'))
    if content.get('schema') != '80-days-original-clips/1' or len({row['item_id'] for row in content['clips']}) != len(content['clips']):
        raise ValueError('Invalid original clip inventory')
    return content


def question_clips(package: dict, day: int, original: dict | None, signer) -> list[dict]:
    content = clip_catalog()
    if (package['package_id'],package['manifest_sha256']) != (content['package_id'],content['manifest_sha256']):
        raise HTTPException(409,'Đoạn nghe chưa khớp phiên bản bài học.')
    rows=[row for row in content['clips'] if row['day']==day]
    if not original:
        if rows: raise HTTPException(503,'Đoạn nghe không có bản ghi gốc phù hợp.')
        return []
    signed={}
    result=[]
    for row in rows:
        expected=f"source-collections/{package['package_id']}/{package['manifest_sha256']}/clips/original-v1/{row['sha256']}.mp3"
        if (row['source_sha256'] != original['sha256'] or row['storage_path'] != expected
                or not 0 <= row['start'] < row['end'] <= original['duration_seconds'] + .05
                or not row['item_id'].startswith(f'80-days:day-{day:02d}:') or not row['part_id'].startswith(f'80-days:day-{day:02d}:')):
            raise HTTPException(503,'Đoạn nghe chưa được gắn đúng bản ghi gốc.')
        if expected not in signed:signed[expected]=signer(expected)
        result.append(SourceQuestionClip.model_validate({key:row[key] for key in ('item_id','part_id','duration_seconds','context_kind','note_vi')} | {'url':signed[expected]}).model_dump())
    return result
