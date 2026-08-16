// Browser-backed contract for the native standalone Listening Dictation route.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const CONTENT_ID = '11111111-1111-4111-8111-111111111122';
const SECOND_CONTENT_ID = '11111111-1111-4111-8111-111111111123';
const FAKE_USER_ID = '00000000-0000-0000-0000-000000000045';
const EXERCISE_ID = '22222222-2222-4222-8222-222222222220';
const fakeSession = JSON.stringify({
  access_token: 'listening-dictation-not-a-real-token', refresh_token: 'x',
  token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: FAKE_USER_ID, email: 'listening-dictation@local' },
});
const bootFor = (contentId) => ({
  content: {
    id: contentId,
    title: contentId === CONTENT_ID ? 'Travel <script>alert(1)</script>' : 'Second dictation',
    audio_signed_url: `https://audio.test/${contentId}.mp3`,
    audio_duration_seconds: 30,
    accent_tag: 'uk_rp',
    cefr_level: 'B1',
    ielts_section: 1,
    topic_tags: ['travel <safe>'],
  },
  exercises: [{
    id: contentId === CONTENT_ID ? EXERCISE_ID : `${EXERCISE_ID}-second`,
    content_id: contentId,
    exercise_type: 'dictation',
    segments: [
      { idx: 0, start_sec: 1, end_sec: 4 },
      { idx: 1, start_sec: 5, end_sec: 8 },
    ],
  }],
});
const resultFor = (body, ordinal) => {
  if (body.segment_idx === 0 && ordinal === 0) {
    return {
      attempt_id: 'attempt-0-first', exercise_id: body.exercise_id,
      segment_idx: 0, mode: 'dictation', is_first_attempt: true,
      score: 2 / 3, correct_words: 2, total_words: 3, is_correct: false,
      diff: [
        { op: 'match', actual: 'Good', expected: 'Good' },
        { op: 'wrong', actual: 'evening', expected: '<morning>' },
        { op: 'match', actual: 'Andy.', expected: 'Andy.' },
      ],
    };
  }
  if (body.segment_idx === 0) {
    return {
      attempt_id: 'attempt-0-retry', exercise_id: body.exercise_id,
      segment_idx: 0, mode: 'dictation', is_first_attempt: false,
      score: 1, correct_words: 3, total_words: 3, is_correct: true,
      diff: [
        { op: 'match', actual: 'Good', expected: 'Good' },
        { op: 'match', actual: '<morning>', expected: '<morning>' },
        { op: 'match', actual: 'Andy.', expected: 'Andy.' },
      ],
    };
  }
  return {
    attempt_id: 'attempt-1-first', exercise_id: body.exercise_id,
    segment_idx: 1, mode: 'dictation', is_first_attempt: true,
    score: 1, correct_words: 2, total_words: 2, is_correct: true,
    diff: [
      { op: 'match', actual: 'Thank', expected: 'Thank' },
      { op: 'match', actual: 'you.', expected: 'you.' },
    ],
  };
};

const results = [];
const writes = [];
const bootReads = [];
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
page.on('pageerror', (error) => pageErrors.push(String(error)));
page.on('dialog', async (dialog) => dialog.dismiss());

await page.route('**/*', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (request.url().startsWith(BASE) || request.url().startsWith('data:')) return route.continue();
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(request.url())) return route.continue();
  if (url.hostname === 'audio.test') {
    return route.fulfill({ status: 200, contentType: 'audio/mpeg', headers: cors, body: '' });
  }
  if (request.method() === 'POST' && url.pathname === '/api/analytics/events') {
    return route.fulfill({ status: 204, headers: cors });
  }
  if (request.method() === 'GET' && url.pathname === '/auth/me') {
    return route.fulfill({
      status: 200, contentType: 'application/json', headers: cors,
      body: JSON.stringify({ id: FAKE_USER_ID }),
    });
  }
  const bootMatch = /^\/api\/listening\/dictation\/([^/]+)\/boot$/.exec(url.pathname);
  if (request.method() === 'GET' && bootMatch) {
    const id = decodeURIComponent(bootMatch[1]);
    bootReads.push(id);
    if (id === 'missing') {
      return route.fulfill({
        status: 404, contentType: 'application/json', headers: cors,
        body: '{"detail":"secret dictation detail"}',
      });
    }
    const body = id === 'empty'
      ? { ...bootFor(id), exercises: [] }
      : bootFor(id);
    return route.fulfill({
      status: 200, contentType: 'application/json', headers: cors,
      body: JSON.stringify(body),
    });
  }
  if (request.method() === 'GET' && /^\/api\/listening\/content\/[^/]+$/.test(url.pathname)) {
    return route.fulfill({
      status: 200, contentType: 'application/json', headers: cors,
      body: JSON.stringify({ audio_signed_url: 'https://audio.test/refetched.mp3' }),
    });
  }
  if (request.method() === 'POST' && url.pathname === '/api/listening/attempts') {
    const body = request.postDataJSON();
    const ordinal = writes.filter((entry) => entry.segment_idx === body.segment_idx).length;
    writes.push(body);
    return route.fulfill({
      status: 200, contentType: 'application/json', headers: cors,
      body: JSON.stringify(resultFor(body, ordinal)),
    });
  }
  if (request.method() !== 'GET') writes.push(`${request.method()} ${url.pathname}`);
  if (request.url().startsWith('https://ielts-speaking-coach-production.up.railway.app')) {
    unhandledProduction.push(request.url());
    return route.abort('blockedbyclient');
  }
  return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{}' });
});

await page.goto(`${BASE}/listening/dictation?content_id=${CONTENT_ID}`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: /Chép chính tả/ }).waitFor();
await page.getByText('CÂU ĐANG LÀM').waitFor();
const bootPayload = bootFor(CONTENT_ID);
check('boot fixture and rendered ready state contain no answer transcript',
  !JSON.stringify(bootPayload).includes('SECRET')
    && !('transcript' in bootPayload.content)
    && bootPayload.exercises[0].segments.every((segment) => !('transcript' in segment))
    && !(await page.locator('.lse-shell').innerText()).includes('<morning>'));
const titleText = await page.locator('.lse-header h1').innerText();
const metadataText = await page.locator('.lse-dictation-meta').innerText();
const authoredElementCount = await page.locator('.lse-header script, .lse-dictation-meta safe').count();
check('authored metadata is rendered as text',
  titleText.includes('Travel <script>alert(1)</script>')
    && metadataText.toLowerCase().includes('travel <safe>')
    && authoredElementCount === 0,
  JSON.stringify({ titleText, metadataText, authoredElementCount }));
const player = page.locator('audio-player');
check('first segment owns the exact clip and looping attributes',
  await player.getAttribute('segment-start') === '1'
    && await player.getAttribute('segment-end') === '4'
    && await player.getAttribute('auto-loop') === 'true');
await player.dispatchEvent('av-audio-play');
await player.dispatchEvent('av-audio-play');
await page.getByLabel('Câu bạn nghe được').fill('Good evening Andy.');
await page.getByRole('button', { name: 'Kiểm tra' }).click();
await page.getByText('67% · 2/3').waitFor();
check('first submit carries exact identity, answer and listen count once',
  writes.length === 1
    && writes[0]?.exercise_id === EXERCISE_ID
    && writes[0]?.content_id === CONTENT_ID
    && writes[0]?.mode === 'dictation'
    && writes[0]?.segment_idx === 0
    && writes[0]?.user_transcript === 'Good evening Andy.'
    && writes[0]?.listen_count === 2);
const firstDiffText = await page.locator('.lse-dictation-diff').innerText();
const diffAuthoredElementCount = await page.locator('.lse-dictation-diff morning, .lse-dictation-diff script').count();
check('server diff reveals the reference only after grading and stays React-safe',
  firstDiffText.includes('<morning>')
    && diffAuthoredElementCount === 0
    && firstDiffText.toLowerCase().includes('lần đầu'),
  JSON.stringify({ firstDiffText, diffAuthoredElementCount }));

await page.getByRole('button', { name: 'Thử lại câu này' }).click();
await page.getByLabel('Câu bạn nghe được').fill('Good <morning> Andy.');
await page.getByRole('button', { name: 'Kiểm tra' }).click();
await page.getByText('100% · 3/3').waitFor();
const retryDiffText = await page.locator('.lse-dictation-diff').innerText();
check('retry is one explicit new write and preserves non-first-attempt truth',
  writes.length === 2
    && writes[1]?.segment_idx === 0
    && retryDiffText.toLowerCase().includes('lần làm thêm'),
  JSON.stringify({ writes: writes.length, segmentIdx: writes[1]?.segment_idx, retryDiffText }));

await page.getByRole('button', { name: 'Câu tiếp theo →' }).click();
await page.getByText('2 / 2').waitFor();
check('advance resets the controlled answer and exact audio clip',
  await page.getByLabel('Câu bạn nghe được').inputValue() === ''
    && await player.getAttribute('segment-start') === '5'
    && await player.getAttribute('segment-end') === '8');
await page.getByLabel('Câu bạn nghe được').fill('Thank you.');
await page.getByRole('button', { name: 'Kiểm tra' }).click();
await page.getByText('100% · 2/2').waitFor();
await page.getByRole('button', { name: 'Xem kết quả' }).click();
await page.getByRole('heading', { name: 'Bạn đã làm đủ 2 câu' }).waitFor();
check('completion summarizes the current run and distinguishes official attempts',
  (await page.locator('.lse-dictation-score').innerText()).includes('100%')
    && (await page.locator('.lse-dictation-official').innerText()).includes('1/2 câu là lần đầu'));
await page.getByRole('tab', { name: 'Bản gỡ băng đầy đủ' }).click();
check('full transcript is reconstructed from validated graded diffs only',
  (await page.locator('.lse-dictation-transcript').innerText()).includes('Good <morning> Andy.')
    && (await page.locator('.lse-dictation-transcript').innerText()).includes('Thank you.')
    && await page.locator('.lse-dictation-transcript morning').count() === 0);

const secondRead = page.waitForResponse((response) => response.request().method() === 'GET'
  && new URL(response.url()).pathname.endsWith(`/api/listening/dictation/${SECOND_CONTENT_ID}/boot`));
await page.evaluate((id) => history.pushState({}, '', `/listening/dictation?content_id=${id}`), SECOND_CONTENT_ID);
await secondRead;
await page.getByRole('heading', { name: /Second dictation/ }).waitFor();
check('soft navigation remounts with a fresh canonical content identity',
  bootReads.includes(SECOND_CONTENT_ID)
    && await page.getByLabel('Câu bạn nghe được').inputValue() === ''
    && (await page.getByText('1 / 2').count()) >= 1);

const beforeBare = bootReads.length;
await page.goto(`${BASE}/listening/dictation`, { waitUntil: 'domcontentloaded' });
await page.getByText('Chưa chọn bài nghe.').waitFor();
check('bare route is an honest picker and performs no boot read', bootReads.length === beforeBare);

await page.goto(`${BASE}/listening/dictation?content_id=empty`, { waitUntil: 'domcontentloaded' });
await page.getByText('Bài này chưa được phân câu.').waitFor();
check('published content without dictation segments has a distinct empty state',
  await page.getByText('Chọn bài khác').isVisible());

await page.goto(`${BASE}/listening/dictation?content_id=missing`, { waitUntil: 'domcontentloaded' });
await page.locator('.lse-state.is-error[role="alert"]').waitFor();
const missingText = await page.locator('.lse-state.is-error').innerText();
check('404 is friendly and does not expose backend detail',
  missingText.includes('không tồn tại') && !missingText.includes('secret dictation detail'));

await page.setViewportSize({ width: 375, height: 812 });
await page.goto(`${BASE}/listening/dictation?content_id=${CONTENT_ID}`, { waitUntil: 'domcontentloaded' });
await page.getByText('CÂU ĐANG LÀM').waitFor();
check('mobile dictation stays inside the viewport',
  await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
check('only the three intended attempt writes occurred',
  writes.filter((row) => typeof row === 'object').length === 3);
check('no production egress or browser error escaped the verifier',
  unhandledProduction.length === 0 && pageErrors.length === 0,
  unhandledProduction[0] || pageErrors[0] || '');

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
