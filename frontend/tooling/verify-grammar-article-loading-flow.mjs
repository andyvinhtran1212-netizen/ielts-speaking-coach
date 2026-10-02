// Browser proof for the streamed Grammar article fallback. The Next server must
// point at an unavailable or deliberately delayed API so the fallback remains
// observable while the server-owned article read is pending.
// --loaded checks the real chrome skip-link after the article is ready.
// Usage: node tooling/verify-grammar-article-loading-flow.mjs [base] [article-path] --loaded
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const loaded = args.includes('--loaded');
const [BASE = 'http://127.0.0.1:3012', ARTICLE_PATH = '/grammar/tenses/present-simple'] = args.filter((arg) => !arg.startsWith('--'));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function launch() {
  try {
    return await chromium.launch();
  } catch (error) {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(chrome)) {
      return chromium.launch({ executablePath: chrome });
    }
    throw error;
  }
}

const browser = await launch();
for (const viewport of [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
]) {
  const page = await browser.newPage({ viewport });
  await page.route('**/*', (route) => {
    // Keep the public article proof local; no analytics/auth/content requests
    // leave the fixture browser.
    return route.request().url().startsWith(BASE) ? route.continue() : route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto(`${BASE}${ARTICLE_PATH}`, { waitUntil: 'commit' });
  if (loaded) {
    const main = page.locator('main#article-container');
    await main.locator('#article-title').waitFor({ timeout: 15000 });
    check(`${viewport.name}: bài đã tải nằm trong một main landmark`, await page.getByRole('main').count() === 1 && await main.locator('article').count() === 1);
    const skip = page.getByRole('link', { name: 'Bỏ qua điều hướng', exact: true });
    await skip.focus();
    await skip.click();
    check(`${viewport.name}: click bỏ qua điều hướng đưa focus vào bài`, await main.evaluate((el) => document.activeElement === el));
    await skip.focus();
    await skip.press('Enter');
    check(`${viewport.name}: Enter bỏ qua điều hướng đưa focus vào bài`, await main.evaluate((el) => document.activeElement === el));
    check(`${viewport.name}: skip không chỉ thay hash`, new URL(page.url()).hash === '');
    await page.close();
    continue;
  }
  const liveStatus = page.locator('p[role="status"]');
  await liveStatus.waitFor({ state: 'attached', timeout: 3000 });
  check(
    `${viewport.name}: live region mô tả canonical read`,
    (await liveStatus.textContent())?.trim() === 'Đang tải bài Grammar…',
  );
  const geometry = await page.evaluate(() => {
    const article = document.querySelector('main article');
    const toc = document.querySelector('main aside');
    return {
      overflow: document.documentElement.scrollWidth > innerWidth,
      articleWidth: article?.getBoundingClientRect().width || 0,
      tocDisplay: toc ? getComputedStyle(toc).display : 'missing',
    };
  });
  check(`${viewport.name}: fallback được stream trước canonical read`, await page.locator('main[aria-busy="true"]').count() === 1);
  check(`${viewport.name}: skeleton không tràn ngang`, !geometry.overflow, JSON.stringify(geometry));
  check(
    `${viewport.name}: article/TOC giữ đúng responsive hierarchy`,
    geometry.articleWidth > 0 && (viewport.name === 'mobile' ? geometry.tocDisplay === 'none' : geometry.tocDisplay !== 'none'),
    JSON.stringify(geometry),
  );
  await page.close();
}

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nGrammar article loading flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
