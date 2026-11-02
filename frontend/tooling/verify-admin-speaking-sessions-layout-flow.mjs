// Fixture-backed layout contract for /admin/speaking/sessions (UIA-1030-A1).
// With the admin sidebar open, a 1280/1366 px desktop used to scroll the whole
// page sideways: the seven fixed-minimum filter columns and the 1120 px table
// were wider than the content column. The page must never scroll horizontally;
// the filter actions wrap and the table scrolls inside `.ass-table-wrap`.
// PC-J400: between 769 and 1180 px the sidebar leaves the filter frame so
// narrow that it can hold a single 150 px track; `span 2` on the actions then
// added an implicit track and overflowed the frame again. Those widths and the
// email placeholder (clipped at 1280) are measured too.
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';
import { stubAdminMfaStatus } from './admin-mfa-stub.mjs';

const BASE = process.argv[2] || 'http://localhost:3000';
const SHOT_DIR = process.env.LAYOUT_SHOT_DIR || '';
// Only the localStorage session key is derived from it (every request is
// routed below); the neutral default matches the CI build's SUPABASE_URL.
const SB = process.env.SUPABASE_URL || 'https://example.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000384';
const authSession = JSON.stringify({ access_token: 'admin-speaking-sessions-layout-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'admin-sessions-layout@local' } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

// 50 rows, like the first page staging renders ("50 session đã tải").
const rows = Array.from({ length: 50 }, (_, index) => ({
  id: `5e55${String(index).padStart(4, '0')}-0000-4000-8000-000000000000`, user_id: `u${index}`, user_email: `student.with.a.long.address.${index}@example.test`, user_lookup_failed: false,
  mode: ['practice', 'test_part', 'test_full'][index % 3], part: index % 3 === 1 ? 2 : null, topic: 'Describe a memorable journey you took with your family',
  status: index % 7 === 0 ? 'grading_failed' : 'completed', overall_band: 6.5, error_code: index % 7 === 0 ? 'grading_failed' : null, error_message: null, failed_step: null, last_error_at: null,
  started_at: '2026-10-30T01:00:00Z', completed_at: '2026-10-30T01:10:00Z', band_fc: 6, band_lr: 6.5, band_gra: 6, band_p: 7,
}));
const pageErrors = [];
const unexpectedWrites = [];

const browser = await launch();
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });

async function measure(width, height, theme) {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addInitScript(([key, value, chosenTheme]) => {
    localStorage.setItem(key, value);
    localStorage.setItem('av-theme', chosenTheme);
    localStorage.removeItem('av-admin-sidebar-collapsed');
  }, [storageKey(SB), authSession, theme]);
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(`${width}: ${error}`));
  await page.route('**/*', async (route) => {
    const request = route.request(); const url = request.url();
    if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('about:')) return route.continue();
    if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
    const parsed = new URL(url); const method = request.method();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !/^\/api\/(analytics\/events|error-logs)$/.test(parsed.pathname)) unexpectedWrites.push(`${method} ${parsed.pathname}`);
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-sessions-layout@local', role: 'admin' });
    if (method === 'GET' && parsed.pathname === '/admin/sessions') return json(rows);
    return json({});
  });
  await stubAdminMfaStatus(page);

  await page.goto(`${BASE}/admin/speaking/sessions`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '50 session đã tải' }).waitFor();
  await page.waitForFunction(() => customElements.get('aver-admin-chrome') && document.querySelector('aver-admin-chrome')?.shadowRoot?.querySelector('.sidebar'));
  await page.evaluate(() => document.fonts.ready);

  const data = await page.evaluate(() => {
    const box = (element) => { const rect = element.getBoundingClientRect(); return { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) }; };
    const sidebar = document.querySelector('aver-admin-chrome').shadowRoot.querySelector('.sidebar');
    const sidebarStyle = getComputedStyle(sidebar);
    const filters = document.querySelector('.ass-filters');
    const actions = document.querySelector('.ass-filter-actions');
    const wrap = document.querySelector('.ass-table-wrap');
    const table = wrap.querySelector('table');
    const buttons = [...actions.querySelectorAll('button')].map((button) => ({ label: button.textContent.trim(), ...box(button) }));
    const email = filters.querySelector('input:not([type])');
    const emailStyle = getComputedStyle(email);
    const context2d = document.createElement('canvas').getContext('2d');
    context2d.font = `${emailStyle.fontWeight} ${emailStyle.fontSize} ${emailStyle.fontFamily}`;
    const placeholder = {
      text: email.placeholder,
      textWidth: Math.ceil(context2d.measureText(email.placeholder).width),
      room: Math.floor(email.clientWidth - parseFloat(emailStyle.paddingLeft) - parseFloat(emailStyle.paddingRight)),
      // Narrowest the field gets with ≥2 tracks: minmax(150px, 1fr) minimum.
      minRoom: Math.floor(150 - parseFloat(emailStyle.paddingLeft) - parseFloat(emailStyle.paddingRight) - parseFloat(emailStyle.borderLeftWidth) - parseFloat(emailStyle.borderRightWidth)),
    };
    return {
      inner: innerWidth, scroll: document.documentElement.scrollWidth,
      sidebarOpen: sidebarStyle.visibility !== 'hidden' && box(sidebar).width > 200 && box(sidebar).right > 0,
      filters: { ...box(filters), scrollWidth: filters.scrollWidth, clientWidth: filters.clientWidth, tracks: getComputedStyle(filters).gridTemplateColumns.split(' ').length },
      actions: box(actions), buttons, placeholder,
      wrap: { ...box(wrap), scrollWidth: wrap.scrollWidth, clientWidth: wrap.clientWidth },
      table: box(table), tableInWrap: table.parentElement === wrap,
    };
  });
  const label = `${width}×${height} ${theme}`;
  const desktop = width > 768;
  if (desktop) check(`${label}: sidebar admin đang mở`, data.sidebarOpen, JSON.stringify({ sidebarOpen: data.sidebarOpen }));
  check(`${label}: trang không cuộn ngang`, data.scroll <= data.inner, `scrollWidth=${data.scroll} innerWidth=${data.inner}`);
  check(`${label}: khung lọc không tràn ngang`, data.filters.scrollWidth <= data.filters.clientWidth, `filters.scroll=${data.filters.scrollWidth} filters.client=${data.filters.clientWidth} tracks=${data.filters.tracks}`);
  check(`${label}: placeholder ô email không bị cắt`, data.placeholder.textWidth <= Math.min(data.placeholder.room, data.placeholder.minRoom), JSON.stringify(data.placeholder));
  check(`${label}: khối lọc và nút nằm trong khung lọc`, data.actions.right <= data.filters.right && data.filters.right <= data.inner, `filters.right=${data.filters.right} actions.right=${data.actions.right}`);
  check(`${label}: nút Áp dụng / Đặt lại thấy đủ`, data.buttons.length === 2 && data.buttons.every((button) => button.left >= 0 && button.right <= data.inner && button.width > 0), JSON.stringify(data.buttons));
  check(`${label}: khung bảng không vượt viewport`, data.tableInWrap && data.wrap.right <= data.inner, `wrap.right=${data.wrap.right} table.right=${data.table.right}`);
  check(`${label}: bảng hẹp hơn table cuộn trong .ass-table-wrap`, data.wrap.clientWidth >= data.table.width || data.wrap.scrollWidth > data.wrap.clientWidth, `wrap.client=${data.wrap.clientWidth} wrap.scroll=${data.wrap.scrollWidth} table=${data.table.width}`);
  if (desktop) {
    // A wider sidebar or zoom can leave the frame a single 150 px track; the
    // actions must then take that one track instead of adding an implicit one.
    const narrow = await page.evaluate(() => {
      const filters = document.querySelector('.ass-filters');
      filters.style.width = '330px';
      const style = getComputedStyle(filters);
      const contentRight = Math.round(filters.getBoundingClientRect().right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight));
      const actionsRight = Math.round(filters.querySelector('.ass-filter-actions').getBoundingClientRect().right);
      const result = { scrollWidth: filters.scrollWidth, clientWidth: filters.clientWidth, tracks: style.gridTemplateColumns.split(' ').length, contentRight, actionsRight };
      filters.style.width = '';
      return result;
    });
    check(`${label}: khung lọc chỉ còn 1 cột vẫn không tràn`, narrow.tracks === 1 && narrow.scrollWidth <= narrow.clientWidth && narrow.actionsRight <= narrow.contentRight, JSON.stringify(narrow));
  }
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/admin-speaking-sessions-${width}-${theme}.png`, fullPage: false });
  await context.close();
  return data;
}

// 769/800/900/1024/1180: sidebar open, narrow content column (PC-J400).
for (const [width, height] of [[769, 900], [800, 900], [900, 900], [1024, 768], [1180, 800], [1280, 800], [1366, 768], [390, 844]]) {
  for (const theme of ['light', 'dark']) await measure(width, height, theme);
}
// Wide desktop: same no-overflow contract (the flow verifier pins its columns).
await measure(1440, 900, 'light');
check('không có write ngoài contract', unexpectedWrites.length === 0, unexpectedWrites.join(', '));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Speaking Sessions layout: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
