const { test, expect } = require('@playwright/test');
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { cors, installReadingHarness } = require('./reading-native-harness');

// Fresh test-browser profile, never the user's existing Chrome. No UA override:
// actual Chrome must independently satisfy the product's admission predicate.
test.use(process.env.AVER_NATIVE_CHROME === '1' ? { channel: 'chrome', headless: false, actionTimeout: 10_000 } : { actionTimeout: 10_000 });
test.setTimeout(90_000);
const A = '00000000-0000-4000-8000-0000000000bb';
const B = '00000000-0000-4000-8000-0000000000cc';
const AUTH_KEY = 'aver:qa-draft-auth';
const FAULT_KEY = 'aver:qa-draft-storage-fault';
const DRAFT_KEY = 'aver:learner-tab-drafts:v1';
const READING = '/reading/vocab/owned-draft';
const API = 'https://owned-draft.fixture.invalid';
const payload = { id: 'article-owned-draft', slug: 'owned-draft', title: 'Owned draft identity fixture', body_markdown: 'Controlled local Reading source.', glossary: [], questions: [
  { q_num: 1, question_type: 'gap_text', prompt: 'Write an unchecked response.', payload: {} },
  { q_num: 2, question_type: 'mcq_single', prompt: 'Choose one.', payload: { options: [{ label: 'A', text: 'Alpha' }, { label: 'B', text: 'Beta' }] } },
] };

test('G-U03 native A logout/Back/B and storage faults never revive private drafts or start work', async ({ page }, testInfo) => {
  let owner = A;
  let micCalls = 0;
  await page.exposeFunction('__qaUnexpectedMic', () => { micCalls++; });
  await page.addInitScript(({ draftKey, faultKey }) => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    const fault = localStorage.getItem(faultKey);
    if (fault === 'corrupt') set.call(sessionStorage, draftKey, '{bad');
    Storage.prototype.getItem = function (key) {
      if (this === sessionStorage && key === draftKey && fault === 'corrupt') return '{bad';
      if (this === sessionStorage && key === draftKey && fault === 'unavailable') throw new DOMException('Owned QA storage unavailable', 'SecurityError');
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (this === sessionStorage && key === draftKey && fault === 'quota') throw new DOMException('Owned QA quota limit', 'QuotaExceededError');
      return set.call(this, key, value);
    };
    if (navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      await window.__qaUnexpectedMic(); throw new Error('Microphone is outside the draft fixture');
    } });
  }, { draftKey: DRAFT_KEY, faultKey: FAULT_KEY });
  await page.route('**/js/runtime-config.js', route => route.fulfill({ contentType: 'application/javascript', body: `window.__AVER_RUNTIME_CONFIG__=Object.freeze({environment:'test',apiBase:'${API}',supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'owned-draft-fixture',release:'local-fixture',gitRef:null});` }));
  // Block every external host. All application APIs are fulfilled locally by
  // the maintained harness; no remote auth, provider, database or storage.
  await page.route(/^https:\/\//, route => route.abort());
  const harness = await installReadingHarness(page, {
    authOwner: A, authStateKey: AUTH_KEY, apiBase: API, route: READING,
    handleApi: async ({ route, request, url }) => {
      if (request.method() !== 'GET') return false;
      let json = {};
      if (url.pathname === '/api/reading/vocab/owned-draft') json = payload;
      else if (url.pathname === '/auth/me') json = { id: owner, email: 'owned-qa@test.local', display_name: 'Owned QA', role: 'user', is_active: true, permissions: ['all'], onboarding_completed: true };
      else if (url.pathname === '/topics') json = [{ title: 'Approved topic', category: 'Public' }];
      else if (url.pathname === '/sessions') json = { sessions: [], total: 0, total_pages: 0, page: 1, page_size: 20 };
      else if (url.pathname === '/stats') json = { total_sessions: 0, recent_sessions: [] };
      else if (url.pathname === '/api/analytics/events') { await route.fulfill({ status: 204, headers: cors }); return true; }
      await route.fulfill({ json, headers: cors });
      return true;
    },
  });
  const text = () => page.getByRole('textbox', { name: 'Câu 1', exact: true });
  const openPractice = async () => {
    await expect(page.locator('#greeting-name')).toHaveText('QA');
    if (!await page.locator('#tab-practice').isVisible()) await page.locator('.mode-card[data-mode="practice"]').first().click();
    await expect(page.locator('#prac-topic-select')).toBeEnabled();
  };
  await expect(text()).toBeVisible();
  const admission = await page.evaluate(async () => {
    const ua = navigator.userAgent;
    return { ua, supported: /Macintosh; Intel Mac OS X/.test(ua) && /\bChrome\/(?:152|154)\.0\.0\.0\b/.test(ua) && !/\b(?:Edg|OPR|Firefox|CriOS|HeadlessChrome)\//.test(ua) };
  });
  if (process.env.AVER_NATIVE_CHROME === '1') expect(admission.supported, `Native draft persistence requires a measured browser, actual UA: ${admission.ua}`).toBe(true);
  await text().fill('private A — never visible to B');
  await page.getByLabel('B. Beta', { exact: true }).check();
  await page.reload();
  await expect(text()).toHaveValue(admission.supported ? 'private A — never visible to B' : '');
  if (!admission.supported) await expect(page.getByText('Nháp chưa được lưu. Bạn vẫn có thể tiếp tục làm bài.', { exact: true })).toBeVisible();
  await page.goto('/');
  await page.evaluate(() => window.__emitReadingNativeAuth(null));
  await page.goBack();
  await expect(text()).toHaveCount(0);
  await expect(page.getByText('private A — never visible to B', { exact: true })).toHaveCount(0);
  // A fresh B signal uses only the local SDK seam; no external sign-in exists.
  owner = B;
  await page.evaluate(id => window.__emitReadingNativeAuth({ access_token: 'reading-native-token', refresh_token: 'refresh', expires_at: 4_102_444_800, user: { id, email: 'owned-qa@test.local' } }), B);
  await page.goto(READING);
  await expect(text()).toHaveValue('');
  await expect(page.getByLabel('B. Beta', { exact: true })).not.toBeChecked();
  await text().fill('owned B draft');
  await page.reload();
  await expect(text()).toHaveValue(admission.supported ? 'owned B draft' : '');
  await page.getByRole('button', { name: 'Bỏ nháp bài này', exact: true }).press('Enter');
  await expect(page.getByText(admission.supported ? 'Đã bỏ nháp của bài đọc này.' : 'Nháp chưa được lưu. Bạn vẫn có thể tiếp tục làm bài.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(text()).toHaveValue('');

  // Exact outstanding Speaking gap: discard after a settled positive reload,
  // then reload again. Restore/discard remains preparation, not Start/record.
  await page.goto('/speaking');
  await openPractice();
  await page.locator('#prac-part-2').click();
  const cue = 'Describe a place\nYou should say:\nwhere it is\nwhat you did\nand why it matters';
  await page.locator('#prac-custom-q').fill(cue);
  await page.reload();
  await openPractice();
  await expect(page.locator('#prac-custom-q')).toHaveValue(admission.supported ? cue : '');
  if (!admission.supported) await page.locator('#prac-custom-q').fill(cue);
  await page.locator('#speaking-draft-discard').press('Enter');
  await expect(page.locator('#speaking-draft-notice')).toHaveText(admission.supported ? 'Đã bỏ nháp của mode hiện tại.' : 'Nháp chưa được lưu trong tab này. Bạn vẫn có thể luyện tập; hãy giữ trang mở để tránh mất nội dung.');
  await page.reload();
  await openPractice();
  await expect(page.locator('#prac-custom-q')).toHaveValue('');

  for (const fault of ['corrupt', 'quota', 'unavailable']) {
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [FAULT_KEY, fault]);
    await page.goto(READING);
    await expect(text()).toHaveValue('');
    await text().fill(`editable despite ${fault}`);
    await expect(text()).toHaveValue(`editable despite ${fault}`);
    await expect(page.getByText('Nháp chưa được lưu. Bạn vẫn có thể tiếp tục làm bài.', { exact: true })).toBeVisible();
    await page.reload();
    await expect(text()).toHaveValue('');
    await page.goto('/speaking');
    await openPractice();
    await page.locator('#prac-custom-q').fill(`editable Speaking despite ${fault}`);
    await expect(page.locator('#prac-custom-q')).toHaveValue(`editable Speaking despite ${fault}`);
    await expect(page.locator('#speaking-draft-notice')).toContainText('chưa được lưu');
    await page.reload();
    await openPractice();
    await expect(page.locator('#prac-custom-q')).toHaveValue('');
  }
  expect(harness.calls.filter(call => /\/check(?:$|\/)|\/sessions(?:$|\/)/.test(call.path) && !['GET', 'OPTIONS'].includes(call.method))).toEqual([]);
  expect(harness.calls.filter(call => /grade|transcri|provider|audio|record|upload/.test(call.path))).toEqual([]);
  expect(micCalls).toBe(0);
  expect(harness.pageErrors).toEqual([]);
  const sources = ['lib/learner-tab-drafts.mjs', 'lib/learner-tab-draft-support.mjs', 'lib/auth/auth-provider.tsx', 'app/(authed-reading)/reading/reading-detail.tsx', 'app/(authed-speaking)/speaking/speaking-behavior.tsx'];
  const receipt = testInfo.outputPath('G-U03-local-native-receipt.json');
  writeFileSync(receipt, JSON.stringify({ admission, identities: [A, B], auth_cookie_changes: false, draft_key: DRAFT_KEY, faults: ['corrupt', 'quota', 'unavailable'], restored_business_writes: 0, mic_calls: micCalls, created_database_rows: [], cleanup: 'Fresh browser context disposed by Playwright; no product/data cleanup required.', source_sha256: Object.fromEntries(sources.map(file => [file, createHash('sha256').update(readFileSync(resolve(process.cwd(), file))).digest('hex')])) }, null, 2));
  await testInfo.attach('G-U03-local-native-receipt', { contentType: 'application/json', path: receipt });
});
