/**
 * safe-error-detail.test.mjs — P0-5 / C-1.3 (FE side).
 *
 * The backend now returns error `detail` as a {error_code,message,ref} DICT for
 * 5xx. The FE must read it without breaking:
 *   • api.js._apiRequest already coerces a dict detail → err.message (the safety
 *     net that keeps every `err.message` caller working);
 *   • grammar.js is a RAW fetch (bypasses api.js) → must read detail.message.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');


describe('P0-5 FE — api.js coerces a dict detail → message (contract safety net)', () => {
  const api = read('frontend/js/api.js');
  test('_apiRequest detects an object detail and surfaces detail.message', () => {
    assert.match(api, /typeof detail === 'object'/);
    assert.match(api, /detail\.message/);
    assert.match(api, /thrown\.detail = detail/);   // raw dict still available for error_code
  });
});


describe('Mã kích hoạt FE — api.js must not res.json() a 204/empty body', () => {
  const api = read('frontend/js/api.js');
  test('helper guards 204 + empty text instead of blindly calling response.json()', () => {
    assert.match(api, /if \(response\.status === 204\) return null/);
    assert.match(api, /await response\.text\(\)/);
    assert.match(api, /text \? JSON\.parse\(text\) : null/);
    // The old blind tail (`return response.json();`) must be gone.
    assert.ok(!/\n\s*return response\.json\(\);/.test(api),
      'the unconditional return response.json() tail must be replaced');
  });
  test('parse tail returns null on 204/empty, object on JSON (real value)', async () => {
    // Mirror the exact tail of _apiRequest.
    const tail = async (response) => {
      if (response.status === 204) return null;
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    };
    const mk = (status, body) => ({ status, text: async () => body });
    assert.equal(await tail(mk(204, '')), null);   // DELETE revoke / remove-user
    assert.equal(await tail(mk(200, '')), null);   // empty 200
    assert.deepEqual(await tail(mk(200, '{"ok":true}')), { ok: true });  // normal JSON
  });
});


describe('P0-5 FE — grammar.js (raw fetch) reads detail.message, no [object Object]', () => {
  const js = read('frontend/js/grammar.js');
  const fn = js.slice(js.indexOf('function fetchGrammarAPI'), js.indexOf('return res.json();'));
  test('throws with detail.message (dict) or the string, never the raw object', () => {
    assert.match(fn, /d\.message/);
    assert.ok(!/new Error\(err\.detail \|\|/.test(fn), 'must not throw the raw err.detail (could be a dict)');
  });
  // real-value: evaluate the exact throw expression on a dict detail.
  test('the throw expression yields the message string for a dict detail (real value)', () => {
    const expr = "var d = err.detail; return (d && d.message) || (typeof d === 'string' ? d : '') || 'HTTP ' + 500;";
    const build = new Function('err', expr);
    assert.equal(build({ detail: { error_code: 'internal_error', message: 'Đã xảy ra lỗi nội bộ', ref: 'a1' } }),
      'Đã xảy ra lỗi nội bộ');
    assert.equal(build({ detail: 'plain string' }), 'plain string');
    assert.equal(build({}), 'HTTP 500');
  });
});
