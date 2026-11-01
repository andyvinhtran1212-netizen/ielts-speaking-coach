"""PC-J434 on actual PostgreSQL: the bank content version changes on every
replace path, using the real `quiz_replace_questions` (186/309) and
`import_quiz_bank_atomic` (294/309) functions and the 118 update trigger.

The version is read with the same columns the PostgREST embed in
`get_bank_for_play` returns, and folded by `quiz_service._content_version`.
Gated like the other Grammar revision tests (explicit loopback database).
"""
from __future__ import annotations

import pytest

from services import quiz_service
from test_grammar_quiz_revision_boundary import CODE, encoded, pg  # noqa: F401

# What `qn:quiz_questions(count)` and `qmax:quiz_questions(created_at)` with
# `qmax.order=created_at.desc&qmax.limit=1` select.
_VERSION_SQL = '''SELECT b.updated_at, b.grammar_new_starts_enabled,
  (SELECT count(*) FROM quiz_questions q WHERE q.bank_id=b.id) AS n,
  (SELECT q.created_at FROM quiz_questions q WHERE q.bank_id=b.id
     ORDER BY q.created_at DESC LIMIT 1) AS newest
FROM quiz_banks b WHERE b.id=$1'''


def _rows(*qids):
    return [{'qid': qid, 'item_key': qid, 'type': 'mcq', 'input': 'choice',
             'skill': 'recognition', 'prompt': 'Synthetic ' + qid,
             'options': ['Yes', 'No'], 'answer': 0} for qid in qids]


async def _version(pg, bank):
    r = await pg.c.fetchrow(_VERSION_SQL, bank)
    return quiz_service._content_version({
        'updated_at': r['updated_at'].isoformat(),
        'grammar_new_starts_enabled': r['grammar_new_starts_enabled'],
        'qn': [{'count': r['n']}],
        'qmax': [{'created_at': r['newest'].isoformat()}] if r['newest'] else [],
    })


async def _replace(pg, bank, rows):
    await pg.c.execute('SELECT quiz_replace_questions($1,$2::jsonb)', bank, encoded(rows))


@pytest.mark.asyncio
async def test_i_atomic_reimport_of_identical_content_changes_the_version(pg):
    payload = {'topic_id': str(pg.topic), 'code': 'cache-version-control',
               'skill_area': 'grammar', 'meta': {}, 'title': 'Synthetic import'}
    first = await pg.c.fetchrow('SELECT * FROM import_quiz_bank_atomic($1::jsonb,$2::jsonb,$3)',
                                encoded(payload), encoded(_rows('a', 'b')), 'published')
    v1 = await _version(pg, first['bank_id'])
    again = await pg.c.fetchrow('SELECT * FROM import_quiz_bank_atomic($1::jsonb,$2::jsonb,$3)',
                                encoded(payload), encoded(_rows('a', 'b')), 'preserve')
    assert again['bank_id'] == first['bank_id'] and again['action'] == 'updated'
    v2 = await _version(pg, first['bank_id'])
    assert v1 is not None and v2 != v1
    assert v2[2] == v1[2] == 2              # same count: newest created_at moved
    assert v2[3] != v1[3] and v2[0] != v1[0]


@pytest.mark.asyncio
async def test_ii_course_importer_two_step_write_moves_the_version_twice(pg):
    """`import_course_exercise_bank.py`: UPDATE quiz_banks, then (separate
    request) `quiz_replace_questions`. The second step changes neither
    `updated_at` nor the count, so the newest `created_at` must carry it."""
    v0 = await _version(pg, pg.old)
    await pg.c.execute("UPDATE quiz_banks SET title='Re-imported' WHERE id=$1", pg.old)
    v1 = await _version(pg, pg.old)                 # an open here caches the old rows
    await _replace(pg, pg.old, _rows('recognition', 'production'))
    v2 = await _version(pg, pg.old)
    assert v0 != v1 != v2
    assert v2[0] == v1[0] and v2[2] == v1[2] == 2   # only `created_at` moved
    assert v2[3] != v1[3]


@pytest.mark.asyncio
async def test_iii_deleting_or_adding_one_question_changes_the_version(pg):
    v0 = await _version(pg, pg.old)
    await pg.c.execute("DELETE FROM quiz_questions WHERE bank_id=$1 AND qid='production'", pg.old)
    v1 = await _version(pg, pg.old)
    assert v1 != v0 and v1[2] == 1
    await pg.c.execute('''INSERT INTO quiz_questions(bank_id,qid,item_key,type,input,skill,prompt,options,answer)
      VALUES($1,'added','added','mcq','choice','recognition','Synthetic','["Yes","No"]',0)''', pg.old)
    v2 = await _version(pg, pg.old)
    assert v2 != v1 and v2[2] == 2 and v2[3] != v1[3]


@pytest.mark.asyncio
async def test_iv_pause_starts_keeps_updated_at_but_changes_the_version(pg):
    await pg.enroll()
    v0 = await _version(pg, pg.new)
    async with pg.c.transaction():
        await pg.c.execute("SELECT set_config('aver.grammar_quiz_context',$1,true)",
                           encoded({'action': 'pause_starts', 'code': CODE, 'bank': str(pg.new)}))
        await pg.c.execute('UPDATE quiz_banks SET grammar_new_starts_enabled=false WHERE id=$1', pg.new)
    v1 = await _version(pg, pg.new)
    assert v1[0] == v0[0]                    # the guard preserves updated_at
    assert v0[1] is True and v1[1] is False
    assert v1 != v0


@pytest.mark.asyncio
async def test_in_place_question_update_is_invisible_to_the_version(pg):
    """Why the TTL exists: offline fix scripts UPDATE a row by id. Nothing in
    the version moves, so only `_BANK_CONTENT_TTL_SECONDS` bounds staleness."""
    v0 = await _version(pg, pg.old)
    await pg.c.execute("UPDATE quiz_questions SET explain='Fixed' WHERE bank_id=$1", pg.old)
    assert await _version(pg, pg.old) == v0
