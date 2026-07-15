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
});

describe('mock-result — chữa bài links per skill', () => {
  test('L/R link to the per-question review by attempt_id', () => {
    assert.match(HTML, /listening-review\.html\?attempt_id=' \+ encodeURIComponent\(data\.listening_attempt_id\)/);
    assert.match(HTML, /reading-review\.html\?attempt_id=' \+ encodeURIComponent\(data\.reading_attempt_id\)/);
  });
  test('Writing tasks link to the delivered essay feedback by id', () => {
    assert.match(HTML, /writing-result\.html\?id=' \+ encodeURIComponent\(data\.essay_task1_id\)/);
    assert.match(HTML, /writing-result\.html\?id=' \+ encodeURIComponent\(data\.essay_task2_id\)/);
  });
  test('review cards render only for skills present in the payload', () => {
    // Each link is pushed under an `if (data.<id>)` guard, not unconditionally.
    assert.match(HTML, /if \(data\.listening_attempt_id\) reviews\.push/);
    assert.match(HTML, /if \(data\.essay_task2_id\) reviews\.push/);
  });
});

describe('mock-result — result endpoint + release gating', () => {
  test('fetches the sealed result endpoint; 403 → pending state', () => {
    assert.match(HTML, /\/api\/mock-exams\/sittings\/' \+ encodeURIComponent\(sittingId\) \+ '\/result/);
    assert.match(HTML, /e\.status === 403[\s\S]*?showState\('pending'\)/);
  });
});
