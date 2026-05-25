/**
 * frontend/tests/sprint-16-3-retention-warning.test.mjs — Sprint 16.3.1 (Warning UI v2)
 *
 * Deletion-warning chips + banner for the speaking.html history list, consuming
 * the Sprint 16.2.1 v2 retention block (audio 15d / content 60d). Functionally
 * exercises retention-warning.js (3 variants + priority), pins Pattern #25/#26
 * (token-only, no inline literals), Pattern #29 (legacy/missing block → no chip,
 * no crash), and the speaking.html / ds.css wiring — no headless browser.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const SRC      = front('js', 'retention-warning.js');
const DS_CSS   = front('css', 'ds.css');
const SPEAKING = front('pages', 'speaking.html');

function build() {
  const win = {};
  new Function('window', SRC)(win);
  return win.RetentionWarning;
}
const RW = build();

// v2 retention block helpers.
const block = (o) => Object.assign({
  days_until_audio_purge: 15, days_until_content_purge: 60,
  is_audio_purged: false, is_content_purged: false, is_hidden: false,
}, o);


// ── chipFor — 3 variants + priority ─────────────────────────────────────────

describe('Sprint 16.3.1 — chipFor v2 variants', () => {
  test('fresh session (both far) → no chip', () => {
    assert.strictEqual(RW.chipFor(block({})), null);
  });

  test('audio purge imminent (≤3d, not purged) → audio-soon', () => {
    const c = RW.chipFor(block({ days_until_audio_purge: 2 }));
    assert.ok(c && c.variant === 'audio-soon' && c.days === 2);
  });

  test('audio already gone, content alive → audio-gone', () => {
    const c = RW.chipFor(block({ days_until_audio_purge: 0, is_audio_purged: true, days_until_content_purge: 40 }));
    assert.ok(c && c.variant === 'audio-gone');
  });

  test('content purge imminent (≤7d) → content-soon', () => {
    const c = RW.chipFor(block({ days_until_content_purge: 5, days_until_audio_purge: 0, is_audio_purged: true }));
    assert.ok(c && c.variant === 'content-soon' && c.days === 5);
  });

  test('PRIORITY: content-soon beats audio-gone (urgent report loss wins)', () => {
    // Audio gone + content also within 7d → must surface the RED content warning,
    // not the gray audio-gone. (Guards the 16.3.1 ordering fix: audio is always
    // purged before content nears purge, so audio-gone-first would mask this.)
    const c = RW.chipFor(block({ is_audio_purged: true, days_until_audio_purge: 0, days_until_content_purge: 3 }));
    assert.strictEqual(c.variant, 'content-soon');
  });

  test('content already purged → no chip (gone from list)', () => {
    assert.strictEqual(RW.chipFor(block({ is_content_purged: true, is_audio_purged: true, days_until_content_purge: 0 })), null);
  });

  test('Pattern #29: null / missing / legacy(v1) block → no chip, no throw', () => {
    assert.strictEqual(RW.chipFor(null), null);
    assert.strictEqual(RW.chipFor(undefined), null);
    assert.strictEqual(RW.chipFor({}), null);
    // A v1 block (days_until_hide only) has none of the v2 numeric fields → null.
    assert.strictEqual(RW.chipFor({ days_until_hide: 2, is_hidden: false }), null);
  });
});


// ── chipHtml / countSoonHidden / bannerHtml ─────────────────────────────────

describe('Sprint 16.3.1 — render helpers', () => {
  test('chipHtml emits the variant class + VN label; empty when no chip', () => {
    assert.match(RW.chipHtml(block({ days_until_content_purge: 4 })),
      /class="ds-retention-chip ds-retention-chip--content-soon".*Báo cáo sắp xóa trong 4 ngày/);
    assert.match(RW.chipHtml(block({ days_until_audio_purge: 1 })),
      /ds-retention-chip--audio-soon.*Audio sắp xóa trong 1 ngày/);
    assert.match(RW.chipHtml(block({ is_audio_purged: true, days_until_audio_purge: 0 })),
      /ds-retention-chip--audio-gone.*Audio đã xóa/);
    assert.strictEqual(RW.chipHtml(block({})), '');
    assert.strictEqual(RW.chipHtml(null), '');
  });

  test('countSoonHidden counts only actionable (audio-soon + content-soon), not audio-gone', () => {
    const sessions = [
      { retention: block({ days_until_audio_purge: 2 }) },                                 // audio-soon ✓
      { retention: block({ days_until_content_purge: 6, is_audio_purged: true }) },        // content-soon ✓
      { retention: block({ is_audio_purged: true, days_until_audio_purge: 0, days_until_content_purge: 40 }) }, // audio-gone ✗
      { retention: block({}) },                                                            // fresh ✗
      {},                                                                                  // legacy ✗
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
    assert.match(b, /3 phiên/);
  });
});


// ── Pattern #25 / #26 — token-only, no inline color/bg/hex literals ─────────

describe('Sprint 16.3.1 — retention-warning.js carries no inline color/bg/hex (Pattern #26)', () => {
  test('no inline style="...color:" / background literal', () => {
    assert.doesNotMatch(SRC, /style\s*=\s*["'][^"']*color\s*:/);
    assert.doesNotMatch(SRC, /style\s*=\s*["'][^"']*background/);
  });
  test('no rgba()/hex colour literals — colour comes from ds.css tokens only', () => {
    assert.doesNotMatch(SRC, /rgba\(\s*\d+\s*,/);
    assert.doesNotMatch(SRC, /#[0-9a-fA-F]{3,6}\b/);
  });
});

describe('Sprint 16.3.1 — ds.css variants bind tokens (both themes, Pattern #25)', () => {
  test('content-soon chip uses var(--ds-danger-*); audio-gone uses var(--ds-muted)', () => {
    assert.match(DS_CSS, /\.ds-retention-chip--content-soon\s*\{[\s\S]*?var\(--ds-danger-bg\)/);
    assert.match(DS_CSS, /\.ds-retention-chip--content-soon\s*\{[\s\S]*?var\(--ds-danger-text\)/);
    assert.match(DS_CSS, /\.ds-retention-chip--audio-gone\s*\{[\s\S]*?var\(--ds-muted\)/);
  });
  test('--ds-danger-* defined in :root (dark) AND light override (WCAG AA)', () => {
    assert.match(DS_CSS, /:root\s*\{[\s\S]*?--ds-danger-bg\s*:/);
    assert.match(DS_CSS, /:root\[data-theme="light"\]\s*\{[\s\S]*?--ds-danger-text\s*:\s*#991b1b/);
  });
});


// ── Integration: speaking.html wiring unchanged (Pattern #34) ───────────────

describe('Sprint 16.3.1 — speaking.html wiring (stable public API)', () => {
  test('includes retention-warning.js + banner mount + renderHistory calls', () => {
    assert.match(SPEAKING, /<script src="\.\.\/js\/retention-warning\.js"><\/script>/);
    assert.match(SPEAKING, /id="history-retention-banner"/);
    assert.match(SPEAKING, /RW\.chipHtml\(s\.retention\)/);
    assert.match(SPEAKING, /RW\.bannerHtml\(RW\.countSoonHidden\(visible\)\)/);
  });
});
