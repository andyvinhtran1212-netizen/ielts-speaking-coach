// Local browser proof for PDF findings 18–22. Every remote request is intercepted.
// No real session, business write, paid AI call or production content is used.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:3110';
const SB = process.env.SUPABASE_URL || 'https://example.supabase.co';
const adminId = '00000000-0000-4000-8000-000000000111';
const session = JSON.stringify({ access_token: 'local-remediation-fixture-only', refresh_token: 'x', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'remediation@example.test' } });
const results = [], writes = [], ratingBodies = [], errors = [], consoleErrors = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
let browser;
try { browser = await chromium.launch(); } catch (error) {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (process.platform !== 'darwin' || !existsSync(chrome)) throw error;
  browser = await chromium.launch({ executablePath: chrome });
}
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(([key, value]) => { try { localStorage.setItem(key, value); } catch { /* Sandboxed preview has no storage permission. */ } }, [storageKey(SB), session]);
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
const contexts = [
  { context: { insertionPoint: 'Sau đoạn 2 <script>window.fixtureInjected=true</script>', reasoning: 'Xét quan điểm đối lập.' }, expected: 'Sau đoạn 2 <script>window.fixtureInjected=true</script>' },
  { context: 'Sau phần mở bài.', expected: 'Sau phần mở bài.' },
  { context: {}, expected: 'Không có counterargument' },
  { context: { insertionPoint: '', reasoning: 'Lý do khi thiếu vị trí.' }, expected: 'Lý do khi thiếu vị trí.' },
];
const feedback = (index) => ({ overall_band_score: 6.5, feedback_json: { counterargumentAnalysis: { isPresent: false, feedback: 'Cần phản đề.', suggestion: 'Thêm một ý đối lập.', context: contexts[index].context } } });
const essay = (id) => ({ id, status: 'delivered', task_type: 'task2', grading_tier: 'standard', analysis_level: 3, created_at: '2026-09-01T00:00:00Z', essay_text: 'Some people believe education should be free.', prompt_text: 'Discuss both views.', selected_model: 'fixture', student: { full_name: 'Fixture Student' } });
const article = { slug: 'past-perfect', title: 'Past Perfect', category: 'tenses', summary: 'Published summary', band: 7, view_count: 12, save_count: null, source_path: 'backend/content/tenses/past-perfect.md' };
let previewReads = 0, inventoryMode = 'duplicate', catalogReady = false, pilotReady = false;
const testRow = (index) => ({ id: `test-${index}`, test_id: `LIS-${index}`, title: `Listening ${index}`, status: 'published', test_type: 'full', exam_only: false, section_count: 4, audio_ready_count: 4, accent_profile: [], band_target: 7, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' });
const unavailable = { detail: { error_code: 'feature_unavailable', feature: 'vocab_curated', message: 'Chưa xác minh schema Curated.' } };
const delayed = { eligible_unit_starts: 0, assessed_unit_starts: 0, attempts: 0, transfer_attempts: 0, followup_rate_percent: null, accuracy_percent: null, transfer_success_percent: null };
const metrics = { period_days: 90, computed_at: '2026-09-01T00:00:00Z', cohort: { enabled_users: 12, learners_started: 4, unit_starts: 7 }, runtime_flags: { vocab_units_read: true, vocab_unit_attempts_write: true, vocab_unit_recommendations: false, vocab_ai_scoring: false }, immediate: { eligible_unit_starts: 6, completed_unit_starts: 5, attempts: 24, completion_rate_percent: 83.3, accuracy_percent: 75 }, day7: delayed, day28: delayed, recommendations: { created: 3, opened: 1, completed: 0, dismissed: 0, open_rate_percent: 33.3, completion_rate_percent: 0 }, units: [] };

await context.route('**/*', async (route) => {
  const request = route.request(), url = new URL(request.url());
  if (url.origin === new URL(BASE).origin || ['data:', 'about:'].includes(url.protocol)) return route.continue();
  const method = request.method(), path = url.pathname;
  const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !/^\/api\/(analytics\/events|error-logs)$/.test(path)) writes.push(`${method} ${path}`);
  if (path === '/auth/me') return json({ id: adminId, email: 'remediation@example.test', role: 'admin', is_active: true });
  if (path === '/admin/writing/essays/schema-0/grade-rating' && method === 'POST') {
    ratingBodies.push(request.postDataJSON());
    return json({ rating: ratingBodies.at(-1).rating, note: ratingBodies.at(-1).note });
  }
  if (path.match(/^\/admin\/writing\/essays\/schema-[0-3]$/)) { const index = Number(path.at(-1)); return json({ ...essay(`schema-${index}`), feedback: feedback(index) }); }
  if (path.match(/^\/api\/writing\/my-essays\/schema-[0-3]$/)) { const index = Number(path.at(-1)); return json({ essay: essay(`schema-${index}`), feedback: feedback(index) }); }
  if (path.endsWith('/regrade-request')) return json({ request: null });
  if (path === '/api/writing/tips') return json({ tips: [] });
  if (path === '/admin/grammar/articles') return json({ total: 1, available_total: 1, items: [article], categories: ['tenses'], analytics_status: { views: 'complete', saves: 'unavailable' } });
  if (path.endsWith('/past-perfect/preview')) { previewReads += 1; return json(previewReads === 1 ? article : { slug: 'past-perfect', html: '<h1>Full Markdown body</h1>' }); }
  if (path === '/admin/listening/tests') {
    if (inventoryMode === 'fail') return json({ detail: 'Inventory network fixture failure' }, 503);
    const offset = Number(url.searchParams.get('offset'));
    const items = offset === 0 ? Array.from({ length: 100 }, (_, index) => testRow(index)) : [testRow(inventoryMode === 'duplicate' ? 0 : 100)];
    return json({ items, total: 101, limit: 100, offset });
  }
  const match = path.match(/^\/admin\/listening\/tests\/test-(\d+)\/audit$/);
  if (match) { const row = testRow(Number(match[1])); return json({ uuid: row.id, test_id: row.test_id, title: row.title, status: row.status, test_type: row.test_type, question_count: 40, section_count: 4, live: { issues: [], health: { error_count: 0, warning_count: 0, status: 'passed' } }, saved: null }); }
  if (path === '/admin/vocabulary/editorial/units') return catalogReady ? json({ items: [], total: 0, offset: 0, limit: 100 }) : json(unavailable, 503);
  if (path === '/admin/vocabulary/pilot-metrics') return pilotReady ? json(metrics) : json(unavailable, 503);
  return json({});
});

try {
  for (let index = 0; index < contexts.length; index += 1) {
    await page.goto(`${BASE}/admin/writing/grade?id=schema-${index}`, { waitUntil: 'domcontentloaded' });
    await page.locator('#grade-rating-panel').waitFor();
    await page.locator('#tab-nangcao').click();
    const text = await page.locator('#content-counterargument').textContent();
    check(`F19 admin context branch ${index}`, text.includes(contexts[index].expected) && !text.includes('[object Object]'));
    check(`F19 admin escapes markup branch ${index}`, await page.locator('#content-counterargument script').count() === 0 && await page.evaluate(() => !window.fixtureInjected));
    if (index === 0) {
      await page.getByRole('button', { name: '3 sao', exact: true }).click();
      await page.locator('#gr-note').fill('Nhận xét chưa lưu');
      for (let round = 0; round < 5; round += 1) for (const key of ['tongquan', 'loi', 'nangcao', 'baimau']) await page.locator(`#tab-${key}`).click();
      check('F18 one panel/save after 5 rounds × 4 tabs', await page.locator('#grade-rating-panel').count() === 1 && await page.locator('#gr-save').count() === 1);
      check('F18 unsaved rating/note survive tabs', await page.getByRole('button', { name: '3 sao', exact: true }).getAttribute('aria-pressed') === 'true' && await page.locator('#gr-note').inputValue() === 'Nhận xét chưa lưu');
      check('F18 tabs never POST rating', writes.length === 0);
      await page.locator('#gr-save').click();
      await page.getByText('✓ Đã lưu đánh giá', { exact: true }).waitFor();
      check('F18 explicit Save submits exactly the retained rating/note once', ratingBodies.length === 1
        && ratingBodies[0].rating === 3 && ratingBodies[0].note === 'Nhận xét chưa lưu'
        && writes.length === 1 && writes[0] === 'POST /admin/writing/essays/schema-0/grade-rating');
    }
    await page.goto(`${BASE}/writing/result?id=schema-${index}`, { waitUntil: 'domcontentloaded' });
    await page.locator('#state-ready').waitFor();
    await page.locator('#tab-nangcao').click();
    const learnerText = await page.locator('#content-counterargument').textContent();
    check(`F19 learner context branch ${index}`, learnerText.includes(contexts[index].expected) && !learnerText.includes('[object Object]'));
    check(`F19 learner escapes markup branch ${index}`, await page.locator('#content-counterargument script').count() === 0 && await page.evaluate(() => !window.fixtureInjected));
  }

  await page.goto(`${BASE}/admin/grammar/articles`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Xem trước' }).click();
  await page.getByText(/thiếu nội dung HTML/).waitFor();
  check('F21 missing HTML is distinct from identity error', await page.locator('iframe[title="Preview Past Perfect"]').count() === 0 && await page.getByText(/Preview không đúng bài đang chọn/).count() === 0);
  await page.getByRole('button', { name: 'Thử lại xem trước' }).click();
  await page.locator('iframe[title="Preview Past Perfect"]').waitFor();
  check('F21 retry replaces failed cache and keeps sandbox', previewReads === 2 && await page.locator('iframe[title="Preview Past Perfect"]').getAttribute('sandbox') === '' && (await page.locator('iframe').getAttribute('srcdoc')).includes('Full Markdown body'));

  await page.goto(`${BASE}/admin/listening/audit`, { waitUntil: 'domcontentloaded' });
  await page.getByText(/lặp giữa các page/).waitFor();
  check('F22 partial/duplicate inventory has no false zero/loading', JSON.stringify(await page.locator('.alqa-summary strong').allTextContents()) === JSON.stringify(['—', '—', '—', '—']) && await page.getByText('Không hoàn tất', { exact: true }).count() === 1 && await page.getByText('Đang đọc từ backend…', { exact: true }).count() === 0);
  inventoryMode = 'ready';
  await page.getByRole('button', { name: 'Thử lại inventory' }).click();
  await page.getByText('Live scan hoàn tất', { exact: true }).waitFor();
  check('F22 successful retry covers all 101 tests', await page.locator('.alqa-table tbody tr').count() === 101 && (await page.locator('.alqa-summary strong').allTextContents())[0] === '101');
  inventoryMode = 'fail';
  await page.getByRole('button', { name: 'Làm mới toàn bộ' }).click();
  await page.getByText(/Không thể làm mới — đang giữ snapshot trước/).waitFor();
  check('F22 failed refresh retains complete snapshot marked stale', await page.locator('.alqa-table tbody tr').count() === 101 && await page.getByText(/Snapshot trước · chưa làm mới được/).count() === 1);

  await page.goto(`${BASE}/admin/vocab/curated`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Curated Editorial chưa khả dụng', { exact: true }).waitFor();
  check('F20 Curated unavailable has no empty/zero claim', await page.getByText('Không có unit phù hợp.', { exact: true }).count() === 0 && await page.getByText('0 unit toàn catalog', { exact: true }).count() === 0);
  catalogReady = true;
  await page.getByRole('button', { name: 'Thử lại catalog' }).click();
  await page.getByText('Không có unit phù hợp.', { exact: true }).waitFor();
  check('F20 successful empty catalog remains distinct', await page.getByText('0 unit toàn catalog', { exact: true }).count() === 1);

  await page.goto(`${BASE}/admin/vocab/pilot-metrics`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Pilot Metrics chưa khả dụng trên môi trường này', { exact: true }).waitFor();
  check('F20 pilot cannot mutate before ready', await page.getByRole('button', { name: 'Thêm vào pilot' }).isDisabled() && await page.getByRole('button', { name: 'Rút khỏi pilot' }).isDisabled() && await page.getByRole('region', { name: 'Rollout gates' }).count() === 0);
  pilotReady = true;
  await page.getByRole('button', { name: 'Thử lại số liệu' }).click();
  await page.getByRole('region', { name: 'Rollout gates' }).waitFor();
  check('F20 pilot retry restores actual metrics and nullable outcomes', !await page.getByRole('button', { name: 'Thêm vào pilot' }).isDisabled() && await page.getByText('12', { exact: true }).count() > 0 && await page.getByText('Chưa đủ dữ liệu', { exact: true }).count() > 0);
  check('only the explicit mocked rating Save writes across journeys', writes.length === 1
    && writes[0] === 'POST /admin/writing/essays/schema-0/grade-rating', writes.join(', '));
  check('no JS exception or duplicate-key console warning', errors.length === 0 && !consoleErrors.some((message) => /same key|Non-unique keys/.test(message)), errors.join(' | '));
} finally { await browser.close(); }
const failures = results.filter((item) => !item.ok);
console.log(`Admin remediation: ${results.length - failures.length}/${results.length} checks passed`);
if (failures.length) process.exitCode = 1;
