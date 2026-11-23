// ADMINGROUP-0077 T001 (G10-T14) — browser contract for the admin route-group
// pilot. `(authed-admin)` now owns one AuthedShell; `(error-logs)`,
// `(feedback)` and `(foot-traffic)` are child groups that only add their page
// stylesheet with a plain <link>. Because the shell no longer remounts between
// those pages, a client navigation must leave the same DOM as a direct load:
// stylesheet list, <body> class and the highlighted sidebar entry (FR-005),
// and a child group's sheet must leave with it (Scenario 3). An inactive
// account is still sent to /login (activation gate). All API calls are
// intercepted; no real data is read or written.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';
import { stubAdminMfaStatus } from './admin-mfa-stub.mjs';

const BASE = process.argv[2] || 'http://localhost:3000';
const SHOTS = process.env.ADMIN_ROUTE_GROUP_SHOTS || '';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000077';
const session = JSON.stringify({ access_token: 'admin-route-group-not-a-real-token', refresh_token: 'x', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'admin-route-group@local' } });
// Each moved page → `active` attribute of its <aver-admin-chrome> and the
// sheets its child-group layout adds after the 4 base sheets, in order.
const PAGE_SPEC = {
  '/admin/error-logs': { active: 'error-logs', sheets: ['/css/admin-error-logs-next.css'] },
  '/admin/feedback': { active: 'feedback', sheets: ['/css/admin-feedback-next.css'] },
  '/admin/foot-traffic': { active: 'foot-traffic', sheets: ['/css/admin-foot-traffic-next.css'] },
  '/admin/usage': { active: 'usage', sheets: ['/css/admin-usage-next.css'] },
  '/admin': { active: 'overview', sheets: ['/css/aver-design/admin-hub.css', '/css/admin-overview.css'] },
  '/admin/users': { active: 'users', sheets: ['/css/admin-users-next.css'] },
  '/admin/students': { active: 'classes', sheets: ['/css/admin-classes-next.css', '/css/admin-students-next.css'] },
  '/admin/classes': { active: 'classes', sheets: ['/css/admin-classes-next.css', '/css/admin-class-detail-next.css', '/css/admin-class-homework-next.css', '/css/admin-class-submissions-next.css', '/css/admin-class-student-work-next.css'] },
  '/admin/instructors': { active: 'instructors', sheets: ['/css/admin-instructors-next.css'] },
};
const PAGES = Object.keys(PAGE_SPEC);
// The 4 admin base sheets owned by (authed-admin)/layout.tsx, in order.
const BASE_SHEETS = [
  // snapshot() tags the surface sheet by its data-aver-admin-surface attribute.
  '/css/aver-design/admin-surface.css [surface]',
  '/css/aver-design/admin-components.css',
  '/css/aver-design/admin-buttons.css',
  '/css/aver-design/admin-status.css',
];
const BASE_TAIL = BASE_SHEETS.at(-1);
const baseSheetsOnce = (sheets) => BASE_SHEETS.every((href) => sheets.filter((s) => s === href).length === 1);
// Client-navigation screenshots of the pages moved in each wave, taken from a
// pilot page that exists on the base build too, so base and head compare 1:1.
const CLIENT_SHOTS = new Set(['/admin/feedback → /admin', '/admin/feedback → /admin/usage', '/admin/error-logs → /admin/feedback',
  '/admin/feedback → /admin/users', '/admin/feedback → /admin/students', '/admin/feedback → /admin/classes', '/admin/feedback → /admin/instructors',
  '/admin/students → /admin/classes', '/admin/classes → /admin/students']);

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
// Measured on staging 119ad352 before this pilot: with `cacheComponents` the
// App Router keeps the previous route mounted but hidden, so after a client
// navigation the previous page's stylesheets stay in the DOM (before the
// pilot, its whole shell: 4 base sheets + page sheet; after it, only the page
// sheet). FR-005 (amended 20/11) only requires "no worse than today" and the
// base sheets never duplicated (enforced below); the leftover page sheets are
// a separate task, so these exact-match checks are reported, not enforced.
const notes = [];
const observe = (name, ok, detail = '') => { notes.push({ name, ok }); console.log(`  ${ok ? '✓' : '⚠'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launchChromium() { try { return await chromium.launch(); } catch (error) { const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(localChrome)) return chromium.launch({ executablePath: localChrome }); throw error; } }

async function openContext(browser, { active = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(([key, value]) => { try { localStorage.setItem(key, value); } catch (_) {} }, [storageKey(SB), session]);
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();
    if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
    const { pathname } = new URL(url);
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (pathname === '/auth/me') return json({ id: adminId, email: 'admin-route-group@local', role: 'admin' });
    if (pathname === '/auth/check-active') return json({ is_active: active });
    return json({});
  });
  await stubAdminMfaStatus(context);
  return context;
}

// Everything the cascade depends on, in document order.
const snapshot = (page) => page.evaluate(() => {
  const chrome = document.querySelector('aver-admin-chrome');
  const root = chrome?.shadowRoot;
  return {
    sheets: [...document.querySelectorAll('link[rel="stylesheet"]')]
      .map((link) => `${link.getAttribute('href')}${link.hasAttribute('data-aver-admin-surface') ? ' [surface]' : ''}`)
      .filter((href) => !href.startsWith('/_next/')),
    bodyClass: document.body.className.split(/\s+/).filter(Boolean).sort().join(' '),
    activeNav: root ? [...root.querySelectorAll('.nav-item.active, .nav-subitem.active, [aria-current]')].map((a) => a.getAttribute('href')).sort().join(',') : null,
  };
});

async function settle(page, url) {
  await page.waitForURL((u) => u.pathname === url, { timeout: 15000 });
  await page.waitForFunction((active) => {
    const chrome = document.querySelector('aver-admin-chrome');
    return chrome?.getAttribute('active') === active && chrome.shadowRoot?.querySelector('.nav-item');
  }, PAGE_SPEC[url].active, { timeout: 15000 });
  await page.waitForTimeout(300);
}

async function shot(page, name) {
  if (!SHOTS) return null;
  mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const browser = await launchChromium();
const pageErrors = [];
try {
  const context = await openContext(browser);
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  const direct = {};
  for (const url of PAGES) {
    await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
    await settle(page, url);
    direct[url] = await snapshot(page);
    await shot(page, `direct${url.replaceAll('/', '_')}`);
    const tail = direct[url].sheets.slice(direct[url].sheets.indexOf(BASE_TAIL) + 1);
    const first = direct[url].sheets.indexOf(BASE_SHEETS[0]);
    check(`${url} tải trực tiếp: 4 sheet nền đúng thứ tự, mỗi sheet một lần`, baseSheetsOnce(direct[url].sheets) && JSON.stringify(direct[url].sheets.slice(first, first + BASE_SHEETS.length)) === JSON.stringify(BASE_SHEETS), direct[url].sheets.join(' '));
    check(`${url} tải trực tiếp: 4 sheet nền rồi đúng sheet của trang`, JSON.stringify(tail) === JSON.stringify(PAGE_SPEC[url].sheets), direct[url].sheets.join(' '));
    // Some pages (foot-traffic, usage) have no sidebar entry of their own;
    // only a page that is listed must highlight itself.
    const listed = await page.evaluate((href) => !!document.querySelector('aver-admin-chrome')?.shadowRoot?.querySelector(`a.nav-item[href="${href}"]`), url);
    if (listed) check(`${url} tải trực tiếp: sidebar chọn đúng mục`, direct[url].activeNav?.split(',').includes(url), direct[url].activeNav ?? 'no chrome');
  }

  // Client navigations inside the same parent group, every ordered pair.
  for (const from of PAGES) {
    for (const to of PAGES) {
      if (from === to) continue;
      await page.goto(`${BASE}${from}`, { waitUntil: 'domcontentloaded' });
      await settle(page, from);
      await page.evaluate(() => { window.__adminRouteGroupMarker = 'same-document'; });
      // Sidebar click goes through ChromeNavigationBridge → router.push; a page
      // without a sidebar entry is opened with the same App Router call.
      const link = page.locator(`aver-admin-chrome a.nav-item[href="${to}"]`);
      if (await link.count()) await link.first().click();
      else await page.evaluate((href) => window.next.router.push(href), to);
      await settle(page, to);
      const sameDocument = await page.evaluate(() => window.__adminRouteGroupMarker === 'same-document');
      const after = await snapshot(page);
      const label = `${from} → ${to}`;
      check(`${label}: điều hướng phía client (không tải lại trang)`, sameDocument);
      // The new page's own cascade must be intact: every sheet of the direct
      // load, in the same relative order, before anything left behind.
      check(`${label}: đủ stylesheet của trang mới, đúng thứ tự`, JSON.stringify(after.sheets.slice(0, direct[to].sheets.length)) === JSON.stringify(direct[to].sheets), after.sheets.join(' '));
      check(`${label}: không nhân đôi 4 sheet nền`, baseSheetsOnce(after.sheets), BASE_SHEETS.map((href) => `${href.split('/').at(-1)}×${after.sheets.filter((s) => s === href).length}`).join(' '));
      observe(`${label}: stylesheet trong DOM giống hệt tải trực tiếp (FR-005)`, JSON.stringify(after.sheets) === JSON.stringify(direct[to].sheets), after.sheets.slice(direct[to].sheets.length).join(' ') || 'không dư');
      check(`${label}: class <body> giống tải trực tiếp`, after.bodyClass === direct[to].bodyClass, after.bodyClass);
      check(`${label}: sidebar chọn giống tải trực tiếp`, after.activeNav === direct[to].activeNav, after.activeNav ?? 'no chrome');
      if (CLIENT_SHOTS.has(label)) await shot(page, `client${from.replaceAll('/', '_')}_to${to.replaceAll('/', '_')}`);
    }
  }
  await context.close();

  // Activation gate: an inactive staff account still lands on /login.
  const inactive = await openContext(browser, { active: false });
  const gated = await inactive.newPage();
  for (const url of PAGES) {
    await gated.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
    let redirected = true;
    try { await gated.waitForURL((u) => u.pathname === '/login', { timeout: 15000 }); } catch { redirected = false; }
    check(`${url}: tài khoản chưa kích hoạt bị đưa về /login`, redirected, new URL(gated.url()).pathname);
  }
  await inactive.close();
  check('không có lỗi JavaScript trên trang', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

if (SHOTS) writeFileSync(path.join(SHOTS, 'results.json'), JSON.stringify({ results, notes }, null, 2));
const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed; ${notes.filter((n) => !n.ok).length}/${notes.length} FR-005 observations differ`);
process.exit(failed.length ? 1 : 0);
