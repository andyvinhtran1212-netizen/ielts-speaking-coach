import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  latestSkillActivity,
  lessonDraft,
  normalizeLessonsPayload,
  normalizeProgressPayload,
  normalizeRosterPayload,
  rosterSummary,
  selectRoster,
  validateLessonDraft,
} from '../lib/admin-class-detail-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-classes)', 'admin', 'classes', '[cohortId]', 'page.tsx');
const DETAIL = read('app', '(authed-admin-classes)', 'admin', 'classes', '[cohortId]', 'admin-class-detail.tsx');
const DIRECTORY = read('app', '(authed-admin-classes)', 'admin', 'classes', 'admin-classes-directory.tsx');
const LAYOUT = read('app', '(authed-admin-classes)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-class-detail-next.css');
const LEDGER = read('..', 'docs', 'ROUTE_LEDGER.md');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');
const BROWSER = read('tooling', 'verify-admin-class-detail-flow.mjs');

describe('/admin/classes/[cohortId] — native ownership', () => {
  test('uses the admin gate and the directory enters the native route', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /<AdminClassDetail cohortId=\{cohortId\}/);
    assert.match(DIRECTORY, /href=\{`\/admin\/classes\/\$\{encodeURIComponent\(cohort\.id\)\}`\}/);
    assert.doesNotMatch(DIRECTORY, /pages\/admin\/classes\/index\.html\?cohort_id/);
  });

  test('keeps roster, progress and lessons as independent canonical reads', () => {
    assert.match(DETAIL, /Promise\.allSettled/);
    assert.match(DETAIL, /\/members`/);
    assert.match(DETAIL, /\/lessons`/);
    assert.match(DETAIL, /\/progress`/);
    assert.match(DETAIL, /const \[rosterError/);
    assert.match(DETAIL, /const \[lessonsError/);
    assert.match(DETAIL, /const \[progressError/);
    assert.match(DETAIL, /await loadOverview\(true\)/);
    assert.match(DETAIL, /await loadLessons\(true\)/);
  });

  test('owns homework natively while marking stays an explicit legacy seam', () => {
    assert.match(DETAIL, /<AdminClassHomework/);
    assert.match(DETAIL, /Nhận bài & Chấm bài/);
    assert.match(DETAIL, /pages\/admin\/classes\/index\.html\?cohort_id/);
    assert.doesNotMatch(DETAIL, /openMarking|marking-title/);
  });

  test('ships contained tables, responsive reflow, focus-safe dialogs and reduced motion', () => {
    assert.match(CSS, /\.acx-progress-table\s*\{[^}]*min-width/s);
    assert.match(CSS, /@media \(max-width: 768px\)/);
    assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(LAYOUT, /admin-class-detail-next\.css/);
    assert.match(LEDGER, /`\/admin\/classes\/\[cohortId\]`[^\n]+native detail \+ homework assignment lifecycle ownership/);
    assert.match(WORKFLOW, /node tooling\/verify-admin-class-detail-flow\.mjs/);
    assert.match(BROWSER, /unexpectedWrites/);
    assert.doesNotMatch(DETAIL, /dangerouslySetInnerHTML|\.innerHTML|window\.confirm|alert\(/);
  });

  test('uses a complete tab contract while keeping the legacy workspace a link', () => {
    assert.match(DETAIL, /role="tablist"/);
    assert.match(DETAIL, /aria-controls=\{tab === value \? `acx-panel-\$\{value\}` : undefined\}/);
    assert.match(DETAIL, /aria-labelledby="acx-tab-roster"/);
    assert.match(DETAIL, /event\.key === 'ArrowRight'/);
    assert.match(DETAIL, /event\.key === 'Home'/);
    assert.match(DETAIL, /className="acx-legacy-workspace"/);
    assert.match(BROWSER, /deep-link tab được khôi phục/);
    assert.match(BROWSER, /xếp học viên làm mới tiến độ chuẩn/);
    assert.match(BROWSER, /progress lỗi liên tục chỉ fetch một lần/);
    assert.match(DETAIL, /!lessonsLoading && !lessonsError/);
    assert.match(DETAIL, /!progressLoading && !progressError/);
    assert.match(DETAIL, /setProgressLoading\(false\)/);
  });

  test('does not encode below-target status by color alone', () => {
    assert.match(DETAIL, /dưới mục tiêu \{target\}/);
    assert.match(DETAIL, /aria-label=\{`Các band gần đây:/);
    assert.match(CSS, /\.acx-below-target/);
  });
});

describe('admin class detail model — canonical truth', () => {
  const payload = normalizeRosterPayload({
    cohort: { id: 'c1', name: '<img>', course_id: 'course-1', is_active: true },
    members: [
      { student_id: 's1', student_code: 'A1', name: 'Andy', user_id: 'u1', sessions: '3', ai_cost_usd: '1.25' },
      { student_id: 's2', student_code: 'B2', name: 'Bình', user_id: null, sessions: null, ai_cost_usd: null },
      { name: 'missing id' },
    ],
  }, 'c1');

  test('normalizes roster without turning failed usage fields into zero', () => {
    assert.equal(payload.cohort.name, '<img>');
    assert.equal(payload.members.length, 2);
    assert.equal(payload.members[0].sessions, 3);
    assert.equal(payload.members[1].sessions, null);
    assert.equal(payload.discarded_member_count, 1);
    assert.deepEqual(rosterSummary(payload.members), { total: 2, activated: 1, unactivated: 1 });
    assert.equal(selectRoster(payload.members, { search: 'b2', account: 'unactivated' }).length, 1);
  });

  test('rejects malformed or cross-cohort roster payloads instead of inventing an active class', () => {
    assert.equal(normalizeRosterPayload({ members: [] }, 'c1'), null);
    assert.equal(normalizeRosterPayload({ cohort: { id: 'other' }, members: [] }, 'c1'), null);
    assert.equal(normalizeRosterPayload({ cohort: { id: 'c1' }, members: null }, 'c1'), null);
  });

  test('drops unsafe historical attachment schemes at the display boundary', () => {
    const lessons = normalizeLessonsPayload({ lessons: [{
      id: 'l1', title: 'Buổi 1', attachments: [
        { label: 'Tốt', url: 'https://example.com/doc' },
        { label: 'Xấu', url: 'javascript:alert(1)' },
      ],
    }] });
    assert.deepEqual(lessons[0].attachments, [
      { label: 'Tốt', url: 'https://example.com/doc', is_safe: true },
      { label: 'Xấu', url: 'javascript:alert(1)', is_safe: false },
    ]);
  });

  test('lesson edits send explicit nulls and reject half-filled or unsafe files', () => {
    const draft = lessonDraft({ id: 'l1', title: 'Buổi 1', lesson_no: 2, lesson_date: '2026-08-12', body_md: 'x', attachments: [], is_published: true });
    draft.lessonNo = '';
    draft.lessonDate = '';
    draft.body = '';
    const untouched = validateLessonDraft(draft);
    assert.equal(untouched.ok, true);
    assert.equal('attachments' in untouched.body, false);
    draft.attachmentsTouched = true;
    const valid = validateLessonDraft(draft);
    assert.equal(valid.ok, true);
    assert.equal(valid.body.lesson_no, null);
    assert.equal(valid.body.lesson_date, null);
    assert.equal(valid.body.body_md, null);
    assert.equal(validateLessonDraft({ ...draft, attachments: [{ label: 'Tên', url: '' }] }).error, 'Tài liệu 1 cần đủ tên và đường dẫn.');
    assert.match(validateLessonDraft({ ...draft, attachments: [{ label: 'Tên', url: 'javascript:x' }] }).error, /Tài liệu 1 dùng liên kết cũ/);
  });

  test('preserves degraded progress cells as null and finds newest activity', () => {
    const progress = normalizeProgressPayload({ students: [{
      student_id: 's1', name: 'A', activated: true,
      skills: { speaking: null, writing: { attempts: 2, last_activity: '2026-08-10T00:00:00Z', recent_bands: [6, 6.5] }, reading: { attempts: 1, last_activity: '2026-08-12T00:00:00Z' }, listening: { attempts: 0 } },
      homework: null,
    }], degraded: ['speaking', 'homework'] });
    assert.equal(progress.students[0].skills.speaking, null);
    assert.equal(progress.students[0].homework, null);
    assert.equal(latestSkillActivity(progress.students[0].skills), '2026-08-12T00:00:00Z');
    assert.equal(latestSkillActivity({ a: { last_activity: '2026-08-12T08:00:00+07:00' }, b: { last_activity: '2026-08-12T02:00:00Z' } }), '2026-08-12T02:00:00Z');
    assert.equal(latestSkillActivity({ a: { last_activity: 'not-a-date' } }), null);
  });
});
