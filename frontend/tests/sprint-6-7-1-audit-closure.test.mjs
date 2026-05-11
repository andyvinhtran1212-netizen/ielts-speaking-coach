/**
 * frontend/tests/sprint-6-7-1-audit-closure.test.mjs — Sprint 6.7.1.
 *
 * Run with: node --test frontend/tests/sprint-6-7-1-audit-closure.test.mjs
 *
 * Closes the 2 AMBER findings from Codex audit Sprint 6.7
 * (CODEX_AUDIT_SPRINT_6_7.md):
 *
 *   AMBER #1 — 3 hardcoded #ffffff color declarations in
 *              writing-dashboard.css broke dark theme contrast
 *              (--av-text-on-primary flips to #0A1628 in dark; white
 *              text on bright teal fails AA there)
 *
 *   AMBER #2 — UNIFIED_DESIGN_BRIEF.md § 3.6.1 lock-state inventory
 *              still said writing-dashboard.html was "TBD — verify
 *              before redesign", despite the page shipping in PR #132
 *
 * These pins guard against drift back to either failure mode.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');


// ── AMBER #1: token discipline on CTA text ────────────────────────


describe('AMBER #1 / writing-dashboard.css token discipline', () => {
  const css = readFileSync(
    path.join(REPO_ROOT, 'frontend/css/writing-dashboard.css'),
    'utf8',
  );

  test('zero hardcoded #ffffff color declarations remain', () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const matches = stripped.match(/color\s*:\s*#ffffff/gi) || [];
    assert.equal(
      matches.length,
      0,
      `Found ${matches.length} hardcoded color:#ffffff declarations. ` +
      `Use var(--av-text-on-primary) — it flips to #0A1628 in dark theme ` +
      `for AA contrast on the bright teal CTA.`,
    );
  });

  test('zero hardcoded #fff / white color declarations remain', () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const fffMatches = stripped.match(/color\s*:\s*#fff\b/gi) || [];
    const wordMatches = stripped.match(/color\s*:\s*white\b/gi) || [];
    assert.equal(fffMatches.length + wordMatches.length, 0,
      'No #fff or "white" color declarations allowed — use --av-text-on-primary');
  });

  test('all 3 CTA buttons use var(--av-text-on-primary)', () => {
    for (const cls of ['.btn-start-assignment', '.btn-primary', '.wd-modal-btn-submit']) {
      const re = new RegExp(`\\${cls}\\s*\\{[^}]*color\\s*:\\s*var\\(--av-text-on-primary\\)`);
      assert.match(
        css,
        re,
        `${cls} must declare color: var(--av-text-on-primary) — Sprint 6.7.1 AMBER #1 closure`,
      );
    }
  });
});


describe('--av-text-on-primary token shipped in tokens.css', () => {
  const tokens = readFileSync(
    path.join(REPO_ROOT, 'frontend/css/aver-design/tokens.css'),
    'utf8',
  );

  test('tokens.css defines --av-text-on-primary', () => {
    assert.match(
      tokens,
      /--av-text-on-primary\s*:/,
      'tokens.css must define --av-text-on-primary',
    );
  });

  test('token flips value between light and dark themes', () => {
    // The whole point of the token: white in light, dark navy in dark.
    // If both themes have the same value, the dark-theme CTA breaks AA.
    const lightVal = tokens.match(/:root[^{]*\{[^}]*--av-text-on-primary\s*:\s*([^;]+);/);
    const darkBlocks = tokens.match(/\[data-theme="dark"\][^{]*\{[\s\S]*?\}/g) || [];
    const darkVal = darkBlocks
      .map(b => b.match(/--av-text-on-primary\s*:\s*([^;]+);/))
      .filter(Boolean)
      .map(m => m[1].trim())[0];
    assert.ok(lightVal, 'light value of --av-text-on-primary must be defined under :root');
    assert.ok(darkVal, 'dark value of --av-text-on-primary must be defined under [data-theme="dark"]');
    assert.notEqual(
      lightVal[1].trim().toLowerCase(),
      darkVal.toLowerCase(),
      `--av-text-on-primary must flip between themes: light="${lightVal[1].trim()}" vs dark="${darkVal}". ` +
      `Same value in both themes means the CTA fails AA in one of them.`,
    );
  });
});


describe('DESIGN_SYSTEM.md / --av-text-on-primary usage convention', () => {
  const md = readFileSync(
    path.join(REPO_ROOT, 'frontend/css/aver-design/DESIGN_SYSTEM.md'),
    'utf8',
  );

  test('documents the inverse-on-brand text token', () => {
    assert.match(
      md,
      /Inverse-on-brand|--av-text-on-primary/,
      'DESIGN_SYSTEM.md § 4 must document --av-text-on-primary so future contributors find it',
    );
  });

  test('labels hardcoded #ffffff on CTAs as an anti-pattern', () => {
    assert.match(
      md,
      /Anti-pattern.*Sprint 6\.7.*AMBER\s*#?\s*1|AMBER\s*#?\s*1.*Sprint 6\.7|color:\s*#ffffff[\s\S]{0,200}wrong/i,
      'DESIGN_SYSTEM.md must label hardcoded color:#ffffff on CTAs as an anti-pattern with Sprint 6.7 AMBER #1 reference',
    );
  });
});


// ── AMBER #2: brief writing-dashboard row + Writing IA note ───────


describe('AMBER #2 / UNIFIED_DESIGN_BRIEF.md writing-dashboard row', () => {
  const brief = readFileSync(
    path.join(REPO_ROOT, 'frontend/css/aver-design/UNIFIED_DESIGN_BRIEF.md'),
    'utf8',
  );

  test('writing-dashboard row no longer says "TBD"', () => {
    // Extract the writing-dashboard.html row from the lock-state table.
    // The row should be a single `| ... | ... | ... | ... | ... |` line.
    const rowMatch = brief.match(/\|\s*`pages\/writing-dashboard\.html`\s*\|[^\n]*/);
    assert.ok(rowMatch, 'writing-dashboard.html row must exist in lock-state inventory');
    assert.ok(
      !/\bTBD\b/i.test(rowMatch[0]),
      `writing-dashboard.html row still says TBD: "${rowMatch[0].slice(0, 200)}"`,
    );
  });

  test('writing-dashboard row references the actual shipped contract', () => {
    const rowMatch = brief.match(/\|\s*`pages\/writing-dashboard\.html`\s*\|[^\n]*/);
    assert.ok(rowMatch, 'writing-dashboard.html row must exist');
    // Must reference at least one of: the preview banner ID, the
    // permission-gating function, or the disabled CTA class names.
    const hasContract = /writing-preview-banner|applyWritingPermissionGating|btn-start-assignment|modal-btn-submit/.test(rowMatch[0]);
    assert.ok(
      hasContract,
      `writing-dashboard row should reference shipped JS contract (writing-preview-banner / applyWritingPermissionGating / btn-start-assignment / modal-btn-submit). Got: "${rowMatch[0].slice(0, 200)}"`,
    );
  });

  test('writing-dashboard row mentions Sprint 6.7 / PR #132 shipping', () => {
    const rowMatch = brief.match(/\|\s*`pages\/writing-dashboard\.html`\s*\|[^\n]*/);
    assert.ok(rowMatch, 'writing-dashboard.html row must exist');
    assert.ok(
      /Sprint 6\.7|PR\s*#?\s*132/.test(rowMatch[0]),
      'writing-dashboard row must reference Sprint 6.7 or PR #132 so the ship date is discoverable',
    );
  });
});


describe('UNIFIED_DESIGN_BRIEF.md / Writing IA architectural note', () => {
  const brief = readFileSync(
    path.join(REPO_ROOT, 'frontend/css/aver-design/UNIFIED_DESIGN_BRIEF.md'),
    'utf8',
  );

  test('has a Writing IA section (3.6.4) documenting teacher-assignment workflow', () => {
    assert.match(
      brief,
      /3\.6\.4[\s\S]{0,200}Writing IA|Writing IA[\s\S]{0,200}teacher.?assignment/i,
      'UNIFIED_DESIGN_BRIEF.md must have a § 3.6.4 Writing IA section',
    );
  });

  test('IA note documents asymmetry between Writing (teacher-assignment) and Speaking (self-directed)', () => {
    // Find a paragraph mentioning both workflow types — the contrast is the point.
    const hasContrast = /(teacher.?assignment[\s\S]{0,500}self.?directed)|(self.?directed[\s\S]{0,500}teacher.?assignment)/i.test(brief);
    assert.ok(
      hasContrast,
      'IA note must contrast teacher-assignment (Writing) vs self-directed (Speaking) — the asymmetry is the architectural finding',
    );
  });

  test('IA note tells future Writing-flow redesigns NOT to design self-directed UI', () => {
    assert.match(
      brief,
      /(?:Don't|don't|Do not|inherit).{0,200}self.?directed|self.?directed.{0,200}(?:Don't|don't|Do not|change)/i,
      'IA note must warn future Writing-flow sprints not to design self-directed UI unless the IA decision changes upstream',
    );
  });

  test('IA note defers the self-directed question to Phase 5+', () => {
    assert.match(
      brief,
      /Phase\s*5\+?|Phase\s*5/i,
      'IA note must explicitly defer the self-directed Writing IA question to Phase 5+',
    );
  });
});
