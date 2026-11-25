// LIBRARY-0061 T008: `/library` (FR-001, FR-002, FR-003, FR-004, FR-063).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LIBRARY_SHELVES,
  formatShelfNumber,
  positiveCount,
  shelvesWithCounts,
} from '../lib/library-shelves.mjs';
import { routeFor } from '../lib/route-registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '../app/(public-library)/library/page.tsx'), 'utf8');
const LAYOUT = readFileSync(path.join(HERE, '../app/(public-library)/layout.tsx'), 'utf8');
const FRAME = readFileSync(path.join(HERE, '../app/(public-library)/library-frame.tsx'), 'utf8');
const PROXY = readFileSync(path.join(HERE, '../proxy.ts'), 'utf8');

const FULL = {
  writing_samples: { total: 12 },
  writing_guides: { total: 30 },
  speaking: { total: 1284, with_video: 40 },
  grammar: { total: 150 },
  vocabulary: { total: 2400 },
};

describe('Library shelves (FR-063)', () => {
  test('exactly five shelves, in sheet order, each with a unique id', () => {
    assert.deepEqual(
      LIBRARY_SHELVES.map((s) => s.id),
      ['bai-mau-writing', 'kien-thuc-writing', 'de-speaking', 'ngu-phap', 'tu-vung'],
    );
    assert.ok(Object.isFrozen(LIBRARY_SHELVES));
  });

  test('every shelf href is a registered route, and no shelf says "Sắp có"', () => {
    for (const shelf of LIBRARY_SHELVES) {
      assert.ok(routeFor(shelf.href), `${shelf.href} is in the route registry`);
      assert.doesNotMatch(`${shelf.title} ${shelf.description}`, /sắp có/i);
    }
  });

  test('a sixth shelf appended to the array is rendered without touching the page', () => {
    const sixth = {
      id: 'nen-tang',
      title: 'Nền tảng',
      href: '/library/background',
      description: 'x',
      summaryKey: 'background',
      count: (e) => (e?.total ? `${e.total} bài` : null),
    };
    const rows = shelvesWithCounts([...LIBRARY_SHELVES, sixth], { ...FULL, background: { total: 3 } });
    assert.equal(rows.length, 6);
    assert.equal(rows[5].countText, '3 bài');
  });

  test('the page draws shelves from LIBRARY_SHELVES, never a hard-coded list', () => {
    assert.match(PAGE, /shelvesWithCounts\(LIBRARY_SHELVES/);
    for (const shelf of LIBRARY_SHELVES) assert.ok(!PAGE.includes(shelf.title), `"${shelf.title}" not in JSX`);
  });
});

describe('Library frame (FR-001, FR-002, FR-003)', () => {
  test('public: no auth gate in the layout and /library is not in the proxy matcher', () => {
    const code = LAYOUT.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(code, /AuthedShell|AuthProvider|activationGate|AdminAccessGate/);
    const matcher = PROXY.slice(PROXY.indexOf('matcher:'));
    assert.doesNotMatch(matcher, /library/);
    assert.equal(routeFor('/library')?.status, 'live');
    assert.equal(routeFor('/library')?.audience, 'public');
  });

  test('page frame: PublicShell (Thư viện marked) for guests, LearnerShell when signed in, no legacy cascade', () => {
    const code = LAYOUT.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.match(code, /<LibraryFrame>\{children\}<\/LibraryFrame>/);
    const frame = FRAME.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.match(frame, /<PublicShell active="library">/);
    assert.match(frame, /<LearnerShell /);
    assert.match(frame, /from '@\/components\/ui\/shell\/public-shell'/);
    // Library reading never needs an activated account (FR-001).
    assert.match(frame, /<AuthProvider>/);
    assert.doesNotMatch(frame, /activationGate/);
    assert.doesNotMatch(code, /aver-chrome|aver-admin-chrome|\/css\/|tailwind|lucide/i);
    // RedirectNotice is styled with legacy --av-* tokens only, which this tree does not load.
    assert.doesNotMatch(code, /RedirectNotice/);
    // PublicShell owns <main>; the page must not add a second one.
    assert.doesNotMatch(PAGE, /<main\b/);
  });

  test('exactly one course link, after the shelves', () => {
    assert.equal(PAGE.match(/<CourseLinkLine/g)?.length, 1);
    assert.ok(PAGE.indexOf('<CourseLinkLine') > PAGE.indexOf('<Suspense'));
  });
});

describe('Library shelf counts (FR-004)', () => {
  test('full summary: counts with no-break thousands', () => {
    const text = Object.fromEntries(shelvesWithCounts(LIBRARY_SHELVES, FULL).map((r) => [r.shelf.id, r.countText]));
    assert.deepEqual(text, {
      'bai-mau-writing': '12 đề · mỗi đề ba bản 7.5, 7.0 và 6.0',
      'kien-thuc-writing': '30 bài',
      'de-speaking': '1 284 đề · 40 đề có video',
      'ngu-phap': '150 bài',
      'tu-vung': '2 400 mục từ',
    });
  });

  test('failed or missing summary: every shelf, no number', () => {
    for (const summary of [null, undefined, {}, 'oops']) {
      const rows = shelvesWithCounts(LIBRARY_SHELVES, summary);
      assert.equal(rows.length, 5);
      assert.ok(rows.every((r) => r.countText === null));
    }
  });

  test('never prints "0", "0/0" or a non-integer; Speaking at zero says so in words', () => {
    const zero = Object.fromEntries(Object.keys(FULL).map((k) => [k, { total: 0, with_video: 0 }]));
    const rows = shelvesWithCounts(LIBRARY_SHELVES, zero);
    for (const r of rows) {
      if (r.shelf.id === 'de-speaking') assert.equal(r.countText, 'Chưa có đề nào');
      else assert.equal(r.countText, null);
    }
    const odd = shelvesWithCounts(LIBRARY_SHELVES, {
      writing_guides: { total: '12' },
      grammar: { total: 2.5 },
      vocabulary: { total: -1 },
      speaking: { total: 5, with_video: 0 },
    });
    const byId = Object.fromEntries(odd.map((r) => [r.shelf.id, r.countText]));
    assert.equal(byId['kien-thuc-writing'], null);
    assert.equal(byId['ngu-phap'], null);
    assert.equal(byId['tu-vung'], null);
    assert.equal(byId['de-speaking'], '5 đề');
  });

  test('number helpers', () => {
    assert.equal(positiveCount(0), null);
    assert.equal(positiveCount(7), 7);
    assert.equal(formatShelfNumber(1234567), '1 234 567');
    assert.equal(formatShelfNumber(999), '999');
    assert.equal(formatShelfNumber(null), null);
  });
});
