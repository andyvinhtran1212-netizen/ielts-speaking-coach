// Fixture-backed browser contract for the public Vocabulary shelf
// (LIBRARY-0061 T015, tờ TuVung). Server-rendered pages read the Next-native
// fixture API (AVER_API_BASE); browser calls are answered here.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3011';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function waitForCount(getCount, expected, timeout = 2000) {
  const deadline = Date.now() + timeout;
  while (getCount() < expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return getCount() >= expected;
}
async function launch() {
  const options = process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {};
  try { return await chromium.launch(options); } catch (error) {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome });
    throw error;
  }
}

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const errors = []; const feedback = []; const analytics = []; const bankPosts = [];
const vocabularyViews = () => analytics.filter((event) => event.event_name === 'vocab_wiki_viewed');
let signedIn = false;
const fixtureRows = [
  { slug: 'academic-growth', category: 'education', headword: 'academic growth', level: 'B2', part_of_speech: 'noun phrase', pronunciation: '', gloss_vi: 'sự tiến bộ học thuật', audio_headword: '' },
  { slug: 'lifelong-learning', category: 'education', headword: 'lifelong learning', level: 'B2', part_of_speech: 'noun phrase', pronunciation: '', gloss_vi: 'học tập suốt đời', audio_headword: '' },
  { slug: 'carbon-footprint', category: 'environment', headword: 'carbon footprint', level: 'B2', part_of_speech: 'noun phrase', pronunciation: '', gloss_vi: 'dấu chân carbon', audio_headword: '' },
  ...Array.from({ length: 62 }, (_, index) => ({
    slug: `fixture-word-${index + 1}`,
    category: index % 2 ? 'environment' : 'education',
    headword: `fixture word ${String(index + 1).padStart(2, '0')}`,
    level: 'B1', part_of_speech: 'noun', pronunciation: '',
    gloss_vi: `mục từ kiểm thử ${index + 1}`, audio_headword: '',
  })),
];
await context.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('about:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url); const method = request.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (method === 'GET' && parsed.pathname === '/api/vocabulary/directory') {
    const categoryFilter = parsed.searchParams.get('category') || '';
    const offset = Number.parseInt(parsed.searchParams.get('offset') || '0', 10);
    const limit = Number.parseInt(parsed.searchParams.get('limit') || '60', 10);
    const filteredRows = fixtureRows.filter((item) => !categoryFilter || item.category === categoryFilter);
    return json({
      categories: [
        { slug: 'education', title: 'Education', article_count: 33 },
        { slug: 'environment', title: 'Environment', article_count: 32 },
      ],
      items: filteredRows.slice(offset, offset + limit),
      total: filteredRows.length,
      offset,
      limit,
    });
  }
  if (parsed.pathname === '/api/vocabulary/bank/stats') {
    return signedIn ? json({ total: 0 }) : json({ detail: 'Not authenticated' }, 401);
  }
  if (method === 'GET' && parsed.pathname === '/api/vocabulary/bank/') {
    return json(bankPosts.map((body, index) => ({ id: `row-${index}`, headword: body.headword })));
  }
  if (method === 'POST' && parsed.pathname === '/api/vocabulary/bank/') {
    const body = JSON.parse(request.postData() || '{}');
    bankPosts.push(body);
    return json({ id: `row-${bankPosts.length - 1}`, headword: body.headword }, 201);
  }
  if (method === 'POST' && parsed.pathname === '/api/feedback') {
    feedback.push(JSON.parse(request.postData() || '{}')); return json({ id: 'feedback-fixture' });
  }
  if (method === 'POST' && parsed.pathname === '/api/analytics/events') {
    analytics.push(JSON.parse(request.postData() || '{}')); return json({ ok: true });
  }
  return json({ detail: `unhandled fixture ${method} ${parsed.pathname}` }, 404);
});

const page = await context.newPage();
page.on('pageerror', (error) => errors.push(String(error)));
await page.goto(`${BASE}/vocabulary`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Từ vựng', exact: true, level: 1 }).waitFor();
await page.waitForFunction(() => Boolean(window.api?.getWith && window.api?.post));
const rows = () => page.locator('table tbody tr');
const initialPageCount = await rows().count();
check('server render danh sách từ có liên kết tới mục từ', initialPageCount >= 2
  && await rows().first().locator('a').getAttribute('href') === '/vocabulary?cat=education&slug=academic-growth', `${initialPageCount} rows`);
await page.getByRole('button', { name: /Xem thêm/ }).click();
await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length === 65);
check('danh mục chỉ hydrate batch đầu rồi tải thêm theo nhu cầu', initialPageCount === 60 && await rows().count() === 65);
const ipaFont = await page.locator('.av2-ipa').first().evaluate((el) => getComputedStyle(el).fontFamily);
check('IPA dùng font Source Sans 3', /^"?Source Sans 3/.test(ipaFont), ipaFont);
check('trang danh sách không phát lượt xem mục từ', vocabularyViews().length === 0);

const box = page.getByRole('combobox', { name: 'Tra từ tiếng Anh' });
await box.click();
await box.fill('f');
await page.waitForTimeout(150);
const oneChar = await page.getByRole('option').count();
await box.fill('fixture word 1');
await page.getByRole('option').first().waitFor();
const options = await page.getByRole('option').count();
check('gợi ý hiện từ ký tự thứ hai, tối đa 5 dòng', oneChar === 0 && options === 5, `${options} options`);
await page.keyboard.press('Escape');
check('Esc đóng gợi ý', await page.getByRole('option').count() === 0);
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
const chosen = (await page.getByRole('option', { selected: true }).locator('span').first().textContent() || '').trim();
await Promise.all([page.waitForURL(/slug=/), page.keyboard.press('Enter')]);
const entryUrl = new URL(page.url());
check('↑ ↓ chọn, Enter mở đúng mục từ bằng identity kép', chosen === 'fixture word 11'
  && entryUrl.pathname === '/vocabulary' && entryUrl.searchParams.get('slug') === 'fixture-word-11'
  && entryUrl.searchParams.get('cat') === 'education', `${chosen} → ${entryUrl.search}`);
await page.getByRole('heading', { name: 'fixture word 11', exact: true, level: 1 }).waitFor();
const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
check('canonical của mục từ là chính URL mục từ', new URL(canonical, BASE).pathname === '/vocabulary'
  && new URL(canonical, BASE).search === '?cat=education&slug=fixture-word-11', canonical || '');
await waitForCount(() => vocabularyViews().length, 1);
check('mở mục từ phát đúng một lượt xem', vocabularyViews().length === 1
  && vocabularyViews()[0].event_data?.slug === 'fixture-word-11');
const tocLabels = await page.locator('nav[aria-label="Trong mục từ này"]').first().locator('a').allTextContents();
check('mục lục chỉ gồm phần có dữ liệu, đánh số liên tục', tocLabels.length === 3
  && tocLabels.map((label) => label.trim()).join('|') === '1Nghĩa và ví dụ|2Kết hợp từ|3Mẹo nhớ', tocLabels.join('|'));

await page.getByRole('button', { name: 'Báo lỗi mục từ này' }).click();
await page.getByRole('button', { name: 'Nội dung', exact: true }).click();
await page.getByText('Đã gửi, cảm ơn bạn.', { exact: true }).waitFor();
check('báo lỗi gửi canonical anonymous feedback', feedback.length === 1 && feedback[0].skill === 'vocabulary'
  && feedback[0].vocab_category === 'education' && feedback[0].vocab_slug === 'fixture-word-11' && feedback[0].category === 'content_issue');

await page.getByRole('button', { name: 'Lưu vào sổ từ' }).click();
const loginLink = page.getByRole('link', { name: 'Đăng nhập để lưu' });
await loginLink.waitFor();
const loginHref = await loginLink.getAttribute('href');
check('khách bấm lưu → lời nhắc dưới nút dẫn tới đăng nhập kèm next', loginHref === `/login?next=${encodeURIComponent('/vocabulary?cat=education&slug=fixture-word-11')}`, loginHref || '');
await loginLink.click();
await page.waitForURL(/\/login/);
signedIn = true;
await page.goto(`${BASE}/vocabulary?cat=education&slug=fixture-word-11`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Đã lưu vào sổ từ' }).waitFor();
check('đăng nhập xong quay về đúng mục từ và từ được lưu luôn', bankPosts.length === 1
  && bankPosts[0].headword === 'fixture word 11' && bankPosts[0].category === 'topic');

await page.goto(`${BASE}/vocabulary?q=fixture%20wrod%2001`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: /Chưa có mục từ/ }).waitFor();
const near = await page.locator('table tbody tr').count();
check('tra không thấy: tối đa 3 từ gần giống và mẹo', near >= 1 && near <= 3 && await page.getByText(/Mẹo: gõ dạng gốc/).count() === 1, `${near} near`);

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/vocabulary?cat=education&slug=lifelong-learning`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'lifelong learning', exact: true, level: 1 }).waitFor();
check('390px không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

const staleCategoryPage = await context.newPage();
staleCategoryPage.on('pageerror', (error) => errors.push(String(error)));
await staleCategoryPage.goto(`${BASE}/vocabulary?cat=retired-category`, { waitUntil: 'domcontentloaded' });
await staleCategoryPage.getByRole('heading', { name: 'Từ vựng', exact: true, level: 1 }).waitFor();
check('category cũ tự rơi về danh mục đầy đủ',
  await staleCategoryPage.locator('table tbody tr').count() === 60
    && await staleCategoryPage.getByRole('link', { name: /^Tất cả/ }).getAttribute('aria-current') === 'page');
await staleCategoryPage.close();

const staleDeepLinkPage = await context.newPage();
staleDeepLinkPage.on('pageerror', (error) => errors.push(String(error)));
await staleDeepLinkPage.goto(`${BASE}/vocabulary?cat=retired-category&slug=lifelong-learning`, { waitUntil: 'domcontentloaded' });
await staleDeepLinkPage.getByRole('heading', { name: 'lifelong learning', exact: true, level: 1 }).waitFor();
const staleCanonical = await staleDeepLinkPage.locator('link[rel="canonical"]').getAttribute('href');
check('deep link có category cũ vẫn resolve slug duy nhất', new URL(staleCanonical, BASE).search === '?cat=education&slug=lifelong-learning');
await staleDeepLinkPage.close();

check('không có lỗi JS', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nVocabulary Wiki flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
