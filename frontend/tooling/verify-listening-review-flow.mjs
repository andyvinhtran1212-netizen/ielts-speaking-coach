// Browser-backed contract for the native, submitted-only Listening review.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const PRODUCTION_BACKEND = 'https://ielts-speaking-coach-production.up.railway.app';
const ATTEMPT_ID = '11111111-1111-4111-8111-111111111113';
const ADMIN_TEST_ID = 'LISTENING-PREVIEW-01';
const FAKE_USER_ID = '00000000-0000-0000-0000-000000000043';
const fakeSession = JSON.stringify({
  access_token: 'listening-review-flow-not-a-real-token', refresh_token: 'x',
  token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: FAKE_USER_ID, email: 'listening-review@local' },
});
const baseReview = {
  attempt_id: ATTEMPT_ID,
  test_id: 'LISTENING-REVIEW-01',
  title: 'Listening <script> fixture',
  status: 'submitted',
  score: 1,
  max_score: 2,
  band_estimate: 5.5,
  band_conversion: [{ band: 4 }, { band: 5 }],
  audio_url: 'data:audio/wav;base64,UklGRg==',
  audio_duration: 90,
  sections: [
    { section_num: 1, theme: 'Introductions', transcript: '**Host:** Welcome.\n\n**Anna:** Thank you.' },
    { section_num: 2, theme: 'Booking', transcript: '**Man:** The old date.\n\n**Woman:** Friday is correct.' },
  ],
  review: [
    {
      q_num: 1, correct: false, user_answer: 'Thursday', expected: 'Friday',
      prompt: 'Choose <img src=x onerror=alert(1)>', transcript_anchor: 1,
      audio_window: { start: 12.5, end: 18, section: 'Section 2' },
      solution: {
        translation_vi: 'Ngày đúng là thứ Sáu.', vocab_focus: 'booking; reschedule',
        paraphrase: 'move the date = reschedule', why_correct: 'The speaker corrects the first date.',
        script: '[M1]\nThe old date — [F1]\n[stress:Friday] is correct. (Q1)',
        trap: 'Self-correction', skills: 'K2, K4',
      },
    },
    {
      q_num: 2, correct: true, user_answer: 'A', expected: 'A',
      prompt: 'Who welcomes Anna?', transcript_anchor: 0,
      audio_window: { start: 2, end: 6, section: 'Section 1' }, solution: {},
    },
  ],
};
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const cors = {
  'access-control-allow-origin': BASE,
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
};

async function launchChromium() {
  try { return await chromium.launch(); } catch (error) {
    const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(localChrome)) {
      return chromium.launch({ executablePath: localChrome });
    }
    throw error;
  }
}

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addInitScript(([key, value]) => {
  try { localStorage.setItem(key, value); } catch (_) {}
}, [storageKey(SB), fakeSession]);
const page = await context.newPage();
const pageErrors = [];
const unhandledProductionRequests = [];
const businessWrites = [];
const reviewReads = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));
page.on('dialog', async (dialog) => dialog.dismiss());

await page.route('**/*', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (request.url().startsWith(BASE) || request.url().startsWith('data:')) return route.continue();
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(request.url())) return route.continue();
  if (request.method() === 'POST' && url.pathname === '/api/analytics/events') {
    return route.fulfill({ status: 204, headers: cors });
  }
  if (request.method() !== 'GET') businessWrites.push(`${request.method()} ${url.pathname}`);
  if (request.method() === 'GET' && url.pathname === '/auth/me') {
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ id: FAKE_USER_ID, display_name: 'Listening reviewer' }), headers: cors,
    });
  }
  const studentMatch = /^\/api\/listening\/tests\/attempts\/([^/]+)\/review$/.exec(url.pathname);
  if (request.method() === 'GET' && studentMatch) {
    const id = decodeURIComponent(studentMatch[1]);
    reviewReads.push(id);
    if (id === 'not-submitted') {
      return route.fulfill({ status: 409, contentType: 'application/json', body: '{"detail":"raw hidden"}', headers: cors });
    }
    if (id === 'sealed') {
      return route.fulfill({ status: 403, contentType: 'application/json', body: '{"detail":"sealed internal detail"}', headers: cors });
    }
    if (id === 'missing') {
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"not found"}', headers: cors });
    }
    if (id === 'broken') {
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"secret stack trace"}', headers: cors });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(baseReview), headers: cors });
  }
  if (request.method() === 'GET' && url.pathname === `/admin/listening/tests/${ADMIN_TEST_ID}/preview`) {
    reviewReads.push(`preview:${ADMIN_TEST_ID}`);
    return route.fulfill({
      status: 200, contentType: 'application/json', headers: cors,
      body: JSON.stringify({
        ...baseReview, preview: true, attempt_id: null, score: null, band_estimate: null,
        review: baseReview.review.map((item) => ({ ...item, correct: false, user_answer: '' })),
      }),
    });
  }
  if (request.url().startsWith(PRODUCTION_BACKEND)) {
    unhandledProductionRequests.push(request.url());
    return route.abort('blockedbyclient');
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}', headers: cors });
});

await page.goto(`${BASE}/listening/review?attempt_id=${ATTEMPT_ID}&from=mini`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Chữa từng câu' }).waitFor();
check('reads the canonical attempt once and preserves the mini-test return',
  reviewReads[0] === ATTEMPT_ID
    && await page.getByRole('link', { name: '← Mini tests' }).getAttribute('href') === '/listening/mini-test');
check('canonical score, band and weakness summary render',
  (await page.locator('.lr-summary').innerText()) === 'Band 5.5 · 1/2'
    && (await page.getByRole('region', { name: 'Kĩ năng cần luyện' }).innerText()).includes('K2'));
check('wrong-answer focus is the student default',
  await page.locator('.lr-card').count() === 1
    && await page.getByRole('button', { name: 'Cần xem lại' }).getAttribute('aria-pressed') === 'true');
check('authored hostile prompt is rendered as text',
  (await page.locator('.lr-card__prompt').innerText()).includes('<img src=x onerror=alert(1)>')
    && await page.locator('.lr-card__prompt img').count() === 0);

await page.locator('audio-player').evaluate((node) => {
  node.seekTo = (seconds) => { window.__listeningReviewSeek = seconds; };
});
await page.getByRole('button', { name: /Section 2 · 0:12–0:18/ }).click();
check('timestamp uses the real audio window and synchronizes transcript',
  await page.evaluate(() => window.__listeningReviewSeek) === 12.5
    && await page.getByRole('tab', { name: 'Section 2' }).getAttribute('aria-selected') === 'true'
    && await page.locator('[data-para="1"]').evaluate((node) => node.classList.contains('lr-src-hl')));

await page.getByRole('button', { name: 'Xem lời giải' }).click();
check('rich solution opens without unsafe HTML injection',
  await page.getByText('Ngày đúng là thứ Sáu.').isVisible()
    && await page.getByText('Self-correction', { exact: true }).isVisible()
    && await page.locator('.lr-card__detail script').count() === 0);

await page.getByRole('button', { name: 'Câu 2 — đúng' }).click();
check('palette jump reveals a card hidden by the active filter',
  await page.locator('#listening-review-q-2').isVisible()
    && await page.getByRole('button', { name: 'Tất cả' }).getAttribute('aria-pressed') === 'true');
check('an empty authored solution preserves the explicit expandable fallback',
  await page.locator('#listening-review-q-2').getByText('Chưa có lời giải chi tiết.', { exact: true }).isVisible()
    && await page.locator('#listening-review-q-2 .lr-card__top').getAttribute('aria-expanded') === 'true');

await page.setViewportSize({ width: 375, height: 812 });
check('mobile review stays within the viewport', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));

await page.goto(`${BASE}/listening/review?admin_test_id=${ADMIN_TEST_ID}`, { waitUntil: 'domcontentloaded' });
await page.getByText('XEM TRƯỚC', { exact: false }).waitFor();
check('admin preview is neutral and scoreless',
  reviewReads.includes(`preview:${ADMIN_TEST_ID}`)
    && await page.locator('.lr-summary').count() === 0
    && await page.locator('.lr-card__verdict').count() === 0
    && await page.locator('.lr-card__ans.is-user').count() === 0
    && await page.locator('.lr-card').count() === 2);

await page.goto(`${BASE}/listening/review?attempt_id=not-submitted`, { waitUntil: 'domcontentloaded' });
await page.locator('.listening-review-next-error[role="alert"]').waitFor();
const notSubmittedText = await page.locator('.listening-review-next-error[role="alert"]').innerText();
check('409 has a friendly submitted-only message and hides backend detail',
  notSubmittedText.includes('chưa nộp') && !notSubmittedText.includes('raw hidden'), notSubmittedText);

await page.goto(`${BASE}/listening/review?attempt_id=sealed`, { waitUntil: 'domcontentloaded' });
await page.locator('.listening-review-next-error[role="alert"]').waitFor();
const sealedText = await page.locator('.listening-review-next-error[role="alert"]').innerText();
check('sealed 403 remains backend-gated with a generic message',
  sealedText.includes('chờ duyệt') && !sealedText.includes('sealed internal detail'), sealedText);

await page.goto(`${BASE}/listening/review?attempt_id=missing`, { waitUntil: 'domcontentloaded' });
await page.getByText('Không tìm thấy bài làm để chữa.').waitFor();
const missingAlerts = await page.locator('.listening-review-next-error[role="alert"]').allInnerTexts();
check('404 maps to an honest empty state', missingAlerts.length === 0, missingAlerts.join(' | '));

await page.goto(`${BASE}/listening/review?attempt_id=broken`, { waitUntil: 'domcontentloaded' });
await page.locator('.listening-review-next-error[role="alert"]').waitFor();
const brokenText = await page.locator('.listening-review-next-error[role="alert"]').innerText();
check('unexpected backend failures stay generic',
  brokenText.includes('Vui lòng thử lại') && !brokenText.includes('secret stack trace'), brokenText);
check('review is read-only and never reaches the production backend',
  businessWrites.length === 0 && unhandledProductionRequests.length === 0,
  businessWrites[0] || unhandledProductionRequests[0] || '');
check('no uncaught browser error', pageErrors.length === 0, pageErrors[0] || '');

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
