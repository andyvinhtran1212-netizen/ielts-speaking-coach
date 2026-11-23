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
await browser.close();
const failed = results.filter((row) => !row.ok);
console.log(`\nFlashcard drill screens: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
