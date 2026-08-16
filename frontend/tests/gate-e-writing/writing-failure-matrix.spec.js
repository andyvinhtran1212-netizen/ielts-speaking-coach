const { test, expect } = require('@playwright/test');
const {
  ASSIGNMENT,
  OWNER,
  commitSubmission,
  cors,
  createWritingGateEState,
  expectNoHarnessErrors,
  installWritingGateEHarness,
  openComposer,
  openLegacy,
  openNext,
} = require('./writing-gate-e-harness');

const FIRST = 'A durable first server draft with enough meaningful words for the autosave contract.';
const LATEST = `${FIRST} The latest in-memory paragraph must survive even when its draft PATCH fails.`;

test('writing-core-player-ambiguous-commit', async ({ page }) => {
  const state = createWritingGateEState();
  let faulted = false;
  const harness = await installWritingGateEHarness(page, {
    state,
    handleApi: async ({ route, request, url, entry }) => {
      if (faulted || request.method() !== 'POST' || !url.pathname.endsWith(`/${ASSIGNMENT}/submit`)) return false;
      faulted = true;
      state.submitCalls.push({ ...entry.body });
      commitSubmission(state, entry.body);
      await route.abort('connectionreset');
      return true;
    },
  });

  await openNext(page);
  await openComposer(page);
  await page.locator('#modal-essay-textarea').fill(LATEST);
  await page.locator('#modal-btn-submit').click();
  await expect(page.locator('#writing-submit-notice')).toContainText('Đã đối chiếu');
  await expect(page.locator('#submit-modal')).toBeHidden();
  expect(state.essayCount).toBe(1);
  expect(state.jobCount).toBe(1);
  expect(state.submitCalls).toHaveLength(1);
  expect(state.submittedText).toBe(LATEST);
  expect(state.requestId).toMatch(/^[0-9a-f-]{36}$/i);
  const pending = await page.evaluate(([owner, assignment]) => (
    window.WritingSubmitReceipt.read(owner, assignment)
  ), [OWNER, ASSIGNMENT]);
  expect(pending).toBeNull();

  await page.reload();
  await expect(page.locator('#essays-list')).toContainText('Chờ chấm');
  await expect(page.locator('#assignments-empty')).toBeVisible();
  expect(state.essayCount).toBe(1);
  expect(state.jobCount).toBe(1);
  await expectNoHarnessErrors(harness);
});

test('writing-core-player-partial-persistence', async ({ page }) => {
  const state = createWritingGateEState();
  let rejectLatest = true;
  const harness = await installWritingGateEHarness(page, {
    state,
    handleApi: async ({ route, request, url, entry }) => {
      if (request.method() !== 'PATCH' || !url.pathname.endsWith(`/${ASSIGNMENT}/draft`)) return false;
      if (!rejectLatest || entry.body?.draft_text !== LATEST) return false;
      state.draftCalls.push(LATEST);
      await route.fulfill({ status: 422, json: { detail: 'fixture rejects latest draft' }, headers: cors });
      return true;
    },
  });

  await openNext(page);
  await openComposer(page);
  await page.locator('#modal-essay-textarea').fill(FIRST);
  await page.locator('#modal-btn-save').click();
  await expect.poll(() => state.draftText).toBe(FIRST);
  await page.locator('#modal-essay-textarea').fill(LATEST);
  await page.locator('#modal-btn-save').click();
  await expect.poll(() => state.draftCalls.filter((text) => text === LATEST).length).toBe(1);
  expect(state.draftText).toBe(FIRST);

  await page.locator('#modal-btn-submit').click();
  await expect(page.locator('#writing-submit-notice')).toContainText('Đã gửi bài thành công');
  expect(state.submittedText).toBe(LATEST);
  expect(state.essayCount).toBe(1);
  expect(state.jobCount).toBe(1);
  expect(state.submitCalls[0].essay_text).toBe(LATEST);

  rejectLatest = false;
  await page.reload();
  await expect(page.locator('#essays-list')).toContainText('Chờ chấm');
  await expect(page.locator('#assignments-empty')).toBeVisible();
  await expectNoHarnessErrors(harness);
});

test('writing-core-player-reload-resume', async ({ page }) => {
  const state = createWritingGateEState();
  const harness = await installWritingGateEHarness(page, { state });

  await openNext(page);
  await openComposer(page);
  await page.locator('#modal-essay-textarea').fill(FIRST);
  await page.locator('#modal-btn-save').click();
  await expect.poll(() => state.draftText).toBe(FIRST);
  const startedAt = state.startedAt;

  await page.reload();
  await openComposer(page);
  await expect(page.locator('#modal-essay-textarea')).toHaveValue(FIRST);
  expect(state.startedAt).toBe(startedAt);
  expect(state.startCalls).toBe(2);
  await expectNoHarnessErrors(harness);
});

test('writing-bidirectional-cross-version-core-player', async ({ page }) => {
  const state = createWritingGateEState();
  const harness = await installWritingGateEHarness(page, { state });

  await openLegacy(page);
  await openComposer(page);
  await page.locator('#modal-essay-textarea').fill(FIRST);
  await page.locator('#modal-btn-save').click();
  await expect.poll(() => state.draftText).toBe(FIRST);

  await openNext(page);
  await openComposer(page);
  await expect(page.locator('#modal-essay-textarea')).toHaveValue(FIRST);
  await page.locator('#modal-essay-textarea').fill(LATEST);
  await page.locator('#modal-btn-save').click();
  await expect.poll(() => state.draftText).toBe(LATEST);

  await openLegacy(page);
  await openComposer(page);
  await expect(page.locator('#modal-essay-textarea')).toHaveValue(LATEST);
  expect(state.essayCount).toBe(0);
  expect(state.jobCount).toBe(0);
  expect(state.startedAt).not.toBeNull();
  await expectNoHarnessErrors(harness);
});
