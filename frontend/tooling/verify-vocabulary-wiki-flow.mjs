// Fixture-backed browser contract for the native public Vocabulary Wiki.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3011';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = []; const feedback = []; const articleReads = [];
page.on('pageerror', (error) => errors.push(String(error)));
await page.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('about:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url); const method = request.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const match = parsed.pathname.match(/^\/api\/vocabulary\/articles\/([^/]+)\/([^/]+)$/);
  if (method === 'GET' && match) {
    const category = decodeURIComponent(match[1]); const slug = decodeURIComponent(match[2]);
    articleReads.push(`${category}/${slug}`);
    return json({
      slug, category, headword: `Fixture ${slug}`, level: 'B2', part_of_speech: 'noun',
      pronunciation: '/ˈfɪk.stʃə/', syllables: 'FIX-ture', definition_en: 'A browser fixture.',
      definition_vi: 'Dữ liệu kiểm thử trình duyệt.', example: `Use ${slug} in context.`,
      collocations: ['browser fixture'], synonyms: [], antonyms: [], related_words: [],
      word_family: [], common_error: '', memory_hook: 'Keep the contract stable.',
      audio_headword: '', audio_example: '', register: 'neutral', source: 'G1 fixture', html: '',
    });
  }
  if (method === 'POST' && parsed.pathname === '/api/feedback') {
    feedback.push(JSON.parse(request.postData() || '{}')); return json({ id: 'feedback-fixture' });
  }
  if (method === 'POST' && parsed.pathname === '/api/analytics/events') return json({ ok: true });
  return json({ detail: `unhandled fixture ${method} ${parsed.pathname}` }, 404);
});

await page.goto(`${BASE}/vocabulary`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Từ vựng theo chủ đề', exact: true }).waitFor();
await page.locator('.vmd-row').first().waitFor();
const rowCount = await page.locator('.vmd-row').count();
check('server bootstrap render danh mục và thẻ đầu tiên', rowCount >= 2 && await page.locator('.va-card').count() === 1, `${rowCount} rows`);

const firstHeadword = (await page.locator('.vmd-rw').first().textContent() || '').trim();
await page.getByRole('searchbox', { name: 'Tìm từ vựng' }).fill(firstHeadword);
const filtered = await page.locator('.vmd-rw').allTextContents();
check('lọc headword chạy trong React', filtered.length >= 1 && filtered.every((value) => value.toLocaleLowerCase('vi').includes(firstHeadword.toLocaleLowerCase('vi'))));
await page.getByRole('searchbox', { name: 'Tìm từ vựng' }).fill('');

const second = page.locator('.vmd-row').nth(1);
const category = await second.getAttribute('data-category'); const slug = await second.getAttribute('data-slug');
await second.locator('.vmd-row-main').click();
await page.getByRole('heading', { name: `Fixture ${slug}`, exact: true }).waitFor();
const url = new URL(page.url());
check('chọn từ dùng identity kép và clean URL', articleReads.includes(`${category}/${slug}`) && url.pathname === '/vocabulary' && url.searchParams.get('cat') === category && url.searchParams.get('slug') === slug);

await page.getByRole('button', { name: 'Báo lỗi thẻ từ này' }).click();
await page.getByRole('menuitem', { name: 'Nội dung' }).click();
await page.getByText('✓ Đã gửi, cảm ơn!', { exact: true }).waitFor();
check('báo lỗi gửi canonical anonymous feedback', feedback.length === 1 && feedback[0].skill === 'vocabulary' && feedback[0].vocab_category === category && feedback[0].vocab_slug === slug && feedback[0].category === 'content_issue');

await page.setViewportSize({ width: 390, height: 844 });
// The desktop selection remains active after a responsive resize, so the
// mobile detail sheet correctly covers the list. Return to the list before
// exercising a fresh mobile selection instead of clicking through the sheet.
if (await page.locator('.vmd-shell.show-detail').count()) {
  await page.getByRole('button', { name: 'Quay lại danh sách' }).click();
  await page.locator('.vmd-shell.show-detail').waitFor({ state: 'detached' });
}
const third = page.locator('.vmd-row').nth(2);
if (await third.count()) {
  await third.locator('.vmd-row-main').click();
  await page.locator('.vmd-shell.show-detail').waitFor();
  await page.getByRole('button', { name: 'Quay lại danh sách' }).click();
}
check('mobile detail đóng về danh sách và không tràn ngang', await page.locator('.vmd-shell.show-detail').count() === 0 && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
check('không có lỗi JS', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nVocabulary Wiki flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
