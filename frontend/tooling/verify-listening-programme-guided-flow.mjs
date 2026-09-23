// Browser-backed guided programme check against a local Next build.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

import { storageKey } from './supabase-session.mjs';

const base = process.argv[2] || 'http://localhost:3011';
const supabase = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const testId = '00000000-0000-0000-0000-000000000602';
const attemptId = '00000000-0000-0000-0000-000000000603';
const session = JSON.stringify({
  access_token: 'guided-flow-not-a-real-token', refresh_token: 'x',
  token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: '00000000-0000-0000-0000-000000000601', email: 'guided-flow@local' },
});
const questions = [
  { q_num: 1, source_item_id: 'visual-1', prompt: 'What does Mai suggest?', response_type: 'single_choice', options: { A: 'Practise together', B: 'Practise alone' } },
  { q_num: 2, source_item_id: 'visual-2', prompt: 'What else did you hear?', response_type: 'written', options: {} },
];
const item = {
  q_num: 1, first_answer: 'A', revealed_at: '2026-09-23T09:00:00Z',
  state: 'checked', correct: true, expected: ['A'], rationale: 'Mai invites both people to practise.',
  reference_answers: [], required_facts: [], optional_facts: [], self_review_rationale: '',
  core_info: '', answer_sentence: '', audio_window: { start: 1, end: 3 },
};

let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (process.platform !== 'darwin' || !existsSync(chrome)) throw error;
  browser = await chromium.launch({ executablePath: chrome });
}

try {
  const pageColors = new Map();
  for (const theme of ['light', 'dark']) {
    for (const width of [375, 768, 1440]) {
      const reducedMotion = theme === 'dark' && width === 375 ? 'reduce' : 'no-preference';
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion });
      await context.addInitScript(([key, value, selectedTheme]) => {
        localStorage.setItem(key, value);
        localStorage.setItem('av-theme', selectedTheme);
      }, [storageKey(supabase), session, theme]);
      const page = await context.newPage();
      const errors = [];
      const requested = [];
      const network = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      page.on('request', (request) => { if (request.url().includes('listening/tests')) network.push(request.url()); });
      page.on('requestfailed', (request) => network.push(`FAILED ${request.url()} ${request.failure()?.errorText}`));
      await page.route('**/*', async (route) => {
        const url = route.request().url();
        const path = new URL(url).pathname;
        if (path === `/api/listening/tests/${testId}/attempts`) {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ attempt_id: attemptId, answers: [] }) });
        }
        if (path === `/api/listening/tests/${testId}`) {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
            scoring_policy: 'report_only', programme_id: 'general-listening-practice', title: 'Guided form',
            listening_lesson_id: 'lesson-1', replay_policy: 'allowed', audio_url: '/audio.wav',
            sections: [{ exercises: [{ payload: { variant: 'programme_form_v1', questions } }] }],
          }) });
        }
        if (path.endsWith('/guided-state')) {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ attempt_id: attemptId, assisted: false, items: [] }) });
        }
        if (path.endsWith('/answers')) {
          requested.push('save');
          return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        }
        if (path.endsWith('/questions/1/reveal')) {
          requested.push('reveal');
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ attempt_id: attemptId, assisted: true, items: [item] }) });
        }
        if (url.startsWith(base) || url.startsWith('data:')) return route.continue();
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      });
      await page.goto(`${base}/listening/programmes/form/${testId}`, { waitUntil: 'domcontentloaded' });
      try {
        await page.getByText('What does Mai suggest?').waitFor({ timeout: 8000 });
      } catch (error) {
        console.error('guided page:', (await page.locator('body').innerText()).slice(0, 1200));
        console.error('page errors:', errors);
        console.error('network:', network);
        throw error;
      }
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      pageColors.set(`${theme}-${width}`, await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `${theme}/${width} horizontal overflow`);
      assert.equal(await page.locator('.programme-question-feedback').count(), 0, 'no premature feedback');
      await page.getByRole('radio', { name: /Practise together/ }).focus();
      await page.keyboard.press('Space');
      assert.equal(await page.getByRole('radio', { name: /Practise together/ }).isChecked(), true, 'keyboard answers the question');
      assert.notEqual(await page.getByRole('radio', { name: /Practise together/ }).evaluate((input) =>
        getComputedStyle(input.nextElementSibling).outlineStyle), 'none', 'keyboard focus is visible');
      assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), reducedMotion === 'reduce');
      await page.getByRole('button', { name: 'Đối chiếu câu này' }).first().click();
      await page.getByText('Mai invites both people to practise.').waitFor();
      assert.ok((await page.getByRole('button', { name: '▶ Nghe lại đoạn này' }).boundingBox()).height >= 44, 'replay has a 44px touch target');
      assert.equal(requested.at(-1), 'reveal');
      assert.equal(requested.includes('save'), true);
      assert.equal(await page.locator('.programme-question-feedback').count(), 1, 'only the revealed question has feedback');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `${theme}/${width} feedback overflow`);
      assert.equal(errors.length, 0, `${theme}/${width}: ${errors[0] || ''}`);
      console.log(`✓ guided programme ${theme} ${width}px`);
      await context.close();
    }
  }
  for (const width of [375, 768, 1440]) {
    assert.notEqual(pageColors.get(`light-${width}`), pageColors.get(`dark-${width}`), `${width}px theme surfaces must differ`);
  }
} finally {
  await browser.close();
}
