/**
 * generate-and-assign-code.test.mjs — admin "Tạo + gán mã".
 *
 * Pins the admin-side activation feature on the Users tab: a user with NO
 * active code gets a "+ Tạo + gán mã" action that opens a modal (type / cohort /
 * quyền / limit / expires) and POSTs to /admin/access-codes/generate-and-assign,
 * then refetches canonical state (no optimistic). Distinct ga-* ids so it never
 * collides with the relocated access-code create modal (m-* / modal-backdrop).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...r) => readFileSync(join(__dirname, '..', ...r), 'utf8');
const HTML = read('pages', 'admin', 'users', 'index.html');
const JS = read('js', 'admin-users.js');


describe('Tạo + gán mã — action visibility', () => {
  test('button shows ONLY when the user has no active code', () => {
    assert.match(JS, /const genBtn = !cs\.has_active_code/);
    assert.match(JS, /data-gencode=/);
  });
  test('click delegated off the tbody → openGen', () => {
    assert.match(JS, /button\[data-gencode\]/);
    assert.match(JS, /openGen\(/);
  });
});


describe('Tạo + gán mã — modal markup (ga-* ids, no collision with m-*)', () => {
  test('dedicated backdrop + fields present', () => {
    assert.match(HTML, /id="ga-backdrop"/);
    assert.match(HTML, /name="ga-type"/);
    assert.match(HTML, /id="ga-cohort-row"/);
    assert.match(HTML, /id="ga-perms"/);
    assert.match(HTML, /id="ga-limit"/);
    assert.match(HTML, /id="ga-expires"/);
    assert.match(HTML, /id="btn-ga-submit"/);
  });
  test('does NOT reuse the relocated create modal ids (m-*/modal-backdrop)', () => {
    // The ga modal must not introduce a duplicate of the access-code module ids.
    assert.equal((HTML.match(/id="modal-backdrop"/g) || []).length, 1);
    assert.equal((HTML.match(/id="status-banner"/g) || []).length, 1);
  });
});


describe('Tạo + gán mã — wiring + canonical contract', () => {
  test('POSTs to /admin/access-codes/generate-and-assign with user_id', () => {
    assert.match(JS, /\/admin\/access-codes\/generate-and-assign/);
    assert.match(JS, /user_id: _genCtx\.userId/);
  });
  test('direct ⇒ cohort guard mirrors the server combo rule', () => {
    assert.match(JS, /code_type === 'direct' && !cohort_id/);
    assert.match(JS, /code_type !== 'direct' && cohort_id/);
  });
  test('refetches canonical state after success (no optimistic)', () => {
    assert.match(JS, /function submitGen[\s\S]*?loadList\(\)/);
  });
  test('cohort select sourced from /admin/cohorts?is_active=true', () => {
    assert.match(JS, /\/admin\/cohorts\?is_active=true/);
    assert.match(JS, /function loadCohorts/);
  });
});
