// Fixture-backed browser verification for the native Listening Dictation player.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3001';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const userId = '00000000-0000-0000-0000-000000000456';
const session = JSON.stringify({ access_token: 'dictation-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: userId, email: 'dictation@local' } });
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(([key, value]) => {
  localStorage.setItem(key, value);
  // Supported Safari/iOS floor has getRandomValues but may not expose
  // randomUUID. Exercise the completion flow under that exact capability set.
  Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: undefined });
}, [storageKey(SB), session]);
const page = await context.newPage();
const errors = []; const completionPosts = []; const receiptReads = []; const attemptWrites = [];
const attemptId = '00000000-0000-0000-0000-000000000789';
let canonical = null;
let releaseCompletion;
let markCompletionStarted;
const completionStarted = new Promise((resolve) => { markCompletionStarted = resolve; });
page.on('pageerror', (error) => errors.push(String(error)));
await page.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('about:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url); const method = request.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/api/listening/tests/test-1/dictation' && method === 'GET') return json({
    id: 'test-1', test_id: 'LIS-1', title: 'Listening <script> fixture',
    audio_url: 'https://audio.test/file.mp3', audio_duration_seconds: 90,
    sections: [
      { section_num: 1, title: 'Section 1', cue_start: 0, sentences: ['Hello there.', 'The address is Brighton.'], timings: [{ start: 0, end: 3 }, { start: 3, end: 7 }], hints: [[], ['Brighton']] },
      { section_num: 2, title: 'Section 2', cue_start: 7, sentences: ['A final sentence.'], timings: [], hints: [[]] },
    ],
  });
  if (parsed.pathname === '/api/listening/tests/test-1/dictation/attempts/in-progress' && method === 'GET') {
    return json({ attempt: null });
  }
  if (parsed.pathname === '/api/listening/tests/test-1/dictation/attempts' && method === 'POST') {
    attemptWrites.push(JSON.parse(request.postData() || '{}'));
    return json({
      attempt_id: attemptId, test_id: 'test-1', section_num: 1,
      status: 'in_progress', renderer_affinity: null,
      started_at: '2026-08-18T00:00:00Z', answers: [],
      units: [
        { text: 'Hello there.', start: 0, end: 3, hints: [] },
        { text: 'The address is Brighton.', start: 3, end: 7, hints: ['Brighton'] },
      ],
    });
  }
  if (parsed.pathname === `/api/listening/tests/dictation/attempts/${attemptId}/renderer-affinity` && method === 'POST') {
    return json({ attempt_id: attemptId, renderer_affinity: 'next' });
  }
  if (parsed.pathname.startsWith(`/api/listening/tests/dictation/attempts/${attemptId}/sentences/`) && method === 'POST') {
    const sentenceIdx = Number(parsed.pathname.split('/').at(-1));
    if (sentenceIdx === 0) return json({ score: 1, is_correct: true, correct_words: 2, total_words: 2, diff: [{ op: 'match', actual: 'Hello' }, { op: 'match', actual: 'there.' }] });
    return json({ score: .8, is_correct: false, correct_words: 4, total_words: 5, diff: [{ op: 'match', actual: 'The' }, { op: 'match', actual: 'address' }, { op: 'match', actual: 'is' }, { op: 'wrong', actual: 'bright', expected: 'Brighton.' }] });
  }
  if (parsed.pathname.startsWith('/api/listening/tests/dictation/session/by-request/') && method === 'GET') {
    receiptReads.push(parsed.pathname);
    return canonical ? json(canonical) : json({ detail: 'not found' }, 404);
  }
  if (parsed.pathname === '/api/listening/tests/dictation/session' && method === 'POST') {
    const body = JSON.parse(request.postData() || '{}'); completionPosts.push(body);
    canonical = {
      session_id: 'session-1', client_request_id: body.client_request_id,
      section_num: 1, total_time_seconds: 61, total_sentences: 2, correct_count: 1,
      accuracy: .9, total_words: 7, correct_words: 6,
      error_trends: { op_counts: { miss: 0, wrong: 1, extra: 0 }, missed: {}, wrong: { 'brighton.': 1 } },
      results: [
        { sentence_idx: 0, score: 1, correct_words: 2, total_words: 2, user_text: 'Hello there.', listen_count: 0, time_seconds: 4, diff: [{ op: 'match', actual: 'Hello' }, { op: 'match', actual: 'there.' }] },
        { sentence_idx: 1, score: .8, correct_words: 4, total_words: 5, user_text: 'The address is bright.', listen_count: 0, time_seconds: 6, diff: [{ op: 'wrong', actual: 'bright', expected: 'Brighton.' }] },
      ],
    };
    // Simulate commit success + lost HTTP acknowledgement.
    markCompletionStarted();
    await new Promise((resolve) => { releaseCompletion = resolve; });
    return route.abort('connectionreset');
  }
  if (parsed.pathname === '/api/listening/tests/dictation/flag' && method === 'POST') return json({ id: 'flag-1', status: 'new' });
  return json({ detail: `unhandled fixture ${method} ${parsed.pathname}` }, 404);
});

await page.goto(`${BASE}/listening/dictation/session?test_id=test-1`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Chọn section' }).waitFor();
check('auth và multi-section boot vào picker', await page.getByRole('button', { name: /Section 1/ }).count() === 1);
check('authored title được React escape', await page.getByRole('heading', { name: 'Chép chính tả · Listening <script> fixture' }).count() === 1 && await page.locator('script').filter({ hasText: 'fixture' }).count() === 0);
await page.getByRole('button', { name: /Section 1/ }).click();
await page.getByLabel('Câu trả lời câu 1').fill('Hello there.');
await page.getByRole('button', { name: 'Kiểm tra câu' }).click();
await page.getByText('100% · 2/2 từ').waitFor();
await page.getByRole('button', { name: 'Câu tiếp theo →' }).click();
check('timing và proper-noun hint đổi theo câu', await page.getByText('Brighton', { exact: true }).count() === 1 && await page.locator('audio-player').getAttribute('segment-start') === '3');
await page.getByLabel('Câu trả lời câu 2').fill('The address is bright.');
await page.getByRole('button', { name: 'Kiểm tra câu' }).click();
await page.getByText('80% · 4/5 từ').waitFor();
await page.getByRole('button', { name: 'Xem tổng kết' }).click();
await page.getByText('Đang xác nhận…', { exact: true }).waitFor();
check('lost ACK không thể xoá receipt bằng làm lại khi đang xác nhận', await page.getByRole('button', { name: 'Làm lại section' }).isDisabled());
// `saving` is rendered before the POST reaches Playwright's route handler.
// Wait for the fixture to actually hold the acknowledgement before releasing
// it; otherwise a fast assertion can race the request and leave it suspended.
await completionStarted;
releaseCompletion();
await page.getByText('✓ Đã lưu & xác nhận', { exact: true }).waitFor();
check('mất ACK được read-back tự động bằng đúng receipt', completionPosts.length === 1 && receiptReads.length >= 2 && canonical?.client_request_id === completionPosts[0].client_request_id);
check('attempt mới claim Next trước khi làm bài', attemptWrites.length === 1 && attemptWrites[0].renderer_affinity_protocol === 'claim-v1');
check('payload hoàn tất đủ coverage, attempt và receipt UUID', completionPosts[0].attempt_id === attemptId && completionPosts[0].sentences.length === 2 && /^[0-9a-f-]{36}$/i.test(completionPosts[0].client_request_id));
check('summary dùng canonical report', await page.getByText('90%', { exact: true }).count() === 1 && await page.getByText('1/2', { exact: true }).count() === 1 && await page.getByText('6/7', { exact: true }).count() === 1);
check('mobile không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await page.getByRole('button', { name: '⚑ Báo lỗi' }).first().click();
await page.getByRole('button', { name: 'Transcript sai' }).click();
await page.getByRole('button', { name: 'Gửi báo lỗi' }).click();
await page.getByText('✓ Đã báo lỗi', { exact: true }).waitFor();
check('báo lỗi từng câu hoạt động', await page.getByText('✓ Đã báo lỗi', { exact: true }).count() === 1);
await page.setViewportSize({ width: 1440, height: 900 });
check('desktop không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
check('không có lỗi JS', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = checks.filter((item) => !item.ok);
console.log(`\nListening Dictation native flow: ${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exitCode = 1;
