/**
 * my-class.js — trang "Lớp của tôi" phía học viên (GĐ 3).
 *
 * Executes the real helpers rather than matching source, because what can be
 * wrong here is what a number or a label MEANS to the student:
 *
 *   * A countdown must count down to the instant the server sent, not to a
 *     locally-reconstructed 19:00 — a learner abroad would otherwise see the
 *     wrong remaining time for the right deadline.
 *   * "Không có bài nào" must never appear because a request failed. Telling a
 *     student they owe nothing when they do is the one thing this page cannot
 *     get wrong.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'public', 'js', 'my-class.js'), 'utf8');
const PAGE = readFileSync(join(HERE, '..', 'public', 'pages', 'my-class.html'), 'utf8');
const MY_CLASS_CSS = readFileSync(join(HERE, '..', 'public', 'css', 'my-class.css'), 'utf8');
const HOME_JS = readFileSync(join(HERE, '..', 'public', 'js', 'home.js'), 'utf8');

/** Strip `//` comments before asserting a symbol is ABSENT — a comment
 *  explaining why something was removed otherwise satisfies the match. */
const codeOnly = (s) => s.replace(/\/\/[^\n]*/g, '');

function loadHelpers() {
  const start = SRC.indexOf('function remainingLabel');
  const end = SRC.indexOf('function itemRow');
  assert.ok(start !== -1 && end > start, 'helper block not found');
  const esc = (s) => String(s == null ? '' : s);
  return new Function('esc', `${SRC.slice(start, end)}
    return { remainingLabel, dueLabel, submittedLabel, taskSub };`)(esc);
}

function loadNextDue() {
  const start = SRC.indexOf('function nextDue');
  const end = SRC.indexOf('function renderCountdown');
  return new Function(`${SRC.slice(start, end)} return nextDue;`)();
}

const { remainingLabel, dueLabel, submittedLabel } = loadHelpers();
const nextDue = loadNextDue();


describe('countdown reads in hours, minutes, then seconds', () => {
  test('over an hour shows hours and minutes', () => {
    assert.equal(remainingLabel((2 * 3600 + 14 * 60) * 1000), '2 giờ 14 phút');
  });

  test('under an hour drops to minutes and seconds', () => {
    assert.equal(remainingLabel((40 * 60 + 5) * 1000), '40 phút 05 giây');
  });

  test('the last minute counts seconds', () => {
    assert.equal(remainingLabel(35 * 1000), '35 giây');
  });

  test('a passed deadline never renders negative time', () => {
    assert.equal(remainingLabel(-5000), '0 giây');
  });
});


describe('the countdown targets the server instant, not a local 19:00', () => {
  test('nextDue uses the assignment due_at as an absolute time', () => {
    const src = codeOnly(SRC.slice(SRC.indexOf('function nextDue'),
                                   SRC.indexOf('function renderCountdown')));
    assert.match(src, /new Date\(a\.assignment\.due_at\)\.getTime\(\)/);
    // Rebuilding 19:00 client-side would use the learner's own zone.
    assert.doesNotMatch(src, /19|setHours/,
      'the deadline instant comes from the server, already carrying +07:00');
  });

  test('it picks the nearest unsubmitted deadline and ignores hand-ins', () => {
    const now = Date.now();
    const mk = (id, offsetMs, submitted) => ({
      item_id: id, submitted_at: submitted || null,
      assignment: { due_at: new Date(now + offsetMs).toISOString() },
    });
    const picked = nextDue([
      mk('far', 3 * 3600e3),
      mk('soon', 40 * 60e3),
      mk('done', 10 * 60e3, '2026-08-03T10:00:00Z'),   // already handed in
    ]);
    assert.equal(picked.a.item_id, 'soon');
  });

  test('nothing outstanding means no countdown at all', () => {
    assert.equal(nextDue([]), null);
    assert.equal(
      nextDue([{ item_id: 'x', submitted_at: '2026-08-03T10:00:00Z',
                 assignment: { due_at: new Date(Date.now() + 60e3).toISOString() } }]),
      null,
    );
  });
});


describe('labels state what happened, including lateness', () => {
  test('an on-time hand-in is not called late', () => {
    const html = submittedLabel({ submitted_at: '2026-08-03T11:00:00Z', is_late: false, score: 6.5 });
    assert.match(html, /Đã nộp/);
    assert.doesNotMatch(html, /trễ/);
    assert.match(html, /Band 6.5/);
  });

  test('a late hand-in says so, and is still a hand-in', () => {
    const html = submittedLabel({ submitted_at: '2026-08-03T13:00:00Z', is_late: true, score: null });
    assert.match(html, /Nộp trễ/);
    assert.doesNotMatch(html, /Band/);
  });

  test('no deadline is stated, not left blank', () => {
    assert.match(dueLabel(null), /Không có hạn/);
  });

  test('an unreadable deadline is reported', () => {
    assert.match(dueLabel('not-a-date'), /không đọc được/i);
  });
});


describe('a failed load never reads as "you owe nothing"', () => {
  test('load() hides the content and reports, rather than rendering empty', () => {
    const fn = codeOnly(SRC.slice(SRC.indexOf('async function load()'), SRC.length));
    assert.match(fn, /showToast/);
    assert.match(fn, /persist: true/, 'the error must outlive a 4-second toast');
    assert.match(fn, /\$\('mc-content'\)\.hidden = true/);
  });

  test('a degraded assignments block suppresses the "no homework" empty state', () => {
    const fn = codeOnly(SRC.slice(SRC.indexOf('function render()'), SRC.indexOf('async function load()')));
    assert.match(fn, /degraded\.includes\('assignments'\)/,
      'the empty state must only claim "no homework" when the block actually loaded');
  });

  test('stats show — rather than zeros when progress is unknown', () => {
    const fn = codeOnly(SRC.slice(SRC.indexOf('function renderStats'), SRC.indexOf('function renderLessons')));
    assert.match(fn, /Chưa đọc được bài tập/);
  });

  test('the home strip stays hidden when its fetch fails', () => {
    const fn = codeOnly(HOME_JS.slice(HOME_JS.indexOf('async function loadClassStrip'),
                                      HOME_JS.indexOf('async function loadHome')));
    // `return` on catch — the strip is never revealed with invented numbers.
    assert.match(fn, /catch[\s\S]{0,120}return;/);
    assert.match(fn, /has_class/);
  });
});


describe('starting a task goes through the server-owned path', () => {
  const fn = codeOnly(SRC.slice(SRC.indexOf('async function startAssignment'),
                                SRC.indexOf('function render()')));

  test('/start first, then POST /sessions', () => {
    const startIdx = fn.indexOf("/api/class/assignments/");
    const sessIdx = fn.indexOf("api.post('/sessions'");
    assert.ok(startIdx !== -1 && sessIdx > startIdx);
  });

  test('the session carries the class item so the hand-in can be recorded', () => {
    assert.match(fn, /class_assignment_item_id: p\.class_assignment_item_id/);
  });

  test('it lands on practice.html by session_id, never by ?part=', () => {
    assert.match(fn, /practice\.html\?session_id=/);
    assert.doesNotMatch(fn, /\?part=/);
  });

  test('a failure re-enables the controls instead of stranding them', () => {
    // Round 4 replaced the single clicked button with every control for that
    // assignment; this pins the guarantee, not the shape it had.
    assert.match(fn, /disabled = false/);
  });
});


describe('page shell follows the student conventions', () => {
  test('mounts aver-chrome and the design tokens', () => {
    assert.match(PAGE, /<aver-chrome/);
    assert.match(PAGE, /aver-design\/tokens\.css/);
  });

  test('no hardcoded colours', () => {
    const styles = PAGE.slice(PAGE.indexOf('<style>'), PAGE.indexOf('</style>'));
    assert.doesNotMatch(styles, /#[0-9a-fA-F]{3,6}\b/);
    assert.doesNotMatch(styles, /rgba?\(/);
  });

  test('the countdown is announced to assistive tech', () => {
    assert.match(PAGE, /id="mc-countdown"[^>]*role="timer"/);
    assert.match(PAGE, /aria-live="polite"/);
  });

  test('being in no class is a plain explanation, not an error', () => {
    assert.match(PAGE, /id="mc-noclass"/);
    assert.match(PAGE, /chưa được xếp vào lớp nào/);
  });
});


describe('the page can actually authenticate (Codex review)', () => {
  // Without initSupabase, api.js keeps its client null and sends every request
  // with no Authorization header: /api/class/me answers 401 and api.js bounces a
  // signed-in student to login. The whole feature is dead, and no unit test of
  // the render helpers would ever notice.
  test('Supabase is bootstrapped before the page script runs', () => {
    assert.match(PAGE, /initSupabase\(SUPABASE_URL, SUPABASE_ANON\)/);
    const boot = PAGE.indexOf('initSupabase(');
    const script = PAGE.indexOf('/js/my-class.js');
    assert.ok(boot !== -1 && script > boot, 'the bootstrap must come first');
  });

  test('api.js is loaded before the bootstrap that calls into it', () => {
    assert.ok(PAGE.indexOf('/js/api.js') < PAGE.indexOf('initSupabase('));
  });
});


describe('lesson bodies render as Markdown, sanitised (Codex review)', () => {
  // class_lessons.body_md is Markdown by contract (mig 176). Escaping it showed
  // the student raw **bold** and unclickable links.
  // Executed, not matched: an earlier version of this test only checked that the
  // string "window.renderMarkdown" appeared somewhere in the function, and it
  // still passed after the renderer call was replaced by esc() — the guard
  // symbol lived on in the `typeof` check above it.
  const loadLessonBody = (renderMarkdown) => {
    const body = SRC.slice(SRC.indexOf('function lessonBody'),
                           SRC.indexOf('function renderLessons'));
    const win = renderMarkdown ? { renderMarkdown } : {};
    const esc = (s) => `ESCAPED(${s})`;
    return new Function('window', 'esc', `${body} return lessonBody;`)(win, esc);
  };

  test('the shared renderer produces the output', () => {
    const lessonBody = loadLessonBody((md) => `RENDERED(${md})`);
    assert.equal(lessonBody('**đậm**'), 'RENDERED(**đậm**)');
  });

  test('it falls back to ESCAPED text when the renderer never loaded', () => {
    const lessonBody = loadLessonBody(null);
    const out = lessonBody('<img src=x onerror=alert(1)>');
    assert.match(out, /ESCAPED\(/, 'a missing CDN must not mean unescaped HTML');
  });

  test('the page loads the renderer and its sanitiser', () => {
    assert.match(PAGE, /js\/markdown\.js/);
    assert.match(PAGE, /marked/);
    assert.match(PAGE, /dompurify/i);
  });

  test('everything else stays escaped — only body_md is Markdown', () => {
    const render = codeOnly(SRC.slice(SRC.indexOf('function renderLessons'),
                                      SRC.indexOf('function nextDue')));
    assert.match(render, /esc\(l\.title\)/);
    assert.match(render, /esc\(f\.url\)/);
    assert.match(render, /esc\(f\.label\)/);
  });
});


describe('the four Codex round-2 findings stay fixed', () => {
  const helper = (name, from, to) => new Function(
    'window', 'esc',
    `${SRC.slice(SRC.indexOf(from), SRC.indexOf(to))} return ${name};`,
  )({ location: { origin: 'https://averlearning.com' } }, (s) => String(s));

  test('an expired but not-yet-missing deadline still triggers the refresh', () => {
    // Filtering on `at > now` made the item vanish the instant it expired: the
    // box hid, the timer cleared, and the reload never ran.
    const expired = [{
      item_id: 'x', submitted_at: null, is_missing: false,
      assignment: { due_at: new Date(Date.now() - 60e3).toISOString() },
    }];
    assert.notEqual(nextDue(expired), null,
      'the gap between "expired locally" and "marked missing" is what fires the refresh');
  });

  test('a row the server marked missing is NOT a countdown target', () => {
    // This is what stops the boundary refresh becoming a loop: the reload
    // returns the row marked missing, it drops out here, and the countdown moves
    // on. Without it the page asked the server again every second, forever, for
    // any student holding one overdue task.
    const missing = [{
      item_id: 'x', submitted_at: null, is_missing: true,
      assignment: { due_at: new Date(Date.now() - 3600e3).toISOString() },
    }];
    assert.equal(nextDue(missing), null);
  });

  test('an overdue row does not hide a genuinely upcoming one', () => {
    const now = Date.now();
    const rows = [
      { item_id: 'overdue', submitted_at: null, is_missing: true,
        assignment: { due_at: new Date(now - 3600e3).toISOString() } },
      { item_id: 'tonight', submitted_at: null, is_missing: false,
        assignment: { due_at: new Date(now + 40 * 60e3).toISOString() } },
    ];
    assert.equal(nextDue(rows).a.item_id, 'tonight');
  });

  test('the boundary refresh happens once per item, not once per tick', () => {
    const fn = codeOnly(SRC.slice(SRC.indexOf('function renderCountdown'),
                                  SRC.indexOf('function startTicking')));
    assert.match(fn, /_deadlineReloaded\.has\(id\)/,
      'without a per-item guard a server that never marks the row missing is polled forever');
  });

  test('the item is recorded only AFTER the refresh succeeds', () => {
    // Recording it up front meant a transient network error left the item
    // flagged and the timer cleared: the page could never obtain the real state
    // again short of a manual reload.
    const fn = codeOnly(SRC.slice(SRC.indexOf('function renderCountdown'),
                                  SRC.indexOf('function startTicking')));
    const add = fn.indexOf('_deadlineReloaded.add(id)');
    const then = fn.indexOf('.then(');
    assert.ok(then !== -1 && add > then, 'the add must sit inside the success branch');
    assert.match(fn, /if \(ok\) _deadlineReloaded\.add\(id\)/);
  });

  test('a failed refresh backs off instead of retrying every tick', () => {
    const fn = codeOnly(SRC.slice(SRC.indexOf('function renderCountdown'),
                                  SRC.indexOf('function startTicking')));
    assert.match(fn, /_deadlineRetryAfter\.set\(id, Date\.now\(\) \+ DEADLINE_RETRY_MS\)/);
    assert.match(fn, /Date\.now\(\) < \(_deadlineRetryAfter\.get\(id\) \|\| 0\)/);
    assert.match(SRC, /DEADLINE_RETRY_MS = \d{4,}/, 'the backoff must be seconds, not milliseconds');
  });

  test('load() reports whether it actually refreshed', () => {
    const fn = codeOnly(SRC.slice(SRC.indexOf('async function load()')));
    assert.match(fn, /return false;/);
    assert.match(fn, /return true;/);
  });

  test('renderCountdown reloads once, not every tick', () => {
    const fn = codeOnly(SRC.slice(SRC.indexOf('function renderCountdown'),
                                  SRC.indexOf('function startTicking')));
    assert.match(fn, /left <= 0/);
    assert.match(fn, /_reloadingForDeadline/, 'a 1s timer must not fire a request per tick');
    assert.match(fn, /clearInterval/);
  });

  test('a DATE renders as the same calendar day in any timezone', () => {
    const calendarDate = helper('calendarDate', 'function calendarDate', 'function lessonBody');
    // new Date('2026-08-03') is UTC midnight — in Los Angeles that prints 02/08.
    assert.equal(calendarDate('2026-08-03'), '03/08/2026');
    assert.equal(calendarDate(null), '');
    assert.equal(calendarDate('rác'), '');
  });

  test('only http(s) attachment links are clickable', () => {
    const isSafeUrl = helper('isSafeUrl', 'function isSafeUrl', 'function calendarDate');
    assert.equal(isSafeUrl('https://averlearning.com/a.pdf'), true);
    assert.equal(isSafeUrl('http://example.com'), true);
    for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,x', '']) {
      assert.equal(isSafeUrl(bad), false, `${bad} must not be clickable`);
    }
  });

  test('an unsafe attachment renders as inert text, not a link', () => {
    const render = codeOnly(SRC.slice(SRC.indexOf('function renderLessons'),
                                      SRC.indexOf('function nextDue')));
    assert.match(render, /isSafeUrl\(f\.url\)/);
    assert.match(render, /<span class="mc-file"/);
  });

  test('the home strip loads independently of the home summary', () => {
    // Hanging it off loadHome()'s success meant an unrelated endpoint failing
    // took away the learner's only link to their class page.
    const boot = codeOnly(HOME_JS.slice(HOME_JS.indexOf('function bootstrap(')));
    assert.match(boot, /loadClassStrip\(\)/, 'bootstrap must fire it');
    const loadHome = codeOnly(HOME_JS.slice(HOME_JS.indexOf('async function loadHome'),
                                            HOME_JS.indexOf('function bootstrap(')));
    assert.doesNotMatch(loadHome, /loadClassStrip\(\)/,
      'it must not be gated on the home-summary response');
  });
});


describe('one intended attempt starts exactly one session (Codex round 4)', () => {
  const fn = codeOnly(SRC.slice(SRC.indexOf('function startControlsFor'),
                                SRC.indexOf('function render()')));

  // Executed, not matched: an earlier version only checked that the string
  // "startControlsFor" appeared in the slice — and the function's own definition
  // is inside that slice, so replacing the CALL with `[btn]` still passed.
  test('startControlsFor returns every control for that assignment', () => {
    const src = SRC.slice(SRC.indexOf('function startControlsFor'),
                          SRC.indexOf('async function startAssignment'));
    const rowBtn = { dataset: { item: 'i1' } };
    const dueBtn = { dataset: { item: 'i1' } };
    const otherBtn = { dataset: { item: 'i2' } };
    const doc = { querySelectorAll: () => [rowBtn, dueBtn, otherBtn] };
    const startControlsFor = new Function(
      'document', 'CSS', `${src} return startControlsFor;`,
    )(doc, { escape: (s) => s });

    const got = startControlsFor('i1');
    assert.equal(got.length, 2, 'both the row button and the countdown button');
    assert.ok(!got.includes(otherBtn), 'another assignment must not be disabled');
  });

  test('the in-flight handler disables the whole set, not one button', () => {
    // The nearest task renders in BOTH the countdown and the "Cần nộp" list. On a
    // slow request a student could click both and burn two daily slots for one
    // attempt — the backend allows repeat sessions per item by design.
    assert.match(fn, /const controls = startControlsFor\(itemId\)/);
    assert.match(fn, /controls\.forEach\([\s\S]{0,80}disabled = true/);
  });

  test('a second click while one is in flight is refused outright', () => {
    assert.match(fn, /_startingItem === itemId/);
    assert.match(fn, /_startingItem = itemId/);
  });

  test('a failure re-enables every control and clears the latch', () => {
    const c = fn.slice(fn.indexOf('catch'));
    assert.match(c, /disabled = false/);
    assert.match(c, /_startingItem = null/);
  });

  test('the home strip asks for the light payload', () => {
    assert.match(HOME_JS, /\/api\/class\/me\?summary=true/);
    // The full page must still ask for everything.
    assert.match(SRC, /api\.get\('\/api\/class\/me'\)/);
  });
});


// ── "chưa cập nhật" KHÁC "chưa tải được" ─────────────────────────────────
//
// A block that failed to load shows nothing and reloading is the fix.
// `homework_stale` is the opposite: the list IS here and looks complete, but a
// hand-in of ANY skill may not be folded in yet — so a task the student
// already finished can still sit under "Cần nộp". Telling them to reload sends
// them to retake work they have done.

function loadBanner() {
  const start = SRC.indexOf('  const degraded = d.degraded || [];');
  const end = SRC.indexOf("  const assignments = d.assignments || [];");
  assert.ok(start !== -1 && end > start, 'degraded banner block not found');

  return (degraded) => {
    const node = { hidden: null, textContent: '' };
    const $ = () => node;
    new Function('$', 'd', SRC.slice(start, end))($, { degraded });
    return node;
  };
}

const banner = loadBanner();

describe('class-page banner tells the two failures apart', () => {
  test('nothing wrong → no banner', () => {
    assert.equal(banner([]).hidden, true);
  });

  test('a block that did not load asks for a reload', () => {
    const n = banner(['lessons']);
    assert.match(n.textContent, /Chưa tải được buổi học/);
    assert.match(n.textContent, /Tải lại/);
  });

  test('a stale ledger says "do not redo it", never "reload"', () => {
    const n = banner(['homework_stale']);
    assert.equal(n.hidden, false);
    assert.match(n.textContent, /không cần làm lại/i);
    assert.doesNotMatch(n.textContent, /Tải lại/,
      'reloading does not fold in the hand-in — it just sends them to redo it');
    assert.doesNotMatch(n.textContent, /homework_stale/,
      'the raw flag name must not reach the student');
  });

  test('both at once → both sentences', () => {
    const n = banner(['lessons', 'homework_stale']);
    assert.match(n.textContent, /buổi học/);
    assert.match(n.textContent, /không cần làm lại/i);
  });

  test('lời nhắn KHÔNG nêu tên kỹ năng nào', () => {
    // Cờ bật cho mọi đường vá sổ. Nhắc riêng "Reading/Listening" khiến em ấy
    // yên tâm về đúng những kỹ năng có thể đang cũ, rồi đi làm lại bài Speaking
    // hoặc bài theo buổi mình đã nộp (codex 06/08).
    const n = banner(['homework_stale']);
    for (const skill of [/Reading/, /Listening/, /Speaking/, /theo buổi/]) {
      assert.doesNotMatch(n.textContent, skill);
    }
  });
});


// ── bài quá hạn: KHÔNG có nút "Làm bài" ─────────────────────────────────
//
// Hạn nộp nay là tuyệt đối, nên bấm vào chỉ để nhận 409 sau một vòng gọi mạng.
// Một nút chỉ-để-thất-bại tệ hơn không có nút: học viên bấm mấy lần rồi tưởng
// lỗi ở máy mình.

function loadItemRow() {
  const start = SRC.indexOf('const awaitingWriting =');
  const end = SRC.indexOf('function renderGroup(');
  // Cắt từ HÀM PHỤ chứ không từ `function itemRow`: `itemRow` gọi
  // `awaitingWriting` khai ngay trên nó, và một lát cắt bỏ sót hàm phụ sẽ dựng
  // ra một `itemRow` thiếu chân — bộ kiểm khi ấy đo một thứ không tồn tại trên
  // trang thật.
  assert.ok(start !== -1 && end > start, 'itemRow not found');
  const esc = (s) => String(s == null ? '' : s);
  const dueLabel = () => '19:00 · 03/08';
  const taskSub = () => 'Speaking · Part 1';
  const submittedLabel = () => 'đã nộp 18:00';
  return new Function('esc', 'dueLabel', 'taskSub', 'submittedLabel',
    `${SRC.slice(start, end)} return itemRow;`)(esc, dueLabel, taskSub, submittedLabel);
}

describe('nút Làm bài biến mất khi quá hạn', () => {
  const itemRow = loadItemRow();
  const row = (over) => ({
    item_id: 'i1', submitted_at: null, score: null, is_late: false,
    is_missing: false,
    assignment: { id: 'a1', title: 'Bài', skill: 'speaking',
                  due_at: '2026-08-03T19:00:00+07:00', content_config: {} },
    ...over,
  });

  test('bài còn hạn thì có nút', () => {
    assert.match(itemRow(row({}), { action: true }), /data-action="start"/);
  });

  test('bài quá hạn CHƯA TỪNG mở thì không có nút', () => {
    // Không có gì để xem, và bấm chỉ để nhận 409 sau một vòng gọi mạng.
    assert.doesNotMatch(
      itemRow(row({ is_missing: true, state: 'assigned' }), { action: true }),
      /data-action="start"/);
  });

  test('bài quá hạn ĐÃ LÀM DỞ vẫn mở xem lại được', () => {
    // "Không nhận bài nữa" khác "không được xem lại bài mình đã làm". Nhãn nói
    // đúng việc nút làm — không hứa "Làm bài" cho một bài đã khoá.
    const html = itemRow(row({ is_missing: true, state: 'opened' }), { action: true });
    assert.match(html, /data-action="start"/);
    assert.match(html, /Xem lại bài/);
    assert.doesNotMatch(html, />Làm bài</);
  });

  test('bài quá hạn VẪN nằm trên danh sách, ghi là quá hạn', () => {
    // Biến mất sẽ đọc ra thành "em chưa từng có bài đó" thay vì "em đã bỏ lỡ".
    const html = itemRow(row({ is_missing: true }), { action: true });
    assert.match(html, /is-missing/);
    assert.match(html, /quá hạn/);
  });

  test('bài Speaking ĐÃ NỘP mở lại được để đọc nhận xét', () => {
    // Đây là lỗi người dùng báo: làm xong rồi thì không còn đường nào quay lại
    // xem mình đã nói gì và máy nhận xét ra sao.
    const html = itemRow(row({ submitted_at: 'x' }), { action: false });
    assert.match(html, /data-action="start"/);
    assert.match(html, /Xem lại bài/);
  });

  test('kỹ năng khác chưa có màn xem lại thì KHÔNG hứa suông', () => {
    const html = itemRow(
      row({ submitted_at: 'x', assignment: { id: 'a1', title: 'Bài', skill: 'reading',
                                             due_at: null, content_config: {} } }),
      { action: false });
    assert.doesNotMatch(html, /Xem lại bài/);
  });
});

describe('điểm bài theo buổi trên trang lớp (codex #928 R7)', () => {
  test('bài course hiện PHẦN TRĂM, không phải "Band 85.0"', () => {
    const html = submittedLabel({
      submitted_at: '2026-08-03T11:00:00Z', is_late: false, score: 85.0,
      passed_at: '2026-08-04T00:00:00Z', assignment: { skill: 'course' },
    });
    assert.match(html, /85% · đã đạt/);
    assert.doesNotMatch(html, /Band/);
  });

  test('course chưa đạt: chỉ %, không gắn nhãn đạt', () => {
    const html = submittedLabel({
      submitted_at: '2026-08-03T11:00:00Z', is_late: false, score: 72.0,
      passed_at: null, assignment: { skill: 'course' },
    });
    assert.match(html, /72%/);
    assert.doesNotMatch(html, /đã đạt|Band/);
  });

  test('bài Speaking vẫn là Band như cũ', () => {
    const html = submittedLabel({
      submitted_at: '2026-08-03T11:00:00Z', is_late: false, score: 6.5,
      assignment: { skill: 'speaking' },
    });
    assert.match(html, /Band 6\.5/);
  });
});

// ── Nhịp lớp ────────────────────────────────────────────────────────────────
//
// Lớp giao bài gần như MỖI NGÀY, nên câu hỏi thật của học viên không phải "hạn
// hôm nay mấy giờ" mà là "mình có đang đều không". Bốn ô thống kê trả lời được
// câu đầu, không trả lời được câu sau.

// `my-class.js` chạm `window` ở tầng module (const api = window.api) nên không
// import thẳng được trong Node — cắt đúng vùng mã như các phép kiểm khác trong
// tệp này vẫn làm, để vẫn chạy HÀM THẬT chứ không khớp chuỗi.
function loadRhythm() {
  const SRC = readFileSync(join(HERE, '..', 'public', 'js', 'my-class.js'), 'utf8');
  const start = SRC.indexOf('const RHYTHM_DAYS =');
  const end = SRC.indexOf('function renderRhythm');
  assert.ok(start !== -1 && end > start, 'không tìm thấy vùng nhịp lớp');
  return new Function(`${SRC.slice(start, end).replace('export function', 'function')}
    return rhythmDays;`)();
}
const rhythmDays = loadRhythm();

describe('nhịp 14 ngày', () => {
  const NOW = new Date('2026-08-05T10:00:00+07:00');
  const A = (dueVN, over = {}) => ({
    item_id: 'i', submitted_at: null, is_late: false, is_missing: false,
    assignment: { id: 'a', title: 'Bài', skill: 'speaking',
                  due_at: dueVN, content_config: {} },
    ...over,
  });

  test('đúng 14 ô, hôm nay ở CUỐI', () => {
    const d = rhythmDays([], NOW);
    assert.equal(d.length, 14);
    assert.equal(d[13].today, true);
    assert.equal(d[12].today, false);
  });

  test('đã nộp / nộp trễ / bỏ lỡ là ba trạng thái khác nhau', () => {
    const d = rhythmDays([
      A('2026-08-03T19:00:00+07:00', { submitted_at: 'x' }),
      A('2026-08-04T19:00:00+07:00', { submitted_at: 'x', is_late: true }),
      A('2026-08-02T19:00:00+07:00'),                       // quá hạn, chưa nộp
    ], NOW);
    const by = Object.fromEntries(d.map((x) => [x.day, x.state]));
    assert.equal(by['2026-08-03'], 'done');
    assert.equal(by['2026-08-04'], 'late');
    assert.equal(by['2026-08-02'], 'missing');
  });

  test('bài CHƯA TỚI HẠN không bị đếm là bỏ lỡ', () => {
    const d = rhythmDays([A('2026-08-05T19:00:00+07:00')], NOW);   // 19:00 hôm nay
    assert.equal(d[13].state, 'none', 'còn 9 tiếng nữa mới tới hạn');
  });

  test('ngày là ngày VIỆT NAM của hạn, không phải ngày UTC', () => {
    // 06:00 VN ngày 04 = 23:00Z ngày 03. Lấy ngày UTC là lệch cả dải một ô.
    const d = rhythmDays([A('2026-08-04T06:00:00+07:00', { submitted_at: 'x' })], NOW);
    const by = Object.fromEntries(d.map((x) => [x.day, x.state]));
    assert.equal(by['2026-08-04'], 'done');
    assert.notEqual(by['2026-08-03'], 'done');
  });

  test('hai bài cùng ngày thì ĐÃ LÀM thắng chưa làm', () => {
    // Ô nói về NGÀY: nộp được một bài là ngày ấy có làm.
    const d = rhythmDays([
      A('2026-08-03T19:00:00+07:00', { submitted_at: 'x' }),
      A('2026-08-03T12:00:00+07:00'),
    ], NOW);
    assert.equal(d.find((x) => x.day === '2026-08-03').state, 'done');
  });

  test('ngày không có bài KHÁC ngày bỏ bài', () => {
    const d = rhythmDays([], NOW);
    assert.ok(d.every((x) => x.state === 'none'));
  });
});

describe('trang Lớp học nằm trên thanh điều hướng', () => {
  const CHROME = readFileSync(
    join(HERE, '..', 'public', 'js', 'components', 'aver-chrome.js'), 'utf8');

  test('đổi nhãn thành MY CLASS và trỏ đúng trang', () => {
    assert.match(CHROME, /href="\/pages\/my-class\.html" data-tab="class">MY CLASS<\/a>/);
  });

  test('MY CLASS có active state thật, không chỉ có data-tab', () => {
    assert.match(CHROME, /VALID_ACTIVE\s*=\s*\[[^\]]*'class'/);
  });

  test('trang tự đánh dấu mình đang mở', () => {
    const HTML = readFileSync(join(HERE, '..', 'public', 'pages', 'my-class.html'), 'utf8');
    assert.match(HTML, /<aver-chrome active="class">/);
  });

  test('được nạp trước như các mục điều hướng khác', () => {
    assert.match(CHROME, /href_matches: '\/pages\/my-class\.html'/);
  });
});

// ── 360px: trang này chủ yếu mở trên điện thoại ────────────────────────────
//
// Audit 06/08: cả trang có ĐÚNG MỘT `@media`, và nó đặt lại đúng giá trị cũ
// (`repeat(4, 1fr)` ở cả hai nơi) nên không làm gì cả. Bốn ô số bị nhồi vào
// 360px: mỗi ô còn ~80px sau khi trừ đệm.

describe('trang học viên trên điện thoại', () => {
  const css = readFileSync(new URL('../public/pages/my-class.html', import.meta.url), 'utf8');

  test('ô số xếp HAI cột trên điện thoại, BỐN từ 640px', () => {
    const base = css.match(/\.mc-stats\s*\{[^}]*\}/);
    assert.ok(base, 'không thấy .mc-stats');
    assert.match(base[0], /grid-template-columns:\s*repeat\(2, 1fr\)/,
      'mặc định (điện thoại) phải là 2 cột');
    const wide = css.match(/@media \(min-width: 640px\)\s*\{\s*\.mc-stats\s*\{[^}]*\}/);
    assert.ok(wide, 'thiếu điểm ngắt cho màn rộng');
    assert.match(wide[0], /repeat\(4, 1fr\)/);
  });

  test('câu lệnh @media phải ĐỔI thứ gì đó', () => {
    // Bản trước khai cùng một giá trị ở cả hai nơi — một điểm ngắt không đổi gì
    // đọc như đã đáp ứng, mà thực ra không.
    const base = css.match(/\.mc-stats\s*\{[^}]*grid-template-columns:\s*([^;]+);/);
    const wide = css.match(/@media \(min-width: 640px\)[^}]*\.mc-stats\s*\{[^}]*grid-template-columns:\s*([^;]+);/);
    assert.notEqual(base[1].trim(), wide[1].trim(),
      'điểm ngắt đặt lại đúng giá trị cũ thì nó không tồn tại');
  });

  test('kẻ dọc không để lại vạch cụt ở mép lưới 2 cột', () => {
    // `:last-child` không đủ: ô số 2 của MỖI hàng cũng là ô cuối hàng.
    assert.match(css, /\.mc-stat:nth-child\(2n\)\s*\{\s*border-inline-end:\s*0/);
  });

  test('nút bấm cao tối thiểu 44px', () => {
    assert.match(PAGE, /class="av-button av-button-primary" id="mc-due-start"/,
      'CTA phải dùng primitive button canonical');
    assert.doesNotMatch(`${PAGE}\n${SRC}\n${MY_CLASS_CSS}`, /mc-btn/,
      'không tạo thêm một button family riêng cho My Class');
    assert.match(MY_CLASS_CSS, /\.mc-due-now \.av-button,[^}]*\.mc-item \.av-button\s*\{[^}]*min-height:\s*44px/s,
      'touch target của CTA trên trang phải cao tối thiểu 44px');
  });
});
