"""Select one current published Grammar bank without rewriting history IDs."""
from __future__ import annotations

import re
from fastapi import HTTPException
from services.grammar_quiz_revision_source import REVIEWED_SOURCES


def _unavailable():
    return HTTPException(503,'Chưa xác minh được bộ câu hỏi Grammar hiện tại. Hãy thử lại.')


def current_banks(rows: list[dict]) -> list[dict]:
    if not isinstance(rows,list) or any(not isinstance(row,dict) for row in rows):
        raise _unavailable()
    groups={}
    for row in rows:
        code=row.get('grammar_canonical_code') or row.get('code')
        if not isinstance(code,str) or not code:
            raise _unavailable()
        groups.setdefault(code,[]).append(row)
    selected=[]
    for code,banks in groups.items():
        managed=[row for row in banks if row.get('grammar_canonical_code') is not None]
        if not managed:
            if len(banks)!=1: raise _unavailable()
            selected.append(banks[0]); continue
        if code not in REVIEWED_SOURCES or len(managed)!=2 or len(banks)!=2:
            raise _unavailable()
        current=[row for row in managed if row.get('grammar_is_current') is True]
        original=[row for row in managed if row.get('grammar_is_current') is False]
        if len(current)!=1 or len(original)!=1: raise _unavailable()
        current,original=current[0],original[0]
        if (original.get('code')!=code or original.get('grammar_predecessor_bank_id') is not None
                or current.get('code')!=code+'~'+REVIEWED_SOURCES[code][0][:16]
                or current.get('grammar_predecessor_bank_id')!=original.get('id')
                or current.get('topic_id')!=original.get('topic_id') or not original.get('topic_id')
                or any(type(row.get('grammar_new_starts_enabled')) is not bool for row in managed)
                or any(not isinstance(row.get('grammar_revision'),str)
                    or not re.fullmatch(r'[0-9a-f]{64}',row['grammar_revision']) for row in managed)):
            raise _unavailable()
        # Only availability identity is remapped. The physical bank/session
        # code and the original question IDs are never rewritten in storage.
        selected.append({**current,'code':code})
    return sorted(selected,key=lambda row:row['code'])
