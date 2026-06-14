/**
 * writing-analytics-instrument.test.mjs — PR-2 frontend instrument.
 *
 * Pins (1) the page_view beacon on the 6 previously-uninstrumented student
 * pages, and (2) the writing-dashboard event emits (writing_tip_view at the tip
 * modal, prompt_view at the essay-open). Source-assertion sentinels.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...rel) => readFileSync(join(__dirname, '..', ...rel), 'utf8');

const DASH = read('pages', 'writing-dashboard.html');

// page → expected analytics-beacon.js src (path style matched per page)
const BEACON_PAGES = [
  ['pages/writing-dashboard.html', '../js/analytics-beacon.js'],
  ['grammar.html',                 'js/analytics-beacon.js'],
  ['pages/grammar-article.html',   '/js/analytics-beacon.js'],
  ['pages/grammar-compare.html',   '../js/analytics-beacon.js'],
  ['pages/grammar-roadmap.html',   '../js/analytics-beacon.js'],
  ['pages/grammar-search.html',    '../js/analytics-beacon.js'],
];


describe('PR-2 — page_view beacon installed on all 6 pages', () => {
  for (const [rel, src] of BEACON_PAGES) {
    it(`${rel} loads analytics-beacon.js (${src}) after api.js`, () => {
      const html = read(...rel.split('/'));
      assert.ok(html.includes(`src="${src}"`), `${rel} missing beacon ${src}`);
      // beacon must come AFTER api.js (needs window.api.post)
      const apiIdx = html.search(/src="[^"]*\/?api\.js"/);
      const beaconIdx = html.indexOf(`src="${src}"`);
      assert.ok(apiIdx !== -1 && apiIdx < beaconIdx, `${rel}: beacon must follow api.js`);
    });
  }
});


describe('PR-2 — writing-dashboard event emits', () => {
  it('emits prompt_view at the essay-open (goToDetail), fire-and-forget', () => {
    assert.match(DASH, /event_name:\s*'prompt_view'/);
    // inside goToDetail, before navigation, guarded + non-blocking
    assert.match(DASH, /goToDetail = function[\s\S]*?event_name:\s*'prompt_view'[\s\S]*?window\.location\.href/);
    assert.match(DASH, /window\.api\.post\('\/api\/analytics\/events'/);
  });
  it('emits writing_tip_view at the tip modal (openTipModal, covers all callers)', () => {
    assert.match(DASH, /function openTipModal\(tip\)[\s\S]*?event_name:\s*'writing_tip_view'/);
    assert.match(DASH, /tip_id:\s*tip\.id/);
  });
  it('both emits are best-effort (.catch + try/guard, never block UI)', () => {
    assert.match(DASH, /event_name:\s*'prompt_view'[\s\S]*?\.catch\(function \(\) \{\}\)/);
    assert.match(DASH, /event_name:\s*'writing_tip_view'[\s\S]*?\.catch\(function \(\) \{\}\)/);
  });
});
