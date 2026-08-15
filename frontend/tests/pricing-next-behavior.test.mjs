import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_PATH = path.join(FRONTEND, 'app', '(marketing)', 'pricing', 'page.tsx');
const PAGE = readFileSync(PAGE_PATH, 'utf8');
const LEGACY = readFileSync(path.join(FRONTEND, 'public', 'pricing.html'), 'utf8');
const NEXT_LANDING = readFileSync(path.join(FRONTEND, 'app', '(marketing)', 'page.tsx'), 'utf8');
const LEGACY_LANDING = readFileSync(path.join(FRONTEND, 'public', 'index.html'), 'utf8');
const LEDGER = readFileSync(path.join(FRONTEND, '../docs/ROUTE_LEDGER.md'), 'utf8');
const WORKFLOW = readFileSync(path.join(FRONTEND, '../.github/workflows/parity-gate.yml'), 'utf8');

describe('/pricing pre-launch native ownership', () => {
  test('Next owns the clean route with a server redirect only', () => {
    assert.ok(existsSync(PAGE_PATH));
    assert.match(PAGE, /import \{ redirect \} from 'next\/navigation'/);
    assert.match(PAGE, /redirect\('\/'\)/);
    assert.doesNotMatch(PAGE, /use client|useEffect|window\.location/);
  });

  test('legacy pricing remains a truthful rollback artifact', () => {
    assert.match(LEGACY, /window\.location\.replace\('\/'\)/);
    assert.match(LEGACY, /id="btn-monthly"/);
    assert.match(LEGACY, /id="faq-list"/);
  });

  test('both landing stacks enter the clean canonical route', () => {
    for (const source of [NEXT_LANDING, LEGACY_LANDING]) {
      assert.match(source, /href="\/pricing"/);
      assert.doesNotMatch(source, /href="\/pricing\.html"/);
    }
  });

  test('ledger records closed-state behavior and rollback boundary', () => {
    assert.match(LEDGER, /`\/pricing`[^\n]+app\/\(marketing\)\/pricing\/page\.tsx[^\n]+CUTOVER 2026-08-15/);
    assert.match(LEDGER, /`\/pricing`[^\n]+server redirect về `\/`[^\n]+Legacy[^\n]+redirect sentinel/);
  });

  test('CI verifies redirect semantics instead of fake same-page parity', () => {
    assert.match(WORKFLOW, /frontend\/app\/\(marketing\)\/pricing\/\*\*/);
    assert.match(WORKFLOW, /node tooling\/verify-pricing-redirect-flow\.mjs/);
  });
});
