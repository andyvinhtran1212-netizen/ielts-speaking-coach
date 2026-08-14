import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  canPublishListeningTest, listeningTestDeleteReceiptKey, makeListeningTestDeleteReceipt,
  consumeListeningTestDeleteReceipt,
  normalizeListeningAudioBundle, normalizeListeningHardDeleteAck,
  normalizeListeningMapSignedUrl, normalizeListeningTestDetail, normalizeListeningTestReadback,
  parseListeningTestDeleteReceipt, storeListeningTestDeleteReceipt,
  validateListeningAudioFile, validateListeningMapFile,
} from '../lib/admin-listening-test-detail-model.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const CLIENT = read('app', '(authed-admin-listening)', 'admin', 'listening', 'tests', '[testId]', 'admin-listening-test-detail.tsx');
const PAGE = read('app', '(authed-admin-listening)', 'admin', 'listening', 'tests', '[testId]', 'page.tsx');
const LIST = read('app', '(authed-admin-listening)', 'admin', 'listening', 'tests', 'admin-listening-tests.tsx');
const LAYOUT = read('app', '(authed-admin-listening)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-listening-test-detail-next.css');

const detailFixture = (patch = {}) => ({
  id: 't-uuid', test_id: 'C19-T1', title: '<script> stays text', status: 'draft', test_type: 'full',
  version: '1.0', band_target: 7.5, accent_profile: ['British'], total_transcript_words: 2100,
  exam_only: false, audio_assembly_mode: 'parts_auto_assembled', full_audio_storage_path: null,
  assembled_audio_storage_path: 'tests/t-uuid/assembled.mp3', assembled_audio_generated_at: '2026-08-14T00:00:00Z',
  cue_points: [{ type: 'section_start', section_num: 1, timestamp_seconds: 12.5 }],
  sections: [
    { id: 'c1', section_num: 1, title: 'Section <one>', status: 'draft', audio_storage_path: 'tests/t-uuid/section-1.mp3', audio_ready: true, exercise_count: 2 },
    { id: 'c2', section_num: 2, title: 'Section two', status: 'published', audio_storage_path: null, audio_ready: false, exercise_count: 1 },
  ],
  plan_label_exercises: [{ id: 'e1', content_id: 'c1', section_num: 1, has_map_image: true, map_image_source: 'manual_upload', letter_options: ['A', 'B'] }],
  created_at: '2026-08-13T00:00:00Z', updated_at: '2026-08-14T00:00:00Z',
  ...patch,
});

test('detail normalizer pins identity and preserves partial canonical structure', () => {
  const row = normalizeListeningTestDetail(detailFixture(), 't-uuid');
  assert.equal(row.testId, 'C19-T1');
  assert.equal(row.sections.length, 2);
  assert.equal(row.sections[0].audioReady, true);
  assert.equal(row.planExercises[0].mapImageSource, 'manual_upload');
  assert.equal(row.cues[0].timestampSeconds, 12.5);
  assert.equal(normalizeListeningTestDetail(detailFixture(), 'other'), null);
  assert.equal(normalizeListeningTestDetail(detailFixture({ status: 'ghost' }), 't-uuid'), null);
});

test('malformed child rows are counted rather than rendered as empty truth', () => {
  const raw = detailFixture();
  raw.sections.push({ ...raw.sections[0] }, { id: 'bad', section_num: 8, status: 'draft', exercise_count: 0 });
  raw.plan_label_exercises.push({ id: 'e2', content_id: 'foreign', section_num: 1, has_map_image: false });
  raw.cue_points.push({ type: 'bad', timestamp_seconds: -1 });
  const row = normalizeListeningTestDetail(raw, 't-uuid');
  assert.equal(row.sections.length, 2);
  assert.equal(row.malformedSectionCount, 2);
  assert.equal(row.malformedPlanCount, 1);
  assert.equal(row.malformedCueCount, 1);
});

test('readback checks exact requested mutation without trusting write ACK', () => {
  assert.equal(normalizeListeningTestReadback(detailFixture({ status: 'published' }), 't-uuid', { status: 'published' }).status, 'published');
  assert.equal(normalizeListeningTestReadback(detailFixture(), 't-uuid', { status: 'published' }), null);
  assert.equal(normalizeListeningTestReadback(detailFixture(), 't-uuid', { sectionAudio: 2 }), null);
  assert.equal(normalizeListeningTestReadback(detailFixture(), 't-uuid', { mapExerciseId: 'e1', hasMapImage: false }), null);
  assert.equal(normalizeListeningTestReadback(detailFixture({ status: 'archived', sections: [{ ...detailFixture().sections[0], status: 'archived' }] }), 't-uuid', { status: 'archived', allSectionsArchived: true }).status, 'archived');
});

test('audio bundle rejects unsafe URLs and reports stored assets without previews', () => {
  const bundle = normalizeListeningAudioBundle({
    full: { audio_storage_path: 'tests/full.mp3', signed_url: 'javascript:alert(1)' },
    assembled: { audio_storage_path: null, signed_url: null },
    sections: [{ section_num: 1, audio_storage_path: 'tests/s1.mp3', signed_url: 'https://storage.test/s1.mp3' }],
  });
  assert.equal(bundle.full.signedUrl, null);
  assert.equal(bundle.sections[0].signedUrl, 'https://storage.test/s1.mp3');
  assert.equal(bundle.unavailableCount, 1);
  assert.equal(normalizeListeningAudioBundle({ sections: [{ section_num: 1 }, { section_num: 1 }] }), null);
});

test('map URL and hard-delete ACK require exact identities', () => {
  assert.equal(normalizeListeningMapSignedUrl({ exercise_id: 'e1', signed_url: 'https://storage.test/map.png' }, 'e1').signedUrl, 'https://storage.test/map.png');
  assert.equal(normalizeListeningMapSignedUrl({ exercise_id: 'e2', signed_url: 'https://storage.test/map.png' }, 'e1'), null);
  const ack = { deleted: true, id: 't-uuid', test_id: 'C19-T1', cascade_count: { content: 4, exercises: 8, attempts: 2, storage_files_removed: 5, storage_files_failed: [] } };
  assert.equal(normalizeListeningHardDeleteAck(ack, 't-uuid', 'C19-T1').attempts, 2);
  assert.equal(normalizeListeningHardDeleteAck({ ...ack, id: 'other' }, 't-uuid', 'C19-T1'), null);
});

test('hard-delete receipt preserves storage cleanup warnings across navigation', () => {
  const clean = makeListeningTestDeleteReceipt('C19-T1', { content: 4, exercises: 8, attempts: 2, storageFilesRemoved: 5, storageFilesFailed: [] });
  const warning = makeListeningTestDeleteReceipt('C19-T1', { content: 4, exercises: 8, attempts: 2, storageFilesRemoved: 4, storageFilesFailed: ['tests/t1/full.mp3'] });
  assert.equal(clean.kind, 'success');
  assert.match(clean.text, /4 section/);
  assert.equal(warning.kind, 'warning');
  assert.match(warning.text, /Ops cần kiểm tra orphan/);
  assert.deepEqual(parseListeningTestDeleteReceipt(JSON.stringify(warning)), warning);
  assert.equal(parseListeningTestDeleteReceipt('{bad'), null);
  assert.equal(listeningTestDeleteReceiptKey('admin-1'), 'aver:admin-listening-test-delete:admin-1');
});

test('receipt storage failures fall back once without blocking list or redirect', () => {
  const warning = makeListeningTestDeleteReceipt('C19-T1', { content: 4, exercises: 8, attempts: 2, storageFilesRemoved: 4, storageFilesFailed: ['tests/t1/full.mp3'] });
  const key = listeningTestDeleteReceiptKey('storage-denied-admin');
  const denied = () => ({
    getItem() { throw new DOMException('denied', 'SecurityError'); },
    removeItem() { throw new DOMException('denied', 'SecurityError'); },
    setItem() { throw new DOMException('denied', 'SecurityError'); },
  });
  assert.equal(storeListeningTestDeleteReceipt(key, warning, denied), false);
  assert.deepEqual(consumeListeningTestDeleteReceipt(key, denied), warning);
  assert.equal(consumeListeningTestDeleteReceipt(key, denied), null);
});

test('publish and upload validators mirror backend preconditions', () => {
  assert.equal(canPublishListeningTest({ audioMode: 'full_premixed', fullAudioStoragePath: 'full.mp3' }).ok, true);
  assert.equal(canPublishListeningTest({ audioMode: 'parts_auto_assembled', assembledAudioStoragePath: 'assembled.mp3' }).ok, true);
  assert.equal(canPublishListeningTest({ audioMode: 'parts_only' }).ok, false);
  assert.equal(validateListeningAudioFile({ name: 'audio.MP3' }), null);
  assert.match(validateListeningAudioFile({ name: 'audio.wav' }), /\.mp3/);
  assert.equal(validateListeningMapFile({ type: 'image/webp', size: 1200 }), null);
  assert.match(validateListeningMapFile({ type: 'image/gif', size: 1200 }), /PNG/);
  assert.match(validateListeningMapFile({ type: 'image/png', size: 6 * 1024 * 1024 }), /5 MB/);
});

test('dynamic route is admin-gated and tests inventory owns its native detail links', () => {
  assert.match(PAGE, /params: Promise<\{ testId: string \}>/);
  assert.match(PAGE, /<AdminAccessGate>/);
  assert.match(PAGE, /active="listening" subsection="tests"/);
  assert.match(LIST, /href=\{`\/admin\/listening\/tests\/\$\{encodeURIComponent\(row\.id\)\}`\}/);
  assert.doesNotMatch(LIST, /href=\{`\/pages\/admin\/listening\/tests-detail\.html/);
  assert.match(LAYOUT, /admin-listening-test-detail-next\.css/);
});

test('reads are account-keyed, ordered and keep audio/map failures explicit', () => {
  assert.match(CLIENT, /const key = `\$\{profile\.id\}:\$\{testId\}`/);
  assert.match(CLIENT, /const order = \+\+detailOrder\.current/);
  assert.match(CLIENT, /order !== detailOrder\.current/);
  assert.match(CLIENT, /const order = \+\+audioOrder\.current/);
  assert.match(CLIENT, /const order = \+\+mapOrder\.current/);
  assert.match(CLIENT, /lỗi này không có nghĩa audio chưa tồn tại/);
  assert.match(CLIENT, /Có \{audioValue\.unavailableCount\} storage record/);
});

test('every write is busy-guarded and reconciled from canonical GET', () => {
  assert.match(CLIENT, /if \(!current \|\| busy\) return/);
  assert.match(CLIENT, /await window\.api\.patch\([\s\S]*await reconcile\(request/);
  assert.match(CLIENT, /await window\.api\.upload\([\s\S]*await reconcile\(request/);
  assert.match(CLIENT, /await window\.api\.post\([\s\S]*await reconcile\(request/);
  assert.match(CLIENT, /await window\.api\.delete\([\s\S]*await reconcile\(request/);
  assert.match(CLIENT, /normalizeListeningTestReadback/);
  assert.doesNotMatch(CLIENT, /window\.confirm|window\.prompt/);
});

test('hard delete uses typed confirmation and exact cascade ACK', () => {
  assert.match(CLIENT, /hardDeleteText !== current\.testId/);
  assert.match(CLIENT, /normalizeListeningHardDeleteAck/);
  assert.match(CLIENT, /storeListeningTestDeleteReceipt\(listeningTestDeleteReceiptKey\(profile\.id\)/);
  assert.match(LIST, /consumeListeningTestDeleteReceipt\(receiptKey\)/);
  assert.match(LIST, /receiptProfile\.current === profile\.id/);
  assert.match(LIST, /Đã xóa, cần dọn storage/);
  assert.match(CLIENT, /router\.push\('\/admin\/listening\/tests'\)/);
  assert.doesNotMatch(CLIENT, /storageFilesFailed\.length[\s\S]*?return;/);
  assert.match(CLIENT, /Xóa test, sections, exercises, attempts/);
});

test('UI retains rollback identity and responsive/accessibility boundaries', () => {
  assert.match(CLIENT, /\/pages\/admin\/listening\/tests-detail\.html\?id=\$\{encodeURIComponent\(current\.id\)\}/);
  assert.match(CLIENT, /role="region" aria-label="Cue points" tabIndex=\{0\}/);
  assert.match(CLIENT, /role=\{banner\.kind === 'error' \? 'alert' : 'status'\}/);
  assert.match(CSS, /@media\(max-width:760px\)/);
  assert.match(CSS, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(CSS, /:focus-visible/);
  assert.match(CSS, /overflow-x:auto/);
});
