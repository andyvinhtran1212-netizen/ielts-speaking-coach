// Hermetic Next-route regression: no shared backend, real native audio playback.
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:3034';
const SB = process.env.SUPABASE_URL || 'https://example.supabase.co';
const user = { id: '00000000-0000-0000-0000-000000000182', email: 'mock-ui-fixture@local', role: 'admin' };
const session = JSON.stringify({ access_token: 'mock-ui-not-real', refresh_token: 'mock-ui-not-real', expires_at: Math.floor(Date.now() / 1000) + 3600, user });
const results = [];
const check = (name, ok, evidence = {}) => { results.push({ name, ok, evidence }); assert.ok(ok, name); console.log(`PASS ${name}`); };
const wav = Buffer.alloc(44 + 8000 * 5 * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
const review = { attempt_id: 'mock-ui-attempt', test_id: 'mock-ui-listening', title: 'Bounded playback fixture', status: 'submitted', score: 0, max_score: 2, band_estimate: 4, audio_url: `${BASE}/mock-ui-fixture.wav`, audio_duration: 5, sections: [{ section_num: 1, transcript: 'First answer.\n\nSecond answer.' }], review: [
  { q_num: 1, correct: false, user_answer: 'X', expected: 'A', prompt: 'First answer', audio_window: { start: 0.2, end: 0.8, section: 'Section 1' }, transcript_anchor: 0, solution: {} },
  { q_num: 2, correct: false, user_answer: 'X', expected: 'B', prompt: 'Second answer', audio_window: { start: 1.2, end: 1.9, section: 'Section 1' }, transcript_anchor: 1, solution: {} },
] };
let mutationStatus = 409;
let listFailure = false;
let paperStatus = 'published';
let patchCount = 0;
const requests = [];
const unexpected = [];
let browser;
let page;
const browserErrors = [];
try { browser = await chromium.launch(); } catch (error) {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (process.platform !== 'darwin' || !existsSync(chrome)) throw error;
  browser = await chromium.launch({ executablePath: chrome });
}
try {
  const context = await browser.newContext({ viewport: { width: 1180, height: 900 } });
  await context.addInitScript(([key, value]) => {
    localStorage.setItem(key, value);
    const NativeAudio = window.Audio;
    window.__mockUiPauses = [];
    window.Audio = function (...args) {
      const media = new NativeAudio(...args); window.__mockUiMedia = media;
      const nativePause = media.pause;
      media.pause = function () { window.__mockUiPauses.push({ position: media.currentTime, rate: media.playbackRate }); return nativePause.call(media); };
      return media;
    };
    window.Audio.prototype = NativeAudio.prototype;
  }, [storageKey(SB), session]);
  await context.route('**/*', async (route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    if (path === '/mock-ui-fixture.wav') {
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers().range || '');
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
      const body = wav.subarray(start, end + 1);
      return route.fulfill({ status: range ? 206 : 200, contentType: 'audio/wav', headers: { 'accept-ranges': 'bytes', 'content-length': String(body.length), ...(range ? { 'content-range': `bytes ${start}-${end}/${wav.length}` } : {}) }, body });
    }
    if (request.url().startsWith(`${BASE}/`)) return route.continue();
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    requests.push({ path, method: request.method() });
    if (path === '/auth/me' || path === '/auth/v1/user') return json(user);
    if (path === '/admin/cohorts') return json({ cohorts: [{ id: 'class-1', name: 'Fixture class' }] });
    if (path === '/admin/mock-exams') return json({ exams: [] });
    if (path === '/admin/exam-content/page') {
      if (listFailure) return json({ detail: 'Fixture list unavailable' }, 503);
      return json({ items: [{ id: 'paper-1', kind: 'reading', code: 'PAPER-1', title: 'Fixture paper', status: paperStatus, publish_ready: true, cohort_ids: ['class-1'], mock_exams: [], is_public: false }], total: 1, total_complete: true, levels: [], levels_complete: true, failed_level_kinds: [], failed_kinds: [] });
    }
    if (path === '/admin/exam-content/reading/paper-1/status' && request.method() === 'PATCH') {
      patchCount += 1;
      if (mutationStatus !== 200) return json({ detail: `Fixture write rejected ${mutationStatus}` }, mutationStatus);
      paperStatus = request.postDataJSON().status; return json({ status: paperStatus });
    }
    if (path === '/api/listening/tests/attempts/mock-ui-attempt/review') return json(review);
    if (path.startsWith('/api/feedback/') || path.startsWith('/api/analytics/')) return json({});
    unexpected.push(request.url()); return route.abort();
  });
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => browserErrors.push(String(error)));
  await page.goto(`${BASE}/admin/mock-exams`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: /Kho đề/ }).click();
  await page.getByText('PAPER-1', { exact: true }).waitFor();
  await page.locator('#test-library summary').click();
  await page.getByRole('button', { name: 'Về draft' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận' }).click();
  await page.getByRole('alert').filter({ hasText: 'Fixture write rejected 409' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('#test-library .mex-dialog-actions button')?.disabled);
  check('409 failure survives GET 200 with published canonical badge', await page.locator('#test-library .mex-pill.is-published').count() === 1);
  check('mutation failure and dismiss action are accessible inside the dialog', await page.getByRole('dialog').getByRole('alert').isVisible());
  await page.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click();
  await page.getByRole('button', { name: 'Tải lại', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Fixture write rejected 409' }).waitFor();
  check('manual list refresh preserves the mutation failure', true);
  await page.getByRole('button', { name: 'Về draft' }).click();
  mutationStatus = 503; listFailure = true;
  await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận' }).click();
  await page.getByRole('alert').filter({ hasText: 'Fixture write rejected 503' }).waitFor();
  await page.getByRole('alert').filter({ hasText: 'Fixture list unavailable' }).waitFor();
  check('503 write plus failed reconciliation keep both errors and old state', await page.locator('#test-library .mex-pill.is-published').count() === 1);
  mutationStatus = 200; listFailure = false;
  await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận' }).click();
  await page.locator('#test-library .mex-pill.is-draft').waitFor();
  check('successful retry clears failure and confirms server draft', await page.locator('#test-library [role="alert"]').count() === 0 && patchCount === 3);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: /Kho đề/ }).click();
  await page.locator('#test-library .mex-pill.is-draft').waitFor();
  check('full reload matches immediate mutation state', true);

  await page.goto(`${BASE}/listening/review?attempt_id=mock-ui-attempt`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof document.querySelector('audio-player')?.getCurrentTime === 'function' && window.__mockUiMedia?.readyState >= 1 && window.__mockUiMedia.seekable.length && window.__mockUiMedia.seekable.end(0) >= 4.9);
  check('native WAV fixture has a real five-second seekable range', true);
  for (const rate of [0.75, 1, 1.25, 1.5]) {
    await page.evaluate((value) => { window.__mockUiMedia.playbackRate = value; }, rate);
    await page.locator('#listening-review-q-1').getByRole('button', { name: /Nghe đoạn/ }).click();
    await page.waitForFunction(() => window.__mockUiMedia.paused && Math.abs(window.__mockUiMedia.currentTime - 0.8) < 0.03, null, { timeout: 5000 });
    const evidence = await page.evaluate(() => ({ paused: window.__mockUiMedia.paused, position: window.__mockUiMedia.currentTime, rate: window.__mockUiMedia.playbackRate, pausePosition: window.__mockUiPauses.at(-1)?.position }));
    check(`real native audio stops at clip end (${rate}x)`, evidence.paused && Math.abs(evidence.position - 0.8) < 0.03 && Math.abs(evidence.pausePosition - 0.8) <= 0.12, evidence);
  }
  await page.evaluate(() => document.querySelector('audio-player').seekTo(3));
  await page.waitForFunction(() => window.__mockUiMedia.paused && Math.abs(window.__mockUiMedia.currentTime - 0.8) < 0.03);
  check('seek past bound clamps and pauses', true);
  await page.locator('#listening-review-q-1').getByRole('button', { name: /Nghe đoạn/ }).click();
  await page.locator('#listening-review-q-2').getByRole('button', { name: /Nghe đoạn/ }).click();
  await page.waitForFunction(() => window.__mockUiMedia.paused && Math.abs(window.__mockUiMedia.currentTime - 1.9) < 0.03);
  check('rapid clip switch uses only latest endpoint', true);
  await page.locator('#listening-review-q-1').getByRole('button', { name: /Nghe tiếp từ/ }).click();
  await page.waitForFunction(() => window.__mockUiMedia.currentTime > 1 && !window.__mockUiMedia.paused);
  check('explicit continuous mode crosses former end', await page.locator('audio-player').getAttribute('segment-end') === null);
  await page.evaluate(() => { document.querySelector('audio-player').remove(); });
  check('unmount stops the native media', await page.evaluate(() => window.__mockUiMedia.paused));
  check('synthetic API host and auth used exclusively', unexpected.length === 0, { unexpected, requestCount: requests.length });
  if (process.env.MOCK_UI_EVIDENCE_OUT) writeFileSync(process.env.MOCK_UI_EVIDENCE_OUT, JSON.stringify({ base: BASE, syntheticSupabaseUrl: SB, results, requests }, null, 2) + '\n');
} catch (error) {
  console.error(JSON.stringify({ requests, unexpected, browserErrors, pageUrl: page?.url(), media: page ? await page.evaluate(() => {
    const media = window.__mockUiMedia; const player = document.querySelector('audio-player');
    return media ? { paused: media.paused, position: media.currentTime, duration: media.duration, seekable: Array.from({length: media.seekable.length}, (_,i) => [media.seekable.start(i),media.seekable.end(i)]), readyState: media.readyState, networkState: media.networkState, error: media.error?.message, src: media.currentSrc, start: player?.getAttribute('segment-start'), end: player?.getAttribute('segment-end'), pauses: window.__mockUiPauses, segmentTimer: player?._segmentTimer } : null;
  }) : null, body: page ? (await page.locator('body').innerText()).slice(0, 1600) : '' }));
  throw error;
} finally { await browser.close(); }
