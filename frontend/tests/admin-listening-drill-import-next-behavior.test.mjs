import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildDrillImportReceipt,
  DRILL_MAX_AUDIO_BYTES,
  DRILL_MAX_TEXT_BYTES,
  drillDescriptorFingerprint,
  drillImportReceiptKey,
  drillTestsHref,
  groupDrillFiles,
  normalizeDrillCanonical,
  normalizeDrillCommit,
  normalizeDrillImportReceipt,
  normalizeDrillPreview,
  normalizeDrillSearch,
  formatDrillBytes,
  validateDrillBundle,
} from '../lib/admin-listening-drill-import-model.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(join(__dirname, '..', ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-listening)', 'admin', 'listening', 'import-drills', 'page.tsx');
const CLIENT = read('app', '(authed-admin-listening)', 'admin', 'listening', 'import-drills', 'admin-listening-drill-import.tsx');
const LAYOUT = read('app', '(authed-admin-listening)', 'layout.tsx');
const TESTS = read('app', '(authed-admin-listening)', 'admin', 'listening', 'tests', 'admin-listening-tests.tsx');
const CSS = read('public', 'css', 'admin-listening-drill-import-next.css');
const LEDGER = readFileSync(join(__dirname, '..', '..', 'docs', 'ROUTE_LEDGER.md'), 'utf8');
const WORKFLOW = readFileSync(join(__dirname, '..', '..', '.github', 'workflows', 'parity-gate.yml'), 'utf8');

const file = (name, webkitRelativePath = '', size = 100) => ({ name, webkitRelativePath, size });
const id = 'ILR-LIS-DRL-MCQ-L2-T1';

describe('drill file inventory is deterministic', () => {
  test('directory paths bind accessories to exact Test ID and preserve metadata-only bundles', () => {
    const grouped = groupDrillFiles([
      file(`${id}.json`, `11_Skill_Drills_Web/Source_JSON/${id}.json`),
      file('timings.json', `11_Skill_Drills_Web/audio_output/${id}/timings.json`),
      file('full_test.mp3', `11_Skill_Drills_Web/audio_output/${id}/full_test.mp3`, 2_000),
      file('ILR-LIS-DRL-NOTE-L2-T1.json', '11_Skill_Drills_Web/Source_JSON/ILR-LIS-DRL-NOTE-L2-T1.json'),
    ]);
    assert.equal(grouped.errors.length, 0);
    assert.equal(grouped.bundles.length, 2);
    assert.equal(grouped.bundles[0].audio.name, 'full_test.mp3');
    assert.equal(grouped.bundles[1].audio, null);
    assert.equal(validateDrillBundle(grouped.bundles[1]).ok, true);
  });

  test('loose accessories never attach when more than one source exists', () => {
    const grouped = groupDrillFiles([
      file(`${id}.json`), file('ILR-LIS-DRL-NOTE-L2-T1.json'), file('timings.json'), file('full_test.mp3'),
    ]);
    assert.equal(grouped.errors.length, 1);
    assert.equal(grouped.unassigned.length, 2);
    assert.equal(grouped.bundles.every((bundle) => !bundle.timings && !bundle.audio), true);
  });

  test('recognized accessories in a noncanonical directory are blocking unassigned evidence', () => {
    const grouped = groupDrillFiles([
      file(`${id}.json`, `wrong/${id}.json`),
      file('full_test.mp3', `audio/${id}/full_test.mp3`),
      file('timings.json', `audio_output/${id}/nested/timings.json`),
    ]);
    assert.deepEqual(grouped.unassigned, [`wrong/${id}.json`, `audio/${id}/full_test.mp3`, `audio_output/${id}/nested/timings.json`]);
    assert.equal(grouped.ignored.length, 0);
  });

  test('frontend limits mirror the backend JSON/audio caps', () => {
    const oversizedSource = groupDrillFiles([file(`${id}.json`, `Source_JSON/${id}.json`, DRILL_MAX_TEXT_BYTES + 1)]).bundles[0];
    assert.match(validateDrillBundle(oversizedSource).errors.join(' '), /vượt giới hạn 2 MB/);
    const oversizedAudio = groupDrillFiles([
      file(`${id}.json`, `Source_JSON/${id}.json`), file('timings.json', `audio_output/${id}/timings.json`),
      file('full_test.mp3', `audio_output/${id}/full_test.mp3`, DRILL_MAX_AUDIO_BYTES + 1),
    ]).bundles[0];
    assert.match(validateDrillBundle(oversizedAudio).errors.join(' '), /vượt giới hạn 30 MB/);
  });

  test('duplicate slots and audio without timings fail closed', () => {
    const duplicate = groupDrillFiles([
      file(`${id}.json`, `Source_JSON/${id}.json`),
      file('timings.json', `audio_output/${id}/timings.json`),
      file('timings.json', `copy/audio_output/${id}/timings.json`),
    ]).bundles[0];
    assert.equal(validateDrillBundle(duplicate).ok, false);
    const audioOnly = groupDrillFiles([
      file(`${id}.json`, `Source_JSON/${id}.json`), file('full_test.mp3', `audio_output/${id}/full_test.mp3`),
    ]).bundles[0];
    assert.match(validateDrillBundle(audioOnly).errors.join(' '), /thiếu timings\.json/);
  });

  test('fingerprint binds source, optional timings and audio identity', () => {
    const hash = 'a'.repeat(64);
    assert.equal(drillDescriptorFingerprint({ source: { name: `${id}.json`, size: 10, digest: hash }, timings: null, audio: null }),
      `source:${id}.json:10:${hash}|timings:none|audio:none`);
    assert.equal(drillDescriptorFingerprint({ source: { name: `${id}.json`, size: 10, digest: 'bad' } }), null);
    assert.equal(formatDrillBytes(0), '0 KB');
  });
});

describe('dry-run, ACK and canonical contracts', () => {
  const preview = { ok: true, duplicate_test_id: false, test_id: id, title: 'MCQ drill', drill_type: 'mcq', level: 'L2', task: '1', question_count: 5, has_audio: true, errors: [], warnings: [] };

  test('dry-run requires exact filename identity, known skill and timing truth', () => {
    assert.equal(normalizeDrillPreview(preview, id).questionCount, 5);
    assert.equal(normalizeDrillPreview({ ...preview, test_id: `${id}-OTHER` }, id), null);
    assert.equal(normalizeDrillPreview({ ...preview, drill_type: 'mystery' }, id), null);
    assert.equal(normalizeDrillPreview({ ...preview, has_audio: false }, id).timingReady, false);
    const invalid = normalizeDrillPreview({ ...preview, ok: false, test_id: '', drill_type: '', question_count: 0,
      has_audio: false, errors: ['Thiếu test_id.'] }, id);
    assert.equal(invalid.ok, false);
    assert.deepEqual(invalid.errors, ['Thiếu test_id.']);
  });

  test('commit ACK pins identity, metadata and actual uploaded audio', () => {
    const raw = { id: 'uuid-1', test_id: id, status: 'draft', drill_type: 'mcq', level: 'L2', has_audio: true, exercises_created: 2, warnings: [] };
    assert.equal(normalizeDrillCommit(raw, { testId: id, drillType: 'mcq', level: 'L2', hasAudio: true }).id, 'uuid-1');
    assert.equal(normalizeDrillCommit({ ...raw, has_audio: false }, { testId: id, drillType: 'mcq', level: 'L2', hasAudio: true }), null);
  });

  test('canonical detail reads audio truth from the test row and requires one exercised section', () => {
    const raw = { id: 'uuid-1', test_id: id, title: 'MCQ drill', status: 'draft', test_type: 'drill',
      metadata: { drill_type: 'mcq', level: 'L2' }, full_audio_storage_path: 'drills/uuid-1/full.mp3',
      full_audio_duration_seconds: 90, full_audio_size_bytes: 2_000,
      sections: [{ id: 'section-1', section_num: 2, exercise_count: 2, audio_ready: false }], plan_label_exercises: [] };
    const expected = { id: 'uuid-1', testId: id, drillType: 'mcq', level: 'L2', hasAudio: true, status: 'draft' };
    assert.equal(normalizeDrillCanonical(raw, expected).hasAudio, true, 'section.audio_ready is intentionally not canonical for full_premixed drills');
    assert.equal(normalizeDrillCanonical({ ...raw, full_audio_storage_path: null }, expected), null);
    assert.equal(normalizeDrillCanonical({ ...raw, sections: [{ ...raw.sections[0], exercise_count: 0 }] }, expected), null);
    const metadataOnlyExpected = { ...expected, hasAudio: false };
    assert.equal(normalizeDrillCanonical({ ...raw, full_audio_storage_path: null, full_audio_duration_seconds: 90, full_audio_size_bytes: 2_000 }, metadataOnlyExpected), null);
  });

  test('paginated exact search and receipts distinguish baseline from one new row', () => {
    const envelope = { total: 2, limit: 100, offset: 0, items: [
      { id: 'old', test_id: id, status: 'archived', test_type: 'drill' },
      { id: 'new', test_id: id, status: 'draft', test_type: 'drill' },
    ] };
    assert.deepEqual(normalizeDrillSearch(envelope, id, ['old']).newMatches.map((row) => row.id), ['new']);
    assert.equal(normalizeDrillSearch({ ...envelope, limit: 101 }, id), null);
    assert.equal(normalizeDrillSearch({ ...envelope, total: 1 }, id), null);
    const receipt = buildDrillImportReceipt({ account: 'admin-1', testId: id, fingerprint: 'hash', drillType: 'mcq', level: 'L2', hasAudio: true, baselineIds: ['old', 'old'] });
    assert.deepEqual(receipt.baselineIds, ['old']);
    assert.deepEqual(normalizeDrillImportReceipt(receipt, 'admin-1'), receipt);
    assert.equal(normalizeDrillImportReceipt(receipt, 'admin-2'), null);
    assert.equal(normalizeDrillImportReceipt({ ...receipt, drillType: 'mystery' }, 'admin-1'), null);
    assert.equal(normalizeDrillImportReceipt({ ...receipt, startedAt: 'not-a-date' }, 'admin-1'), null);
    assert.equal(normalizeDrillImportReceipt({ ...receipt, baselineIds: 'old' }, 'admin-1'), null);
    assert.match(drillImportReceiptKey('admin/1'), /admin%2F1/);
    assert.equal(drillTestsHref(id), `/admin/listening/tests?search=${id}`);
  });
});

describe('native route, queue boundary and responsive contract', () => {
  test('owns the clean route, preserves explicit rollback and updates the tests CTA', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /watchdogScript\('\/pages\/admin\/listening\/import-drills\.html'\)/);
    assert.match(PAGE, /subsection="tests"/);
    assert.match(TESTS, /href="\/admin\/listening\/import-drills"/);
    assert.match(CLIENT, /href="\/pages\/admin\/listening\/import-drills\.html"/);
    assert.match(LEDGER, /`\/admin\/listening\/import-drills`[^\n]+native React ownership/);
  });

  test('never guesses loose multi-source ownership and never silently drops audio', () => {
    assert.match(CLIENT, /groupDrillFiles/);
    assert.match(CLIENT, /audio_output\/&lt;TEST_ID&gt;/);
    assert.match(CLIENT, /Audio thiếu timings/);
    assert.match(CLIENT, /Không đoán quan hệ file/);
    assert.match(CLIENT, /preview\.duplicate/);
  });

  test('writes one account receipt before each sequential POST and stops on ambiguity', () => {
    assert.match(CLIENT, /for \(const bundle of queue\)/);
    assert.match(CLIENT, /localStorage\.getItem\(receiptKey\) !== serialized/);
    assert.match(CLIENT, /Đã có receipt khác của cùng tài khoản trong tab khác/);
    assert.match(CLIENT, /const inventoryBlocked = inventoryErrors\.length > 0 \|\| unassigned\.length > 0/);
    assert.match(CLIENT, /!bundles\.length \|\| inventoryBlocked/);
    assert.match(CLIENT, /commitLock\.current/);
    assert.match(CLIENT, /xhr\.upload\.onprogress/);
    assert.match(CLIENT, /normalizeDrillCommit/);
    assert.match(CLIENT, /readCanonical/);
    assert.match(CLIENT, /queue đã dừng/i);
    assert.match(CLIENT, /newMatches\.length !== 1/);
    assert.match(CLIENT, /if \(bundle\.canonical\) continue/);
    assert.match(CLIENT, /canonical\.exerciseCount !== ack\.exercisesCreated/);
    const queueLoop = CLIENT.slice(CLIENT.indexOf('for (const bundle of queue)'), CLIENT.indexOf('const reconcile = async'));
    assert.match(queueLoop, /const token = await accessToken\(\)/);
    assert.match(queueLoop, /caught\.status === 401/);
    assert.doesNotMatch(CLIENT.slice(CLIENT.indexOf('const reconcile = async'), CLIENT.indexOf('const discardReceipt')), /uploadDrill\(/, 'reconcile must remain GET-only');
  });

  test('account switching aborts old XHR and resets local UI while receipts stay account-scoped', () => {
    assert.match(CLIENT, /const activeAccount = useRef\(profile\.id\)/);
    assert.match(CLIENT, /activeUpload\.current\?\.abort\(\)/);
    assert.match(CLIENT, /receiptOwner\.current === profile\.id && receiptReady/);
    assert.match(CLIENT, /activeAccount\.current !== account/);
    assert.match(CLIENT, /timings\.json không chứa full_test\/sections hợp lệ/);
    assert.match(CLIENT, /Tải lại sau khi cấp quyền lưu trữ/);
    assert.doesNotMatch(CLIENT, /\{!recovered && <section className="aldi-action-card"/);
  });

  test('confirmation is accessible and CSS meets responsive token contract', () => {
    assert.match(CLIENT, /<Dialog open=\{dialog === 'commit'\}/);
    assert.doesNotMatch(CLIENT, /\b(?:window\.)?(?:alert|confirm)\s*\(/i);
    assert.match(CLIENT, /role="progressbar"/);
    assert.match(LAYOUT, /admin-listening-drill-import-next\.css/);
    assert.match(CSS, /:focus-visible/);
    assert.match(CSS, /:focus-within/);
    assert.match(CSS, /\.aldi-shell \.sr-only/);
    assert.match(CSS, /\.adm-status-pill\.is-warning/);
    assert.match(CSS, /min-height:44px/);
    assert.match(CSS, /@media\(max-width:760px\)/);
    assert.match(CSS, /prefers-reduced-motion:reduce/);
    assert.doesNotMatch(CSS, /#[0-9a-fA-F]{3,8}\b/);
    assert.match(WORKFLOW, /verify-admin-listening-drill-import-flow\.mjs/);
  });
});
