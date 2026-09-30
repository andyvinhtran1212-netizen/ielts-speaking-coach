import assert from 'node:assert/strict';
import test from 'node:test';
import { listeningLessonHref, listeningProgrammeFormHref, listeningProgrammeLessonHref, listeningProgrammeResultHref, listeningProgrammeReturnHref } from '../lib/listening-library-context.mjs';

for (const [id, path] of [['general-listening-practice', 'general'], ['ielts-listening-practice', 'ielts']]) {
  for (const filter of ['new', 'in_progress', 'completed']) test(`${path}/${filter}: canonical context survives lesson, form, result and library`, () => {
    const lesson = new URL(listeningLessonHref(path, 'lesson 1', { filter }), 'https://local.test');
    const form = new URL(listeningProgrammeFormHref(id, 'form/1', lesson.searchParams), lesson);
    const result = new URL(listeningProgrammeResultHref(id, 'attempt/1', form.searchParams), form);
    assert.equal(form.pathname, '/listening/programmes/form/form%2F1');
    assert.equal(result.pathname, '/listening/programmes/result/attempt%2F1');
    assert.equal(listeningProgrammeLessonHref(id, 'lesson 1', form.searchParams), lesson.pathname + lesson.search);
    assert.equal(listeningProgrammeReturnHref(id, result.searchParams), `/listening/${path}?filter=${filter}`);
    assert.deepEqual([...result.searchParams], [['from', path], ['filter', filter]]);
  });

  for (const raw of ['', 'from=other&filter=new', `from=${path}&from=${path}&filter=new`, 'from=https://evil.test&filter=completed']) test(`${path} rejects unowned context ${raw}`, () => {
    const params = new URLSearchParams(`${raw}&return_to=https://evil.test&lesson_id=evil`);
    assert.equal(listeningProgrammeReturnHref(id, params), `/listening/${path}`);
    assert.equal(listeningProgrammeFormHref(id, 'form-1', params), '/listening/programmes/form/form-1');
    assert.equal(listeningProgrammeResultHref(id, 'attempt-1', params), '/listening/programmes/result/attempt-1');
    assert.equal(listeningProgrammeLessonHref(id, 'canonical-lesson', params), `/listening/${path}/canonical-lesson`);
  });

  for (const filter of ['filter=new&filter=completed', 'filter=new&filter=new', 'filter=https://evil.test', 'filter=']) test(`${path} rejects invalid/duplicate filters ${filter}`, () => {
    const params = new URLSearchParams(`from=${path}&${filter}&return_to=//evil.test`);
    assert.equal(listeningProgrammeReturnHref(id, params), `/listening/${path}`);
    assert.equal(listeningProgrammeResultHref(id, 'attempt-1', params), `/listening/programmes/result/attempt-1?from=${path}`);
  });
}

test('API programme identity wins over cross-programme query and unknown programme has a fixed safe return', () => {
  const raw = new URLSearchParams('from=general&filter=completed&return_to=https://evil.test');
  assert.equal(listeningProgrammeReturnHref('ielts-listening-practice', raw), '/listening/ielts');
  assert.equal(listeningProgrammeLessonHref('ielts-listening-practice', 'canonical-lesson', raw), '/listening/ielts/canonical-lesson');
  assert.equal(listeningProgrammeReturnHref('future-programme', raw), '/listening');
  assert.equal(listeningProgrammeLessonHref('future-programme', 'lesson-1', raw), '/listening');
  assert.equal(listeningProgrammeLessonHref('general-listening-practice', '', raw), '/listening');
  assert.equal(listeningProgrammeResultHref('future-programme', 'attempt?next=//evil.test', raw), '/listening/programmes/result/attempt%3Fnext%3D%2F%2Fevil.test');
});
