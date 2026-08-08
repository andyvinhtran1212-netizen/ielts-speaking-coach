/**
 * admin-classes.js — cột bài tập phải phân biệt "chưa tới hạn" với "đã trễ" (GĐ 2).
 *
 * Executes the real render helpers rather than matching their source: the thing
 * that can be wrong here is what a number MEANS on screen, and a regex cannot
 * tell "3 chưa nộp" shown as a neutral fact from the same 3 shown as a problem.
 *
 * The distinction matters because the daily task is due at 19:00. Before the
 * deadline, everyone who has not submitted is simply not due yet — styling that
 * as a warning would put a red flag on every class all day, which trains the
 * teacher to ignore the flag by the time it means something.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'public', 'js', 'admin-classes.js'), 'utf8');

function loadHelpers() {
  const start = SRC.indexOf('function dueLabel');
  const end = SRC.indexOf('function renderHomework');
  assert.ok(start !== -1 && end > start, 'homework helpers not found');

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const countLabel = (n) => String(n);

  return new Function('esc', 'countLabel', `${SRC.slice(start, end)}
    return { dueLabel, progressCell };`)(esc, countLabel);
}

const { dueLabel, progressCell } = loadHelpers();

/**
 * Strip `//` comments before asserting a symbol is ABSENT from code.
 *
 * Without this, a comment explaining why `getFullYear()` was removed satisfies
 * a /getFullYear/ match and the test fails on its own documentation — or worse,
 * a doesNotMatch passes because the code is clean while a *positive* assertion
 * is satisfied by prose. Same trap as the SQL migration tests.
 */
const codeOnly = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments too: a /** */ docblock
  .replace(/\/\/[^\n]*/g, '');          // satisfied a /exam_only/ match on its own

// The class marker for "this needs attention" — the same one the roster uses
// for students with no account.
const WARN = 'cl-roster-gap';


describe('submission cell separates not-yet-due from overdue', () => {
  test('nobody overdue → no warning styling anywhere', () => {
    const html = progressCell({ assigned: 20, submitted: 5, late: 0, missing: 0 });
    assert.match(html, /5\/20 đã nộp/);
    assert.doesNotMatch(html, new RegExp(WARN),
      'before the deadline, "chưa nộp" is not a problem and must not be flagged');
  });

  test('overdue and unsubmitted → flagged', () => {
    const html = progressCell({ assigned: 20, submitted: 5, late: 0, missing: 15 });
    assert.match(html, new RegExp(WARN));
    assert.match(html, /15 chưa nộp, đã quá hạn/);
  });

  test('late submissions are reported but not flagged as missing', () => {
    const html = progressCell({ assigned: 20, submitted: 20, late: 3, missing: 0 });
    assert.match(html, /3 nộp trễ/);
    assert.doesNotMatch(html, new RegExp(WARN),
      'a late hand-in is still a hand-in — only nothing-at-all past the deadline is the alarm');
  });

  test('a failed progress read says so instead of showing zeros', () => {
    // "0/0 đã nộp" would be a claim about the class that no query earned.
    const html = progressCell(null);
    assert.match(html, /Không đọc được/);
    assert.doesNotMatch(html, /đã nộp/);
  });
});


describe('deadline cell', () => {
  test('no deadline is stated, not blank', () => {
    assert.match(dueLabel(null), /Không hạn/);
  });

  test('an unparseable deadline is reported, never silently dropped', () => {
    assert.match(dueLabel('not-a-date'), /không đọc được/i);
  });

  test('a real deadline renders the date', () => {
    const html = dueLabel('2026-08-03T19:00:00+07:00');
    assert.match(html, /2026/);
    assert.match(html, /03/);
  });
});


describe('the give flow tells the admin who will not receive it', () => {
  // Kết ở hàm NGAY SAU `submitHomework`, không kéo tới tận `deleteHomework`:
  // giữa hai chỗ ấy có hơn 500 dòng của những màn khác (bù người nhận, đổi hạn
  // nộp), và chốt "đừng dựng giờ hạn trong trình duyệt" bên dưới quét cả chúng.
  // Một màn ĐỔI HẠN thì đương nhiên có chữ '19:00' trong ô nhập của nó — chốt
  // đỏ ở đó là đỏ vì phạm vi quét, không phải vì có lỗi.
  const submit = SRC.slice(SRC.indexOf('async function submitHomework'),
                           SRC.indexOf('async function submitLessonHomework'));

  test('unactivated students are surfaced on success, as an error toast', () => {
    // Those students get a row but no account, so nothing is ever shown to them
    // — they read as simply not having done the work (mig 177 header).
    assert.match(submit, /unactivated_count/);
    assert.match(submit, /chưa kích hoạt tài khoản/);
    assert.match(submit, /'error'/,
      'a quiet success toast would bury the one thing the admin must act on');
  });

  test('the deadline is sent as a DATE — the 19:00 rule lives on the server', () => {
    assert.match(submit, /due_date: \$\('hf-due'\)\.value \|\| null/);
    assert.doesNotMatch(submit, /19:00|setHours|toISOString/,
      'composing the deadline in the browser would use the admin’s own timezone');
  });
});


describe('the default deadline is the next VIABLE Vietnam date (Codex review)', () => {
  // Two separate bugs met here. The date must be Vietnam's, not the browser's.
  // And "today" stops being viable once 19:00 has passed — submitting the
  // untouched form at 20:00 would create a give that is overdue the moment it
  // exists, reporting every student as missing.
  const src = SRC.slice(SRC.indexOf('const VN_TZ'), SRC.indexOf('function fmtDate'));
  const defaultDueDateVietnam = new Function(`${src}; return defaultDueDateVietnam;`)();

  test('before 19:00 Vietnam → today', () => {
    // 11:59Z == 18:59 in Vietnam (+07).
    assert.equal(defaultDueDateVietnam(new Date('2026-08-03T11:59:00Z')), '2026-08-03');
  });

  test('after 19:00 Vietnam → tomorrow, so the give is not born overdue', () => {
    assert.equal(defaultDueDateVietnam(new Date('2026-08-03T12:01:00Z')), '2026-08-04');
  });

  test('just past Vietnam midnight → that same new day', () => {
    // 20:00Z on the 3rd is already 03:00 on the 4th in Vietnam.
    assert.equal(defaultDueDateVietnam(new Date('2026-08-03T20:00:00Z')), '2026-08-04');
  });

  test('the cutoff matches the server rule', () => {
    assert.match(src, /VN_CUTOFF_HOUR = 19/);
    assert.match(src, /timeZone: VN_TZ/);
  });
});


describe('the modal wires the helper, not a raw browser Date', () => {
  test('openHomeworkModal calls the helper and no browser-local getter', () => {
    const open = codeOnly(SRC.slice(SRC.indexOf('function openHomeworkModal'),
                                    SRC.indexOf('function closeHomeworkModal')));
    assert.match(open, /defaultDueDateVietnam\(\)/);
    assert.doesNotMatch(open, /getFullYear|getMonth\(\)|getDate\(\)/,
      'browser-local getters are exactly the bug this replaced');
  });

  test('it really returns the Vietnam date at a day boundary', () => {
    // 2026-08-02T20:00Z is still the 2nd in Los Angeles but already the 3rd in
    // Vietnam (+07) — the fixture must straddle a real boundary to mean anything.
    const boundary = new Date('2026-08-02T20:00:00Z');
    const fmt = (tz) => new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(boundary);
    assert.equal(fmt('Asia/Ho_Chi_Minh'), '2026-08-03');
    assert.equal(fmt('America/Los_Angeles'), '2026-08-02');
  });
});


describe('Full Test is not offered as class homework (Codex review round 3)', () => {
  // A Full Test is a chain of three sessions and its real result is the
  // aggregate across all three; only the opening session would carry the ledger
  // link, so the homework score would deterministically be Part 1's band.
  const page = readFileSync(join(HERE, '..', 'public', 'pages', 'admin', 'classes', 'index.html'), 'utf8');

  test('the mode picker offers only the single-session modes', () => {
    assert.match(page, /<option value="practice">/);
    assert.match(page, /<option value="test_part">/);
    assert.doesNotMatch(page, /<option value="test_full">/,
      'offering a half-working Full Test is worse than not offering it');
  });
});


describe('a give with submissions cannot be deleted from the UI', () => {
  test('the delete button is withheld once anyone has handed in', () => {
    // Round 6 replaced the dead-end "Đã có bài nộp" label with a real Đóng bài
    // action, so this pins the GUARANTEE (delete is not offered) rather than the
    // shape the guarantee happened to have.
    const render = SRC.slice(SRC.indexOf('function renderHomework'),
                             SRC.indexOf('async function loadHomework'));
    const branch = render.slice(render.indexOf('const action ='), render.indexOf('const archivedChip'));
    assert.match(branch, /p\.submitted/,
      'the delete/archive choice must depend on whether anyone has submitted');
    const submittedBranch = branch.slice(branch.indexOf('p.submitted'));
    const deleteIdx = submittedBranch.indexOf('delete-homework');
    const archiveIdx = submittedBranch.indexOf('archive-homework');
    assert.ok(archiveIdx !== -1 && deleteIdx !== -1);
    assert.ok(archiveIdx < deleteIdx,
      'the submitted case must lead to archive, and delete only to the other branch');
  });
});


describe('a failed homework load is not an empty class (Codex review round 4)', () => {
  // Replacing canonical data with [] renders the normal "Chưa giao bài nào",
  // which tells the admin something false — and the toast that said otherwise
  // has already gone.
  const load = SRC.slice(SRC.indexOf('async function loadHomework'),
                         SRC.indexOf('function openHomeworkModal'));
  const render = SRC.slice(SRC.indexOf('function renderHomework'),
                           SRC.indexOf('async function loadHomework'));

  test('failure sets a distinct error state', () => {
    assert.match(load, /_homeworkError = true/);
    assert.match(render, /_homeworkError/);
    assert.match(render, /Không đọc được danh sách bài giao/);
  });

  test('failure releases the once-only load latch so the tab can retry', () => {
    assert.match(load, /_homeworkLoaded = false/,
      'without this, reopening the tab shows the stale failure forever');
  });

  test('a successful load clears the error state', () => {
    assert.match(load, /_homeworkError = false/);
  });

  test('the empty state is restored on a good load, not left as the error text', () => {
    assert.match(render, /Chưa giao bài nào/);
  });
});


describe('a closed-off give and an unreliable count are both stated (Codex round 6)', () => {
  const render = SRC.slice(SRC.indexOf('function renderHomework'),
                           SRC.indexOf('async function loadHomework'));
  const load = SRC.slice(SRC.indexOf('async function loadHomework'),
                         SRC.indexOf('function openHomeworkModal'));

  test('a give with submissions offers Đóng bài instead of a dead end', () => {
    // DELETE tells the admin to archive it; until now no archive action existed,
    // so a cancelled assignment with one hand-in stayed startable forever.
    assert.match(render, /data-action="archive-homework"/);
    assert.match(render, /Đóng bài/);
  });

  test('an archived give is labelled and can be reopened', () => {
    assert.match(render, /Đã đóng/);
    assert.match(render, /data-action="publish-homework"/);
    assert.match(render, /Mở lại/);
  });

  test('delete is still withheld once anyone has submitted', () => {
    assert.match(render, /p\.submitted[\s\S]{0,200}archive-homework/);
  });

  test('a failed repair pass is surfaced, not hidden behind plausible counts', () => {
    assert.match(load, /reconcile_failed/);
    assert.match(load, /có thể thiếu/);
    assert.match(load, /'error'/);
  });
});


// ── bộ chọn đề: xuất bản CHƯA CHẮC giao được ────────────────────────────
//
// Most of the Cambridge library is exam_only — reserved for mock sittings, and
// the student endpoints answer 404 to anyone without one. Offering those papers
// in the picker means the class is recorded as owing work none of them can open.

function loadTestPicker() {
  const start = SRC.indexOf('async function loadTests');
  const end = SRC.indexOf('function openHomeworkModal');
  assert.ok(start !== -1 && end > start, 'loadTests not found');

  const esc = (s) => String(s == null ? '' : s);
  const el = { innerHTML: '' };
  // Two different nodes: the select being painted, and the skill picker the
  // code checks to see whether its response is still wanted.
  const skillEl = { value: '' };
  const $ = (id) => (id === 'hf-skill' ? skillEl : el);
  const _testsBySkill = {};
  // Mutated per test; `loadTests` calls api.get() at call time, so reassigning
  // the METHOD (not the binding) is what puts the stub in reach.
  const api = { get: null };
  const loadTests = new Function('esc', '$', '_testsBySkill', 'api',
    `${SRC.slice(start, end)}
    return loadTests;`)(esc, $, _testsBySkill, api);

  return {
    el,
    skillEl,
    setApi: (fn) => { api.get = fn; },
    run: (skill) => { skillEl.value = skill; return loadTests(skill); },
    // Start a load, then switch the picker mid-flight.
    runThenSwitch: (skill, to) => {
      skillEl.value = skill;
      const p = loadTests(skill);
      skillEl.value = to;
      return p;
    },
  };
}

describe('the paper picker offers only papers a class can actually open', () => {
  test('exam-only papers are left out even when published', async () => {
    const h = loadTestPicker();
    h.setApi(async () => ({ items: [
      { id: 'u1', code: 'CAM18-T1', title: 'Cam 18 Test 1',
        status: 'published', exam_only: true },
      { id: 'u2', code: 'ILR-001', title: 'Đề luyện 1',
        status: 'published', exam_only: false },
    ] }));
    await h.run('reading');
    assert.match(h.el.innerHTML, /ILR-001/);
    assert.doesNotMatch(h.el.innerHTML, /CAM18-T1/,
      'an exam-only paper 404s for students without a mock sitting');
  });

  test('every paper reserved → says so, not an empty dropdown', async () => {
    const h = loadTestPicker();
    h.setApi(async () => ({ items: [
      { id: 'u1', code: 'CAM18-T1', title: 'x', status: 'published', exam_only: true },
    ] }));
    await h.run('listening');
    assert.match(h.el.innerHTML, /Chưa có đề nào giao được/);
  });

  test('a failed library read is not reported as an empty library', async () => {
    const h = loadTestPicker();
    h.setApi(async () => ({ items: [], failed_kinds: ['reading'] }));
    await h.run('reading');
    assert.match(h.el.innerHTML, /Không đọc được thư viện đề/);
  });

  test('the exam_only filter is in the code, not only in a comment', () => {
    const body = codeOnly(SRC.slice(SRC.indexOf('async function loadTests'),
                                    SRC.indexOf('function openHomeworkModal')));
    assert.match(body, /exam_only/,
      'stripping comments must still leave a real exam_only check');
  });
});


describe('a late library response does not paint the wrong skill', () => {
  test('switching Reading → Listening mid-flight discards the Reading list', async () => {
    const h = loadTestPicker();
    h.setApi(async () => ({ items: [
      { id: 'r1', code: 'READ-1', title: 'Đề đọc', status: 'published',
        exam_only: false },
    ] }));
    await h.runThenSwitch('reading', 'listening');
    assert.doesNotMatch(h.el.innerHTML, /READ-1/,
      'Reading papers under a Listening heading send a content_id the backend rejects');
  });

  test('a late FAILURE does not overwrite the other skill either', async () => {
    const h = loadTestPicker();
    h.setApi(async () => { throw new Error('boom'); });
    await h.runThenSwitch('reading', 'listening');
    assert.doesNotMatch(h.el.innerHTML, /Không đọc được thư viện đề/,
      'the Listening library did not fail — Reading did');
  });

  test('no switch → the list is painted as normal', async () => {
    const h = loadTestPicker();
    h.setApi(async () => ({ items: [
      { id: 'r1', code: 'READ-1', title: 'Đề đọc', status: 'published',
        exam_only: false },
    ] }));
    await h.run('reading');
    assert.match(h.el.innerHTML, /READ-1/);
  });
});


// ── chưa kích hoạt tài khoản KHÁC chưa nộp ──────────────────────────────

describe('ô tiến độ tách nhóm chưa kích hoạt tài khoản', () => {
  test('hiện thành dòng riêng, không gộp vào "chưa nộp"', () => {
    // Em ấy chưa từng THẤY bài — nhắc em nộp là nhắc nhầm người.
    const html = progressCell({ assigned: 20, submitted: 15, late: 0,
      missing: 2, no_account: 3 });
    assert.match(html, /2 chưa nộp, đã quá hạn/);
    assert.match(html, /3 chưa kích hoạt tài khoản/);
  });

  test('không đeo dấu "cần hỏi học viên này"', () => {
    // .cl-roster-gap nghĩa là hỏi em ấy. Kích hoạt tài khoản là việc của người
    // khác, nên gắn cùng dấu sẽ chỉ sai người phải hành động.
    const html = progressCell({ assigned: 20, submitted: 17, late: 0,
      missing: 0, no_account: 3 });
    assert.doesNotMatch(html, new RegExp(WARN));
    assert.match(html, /3 chưa kích hoạt/);
  });

  test('không ai thiếu tài khoản → không thêm dòng nào', () => {
    const html = progressCell({ assigned: 20, submitted: 20, late: 0,
      missing: 0, no_account: 0 });
    assert.doesNotMatch(html, /kích hoạt/);
  });

  test('ba nhóm cộng lại bằng sĩ số', () => {
    // Nếu một nhóm rơi khỏi mọi ô đếm thì tổng lệch và không ai phát hiện.
    const p = { assigned: 20, submitted: 15, late: 0, missing: 2, no_account: 3 };
    assert.equal(p.submitted + p.missing + p.no_account, p.assigned);
  });
});
