import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-speaking)', 'admin', 'speaking', 'page.tsx');
const LAYOUT = read('app', '(authed-admin-speaking)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-speaking-hub-next.css');
const LEGACY = read('public', 'pages', 'admin', 'speaking', 'index.html');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const OVERVIEW = read('app', '(authed-admin-overview)', 'admin', 'admin-overview.tsx');
const ROLLBACK_OVERVIEW = read('public', 'pages', 'admin', 'index.html');
const CONFIG = read('next.config.ts');
const LEDGER = read('..', 'docs', 'ROUTE_LEDGER.md');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');

describe('/admin/speaking native operations hub', () => {
  test('owns the canonical route and preserves direct rollback HTML', () => {
    assert.match(PAGE, /function AdminSpeakingPage/);
    assert.doesNotMatch(CONFIG, /source:\s*['"]\/admin\/speaking['"]/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'speaking', 'index.html')));
    assert.match(CHROME, /section: 'speaking'[^\n]+href: '\/admin\/speaking'/);
    assert.match(OVERVIEW, /speaking: '\/admin\/speaking'/);
    assert.match(ROLLBACK_OVERVIEW, /href="\/admin\/speaking"[^>]*data-skill="speaking"/);
    assert.match(LEDGER, /`\/admin\/speaking`[^\n]+authed-admin-speaking[^\n]+native React ownership/);
  });

  test('fails closed on canonical backend-owned admin truth', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /<aver-admin-chrome active="speaking">/);
    assert.match(LAYOUT, /<AuthedShell/);
    assert.match(LAYOUT, /chrome="admin"/);
    assert.match(LAYOUT, /utilityLayer=\{false\}/);
    assert.match(LAYOUT, /tailwindLayer=\{false\}/);
  });

  test('states child ownership truth and exposes only real destinations', () => {
    for (const href of ['/speaking', '/admin/speaking/sessions', '/admin/speaking/topics', '/admin/system']) {
      assert.ok(PAGE.includes(`href: '${href}'`) || PAGE.includes(`href="${href}"`), href);
    }
    assert.equal((PAGE.match(/LEGACY WORKSPACE/g) || []).length, 0);
    assert.match(PAGE, /Sessions và Topics đều chạy native/);
    assert.doesNotMatch(PAGE, /window\.api\.|\bfetch\(|onClick=|<form/);
    assert.doesNotMatch(PAGE, /Sprint 12\.5|Sprint 12\.8/);
    assert.doesNotMatch(LEGACY, /Sprint 12\.8|href="\/admin\.html"/);
  });

  test('uses the governed responsive and accessible visual contract', () => {
    for (const stylesheet of ['admin-components.css', 'admin-buttons.css', 'admin-status.css', 'admin-speaking-hub-next.css']) {
      assert.ok(LAYOUT.includes(stylesheet), `missing ${stylesheet}`);
    }
    assert.match(CSS, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
    assert.match(CSS, /@media\(max-width:768px\)/);
    assert.match(CSS, /@media\(max-width:480px\)/);
    assert.match(CSS, /:focus-visible/);
    assert.match(CSS, /@media\(prefers-reduced-motion:reduce\)/);
    assert.match(WORKFLOW, /frontend\/app\/\(authed-admin-speaking\)\/\*\*/);
    assert.match(WORKFLOW, /verify-admin-speaking-flow\.mjs/);
  });
});
