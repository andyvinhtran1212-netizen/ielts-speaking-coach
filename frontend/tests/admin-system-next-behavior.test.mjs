import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-system)', 'admin', 'system', 'page.tsx');
const LAYOUT = read('app', '(authed-admin-system)', 'layout.tsx');
const GATE = read('components', 'admin-access-gate.tsx');
const SURFACE = read('public', 'css', 'aver-design', 'admin-surface.css');
const LEGACY = read('pages', 'admin', 'system', 'index.html');
const ADMIN_HOME = read('pages', 'admin', 'index.html');
const CONFIG = read('next.config.ts');

describe('/admin/system — native read-only admin pilot', () => {
  test('owns the canonical route and keeps its rollback HTML directly reachable', () => {
    assert.match(PAGE, /function AdminSystemPage/);
    assert.doesNotMatch(CONFIG, /source:\s*['"]\/admin\/system['"]/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'system', 'index.html')));
    assert.match(ADMIN_HOME, /href="\/admin\/system">Hệ thống · LIVE<\/a>/);
    assert.doesNotMatch(ADMIN_HOME, /href="\/pages\/admin\/system\/index\.html"/);
  });

  test('uses the canonical admin shell without importing legacy utility resets', () => {
    assert.match(LAYOUT, /<AuthedShell/);
    assert.match(LAYOUT, /chrome="admin"/);
    assert.match(LAYOUT, /utilityLayer=\{false\}/);
    assert.match(LAYOUT, /tailwindLayer=\{false\}/);
    const order = [
      'admin-surface.css', 'admin-components.css', 'admin-status.css',
      'admin-hub.css', 'admin-system.css',
    ];
    let cursor = -1;
    for (const item of order) {
      const index = LAYOUT.indexOf(item);
      assert.ok(index > cursor, `${item} cascade`);
      cursor = index;
    }
  });

  test('fails closed on backend-owned admin truth with utility-independent states', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(GATE, /window\.api\.get<AdminProfile>\('\/auth\/me'\)/);
    assert.match(GATE, /profile\?\.role === 'admin'/);
    assert.match(GATE, /selectKeyedAdminState\(accessState, accountKey\)/);
    assert.match(GATE, /adm-access-state/);
    assert.match(SURFACE, /\.adm-access-state\s*\{/);
    assert.match(SURFACE, /\.adm-access-state__action\s*\{/);
  });

  test('preserves both operational destinations and visible status truth', () => {
    assert.ok(PAGE.includes('/pages/admin/system/ai-usage.html'));
    assert.ok(PAGE.includes('/admin/system/alerts'));
    assert.ok(LEGACY.includes('/pages/admin/system/ai-usage.html'));
    assert.ok(LEGACY.includes('/pages/admin/system/alerts.html'));
    assert.doesNotMatch(PAGE, /href="\/pages\/admin\/system\/alerts\.html"/);
    assert.equal((PAGE.match(/adm-status-pill is-live/g) || []).length, 2);
    assert.match(PAGE, /aria-label="System admin sections"/);
  });

  test('shares page CSS with rollback instead of carrying a second inline copy', () => {
    assert.match(LEGACY, /\/css\/admin-system\.css/);
    assert.doesNotMatch(LEGACY, /<style>/);
    assert.match(LEGACY, /@supabase\/supabase-js@2\.107\.0/);
    assert.match(LEGACY, /\/js\/runtime-config\.js/);
    assert.match(LEGACY, /\/js\/api\.js/);
    const css = read('public', 'css', 'admin-system.css');
    assert.match(css, /\.sys-shell/);
    assert.match(css, /calc\(100vw - 328px\)/);
    assert.match(css, /aver-admin-chrome\[data-collapsed="1"\] > \.sys-shell/);
    assert.match(css, /@media \(max-width: 768px\)/);
    assert.match(css, /calc\(100vw - 32px\)/);
  });
});
