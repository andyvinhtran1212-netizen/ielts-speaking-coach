// G02-T14 (PR #2382 review) — on a phone the submit modal stacks vertically
// and the textarea is at least 24rem tall, so a draft-save error must sit
// beside "Lưu bản nháp", not above the textarea. This renders the REAL
// WritingShell markup (bundled from page-shell.tsx) with the real stylesheet
// cascade from AuthedShell, at a phone viewport, and checks that the error
// is on screen while the learner is at the Save button.
//
// The save/clear behaviour of the real saveDraft() is covered in
// tests/core-operation-integration.test.mjs.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const esbuild = require('esbuild');

const FRONTEND = path.resolve(__dirname, '../..');

function renderWritingShell() {
  const out = esbuild.buildSync({
    stdin: {
      contents: [
        "import { createElement } from 'react';",
        "import { renderToStaticMarkup } from 'react-dom/server';",
        "import { WritingShell } from './app/(authed-writing)/writing/dashboard/page-shell.tsx';",
        'module.exports = renderToStaticMarkup(createElement(WritingShell));',
      ].join('\n'),
      resolveDir: FRONTEND,
      loader: 'tsx',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    write: false,
    logLevel: 'silent',
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}

// Same order as components/authed-shell.tsx + (authed-writing)/layout.tsx.
const STYLESHEETS = [
  '/public/css/aver-design/tokens.css',
  '/public/css/aver-design/components.css',
  '/public/css/ds.css',
  '/public/css/writing-dashboard.css',
  '/public/css/markdown.css',
  '/public/css/tailwind.build.css',
];

test.use({ viewport: { width: 375, height: 667 } });

test('draft-save error is on screen next to "Lưu bản nháp" on a phone', async ({ page }) => {
  const shell = renderWritingShell();
  await page.goto('/tests/e2e/fixtures/harness.html');
  await page.setContent(
    '<!doctype html><html lang="vi"><head><meta name="viewport" content="width=device-width, initial-scale=1">'
      + STYLESHEETS.map((href) => `<link rel="stylesheet" href="${href}">`).join('')
      + '</head><body class="av-page font-sans min-h-screen">' + shell + '</body></html>',
    { waitUntil: 'load' },
  );

  // Open the modal workspace the way openSubmitModal()/renderModal() leave it.
  await page.evaluate(() => {
    document.getElementById('submit-modal').classList.remove('hidden');
    document.getElementById('modal-loading').classList.add('hidden');
    document.getElementById('modal-content').classList.remove('hidden');
    document.getElementById('modal-prompt-text').textContent = 'Some people think… '.repeat(30);
    document.getElementById('modal-essay-textarea').value = 'My exact essay text';
  });

  const textarea = page.locator('#modal-essay-textarea');
  const save = page.locator('#modal-btn-save');
  const error = page.locator('#modal-save-error');
  await expect(error).toBeHidden();

  // The layout really is the stacked phone layout the review describes.
  expect((await textarea.boundingBox()).height).toBeGreaterThanOrEqual(24 * 16 - 1);

  await save.scrollIntoViewIfNeeded();
  // What saveDraft() does on failure (showDraftSaveError).
  await page.evaluate(() => {
    const el = document.getElementById('modal-save-error');
    el.textContent = 'Không lưu được bản nháp: offline';
    el.classList.remove('hidden');
  });

  await expect(error).toBeVisible();
  await expect(error).toHaveAttribute('role', 'alert');
  await expect(error).toBeInViewport({ ratio: 1 });
  await expect(save).toBeInViewport();
  // Adjacent to the button, not a screen away.
  const [e, s] = [await error.boundingBox(), await save.boundingBox()];
  expect(Math.abs(s.y - (e.y + e.height))).toBeLessThan(120);
  // The learner's text is untouched.
  await expect(textarea).toHaveValue('My exact essay text');

  // The blocked-paste warning stays beside the input, above the textarea.
  await page.evaluate(() => {
    const el = document.getElementById('modal-notice');
    el.textContent = 'Không dán được đoạn dài 900 ký tự. Bạn hãy tự gõ bài.';
    el.classList.remove('hidden');
  });
  await textarea.scrollIntoViewIfNeeded();
  const notice = await page.locator('#modal-notice').boundingBox();
  const area = await textarea.boundingBox();
  expect(notice.y + notice.height).toBeLessThanOrEqual(area.y);
  expect(area.y - (notice.y + notice.height)).toBeLessThan(120);
});
