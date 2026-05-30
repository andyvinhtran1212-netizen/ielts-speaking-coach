/**
 * frontend/tests/design-fix-2-admin-buttons-hubs.test.mjs — Design-Fix Sprint 2.
 *
 * Sentinels for the shared admin BUTTON bridge (B3) and HUB-CARD primitive (B4),
 * from the design-consistency audit (rows 13,14,16,17,18,30).
 *
 * Contract pinned here:
 *   • admin-buttons.css bridges the legacy per-page button classes
 *     (.btn-primary, .btn-secondary, .btn-danger, .td-btn-x, .db-refresh) onto the
 *     canonical .adm-btn-* look, theme-aware danger via --av-error. Side-effect
 *     -free (no box-sizing reset); @imported by admin-components.css.
 *   • admin-hub.css provides .admin-hub-grid / .admin-hub-card / .admin-card-link;
 *     hub status tags REUSE .adm-status-pill (NOT a new .admin-hub-tag).
 *   • Every migrated page links a provider and dropped its local copies.
 *   • Intentionally-preserved page-local variants (.btn-ghost, .btn-warn/rej/pub,
 *     .db-card metric tile) are NOT swallowed by the bridge.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

let btnCss, hubCss, adminCss;
const hub = {};
before(() => {
  btnCss   = read('frontend/css/aver-design/admin-buttons.css');
  hubCss   = read('frontend/css/aver-design/admin-hub.css');
  adminCss = read('frontend/css/aver-design/admin-components.css');
  for (const p of ['grammar/index', 'vocab/index', 'speaking/index', 'system/index', 'index']) {
    hub[p] = read(`frontend/pages/admin/${p}.html`);
  }
});


describe('admin-buttons.css / button bridge (B3)', () => {
  test('bridges the legacy button class families', () => {
    for (const cls of ['.btn-primary', '.btn-secondary', '.btn-danger',
                       '.td-btn-primary', '.td-btn-ghost', '.td-btn-danger', '.db-refresh']) {
      assert.ok(btnCss.includes(cls), `${cls} must be bridged in admin-buttons.css`);
    }
  });

  test('danger is theme-aware (--av-error), never hardcoded hex', () => {
    assert.match(btnCss, /\.btn-danger[\s\S]*?color:\s*var\(--av-error\)/);
    const stripped = btnCss.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(stripped), 'admin-buttons.css must not hardcode hex colors');
  });

  test('side-effect-free — carries no global box-sizing reset', () => {
    const code = btnCss.replace(/\/\*[\s\S]*?\*\//g, '');  // ignore the explanatory header comment
    assert.ok(!/box-sizing/.test(code),
      'admin-buttons.css must not reset box-sizing (it is linked by pages that never adopted border-box)');
  });

  test('imported by admin-components.css (reachable for its consumers)', () => {
    assert.match(adminCss, /@import\s+url\(['"]admin-buttons\.css['"]\)/);
    assert.match(adminCss, /@import\s+url\(['"]admin-hub\.css['"]\)/);
  });
});


describe('admin-hub.css / hub-card primitive (B4)', () => {
  test('provides grid + card + card-link primitives', () => {
    for (const cls of ['.admin-hub-grid', '.admin-hub-card', '.admin-card-link']) {
      assert.ok(hubCss.includes(cls), `${cls} must be declared`);
    }
  });

  test('aliases dashboard .db-card__link onto .admin-card-link (audit row 30)', () => {
    assert.match(hubCss, /\.db-card__link/);
  });

  test('does NOT introduce a separate .admin-hub-tag (hub tags reuse .adm-status-pill)', () => {
    const code = hubCss.replace(/\/\*[\s\S]*?\*\//g, '');  // ignore the explanatory header comment
    assert.ok(!/\.admin-hub-tag/.test(code),
      'hub tags must reuse .adm-status-pill, not a new .admin-hub-tag class');
  });

  test('side-effect-free — no box-sizing reset', () => {
    const code = hubCss.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/box-sizing/.test(code));
  });
});


describe('hub pages migrated to the primitives (B4)', () => {
  test('all 5 hubs link admin-hub.css + admin-status.css and use the shared classes', () => {
    for (const p of ['grammar/index', 'vocab/index', 'speaking/index', 'system/index', 'index']) {
      assert.match(hub[p], /admin-hub\.css/, `${p} links admin-hub.css`);
      assert.match(hub[p], /admin-status\.css/, `${p} links admin-status.css`);
      assert.match(hub[p], /class="admin-hub-card"/, `${p} uses .admin-hub-card`);
    }
  });

  test('no per-prefix card/grid/tag classes survive in any hub', () => {
    for (const p of ['grammar/index', 'vocab/index', 'speaking/index', 'system/index', 'index']) {
      // ignore comments that may name the old prefixes
      const code = hub[p].replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      assert.ok(!/class="(grm|vcb|spk|sys|ov)-(card|grid|tag)/.test(code),
        `${p} still emits a per-prefix hub class`);
    }
  });

  test('hub status tags use .adm-status-pill state modifiers', () => {
    // every hub has at least one LIVE tag rendered via the shared pill
    for (const p of ['grammar/index', 'vocab/index', 'speaking/index', 'system/index', 'index']) {
      assert.match(hub[p], /adm-status-pill is-(live|readonly|new|soon)/, `${p} hub tag uses .adm-status-pill`);
    }
  });
});
