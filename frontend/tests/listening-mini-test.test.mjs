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
const PLAYER_HTML = read('pages', 'listening-test.html');
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


// ── PR follow-up: render bugs that only surface with REAL 1-section content
//    (a mini may be "Section 3" → section_num=3, not 1). Pin the fixes so the
//    full 4-section path can't regress and the 1-section path can't re-break.
describe('Mini test — 1-section render fixes (#454 follow-up)', () => {
  it('computeTestShape captures the FIRST real section number (mini may start at 3)', () => {
    // CRITICAL blank-render root: a single "Section 3" panel was hidden because
    // applyActiveTab hides every section whose num != activeTab, and activeTab
    // was hardcoded to 1. Seed it from the real first section instead.
    assert.match(PLAYER_JS, /STATE\.firstSection\s*=\s*sections\.length\s*\?\s*Number\(sections\[0\]\.section_num\)/);
  });
  it('activeTab is seeded from the first real section, NOT a hardcoded 1', () => {
    assert.match(PLAYER_JS, /STATE\.activeTab\s*=\s*STATE\.firstSection/);
    assert.doesNotMatch(PLAYER_JS, /STATE\.activeTab\s*=\s*1;/);
  });
  it('setActiveTab accepts any REAL section number (a mini section set may be {3})', () => {
    assert.match(PLAYER_JS, /STATE\.sectionQCounts[\s\S]*?hasOwnProperty\.call\(STATE\.sectionQCounts,\s*tabNum\)/);
  });
  it('footer answered-count denominator is param-ized (data-total-q), not a static "/ 40 câu"', () => {
    assert.match(PLAYER_HTML, /id="ft-answered-foot"[\s\S]*?data-total-q/);
    assert.doesNotMatch(PLAYER_HTML, /id="ft-answered-foot"[^<]*<\/strong>\s*\/\s*40 câu/);
  });
  it('taking-player MCQ renders option {letter,text}, never [object Object]', () => {
    // renderMCQ must read o.letter/o.text — escapeHtml(object) would print
    // "[object Object]" as it did in the admin preview.
    assert.match(PLAYER_JS, /const letter\s*=\s*o\.letter\s*\|\|\s*o\.label/);
    assert.match(PLAYER_JS, /const text\s*=\s*o\.text/);
  });
  it('admin import preview renders MCQ option letter+text, not escapeHtml(object)', () => {
    assert.match(ADMIN_JS, /o\.letter\s*\|\|\s*o\.label/);
    assert.doesNotMatch(ADMIN_JS, /return '<li>' \+ escapeHtml\(o\) \+ '<\/li>'; \}\)\.join/);
  });
  it('admin import preview drops the misleading /4 and /40 fixed denominators', () => {
    assert.doesNotMatch(ADMIN_JS, /question_count[^)]*\) \+ '\/40<\/b>/);
    assert.doesNotMatch(ADMIN_JS, /section_count[^)]*\) \+ '\/4<\/b>/);
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
