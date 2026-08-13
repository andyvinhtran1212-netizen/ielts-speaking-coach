import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-reading)', 'admin', 'reading', 'page.tsx');
const LAYOUT = read('app', '(authed-admin-reading)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-reading-hub-next.css');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const OVERVIEW = read('app', '(authed-admin-overview)', 'admin', 'admin-overview.tsx');
const ROLLBACK_OVERVIEW = read('public', 'pages', 'admin', 'index.html');
const ROLLBACK_CONTROLLER = read('public', 'js', 'admin-overview.js');
const CONFIG = read('next.config.ts');
const LEDGER = read('..', 'docs', 'ROUTE_LEDGER.md');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');

describe('/admin/reading native operations hub', () => {
  test('owns the canonical route while retaining both legacy child workspaces', () => {
    assert.match(PAGE, /function AdminReadingPage/);
    assert.doesNotMatch(CONFIG, /source:\s*['"]\/admin\/reading['"]/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'reading', 'content.html')));
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'reading', 'preview.html')));
    assert.match(CHROME, /section: 'reading'[^\n]+href: '\/admin\/reading'/);
    assert.match(CHROME, /slug: 'content'[^\n]+href: '\/pages\/admin\/reading\/content\.html'/);
    assert.match(OVERVIEW, /reading: '\/admin\/reading'/);
    assert.match(ROLLBACK_OVERVIEW, /href="\/admin\/reading"[^>]*data-skill="reading"/);
    assert.match(LEDGER, /`\/admin\/reading`[^\n]+authed-admin-reading[^\n]+native React ownership/);
  });

  test('fails closed on canonical backend-owned admin truth', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /<aver-admin-chrome active="reading">/);
    assert.match(LAYOUT, /<AuthedShell/);
    assert.match(LAYOUT, /chrome="admin"/);
    assert.match(LAYOUT, /utilityLayer=\{false\}/);
    assert.match(LAYOUT, /tailwindLayer=\{false\}/);
  });

  test('states route ownership truth and exposes only real destinations', () => {
    for (const href of ['/reading/test', '/pages/admin/reading/content.html', '/admin/dashboard/reading-attempts', '/admin/feedback?skill=reading']) {
      assert.ok(PAGE.includes(`href: '${href}'`) || PAGE.includes(`href="${href}"`), href);
    }
    assert.equal((PAGE.match(/status: 'NATIVE'/g) || []).length, 2);
    assert.equal((PAGE.match(/status: 'LEGACY WORKSPACE'/g) || []).length, 1);
    assert.match(PAGE, /Content vẫn mở workspace HTML hiện tại/);
    assert.doesNotMatch(PAGE, /window\.api\.|\bfetch\(|onClick=|<form/);
  });

  test('overview card consumes canonical Reading metrics on both surfaces', () => {
    for (const field of ['attempts_7d', 'attempts_total', 'avg_score_7d']) {
      assert.ok(OVERVIEW.includes(`skills.reading?.${field}`), field);
    }
    for (const slot of ['data-skill-7d="reading"', 'data-skill-total="reading"', 'data-skill-extra="reading"']) {
      assert.ok(ROLLBACK_OVERVIEW.includes(slot), slot);
    }
    assert.match(ROLLBACK_CONTROLLER, /skills\.reading\?\.avg_score_7d/);
  });

  test('uses the governed responsive and accessible visual contract', () => {
    for (const stylesheet of ['admin-components.css', 'admin-buttons.css', 'admin-status.css', 'admin-reading-hub-next.css']) {
      assert.ok(LAYOUT.includes(stylesheet), `missing ${stylesheet}`);
    }
    assert.match(CSS, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
    assert.match(CSS, /@media\(max-width:768px\)/);
    assert.match(CSS, /@media\(max-width:480px\)/);
    assert.match(CSS, /:focus-visible/);
    assert.match(CSS, /@media\(prefers-reduced-motion:reduce\)/);
    assert.match(WORKFLOW, /frontend\/app\/\(authed-admin-reading\)\/\*\*/);
    assert.match(WORKFLOW, /verify-admin-reading-flow\.mjs/);
  });
});
