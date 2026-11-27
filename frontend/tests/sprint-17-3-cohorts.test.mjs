/**
 * frontend/tests/sprint-17-3-cohorts.test.mjs — Sprint 17.3 (Direction C)
 *
 * Source-scan of the cohort management UI wiring + nav graduation. The cohort
 * controller reuses the (already unit-tested) Sprint 17.2 usage-util formatters,
 * so this file pins the wiring + Pattern #26 rather than re-testing pure logic.
 * No headless browser (project source-scan convention).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';


const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
// LEGACYJS-0075 W3b: admin-classes.js is deleted. The class list is the Next
// directory and the roster is the dynamic /admin/classes/[cohortId] route.
const DIR = front('app', '(authed-admin)', '(classes)', 'admin', 'classes', 'admin-classes-directory.tsx');
const DETAIL = front('app', '(authed-admin)', '(classes)', 'admin', 'classes', '[cohortId]', 'admin-class-detail.tsx');
const DETAIL_PAGE = front('app', '(authed-admin)', '(classes)', 'admin', 'classes', '[cohortId]', 'page.tsx');
const CTRL = DIR + DETAIL;
const CHROME = front('js', 'components', 'aver-admin-chrome.js');
const HTML = front('pages', 'admin', 'classes', 'index.html');


// LEGACYJS-0075 W4a: admin-usage-util.js is deleted. Its last consumers
// (admin-classes.js in W3b, admin-usage.js here) are gone; the Next class
// surfaces format with their own models.

describe('Sprint 17.3 — class wiring (Next directory + detail route)', () => {
  test('member roster is its own route keyed by cohortId', () => {
    assert.match(DETAIL_PAGE, /<AdminClassDetail cohortId=\{cohortId\} \/>/);
    assert.match(DETAIL, /window\.api\.get<unknown>\(`\/admin\/cohorts\/\$\{encodeURIComponent\(cohortId\)\}\/members`\)/);
    assert.match(DIR, /getAdminCohorts\(\{ withRollup: true \}\)/);
  });
  test('create + archive/restore wired (PATCH is_active)', () => {
    assert.match(DIR, /window\.api\.post\('\/admin\/cohorts'/);
    assert.match(DIR, /\{ is_active: current\.nextActive \}/);
    assert.match(DIR, /is_active \? 'Lưu trữ' : 'Khôi phục'/);
  });
  test('renders member roster from students (student_code) + formatters', () => {
    // WF-1: roster = students.cohort_id; rows show student_code (not user email).
    assert.match(DETAIL, /<td><code>\{member\.student_code \|\| '—'\}<\/code><\/td>/);
    // A failed usage read stays "Không đọc được", never 0.
    assert.match(DETAIL, /member\.sessions == null \? <span className="acd-unknown">Không đọc được<\/span>/);
    assert.match(DETAIL, /formatMoney\(member\.ai_cost_usd\)/);
  });
  test('Pattern #26 — no inline color/bg/hex literals', () => {
    assert.doesNotMatch(CTRL, /style=\{\{[^}]*color\s*:/);
    assert.doesNotMatch(CTRL, /style=\{\{[^}]*background/);
    assert.doesNotMatch(CTRL, /rgba\(\s*\d+\s*,/);
  });
});

describe('Sprint 17.3 — integrations', () => {
  test('nav graduated cohorts (PHASE_B_SECTIONS now empty)', () => {
    assert.match(CHROME, /PHASE_B_SECTIONS\s*=\s*new Set\(\[\]\)/);
    assert.doesNotMatch(CHROME, /new Set\(\[\s*'cohorts'/);
  });
  test('page has list + detail views, member table, create modal', () => {
    assert.match(HTML, /id="view-list"/);
    assert.match(HTML, /id="view-detail"/);
    assert.match(HTML, /id="roster-tbody"/);
    assert.match(HTML, /id="cohort-modal"/);
  });
});
