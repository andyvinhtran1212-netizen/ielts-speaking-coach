import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const D1_PAGE = read('app', '(authed-admin-vocab)', 'admin', 'vocab', 'd1-curation', 'page.tsx');
const D1 = read('app', '(authed-admin-vocab)', 'admin', 'vocab', 'd1-curation', 'admin-vocab-d1-curation.tsx');
const LEMMA_PAGE = read('app', '(authed-admin-vocab)', 'admin', 'vocab', 'lemmas', 'page.tsx');
const LEMMA = read('app', '(authed-admin-vocab)', 'admin', 'vocab', 'lemmas', 'admin-vocab-lemmas.tsx');
const HUB = read('app', '(authed-admin-vocab)', 'admin', 'vocab', 'page.tsx');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');

describe('Admin Vocabulary D1 + Lemma native ownership', () => {
  test('owns both clean routes and retains rollback HTML', () => {
    assert.match(D1_PAGE, /<AdminAccessGate>/);
    assert.match(LEMMA_PAGE, /<AdminAccessGate>/);
    assert.match(HUB, /href: '\/admin\/vocab\/d1-curation'/);
    assert.match(HUB, /href: '\/admin\/vocab\/lemmas'/);
    assert.match(CHROME, /slug: 'd1-curation'[^\n]*href: '\/admin\/vocab\/d1-curation'/);
    assert.match(CHROME, /slug: 'lemmas'[^\n]*href: '\/admin\/vocab\/lemmas'/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'vocab', 'd1-curation.html')));
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'vocab', 'lemmas.html')));
  });

  test('D1 validates canonical payload/ACK and reloads after all writes', () => {
    assert.match(D1, /normalizeD1ListPayload/);
    assert.match(D1, /normalizeD1PatchAck/);
    assert.match(D1, /mutationLock/);
    assert.match(D1, /accountRef/);
    assert.match(D1, /await refreshAfterWrite\(\)/);
    assert.match(D1, /window\.api\.delete\(`/);
    assert.doesNotMatch(D1, /window\.confirm|dangerouslySetInnerHTML/);
  });

  test('Lemma validates create ACK and reloads canonical list after create/delete', () => {
    assert.match(LEMMA, /normalizeLemmaCreateAck/);
    assert.match(LEMMA, /mutationLock/);
    assert.match(LEMMA, /accountRef/);
    assert.ok((LEMMA.match(/await refreshAfterWrite\(\)/g) || []).length >= 2);
    assert.match(LEMMA, /role="dialog"/);
    assert.doesNotMatch(LEMMA, /window\.confirm|dangerouslySetInnerHTML/);
  });

  test('CI browser verifier owns the new flows', () => {
    assert.match(WORKFLOW, /admin-vocab-curation-model\.mjs/);
    assert.match(WORKFLOW, /verify-admin-vocab-flow\.mjs/);
  });
});
