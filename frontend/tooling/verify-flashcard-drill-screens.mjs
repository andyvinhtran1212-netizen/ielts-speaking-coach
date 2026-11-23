// EXAMDRILL-0073 T002 (FR-004): screenshots of the flashcard study run in the
// practice room ('drill' flag on) at 1280x800 and 390x844, front and back of the
// longest card. Checks that the flip and rating buttons are inside the first
// screen without page scroll, the card fills the window, each rating button is at least 44px tall, rating
// is locked before the turn and no browser dialog opens. Built Next server,
// synthetic auth, intercepted API; no account, no database, no AI.
//   node tooling/verify-flashcard-drill-screens.mjs http://localhost:3011 [out-dir]
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = new URL(process.argv[2] || 'http://localhost:3011').origin;
const OUT = process.argv[3] || '';
const API = 'https://flashcard-drill-fixture.invalid';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
if (OUT) mkdirSync(OUT, { recursive: true });

let browser;
// CHROMIUM_EXECUTABLE: a preinstalled Chromium when the pinned Playwright build is absent.
try { browser = await chromium.launch(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}); } catch (error) {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (process.platform !== 'darwin' || !existsSync(chrome)) throw error;
  browser = await chromium.launch({ executablePath: chrome });
}

const longCard = {
  slug: 'sustainable', headword: 'sustainable', pronunciation: '/səˈsteɪnəbl/', part_of_speech: 'adjective', level: 'B2',
  definition_vi: 'bền vững; có thể duy trì lâu dài mà không gây hại cho môi trường hay cạn kiệt tài nguyên',
  definition_en: 'able to continue over a period of time without damaging the environment or using up resources',
  example: 'Governments should invest in sustainable energy sources such as wind and solar power to reduce long-term costs.',
  collocations: ['sustainable development', 'sustainable growth', 'environmentally sustainable', 'sustainable tourism', 'sustainable farming', 'sustainable energy'],
  synonyms: ['viable', 'renewable', 'maintainable', 'long-lasting', 'eco-friendly'],
  antonyms: ['unsustainable', 'damaging', 'wasteful', 'short-lived'],
  memory_hook: 'sustain = giữ cho tiếp tục; -able = có thể. "Có thể giữ cho tiếp tục" mà không phá huỷ nguồn lực.',
  common_error: 'Không dùng "sustainable" cho người (sai: "a sustainable person"); dùng cho hệ thống, nguồn năng lượng, phát triển.',
};
const wiki = { category: 'environment', cards: [longCard, { slug: 'habitat', headword: 'habitat', definition_vi: 'môi trường sống', collocations: [], synonyms: [], antonyms: [] }] };

async function open(viewport, theme) {
  const context = await browser.newContext({ viewport, colorScheme: theme, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = []; let dialogs = 0;
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('dialog', (dialog) => { dialogs += 1; void dialog.dismiss(); });
  await context.route('**/*', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin === BASE) {
      if (url.pathname === '/js/runtime-config.js') {
        return route.fulfill({ contentType: 'application/javascript', body: `window.__AVER_RUNTIME_CONFIG__=Object.freeze({apiBase:${JSON.stringify(API)},environment:'staging',examRoomSurfaces:['drill']});` });
      }
      return route.continue();
    }
    if (url.origin !== API) return route.abort();
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'authorization,content-type,x-request-id' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    const json = (body, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/vocabulary/categories/environment/cards') return json(wiki);
    return json({});
  });
  await page.goto(`${BASE}/flashcard-study?stack=wiki:environment`, { waitUntil: 'domcontentloaded' });
  await page.getByText(/Thẻ 1 trên 2/).waitFor();
  return { context, page, errors, get dialogs() { return dialogs; } };
}

async function layout(page) {
  return page.evaluate(() => {
    const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height, width: r.width }; };
    const buttons = [...document.querySelectorAll('[role="group"][aria-label="Chấm mức nhớ"] button')];
    const flip = [...document.querySelectorAll('button')].find((b) => /^(Lật thẻ|Xem mặt từ)$/.test(b.textContent?.trim() || ''));
    const back = document.querySelector('[role="region"][aria-label^="Mặt sau"]');
    return {
      vh: innerHeight, vw: innerWidth,
      pageScroll: document.documentElement.scrollHeight - innerHeight,
      wide: document.documentElement.scrollWidth - innerWidth,
      flip: box(flip), rates: buttons.map(box), disabled: buttons.map((b) => b.disabled),
      backScrolls: back ? back.scrollHeight > back.clientHeight : null,
      backTab: back?.getAttribute('tabindex') ?? null,
    };
  });
}

for (const [label, viewport] of [['1280x800', { width: 1280, height: 800 }], ['390x844', { width: 390, height: 844 }]]) {
  for (const theme of ['light', 'dark']) {
    const name = `${label}/${theme}`;
    const run = await open(viewport, theme);
    const front = await layout(run.page);
    if (OUT) await run.page.waitForTimeout(300); // let the 160ms face fade finish
    if (OUT) await run.page.screenshot({ path: `${OUT}/flashcard-drill-${label}-${theme}-front.png` });
    check(`${name} front: rating locked before the turn`, front.disabled.length === 2 && front.disabled.every(Boolean));
    await run.page.keyboard.press('1');
    check(`${name} front: number key does not rate`, (await run.page.getByText(/Thẻ 1 trên 2/).count()) === 1);
    await run.page.getByRole('button', { name: 'Lật thẻ', exact: true }).click();
    await run.page.getByRole('region', { name: /Mặt sau của thẻ sustainable/ }).waitFor();
    const back = await layout(run.page);
    if (OUT) await run.page.waitForTimeout(300); // let the 160ms face fade finish
    if (OUT) await run.page.screenshot({ path: `${OUT}/flashcard-drill-${label}-${theme}-back.png` });
    const inView = (r) => r && r.top >= 0 && r.bottom <= back.vh + 0.5;
    check(`${name} back: flip and both rating buttons on the first screen`, inView(back.flip) && back.rates.every(inView), JSON.stringify({ flip: back.flip, rates: back.rates, vh: back.vh }));
    check(`${name} back: the card fills the window (rating row within 64px of the bottom)`, back.rates.every((r) => r && back.vh - r.bottom <= 64), `gap=${back.rates[0] ? Math.round(back.vh - back.rates[0].bottom) : 'n/a'}`);
    check(`${name} back: no page scroll, no sideways overflow`, back.pageScroll <= 1 && back.wide <= 1, `scroll=${back.pageScroll} wide=${back.wide}`);
    check(`${name} back: rating buttons at least 44px tall and enabled`, back.rates.every((r) => r.height >= 43.99) && back.disabled.every((d) => !d));
    check(`${name} back: long back scrolls inside the card (tabIndex=0)`, back.backScrolls === true && back.backTab === '0', `scrolls=${back.backScrolls}`);
    check(`${name}: no browser dialog, no JS error`, run.dialogs === 0 && run.errors.length === 0, run.errors.join(' | '));
    await run.context.close();
  }
}
// Codex P1/P2 on #2597, personal stack with a signed-in synthetic account:
// a review the server keeps refusing with 401 must not loop while the account
// still reads as signed in, and a pending rating (failed or sending) guards reload.
async function openPersonal(reviewStatus) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript({ content: `window.__AVER_SUPABASE_CLIENT__ = { auth: {
    getSession: async function () { return { data: { session: { access_token: 'fixture-token', user: { id: 'fc-user', email: 'fc@example.com' } } }, error: null }; },
    onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
    signOut: async function () { return { error: null }; }
  } };` });
  const page = await context.newPage();
  const state = { reviews: 0, status: reviewStatus, dialogs: 0, errors: [] };
  page.on('pageerror', (error) => state.errors.push(String(error)));
  page.on('dialog', (dialog) => { state.dialogs += 1; void dialog.dismiss(); });
  await context.route('**/*', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin === BASE) {
      if (url.pathname === '/js/runtime-config.js') {
        return route.fulfill({ contentType: 'application/javascript', body: `window.__AVER_RUNTIME_CONFIG__=Object.freeze({apiBase:${JSON.stringify(API)},environment:'staging',examRoomSurfaces:['drill']});` });
      }
      if (request.isNavigationRequest() && url.pathname === '/login') return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>login</title>' });
      return route.continue();
    }
    if (url.origin !== API) return route.abort();
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'authorization,content-type,x-request-id' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    const json = (body, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.startsWith('/api/flashcards/stacks/')) {
      return json({ stack_id: 'auto:due', cards: [
        { id: '11111111-1111-4111-8111-111111111111', headword: 'resilient', definition_vi: 'kiên cường', source_type: 'needs_review', review: null },
        { id: '22222222-2222-4222-8222-222222222222', headword: 'mitigate', definition_vi: 'giảm nhẹ', source_type: 'needs_review', review: null },
      ] });
    }
    const review = /^\/api\/flashcards\/([^/]+)\/review$/.exec(url.pathname);
    if (review && request.method() === 'POST') {
      state.reviews += 1;
      if (state.status === 200) return json({ vocab_id: review[1], status: 'success', replayed: false, interval_days: 1, ease_factor: 2.5, review_count: 1, next_review_at: '2026-11-24T00:00:00Z' });
      return json({ detail: 'refused' }, state.status);
    }
    return json({});
  });
  await page.goto(`${BASE}/flashcard-study?stack=auto:due`, { waitUntil: 'domcontentloaded' });
  await page.getByText(/Thẻ 1 trên 2/).waitFor();
  await page.getByRole('button', { name: 'Lật thẻ', exact: true }).click();
  await page.getByRole('button', { name: /^Tốt/ }).click();
  return { context, page, state };
}
const reloadGuarded = (page) => page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });

const refused = await openPersonal(401);
await refused.page.getByText('Phiên đăng nhập đã hết hạn').waitFor();
await refused.page.waitForTimeout(1500);
const afterWait = refused.state.reviews;
await refused.page.evaluate(() => window.dispatchEvent(new Event('focus')));
await refused.page.waitForTimeout(1000);
check('personal: a review refused with 401 is not retried in a loop; one retry per focus (Codex P1)',
  afterWait === 1 && refused.state.reviews === 2 && await refused.page.getByText('Phiên đăng nhập đã hết hạn').count() > 0 && new URL(refused.page.url()).pathname === '/flashcard-study',
  `before focus=${afterWait}; after=${refused.state.reviews}`);
check('personal 401: reload is guarded while the rating waits', await reloadGuarded(refused.page));
check('personal 401: no browser dialog, no JS error', refused.state.dialogs === 0 && refused.state.errors.length === 0, refused.state.errors.join(' | '));
await refused.context.close();

const failing = await openPersonal(503);
await failing.page.getByText('Chưa lưu được đánh giá. Kiểm tra mạng rồi bấm Thử lưu lại.').waitFor();
check('personal: a failed rating guards reload and the bar says it is not saved (Codex P2)', await reloadGuarded(failing.page) && await failing.page.getByText(/Đã lưu/).count() === 0);
failing.state.status = 200;
await failing.page.getByRole('button', { name: 'Thử lưu lại' }).click();
await failing.page.getByText(/Thẻ 2 trên 2/).waitFor();
check('personal: once saved, reload is no longer guarded', !await reloadGuarded(failing.page) && failing.state.reviews === 2);
await failing.context.close();

await browser.close();
const failed = results.filter((row) => !row.ok);
console.log(`\nFlashcard drill screens: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
