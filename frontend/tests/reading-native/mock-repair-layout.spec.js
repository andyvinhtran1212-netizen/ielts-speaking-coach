const { test, expect } = require('@playwright/test');
const { cors, installReadingHarness } = require('./reading-native-harness');
const matching = require('../fixtures/reading-mock-repair-matching.json');
const contexts = require('../fixtures/reading-mock-repair-contexts.json');

for (const fixture of matching.cases) {
  for (const width of [360, 390, 768, 1180, 1440]) {
    test(`matching ${fixture.revised_uuid} Q${fixture.target} keeps all choices accessible at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 757 });
      const { calls } = await installReadingHarness(page, {
        route: `/reading/exam/session?test_id=${fixture.bundle.test_id}&admin_preview=1`,
        handleApi: async ({ route, url }) => {
          if (url.pathname === `/admin/reading/content/tests/${fixture.bundle.test_id}`) {
            await route.fulfill({ json: fixture.bundle, headers: cors }); return true;
          }
          return false;
        },
      });
      // A local `next dev` cache toast can cover the palette; it is absent in
      // the production build used by this suite's committed config.
      await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
      await page.locator(`.exam-palette button[data-q="${fixture.target}"]`).click();
      await expect.poll(() => page.evaluate(q => {
        const row = document.getElementById(`q-${q}`).getBoundingClientRect();
        const pane = document.querySelector('.exam-questions').getBoundingClientRect();
        return row.bottom > pane.top && row.top < pane.bottom;
      }, fixture.target)).toBe(true);
      const row = page.locator(`#q-${fixture.target}`);
      const targetQuestion = fixture.bundle.questions.find(q => q.q_num === fixture.target);
      const statement = row.getByRole('rowheader');
      await expect(statement).toContainText(targetQuestion.prompt);
      const bank = page.getByRole('complementary', { name: 'List of Features' });
      const region = page.getByRole('region', { name: /Lựa chọn câu/ });
      const geometry = await page.evaluate(({ q }) => {
        const bank = document.querySelector('.exam-features-box').getBoundingClientRect();
        const row = document.getElementById(`q-${q}`).getBoundingClientRect();
        const pane = document.querySelector('.exam-questions').getBoundingClientRect();
        return { bankBottom: bank.bottom, rowTop: row.top, rowBottom: row.bottom, paneTop: pane.top, paneBottom: pane.bottom, pageWidth: document.documentElement.scrollWidth };
      }, { q: fixture.target });
      expect(geometry.bankBottom).toBeLessThanOrEqual(geometry.rowTop);
      expect(geometry.rowBottom).toBeGreaterThan(geometry.paneTop);
      expect(geometry.rowTop).toBeLessThan(geometry.paneBottom);
      expect(geometry.pageWidth).toBeLessThanOrEqual(width);
      await expect(bank).toHaveCSS('position', 'static');
      await expect(region).toHaveAttribute('tabindex', '0');
      if (width === 1180) await page.screenshot({ path: `/tmp/reading-mock-repair-${fixture.target}-1180-statement.png` });
      for (const option of targetQuestion.payload.options) {
        const control = row.getByRole('radio', { name: `Question ${fixture.target}: ${option.label}` });
        await control.focus();
        const accessible = await control.evaluate(input => {
          const label = input.closest('label'); const rect = label.getBoundingClientRect();
          const wrap = input.closest('.reading-next-match-matrix-wrap').getBoundingClientRect();
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return { text: label.textContent.trim(), width: rect.width, height: rect.height,
            withinScrollRegion: rect.left >= wrap.left && rect.right <= wrap.right,
            pointerReachable: hit === label || label.contains(hit) };
        });
        expect(accessible.text).toBe(option.label);
        expect(accessible.width).toBeGreaterThanOrEqual(40);
        expect(accessible.height).toBeGreaterThanOrEqual(40);
        expect(accessible.withinScrollRegion).toBe(true);
        expect(accessible.pointerReachable).toBe(true);
        await control.check(); await expect(control).toBeChecked();
        await control.focus(); await control.press('Space'); await expect(control).toBeFocused();
      }
      if (width === 1180) await page.screenshot({ path: `/tmp/reading-mock-repair-${fixture.target}-1180-final-option.png` });
      expect(calls.filter(call => ['POST', 'PATCH', 'DELETE'].includes(call.method) && !call.path.includes('analytics'))).toEqual([]);
    });
  }
}

test('submitted Reading review renders the actual C13 R1 table as numbered blanks while retaining source, translation and solution', async ({ page }) => {
  const source = contexts.cases.find(item => item.revised_uuid === '6c8922a4-1a9e-47f2-9505-c3f9429a8a5a');
  const review = {
    status: 'submitted', attempt_id: 'numbered-context', test_id: source.test_id, title: 'C13 R1 submitted context',
    score: 0, max_score: 1, skill_breakdown: {}, context_source: { provenance: 'submission_snapshot', possibly_changed: false },
    passages: [{ passage_order: 1, title: 'New Zealand tourism', body_markdown: 'Original source passage.', translation_vi: 'Bản dịch nguồn vẫn được giữ.' }],
    review: [{ q_num: 1, passage_order: 1, question_type: 'table_completion', correct: false, user_answer: '', expected: 'update', prompt: '(see summary above)',
      question_context: source.context,
      solution: { steps: 'Định vị thông tin trong bảng.', source_excerpt: 'Businesses were able to update the details they gave on a regular basis.' } }],
  };
  await installReadingHarness(page, {
    route: '/reading/review?attempt_id=numbered-context',
    handleApi: async ({ route, url }) => {
      if (url.pathname.endsWith('/attempts/numbered-context/review')) { await route.fulfill({ json: review, headers: cors }); return true; }
      return false;
    },
  });
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.getByRole('button', { name: 'Câu 1 — bỏ trống', exact: true }).click();
  const context = page.getByRole('region', { name: 'Ngữ cảnh câu hỏi' });
  // The component is a labelled section; browsers expose it as a region.
  await expect(context.getByRole('table')).toBeVisible();
  for (const q of [1, 2, 3, 4, 5, 6, 7]) await expect(context.getByLabel(`Chỗ trống câu ${q}`)).toHaveCount(1);
  await expect(context).not.toContainText(/\{\{\s*\d+\s*\}\}/);
  await expect(page.getByText('Định vị thông tin trong bảng.')).toBeVisible();
  await expect(page.getByText('Businesses were able to update the details they gave on a regular basis.')).toBeVisible();
  await page.screenshot({ path: '/tmp/reading-mock-repair-submitted-context.png' });
  await page.getByRole('button', { name: 'Bài dịch', exact: true }).click();
  await expect(page.getByText('Bản dịch nguồn vẫn được giữ.')).toBeVisible();
});
