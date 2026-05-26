/**
 * frontend/tests/sprint-18-1-ia.test.mjs — Sprint 18.1 (Direction A: IA restructure)
 *
 * Source-scan of the four IA changes (all controllers are auto-running /
 * DOM-coupled, so we pin wiring + contracts rather than execute):
 *   B  Convert thành học viên  — users page modal + admin-users.js POST
 *   D  User dropdown            — cohorts add-member <select> + /admin/users fetch
 *   A  Tab bar                  — "Lớp & Học viên" segmented sibling tabs on both pages
 *      Nav fold                 — students nav item removed, cohorts relabelled, students still valid
 */
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const USERS_JS    = front('js', 'admin-users.js');
const USERS_HTML  = front('pages', 'admin', 'users', 'index.html');
const COHORTS_JS  = front('js', 'admin-cohorts.js');
const COHORTS_HTML = front('pages', 'admin', 'cohorts', 'index.html');
const STUDENTS_HTML = front('pages', 'admin', 'students', 'index.html');
const CHROME      = front('js', 'components', 'aver-admin-chrome.js');
// Sprint 18.3 moved the cohorts page's .adm-subtab styles into the shared
// admin-components.css; the students page keeps them inline until 18.3.1.
const ADMIN_COMPONENTS = front('css', 'aver-design', 'admin-components.css');


describe('Sprint 18.1 B — convert user → học viên', () => {
  test('users page has the convert modal', () => {
    assert.match(USERS_HTML, /id="convert-backdrop"/);
    assert.match(USERS_HTML, /id="cv-code"/);
    assert.match(USERS_HTML, /id="cv-name"/);
    assert.match(USERS_HTML, /id="btn-cv-submit"/);
  });
  test('per-row convert button + opens modal', () => {
    assert.match(USERS_JS, /data-convert=/);
    assert.match(USERS_JS, /openConvert\(/);
  });
  test('submits user_id to POST /admin/students + handles the 409 already-student case', () => {
    assert.match(USERS_JS, /api\.post\('\/admin\/students',\s*\{\s*user_id/);
    assert.match(USERS_JS, /409|đã là học viên/);
  });
  test('Pattern #26 — no inline colour/bg in admin-users.js', () => {
    assert.doesNotMatch(USERS_JS, /style\s*=\s*["'][^"']*color\s*:/);
    assert.doesNotMatch(USERS_JS, /style\s*=\s*["'][^"']*background/);
    assert.doesNotMatch(USERS_JS, /rgba\(\s*\d+\s*,/);
  });
});

describe('Sprint 18.1 D — cohort add-member user dropdown', () => {
  test('add-member picker is a <select>, not a raw UUID input', () => {
    assert.match(COHORTS_HTML, /<select id="am-user">/);
    assert.doesNotMatch(COHORTS_HTML, /<input id="am-user"/);
  });
  test('dropdown is populated from GET /admin/users', () => {
    assert.match(COHORTS_JS, /populateUserDropdown/);
    assert.match(COHORTS_JS, /api\.get\('\/admin\/users'\)/);
  });
  test('Pattern #26 — no inline colour/bg in admin-cohorts.js', () => {
    assert.doesNotMatch(COHORTS_JS, /style\s*=\s*["'][^"']*color\s*:/);
    assert.doesNotMatch(COHORTS_JS, /style\s*=\s*["'][^"']*background/);
    assert.doesNotMatch(COHORTS_JS, /rgba\(\s*\d+\s*,/);
  });
});

describe('Sprint 18.1 A — "Lớp & Học viên" tab bar', () => {
  test('cohorts page: cohorts tab active, links to students', () => {
    assert.match(COHORTS_HTML, /class="adm-subtab is-active"[^>]*href="\/pages\/admin\/cohorts\/index\.html"/);
    assert.match(COHORTS_HTML, /class="adm-subtab"[^>]*href="\/pages\/admin\/students\/index\.html"/);
  });
  test('students page: students tab active, links to cohorts', () => {
    assert.match(STUDENTS_HTML, /class="adm-subtab is-active"[^>]*href="\/pages\/admin\/students\/index\.html"/);
    assert.match(STUDENTS_HTML, /class="adm-subtab"[^>]*href="\/pages\/admin\/cohorts\/index\.html"/);
  });
  test('tab active state uses tokenised brand classes (no inline hex)', () => {
    // Cohorts consumes the shared admin-components.css (Sprint 18.3); students
    // page still defines the tab styles inline (migrates in 18.3.1).
    assert.match(ADMIN_COMPONENTS, /\.adm-subtab\.is-active[\s\S]*?--av-brand-teal-50/);
    assert.match(COHORTS_HTML, /admin-components\.css/);
    assert.match(STUDENTS_HTML, /\.adm-subtab\.is-active[\s\S]*?--av-brand-teal-50/);
  });
});

describe('Sprint 18.1 — nav fold (students → Lớp & Học viên)', () => {
  test('cohorts nav item relabelled', () => {
    assert.match(CHROME, /label: 'Lớp & Học viên'/);
  });
  test('standalone students nav item removed', () => {
    assert.doesNotMatch(CHROME, /section: 'students', label: 'Học viên',\s*href/);
  });
  test("'students' kept in VALID_ACTIVE so the page still resolves via the tab", () => {
    assert.match(CHROME, /VALID_ACTIVE = \[[\s\S]*?'students'[\s\S]*?\]/);
  });
});
