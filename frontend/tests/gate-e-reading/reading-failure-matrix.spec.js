const { test, expect } = require('@playwright/test');
const {
  ATTEMPT,
  cors,
  createReadingGateEState,
  expectNoHarnessErrors,
  installReadingGateEHarness,
  openLegacy,
  openNext,
} = require('./reading-gate-e-harness');

test('reading-core-player-ambiguous-commit', async ({ page }) => {
  const state = createReadingGateEState();
  let q1Writes = 0;
  const harness = await installReadingGateEHarness(page, {
    state,
    allowCrossRendererFixture: true,
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
  await page.getByRole('button', { name: 'Bắt đầu bài thi' }).click();
  await page.getByLabel('Answer 1').fill('first idea');
  await expect.poll(() => state.patchCalls.filter(({ q_num }) => q_num === 1).length).toBe(2);
  expect(state.answers.get(1)).toBe('first idea');
  expect(state.answers.size).toBe(1);

  await page.reload();
  await page.getByRole('button', { name: 'Tiếp tục bài đang làm' }).click();
  await expect(page.getByLabel('Answer 1')).toHaveValue('first idea');

  await openLegacy(page);
  await page.locator('#exam-resume-btn-prestart').click();
  await expect(page.locator('input[name="q-1"]')).toHaveValue('first idea');
  expect(state.startCount).toBe(1);
  expect(state.bootCount).toBe(3);
  await expectNoHarnessErrors(harness);
});

test('reading-core-player-partial-persistence', async ({ page }) => {
  const state = createReadingGateEState();
  const harness = await installReadingGateEHarness(page, {
    state,
    handleApi: async ({ route, request, url, entry }) => {
      if (request.method() !== 'PATCH' || !url.pathname.endsWith(`/${ATTEMPT}/answers`)) return false;
      if (Number(entry.body?.q_num) !== 2) return false;
      state.patchCalls.push({ q_num: 2, user_answer: String(entry.body.user_answer) });
      await route.fulfill({ status: 422, json: { detail: 'fixture rejects this per-question write' }, headers: cors });
      return true;
    },
  });

  await openNext(page);
  await page.getByRole('button', { name: 'Bắt đầu bài thi' }).click();
  await page.getByLabel('Answer 1').fill('first idea');
  await expect.poll(() => state.answers.get(1)).toBe('first idea');
  await page.getByRole('radiogroup', { name: 'Answer 2' }).getByRole('radio', { name: 'TRUE' }).check();
  await expect(page.locator('.reading-next-save-banner')).toContainText('1 câu chưa lưu được lên máy chủ');
  expect(state.answers.has(2)).toBe(false);

  await page.getByRole('button', { name: 'Submit' }).click();
  await page.getByRole('button', { name: 'Nộp bài', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Kết quả' })).toBeVisible();
  await expect(page.locator('.exam-results-score')).toHaveText('2/3');
  await expect(page.locator('.reading-next-result-table')).toContainText('TRUE');
  expect(state.submitCalls).toHaveLength(1);
  expect(state.submitCalls[0]).toEqual([
    { q_num: 1, user_answer: 'first idea' },
    { q_num: 2, user_answer: 'TRUE' },
  ]);
  expect(Object.fromEntries(state.answers)).toEqual({ 1: 'first idea', 2: 'TRUE' });

  await openLegacy(page);
  await expect(page.locator('#exam-resume-btn-prestart')).toBeHidden();
  expect(state.status).toBe('submitted');
  expect(Object.fromEntries(state.answers)).toEqual({ 1: 'first idea', 2: 'TRUE' });
  await expectNoHarnessErrors(harness);
});

test('reading-core-player-reload-resume', async ({ page }) => {
  const state = createReadingGateEState();
  const harness = await installReadingGateEHarness(page, { state });

  await openNext(page);
  await page.getByRole('button', { name: 'Bắt đầu bài thi' }).click();
  await page.getByLabel('Answer 1').fill('first idea');
  await expect.poll(() => state.answers.get(1)).toBe('first idea');
  const beforeReload = await page.getByRole('timer').textContent();

  await page.reload();
  await page.getByRole('button', { name: 'Tiếp tục bài đang làm' }).click();
  await expect(page.getByLabel('Answer 1')).toHaveValue('first idea');
  await expect(page.getByRole('timer')).toContainText('59:');
  const afterReload = await page.getByRole('timer').textContent();
  expect(Number(afterReload?.replace(':', ''))).toBeLessThanOrEqual(Number(beforeReload?.replace(':', '')));
  expect(state.bootCount).toBe(2);
  expect(state.startCount).toBe(1);
  await expectNoHarnessErrors(harness);
});

test('reading-bidirectional-cross-version-core-player', async ({ page }) => {
  const state = createReadingGateEState();
  const harness = await installReadingGateEHarness(page, {
    state,
    allowCrossRendererFixture: true,
  });

  await openLegacy(page);
  await page.locator('#exam-start-btn').click();
  await page.locator('input[name="q-1"]').fill('first idea');
  await expect.poll(() => state.answers.get(1)).toBe('first idea');

  await openNext(page);
  await page.getByRole('button', { name: 'Tiếp tục bài đang làm' }).click();
  await expect(page.getByLabel('Answer 1')).toHaveValue('first idea');
  await page.getByRole('radiogroup', { name: 'Answer 2' }).getByRole('radio', { name: 'TRUE' }).check();
  await expect.poll(() => state.answers.get(2)).toBe('TRUE');

  await openLegacy(page);
  await page.locator('#exam-resume-btn-prestart').click();
  await expect(page.locator('input[name="q-1"]')).toHaveValue('first idea');
  await expect(page.locator('select[name="q-2"]')).toHaveValue('TRUE');
  expect(state.attemptId).toBe(ATTEMPT);
  expect(state.startCount).toBe(1);
  expect(state.bootCount).toBe(3);
  expect(Object.fromEntries(state.answers)).toEqual({ 1: 'first idea', 2: 'TRUE' });
  await expectNoHarnessErrors(harness);
});
