const { test, expect } = require('@playwright/test');
const { cors, installReadingHarness } = require('./reading-native-harness');

const standfirst = 'Between two dates, the sisters assembled a substantial collection of paintings that would later become an important public collection for people throughout their country.';
const paragraphs = ['A', 'B', 'C', 'D', 'E', 'F'].map(label => `${label} This paragraph discusses the collection and its history. ` + 'The evidence is available in the text. '.repeat(12)).join('\n\n');
const reading = {
  test_id: 'RD-NATIVE-1', title: 'Full Reading layout', time_limit_minutes: 60, total_questions: 40,
  passages: [1, 2, 3].map(part => ({ passage_order: part, title: `Passage title ${part}`, body_markdown: part === 1 ? `*${standfirst}* The opening paragraph begins here.\n\n${paragraphs}` : paragraphs })),
  questions: Array.from({ length: 40 }, (_, i) => ({ q_num: i + 1, passage_order: i < 13 ? 1 : i < 26 ? 2 : 3, question_type: 'short_answer', prompt: `Answer question ${i + 1}.` })),
};
const listening = {
  id: 'LS-UI', test_id: 'LS-UI', title: 'Full Listening layout', test_type: 'full', audio_url: 'https://audio.fixture/recording.wav',
  sections: [1, 2, 3, 4].map(part => ({ section_num: part, exercises: [{ id: `ex-${part}`, exercise_type: 'dictation', payload: {
    template_kind: 'form_completion', instruction: 'Write ONE WORD for each answer.',
    questions: Array.from({ length: 10 }, (_, i) => ({ q_num: (part - 1) * 10 + i + 1, prompt: 'Collection ____' })),
    template: { heading: 'Collection information', rows: Array.from({ length: 10 }, (_, i) => ({ label: `Detail ${i + 1}`, q_num: (part - 1) * 10 + i + 1 })) },
  } }] })),
};

async function openPreview(page, skill, readingPaper = reading) {
  await page.route('https://audio.fixture/**', route => route.abort());
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () { this.dispatchEvent(new Event('play')); return Promise.resolve(); };
  });
  return installReadingHarness(page, {
    realMarkdown: true, bundle: readingPaper,
    route: skill === 'reading' ? '/reading/exam/session?test_id=RD-NATIVE-1&admin_preview=1' : '/listening/test/session?id=LS-UI&admin_preview=1',
    handleApi: async ({ route, url }) => {
      if (url.pathname === '/admin/reading/content/tests/RD-NATIVE-1') { await route.fulfill({ json: readingPaper, headers: cors }); return true; }
      if (url.pathname === '/admin/listening/tests/LS-UI/player-preview') { await route.fulfill({ json: listening, headers: cors }); return true; }
      return false;
    },
  });
}

test('Cambridge 21 Test 1 source: standfirst, paragraph labels and all three passages', async ({ page }, testInfo) => {
  test.skip(!process.env.EXAM_READING_PAPER, 'Optional private source fixture; never committed.');
  const source = JSON.parse(require('node:fs').readFileSync(process.env.EXAM_READING_PAPER, 'utf8'));
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await openPreview(page, 'reading', { ...source.definition, test_id: 'RD-NATIVE-1' });
  await page.addStyleTag({ content: 'nextjs-portal { display: none; }' });
  await expect(page.getByRole('heading', { name: 'The Davies Sisters', exact: true })).toBeVisible();
  await expect(page.locator('.reading-next-standfirst')).toContainText('Between 1908 and 1924');
  await expect(page.locator('.reading-next-standfirst + p')).toContainText('Gwendoline (1882');
  await page.screenshot({ path: testInfo.outputPath('cam21-test1-passage1.png') });
  const palette = page.getByRole('navigation', { name: 'Question palette' });
  await palette.getByRole('button', { name: /^Part 2/ }).click();
  await expect(page.locator('.reading-next-paragraph-label')).toHaveText(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  await page.screenshot({ path: testInfo.outputPath('cam21-test1-passage2.png') });
  await palette.getByRole('button', { name: /^Part 3/ }).click();
  await expect(page.getByRole('heading', { name: /Book review: The World of Sugar/ })).toBeVisible();
  expect(state.pageErrors).toEqual([]);
});

for (const skill of ['reading', 'listening']) {
  for (const width of [1440, 1180, 820, 390]) {
    test(`${skill} full test: parts, answers, review and layout at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : width === 1180 ? 768 : 900 });
      const state = await openPreview(page, skill);
      await page.addStyleTag({ content: 'nextjs-portal { display: none; }' });
      if (skill === 'listening') await page.getByRole('dialog', { name: 'Check your headphones' }).getByRole('button', { name: /Play/ }).click();
      const palette = page.getByRole('navigation', { name: 'Question palette' });
      await expect(palette).toBeVisible();
      await expect(page.getByRole('region', { name: 'Part 1', exact: true })).toBeVisible();
      const partButtons = palette.getByRole('button', { name: /^Part \d/ });
      await expect(partButtons).toHaveCount(skill === 'reading' ? 3 : 4);
      await expect(partButtons.nth(0)).toHaveAttribute('aria-expanded', 'true');
      if (skill === 'reading') {
        await expect(page.locator('.reading-next-standfirst')).toHaveText(standfirst);
        await expect(page.locator('.reading-next-standfirst + p')).toHaveText('The opening paragraph begins here.');
        await expect(page.locator('.reading-next-paragraph-label')).toHaveText(['A', 'B', 'C', 'D', 'E', 'F']);
        const weights = await page.locator('.reading-next-paragraph-label').first().evaluate(el => ({ label: parseFloat(getComputedStyle(el).fontSize), body: parseFloat(getComputedStyle(el.parentElement).fontSize), weight: getComputedStyle(el).fontWeight }));
        expect(weights.label).toBeGreaterThan(weights.body);
        expect(Number(weights.weight)).toBeGreaterThanOrEqual(700);
        await page.screenshot({ path: testInfo.outputPath(`reading-intro-${width}.png`) });
      }
      const lastPart = skill === 'reading' ? 3 : 4;
      await partButtons.nth(lastPart - 1).click();
      await expect(page.getByRole('region', { name: `Part ${lastPart}`, exact: true })).toBeVisible();
      await palette.getByRole('button', { name: /^Question 40,/ }).click();
      await expect(palette.locator('[aria-current="step"]')).toHaveText('40');
      await page.getByRole('textbox', { name: 'Answer 40', exact: true }).fill('gallery');
      await palette.getByRole('checkbox', { name: 'Review', exact: true }).check();
      await expect(palette.getByRole('button', { name: /Question 40,.*answered.*marked for review/ })).toBeVisible();
      await partButtons.nth(0).click();
      await partButtons.nth(lastPart - 1).click();
      await expect(page.getByRole('textbox', { name: 'Answer 40', exact: true })).toHaveValue('gallery');
      await palette.getByRole('button', { name: /^Question 40,/ }).click();
      await expect(palette.getByRole('button', { name: /Next/ })).toBeDisabled();
      await expect(page.getByRole('textbox', { name: 'Answer 40', exact: true })).toBeInViewport();
      await expect(palette).toBeInViewport({ ratio: 1 });
      const bounds = await page.evaluate(() => {
        const palette = document.querySelector('[aria-label="Question palette"]');
        const paper = document.querySelector('#reading-next-player, #listening-paper');
        const active = palette.querySelector('[aria-current="step"]');
        return { overflow: document.documentElement.scrollWidth > innerWidth + 1, palette: palette.getBoundingClientRect().toJSON(), paper: paper.getBoundingClientRect().toJSON(), active: active.getBoundingClientRect().toJSON(), width: innerWidth, height: innerHeight };
      });
      expect(bounds.overflow).toBe(false);
      expect(bounds.active.x).toBeGreaterThanOrEqual(0);
      expect(bounds.active.right).toBeLessThanOrEqual(width);
      expect(bounds.palette.bottom).toBeLessThanOrEqual(bounds.height + 1);
      expect(bounds.paper.bottom).toBeLessThanOrEqual(bounds.palette.top + 1);
      expect(bounds.paper.height).toBeGreaterThan(width > 780 ? 300 : 180);
      expect(await page.locator('body').innerText()).not.toMatch(/[À-ỹ]/);
      expect(state.calls.filter(call => !['GET', 'OPTIONS'].includes(call.method) && call.path !== '/api/analytics/events')).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`${skill}-${width}.png`) });
    });
  }
}
