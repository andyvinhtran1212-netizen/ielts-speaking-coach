// LIBRARY-0061 T011 (G06-T11): Kiến thức Writing helpers, routes and API contract.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { routeFor, sectionFor } from '../lib/route-registry.mjs';
import {
  GUIDE_GROUPS,
  formatGuideDate,
  guideHref,
  visibleGroups,
  withSampleLinks,
} from '../lib/writing-guides-model.mjs';

test('four fixed groups in the FR-020 order', () => {
  assert.deepEqual(
    GUIDE_GROUPS.map((g) => [g.n, g.id, g.label]),
    [
      ['1', 'task1', 'Task 1'],
      ['2', 'task2', 'Task 2'],
      ['3', 'criteria', 'Tiêu chí chấm'],
      ['4', 'question-type', 'Dạng đề'],
    ],
  );
});

test('visibleGroups hides empty and unknown groups, keeps the fixed order', () => {
  const groups = visibleGroups([
    { id: 'question-type', label: 'x', items: [{ slug: 'a' }] },
    { id: 'task1', label: 'x', items: [] },
    { id: 'zzz', label: 'x', items: [{ slug: 'b' }] },
    { id: 'task2', label: 'x', items: [{ slug: 'a' }] },
  ]);
  assert.deepEqual(groups.map((g) => g.id), ['task2', 'question-type']);
  assert.deepEqual(visibleGroups(null), []);
});

test('formatGuideDate is Vietnam time, null when unreadable', () => {
  assert.equal(formatGuideDate('2026-11-20T18:30:00Z'), '21/11/2026');
  assert.equal(formatGuideDate('2026-11-20T08:00:00+00:00'), '20/11/2026');
  assert.equal(formatGuideDate(''), null);
  assert.equal(formatGuideDate('nope'), null);
  assert.equal(formatGuideDate(null), null);
});

test('guideHref encodes the slug', () => {
  assert.equal(guideHref('mo-bai'), '/library/writing-guides/mo-bai');
  assert.equal(guideHref('a b'), '/library/writing-guides/a%20b');
});

test('withSampleLinks unlinks citations only while the sample page is not live', () => {
  const html =
    '<p><a class="sample-cite-link" href="/library/writing-samples/a?muc=7.0">A (bản 7.0)</a> và <a href="/grammar">khác</a></p>' +
    '<figure class="sample-cite"><blockquote><p>Q</p></blockquote><a class="sample-cite-open" href="/library/writing-samples/a?muc=7.5">Mở đề này, bản 7.5</a></figure>';
  assert.equal(withSampleLinks(html, true), html);
  const off = withSampleLinks(html, false);
  assert.ok(!off.includes('/library/writing-samples'));
  assert.ok(off.includes('<span class="sample-cite-link">A (bản 7.0)</span>'));
  assert.ok(off.includes('<a href="/grammar">khác</a>'));
  assert.ok(off.includes('<p>Q</p>') && !off.includes('Mở đề này'));
  assert.equal(withSampleLinks(undefined, false), '');
});

test('both pages are live, public, v2 routes in the Library section', () => {
  for (const path of ['/library/writing-guides', '/library/writing-guides/mo-bai']) {
    const entry = routeFor(path);
    assert.equal(entry?.status, 'live', path);
    assert.equal(entry?.audience, 'public', path);
    assert.equal(entry?.ui, 'v2', path);
    assert.equal(sectionFor(path), 'library', path);
  }
});

test('pages read the guides API uncached and render raw API HTML only in the body', () => {
  const data = readFileSync(new URL('../app/(public-library)/library/writing-guides/guides-data.ts', import.meta.url), 'utf8');
  assert.match(data, /\/api\/library\/writing-guides/);
  assert.match(data, /cache: 'no-store'/);
  const article = readFileSync(
    new URL('../app/(public-library)/library/writing-guides/[slug]/guide-article.tsx', import.meta.url),
    'utf8',
  );
  assert.equal((article.match(/dangerouslySetInnerHTML/g) ?? []).length, 1);
  assert.match(article, /withSampleLinks\(guide\.html, sampleLive\)/);
});
