/**
 * frontend/tests/admin-listening-audit-paging.test.mjs
 *
 * The audit dashboard promises "every test". It has to actually fetch them.
 *
 * It used to issue one `limit=100` request and stop. That was fine while the
 * whole library fit in a page — but the admin list orders newest-first, so the
 * moment the generated Luyện nhanh bank grew past 100 rows every older
 * full/mini/drill test fell off the only page fetched, silently, on the screen
 * an operator uses to confirm content is sound.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JS = readFileSync(
  join(__dirname, '..', 'public', 'js', 'admin-listening-audit.js'), 'utf8');


describe('audit dashboard fetches the whole list', () => {
  it('pages by offset instead of taking one fixed page', () => {
    assert.match(JS, /offset=/, 'no offset → only the newest page is ever seen');
    assert.match(JS, /res && res\.total/,
      'paging must terminate on the reported total, not on a guess');
  });

  it('does not fire one request per test all at once', () => {
    // 100 concurrent audit calls was already a lot; over the full bank it is
    // several hundred. Batched, not unbounded.
    assert.match(JS, /mapBatched\(items,\s*\d+/);
    assert.doesNotMatch(JS, /Promise\.all\(items\.map/,
      'unbounded fan-out over the whole list');
  });

  it('says so when it stops early rather than presenting a partial audit', () => {
    // A silent cap reads exactly like "everything is fine".
    assert.match(JS, /chạm trần phân trang/);
  });
});
