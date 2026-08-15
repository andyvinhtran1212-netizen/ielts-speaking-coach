import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000001148'; const testId = 'test-audit-detail';
const session = JSON.stringify({ access_token: 'audit-detail-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'audit-detail@local' } });
const checks = []; const jsErrors = []; const requests = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

let contentVersion = '2026-08-14T01:00:00Z'; let exerciseVersion = '2026-08-14T01:00:00Z'; let transcript = 'Original transcript';
let siblingPrompt = 'Sibling prompt';
let question = { prompt: 'Original prompt', answer: 'A', alternatives: ['one'], trap_mechanisms: ['contrast'], options: [{ letter: 'A', text: 'One' }], solution: 'Original reason', audio_window: { start: 4, end: 7, section: 'S2' } };
let saved = { test_id: testId, status: 'has_issues', notes: '', auditor: adminId, audited_at: '2026-08-14T02:00:00Z', updated_at: '2026-08-14T02:00:00Z', health: { error_count: 1, warning_count: 0, status: 'has_issues' }, issues: [{ q_num: 1, dimension: 'solution', severity: 'error', source: 'llm', code: 'answer_in_script', message: 'Không thấy đáp án', resolved: false }] };
let postCount = 0; let triageCount = 0; let receiptBeforePost = false; let audioFail = false; let lastRunRequestId = null;
const auditPayload = () => ({ uuid: testId, test_id: 'ILR-AUD-DETAIL', title: 'Canonical repair fixture', status: 'published', test_type: 'full', question_count: 2, section_count: 2,
  sections: [{ section_num: 2, content_id: 'content-2', content_updated_at: contentVersion, audio_offset: 100, transcript, questions: [{ q_num: 1, exercise_id: 'exercise-1', exercise_updated_at: exerciseVersion, template_kind: 'mcq_3option', ...question, audio_window: { ...question.audio_window, start: 104, end: 107 } },
    { q_num: 2, exercise_id: 'exercise-1', exercise_updated_at: exerciseVersion, template_kind: 'mcq_3option', prompt: siblingPrompt, answer: 'B', alternatives: [], trap_mechanisms: [], options: [{ letter: 'A', text: 'One' }, { letter: 'B', text: 'Two' }], solution: 'Sibling reason', audio_window: { start: 108, end: 110, section: 'S2' } }] },
    { section_num: 3, content_id: 'content-3', content_updated_at: '2026-08-14T01:00:00Z', audio_offset: 200, transcript: 'Section three', questions: [] }],
  live: { issues: [], health: { error_count: 0, warning_count: 0, status: 'passed' } }, saved });

const browser = await launch(); const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(([key, value]) => {
  localStorage.setItem(key, value); window.__auditReceiptWrites = [];
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function (name, next) { if (name.includes('aver:admin:listening-audit-run')) window.__auditReceiptWrites.push({ name, next }); return original.call(this, name, next); };
}, [storageKey(SB), session]);
const page = await context.newPage(); page.on('pageerror', (error) => jsErrors.push(String(error)));
await page.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('about:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url); const method = request.method(); requests.push(`${method} ${parsed.pathname}`);
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'audit-detail@local', role: 'admin' });
  if (parsed.pathname === `/admin/listening/tests/${testId}/audit` && method === 'GET') return json(auditPayload());
  if (parsed.pathname === `/admin/listening/tests/${testId}/audio/signed-urls`) return audioFail ? json({ detail: 'audio fixture offline' }, 503) : json({ assembled: null, full: null, sections: [{ section_num: 1, signed_url: 'https://cdn.test/section-1.mp3' }, { section_num: 2, signed_url: 'https://cdn.test/section-2.mp3' }, { section_num: 3, signed_url: null }] });
  if (parsed.pathname === '/admin/listening/content/content-2' && method === 'PATCH') {
    const body = request.postDataJSON(); if (body.expected_updated_at !== contentVersion) return json({ detail: 'stale' }, 409);
    transcript = body.transcript; contentVersion = '2026-08-14T03:00:00Z'; return json({ id: 'content-2', transcript, updated_at: contentVersion });
  }
  if (parsed.pathname === '/admin/listening/exercises/exercise-1/questions/1' && method === 'PATCH') {
    const body = request.postDataJSON(); if (body.expected_updated_at !== exerciseVersion) return json({ detail: 'stale' }, 409);
    question = { prompt: body.prompt, answer: body.answer, alternatives: body.alternatives, trap_mechanisms: body.trap_mechanisms, options: body.options, solution: body.solution, audio_window: body.audio_window };
    siblingPrompt = 'External change from another tab'; exerciseVersion = '2026-08-14T04:00:00Z';
    saved = { ...saved, notes: 'External triage note', updated_at: '2026-08-14T04:30:00Z' };
    return json({ exercise_id: 'exercise-1', q_num: 1, updated_at: exerciseVersion, ok: true });
  }
  if (parsed.pathname === `/admin/listening/tests/${testId}/audit/run` && method === 'POST') {
    postCount += 1; lastRunRequestId = request.postDataJSON().request_id; receiptBeforePost = (await page.evaluate(() => window.__auditReceiptWrites.length > 0));
    if (postCount === 1) return json({ detail: 'ambiguous fixture' }, 503);
    saved = { ...saved, audited_at: '2026-08-14T23:00:00Z', updated_at: '2026-08-14T23:00:00Z' };
    return json({ uuid: testId, audited_at: saved.audited_at, request_id: lastRunRequestId, status: saved.status, issues: saved.issues, health: saved.health });
  }
  if (parsed.pathname === `/admin/listening/tests/${testId}/audit` && method === 'PATCH') {
    triageCount += 1; const body = request.postDataJSON();
    if (body.expected_updated_at !== saved.updated_at) return json({ detail: 'stale triage' }, 409);
    saved = { ...saved, status: body.status, notes: body.notes, updated_at: '2026-08-14T07:00:00Z', issues: saved.issues.map((item, index) => body.resolved_indexes.includes(index) ? { ...item, resolved: true } : item) };
    return json({ test_id: testId, ...body, updated_at: saved.updated_at });
  }
  return json({ detail: `unhandled ${method} ${parsed.pathname}` }, 404);
});

await page.goto(`${BASE}/admin/listening/audit-detail?id=${testId}`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Canonical repair fixture' }).waitFor();
check('route binds exact test id and renders all canonical sections', await page.getByRole('tab').count() === 2 && await page.getByRole('tab', { name: /Section 2/ }).getAttribute('aria-selected') === 'true'
  && requests.some((value) => value === `GET /admin/listening/tests/${testId}/audit`)
  && !requests.some((value) => /\/admin\/listening\/tests\/[^/]+\/audit$/.test(value.split(' ')[1]) && !value.endsWith(`/${testId}/audit`)));

await page.locator('audio-player').evaluate((node) => { node.play = () => Promise.resolve(); node.seekTo = () => {}; });
await page.getByRole('button', { name: /Nghe window/ }).first().click();
check('question uses exact Section 2 audio fallback', await page.locator('audio-player').evaluate((node) => node.getAttribute('src')) === 'https://cdn.test/section-2.mp3');
check('section fallback rebases absolute window to section timebase', await page.locator('audio-player').evaluate((node) => node.getAttribute('segment-start')) === '4');

await page.getByLabel('Transcript canonical').first().fill('Draft survives tab switch');
await page.getByLabel('Prompt').first().fill('Question draft survives tab switch');
await page.getByRole('tab', { name: /Section 2/ }).press('ArrowRight');
await page.waitForFunction(() => document.querySelector('#alqad-tab-3')?.getAttribute('aria-selected') === 'true' && document.activeElement?.id === 'alqad-tab-3');
check('ARIA tabs move selection and focus with arrow keys', await page.getByRole('tab', { name: /Section 3/ }).getAttribute('aria-selected') === 'true' && await page.evaluate(() => document.activeElement?.id === 'alqad-tab-3'));
await page.getByRole('tab', { name: /Section 3/ }).press('ArrowLeft');
check('section tab switch preserves transcript and question drafts', await page.getByLabel('Transcript canonical').first().inputValue() === 'Draft survives tab switch' && await page.getByLabel('Prompt').first().inputValue() === 'Question draft survives tab switch');
await page.getByLabel('Transcript canonical').first().fill('Original transcript');
await page.getByLabel('Prompt').first().fill('Original prompt');

await page.getByLabel('Ghi chú người duyệt').fill('Unsaved triage note');
await page.getByLabel('Prompt').first().fill('Unsaved question draft');
const transcriptBox = page.getByLabel('Transcript canonical').first(); await transcriptBox.fill('Updated transcript'); await page.getByRole('button', { name: 'Lưu transcript' }).first().click();
await page.getByText('Đã lưu và đọc lại transcript Section 2.').waitFor();
check('transcript PATCH carries version/readback without discarding question drafts', transcript === 'Updated transcript' && contentVersion.endsWith('03:00:00Z') && await page.getByLabel('Prompt').first().inputValue() === 'Unsaved question draft' && requests.filter((value) => value === `GET /admin/listening/tests/${testId}/audit`).length >= 2);
check('transcript/question readbacks preserve in-progress triage input', await page.getByLabel('Ghi chú người duyệt').inputValue() === 'Unsaved triage note');

await page.getByLabel('Prompt').first().fill('Updated prompt'); await page.getByLabel('Prompt').nth(1).fill('Unsaved sibling draft'); await page.getByLabel(/Options · mỗi dòng/).first().fill('A | Alpha\nB | Beta'); await page.getByLabel('Trap mechanisms · mỗi dòng một giá trị').first().fill('contrast\ndistractor');
await page.getByRole('button', { name: 'Lưu Câu 1' }).click(); await page.getByText('Đã lưu và đọc lại Câu 1.').waitFor();
check('question PATCH preserves but locks a sibling draft changed canonically', question.prompt === 'Updated prompt' && question.options.length === 2 && question.trap_mechanisms.length === 2 && exerciseVersion.endsWith('04:00:00Z') && await page.getByLabel('Prompt').nth(1).inputValue() === 'Unsaved sibling draft' && await page.getByText('Câu 2 đã đổi ở nguồn canonical', { exact: true }).count() === 1 && await page.getByRole('button', { name: 'Lưu Câu 2' }).isDisabled());
check('external saved-audit write preserves but stale-locks triage input', await page.getByLabel('Ghi chú người duyệt').inputValue() === 'Unsaved triage note' && await page.getByText('Saved audit đã đổi', { exact: true }).count() === 1 && await page.getByRole('button', { name: 'Lưu & đọc lại' }).isDisabled());

await page.getByRole('button', { name: 'Chạy full audit' }).click(); await page.getByRole('button', { name: 'Tạo receipt & chạy' }).click();
await page.getByText(/Không tự gửi lại POST/).first().waitFor();
check('receipt is durable before ambiguous POST and remains visible after 503', receiptBeforePost && postCount === 1 && await page.getByText('Full audit đang cần đối chiếu', { exact: true }).count() === 1);
await page.getByRole('button', { name: 'Bỏ receipt & cho phép chạy lại' }).click();
await page.getByRole('button', { name: 'Giữ receipt' }).click();
check('receipt discard requires explicit confirmation and cancel keeps the lock', await page.getByText('Full audit đang cần đối chiếu', { exact: true }).count() === 1 && await page.getByRole('button', { name: 'Chạy full audit' }).isDisabled());
await page.reload({ waitUntil: 'domcontentloaded' }); await page.getByRole('heading', { name: 'Canonical repair fixture' }).waitFor();
check('reload does not replay ambiguous POST', postCount === 1);
saved = { ...saved, audited_at: '2026-08-14T23:00:00Z', updated_at: '2026-08-14T23:00:00Z', health: { ...saved.health, request_id: lastRunRequestId } };
await page.getByRole('button', { name: 'Đối chiếu bằng GET' }).click(); await page.getByText(/receipt được khép an toàn/).waitFor();
check('GET-only reconciliation closes ambiguous receipt', postCount === 1 && await page.getByText('Full audit đang cần đối chiếu', { exact: true }).count() === 0);

await page.getByLabel('Trạng thái').selectOption('fixed'); await page.getByRole('button', { name: 'Lưu & đọc lại' }).click();
await page.getByText(/Còn 1 error chưa chọn xử lý/).waitFor(); check('UI blocks fixed while saved error remains unresolved', triageCount === 0);
await page.locator('.alqad-issue input[type="checkbox"]').check(); await page.getByRole('button', { name: 'Lưu & đọc lại' }).click(); await page.getByText(/trạng thái triage canonical/).waitFor();
check('triage resolves explicit saved index then canonical GET confirms', triageCount === 1 && saved.status === 'fixed' && saved.issues[0].resolved);

const mobile = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
check('mobile workspace does not overflow horizontally', mobile.scroll <= mobile.width, JSON.stringify(mobile));
check('mobile controls meet touch target', await page.getByRole('tab', { name: /Section 2/ }).evaluate((node) => parseFloat(getComputedStyle(node).minHeight) >= 44));
audioFail = true; await page.reload({ waitUntil: 'domcontentloaded' }); await page.getByText('Audio lookup failed', { exact: true }).waitFor();
check('audio lookup failure stays unknown rather than missing audio', await page.getByText('Không kết luận rằng test thiếu audio.', { exact: false }).count() === 1);
await page.setViewportSize({ width: 1440, height: 900 }); check('desktop workspace does not overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
check('no JavaScript errors', jsErrors.length === 0, jsErrors.join(' | '));

await browser.close(); const failed = checks.filter((item) => !item.ok);
console.log(`\nAdmin Listening audit detail flow: ${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exitCode = 1;
