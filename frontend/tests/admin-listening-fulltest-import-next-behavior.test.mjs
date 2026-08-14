import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildFulltestImportReceipt,
  formatFulltestBytes,
  fulltestDescriptorFingerprint,
  fulltestImagePromptBlocks,
  fulltestImportReceiptKey,
  fulltestTestsHref,
  groupFulltestQuestions,
  normalizeFulltestCanonical,
  normalizeFulltestCommit,
  normalizeFulltestImportReceipt,
  normalizeFulltestPreview,
  normalizeFulltestSearch,
  routeFulltestFile,
  validateFulltestFiles,
} from '../lib/admin-listening-fulltest-import-model.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(join(here, '..', ...parts), 'utf8');
const CLIENT = read('app', '(authed-admin-listening)', 'admin', 'listening', 'import-fulltest', 'admin-listening-fulltest-import.tsx');
const PAGE = read('app', '(authed-admin-listening)', 'admin', 'listening', 'import-fulltest', 'page.tsx');
const LAYOUT = read('app', '(authed-admin-listening)', 'layout.tsx');
const TESTS = read('app', '(authed-admin-listening)', 'admin', 'listening', 'tests', 'admin-listening-tests.tsx');
const CSS = read('public', 'css', 'admin-listening-fulltest-import-next.css');
const WORKFLOW = readFileSync(join(here, '..', '..', '.github', 'workflows', 'parity-gate.yml'), 'utf8');
const LEDGER = readFileSync(join(here, '..', '..', 'docs', 'ROUTE_LEDGER.md'), 'utf8');

const file = (name, size = 100) => ({ name, size });
const files = (patch = {}) => ({
  questionPaper: file('ILR_LIS_001_Question_Paper.md'),
  solution: file('ILR_LIS_001_Solution.md'), timings: file('timings.json'), audio: file('full_test.mp3', 26 * 1024 * 1024), ...patch,
});
const question = (number, patch = {}) => ({ q_num: number, section: `S${Math.ceil(number / 10)}`, prompt: `Question ${number}`,
  options: [{ letter: 'A', text: 'Alpha' }, { letter: 'B', text: 'Beta' }], answer: 'B', ...patch });
const preview = (patch = {}) => ({ ok: true, duplicate_test_id: false, errors: [], warnings: [], section_count: 1, question_count: 2,
  metadata: { test_id: 'ILR-LIS-001', title: 'Fixture', format_version: '1.2', transcript_source: 'solution' },
  questions: [question(1), question(2)], ...patch });

describe('Admin Listening full-test import canonical model', () => {
  test('routes multi-file drops deterministically and rejects wrong/missing/oversized inputs', () => {
    assert.equal(routeFulltestFile('ILR_Question_Paper.md'), 'questionPaper');
    assert.equal(routeFulltestFile('ILR_Solution.md'), 'solution');
    assert.equal(routeFulltestFile('answers.markdown'), 'solution');
    assert.equal(routeFulltestFile('timings.JSON'), 'timings');
    assert.equal(routeFulltestFile('full.MP3'), 'audio');
    assert.equal(routeFulltestFile('notes.txt'), null);
    assert.equal(validateFulltestFiles(files()).ok, true);
    assert.match(validateFulltestFiles(files({ audio: null })).errors.audio, /Chưa chọn/);
    assert.match(validateFulltestFiles(files({ solution: file('solution.txt') })).errors.solution, /\.md/);
    assert.match(validateFulltestFiles(files({ audio: file('full.mp3', 61 * 1024 * 1024) })).errors.audio, /60 MB/);
  });

  test('builds a content-bound fingerprint only from four SHA-256 descriptors and mode', () => {
    const digest = 'a'.repeat(64);
    const descriptors = Object.fromEntries(Object.entries(files()).map(([field, row]) => [field, { ...row, digest }]));
    assert.match(fulltestDescriptorFingerprint(descriptors, false), /^full\|questionPaper:/);
    assert.match(fulltestDescriptorFingerprint(descriptors, true), /^mini\|/);
    assert.equal(fulltestDescriptorFingerprint({ ...descriptors, audio: { ...descriptors.audio, digest: 'weak' } }), null);
  });

  test('normalizes strict dry-run evidence, sections and contiguous image blocks', () => {
    const raw = preview({ question_count: 3, questions: [question(1, { img_prompt: 'Map A' }), question(2, { img_prompt: 'Map A' }), question(4, { img_prompt: 'Map A' })] });
    const normalized = normalizeFulltestPreview(raw);
    assert.equal(normalized.testId, 'ILR-LIS-001');
    assert.deepEqual(groupFulltestQuestions(normalized.questions).map((section) => [section.number, section.questions.length]), [[1, 3]]);
    assert.deepEqual(fulltestImagePromptBlocks(normalized.questions).map((block) => [block.first, block.last]), [[1, 2], [4, 4]]);
    assert.equal(normalizeFulltestPreview(preview({ ok: true, errors: ['hidden failure'] })), null);
    assert.equal(normalizeFulltestPreview(preview({ questions: [question(1), question(1)] })), null);
    assert.equal(normalizeFulltestPreview(preview({ questions: [question(1, { section: 'banana' }), question(2)] })), null);
    assert.equal(normalizeFulltestPreview(preview({ questions: [question(1, { answer: '' }), question(2)] })), null);
    assert.equal(normalizeFulltestPreview(preview({ questions: [question(1, { prompt: '' }), question(2)] })).questions[0].prompt, '');
    assert.equal(normalizeFulltestPreview(preview({ question_count: 40 })), null);
  });

  test('requires exact commit ACK then exact UUID/test/status/section canonical GET', () => {
    const ack = { id: 'uuid-new', test_id: 'ILR-LIS-001', status: 'draft', sections_created: 4, exercises_created: 10,
      audio: { size_bytes: 26000000, duration_seconds: 1657 }, warnings: [] };
    assert.equal(normalizeFulltestCommit(ack, 'ILR-LIS-001').id, 'uuid-new');
    assert.equal(normalizeFulltestCommit({ ...ack, status: 'published' }, 'ILR-LIS-001'), null);
    const canonical = { id: 'uuid-new', test_id: 'ILR-LIS-001', status: 'draft', test_type: 'full', title: 'Fixture',
      sections: [{ id: 's1', section_num: 1 }, { id: 's2', section_num: 2 }, { id: 's3', section_num: 3 }, { id: 's4', section_num: 4 }], plan_label_exercises: [] };
    assert.equal(normalizeFulltestCanonical(canonical, 'uuid-new', 'ILR-LIS-001', 'draft').sectionCount, 4);
    assert.equal(normalizeFulltestCanonical(canonical, 'uuid-new', 'ILR-LIS-001', 'draft', 'mini'), null);
    assert.equal(normalizeFulltestCanonical({ ...canonical, test_type: 'mini' }, 'uuid-new', 'ILR-LIS-001', 'draft', 'mini'), null);
    assert.equal(normalizeFulltestCanonical({ ...canonical, test_type: 'mini', sections: canonical.sections.slice(0, 1) }, 'uuid-new', 'ILR-LIS-001', 'draft', 'mini').sectionCount, 1);
    assert.equal(normalizeFulltestCanonical({ ...canonical, sections: canonical.sections.slice(0, 2) }, 'uuid-new', 'ILR-LIS-001', 'draft', 'full'), null);
    assert.equal(normalizeFulltestCanonical(canonical, 'wrong', 'ILR-LIS-001'), null);
    assert.equal(normalizeFulltestCanonical({ ...canonical, sections: [{ id: 's1', section_num: 1 }, { id: 's1', section_num: 2 }] }, 'uuid-new', 'ILR-LIS-001'), null);
  });

  test('reconciliation separates baseline archived rows from one newly created identity', () => {
    const envelope = { total: 3, limit: 100, offset: 0, items: [
      { id: 'old', test_id: 'ILR-LIS-001', status: 'archived', test_type: 'full' },
      { id: 'new', test_id: 'ILR-LIS-001', status: 'draft', test_type: 'full' },
      { id: 'other', test_id: 'ILR-LIS-010', status: 'draft', test_type: 'full' },
    ] };
    const result = normalizeFulltestSearch(envelope, 'ILR-LIS-001', ['old']);
    assert.deepEqual(result.matches.map((row) => row.id), ['old', 'new']);
    assert.deepEqual(result.newMatches.map((row) => row.id), ['new']);
    assert.equal(normalizeFulltestSearch({ ...envelope, total: '3' }, 'ILR-LIS-001'), null);
  });

  test('durable receipts are account scoped and links preserve exact Test ID', () => {
    const receipt = buildFulltestImportReceipt({ account: 'admin-1', testId: 'ILR/LIS 1', fingerprint: 'full|hash', mini: false, baselineIds: ['old', 'old'] });
    assert.deepEqual(receipt.baselineIds, ['old']);
    assert.deepEqual(normalizeFulltestImportReceipt(receipt, 'admin-1'), receipt);
    assert.equal(normalizeFulltestImportReceipt(receipt, 'admin-2'), null);
    assert.match(fulltestImportReceiptKey('admin/1'), /admin%2F1/);
    assert.equal(fulltestTestsHref('ILR/LIS 1'), '/admin/listening/tests?search=ILR%2FLIS+1');
    assert.equal(formatFulltestBytes(26 * 1024 * 1024), '26.0 MB');
  });
});

describe('native route, write boundary and responsive contract', () => {
  test('owns the clean route, keeps explicit rollback and updates the tests inventory CTA', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /<HydratedSignal \/>/);
    assert.match(PAGE, /watchdogScript\('\/pages\/admin\/listening\/import-fulltest\.html'\)/);
    assert.match(PAGE, /subsection="tests"/);
    assert.match(TESTS, /href="\/admin\/listening\/import-fulltest"/);
    assert.match(CLIENT, /href="\/pages\/admin\/listening\/import-fulltest\.html"/);
    assert.match(LEDGER, /`\/admin\/listening\/import-fulltest`[^\n]+native React ownership/);
  });

  test('hashes before dry-run, invalidates changed files and hard-blocks duplicate Test IDs', () => {
    assert.match(CLIENT, /crypto\.subtle\.digest\('SHA-256'/);
    assert.match(CLIENT, /const invalidate = \(\) =>/);
    assert.match(CLIENT, /setPreview\(null\); setPreviewFingerprint\(null\)/);
    assert.match(CLIENT, /preview\.duplicate/);
    assert.match(CLIENT, /Không archive trong lúc upload/);
    assert.match(CLIENT, /fulltestTestsHref\(preview\.testId\)/);
    assert.doesNotMatch(CLIENT, /patch\([^\n]+archived|_archiveThenCommit|archive-import/);
    assert.match(CLIENT, /const modeCompatible = preview\?\.sectionCount === \(mini \? 1 : 4\)/);
  });

  test('writes receipt before progress-aware POST and reconciles ACK or ambiguity with GET only', () => {
    assert.match(CLIENT, /persistReceipt\(receipt\);/);
    assert.match(CLIENT, /localStorage\.getItem\(receiptKey\) !== serialized/);
    assert.match(CLIENT, /commitLock\.current/);
    assert.match(CLIENT, /for \(;;\)/);
    assert.match(CLIENT, /xhr\.upload\.onprogress/);
    assert.match(CLIENT, /getSession/);
    assert.match(CLIENT, /normalizeFulltestCommit/);
    assert.match(CLIENT, /readCanonical\(ack\.id, preview\.testId, 'draft', mini \? 'mini' : 'full'\)/);
    assert.match(CLIENT, /caught instanceof UploadHttpError/);
    assert.match(CLIENT, /không tự phát lại POST/);
    assert.match(CLIENT, /newMatches\.length !== 1/);
    assert.match(CLIENT, /Đối chiếu canonical/);
    assert.equal((CLIENT.match(/\buploadCommit\(/g) || []).length, 2, 'one declaration + one invocation; reconciliation must not replay');
  });

  test('purges account-local evidence and ignores stale async completions when the admin identity changes', () => {
    assert.match(CLIENT, /const activeAccount = useRef\(profile\.id\)/);
    assert.match(CLIENT, /setFiles\(EMPTY_FILES\); setMini\(false\); setAttempted\(false\); setPreview\(null\)/);
    assert.match(CLIENT, /activeAccount\.current !== account/);
    assert.match(CLIENT, /const accountReady = receiptOwner\.current === profile\.id && receiptReady/);
    assert.match(CLIENT, /activeUpload\.current\?\.abort\(\)/);
    assert.match(CLIENT, /dryRunLock\.current/);
  });

  test('publishes only through a dialog plus exact status readback, without native alert/confirm', () => {
    assert.match(CLIENT, /<Dialog open=\{dialog === 'publish'\}/);
    assert.match(CLIENT, /window\.api\.patch\(`\/admin\/listening\/tests\/\$\{encodeURIComponent\(target\.id\)\}\/status`/);
    assert.match(CLIENT, /readCanonical\(target\.id, target\.testId, 'published', target\.type\)/);
    assert.match(CLIENT, /chưa cập nhật UI lạc quan/);
    assert.doesNotMatch(CLIENT, /\b(?:window\.)?(?:alert|confirm)\s*\(/i);
  });

  test('loads token-only responsive CSS and fixture browser coverage', () => {
    assert.match(LAYOUT, /admin-listening-fulltest-import-next\.css/);
    assert.match(CSS, /:focus-visible/);
    assert.match(CSS, /:focus-within/);
    assert.match(CSS, /min-height:44px/);
    assert.match(CSS, /@media\(max-width:760px\)/);
    assert.match(CSS, /prefers-reduced-motion:reduce/);
    assert.doesNotMatch(CSS, /#[0-9a-fA-F]{3,8}\b/);
    assert.match(CLIENT, /role="progressbar"/);
    assert.doesNotMatch(CLIENT, /className="alfi-progress" role="status"/);
    assert.match(WORKFLOW, /verify-admin-listening-fulltest-import-flow\.mjs/);
  });
});
