// G02-T12 (FR-02-010): admin pages opened without their required parameter go
// to the parent page with `?notice=lien-ket-thieu` from the Server Component,
// before AdminAccessGate renders. The browser flows check the landing strip
// for mock pacing, mock review report, Reading preview and Writing status;
// this pins every page in the T12 table, including the two Grammar reports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mockTestsHref } from '../lib/admin-mock-tests-model.mjs';
import { adminReadingPreviewReturnHref } from '../lib/admin-reading-navigation.mjs';
import { writingNavigationHref } from '../lib/admin-writing-navigation-model.mjs';
import { writingStatusHref } from '../lib/admin-writing-status-model.mjs';
import { PARENT_LABELS } from '../lib/redirect-notice-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = (...parts) => readFileSync(join(ROOT, 'app', ...parts, 'page.tsx'), 'utf8');

const PAGES = [
  { route: '/admin/mock-reviews/report', source: page('(authed-admin-mock-reviews)', 'admin', 'mock-reviews', 'report'), guard: /if \(!reviewId\) redirect\(redirectNoticeHref\(mockTestsHref\('review', examId\)\)\)/ },
  { route: '/admin/mock-pacing', source: page('(authed-admin-mock-live)', 'admin', 'mock-pacing'), guard: /if \(!sittingId\) redirect\(redirectNoticeHref\(mockTestsHref\('live'\)\)\)/ },
  { route: '/admin/reading/preview', source: page('(authed-admin-reading-preview)', 'admin', 'reading', 'preview'), guard: /if \(!searchParamText\(params\.test_id\)\) redirect\(redirectNoticeHref\(adminReadingPreviewReturnHref\(firstSearchParams\(params\)\)\)\)/ },
  { route: '/admin/grammar-lessons', source: page('(authed-admin-grammar)', 'admin', 'grammar-lessons'), guard: /if \(!searchParamText\(params\.attempt\)\) redirect\(redirectNoticeHref\('\/admin\/classes'\)\)/ },
  { route: '/admin/grammar-diagnostic', source: page('(authed-admin-grammar)', 'admin', 'grammar-diagnostic'), guard: /if \(!searchParamText\(params\.session\)\) redirect\(redirectNoticeHref\('\/admin\/classes'\)\)/ },
  { route: '/admin/writing/status', source: page('(authed-admin-writing-status)', 'admin', 'writing', 'status'), guard: /if \(!searchParamText\(params\.essay_id\) && !searchParamText\(params\.id\)\) \{\s*redirect\(redirectNoticeHref\(writingStatusHref\('queue', firstSearchParams\(params\)\)\)\);/ },
  { route: '/admin/writing/grade', source: page('(authed-admin-writing-grade)', 'admin', 'writing', 'grade'), guard: /if \(!searchParamText\(params\.id\) && !searchParamText\(params\.essay_id\)\) \{\s*redirect\(redirectNoticeHref\(writingNavigationHref\('queue', firstSearchParams\(params\)\)\)\);/ },
];

test('each page checks its parameter inside an async child under <Suspense>, before the gate', () => {
  for (const { route, source, guard } of PAGES) {
    assert.match(source, guard, route);
    assert.match(source, /import \{ redirect \} from 'next\/navigation';/, route);
    assert.match(source, /async function \w+\(\{ searchParams \}/, route);
    assert.match(source, /<Suspense fallback=\{[^}]+\}><\w+ searchParams=\{searchParams\} \/><\/Suspense>/, route);
    assert.ok(source.search(guard) < source.indexOf('<AdminAccessGate>'), `${route}: redirect runs before the gate`);
  }
});

test('every parent these pages land on has its own name in the notice', () => {
  const parents = [
    mockTestsHref('review', 'exam-1'), mockTestsHref('live'), adminReadingPreviewReturnHref({}),
    adminReadingPreviewReturnHref({ from: 'reading-content' }), '/admin/classes',
    writingStatusHref('queue', {}), writingNavigationHref('queue', { from: 'queue', status: 'all' }),
    writingNavigationHref('queue', { from: 'instructor' }),
  ];
  for (const href of parents) {
    const pathname = new URL(href, 'https://x.invalid').pathname;
    assert.ok(Object.hasOwn(PARENT_LABELS, pathname), `${href} → ${pathname}`);
  }
});

test('/admin/mock-live keeps its exam picker: exam_id is optional there', () => {
  const live = page('(authed-admin-mock-live)', 'admin', 'mock-live');
  assert.doesNotMatch(live, /redirect\(/);
});
