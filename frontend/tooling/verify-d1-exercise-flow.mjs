// Fixture-backed browser contract for the native authenticated D1 player.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3012';
const API = 'http://localhost:8000';
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
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
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

const supabaseStub = `
window.supabase = { createClient: function () { return { auth: {
  getSession: async function () {
    var call = Number(sessionStorage.getItem('d1-auth-session-calls') || '0') + 1;
    sessionStorage.setItem('d1-auth-session-calls', String(call));
    var foreignAt = Number(localStorage.getItem('d1-foreign-token-at') || '0');
    if (foreignAt === call) {
      await new Promise(function (resolve) { setTimeout(resolve, 120); });
      return { data: { session: { access_token: 'foreign-token', user: { id: '${FOREIGN_USER}', email: 'other@local' } } }, error: null };
    }
    var currentUser = window.__d1CurrentUser || '${USER}';
    var foreign = currentUser === '${FOREIGN_USER}';
    return { data: { session: { access_token: foreign ? 'foreign-token' : 'fixture-token', user: { id: currentUser, email: foreign ? 'other@local' : 'd1@local' } } }, error: null };
  },
  onAuthStateChange: function (callback) { window.__d1AuthCallback = callback; return { data: { subscription: { unsubscribe: function () {} } } }; },
  signOut: async function () { return { error: null }; }
} }; } };`;

await context.route('**/*', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('supabase')) {
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: supabaseStub });
  }
  if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname) || url.hostname === 'unpkg.com') return route.abort();
  if (url.origin === BASE) return route.continue();
  if (url.origin !== API) return route.abort();
  requests.push(`${request.method()} ${url.pathname}`);
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-request-id',
  };
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
  if (url.pathname === '/auth/me') {
    if (bootstrap401Armed && request.headers().authorization === 'Bearer fixture-token') {
      bootstrap401Armed = false;
      resolveBootstrap401();
      await new Promise((resolve) => setTimeout(resolve, 300));
      return json({ detail: 'Token expired' }, 401);
    }
    return json({ id: USER, d1_enabled: true });
  }
  if (request.method() === 'POST' && url.pathname === '/api/exercises/d1/sessions') {
    return json({ session_id: SESSION, exercises, total: 2 }, 201);
  }
  if (request.method() === 'GET' && url.pathname === `/api/exercises/d1/sessions/${SESSION}`) {
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
    return json({ detail: 'Session not found' }, 404);
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
    return json({ detail: 'Token expired' }, 401);
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
    if (attempt401Armed && request.headers().authorization === 'Bearer fixture-token') {
      attempt401Armed = false;
      resolveAttempt401();
      await new Promise((resolve) => setTimeout(resolve, 300));
      return json({ detail: 'Token expired' }, 401);
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
      return json({ detail: 'Token expired' }, 401);
    }
    return json({ detail: 'Session not found' }, 404);
  }
  if (url.pathname === '/api/error-logs' || url.pathname === '/api/analytics/events') return json({ ok: true });
  return json({});
});

const page = await context.newPage();
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
  const calls = Number(sessionStorage.getItem('d1-auth-session-calls') || '0');
  // On reload: AuthProvider owns call +1, /auth/me owns +2, resume owns +3.
  localStorage.setItem('d1-foreign-token-at', String(calls + 3));
}, [USER, SESSION]);
await page.goto(`${BASE}/d1-exercise?session=${SESSION}`, { waitUntil: 'domcontentloaded' });
await page.getByText(/Tài khoản đã thay đổi trước khi gửi yêu cầu/).waitFor();
check('token owner đổi trong resume không xóa registry của account cũ', await page.evaluate(([userId, sessionId]) => {
  const scoped = localStorage.getItem(`aver:d1:active-session:${userId}`);
  return !!scoped && JSON.parse(scoped).includes(sessionId);
}, [USER, SESSION]));
await page.evaluate(() => localStorage.removeItem('d1-foreign-token-at'));
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
await foreignOwnerMissStarted;
await page.evaluate(([foreignUserId]) => {
  window.__d1CurrentUser = foreignUserId;
  window.__d1AuthCallback?.('SIGNED_IN', {
    access_token: 'foreign-token',
    user: { id: foreignUserId, email: 'other@local' },
  });
}, [FOREIGN_USER]);
await page.getByText('Trees _____ in spring.').waitFor();
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
await unauthorizedResponseStarted;
await page.evaluate(([foreignUserId]) => {
  window.__d1CurrentUser = foreignUserId;
  window.__d1AuthCallback?.('SIGNED_IN', {
    access_token: 'foreign-token',
    user: { id: foreignUserId, email: 'other@local' },
  });
}, [FOREIGN_USER]);
await page.getByText('Trees _____ in spring.').waitFor();
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
await bootstrap401Started;
await page.evaluate(([foreignUserId]) => {
  window.__d1CurrentUser = foreignUserId;
  window.__d1AuthCallback?.('SIGNED_IN', {
    access_token: 'foreign-token',
    user: { id: foreignUserId, email: 'other@local' },
  });
}, [FOREIGN_USER]);
await page.getByRole('button', { name: 'Bắt đầu phiên mới' }).waitFor();
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
await attempt401Started;
await page.evaluate(([foreignUserId]) => {
  window.__d1CurrentUser = foreignUserId;
  window.__d1AuthCallback?.('SIGNED_IN', {
    access_token: 'foreign-token',
    user: { id: foreignUserId, email: 'other@local' },
  });
}, [FOREIGN_USER]);
await page.getByText('Trees _____ in spring.').waitFor();
await page.waitForTimeout(350);
check('401 trễ khi lưu attempt không redirect account mới',
  new URL(page.url()).pathname === '/d1-exercise');

complete401Armed = true;
await page.evaluate(([userId, foreignUserId]) => {
  localStorage.removeItem(`aver:d1:active-session:${userId}`);
  localStorage.removeItem(`aver:d1:active-session:${foreignUserId}`);
}, [USER, FOREIGN_USER]);
await page.goto(`${BASE}/d1-exercise?session=${COMPLETE_401_SESSION}`, { waitUntil: 'domcontentloaded' });
await complete401Started;
await page.evaluate(([foreignUserId]) => {
  window.__d1CurrentUser = foreignUserId;
  window.__d1AuthCallback?.('SIGNED_IN', {
    access_token: 'foreign-token',
    user: { id: foreignUserId, email: 'other@local' },
  });
}, [FOREIGN_USER]);
await page.getByRole('button', { name: 'Bắt đầu phiên mới' }).waitFor();
await page.waitForTimeout(350);
check('401 trễ khi complete không redirect account mới',
  new URL(page.url()).pathname === '/d1-exercise');

await context.close();
await browser.close();
if (results.some((item) => !item.ok)) process.exitCode = 1;
