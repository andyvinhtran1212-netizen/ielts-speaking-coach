import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  assignmentAction,
  nextDue,
  normalizeClassStartResponse,
  normalizeMyClassResponse,
  remainingLabel,
  rhythmDays,
} from '../lib/my-class-model.mjs';

const assignment = (overrides = {}) => ({
  item_id: 'item-1',
  state: 'assigned',
  submitted_at: null,
  score: null,
  passed_at: null,
  writing_expected: false,
  is_late: false,
  is_missing: false,
  assignment: {
    id: 'assignment-1',
    title: 'Grammar 2',
    skill: 'course',
    instructions: 'Làm đủ các chặng',
    due_at: '2026-08-17T12:00:00+00:00',
    content_config: { lesson_no: 2, test_title: 'Danh từ và lượng từ' },
  },
  ...overrides,
});

const payload = (overrides = {}) => ({
  has_class: true,
  class: { id: 'class-1', name: 'TUE–FRI', course: { code: 'C1', name: 'IELTS Foundation' } },
  student: { full_name: 'An', student_code: 'S1' },
  assignments: [assignment()],
  lessons: [{
    id: 'lesson-1', title: 'Buổi 2', lesson_no: 2, lesson_date: '2026-08-16',
    body_md: '**Danh từ**', attachments: [{ label: 'Tài liệu', url: 'https://example.com/a.pdf' }],
  }],
  progress: { total: 1, submitted: 0, todo: 1, missing: 0, late: 0, on_time_pct: null },
  ...overrides,
});

describe('canonical My Class snapshot boundary', () => {
  test('accepts a complete snapshot and preserves server truth', () => {
    const result = normalizeMyClassResponse(payload());
    assert.equal(result.hasClass, true);
    assert.equal(result.assignments[0].assignment.content.lessonNo, 2);
    assert.equal(result.progress.todo, 1);
    assert.deepEqual(result.warnings, []);
  });

  test('preserves two active classes and attributes each task to its class', () => {
    const second = assignment({ item_id: 'item-2', assignment: {
      ...assignment().assignment, id: 'assignment-2', cohort_id: 'class-2',
      cohort_name: 'SAT–SUN',
    } });
    const first = assignment({ assignment: {
      ...assignment().assignment, cohort_id: 'class-1', cohort_name: 'TUE–FRI',
    } });
    const result = normalizeMyClassResponse(payload({
      classes: [
        { id: 'class-1', name: 'TUE–FRI', course: { code: 'C1', name: 'Foundation' } },
        { id: 'class-2', name: 'SAT–SUN', course: { code: 'C2', name: 'Speaking' } },
      ],
      assignments: [first, second],
      progress: { total: 2, submitted: 0, todo: 2, missing: 0, late: 0, on_time_pct: null },
    }));
    assert.deepEqual(result.classes.map((item) => item.id), ['class-1', 'class-2']);
    assert.deepEqual(result.assignments.map((item) => item.assignment.cohortName),
      ['TUE–FRI', 'SAT–SUN']);
  });

  test('no class is an ordinary state', () => {
    assert.deepEqual(normalizeMyClassResponse({ has_class: false }), { hasClass: false });
  });

  test('a summary/list disagreement hides summary numbers instead of lying', () => {
    const result = normalizeMyClassResponse(payload({
      progress: { total: 1, submitted: 1, todo: 0, missing: 0, late: 0, on_time_pct: 100 },
    }));
    assert.equal(result.progress, null);
    assert.ok(result.warnings.includes('progress_contract'));
    assert.equal(result.assignments.length, 1);
  });

  test('one malformed assignment fails the whole assignment block visibly', () => {
    const result = normalizeMyClassResponse(payload({ assignments: [assignment(), { title: 'broken' }] }));
    assert.equal(result.assignments, null);
    assert.equal(result.progress, null);
    assert.ok(result.warnings.includes('assignments_contract'));
  });

  test('contradictory server-derived assignment states fail the whole block', () => {
    for (const broken of [
      assignment({ submitted_at: '2026-08-16T10:00:00Z', is_missing: true }),
      assignment({ submitted_at: null, is_late: true }),
    ]) {
      const result = normalizeMyClassResponse(payload({ assignments: [broken] }));
      assert.equal(result.assignments, null);
      assert.equal(result.progress, null);
      assert.ok(result.warnings.includes('assignments_contract'));
    }
  });

  test('a backend-degraded assignment block stays unknown, never empty', () => {
    const result = normalizeMyClassResponse(payload({
      assignments: [], progress: null, degraded: ['assignments'],
    }));
    assert.equal(result.assignments, null);
    assert.equal(result.progress, null);
    assert.ok(result.warnings.includes('assignments'));
  });

  test('unsafe attachment schemes remain inert even if old data escaped the backend guard', () => {
    const result = normalizeMyClassResponse(payload({
      lessons: [{
        id: 'lesson-1', title: 'Buổi 2', lesson_no: 2, lesson_date: null, body_md: '',
        attachments: [{ label: 'Không an toàn', url: 'javascript:alert(1)' }],
      }],
    }));
    assert.equal(result.lessons[0].attachments[0].url, null);
  });

  test('missing or malformed top-level identity fails closed', () => {
    assert.equal(normalizeMyClassResponse({}), null);
    assert.equal(normalizeMyClassResponse({ has_class: 'yes' }), null);
  });
});

describe('deadline helpers', () => {
  test('countdown formats the server instant without inventing a local deadline', () => {
    assert.equal(remainingLabel((2 * 3600 + 14 * 60) * 1000), '2 giờ 14 phút');
    assert.equal(remainingLabel(40_005), '40 giây');
    assert.equal(remainingLabel(-1), '0 giây');
  });

  test('nearest due excludes submitted and server-classified missing work', () => {
    const result = normalizeMyClassResponse(payload({
      assignments: [
        assignment({ item_id: 'late', is_missing: true, assignment: { ...assignment().assignment, id: 'a-late', due_at: '2026-08-15T12:00:00Z' } }),
        assignment({ item_id: 'next', assignment: { ...assignment().assignment, id: 'a-next', due_at: '2026-08-17T12:00:00Z' } }),
      ],
      progress: { total: 2, submitted: 0, todo: 1, missing: 1, late: 0, on_time_pct: null },
    }));
    assert.equal(nextDue(result.assignments).row.itemId, 'next');
  });

  test('rhythm uses Vietnam calendar days and marks today structurally', () => {
    const normalized = normalizeMyClassResponse(payload({
      assignments: [assignment({ is_missing: true })],
      progress: { total: 1, submitted: 0, todo: 0, missing: 1, late: 0, on_time_pct: null },
    }));
    const days = rhythmDays(normalized.assignments, new Date('2026-08-18T01:00:00Z'));
    assert.equal(days.length, 14);
    assert.equal(days.filter((day) => day.today).length, 1);
    assert.equal(days.find((day) => day.day === '2026-08-17')?.state, 'missing');
  });

  test('rhythm never overrides the canonical missing flag with the browser clock', () => {
    const normalized = normalizeMyClassResponse(payload());
    const days = rhythmDays(normalized.assignments, new Date('2026-08-18T01:00:00Z'));
    assert.equal(days.find((day) => day.day === '2026-08-17')?.state, 'none');
  });
});

describe('assignment start contract', () => {
  test('a submitted course item remains actionable as a result, not a new attempt', () => {
    const normalized = normalizeMyClassResponse(payload({
      assignments: [assignment({
        state: 'submitted', submitted_at: '2026-08-19T18:23:55Z', score: 50,
      })],
      progress: { total: 1, submitted: 1, todo: 0, missing: 0, late: 0, on_time_pct: 100 },
    }));
    assert.deepEqual(assignmentAction(normalized.assignments[0]), {
      kind: 'review', label: 'Xem kết quả',
    });
  });

  test('course review intent survives the strict start-response boundary', () => {
    assert.deepEqual(normalizeClassStartResponse({
      item_id: 'item-1', assignment_id: 'a', skill: 'course',
      bank_id: 'bank-1', review_only: true,
    }, 'item-1'), {
      kind: 'course', bankId: 'bank-1', itemId: 'item-1', reviewOnly: true,
    });
  });

  test('completed Speaking sessions go to canonical result, never a historical player', () => {
    assert.deepEqual(normalizeClassStartResponse({
      item_id: 'item-1', assignment_id: 'a', skill: 'speaking',
      result_session_id: 'done/1', renderer_affinity: 'legacy',
    }, 'item-1'), {
      kind: 'result', url: '/result?id=done%2F1',
    });
  });

  test('existing Speaking sessions keep their persisted stable renderer', () => {
    assert.deepEqual(normalizeClassStartResponse({
      item_id: 'item-1', assignment_id: 'a', skill: 'speaking', session_id: 'session-1',
      renderer_affinity: 'legacy',
    }, 'item-1'), {
      kind: 'stable-player', url: '/pages/practice.html?session_id=session-1',
    });
    assert.deepEqual(normalizeClassStartResponse({
      item_id: 'item-1', assignment_id: 'a', skill: 'speaking', session_id: 'session-2',
      renderer_affinity: 'next',
    }, 'item-1'), {
      kind: 'stable-player', url: '/practice/session?session_id=session-2',
    });
  });

  test('an unclaimed fresh Speaking session still asks runtime; N-1 sessions stay Legacy', () => {
    assert.deepEqual(normalizeClassStartResponse({
      item_id: 'item-1', assignment_id: 'a', skill: 'speaking', session_id: 'fresh',
      renderer_affinity: null,
    }, 'item-1'), {
      kind: 'player', surface: 'speaking', query: { session_id: 'fresh' },
    });
    assert.deepEqual(normalizeClassStartResponse({
      item_id: 'item-1', assignment_id: 'a', skill: 'speaking', session_id: 'old-backend',
    }, 'item-1'), {
      kind: 'stable-player', url: '/pages/practice.html?session_id=old-backend',
    });
    assert.equal(normalizeClassStartResponse({
      item_id: 'item-1', assignment_id: 'a', skill: 'speaking', session_id: 'bad',
      renderer_affinity: 'random',
    }, 'item-1'), null);
  });

  test('new Speaking sessions retain the server-authorized class identity', () => {
    assert.deepEqual(normalizeClassStartResponse({
      item_id: 'item-1', assignment_id: 'a', skill: 'speaking',
      session_params: { mode: 'practice', part: 2, topic: 'Home', class_assignment_item_id: 'item-1' },
    }, 'item-1'), {
      kind: 'create-speaking',
      body: { mode: 'practice', part: 2, topic: 'Home', class_assignment_item_id: 'item-1' },
    });
  });

  test('canonical Reading/Listening response semantics enter runtime admission', () => {
    assert.deepEqual(normalizeClassStartResponse({
      item_id: 'item-1', assignment_id: 'a', skill: 'reading',
      player_surface: 'reading_exam',
      player_query: { test_id: 'CAM19-T3', class_item: 'item-1' },
      open_url: '/core-player/launch?surface=reading_exam&test_id=CAM19-T3&class_item=item-1',
    }, 'item-1'), {
      kind: 'admission',
      url: '/core-player/launch?surface=reading_exam&test_id=CAM19-T3&class_item=item-1',
    });
    assert.deepEqual(normalizeClassStartResponse({
      item_id: 'item-1', assignment_id: 'a', skill: 'listening',
      player_surface: 'listening_test',
      player_query: { id: 'test-7', class_item: 'item-1' },
      open_url: '/core-player/launch?surface=listening_test&id=test-7&class_item=item-1',
    }, 'item-1'), {
      kind: 'admission',
      url: '/core-player/launch?surface=listening_test&id=test-7&class_item=item-1',
    });
  });

  test('legacy N-1 Reading/Listening response URLs re-enter runtime admission', () => {
    assert.deepEqual(normalizeClassStartResponse({
      item_id: 'item-1', assignment_id: 'a', skill: 'reading',
      open_url: '/pages/reading-exam.html?test_id=CAM19-T3&class_item=item-1',
    }, 'item-1'), {
      kind: 'admission',
      url: '/core-player/launch?surface=reading_exam&test_id=CAM19-T3&class_item=item-1',
    });
    assert.deepEqual(normalizeClassStartResponse({
      item_id: 'item-1', assignment_id: 'a', skill: 'listening',
      open_url: '/pages/listening-test.html?id=test-7&class_item=item-1',
    }, 'item-1'), {
      kind: 'admission',
      url: '/core-player/launch?surface=listening_test&id=test-7&class_item=item-1',
    });
  });

  test('foreign, mismatched and unrecognized destinations fail closed', () => {
    assert.equal(normalizeClassStartResponse({
      item_id: 'item-1', assignment_id: 'a', skill: 'reading',
      player_surface: 'listening_test',
      player_query: { id: 'test-7', class_item: 'item-1' },
    }, 'item-1'), null);
    assert.equal(normalizeClassStartResponse({
      item_id: 'item-1', assignment_id: 'a', skill: 'reading',
      player_surface: 'reading_exam',
      player_query: { test_id: 'CAM19-T3', class_item: 'other' },
    }, 'item-1'), null);
    assert.equal(normalizeClassStartResponse({
      item_id: 'item-1', assignment_id: 'a', skill: 'reading',
      player_surface: 'reading_exam',
      player_query: { test_id: 'CAM19-T3', class_item: 'item-1', extra: 'unsafe' },
    }, 'item-1'), null);
    assert.equal(normalizeClassStartResponse({
      item_id: 'item-1', assignment_id: 'a', skill: 'reading',
      open_url: 'https://evil.example/pages/reading-exam.html?test_id=x&class_item=item-1',
    }, 'item-1'), null);
    assert.equal(normalizeClassStartResponse({
      item_id: 'other', assignment_id: 'a', skill: 'course', bank_id: 'bank-1',
    }, 'item-1'), null);
  });
});

describe('native route ownership', () => {
  const workspace = readFileSync(new URL('../app/(authed-my-class)/my-class/my-class-workspace.tsx', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../app/(authed-my-class)/my-class/page.tsx', import.meta.url), 'utf8');
  const layout = readFileSync(new URL('../app/(authed-my-class)/layout.tsx', import.meta.url), 'utf8');
  const chrome = readFileSync(new URL('../public/js/components/aver-chrome.js', import.meta.url), 'utf8');
  const home = readFileSync(new URL('../app/(authed-home)/home/page-shell.tsx', import.meta.url), 'utf8');
  const course = readFileSync(new URL('../app/(authed)/course-exercises/page-shell.tsx', import.meta.url), 'utf8');
  const ledger = readFileSync(new URL('../../docs/ROUTE_LEDGER.md', import.meta.url), 'utf8');

  test('React owns the route behavior; rollback JS is not mounted', () => {
    assert.match(page, /MyClassWorkspace/);
    assert.doesNotMatch(workspace, /my-class\.js/);
    assert.match(workspace, /normalizeMyClassResponse/);
    assert.match(workspace, /useAuth/);
    assert.match(workspace, /startingItemRef\.current/,
      'the lock must close synchronously before React can rerender two duplicate controls');
    assert.match(workspace, /stateAccount !== accountKey/,
      'an account switch must hide the previous private snapshot before effects run');
    assert.match(workspace, /accountRef\.current !== owner/,
      'a response started by the previous account must never install its snapshot');
    assert.match(workspace, /catch \(caught\) \{\s+if \(accountRef\.current !== owner\) return;/,
      'a failed old-account mutation must not toast into the new account');
    assert.match(layout, /\/js\/toast\.js/,
      'start errors must have the global toast implementation the workspace calls');
    assert.match(workspace, /Hạn nộp đã đóng\. Liên hệ giảng viên nếu bạn cần được mở lại bài\./,
      'bài quá hạn không có action phải nói rõ bước tiếp theo thay vì kết thúc cụt');
  });

  test('all canonical inbound links use the clean route', () => {
    for (const source of [chrome, home, course]) assert.match(source, /(?:href=|href_matches: )['"]\/my-class['"]/);
    assert.doesNotMatch(chrome, /href="\/pages\/my-class\.html"/);
  });

  test('player navigation is affinity-aware and the ledger names rollback explicitly', () => {
    assert.match(workspace, /admitCorePlayer/);
    assert.match(workspace,
      /target\.surface === 'speaking'[\s\S]*?await resolveCorePlayerAdmissionForNavigation/,
      'Next Speaking admission should resolve runtime policy without a document redirect');
    assert.match(workspace, /router\.push\(destination\)/,
      'resolved Next Speaking destinations should stay inside the App Router shell');
    assert.match(workspace,
      /destination\.startsWith\('\/practice\/session\?\'\)\) router\.push\(destination\);[\s\S]*?else window\.location\.assign\(destination\)/,
      'a runtime rollback decision must still hard-navigate to the Legacy renderer');
    assert.match(workspace, /target\.url\.startsWith\('\/practice\/session\?'\)\) router\.push/,
      'a stable Next Speaking session should navigate without a document reload');
    assert.match(workspace, /else window\.location\.assign\(target\.url\)/,
      'persisted Legacy affinity must keep the hard-navigation rollback path');
    assert.match(workspace, /target\.kind === 'result'[\s\S]*?router\.push\(target\.url\)/,
      'completed class Speaking should reach the native result without a reload');
    assert.match(ledger, /\| `\/my-class` \| `\/pages\/my-class\.html` remains rollback\/parity target/);
  });
});
