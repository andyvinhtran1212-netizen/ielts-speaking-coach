import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  formatGrammarMetric,
  grammarStudentHref,
  normalizeGrammarArticlesPayload,
  normalizeGrammarPreview,
} from '../lib/admin-grammar-articles-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-grammar-articles)', 'admin', 'grammar', 'articles', 'page.tsx');
const CLIENT = read('app', '(authed-admin-grammar-articles)', 'admin', 'grammar', 'articles', 'admin-grammar-articles.tsx');
const LAYOUT = read('app', '(authed-admin-grammar-articles)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-grammar-articles-next.css');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const HUB = read('app', '(authed-admin-grammar)', 'admin', 'grammar', 'page.tsx');
const LEGACY_HUB = read('public', 'pages', 'admin', 'grammar', 'index.html');
const LEGACY_CLIENT = read('public', 'js', 'admin-grammar-articles.js');
const CONFIG = read('next.config.ts');
const LEDGER = read('..', 'docs', 'ROUTE_LEDGER.md');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');

const fixture = {
  total: 1,
  available_total: 3,
  categories: ['tenses', 'verb-patterns'],
  analytics_status: { views: 'complete', saves: 'unavailable' },
  items: [{
    slug: 'past-perfect', title: 'Past Perfect', category: 'tenses', summary: 'Summary', band: 7,
    view_count: 12, save_count: null, source_path: 'backend/content/tenses/past-perfect.md',
  }],
};

describe('/admin/grammar/articles native ownership', () => {
  test('uses canonical admin access and keeps the rollback artifact', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /subsection="articles"/);
    assert.match(LAYOUT, /chrome="admin"/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'grammar', 'articles.html')));
    assert.doesNotMatch(CONFIG, /source:\s*['"]\/admin\/grammar\/articles['"]/);
  });

  test('all normal navigation targets the clean route', () => {
    assert.match(CHROME, /slug: 'articles'[^\n]+href: '\/admin\/grammar\/articles'/);
    assert.ok(HUB.includes("href: '/admin/grammar/articles'"));
    assert.match(LEGACY_HUB, /href="\/admin\/grammar\/articles"/);
    assert.doesNotMatch(LEGACY_HUB, /href="\/pages\/admin\/grammar\/articles\.html"/);
  });

  test('pins read-only canonical truth and responsive/sandboxed preview', () => {
    assert.match(CLIENT, /backend\/content\/&lt;category&gt;\/&lt;slug&gt;\.md/);
    assert.doesNotMatch(CLIENT, /window\.api\.(post|patch|delete|upload)/);
    assert.match(CLIENT, /sandbox=""/);
    assert.match(CLIENT, /srcDoc=\{previewDocument/);
    assert.match(CLIENT, /requestId === sequence\.current/);
    assert.match(CLIENT, /requestId === previewSequence\.current\[article\.slug\]/);
    assert.match(CSS, /@media\(max-width:768px\)/);
    assert.match(CSS, /\.gaa-table,.gaa-table tbody\{display:grid/);
    assert.match(CSS, /@media\(prefers-reduced-motion:reduce\)/);
  });

  test('records typed truth, rollback and CI ownership', () => {
    assert.match(LEDGER, /`\/admin\/grammar\/articles`[^\n]+authed-admin-grammar-articles[^\n]+explicit per-source analytics availability/);
    assert.match(WORKFLOW, /authed-admin-grammar-articles/);
    assert.match(WORKFLOW, /verify-admin-grammar-articles-flow\.mjs/);
  });
});

describe('grammar articles payload contract', () => {
  test('preserves unknown analytics instead of inventing zero', () => {
    const result = normalizeGrammarArticlesPayload(fixture);
    assert.equal(result.items[0].viewCount, 12);
    assert.equal(result.items[0].saveCount, null);
    assert.equal(formatGrammarMetric(result.items[0].saveCount), '—');
    assert.equal(result.availableTotal, 3);
  });

  test('rejects malformed or contradictory metric contracts', () => {
    const contradictory = normalizeGrammarArticlesPayload({ ...fixture, analytics_status: { views: 'complete', saves: 'complete' } });
    assert.equal(contradictory.items.length, 0);
    assert.equal(contradictory.malformedCount, 1);
    assert.equal(normalizeGrammarArticlesPayload({ ...fixture, total: 4 }), null);
  });

  test('requires preview slug identity and emits clean student URLs', () => {
    assert.deepEqual(normalizeGrammarPreview({ slug: 'past-perfect', html: '<h1>Hi</h1>' }, 'past-perfect'), { slug: 'past-perfect', html: '<h1>Hi</h1>' });
    assert.equal(normalizeGrammarPreview({ slug: 'other', html: '<h1>Hi</h1>' }, 'past-perfect'), null);
    assert.equal(grammarStudentHref('sentence structures', 'relative/clauses'), '/grammar/sentence%20structures/relative%2Fclauses');
  });

  test('rollback client also preserves unavailable truth and clean learner links', () => {
    assert.match(LEGACY_CLIENT, /_analyticsStatus\.views === 'complete'/);
    assert.match(LEGACY_CLIENT, /_analyticsStatus\.saves === 'complete'/);
    assert.match(LEGACY_CLIENT, /requestId !== _loadSequence/);
    assert.match(LEGACY_CLIENT, /\/grammar\/\$\{encodeURIComponent\(r\.category\)\}\/\$\{encodeURIComponent\(r\.slug\)\}/);
  });
});
