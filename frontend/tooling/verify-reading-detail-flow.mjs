// Fixture-backed browser contract for the shared native L1/L2 Reading detail workspace.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const fakeSession = JSON.stringify({
  access_token: 'reading-detail-flow-not-a-real-token', refresh_token: 'x', token_type: 'bearer',
  expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: '00000000-0000-0000-0000-000000000037', email: 'reading-detail@local' },
});
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
async function launchChromium() {
  try { return await chromium.launch(); } catch (error) {
    const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(localChrome)) return chromium.launch({ executablePath: localChrome });
    throw error;
  }
}

const longBody = Array.from({ length: 45 }, (_, index) => `Tea paragraph ${index + 1} explains the ritual and its history.`).join('\n\n');
const payloadFor = (slug, library) => ({
  id: `${library}-1`, slug, title: library === 'vocab' ? 'A Short History of Tea' : 'Skimming Climate Change',
  body_markdown: longBody, difficulty_level: 'intermediate', topic_tags: ['history', 'culture'],
  image_url: '/favicon.svg', word_count: 620, estimated_minutes: 8,
  skill_focus: library === 'skill' ? 'skimming' : null,
  glossary: [{ term: 'ritual', definition: 'nghi thức', ipa: '/ˈrɪtʃ.u.əl/', pos: 'noun', example: 'Tea became a ritual.', synonyms: ['custom'] }],
  translation_vi: 'Đây là bản dịch đoạn một.\n\nĐây là bản dịch đoạn hai.',
  grammar_focus: [{ point: 'Past simple', example: 'Tea **became** popular.', analysis: 'Một sự kiện trong quá khứ.', review: 'S + V2', tip: 'Tìm mốc thời gian.' }],
  questions: [
    { q_num: 1, question_type: 'mcq_single', prompt: 'Pick the main idea.', payload: { options: [{ label: 'A', text: 'Tea history' }, { label: 'B', text: 'Coffee' }] }, skill_tag: 'main_idea' },
    { q_num: 2, question_type: 'true_false_not_given', prompt: 'Tea is coffee.', payload: {}, skill_tag: 'detail' },
    { q_num: 3, question_type: 'yes_no_not_given', prompt: 'Does the writer approve?', payload: {}, skill_tag: 'writer_view_TFNG' },
    { q_num: 4, question_type: 'matching_headings', prompt: 'Choose a heading.', payload: { options: [{ label: 'i', text: 'Origins' }, { label: 'ii', text: 'Trade' }] }, skill_tag: 'skimming' },
  ],
});

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addInitScript(([key, value]) => { try { localStorage.setItem(key, value); } catch (_) {} }, [storageKey(SB), fakeSession]);
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));
let scenario = 'valid';
const posts = new Map();
const apiHeaders = {
  'access-control-allow-origin': BASE,
  'access-control-allow-headers': 'authorization,content-type,x-request-id',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
await page.route('**/*', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const detailMatch = url.pathname.match(/\/api\/reading\/(vocab|skill)\/([^/]+)$/);
  const checkMatch = url.pathname.match(/\/api\/reading\/(vocab|skill)\/([^/]+)\/check$/);
  if ((detailMatch || checkMatch) && request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: apiHeaders });
  if (checkMatch && request.method() === 'POST') {
    const body = request.postDataJSON();
    const qNum = body?.answers?.[0]?.q_num;
    posts.set(qNum, (posts.get(qNum) || 0) + 1);
    if (qNum === 1 && posts.get(qNum) === 1) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return route.fulfill({ status: 200, contentType: 'application/json', headers: apiHeaders, body: '{"results":[]}' });
    }
    const correct = qNum === 1;
    return route.fulfill({
      status: 200, contentType: 'application/json',
      headers: apiHeaders,
      body: JSON.stringify({ results: [{ q_num: qNum, correct, expected: qNum === 1 ? 'A' : 'FALSE', explanation: 'Canonical explanation', skill_tag: qNum === 1 ? 'main_idea' : 'detail' }] }),
    });
  }
  if (detailMatch && request.method() === 'GET') {
    if (scenario === 'error') return route.fulfill({ status: 500, contentType: 'application/json', headers: apiHeaders, body: '{"detail":"secret"}' });
    const [, library, slug] = detailMatch;
    const payload = payloadFor(decodeURIComponent(slug), library);
    if (scenario === 'leak') payload.questions[0].answer = 'A';
    return route.fulfill({ status: 200, contentType: 'application/json', headers: apiHeaders, body: JSON.stringify(payload) });
  }
  if (request.url().startsWith(BASE) || request.url().startsWith('data:')) return route.continue();
  // Keep the renderer deterministic: defer ordering means a slow public CDN
  // would otherwise delay markdown.js and every helper after it. This tiny
  // escaped renderer is a fixture dependency, not production behavior.
  if (/marked@12\.0\.2/.test(request.url())) return route.fulfill({
    status: 200, contentType: 'application/javascript',
    body: `window.marked={parse:function(s){return '<p>'+String(s).replace(/[&<>]/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]}).replace(/\\n\\s*\\n/g,'</p><p>')+'</p>'}};`,
  });
  if (/dompurify@3\.4\.8/.test(request.url())) return route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.DOMPurify={sanitize:function(s){return s}};' });
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(request.url())) return route.continue();
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

await page.goto(`${BASE}/reading/vocab/a-short-history-of-tea`, { waitUntil: 'domcontentloaded' });
await page.locator('.rv-detail').waitFor({ state: 'visible' });
check('Vocab detail hiển thị metadata canonical',
  (await page.locator('.rv-passage__title').innerText()) === 'A Short History of Tea'
    && (await page.locator('.rv-detail__facts').innerText()).includes('8')
    && (await page.locator('.rv-detail__facts').innerText()).includes('Phút đọc')
    && (await page.locator('.rv-detail__topics').innerText()).includes('history')
    && (await page.locator('.rv-back').innerText()).includes('Thư viện Vocab Reading'));
check('đủ bốn loại control và chưa có answer key trước check',
  await page.locator('.rq-card').count() === 4
    && await page.locator('.rq-card select').count() === 1
    && !(await page.locator('.rv-questions').innerText()).includes('Canonical explanation'));

const tabs = page.locator('[role="tab"]');
await tabs.nth(0).focus(); await tabs.nth(0).press('End');
check('tablist hỗ trợ roving keyboard và panel grammar',
  await tabs.nth(2).getAttribute('aria-selected') === 'true'
    && await page.locator('#rv-panel-grammar').isVisible()
    && (await page.locator('.rv-gpoint__example strong').innerText()) === 'became'
    && !(await page.locator('.rv-gpoint__example').innerText()).includes('**'));
await tabs.nth(2).press('Home');
check('Home trả về văn bản gốc', await page.locator('#rv-panel-original').isVisible());

await page.locator('.glossary-term').waitFor({ state: 'visible' });
await page.locator('.glossary-term').click();
check('glossary mở dialog có nghĩa canonical',
  await page.locator('.rv-dialog--glossary').isVisible()
    && (await page.locator('.rv-dialog--glossary').innerText()).includes('nghi thức'));
await page.locator('.rv-dialog__close').click();

const leadImage = page.locator('.rv-passage__body > img').first();
await leadImage.focus(); await leadImage.press('Enter');
check('ảnh mở lightbox focus-contained', await page.locator('.rv-dialog--image').isVisible()
  && await page.locator('.rv-dialog__close').evaluate((node) => document.activeElement === node));
await page.keyboard.press('Escape');

await page.locator('.rq-card').nth(0).locator('input[value="A"]').check();
await page.locator('.rq-card').nth(0).locator('.rq-check').evaluate((button) => { button.click(); button.click(); });
await page.locator('.rq-card').nth(0).getByText('Bạn có thể thử lại', { exact: false }).waitFor({ state: 'visible' });
check('sync lock chặn double POST và malformed ACK không khóa câu', posts.get(1) === 1 && await page.locator('.rq-card').nth(0).locator('input').first().isEnabled());
await page.locator('.rq-card').nth(0).locator('.rq-check').click();
await page.locator('.rq-card').nth(0).getByText('Đúng rồi', { exact: false }).waitFor({ state: 'visible' });
check('retry hợp lệ khóa câu và cập nhật summary đúng một lần',
  posts.get(1) === 2 && await page.locator('.rq-card').nth(0).locator('input').first().isDisabled()
    && (await page.locator('.rq-summary').innerText()).trim() === 'Đúng 1/4');
await page.locator('.rq-card').nth(1).locator('input[value="TRUE"]').check();
await page.locator('.rq-card').nth(1).locator('.rq-check').click();
await page.locator('.rq-card').nth(1).getByText('Canonical explanation', { exact: false }).waitFor({ state: 'visible' });
check('kết quả fail dùng expected/explanation từ server và gắn flag',
  (await page.locator('.rq-card').nth(1).innerText()).includes('Đáp án: FALSE')
    && await page.locator('.rq-card').nth(1).locator('.fb-flag-btn').count() === 1);

await page.setViewportSize({ width: 390, height: 844 });
check('mobile không tràn ngang và bỏ independent pane scroll',
  await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
    && await page.locator('.rv-reader').evaluate((node) => getComputedStyle(node).overflowY === 'visible'));

await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${BASE}/reading/skill/skim-climate-change-coral-reefs`, { waitUntil: 'domcontentloaded' });
await page.locator('.rv-detail').waitFor({ state: 'visible' });
check('Skill detail dùng chung workspace nhưng giữ skill focus',
  (await page.locator('.rv-skill-banner').innerText()).includes('Skimming')
    && (await page.locator('.rq-title').innerText()) === 'Luyện đúng kỹ năng'
    && (await page.locator('.rv-detail__facts').innerText()).includes('Phút luyện'));

scenario = 'leak';
await page.goto(`${BASE}/reading/vocab/leak-passage`, { waitUntil: 'domcontentloaded' });
await page.locator('.rv-error').waitFor({ state: 'visible' });
check('payload GET chứa answer key fail closed', !(await page.locator('body').innerText()).includes('Pick the main idea'));
scenario = 'error';
await page.goto(`${BASE}/reading/skill/server-error`, { waitUntil: 'domcontentloaded' });
await page.locator('.rv-error').waitFor({ state: 'visible' });
check('lỗi backend hiển thị copy an toàn, không lộ detail', !(await page.locator('.rv-error').innerText()).includes('secret'));
check('không có lỗi JS chưa bắt', pageErrors.length === 0, pageErrors[0] || '');

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
