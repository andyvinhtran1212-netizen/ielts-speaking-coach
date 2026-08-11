const { test, expect } = require('@playwright/test');
const {
  ATTEMPT,
  cors,
  createListeningGateEState,
  dispatchAudioMetadata,
  expectNoHarnessErrors,
  installListeningGateEHarness,
  openLegacy,
  openNext,
} = require('./listening-gate-e-harness');

test('listening-core-player-ambiguous-commit', async ({ page }) => {
  const state = createListeningGateEState();
  let q1Writes = 0;
  const harness = await installListeningGateEHarness(page, {
    state,
    handleApi: async ({ route, request, url, entry }) => {
      if (request.method() !== 'PATCH' || !url.pathname.endsWith(`/${ATTEMPT}/answers`)) return false;
      if (Number(entry.body?.q_num) !== 1) return false;
      q1Writes += 1;
      if (q1Writes === 1) {
        state.patchCalls.push({ q_num: 1, user_answer: String(entry.body.user_answer) });
        state.answers.set(1, String(entry.body.user_answer));
        await route.abort('connectionreset');
        return true;
      }
      return false;
    },
  });

  await openNext(page);
  await page.getByRole('button', { name: 'Bắt đầu test' }).click();
  await page.getByLabel('Answer 1').fill('library');
  await expect.poll(() => state.patchCalls.filter(({ q_num }) => q_num === 1).length).toBe(2);
  expect(state.answers.get(1)).toBe('library');
  expect(state.answers.size).toBe(1);

  await page.reload();
  await page.getByRole('button', { name: 'Tiếp tục bài đang làm' }).click();
  await expect(page.getByLabel('Answer 1')).toHaveValue('library');

  await openLegacy(page);
  await page.locator('#ft-resume-btn').click();
  await expect(page.locator('.ft-q-input[data-q-num="1"]')).toHaveValue('library');
  expect(state.startCount).toBe(1);
  expect(state.resumeReads).toBeGreaterThanOrEqual(4);
  await expectNoHarnessErrors(harness);
});

test('listening-core-player-partial-persistence', async ({ page }) => {
  const state = createListeningGateEState();
  let rejectQ2 = true;
  const harness = await installListeningGateEHarness(page, {
    state,
    handleApi: async ({ route, request, url, entry }) => {
      if (request.method() !== 'PATCH' || !url.pathname.endsWith(`/${ATTEMPT}/answers`)) return false;
      if (Number(entry.body?.q_num) !== 2 || !rejectQ2) return false;
      state.patchCalls.push({ q_num: 2, user_answer: String(entry.body.user_answer) });
      await route.fulfill({ status: 422, json: { detail: 'fixture rejects this per-question write' }, headers: cors });
      return true;
    },
  });

  await openNext(page);
  await page.getByRole('button', { name: 'Bắt đầu test' }).click();
  await page.getByLabel('Answer 1').fill('library');
  await expect.poll(() => state.answers.get(1)).toBe('library');
  await page.getByLabel('Answer 2').fill('blue');
  await expect(page.locator('.ft-unsaved-note')).toContainText('1 câu chưa lưu được lên máy chủ');
  expect(state.answers.has(2)).toBe(false);

  await page.getByRole('button', { name: 'Nộp bài' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Nộp bài' }).click();
  await expect(page.locator('.ft-nothing-saved')).toContainText('Vẫn còn câu chưa lưu được lên máy chủ');
  expect(state.submitCalls).toHaveLength(0);
  expect(Object.fromEntries(state.answers)).toEqual({ 1: 'library' });

  rejectQ2 = false;
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect.poll(() => state.answers.get(2)).toBe('blue');
  await expect(page.locator('.ft-unsaved-note')).toHaveCount(0);

  await page.getByRole('button', { name: 'Nộp bài' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Nộp bài' }).click();
  await expect(page.locator('.listening-next-score > strong')).toHaveText('2/2');
  expect(state.submitCalls).toHaveLength(1);
  expect(Object.fromEntries(state.answers)).toEqual({ 1: 'library', 2: 'blue' });

  await openLegacy(page);
  await expect(page.locator('#ft-resume-btn')).toBeHidden();
  expect(state.status).toBe('submitted');
  await expectNoHarnessErrors(harness);
});

test('listening-core-player-reload-resume', async ({ page }) => {
  const state = createListeningGateEState();
  const harness = await installListeningGateEHarness(page, { state });

  await openNext(page);
  await page.getByRole('button', { name: 'Bắt đầu test' }).click();
  await page.getByLabel('Answer 1').fill('library');
  await expect.poll(() => state.answers.get(1)).toBe('library');

  await page.reload();
  await page.getByRole('button', { name: 'Tiếp tục bài đang làm' }).click();
  await expect(page.getByLabel('Answer 1')).toHaveValue('library');
  await dispatchAudioMetadata(page);
  await expect.poll(() => page.locator('audio').evaluate((audio) => audio.currentTime)).toBeGreaterThanOrEqual(29);
  await expect(page.locator('.ft-time')).toContainText('/ 2:00');
  expect(state.startCount).toBe(1);
  expect(state.resumeReads).toBe(3);
  await expectNoHarnessErrors(harness);
});

test('listening-bidirectional-cross-version-core-player', async ({ page }) => {
  const state = createListeningGateEState();
  const harness = await installListeningGateEHarness(page, { state });

  await openLegacy(page);
  await page.locator('#btn-start').click();
  await page.locator('.ft-q-input[data-q-num="1"]').fill('library');
  await expect.poll(() => state.answers.get(1)).toBe('library');

  await openNext(page);
  await page.getByRole('button', { name: 'Tiếp tục bài đang làm' }).click();
  await expect(page.getByLabel('Answer 1')).toHaveValue('library');
  await page.getByLabel('Answer 2').fill('blue');
  await expect.poll(() => state.answers.get(2)).toBe('blue');

  await openLegacy(page);
  await page.locator('#ft-resume-btn').click();
  await expect(page.locator('.ft-q-input[data-q-num="1"]')).toHaveValue('library');
  await expect(page.locator('.ft-q-input[data-q-num="2"]')).toHaveValue('blue');
  expect(state.attemptId).toBe(ATTEMPT);
  expect(state.startCount).toBe(1);
  expect(Object.fromEntries(state.answers)).toEqual({ 1: 'library', 2: 'blue' });
  await expectNoHarnessErrors(harness);
});
