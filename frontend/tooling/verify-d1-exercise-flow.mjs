// Fixture-backed browser contract for the native authenticated D1 player.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { createFlowWatchdog } from './lib/flow-watchdog.mjs';

const BASE = process.argv[2] || 'http://localhost:3012';
const api = new URL(process.env.AVER_API_BASE || 'http://127.0.0.1:3999');
if (api.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname)
    || api.username || api.password || api.pathname !== '/' || api.search || api.hash) {
  throw new Error('AVER_API_BASE must be an explicit local fixture origin');
}
const API = api.origin;
const USER = '00000000-0000-4000-8000-000000000201';
const FOREIGN_USER = '00000000-0000-4000-8000-000000000208';
const SESSION = '00000000-0000-4000-8000-000000000202';
const FOREIGN_SESSION = '00000000-0000-4000-8000-000000000207';
const FOREIGN_OWNER_SESSION = '00000000-0000-4000-8000-000000000209';
const UNAUTHORIZED_SESSION = '00000000-0000-4000-8000-000000000210';
const COMPLETE_401_SESSION = '00000000-0000-4000-8000-000000000211';
const A = '00000000-0000-4000-8000-000000000203';
const B = '00000000-0000-4000-8000-000000000204';
const ATT_A = '00000000-0000-4000-8000-000000000205';
const ATT_B = '00000000-0000-4000-8000-000000000206';
const exercises = [
  { id: A, sentence: 'People must ___ to change.', answer: 'adapt', options: ['adapt', 'freeze', 'delay', 'reject'], source: 'personalized' },
  { id: B, sentence: 'Trees ___ in spring.', answer: 'grow', options: ['fall', 'grow', 'sleep', 'wait'], source: 'admin_fallback' },
];
// PC-J253: a green run takes well under a minute. The journey awaits every
// fixture signal through guard.within (15 s) and the whole script is capped,
// so a missing signal fails fast with diagnostics instead of stalling CI.
const guard = createFlowWatchdog({ name: 'verify-d1-exercise-flow', totalMs: 6 * 60_000 });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  if (ok) guard.passed(name);
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function launch() {
  try { return await chromium.launch(); } catch (error) {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome });
    throw error;
  }
}

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const requests = [];
const attemptBodies = [];
const pageErrors = [];
let attemptBCalls = 0;
let completed = false;
const persistedAttempts = [];
let resolveForeignOwnerMiss;
const foreignOwnerMissStarted = new Promise((resolve) => { resolveForeignOwnerMiss = resolve; });
let resolveUnauthorizedResponse;
const unauthorizedResponseStarted = new Promise((resolve) => { resolveUnauthorizedResponse = resolve; });
let bootstrap401Armed = false;
let resolveBootstrap401;
const bootstrap401Started = new Promise((resolve) => { resolveBootstrap401 = resolve; });
let attempt401Armed = false;
let resolveAttempt401;
const attempt401Started = new Promise((resolve) => { resolveAttempt401 = resolve; });
let complete401Armed = false;
let resolveComplete401;
const complete401Started = new Promise((resolve) => { resolveComplete401 = resolve; });
let refresh401Armed = false;
let refreshRetryExpected = false;
let refreshRetrySeen = false;
let resolveRefresh401;
const refresh401Started = new Promise((resolve) => { resolveRefresh401 = resolve; });
let resolveRefreshTokenInstalled;
const refreshTokenInstalled = new Promise((resolve) => { resolveRefreshTokenInstalled = resolve; });
let resolveRefreshRetry;
const refreshRetryObserved = new Promise((resolve) => { resolveRefreshRetry = resolve; });
let generationRaceArmed = false;
let generationOldAttemptSeen = false;
let resolveGenerationOldAttempt;
const generationOldAttemptStarted = new Promise((resolve) => { resolveGenerationOldAttempt = resolve; });
let resolveGenerationNewAttempt;
const generationNewAttemptStarted = new Promise((resolve) => { resolveGenerationNewAttempt = resolve; });
let releaseGenerationNewAttempt;
const generationNewAttemptRelease = new Promise((resolve) => { releaseGenerationNewAttempt = resolve; });
let staleRetryArmed = false;
let staleRetryOldPosts = 0;
let resolveStaleRetryFirst;
const staleRetryFirstStarted = new Promise((resolve) => { resolveStaleRetryFirst = resolve; });
let refreshGenerationRaceArmed = false;
let refreshGenerationOldPosts = 0;
let resolveRefreshGenerationOld;
const refreshGenerationOldStarted = new Promise((resolve) => { resolveRefreshGenerationOld = resolve; });
let initialDispatchRaceArmed = false;
let resumeOwnerSwitchArmed = false;
let resolveResumeOwnerSwitch;
const resumeOwnerSwitchStarted = new Promise((resolve) => { resolveResumeOwnerSwitch = resolve; });
let resolveResumeOwnerSwitchInstalled;
const resumeOwnerSwitchInstalled = new Promise((resolve) => { resolveResumeOwnerSwitchInstalled = resolve; });
let final401Armed = false;
let resolveFinal401;
const final401Started = new Promise((resolve) => { resolveFinal401 = resolve; });
// PC-J253: resolved once the fixture has sent a delayed stale response. The
// page may already have aborted that request, so no browser event is certain.
const answered = {};
const sentLate = {};
for (const key of ['foreignOwner', 'unauthorized', 'bootstrap401', 'attempt401', 'complete401', 'generationOld', 'refreshGenerationOld']) {
  answered[key] = new Promise((resolve) => { sentLate[key] = resolve; });
}
const fulfilled = (key, pending) => pending.finally(() => sentLate[key]());

const supabaseStub = `
window.__AVER_SUPABASE_CLIENT__ = { auth: {
  getSession: async function () {
    if (localStorage.getItem('d1-delay-auth-once') === '1') {
      localStorage.removeItem('d1-delay-auth-once');
      window.__d1DelayedAuthStarted = true;
      await new Promise(function (resolve) { setTimeout(resolve, 500); });
      window.__d1DelayedAuthSettled = true;
    }
    var currentUser = window.__d1CurrentUser || '${USER}';
    var foreign = currentUser === '${FOREIGN_USER}';
    var token = window.__d1AccessToken || (foreign ? 'foreign-token' : 'fixture-token');
    return { data: { session: { access_token: token, user: { id: currentUser, email: foreign ? 'other@local' : 'd1@local' } } }, error: null };
  },
  onAuthStateChange: function (callback) { window.__d1AuthCallback = callback; return { data: { subscription: { unsubscribe: function () {} } } }; },
  signOut: async function () { return { error: null }; }
} };`;

await context.addInitScript({ content: supabaseStub });
// PC-J253: <aver-chrome> and the player share one /auth/me per token
// (PC-J147). Whichever starts first owns the request, so a check that must
// answer the player's own /auth/me (resume owner switch, 401 refresh retry)
// hung whenever the chrome won. For those loads only, give the chrome its
// documented page-owned role source so the player's read is the only one.
await context.addInitScript(() => {
  if (window.top !== window || localStorage.getItem('d1-page-owns-auth-me-once') !== '1') return;
  localStorage.removeItem('d1-page-owns-auth-me-once');
  const mark = () => {
    document.querySelectorAll('aver-chrome:not([role-source])').forEach((el) => el.setAttribute('role-source', 'page'));
  };
  new MutationObserver(mark).observe(document, { childList: true, subtree: true });
});

await context.route('**/*', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname) || url.hostname === 'unpkg.com') return route.abort();
  if (url.origin === BASE) return route.continue();
  if (url.origin !== API) return route.abort();
  requests.push(`${request.method()} ${url.pathname}`);
  guard.recordRequest(request);
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-request-id',
  };
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
  if (url.pathname === '/auth/me') {
    if (resumeOwnerSwitchArmed
      && request.headers().authorization === 'Bearer fixture-token'
      && request.headers()['x-request-id']) {
      resumeOwnerSwitchArmed = false;
      resolveResumeOwnerSwitch();
      // Bounded by the journey's guard.within on resumeOwnerSwitchStarted and
      // the watchdog: the journey installs it right after that signal.
      await resumeOwnerSwitchInstalled;
    }
    if (refresh401Armed
      && request.headers().authorization === 'Bearer fixture-token'
      && request.headers()['x-request-id']) {
      refresh401Armed = false;
      refreshRetryExpected = true;
      resolveRefresh401();
      // Bounded like resumeOwnerSwitchInstalled above.
      await refreshTokenInstalled;
      return json({ detail: 'Old token expired' }, 401);
    }
    if (refreshRetryExpected && request.headers().authorization === 'Bearer refreshed-token'
      && request.headers()['x-request-id']) {
      refreshRetryExpected = false;
      refreshRetrySeen = true;
      resolveRefreshRetry();
    }
    if (bootstrap401Armed && request.headers().authorization === 'Bearer fixture-token') {
      bootstrap401Armed = false;
      resolveBootstrap401();
      await new Promise((resolve) => setTimeout(resolve, 300));
      return fulfilled('bootstrap401', json({ detail: 'Token expired' }, 401));
    }
    return json({ id: USER, d1_enabled: true });
  }
  if (request.method() === 'POST' && url.pathname === '/api/exercises/d1/sessions') {
    if (final401Armed && request.headers().authorization === 'Bearer fixture-token') {
      final401Armed = false;
      resolveFinal401();
      return json({ detail: 'Current token revoked' }, 401);
    }
    return json({ session_id: SESSION, exercises, total: 2 }, 201);
  }
  if (request.method() === 'GET' && url.pathname === `/api/exercises/d1/sessions/${SESSION}`) {
    if ((generationRaceArmed || staleRetryArmed || refreshGenerationRaceArmed || initialDispatchRaceArmed)
      && request.headers().authorization === 'Bearer foreign-token') {
      return json({ detail: 'Session not found' }, 404);
    }
    return json({
      session: {
        id: SESSION, status: 'active', total_count: 2,
        exercise_ids: [A, B], exercise_snapshot: exercises,
      },
      attempts: persistedAttempts,
    });
  }
  if (request.method() === 'GET' && url.pathname === `/api/exercises/d1/sessions/${FOREIGN_SESSION}`) {
    return json({ detail: 'Session not found' }, 404);
  }
  if (request.method() === 'GET' && url.pathname === `/api/exercises/d1/sessions/${FOREIGN_OWNER_SESSION}`) {
    if (request.headers().authorization === 'Bearer foreign-token') {
      return json({
        session: {
          id: FOREIGN_OWNER_SESSION, status: 'active', total_count: 2,
          exercise_ids: [A, B], exercise_snapshot: exercises,
        },
        attempts: persistedAttempts,
      });
    }
    resolveForeignOwnerMiss();
    await new Promise((resolve) => setTimeout(resolve, 300));
    return fulfilled('foreignOwner', json({ detail: 'Session not found' }, 404));
  }
  if (request.method() === 'GET' && url.pathname === `/api/exercises/d1/sessions/${UNAUTHORIZED_SESSION}`) {
    if (request.headers().authorization === 'Bearer foreign-token') {
      return json({
        session: {
          id: UNAUTHORIZED_SESSION, status: 'active', total_count: 2,
          exercise_ids: [A, B], exercise_snapshot: exercises,
        },
        attempts: persistedAttempts,
      });
    }
    resolveUnauthorizedResponse();
    await new Promise((resolve) => setTimeout(resolve, 300));
    return fulfilled('unauthorized', json({ detail: 'Token expired' }, 401));
  }
  if (request.method() === 'GET' && url.pathname === `/api/exercises/d1/sessions/${COMPLETE_401_SESSION}`) {
    if (request.headers().authorization === 'Bearer foreign-token') {
      return json({ detail: 'Session not found' }, 404);
    }
    return json({
      session: {
        id: COMPLETE_401_SESSION, status: 'active', total_count: 2,
        exercise_ids: [A, B], exercise_snapshot: exercises,
      },
      attempts: [
        { exercise_id: A, user_answer: 'adapt', is_correct: true },
        { exercise_id: B, user_answer: 'fall', is_correct: false },
      ],
    });
  }
  if (request.method() === 'POST' && url.pathname === `/api/exercises/d1/${A}/attempt`) {
    const body = JSON.parse(request.postData() || '{}');
    attemptBodies.push(body);
    if (initialDispatchRaceArmed && body.user_answer === 'adapt') {
      return json({ attempt_id: ATT_A, persisted: true, replayed: false, is_correct: true, correct_answer: 'adapt', score: 1, srs_updated: true, srs_rating: 'good' });
    }
    if (initialDispatchRaceArmed && body.user_answer === 'freeze') {
      return json({ attempt_id: ATT_B, persisted: true, replayed: false, is_correct: false, correct_answer: 'adapt', score: 0, srs_updated: false, srs_rating: null });
    }
    if (refreshGenerationRaceArmed && body.user_answer === 'adapt') {
      refreshGenerationOldPosts += 1;
      if (refreshGenerationOldPosts === 1) {
        resolveRefreshGenerationOld();
        await new Promise((resolve) => setTimeout(resolve, 500));
        return fulfilled('refreshGenerationOld', json({ detail: 'Old token expired' }, 401));
      }
      return json({ attempt_id: ATT_A, persisted: true, replayed: false, is_correct: true, correct_answer: 'adapt', score: 1, srs_updated: true, srs_rating: 'good' });
    }
    if (refreshGenerationRaceArmed && body.user_answer === 'freeze') {
      return json({ attempt_id: ATT_B, persisted: true, replayed: false, is_correct: false, correct_answer: 'adapt', score: 0, srs_updated: false, srs_rating: null });
    }
    if (staleRetryArmed && body.user_answer === 'adapt') {
      staleRetryOldPosts += 1;
      if (staleRetryOldPosts === 1) resolveStaleRetryFirst();
      return json({ detail: 'temporary fixture failure' }, 503);
    }
    if (staleRetryArmed && body.user_answer === 'freeze') {
      staleRetryArmed = false;
      return json({ attempt_id: ATT_B, persisted: true, replayed: false, is_correct: false, correct_answer: 'adapt', score: 0, srs_updated: false, srs_rating: null });
    }
    if (generationRaceArmed && body.user_answer === 'adapt' && !generationOldAttemptSeen) {
      generationOldAttemptSeen = true;
      resolveGenerationOldAttempt();
      await new Promise((resolve) => setTimeout(resolve, 500));
      return fulfilled('generationOld', json({ attempt_id: ATT_A, persisted: true, replayed: false, is_correct: true, correct_answer: 'adapt', score: 1, srs_updated: true, srs_rating: 'good' }));
    }
    if (generationRaceArmed && body.user_answer === 'freeze') {
      resolveGenerationNewAttempt();
      // Held until the test has checked the lock after the old ACK, so the
      // new ACK always lands second (it used to be a 900 ms delay).
      await guard.within(generationNewAttemptRelease, 'fixture: release new-generation ACK');
      generationRaceArmed = false;
      return json({ attempt_id: ATT_B, persisted: true, replayed: false, is_correct: false, correct_answer: 'adapt', score: 0, srs_updated: false, srs_rating: null });
    }
    if (attempt401Armed && request.headers().authorization === 'Bearer fixture-token') {
      attempt401Armed = false;
      resolveAttempt401();
      await new Promise((resolve) => setTimeout(resolve, 300));
      return fulfilled('attempt401', json({ detail: 'Token expired' }, 401));
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (!persistedAttempts.some((item) => item.exercise_id === A)) {
      persistedAttempts.push({ exercise_id: A, user_answer: 'adapt', is_correct: true });
    }
    return json({ attempt_id: ATT_A, persisted: true, replayed: false, is_correct: true, correct_answer: 'adapt', score: 1, srs_updated: true, srs_rating: 'good' });
  }
  if (request.method() === 'POST' && url.pathname === `/api/exercises/d1/${B}/attempt`) {
    const body = JSON.parse(request.postData() || '{}');
    attemptBodies.push(body);
    attemptBCalls += 1;
    if (attemptBCalls < 3) return json({ detail: 'temporary fixture failure' }, 503);
    return json({ attempt_id: ATT_B, persisted: true, replayed: false, is_correct: false, correct_answer: 'grow', score: 0, srs_updated: false, srs_rating: null });
  }
  if (request.method() === 'POST' && url.pathname === `/api/exercises/d1/sessions/${SESSION}/complete`) {
    completed = true;
    return json({
      session_id: SESSION, correct_count: 1, total_count: 2,
      correct: [{ exercise_id: A, sentence: exercises[0].sentence, answer: 'adapt' }],
      wrong: [{ exercise_id: B, sentence: exercises[1].sentence, user_answer: 'fall', correct_answer: 'grow' }],
    });
  }
  if (request.method() === 'POST' && url.pathname === `/api/exercises/d1/sessions/${COMPLETE_401_SESSION}/complete`) {
    if (complete401Armed && request.headers().authorization === 'Bearer fixture-token') {
      complete401Armed = false;
      resolveComplete401();
      await new Promise((resolve) => setTimeout(resolve, 300));
      return fulfilled('complete401', json({ detail: 'Token expired' }, 401));
    }
    return json({ detail: 'Session not found' }, 404);
  }
  if (url.pathname === '/api/error-logs' || url.pathname === '/api/analytics/events') return json({ ok: true });
  guard.recordUnhandled(`${request.method()} ${url.pathname}`);
  return json({});
});

const page = await context.newPage();
guard.watchPage(page);
page.on('pageerror', (error) => pageErrors.push(String(error)));
await page.goto(`${BASE}/d1-exercise`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Điền từ đúng vào ngữ cảnh' }).waitFor();
check('feature gate đọc canonical /auth/me', requests.includes('GET /auth/me'));
await page.getByRole('button', { name: 'Bắt đầu phiên mới' }).click();
await page.getByText('People must _____ to change.').waitFor();
check('session id được ghi vào URL để resume', new URL(page.url()).searchParams.get('session') === SESSION);
check('registry recovery được namespace theo account', await page.evaluate(([userId, sessionId]) => {
  const raw = localStorage.getItem(`aver:d1:active-session:${userId}`);
  return raw ? JSON.parse(raw).includes(sessionId) : false;
}, [USER, SESSION]));

await page.getByRole('button', { name: 'adapt' }).click();
const next = page.getByRole('button', { name: 'Câu tiếp theo →' });
check('Next khóa trong lúc canonical attempt đang lưu', await next.isDisabled());
await page.getByText('Đã ghi nhận vào lịch ôn tập.').waitFor();
check('Next chỉ mở sau ACK persisted', !(await next.isDisabled()) && attemptBodies[0]?.client_attempt_id);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByText('Trees _____ in spring.').waitFor();
check('reload khôi phục đúng câu chưa làm từ snapshot + attempt canonical', requests.includes(`GET /api/exercises/d1/sessions/${SESSION}`));

await page.getByRole('button', { name: 'fall' }).click();
await page.getByRole('button', { name: 'Thử lưu lại' }).waitFor();
const keyB = attemptBodies.filter((body) => body.user_answer === 'fall').map((body) => body.client_attempt_id);
check('hai transient retries dùng cùng client_attempt_id', keyB.length === 2 && new Set(keyB).size === 1);
await page.getByRole('button', { name: 'Thử lưu lại' }).click();
await page.getByText('✓ Đã lưu bài.').waitFor();
const keyBAfterManual = attemptBodies.filter((body) => body.user_answer === 'fall').map((body) => body.client_attempt_id);
check('manual retry vẫn dùng key gốc', keyBAfterManual.length === 3 && new Set(keyBAfterManual).size === 1);
await page.getByRole('button', { name: 'Xem kết quả' }).click();
await page.getByRole('heading', { name: 'Kết quả luyện tập' }).waitFor();
check('summary canonical đủ đúng/sai và đã complete', completed && await page.getByText('1/2').count() === 1 && await page.getByText('Đáp án grow').count() === 1);
check('resume pointer được xóa sau completion', new URL(page.url()).searchParams.get('session') === null);
check('completion chỉ loại session đã xong khỏi registry', await page.evaluate((userId) => {
  return localStorage.getItem(`aver:d1:active-session:${userId}`) === null;
}, USER));

const attemptsBeforeReview = attemptBodies.length;
await page.getByRole('button', { name: 'Ôn lại câu sai' }).click();
await page.getByRole('button', { name: 'grow' }).click();
await page.getByRole('button', { name: 'Kết thúc ôn tập' }).click();
await page.getByRole('heading', { name: 'Kết quả luyện tập' }).waitFor();
check('revision local-only không tạo attempt/SRS mới', attemptBodies.length === attemptsBeforeReview);
check('mobile không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
check('không có pageerror', pageErrors.length === 0, pageErrors.join(' | '));

await page.evaluate(([userId, sessionId]) => {
  localStorage.setItem(`aver:d1:active-session:${userId}`, JSON.stringify([sessionId]));
  localStorage.removeItem('aver:d1:active-session');
}, [USER, SESSION]);
await page.goto(`${BASE}/d1-exercise?session=${FOREIGN_SESSION}`, { waitUntil: 'domcontentloaded' });
await page.getByText('Trees _____ in spring.').waitFor();
check('URL foreign 404 fallback ngay sang registry account',
  new URL(page.url()).searchParams.get('session') === SESSION
  && requests.includes(`GET /api/exercises/d1/sessions/${FOREIGN_SESSION}`));

const staleRegistryMissesBefore = requests.filter(
  (entry) => entry === `GET /api/exercises/d1/sessions/${FOREIGN_SESSION}`,
).length;
await page.evaluate(([userId, activeId, staleId]) => {
  localStorage.setItem(
    `aver:d1:active-session:${userId}`,
    JSON.stringify([activeId, staleId]),
  );
}, [USER, SESSION, FOREIGN_SESSION]);
await page.goto(`${BASE}/d1-exercise`, { waitUntil: 'domcontentloaded' });
await page.getByText('Trees _____ in spring.').waitFor();
check('registry thử toàn bộ session mới→cũ trước khi hiện Start', await page.evaluate(
  ([userId, activeId]) => {
    const scoped = localStorage.getItem(`aver:d1:active-session:${userId}`);
    return new URL(window.location.href).searchParams.get('session') === activeId
      && !!scoped && JSON.parse(scoped).length === 1 && JSON.parse(scoped)[0] === activeId;
  },
  [USER, SESSION],
) && requests.filter(
  (entry) => entry === `GET /api/exercises/d1/sessions/${FOREIGN_SESSION}`,
).length === staleRegistryMissesBefore + 1);

await page.evaluate(([userId, sessionId]) => {
  localStorage.removeItem(`aver:d1:active-session:${userId}`);
  localStorage.setItem('aver:d1:active-session', sessionId);
}, [USER, SESSION]);
await page.goto(`${BASE}/d1-exercise`, { waitUntil: 'domcontentloaded' });
await page.getByText('Trees _____ in spring.').waitFor();
check('singleton legacy chỉ bị claim sau resume user-scoped thành công', await page.evaluate(([userId, sessionId]) => {
  const scoped = localStorage.getItem(`aver:d1:active-session:${userId}`);
  return localStorage.getItem('aver:d1:active-session') === null
    && !!scoped && JSON.parse(scoped).includes(sessionId);
}, [USER, SESSION]));

await page.evaluate(([userId, sessionId]) => {
  localStorage.setItem(`aver:d1:active-session:${userId}`, JSON.stringify([sessionId]));
}, [USER, SESSION]);
// Switch the token owner while the player's correlated /auth/me is in flight,
// so its next getSession is the resume lookup. A getSession call ordinal is
// not stable: aver-chrome and api.js read the session at racy points too.
resumeOwnerSwitchArmed = true;
await page.evaluate(() => localStorage.setItem('d1-page-owns-auth-me-once', '1'));
const resumeRequestsBefore = requests.filter(
  (entry) => entry === `GET /api/exercises/d1/sessions/${SESSION}`,
).length;
await page.goto(`${BASE}/d1-exercise?session=${SESSION}`, { waitUntil: 'domcontentloaded' });
await guard.within(resumeOwnerSwitchStarted, "player's /auth/me during resume (owner switch)");
await page.evaluate(([foreignUserId]) => {
  window.__d1CurrentUser = foreignUserId;
}, [FOREIGN_USER]);
resolveResumeOwnerSwitchInstalled();
await page.getByText(/Tài khoản đã thay đổi trước khi gửi yêu cầu/).waitFor();
check('token owner đổi trong resume không xóa registry của account cũ', await page.evaluate(([userId, sessionId]) => {
  const scoped = localStorage.getItem(`aver:d1:active-session:${userId}`);
  return !!scoped && JSON.parse(scoped).includes(sessionId);
}, [USER, SESSION]) && requests.filter(
  (entry) => entry === `GET /api/exercises/d1/sessions/${SESSION}`,
).length === resumeRequestsBefore);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByText('Trees _____ in spring.').waitFor();
check('account cũ vẫn resume được đúng session sau token race',
  new URL(page.url()).searchParams.get('session') === SESSION);

await page.evaluate(([userId, foreignUserId]) => {
  localStorage.removeItem(`aver:d1:active-session:${userId}`);
  localStorage.removeItem(`aver:d1:active-session:${foreignUserId}`);
  localStorage.removeItem('aver:d1:active-session');
  window.__d1CurrentUser = userId;
}, [USER, FOREIGN_USER]);
await page.goto(`${BASE}/d1-exercise?session=${FOREIGN_OWNER_SESSION}`, { waitUntil: 'domcontentloaded' });
await guard.within(foreignOwnerMissStarted, 'fixture: old-account 404 for foreign-owner session');
await page.evaluate(([foreignUserId]) => {
  window.__d1CurrentUser = foreignUserId;
  window.__d1AuthCallback?.('SIGNED_IN', {
    access_token: 'foreign-token',
    user: { id: foreignUserId, email: 'other@local' },
  });
}, [FOREIGN_USER]);
await page.getByText('Trees _____ in spring.').waitFor();
await guard.within(answered.foreignOwner, 'fixture: late 404 of the old account sent');
// The late response has left the fixture; this pause only proves it changes
// nothing in the page (there is no event for "nothing happened").
await page.waitForTimeout(350);
check('404 trễ của account cũ không xóa query resume của account mới',
  new URL(page.url()).searchParams.get('session') === FOREIGN_OWNER_SESSION);
check('account mới claim query session vào đúng registry', await page.evaluate(([userId, sessionId]) => {
  const scoped = localStorage.getItem(`aver:d1:active-session:${userId}`);
  return !!scoped && JSON.parse(scoped).includes(sessionId);
}, [FOREIGN_USER, FOREIGN_OWNER_SESSION]));

await page.evaluate(([userId, foreignUserId]) => {
  localStorage.removeItem(`aver:d1:active-session:${userId}`);
  localStorage.removeItem(`aver:d1:active-session:${foreignUserId}`);
  window.__d1CurrentUser = userId;
}, [USER, FOREIGN_USER]);
await page.goto(`${BASE}/d1-exercise?session=${UNAUTHORIZED_SESSION}`, { waitUntil: 'domcontentloaded' });
await guard.within(unauthorizedResponseStarted, 'fixture: old-account 401 for resume');
await page.evaluate(([foreignUserId]) => {
  window.__d1CurrentUser = foreignUserId;
  window.__d1AuthCallback?.('SIGNED_IN', {
    access_token: 'foreign-token',
    user: { id: foreignUserId, email: 'other@local' },
  });
}, [FOREIGN_USER]);
await page.getByText('Trees _____ in spring.').waitFor();
await guard.within(answered.unauthorized, 'fixture: late resume 401 of the old account sent');
// The late response has left the fixture; this pause only proves it changes
// nothing in the page (there is no event for "nothing happened").
await page.waitForTimeout(350);
check('401 trễ của account cũ không redirect account mới về login',
  new URL(page.url()).pathname === '/d1-exercise'
  && new URL(page.url()).searchParams.get('session') === UNAUTHORIZED_SESSION);
check('account mới giữ được session sau stale 401', await page.evaluate(([userId, sessionId]) => {
  const scoped = localStorage.getItem(`aver:d1:active-session:${userId}`);
  return !!scoped && JSON.parse(scoped).includes(sessionId);
}, [FOREIGN_USER, UNAUTHORIZED_SESSION]));

bootstrap401Armed = true;
await page.evaluate(([userId, foreignUserId]) => {
  localStorage.removeItem(`aver:d1:active-session:${userId}`);
  localStorage.removeItem(`aver:d1:active-session:${foreignUserId}`);
}, [USER, FOREIGN_USER]);
await page.goto(`${BASE}/d1-exercise`, { waitUntil: 'domcontentloaded' });
await guard.within(bootstrap401Started, 'fixture: old-account 401 for /auth/me bootstrap');
await page.evaluate(([foreignUserId]) => {
  window.__d1CurrentUser = foreignUserId;
  window.__d1AuthCallback?.('SIGNED_IN', {
    access_token: 'foreign-token',
    user: { id: foreignUserId, email: 'other@local' },
  });
}, [FOREIGN_USER]);
await page.getByRole('button', { name: 'Bắt đầu phiên mới' }).waitFor();
await guard.within(answered.bootstrap401, 'fixture: late /auth/me 401 of the old account sent');
// The late response has left the fixture; this pause only proves it changes
// nothing in the page (there is no event for "nothing happened").
await page.waitForTimeout(350);
check('401 trễ ở feature bootstrap không redirect account mới',
  new URL(page.url()).pathname === '/d1-exercise');

attempt401Armed = true;
await page.evaluate(([userId, foreignUserId]) => {
  localStorage.removeItem(`aver:d1:active-session:${userId}`);
  localStorage.removeItem(`aver:d1:active-session:${foreignUserId}`);
}, [USER, FOREIGN_USER]);
await page.goto(`${BASE}/d1-exercise`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Bắt đầu phiên mới' }).click();
await page.getByRole('button', { name: 'adapt' }).click();
await guard.within(attempt401Started, 'fixture: old-account 401 for attempt');
await page.evaluate(([foreignUserId]) => {
  window.__d1CurrentUser = foreignUserId;
  window.__d1AuthCallback?.('SIGNED_IN', {
    access_token: 'foreign-token',
    user: { id: foreignUserId, email: 'other@local' },
  });
}, [FOREIGN_USER]);
await page.getByText('Trees _____ in spring.').waitFor();
await guard.within(answered.attempt401, 'fixture: late attempt 401 of the old account sent');
// The late response has left the fixture; this pause only proves it changes
// nothing in the page (there is no event for "nothing happened").
await page.waitForTimeout(350);
check('401 trễ khi lưu attempt không redirect account mới',
  new URL(page.url()).pathname === '/d1-exercise');

complete401Armed = true;
await page.evaluate(([userId, foreignUserId]) => {
  localStorage.removeItem(`aver:d1:active-session:${userId}`);
  localStorage.removeItem(`aver:d1:active-session:${foreignUserId}`);
}, [USER, FOREIGN_USER]);
await page.goto(`${BASE}/d1-exercise?session=${COMPLETE_401_SESSION}`, { waitUntil: 'domcontentloaded' });
await guard.within(complete401Started, 'fixture: old-account 401 for complete');
await page.evaluate(([foreignUserId]) => {
  window.__d1CurrentUser = foreignUserId;
  window.__d1AuthCallback?.('SIGNED_IN', {
    access_token: 'foreign-token',
    user: { id: foreignUserId, email: 'other@local' },
  });
}, [FOREIGN_USER]);
await page.getByRole('button', { name: 'Bắt đầu phiên mới' }).waitFor();
await guard.within(answered.complete401, 'fixture: late complete 401 of the old account sent');
// The late response has left the fixture; this pause only proves it changes
// nothing in the page (there is no event for "nothing happened").
await page.waitForTimeout(350);
check('401 trễ khi complete không redirect account mới',
  new URL(page.url()).pathname === '/d1-exercise');

refresh401Armed = true;
await page.evaluate(([userId, foreignUserId]) => {
  localStorage.removeItem(`aver:d1:active-session:${userId}`);
  localStorage.removeItem(`aver:d1:active-session:${foreignUserId}`);
  localStorage.setItem('d1-page-owns-auth-me-once', '1');
}, [USER, FOREIGN_USER]);
const refreshAuthMeBefore = requests.length;
await page.goto(`${BASE}/d1-exercise`, { waitUntil: 'domcontentloaded' });
await guard.within(refresh401Started, "player's /auth/me with the old token (401 refresh)");
await page.evaluate(([userId]) => {
  window.__d1CurrentUser = userId;
  window.__d1AccessToken = 'refreshed-token';
}, [USER]);
// Supabase has already committed the refreshed session by the time the
// original request receives 401. Account-change callbacks are covered by the
// adjacent generation tests; emitting one here would add an unrelated React
// lifecycle race to the request retry contract.
resolveRefreshTokenInstalled();
// The retry precedes the Start screen, so a missing retry fails here, named.
await guard.within(refreshRetryObserved, '401 token cũ retry một lần bằng token refresh cùng account');
await page.getByRole('button', { name: 'Bắt đầu phiên mới' }).waitFor();
check('401 token cũ retry một lần bằng token refresh cùng account',
  refreshRetrySeen && new URL(page.url()).pathname === '/d1-exercise'
  && requests.slice(refreshAuthMeBefore).filter((entry) => entry === 'GET /auth/me').length === 2);

generationRaceArmed = true;
persistedAttempts.length = 0;
await page.evaluate(([userId, foreignUserId]) => {
  localStorage.removeItem(`aver:d1:active-session:${userId}`);
  localStorage.removeItem(`aver:d1:active-session:${foreignUserId}`);
}, [USER, FOREIGN_USER]);
await page.goto(`${BASE}/d1-exercise`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Bắt đầu phiên mới' }).click();
await page.getByRole('button', { name: 'adapt' }).click();
await guard.within(generationOldAttemptStarted, 'fixture: old-generation attempt A');
await page.evaluate(([foreignUserId]) => {
  window.__d1CurrentUser = foreignUserId;
  window.__d1AuthCallback?.('SIGNED_IN', {
    access_token: 'foreign-token',
    user: { id: foreignUserId, email: 'other@local' },
  });
}, [FOREIGN_USER]);
await page.getByRole('button', { name: 'Bắt đầu phiên mới' }).waitFor();
await page.evaluate(([userId]) => {
  window.__d1CurrentUser = userId;
  window.__d1AuthCallback?.('SIGNED_IN', {
    access_token: 'fixture-token',
    user: { id: userId, email: 'd1@local' },
  });
}, [USER]);
await page.getByText('People must _____ to change.').waitFor();
await page.getByRole('button', { name: 'freeze' }).click();
await guard.within(generationNewAttemptStarted, 'fixture: new-generation attempt A');
await guard.within(answered.generationOld, 'fixture: old-generation ACK sent');
// The late response has left the fixture; this pause only proves it changes
// nothing in the page (there is no event for "nothing happened").
await page.waitForTimeout(350);
check('ACK generation A cũ không mở khóa attempt A mới',
  await page.getByRole('button', { name: 'Câu tiếp theo →' }).isDisabled());
releaseGenerationNewAttempt();
await page.getByText('✓ Đã lưu bài.').waitFor();
check('attempt generation mới tự mở khóa sau đúng ACK',
  !(await page.getByRole('button', { name: 'Câu tiếp theo →' }).isDisabled()));

staleRetryArmed = true;
staleRetryOldPosts = 0;
persistedAttempts.length = 0;
await page.evaluate(([userId, foreignUserId]) => {
  localStorage.removeItem(`aver:d1:active-session:${userId}`);
  localStorage.removeItem(`aver:d1:active-session:${foreignUserId}`);
}, [USER, FOREIGN_USER]);
await page.goto(`${BASE}/d1-exercise`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Bắt đầu phiên mới' }).click();
await page.getByRole('button', { name: 'adapt' }).click();
await guard.within(staleRetryFirstStarted, 'fixture: old-generation transient 503');
await page.evaluate(([foreignUserId]) => {
  window.__d1CurrentUser = foreignUserId;
  window.__d1AuthCallback?.('SIGNED_IN', {
    access_token: 'foreign-token',
    user: { id: foreignUserId, email: 'other@local' },
  });
}, [FOREIGN_USER]);
await page.getByRole('button', { name: 'Bắt đầu phiên mới' }).waitFor();
await page.evaluate(([userId]) => {
  window.__d1CurrentUser = userId;
  window.__d1AuthCallback?.('SIGNED_IN', {
    access_token: 'fixture-token',
    user: { id: userId, email: 'd1@local' },
  });
}, [USER]);
await page.getByText('People must _____ to change.').waitFor();
await page.getByRole('button', { name: 'freeze' }).click();
await page.getByText('✓ Đã lưu bài.').waitFor();
// The old generation's retry would leave 500 ms after its 503 (player backoff),
// which was before this point; 600 ms proves it never leaves.
await page.waitForTimeout(600);
check('generation cũ không dispatch transient retry sau A→B→A', staleRetryOldPosts === 1);

refreshGenerationRaceArmed = true;
refreshGenerationOldPosts = 0;
persistedAttempts.length = 0;
await page.evaluate(([userId, foreignUserId]) => {
  localStorage.removeItem(`aver:d1:active-session:${userId}`);
  localStorage.removeItem(`aver:d1:active-session:${foreignUserId}`);
  window.__d1AccessToken = 'fixture-token';
}, [USER, FOREIGN_USER]);
await page.goto(`${BASE}/d1-exercise`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Bắt đầu phiên mới' }).click();
await page.getByRole('button', { name: 'adapt' }).click();
await guard.within(refreshGenerationOldStarted, 'fixture: old-generation attempt (delayed 401)');
await page.evaluate(([foreignUserId]) => {
  window.__d1CurrentUser = foreignUserId;
  window.__d1AccessToken = 'foreign-token';
  window.__d1AuthCallback?.('SIGNED_IN', {
    access_token: 'foreign-token',
    user: { id: foreignUserId, email: 'other@local' },
  });
}, [FOREIGN_USER]);
await page.getByRole('button', { name: 'Bắt đầu phiên mới' }).waitFor();
await page.evaluate(([userId]) => {
  window.__d1CurrentUser = userId;
  window.__d1AccessToken = 'refreshed-token';
  window.__d1AuthCallback?.('SIGNED_IN', {
    access_token: 'refreshed-token',
    user: { id: userId, email: 'd1@local' },
  });
}, [USER]);
await page.getByText('People must _____ to change.').waitFor();
await page.getByRole('button', { name: 'freeze' }).click();
await page.getByText('✓ Đã lưu bài.').waitFor();
await guard.within(answered.refreshGenerationOld, 'fixture: old-generation 401 sent');
// A 401 retry is dispatched at once; this pause only proves none leaves.
await page.waitForTimeout(600);
check('generation cũ không redispatch bằng token refresh sau A→B→A',
  refreshGenerationOldPosts === 1);
refreshGenerationRaceArmed = false;

initialDispatchRaceArmed = true;
persistedAttempts.length = 0;
await page.evaluate(([userId, foreignUserId]) => {
  localStorage.removeItem(`aver:d1:active-session:${userId}`);
  localStorage.removeItem(`aver:d1:active-session:${foreignUserId}`);
  window.__d1AccessToken = 'fixture-token';
}, [USER, FOREIGN_USER]);
await page.goto(`${BASE}/d1-exercise`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Bắt đầu phiên mới' }).click();
const adaptPostsBeforeDelayedToken = attemptBodies.filter((body) => body.user_answer === 'adapt').length;
await page.evaluate(() => {
  window.__d1DelayedAuthStarted = false;
  window.__d1DelayedAuthSettled = false;
  localStorage.setItem('d1-delay-auth-once', '1');
});
await page.getByRole('button', { name: 'adapt' }).click();
await page.waitForFunction(() => window.__d1DelayedAuthStarted === true);
await page.evaluate(([foreignUserId]) => {
  window.__d1CurrentUser = foreignUserId;
  window.__d1AccessToken = 'foreign-token';
  window.__d1AuthCallback?.('SIGNED_IN', {
    access_token: 'foreign-token',
    user: { id: foreignUserId, email: 'other@local' },
  });
}, [FOREIGN_USER]);
await page.getByRole('button', { name: 'Bắt đầu phiên mới' }).waitFor();
await page.evaluate(([userId]) => {
  window.__d1CurrentUser = userId;
  window.__d1AccessToken = 'fixture-token';
  window.__d1AuthCallback?.('SIGNED_IN', {
    access_token: 'fixture-token',
    user: { id: userId, email: 'd1@local' },
  });
}, [USER]);
await page.getByText('People must _____ to change.').waitFor();
await page.getByRole('button', { name: 'freeze' }).click();
await page.getByText('✓ Đã lưu bài.').waitFor();
await page.waitForFunction(() => window.__d1DelayedAuthSettled === true);
// The delayed token lookup has returned; a stale dispatch would follow at
// once, so this pause only proves none leaves.
await page.waitForTimeout(600);
check('generation cũ không dispatch sau token lookup trễ A→B→A',
  attemptBodies.filter((body) => body.user_answer === 'adapt').length === adaptPostsBeforeDelayedToken);
initialDispatchRaceArmed = false;

await page.evaluate(([userId, foreignUserId]) => {
  localStorage.removeItem(`aver:d1:active-session:${userId}`);
  localStorage.removeItem(`aver:d1:active-session:${foreignUserId}`);
  window.__d1CurrentUser = userId;
  window.__d1AccessToken = 'fixture-token';
}, [USER, FOREIGN_USER]);
await page.goto(`${BASE}/d1-exercise`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Bắt đầu phiên mới' }).waitFor();
final401Armed = true;
await page.getByRole('button', { name: 'Bắt đầu phiên mới' }).click();
await guard.within(final401Started, 'fixture: final 401 for current token');
await page.waitForURL('**/login');
check('401 cuối của token hiện hành redirect về login', new URL(page.url()).pathname === '/login');

await context.close();
await browser.close();
guard.stop();
if (results.some((item) => !item.ok)) process.exitCode = 1;
