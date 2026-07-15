/**
 * mock-result.test.mjs — the student mock TRF (result) page.
 *
 * Guards the P2 rewrite: the old page had a broken `sections += A += B`
 * concatenation (a SyntaxError that killed the whole script, so results never
 * rendered). Pins the fix + the redesigned structure + the per-skill chữa-bài
 * links. Source-sentinel (the page is a DOM/IIFE).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(__dirname, '..', 'public', 'pages', 'mock-result.html'), 'utf8');

describe('mock-result — the broken double-assignment is gone', () => {
  test('no `<string> + <var> += ...` chained-assignment (the old SyntaxError)', () => {
    // The bug: `'<div>' + sections += '<h2>'` → invalid LHS assignment.
    assert.doesNotMatch(HTML, /\+\s*sections\s*\+=/);
    // And the duplicated inline-styled headers are gone.
    assert.doesNotMatch(HTML, /margin:16px 0 8px/);
  });
});

describe('mock-result — shell + design system', () => {
  test('uses the student chrome + design-system tokens', () => {
    assert.match(HTML, /<aver-chrome active="home">/);
    assert.match(HTML, /href="\/css\/aver-design\/tokens\.css"/);
  });
  test('all four states present', () => {
    for (const s of ['loading', 'pending', 'error', 'content']) {
      assert.match(HTML, new RegExp(`id="state-${s}"`), `missing state-${s}`);
    }
  });
  test('overall band hero + per-skill band grid', () => {
    assert.match(HTML, /id="overall-val"/);
    assert.match(HTML, /id="bands"/);
    assert.match(HTML, /listening.*reading.*writing.*speaking/s);   // SKILLS order
  });
  test('skill count + grid driven by scored skills, not a hard-coded 4 (partial mock)', () => {
    assert.match(HTML, /var scored = SKILLS\.filter/);
    assert.match(HTML, /scored\.length \+ ' kỹ năng đã chấm'/);
    assert.doesNotMatch(HTML, /\/4 kỹ năng/);              // the old misleading denominator
    assert.match(HTML, /\(scored\.length \? scored : SKILLS\)\.map/);
  });
});

describe('mock-result — chữa bài links per skill', () => {
  test('L/R link to the per-question review by attempt_id', () => {
    assert.match(HTML, /listening-review\.html\?attempt_id=' \+ encodeURIComponent\(data\.listening_attempt_id\)/);
    assert.match(HTML, /reading-review\.html\?attempt_id=' \+ encodeURIComponent\(data\.reading_attempt_id\)/);
  });
  test('Writing tasks link to the delivered essay feedback by id', () => {
    // Driven off writing_tasks[] now, not the two flat ids: the payload carries a
    // per-task STATE so the page can also explain a task it cannot link.
    assert.match(HTML, /writing-result\.html\?id=' \+ encodeURIComponent\(t\.essay_id\)/);
    assert.match(HTML, /t\.state === 'delivered' && t\.essay_id/);
  });
  test('review cards render only for skills present in the payload', () => {
    // Each link is pushed under a guard, not unconditionally.
    assert.match(HTML, /if \(data\.listening_attempt_id\) reviews\.push/);
    assert.match(HTML, /if \(data\.reading_attempt_id\) reviews\.push/);
  });
});

// A Writing task with no feedback used to be skipped in silence — the student
// saw one link and an unexplained gap, which reads as "the system lost my essay".
describe('mock-result — a Writing task with no feedback says why', () => {
  test('every non-delivered task gets a card', () => {
    assert.match(HTML, /filter\(function \(t\) \{ return t\.state !== 'delivered'; \}\)/);
  });
  test('too_short states the real numbers — word count vs the IELTS minimum', () => {
    assert.match(HTML, /t\.state === 'too_short'/);
    assert.match(HTML, /Bài không đạt yêu cầu/);
    assert.match(HTML, /t\.word_count/);
    assert.match(HTML, /t\.min_words/);
  });
  test('missing and not-graded are told apart, not lumped into "too short"', () => {
    // Blaming an un-graded long essay on length would tell the student something
    // false about their own work.
    assert.match(HTML, /t\.state === 'missing'/);
    assert.match(HTML, /Không có bài nộp/);
    assert.match(HTML, /Chưa có nhận xét/);
  });
  test('"cần thi lại" comes ONLY from the examiner flag, never from the gap', () => {
    // not-graded is what HAPPENED; "must retake" is what the examiner DECIDED.
    // The page must not invent the second from the first.
    assert.match(HTML, /var mustRetakeWriting = !!retestFlags\.writing;/);
    assert.match(HTML, /mustRetakeWriting[\s\S]*?Giám khảo yêu cầu thi lại phần Writing/);
  });
  test('the gap section stays hidden when every task was graded', () => {
    assert.match(HTML, /if \(!wrap \|\| !gaps\.length\) return;/);
  });
});

describe('mock-result — result endpoint + release gating', () => {
  test('fetches the sealed result endpoint; 403 → pending state', () => {
    assert.match(HTML, /\/api\/mock-exams\/sittings\/' \+ encodeURIComponent\(sittingId\) \+ '\/result/);
    assert.match(HTML, /e\.status === 403[\s\S]*?showState\('pending'\)/);
  });
});

// An L/R skill with no band used to just vanish from the grid — the student saw
// the other skills and was left guessing. The three states are kept apart because
// they are different truths: production's stuck sittings all submitted on time,
// so "không nhận được bài làm" would be a lie about their own exam.
describe('mock-result — a skill with no band says why', () => {
  test('only bandless skills get a card — a hand-entered band needs no excuse', () => {
    assert.match(HTML, /s\.state !== 'scored' && fb\[s\.skill\] == null/);
  });
  test('never-received, blank paper and too-low are three different messages', () => {
    assert.match(HTML, /s\.state === 'no_attempt'/);
    assert.match(HTML, /Không nhận được bài làm/);
    assert.match(HTML, /s\.state === 'no_answers'/);
    assert.match(HTML, /Không có đáp án/);
    assert.match(HTML, /Không có band/);
  });
  test('the too-low message carries the real numbers, not a vague excuse', () => {
    assert.match(HTML, /s\.score == null \? 0 : s\.score/);
    assert.match(HTML, /s\.max \|\| 40/);
    assert.match(HTML, /dưới mức thấp nhất của bảng quy đổi band IELTS/);
  });
  test('"cần thi lại" still comes only from the examiner flag', () => {
    assert.match(HTML, /retestFlags\[s\.skill\][\s\S]*?Giám khảo yêu cầu thi lại phần/);
  });
  test('the section stays hidden when every skill has a band', () => {
    assert.match(HTML, /if \(!wrap \|\| !gaps\.length\) return;/);
  });
});
