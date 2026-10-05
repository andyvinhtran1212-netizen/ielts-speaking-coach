// Local production-Next UI acceptance using declared synthetic Admin wire.
// The source/diff fixture comes from the real reviewed parser. This is not PG,
// canonical publication or live cohort evidence. No real endpoint is contacted.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:3110';
if (!['localhost', '127.0.0.1', '::1'].includes(new URL(BASE).hostname)) throw new Error('Only an owned local Next server is allowed.');
const SB = process.env.SUPABASE_URL || 'https://example.supabase.co';
const fixture = JSON.parse(readFileSync(new URL('../tests/fixtures/admin-grammar-revision.json', import.meta.url), 'utf8'));
const sourceFixture = JSON.parse(readFileSync(new URL('../tests/fixtures/grammar-exact-form-banks.json', import.meta.url), 'utf8'));
const row = fixture.rows[0];
const bankSource = sourceFixture.banks.find((b) => b.code === row.code).raw_source;
const results = []; const traffic = []; const errors = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`); if (!ok) throw new Error(name); };
const clone = structuredClone;
let committed = false; let loseAck = false; let commitPosts = 0;
let browser;
try {
  try { browser = await chromium.launch(); }
  catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform !== 'darwin' || !existsSync(chrome)) throw error; browser = await chromium.launch({ executablePath: chrome }); }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined }));
  const user = { id: fixture.actor, email: 'grammar-admin@example.test', role: 'authenticated' };
  await context.addInitScript(([key, session]) => localStorage.setItem(key, JSON.stringify(session)), [storageKey(SB), { access_token: 'synthetic-admin-grammar-not-a-key', refresh_token: 'synthetic', expires_at: Math.floor(Date.now() / 1000) + 3600, user }]);
  const page = await context.newPage(); page.on('pageerror', (error) => errors.push(String(error)));
  await page.route('**/*', async (route) => {
    const req = route.request(); const u = new URL(req.url()); const path = u.pathname; const method = req.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path.startsWith('/auth/v1/')) return json(user);
    if (path === '/auth/me') return json({ ...user, role: 'admin' });
    if (path === '/admin/content-topics' || path === '/admin/quiz/banks') return json([]);
    if (path.startsWith('/admin/quiz/grammar-revisions/')) {
      const body = method === 'POST' ? req.postDataJSON() : null;
      traffic.push({ method, path, body });
      const code = decodeURIComponent(path.split('/')[4]);
      const r = fixture.rows.find((item) => item.code === code);
      if (!r) return json({ detail: { error_code: 'grammar_revision_scope_not_found', message: 'Không có nguồn gốc.', current_revision: null } }, 404);
      if (path.endsWith('/preview')) return json(r.preview);
      if (path.endsWith('/commit')) {
        commitPosts += 1; committed = true;
        if (loseAck) { loseAck = false; return route.abort('failed'); }
        return json({ ...r.ack, operation_id: body.operation_id, outcome: commitPosts > 1 ? 'already_applied' : 'applied' });
      }
      return json(committed && code === row.code ? r.ack.canonical : r.read);
    }
    if (path === '/api/analytics/events' || path === '/api/error-logs') return json({});
    if (u.origin === new URL(BASE).origin || u.protocol === 'data:' || u.protocol === 'about:') return route.continue();
    // No paid/live/provider requests or external font/CDN fallback.
    return json({});
  });
  await page.goto(`${BASE}/admin/vocab/quiz?skill_area=grammar`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Xem trước và xác nhận bản sửa Grammar', exact: true }).waitFor();
  await page.getByText(/Nguồn gốc chưa được sửa/).waitFor();
  check('passive canonical reads dispatch no business POST', traffic.every((r) => r.method === 'GET'));
  check('picker owns exactly the twelve approved codes', await page.getByLabel('Nguồn Grammar đã duyệt').locator('option').count() === 12);
  await page.getByLabel('File nguồn UTF-8 đã duyệt').setInputFiles({ name: 'reviewed.md', mimeType: 'text/markdown', buffer: Buffer.from(bankSource, 'utf8') });
  await page.getByRole('button', { name: 'Xem trước bản sửa Grammar', exact: true }).click();
  await page.getByText('Diff đã được backend xác minh').waitFor();
  check('full raw source and fingerprint are preserved', await page.getByLabel('Nguồn Markdown Grammar').inputValue() === bankSource && await page.locator('#grammar-revision').getByText(row.preview.source_sha256, { exact: true }).count() >= 1);
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => { document.documentElement.setAttribute('data-theme', value); localStorage.setItem('av-theme', value); }, theme);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const layout = await page.locator('#grammar-revision').evaluate((section) => {
        const visible = [...section.querySelectorAll('button,select,input,summary')].filter((el) => el.getBoundingClientRect().height > 0);
        return { width: document.documentElement.scrollWidth, viewport: innerWidth, targets: visible.map((el) => el.getBoundingClientRect().height), background: getComputedStyle(section).backgroundColor, color: getComputedStyle(section).color };
      });
      check(`${width}px ${theme} no horizontal overflow`, layout.width <= layout.viewport);
      check(`${width}px ${theme} targets44px and contrasting tokens`, layout.targets.every((height) => height >= 44) && layout.color !== layout.background);
    }
  }
  const opener = page.getByRole('button', { name: 'Kiểm tra và xác nhận bản sửa', exact: true });
  await opener.focus(); await opener.click(); await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  check('Escape cancels without commit and restores opener focus', commitPosts === 0 && await opener.evaluate((el) => el === document.activeElement));
  loseAck = true; await opener.click(); await page.getByRole('button', { name: 'Xác nhận tạo bản sửa', exact: true }).click();
  await page.getByRole('button', { name: 'Khôi phục bằng cùng mã và nội dung', exact: true }).waitFor();
  check('lost ACK dispatches one commit and never auto retries', commitPosts === 1);
  await page.getByRole('button', { name: 'Khôi phục bằng cùng mã và nội dung', exact: true }).click();
  await page.getByText('Receipt đã đối chiếu canonical', { exact: true }).waitFor();
  const writes = traffic.filter((r) => r.method === 'POST' && r.path.endsWith('/commit'));
  check('explicit recovery reuses the exact UUID and complete payload', writes.length === 2 && JSON.stringify(writes[0].body) === JSON.stringify(writes[1].body));
  check('receipt is followed by canonical GET', traffic.at(-1).method === 'GET');
  const beforeReload = traffic.filter((r) => r.method === 'POST').length;
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.getByText(/Nguồn đã có bản sửa/).waitFor();
  check('reload reads canonical managed state with zero further writes', traffic.filter((r) => r.method === 'POST').length === beforeReload);
  check('no JavaScript errors', errors.length === 0, errors.join(' | '));
} catch (error) { results.push({ name: 'runner completed', ok: false, detail: String(error) }); process.exitCode = 1; }
finally {
  if (browser) await browser.close();
  const evidence = { fixture_kind: 'DECLARED_SYNTHETIC_ROWS_UI_REPLAY', boundary: 'This driver replays only the twelve declared synthetic fixture rows against owned local Next. The separate real local PG/ASGI public capture is covered by focused model/React tests, not this driver. No live API/cutover, RLS or cohort evidence.', results, traffic, errors };
  if (process.env.ADMIN_GRAMMAR_BROWSER_EVIDENCE) writeFileSync(process.env.ADMIN_GRAMMAR_BROWSER_EVIDENCE, JSON.stringify(evidence, null, 2));
  console.log(`Admin Grammar revision: ${results.filter((r) => r.ok).length}/${results.length} checks passed`);
}
