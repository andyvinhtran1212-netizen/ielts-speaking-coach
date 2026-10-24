const { test, expect } = require('@playwright/test');
const { ATTEMPT, cors, installReadingHarness } = require('./reading-native-harness');
const fixture = require('../fixtures/cam19-audit-regressions.json');
const paper = questions => ({ test_id: 'RD-NATIVE-1', title: 'Cam19 captured audit context', time_limit_minutes: 60,
  total_questions: questions.length, passages: [{ passage_order: 1, title: 'Cam19 source', body_markdown: 'Source paragraph. '.repeat(200) }],
  questions: questions.map(q => ({ ...q, passage_order: 1 })) });

for (const width of [1180, 390]) {
  test(`Cam19 T4 matrix retains full stems and A–E together at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 757 });
    const bundle = paper(fixture.reading_matrix);
    await installReadingHarness(page, { bundle, route: '/reading/exam/session?test_id=RD-NATIVE-1&admin_preview=1', handleApi: async ({ route, url }) => {
      if (url.pathname === '/admin/reading/content/tests/RD-NATIVE-1') { await route.fulfill({ json: bundle, headers: cors }); return true; } return false;
    } });
    const row = page.locator('#q-21'); await row.scrollIntoViewIfNeeded();
    await expect(row).toContainText(fixture.reading_matrix.find(q => q.q_num === 21).prompt);
    for (const letter of ['A', 'B', 'C', 'D', 'E']) {
      const control = row.getByRole('radio', { name: `Question 21: ${letter}`, exact: true });
      await control.check(); await expect(control).toBeChecked();
      expect(await control.evaluate(input => {
        const box = input.closest('label').getBoundingClientRect(); const wrap = input.closest('.reading-next-match-matrix-wrap').getBoundingClientRect();
        return box.left >= wrap.left && box.right <= wrap.right;
      })).toBe(true);
    }
    expect(await page.locator('.reading-next-match-matrix-wrap').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath(`cam19-matrix-${width}.png`) });
  });

  test(`Cam19 review target clears the variable sticky header at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 757 });
    const review = { status: 'submitted', attempt_id: ATTEMPT, title: 'Cam19 review offset', score: 20, max_score: 20,
      passages: [{ passage_order: 1, body_markdown: 'Source paragraph.' }], skill_breakdown: {},
      review: Array.from({ length: 20 }, (_, i) => ({ q_num: i + 1, correct: true, expected: 'D', user_answer: 'D', passage_order: 1,
        prompt: 'What does the source explain about the response?', solution: { steps: 'Inspect the source evidence. '.repeat(15) } })) };
    await installReadingHarness(page, { route: `/reading/review?attempt_id=${ATTEMPT}`, handleApi: async ({ route, url }) => {
      if (url.pathname.endsWith(`/attempts/${ATTEMPT}/review`)) { await route.fulfill({ json: review, headers: cors }); return true; } return false;
    } });
    await page.getByRole('button', { name: 'Câu 14 — đúng', exact: true }).click();
    await expect.poll(() => page.locator('#reading-review-q-14').evaluate(el => el.getBoundingClientRect().top - document.querySelector('.rr-review-header').getBoundingClientRect().bottom)).toBeGreaterThanOrEqual(8);
    await page.screenshot({ path: info.outputPath(`cam19-review-offset-${width}.png`) });
    await page.setViewportSize({ width: width === 390 ? 1180 : 390, height: 757 });
    await page.getByRole('button', { name: 'Câu 16 — đúng', exact: true }).click();
    await expect.poll(() => page.locator('#reading-review-q-16').evaluate(el => el.getBoundingClientRect().top - document.querySelector('.rr-review-header').getBoundingClientRect().bottom)).toBeGreaterThanOrEqual(8);
  });
}

test('Cam19 inline pending status occupies layout space during a slow save', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 757 });
  const bundle = paper(fixture.reading_inline);
  let release; const pending = new Promise(resolve => { release = resolve; });
  await installReadingHarness(page, { bundle,
    inProgress: { attempt_id: ATTEMPT, started_at: new Date().toISOString(), time_limit_minutes: 60, answers: [], renderer_affinity: 'next' },
    handleApi: async ({ route, request, url }) => {
      if (request.method() === 'PATCH' && url.pathname.endsWith('/answers')) { await pending; await route.fulfill({ json: { attempt_id: ATTEMPT, answered: 1 }, headers: cors }); return true; } return false;
    } });
  await page.getByRole('button', { name: 'Resume test', exact: true }).click();
  await page.getByLabel('Answer 12', { exact: true }).fill('copolyester');
  const hint = page.locator('#q-12 .reading-next-gap-save'); await expect(hint).toBeVisible();
  const rect = await hint.evaluate(el => { const a = el.getBoundingClientRect(); const b = el.closest('.reading-next-flow-gap').getBoundingClientRect(); return { top: a.top, bottom: a.bottom, parentTop: b.top, parentBottom: b.bottom, position: getComputedStyle(el).position }; });
  expect(rect.position).toBe('static'); expect(rect.top).toBeGreaterThanOrEqual(rect.parentTop); expect(rect.bottom).toBeLessThanOrEqual(rect.parentBottom + 1);
  release(); await expect(hint).toHaveCount(0);
});

test('Listening pending palette digits retain readable contrast in both themes', async ({ page }) => {
  const bundle = { id: 'LS-UI', title: 'Cam19 contrast', audio_url: 'https://audio.fixture.test/cam19.mp3',
    sections: [{ section_num: 4, exercises: [fixture.listening_t4] }] };
  await installReadingHarness(page, { route: '/listening/test/session?id=LS-UI&admin_preview=1', handleApi: async ({ route, url }) => {
    if (url.pathname === '/admin/listening/tests/LS-UI/player-preview') { await route.fulfill({ json: bundle, headers: cors }); return true; } return false;
  } });
  await expect(page.locator('.progress-square').first()).toBeAttached();
  for (const theme of ['light', 'dark']) {
    // Measure the pending CSS state on the real rendered control. Persistence
    // and queue transitions are covered by the existing lifecycle suites.
    const ratio = await page.evaluate(theme => {
      document.documentElement.dataset.theme = theme;
      const el = document.querySelector('.progress-square'); el.classList.add('is-unsaved');
      const rgb = value => value.match(/[\d.]+/g).map(Number);
      let bg = [255, 255, 255];
      const ancestors = []; for (let node = el; node; node = node.parentElement) ancestors.unshift(node);
      for (const node of ancestors) { const c = rgb(getComputedStyle(node).backgroundColor); const alpha = c[3] ?? 1; bg = c.slice(0, 3).map((v, i) => v * alpha + bg[i] * (1 - alpha)); }
      const luminance = channels => channels.map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
      const a = luminance(rgb(getComputedStyle(el).color).slice(0, 3)), b = luminance(bg);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    }, theme);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  }
});
