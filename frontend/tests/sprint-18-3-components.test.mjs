/**
 * frontend/tests/sprint-18-3-components.test.mjs — Sprint 18.3 (Direction C, UI Refactor r2)
 *
 * Source-scan of the shared admin component extraction. Verifies the library
 * exists + defines the canonical components, that the migrated pages consume it
 * (link + .adm-* classes) and no longer redefine the extracted rules in their
 * own <style>, and that Pattern #25/#26 hold. Visual correctness is confirmed by
 * Andy's dogfood (no headless browser convention, PF-7).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const CSS = front('css', 'aver-design', 'admin-components.css');
const MIGRATED = {
  'access-codes': front('pages', 'admin', 'access-codes', 'index.html'),
  'usage':        front('pages', 'admin', 'usage', 'index.html'),
  'foot-traffic': front('pages', 'admin', 'foot-traffic', 'index.html'),
  'cohorts':      front('pages', 'admin', 'cohorts', 'index.html'),
};
const MIGRATED_JS = {
  'admin-access-codes.js': front('js', 'admin-access-codes.js'),
  'admin-usage.js':        front('js', 'admin-usage.js'),
  'admin-foot-traffic.js': front('js', 'admin-foot-traffic.js'),
  'admin-cohorts.js':      front('js', 'admin-cohorts.js'),
};


describe('Sprint 18.3 — shared component library', () => {
  test('admin-components.css defines the canonical components', () => {
    for (const sel of [
      '.adm-table-wrap', 'table.adm-table', '.adm-btn-primary', '.adm-btn-secondary',
      '.adm-btn-danger', '.adm-chip', '.adm-modal', '.adm-field', '.adm-card',
      '.adm-empty', '.adm-loading', '.adm-banner', '.adm-subtab',
    ]) {
      assert.ok(CSS.includes(sel), `expected ${sel} in admin-components.css`);
    }
  });
  test('library is token-driven, both themes (Pattern #25): av-* tokens, no hex literals', () => {
    assert.match(CSS, /--av-surface-card/);
    assert.match(CSS, /--av-brand-teal-50/);
    assert.doesNotMatch(CSS, /:\s*#[0-9a-fA-F]{3,6}\b/);
  });
});

describe('Sprint 18.3 — migrated pages consume the library', () => {
  for (const [page, html] of Object.entries(MIGRATED)) {
    test(`${page} links admin-components.css + uses .adm-* components`, () => {
      assert.match(html, /\/css\/aver-design\/admin-components\.css/);
      assert.match(html, /class="[^"]*\badm-(table|btn-\w+|card|chip|modal|empty|loading|banner)\b/);
    });
    test(`${page} no longer redefines extracted components in its <style>`, () => {
      // The old per-page component rules must be gone (de-duplication).
      assert.doesNotMatch(html, /\.(ac|us|ft|co)-table(-wrap)?\s*\{/);
      assert.doesNotMatch(html, /table\.(ac|us|ft|co)-table\b/);
      assert.doesNotMatch(html, /\.btn-(primary|secondary|danger)\s*\{/);
      assert.doesNotMatch(html, /\.(ac|co)-modal(-backdrop|-actions)?\s*\{/);
      assert.doesNotMatch(html, /\.(ac|co)-chip\s*\{/);
    });
  }
});

describe('Sprint 18.3 — Pattern #26 (no inline colour/bg in migrated JS)', () => {
  for (const [name, js] of Object.entries(MIGRATED_JS)) {
    test(`${name} has no inline colour/bg styles`, () => {
      assert.doesNotMatch(js, /style\s*=\s*["'][^"']*color\s*:/);
      assert.doesNotMatch(js, /style\s*=\s*["'][^"']*background/);
    });
  }
});
