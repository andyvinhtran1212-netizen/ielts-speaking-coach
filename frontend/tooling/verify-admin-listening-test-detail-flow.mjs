// Fixture-backed browser contract for native Admin Listening test detail.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000121';
const session = JSON.stringify({ access_token: 'admin-listening-test-detail-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'listening-test-detail@local' } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

let status = 'draft'; let mode = 'parts_auto_assembled'; let mapPresent = true; let fullAudioPresent = false; let hardDeleted = false; let failNextMode = true;
let detailReads = 0; let audioReads = 0; const writes = []; const errors = [];
const sections = [1, 2, 3, 4].map((number) => ({ id: `c${number}`, section_num: number, title: number === 1 ? 'Section <img onerror=alert(1)>' : `Section ${number}`, status: 'draft', audio_storage_path: `tests/t1/section-${number}.mp3`, audio_ready: true, exercise_count: number }));
const detailPayload = () => ({
  id: 't1', test_id: 'C19-T1', title: 'Test <script>alert(1)</script>', status, test_type: 'full', version: '1.0',
  band_target: 7.5, accent_profile: ['British'], total_transcript_words: 2200, exam_only: false,
  audio_assembly_mode: mode, full_audio_storage_path: fullAudioPresent ? 'tests/t1/full.mp3' : null,
  full_audio_duration_seconds: fullAudioPresent ? 1800 : null, full_audio_size_bytes: fullAudioPresent ? 1048576 : null,
  assembled_audio_storage_path: 'tests/t1/assembled.mp3', assembled_audio_generated_at: '2026-08-14T00:00:00Z',
  cue_points: [{ type: 'section_start', section_num: 1, timestamp_seconds: 12.5 }],
  sections,
  plan_label_exercises: [{ id: 'e1', content_id: 'c1', section_num: 1, has_map_image: mapPresent, map_image_source: 'manual_upload', letter_options: ['A', 'B'] }],
  created_at: '2026-08-13T00:00:00Z', updated_at: '2026-08-14T00:00:00Z',
});

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), session]);
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(String(error)));
await page.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url); const method = request.method();
  const json = (body, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'listening-test-detail@local', role: 'admin' });
  if (parsed.pathname === '/admin/listening/tests/t1' && method === 'GET') {
    detailReads += 1;
    if (detailReads > 2) await new Promise((resolve) => setTimeout(resolve, 320));
    if (hardDeleted) return json({ detail: 'not found' }, 404);
    return json(detailPayload());
  }
  if (parsed.pathname === '/admin/listening/tests/t1/audio/signed-urls' && method === 'GET') {
    audioReads += 1;
    return json({
      full: { audio_storage_path: fullAudioPresent ? 'tests/t1/full.mp3' : null, signed_url: fullAudioPresent ? 'https://storage.test/full.mp3' : null, duration_seconds: 1800, size_bytes: 1048576 },
      assembled: { audio_storage_path: 'tests/t1/assembled.mp3', signed_url: 'https://storage.test/assembled.mp3', generated_at: '2026-08-14T00:00:00Z' },
      sections: [1, 2, 3, 4].map((number) => ({ section_num: number, audio_storage_path: `tests/t1/section-${number}.mp3`, signed_url: `https://storage.test/s${number}.mp3` })),
    });
  }
  if (parsed.pathname === '/admin/listening/exercises/e1/map-image/signed-url' && method === 'GET') return json({ detail: 'signing unavailable' }, 500);
  if (parsed.pathname === '/admin/listening/tests/t1/audio/mode' && method === 'PATCH') {
    writes.push({ path: parsed.pathname, body: request.postDataJSON() });
    if (failNextMode) { failNextMode = false; return json({ detail: 'fixture mode failure' }, 503); }
    mode = request.postDataJSON().mode;
    return json({ id: 't1', audio_assembly_mode: 'parts_only' }); // stale ACK
  }
  if (parsed.pathname === '/admin/listening/tests/t1/audio/full' && method === 'POST') {
    writes.push({ path: parsed.pathname, contentType: request.headers()['content-type'] }); fullAudioPresent = true;
    return json({ full_audio_storage_path: 'stale/wrong.mp3' });
  }
  if (parsed.pathname === '/admin/listening/tests/t1/audio/assemble' && method === 'POST') {
    writes.push({ path: parsed.pathname }); mode = 'parts_auto_assembled';
    return json({ assembled_audio_storage_path: 'stale/wrong.mp3' });
  }
  if (parsed.pathname === '/admin/listening/tests/t1/status' && method === 'PATCH') {
    writes.push({ path: parsed.pathname, body: request.postDataJSON() }); status = request.postDataJSON().status;
    return json({ id: 't1', status: 'archived' }); // stale ACK
  }
  if (parsed.pathname === '/admin/listening/exercises/e1/map-image' && method === 'DELETE') {
    writes.push({ path: parsed.pathname }); mapPresent = false; return json({ deleted: true, had_image: true });
  }
  if (parsed.pathname === '/admin/listening/exercises/e1/upload-map-image' && method === 'POST') {
    writes.push({ path: parsed.pathname, contentType: request.headers()['content-type'] }); mapPresent = true;
    return json({ exercise_id: 'wrong', map_image_storage_path: 'stale/wrong.png' });
  }
  if (parsed.pathname === '/admin/listening/tests/t1' && method === 'DELETE') {
    writes.push({ path: parsed.pathname }); status = 'archived'; sections.forEach((section) => { section.status = 'archived'; });
    return json({ id: 't1', status: 'archived' });
  }
  if (parsed.pathname === '/admin/listening/tests/t1/hard' && method === 'DELETE') {
    writes.push({ path: parsed.pathname }); hardDeleted = true;
    return json({ deleted: true, id: 't1', test_id: 'C19-T1', cascade_count: { content: 4, exercises: 10, attempts: 3, storage_files_removed: 6, storage_files_failed: [] } });
  }
  if (parsed.pathname === '/admin/listening/tests' && method === 'GET') return json({ items: [], total: 0, limit: 20, offset: 0 });
  return json({ detail: `unhandled fixture ${method} ${parsed.pathname}` }, 404);
});

await page.goto(`${BASE}/admin/listening/tests/t1`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'C19-T1', exact: true }).waitFor();
check('admin gate và independent canonical reads chạy', detailReads >= 1 && audioReads >= 1);
check('hostile title/section được React escape', await page.locator('script').filter({ hasText: 'alert' }).count() === 0 && await page.getByText('Test <script>alert(1)</script>', { exact: true }).count() === 1 && await page.getByText('Section <img onerror=alert(1)>', { exact: true }).count() >= 1);
check('map signing failure không bị diễn giải thành thiếu hình', await page.getByText(/Có storage record nhưng không mở được preview/).count() === 1 && await page.getByText('Manual upload', { exact: true }).count() === 1);
check('rollback giữ đúng identity', await page.getByRole('link', { name: 'Mở bản HTML rollback ↗' }).getAttribute('href') === '/pages/admin/listening/tests-detail.html?id=t1');
check('mobile detail không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

await page.getByRole('button', { name: 'Render & assemble' }).click();
await page.getByText('Assembled audio đã được backend xác nhận.', { exact: true }).waitFor();
check('assemble bỏ stale ACK và đối chiếu test/audio GET', writes.some((write) => write.path.endsWith('/audio/assemble')) && audioReads >= 2);

const modeSelect = page.getByLabel('Chế độ audio');
await modeSelect.selectOption('full_premixed');
await page.getByText(/Không xác nhận được audio mode canonical/).waitFor();
check('PATCH mode lỗi quay về canonical state', await modeSelect.inputValue() === 'parts_auto_assembled' && writes.find((write) => write.path.endsWith('/audio/mode'))?.body.mode === 'full_premixed');

await modeSelect.selectOption('full_premixed');
await page.getByText('Đã đối chiếu backend: Full pre-mixed.', { exact: true }).waitFor();
check('stale mode ACK bị bỏ qua, exact GET quyết định UI', await modeSelect.inputValue() === 'full_premixed' && detailReads >= 3 && audioReads >= 2);

await page.locator('.altd-audio-panel input[type=file]').setInputFiles({ name: 'full.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('ID3 fixture audio bytes') });
await page.getByText('Full audio đã lưu và được backend xác nhận.', { exact: true }).waitFor();
check('multipart audio upload chỉ thành công sau path readback', fullAudioPresent && writes.some((write) => write.path.endsWith('/audio/full') && write.contentType?.startsWith('multipart/form-data')) && await page.getByText('tests/t1/full.mp3', { exact: true }).count() >= 1);

await page.getByRole('button', { name: 'Phát hành test' }).click();
const publishDialog = page.getByRole('dialog');
await publishDialog.getByRole('button', { name: 'Xác nhận thay đổi' }).click();
await page.waitForTimeout(100);
check('write đang reconcile khóa double-submit', await publishDialog.getByRole('button', { name: 'Đang đối chiếu…' }).isDisabled());
await page.getByText('Đã đối chiếu backend: Đã phát hành.', { exact: true }).waitFor();
check('status chỉ đổi sau canonical GET, không dùng stale ACK', writes.some((write) => write.body?.status === 'published') && await page.getByText('Đã phát hành', { exact: true }).count() >= 1);

await page.getByRole('button', { name: 'Xóa hình hiện tại' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận thay đổi' }).click();
await page.getByText('Đã xóa map của section 1.', { exact: true }).waitFor();
check('xóa map được GET readback xác nhận', writes.some((write) => write.path.endsWith('/map-image')) && await page.getByText('Chưa có hình', { exact: true }).count() === 1);

await page.locator('.altd-map-card input[type=file]').setInputFiles({ name: 'map.png', mimeType: 'image/png', buffer: Buffer.alloc(120, 1) });
await page.getByRole('button', { name: 'Xác nhận upload · $0' }).click();
await page.getByText('Map section 1 đã lưu với chi phí API $0.', { exact: true }).waitFor();
check('manual map upload dùng multipart và exact exercise readback', mapPresent && writes.some((write) => write.path.endsWith('/upload-map-image') && write.contentType?.startsWith('multipart/form-data')) && await page.getByText('Manual upload', { exact: true }).count() === 1);

await page.getByRole('button', { name: 'Lưu trữ toàn bundle' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận thay đổi' }).click();
await page.getByText('Test và toàn bộ section đã được lưu trữ.', { exact: true }).waitFor();
check('cascade archive xác nhận parent và 4 section', status === 'archived' && sections.every((section) => section.status === 'archived') && await page.getByText('Đã lưu trữ', { exact: true }).count() >= 5);

await page.getByRole('button', { name: 'Xóa vĩnh viễn' }).click();
const deleteDialog = page.getByRole('dialog');
const deleteButton = deleteDialog.getByRole('button', { name: 'Xóa vĩnh viễn' });
check('hard delete bị khóa trước khi nhập đúng identity', await deleteButton.isDisabled());
await deleteDialog.getByRole('textbox').fill('C19-T1');
await deleteButton.click();
await page.waitForURL(`${BASE}/admin/listening/tests`);
await page.getByText(/Đã xóa vĩnh viễn C19-T1/).waitFor();
check('hard delete chỉ điều hướng sau exact cascade ACK và giữ receipt', hardDeleted && writes.some((write) => write.path.endsWith('/hard')) && await page.getByText('Đã xóa', { exact: true }).count() === 1);

await page.setViewportSize({ width: 1440, height: 900 });
check('desktop không tràn trang', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
check('không có lỗi JS', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Listening test detail flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
