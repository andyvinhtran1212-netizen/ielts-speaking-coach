const { test, expect } = require('@playwright/test');
const { cors, installReadingHarness } = require('./reading-native-harness');
const bundle = require('../fixtures/reading-b13t2-staging-player.json');

// PC-J127 re-check of CM batch 3 on ILR-RDG-CAM-B13-T2 (staging content):
// C13R2-02 "column headings covered" and C13R2-05 "review marks lost on reload".
const OWNER_A = '00000000-0000-4000-8000-0000000000bb';
const OWNER_B = '00000000-0000-4000-8000-0000000000cc';
const ATTEMPT_A1 = '27a00000-0000-4000-8000-000000000001';
const ATTEMPT_A2 = '27a00000-0000-4000-8000-000000000002';
const ATTEMPT_B = '27b00000-0000-4000-8000-000000000001';
const AUTH_KEY = 'aver:qa-pcj127-auth';
const SCOPE = { protocol: 'question-cas-v1' };
const FLAGS_PATH = /^\/api\/reading\/test\/attempts\/([^/]+)\/review-flags$/;

/** In-memory Reading backend: per-owner current attempt, per-attempt CAS flag rows. */
function readingServer() {
  const state = {
    owner: OWNER_A,
    current: new Map([[OWNER_A, ATTEMPT_A1], [OWNER_B, ATTEMPT_B]]),
    attemptOwner: new Map([[ATTEMPT_A1, OWNER_A], [ATTEMPT_A2, OWNER_A], [ATTEMPT_B, OWNER_B]]),
    flags: new Map(),
    nextAttempt: [ATTEMPT_A2],
    failWrites: false,
  };
  const rows = (attemptId) => {
    if (!state.flags.has(attemptId)) state.flags.set(attemptId, new Map());
    return state.flags.get(attemptId);
  };
  const row = (attemptId, qNum) => rows(attemptId).get(qNum)
    || { q_num: qNum, question_id: `b13t2-question-${qNum}`, flagged: false, revision: 0, updated_at: null };
  const flaggedOn = (attemptId) => [...rows(attemptId).values()].filter((r) => r.flagged).map((r) => r.q_num).sort((a, b) => a - b);
  const handleApi = async ({ route, request, url }) => {
    const method = request.method();
    if (url.pathname === `/api/reading/test/${bundle.test_id}/boot`) {
      const attemptId = state.current.get(state.owner);
      await route.fulfill({ json: { test: bundle, in_progress: attemptId ? {
        attempt_id: attemptId, started_at: new Date().toISOString(), time_limit_minutes: 60, renderer_affinity: 'next', answers: [],
      } : null }, headers: cors });
      return true;
    }
    if (url.pathname === `/api/reading/test/${bundle.test_id}/attempts` && method === 'POST') {
      const attemptId = state.nextAttempt.shift();
      state.current.set(state.owner, attemptId);
      await route.fulfill({ json: { attempt_id: attemptId, renderer_affinity: 'next' }, headers: cors });
      return true;
    }
    const match = url.pathname.match(FLAGS_PATH);
    if (!match) return false;
    const attemptId = decodeURIComponent(match[1]);
    if (state.attemptOwner.get(attemptId) !== state.owner) {
      await route.fulfill({ status: 403, json: { detail: 'Không có quyền với lượt làm này.' }, headers: cors });
      return true;
    }
    if (method === 'GET') {
      await route.fulfill({ json: { ...SCOPE, attempt_id: attemptId, review_flags: [...rows(attemptId).values()] }, headers: cors });
      return true;
    }
    if (method === 'PATCH') {
      if (state.failWrites) {
        await route.fulfill({ status: 503, json: { detail: 'Chưa xác nhận lưu dấu xem lại.' }, headers: cors });
        return true;
      }
      const body = request.postDataJSON();
      const previous = row(attemptId, body.q_num);
      let reply;
      if (previous.operation_id === body.operation_id) reply = { ...previous, accepted: true, reason: 'replayed' };
      else if (previous.revision !== body.expected_revision) reply = { ...previous, accepted: false, reason: 'conflict' };
      else {
        const next = { ...previous, flagged: body.flagged, revision: previous.revision + 1, operation_id: body.operation_id, updated_at: new Date().toISOString() };
        rows(attemptId).set(body.q_num, next);
        reply = { ...next, accepted: true, reason: 'applied' };
      }
      await route.fulfill({ json: { ...SCOPE, ...reply, attempt_id: attemptId }, headers: cors });
      return true;
    }
    return false;
  };
  return { state, handleApi, flaggedOn };
}

async function openPlayer(page, server, { width = 1280 } = {}) {
  await page.setViewportSize({ width, height: width < 640 ? 780 : 800 });
  const harness = await installReadingHarness(page, {
    bundle, authOwner: OWNER_A, authStateKey: AUTH_KEY,
    route: `/reading/exam/session?test_id=${bundle.test_id}`,
    handleApi: server.handleApi,
  });
  // A local `next dev` cache toast can cover the palette; absent in production builds.
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  return harness;
}

async function resume(page) {
  await page.getByRole('button', { name: 'Resume test' }).click();
  await expect(page.locator('.exam-review-flag-status')).toHaveCount(0);
}

async function showQuestion(page, qNum) {
  const part = bundle.questions.find((q) => q.q_num === qNum).passage_order;
  await page.getByRole('navigation', { name: 'Question palette' }).getByRole('button', { name: new RegExp(`^Part ${part}\\b`) }).click();
  await page.locator(`.exam-palette button[data-q="${qNum}"]`).click();
}

// Every renderer B13-T2 uses for a Review control: inline note gap (Q3),
// TFNG card (Q11), matching_features matrix rows (Q18, Q35), MCQ card (Q27).
const FLAG_TARGETS = [3, 11, 18, 27, 35];
const flagControl = (page, qNum) => page.getByRole('button', { name: new RegExp(`^(Flag|Mark) question ${qNum} for review$`) });

async function expectFlags(page, flagged, unflagged) {
  for (const qNum of flagged) {
    await showQuestion(page, qNum);
    await expect(flagControl(page, qNum)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(`.exam-palette button[data-q="${qNum}"]`)).toHaveClass(/\bis-flagged\b/);
  }
  for (const qNum of unflagged) {
    await showQuestion(page, qNum);
    await expect(flagControl(page, qNum)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator(`.exam-palette button[data-q="${qNum}"]`)).not.toHaveClass(/\bis-flagged\b/);
  }
}

test.describe('C13R2-05 B13-T2 review marks', () => {
  test('saved marks on every B13-T2 renderer survive reload and stay on their attempt', async ({ page }) => {
    const server = readingServer();
    const { calls } = await openPlayer(page, server);
    await resume(page);
    for (const qNum of FLAG_TARGETS) {
      await showQuestion(page, qNum);
      await flagControl(page, qNum).click();
    }
    await expect.poll(() => server.flaggedOn(ATTEMPT_A1)).toEqual(FLAG_TARGETS);
    // Un-flag one so reload has to honour an explicit false tombstone too.
    await showQuestion(page, 11);
    await flagControl(page, 11).click();
    await expect.poll(() => server.flaggedOn(ATTEMPT_A1)).toEqual([3, 18, 27, 35]);
    await expect(page.locator('.exam-review-flag-status')).toHaveCount(0);

    await page.reload();
    await resume(page);
    await expectFlags(page, [3, 18, 27, 35], [11, 1, 20]);
    const flagReads = calls.filter((call) => call.method === 'GET' && FLAGS_PATH.test(call.path));
    expect(flagReads.length).toBeGreaterThanOrEqual(2);
    expect(flagReads.every((call) => call.path.includes(ATTEMPT_A1))).toBe(true);

    // A replacement attempt starts with no marks; the old attempt keeps its own.
    page.once('dialog', (dialog) => dialog.accept());
    await page.reload();
    await page.getByRole('button', { name: 'Start a new attempt' }).click();
    await expect(page.locator('.exam-review-flag-status')).toHaveCount(0);
    await expectFlags(page, [], FLAG_TARGETS);
    await page.reload();
    await resume(page);
    await expectFlags(page, [], FLAG_TARGETS);
    expect(server.flaggedOn(ATTEMPT_A2)).toEqual([]);
    expect(server.flaggedOn(ATTEMPT_A1)).toEqual([3, 18, 27, 35]);
    expect(calls.filter((call) => call.method === 'PATCH' && call.path.includes(ATTEMPT_A2))).toEqual([]);
  });

  test('a mark toggled immediately before reload is not dropped', async ({ page }) => {
    const server = readingServer();
    const { calls } = await openPlayer(page, server);
    await resume(page);
    await showQuestion(page, 18);
    await flagControl(page, 18).click();
    // No wait for the 100 ms save debounce: the pagehide flush or the
    // tab-scoped pending receipt must carry the mark across the reload.
    await page.reload();
    await page.getByRole('button', { name: 'Resume test' }).click();
    // Either the keepalive flush landed, or the restored receipt is shown as
    // unsaved with "Thử lại"; both keep the mark and replay one operation.
    const retry = page.locator('.exam-review-flag-status').getByRole('button', { name: 'Thử lại' });
    await expect.poll(async () => {
      if (await retry.isVisible()) await retry.click();
      return server.flaggedOn(ATTEMPT_A1);
    }).toEqual([18]);
    expect(new Set(calls.filter((call) => call.method === 'PATCH').map((call) => call.body.operation_id)).size).toBe(1);
    await expect(page.locator('.exam-review-flag-status')).toHaveCount(0);
    await expectFlags(page, [18], [19]);
  });

  test('switching account in the same tab does not carry marks or pending receipts across', async ({ page }) => {
    const server = readingServer();
    const { calls } = await openPlayer(page, server);
    await resume(page);
    await showQuestion(page, 3);
    await flagControl(page, 3).click();
    await expect.poll(() => server.flaggedOn(ATTEMPT_A1)).toEqual([3]);
    // Leave an unsaved receipt for A in this tab's sessionStorage.
    server.state.failWrites = true;
    await showQuestion(page, 18);
    await flagControl(page, 18).click();
    await expect(page.locator('.exam-review-flag-status')).toContainText('Chưa lưu được đánh dấu xem lại ở 1 câu');
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('aver:review-flags:')))).toEqual(
      [`aver:review-flags:${OWNER_A}:reading:${ATTEMPT_A1}`],
    );

    server.state.failWrites = false;
    server.state.owner = OWNER_B;
    await page.evaluate((owner) => window.__emitReadingNativeAuth({
      access_token: 'reading-native-token', refresh_token: 'refresh', expires_at: 4_102_444_800,
      user: { id: owner, email: 'reading-native-b@test.local' },
    }), OWNER_B);
    await page.getByRole('button', { name: 'Resume test' }).click();
    await expect(page.locator('.exam-review-flag-status')).toHaveCount(0);
    await expectFlags(page, [], [3, 18]);
    expect(server.flaggedOn(ATTEMPT_B)).toEqual([]);
    expect(calls.filter((call) => call.method === 'PATCH' && call.path.includes(ATTEMPT_B))).toEqual([]);
    expect(server.flaggedOn(ATTEMPT_A1)).toEqual([3]);
  });
});

// C13R2-02: no heading in either pane may be painted over by another element
// (palette, part strip, feature bank, neighbouring row). Below a 640 px
// question pane the matrix header row is intentionally screen-reader-only
// (#1685) and every cell shows its letter instead; that is asserted too.
for (const width of [360, 390, 1280]) {
  test(`C13R2-02 B13-T2 headings stay uncovered at ${width}`, async ({ page }) => {
    const server = readingServer();
    await openPlayer(page, server, { width });
    await resume(page);
    for (const part of [1, 2, 3]) {
      await page.getByRole('navigation', { name: 'Question palette' }).getByRole('button', { name: new RegExp(`^Part ${part}\\b`) }).click();
      const report = await page.evaluate(async () => {
        const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const srOnly = (el) => [el, ...(el.closest('thead') ? [el.closest('thead')] : [])]
          .some((node) => getComputedStyle(node).clipPath !== 'none');
        const selector = 'main :is(h1, h2, h3, h4, th, .exam-questions__part-heading, .exam-questions__group-title, .exam-questions__instructions, .exam-features-box p, .exam-features-box li)';
        const covered = [];
        const visibleHeaders = [];
        let measured = 0;
        for (const el of document.querySelectorAll(selector)) {
          if (!el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
          if (srOnly(el)) continue;
          if (el.closest('thead')) visibleHeaders.push(el.textContent.trim());
          for (const block of ['start', 'center', 'end']) {
            el.scrollIntoView({ block, inline: 'nearest' });
            await frame();
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) continue;
            // Sample only the part its scroll containers actually show: a
            // heading taller than the small mobile pane is scrolled, not covered.
            let top = Math.max(r.top, 0);
            let bottom = Math.min(r.bottom, innerHeight);
            for (let node = el.parentElement; node; node = node.parentElement) {
              if (getComputedStyle(node).overflowY === 'visible') continue;
              const clip = node.getBoundingClientRect();
              top = Math.max(top, clip.top + node.clientTop);
              bottom = Math.min(bottom, clip.top + node.clientTop + node.clientHeight);
            }
            if (bottom - top < 4) continue;
            measured += 1;
            const y = top + Math.min((bottom - top) / 2, 12);
            for (const x of [r.left + Math.min(6, r.width / 2), r.left + r.width / 2, r.right - Math.min(6, r.width / 2)]) {
              const hit = x >= 0 && y >= 0 && x < innerWidth && y < innerHeight ? document.elementFromPoint(x, y) : null;
              if (!hit || (!el.contains(hit) && !hit.contains(el))) {
                covered.push({ block, heading: el.textContent.trim().slice(0, 50), by: hit ? `${hit.tagName}.${hit.className}` : 'off-screen' });
                break;
              }
            }
          }
        }
        const matrices = [...document.querySelectorAll('.reading-next-match-matrix')].map((table) => ({
          wrapWidth: table.parentElement.getBoundingClientRect().width,
          headerHidden: getComputedStyle(table.tHead).clipPath !== 'none',
          cellLetters: [...table.querySelectorAll('tbody tr')].every((tr) => [...tr.querySelectorAll('.reading-next-matrix-letter')]
            .every((letter) => letter.getBoundingClientRect().width > 0 && getComputedStyle(letter).visibility !== 'hidden')),
          scrollOverflow: table.parentElement.scrollWidth - table.parentElement.clientWidth,
        }));
        return { measured, covered, visibleHeaders, matrices, pageOverflow: document.documentElement.scrollWidth - innerWidth };
      });
      expect(report.measured, `part ${part} measured headings`).toBeGreaterThan(3);
      expect(report.covered, `part ${part} covered headings`).toEqual([]);
      expect(report.pageOverflow).toBeLessThanOrEqual(0);
      for (const matrix of report.matrices) {
        expect(matrix.scrollOverflow).toBeLessThanOrEqual(0);
        if (matrix.headerHidden) {
          expect(matrix.wrapWidth).toBeLessThanOrEqual(640);
          expect(matrix.cellLetters).toBe(true);
        }
      }
      expect(report.matrices.length).toBe(part === 1 ? 0 : 1);
      await page.screenshot({ path: `/tmp/pcj127-b13t2-${width}-part${part}.png` });
    }
  });
}
