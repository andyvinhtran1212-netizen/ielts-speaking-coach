// LIBRARY-0061 T009 (G06-T09): URL ↔ query ↔ API path of the Writing sample list.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  activeChips,
  changeListQuery,
  countText,
  listApiPath,
  listHref,
  loadListState,
  parseListQuery,
  rowNumber,
  totalPages,
} from '../lib/writing-samples-list-model.mjs';

describe('parseListQuery (FR-010)', () => {
  test('a shared link opens in its state', () => {
    const q = parseListQuery({ task: 'task2', dang: 'opinion', q: ' work ', trang: '2' });
    assert.deepEqual({ ...q }, { task: 'task2', dang: 'opinion', chude: null, q: 'work', trang: 2 });
    assert.equal(listApiPath(q), '/api/library/writing-samples?task=task2&dang=opinion&q=work&trang=2');
  });

  test('values the API would reject are dropped, not sent', () => {
    const q = parseListQuery({ task: 'task3', dang: 'problem_solution', chude: '../x', trang: '-4' });
    assert.deepEqual({ ...q }, { task: null, dang: null, chude: null, q: '', trang: 1 });
    // A question type never goes with Task 1.
    assert.equal(parseListQuery({ task: 'task1', dang: 'opinion' }).dang, null);
    // Repeated parameters: the first one wins.
    assert.equal(parseListQuery({ task: ['task1', 'task2'] }).task, 'task1');
    assert.equal(parseListQuery({ q: 'x'.repeat(150) }).q.length, 100);
  });

  test('the plain list has one address: page 1 and empty values are left out', () => {
    assert.equal(listHref(parseListQuery({})), '/library/writing-samples');
    assert.equal(listHref(parseListQuery({ trang: '1', q: '' })), '/library/writing-samples');
    assert.equal(listHref(parseListQuery({ chude: 'environment', trang: '3' })), '/library/writing-samples?chude=environment&trang=3');
  });
});

describe('changeListQuery (FR-010, FR-011)', () => {
  const start = parseListQuery({ task: 'task2', dang: 'opinion', q: 'work', trang: '3' });

  test('any filter change goes back to page 1', () => {
    assert.equal(changeListQuery(start, { chude: 'environment' }).trang, 1);
    assert.equal(changeListQuery(start, { q: 'job' }).trang, 1);
    assert.equal(changeListQuery(start, { dang: null }).trang, 1);
  });

  test('Task 1 drops the Task 2 question type', () => {
    const next = changeListQuery(start, { task: 'task1' });
    assert.equal(next.dang, null);
    assert.equal(listHref(next), '/library/writing-samples?task=task1&q=work');
  });

  test('moving pages keeps the filters', () => {
    assert.deepEqual({ ...changeListQuery(start, { trang: 4 }) }, { ...start, trang: 4 });
  });
});

describe('list numbers and counts (FR-011)', () => {
  test('rows are numbered within the filtered result', () => {
    assert.equal(rowNumber(1, 0), 1);
    assert.equal(rowNumber(2, 0), 13);
    assert.equal(rowNumber(3, 11), 36);
  });

  test('pages', () => {
    assert.equal(totalPages(0), 1);
    assert.equal(totalPages(12), 1);
    assert.equal(totalPages(13), 2);
  });

  test('count text never shows a count it was not given', () => {
    const none = parseListQuery({});
    assert.equal(countText(undefined, none), '');
    assert.equal(countText(549, none), '549 đề');
    assert.equal(countText(479, parseListQuery({ task: 'task2' })), '479 đề Task 2');
    assert.equal(countText(7, parseListQuery({ task: 'task2', q: 'work' })), '7 đề Task 2 khớp');
    assert.doesNotMatch(countText(0, parseListQuery({ q: 'zzz' })), /0\/0/);
  });

  test('chips name each active filter with its public label', () => {
    const chips = activeChips(parseListQuery({ task: 'task2', dang: 'problem-solution', chude: 'environment', q: 'tax' }), [
      { slug: 'environment', label_vi: 'Môi trường' },
    ]);
    assert.deepEqual(chips.map((c) => c.label), ['Task 2', 'Problem and Solution', 'Môi trường', '“tax”']);
    assert.ok(chips.every((c) => !/_/.test(c.label)));
  });
});

describe('loadListState: what a read means for the page', () => {
  const page = (total, items) => ({ items: Array.from({ length: items }, (_, i) => ({ slug: `s${i}` })), total, page: 1, page_size: 12 });
  const fake = (answers) => {
    const asked = [];
    return { asked, fetchList: async (path) => { asked.push(path); return answers(path); } };
  };

  test('a topic the API no longer has: read again without it and say so', async () => {
    const { asked, fetchList } = fake((path) => (path.includes('chude=') ? { data: null, status: 422 } : { data: page(30, 12), status: 200 }));
    const state = await loadListState(parseListQuery({ task: 'task2', chude: 'old-topic', trang: '2' }), fetchList);
    assert.deepEqual(asked, ['/api/library/writing-samples?task=task2&chude=old-topic&trang=2', '/api/library/writing-samples?task=task2']);
    assert.equal(state.notice, 'topic-gone');
    assert.equal(state.query.chude, null);
    assert.equal(state.query.trang, 1);
    assert.equal(state.data.total, 30);
    assert.equal(state.redirectTo, null);
  });

  test('a server failure stays a failure: no second read, no notice', async () => {
    const { asked, fetchList } = fake(() => ({ data: null, status: 503 }));
    const state = await loadListState(parseListQuery({ chude: 'work' }), fetchList);
    assert.equal(asked.length, 1);
    assert.equal(state.data, null);
    assert.equal(state.notice, null);
  });

  test('422 without a topic is not treated as a lost topic', async () => {
    const { asked, fetchList } = fake(() => ({ data: null, status: 422 }));
    const state = await loadListState(parseListQuery({ task: 'task2' }), fetchList);
    assert.equal(asked.length, 1);
    assert.equal(state.notice, null);
    assert.equal(state.data, null);
  });

  test('a page past the end of a non-empty result goes to the last page, filters kept', async () => {
    const { fetchList } = fake(() => ({ data: page(30, 0), status: 200 }));
    const state = await loadListState(parseListQuery({ dang: 'opinion', trang: '99' }), fetchList);
    assert.equal(state.redirectTo, '/library/writing-samples?dang=opinion&trang=3');
  });

  test('last page one: the redirect leaves out trang', async () => {
    const { fetchList } = fake(() => ({ data: page(5, 0), status: 200 }));
    const state = await loadListState(parseListQuery({ q: 'work', trang: '4' }), fetchList);
    assert.equal(state.redirectTo, '/library/writing-samples?q=work');
  });

  test('no result at all is the empty state, not a redirect', async () => {
    const { fetchList } = fake(() => ({ data: page(0, 0), status: 200 }));
    const state = await loadListState(parseListQuery({ q: 'zzz', trang: '3' }), fetchList);
    assert.equal(state.redirectTo, null);
    assert.equal(state.data.total, 0);
  });
});
