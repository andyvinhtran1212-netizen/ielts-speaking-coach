import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-writing)', 'admin', 'writing', 'page.tsx');
const LAYOUT = read('app', '(authed-admin-writing)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-writing-hub-next.css');
const LEGACY = read('public', 'pages', 'admin', 'writing', 'index.html');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const OVERVIEW = read('app', '(authed-admin-overview)', 'admin', 'admin-overview.tsx');
const GRADE = read('app', '(authed-admin-writing-grade)', 'admin', 'writing', 'grade', 'writing-grade-behavior.tsx');
const LEGACY_CHILDREN = ['assignments.html', 'new.html', 'grade.html', 'tips.html', 'regrade-requests.html', 'cohorts.html', 'prompts.html']
  .map((name) => read('public', 'pages', 'admin', 'writing', name));
const CONFIG = read('next.config.ts');
const LEDGER = read('..', 'docs', 'ROUTE_LEDGER.md');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');

describe('/admin/writing native operations hub', () => {
  test('owns the canonical route and preserves direct rollback HTML', () => {
    assert.match(PAGE, /function AdminWritingPage/);
    assert.doesNotMatch(CONFIG, /source:\s*['"]\/admin\/writing['"]/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'writing', 'index.html')));
    assert.match(CHROME, /section: 'writing'[^\n]+href: '\/admin\/writing'/);
    assert.match(OVERVIEW, /writing: '\/admin\/writing'/);
    assert.match(GRADE, /href="\/admin\/writing" className="back-link"/);
    for (const child of LEGACY_CHILDREN) {
      assert.match(child, /href="\/admin\/writing"/);
      assert.doesNotMatch(child, /href="\/pages\/admin\/writing\/index\.html"/);
    }
    assert.match(LEDGER, /`\/admin\/writing`[^\n]+authed-admin-writing[^\n]+native React ownership/);
  });

  test('fails closed and is a read-only routing surface', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /<aver-admin-chrome active="writing">/);
    assert.match(LAYOUT, /<AuthedShell/);
    assert.match(LAYOUT, /chrome="admin"/);
    assert.doesNotMatch(PAGE, /window\.api\.|\bfetch\(|onClick=|<form/);
  });

  test('states ownership truth for all ten operational destinations', () => {
    for (const href of [
      '/admin/writing/new', '/admin/writing/prompts', '/admin/writing/tips',
      '/admin/writing/queue', '/admin/writing/regrade-requests',
      '/admin/writing/instructor-queue', '/admin/writing/grade',
      '/admin/writing/assignments', '/admin/writing/cohorts', '/admin/students',
      '/writing/dashboard',
    ]) assert.ok(PAGE.includes(`href: '${href}'`) || PAGE.includes(`href="${href}"`), href);
    assert.equal((PAGE.match(/href: '/g) || []).length, 10);
    assert.equal((PAGE.match(/status: 'NATIVE'/g) || []).length, 10);
    assert.equal((PAGE.match(/status: 'MIGRATING'/g) || []).length, 0);
    assert.match(PAGE, /Chuẩn bị → Chấm → Giao & theo dõi/);
    assert.doesNotMatch(PAGE, /<span[^>]*>[^<]*(?:✍|📚|💡|📥|🔄|👤|📌|👥|🎓)/);
  });

  test('uses governed responsive and accessible styles', () => {
    for (const stylesheet of ['admin-components.css', 'admin-buttons.css', 'admin-status.css', 'admin-writing-hub-next.css']) {
      assert.ok(LAYOUT.includes(stylesheet), `missing ${stylesheet}`);
    }
    assert.match(CSS, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
    assert.match(CSS, /min-height:44px/);
    assert.match(CSS, /@media\(max-width:768px\)/);
    assert.match(CSS, /@media\(max-width:480px\)/);
    assert.match(CSS, /:focus-visible/);
    assert.match(CSS, /@media\(prefers-reduced-motion:reduce\)/);
    assert.match(WORKFLOW, /frontend\/app\/\(authed-admin-writing\)\/\*\*/);
    assert.match(WORKFLOW, /verify-admin-writing-flow\.mjs/);
    assert.ok(LEGACY.includes('<aver-admin-chrome active="writing">'));
  });
});
