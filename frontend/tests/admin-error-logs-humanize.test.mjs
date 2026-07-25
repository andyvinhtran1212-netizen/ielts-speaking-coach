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


describe('humanizeError — postgrest upstream 5xx (DEBT-2026-07-22-E)', () => {
  // The real 2026-07-22 payload. postgrest-py's generate_default_error_message
  // puts the HTTP STATUS in `code` as an INT — unquoted in the repr — and the
  // upstream body in `details`. One short Supabase platform blip produced 11
  // level=error rows shaped exactly like this.
  const REAL_555 = "{'message': 'JSON could not be generated', 'code': 555, "
    + "'hint': 'Refer to full message for details.', 'details': \"b'Internal server error.'\"}";

  test('the 555 blip lands in Mạng/warning, NOT Khác', () => {
    const h = H({ source: 'backend', message: REAL_555 });
    assert.equal(h.category, 'Mạng');
    assert.equal(h.tone, 'warning');
  });

  test('the summary names the status and shows the real upstream body', () => {
    const h = H({ source: 'backend', message: REAL_555 });
    assert.match(h.summary, /HTTP 555/);
    assert.match(h.summary, /Internal server error/);
    assert.ok(!/Cột|cột/.test(h.summary), 'must not be described as a schema problem');
  });

  test('stays visible (noise:false) — a platform outage is not noise', () => {
    // Hiding it would make a real Supabase outage invisible in the admin panel.
    // The defect was the mislabelling + raw traceback, not the row existing.
    const h = H({ source: 'backend', message: REAL_555 });
    assert.equal(h.noise, false);
  });

  test('a non-5xx gateway body is upstream too, but not called transient', () => {
    const h = H({ source: 'backend', message:
      "{'message': 'JSON could not be generated', 'code': 502, 'details': \"b'Bad gateway'\"}" });
    assert.equal(h.category, 'Mạng');
    assert.equal(h.tone, 'warning');
    const h4 = H({ source: 'backend', message:
      "{'message': 'JSON could not be generated', 'code': 404, 'details': \"b'not found'\"}" });
    assert.equal(h4.category, 'Mạng');
    assert.equal(h4.tone, 'error');
    assert.match(h4.summary, /cổng API/);
  });

  test('a real quoted SQLSTATE still routes to CSDL (no regression)', () => {
    const h = H({ source: 'backend', message:
      "{'message': 'column reading_tests.published does not exist', 'code': '42703', "
      + "'hint': None, 'details': None}" });
    assert.equal(h.category, 'CSDL');
    assert.match(h.summary, /published/);
  });

  // Fixtures below are the EXACT `str(dict)` Python emits — generated with
  // python3, not hand-escaped, so the delimiter/escaping choices are real.
  test('a gateway body containing quotes still shows (review #822)', () => {
    // Once the body holds a `"`, Python must delimit with single quotes and
    // ESCAPE the inner ones. A `[^']*` capture stopped at the first `\'` and
    // produced the summary `— b\`, throwing away the whole diagnostic.
    const h = H({ source: 'backend', message:
      "{'message': 'JSON could not be generated', 'code': 502, 'details': 'b\\'<html><title>502 Bad \"Gateway\"</title></html>\\''}" });
    assert.equal(h.category, 'Mạng');
    assert.match(h.summary, /502 Bad "Gateway"/);
    assert.ok(!/— b\\?$/.test(h.summary), 'the capture must not stop at the escaped quote');
  });

  test('escaped newlines in the body do not break the one-line summary', () => {
    const h = H({ source: 'backend', message:
      "{'message': 'JSON could not be generated', 'code': 503, 'details': \"b'upstream\\\\ndown'\"}" });
    assert.match(h.summary, /HTTP 503/);
    assert.match(h.summary, /upstream down/);
    assert.ok(!/\\n/.test(h.summary), 'escape sequences must not leak into the summary');
  });

  test('a body with no quotes at all is unchanged (the 2026-07-22 case)', () => {
    const h = H({ source: 'backend', message: REAL_555 });
    assert.match(h.summary, /Internal server error/);
  });

  test('an unquoted numeric code alone does NOT hijack a genuine DB error', () => {
    // Only the "JSON could not be generated" message routes upstream; anything
    // else with a numeric code keeps the CSDL path.
    const h = H({ source: 'backend', message:
      "{'message': 'null value in column \"q_num\" violates not-null constraint', 'code': 23502}" });
    assert.equal(h.category, 'CSDL');
  });
});
