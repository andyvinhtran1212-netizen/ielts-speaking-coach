/**
 * vocab-admin-console.test.mjs — V-admin slice.
 *
 * Static sentinels for the vocab admin console (pages/admin/vocab/content.html):
 * the import panel is preserved + a manage section (list / search / filter /
 * paginate / edit modal / delete-with-confirm / ▶ audio preview) is added, all
 * via window.api (no raw fetch). Zero-dep node:test.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(join(__dirname, '..', 'pages', 'admin', 'vocab', 'content.html'), 'utf8');

describe('vocab admin console — content.html', () => {
  test('all data via window.api — NO raw fetch (grep-gate)', () => {
    assert.match(PAGE, /window\.api\.get\(/);
    assert.match(PAGE, /window\.api\.patch\(/);
    assert.match(PAGE, /window\.api\.delete\(/);
    assert.doesNotMatch(PAGE, /[^.]\bfetch\s*\(/);   // no bare fetch( (window.api only)
  });

  test('import panel preserved (not replaced by the console)', () => {
    assert.match(PAGE, /id="import-panel"/);
    assert.match(PAGE, /\/admin\/vocabulary\/import\?dry_run=/);
  });

  test('list + search + category filter + pagination present', () => {
    assert.match(PAGE, /id="vw-list"/);
    assert.match(PAGE, /id="vw-search"/);
    assert.match(PAGE, /id="vw-cat"/);
    assert.match(PAGE, /id="vw-prev"/);
    assert.match(PAGE, /id="vw-next"/);
    assert.match(PAGE, /window\.api\.get\('\/admin\/vocabulary\?'/);
  });

  test('edit modal PATCHes by id + reload-reflecting copy', () => {
    assert.match(PAGE, /id="vw-modal"/);
    assert.match(PAGE, /id="f-glossvi"/);          // an edit field
    assert.match(PAGE, /window\.api\.patch\('\/admin\/vocabulary\/'/);
  });

  test('delete requires a confirm() and DELETEs by id', () => {
    assert.match(PAGE, /confirm\(\s*'Xóa từ/);
    assert.match(PAGE, /window\.api\.delete\('\/admin\/vocabulary\/'/);
  });

  test('▶ audio preview prefers mp3 (new Audio) then speechSynthesis; shows audio_status', () => {
    assert.match(PAGE, /new Audio\(/);
    assert.match(PAGE, /speechSynthesis/);
    assert.match(PAGE, /\.catch\(function \(\) \{ vwSpeak/);   // playback error → fallback
    assert.match(PAGE, /audio_status/);                       // status pill
    // No render trigger this slice (V-eleven): preview-only.
    assert.doesNotMatch(PAGE, /elevenlabs/i);
    assert.doesNotMatch(PAGE, /data-act="render"/);
  });

  test('bulk-delete: per-row checkbox + select-all + counted action bar', () => {
    assert.match(PAGE, /class="vw-tick"/);            // per-row checkbox
    assert.match(PAGE, /id="vw-select-all"/);          // select-all (this page)
    assert.match(PAGE, /id="vw-bulk-del"/);            // action button
    assert.match(PAGE, /id="vw-selected"/);            // "Đã chọn X từ" counter
  });
  test('bulk-delete POSTs ids to /bulk-delete behind a counted confirm()', () => {
    assert.match(PAGE, /window\.api\.post\('\/admin\/vocabulary\/bulk-delete',\s*\{\s*ids:/);
    assert.match(PAGE, /confirm\('Xóa ' \+ ids\.length \+ ' từ/);   // counted, named confirm
    assert.match(PAGE, /KHÔNG thể hoàn tác/);
  });
});
