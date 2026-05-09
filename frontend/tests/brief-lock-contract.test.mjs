/**
 * frontend/tests/brief-lock-contract.test.mjs — Sprint 6.3.1 hotfix.
 *
 * Run with: node --test frontend/tests/brief-lock-contract.test.mjs
 *
 * Pin against AMBER #3 from the Codex audit (2026-05-09): the
 * UNIFIED_DESIGN_BRIEF.md previously claimed `.skill-card-locked` was
 * the canonical lock contract, but `js/home.js` actually applies
 * `.coming-soon` + `data-locked="true"`. A future redesign that
 * faithfully followed the wrong contract would silently break the
 * permission gate UX.
 *
 * What this guards:
 *   • The brief mentions the REAL homepage lock class (.coming-soon)
 *   • The brief mentions the data-locked attribute
 *   • The brief warns to inspect the page's JS before assuming
 *   • DESIGN_SYSTEM.md § 11.2 no longer lists .skill-card-locked as a
 *     JS-coupled immutable class (it isn't)
 *   • The runtime contract in home.js still matches what the brief
 *     describes — if home.js renames lock semantics, this test fires
 *     and the brief gets updated alongside.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));


let brief;
let designSystem;
let homeJs;

before(() => {
  brief = readFileSync(
    path.join(__dirname, '..', 'css', 'aver-design', 'UNIFIED_DESIGN_BRIEF.md'),
    'utf8',
  );
  designSystem = readFileSync(
    path.join(__dirname, '..', 'css', 'aver-design', 'DESIGN_SYSTEM.md'),
    'utf8',
  );
  homeJs = readFileSync(
    path.join(__dirname, '..', 'js', 'home.js'),
    'utf8',
  );
});


describe('UNIFIED_DESIGN_BRIEF.md / lock-state contract', () => {
  test('mentions the real homepage lock class (.coming-soon)', () => {
    // The brief must reference `.coming-soon` somewhere in its lock
    // discussion — that's what `home.js` actually adds when the
    // Writing permission is missing. If a future edit reverts the
    // brief to claim `.skill-card-locked` is the canonical class,
    // this fires.
    assert.ok(
      /\.coming-soon\b/.test(brief),
      'UNIFIED_DESIGN_BRIEF.md must reference the real .coming-soon ' +
      'lock class used by js/home.js renderSkillCard',
    );
  });

  test('mentions the data-locked="true" attribute', () => {
    assert.ok(
      /data-locked/.test(brief),
      'UNIFIED_DESIGN_BRIEF.md must reference data-locked, the ' +
      'attribute home.js sets to mark a card as permission-locked',
    );
  });

  test('warns to inspect the page\'s JS before redesigning', () => {
    // The anti-pattern note must direct future contributors to read
    // the runtime, not the doc. Loose regex so the wording can evolve
    // without flapping the test.
    assert.ok(
      /(inspect|read|verify|check).*\bJS\b|\bJS\b.*(inspect|read|verify|check)/i.test(brief),
      'UNIFIED_DESIGN_BRIEF.md must warn future redesigns to verify the ' +
      'page\'s JS render functions before assuming class names',
    );
  });

  test('lists at least the home.html row in the lock-state inventory', () => {
    // The inventory table is the operational artifact each redesign
    // sprint fills in. It must already include the verified row for
    // home.html so contributors have a working example to copy.
    assert.match(
      brief,
      /pages\/home\.html[\s\S]*?coming-soon[\s\S]*?data-locked/,
      'the lock-state inventory must contain the home.html row with ' +
      '.coming-soon + data-locked verified against home.js',
    );
  });
});


describe('DESIGN_SYSTEM.md / immutable class list correction', () => {
  test('does not present .skill-card-locked as a bare immutable JS-coupled class', () => {
    // .skill-card-locked appears in home.css as a CSS-only fallback
    // selector but is not actually applied by home.js. Listing it
    // bare in the immutable JS-coupled list misled future redesigns
    // (the AMBER #3 root cause). The corrected list either omits it
    // or annotates it with a "but verify" note.
    //
    // Test allows .skill-card-locked to appear ONLY when accompanied
    // by a corrective phrase like "verify" or "Note:" or "actually"
    // in the same paragraph.
    const lines = designSystem.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/skill-card-locked/.test(line)) continue;
      // Allow if the same line carries a corrective annotation.
      const corrected =
        /Note:|previously|actually|verify|inventory|see\s+UNIFIED_DESIGN_BRIEF/i.test(line);
      assert.ok(
        corrected,
        `DESIGN_SYSTEM.md line ${i + 1} mentions .skill-card-locked without ` +
        `a corrective note. The immutable class list should either drop it ` +
        `or annotate that home.js actually uses .coming-soon + data-locked. ` +
        `Line content: ${line.trim()}`,
      );
    }
  });
});


describe('home.js / runtime contract still matches the brief', () => {
  test('home.js applies the .coming-soon class on the lock branch', () => {
    // If home.js ever switches to .skill-card-locked or another class,
    // this test fires and the brief / inventory must be updated to
    // match. Looking for the class assignment specifically inside
    // the locked code path (which precedes the alert handler).
    const lockSection = homeJs.match(
      /permissions\.writing === false[\s\S]*?lockedAlert/,
    );
    assert.ok(
      lockSection,
      'expected a `permissions.writing === false` branch in home.js — ' +
      'if the gate moved or refactored, update this test and the brief',
    );
    assert.match(
      lockSection[0],
      /classList\.add\(['"]coming-soon['"]\)/,
      'home.js lock branch must add the .coming-soon class. If this ' +
      'failed, home.js renamed the lock class — UNIFIED_DESIGN_BRIEF.md ' +
      '§ 3.6.1 lock-state inventory must be updated alongside.',
    );
  });

  test('home.js sets data-locked="true" on the lock branch', () => {
    const lockSection = homeJs.match(
      /permissions\.writing === false[\s\S]*?lockedAlert/,
    );
    assert.ok(lockSection);
    assert.match(
      lockSection[0],
      /dataset\.locked\s*=\s*['"]true['"]/,
      'home.js lock branch must set dataset.locked = "true". If this ' +
      'failed, the data attribute was renamed and the brief inventory ' +
      'needs updating.',
    );
  });
});
