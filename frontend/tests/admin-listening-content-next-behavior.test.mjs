import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  formatListeningDuration, listeningAudioState, listeningContentListHref,
  normalizeListeningContentFilters, normalizeListeningContentList,
  normalizeListeningExerciseCoverage, normalizeListeningTestAudio,
} from '../lib/admin-listening-content-model.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const CLIENT = read('app', '(authed-admin-listening)', 'admin', 'listening', 'admin-listening-content.tsx');
const PAGE = read('app', '(authed-admin-listening)', 'admin', 'listening', 'page.tsx');
const LAYOUT = read('app', '(authed-admin-listening)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-listening-content-next.css');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const OVERVIEW = read('app', '(authed-admin-overview)', 'admin', 'admin-overview.tsx');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');
const LEDGER = read('..', 'docs', 'ROUTE_LEDGER.md');

test('normalizes URL filters and produces stable clean-route links', () => {
  assert.deepEqual(normalizeListeningContentFilters({ status: 'published', page: '3' }), { status: 'published', page: 3 });
  assert.deepEqual(normalizeListeningContentFilters({ status: 'banana', page: '-2' }), { status: 'all', page: 1 });
  assert.equal(listeningContentListHref('all', 1), '/admin/listening');
  assert.equal(listeningContentListHref('draft', 2), '/admin/listening?status=draft&page=2');
});

test('keeps canonical total while excluding malformed content rows', () => {
  const result = normalizeListeningContentList({
    items: [
      { id: 'c1', title: '<script>', status: 'draft', source_type: 'upload_mp3', accent_tag: 'uk_rp', cefr_level: 'B2', ielts_section: 2, audio_duration_seconds: 61.2, audio_storage_path: 'audio/c1.mp3', topic_tags: ['Travel'], is_premium: true },
      { id: '', status: 'published' },
      { id: 'c3', status: 'invalid' },
    ],
    total: 9, limit: 20, offset: 0,
  }, { limit: 20, offset: 0 });
  assert.equal(result.rows.length, 1);
  assert.equal(result.malformedCount, 2);
  assert.equal(result.total, 9);
  assert.equal(result.rows[0].title, '<script>');
  assert.equal(result.rows[0].durationSeconds, 61.2);
  assert.equal(result.rows[0].isPremium, true);
  assert.deepEqual(normalizeListeningContentList({ items: [], total: 0, limit: 20, offset: 20 }, { limit: 20, offset: 20 }), { rows: [], malformedCount: 0, total: 0, limit: 20, offset: 20 });
  const filtered = normalizeListeningContentList({ items: [{ id: 'draft', status: 'draft' }, { id: 'live', status: 'published' }], total: 2, limit: 20, offset: 0 }, { limit: 20, offset: 0, status: 'published' });
  assert.deepEqual(filtered.rows.map((row) => row.id), ['live']);
  assert.equal(filtered.malformedCount, 1);
});

test('aggregates valid exercise blocks and keeps supplemental mini tests neutral', () => {
  const result = normalizeListeningExerciseCoverage({ exercises: [
    { id: 'e1', content_id: 'c1', exercise_type: 'dictation', status: 'published' },
    { id: 'e2', content_id: 'c1', exercise_type: 'gist', status: 'draft' },
    { id: 'e3', content_id: 'c1', exercise_type: 'gist', status: 'published' },
    { id: 'e4', content_id: 'other', exercise_type: 'mcq', status: 'published' },
    { id: 'e5', content_id: 'c1', exercise_type: 'unknown', status: 'published' },
    { id: 'e6', exercise_type: 'mcq', status: 'published' },
    { id: 'e7', content_id: 'c1', exercise_type: 'mini_test', status: 'published' },
  ] }, 'c1');
  assert.equal(result.presentCount, 2);
  assert.equal(result.readyCount, 1);
  assert.equal(result.blockCount, 3);
  assert.equal(result.supplementalCount, 1);
  assert.equal(result.malformedCount, 3);
  assert.equal(result.items.find((item) => item.type === 'gist').status, 'mixed');
  assert.equal(result.items.find((item) => item.type === 'gist').blockCount, 2);
  assert.equal(result.items.find((item) => item.type === 'true_false').status, null);
  assert.equal(normalizeListeningExerciseCoverage({ exercises: 'not-array' }, 'c1'), null);
});

test('derives audio truth and formats durations without inventing zero', () => {
  assert.equal(listeningAudioState({ audioStoragePath: 'x', durationSeconds: 0 }), 'ready');
  assert.equal(listeningAudioState({ sourceType: 'ai_elevenlabs', status: 'draft', audioStoragePath: null }), 'rendering');
  assert.equal(listeningAudioState({ sourceType: 'ai_elevenlabs', status: 'archived', audioStoragePath: null }), 'failed');
  assert.equal(listeningAudioState({ sourceType: 'upload_mp3', audioStoragePath: null }), 'missing');
  assert.equal(listeningAudioState({ testId: 't1', audioStoragePath: null }), 'checking');
  assert.equal(listeningAudioState({ testId: 't1', audioStoragePath: null }, null), 'unknown');
  assert.equal(listeningAudioState({ testId: 't1', audioStoragePath: null }, { ready: true }), 'test_ready');
  assert.equal(listeningAudioState({ testId: 't1', audioStoragePath: null }, { ready: false }), 'missing');
  assert.deepEqual(normalizeListeningTestAudio({ id: 't1', audio_assembly_mode: 'full_premixed', full_audio_storage_path: 'tests/t1/full.mp3' }, 't1'), { id: 't1', mode: 'full_premixed', ready: true });
  assert.equal(normalizeListeningTestAudio({ id: 'other', full_audio_storage_path: 'x' }, 't1'), null);
  assert.equal(formatListeningDuration(null), '—');
  assert.equal(formatListeningDuration(61.2), '1:01');
});

test('owns /admin/listening with backend role guard and explicit rollback', () => {
  assert.match(PAGE, /<AdminAccessGate>/);
  assert.match(PAGE, /active="listening" subsection="content"/);
  assert.match(LAYOUT, /chrome="admin"/);
  assert.match(LAYOUT, /admin-listening-content-next\.css/);
  assert.match(CLIENT, /\/admin\/listening\/content\?\$\{query\}/);
  assert.match(CLIENT, /\/admin\/listening\/exercises\?content_id=/);
  assert.match(CLIENT, /\/admin\/listening\/tests\/\$\{encodeURIComponent\(testId\)\}/);
  assert.match(CLIENT, /\/pages\/admin\/listening\/index\.html/);
  assert.doesNotMatch(CLIENT, /window\.api\.(post|patch|delete|upload)/);
  assert.match(CHROME, /section: 'listening', label: 'Listening', href: '\/admin\/listening'/);
  assert.match(OVERVIEW, /listening: '\/admin\/listening'/);
  assert.match(LEDGER, /`\/admin\/listening`[^\n]+authed-admin-listening[^\n]+native React ownership/);
});

test('keeps detail/editor identities and exposes truthful degraded states', () => {
  assert.match(CLIENT, /\/admin\/listening\/content\/\$\{encodeURIComponent\(row\.id\)\}/);
  assert.match(CLIENT, /\/admin\/listening\/content\/\$\{encodeURIComponent\(row\.id\)\}\/edit/);
  assert.match(CLIENT, /\/admin\/listening\/segments\?content_id=/);
  for (const editor of ['gist', 'tf', 'mcq']) assert.match(CLIENT, new RegExp(`${editor}\\.html\\?content_id=`));
  assert.match(CLIENT, /Không đồng nghĩa “chưa có”/);
  assert.match(CLIENT, /Đã loại \{current\.malformedCount\} dòng/);
  assert.match(CLIENT, /scope\.current !== owner/);
  assert.match(CLIENT, /setCoverage\(\(previous\) =>/);
  assert.match(CLIENT, /filters\.page > lastPage[\s\S]*router\.replace\(listeningContentListHref/);
});

test('uses responsive, focusable, dark-token and reduced-motion styling', () => {
  assert.match(CSS, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(CSS, /@media\(max-width:1080px\)[\s\S]*\.alc-table thead\{display:none\}/);
  assert.match(CSS, /@media\(max-width:520px\)[\s\S]*min-height:44px/);
  assert.match(CSS, /:focus-visible/);
  assert.match(CSS, /@media\(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(CSS, /#[0-9a-fA-F]{3,8}\b/);
  assert.match(WORKFLOW, /verify-admin-listening-content-flow\.mjs/);
});
