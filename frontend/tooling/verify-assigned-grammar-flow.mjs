// Actual built Next lesson UI with the released content, synthetic auth and
// intercepted assignment transport. This is UI evidence, not live DB proof.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { marked } from 'marked';

const BASE = new URL(process.argv[2] || 'http://localhost:3011').origin;
const API = 'https://assigned-grammar-fixture.invalid';
const version = process.env.GRAMMAR_LESSON_CONTENT_VERSION || 'v2';
assert.ok(['v2', 'v3'].includes(version));
const bytes = version === 'v3' ? Buffer.from(execFileSync(process.env.GRAMMAR_CONTENT_PYTHON || 'python3',
  ['-c', 'import json; from services.grammar_lesson_content import load_version; print(json.dumps(load_version("v3"),ensure_ascii=False))'],
  { cwd: new URL('../../backend/', import.meta.url), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }))
  : readFileSync(new URL('../../backend/content/master30-assigned-practice/v2.json', import.meta.url));
const packageData = JSON.parse(bytes);
assert.equal(Object.keys(packageData.lessons).length, 30);
const learnerLessonIds = process.env.GRAMMAR_LESSON_UI_ONLY
  ? process.env.GRAMMAR_LESSON_UI_ONLY.split(',') : Object.keys(packageData.lessons).sort();
assert.ok(learnerLessonIds.length && learnerLessonIds.every(id=>packageData.lessons[id]));
if (version === 'v3') assert.equal(Object.values(packageData.lessons).reduce((n,l) => n+l.questions.length,0),3100);
const counts = (lesson) => ({ objective_count: lesson.questions.filter(q => q.type !== 'writing').length,
  writing_count: lesson.questions.filter(q => q.type === 'writing').length,
  core_count: lesson.questions.filter(q => !q.supplementary).length,
  supplementary_count: lesson.questions.filter(q => q.supplementary).length });
const publicQuestion = (q, saved) => ({ id:q.id, prompt:q.prompt, options:q.options,
  type:q.type || 'mcq',format_code:q.format_code,supplementary:q.supplementary || false,
  ...(q.type==='writing' ? {output_requirements:q.output_requirements} : {}),
  ...(saved ? q.type==='writing' ? { ...saved,explanation:q.explanation,writing_feedback:{
    model_answer:q.model_answer,accepted_variants:q.accepted_variants,rubric:q.rubric,
    detailed_rubric:q.detailed_rubric,writing_skill:q.writing_skill,
  }} : {...saved,correct_index:q.correct_index,explanation:q.explanation,distractor_explanations:q.distractor_explanations} : {}),
});
async function feedbackIncludes(page, locator, explanation) {
  const expected = await page.evaluate((html) => {
    const element=document.createElement('div');element.innerHTML=html;
    for (const br of element.querySelectorAll('br')) br.replaceWith('\n');
    return (element.textContent || '').replace(/\s+/g,' ').trim();
  },marked.parse(explanation,{breaks:true}));
  return (await locator.innerText()).replace(/\s+/g,' ').includes(expected);
}
let browser;
try { browser = await chromium.launch(); }
catch (error) {
  const executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (process.platform !== 'darwin' || !existsSync(executablePath)) throw error;
  browser = await chromium.launch({ executablePath });
}
const checks = [];
const check = (name, ok) => { checks.push({ name, ok }); assert.ok(ok, name); };

async function runTeacher() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), trace = [], stored = new Map(), errors = [];
  const cohortId = 'grammar-course-five-fixture';
  let loseFirstResponse = true;
  await context.addInitScript(() => {
    window.__AVER_SUPABASE_CLIENT__ = { auth: {
      getSession: async () => ({ data: { session: { access_token: 'synthetic-teacher-token', user: { id: 'synthetic-teacher', email: 'teacher@fixture.invalid' } } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    } };
  });
  await context.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === BASE) {
      if (url.pathname === '/js/runtime-config.js') return route.fulfill({ contentType: 'application/javascript', body: `window.__AVER_RUNTIME_CONFIG__=Object.freeze({apiBase:${JSON.stringify(API)}});` });
      return route.continue();
    }
    if (url.origin !== API) return route.abort();
    const headers = { 'access-control-allow-origin': BASE, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'authorization,content-type,x-request-id' };
    const json = (value, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(value) });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    const entry = { method: request.method(), path: url.pathname, body: request.postDataJSON() };
    trace.push(entry);
    if (url.pathname === '/auth/me') return json({ id: 'synthetic-teacher', email: 'teacher@fixture.invalid', role: 'admin' });
    if (url.pathname === '/admin/courses') return json({ courses: [{ id: 'course-five', code: 'C5', name: 'Course 5', is_active: true }] });
    if (url.pathname === `/admin/cohorts/${cohortId}/members`) return json({
      cohort: { id: cohortId, name: 'Course 5 fixture', course_id: 'course-five', is_active: true }, member_count: 2,
      members: [{ student_id: 'student-one', student_code: 'S001', name: 'Học viên kiểm thử', user_id: 'user-one', sessions: 0, ai_cost_usd: 0 },
        { student_id: 'student-two', student_code: 'S002', name: 'Học viên còn lại', user_id: 'user-two', sessions: 0, ai_cost_usd: 0 }],
    });
    if (url.pathname === `/admin/cohorts/${cohortId}/grammar-lessons/catalog`) return json(Object.entries(packageData.lessons).map(([id, lesson], index) => ({
      id, lesson_no: index + 1, title: lesson.title, ready: true, reason: null,
      focus: lesson.focus, article: lesson.article || null, question_count: lesson.questions.length, content_version: version,
      practice_kind:version==='v3'?'full_original_bank':'mini_practice',...counts(lesson),
    })));
    if (url.pathname === `/admin/cohorts/${cohortId}/assignments`) {
      if (request.method() === 'GET') return json({ assignments: [...stored.values()], reconcile_failed: false });
      assert.equal(request.method(), 'POST');
      const body = entry.body;
      assert.equal(body.skill, 'grammar');
      assert.ok(packageData.lessons[body.grammar_lesson_id]);
      assert.match(body.give_request_id, /^[a-f0-9-]{36}$/);
      if (!stored.has(body.give_request_id)) stored.set(body.give_request_id, {
        id: body.give_request_id, status: 'published', kind: 'daily', skill: 'grammar', title: body.title,
        due_at: null, content_config: { assignment_type: 'grammar_lesson', lesson_id: body.grammar_lesson_id },
        recipient_scope: 'subset', progress: { assigned: 1, submitted: 0, late: 0, missing: 0, no_account: 0 },
      });
      if (loseFirstResponse) { loseFirstResponse = false; return json({ detail: 'fixture lost give response' }, 503); }
      return json({ student_count: 1, unactivated_count: 0 }, 201);
    }
    if (request.method() === 'GET' || url.pathname === '/api/analytics/events' || url.pathname === '/api/error-logs') return json({});
    throw new Error(`Unexpected teacher mutation: ${request.method()} ${url.pathname}`);
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.setDefaultTimeout(15000);
  try {
    await page.goto(`${BASE}/admin/classes/${cohortId}?tab=homework`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Bài tập', exact: true }).waitFor();
    for (const [index, lessonId] of ['M30-B02', 'M30-B07', 'M30-B18', 'M30-B02'].entries()) {
      await page.getByRole('button', { name: 'Giao bài lớp' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Kỹ năng').selectOption('grammar_lesson');
      const select = dialog.getByLabel('Bài Grammar');
      await select.locator('option[value="M30-B30"]').waitFor({ state: 'attached' });
      check(`teacher ${index}: all thirty approved lessons selectable`, await select.locator('option[value^="M30-B"]:not([disabled])').count() === 30);
      await select.selectOption(lessonId);
      if (version==='v3') check(`teacher ${lessonId}: exact full counts before give`,
        (await dialog.locator('.acd-warning').innerText()).includes(`${packageData.lessons[lessonId].questions.length} câu: 90 trắc nghiệm`));
      await dialog.getByLabel('Tên bài giao').fill(`Ôn ${lessonId} ${index}`);
      await dialog.getByLabel('Giao cho', { exact: true }).selectOption('subset');
      await dialog.getByText('Học viên kiểm thử', { exact: true }).click();
      await dialog.getByRole('button', { name: 'Giao cho 1 học viên' }).click();
      if (index === 0) {
        await dialog.getByText('fixture lost give response', { exact: true }).waitFor();
        const first = trace.filter((row) => row.method === 'POST' && row.path.endsWith('/assignments')).at(-1).body;
        await dialog.getByRole('button', { name: 'Giao cho 1 học viên' }).click();
        await dialog.waitFor({ state: 'hidden' });
        const retry = trace.filter((row) => row.method === 'POST' && row.path.endsWith('/assignments')).at(-1).body;
        check('teacher lost-response retry keeps give request and recipients', first.give_request_id === retry.give_request_id && JSON.stringify(retry.student_ids) === '["student-one"]' && stored.size === 1);
      } else await dialog.waitFor({ state: 'hidden' });
      await page.getByText('Đã giao bài cho 1 học viên.', { exact: true }).waitFor();
      await page.locator('tr').filter({ hasText: `Ôn ${lessonId} ${index}` }).waitFor();
    }
    const created = trace.filter((row) => row.method === 'POST' && row.path.endsWith('/assignments'));
    check('teacher repeat creates new explicit assignment', created.at(-1).body.give_request_id !== created[0].body.give_request_id && stored.size === 4);
    check('teacher mutations followed by canonical reload', created.slice(1).every((entry) => trace.slice(trace.indexOf(entry) + 1).some((row) => row.method === 'GET' && row.path === entry.path)));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('tr').filter({ hasText: 'Ôn M30-B02 3' }).waitFor();
    check('teacher all four assignments survive full reload', await page.locator('tr').filter({ hasText: /Ôn M30-B/ }).count() === 4);
    check('teacher no application errors', errors.length === 0);
  } catch (error) {
    console.error(JSON.stringify({ scope: 'teacher fixture failure', errors, trace, body: await page.locator('body').innerText() }));
    throw error;
  } finally { await context.close(); }
}

async function run(lessonId, width = 1366, theme = 'light', keyboard = false) {
  const lesson = packageData.lessons[lessonId];
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [], trace = [];
  let started = false, failNextRead = false, failFirstWriting = keyboard && version==='v3';
  const saved = {};
  const state = () => ({
    assignment_item_id: 'fixture-item', assignment_id: 'fixture-assignment',
    lesson_id: lessonId, title: lesson.title, instructions: 'Đọc bài trước khi luyện tập.',
    due_at: null, focus: lesson.focus, article: lesson.article || null,
    lesson_notes: lesson.lesson_notes, learning_objectives: lesson.learning_objectives,
    status: Object.keys(saved).length === lesson.questions.length ? 'completed' : started ? 'in_progress' : 'not_started',
    can_submit: Object.keys(saved).length !== lesson.questions.length,
    question_count: lesson.questions.length, answered_count: Object.keys(saved).length,
    correct_count: Object.values(saved).filter((row) => row.is_correct).length,
    content_version:version,...counts(lesson),writing_answered_count:Object.values(saved).filter(row=>row.answer_text!=null).length,
    attempt_id: started ? 'fixture-attempt' : null,
    questions: started ? lesson.questions.map((q) => publicQuestion(q,saved[q.id])) : [],
  });
  await context.addInitScript((theme) => {
    localStorage.setItem('theme', theme);
    window.__AVER_SUPABASE_CLIENT__ = { auth: {
      getSession: async () => ({ data: { session: { access_token: 'synthetic-grammar-token', user: { id: 'synthetic-grammar-user', email: 'grammar@fixture.invalid' } } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    } };
  }, theme);
  await context.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === BASE) {
      if (url.pathname === '/js/runtime-config.js') return route.fulfill({ contentType: 'application/javascript', body: `window.__AVER_RUNTIME_CONFIG__=Object.freeze({apiBase:${JSON.stringify(API)}});` });
      return route.continue();
    }
    if (url.origin !== API) return route.abort();
    const headers = { 'access-control-allow-origin': BASE, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'authorization,content-type,x-request-id' };
    const json = (value, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(value) });
    const method = request.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    trace.push({ method, path: url.pathname });
    if (url.pathname === '/auth/me') return json({ id: 'synthetic-grammar-user', email: 'grammar@fixture.invalid', role: 'user', is_active: true, onboarding_completed: true });
    if (url.pathname === '/api/analytics/events' || url.pathname === '/api/error-logs') return json({});
    if (method === 'GET' && url.pathname === '/api/grammar/lessons/items/fixture-item') {
      if (failNextRead) { failNextRead = false; return json({ detail: 'Không thể tải bài. Thử lại.' }, 503); }
      return json(state());
    }
    if (method === 'POST' && url.pathname.endsWith('/fixture-item/start')) { started = true; return json(state()); }
    if (method === 'POST' && url.pathname.endsWith('/fixture-item/answers')) {
      const body = request.postDataJSON(), q = lesson.questions.find((row) => row.id === body.question_id);
      assert.ok(q);
      if (q.type==='writing') {
        assert.equal(body.answer_text, 'My own sentence.\nReason deliberately omitted.');
        assert.equal(body.selected_index,undefined);
        if (failFirstWriting) {failFirstWriting=false;return json({detail:'Writing save failed; draft retained'},503);}
        saved[q.id]={answer_text:body.answer_text};
      } else saved[q.id] = { selected_index: body.selected_index, is_correct: body.selected_index === q.correct_index };
      return json(state());
    }
    throw new Error(`Unexpected transport: ${method} ${url.pathname}`);
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.setDefaultTimeout(15000);
  try {
    await page.goto(`${BASE}/grammar-lessons/assigned?assignment_item=fixture-item`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: `${lessonId} · ${lesson.title}`, exact: true }).waitFor();
    check(`${lessonId}: requested ${theme} theme is active`,await page.locator('html').getAttribute('data-theme')===theme);
    await page.locator('.agl-notes h2,.agl-notes h3').first().waitFor();
    check(`${lessonId}: own frozen teaching and objectives`, (await page.locator('.agl-notes').innerText()).length > 1000 && await page.getByText(lesson.learning_objectives[0], { exact: true }).count() > 0);
    const start = page.getByRole('button', { name: 'Bắt đầu luyện tập' });
    if (keyboard) { await start.focus(); await page.keyboard.press('Enter'); } else await start.click();
    await page.locator('.agl-question').nth(lesson.questions.length - 1).waitFor();
    check(`${lessonId}: no key/explanation before answering`, await page.locator('.agl-feedback').count() === 0);
    for (const [index, q] of lesson.questions.entries()) {
      const card = page.locator('.agl-question').nth(index);
      const writing=q.type==='writing';
      const raw='My own sentence.\nReason deliberately omitted.';
      if (writing) {
        check(`${lessonId}/${q.id}: output visible before model`,await card.getByText('Yêu cầu bài viết',{exact:true}).count()===1 && await card.locator('.agl-feedback').count()===0);
        await card.getByRole('textbox').fill(raw);
      } else {
        const radio = card.getByRole('radio').nth(index === 0 ? (q.correct_index + 1) % 4 : q.correct_index);
        if (keyboard) { await radio.focus(); await page.keyboard.press('Space'); } else await radio.check();
      }
      const submit = card.getByRole('button', { name: writing?'Lưu và đối chiếu':'Kiểm tra câu này' });
      const expectWriteFailure=writing && failFirstWriting;
      if (keyboard) { await submit.focus(); await page.keyboard.press('Enter'); } else await submit.click();
      if (expectWriteFailure) {
        await page.getByRole('alert').filter({hasText:'Writing save failed'}).waitFor();
        check(`${lessonId}: failed E save preserves exact draft`,await card.getByRole('textbox').inputValue()===raw);
        await submit.click();
      }
      await card.locator('.agl-feedback').waitFor();
      check(`${lessonId}/${q.id}: actual reviewed correction`,await feedbackIncludes(page,card.locator('.agl-feedback'),q.explanation));
      if (writing) {
        check(`${lessonId}/${q.id}: exact raw writing with no correctness claim`,(await card.locator('.agl-feedback').innerText()).includes(raw) && await card.getByText('Đã lưu bài viết · Chưa chấm điểm',{exact:true}).count()===1 && await card.locator('.is-correct,.is-incorrect').count()===0);
        check(`${lessonId}/${q.id}: saved model and rubric`,await feedbackIncludes(page,card.locator('.agl-feedback'),q.model_answer) && await feedbackIncludes(page,card.locator('.agl-feedback'),q.rubric));
        check(`${lessonId}/${q.id}: keyboard focus reaches saved feedback`,await card.locator('[tabindex="-1"]').evaluate(el=>el===document.activeElement));
      }
    }
    const objective=counts(lesson).objective_count;
    await page.getByText(new RegExp(`Đã hoàn thành: ${objective-1}/${objective} câu đúng`)).waitFor();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.agl-feedback').nth(lesson.questions.length - 1).waitFor();
    check(`${lessonId}: completed result and notes survive reload`, await page.locator('.agl-feedback').count() === lesson.questions.length && await page.locator('.agl-notes').count() === 1);
    check(`${lessonId}: only intended lesson mutations`, trace.filter((row) => row.path.endsWith('/start')).length === 1 && trace.filter((row) => row.path.endsWith('/answers')).length === lesson.questions.length+(keyboard&&version==='v3'?1:0) && !trace.some((row) => /diagnostic|exposure/.test(row.path)));
    if (keyboard) {
      check(`${lessonId}: mobile layout has no page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      failNextRead = true;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
      await page.locator('.agl-feedback').nth(lesson.questions.length - 1).waitFor();
      check(`${lessonId}: failed read/retry retains completed work`, await page.locator('.agl-feedback').count() === lesson.questions.length);
    }
    check(`${lessonId}: no application errors`, errors.length === 0);
    console.log(`${lessonId}: ${lesson.questions.length} questions verified`);
  } catch (error) {
    if (process.env.GRAMMAR_LESSON_UI_REPORT) {
      await page.screenshot({path:process.env.GRAMMAR_LESSON_UI_REPORT.replace(/\.json$/,`-${lessonId}-failure.png`)}).catch(()=>{});
      console.log('Failure page metrics',JSON.stringify(await page.evaluate(()=>({scrollY,viewport:innerHeight,
        pageHeight:document.documentElement.scrollHeight,activeTag:document.activeElement?.tagName})).catch(()=>({}))));
    }
    throw error;
  } finally { await context.close(); }
}
async function runTeacherReport() {
  const context = await browser.newContext({ viewport: { width: 1366, height: 1000 } });
  const page = await context.newPage(), errors = [];
  let reads = 0;
  const lesson = packageData.lessons['M30-B02'];
  await context.addInitScript(() => {
    window.__AVER_SUPABASE_CLIENT__ = { auth: {
      getSession: async () => ({ data: { session: { access_token: 'synthetic-teacher-token', user: { id: 'synthetic-teacher', email: 'teacher@fixture.invalid' } } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    } };
  });
  await context.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === BASE) {
      if (url.pathname === '/js/runtime-config.js') return route.fulfill({ contentType: 'application/javascript', body: `window.__AVER_RUNTIME_CONFIG__=Object.freeze({apiBase:${JSON.stringify(API)}});` });
      return route.continue();
    }
    if (url.origin !== API) return route.abort();
    const headers = { 'access-control-allow-origin': BASE, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'authorization,content-type,x-request-id' };
    const json = (value, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(value) });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    if (url.pathname === '/auth/me') return json({ id: 'synthetic-teacher', email: 'teacher@fixture.invalid', role: 'admin' });
    if (url.pathname === '/admin/grammar-lessons/attempts/fixture-report') {
      reads++;
      if (reads === 1) return json({ detail: 'Report read failed' }, 503);
      return json({ attempt_id: 'fixture-report', assignment_item_id: 'fixture-item',
        assignment_title: 'Reviewed B02', lesson_id: 'M30-B02', status: 'completed',
        correct_count:counts(lesson).objective_count-1, question_count:lesson.questions.length,...counts(lesson),
        writing_answered_count:counts(lesson).writing_count,completed_at:null,article:null,focus:lesson.focus,
        questions:lesson.questions.map((q,index)=>publicQuestion(q,q.type==='writing'?{answer_text:'Teacher sees actual raw writing.'}:{selected_index:index===0?(q.correct_index+1)%4:q.correct_index,is_correct:index!==0})),
      });
    }
    if (request.method() === 'GET' || url.pathname === '/api/analytics/events' || url.pathname === '/api/error-logs') return json({});
    throw new Error(`Unexpected report mutation: ${request.method()} ${url.pathname}`);
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.setDefaultTimeout(15000);
  try {
    await page.goto(`${BASE}/admin/grammar-lessons?attempt=fixture-report`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('alert').filter({ hasText: 'Report read failed' }).waitFor();
    check('teacher report cold bootstrap reaches visible read failure', reads === 1 && errors.length === 0);
    await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
    await page.getByRole('heading', { name: 'M30-B02 · Reviewed B02', exact: true }).waitFor();
    const objective=counts(lesson).objective_count;
    check('teacher report retry loads canonical count', await page.getByText(`${objective-1}/${objective} câu${version==='v3'?' trắc nghiệm':''} đúng`, { exact: true }).count() === 1);
    for (const [index,q] of lesson.questions.entries()) check(`teacher report ${q.id}: reviewed feedback`,await feedbackIncludes(page,page.locator('.agl-feedback').nth(index),q.explanation));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.agl-feedback').nth(lesson.questions.length-1).waitFor();
    check('teacher report reload retains all corrections without application errors', reads === 3 && errors.length === 0);
  } finally { await context.close(); }
}

try {
  await runTeacher();
  await runTeacherReport();
  for (const id of learnerLessonIds) await run(id);
  await run('M30-B02', 390, 'dark', true);
} finally {
  await browser.close();
  if (process.env.GRAMMAR_LESSON_UI_REPORT) writeFileSync(process.env.GRAMMAR_LESSON_UI_REPORT, JSON.stringify({
    scope: `Built Next UI, exact reviewed ${version} content, synthetic intercepted HTTP; not hosted DB/deployment proof`,
    learner_lesson_ids: learnerLessonIds,
    package_sha256: createHash('sha256').update(bytes).digest('hex'), checks,
  }, null, 2));
}
console.log(`${checks.length} assigned Grammar UI checks passed`);
