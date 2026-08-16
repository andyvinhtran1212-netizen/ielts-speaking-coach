const { test, expect } = require('@playwright/test');
const {
  RECEIPT_KEY,
  completeLegacyDictation,
  completeNextDictation,
  createDictationGateEState,
  expectNoDictationHarnessErrors,
  installDictationGateEHarness,
  openLegacyDictation,
  openNextDictation,
} = require('./dictation-gate-e-harness');

test('listening-dictation-core-player-ambiguous-commit', async ({ page }) => {
  const state = createDictationGateEState();
  let loseAcknowledgement = true;
  const harness = await installDictationGateEHarness(page, {
    state,
    handleApi: async ({ route, entry, persist }) => {
      if (!entry.body?.client_request_id || !loseAcknowledgement) return false;
      loseAcknowledgement = false;
      persist(entry.body);
      await route.abort('connectionreset');
      return true;
    },
  });

  await openNextDictation(page);
  await completeNextDictation(page);
  await expect(page.getByText('✓ Đã lưu & xác nhận', { exact: true })).toBeVisible();

  expect(state.completionCalls).toHaveLength(1);
  expect(state.sessions).toHaveLength(1);
  expect(state.receiptReads.length).toBeGreaterThanOrEqual(2);
  expect(state.receiptReads.every((id) => id === state.completionCalls[0].client_request_id)).toBe(true);
  expect(await page.evaluate((key) => localStorage.getItem(key), RECEIPT_KEY)).toBeNull();
  await expectNoDictationHarnessErrors(harness);
});

test('listening-dictation-core-player-pre-commit-failure-retry', async ({ page }) => {
  const state = createDictationGateEState();
  let failBeforeCommit = true;
  const harness = await installDictationGateEHarness(page, {
    state,
    handleApi: async ({ route, entry, cors }) => {
      if (!entry.body?.client_request_id || !failBeforeCommit) return false;
      failBeforeCommit = false;
      await route.fulfill({
        status: 503,
        json: { detail: 'fixture pre-commit failure' },
        headers: cors,
      });
      return true;
    },
  });

  await openNextDictation(page);
  await completeNextDictation(page);
  await expect(page.locator('.dict-next-recovery')).toContainText('Kết quả chưa được xác nhận');
  expect(state.sessions).toHaveLength(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), RECEIPT_KEY)).not.toBeNull();

  await page.getByRole('button', { name: 'Gửi lại và xác nhận' }).click();
  await expect(page.getByText('✓ Đã lưu & xác nhận', { exact: true })).toBeVisible();
  expect(state.completionCalls).toHaveLength(2);
  expect(state.completionCalls[0].client_request_id).toBe(state.completionCalls[1].client_request_id);
  expect(state.sessions).toHaveLength(1);
  expect(await page.evaluate((key) => localStorage.getItem(key), RECEIPT_KEY)).toBeNull();
  await expectNoDictationHarnessErrors(harness);
});

test('listening-dictation-core-player-reload-receipt-resume', async ({ page }) => {
  const state = createDictationGateEState();
  let dropBeforeCommit = true;
  const harness = await installDictationGateEHarness(page, {
    state,
    handleApi: async ({ route, entry }) => {
      if (!entry.body?.client_request_id || !dropBeforeCommit) return false;
      dropBeforeCommit = false;
      await route.abort('connectionreset');
      return true;
    },
  });

  await openNextDictation(page);
  await completeNextDictation(page);
  await expect(page.locator('.dict-next-recovery')).toContainText('Kết quả chưa được xác nhận');
  const pending = JSON.parse(await page.evaluate((key) => localStorage.getItem(key), RECEIPT_KEY));
  expect(pending.requestId).toBe(state.completionCalls[0].client_request_id);

  await page.reload();
  await expect(page.getByText('✓ Đã lưu & xác nhận', { exact: true })).toBeVisible();
  expect(state.completionCalls).toHaveLength(2);
  expect(state.completionCalls[1].client_request_id).toBe(pending.requestId);
  expect(state.sessions).toHaveLength(1);
  expect(state.sessions[0].report.client_request_id).toBe(pending.requestId);
  expect(await page.evaluate((key) => localStorage.getItem(key), RECEIPT_KEY)).toBeNull();
  await expectNoDictationHarnessErrors(harness);
});

test('listening-dictation-legacy-next-canonical-coexistence', async ({ page }) => {
  const state = createDictationGateEState();
  const harness = await installDictationGateEHarness(page, { state });

  await openLegacyDictation(page);
  await completeLegacyDictation(page);
  await expect.poll(() => state.sessions.length).toBe(1);
  expect(state.sessions[0].body.client_request_id).toBeUndefined();

  await openNextDictation(page);
  await completeNextDictation(page);
  await expect(page.getByText('✓ Đã lưu & xác nhận', { exact: true })).toBeVisible();

  expect(state.sessions).toHaveLength(2);
  expect(state.sessions[1].body.client_request_id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(state.byRequest.size).toBe(1);
  expect(state.gradeCalls).toHaveLength(2);
  expect(state.sessions.map(({ report }) => report.accuracy)).toEqual([1, 1]);
  await expectNoDictationHarnessErrors(harness);
});
