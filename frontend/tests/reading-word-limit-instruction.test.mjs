/**
 * frontend/tests/reading-word-limit-instruction.test.mjs
 *
 * Cam18-T2 content audit (2026-08-01). Two instruction defects, both in the
 * FRONTEND generator rather than the data, so they hit EVERY reading test:
 *
 *   1. Every completion type hardcoded "NO MORE THAN TWO WORDS". Cambridge 18
 *      Test 2 Reading Q34-40 is "ONE WORD ONLY" — a student who follows the
 *      site and writes two words scores ZERO on the real exam. The limit now
 *      comes from `payload.word_limit`, whitelisted so a bad DB value can
 *      never author the instruction.
 *   2. summary_completion authored WITH `options:` is the word-bank task (pick
 *      a lettered phrase), but it inherited the copy-from-the-passage wording
 *      — contradicting the Word Bank rendered directly below it.
 *
 * Plus the review-pane counterpart: completion runs park "(see summary above)"
 * in every member's `prompt`, which the review cards rendered literally, so a
 * student could not tell what the question had been.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

describe('reading-exam — word limit comes from the paper, not a hardcode', () => {
  const js = read('frontend/js/reading-exam.js');

  test('every completion instruction resolves its limit through _wordLimit(ctx)', () => {
    for (const type of ['sentence_completion', 'summary_completion', 'notes_completion',
                        'table_completion', 'form_completion', 'short_answer']) {
      const fn = js.match(new RegExp(`${type}: function \\(range, ctx\\) \\{[\\s\\S]{0,700}?\\n    \\},`));
      assert.ok(fn, `${type} instruction template not found (or lost its ctx arg)`);
      assert.match(fn[0], /_wordLimit\(ctx/, `${type} still hardcodes its word limit`);
    }
  });

  test('short_answer keeps THREE WORDS as its fallback, not TWO', () => {
    const fn = js.match(/short_answer: function \(range, ctx\) \{[\s\S]{0,400}?\n    \},/);
    assert.match(fn[0], /_wordLimit\(ctx,\s*'NO MORE THAN THREE WORDS'\)/);
  });

  test('_wordLimit whitelists the limit and falls back to the historical default', () => {
    assert.match(js, /var WORD_LIMITS = \[/);
    for (const w of ['ONE WORD ONLY', 'NO MORE THAN TWO WORDS', 'NO MORE THAN THREE WORDS']) {
      assert.match(js, new RegExp(`'${w.replace(/\//g, '\\/')}'`), `whitelist missing ${w}`);
    }
    const fn = js.match(/function _wordLimit\(ctx, fallback\) \{[\s\S]{0,400}?\n  \}/);
    assert.ok(fn, '_wordLimit not found');
    // Unknown value must be IGNORED (fall through to the default), never rendered.
    assert.match(fn[0], /WORD_LIMITS\.indexOf\(w\) >= 0 \? w : \(fallback \|\| 'NO MORE THAN TWO WORDS'\)/);
  });

  test('the run\'s word_limit is read into ctx alongside optionsCount', () => {
    assert.match(js, /var wordLimit = \(run\[0\]\.payload && run\[0\]\.payload\.word_limit\) \|\| '';/);
    assert.match(js, /var ctx = \{ part: part, optionsCount: optionsCount, wordLimit: wordLimit \};/);
  });

  test('summary_completion WITH a bank switches to the list-of-phrases wording', () => {
    const fn = js.match(/summary_completion: function \(range, ctx\) \{[\s\S]{0,900}?\n    \},/);
    assert.ok(fn, 'summary_completion template not found');
    assert.match(fn[0], /if \(ctx && ctx\.optionsCount\)/);
    assert.match(fn[0], /Complete the summary using the list ' \+\s*\n\s*'of phrases, A-' \+ _letterAt\(ctx\.optionsCount\)/);
    // …and the no-bank variant still copies words out of the passage.
    assert.match(fn[0], /Complete the summary below\. Choose ' \+\s*\n\s*_wordLimit\(ctx\)/);
  });

  test('_letterAt maps a bank size to its last letter and stays in A-Z', () => {
    assert.match(js, /function _letterAt\(n\) \{[\s\S]{0,200}String\.fromCharCode\(64 \+ Math\.max\(1, Math\.min\(26, n \| 0\)\)\)/);
  });
});

describe('reading-review — a placeholder prompt never reaches the card', () => {
  const js = read('frontend/js/reading-review.js');

  test('the card renders _promptText(item, sol), not item.prompt', () => {
    assert.match(js, /_promptText\(item, sol\)\s*\n\s*\? '<p class="rr-card__prompt">' \+ escapeHtml\(_promptText\(item, sol\)\)/);
    assert.doesNotMatch(
      js,
      /\(item\.prompt \? '<p class="rr-card__prompt">' \+ escapeHtml\(item\.prompt\)/,
      'the old raw-prompt render is still present',
    );
  });

  test('the placeholder pattern covers every completion family authors emit', () => {
    const re = js.match(/var _PLACEHOLDER_PROMPT_RE = (.*);/);
    assert.ok(re, '_PLACEHOLDER_PROMPT_RE not found');
    const rx = new RegExp(re[1].trim().replace(/^\/|\/i$/g, ''), 'i');
    for (const p of ['(see summary above)', 'see notes above', '(See Table Above)',
                     '(see form above)']) {
      assert.ok(rx.test(p), `placeholder not matched: ${p}`);
    }
    // A real question must NOT be mistaken for a placeholder.
    assert.ok(!rx.test('What point does the writer make about AI in the first paragraph?'));
  });

  test('falls back to solution.question_text with its authored quotes stripped', () => {
    const fn = js.match(/function _promptText\(item, sol\) \{[\s\S]{0,700}?\n  \}/);
    assert.ok(fn, '_promptText not found');
    assert.match(fn[0], /sol\.question_text/);
    assert.match(fn[0], /replace\(\/\^\["“”'\]\+\/, ''\)\.replace\(\/\["“”'\]\+\$\/, ''\)/);
    // No solution text → keep whatever the prompt was rather than blanking the card.
    assert.match(fn[0], /return qt \|\| p;/);
  });
});
