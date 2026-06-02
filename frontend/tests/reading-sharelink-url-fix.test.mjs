/**
 * frontend/tests/reading-sharelink-url-fix.test.mjs
 *
 * reading-sharelink-url-fix — the B2 admin "Generate link" produced a malformed
 * URL: `https://www.averlearning.com./pages/reading-exam.html?share=…` — the
 * trailing dot after `.com` (from gluing the origin to api.url()'s relative
 * './pages/…') yields a host that doesn't match the TLS cert →
 * ERR_CONNECTION_CLOSED.
 *
 * This is a REAL-OUTPUT test (Lesson 20): it evaluates the actual admin-reading
 * share-URL builder in a node:vm sandbox with a controlled window.location and
 * asserts the generated URL is well-formed (canonical host, no trailing dot,
 * root-absolute exam path, ?share=token). A malformed host can't regress
 * silently. (No jsdom dependency — the module's eval-time footprint is just
 * `window` + a `document.addEventListener` stub.)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const SRC = readFileSync(path.join(REPO, 'frontend/js/admin-reading.js'), 'utf8');

// Evaluate admin-reading.js in an isolated context with a fake window.location,
// then call the exposed share-URL builder. Returns the ACTUAL generated URL.
function shareUrlFor(location, token) {
  const win = { __AR_SHARE_TEST__: true, location };
  const sandbox = {
    window: win,
    document: { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; } },
    navigator: {},
    localStorage: { getItem() { return null; }, setItem() {} },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  const helpers = sandbox.window.__AR_SHARE_HELPERS__;
  assert.ok(helpers && typeof helpers.shareUrl === 'function',
    'admin-reading.js must expose the share-URL builder under the test hook');
  return helpers.shareUrl(token);
}

const TOKEN = 'AbC123_token-XYZ';
const EXAM_PATH = '/pages/reading-exam.html';


describe('reading-sharelink-url-fix — canonical, well-formed share URL', () => {
  test('apex host (no www) is upgraded to the canonical www host', () => {
    const url = shareUrlFor(
      { protocol: 'https:', hostname: 'averlearning.com', port: '', origin: 'https://averlearning.com' },
      TOKEN);
    const u = new URL(url);
    assert.equal(u.protocol, 'https:');
    assert.equal(u.hostname, 'www.averlearning.com');
    assert.equal(u.pathname, EXAM_PATH);
    assert.equal(u.searchParams.get('share'), TOKEN);
  });

  test('trailing-dot FQDN host is stripped (the actual bug) + upgraded', () => {
    // This is the exact malformation from the report: `averlearning.com.`
    const url = shareUrlFor(
      { protocol: 'https:', hostname: 'averlearning.com.', port: '', origin: 'https://averlearning.com.' },
      TOKEN);
    const u = new URL(url);
    assert.equal(u.hostname, 'www.averlearning.com');
    assert.ok(!u.host.endsWith('.'), 'host must not end with a dot');
    // The bug signature `.com./` must never appear in the output.
    assert.ok(!/averlearning\.com\.\//.test(url), 'trailing-dot host must be gone');
  });

  test('www host with a trailing dot is stripped, stays www', () => {
    const url = shareUrlFor(
      { protocol: 'https:', hostname: 'www.averlearning.com.', port: '', origin: 'https://www.averlearning.com.' },
      TOKEN);
    const u = new URL(url);
    assert.equal(u.hostname, 'www.averlearning.com');
    assert.equal(u.pathname, EXAM_PATH);
  });

  test('already-canonical www host is unchanged', () => {
    const url = shareUrlFor(
      { protocol: 'https:', hostname: 'www.averlearning.com', port: '', origin: 'https://www.averlearning.com' },
      TOKEN);
    assert.equal(url, 'https://www.averlearning.com' + EXAM_PATH + '?share=' + TOKEN);
  });

  test('localhost dev origin (with port) is preserved for local testing', () => {
    const url = shareUrlFor(
      { protocol: 'http:', hostname: 'localhost', port: '5500', origin: 'http://localhost:5500' },
      TOKEN);
    const u = new URL(url);
    assert.equal(u.protocol, 'http:');
    assert.equal(u.hostname, 'localhost');
    assert.equal(u.port, '5500');
    assert.equal(u.pathname, EXAM_PATH);
  });

  test('the URL is root-absolute (exam path independent of admin page depth)', () => {
    // The admin page lives at /pages/admin/reading/content.html; the share URL
    // must point at the site-root exam page, not a path resolved against the
    // admin depth (the old relative api.url() bug).
    const url = shareUrlFor(
      { protocol: 'https:', hostname: 'www.averlearning.com', port: '', origin: 'https://www.averlearning.com' },
      TOKEN);
    assert.ok(url.includes(EXAM_PATH));
    assert.ok(!url.includes('/admin/'), 'must not inherit the admin page path');
    assert.ok(!url.includes('./') && !url.includes('../'), 'no relative-path artifact');
  });

  test('token is URL-encoded into the ?share= query', () => {
    const url = shareUrlFor(
      { protocol: 'https:', hostname: 'www.averlearning.com', port: '', origin: 'https://www.averlearning.com' },
      'a b/c?d');
    const u = new URL(url);
    assert.equal(u.searchParams.get('share'), 'a b/c?d');
  });
});
