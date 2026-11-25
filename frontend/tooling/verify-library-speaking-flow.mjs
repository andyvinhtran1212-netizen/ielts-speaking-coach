// Fixture-backed browser contract for the Speaking shelf (LIBRARY-0061 T013).
//
// CSP is per document: the YouTube sources are sent only with the response of
// `/library/speaking/:slug` (G06-T13 security PR). A soft App Router navigation
// into a question page would keep the policy of the page it came from and the
// player would be blocked, so every way into a question page must be a full
// document load. This flow walks list -> question -> next -> previous and
// fails on any RSC (soft) request for a question page.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3000';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

const QUESTION = /\/library\/speaking\/[^/?#]+/;
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
const documents = [];
const softLoads = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('request', (request) => {
  const path = new URL(request.url()).pathname;
  if (!QUESTION.test(path)) return;
  if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(path);
  else if (request.headers().rsc === '1' || new URL(request.url()).searchParams.has('_rsc')) softLoads.push(path);
});
// Hermetic: never reach YouTube. The player must then say so in its frame.
await context.route(/^https:\/\/(www\.)?youtube(-nocookie)?\.com\//, (route) => route.abort());

await page.goto(`${BASE}/library/speaking`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { level: 1 }).waitFor();
const row = page.getByRole('link', { name: /Describe a city you would like to visit/ });
await row.waitFor();
check('danh sách hiện đề kèm tình trạng video bằng chữ', await row.count() === 1 && /video/i.test(await row.textContent() || ''));

await Promise.all([page.waitForURL(/\/library\/speaking\/a-city-part-2$/), row.click()]);
await page.getByRole('heading', { name: 'Describe a city you would like to visit', level: 1 }).waitFor();
check('từ danh sách vào trang đề là tải lại cả trang', documents.includes('/library/speaking/a-city-part-2'), documents.join(', '));

const nav = await page.request.get(`${BASE}/library/speaking/a-city-part-2`, { maxRedirects: 0 });
const csp = nav.headers()['content-security-policy'] || '';
check('trang đề có CSP riêng của document', csp.includes('frame-src') || csp.includes('default-src'), csp.slice(0, 80));

await page.getByText('Giọng đọc tổng hợp', { exact: true }).first().waitFor();
await page.getByText('Không mở được video từ YouTube').waitFor({ timeout: 10000 });
check('YouTube bị chặn thì khung báo lỗi, không bỏ trống', await page.getByRole('link', { name: 'Xem trên YouTube' }).count() === 1);

const nextLink = page.getByRole('link', { name: /Đề sau/ });
await Promise.all([page.waitForURL(/\/library\/speaking\/hometown-part-1$/), nextLink.click()]);
await page.getByRole('heading', { name: 'Your hometown', level: 1 }).waitFor();
const prevLink = page.getByRole('link', { name: /Đề trước/ });
await Promise.all([page.waitForURL(/\/library\/speaking\/a-city-part-2$/), prevLink.click()]);
await page.getByRole('heading', { name: 'Describe a city you would like to visit', level: 1 }).waitFor();
check('đề sau / đề trước là tải lại cả trang',
  documents.filter((p) => p === '/library/speaking/hometown-part-1').length === 1
    && documents.filter((p) => p === '/library/speaking/a-city-part-2').length === 2, documents.join(', '));
check('không có điều hướng mềm (RSC) nào vào trang đề', softLoads.length === 0, softLoads.join(', '));

await page.setViewportSize({ width: 390, height: 844 });
check('390 px không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
check('không có lỗi JS', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nLibrary Speaking flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
