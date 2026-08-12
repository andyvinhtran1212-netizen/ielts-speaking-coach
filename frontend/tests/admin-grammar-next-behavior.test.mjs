import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-grammar)', 'admin', 'grammar', 'page.tsx');
const LAYOUT = read('app', '(authed-admin-grammar)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-grammar-hub-next.css');
const LEGACY = read('public', 'pages', 'admin', 'grammar', 'index.html');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const OVERVIEW = read('app', '(authed-admin-overview)', 'admin', 'admin-overview.tsx');
const ROLLBACK_OVERVIEW = read('public', 'pages', 'admin', 'index.html');
const CONFIG = read('next.config.ts');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');

describe('/admin/grammar native hub', () => {
  test('owns the canonical route while preserving a direct rollback artifact', () => {
    assert.match(PAGE, /function AdminGrammarPage/);
    assert.doesNotMatch(CONFIG, /source:\s*['"]\/admin\/grammar['"]/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'grammar', 'index.html')));
    assert.match(CHROME, /section: 'grammar',[^\n]*href: '\/admin\/grammar'/);
    assert.match(OVERVIEW, /grammar: '\/admin\/grammar'/);
    assert.match(ROLLBACK_OVERVIEW, /href="\/admin\/grammar"[^>]*data-skill="grammar"/);
    assert.doesNotMatch(ROLLBACK_OVERVIEW, /href="\/pages\/admin\/grammar\/index\.html"/);
    assert.match(LEGACY, /<aver-admin-chrome\s+active=["']grammar["']/);
  });

  test('fails closed on canonical backend-owned admin truth', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /<aver-admin-chrome active="grammar">/);
    assert.match(LAYOUT, /<AuthedShell/);
    assert.match(LAYOUT, /chrome="admin"/);
    assert.match(LAYOUT, /utilityLayer=\{false\}/);
    assert.match(LAYOUT, /tailwindLayer=\{false\}/);
  });

  test('states the file-based publishing contract without inventing mutations', () => {
    assert.match(PAGE, /backend\/content\/&lt;category&gt;\/&lt;slug&gt;\.md/);
    assert.match(PAGE, /Sửa Markdown/);
    assert.match(PAGE, /Review &amp; commit/);
    assert.match(PAGE, /Auto-deploy/);
    assert.match(PAGE, /FILE-BASED/);
    assert.doesNotMatch(PAGE, /window\.api\.|\bfetch\(|onClick=|<form/);
  });

  test('exposes every real destination and the learner preview', () => {
    for (const href of [
      '/grammar',
      '/pages/admin/grammar/articles.html',
      '/pages/admin/grammar/analytics.html',
      '/pages/admin/grammar/recommend-test.html',
      '/pages/admin/vocab/topics.html?skill_area=grammar',
    ]) assert.ok(PAGE.includes(`href: '${href}'`) || PAGE.includes(`href="${href}"`), href);
    assert.equal((PAGE.match(/className={`grh-card/g) || []).length, 1);
    assert.match(PAGE, /destinations\.map/);
  });

  test('has a responsive and reduced-motion visual contract in CI', () => {
    for (const stylesheet of [
      'admin-components.css',
      'admin-buttons.css',
      'admin-status.css',
      'admin-grammar-hub-next.css',
    ]) {
      assert.ok(LAYOUT.includes(stylesheet), `layout missing ${stylesheet}`);
      assert.ok(WORKFLOW.includes(`frontend/public/css/${stylesheet.startsWith('admin-grammar') ? '' : 'aver-design/'}${stylesheet}`),
        `parity paths missing ${stylesheet}`);
    }
    assert.match(CSS, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(CSS, /@media \(max-width: 768px\)/);
    assert.match(CSS, /@media \(max-width: 480px\)/);
    assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(WORKFLOW, /frontend\/app\/\(authed-admin-grammar\)\/\*\*/);
    assert.match(WORKFLOW, /verify-admin-grammar-flow\.mjs/);
  });
});
