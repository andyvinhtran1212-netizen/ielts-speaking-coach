// Hermetic phone-width regression for PC-J13 (U-05, U-08, U-18).
//
// U-05: on a grammar article the sticky breadcrumb plus the fixed guest CTA bar
//       covered about a fifth of a 390px screen, and the bar sat on top of the
//       last links of the article.
// U-08: the solid teal CTAs ("Dùng thử miễn phí", "Luyện Speaking ngay") had
//       their white text remapped to the theme text colour — near-black on
//       teal in the light theme.
// PC-J13A: the "Kiểm tra nhanh" sub-line (#exercise-cta-sub) and the
//       /grammar/exercises intro used text-white/45, which had no theme mapping
//       and painted fixed white (1.06:1 on the light page).
// PC-J13B: at 1280×800 the guest CTA bar covered "Bài trước / Bài tiếp" —
//       the room reserved for it was phone-only.
// U-18: /profile at 360–390px — band chips overflowed their card, the email
//       was cut off with an ellipsis, and the "Đã lưu" toast text sat in the
//       DOM before anything was saved.
//
// Set SHOT_DIR=<dir> to also write screenshots for the PR evidence.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3000';
const api = new URL(process.env.AVER_API_BASE || 'http://127.0.0.1:3999');
if (api.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname)
    || api.username || api.password || api.pathname !== '/' || api.search || api.hash) {
  throw new Error('AVER_API_BASE must be an explicit local fixture origin');
}
const API = api.origin;
const SHOT_DIR = process.env.SHOT_DIR || '';
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });
const USER = '00000000-0000-4000-8000-000000000513';
const LONG_EMAIL = 'nguyen.thi.minh.anh.ielts.practice2026@student-mail.example.edu.vn';
const ARTICLE = '/grammar/parts-of-speech/ux-nouns';
const WIDTHS = [360, 390];

const failures = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

async function launch() {
  try { return await chromium.launch(); } catch (error) {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome });
    throw error;
  }
}

async function newPage(browser, { width, height = 844, theme, signedIn }) {
  const context = await browser.newContext({ viewport: { width, height }, bypassCSP: true });
  const session = signedIn
    ? `{ access_token: 'fixture-token', user: { id: '${USER}', email: '${LONG_EMAIL}' } }`
    : 'null';
  await context.addInitScript({ content: `
try { localStorage.setItem('av-theme', '${theme}'); } catch (e) {}
window.__AVER_SUPABASE_CLIENT__ = { auth: {
  getSession: async function () { return { data: { session: ${session} }, error: null }; },
  onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
  signOut: async function () { return { error: null }; }
} };
` });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname) || url.hostname === 'unpkg.com') return route.abort();
    if (url.origin === BASE && url.pathname === '/js/runtime-config.js') {
      return route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `window.__AVER_RUNTIME_CONFIG__ = Object.freeze(${JSON.stringify({
          environment: 'test', apiBase: API,
          supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'test-anon-key',
        })});`,
      });
    }
    if (url.origin === BASE) return route.continue();
    if (url.origin !== API) return route.abort();
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS', 'access-control-allow-headers': 'authorization,content-type,x-request-id' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
    const profile = {
      id: USER, email: LONG_EMAIL, display_name: 'Nguyễn Thị Minh Anh', role: 'user', is_active: true,
      onboarding_completed: true, joined_at: '2026-09-01T00:00:00Z', target_band: '6.5', exam_date: null,
      self_level: 'intermediate', weekly_goal: 5, stats: { total_sessions: 12, avg_band: 6.0 },
    };
    if (url.pathname === '/auth/me' || url.pathname === '/auth/profile') return json(profile);
    if (url.pathname === '/auth/check-active') return json({ is_active: true });
    if (/^\/api\/grammar\/article\/[^/]+\/[^/]+\/exercise$/.test(url.pathname)) {
      return json({ available: true, bank_id: 'fixture-bank', questions: 12 });
    }
    return json({});
  });
  return context.newPage();
}

// WCAG relative-luminance contrast of an element's text on its own fill.
function contrastOf(page, selector) {
  return page.$eval(selector, (el) => {
    const parse = (value) => {
      const probe = document.createElement('span');
      probe.style.color = value;
      document.body.appendChild(probe);
      const rgb = getComputedStyle(probe).color.match(/[\d.]+/g).map(Number);
      probe.remove();
      return rgb;
    };
    const lum = ([r, g, b]) => {
      const c = [r, g, b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const style = getComputedStyle(el);
    const fg = lum(parse(style.color));
    const bg = lum(parse(style.backgroundColor));
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  });
}

// Same ratio for text on a translucent stack (e.g. #exercise-cta-sub on the
// bg-teal/[0.06] card over the page): composite the ancestors' fills first.
function textContrastOf(page, selector) {
  return page.$eval(selector, (el) => {
    const rgba = (value) => {
      const probe = document.createElement('span');
      probe.style.color = value;
      document.body.appendChild(probe);
      const n = getComputedStyle(probe).color.match(/[\d.]+/g).map(Number);
      probe.remove();
      return n.length === 3 ? [...n, 1] : n;
    };
    const over = ([r, g, b, a], [R, G, B]) => [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a)];
    const fills = [];
    for (let node = el; node; node = node.parentElement) {
      const fill = rgba(getComputedStyle(node).backgroundColor);
      if (fill[3] > 0) fills.push(fill);
      if (fill[3] >= 1) break;
    }
    let bg = [255, 255, 255];
    for (const fill of fills.reverse()) bg = over(fill, bg);
    const fg = over(rgba(getComputedStyle(el).color), bg);
    const lum = ([r, g, b]) => {
      const c = [r, g, b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const [a, b] = [lum(fg), lum(bg)];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

async function checkExerciseCta(page, tag) {
  await page.locator('#exercise-cta:not(.hidden)').waitFor({ timeout: 15_000 });
  const ratio = await textContrastOf(page, '#exercise-cta-sub');
  check(`${tag} "Kiểm tra nhanh" sub-line contrast ≥ 4.5`, ratio >= 4.5, ratio.toFixed(2));
}

async function checkTailClearsBar(page, tag) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const tail = await page.evaluate(() => {
    const bar = document.getElementById('guest-cta-bar').getBoundingClientRect();
    const last = document.getElementById('prev-next').getBoundingClientRect();
    return { lastBottom: Math.round(last.bottom), barTop: Math.round(bar.top), barHeight: Math.round(bar.height) };
  });
  check(`${tag} last article links clear the CTA bar`, tail.lastBottom <= tail.barTop,
    `prev/next bottom ${tail.lastBottom}px, bar top ${tail.barTop}px, bar height ${tail.barHeight}px`);
}

const overflowOf = (page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);

const browser = await launch();
try {
  for (const width of WIDTHS) {
    for (const theme of ['light', 'dark']) {
      const tag = `${width}px ${theme}`;

      // ── U-05 / U-08: grammar article as a guest on a second read ──────
      const page = await newPage(browser, { width, theme, signedIn: false });
      await page.addInitScript(() => { try { localStorage.setItem('_aver_grammar_reads', '1'); } catch (e) {} });
      const response = await page.goto(`${BASE}${ARTICLE}`, { waitUntil: 'networkidle' });
      check(`${tag} article loads`, response?.ok() === true, `HTTP ${response?.status()}`);
      await page.locator('#guest-cta-bar:not(.hidden)').waitFor({ timeout: 15_000 });
      // Before the 8 s guest modal can cover the bar.
      const barRatio = await contrastOf(page, '#guest-cta-bar a');
      check(`${tag} "Dùng thử miễn phí" contrast ≥ 4.5`, barRatio >= 4.5, barRatio.toFixed(2));
      await page.locator('#guest-cta-bar a').hover();
      await page.waitForTimeout(300); // transition-colors
      const barHover = await contrastOf(page, '#guest-cta-bar a');
      check(`${tag} "Dùng thử miễn phí" hover contrast ≥ 4.5`, barHover >= 4.5, barHover.toFixed(2));

      check(`${tag} article has no horizontal overflow`, await overflowOf(page) <= 1, `${await overflowOf(page)}px`);

      // Scroll into the article: whatever stays pinned is what the reader loses.
      await page.evaluate(() => window.scrollTo(0, 400));
      const covered = await page.evaluate(() => {
        const vh = window.innerHeight;
        const nav = document.querySelector('nav.gw-subnav').getBoundingClientRect();
        const bar = document.getElementById('guest-cta-bar').getBoundingClientRect();
        const top = nav.bottom > 0 && nav.top <= 0 ? nav.bottom : 0;
        const bottom = bar.top < vh ? vh - Math.max(bar.top, 0) : 0;
        return { top: Math.round(top), bottom: Math.round(bottom), share: (top + bottom) / vh };
      });
      check(`${tag} breadcrumb is not pinned over the article`, covered.top === 0, `${covered.top}px pinned at top`);
      check(`${tag} pinned chrome covers ≤ 10% of the screen`, covered.share <= 0.10,
        `top ${covered.top}px + bottom ${covered.bottom}px = ${(covered.share * 100).toFixed(1)}%`);

      // The end of the article must be reachable above the fixed bar.
      await checkTailClearsBar(page, tag);
      await checkExerciseCta(page, tag);
      if (SHOT_DIR && theme === 'light') {
        await page.evaluate(() => window.scrollTo(0, 400));
        await page.screenshot({ path: join(SHOT_DIR, `grammar-article-${width}.png`) });
      }

      // Second read opens the guest modal after 8 s.
      await page.locator('#guest-modal-overlay:not(.hidden)').waitFor({ timeout: 15_000 });
      const cta = '#guest-modal-overlay a[href="/login"]';
      const modalRatio = await contrastOf(page, cta);
      check(`${tag} "Luyện Speaking ngay" contrast ≥ 4.5`, modalRatio >= 4.5, modalRatio.toFixed(2));
      await page.locator(cta).hover();
      await page.waitForTimeout(300); // transition-colors
      const modalHover = await contrastOf(page, cta);
      check(`${tag} "Luyện Speaking ngay" hover contrast ≥ 4.5`, modalHover >= 4.5, modalHover.toFixed(2));
      if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `grammar-modal-${width}-${theme}.png`) });
      await page.context().close();

      // ── U-18: /profile signed in ───────────────────────────────────────
      const profile = await newPage(browser, { width, theme, signedIn: true });
      await profile.goto(`${BASE}/profile`, { waitUntil: 'networkidle' });
      await profile.locator('#band-btns .band-btn').first().waitFor({ timeout: 15_000 });
      await profile.locator('#profile-email', { hasText: LONG_EMAIL }).waitFor({ timeout: 15_000 });
      check(`${tag} /profile has no horizontal overflow`, await overflowOf(profile) <= 1, `${await overflowOf(profile)}px`);
      const layout = await profile.evaluate(() => {
        const form = document.getElementById('profile-form').getBoundingClientRect();
        const chips = [...document.querySelectorAll('#band-btns .band-btn')].map((el) => el.getBoundingClientRect());
        const email = document.getElementById('profile-email');
        const card = email.closest('.card').getBoundingClientRect();
        const toast = document.getElementById('toast');
        return {
          formLeft: form.left, formRight: form.right,
          chipLeft: Math.min(...chips.map((r) => r.left)), chipRight: Math.max(...chips.map((r) => r.right)),
          chipCount: chips.length,
          emailClipped: email.scrollWidth > email.clientWidth + 1,
          emailRight: email.getBoundingClientRect().right, cardRight: card.right,
          toastText: toast.textContent.trim(),
          toastVisible: getComputedStyle(toast).visibility !== 'hidden',
        };
      });
      check(`${tag} all 9 band chips stay inside the form card`,
        layout.chipCount === 9 && layout.chipLeft >= layout.formLeft && layout.chipRight <= layout.formRight + 0.5,
        `chips ${Math.round(layout.chipLeft)}–${Math.round(layout.chipRight)}px, card ${Math.round(layout.formLeft)}–${Math.round(layout.formRight)}px`);
      check(`${tag} email is shown in full`, !layout.emailClipped && layout.emailRight <= layout.cardRight + 0.5);
      check(`${tag} no save toast before saving`, !layout.toastText && !layout.toastVisible,
        `text "${layout.toastText}", visible ${layout.toastVisible}`);
      if (SHOT_DIR && theme === 'light') await profile.screenshot({ path: join(SHOT_DIR, `profile-${width}.png`), fullPage: true });

      // A long error toast must wrap inside the screen.
      await profile.evaluate(() => {
        const toast = document.getElementById('toast');
        toast.textContent = 'Không thể tải hồ sơ: máy chủ trả lỗi trong lúc kiểm tra trạng thái tài khoản, vui lòng thử lại';
        toast.classList.add('show', 'pf-toast--error');
      });
      const toastBox = await profile.$eval('#toast', (el) => el.getBoundingClientRect().toJSON());
      check(`${tag} long toast stays within the screen`, toastBox.left >= 0 && toastBox.right <= width + 0.5,
        `${Math.round(toastBox.left)}–${Math.round(toastBox.right)}px`);
      await profile.context().close();
    }
  }

  // ── PC-J13A/B at desktop width, guest ───────────────────────────────────
  for (const theme of ['light', 'dark']) {
    const tag = `1280x800 ${theme}`;
    const page = await newPage(browser, { width: 1280, height: 800, theme, signedIn: false });
    const response = await page.goto(`${BASE}${ARTICLE}`, { waitUntil: 'networkidle' });
    check(`${tag} article loads`, response?.ok() === true, `HTTP ${response?.status()}`);
    await page.locator('#guest-cta-bar:not(.hidden)').waitFor({ timeout: 15_000 });
    await checkExerciseCta(page, tag);
    await checkTailClearsBar(page, tag);
    if (SHOT_DIR && theme === 'light') await page.screenshot({ path: join(SHOT_DIR, 'grammar-article-1280-end.png') });

    const exercises = await page.goto(`${BASE}/grammar/exercises`, { waitUntil: 'networkidle' });
    check(`${tag} /grammar/exercises loads`, exercises?.ok() === true, `HTTP ${exercises?.status()}`);
    const intro = 'main header p.text-white\\/45';
    const introRatio = await textContrastOf(page, intro);
    check(`${tag} /grammar/exercises intro contrast ≥ 4.5`, introRatio >= 4.5, introRatio.toFixed(2));
    await page.context().close();
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nverify-mobile-layout-flow: all checks passed');
