import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ADMIN_GRADE_SECTIONS,
  adminGradeActionState,
  adminGradeRequestKey,
  classifyInstructorReview,
  parseAdminGradeDraft,
  readAdminGradeQueue,
  selectKeyedAdminState,
} from '../lib/admin-writing-grade-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-writing-grade)', 'admin', 'writing', 'grade', 'page.tsx');
const LAYOUT = read('app', '(authed-admin-writing-grade)', 'layout.tsx');
const BEHAVIOR = read('app', '(authed-admin-writing-grade)', 'admin', 'writing', 'grade', 'writing-grade-behavior.tsx');
const GATE = read('components', 'admin-access-gate.tsx');
const SHELL = read('components', 'authed-shell.tsx');
const LEGACY = read('pages', 'admin', 'writing', 'grade.html');
const CONFIG = read('next.config.ts');
const PAIRS = JSON.parse(read('tooling', 'parity-pairs-authed.json'));
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');
const WRITE_FLOW_NAMES = [
  'admin-writing-grade-save-deliver.mjs',
  'admin-writing-grade-revoke.mjs',
  'admin-writing-grade-regrade.mjs',
  'admin-writing-grade-instructor-warning.mjs',
  'admin-writing-grade-save-next-failure.mjs',
  'admin-writing-grade-instructor-deliver-failure.mjs',
];

describe('/admin/writing/grade — native ownership + admin boundary', () => {
  test('owns the canonical route and keeps rollback HTML', () => {
    assert.match(PAGE, /AdminWritingGradeBehavior/);
    assert.doesNotMatch(CONFIG, /source:\s*['"]\/admin\/writing\/grade['"]/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'writing', 'grade.html')));
  });

  test('uses the canonical admin shell with the measured legacy cascade', () => {
    assert.match(LAYOUT, /<AuthedShell/);
    assert.match(LAYOUT, /chrome="admin"/);
    assert.match(LAYOUT, /utilityLayer=\{false\}/);
    assert.match(LAYOUT, /tailwindLayer/);
    const order = ['admin-surface.css', 'admin-writing.css', 'admin-writing-grade.css', 'image-lightbox.css'];
    let cursor = -1;
    for (const item of order) { const index = LAYOUT.indexOf(item); assert.ok(index > cursor, `${item} cascade`); cursor = index; }
    assert.match(SHELL, /aver-admin-chrome\.js/);
    assert.match(LAYOUT, /dataAverAdminSurface: true/);
    assert.match(SHELL, /data-aver-admin-surface=\{dataAverAdminSurface\}/);
    assert.match(read('public', 'css', 'aver-design', 'components.css'), /\.av-toast\.is-show/);
  });

  test('fails closed through account-keyed /auth/me role truth', () => {
    assert.match(GATE, /status === 'signed-out'/);
    assert.match(GATE, /window\.location\.replace\('\/login'\)/);
    assert.match(GATE, /window\.api\.get<AdminProfile>\('\/auth\/me'\)/);
    assert.match(GATE, /profile\?\.role === 'admin'/);
    assert.match(GATE, /selectKeyedAdminState\(accessState, accountKey\)/);
    assert.match(GATE, /phase: 'denied'/);
  });
});

describe('/admin/writing/grade — state + persistence contract', () => {
  test('preserves all 13 editable feedback sections and shared renderers', () => {
    assert.equal(ADMIN_GRADE_SECTIONS.length, 13);
    assert.match(BEHAVIOR, /WritingRenderers\?\.SECTION_RENDERERS/);
    assert.match(BEHAVIOR, /parseAdminGradeDraft/);
    assert.match(BEHAVIOR, /dirty: true/);
    assert.match(BEHAVIOR, /beforeunload/);
  });

  test('keeps canonical read/save/note/render/export endpoints', () => {
    for (const needle of [
      '/admin/writing/essays/${encodeURIComponent(essayId)}',
      '/feedback`', '/instructor-note`', '/render`', '/export.docx`',
    ]) assert.ok(BEHAVIOR.includes(needle), `missing ${needle}`);
    assert.match(BEHAVIOR, /Authorization: `Bearer \$\{token\}`/);
    assert.match(BEHAVIOR, /Content-Disposition/);
    assert.match(BEHAVIOR, /Sửa: Note giảng viên[\s\S]*?maxLength=\{5000\}/);
  });

  test('keeps reviewed→delivered→reviewed and regrade transitions', () => {
    assert.match(BEHAVIOR, /\/mark-delivered`/);
    assert.match(BEHAVIOR, /hide_subbands: hideScores/);
    assert.match(BEHAVIOR, /\/revoke-delivery`/);
    assert.match(BEHAVIOR, /\/regrade`/);
    assert.match(BEHAVIOR, /analysis_level: level/);
    assert.match(BEHAVIOR, /Regrade sẽ XÓA chỉnh sửa chưa lưu/);
  });

  test('preserves rating, instructor ownership and queue save-next', () => {
    assert.match(BEHAVIOR, /\/grade-rating`/);
    assert.match(BEHAVIOR, /\/admin\/instructor\/queue\?/);
    assert.match(BEHAVIOR, /\/admin\/instructor\/reviews\/\$\{encodeURIComponent\(review\.id\)\}\/deliver/);
    assert.match(BEHAVIOR, /\/admin\/instructor\/reviews\/\$\{encodeURIComponent\(review\.id\)\}\/release/);
    assert.match(BEHAVIOR, /if \(!await saveAll\(\)\) return/);
    assert.match(BEHAVIOR, /queue\?\.nextId/);
    assert.match(BEHAVIOR, /instructor-context-warning/);
    assert.match(BEHAVIOR, /Không tải được trạng thái instructor/);
    assert.match(BEHAVIOR, /Lỗi deliver: \$\{messageOf\(caught\)\}/);
    assert.match(BEHAVIOR, /Lỗi release: \$\{messageOf\(caught\)\}/);
    assert.match(BEHAVIOR, /Lỗi lưu note: \$\{messageOf\(caught\)\}/);
    assert.match(LEGACY, /panel\.classList\.remove\('hidden', 'locked', 'delivered'\)/);
  });

  test('blocks rapid duplicate mutations and hides stale account data', () => {
    assert.match(BEHAVIOR, /mutationRef\.current\.has\(name\)/);
    assert.match(BEHAVIOR, /mutationRef\.current\.add\(name\)/);
    assert.match(BEHAVIOR, /mutationRef\.current\.delete\(name\)/);
    assert.match(BEHAVIOR, /selectKeyedAdminState\(gradeState, requestKey\)/);
    assert.match(BEHAVIOR, /return \(\) => \{ dead = true; \}/);
    assert.match(BEHAVIOR, /setTimeout\(\(\) => URL\.revokeObjectURL\(url\), 1000\)/);
  });

  test('registers denied-state parity without overstating grading coverage', () => {
    const pair = PAIRS.find((candidate) => candidate.name === 'admin-writing-grade-denied');
    assert.deepEqual([pair?.legacy, pair?.next], ['/pages/admin/writing/grade.html', '/admin/writing/grade']);
    assert.match(pair.note, /không có role admin/);
    assert.match(pair.note, /browser write-flow/);
    assert.match(WORKFLOW, /authed-admin-writing-grade/);
  });

  test('covers success and destructive/inconsistent browser paths on both implementations', () => {
    for (const filename of WRITE_FLOW_NAMES) {
      const flow = read('tooling', 'write-flows', filename);
      assert.match(flow, /legacyRoute:/, `${filename} must run against rollback HTML too`);
      assert.match(flow, /waitForWrites:/, `${filename} must synchronize on a real mutation`);
    }
  });
});

describe('admin Writing grade pure model', () => {
  test('parses string, JSON, empty and invalid drafts deterministically', () => {
    assert.deepEqual(parseAdminGradeDraft('abc', true), { ok: true, value: 'abc' });
    assert.deepEqual(parseAdminGradeDraft('  ', false), { ok: true, value: null });
    assert.deepEqual(parseAdminGradeDraft('{"x":1}', false), { ok: true, value: { x: 1 } });
    assert.equal(parseAdminGradeDraft('{', false).ok, false);
  });

  test('pins backend state guards', () => {
    assert.deepEqual(adminGradeActionState('graded'), { canSave: true, canDeliver: false, canRevoke: false });
    assert.deepEqual(adminGradeActionState('reviewed'), { canSave: true, canDeliver: true, canRevoke: false });
    assert.deepEqual(adminGradeActionState('delivered'), { canSave: false, canDeliver: false, canRevoke: true });
  });

  test('keys private views and classifies instructor ownership', () => {
    assert.equal(adminGradeRequestKey('a', ''), 'a:__missing__');
    const privateState = { key: 'a:e1', value: { phase: 'ready', secret: 'A' } };
    assert.equal(selectKeyedAdminState(privateState, 'a:e1').secret, 'A');
    assert.deepEqual(selectKeyedAdminState(privateState, 'b:e1'), { phase: 'loading' });
    assert.equal(classifyInstructorReview({ status: 'claimed', claimed_by: 'a' }, 'a').kind, 'mine');
    assert.equal(classifyInstructorReview({ status: 'claimed', claimed_by: 'b' }, 'a').kind, 'locked');
    assert.equal(classifyInstructorReview({ status: 'edited', claimed_by: 'a' }, 'a').kind, 'mine');
    assert.equal(classifyInstructorReview({ status: 'edited', claimed_by: 'b' }, 'a').kind, 'locked');
  });

  test('recomputes queue position from essay id instead of trusting a stale index', () => {
    assert.deepEqual(readAdminGradeQueue(JSON.stringify({ ids: ['a', 'b'], i: 99 }), 'a'), { inQueue: true, nextId: 'b' });
    assert.deepEqual(readAdminGradeQueue(JSON.stringify({ ids: ['a', 'b'] }), 'b'), { inQueue: true, nextId: null });
    assert.equal(readAdminGradeQueue('{', 'a'), null);
  });
});
