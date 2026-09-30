import assert from 'node:assert/strict';
import test from 'node:test';

import { adminReadingContext, adminReadingLibraryHref, adminReadingPreviewReturnHref } from '../lib/admin-reading-navigation.mjs';
import { readingPreviewHref } from '../lib/admin-reading-preview-model.mjs';
import { adminOverviewContext, adminOverviewHref } from '../lib/admin-overview-context.mjs';

test('Admin Reading new-tab return uses fixed source and restores library/page independently of stale storage', () => {
  const href = readingPreviewHref('T 1', 2, { library: 'l3_test', page: 2 });
  const url = new URL(href, 'https://example.test');
  assert.equal(url.hash, '#q2');
  assert.equal(url.searchParams.get('test_id'), 'T 1');
  assert.equal(adminReadingPreviewReturnHref(url.searchParams), '/admin/reading/content?library=l3_test&page=2');
  assert.equal(adminReadingLibraryHref({ library: 'l1_vocab', page: 1 }), '/admin/reading/content?library=l1_vocab');
  assert.equal(readingPreviewHref('T 1'), '/admin/reading/preview?test_id=T%201');
  assert.equal(adminReadingPreviewReturnHref(new URLSearchParams('from=https://evil.test&page=2')), '/admin/reading/content');
  assert.deepEqual(adminReadingContext(new URLSearchParams('library=l3_test&library=l1_vocab&page=-1')), { library: '', page: 1 });
});

test('Overview window and pane round-trip together and invalid values use documented defaults', () => {
  const href = adminOverviewHref({ window: 7, pane: 'content' });
  assert.equal(href, '/admin?window=7&pane=content');
  assert.deepEqual(adminOverviewContext(new URL(href, 'https://example.test').searchParams), { windowDays: 7, pane: 'content' });
  assert.deepEqual(adminOverviewContext(new URLSearchParams('window=7&window=90&pane=ops&pane=content')), { windowDays: 30, pane: 'ops' });
  assert.equal(adminOverviewHref({ window: 'infinite', pane: 'javascript:' }), '/admin');
});
