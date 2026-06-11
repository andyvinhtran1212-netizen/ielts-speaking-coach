/**
 * reading-mini-test.test.mjs — Reading MINI TEST mode (Phase B).
 *
 * A mini = a full reading test with 1 passage, flagged metadata.test_type='mini'.
 * It REUSES the full-test taking (reading-exam) + review (reading-review) pages
 * AS-IS; only the list page + a 4th library tab + the admin import toggle + two
 * param-ized display strings are new. These sentinels pin that wiring.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...rel) => readFileSync(join(__dirname, '..', ...rel), 'utf8');

const MINI_HTML = read('pages', 'reading-mini-test.html');
const MINI_JS   = read('js', 'reading-mini-test.js');
const TEST_JS   = read('js', 'reading-test.js');
const EXAM_HTML = read('pages', 'reading-exam.html');
const EXAM_JS   = read('js', 'reading-exam.js');
const ADMIN_HTML = read('pages', 'admin', 'reading', 'content.html');
const ADMIN_JS   = read('js', 'admin-reading.js');


describe('Mini test — student list page reuses the full-test exam', () => {
  it('mini page loads reading-mini-test.js + deep-links to the SHARED exam page', () => {
    assert.match(MINI_HTML, /src="\/js\/reading-mini-test\.js"/);
    assert.match(MINI_JS, /\/pages\/reading-exam\.html\?test_id=/);
    // It must NOT clone the exam/review pages — reuse only.
    assert.doesNotMatch(MINI_JS, /reading-mini-exam|reading-mini-review/);
  });
  it('mini list fetches ONLY mini tests (test_type=mini)', () => {
    assert.match(MINI_JS, /qs\.set\('test_type',\s*'mini'\)/);
  });
});


describe('Mini test — 2-way library segregation in the UI', () => {
  it('Full Tests list explicitly excludes mini (test_type=full)', () => {
    assert.match(TEST_JS, /qs\.set\('test_type',\s*'full'\)/);
  });
  it('all four library tabs link to the mini page', () => {
    for (const f of ['reading-vocab.html', 'reading-skill.html', 'reading-test.html']) {
      const html = read('pages', f);
      assert.match(html, /href="\/pages\/reading-mini-test\.html">Mini Tests<\/a>/,
        `${f} missing Mini Tests tab`);
    }
    // The mini page marks its own tab active.
    assert.match(MINI_HTML, /is-active[^>]*>Mini Tests|Mini Tests<\/a>/);
  });
});


describe('Mini test — reading-exam display strings are param-ized (no hardcoded 3/40)', () => {
  it('prestart rule + results header carry IDs (set dynamically)', () => {
    assert.match(EXAM_HTML, /id="prestart-rule-nav"/);
    assert.match(EXAM_HTML, /id="results-by-part-title"/);
    // The literal "3 đoạn và 40 câu hỏi" / "(3 parts)" must be gone from markup.
    assert.doesNotMatch(EXAM_HTML, /3 đoạn và 40 câu hỏi/);
    assert.doesNotMatch(EXAM_HTML, /Theo đoạn \(3 parts\)/);
  });
  it('exam JS sets the rule line from the test passage_count/total_questions', () => {
    assert.match(EXAM_JS, /prestart-rule-nav/);
    assert.match(EXAM_JS, /pCount\s*\+\s*' đoạn và '\s*\+\s*qCount\s*\+\s*' câu hỏi/);
  });
  it('results by-part iterates ACTUAL parts, not a hardcoded p1/p2/p3', () => {
    assert.doesNotMatch(EXAM_JS, /\['p1',\s*'p2',\s*'p3'\]/);
    assert.match(EXAM_JS, /Object\.keys\(result\.by_part/);
    assert.match(EXAM_JS, /results-by-part-title/);
  });
});


describe('Mini test — admin import toggle', () => {
  it('bundle import form has a Mini-test checkbox', () => {
    assert.match(ADMIN_HTML, /id="ar-bundle-mini"/);
  });
  it('commit passes mini=true when checked (else full via backend default)', () => {
    assert.match(ADMIN_JS, /ar-bundle-mini/);
    assert.match(ADMIN_JS, /'&mini=true'/);
  });
});
