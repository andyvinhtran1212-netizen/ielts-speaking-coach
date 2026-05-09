/**
 * frontend/tests/iframe-composition-docs.test.mjs — Sprint 6.3.1 hotfix.
 *
 * Run with: node --test frontend/tests/iframe-composition-docs.test.mjs
 *
 * Pin against AMBER #2 from the Codex audit (2026-05-09): the
 * vocabulary tabs use `<iframe>` as a UX composition pattern, NOT a
 * security sandbox. The audit's concern was that this distinction
 * wasn't documented anywhere — a future contributor seeing iframes
 * could mistake them for an isolation boundary.
 *
 * What this guards:
 *   • DESIGN_SYSTEM.md explicitly states iframes are composition,
 *     not a security boundary
 *   • DESIGN_SYSTEM.md warns that adding `sandbox="allow-same-origin"`
 *     does NOT add isolation (the common mis-fix)
 *   • TECH_DEBT.md DEBT-2026-05-09-B references the audit + lists the
 *     un-defer triggers (mobile perf, cross-tab state, future XSS,
 *     commercial launch prep)
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));


let designSystem;
let techDebt;

before(() => {
  designSystem = readFileSync(
    path.join(__dirname, '..', 'css', 'aver-design', 'DESIGN_SYSTEM.md'),
    'utf8',
  );
  techDebt = readFileSync(
    path.join(__dirname, '..', '..', 'TECH_DEBT.md'),
    'utf8',
  );
});


describe('DESIGN_SYSTEM.md / iframe composition pattern', () => {
  test('declares iframe is composition, NOT a security boundary', () => {
    // Loose regex so the wording can evolve. Match either phrasing.
    assert.ok(
      /composition[\s\S]{0,80}\bnot\b[\s\S]{0,80}(sandbox|security|boundary|isolation)/i.test(designSystem) ||
      /\bnot\b[\s\S]{0,80}(security|isolation)\b[\s\S]{0,80}boundary/i.test(designSystem),
      'DESIGN_SYSTEM.md must clearly state the iframe pattern is ' +
      'composition, not a security boundary',
    );
  });

  test('mentions the iframes do not have a sandbox attribute', () => {
    assert.ok(
      /sandbox/.test(designSystem),
      'DESIGN_SYSTEM.md must mention the sandbox attribute (or its ' +
      'absence) so future contributors understand the trade-off',
    );
  });

  test('warns that allow-same-origin sandbox does NOT add isolation', () => {
    // The "quick fix" trap: adding sandbox="allow-same-origin allow-scripts"
    // looks like it tightens security but actually preserves the same
    // same-origin reach the unprefixed iframe already has. The doc must
    // explicitly call out this mis-fix.
    assert.ok(
      /allow-same-origin/.test(designSystem),
      'DESIGN_SYSTEM.md must warn that sandbox="allow-same-origin ..." ' +
      'is NOT a real isolation fix',
    );
  });

  test('points future contributors at the un-defer trigger list', () => {
    assert.match(
      designSystem,
      /DEBT-2026-05-09-B|TECH_DEBT\.md/,
      'DESIGN_SYSTEM.md must cross-reference the canonical un-defer ' +
      'trigger list in TECH_DEBT.md',
    );
  });
});


describe('TECH_DEBT.md / DEBT-2026-05-09-B audit cross-reference', () => {
  test('DEBT entry exists and references the Codex audit', () => {
    // The DEBT entry was created in the foundation sprint; the audit
    // hotfix extends it with the AMBER #2 cross-reference. Both must
    // be present.
    const debtBlock = techDebt.match(
      /DEBT-2026-05-09-B[\s\S]*?(?=DEBT-2026-05-09-C|^####|^---)/m,
    );
    assert.ok(
      debtBlock,
      'TECH_DEBT.md must contain the DEBT-2026-05-09-B entry block',
    );
    assert.match(
      debtBlock[0],
      /Codex audit|AMBER #2/i,
      'DEBT-2026-05-09-B must reference the Codex audit / AMBER #2 ' +
      'so the connection to the audit is discoverable',
    );
  });

  test('DEBT entry lists at least 3 distinct un-defer triggers', () => {
    const debtBlock = techDebt.match(
      /DEBT-2026-05-09-B[\s\S]*?(?=DEBT-2026-05-09-C|^####|^---)/m,
    );
    assert.ok(debtBlock);
    // Look for the canonical trigger list: mobile perf, cross-tab state,
    // future XSS, and commercial launch prep should each appear at
    // least once.
    const triggers = [
      /mobile|performance/i,
      /cross-tab|shared state/i,
      /XSS|DOM/i,
      /commercial launch|Phase E/i,
    ];
    const matched = triggers.filter(re => re.test(debtBlock[0])).length;
    assert.ok(
      matched >= 3,
      `DEBT-2026-05-09-B should list at least 3 un-defer triggers ` +
      `(mobile perf, cross-tab state, XSS, Phase E); only ${matched} found.`,
    );
  });

  test('DEBT entry warns that allow-same-origin sandbox is not a fix', () => {
    const debtBlock = techDebt.match(
      /DEBT-2026-05-09-B[\s\S]*?(?=DEBT-2026-05-09-C|^####|^---)/m,
    );
    assert.ok(debtBlock);
    // Same anti-mis-fix point as in DESIGN_SYSTEM.md, kept here too
    // so a contributor reading the DEBT entry alone gets the warning.
    assert.match(
      debtBlock[0],
      /sandbox|same-origin/i,
      'DEBT-2026-05-09-B should explain why the sandbox attribute is ' +
      'not the canonical fix (module extraction is)',
    );
  });
});
