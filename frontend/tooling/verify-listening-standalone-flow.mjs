// Browser-backed contract for native standalone Listening Gist / T-F / MCQ.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const CONTENT_ID = '11111111-1111-4111-8111-111111111120';
const SECOND_CONTENT_ID = '11111111-1111-4111-8111-111111111121';
const FAKE_USER_ID = '00000000-0000-0000-0000-000000000044';
const fakeSession = JSON.stringify({
  access_token: 'listening-standalone-not-a-real-token', refresh_token: 'x',
  token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: FAKE_USER_ID, email: 'listening-standalone@local' },
});
const content = {
  id: CONTENT_ID, title: 'Travel <script>alert(1)</script>',
  audio_signed_url: 'data:audio/wav;base64,UklGRg==', audio_duration_seconds: 90,
  transcript: 'SECRET TRANSCRIPT MUST BE IGNORED BY THE CLIENT',
};
const exercises = {
  gist: { id: 'exercise-gist', content_id: CONTENT_ID, exercise_type: 'gist', payload: { prompt_text: 'Summarise <b>the trip</b>.' } },
  true_false: { id: 'exercise-tf', content_id: CONTENT_ID, exercise_type: 'true_false', payload: { statements: [
    { idx: 0, text: 'The speaker travels by train.' }, { idx: 1, text: 'The ticket costs <img src=x>.' },
  ] } },
  mcq: { id: 'exercise-mcq', content_id: CONTENT_ID, exercise_type: 'mcq', payload: { questions: [
    { idx: 0, stem: 'Where does the speaker go?', options: ['London', 'Paris', '<svg onload=alert(1)>', 'Rome'] },
    { idx: 1, stem: 'When?', options: ['Monday', 'Tuesday', 'Wednesday', 'Friday'] },
  ] } },
};
const results = [];
const writes = [];
const contentReads = [];
const pageErrors = [];
const unhandledProduction = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const cors = {
  'access-control-allow-origin': BASE,
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,x-request-id',
};

async function launchChromium() {
  try { return await chromium.launch(); } catch (error) {
    const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(localChrome)) return chromium.launch({ executablePath: localChrome });
    throw error;
  }
}

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addInitScript(([key, value]) => {
  try { localStorage.setItem(key, value); } catch (_) {}
}, [storageKey(SB), fakeSession]);
const page = await context.newPage();
page.on('pageerror', (error) => pageErrors.push(String(error)));
page.on('dialog', async (dialog) => dialog.dismiss());

await page.route('**/*', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (request.url().startsWith(BASE) || request.url().startsWith('data:')) return route.continue();
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(request.url())) return route.continue();
  if (request.method() === 'POST' && url.pathname === '/api/analytics/events') return route.fulfill({ status: 204, headers: cors });
  if (request.method() === 'GET' && url.pathname === '/auth/me') {
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ id: FAKE_USER_ID }) });
  }
  const contentMatch = /^\/api\/listening\/content\/([^/]+)$/.exec(url.pathname);
  if (request.method() === 'GET' && contentMatch) {
    const id = decodeURIComponent(contentMatch[1]);
    contentReads.push(id);
    if (id === 'missing') return route.fulfill({ status: 404, contentType: 'application/json', headers: cors, body: '{"detail":"secret content detail"}' });
    return route.fulfill({
      status: 200, contentType: 'application/json', headers: cors,
      body: JSON.stringify({ ...content, id, title: id === CONTENT_ID ? content.title : 'Second content' }),
    });
  }
  if (request.method() === 'GET' && url.pathname === '/api/listening/exercises') {
    const id = url.searchParams.get('content_id');
    const mode = url.searchParams.get('exercise_type');
    const item = exercises[mode];
    const rows = id === 'empty' || !item ? [] : [{ ...item, content_id: id }];
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ exercises: rows }) });
  }
  if (request.method() === 'POST' && url.pathname === '/api/listening/attempts') {
    const body = request.postDataJSON();
    writes.push(body);
    const common = { attempt_id: `attempt-${body.mode}`, exercise_id: body.exercise_id, mode: body.mode, is_first_attempt: true };
    const response = body.mode === 'gist'
      ? { ...common, score: 76, is_correct: false, ai_used: false, feedback: 'Keep the main idea.', keyword_matches: ['trip <safe>'] }
      : body.mode === 'true_false'
        ? { ...common, score: 0.5, correct: 1, total: 2, is_correct: false, details: [
            { idx: 0, actual: body.answers[0], expected: 'T', is_correct: true },
            { idx: 1, actual: body.answers[1], expected: 'F', is_correct: false },
          ] }
        : { ...common, score: 0.5, correct: 1, total: 2, is_correct: false, details: [
            { idx: 0, actual_idx: body.mcq_answers[0], is_correct: true },
            { idx: 1, actual_idx: body.mcq_answers[1], is_correct: false },
          ] };
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(response) });
  }
  if (request.method() !== 'GET') writes.push(`${request.method()} ${url.pathname}`);
  if (request.url().startsWith('https://ielts-speaking-coach-production.up.railway.app')) {
    unhandledProduction.push(request.url());
    return route.abort('blockedbyclient');
  }
  return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{}' });
});

await page.goto(`${BASE}/listening/mcq?content_id=${CONTENT_ID}`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: /Trắc nghiệm/ }).waitFor();
await page.getByText('Where does the speaker go?').waitFor();
check('MCQ reads canonical identity and renders authored text safely',
  contentReads.includes(CONTENT_ID)
    && (await page.locator('.lse-header h1').innerText()).includes('Travel <script>alert(1)</script>')
    && await page.locator('.lse-header script, .lse-items svg').count() === 0);
await page.locator('audio-player').dispatchEvent('av-audio-play');
await page.locator('.lse-items > li').nth(0).getByText('A. London').click();
await page.locator('.lse-items > li').nth(1).getByText('B. Tuesday').click();
await page.getByRole('button', { name: 'Kiểm tra' }).click();
await page.getByText('50% · 1/2').waitFor();
check('MCQ submits exact indices, listen count and paints per-question result',
  writes[0]?.mode === 'mcq' && JSON.stringify(writes[0]?.mcq_answers) === '[0,1]'
    && writes[0]?.listen_count === 1 && await page.getByText('✗ Sai — bạn chọn B').isVisible());
await page.getByRole('button', { name: 'Thử lại' }).click();
check('MCQ reset clears controlled choices', await page.locator('input[type="radio"]:checked').count() === 0);
const secondRead = page.waitForResponse((response) => response.request().method() === 'GET'
  && new URL(response.url()).pathname.endsWith(`/api/listening/content/${SECOND_CONTENT_ID}`));
await page.evaluate((id) => history.pushState({}, '', `/listening/mcq?content_id=${id}`), SECOND_CONTENT_ID);
await secondRead;
await page.getByRole('heading', { name: /Second content/ }).waitFor();
check('soft navigation remounts against the new canonical content identity',
  contentReads.includes(SECOND_CONTENT_ID) && await page.locator('input[type="radio"]:checked').count() === 0);

await page.goto(`${BASE}/listening/tf?content_id=${CONTENT_ID}`, { waitUntil: 'domcontentloaded' });
await page.getByText('The speaker travels by train.').waitFor();
await page.locator('.lse-items > li').nth(0).getByText('Đúng (T)').click();
await page.locator('.lse-items > li').nth(1).getByText('Không có (NG)').click();
await page.getByRole('button', { name: 'Kiểm tra' }).click();
await page.getByText('50% · 1/2').waitFor();
check('T/F submits canonical values and shows server truth after submit',
  writes[1]?.mode === 'true_false' && JSON.stringify(writes[1]?.answers) === '["T","NG"]'
    && await page.getByText('✗ Sai — bạn chọn NG · đáp án F').isVisible());

await page.goto(`${BASE}/listening/gist?content_id=${CONTENT_ID}`, { waitUntil: 'domcontentloaded' });
await page.getByText('Summarise <b>the trip</b>.').waitFor();
await page.getByLabel('Câu trả lời của bạn').fill('The speaker describes a trip.');
await page.getByRole('button', { name: 'Kiểm tra' }).click();
await page.getByText('76 / 100 · keyword fallback').waitFor();
check('Gist keeps authored and grader prose as text and explains first-attempt truth',
  writes[2]?.mode === 'gist' && writes[2]?.user_transcript === 'The speaker describes a trip.'
    && await page.getByText('trip <safe>', { exact: true }).isVisible()
    && await page.locator('.lse-feedback script, .lse-feedback safe').count() === 0
    && (await page.locator('.lse-feedback > span').innerText()).toLowerCase().includes('lần đầu'));

const beforeBare = contentReads.length;
await page.goto(`${BASE}/listening/mcq`, { waitUntil: 'domcontentloaded' });
await page.getByText('Chưa chọn bài nghe.').waitFor();
check('bare route is an honest picker state and performs no content read', contentReads.length === beforeBare);

await page.goto(`${BASE}/listening/gist?content_id=empty`, { waitUntil: 'domcontentloaded' });
await page.getByText('Bài này chưa có dạng Nghe ý chính.').waitFor();
check('published content with no matching exercise is distinct from load failure', await page.getByText('Chọn bài khác').isVisible());

await page.goto(`${BASE}/listening/tf?content_id=missing`, { waitUntil: 'domcontentloaded' });
await page.locator('.lse-state.is-error[role="alert"]').waitFor();
const missingText = await page.locator('.lse-state.is-error').innerText();
check('404 is friendly and does not expose backend detail', missingText.includes('không tồn tại') && !missingText.includes('secret content detail'));

await page.setViewportSize({ width: 375, height: 812 });
await page.goto(`${BASE}/listening/mcq?content_id=${CONTENT_ID}`, { waitUntil: 'domcontentloaded' });
await page.getByText('Where does the speaker go?').waitFor();
check('mobile exercise stays within viewport', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
check('only the three intended attempt writes occurred', writes.filter((row) => typeof row === 'object').length === 3);
check('no unhandled production egress or browser error', unhandledProduction.length === 0 && pageErrors.length === 0, unhandledProduction[0] || pageErrors[0] || '');

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
