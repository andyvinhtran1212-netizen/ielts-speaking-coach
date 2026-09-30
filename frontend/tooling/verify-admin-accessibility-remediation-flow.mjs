// Native inline panels and embedded Mock review; remote APIs are local fixtures.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';
const BASE = process.argv[2] || 'http://127.0.0.1:3110';
const SB = process.env.SUPABASE_URL || 'https://example.supabase.co';
const results = [], writes = [], errors = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
let browser;
try { browser = await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform !== 'darwin' || !existsSync(chrome)) throw error; browser = await chromium.launch({ executablePath: chrome }); }
const context = await browser.newContext({ viewport: { width: 1182, height: 757 } });
const session = JSON.stringify({ access_token: 'accessibility-local-fixture', refresh_token: 'x', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'admin-1', email: 'admin@example.test' } });
await context.addInitScript(([key, value]) => { try { localStorage.setItem(key, value); } catch {} }, [storageKey(SB), session]);
const page = await context.newPage(); page.on('pageerror', (error) => errors.push(String(error)));
const topic = { id: 'topic-1', title: 'Travel and tourism', category: 'Travel', part: 1, is_active: true, question_count: 1, question_metadata_lookup_failed: false, status: 'has_questions', updated_at: '2026-09-01T00:00:00Z', last_updated_at: '2026-09-01T00:00:00Z' };
const attempt = { id: 'attempt-1', status: 'submitted', score: 8, total_questions: 10, accuracy: .8, duration_seconds: 750, started_at: '2026-09-01T00:00:00Z', submitted_at: '2026-09-01T00:12:30Z', created_at: '2026-09-01T00:00:00Z', user: { id: 'user-1', email: 'learner@example.test', display_name: 'Learner' }, test: { id: 'test-1', test_id: 'LIS-1', title: 'Listening', test_type: 'full' } };
const vocabId = '00000000-0000-4000-8000-000000000401';
const vocabTopic = { id: vocabId, slug: 'work-careers', title: 'Work and Careers', title_vi: 'Công việc và nghề nghiệp', skill_area: 'vocab', description: 'Canonical vocabulary topic', order: 1, is_published: true, updated_at: '2026-09-01T00:00:00Z' };
const exam = { id: 'exam-1', code: 'MOCK-1', title: 'Completed exam', status: 'published', exam_mode: 'sequential', is_open: false, active_section: 'done', review_eligible: true };
let rosterCount = 25;
await context.route('**/*', async (route) => {
  const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
  if (url.origin === new URL(BASE).origin) return route.continue();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !/^\/api\/(analytics\/events|error-logs)$/.test(path)) writes.push(`${method} ${path}`);
  const json = (value) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
  if (path === '/auth/me') return json({ id: 'admin-1', email: 'admin@example.test', role: 'admin', is_active: true });
  if (path === '/admin/topics') return json([topic]);
  if (path === '/admin/topics/topic-1/questions') return json([{ id: 'question-1', topic_id: topic.id, part: 1, order_num: 1, question_text: 'Do you like travelling?', question_type: 'personal', cue_card_bullets: null, cue_card_reflection: null, audio_path: 'questions/fixture.mp3' }]);
  if (path === '/admin/listening/attempts') return json({ items: [attempt], total: 1, offset: 0, limit: 50, association_lookup_failed: false, association_lookup_failures: [] });
  if (path === '/admin/listening/attempts/attempt-1') return json({ ...attempt, grading_details: [{ q_num: 1, correct: true, user_answer: 'A', expected: 'A', trap_caught: false }], band_estimate: 7, association_lookup_failed: false, association_lookup_failures: [], trap_analytics: null });
  if (path === '/admin/content-topics') return json([vocabTopic]);
  if (path.endsWith(`/${vocabId}/bundle`)) return json({ topic: vocabTopic, vocab_cards: [], quiz_banks: [{ id: '00000000-0000-4000-8000-000000000402', code: 'L02', title: 'Career vocabulary Quick Check', skill_area: 'vocab', words_count: 20, is_published: true }], counts: { vocab_cards: 0, quiz_banks: 1 } });
  if (path === '/admin/mock-exams') return json({ exams: [exam] });
  if (path === '/admin/mock-exams/exam-1/roster') return json({ roster: Array.from({ length: rosterCount }, (_, index) => ({ sitting_id: `sitting-${index}`, review_id: `review-${index}`, student_name: `Learner ${index}`, sitting_status: 'all_submitted', listening: { score: 30, max: 40, band: 7 }, reading: { score: 28, max: 40, band: 6.5 }, writing: { task1_wc: 170, task2_wc: 280, task1_essay_id: 'essay-1', task2_essay_id: 'essay-2', band: null, band_is_final: false }, speaking: { count: 1, band: null, band_is_final: false }, review_status: 'queued', claimed: false, needs_retest: false, retest_flags: {} })) });
  if (path === '/admin/mock-exams/exam-1/retest-summary') return json({ total_sittings: rosterCount, reviewed_sittings: 0, needs_retest_count: 0, per_skill: { listening: 0, reading: 0, writing: 0, speaking: 0 }, students: [] });
  return json({});
});
try {
  await page.goto(`${BASE}/admin/speaking/topics`, { waitUntil: 'domcontentloaded' });
  const topicButton = page.getByRole('button', { name: /Travel and tourism Travel/ });
  await topicButton.click();
  await page.waitForFunction(() => document.activeElement?.id === 'ast-detail-title');
  check('A-UX01 topic detail takes heading focus', await page.locator('#ast-detail-title').evaluate((node) => node === document.activeElement));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !new URL(location.href).searchParams.has('topic'));
  check('A-UX01 Escape closes and restores topic trigger', await page.locator('.ast-detail').count() === 0 && await topicButton.evaluate((node) => node === document.activeElement));
  await topicButton.click();
  await page.locator('.ast-detail').getByRole('button', { name: '+ Thêm câu hỏi' }).click();
  await page.getByRole('dialog', { name: 'Thêm câu hỏi' }).waitFor();
  await page.keyboard.press('Escape');
  check('A-UX01 nested editor Escape retains detail', await page.getByRole('dialog').count() === 0 && await page.locator('.ast-detail').count() === 1);

  await page.goto(`${BASE}/admin/listening/attempts?user=learner&type=full&status=submitted`, { waitUntil: 'domcontentloaded' });
  const attemptButton = page.getByRole('button', { name: 'Xem từng câu' });
  await attemptButton.click();
  await page.waitForFunction(() => document.activeElement?.id === 'ala-detail-title');
  check('A-UX02 attempt detail takes heading focus', await page.locator('#ala-detail-title').evaluate((node) => node === document.activeElement));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !new URL(location.href).searchParams.has('attempt'));
  check('A-UX02 Escape closes, restores row focus and retains filters', await page.locator('.ala-detail').count() === 0 && await attemptButton.evaluate((node) => node === document.activeElement) && new URL(page.url()).searchParams.get('user') === 'learner' && new URL(page.url()).searchParams.get('status') === 'submitted');

  for (const size of [{ width: 1182, height: 757 }, { width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size);
    await page.goto(`${BASE}/admin/vocab/topics?topic=${vocabId}`, { waitUntil: 'domcontentloaded' });
    await page.locator('.avv-topic-form').waitFor();
    const bounds = await page.evaluate(() => ({ pageWidth: document.documentElement.scrollWidth, viewport: innerWidth, fields: [...document.querySelectorAll('.avv-topic-form input,.avv-topic-form textarea')].map((field) => ({ right: field.getBoundingClientRect().right, parentRight: field.closest('form').getBoundingClientRect().right, width: field.getBoundingClientRect().width })) }));
    check(`A-UX03 Vocab fields stay within form at ${size.width}`, bounds.pageWidth <= bounds.viewport && bounds.fields.every((field) => field.right <= field.parentRight + 1), JSON.stringify(bounds));
    await page.goto(`${BASE}/admin/mock-tests?tab=review&exam_id=exam-1`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe');
    await frame.locator('.mrr-roster tbody tr').first().waitFor();
    await page.waitForFunction(() => {
      const node = document.querySelector('iframe');
      return node?.contentDocument?.querySelectorAll('.mrr-roster tbody tr').length === 25
        && node.contentDocument.documentElement.scrollHeight <= node.contentDocument.documentElement.clientHeight + 2;
    }, null, { timeout: 5000 }).catch(() => {});
    const scrolling = await page.locator('iframe').evaluate((node) => ({ client: node.contentDocument.documentElement.clientHeight, scroll: node.contentDocument.documentElement.scrollHeight, frameHeight: node.getBoundingClientRect().height, rows: node.contentDocument.querySelectorAll('.mrr-roster tbody tr').length }));
    check(`A-UX04 review uses outer scroll at ${size.width}`, scrolling.scroll <= scrolling.client + 2 && scrolling.rows === 25, JSON.stringify(scrolling));
    if (size.width === 1182) {
      for (const count of [3, 25]) {
        rosterCount = count;
        await frame.getByRole('button', { name: '↻ Tải lại', exact: true }).click();
        await page.waitForFunction((expectedRows) => {
          const node = document.querySelector('iframe');
          return node?.contentDocument?.querySelectorAll('.mrr-roster tbody tr').length === expectedRows
            && node.contentDocument.documentElement.scrollHeight <= node.contentDocument.documentElement.clientHeight + 2;
        }, count);
        const refreshed = await page.locator('iframe').evaluate((node) => ({ client: node.contentDocument.documentElement.clientHeight, scroll: node.contentDocument.documentElement.scrollHeight, frameHeight: node.getBoundingClientRect().height, rows: node.contentDocument.querySelectorAll('.mrr-roster tbody tr').length }));
        check(`A-UX04 iframe follows roster refresh to ${count} rows`, refreshed.rows === count
          && refreshed.scroll <= refreshed.client + 2
          && (count === 3 ? refreshed.frameHeight < scrolling.frameHeight : refreshed.frameHeight >= scrolling.frameHeight - 2), JSON.stringify(refreshed));
      }
    }
  }
  check('accessibility checks never write business data', writes.length === 0, writes.join(', '));
  check('no JS exceptions', errors.length === 0, errors.join(' | '));
} finally { await browser.close(); }
const failed = results.filter((result) => !result.ok);
console.log(`Admin accessibility remediation: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
