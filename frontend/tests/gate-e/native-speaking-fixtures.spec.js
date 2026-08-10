// Gate E evidence: drive the hydrated native `/practice/session` route through
// each supported Speaking shape. Supabase, backend and third-party scripts are
// deterministic browser fixtures; no request leaves the Playwright process.
const { test, expect } = require('@playwright/test');

const API = 'http://localhost:8000';
const ORIGIN = 'http://localhost:3210';
const OWNER = '00000000-0000-4000-8000-0000000000aa';
const SID = '11111111-1111-4111-8111-111111111101';
const CHAIN_KEY = 'ielts_ft_session_ids';
const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.107.0/dist/umd/supabase.min.js';
const LUCIDE_CDN = 'https://unpkg.com/lucide@1.17.0';

const AUTH_SESSION = {
  access_token: 'gate-e-fake-token',
  refresh_token: 'gate-e-refresh',
  expires_at: 4_102_444_800,
  user: { id: OWNER, email: 'gate-e@test.local' },
};

const cors = {
  'access-control-allow-origin': ORIGIN,
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,x-request-id',
};

function question(id, part, text, extra = {}) {
  return {
    id,
    part,
    order_num: Number(id.replace(/\D/g, '')) || 1,
    question_text: text,
    ...extra,
  };
}

function partOneQuestions(count = 3) {
  return Array.from({ length: count }, (_, index) => question(
    `q${index + 1}`,
    1,
    `Question ${index + 1}?`,
    { subtopic: index < 3 ? 'Home' : index < 6 ? 'Work' : 'Hobbies' },
  ));
}

async function installHarness(page, { session, questions }) {
  const calls = [];
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.addInitScript((authSession) => {
    window.__GATE_E_AUTH_SESSION__ = authSession;
  }, AUTH_SESSION);

  // The product pins these scripts from CDNs. Replace only their network
  // transport; api.js and AuthProvider still use the real shared-client path.
  await page.route(SUPABASE_CDN, (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `window.supabase = {
      createClient: function () {
        var session = window.__GATE_E_AUTH_SESSION__;
        return { auth: {
          getSession: async function () { return { data: { session: session } }; },
          onAuthStateChange: function () {
            return { data: { subscription: { unsubscribe: function () {} } } };
          },
          signOut: async function () { return { error: null }; }
        } };
      }
    };`,
  }));
  await page.route(LUCIDE_CDN, (route) => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.lucide = { createIcons: function () {} };',
  }));
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());

  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    calls.push(`${request.method()} ${path}`);

    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: cors });
    }
    if (request.method() === 'GET' && path === `/sessions/${SID}`) {
      return route.fulfill({ json: session, headers: cors });
    }
    if (request.method() === 'GET' && path === `/sessions/${SID}/questions`) {
      return route.fulfill({ json: questions, headers: cors });
    }
    // Shell telemetry is intentionally non-blocking and unrelated to player
    // truth. Acknowledge it so fixture logs stay signal-only.
    if (path === '/api/analytics/events') {
      return route.fulfill({ status: 204, headers: cors });
    }
    return route.fulfill({ status: 404, json: { detail: 'fixture route missing' }, headers: cors });
  });

  await page.goto(`/practice/session?session_id=${SID}`);
  await expect(page.locator('#state-loading')).not.toHaveClass(/\bactive\b/);
  expect(pageErrors).toEqual([]);
  expect(calls.filter((call) => call === `GET /sessions/${SID}`)).toHaveLength(1);
  expect(calls.filter((call) => call === `GET /sessions/${SID}/questions`)).toHaveLength(1);
  return calls;
}

function baseSession(overrides = {}) {
  return {
    id: SID,
    session_id: SID,
    mode: 'practice',
    part: 1,
    topic: 'Home',
    status: 'in_progress',
    responses: [],
    ...overrides,
  };
}

test('practice boots into the native visual prep state', async ({ page }) => {
  await installHarness(page, {
    session: baseSession(),
    questions: partOneQuestions(3),
  });

  await expect(page.locator('#state-prep')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#prep-q-counter')).toHaveText('Câu 1 / 3');
  await expect(page.locator('#prep-q-text')).toHaveText('Question 1?');
  await expect(page.locator('#test-mode-banner')).toBeHidden();
});

test('test_part exposes exam progress but keeps the visual question', async ({ page }) => {
  await installHarness(page, {
    session: baseSession({ mode: 'test_part' }),
    questions: partOneQuestions(5),
  });

  await expect(page.locator('#state-prep')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#test-mode-banner')).toBeVisible();
  await expect(page.locator('#progress-bar-label')).toHaveText('Câu 1 / 5');
  await expect(page.locator('#prep-q-text')).toHaveText('Question 1?');
  await expect(page.locator('#prep-text-reveal')).toBeVisible();
});

test('test_full boots in listening mode and persists its canonical attempt identity', async ({ page }) => {
  await installHarness(page, {
    session: baseSession({
      mode: 'test_full',
      topic: 'Home|||Work|||Hobbies',
      full_test_attempt_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }),
    questions: partOneQuestions(9),
  });

  await expect(page.locator('#state-prep')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#test-mode-banner')).toBeVisible();
  await expect(page.locator('#progress-bar-label')).toContainText('Tổng: 1 / 15');
  await expect(page.locator('#prep-text-reveal')).toBeHidden();
  await expect(page.locator('#prep-reveal-btn')).toBeVisible();
  await expect.poll(() => page.evaluate((key) => (
    JSON.parse(window.sessionStorage.getItem(key) || 'null')
  ), CHAIN_KEY)).toEqual([SID]);
});

test('Part 2 renders the dedicated cue-card state', async ({ page }) => {
  await installHarness(page, {
    session: baseSession({ part: 2, topic: 'A useful skill' }),
    questions: [question('q1', 2, 'Describe a useful skill you learned.', {
      cue_card_bullets: ['what the skill is', 'how you learned it', 'why it is useful'],
      cue_card_reflection: 'and explain how it changed your daily life',
    })],
  });

  await expect(page.locator('#state-p2a')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#p2a-question')).toHaveText('Describe a useful skill you learned.');
  await expect(page.locator('#p2a-bullets li')).toHaveCount(3);
  await expect(page.locator('#p2a-reflection')).toContainText('changed your daily life');
});

test('class assignment renders the multi-question answer sheet from persisted truth', async ({ page }) => {
  await installHarness(page, {
    session: baseSession({
      class_assignment_item_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      class_task: { accepting: true, submitted_at: null },
      responses: [{
        id: 'r1',
        question_id: 'q1',
        grading_status: 'completed',
        overall_band: 6.5,
        feedback: { overall_band: 6.5 },
      }],
    }),
    questions: partOneQuestions(2),
  });

  await expect(page.locator('#state-sheet')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#sheet-slots .av-slot')).toHaveCount(2);
  await expect(page.locator('#sheet-meter-count')).toHaveText('Đã lưu 1/2');
  await expect(page.locator('#sheet-slots .av-slot').nth(0)).toHaveAttribute('data-state', 'saved');
  await expect(page.locator('#sheet-slots .av-slot').nth(1)).toHaveAttribute('data-state', 'idle');
  await expect(page.locator('#btn-sheet-submit')).toBeDisabled();
});

test('sealed mock resumes from response receipts without leaking result data', async ({ page }) => {
  await installHarness(page, {
    session: baseSession({
      mode: 'test_full',
      topic: 'Home|||Work|||Hobbies',
      sitting_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      full_test_attempt_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      results_sealed: true,
      responses: [],
      response_receipts: [{ id: 'sealed-r1', question_id: 'q1' }],
    }),
    questions: partOneQuestions(9),
  });

  await expect(page.locator('#state-prep')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#prep-q-counter')).toHaveText('Câu 2 / 9');
  await expect(page.locator('#prep-q-text')).toHaveText('Question 2?');
  await expect(page.locator('#state-feedback')).not.toHaveClass(/\bactive\b/);
  await expect(page.locator('body')).not.toContainText('6.5');
  await expect(page.locator('body')).not.toContainText('sealed-r1');
});
