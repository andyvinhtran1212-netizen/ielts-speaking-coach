// G02-T12 (FR-02-010): admin pages opened without their required parameter go
// to their parent with `?notice=lien-ket-thieu`. The redirects themselves are
// checked in the browser flows (verify-admin-{mock-live,mock-reviews,
// reading-preview,grammar,writing-status}-flow); this checks that every parent
// those pages can land on names itself in the notice.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mockTestsHref } from '../lib/admin-mock-tests-model.mjs';
import { adminReadingPreviewReturnHref } from '../lib/admin-reading-navigation.mjs';
import { writingNavigationHref } from '../lib/admin-writing-navigation-model.mjs';
import { writingStatusHref } from '../lib/admin-writing-status-model.mjs';
import { PARENT_LABELS } from '../lib/redirect-notice-model.mjs';

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
