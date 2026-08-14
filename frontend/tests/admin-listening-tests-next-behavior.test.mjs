import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  listeningTestListHref, normalizeListeningTestFilters, normalizeListeningTestList,
  normalizeListeningTestMutationReadback,
} from '../lib/admin-listening-content-model.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const CLIENT = read('app', '(authed-admin-listening)', 'admin', 'listening', 'tests', 'admin-listening-tests.tsx');
const PAGE = read('app', '(authed-admin-listening)', 'admin', 'listening', 'tests', 'page.tsx');
const CONTENT = read('app', '(authed-admin-listening)', 'admin', 'listening', 'admin-listening-content.tsx');
const CSS = read('public', 'css', 'admin-listening-tests-next.css');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');

const testRow = (patch = {}) => ({ id: 't1', test_id: 'ILR-LIS-1', title: '<script>', status: 'draft', test_type: 'full', exam_only: false, section_count: 4, audio_ready_count: 3, band_target: 7, accent_profile: ['UK'], ...patch });

test('test filters round-trip through the clean URL', () => {
  assert.deepEqual(normalizeListeningTestFilters({ status: 'bad', type: 'bad', search: '  ILR  ', page: '0' }), { status: 'all', type: 'all', search: 'ILR', page: 1 });
  assert.equal(listeningTestListHref({ status: 'published', type: 'practice', search: 'ILR 1', page: 2 }), '/admin/listening/tests?status=published&type=practice&search=ILR+1&page=2');
});

test('list normalizer preserves backend total and surfaces malformed rows', () => {
  const result = normalizeListeningTestList({ items: [testRow(), testRow({ id: 't2', exam_only: null })], total: 22, limit: 20, offset: 0 }, { status: 'all', type: 'all', search: '', limit: 20, offset: 0 });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].title, '<script>');
  assert.equal(result.malformedCount, 1);
  assert.equal(result.total, 22);
  assert.equal(normalizeListeningTestList({ items: [], total: 'no', limit: 20, offset: 0 }), null);
  assert.equal(normalizeListeningTestList({ items: [testRow({ section_count: 0, audio_ready_count: 0 })], total: 1, limit: 20, offset: 0 }).rows[0].sectionCount, 0);
  assert.equal(normalizeListeningTestList({ items: [testRow({ test_type: 'practice', section_count: 1, audio_ready_count: 1 })], total: 1, limit: 20, offset: 0 }).rows[0].sectionCount, 1);
});

test('mutation readback validates identity and exact canonical field', () => {
  const raw = { id: 't1', status: 'published', exam_only: true };
  assert.deepEqual(normalizeListeningTestMutationReadback(raw, 't1', { status: 'published', examOnly: true }), { id: 't1', status: 'published', examOnly: true });
  assert.equal(normalizeListeningTestMutationReadback(raw, 'other', { status: 'published' }), null);
  assert.equal(normalizeListeningTestMutationReadback(raw, 't1', { examOnly: false }), null);
});

test('native route is admin-gated and content inventory links to it', () => {
  assert.match(PAGE, /<AdminAccessGate>/);
  assert.match(PAGE, /active="listening" subsection="tests"/);
  assert.match(CONTENT, /href="\/admin\/listening\/tests"/);
  assert.match(CHROME, /slug:\s*'tests',\s+label:\s*'Cambridge tests',\s+href:\s*'\/admin\/listening\/tests'/);
  assert.match(CLIENT, /tests-detail\.html\?id=/);
  assert.match(CLIENT, /listening\/index\.html\?test_id=/);
  assert.match(CLIENT, /tests\.html">Mở bản HTML rollback/);
});

test('writes require dialog and exact GET readback without optimistic row mutation', () => {
  assert.match(CLIENT, /<Dialog open=\{Boolean\(action\)\}/);
  assert.match(CLIENT, /window\.api\.patch/);
  assert.match(CLIENT, /normalizeListeningTestMutationReadback\(await window\.api\.get/);
  assert.match(CLIENT, /await load\(false\)/);
  assert.match(CLIENT, /Backend đã xác nhận \$\{saved\}, nhưng danh sách chưa làm mới được/);
  assert.doesNotMatch(CLIENT, /setSnapshot\([^\n]+target/);
});

test('responsive UI exposes exam boundary, focus and reduced motion', () => {
  assert.match(CLIENT, /exam_only=true/);
  assert.match(CLIENT, /Backend có thể từ chối/);
  assert.match(CSS, /@media\(max-width:700px\)/);
  assert.match(CSS, /:focus-visible/);
  assert.match(CSS, /prefers-reduced-motion:reduce/);
  assert.doesNotMatch(CSS, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(CLIENT, /sectionCount \|\| 4/);
});
