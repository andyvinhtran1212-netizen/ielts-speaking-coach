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
// LEGACYJS-0075 W3a: admin-users.js is deleted; the Users tab is the Next panel.
const JS = read('app', '(authed-admin-users)', 'admin', 'users', 'admin-users-panel.tsx');
const SHELL = read('app', '(authed-admin-users)', 'admin', 'users', 'admin-users.tsx');
const MODEL = read('lib', 'admin-users-model.mjs');


describe('Tạo + gán mã — action visibility', () => {
  test('button shows ONLY when the user has no active code', () => {
    assert.match(JS, /\{!summary\.has_active_code && <button[^>]+onClick=\{\(\) => setGenerate\(\{ user,/);
  });
  test('the action opens the generate dialog for that user', () => {
    assert.match(JS, /const \[generate, setGenerate\] = useState<GenerateDraft \| null>\(null\)/);
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
    assert.match(JS, /'\/admin\/access-codes\/generate-and-assign', \{\s*user_id: generate\.user\.id,/);
  });
  test('direct ⇒ cohort guard mirrors the server combo rule', () => {
    assert.match(JS, /const validation = validateCodeDraft\(\{\s*codeType: generate\.codeType,/);
    assert.match(MODEL, /codeType === 'direct' && !cohortId/);
    assert.match(MODEL, /codeType !== 'direct' && cohortId/);
  });
  test('refetches canonical state after success (no optimistic)', () => {
    assert.match(JS, /const submitGenerate = async \(\) => \{[\s\S]*?await loadUsers\(true\)/);
  });
  test('cohort select sourced from /admin/cohorts?is_active=true', () => {
    assert.match(SHELL, /getAdminCohorts\(\{ isActive: true \}\)/);
  });
});
