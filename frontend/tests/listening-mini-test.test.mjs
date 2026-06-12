/**
 * listening-mini-test.test.mjs — Listening MINI TEST mode.
 *
 * A mini = a listening full test with 1 section, flagged metadata.test_type='mini'.
 * It REUSES the full-test player (listening-test.html?id) + review AS-IS; only
 * the list page + the 4/40 → real-shape param + the admin toggle + the 2-way
 * filter are new. These sentinels pin that wiring.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...rel) => readFileSync(join(__dirname, '..', ...rel), 'utf8');

const MINI_HTML  = read('pages', 'listening-mini-test.html');
const MINI_JS    = read('js', 'listening-mini-test.js');
const LIST_JS    = read('js', 'listening-tests-list.js');
const PLAYER_JS  = read('js', 'listening-test-player.js');
const REVIEW_JS  = read('js', 'listening-review.js');
const ADMIN_HTML = read('pages', 'admin', 'listening', 'import-fulltest.html');
const ADMIN_JS   = read('js', 'admin-listening-fulltest-import.js');
const HUB_HTML   = read('pages', 'listening.html');


describe('Mini test — list page reuses the full-test player', () => {
  it('mini page loads listening-mini-test.js + cards open the SHARED player', () => {
    assert.match(MINI_HTML, /src="\/js\/listening-mini-test\.js"/);
    assert.match(MINI_JS, /\/pages\/listening-test\.html\?id=/);
  });
  it('mini list fetches ONLY mini tests (test_type=mini)', () => {
    assert.match(MINI_JS, /\/api\/listening\/tests\?test_type=mini/);
  });
  it('hub Mini Test card points to the mini list page', () => {
    assert.match(HUB_HTML, /href="\/pages\/listening-mini-test\.html"/);
  });
});


describe('Mini test — 2-way segregation', () => {
  it('Full Tests list explicitly excludes mini (test_type=full)', () => {
    assert.match(LIST_JS, /\/api\/listening\/tests\?test_type=full/);
  });
});


describe('Mini test — player param-ized off the real shape (no hardcoded 4/40)', () => {
  it('derives section count + total questions + q→section map from the test', () => {
    assert.match(PLAYER_JS, /function computeTestShape\(test\)/);
    assert.match(PLAYER_JS, /STATE\.totalQuestions\s*=/);
    assert.match(PLAYER_JS, /STATE\.sectionCount\s*=/);
    assert.match(PLAYER_JS, /STATE\.qToSection/);
  });
  it('renders one tab per real section (not a static 4)', () => {
    assert.match(PLAYER_JS, /function renderTabs\(\)/);
  });
  it('progress loop + bounds use totalQuestions, not a literal 40', () => {
    assert.match(PLAYER_JS, /q <= \(STATE\.totalQuestions \|\| 40\)/);
    assert.doesNotMatch(PLAYER_JS, /for \(let q = 1; q <= 40; q\+\+\)/);
  });
  it('sectionForQ uses the data map, not only the /10 formula', () => {
    assert.match(PLAYER_JS, /STATE\.qToSection && STATE\.qToSection\.has/);
  });
  it('setActiveTab guard uses sectionCount', () => {
    assert.match(PLAYER_JS, /tabNum > \(STATE\.sectionCount \|\| 4\)/);
  });
});


describe('Mini test — review palette is section-driven (not %10)', () => {
  it('palette inserts a separator on SECTION change, not q_num % 10', () => {
    assert.match(REVIEW_JS, /sec != null && sec !== prevSec/);
    assert.doesNotMatch(REVIEW_JS, /it\.q_num % 10 === 1/);
  });
});


describe('Mini test — admin import toggle', () => {
  it('import form has a Mini-test checkbox', () => {
    assert.match(ADMIN_HTML, /id="fi-mini"/);
  });
  it('commit passes mini=true when checked', () => {
    assert.match(ADMIN_JS, /fi-mini/);
    assert.match(ADMIN_JS, /'\?mini=true'/);
  });
});
