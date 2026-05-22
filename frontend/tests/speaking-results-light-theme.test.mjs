/**
 * frontend/tests/speaking-results-light-theme.test.mjs — Sprint 14.1.
 *
 * Source-regex sentinels for the speaking-results light-theme fix.
 * The project ships vanilla static HTML with no headless-browser harness
 * in CI, so the contrast bug + the fix are both source-traceable rather
 * than DOM-rendered. These pins guard against:
 *
 *   - The :root[data-theme="light"] override block disappearing from
 *     ds.css (Patch 1 regression).
 *   - Result-page .ds-* rules re-introducing hardcoded white literals
 *     (Patch 2 regression).
 *   - The dark-theme :root block losing the legacy literal values
 *     (L5 dark-theme backward-compat).
 *   - result.html silently renaming the classes the fix targets
 *     (Sprint 14.0 Discovery anchor: result.html → .ds-band-hero /
 *     .ds-crit / etc. chain).
 *
 * Pinned at the source-string level rather than computed-style level.
 * The contrast math behind WCAG AA is in the spike doc; these tests
 * pin the *structural* fix that the math depends on.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
function read(...parts) {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

const DS_CSS   = read('css', 'ds.css');
const TOKENS   = read('css', 'aver-design', 'tokens.css');
const RESULT   = read('pages', 'result.html');
const SPIKE    = readFileSync(
  join(__dirname, '..', '..', 'commission', 'sprint_14_1_spike_findings.md'),
  'utf8',
);


// ── Patch 1: light-theme override block exists ─────────────────────────────


describe('Sprint 14.1 — ds.css light-theme override block', () => {

  test('ds.css ships a :root[data-theme="light"] block overriding --ds-* tokens', () => {
    // The single root cause from the spike: the legacy --ds-* tokens
    // (--ds-text, --ds-surface, --ds-border, --ds-muted, --ds-faint)
    // were hardcoded to rgba(255,255,255,X) literals at :root with no
    // [data-theme="light"] override. Patch 1 adds the override.
    const overrideRe = /:root\[data-theme="light"\]\s*\{[\s\S]*?\}/;
    const m = DS_CSS.match(overrideRe);
    assert.ok(m, 'ds.css must contain :root[data-theme="light"] override block');
    const block = m[0];
    // All five core --ds-* tokens must be redefined under light theme.
    for (const tok of [
      '--ds-text',
      '--ds-surface',
      '--ds-border',
      '--ds-muted',
      '--ds-faint',
      '--ds-bg',
    ]) {
      assert.ok(
        new RegExp(`${tok}\\s*:\\s*var\\(--av-`).test(block),
        `light override must alias ${tok} to a var(--av-*) token`,
      );
    }
  });

  test('light override targets the correct --av-* counterparts (semantic match)', () => {
    // The --ds-* names are semantic (text/surface/border/muted/faint)
    // and must map to the --av-* tokens with matching semantics so the
    // dark→light flip preserves meaning, not just contrast.
    const want = {
      '--ds-text':    'var(--av-text-primary)',
      '--ds-muted':   'var(--av-text-muted)',
      '--ds-faint':   'var(--av-text-faint)',
      '--ds-bg':      'var(--av-surface-page)',
      '--ds-surface': 'var(--av-surface-sunken)',
      '--ds-border':  'var(--av-border-default)',
    };
    const block = DS_CSS.match(/:root\[data-theme="light"\]\s*\{([\s\S]*?)\}/)[1];
    for (const [k, v] of Object.entries(want)) {
      assert.ok(
        block.includes(`${k}:`) && block.includes(v),
        `light override expected ${k} → ${v}`,
      );
    }
  });

  test('light override block sits AFTER the dark :root literals (so light wins on flip)', () => {
    // CSS cascade order matters when [data-theme="light"] activates —
    // the override must appear after the base :root so it takes effect.
    const baseIdx = DS_CSS.search(/:root\s*\{/);
    const lightIdx = DS_CSS.search(/:root\[data-theme="light"\]\s*\{/);
    assert.ok(baseIdx >= 0, 'base :root block must exist');
    assert.ok(lightIdx >= 0, 'light override block must exist');
    assert.ok(lightIdx > baseIdx,
      'light override must appear AFTER base :root in source order');
  });

});


// ── Patch 2: hardcoded literals migrated to --ds-* tokens ──────────────────


describe('Sprint 14.1 — result-page .ds-* rules use tokens, not rgba(255,255,255) literals', () => {

  // The selectors below were captured in the spike inventory § 1.
  // Each one must contain zero rgba(255,255,255,*) literals in its
  // rule body. Regex extracts the body between `{` and the next `}`.
  const MIGRATED_SELECTORS = [
    '\\.ds-question-card\\s*\\{',
    '\\.ds-question-card\\s+\\.ds-q-text\\s*\\{',
    '\\.ds-cue-bullet\\s*\\{',
    '\\.ds-crit\\s*\\{',
    '\\.ds-crit:hover\\s*\\{',
    '\\.ds-empty-title\\s*\\{',
    '\\.ds-strength-item\\s*\\{',
    '\\.ds-improve-item\\s*\\{',
    '\\.ds-progress-track\\s*\\{',
    '\\.ds-band-pill\\s*\\{',
    '\\.btn-secondary\\s*\\{',
  ];

  for (const sel of MIGRATED_SELECTORS) {
    test(`${sel.replace(/\\\\/g, '').replace(/\\s\*\\\{/, '')} body contains no rgba(255,255,255,*) literal`, () => {
      const re = new RegExp(`${sel}([^}]*)\\}`);
      const m = DS_CSS.match(re);
      assert.ok(m, `selector ${sel} must exist in ds.css`);
      assert.doesNotMatch(m[1], /rgba\(\s*255\s*,\s*255\s*,\s*255\s*,/,
        `Sprint 14.1: ${sel} body still contains rgba(255,255,255,*) literal — invisible on light theme`);
      assert.doesNotMatch(m[1], /(?<![\w])#fff(?:f{3})?\b/i,
        `Sprint 14.1: ${sel} body still contains #fff literal — invisible on light theme`);
    });
  }

  test('every migrated selector references at least one --ds-* token', () => {
    // Defensive — confirms the migration replaced the literal with a
    // token, not deleted the rule.
    for (const sel of MIGRATED_SELECTORS) {
      const re = new RegExp(`${sel}([^}]*)\\}`);
      const m = DS_CSS.match(re);
      assert.ok(m, `selector ${sel} must exist`);
      assert.match(m[1], /var\(--ds-[a-z-]+\)/,
        `${sel} body must reference at least one var(--ds-*) token`);
    }
  });

});


// ── L5: dark-theme regression guard ────────────────────────────────────────


describe('Sprint 14.1 — dark theme backward-compat (L5)', () => {

  test('base :root keeps the legacy dark-theme rgba(255,255,255,*) values', () => {
    // The light override aliases to --av-* tokens. Dark theme MUST
    // keep the existing literals so the dark appearance is byte-stable.
    const baseBlockRe = /:root\s*\{([\s\S]*?)\}/;
    const block = DS_CSS.match(baseBlockRe)[1];
    assert.match(block, /--ds-text\s*:\s*rgba\(255,255,255,0\.85\)/);
    assert.match(block, /--ds-surface\s*:\s*rgba\(255,255,255,0\.04\)/);
    assert.match(block, /--ds-border\s*:\s*rgba\(255,255,255,0\.08\)/);
    assert.match(block, /--ds-muted\s*:\s*rgba\(255,255,255,0\.4\)/);
    assert.match(block, /--ds-faint\s*:\s*rgba\(255,255,255,0\.15\)/);
  });

  test('tokens.css still defines light + dark blocks (no token system regression)', () => {
    // Anchor finding from Sprint 14.0 Discovery — keep it pinned.
    assert.match(TOKENS, /:root\[data-theme="light"\]\s*\{/);
    assert.match(TOKENS, /:root\[data-theme="dark"\]\s*\{/);
    assert.match(TOKENS, /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/);
  });

});


// ── Sprint 14.0 Discovery anchor: result.html uses the migrated classes ────


describe('Sprint 14.1 — result.html → ds.css class chain (rename guard)', () => {

  test('result.html still renders via .ds-band-hero / .ds-band-value', () => {
    // If a future redesign renames these to .av-band-hero or similar,
    // the ds.css fix would still ship but the page would no longer
    // pick it up. Pin the chain.
    assert.match(RESULT, /class="ds-band-hero/);
    assert.match(RESULT, /class="ds-band-value/);
    assert.match(RESULT, /class="ds-band-label"/);
  });

  test('result.html still renders the 4 criterion cards via .ds-crit-{fc,lr,gra,p}', () => {
    assert.match(RESULT, /class="ds-crit ds-crit-fc"/);
    assert.match(RESULT, /class="ds-crit ds-crit-lr"/);
    assert.match(RESULT, /class="ds-crit ds-crit-gra"/);
    assert.match(RESULT, /class="ds-crit ds-crit-p"/);
  });

  test('result.html uses .btn-secondary for the secondary CTAs (migrated rule)', () => {
    // The Quay lại / Retry / audio toggle buttons all hit .btn-secondary,
    // which is migrated above. If the class is renamed away, the
    // migration loses its target.
    assert.match(RESULT, /class="btn-secondary/);
  });

});


// ── Spike + Patch provenance pins ──────────────────────────────────────────


describe('Sprint 14.1 — spike + patch provenance', () => {

  test('ds.css carries a Sprint 14.1 narrative comment near the override block', () => {
    // Long-running CSS without a why-comment loses context fast. Pin
    // that the fix narrative survives a doc-cleanup pass.
    assert.match(DS_CSS, /Sprint 14\.1/);
    assert.match(DS_CSS, /Andy 2026-05-22/);
    assert.match(DS_CSS, /aver-design tokens\.css/);
  });

  test('spike findings doc exists and names the root cause + fix scope', () => {
    assert.match(SPIKE, /:root\[data-theme="light"\]/);
    assert.match(SPIKE, /Patch 1/);
    assert.match(SPIKE, /Patch 2/);
    // L2 — combined PR decision documented (not split to 14.1.1).
    assert.match(SPIKE, /combined Sprint 14\.1.*no split/i);
  });

  test('spike documents WCAG-AA contrast math for the residual amber band-value risk', () => {
    // Phase B item #2 from the spike — surface to the doc so the
    // Sprint 14.4 rubric overhaul has the trigger captured.
    assert.match(SPIKE, /#fbbf24/);
    assert.match(SPIKE, /WCAG AA/i);
  });

});
