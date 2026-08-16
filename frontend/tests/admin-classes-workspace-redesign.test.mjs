import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PAGE = readFileSync(join(ROOT, 'frontend/public/pages/admin/classes/index.html'), 'utf8');
const JS = readFileSync(join(ROOT, 'frontend/public/js/admin-classes.js'), 'utf8');
const STUDENTS_JS = readFileSync(join(ROOT, 'frontend/public/js/admin-students-panel.js'), 'utf8');
const CSS = readFileSync(join(ROOT, 'frontend/public/css/aver-design/admin-classes-workspace.css'), 'utf8');

function directoryHarness({ cohorts = [], rollupFailed = false, loadFailed = false } = {}) {
  const nodes = {
    'filter-status': { value: 'all' }, 'filter-course': { value: '' },
    'filter-search': { value: '' }, 'kpi-active-classes': {}, 'kpi-total-students': {},
    'kpi-unactivated': {}, 'list-loading': {}, 'class-result-summary': {},
    'list-empty': {}, 'list-table-wrap': {}, 'list-tbody': {},
  };
  const start = JS.indexOf('function renderList()');
  const end = JS.indexOf('async function loadCourses');
  assert.ok(start > -1 && end > start);
  return new Function('nodes', 'cohorts', 'rollupFailed', 'loadFailed', `
    const $ = (id) => nodes[id];
    let _cohorts = cohorts;
    let _rollupFailed = rollupFailed;
    let _cohortsLoadFailed = loadFailed;
    const countLabel = String;
    const foldSearch = (s) => String(s || '').toLowerCase();
    const esc = String;
    const statusChip = () => 'status';
    const courseLabel = () => 'course';
    const rosterCell = (n) => String(n);
    ${JS.slice(start, end)}
    renderList();
    return nodes;
  `)(nodes, cohorts, rollupFailed, loadFailed);
}

function rosterHarness(account) {
  const nodes = {
    'roster-search': { value: '' },
    'roster-account-filter': { value: account },
    'roster-empty': {}, 'roster-filter-empty': {}, 'roster-result-count': {},
    'roster-table-wrap': { querySelector: () => ({ innerHTML: '' }) },
    'roster-tbody': {},
  };
  const start = JS.indexOf('function renderRoster(members)');
  const end = JS.indexOf('function revealDrawer');
  assert.ok(start > -1 && end > start);
  return new Function('nodes', `
    const $ = (id) => nodes[id];
    const foldSearch = (s) => String(s || '').toLowerCase();
    const countLabel = String;
    const esc = String;
    let _picked = null;
    const ROSTER_COLUMNS = { head: ['Học viên'], cells: (m) => '<td>' + m.student_code + '</td>' };
    const renderDrawer = () => {};
    ${JS.slice(start, end)}
    renderRoster([
      { student_id: 'a', name: 'An', student_code: 'A01', user_id: 'user-a' },
      { student_id: 'b', name: 'Bình', student_code: 'B02', user_id: null },
    ]);
    return nodes;
  `)(nodes);
}

function homeworkHarness(assignments, status = 'all') {
  const nodes = {
    'homework-loading': {}, 'homework-kpi-open': {}, 'homework-kpi-due': {},
    'homework-kpi-closed': {}, 'homework-empty': {}, 'homework-table-wrap': {},
    'homework-filter-empty': {}, 'homework-result-count': {}, 'homework-tbody': {},
    'homework-search': { value: '' }, 'homework-status-filter': { value: status },
  };
  const start = JS.indexOf('function renderHomework()');
  const end = JS.indexOf('/* ── Bảng tổng kết nộp bài');
  assert.ok(start > -1 && end > start);
  return new Function('nodes', 'assignments', `
    const $ = (id) => nodes[id];
    let _homework = assignments;
    let _homeworkError = false;
    const countLabel = String;
    const foldSearch = (s) => String(s || '').toLowerCase();
    const esc = String;
    const SKILL_LABEL = { speaking: 'Speaking' };
    const dueLabel = () => 'due';
    const progressCell = () => 'progress';
    ${JS.slice(start, end)}
    renderHomework();
    return nodes;
  `)(nodes, assignments);
}

function courseWizardValidation(passPct, retakeSize) {
  const nodes = {
    'hf-title': { value: 'Bài theo buổi' }, 'hf-skill': { value: 'course' },
    'hf-cbank': { value: 'bank-1' }, 'hf-pass-pct': { value: passPct },
    'hf-retake-size': { value: retakeSize }, 'hf-test': { value: '' },
    'hf-topic': { value: '' }, 'hf-part': { value: '1' },
  };
  const start = JS.indexOf('function homeworkValidationMessage(step)');
  const end = JS.indexOf('function homeworkContentSummary');
  assert.ok(start > -1 && end > start);
  return new Function('nodes', `
    const $ = (id) => nodes[id];
    const hfKind = () => 'daily';
    const qmode = () => 'random';
    const whoIsAll = () => true;
    const _qpick = { picked: [], want: 1 };
    const _who = { picked: new Set() };
    ${JS.slice(start, end)}
    return homeworkValidationMessage(1);
  `)(nodes);
}

function lessonErrorHarness() {
  const nodes = {
    'lessons-loading': {}, 'lessons-count': {}, 'lessons-published-count': {},
    'lessons-empty': {}, 'lessons-list': {},
  };
  const start = JS.indexOf('function renderLessons()');
  const end = JS.indexOf('async function loadLessons');
  assert.ok(start > -1 && end > start);
  return new Function('nodes', `
    const $ = (id) => nodes[id];
    const _lessons = [];
    const _lessonsError = true;
    const countLabel = String;
    const esc = String;
    const fmtDate = String;
    ${JS.slice(start, end)}
    renderLessons();
    return nodes;
  `)(nodes);
}

function studentDirectoryHarness(rows) {
  const nodes = {
    'students-tbody': {}, 'bulk-select-all': {}, 'row-count': {},
    'student-kpi-total': {}, 'student-kpi-unassigned': {}, 'student-kpi-upcoming': {},
  };
  const start = STUDENTS_JS.indexOf('function renderRows(rows)');
  const end = STUDENTS_JS.indexOf('// ── WF-1 bulk-assign-to-cohort');
  assert.ok(start > -1 && end > start);
  return new Function('nodes', 'rows', `
    const document = { getElementById: (id) => nodes[id] };
    const _selectedIds = new Set();
    const updateBulkBar = () => {};
    const esc = String;
    const goalCell = () => '';
    const _formatDateShort = String;
    ${STUDENTS_JS.slice(start, end)}
    renderRows(rows);
    return nodes;
  `)(nodes, rows);
}

describe('Lớp & Học viên handcrafted workspace — directory', () => {
  test('workflow stylesheet loads after the legacy page-local block', () => {
    assert.ok(PAGE.indexOf('</style>') < PAGE.indexOf('admin-classes-workspace.css'));
  });

  test('class overview exposes truthful KPI and result status nodes', () => {
    for (const id of [
      'kpi-active-classes', 'kpi-total-students', 'kpi-unactivated',
      'class-result-summary', 'filter-search',
    ]) assert.match(PAGE, new RegExp(`id="${id}"`));
  });

  test('list transport failure is distinct from an empty directory', () => {
    assert.match(JS, /let _cohortsLoadFailed = false/);
    assert.match(JS, /_cohortsLoadFailed = true/);
    assert.match(JS, /Không tải được danh sách lớp/);
    assert.match(JS, /_cohortsLoadFailed\s*\n?\s*\? 'Chưa đọc được'/);
  });

  test('local search folds Vietnamese diacritics and is debounced', () => {
    assert.match(JS, /normalize\('NFD'\)/);
    assert.match(JS, /replace\(\/đ\/g, 'd'\)/);
    assert.match(JS, /setTimeout\(renderList, 180\)/);
  });

  test('wide directory keeps horizontal actions reachable', () => {
    assert.match(CSS, /\.cl-directory\s*\{[^}]*overflow-x:\s*auto/s);
    assert.doesNotMatch(CSS, /\.cl-directory\s*\{[^}]*overflow:\s*hidden/s);
  });

  test('behaviour: transport failure never renders an empty-school claim', () => {
    const nodes = directoryHarness({ loadFailed: true });
    assert.equal(nodes['kpi-active-classes'].textContent, 'Chưa đọc được');
    assert.match(nodes['list-empty'].textContent, /Không tải được danh sách lớp/);
    assert.equal(nodes['list-table-wrap'].hidden, true);
  });

  test('behaviour: student KPIs exclude archived classes', () => {
    const nodes = directoryHarness({ cohorts: [
      { id: 'active', name: 'Active', is_active: true, member_count: 4, unactivated_count: 1 },
      { id: 'archived', name: 'Archived', is_active: false, member_count: 9, unactivated_count: 7 },
    ] });
    assert.equal(nodes['kpi-total-students'].textContent, '4');
    assert.equal(nodes['kpi-unactivated'].textContent, '1');
  });
});

describe('Lớp & Học viên handcrafted workspace — class dialog and hierarchy', () => {
  test('class name is programmatically required', () => {
    assert.match(PAGE, /id="cf-name"[^>]*\brequired\b[^>]*aria-required="true"/);
  });

  test('back breadcrumb names its destination', () => {
    assert.match(PAGE, /<nav class="cl-back cl-breadcrumb" aria-label="Đường dẫn">/);
    assert.match(PAGE, /<a href="\/admin\/classes">Lớp &amp; Học viên<\/a>/);
    assert.match(PAGE, /<strong aria-current="page">Chi tiết lớp<\/strong>/);
  });

  test('class editor is a real form with native required validation', () => {
    assert.match(PAGE, /<form id="cohort-form">/);
    assert.match(PAGE, /id="btn-cf-submit" type="submit"/);
    assert.match(JS, /\$\('cohort-form'\)\.addEventListener\('submit'/);
  });

  test('sticky layers derive from the admin header token', () => {
    assert.match(CSS, /--cl-header-h:\s*var\(--admin-header-h, 68px\)/);
    assert.match(CSS, /top:\s*calc\(var\(--cl-header-h\) \+ var\(--cl-section-nav-h\)\)/);
  });

  test('detail tabs override the older two-class padding rule', () => {
    assert.match(CSS, /\.cl-shell \.adm-subtabs\[data-level="section"\]\s*\{/);
  });
});

describe('Lớp & Học viên handcrafted workspace — roster and progress', () => {
  test('detail header exposes canonical roster totals', () => {
    for (const id of ['detail-kpi-total', 'detail-kpi-activated', 'detail-kpi-unactivated']) {
      assert.match(PAGE, new RegExp(`id="${id}"`));
      assert.match(JS, new RegExp(`\\$\\('${id}'\\)\\.textContent`));
    }
  });

  test('roster has search, account filtering and a distinct no-match state', () => {
    for (const id of ['roster-search', 'roster-account-filter', 'roster-result-count', 'roster-filter-empty']) {
      assert.match(PAGE, new RegExp(`id="${id}"`));
    }
    assert.match(JS, /account === 'activated'/);
    assert.match(JS, /account === 'unactivated'/);
    assert.match(JS, /roster-filter-empty/);
  });

  test('behaviour: account filter renders only truthful matching rows', () => {
    const nodes = rosterHarness('unactivated');
    assert.doesNotMatch(nodes['roster-tbody'].innerHTML, /An/);
    assert.match(nodes['roster-tbody'].innerHTML, /Bình/);
    assert.equal(nodes['roster-result-count'].textContent, '1 / 2 học viên');
  });

  test('student drawer is closable and returns focus to the row control', () => {
    assert.match(JS, /data-action="close-drawer"/);
    assert.match(JS, /roster-drawer'\)\.addEventListener/);
    assert.match(JS, /previouslyPicked/);
    assert.match(JS, /if \(back\) back\.focus\(\)/);
  });

  test('drawer distinguishes unread progress from not-yet-requested progress', () => {
    assert.match(JS, /const progressRequested = _progressLoaded/);
    assert.match(JS, /Chưa đọc được tiến độ của học viên này/);
    assert.match(JS, /progressRequested \? punctualityCell\(null\) : '<span class="cl-skill-none">—<\/span>'/);
    assert.match(PAGE, /role="region" aria-labelledby="roster-drawer-title"/);
  });

  test('progress insight surface is a full workflow panel', () => {
    assert.match(PAGE, /id="tab-progress"[^>]*>Tiến độ 4 kỹ năng<\/button>/);
    assert.doesNotMatch(PAGE, /class="cl-lens"/);
    assert.match(PAGE, /Tín hiệu cần hành động/);
    assert.match(CSS, /#panel-progress\s*\{[^}]*padding:\s*var\(--cl-panel-pad\)/s);
  });
});

describe('Lớp & Học viên handcrafted workspace — lessons and assignments', () => {
  test('lesson timeline reports load failure separately from an empty syllabus', () => {
    assert.match(JS, /let _lessonsError = false/);
    assert.match(JS, /_lessonsError = true/);
    assert.match(JS, /retry-lessons/);
    assert.match(PAGE, /id="lessons-published-count"/);
    const nodes = lessonErrorHarness();
    assert.match(nodes['lessons-empty'].innerHTML, /Không đọc được/);
    assert.match(nodes['lessons-empty'].innerHTML, /retry-lessons/);
    assert.equal(nodes['lessons-count'].textContent, 'Chưa đọc được');
  });

  test('lesson editor is a structured native form', () => {
    assert.match(PAGE, /<form id="lesson-form">/);
    assert.match(PAGE, /id="lf-title"[^>]*required[^>]*aria-required="true"/);
    assert.match(PAGE, /id="btn-lf-submit" type="submit"/);
    assert.match(JS, /\$\('lesson-form'\)\.addEventListener\('submit'/);
  });

  test('assignment directory has operational summary and filters', () => {
    for (const id of [
      'homework-kpi-open', 'homework-kpi-due', 'homework-kpi-closed',
      'homework-search', 'homework-status-filter', 'homework-filter-empty',
    ]) assert.match(PAGE, new RegExp(`id="${id}"`));
    assert.match(JS, /const isDueSoon = \(a\)/);
    assert.match(JS, /setTimeout\(renderHomework, 180\)/);
  });

  test('behaviour: expired work is never counted or labelled as open', () => {
    const nodes = homeworkHarness([
      { id: 'past', title: 'Đã hết hạn', skill: 'speaking', due_at: '2020-01-01T00:00:00Z', status: 'published' },
      { id: 'open', title: 'Không hạn', skill: 'speaking', due_at: null, status: 'published' },
    ]);
    assert.equal(nodes['homework-kpi-open'].textContent, '1');
    assert.match(nodes['homework-tbody'].innerHTML, /Hết hạn/);
    assert.match(nodes['homework-tbody'].innerHTML, /Đang mở/);
    const filtered = homeworkHarness([
      { id: 'past', title: 'Đã hết hạn', skill: 'speaking', due_at: '2020-01-01T00:00:00Z', status: 'published' },
      { id: 'open', title: 'Không hạn', skill: 'speaking', due_at: null, status: 'published' },
    ], 'open');
    assert.doesNotMatch(filtered['homework-tbody'].innerHTML, /Đã hết hạn/);
  });

  test('assignment creation is a real four-step workflow', () => {
    for (const step of [1, 2, 3, 4]) {
      assert.match(PAGE, new RegExp(`data-hf-step="${step}"`));
      assert.match(PAGE, new RegExp(`data-step-indicator="${step}"`));
    }
    assert.match(JS, /function homeworkValidationMessage\(step\)/);
    assert.match(JS, /function renderHomeworkReview\(\)/);
    assert.match(JS, /function showHomeworkStep\(step/);
    assert.match(PAGE, /id="hf-review-recipients"/);
  });

  test('behaviour: course-only ranges are rejected on the content step', () => {
    assert.match(courseWizardValidation('45', ''), /50–100/);
    assert.match(courseWizardValidation('', '101'), /5–100/);
    assert.equal(courseWizardValidation('80', '20'), '');
  });

  test('wizard errors are announced and focused where they occur', () => {
    assert.match(PAGE, /id="hf-error" role="alert" tabindex="-1"/);
    assert.match(PAGE, /class="cl-wizard-footer"[\s\S]*id="hf-error"[\s\S]*class="adm-modal-actions cl-wizard-actions"/);
    assert.match(JS, /\$\('hf-error'\)\.scrollIntoView/);
    assert.match(JS, /\$\('hf-error'\)\.focus\(\)/);
    assert.match(CSS, /\.cl-wizard-panel\s*\{[^}]*flex:\s*0 0 auto/s);
    assert.match(CSS, /\.cl-wizard-footer\s*\{[^}]*position:\s*sticky[^}]*flex:\s*0 0 auto/s);
  });

  test('marking is an in-page workspace, not another modal', () => {
    assert.match(PAGE, /<section class="cl-marking" id="panel-marking"/);
    assert.match(PAGE, /Không gian chấm bài/);
    const detailStart = PAGE.indexOf('<main class="cl-shell" id="view-detail"');
    const detailEnd = PAGE.indexOf('</main>', detailStart);
    const marking = PAGE.indexOf('id="panel-marking"');
    assert.ok(marking > detailStart && marking < detailEnd, 'Nhận bài phải dùng cùng shell chi tiết lớp');
    const markingRule = CSS.match(/\.cl-marking\s*\{[^}]*\}/s);
    assert.ok(markingRule, 'thiếu luật bố cục cho Nhận bài');
    assert.match(markingRule[0], /width:\s*100%/);
    assert.doesNotMatch(markingRule[0], /max-width:/,
      'max-width sẽ làm Nhận bài lại hẹp hơn shell chi tiết lớp');
    assert.doesNotMatch(markingRule[0], /margin-(?:left|right):\s*auto/,
      'auto margin từng thuộc container độc lập và làm hai lề lệch hệ panel');
    assert.match(CSS, /\.cl-marking \.av-tally\s*\{[^}]*width:\s*100%[^}]*max-width:\s*none/s);
    assert.match(CSS, /\.cl-one__list\s*\{[^}]*overflow-y:\s*auto/s);
  });

  test('roster uses the full panel until the student drawer actually opens', () => {
    assert.match(PAGE, /class="cl-roster-split" data-drawer-open="false"/);
    assert.match(PAGE, /\.cl-roster-split\[data-drawer-open="true"\]\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 340px/s);
    assert.match(JS, /split\.dataset\.drawerOpen = 'false'/);
    assert.match(JS, /split\.dataset\.drawerOpen = 'true'/);
  });
});

describe('Lớp & Học viên handcrafted workspace — student directory', () => {
  test('directory header, KPI strip and explicit search label are present', () => {
    for (const id of ['student-kpi-total', 'student-kpi-unassigned', 'student-kpi-upcoming', 'search-input']) {
      assert.match(PAGE, new RegExp(`id="${id}"`));
    }
    assert.match(PAGE, /Danh bạ học viên/);
    assert.match(PAGE, /<label for="search-input">/);
  });

  test('behaviour: student KPI values are derived from the current canonical rows', () => {
    const today = new Date();
    const localToday = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
    const later = new Date(today.getTime() + 91 * 24 * 60 * 60 * 1000);
    const afterWindow = [later.getFullYear(), String(later.getMonth() + 1).padStart(2, '0'), String(later.getDate()).padStart(2, '0')].join('-');
    const nodes = studentDirectoryHarness([
      { id: 'a', student_code: 'A01', full_name: 'An', cohort_id: 'co-a', cohort_name: 'Lớp A', target_date: localToday },
      { id: 'b', student_code: 'B02', full_name: 'Bình', cohort_id: null, cohort_name: null, target_date: afterWindow },
    ]);
    assert.equal(nodes['student-kpi-total'].textContent, 2);
    assert.equal(nodes['student-kpi-unassigned'].textContent, 1);
    assert.equal(nodes['student-kpi-upcoming'].textContent, 1);
  });

  test('behaviour: a failed cohort-name lookup never counts an assigned student as unassigned', () => {
    const nodes = studentDirectoryHarness([
      { id: 'assigned', student_code: 'A01', full_name: 'An', cohort_id: 'co-a', cohort_name: null },
      { id: 'unassigned', student_code: 'B02', full_name: 'Bình', cohort_id: null, cohort_name: null },
    ]);
    assert.equal(nodes['student-kpi-unassigned'].textContent, 1);
  });

  test('student transport failure is a retryable table state, not an empty directory', () => {
    assert.match(STUDENTS_JS, /Không đọc được danh sách học viên/);
    assert.match(STUDENTS_JS, /data-act="retry"/);
    assert.match(STUDENTS_JS, /if \(act === 'retry'\)/);
  });

  test('student auth gate shows a real loading state before revealing protected content', () => {
    assert.match(PAGE, /id="state-ready" class="st-shell hidden"/);
    assert.match(STUDENTS_JS, /async function _boot\(\) \{\s*_hide\('state-ready'\);\s*_hide\('state-denied'\);\s*_show\('state-loading'\);/s);
    assert.match(STUDENTS_JS, /if \(!me \|\| me\.role !== 'admin'\) \{\s*_hide\('state-loading'\);/s);
  });

  test('date-only targets are parsed as local calendar dates', () => {
    assert.match(STUDENTS_JS, /\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(iso\) \? iso \+ 'T00:00:00'/);
    assert.match(STUDENTS_JS, /today\.setHours\(0, 0, 0, 0\)/);
  });

  test('bulk assignment remains canonical and can clear selection', () => {
    assert.match(PAGE, /id="bulk-clear"/);
    assert.match(STUDENTS_JS, /getElementById\('bulk-clear'\)\.addEventListener/);
    assert.match(STUDENTS_JS, /loadStudents\(\);\s*\/\/ refetch/);
  });

  test('student profile and editor use structured workflow surfaces', () => {
    assert.match(PAGE, /class="st-drawer-section"/);
    assert.match(PAGE, /class="adm-modal cl-form-dialog st-editor"/);
    assert.match(PAGE, /id="btn-st-close"/);
    assert.match(STUDENTS_JS, /saveBtn\.disabled = true/);
    assert.match(STUDENTS_JS, /finally \{\s*saveBtn\.disabled = false/s);
    assert.match(STUDENTS_JS, /_editorLastFocus/);
    assert.match(STUDENTS_JS, /modal\.querySelectorAll/);
  });

  test('compact student actions remain on one row after the later workspace stylesheet loads', () => {
    assert.match(CSS, /\.st-row-actions\s*\{[^}]*flex-wrap:\s*nowrap/s);
  });

  test('search responses are sequence-guarded before rendering KPIs and rows', () => {
    assert.match(STUDENTS_JS, /var _studentReqSeq = 0/);
    assert.match(STUDENTS_JS, /var seq = \+\+_studentReqSeq/);
    assert.match(STUDENTS_JS, /if \(seq !== _studentReqSeq\) return/);
  });
});
