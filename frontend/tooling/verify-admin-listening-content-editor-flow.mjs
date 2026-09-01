// Fixture-backed browser contract for native Admin Listening metadata editor.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3012';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000123';
const contentId = '00000000-0000-0000-0000-000000000456';
const session = JSON.stringify({ access_token: 'admin-listening-meta-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'listening-meta@local' } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

let canonical = {
  id: contentId, title: 'Original title', transcript: 'Line one.\nLine two.', accent_tag: 'uk_rp',
  cefr_level: null, ielts_section: null, topic_tags: ['Travel', 'Work'], is_premium: false,
  external_license: null, external_source_url: null, status: 'draft', source_type: 'upload_mp3',
  audio_storage_path: 'content/audio.mp3', updated_at: '2026-08-14T01:00:00+00:00',
};
const patchBodies = []; let contentReads = 0; let nextReadFailure = 0;
const applyPatch = (body) => {
  const map = { accent_tag: 'accent_tag', cefr_level: 'cefr_level', ielts_section: 'ielts_section', topic_tags: 'topic_tags', is_premium: 'is_premium', external_license: 'external_license', external_source_url: 'external_source_url', title: 'title', transcript: 'transcript' };
  for (const [key, target] of Object.entries(map)) if (Object.hasOwn(body, key)) canonical[target] = body[key];
  canonical.updated_at = new Date(Date.parse(canonical.updated_at) + 1000).toISOString();
};

const errors = [];
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), session]);
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(String(error)));
await page.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('about:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url); const method = request.method();
  const json = (body, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'listening-meta@local', role: 'admin' });
  if (parsed.pathname === `/admin/listening/content/${contentId}` && method === 'GET') {
    contentReads += 1;
    if (nextReadFailure) { const status = nextReadFailure; nextReadFailure = 0; return json({ detail: 'readback forbidden after acknowledged patch' }, status); }
    return json(canonical);
  }
  if (parsed.pathname === `/admin/listening/content/${contentId}` && method === 'PATCH') {
    const body = request.postDataJSON(); patchBodies.push(body);
    if (body.title === 'Conflict edit') {
      canonical = { ...canonical, title: 'Concurrent canonical', updated_at: '2026-08-14T02:00:00+00:00' };
      return json({ detail: 'version conflict' }, 409);
    }
    if (body.title === 'Ambiguous edit') { applyPatch(body); return json({ detail: 'gateway timeout after commit' }, 503); }
    if (body.title === 'Acknowledged then forbidden') { applyPatch(body); nextReadFailure = 403; return json({ accepted: true }); }
    if (body.expected_updated_at !== canonical.updated_at) return json({ detail: 'version conflict' }, 409);
    applyPatch(body);
    return json({ accepted: true });
  }
  return json({ detail: `unhandled fixture ${method} ${parsed.pathname}` }, 404);
});

await page.goto(`${BASE}/admin/listening/content/${contentId}/edit`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Sửa metadata', exact: true }).waitFor();
check('route admin đọc exact content identity', contentReads >= 1 && page.url().endsWith(`/admin/listening/content/${contentId}/edit`), `${contentReads} GET`);
check('nullable CEFR và section không bị bịa mặc định', await page.locator('#alme-cefr').inputValue() === '' && await page.locator('#alme-section').inputValue() === '');
check('rollback giữ exact identity legacy', await page.getByRole('link', { name: /Mở bản HTML rollback/ }).getAttribute('href') === `/pages/admin/listening/content-meta.html?id=${contentId}`);

await page.locator('#alme-title').fill('Updated title');
await page.locator('#alme-tags').fill('Travel, travel, Work, Education');
await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
await page.getByText('Đã lưu metadata', { exact: true }).waitFor();
const firstPatch = patchBodies[0];
check('PATCH chỉ gửi delta cùng expected_updated_at', JSON.stringify(Object.keys(firstPatch).sort()) === JSON.stringify(['expected_updated_at', 'title', 'topic_tags'].sort()), JSON.stringify(firstPatch));
check('topic tags canonical được trim và loại trùng', JSON.stringify(firstPatch.topic_tags) === JSON.stringify(['Travel', 'Work', 'Education']));
check('thành công chỉ sau GET readback và editor không redirect', contentReads >= 2 && page.url().endsWith('/edit') && await page.locator('#alme-title').inputValue() === 'Updated title');

await page.locator('#alme-title').fill('Conflict edit');
await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
await page.getByRole('heading', { name: 'Canonical đã thay đổi ở nơi khác' }).waitFor();
check('409 khóa form và không ghi đè concurrent canonical', canonical.title === 'Concurrent canonical' && await page.locator('#alme-title').isDisabled());
await page.getByRole('button', { name: 'Tải canonical mới' }).click();
await page.getByRole('button', { name: 'Tải lại' }).click();
await page.waitForFunction(() => document.querySelector('#alme-title')?.value === 'Concurrent canonical');
check('reload conflict lấy snapshot mới', await page.locator('#alme-title').inputValue() === 'Concurrent canonical');

await page.locator('#alme-title').fill('Ambiguous edit');
await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
await page.getByRole('heading', { name: 'Lượt lưu cần đối chiếu' }).waitFor();
const patchCountBeforeReconcile = patchBodies.length;
await page.getByRole('button', { name: 'Đối chiếu canonical' }).click();
await page.getByText('Đã xác nhận lưu', { exact: true }).waitFor();
check('response mơ hồ được reconcile bằng GET, không PATCH lại', patchBodies.length === patchCountBeforeReconcile && canonical.title === 'Ambiguous edit');

await page.locator('#alme-title').fill('Acknowledged then forbidden');
await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
await page.getByText('PATCH đã nhận, chưa đọc lại được', { exact: true }).waitFor();
const patchCountAfterAcknowledged = patchBodies.length;
check('PATCH 200 rồi GET 403 vẫn giữ receipt và khóa phát lại', await page.getByRole('heading', { name: 'Lượt lưu cần đối chiếu' }).count() === 1 && await page.locator('#alme-title').isDisabled());
await page.getByRole('button', { name: 'Đối chiếu canonical' }).click();
await page.getByText('Đã xác nhận lưu', { exact: true }).waitFor();
check('readback 403 được reconcile bằng GET-only, không PATCH lần hai', patchBodies.length === patchCountAfterAcknowledged && canonical.title === 'Acknowledged then forbidden');

await page.evaluate(() => {
  const nativeSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function setItem(key, value) {
    if (String(key).startsWith('alme-pending:')) throw new DOMException('Storage disabled', 'QuotaExceededError');
    return nativeSetItem.call(this, key, value);
  };
});
const patchCountBeforeStorageFailure = patchBodies.length;
await page.locator('#alme-title').fill('Storage-blocked edit');
await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
await page.getByText('Không thể tạo biên nhận an toàn', { exact: true }).waitFor();
check('sessionStorage hỏng thì chặn trước PATCH và giữ form sửa được', patchBodies.length === patchCountBeforeStorageFailure && !(await page.locator('#alme-title').isDisabled()));

check('mobile không tràn ngang và action có touch target', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && parseFloat(getComputedStyle(document.querySelector('.alme-actions .adm-btn-primary')).minHeight) >= 44));
await page.setViewportSize({ width: 1440, height: 900 });
check('desktop dùng layout editor hai cột', await page.evaluate(() => getComputedStyle(document.querySelector('.alme-layout')).gridTemplateColumns.split(' ').length >= 2));
check('không có lỗi JS', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Listening content editor flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
