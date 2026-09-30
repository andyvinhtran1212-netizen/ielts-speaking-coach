import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readWritingContentQuery as parse, writingContentHref, writingContentLibraryHref,
  createWritingContentMarker, validWritingContentMarker, validWritingLibraryMarker,
  normalizeWritingContentList,
} from '../lib/writing-content-navigation.mjs';

test('FR001: valid libraries and kind-specific content', () => {
  for (const tab of ['assignments', 'essays', 'tips', 'prompt-bank']) assert.equal(parse(`tab=${tab}`).tab, tab);
  assert.deepEqual(parse('tab=tips&tip=t1').item, { kind: 'tip', id: 't1' });
  assert.deepEqual(parse('tab=prompt-bank&prompt=p1').item, { kind: 'prompt', id: 'p1' });
});
for (const search of ['', 'tab=bad&tip=t1', 'tab=tips&tab=tips&tip=t1', 'tab=tips&tip=t1&tip=t1',
  'tab=prompt-bank&prompt=p1&prompt=p1', 'tab=tips&tip=', 'tip=t1', 'tab=tips&prompt=p1',
  'tab=prompt-bank&tip=t1', 'tab=tips&tip=t1&prompt=p1', 'tab=tips&tip=%2Felsewhere',
  'tab=tips&tip=%20t1', 'tab=tips&tip=t1&prompt=', 'tab=tips&tip=t1&assignment_id=',
  'tab=tips&tip=t1&assignment_id=a&assignment_id=b']) {
  test(`FR001: fail closed ${search || '(absent)'}`, () => assert.equal(parse(search).item, null));
}
test('FR001: any assignment key wins without changing its values', () => {
  for (const suffix of ['assignment_id=', 'assignment_id=a', 'assignment_id=a&assignment_id=b']) {
    const search = `tab=tips&tip=t1&${suffix}`;
    assert.equal(parse(search).assignment, true);
    assert.equal(search, `tab=tips&tip=t1&${suffix}`);
  }
});
test('FR003: marker matches account, route, item and exact fixed parent', () => {
  const query = parse('tab=tips&tip=t1');
  const marker = createWritingContentMarker('account-a', query.item, 'parent-1');
  const library = { version: 1, account: 'account-a', tab: 'tips', id: 'parent-1', scroll: 0,
    tipFilter: 'all', tipTypeFilter: 'all', pbFilter: 'all' };
  assert.equal(validWritingContentMarker(marker, 'account-a', '/writing/dashboard', query, library), true);
  for (const patch of [{ account: 'account-b' }, { route: '/elsewhere' }, { id: 't2' }, { kind: 'prompt' },
    { parent: 'https://example.test/' }, { parent: '/writing/dashboard?tab=tips&tip=t1' },
    { parent: '/writing/dashboard?tab=prompt-bank' }, { parentId: '' }, { version: 2 }]) {
    assert.equal(validWritingContentMarker({ ...marker, ...patch }, 'account-a', '/writing/dashboard', query, library), false);
  }
  assert.equal(validWritingContentMarker(null, 'account-a', '/writing/dashboard', query, library), false);
  assert.equal(validWritingContentMarker(marker, 'account-a', '/other', query, library), false);
  assert.equal(validWritingContentMarker(marker, 'account-a', '/writing/dashboard', parse('tab=tips&tip=t1&assignment_id='), library), false);
  for (const damaged of [undefined, { ...library, id: 'other' }, { ...library, account: 'other' }, { ...library, tab: 'essays' }, { ...library, scroll: -1 }]) {
    assert.equal(validWritingContentMarker(marker, 'account-a', '/writing/dashboard', query, damaged), false);
  }
});
test('FR003: fixed hrefs reject arbitrary redirects and invalid identity', () => {
  assert.equal(writingContentHref('tip', 't1'), '/writing/dashboard?tab=tips&tip=t1');
  assert.equal(writingContentHref('prompt', 'p1'), '/writing/dashboard?tab=prompt-bank&prompt=p1');
  assert.equal(writingContentHref('tip', '../'), null);
  assert.equal(writingContentHref('essay', 't1'), null);
  assert.equal(writingContentLibraryHref('https://evil.test/'), '/writing/dashboard?tab=assignments');
});
test('FR007: library marker validates bounded filters/account/scroll', () => {
  const marker = { version: 1, account: 'a', tab: 'tips', id: 'entry-1', scroll: 42,
    tipFilter: 'task_2', tipTypeFilter: 'knowledge', pbFilter: 'all' };
  assert.equal(validWritingLibraryMarker(marker, 'a', 'tips'), true);
  for (const patch of [{ scroll: Infinity }, { scroll: -1 }, { tipFilter: 'evil' }, { pbFilter: 'evil' }, { id: '' }]) {
    assert.equal(validWritingLibraryMarker({ ...marker, ...patch }, 'a', 'tips'), false);
  }
  assert.equal(validWritingLibraryMarker(marker, 'b', 'tips'), false);
});
test('FR004: canonical list rejects malformed/duplicate identities, preserves kind', () => {
  const tip = { id: 't1', title: 'Tip', body_markdown: 'Body' };
  assert.deepEqual(normalizeWritingContentList('tip', { tips: [tip] }), [tip]);
  const blank = { ...tip, title: '   ' };
  assert.deepEqual(normalizeWritingContentList('tip', { tips: [blank] }), [blank]);
  assert.deepEqual(normalizeWritingContentList('prompt', { enabled: false, prompts: [] }), []);
  for (const payload of [{ tips: {} }, { tips: [tip, tip] }, { tips: [{ ...tip, id: '' }] },
    { tips: [{ id: 't1', title: 'Tip', prompt_text: 'wrong kind' }] }]) {
    assert.throws(() => normalizeWritingContentList('tip', payload));
  }
  assert.throws(() => normalizeWritingContentList('prompt', { prompts: [] }));
});
