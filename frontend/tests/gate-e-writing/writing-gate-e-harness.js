const { expect } = require('@playwright/test');

const API = 'http://localhost:8000';
const ORIGIN = 'http://localhost:3214';
const OWNER = '00000000-0000-4000-8000-0000000000dd';
const ASSIGNMENT = '11111111-1111-4111-8111-111111111111';
const ESSAY = '22222222-2222-4222-8222-222222222222';
const JOB = '33333333-3333-4333-8333-333333333333';
const SUPABASE_NEXT_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.107.0/dist/umd/supabase.min.js';
const SUPABASE_LEGACY_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.107.0';
const LUCIDE_CDN = 'https://unpkg.com/lucide@1.17.0';
const PRODUCTION_ORIGINS = Object.freeze([
  'https://ielts-speaking-coach-production.up.railway.app',
  'https://huwsmtubwulikhlmcirx.supabase.co',
]);

const cors = {
  'access-control-allow-origin': ORIGIN,
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,x-request-id',
};

function createWritingGateEState() {
  return {
    status: 'pending',
    startedAt: null,
    draftText: '',
    submittedText: null,
    requestId: null,
    startCalls: 0,
    draftCalls: [],
    submitCalls: [],
    essayCount: 0,
    jobCount: 0,
  };
}

function assignmentPayload(state) {
  return {
    id: ASSIGNMENT,
    status: state.status,
    name: 'Gate E Writing assignment',
    deadline: null,
    instructions: 'Giữ đúng canonical text.',
    created_at: '2026-08-14T00:00:00.000Z',
    submitted_at: state.status === 'submitted' ? '2026-08-14T00:10:00.000Z' : null,
    delivered_at: null,
    essay_id: state.status === 'submitted' ? ESSAY : null,
    allow_soft_check: false,
    is_timed: true,
    time_limit_minutes: 40,
    started_at: state.startedAt,
    auto_submitted: false,
    writing_prompts: {
      id: '44444444-4444-4444-8444-444444444444',
      title: 'Canonical persistence',
      prompt_text: 'Discuss why durable drafts matter for learners.',
      task_type: 'task2',
      difficulty: 'intermediate',
      prompt_image_url: null,
    },
  };
}

function timerPayload(state) {
  return {
    is_timed: true,
    time_limit_minutes: 40,
    started_at: state.startedAt,
    expires_at: state.startedAt ? new Date(new Date(state.startedAt).getTime() + 40 * 60_000).toISOString() : null,
    time_remaining_seconds: state.startedAt ? 2390 : null,
    is_expired: false,
  };
}

function assignmentList(state) {
  const assignment = assignmentPayload(state);
  return {
    student: { full_name: 'Gate E Learner', student_code: 'GE-WRITE', target_band: 7 },
    assignments: [{
      ...assignment,
      has_draft: Boolean(state.draftText),
      draft_word_count: state.draftText.trim() ? state.draftText.trim().split(/\s+/).length : 0,
      draft_updated_at: state.draftText ? '2026-08-14T00:05:00.000Z' : null,
    }],
  };
}

function essaysPayload(state) {
  const essays = state.status === 'submitted' ? [{
    id: ESSAY,
    task_type: 'task2',
    prompt_text: 'Discuss why durable drafts matter for learners.',
    essay_text: state.submittedText,
    word_count: state.submittedText ? state.submittedText.trim().split(/\s+/).length : 0,
    status: 'pending',
    is_flagged: false,
    flag_reasons: [],
    created_at: '2026-08-14T00:10:00.000Z',
  }] : [];
  return { student: { full_name: 'Gate E Learner' }, essays };
}

function submissionAck(state, replayed = false) {
  return {
    essay_id: ESSAY,
    job_id: JOB,
    assignment_id: ASSIGNMENT,
    status: 'submitted',
    is_flagged: false,
    message: 'Bài viết đã được nộp. Em sẽ nhận kết quả sớm.',
    replayed,
  };
}

function commitSubmission(state, body) {
  if (state.status === 'submitted') {
    if (body?.request_id === state.requestId && body?.essay_text === state.submittedText) {
      return submissionAck(state, true);
    }
    return null;
  }
  state.status = 'submitted';
  state.requestId = String(body?.request_id || '');
  state.submittedText = String(body?.essay_text ?? '');
  state.draftText = '';
  state.essayCount += 1;
  state.jobCount += 1;
  return submissionAck(state, false);
}

async function installWritingGateEHarness(page, { state, handleApi = null } = {}) {
  if (!state) throw new TypeError('state is required');
  const calls = [];
  const pageErrors = [];
  const productionRequests = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    if (PRODUCTION_ORIGINS.some((origin) => request.url().startsWith(origin))) {
      productionRequests.push(request.url());
    }
  });
  page.on('dialog', (dialog) => dialog.accept());

  await page.addInitScript(({ owner }) => {
    window.__GATE_E_WRITING_SESSION__ = {
      access_token: 'gate-e-writing-token',
      refresh_token: 'gate-e-writing-refresh',
      expires_at: 4_102_444_800,
      user: { id: owner, email: 'gate-e-writing@test.local' },
    };
  }, { owner: OWNER });

  const fulfillSupabase = (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `window.supabase={createClient:function(){return{auth:{getSession:async function(){return{data:{session:window.__GATE_E_WRITING_SESSION__}}},onAuthStateChange:function(){return{data:{subscription:{unsubscribe:function(){}}}}},signOut:async function(){return{error:null}}}}}};`,
  });
  await page.route(SUPABASE_NEXT_CDN, fulfillSupabase);
  await page.route(SUPABASE_LEGACY_CDN, fulfillSupabase);
  await page.route(LUCIDE_CDN, (route) => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.lucide={createIcons:function(){}};',
  }));
  await page.route('https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js', (route) => route.fulfill({
    contentType: 'application/javascript', body: 'window.marked={parse:function(s){return "<p>"+s+"</p>"}};',
  }));
  await page.route('https://cdn.jsdelivr.net/npm/dompurify@3.4.8/dist/purify.min.js', (route) => route.fulfill({
    contentType: 'application/javascript', body: 'window.DOMPurify={sanitize:function(s){return s}};',
  }));
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
  for (const origin of PRODUCTION_ORIGINS) await page.route(`${origin}/**`, (route) => route.abort('blockedbyclient'));

  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let body = null;
    try { body = request.postDataJSON(); } catch {}
    const entry = { method: request.method(), path: url.pathname, query: url.search, body };
    calls.push(entry);
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (handleApi && await handleApi({ route, request, url, entry, state, calls })) return;

    if (request.method() === 'GET' && url.pathname === '/api/student/permissions') {
      return route.fulfill({ json: { writing: true }, headers: cors });
    }
    if (request.method() === 'GET' && url.pathname === '/api/writing/my-assignments') {
      return route.fulfill({ json: assignmentList(state), headers: cors });
    }
    if (request.method() === 'GET' && url.pathname === '/api/writing/my-essays') {
      return route.fulfill({ json: essaysPayload(state), headers: cors });
    }
    if (request.method() === 'GET' && url.pathname === '/api/writing/prompt-bank') {
      return route.fulfill({ json: { enabled: false, prompts: [] }, headers: cors });
    }
    if (request.method() === 'GET' && url.pathname === '/api/writing/tips') {
      return route.fulfill({ json: { tips: [] }, headers: cors });
    }
    if (request.method() === 'POST' && url.pathname === `/api/writing/my-assignments/${ASSIGNMENT}/start`) {
      state.startCalls += 1;
      if (!state.startedAt) state.startedAt = new Date(Date.now() - 10_000).toISOString();
      if (state.status === 'pending') state.status = 'in_progress';
      return route.fulfill({ json: { assignment: assignmentPayload(state), timer: timerPayload(state) }, headers: cors });
    }
    if (request.method() === 'GET' && url.pathname === `/api/writing/my-assignments/${ASSIGNMENT}`) {
      return route.fulfill({
        json: {
          assignment: assignmentPayload(state),
          draft: state.draftText ? { draft_text: state.draftText, word_count: state.draftText.trim().split(/\s+/).length } : null,
          timer: timerPayload(state),
        },
        headers: cors,
      });
    }
    if (request.method() === 'PATCH' && url.pathname === `/api/writing/my-assignments/${ASSIGNMENT}/draft`) {
      const text = String(body?.draft_text ?? '');
      state.draftCalls.push(text);
      state.draftText = text;
      if (state.status === 'pending') state.status = 'in_progress';
      return route.fulfill({ json: { assignment_id: ASSIGNMENT, draft_text: text }, headers: cors });
    }
    if (request.method() === 'POST' && url.pathname === `/api/writing/my-assignments/${ASSIGNMENT}/paste-log`) {
      return route.fulfill({ json: { ok: true }, headers: cors });
    }
    if (request.method() === 'POST' && url.pathname === `/api/writing/my-assignments/${ASSIGNMENT}/submit`) {
      state.submitCalls.push({ ...body });
      const ack = commitSubmission(state, body);
      if (!ack) return route.fulfill({ status: 409, json: { detail: 'request mismatch' }, headers: cors });
      return route.fulfill({ json: ack, headers: cors });
    }
    if (request.method() === 'GET' && url.pathname === `/api/writing/my-assignments/${ASSIGNMENT}/submission`) {
      if (state.status !== 'submitted') return route.fulfill({ status: 404, json: { detail: 'not committed' }, headers: cors });
      if (url.searchParams.get('request_id') !== state.requestId) {
        return route.fulfill({ status: 409, json: { detail: 'request mismatch' }, headers: cors });
      }
      return route.fulfill({ json: submissionAck(state, true), headers: cors });
    }
    if (url.pathname === '/api/analytics/events' || url.pathname === '/api/error-logs') {
      return route.fulfill({ status: 204, headers: cors });
    }
    return route.fulfill({
      status: 404,
      json: { detail: `fixture route missing: ${request.method()} ${url.pathname}` },
      headers: cors,
    });
  });

  return { calls, pageErrors, productionRequests };
}

async function openNext(page) {
  await page.goto('/writing/dashboard');
  await expect(page.getByRole('heading', { name: 'Canonical persistence' })).toBeVisible();
}

async function openLegacy(page) {
  await page.goto('/pages/writing-dashboard.html');
  await expect(page.getByRole('heading', { name: 'Canonical persistence' })).toBeVisible();
}

async function openComposer(page) {
  await page.locator(`.assignment-card[data-assignment-id="${ASSIGNMENT}"] .btn-start-assignment`).click();
  await expect(page.locator('#modal-essay-textarea')).toBeVisible();
}

async function expectNoHarnessErrors({ pageErrors, productionRequests }) {
  expect(pageErrors).toEqual([]);
  expect(productionRequests).toEqual([]);
}

module.exports = {
  ASSIGNMENT,
  ESSAY,
  JOB,
  OWNER,
  commitSubmission,
  cors,
  createWritingGateEState,
  expectNoHarnessErrors,
  installWritingGateEHarness,
  openComposer,
  openLegacy,
  openNext,
};
