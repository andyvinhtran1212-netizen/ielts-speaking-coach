/**
 * frontend/tests/sprint-16-3-retention-warning.test.mjs — Sprint 16.3 (Direction B)
 *
 * Deletion-warning chips + banner for the speaking.html history list. Functionally
 * exercises retention-warning.js (pure consumers of the Sprint 16.2 `retention`
 * block) + pins Pattern #25/#26 (token-only, no inline literals), Pattern #29
 * (legacy API row with no retention block → no chip, no crash), and the
 * speaking.html / ds.css wiring — no headless browser.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const SRC          = front('js', 'retention-warning.js');
const DS_CSS       = front('css', 'ds.css');
const SPEAKING     = front('pages', 'speaking.html');

// Run the IIFE against a fake window to get the real exports (no DOM).
function build() {
  const win = {};
  new Function('window', SRC)(win);
  return win.RetentionWarning;
}
const RW = build();


// ── chipFor — threshold + guard logic ──────────────────────────────────────

describe('Sprint 16.3 — chipFor threshold logic', () => {
  test('soon-hide (days_until_hide ≤ 3, visible) → soon chip with VN copy', () => {
    const c = RW.chipFor({ days_until_hide: 2, days_until_purge: 25, is_hidden: false, is_purged: false });
    assert.ok(c && c.variant === 'soon');
    assert.match(c.label, /Sắp ẩn trong 2 ngày/);
  });

  test('far from hide (days_until_hide = 10) → no chip', () => {
    assert.strictEqual(RW.chipFor({ days_until_hide: 10, is_hidden: false }), null);
  });

  test('already hidden / purged → no soon chip', () => {
    assert.strictEqual(RW.chipFor({ days_until_hide: 0, is_hidden: true }), null);
    assert.strictEqual(RW.chipFor({ days_until_hide: 0, is_purged: true }), null);
  });

  test('boundary: exactly HIDE_WARN_DAYS triggers; one more does not', () => {
    assert.ok(RW.chipFor({ days_until_hide: RW.HIDE_WARN_DAYS, is_hidden: false }));
    assert.strictEqual(RW.chipFor({ days_until_hide: RW.HIDE_WARN_DAYS + 1, is_hidden: false }), null);
  });

  test('Pattern #29: null / missing / non-numeric retention → no chip, no throw', () => {
    assert.strictEqual(RW.chipFor(null), null);
    assert.strictEqual(RW.chipFor(undefined), null);
    assert.strictEqual(RW.chipFor({}), null);
    assert.strictEqual(RW.chipFor({ days_until_hide: 'soon' }), null);
  });
});


// ── chipHtml / countSoonHidden / bannerHtml ─────────────────────────────────

describe('Sprint 16.3 — render helpers', () => {
  test('chipHtml uses the themed class + VN label; empty when no warning', () => {
    const html = RW.chipHtml({ days_until_hide: 1, is_hidden: false });
    assert.match(html, /class="ds-retention-chip ds-retention-chip--soon"/);
    assert.match(html, /Sắp ẩn/);
    assert.strictEqual(RW.chipHtml({ days_until_hide: 30, is_hidden: false }), '');
    assert.strictEqual(RW.chipHtml(null), '');
  });

  test('countSoonHidden counts only warning-window sessions (graceful on missing block)', () => {
    const sessions = [
      { retention: { days_until_hide: 2, is_hidden: false } },   // ✓
      { retention: { days_until_hide: 9, is_hidden: false } },   // ✗ far
      { retention: { days_until_hide: 0, is_hidden: true } },    // ✗ hidden
      { /* legacy row, no retention */ },                        // ✗ graceful
      { retention: { days_until_hide: 3, is_hidden: false } },   // ✓
    ];
    assert.strictEqual(RW.countSoonHidden(sessions), 2);
    assert.strictEqual(RW.countSoonHidden([]), 0);
    assert.strictEqual(RW.countSoonHidden(undefined), 0);
  });

  test('bannerHtml: empty for 0, alert banner with count for ≥1', () => {
    assert.strictEqual(RW.bannerHtml(0), '');
    const b = RW.bannerHtml(3);
    assert.match(b, /class="ds-warning-banner"/);
    assert.match(b, /role="alert"/);
    assert.match(b, /3 phiên sắp bị ẩn/);
  });
});


// ── Pattern #25 / #26 — token-only, no inline color/bg/hex literals ─────────

describe('Sprint 16.3 — retention-warning.js carries no inline color/bg/hex (Pattern #26)', () => {
  test('no inline style="...color:" / background literal in emitted HTML', () => {
    assert.doesNotMatch(SRC, /style\s*=\s*["'][^"']*color\s*:/);
    assert.doesNotMatch(SRC, /style\s*=\s*["'][^"']*background/);
  });
  test('no rgba()/hex colour literals — colour comes from ds.css tokens only', () => {
    assert.doesNotMatch(SRC, /rgba\(\s*\d+\s*,/);
    assert.doesNotMatch(SRC, /#[0-9a-fA-F]{3,6}\b/);
  });
  test('chip + banner reach colour via the canonical .ds-* classes', () => {
    assert.match(SRC, /class="ds-retention-chip ds-retention-chip--/);
    assert.match(SRC, /class="ds-warning-banner"/);
  });
});

describe('Sprint 16.3 — ds.css chip binds the --ds-warning-* tokens (both themes, Pattern #25)', () => {
  test('.ds-retention-chip uses var(--ds-warning-bg/border/text)', () => {
    assert.match(DS_CSS, /\.ds-retention-chip\s*\{[\s\S]*?var\(--ds-warning-bg\)/);
    assert.match(DS_CSS, /\.ds-retention-chip\s*\{[\s\S]*?var\(--ds-warning-border\)/);
    assert.match(DS_CSS, /\.ds-retention-chip\s*\{[\s\S]*?var\(--ds-warning-text\)/);
  });
});


// ── Integration: speaking.html wiring (Pattern #34) ─────────────────────────

describe('Sprint 16.3 — speaking.html wires the warning UI', () => {
  test('includes retention-warning.js', () => {
    assert.match(SPEAKING, /<script src="\.\.\/js\/retention-warning\.js"><\/script>/);
  });
  test('has the aggregate banner mount point', () => {
    assert.match(SPEAKING, /id="history-retention-banner"/);
  });
  test('renderHistory injects the chip + sets the banner via RetentionWarning', () => {
    assert.match(SPEAKING, /RW\.chipHtml\(s\.retention\)/);
    assert.match(SPEAKING, /RW\.bannerHtml\(RW\.countSoonHidden\(visible\)\)/);
  });
});
