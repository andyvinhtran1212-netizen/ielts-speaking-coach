// SA PR-2104 r2 — EXPECTED unit tests for the fix (synthetic values only).
// Ported from /workspace/qa/pr2104/r2/expected-tests.test.mjs (16 cases).
// Run: node --test frontend/tests/artifact-secret-variants.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const R = require('../tooling/redact-secrets.cjs');
const { scanBuffer } = await import('../tooling/scan-artifact-secrets.mjs');
const { sanitizeBuffer } = await import('../tooling/sanitize-artifacts.mjs');

const PW = ['Fk', '"e\\', 'Pw:d+ 9', '&<x>', "/='q", 'FAKE'].join('');
const TOTP = ['JBSW', 'Y3DP', 'EHPK', '3PXP', 'FAKE', 'ZZ22'].join('');
const BYP = ['byp', 'FAKE', 'a1B2c3D4e5F6g7H8'].join('');
const literals = [PW, TOTP, BYP];
const o = { literals };
const j1 = (s) => JSON.stringify(s).slice(1, -1);
const html = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const b64At = (s, k) => Buffer.concat([Buffer.alloc(k, 0x41), Buffer.from(s)]).toString('base64');

const FORMS = {
  'JSON 1x': j1(PW), 'JSON 2x': j1(j1(PW)), 'JSON 3x': j1(j1(j1(PW))),
  'encodeURIComponent': encodeURIComponent(PW), 'form + for space': new URLSearchParams({ p: PW }).toString().slice(2),
  'HTML entities': html(PW), '\\u escapes of specials': PW.replace(/["\\<>&'\/]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')),
  'base64 k=0': b64At(PW, 0), 'base64 k=1': b64At(PW, 1), 'base64 k=2': b64At(PW, 2), 'base64url': Buffer.from(PW).toString('base64url'),
};
for (const [name, form] of Object.entries(FORMS)) {
  test(`password with " and \\ is counted and redacted in form: ${name}`, () => {
    const text = `{"stdout":"x ${form} y"}`;
    assert.ok(R.countSecretMatches(text, o) >= 1, 'guard must count it');
    const red = R.redactSecrets(text, o);
    assert.ok(!red.includes(form), 'sanitize must remove it');
    assert.equal(R.countSecretMatches(red, o), 0, 'nothing left after redaction');
  });
}

test('base32 TOTP and alnum bypass: base64 forms at every alignment are caught', () => {
  for (const s of [TOTP, BYP]) for (const k of [0, 1, 2]) {
    const text = `{"params":{"postData":"${b64At(`{"v":"${s}"}`, k)}"}}`;
    assert.ok(R.countSecretMatches(text, o) >= 1, `k=${k}`);
  }
});

test('trace zip: JSON-escaped password in trace.trace / trace.network / resources is flagged then cleaned', () => {
  const body = JSON.stringify({ password: PW });
  const zip = R.writeZip([
    { name: 'trace.trace', data: Buffer.from(JSON.stringify({ params: { value: PW } })) },
    { name: 'trace.network', data: Buffer.from(JSON.stringify({ request: { postData: { text: body } } })) },
    { name: 'resources/aa.json', data: Buffer.from(body) },
  ]);
  assert.ok(scanBuffer(zip, o).count >= 3);
  const clean = sanitizeBuffer(zip, o);
  assert.deepEqual(scanBuffer(clean, o), { count: 0, unscannable: false });
});

test('HTML report: JSON-escaped password inside the embedded base64 zip is flagged then cleaned', () => {
  const inner = R.writeZip([{ name: 'r.json', data: Buffer.from(JSON.stringify({ errors: [PW] })) }]).toString('base64');
  const page = Buffer.from(`<template id="playwrightReportBase64">data:application/zip;base64,${inner}</template>`);
  assert.ok(scanBuffer(page, o).count >= 1);
  assert.deepEqual(scanBuffer(sanitizeBuffer(page, o), o), { count: 0, unscannable: false });
});

test('fail closed: gzip / unknown binary zip entry is unscannable unless decompressed and clean', () => {
  const zip = R.writeZip([{ name: 'resources/x.dat', data: zlib.gzipSync(Buffer.from(`k ${PW}`)) }]);
  const r = scanBuffer(zip, o);
  assert.ok(r.count >= 1 || r.unscannable, 'compressed entry must not pass silently');
  const opaque = R.writeZip([{ name: 'resources/y.bin', data: Buffer.from([0x00, 0x13, 0x37, 0xfe, 0x00, 0x01]) }]);
  assert.equal(scanBuffer(opaque, o).unscannable, true, 'unknown binary must fail closed');
});

test('no false positive and no literal in output for unrelated text', () => {
  assert.equal(R.countSecretMatches('{"ok":true,"msg":"hello world"}', o), 0);
});
