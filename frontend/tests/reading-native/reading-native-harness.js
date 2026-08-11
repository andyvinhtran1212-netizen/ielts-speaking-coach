const { expect } = require('@playwright/test');

const API = 'http://localhost:8000';
const ORIGIN = 'http://localhost:3211';
const OWNER = '00000000-0000-4000-8000-0000000000bb';
const ATTEMPT = '11111111-1111-4111-8111-111111111111';
const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.107.0/dist/umd/supabase.min.js';
const LUCIDE_CDN = 'https://unpkg.com/lucide@1.17.0';

const cors = {
  'access-control-allow-origin': ORIGIN,
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,x-reading-anon,x-reading-password,x-request-id',
};

function testBundle() {
  return {
    test_id: 'RD-NATIVE-1',
    title: 'Native Reading fixture',
    module: 'academic',
    time_limit_minutes: 60,
    total_questions: 3,
    passages: [{
      id: 'p1', passage_order: 1, title: 'A short passage',
      body_markdown: 'Paragraph A explains the **first idea**.',
    }],
    questions: [
      { q_num: 1, passage_order: 1, question_type: 'short_answer', prompt: 'What idea is explained?' },
      { q_num: 2, passage_order: 1, question_type: 'true_false_not_given', prompt: 'The passage has an idea.' },
      { q_num: 3, passage_order: 1, question_type: 'mcq_single', prompt: 'Choose one.', payload: { options: [{ label: 'A', text: 'First' }, { label: 'B', text: 'Second' }] } },
    ],
  };
}

function completionBundle() {
  const summaryPayload = (summary_text, extra = {}) => ({
    word_limit: 'ONE WORD ONLY', template: { summary_text }, ...extra,
  });
  return {
    test_id: 'RD-NATIVE-1', title: 'Completion fidelity fixture', module: 'academic',
    time_limit_minutes: 60, total_questions: 14,
    passages: [{ id: 'p1', passage_order: 1, title: 'Completion passage', body_markdown: 'Completion context.' }],
    questions: [
      { q_num: 1, passage_order: 1, question_type: 'sentence_completion', prompt: '(see summary above)', payload: summaryPayload('Sentence {{1}}\n• detail {{2}}') },
      { q_num: 2, passage_order: 1, question_type: 'sentence_completion', prompt: '(see summary above)' },
      { q_num: 3, passage_order: 1, question_type: 'summary_completion', prompt: '(see summary above)', payload: summaryPayload('Summary {{3}} continues with {{4}}.', { options: [{ label: 'A', text: 'alpha' }, { label: 'B', text: 'beta' }] }) },
      { q_num: 4, passage_order: 1, question_type: 'summary_completion', prompt: '(see summary above)' },
      { q_num: 5, passage_order: 1, question_type: 'notes_completion', prompt: '(see summary above)', payload: summaryPayload('Notes\n• first {{5}}\n• second {{6}}') },
      { q_num: 6, passage_order: 1, question_type: 'notes_completion', prompt: '(see summary above)' },
      { q_num: 7, passage_order: 1, question_type: 'table_completion', prompt: '(see summary above)', payload: summaryPayload('Column A | Column B\n{{7}} | {{8}}') },
      { q_num: 8, passage_order: 1, question_type: 'table_completion', prompt: '(see summary above)' },
      { q_num: 9, passage_order: 1, question_type: 'form_completion', prompt: '(see summary above)', payload: summaryPayload('Form\nName: {{9}}\nCode: {{10}}') },
      { q_num: 10, passage_order: 1, question_type: 'form_completion', prompt: '(see summary above)' },
      { q_num: 11, passage_order: 1, question_type: 'flow_chart_completion', prompt: '(see summary above)', payload: summaryPayload('Start {{11}}\n↓\nFinish {{12}}') },
      { q_num: 12, passage_order: 1, question_type: 'flow_chart_completion', prompt: '(see summary above)' },
      { q_num: 13, passage_order: 1, question_type: 'diagram_label_completion', prompt: 'First callout', payload: { word_limit: 'ONE WORD ONLY', image_url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==' } },
      { q_num: 14, passage_order: 1, question_type: 'diagram_label_completion', prompt: 'Second callout' },
    ],
  };
}

async function installReadingHarness(page, {
  signedIn = true,
  inProgress = null,
  handleApi = null,
  route = '/reading/exam/session?test_id=RD-NATIVE-1',
  bundle = testBundle(),
} = {}) {
  const calls = [];
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(({ owner, signedIn }) => {
    window.__READING_NATIVE_SESSION__ = signedIn ? {
      access_token: 'reading-native-token', refresh_token: 'refresh', expires_at: 4_102_444_800,
      user: { id: owner, email: 'reading-native@test.local' },
    } : null;
  }, { owner: OWNER, signedIn });

  await page.route(SUPABASE_CDN, (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `window.supabase={createClient:function(){var session=window.__READING_NATIVE_SESSION__;return{auth:{getSession:async function(){return{data:{session:session}}},onAuthStateChange:function(){return{data:{subscription:{unsubscribe:function(){}}}}},signOut:async function(){return{error:null}}}}}};`,
  }));
  await page.route(LUCIDE_CDN, (route) => route.fulfill({
    contentType: 'application/javascript', body: 'window.lucide={createIcons:function(){}};',
  }));
  await page.route('https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js', (route) => route.fulfill({
    contentType: 'application/javascript', body: 'window.marked={parse:function(s){return "<p>"+s+"</p>"}};',
  }));
  await page.route('https://cdn.jsdelivr.net/npm/dompurify@3.4.8/dist/purify.min.js', (route) => route.fulfill({
    contentType: 'application/javascript', body: 'window.DOMPurify={sanitize:function(s){return s}};',
  }));
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());

  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const entry = {
      method: request.method(), path: url.pathname, headers: request.headers(),
      body: request.postDataJSON?.() ?? null,
    };
    calls.push(entry);
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (handleApi && await handleApi({ route, request, url, entry, calls })) return;
    if (url.pathname === '/api/reading/test/RD-NATIVE-1/boot') {
      return route.fulfill({ json: { test: bundle, in_progress: inProgress }, headers: cors });
    }
    if (url.pathname === '/api/analytics/events') return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({ status: 404, json: { detail: `${request.method()} ${url.pathname}` }, headers: cors });
  });

  await page.goto(route);
  await expect(page.locator('body')).not.toContainText('Đang tải bài thi…');
  expect(pageErrors).toEqual([]);
  return { calls, pageErrors };
}

module.exports = { API, ATTEMPT, completionBundle, cors, installReadingHarness, testBundle };
