import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.join(here, '..');
const receiptSource = readFileSync(
  path.join(frontend, 'public', 'js', 'writing-submit-receipt.js'),
  'utf8',
);
const legacyHtml = readFileSync(
  path.join(frontend, 'public', 'pages', 'writing-dashboard.html'),
  'utf8',
);

test('Writing receipt falls back to memory when sessionStorage rejects writes', () => {
  const storage = {
    get length() { return 0; },
    getItem() { return null; },
    key() { return null; },
    removeItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('QuotaExceededError'); },
  };
  const window = {
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
  };
  vm.runInNewContext(receiptSource, {
    Array,
    Date,
    JSON,
    Object,
    String,
    TypeError,
    Uint8Array,
    encodeURIComponent,
    sessionStorage: storage,
    window,
  });

  const first = window.WritingSubmitReceipt.begin('student-1', 'assignment-1', 'Exact essay');
  const retry = window.WritingSubmitReceipt.begin('student-1', 'assignment-1', 'Changed essay');
  assert.equal(first.requestId, retry.requestId);
  assert.equal(retry.essayText, 'Exact essay');
  assert.deepEqual(
    JSON.parse(JSON.stringify(window.WritingSubmitReceipt.list('student-1'))),
    [JSON.parse(JSON.stringify(first))],
  );

  window.WritingSubmitReceipt.remove('student-1', 'assignment-1');
  assert.equal(window.WritingSubmitReceipt.read('student-1', 'assignment-1'), null);
});

test('late legacy rejection for assignment A cannot mutate assignment B', async () => {
  const match = legacyHtml.match(
    /    async function submitFromModal\(force\) \{[\s\S]*?\n    \}(?=\n\n    function closeModal)/,
  );
  assert.ok(match, 'legacy submitFromModal() must remain extractable');

  let rejectPost;
  const post = new Promise((_, reject) => { rejectPost = reject; });
  const removed = [];
  let closeCount = 0;
  const modalState = {
    accountId: 'student-1',
    assignmentId: 'assignment-A',
    allowSoftCheck: false,
    autoSaveTimer: null,
    countdownInterval: null,
  };
  const textarea = { value: 'A complete essay with enough words.' };
  const submitButton = { disabled: false };
  const saveButton = { disabled: false };
  const context = {
    Promise,
    clearInterval() {},
    clearTimeout() {},
    closeModal() { closeCount += 1; modalState.assignmentId = null; },
    confirm() { return true; },
    countWords() { return 101; },
    definitiveSubmitRejection(err) { return err?.status >= 400 && err?.status < 500; },
    document: {
      getElementById(id) {
        if (id === 'modal-essay-textarea') return textarea;
        if (id === 'modal-btn-submit') return submitButton;
        if (id === 'modal-btn-save') return saveButton;
        return null;
      },
    },
    loadAssignments: async () => {},
    loadEssays: async () => {},
    modalState,
    reconcileSubmission: async () => null,
    showSpellPanel() {},
    showSubmissionNotice() {},
    submitStatus(err) { return err?.status ?? null; },
    window: {
      api: { post: async () => post },
      WritingSubmitReceipt: {
        begin(account, assignmentId, essayText) {
          return {
            account,
            assignmentId,
            essayText,
            requestId: '11111111-1111-4111-8111-111111111111',
          };
        },
        normalizeAck() { return null; },
        remove(account, assignmentId) { removed.push([account, assignmentId]); },
      },
    },
  };
  vm.runInNewContext(match[0] + '\nthis.submitFromModal = submitFromModal;', context);

  const pendingA = context.submitFromModal(true);
  await Promise.resolve();
  modalState.assignmentId = 'assignment-B';
  submitButton.disabled = true;
  saveButton.disabled = true;
  rejectPost(Object.assign(new Error('conflict'), { status: 409 }));
  await pendingA;

  assert.deepEqual(removed, [['student-1', 'assignment-A']]);
  assert.equal(modalState.assignmentId, 'assignment-B');
  assert.equal(closeCount, 0);
  assert.equal(submitButton.disabled, true);
  assert.equal(saveButton.disabled, true);
});
