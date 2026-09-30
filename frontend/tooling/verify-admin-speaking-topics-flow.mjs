// Fixture-backed browser contract for native Speaking Topics operations.
// All backend calls are intercepted; no production topic or AI data is touched.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000117';
const authSession = JSON.stringify({ access_token: 'admin-speaking-topics-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'admin-topics@local' } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

const dangerous = '<img src=x onerror="window.__topicsXss=1">';
let topics = [
  { id: 't1', title: dangerous, category: 'Lifestyle', part: 1, is_active: true, question_count: 1, question_metadata_lookup_failed: false, status: 'has_questions', status_label: 'Has questions', updated_at: '2026-08-12T01:00:00Z', last_updated_at: '2026-08-12T01:00:00Z' },
  { id: 't2', title: 'Travel and tourism', category: 'Travel', part: 2, is_active: true, question_count: 2, question_metadata_lookup_failed: false, status: 'has_questions', status_label: 'Has questions', updated_at: '2026-08-12T02:00:00Z', last_updated_at: '2026-08-12T02:00:00Z' },
  { id: 't3', title: 'Technology', category: 'Society', part: 3, is_active: false, question_count: 0, question_metadata_lookup_failed: false, status: 'inactive', status_label: 'Inactive', updated_at: '2026-08-12T03:00:00Z', last_updated_at: '2026-08-12T03:00:00Z' },
];
const questions = new Map([
  ['t1', [{ id: 'q1', topic_id: 't1', part: 1, order_num: 1, question_text: dangerous, question_type: 'personal', cue_card_bullets: null, cue_card_reflection: null, audio_path: 'questions/q1.mp3' }]],
  ['t2', [
    { id: 'q2', topic_id: 't2', part: 2, order_num: 1, question_text: 'Describe a memorable journey.', question_type: 'cuecard', cue_card_bullets: ['where you went'], cue_card_reflection: 'Explain how you felt.', audio_path: 'questions/q2.mp3' },
    { id: 'q3', topic_id: 't2', part: 3, order_num: 1, question_text: 'Why do people travel?', question_type: 'opinion', cue_card_bullets: null, cue_card_reflection: null },
  ]],
  ['t3', []],
]);
let listReads = 0; let questionReads = 0; let metadataFails = false; let listFails = false;
let generationPending = false;
let acknowledgeGeneration;
let announceGeneration;
const generationStarted = new Promise((resolve) => { announceGeneration = resolve; });
const requests = []; const unexpectedWrites = []; const pageErrors = [];
const allowedWrites = [/^POST \/admin\/topics(?:\/bulk|\/bulk-delete|\/bulk-generate-questions|\/[^/]+\/questions|\/[^/]+\/generate-questions)$/, /^PATCH \/admin\/topics\/[^/]+(?:\/questions\/[^/]+)?$/, /^DELETE \/admin\/topics\/[^/]+(?:\/questions\/[^/]+)?$/, /^POST \/api\/(analytics\/events|error-logs)$/];

function decorateTopics() {
  return topics.map((topic) => {
    const count = (questions.get(topic.id) || []).length;
    return { ...topic, question_count: metadataFails ? null : count, question_metadata_lookup_failed: metadataFails, status: metadataFails ? 'metadata_unavailable' : topic.is_active === false ? 'inactive' : count ? 'has_questions' : 'no_questions' };
  });
}
function generatedRows(topic, mode) {
  const rows = topic.part === 2
    ? [{ id: `${topic.id}-g2`, topic_id: topic.id, part: 2, order_num: 1, question_text: 'Describe a generated topic.', question_type: 'cuecard', cue_card_bullets: ['what it was'], cue_card_reflection: 'Explain why.' }, { id: `${topic.id}-g3`, topic_id: topic.id, part: 3, order_num: 1, question_text: 'What is the wider impact?', question_type: 'opinion' }]
    : [{ id: `${topic.id}-g1`, topic_id: topic.id, part: topic.part, order_num: 1, question_text: `Generated ${mode}`, question_type: topic.part === 1 ? 'personal' : 'opinion' }];
  questions.set(topic.id, rows); return rows;
}

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), authSession]);
const page = await context.newPage();
page.on('pageerror', (error) => pageErrors.push(String(error)));
await page.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('about:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url); const method = request.method(); const signature = `${method} ${parsed.pathname}`;
  requests.push({ method, path: parsed.pathname, search: parsed.search, body: request.postDataJSON?.() });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !allowedWrites.some((pattern) => pattern.test(signature))) unexpectedWrites.push(signature);
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-topics@local', role: 'admin' });
  if (method === 'GET' && parsed.pathname === '/admin/topics') { listReads += 1; if (listFails) { listFails = false; return json({ detail: 'topics unavailable' }, 503); } return json(decorateTopics()); }
  const qList = parsed.pathname.match(/^\/admin\/topics\/([^/]+)\/questions$/);
  if (qList && method === 'GET') { questionReads += 1; return json(questions.get(qList[1]) || []); }
  if (parsed.pathname === '/admin/topics' && method === 'POST') {
    const body = request.postDataJSON(); const topic = { id: 't-new', title: body.title, category: body.category, part: body.part, is_active: true, question_count: 0, question_metadata_lookup_failed: false, status: 'no_questions', updated_at: '2026-08-13T01:00:00Z' }; topics.push(topic); questions.set(topic.id, []); return json(topic, 201);
  }
  if (parsed.pathname === '/admin/topics/bulk' && method === 'POST') {
    const body = request.postDataJSON(); const created = String(body.lines).split('\n').filter(Boolean).map((title, index) => ({ id: `bulk-${index}`, title, category: '', part: body.part, is_active: true, question_count: 0, question_metadata_lookup_failed: false, status: 'no_questions' })); topics.push(...created); created.forEach((topic) => questions.set(topic.id, [])); return json({ created: created.length, created_count: created.length, topics: created }, 201);
  }
  if (parsed.pathname === '/admin/topics/bulk-delete' && method === 'POST') {
    const ids = request.postDataJSON().topic_ids; topics = topics.filter((topic) => !ids.includes(topic.id)); ids.forEach((id) => questions.delete(id)); return json({ processed_count: ids.length, deleted_count: ids.length, deleted_ids: ids, failed_ids: [], errors: [] });
  }
  if (parsed.pathname === '/admin/topics/bulk-generate-questions' && method === 'POST') {
    const body = request.postDataJSON(); const success = []; const failed = [];
    for (const id of body.topic_ids) { const topic = topics.find((item) => item.id === id); if (!topic || (body.mode === 'missing_only' && (questions.get(id) || []).length)) failed.push(id); else { generatedRows(topic, body.mode); success.push(id); } }
    return json({ processed_count: body.topic_ids.length, success_count: success.length, success_ids: success, failed_ids: failed, errors: failed.map((id) => ({ topic_id: id, message: 'already has questions' })), mode: body.mode });
  }
  const generate = parsed.pathname.match(/^\/admin\/topics\/([^/]+)\/generate-questions$/);
  if (generate && method === 'POST') {
    generationPending = true;
    announceGeneration();
    await new Promise((resolve) => { acknowledgeGeneration = resolve; });
    const topic = topics.find((item) => item.id === generate[1]); const mode = request.postDataJSON().mode;
    generationPending = false;
    if (!topic) return json({ detail: 'not found' }, 404);
    if (mode === 'missing_only' && (questions.get(topic.id) || []).length) return json({ detail: 'already has questions' }, 409);
    const rows = generatedRows(topic, mode); return json({ topic_id: topic.id, topic_title: topic.title, mode, replaced_existing: mode === 'replace_all', question_count: rows.length, questions: rows });
  }
  const questionItem = parsed.pathname.match(/^\/admin\/topics\/([^/]+)\/questions\/([^/]+)$/);
  if (questionItem && method === 'PATCH') {
    const body = request.postDataJSON(); const rows = questions.get(questionItem[1]) || []; const row = rows.find((item) => item.id === questionItem[2]);
    const partChanged = Object.hasOwn(body, 'part') && body.part !== row.part;
    Object.assign(row, { part: body.part, question_type: body.question_type, order_num: body.order_num, cue_card_bullets: body.cue_card_bullets, cue_card_reflection: body.cue_card_reflection });
    if (Object.hasOwn(body, 'question_text')) Object.assign(row, { question_text: body.question_text, audio_path: null, audio_url: null });
    if (partChanged) Object.assign(row, { audio_path: null, audio_url: null });
    return json(row);
  }
  if (questionItem && method === 'DELETE') { questions.set(questionItem[1], (questions.get(questionItem[1]) || []).filter((row) => row.id !== questionItem[2])); return route.fulfill({ status: 204, body: '' }); }
  if (qList && method === 'POST') { const body = request.postDataJSON(); const row = { id: 'q-new', topic_id: qList[1], part: body.part, order_num: body.order_num || 2, question_text: body.question_text, question_type: body.question_type, cue_card_bullets: body.cue_card_bullets, cue_card_reflection: body.cue_card_reflection }; questions.set(qList[1], [...(questions.get(qList[1]) || []), row]); return json(row, 201); }
  const topicItem = parsed.pathname.match(/^\/admin\/topics\/([^/]+)$/);
  if (topicItem && method === 'PATCH') { const body = request.postDataJSON(); const topic = topics.find((item) => item.id === topicItem[1]); Object.assign(topic, { title: body.title ?? topic.title, category: body.category ?? topic.category, part: body.part ?? topic.part, is_active: body.is_active ?? topic.is_active }); return json(decorateTopics().find((item) => item.id === topicItem[1])); }
  if (topicItem && method === 'DELETE') { topics = topics.filter((item) => item.id !== topicItem[1]); questions.delete(topicItem[1]); return route.fulfill({ status: 204, body: '' }); }
  return json({});
});

await page.goto(`${BASE}/admin/speaking/topics?part=1&topic=t1`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Topics & questions', exact: true }).waitFor();
await page.locator('#ast-detail-title').filter({ hasText: dangerous }).waitFor();
check('admin gate, URL state và deep-linked detail đều chạy', requests.some((item) => item.path === '/auth/me') && new URL(page.url()).searchParams.get('part') === '1' && questionReads >= 1);
check('hostile topic/question render thành text', await page.locator('.ast-shell img, .ast-shell script').count() === 0 && await page.evaluate(() => !window.__topicsXss));
check('mobile table thành card và không tràn ngang', await page.evaluate(() => getComputedStyle(document.querySelector('.ast-table')).display === 'block' && document.documentElement.scrollWidth <= innerWidth));

await page.getByRole('tab', { name: /Part 2/ }).click();
await page.waitForURL((url) => url.searchParams.get('part') === '2' && !url.searchParams.has('topic'));
await page.getByRole('button', { name: /Travel and tourism/ }).click();
await page.getByRole('heading', { name: 'Travel and tourism', exact: true }).waitFor();
check('Part 2 topic hiển thị cả Part 2 và follow-up Part 3', await page.getByText('Part 2 · #1', { exact: true }).count() === 1 && await page.getByText('Part 3 · #1', { exact: true }).count() === 1);
const topicTrigger = page.getByRole('button', { name: /Travel and tourism/ });
const detailHeading = page.locator('#ast-detail-title');
await detailHeading.focus();
const detailCloseStart = requests.length;
await page.keyboard.press('Escape');
await page.waitForURL((url) => !url.searchParams.has('topic'));
check('Escape đóng chi tiết, trả focus về topic và không tạo write', await topicTrigger.evaluate((node) => node === document.activeElement)
  && !requests.slice(detailCloseStart).some((item) => item.path.startsWith('/admin/topics') && !['GET', 'HEAD', 'OPTIONS'].includes(item.method)));
await topicTrigger.click();
await detailHeading.waitFor();

async function cancelEditorWithFocus(trigger, title, fieldLabel) {
  const start = requests.length;
  const originalUrl = page.url();
  await trigger.click();
  const editor = page.getByRole('dialog', { name: title, exact: true });
  await editor.waitFor();
  const focusedPanel = await editor.evaluate((node) => node === document.activeElement);
  const close = editor.getByRole('button', { name: 'Đóng', exact: true });
  const last = editor.getByRole('button').last();
  await last.focus();
  await page.keyboard.press('Tab');
  const wrapsForward = await close.evaluate((node) => node === document.activeElement);
  await page.keyboard.press('Shift+Tab');
  const wrapsBackward = await last.evaluate((node) => node === document.activeElement);
  await editor.getByLabel(fieldLabel).focus();
  await page.keyboard.press('Escape');
  await editor.waitFor({ state: 'hidden' });
  check(`${title}: focus trong panel, Tab giữ bên trong, Escape trả đúng nút và không ghi`, focusedPanel && wrapsForward && wrapsBackward
    && await trigger.evaluate((node) => node === document.activeElement) && page.url() === originalUrl
    && !requests.slice(start).some((item) => item.path.startsWith('/admin/topics') && !['GET', 'HEAD', 'OPTIONS'].includes(item.method)));
}

await cancelEditorWithFocus(page.getByRole('button', { name: '+ Thêm topic', exact: true }), 'Thêm topic', 'Tên topic');
await cancelEditorWithFocus(page.getByRole('button', { name: '+ Thêm câu hỏi', exact: true }), 'Thêm câu hỏi', 'Nội dung câu hỏi');
const readsBeforeCreate = { list: listReads, questions: questionReads };
await page.getByRole('button', { name: '+ Thêm câu hỏi' }).click();
await page.getByLabel('Nội dung câu hỏi').fill('What makes a journey memorable?');
await page.getByLabel('Part thực tế').selectOption('3');
await page.getByLabel('Loại câu hỏi').fill('opinion');
await page.getByRole('button', { name: 'Lưu câu hỏi' }).click();
await page.getByText(/Đã thêm câu hỏi và đối chiếu lại từ máy chủ/).waitFor();
const createWrite = requests.find((item) => item.method === 'POST' && item.path === '/admin/topics/t2/questions');
check('create question gửi đủ Part/type/order rồi canonical readback', createWrite?.body?.part === 3 && createWrite.body.question_type === 'opinion' && createWrite.body.order_num === 0 && listReads > readsBeforeCreate.list && questionReads > readsBeforeCreate.questions);

const cueCard = page.locator('.ast-question').filter({ has: page.getByRole('heading', { name: 'Describe a memorable journey.' }) });
await cancelEditorWithFocus(cueCard.getByRole('button', { name: 'Sửa', exact: true }), 'Sửa câu hỏi', 'Nội dung câu hỏi');
await cueCard.getByRole('button', { name: 'Sửa' }).click();
await page.getByLabel('Part thực tế').selectOption('3');
await page.getByRole('button', { name: 'Lưu câu hỏi' }).click();
await page.getByText(/Đã cập nhật câu hỏi và đối chiếu lại từ máy chủ/).waitFor();
const clearCueWrite = requests.find((item) => item.method === 'PATCH' && item.path === '/admin/topics/t2/questions/q2');
check('đổi Part xoá cue-card metadata và audio cũ', clearCueWrite?.body?.part === 3 && !Object.hasOwn(clearCueWrite.body, 'question_text') && clearCueWrite.body.cue_card_bullets === null && clearCueWrite.body.cue_card_reflection === null && questions.get('t2')?.find((row) => row.id === 'q2')?.audio_path === null);

const rotateTrigger = page.locator('.ast-detail__actions').getByRole('button', { name: 'AI thay toàn bộ', exact: true });
const rotateDialog = page.getByRole('dialog', { name: 'Thay toàn bộ bộ câu hỏi?', exact: true });
const cancelRotateStart = requests.length;
await rotateTrigger.click();
await rotateDialog.waitFor();
const dialogFocused = await rotateDialog.evaluate((node) => node.contains(document.activeElement));
await page.keyboard.press('Escape');
await rotateDialog.waitFor({ state: 'hidden' });
check('AI confirmation nhận focus; Escape huỷ, trả focus và không gọi AI', dialogFocused && await rotateTrigger.evaluate((node) => node === document.activeElement)
  && !requests.slice(cancelRotateStart).some((item) => item.path.startsWith('/admin/topics') && !['GET', 'HEAD', 'OPTIONS'].includes(item.method)));
const readsBeforeRotate = { list: listReads, questions: questionReads };
const rotateRequestStart = requests.length;
await rotateTrigger.click();
await rotateDialog.waitFor();
await rotateDialog.getByRole('button', { name: 'Thay toàn bộ', exact: true }).click();
await generationStarted;
await rotateDialog.getByRole('button', { name: 'Đang xử lý…', exact: true }).waitFor();
await page.keyboard.press('Escape');
check('AI đang chờ ACK khoá nút và Escape không đóng confirmation', generationPending && await rotateDialog.isVisible()
  && await rotateDialog.getByRole('button', { name: 'Đang xử lý…', exact: true }).isDisabled());
acknowledgeGeneration();
await page.getByText(/Đã thay toàn bộ bộ câu hỏi.*Đã đối chiếu trạng thái đã lưu/).waitFor();
const rotateRequests = requests.slice(rotateRequestStart);
const rotateWrites = rotateRequests.filter((item) => item.method === 'POST' && item.path === '/admin/topics/t2/generate-questions' && item.body?.mode === 'replace_all');
check('destructive AI cần dialog, gửi replace_all và đọc lại hai nguồn', rotateWrites.length === 1 && listReads > readsBeforeRotate.list && questionReads > readsBeforeRotate.questions
  && rotateRequests.some((item) => item.method === 'GET' && item.path === '/admin/topics')
  && rotateRequests.some((item) => item.method === 'GET' && item.path === '/admin/topics/t2/questions')
  && await page.locator('.ast-question').count() === 2
  && await page.getByRole('heading', { name: 'Describe a generated topic.', exact: true }).count() === 1
  && await page.getByRole('heading', { name: 'What is the wider impact?', exact: true }).count() === 1);

await cancelEditorWithFocus(page.getByRole('button', { name: 'Thêm hàng loạt', exact: true }), 'Thêm nhiều topic · Part 2', 'Danh sách topic');
const readsBeforeBulkCreate = listReads;
await page.getByRole('button', { name: 'Thêm hàng loạt' }).click();
await page.getByLabel('Danh sách topic').fill('Environment\nPublic services');
await page.getByRole('button', { name: 'Tạo topic' }).click();
await page.getByText(/Đã tạo 2 topic Part 2 và đối chiếu lại từ máy chủ/).waitFor();
const bulkCreateWrite = requests.find((item) => item.method === 'POST' && item.path === '/admin/topics/bulk');
check('bulk create gửi đúng Part/dòng và đọc lại canonical', bulkCreateWrite?.body?.part === 2 && bulkCreateWrite.body.lines === 'Environment\nPublic services' && listReads > readsBeforeBulkCreate && topics.some((topic) => topic.id === 'bulk-0') && topics.some((topic) => topic.id === 'bulk-1'));

await page.getByLabel('Chọn Travel and tourism').check();
await page.getByLabel('Chọn Environment').check();
const readsBeforeBulkGenerate = { list: listReads, questions: questionReads };
await page.locator('.ast-bulkbar').getByRole('button', { name: 'AI sinh khi trống' }).click();
await page.getByRole('dialog', { name: 'Sinh câu hỏi cho 2 topic đang trống?' }).waitFor();
await page.getByRole('button', { name: 'Sinh khi trống', exact: true }).last().click();
await page.getByText(/AI hoàn tất 1\/2 topic.*1 topic được giữ nguyên hoặc gặp lỗi/).waitFor();
const bulkGenerateWrite = requests.find((item) => item.method === 'POST' && item.path === '/admin/topics/bulk-generate-questions');
check('bulk AI partial failure hiện lỗi và đọc lại topic thành công', bulkGenerateWrite?.body?.mode === 'missing_only' && bulkGenerateWrite.body.topic_ids.includes('t2') && bulkGenerateWrite.body.topic_ids.includes('bulk-0') && listReads > readsBeforeBulkGenerate.list && questionReads > readsBeforeBulkGenerate.questions && (questions.get('bulk-0') || []).length > 0);

await page.getByLabel('Chọn Environment').check();
await page.getByLabel('Chọn Public services').check();
const readsBeforeBulkDelete = listReads;
await page.locator('.ast-bulkbar').getByRole('button', { name: 'Xoá', exact: true }).click();
await page.getByRole('dialog', { name: 'Xoá 2 topic?' }).waitFor();
await page.getByRole('button', { name: 'Xoá các topic' }).click();
await page.getByText(/Đã xoá 2\/2 topic.*Đã đối chiếu trạng thái đã lưu/).waitFor();
const bulkDeleteWrite = requests.find((item) => item.method === 'POST' && item.path === '/admin/topics/bulk-delete');
check('bulk delete cần dialog và xác nhận biến mất qua GET', bulkDeleteWrite?.body?.topic_ids.includes('bulk-0') && bulkDeleteWrite.body.topic_ids.includes('bulk-1') && listReads > readsBeforeBulkDelete && !topics.some((topic) => topic.id === 'bulk-0' || topic.id === 'bulk-1')
  && await page.getByRole('button', { name: /^Environment/ }).count() === 0
  && await page.getByRole('button', { name: /^Public services/ }).count() === 0);

metadataFails = true;
await page.getByRole('button', { name: 'Làm mới' }).click();
await page.getByText('Không đọc được metadata câu hỏi.', { exact: true }).waitFor();
check('metadata lỗi hiển thị unknown và khóa missing-only', await page.getByText('Không rõ số câu', { exact: true }).count() >= 1 && await page.getByRole('button', { name: 'AI sinh khi trống' }).isDisabled());
metadataFails = false;

listFails = true;
await page.getByRole('button', { name: 'Làm mới' }).click();
await page.getByText(/Không thể làm mới — đang giữ snapshot trước/).waitFor();
check('refresh lỗi giữ snapshot thay vì giả danh sách trống', await page.getByRole('heading', { name: 'Travel and tourism', exact: true }).count() === 1);

await page.setViewportSize({ width: 1440, height: 900 });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Topics & questions', exact: true }).waitFor();
await page.locator('.ast-table').first().waitFor({ state: 'visible' });
check('desktop dùng bảng, detail hai cột và không tràn ngang', await page.evaluate(() => getComputedStyle(document.querySelector('.ast-table')).display === 'table' && getComputedStyle(document.querySelector('.ast-workspace')).gridTemplateColumns.split(' ').length === 2 && document.documentElement.scrollWidth <= innerWidth));
check('không có write ngoài contract', unexpectedWrites.length === 0, unexpectedWrites.join(', '));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));
console.log(JSON.stringify({ topicWrites: requests.filter((item) => item.path.startsWith('/admin/topics') && !['GET', 'HEAD', 'OPTIONS'].includes(item.method)), listReads, questionReads, unexpectedWrites }, null, 2));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Speaking Topics native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
