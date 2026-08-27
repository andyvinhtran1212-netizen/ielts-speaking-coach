/** Regression gate for the feature-flagged Vocab Curated vertical slice. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const HOME_PAGE = read('app', '(authed-vocab-curated)', 'vocabulary', 'learn', 'page.tsx');
const HOME = read('app', '(authed-vocab-curated)', 'vocabulary', 'learn', 'vocab-curated-home.tsx');
const UNIT_PAGE = read('app', '(authed-vocab-curated)', 'vocabulary', 'learn', '[unitSlug]', 'page.tsx');
const LESSON = read('app', '(authed-vocab-curated)', 'vocabulary', 'learn', '[unitSlug]', 'vocab-unit-lesson.tsx');
const LAYOUT = read('app', '(authed-vocab-curated)', 'layout.tsx');
const CSS = read('public', 'css', 'vocab-curated.css');

describe('/vocabulary/learn — curated home', () => {
  test('is authenticated, default-deny and account-request safe', () => {
    assert.match(HOME, /useAuth\(\)/);
    assert.match(HOME, /vocab_curated_enabled !== true/);
    assert.match(HOME, /window\.location\.replace\('\/login'\)/);
    assert.match(HOME, /new AbortController\(\)/);
    assert.match(HOME, /controller\.abort\(\)/);
    assert.doesNotMatch(HOME, /localStorage|sessionStorage/);
  });

  test('uses canonical today/pathways APIs and separates Reference Wiki', () => {
    assert.match(HOME, /'\/api\/me\/vocabulary\/today'/);
    assert.match(HOME, /'\/api\/vocabulary\/pathways'/);
    assert.match(HOME_PAGE, /href="\/vocabulary"/);
    assert.match(HOME_PAGE, /Reference Wiki/);
    assert.match(HOME, /Lộ trình theo vấn đề/);
  });

  test('has one chrome owner and dedicated responsive styling', () => {
    assert.equal((HOME_PAGE.match(/<aver-chrome\b/g) || []).length, 1);
    assert.match(LAYOUT, /AuthedShell/);
    assert.match(LAYOUT, /vocab-curated\.css/);
    assert.match(CSS, /@media \(max-width: 800px\)/);
    assert.match(CSS, /prefers-reduced-motion/);
  });
});

describe('/vocabulary/learn/[unitSlug] — server-graded learning loop', () => {
  test('encodes route values and never sends correctness or an answer key', () => {
    assert.match(UNIT_PAGE, /Promise<\{ unitSlug: string \}>/);
    assert.match(LESSON, /encodeURIComponent\(unitSlug\)/);
    assert.match(LESSON, /encodeURIComponent\(task\.id\)/);
    assert.match(LESSON, /attempt_id: newAttemptId\(\), response: \{ answer:/);
    assert.doesNotMatch(LESSON, /correct:\s*(?:true|false|answer)/);
    assert.doesNotMatch(LESSON, /answer_key/);
  });

  test('renders meaning, construction, Vietnamese problem clinic and context diversity', () => {
    for (const field of [
      'meaning_vi', 'construction', 'usage_vi',
      'why_vietnamese_learners_struggle', 'contrast_vi', 'memory_hook_vi',
    ]) assert.match(LESSON, new RegExp(field));
    assert.match(LESSON, /Context diversity/);
    assert.match(LESSON, /Vietnamese learner clinic/);
  });

  test('supports recall/control/production input and accessible result states', () => {
    assert.match(LESSON, /type="radio"/);
    assert.match(LESSON, /<textarea/);
    assert.match(LESSON, /role="status"/);
    assert.match(LESSON, /role="alert"/);
    assert.match(LESSON, /maxLength=\{1200\}/);
  });
});
