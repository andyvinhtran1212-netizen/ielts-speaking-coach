/**
 * frontend/tests/admin-error-logs-humanize.test.mjs — 2026-07-02.
 *
 * humanizeError() turns the raw stored error message (Postgres dict reprs,
 * third-party JS errors, test entries) into a plain-language summary + category
 * so a non-engineer admin can triage the error log. These tests pin the
 * categorisation against the real messages pulled from the production log.
 *
 * admin-error-logs.js auto-runs main() on load, so we sandbox it with
 * document.readyState = 'loading' (defers main() to a DOMContentLoaded that
 * never fires) and stub window/document just enough for the module body to run.
 */

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(__dirname, '..', 'js', 'admin-error-logs.js'), 'utf8');

function loadModule() {
  const noop = () => {};
  const fakeDocument = {
    readyState: 'loading',           // → main() deferred, never runs in the test
    addEventListener: noop,
    getElementById: () => null,
  };
  const fakeWindow = { api: { base: '' }, initSupabase: noop, getSupabase: () => null };
  const ctx = vm.createContext({
    window: fakeWindow, document: fakeDocument,
    console: { error: noop, warn: noop, log: noop },
    Set, String, JSON, Math, Date, Promise, setTimeout, clearTimeout,
  });
  vm.runInContext(SOURCE, ctx);
  return ctx;
}

const H = loadModule().humanizeError;

describe('humanizeError — categorisation', () => {
  test('Postgres NOT NULL (23502) → CSDL with the column name', () => {
    const h = H({ source: 'backend', message:
      "{'message': 'null value in column \"prompt_version\" of relation \"writing_feedback\" violates not-null constraint', 'code': '23502'}" });
    assert.equal(h.category, 'CSDL');
    assert.equal(h.noise, false);
    assert.match(h.summary, /prompt_version/);
    assert.match(h.summary, /writing_feedback/);
  });

  test('missing table (PGRST205) → CSDL "không tồn tại"', () => {
    const h = H({ source: 'backend', message:
      "{'message': \"Could not find the table 'public.writing_tips' in the schema cache\", 'code': 'PGRST205'}" });
    assert.equal(h.category, 'CSDL');
    assert.match(h.summary, /không tồn tại/);
  });

  test('undefined column (42703) → CSDL', () => {
    const h = H({ source: 'backend', message:
      "{'message': 'column writing_essays.overall_band_score does not exist', 'code': '42703'}" });
    assert.equal(h.category, 'CSDL');
    assert.match(h.summary, /overall_band_score/);
  });

  test('Zalo third-party → Bên thứ 3, noise', () => {
    const h = H({ source: 'frontend', message: 'Uncaught ReferenceError: zaloJSV2 is not defined' });
    assert.equal(h.category, 'Bên thứ 3');
    assert.equal(h.noise, true);
  });

  test('opaque "Script error." → Bên thứ 3, noise', () => {
    const h = H({ source: 'frontend', message: 'Script error.' });
    assert.equal(h.noise, true);
  });

  test('test/dogfood entry → Thử nghiệm, noise', () => {
    const h = H({ source: 'backend', message: 'Test exception from /admin/error-logs/test endpoint' });
    assert.equal(h.category, 'Thử nghiệm');
    assert.equal(h.noise, true);
  });

  test('frontend null read → Giao diện with the property name', () => {
    const h = H({ source: 'frontend', message: "Cannot read properties of null (reading 'essay')" });
    assert.equal(h.category, 'Giao diện');
    assert.equal(h.noise, false);
    assert.match(h.summary, /essay/);
  });

  test('SSL / network → Mạng', () => {
    const h = H({ source: 'backend', message:
      '[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed (_ssl.c:1010)' });
    assert.equal(h.category, 'Mạng');
  });

  test('backend bare KeyError → Máy chủ', () => {
    const h = H({ source: 'backend', message: "'time_limit_minutes'" });
    assert.equal(h.category, 'Máy chủ');
    assert.match(h.summary, /time_limit_minutes/);
  });

  test('unknown message → Khác, not noise', () => {
    const h = H({ source: 'backend', message: 'Something totally unexpected happened' });
    assert.equal(h.category, 'Khác');
    assert.equal(h.noise, false);
  });
});
