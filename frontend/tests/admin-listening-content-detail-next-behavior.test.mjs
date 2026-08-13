import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  normalizeListeningContentDetail, normalizeListeningStatusReadback,
} from '../lib/admin-listening-content-model.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const CLIENT = read('app', '(authed-admin-listening)', 'admin', 'listening', 'content', '[contentId]', 'admin-listening-content-detail.tsx');
const PAGE = read('app', '(authed-admin-listening)', 'admin', 'listening', 'content', '[contentId]', 'page.tsx');
const LIST = read('app', '(authed-admin-listening)', 'admin', 'listening', 'admin-listening-content.tsx');
const CSS = read('public', 'css', 'admin-listening-content-next.css');

test('detail normalizer enforces identity, status and safe signed audio', () => {
  const base = { id: 'c1', title: '<script>', status: 'draft', transcript: 'hello', audio_signed_url: 'https://storage.test/audio.mp3', external_source_url: 'javascript:bad' };
  const row = normalizeListeningContentDetail(base, 'c1');
  assert.equal(row.title, '<script>');
  assert.equal(row.audioSignedUrl, 'https://storage.test/audio.mp3');
  assert.equal(row.externalSourceUrl, 'javascript:bad');
  assert.equal(normalizeListeningContentDetail(base, 'other'), null);
  assert.equal(normalizeListeningContentDetail({ ...base, audio_signed_url: 'javascript:alert(1)' }, 'c1').audioSignedUrl, null);
  assert.equal(normalizeListeningStatusReadback({ ...base, status: 'published' }, 'c1', 'published').status, 'published');
  assert.equal(normalizeListeningStatusReadback(base, 'c1', 'published'), null);
});

test('dynamic route is admin-gated and inventory owns the native identity link', () => {
  assert.match(PAGE, /params: Promise<\{ contentId: string \}>/);
  assert.match(PAGE, /<AdminAccessGate>/);
  assert.match(PAGE, /active="listening" subsection="content"/);
  assert.match(LIST, /href=\{`\/admin\/listening\/content\/\$\{encodeURIComponent\(row\.id\)\}`\}/);
});

test('metadata and exercise reads stay independent and account-keyed', () => {
  assert.match(CLIENT, /const key = `\$\{profile\.id\}:\$\{contentId\}`/);
  assert.match(CLIENT, /void \(async \(\) => \{[\s\S]*readContent\(request\)[\s\S]*\}\)\(\);[\s\S]*void readExercises\(request\)/);
  assert.match(CLIENT, /const readExercises = useCallback[\s\S]*normalizeListeningExerciseCoverage/);
  assert.match(CLIENT, /lỗi này không có nghĩa “chưa có bài”/);
  assert.match(CLIENT, /request !== sequence\.current/);
});

test('status mutation requires confirmation and canonical GET readback', () => {
  assert.match(CLIENT, /<Dialog open=\{Boolean\(confirmStatus\)\}/);
  assert.match(CLIENT, /window\.api\.patch\(`\/admin\/listening\/content\/\$\{encodeURIComponent\(contentId\)\}\/status`/);
  assert.match(CLIENT, /normalizeListeningStatusReadback\(payload, contentId, expectedStatus\)/);
  assert.match(CLIENT, /const readOrder = \+\+contentReadOrder\.current/);
  assert.match(CLIENT, /readOrder !== contentReadOrder\.current/);
  assert.match(CLIENT, /const readOrder = \+\+exerciseReadOrder\.current/);
  assert.match(CLIENT, /readOrder === exerciseReadOrder\.current/);
  assert.match(CLIENT, /Backend chưa xác nhận trạng thái vừa chọn/);
  assert.doesNotMatch(CLIENT, /setContent\([^\n]+await window\.api\.patch/);
  assert.doesNotMatch(CLIENT, /const target = confirmStatus; const request = \+\+sequence\.current/);
  assert.match(CLIENT, /finally \{[\s\S]*readExercises\(request\)[\s\S]*readContent\(request\)[\s\S]*setPollEpoch/);
});

test('render polling is bounded and cleaned up', () => {
  assert.match(CLIENT, /const POLL_DELAYS = \[5000, 10000, 15000, 15000, 15000\]/);
  assert.match(CLIENT, /attempt >= POLL_DELAYS\.length/);
  assert.match(CLIENT, /Đã dừng tự kiểm tra sau 60 giây/);
  assert.match(CLIENT, /window\.clearTimeout\(pollTimer\.current\)/);
});

test('detail UI keeps rollback/editors and responsive accessible dialog', () => {
  assert.match(CLIENT, /content-detail\.html\?id=/);
  assert.match(CLIENT, /item\.type === 'dictation' \? 'segments' : item\.type === 'true_false' \? 'tf' : item\.type/);
  assert.match(CLIENT, /`\/pages\/admin\/listening\/\$\{editor\}\.html\?content_id=\$\{encodeURIComponent\(contentId\)\}`/);
  assert.match(CSS, /\.ald-exercise-grid\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(CSS, /@media\(max-width:760px\)[^\n]+\.ald-exercise-grid\{grid-template-columns:1fr\}/);
  assert.match(CSS, /\.acd-dialog-backdrop\{position:fixed/);
  assert.match(CSS, /\.acd-dialog :is\(button,a\):focus-visible/);
  assert.doesNotMatch(CSS, /#[0-9a-fA-F]{3,8}\b/);
});
