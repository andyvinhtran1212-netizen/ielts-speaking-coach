/**
 * Q-62 — follow-up to UIA-1028-03 (#1790). The Speaking feedback headings the
 * ticket's extractor missed (multi-line JSX / concatenated HTML) are Vietnamese
 * on every surface that renders practice feedback: the native practice shell,
 * the legacy compatibility renderer in practice.js (live + history card) and
 * the session result page. The vocabulary matches #1790 and the formal branch:
 * Strengths → Điểm mạnh, Grammar Issues → Lỗi ngữ pháp,
 * Sample Answer → Bài nói mẫu, Corrections → Sửa lỗi.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PRACTICE_JS = read('public', 'js', 'practice.js');
const SHELL = read('app', '(authed-practice)', 'practice', 'session', 'practice-page-shell.tsx');
const RESULT = read('app', '(authed-session-result)', 'result', 'session-result-behavior.tsx');

const ENGLISH_HEADINGS = ['Strengths', 'Grammar Issues', 'Sample Answer', 'Corrections'];

function extract(name) {
  const m = new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}`).exec(PRACTICE_JS);
  assert.ok(m, `practice.js must define ${name}`);
  return m[0];
}

function load(name) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return new Function('_esc', `${extract(name)}; return ${name};`)(esc);
}

describe('Q-62 — practice.js compatibility renderer', () => {
  test('sample-answer blocks render the Vietnamese heading', () => {
    assert.match(load('_sampleAnswerBlock')('I usually read at night.'), />Bài nói mẫu<\/p>/);
    assert.match(load('_sampleUnavailableBlock')(), />Bài nói mẫu<\/p>/);
  });

  test('corrections block renders the Vietnamese heading', () => {
    const html = load('_correctionsBlock')([{ original: 'I goes', corrected: 'I go', explanation: 'x' }]);
    assert.match(html, />Sửa lỗi<\/p>/);
  });

  test('grammar-issues heading and both practice Strengths lists are Vietnamese', () => {
    assert.match(extract('_grammarIssuesBlock'), />Lỗi ngữ pháp<\/p>/);
    // Live feedback (_showFeedback) and the history card both list strengths.
    assert.equal(PRACTICE_JS.match(/_listBlock\('Điểm mạnh',\s+data\.strengths,/g).length, 4);
  });

  test('no English heading literal remains', () => {
    for (const text of ENGLISH_HEADINGS) {
      assert.doesNotMatch(PRACTICE_JS, new RegExp(`>${text}</p>|_listBlock\\('${text}'`), text);
    }
  });
});

describe('Q-62 — native practice shell', () => {
  test('practice Strengths and Corrections headings are Vietnamese', () => {
    assert.match(SHELL, /feedback\.kind === 'practice' \? <FeedbackList title="Điểm mạnh" items=\{feedback\.strengths\}/);
    assert.match(SHELL, /margin: '0 0 8px' \}\}>Sửa lỗi<\/p>/);
    assert.match(_nativeSampleTitle(), /^Bài nói mẫu$/);
    for (const text of ENGLISH_HEADINGS) {
      assert.doesNotMatch(SHELL, new RegExp(`title="${text}"|>${text}</p>`), text);
    }
  });
});

describe('Q-62 — session result page', () => {
  test('practice feedback headings are Vietnamese', () => {
    assert.match(RESULT, /<BulletSection items=\{feedback\?\.strengths\} title="Điểm mạnh"/);
    assert.match(RESULT, /function GrammarIssues[\s\S]*?\n\s+Lỗi ngữ pháp\n\s+<\/div>/);
    assert.match(RESULT, /function Corrections[\s\S]*?\n\s+Sửa lỗi\n\s+<\/div>/);
    assert.match(RESULT, /feedback\?\.sample_answer \? \([\s\S]*?\n\s+Bài nói mẫu\n\s+<\/div>/);
    for (const text of ENGLISH_HEADINGS) {
      assert.doesNotMatch(RESULT, new RegExp(`title="${text}"|^\\s+${text}$`, 'm'), text);
    }
  });
});

// The native shell takes the sample title from practice.js's view model.
function _nativeSampleTitle() {
  const m = /sample = payload\.sample_answer\s*\? \{ title: '([^']+)'/.exec(PRACTICE_JS);
  assert.ok(m, 'native practice sample title not found');
  return m[1];
}
