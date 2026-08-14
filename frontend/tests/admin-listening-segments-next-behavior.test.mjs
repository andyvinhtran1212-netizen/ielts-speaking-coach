import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assignListeningAlignmentTimestamps, assignListeningProportionalTimestamps,
  buildListeningSegmentOperation, findListeningSegmentOperationMatch,
  formatListeningSegmentTime, listeningSegmentsHref, listeningSegmentsRollbackHref,
  MAX_LISTENING_SEGMENTS, normalizeListeningDictationBlocks, normalizeListeningSegmentContent,
  normalizePendingListeningSegmentSave, parseListeningSegmentTime,
  splitListeningTranscript, validateListeningSegments,
} from '../lib/admin-listening-segments-model.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(join(here, '..', ...parts), 'utf8');
const CLIENT = read('app', '(authed-admin-listening)', 'admin', 'listening', 'segments', 'admin-listening-segments.tsx');
const PAGE = read('app', '(authed-admin-listening)', 'admin', 'listening', 'segments', 'page.tsx');
const LAYOUT = read('app', '(authed-admin-listening)', 'layout.tsx');
const LIST = read('app', '(authed-admin-listening)', 'admin', 'listening', 'admin-listening-content.tsx');
const DETAIL = read('app', '(authed-admin-listening)', 'admin', 'listening', 'content', '[contentId]', 'admin-listening-content-detail.tsx');
const CSS = read('public', 'css', 'admin-listening-segments-next.css');
const PLAYER = read('public', 'js', 'components', 'audio-player.js');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const BACKEND = readFileSync(join(here, '..', '..', 'backend', 'routers', 'listening.py'), 'utf8');
const MIGRATION = readFileSync(join(here, '..', '..', 'backend', 'migrations', '208_listening_exercise_block_identity.sql'), 'utf8');

const content = (patch = {}) => ({
  id: 'content-1', title: 'Lecture', transcript: 'Hello.  World.', audio_duration_seconds: 20,
  audio_signed_url: 'https://audio.example/signed', status: 'published', source_type: 'upload_mp3',
  alignment_data: null, ...patch,
});
const segments = [
  { idx: 0, transcript: 'Hello.', start_sec: 0, end_sec: 5 },
  { idx: 1, transcript: 'World.', start_sec: 5, end_sec: 10 },
];
const block = (patch = {}) => ({
  id: 'exercise-1', content_id: 'content-1', exercise_type: 'dictation', order_num: 1,
  status: 'draft', updated_at: '2026-08-14T00:00:00+00:00', segments, ...patch,
});

describe('Admin Listening segments canonical model', () => {
  test('normalizes exact content identity and safe audio truth', () => {
    const value = normalizeListeningSegmentContent(content(), 'content-1');
    assert.equal(value.title, 'Lecture');
    assert.equal(value.audioUrl, 'https://audio.example/signed');
    assert.equal(normalizeListeningSegmentContent(content(), 'other'), null);
    assert.equal(normalizeListeningSegmentContent(content({ audio_duration_seconds: 0 }), 'content-1'), null);
    assert.equal(normalizeListeningSegmentContent(content({ transcript: '' }), 'content-1').transcript, '');
    assert.equal(normalizeListeningSegmentContent(content({ transcript: null }), 'content-1').transcript, '');
    assert.equal(normalizeListeningSegmentContent(content({ audio_signed_url: 'javascript:alert(1)' }), 'content-1').audioUrl, null);
  });

  test('preserves multiple order blocks and exposes malformed/duplicate truth', () => {
    const value = normalizeListeningDictationBlocks({ exercises: [
      block({ id: 'exercise-2', order_num: 2 }),
      block(),
      block({ id: 'duplicate', order_num: 1 }),
      block({ id: '', order_num: 3 }),
    ] }, 'content-1');
    assert.deepEqual(value.items.map((item) => item.orderNum), [1, 1, 2]);
    assert.deepEqual(value.duplicateOrders, [1]);
    assert.equal(value.malformedCount, 1);
    assert.deepEqual(
      normalizeListeningDictationBlocks({ exercises: [block({ segments: null })] }, 'content-1').items[0].segments,
      [],
      'legacy/null segments must be repairable as an empty block',
    );
  });

  test('splits sentences and uses alignment offsets from original whitespace', () => {
    assert.deepEqual(splitListeningTranscript('Hello. World!\nLast line'), ['Hello.', 'World!', 'Last line']);
    const text = 'Hello.  World.';
    const chars = [...text];
    const alignment = {
      characters: chars,
      character_start_times_seconds: chars.map((_, index) => index),
      character_end_times_seconds: chars.map((_, index) => index + 0.5),
    };
    const out = assignListeningAlignmentTimestamps(['Hello.', 'World.'], alignment);
    assert.equal(out[0].startSec, 0);
    assert.equal(out[1].startSec, 8, 'collapsed whitespace must map back to original alignment index');
    assert.equal(out[1].endSec, 13.5);
    const tokenAlignment = {
      characters: ['Hello', ' ', '🌍', '.'],
      character_start_times_seconds: [0, 1, 2, 3],
      character_end_times_seconds: [0.9, 1.9, 2.9, 3.5],
    };
    assert.deepEqual(assignListeningAlignmentTimestamps(['Hello 🌍.'], tokenAlignment), [
      { transcript: 'Hello 🌍.', startSec: 0, endSec: 3.5 },
    ]);
    const many = Array.from({ length: MAX_LISTENING_SEGMENTS + 1 }, (_, index) => `Sentence ${index}.`).join('\n');
    assert.equal(splitListeningTranscript(many).length, MAX_LISTENING_SEGMENTS + 1, 'over-limit input must be reported, never silently truncated');
  });

  test('proportional fallback is contiguous and ends exactly at duration', () => {
    const out = assignListeningProportionalTimestamps(['Short.', 'A much longer sentence.'], 30);
    assert.equal(out[0].startSec, 0);
    assert.equal(out[0].endSec, out[1].startSec);
    assert.equal(out[1].endSec, 30);
  });

  test('parses display time and matches backend overlap/duration validation', () => {
    assert.equal(parseListeningSegmentTime('1:02.5'), 62.5);
    assert.equal(formatListeningSegmentTime(62.5), '1:02.5');
    assert.equal(formatListeningSegmentTime(62.345), '1:02.345');
    assert.equal(formatListeningSegmentTime(59.9996), '1:00.0');
    assert.equal(parseListeningSegmentTime('1:bad'), null);
    assert.equal(validateListeningSegments([
      { transcript: 'A', startSec: 0, endSec: 5 },
      { transcript: 'B', startSec: 4, endSec: 12 },
    ], 10).ok, false);
    assert.equal(validateListeningSegments([
      { transcript: 'A', startSec: 0, endSec: 5 },
      { transcript: 'B', startSec: 5, endSec: 10 },
    ], 10).ok, true);
  });

  test('builds exact versioned update or expected-absent create and reconciles canonical GET', () => {
    const collection = normalizeListeningDictationBlocks({ exercises: [block()] }, 'content-1');
    const existing = collection.items[0];
    const update = buildListeningSegmentOperation({ contentId: 'content-1', block: existing, orderNum: 1, draft: [
      { transcript: 'Hello.', startSec: 0, endSec: 5 },
      { transcript: 'World.', startSec: 5, endSec: 10 },
    ], durationSeconds: 20, status: 'draft' });
    assert.equal(update.operation.exercise_id, 'exercise-1');
    assert.equal(update.operation.expected_updated_at, '2026-08-14T00:00:00+00:00');
    assert.equal(Object.hasOwn(update.operation, 'expected_absent'), false);
    assert.equal(findListeningSegmentOperationMatch(collection, update.operation).id, 'exercise-1');

    const create = buildListeningSegmentOperation({ contentId: 'content-1', block: null, orderNum: 1, draft: [
      { transcript: 'Hello.', startSec: 0, endSec: 5 },
    ], durationSeconds: 20, status: 'draft' });
    assert.equal(create.operation.expected_absent, true);
    assert.equal(Object.hasOwn(create.operation, 'exercise_id'), false);
  });

  test('scopes pending receipts and route identity', () => {
    const pending = { account: 'admin-1', contentId: 'content-1', startedAt: '2026-08-14T00:00:00Z', operation: {
      content_id: 'content-1', exercise_type: 'dictation', order_num: 1, segments, status: 'draft', expected_absent: true,
    } };
    assert.deepEqual(normalizePendingListeningSegmentSave(pending, 'admin-1', 'content-1'), pending);
    assert.equal(normalizePendingListeningSegmentSave(pending, 'admin-2', 'content-1'), null);
    assert.equal(listeningSegmentsHref('a/b', 'x/y'), '/admin/listening/segments?content_id=a%2Fb&exercise_id=x%2Fy');
    assert.equal(listeningSegmentsRollbackHref('a/b'), '/pages/admin/listening/segments.html?content_id=a%2Fb');
  });
});
describe('native segments route and persistence contract', () => {
  test('owns clean admin route and exact inventory/detail entry links', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /subsection="segments"/);
    assert.match(PAGE, /content_id\?: string/);
    assert.match(PAGE, /if \(!contentId\) redirect\('\/admin\/listening'\)/);
    assert.match(PAGE, /<HydratedSignal \/>/);
    assert.match(PAGE, /<LegacyModule src="\/js\/components\/audio-player\.js" \/>/);
    assert.match(PAGE, /watchdogScript\('\/pages\/admin\/listening\/segments\.html'\)/);
    assert.match(PAGE, /watchdogScript intentionally appends the current search\/hash/);
    assert.doesNotMatch(PAGE, /<script type="module"/);
    assert.match(CHROME, /slug: 'segments',[^\n]+href: '\/admin\/listening'/);
    assert.match(LIST, /\/admin\/listening\/segments\?content_id=/);
    assert.match(DETAIL, /\/admin\/listening\/segments\?content_id=/);
    assert.doesNotMatch(DETAIL, /pages\/admin\/listening\/segments\.html\?content_id/);
  });

  test('uses exact block version, durable receipt and canonical readback without replay', () => {
    assert.match(CLIENT, /buildListeningSegmentOperation/);
    assert.match(CLIENT, /window\.api\.post\('\/admin\/listening\/exercises'/);
    assert.match(CLIENT, /const nextCollection = await readCollection\(\)/);
    assert.match(CLIENT, /findListeningSegmentOperationMatch/);
    assert.match(CLIENT, /let postAcknowledged = false/);
    assert.match(CLIENT, /!postAcknowledged && definitive\(statusCode\)/);
    assert.match(CLIENT, /POST đã nhận, chưa đọc lại được/);
    assert.match(CLIENT, /Không tự POST lại|không tự phát lại POST/i);
    assert.match(CLIENT, /sessionStorage\.getItem\(key\) === value/);
    assert.match(CLIENT, /if \(!writeReceipt/);
    assert.match(CLIENT, /if \(!dirty && !pending\) return/);
    assert.match(CLIENT, /nextCollection\.malformedCount/);
    assert.match(CLIENT, /Boolean\(collection\?\.malformedCount\)/);
    assert.match(CLIENT, /Editor đã khóa vì canonical sai contract/);
    assert.match(CLIENT, /const startNewBlock = \(\) =>/);
    assert.match(CLIENT, /expected_absent/);
    assert.match(CLIENT, /targetStatus === 'archived'/);
    assert.match(CLIENT, /Đã lưu trữ Dictation block/);
    assert.match(BACKEND, /exercise_id: str \| None/);
    assert.match(BACKEND, /expected_updated_at is required with exercise_id/);
    assert.match(BACKEND, /explicit_order = "order_num" in body\.model_fields_set/);
    assert.match(BACKEND, /existing_query = existing_query\.order\("order_num"\)/);
    assert.match(BACKEND, /order_num is required with expected_absent/);
    assert.match(BACKEND, /"payload" not in body\.model_fields_set/);
    assert.match(BACKEND, /MAX_LISTENING_SEGMENTS = 500/);
    assert.match(BACKEND, /len\(segments\) > MAX_LISTENING_SEGMENTS/);
    assert.match(BACKEND, /prev_end - 0\.05/);
    assert.match(BACKEND, /audio_duration_seconds\) \+ 0\.5/);
    assert.match(BACKEND, /mutation = mutation\.eq\("updated_at", body\.expected_updated_at\)/);
    assert.match(MIGRATION, /HAVING COUNT\(\*\) > 1[\s\S]+RAISE EXCEPTION/);
    assert.match(MIGRATION, /UNIQUE INDEX IF NOT EXISTS[\s\S]+content_id, exercise_type, order_num/);
  });

  test('uses public audio time API and protects destructive/unsaved boundaries', () => {
    assert.match(PLAYER, /getCurrentTime\(\)/);
    assert.match(CLIENT, /audioRef\.current\?\.getCurrentTime/);
    assert.doesNotMatch(CLIENT, /\._audio/);
    assert.match(CLIENT, /beforeunload/);
    assert.match(CLIENT, /if \(leaving\.current\) return/);
    assert.match(CLIENT, /aria-label=\{`Đánh dấu start câu/);
    assert.match(CLIENT, /sentences\.length > MAX_LISTENING_SEGMENTS/);
    assert.match(CLIENT, /Transcript canonical/);
    assert.match(CLIENT, /readOnly aria-readonly="true"/);
    assert.doesNotMatch(CLIENT, /id="alse-transcript"[^>]+onChange=/);
    assert.match(CLIENT, /<Dialog open=\{confirm !== null\}/);
    assert.match(CLIENT, /<fieldset className="alse-status-options">/);
    assert.match(CLIENT, /<legend>Trạng thái đích<\/legend>/);
    assert.doesNotMatch(CLIENT, /alert\(|confirm\(/);
  });

  test('loads token-only responsive CSS with focus and reduced motion', () => {
    assert.match(LAYOUT, /admin-listening-segments-next\.css/);
    assert.match(CSS, /:focus-visible/);
    assert.match(CSS, /@media\(max-width:760px\)/);
    assert.match(CSS, /min-height:44px/);
    assert.match(CSS, /-webkit-backdrop-filter:blur\(16px\)/);
    assert.match(CSS, /@media\(prefers-reduced-motion:reduce\)/);
    assert.doesNotMatch(CSS, /#[0-9a-fA-F]{3,8}\b/);
    assert.doesNotMatch(CSS, /--av-color-|--av-surface-raised|--av-shadow-xs/);
  });
});
