import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-vocab)', 'admin', 'vocab', 'quiz-analytics', 'page.tsx');
const CLIENT = read('app', '(authed-admin-vocab)', 'admin', 'vocab', 'quiz-analytics', 'admin-vocab-quiz-analytics.tsx');
const HUB = read('app', '(authed-admin-vocab)', 'admin', 'vocab', 'page.tsx');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');

describe('Admin Vocabulary quiz analytics native ownership', () => {
  test('owns the clean route and retains rollback HTML', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /subsection="quiz-analytics"/);
    assert.match(HUB, /href: '\/admin\/vocab\/quiz-analytics'/);
    assert.match(CHROME, /slug: 'quiz-analytics'[^\n]*href: '\/admin\/vocab\/quiz-analytics'/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'vocab', 'quiz-analytics.html')));
  });

  test('uses all four canonical read contracts without business writes', () => {
    assert.match(CLIENT, /\/admin\/quiz\/students\?\$\{query\}/);
    assert.match(CLIENT, /\/admin\/quiz\/students\/\$\{encodeURIComponent\(student\.userId\)\}\?\$\{query\}/);
    assert.match(CLIENT, /\/admin\/quiz\/banks\?\$\{query\}/);
    assert.match(CLIENT, /\/admin\/quiz\/banks\/\$\{encodeURIComponent\(targetBankId\)\}\/analytics/);
    assert.doesNotMatch(CLIENT, /window\.api\.(post|patch|delete)|dangerouslySetInnerHTML/);
  });

  test('guards stale requests and validates deep-linked banks against scoped list', () => {
    assert.match(CLIENT, /accountRef/);
    assert.match(CLIENT, /rollupSeq/);
    assert.match(CLIENT, /detailSeq/);
    assert.match(CLIENT, /banks\.some\(\(bank\) => bank\.id === bankId\)/);
    assert.match(CLIENT, /!banksReady/);
    assert.match(CLIENT, /updateUrl\(scope, tab\)/);
    assert.match(CLIENT, /event\.key === 'Escape'/);
  });

  test('CI owns model, browser flow and route group', () => {
    assert.match(WORKFLOW, /admin-vocab-quiz-analytics-model\.mjs/);
    assert.match(WORKFLOW, /admin-vocab-quiz-analytics-next-behavior\.test\.mjs/);
    assert.match(WORKFLOW, /verify-admin-vocab-flow\.mjs/);
  });
});
