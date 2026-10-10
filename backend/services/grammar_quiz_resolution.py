"""Select one current published Grammar bank without rewriting history IDs."""
from __future__ import annotations

import re
from fastapi import HTTPException
from services.grammar_quiz_revision_source import REVIEWED_SOURCES, REVIEWED_BINDINGS, FOLLOWUP_CODE


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
        if code not in REVIEWED_SOURCES or len(managed) != len(banks) or len(banks) not in (2,3) or len(banks)==3 and code!=FOLLOWUP_CODE:
            raise _unavailable()
        roots=[row for row in managed if row.get('code')==code and row.get('grammar_predecessor_bank_id') is None]
        currents=[row for row in managed if row.get('grammar_is_current') is True]
        if len(roots)!=1 or len(currents)!=1: raise _unavailable()
        chain=[roots[0]]
        for _ in range(len(banks)-1):
            children=[row for row in managed if row.get('grammar_predecessor_bank_id')==chain[-1].get('id')]
            if len(children)!=1: raise _unavailable()
            child=children[0]
            if child.get('code') not in {code+'~'+raw[:16] for raw in REVIEWED_BINDINGS[code]['bindings']}:
                raise _unavailable()
            chain.append(child)
        current,original=chain[-1],chain[0]
        if (current.get('id')!=currents[0].get('id') or not original.get('topic_id')
                or any(row.get('topic_id')!=original.get('topic_id') for row in chain)
                or any(row.get('grammar_is_current') is not False for row in chain[:-1])
                or any(type(row.get('grammar_new_starts_enabled')) is not bool for row in managed)
                or any(not isinstance(row.get('grammar_revision'),str)
                    or not re.fullmatch(r'[0-9a-f]{64}',row['grammar_revision']) for row in managed)
                or len(chain)==3 and (chain[1].get('code')==code+'~'+REVIEWED_SOURCES[code][0][:16]
                    or current.get('code')!=code+'~'+REVIEWED_SOURCES[code][0][:16])):
            raise _unavailable()
        # Only availability identity is remapped. The physical bank/session
        # code and the original question IDs are never rewritten in storage.
        selected.append({**current,'code':code})
    return sorted(selected,key=lambda row:row['code'])
