import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const BEHAVIOR = read('app', '(authed-reading)', 'reading', 'reading-detail.tsx');
const ASSETS = read('app', '(authed-reading)', 'reading', 'reading-detail-assets.tsx');
const VOCAB = read('app', '(authed-reading)', 'reading', 'vocab', '[slug]', 'page.tsx');
const SKILL = read('app', '(authed-reading)', 'reading', 'skill', '[slug]', 'page.tsx');

describe('native Reading detail workspace', () => {
  test('owns both dynamic routes behind shared auth and Suspense', () => {
    assert.match(VOCAB, /<ReadingDetail library="vocab" slug=\{slug\}/);
    assert.match(SKILL, /<ReadingDetail library="skill" slug=\{slug\}/);
    assert.match(VOCAB, /<Suspense/); assert.match(SKILL, /<Suspense/);
    assert.match(BEHAVIOR, /useAuth\(\)/);
    assert.match(BEHAVIOR, /key=\{`\$\{accountKey \|\| status\}\|\$\{library\}\|\$\{slug\}`\}/);
  });

  test('uses abortable canonical reads and strict normalization', () => {
    assert.match(BEHAVIOR, /new AbortController\(\)/);
    assert.match(BEHAVIOR, /window\.api\.getWith<unknown>\(path, undefined, \{ signal: controller\.signal \}\)/);
    assert.match(BEHAVIOR, /normalizeReadingDetail\(payload, slug\)/);
    assert.match(BEHAVIOR, /controller\.abort\(\)/);
  });

  test('keeps server-side per-question grading retryable and duplicate-safe', () => {
    assert.match(BEHAVIOR, /if \(!value \|\| lock\.current \|\| lockedResult\) return/);
    assert.match(BEHAVIOR, /mounted\.current = true;[\s\S]*mounted\.current = false/);
    assert.match(BEHAVIOR, /window\.api\.post<unknown>/);
    assert.match(BEHAVIOR, /normalizeReadingCheck\(raw, question\.qNum\)/);
    assert.match(BEHAVIOR, /if \(!result\) throw new Error\('invalid-check-contract'\)/);
    assert.match(BEHAVIOR, /lock\.current = false/);
    assert.match(BEHAVIOR, /Bạn có thể thử lại/);
  });

  test('preserves all question controls, feedback flags and summary truth', () => {
    for (const type of ['mcq_single', 'true_false_not_given', 'yes_no_not_given', 'matching_headings']) assert.match(BEHAVIOR, new RegExp(type));
    assert.match(BEHAVIOR, /AverFeedback\.attachCardFlag/);
    assert.match(BEHAVIOR, /Đúng \{correct\}\/\{detail\.questions\.length\}/);
    assert.doesNotMatch(BEHAVIOR, /session\.answered \+=|session\.correct \+=/);
  });

  test('preserves visible legacy copy and safe grammar emphasis', () => {
    assert.match(BEHAVIOR, /'Thư viện Vocab Reading'/);
    assert.match(BEHAVIOR, /function InlineStrong/);
    assert.match(BEHAVIOR, /<InlineStrong value=\{point\.example\}/);
    assert.doesNotMatch(BEHAVIOR, /rv-gpoint__example[^\n]+dangerouslySetInnerHTML/);
  });

  test('renders sanitized Markdown and accessible tab/dialog interactions', () => {
    assert.match(ASSETS, /marked@12\.0\.2/); assert.match(ASSETS, /dompurify@3\.4\.8/);
    assert.match(VOCAB, /<ReadingDetailAssets/); assert.match(SKILL, /<ReadingDetailAssets/);
    assert.match(BEHAVIOR, /window\.renderMarkdown!\(detail\.bodyMarkdown, \{ breaks: false \}\)/);
    assert.match(BEHAVIOR, /role="tablist"/); assert.match(BEHAVIOR, /aria-controls=/);
    for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) assert.match(BEHAVIOR, new RegExp(key));
    assert.match(BEHAVIOR, /aria-modal="true"/); assert.match(BEHAVIOR, /event\.key === 'Escape'/);
    assert.match(BEHAVIOR, /event\.key !== 'Tab'/);
  });
});
