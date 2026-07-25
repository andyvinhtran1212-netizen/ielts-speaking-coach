/**
 * brand-favicon.test.mjs — DEBT-2026-07-24-I, favicon half.
 *
 * The 2026-07-24 brand work locked direction "Mũi lên" (upward chevron + amber
 * spark) and retired the old navy-square "A". Rolling the whole identity onto
 * the web is still blocked on the Next migration, because the wordmark exists
 * separately in the legacy chrome and in the Next landing — apply it now and
 * you apply it twice.
 *
 * The favicon is the exception, and that is why it ships alone: there is ONE
 * file at `frontend/public/favicon.svg` and every page references it by the
 * same absolute `/favicon.svg`, which Next serves from `public/` too. One file,
 * one path, both stacks — no double-application risk.
 *
 * It also closes a colour inconsistency the old file carried: teal-500
 * `#14b8a6` where the brand teal is `#0F766E` (see the DEBT-I write-up).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const LIVE = read('frontend/public/favicon.svg');
const SOURCE = read('docs/brand/assets/favicon.svg');

describe('DEBT-I (favicon half) — the shipped favicon is the brand mark', () => {
  test('it is byte-identical to the locked brand source', () => {
    // The source of truth is docs/brand/assets/ (merged in #826). Copying
    // rather than re-drawing means the two cannot drift.
    assert.equal(LIVE, SOURCE, 'frontend/public/favicon.svg must be a copy of docs/brand/assets/favicon.svg');
  });

  test('carries the "Mũi lên" mark, not the retired square "A"', () => {
    assert.match(LIVE, /<path[^>]*d="M25 72 L50 32 L75 72"/, 'upward chevron missing');
    assert.match(LIVE, /<circle[^>]*fill="#F59E0B"/, 'amber spark missing');
    assert.ok(!/<text/.test(LIVE), 'the old letter-"A" favicon must be gone');
    assert.ok(!/Inter/.test(LIVE), 'the old file pinned Inter, a font the system no longer uses');
  });

  test('uses brand teal #0F766E, not the teal-500 the old file had', () => {
    assert.match(LIVE, /fill="#0F766E"/);
    assert.ok(!/#14b8a6/i.test(LIVE), 'teal-500 is the DARK-theme step, wrong for a fixed asset');
  });

  test('still the single shared icon both stacks resolve', () => {
    // If a second icon ever appears (an /icon.png, a Next metadata.icons entry),
    // this test is the place that notices — the "ship it alone" argument above
    // only holds while there is exactly one.
    const pages = [];
    const walk = (dir) => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(full);
        else if (ent.name.endsWith('.html')) pages.push(full);
      }
    };
    walk(path.join(REPO, 'frontend/public'));
    const wrong = pages
      .filter((f) => /rel="icon"/.test(readFileSync(f, 'utf8')))
      .filter((f) => !/href="\/favicon\.svg"/.test(readFileSync(f, 'utf8')))
      .map((f) => path.basename(f));
    assert.deepEqual(wrong, [], 'every page must resolve the same /favicon.svg');

    const nextLayout = read('frontend/app/layout.tsx');
    assert.ok(!/icons\s*:/.test(nextLayout),
      'a Next metadata.icons entry would override public/favicon.svg — update this test if one is added');
  });
});
