// Live, reversible acceptance for the deployed course selectors. Only the
// uniquely named synthetic prompt is changed; no class assignments are made.
// @ts-check
const { test, expect } = require('@playwright/test');
const { primeBypassCookie, identityEmail, STAGING_API, STAGING_SUPABASE, STAGING_ANON } = require('./helpers');

let cleanupPrompt;
let cleanupContext;
test.afterEach(async ({ playwright }) => {
  // A test timeout interrupts requests in the test body. Use a separate
  // cleanup hook/context so synthetic data is still archived on failure.
  const cleanup = await playwright.request.newContext({ timeout: 10_000 });
  try {
    if (cleanupPrompt) {
      const { id, headers } = cleanupPrompt;
      const archived = await cleanup.delete(`${STAGING_API}/admin/writing/prompts/${id}`, { headers });
      expect(archived.status(), 'Synthetic Writing prompt must be archived after acceptance').toBe(200);
      const detail = await cleanup.get(`${STAGING_API}/admin/writing/prompts/${id}`, { headers });
      expect((await detail.json()).is_active).toBe(false);
    }
  } finally {
    cleanupPrompt = null;
    await cleanup.dispose();
    await cleanupContext?.close();
    cleanupContext = null;
  }
});

test('Writing course allocation persists and is reused by the assignment picker', async ({ browser, request, baseURL }) => {
  test.setTimeout(120_000);
  expect(new URL(baseURL).hostname).toBe('staging.averlearning.com');
  const password = process.env.E2E_PASSWORD;
  if (!password) throw new Error('E2E_PASSWORD is required for staging Writing acceptance.');
  const login = await request.post(`${STAGING_SUPABASE}/auth/v1/token?grant_type=password`, {
    headers: { apikey: STAGING_ANON }, data: { email: identityEmail('admin'), password },
  });
  expect(login.status()).toBe(200);
  const session = await login.json();
  session.expires_at ||= Math.floor(Date.now() / 1000) + session.expires_in;
  const headers = { Authorization: `Bearer ${session.access_token}` };
  const marker = `E2E Writing Courses ${process.env.RELEASE_SOURCE_SHA?.slice(0, 12) || Date.now()}`;
  const created = await request.post(`${STAGING_API}/admin/writing/prompts`, {
    headers, data: {
      title: marker, task_type: 'task2', difficulty: 'intermediate', tags: ['e2e-writing-courses'],
      prompt_text: 'Some people believe that education should be free for everyone. Discuss both views and give your opinion.',
    },
  });
  expect(created.status()).toBe(201);
  const promptId = (await created.json()).id;
  cleanupPrompt = { id: promptId, headers };
  const context = await browser.newContext({ baseURL });
  cleanupContext = context;
  const detail = () => request.get(`${STAGING_API}/admin/writing/prompts/${promptId}`, { headers });
  await primeBypassCookie(context, baseURL);
  const storageKey = `sb-${new URL(STAGING_SUPABASE).hostname.split('.')[0]}-auth-token`;
  await context.addInitScript(([key, value]) => {
    if (!localStorage.getItem('__writing_e2e_seeded')) {
      localStorage.setItem(key, value);
      localStorage.setItem('__writing_e2e_seeded', '1');
    }
  }, [storageKey, JSON.stringify(session)]);
  const page = await context.newPage();
  await page.goto(`/admin/writing/prompts?q=${encodeURIComponent(marker)}`);
  // Live list reads may take longer than the default five-second assertion
  // window. Wait for the library's completed load, then assert its content.
  await expect(page.getByRole('button', { name: 'Làm mới', exact: true })).toBeEnabled({ timeout: 30_000 });
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: marker, exact: true }) });
  await expect(card.getByText('Chưa phân bổ', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Phân bổ khóa học', exact: true }).click();
  for (const course of [2, 5]) await page.getByRole('checkbox', { name: `Course ${course}`, exact: true }).check();
  await page.getByRole('button', { name: 'Lưu đề', exact: true }).click();
  await expect(page.getByText('Đã cập nhật prompt và đối chiếu lại từ máy chủ.', { exact: true })).toBeVisible();
  const saved = await detail();
  expect(saved.status()).toBe(200);
  expect((await saved.json()).tags).toEqual(['e2e-writing-courses', 'course:2', 'course:5']);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Làm mới', exact: true })).toBeEnabled({ timeout: 30_000 });
  await expect(card.getByText('Course 2', { exact: true })).toBeVisible();
  await expect(card.getByText('Course 5', { exact: true })).toBeVisible();
  await page.getByRole('group', { name: 'Lọc theo khóa học' }).getByRole('button', { name: /Course 2/ }).click();
  await expect(card).toBeVisible();
  await card.getByRole('link', { name: 'Giao đề này', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const option = dialog.locator('label.awa-option').filter({ has: page.getByText(marker, { exact: true }) });
  await expect(option.getByRole('checkbox')).toBeChecked();
  await dialog.getByRole('combobox', { name: 'Khóa học của đề', exact: true }).selectOption('1');
  await expect(option).toHaveCount(0);
  await expect(dialog.getByText('1 đề đã chọn trên tất cả khóa. Đổi bộ lọc giữ nguyên các đề đã chọn.', { exact: true })).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Khóa học của đề', exact: true }).selectOption('5');
  await expect(option.getByRole('checkbox')).toBeChecked();
  await page.goto(`/admin/writing/prompts?q=${encodeURIComponent(marker)}`);
  await expect(page.getByRole('button', { name: 'Làm mới', exact: true })).toBeEnabled({ timeout: 30_000 });
  await card.getByRole('button', { name: 'Phân bổ khóa học', exact: true }).click();
  for (const course of [2, 5]) await page.getByRole('checkbox', { name: `Course ${course}`, exact: true }).uncheck();
  await page.getByRole('button', { name: 'Lưu đề', exact: true }).click();
  await expect(page.getByText('Đã cập nhật prompt và đối chiếu lại từ máy chủ.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Làm mới', exact: true })).toBeEnabled({ timeout: 30_000 });
  await expect(card.getByText('Chưa phân bổ', { exact: true })).toBeVisible();
  expect((await (await detail()).json()).tags).toEqual(['e2e-writing-courses']);
});
