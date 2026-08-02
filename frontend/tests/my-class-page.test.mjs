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

  test('it picks the nearest FUTURE unsubmitted deadline', () => {
    const now = Date.now();
    const mk = (id, offsetMs, submitted) => ({
      item_id: id, submitted_at: submitted || null,
      assignment: { due_at: new Date(now + offsetMs).toISOString() },
    });
    const picked = nextDue([
      mk('far', 3 * 3600e3),
      mk('past', -3600e3),                 // already overdue → belongs elsewhere
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

  test('a failure re-enables the button instead of stranding it', () => {
    assert.match(fn, /btn\.disabled = false/);
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
