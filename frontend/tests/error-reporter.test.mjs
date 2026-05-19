/**
 * frontend/tests/error-reporter.test.mjs — Sprint 12.3.
 *
 * Pins the global error reporter at /js/error-reporter.js. Sentinel
 * tests against static source (the IIFE wires window.* handlers so
 * actual behavior is integration-tested via the backend POST endpoint).
 *
 * Coverage:
 *   - Double-load guard (idempotent against multiple includes)
 *   - UUID with safe fallback for old browsers
 *   - Dedup helper exported + capped
 *   - Fail-soft fetch (try/catch swallow)
 *   - window.error + unhandledrejection both listened
 *   - window.aver.reportError surface
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...rel) => readFileSync(join(__dirname, '..', ...rel), 'utf8');

const JS = read('js', 'error-reporter.js');


describe('Sprint 12.3 — error-reporter.js global handlers', () => {
  it('listens for window.error events', () => {
    assert.match(JS, /addEventListener\(['"]error['"]/);
  });
  it('listens for window.unhandledrejection events', () => {
    assert.match(JS, /addEventListener\(['"]unhandledrejection['"]/);
  });
  it('exposes window.aver.reportError surface', () => {
    assert.match(JS, /window\.aver\.reportError\s*=/);
  });
  it('exposes window.aver.requestId for correlation', () => {
    assert.match(JS, /window\.aver\.requestId\s*=/);
  });
});


describe('Sprint 12.3 — error-reporter.js fail-soft contract', () => {
  it('IIFE guards against double-load', () => {
    assert.match(JS, /window\.aver\._errorReporterLoaded/);
  });
  it('fetch() wrapped in try/catch (logging cannot escalate)', () => {
    // Verify the reportError function has a try/catch around fetch.
    assert.match(JS, /try[\s\S]{0,400}fetch[\s\S]{0,400}catch/);
  });
  it('crypto.randomUUID has a Math.random fallback', () => {
    assert.match(JS, /randomUUID/);
    assert.match(JS, /Math\.random/);
  });
  it('no-op when window.fetch is unavailable (old browsers)', () => {
    assert.match(JS, /typeof\s+window\.fetch\s*!==\s*['"]function['"]/);
  });
});


describe('Sprint 12.3 — error-reporter.js dedup', () => {
  it('exports a pure dedup-key helper for testability', () => {
    assert.match(JS, /window\.aver\._buildDedupKey\s*=/);
    assert.match(JS, /function\s+buildDedupKey/);
  });
  it('dedup set has a hard cap to prevent unbounded growth', () => {
    assert.match(JS, /MAX_DEDUP_ENTRIES/);
  });
  it('dedup key truncates to 500 chars', () => {
    assert.match(JS, /\.slice\(0,\s*500\)/);
  });
});


describe('Sprint 12.3 — error-reporter.js auth-aware reporting', () => {
  it('attaches Bearer token when available via getSupabase()', () => {
    assert.match(JS, /Authorization['"]\s*\]\s*=\s*['"]Bearer/);
    assert.match(JS, /getSupabase\(\)/);
  });
});


describe('Sprint 12.3 — chrome components autoload error-reporter', () => {
  it('aver-admin-chrome injects error-reporter.js on connect', () => {
    const chrome = read('js', 'components', 'aver-admin-chrome.js');
    assert.match(chrome, /data-aver-error-reporter/);
    assert.match(chrome, /\/js\/error-reporter\.js/);
  });

  it('aver-chrome injects error-reporter.js on connect', () => {
    const chrome = read('js', 'components', 'aver-chrome.js');
    assert.match(chrome, /data-aver-error-reporter/);
    assert.match(chrome, /\/js\/error-reporter\.js/);
  });

  it('legacy admin.html includes error-reporter.js directly', () => {
    const legacy = read('admin.html');
    assert.match(legacy, /<script\s+src="js\/error-reporter\.js"/);
  });
});
