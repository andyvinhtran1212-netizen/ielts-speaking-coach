import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assignmentSummary,
  defaultVietnamDueDate,
  dueParts,
  homeworkDraft,
  normalizeActionLog,
  normalizeAssignmentsPayload,
  normalizeCatalog,
  selectAssignments,
  validateHomeworkDraft,
} from '../lib/admin-class-homework-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const UI = read('app', '(authed-admin-classes)', 'admin', 'classes', '[cohortId]', 'admin-class-homework.tsx');
const SUBMISSIONS = read('app', '(authed-admin-classes)', 'admin', 'classes', '[cohortId]', 'admin-class-submissions.tsx');
const CSS = read('public', 'css', 'admin-class-homework-next.css');
const LAYOUT = read('app', '(authed-admin-classes)', 'layout.tsx');
const LEDGER = read('..', 'docs', 'ROUTE_LEDGER.md');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');

const catalog = [{ id: 'bank-1', title: 'Grammar 2', ready: true, already_given: false }];

describe('admin class homework model — canonical truth', () => {
  test('keeps unreadable progress unknown and exposes ledger reconciliation failure', () => {
    const payload = normalizeAssignmentsPayload({ reconcile_failed: true, assignments: [
      { id: 'a1', title: 'Bài một', skill: 'course', due_at: null, progress: null },
      { id: 'a2', title: 'Bài hai', skill: 'speaking', progress: { assigned: '3', submitted: '1', late: 0, missing: 0 } },
      { id: 'a3', title: 'Bài ba', skill: 'listening', progress: {} },
      { id: '', skill: 'course' },
    ] });
    assert.equal(payload.reconcile_failed, true);
    assert.equal(payload.assignments.length, 3);
    assert.equal(payload.assignments[0].progress, null);
    assert.deepEqual(payload.assignments[1].progress, { assigned: 3, submitted: 1, late: 0, missing: 0, no_account: 0 });
    assert.equal(payload.assignments[2].progress, null);
    assert.equal(normalizeAssignmentsPayload({ assignments: null }), null);
  });

  test('counts operational states and folds Vietnamese search text', () => {
    const now = Date.parse('2026-08-12T00:00:00Z');
    const rows = [
      { id: '1', title: 'Ngữ pháp', status: 'published', due_at: '2026-08-13T00:00:00Z', skill: 'course', content_config: {} },
      { id: '2', title: 'Đề nghe', status: 'published', due_at: '2026-08-10T00:00:00Z', skill: 'listening', content_config: {} },
      { id: '3', title: 'Đã đóng', status: 'archived', due_at: null, skill: 'speaking', content_config: {} },
    ];
    assert.deepEqual(assignmentSummary(rows, now), { open: 1, dueSoon: 1, closed: 1 });
    assert.deepEqual(selectAssignments(rows, { search: 'ngu phap' }, now).map((row) => row.id), ['1']);
    assert.deepEqual(selectAssignments(rows, { status: 'due-soon' }, now).map((row) => row.id), ['1']);
  });

  test('uses the 19:00 Vietnam cutoff and round-trips a Vietnam due time', () => {
    assert.equal(defaultVietnamDueDate(new Date('2026-08-12T11:59:00Z')), '2026-08-12');
    assert.equal(defaultVietnamDueDate(new Date('2026-08-12T12:01:00Z')), '2026-08-13');
    assert.deepEqual(dueParts('2026-08-12T12:30:00Z'), { date: '2026-08-12', time: '19:30' });
  });

  test('builds exact class/subset payloads and enforces course mastery rules', () => {
    const draft = { ...homeworkDraft(new Date('2026-08-12T01:00:00Z')), skill: 'course', title: 'Grammar 2', contentId: 'bank-1', recipientScope: 'subset', studentIds: ['s1'], passPct: '75', retakeSize: '20' };
    const valid = validateHomeworkDraft(draft, catalog);
    assert.equal(valid.ok, true);
    assert.deepEqual(valid.body.student_ids, ['s1']);
    assert.equal(valid.body.pass_pct, 75);
    assert.equal(valid.body.retake_size, 20);
    assert.equal(validateHomeworkDraft({ ...draft, studentIds: [] }, catalog).ok, false);
    assert.equal(validateHomeworkDraft({ ...draft, passPct: '49' }, catalog).ok, false);
    assert.equal(validateHomeworkDraft({ ...draft, retakeSize: '4' }, catalog).ok, false);
    assert.equal(validateHomeworkDraft({ ...draft, dueDate: '2026-99-31' }, catalog).ok, false);
    assert.equal(validateHomeworkDraft({ ...draft, dueTime: '25:90' }, catalog).ok, false);
    const whole = validateHomeworkDraft({ ...draft, recipientScope: 'class', studentIds: [] }, catalog);
    assert.equal(whole.body.student_ids, null);
  });

  test('manual Speaking selection must use the exact ready count', () => {
    const draft = { ...homeworkDraft(), title: 'Speaking', contentId: 'topic-1', questionMode: 'manual', questionIds: ['q1', 'q2'] };
    const topics = [{ id: 'topic-1', title: 'Home', ready: true, already_given: false }];
    const questions = [{ id: 'q1', ready: true }, { id: 'q2', ready: true }, { id: 'q3', ready: false }];
    assert.equal(validateHomeworkDraft(draft, topics, questions, 2).ok, true);
    assert.equal(validateHomeworkDraft({ ...draft, questionIds: ['q1'] }, topics, questions, 2).ok, false);
    assert.equal(validateHomeworkDraft({ ...draft, questionIds: ['q1', 'q3'] }, topics, questions, 2).ok, false);
  });

  test('does not turn a failed exam library into an empty catalog', () => {
    assert.equal(normalizeCatalog({ items: [], failed_kinds: ['listening'] }, 'exam', 'listening'), null);
    assert.deepEqual(normalizeCatalog({ items: [{ id: 'r1', title: 'R', status: 'published', exam_only: false }] }, 'exam', 'reading')[0].ready, true);
  });

  test('normalizes paginated action-log details without claiming failed reads are empty', () => {
    const log = normalizeActionLog({ actions: [{ action: 'due_change', created_at: '2026-08-12T00:00:00Z', details: { flips: { to_late: 2 } } }], has_more: true, next_before: 'cursor' });
    assert.equal(log.actions.length, 1);
    assert.equal(log.actions[0].details.flips.to_late, 2);
    assert.equal(log.has_more, true);
    assert.equal(normalizeActionLog({ actions: null }), null);
  });
});

describe('admin class homework — integration contracts', () => {
  test('owns assignment lifecycle and opens the native marking workspace', () => {
    assert.match(UI, /\/assignments`/);
    assert.match(UI, /assignments\/\$\{encodeURIComponent\(assignment\.id\)\}/);
    assert.match(UI, /\/backfill`/);
    assert.match(UI, /\/due`/);
    assert.match(UI, /\/action-log/);
    assert.match(UI, /onOpenSubmissions\?\.\(assignment\)/);
    assert.match(SUBMISSIONS, /\/assignments\/\$\{encodeURIComponent\(assignment\.id\)\}\/tally/);
    assert.doesNotMatch(UI, /pages\/admin\/classes\/index\.html\?cohort_id|markingHref/);
  });

  test('never exposes destructive delete when progress is unknown', () => {
    assert.match(UI, /progress == null \|\| progress\.submitted > 0 \? <button/);
    assert.match(UI, /backend vẫn kiểm lại trong transaction/);
  });

  test('recovers due conflicts from canonical current_due_at and groups radios natively', () => {
    assert.match(UI, /hasOwnProperty\.call\(detail, 'current_due_at'\)/);
    assert.match(UI, /assignment: \{ \.\.\.dueEditor\.assignment, due_at: current \}/);
    assert.match(UI, /name="ach-homework-kind"/);
    assert.match(UI, /name="ach-question-mode"/);
  });

  test('shows manual Speaking order and uses one exclusive audio preview', () => {
    assert.match(UI, /editor\.questionIds\.indexOf\(question\.id\)/);
    assert.match(UI, /<span className="sr-only">Thứ tự chọn <\/span>\{selectedOrder \+ 1\}/);
    assert.match(UI, /new Audio\(question\.audio_url\)/);
    assert.match(UI, /previewAudio\.current\?\.pause\(\)/);
    assert.match(UI, /aria-label=\{`\$\{previewingQuestion === question\.id \? 'Dừng nghe' : 'Nghe thử'\}: \$\{question\.text\}`\}/);
    assert.match(CSS, /\.ach-question-row \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto/);
  });

  test('ships responsive styling, CI browser coverage and an updated route claim', () => {
    assert.match(LAYOUT, /admin-class-homework-next\.css/);
    assert.match(CSS, /@media \(max-width: 768px\)/);
    assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(WORKFLOW, /verify-admin-class-homework-flow\.mjs/);
    assert.match(LEDGER, /tab=roster\|progress\|lessons\|homework/);
    assert.match(LEDGER, /homework \+ assignment-centric marking \+ student-centric cross-assignment work-history ownership/);
    assert.doesNotMatch(UI, /dangerouslySetInnerHTML|\.innerHTML|window\.confirm|alert\(/);
  });
});
