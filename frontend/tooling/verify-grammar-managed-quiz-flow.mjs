// Existing Next server only. Actual captured public wire + actual shared engine;
// auth/HTTP are isolated fixture transports, not a persistence/publication proof.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { createEngine } from '../public/js/quiz-engine.js';
import { canonicalQuizBankPolicy } from '../public/js/quiz-text-match-policy.js';

const BASE = new URL(process.argv[2] || 'http://localhost:3011').origin;
const API = 'https://grammar-native-fixture.invalid';
const wireBytes = readFileSync(new URL('../tests/fixtures/grammar-native-public-wire.json', import.meta.url));
const wire = JSON.parse(wireBytes);
const controls = JSON.parse(readFileSync(new URL('../tests/fixtures/grammar-exact-form-controls.json', import.meta.url)));
const requests = wire.rows.flatMap((row) => row.requests.map((request) => ({ ...request, case: row.case })));
const clone = (value) => structuredClone(value);
const results = [];
const scenarios = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
function flow(name, legacy = false) {
  const rows = requests.filter((row) => row.case.includes(name));
  const banks = rows.filter((row) => row.method === 'GET' && row.status === 200 && row.response?.bank);
  const bank = (banks.find((row) => row.response.grammar.content_state === (legacy ? 'legacy' : 'current')) || banks[0])?.response;
  const start = rows.find((row) => row.path === '/api/quiz/sessions' && row.status === 201 && row.response.grammar.bank_id === bank?.bank.id)?.response;
  if (!bank || !start) throw new Error(`Missing actual bank/start wire: ${name}`);
  return { bank: clone(bank), start: clone(start), rows };
}
function engineFor(bank, options = {}) {
  const validated = canonicalQuizBankPolicy(bank, bank.bank.id);
  return createEngine({ meta: validated.meta, questions: validated.questions }, options);
}
function masteredResume(bank) {
  const engine = engineFor(bank);
  for (let item = engine.next(), guard = 0; item; item = engine.next()) {
    if (++guard > bank.questions.length * 12) throw new Error('Actual engine mastery did not terminate');
    engine.submit(rightAnswer(item.question));
  }
  return engine.drainBatch().word_stats;
}
const rightAnswer = (q) => q.input === 'text' ? q.accept[0] : q.input === 'boolean' ? Boolean(q.answer) : q.answer;
const wrongAnswer = (q) => q.input === 'text' ? '__incorrect__' : q.input === 'boolean' ? !Boolean(q.answer) : (q.answer + 1) % (q.options || q.segments).length;
const renderedText = (value) => String(value).replaceAll('**', '').replace(/_{2,}/g, '').replace(/\s+/g, ' ').trim();
let browser;
try { browser = await chromium.launch(); } catch (error) {
  const executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (process.platform !== 'darwin' || !existsSync(executablePath)) throw error;
  browser = await chromium.launch({ executablePath });
}

async function fixture(selected, options = {}) {
  const context = await browser.newContext({ viewport: { width: options.width || 390, height: 900 }, colorScheme: options.theme || 'light', reducedMotion: options.reducedMotion || 'no-preference' });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const trace = [], errors = [];
  let resume = clone(options.resume ?? selected.start.resume), bankReads = 0, resumeReads = 0, startCount = 0, progressCount = 0;
  const banks = new Map([selected, ...(options.alternate ? [options.alternate] : [])].map((item) => [item.bank.bank.id, item]));
  const holds = {};
  for (const kind of ['bank', 'start']) if (options[`hold${kind[0].toUpperCase()}${kind.slice(1)}`]) {
    let release, finish;
    const promise = new Promise((resolve) => { release = resolve; });
    const finished = new Promise((resolve) => { finish = resolve; });
    holds[kind] = { promise, release, finished, finish };
  }
  const waitHeld = async (kind) => {
    let timer;
    try {
      await Promise.race([holds[kind].promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Held ${kind} response was not released within15s`)), 15_000); })]);
    } finally { clearTimeout(timer); }
  };
  await context.addInitScript(() => {
    window.__AVER_SUPABASE_CLIENT__ = { auth: {
      getSession: async () => ({ data: { session: { access_token: 'synthetic-token', user: { id: 'grammar-fixture-user', email: 'grammar@example.com' } } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    } };
  });
  await context.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (url.origin === BASE) {
      if (request.isNavigationRequest() && url.pathname === '/login') return route.fulfill({ contentType: 'text/html', body: '<h1>Fixture login</h1>' });
      if (url.pathname === '/js/runtime-config.js') return route.fulfill({ contentType: 'application/javascript', body: `window.__AVER_RUNTIME_CONFIG__=Object.freeze({apiBase:${JSON.stringify(API)}});` });
      return route.continue();
    }
    if (url.origin !== API) return route.abort();
    const headers = { 'access-control-allow-origin': BASE, 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS', 'access-control-allow-headers': 'authorization,content-type,x-request-id' };
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    const json = (value, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(value) });
    const entry = { method, path: url.pathname, body: request.postDataJSON(), response: null };
    if (url.pathname.startsWith('/api/quiz/')) trace.push(entry);
    const bankId = url.pathname.match(/^\/api\/quiz\/banks\/([^/]+)$/)?.[1];
    if (method === 'GET' && banks.has(bankId)) {
      const readNumber = ++bankReads;
      try {
        if (readNumber === 1 && holds.bank) { entry.response = 'held-bank'; await waitHeld('bank'); }
        if (request.failure()?.errorText === 'net::ERR_ABORTED') { entry.response = 'disposed-bank'; return; }
        if (readNumber === 2 && options.reset === 'success') await new Promise((resolve) => setTimeout(resolve, 250));
        if (options.bankStatus) { entry.response = 'bank-error'; return await json({ detail: 'Controlled owned bank unavailable' }, options.bankStatus); }
        entry.response = 'bank'; return await json(readNumber > 1 && options.afterBank ? options.afterBank : banks.get(bankId).bank);
      } finally { if (readNumber === 1) holds.bank?.finish(); }
    }
    if (method === 'GET' && url.pathname.endsWith('/resume')) {
      resumeReads++; entry.response = 'resume';
      const ownerId = url.pathname.match(/^\/api\/quiz\/banks\/([^/]+)\/resume$/)?.[1];
      return json(ownerId === selected.bank.bank.id ? resume : (banks.get(ownerId)?.start.resume ?? []));
    }
    if (method === 'POST' && url.pathname === '/api/quiz/sessions') {
      startCount++;
      if (startCount === 1 && holds.start) { entry.response = 'held-start'; await waitHeld('start'); }
      if (options.start === 'lost' || options.start === 'lost-once' && startCount === 1) { entry.response = 'lost-start'; return route.abort('connectionfailed'); }
      if (options.start === 'unauthorized') return json({ detail: 'Fixture unauthorized' }, 401);
      if (options.start === 'forbidden') return json({ detail: 'Controlled owner access denied' }, 403);
      if (options.start === 'conflict') {
        const actual = selected.rows.find((row) => row.path === '/api/quiz/sessions' && row.status === 409);
        if (!actual) throw new Error('No actual start conflict in captured wire');
        return json(actual.response, 409);
      }
      const ack = clone((banks.get(entry.body.bank_id) || selected).start);
      if (options.start === 'missing-policy') delete ack.grammar.text_match_policy;
      if (options.start === 'wrong-bank') ack.grammar.bank_id = '22222222-2222-4222-8222-222222222222';
      if (options.start === 'wrong-revision') ack.grammar.bank_revision = 'c'.repeat(64);
      if (options.start === 'invalid-resume') ack.resume = null;
      entry.response = 'start'; return json(ack, 201);
    }
    if (method === 'POST' && url.pathname.endsWith('/progress')) {
      progressCount++;
      if (options.progress === 'stale' || options.progress === 'stale-once' && progressCount === 1) {
        const actual = selected.rows.find((row) => row.path.endsWith('/progress') && row.status === 409);
        entry.response = 'stale'; return json(actual.response, 409);
      }
      // Transport counts echo the received actual-engine batch; no grade/credit double.
      entry.response = 'progress';
      const owner = [...banks.values()].find((item) => url.pathname.includes(item.start.session_id)) || selected;
      return json({ ok: true, attempts: entry.body.attempts.length, word_stats: entry.body.word_stats.length, grammar: owner.start.grammar });
    }
    if (method === 'PATCH' && url.pathname === `/api/quiz/sessions/${selected.start.session_id}`) {
      const actual = selected.rows.find((row) => row.method === 'PATCH' && row.status === 200 && row.response.id === selected.start.session_id);
      if (!actual) throw new Error('No actual owned end ACK for this fixture');
      entry.response = 'end'; return json(actual.response);
    }
    if (method === 'POST' && url.pathname.endsWith('/reset')) {
      if (options.reset === 'lost') return route.abort('connectionfailed');
      const actual = selected.rows.find((row) => row.path.endsWith('/reset') && row.status === 200);
      if (!actual) throw new Error('No actual reset ACK for this fixture');
      resume = []; entry.response = 'reset'; return json(actual.response);
    }
    if (url.pathname.startsWith('/api/quiz/')) throw new Error(`Unexpected fixture request ${method} ${url.pathname}`);
    return json({});
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto(`${BASE}/quiz?bank=${selected.bank.bank.id}`, { waitUntil: 'domcontentloaded' });
  return { context, page, trace, errors, releaseBank: () => { holds.bank?.release(); return holds.bank?.finished; }, releaseStart: () => holds.start?.release(), get bankReads() { return bankReads; }, get resumeReads() { return resumeReads; } };
}
async function closeRun(name, run) {
  check(`${name}: no JavaScript errors`, run.errors.length === 0, run.errors.join('; '));
  scenarios.push({ name, trace: clone(run.trace), errors: run.errors, ui: run.ui || [] });
  await run.context.close();
}
async function uiState(run, name) {
  const snapshot = await run.page.evaluate(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    const controls = [...document.querySelectorAll('.qz-shell button:not(:disabled),.qz-shell a[href],.qz-shell input:not(:disabled)')].filter(visible);
    return {
      width: innerWidth, documentWidth: document.documentElement.scrollWidth,
      controls: controls.map((el) => { const r = el.getBoundingClientRect(); return { label: el.getAttribute('aria-label') || el.textContent?.trim(), width: r.width, height: r.height }; }),
      motion: [...document.querySelectorAll('.qz-shell .qz-bar,.qz-shell .qz-opt,.qz-shell .spinner,.qz-shell .av-button,.qz-shell .subpage-header__back')].filter(visible).map((el) => ({ class: el.className, transition: getComputedStyle(el).transitionDuration, animation: getComputedStyle(el).animationDuration })),
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  });
  (run.ui ||= []).push({ name, ...snapshot });
  check(`${name}: fits and44px active targets`, snapshot.documentWidth <= snapshot.width + 1 && snapshot.controls.every((r) => r.width >= 43.99 && r.height >= 43.99), JSON.stringify(snapshot.controls.filter((r) => r.width < 43.99 || r.height < 43.99)));
  if (snapshot.reduced) check(`${name}: reduced motion`, snapshot.motion.every((r) => r.transition.split(',').every((v) => parseFloat(v) === 0) && r.animation.split(',').every((v) => parseFloat(v) === 0)), JSON.stringify(snapshot.motion));
}
async function answer(page, question, value, expectedCorrect, stopOnUnavailable = false) {
  await page.locator('.qz-prompt').waitFor();
  const prompt = renderedText(await page.locator('.qz-prompt').innerText());
  if (prompt !== renderedText(question.prompt)) throw new Error(`Actual engine/browser order differs for ${question.qid}`);
  if (question.input === 'text') { await page.getByRole('textbox', { name: 'Đáp án của bạn' }).fill(String(value)); await page.keyboard.press('Enter'); }
  else if (question.input === 'boolean') await page.locator('.qz-bool').getByRole('button', { name: value ? 'Đúng' : 'Sai', exact: true }).click();
  else await page.locator(question.input === 'choice' ? '.qz-options' : '.qz-chips').getByRole('button', { name: renderedText((question.options || question.segments)[value]), exact: true }).click();
  if (stopOnUnavailable) {
    await page.waitForFunction((correct) => Boolean(document.querySelector(`.qz-feedback.${correct ? 'ok' : 'no'}`) || document.querySelector('.qz-error')), expectedCorrect);
    return Boolean(await page.locator('.qz-error').count());
  }
  await page.locator(`.qz-feedback.${expectedCorrect ? 'ok' : 'no'}`).waitFor();
  return false;
}
async function complete(run, selected, { review = false, stopOnUnavailable = false, onFirstFeedback, firstWrong = false } = {}) {
  const engine = engineFor(selected.bank, { resume: review ? [] : selected.start.resume, seed: selected.start.session_id });
  for (let item = engine.next(), guard = 0; item; item = engine.next()) {
    if (++guard > selected.bank.questions.length * 12) throw new Error('Actual engine/browser finish guard exceeded');
    const value = guard === 1 && firstWrong ? wrongAnswer(item.question) : rightAnswer(item.question), grade = engine.submit(value);
    const unavailable = await answer(run.page, item.question, value, grade.correct, stopOnUnavailable);
    if (guard === 1 && !unavailable && onFirstFeedback) await onFirstFeedback();
    if (stopOnUnavailable && (unavailable || posts(run, '/progress').some((row) => row.response === 'stale'))) {
      await run.page.getByRole('heading', { name: 'Không thể mở bài' }).waitFor(); return { stale: true, answered: guard };
    }
    await run.page.getByRole('button', { name: 'Tiếp →' }).click();
  }
  return engine.summary();
}
const posts = (run, suffix) => run.trace.filter((row) => row.method === 'POST' && row.path.endsWith(suffix));

async function waitForQuizTrace(run, predicate, label) {
  let timer, poll;
  const observed = () => run.trace.some(predicate);
  try {
    await Promise.race([
      new Promise((resolve) => { if (observed()) resolve(); else poll = setInterval(() => { if (observed()) resolve(); }, 10); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} was not observed within15s`)), 15_000); }),
    ]);
  } finally { clearInterval(poll); clearTimeout(timer); }
}

try {
  const authored = requests.filter((row) => row.method === 'GET' && row.response?.bank && row.case.includes('test_actual_twelve_sources_policy_copy_readback'));
  const unique = [...new Map(authored.map((row) => [row.response.bank.id, row])).values()];
  check('durable public wire contains all12 approved banks/264 questions', unique.length === 12 && unique.reduce((sum, row) => sum + row.response.questions.length, 0) === 264);
  for (const [index, row] of unique.entries()) {
    const selected = flow(row.case), width = [360, 390, 768, 1440][index % 4], theme = index % 2 ? 'dark' : 'light';
    const run = await fixture(selected, { width, theme });
    await run.page.getByRole('heading', { name: selected.bank.bank.title, exact: true }).waitFor();
    const body = posts(run, '/api/quiz/sessions')[0]?.body;
    check(`${selected.bank.bank.grammar_canonical_code}: frozen admission/${width}/${theme}`, body?.bank_id === selected.bank.bank.id && body.grammar_revision === selected.bank.bank.grammar_revision && Object.hasOwn(body, 'text_match_policy') === Boolean(Object.keys(selected.bank.bank.meta.text_match_by_qid || {}).length) && (!body.text_match_policy || body.text_match_policy === 'qid-exact-v1'));
    check(`${selected.bank.bank.grammar_canonical_code}: pre-answer zero progress/end`, posts(run, '/progress').length === 0 && !run.trace.some((item) => item.method === 'PATCH'));
    check(`${selected.bank.bank.grammar_canonical_code}: viewport fits`, await run.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await closeRun(selected.bank.bank.grammar_canonical_code, run);
  }

  for (const positive of [false, true]) {
    const selected = flow('test_actual_twelve_sources_policy_copy_readback_and_synthetic_original_history[G-tenses-past-perfect]');
    const target = controls.controls.find((row) => row.code === 'G-tenses-past-perfect' && row.qid === 'pqp_form_i2');
    const run = await fixture(selected), engine = engineFor(selected.bank, { resume: [], seed: selected.start.session_id });
    await run.page.getByRole('heading', { name: selected.bank.bank.title, exact: true }).waitFor();
    let reached = false;
    for (let guard = 0; guard < selected.bank.questions.length * 2; guard++) {
      const item = engine.next(); if (!item) throw new Error('Named authored question was not reachable');
      const isTarget = item.question.qid === target.qid;
      const value = isTarget ? positive ? item.question.accept[0] : target.negative_or_legacy_cases[0].answer : wrongAnswer(item.question);
      const grade = engine.submit(value);
      await answer(run.page, item.question, value, grade.correct);
      if (isTarget) { reached = true; break; }
      await run.page.getByRole('button', { name: 'Tiếp →' }).click();
    }
    if (!reached) throw new Error('Named morphology control exceeded its full-bank guard');
    // A threshold flush may already contain the target. Otherwise register the
    // exact waiter before the explicit unload; never wait for a nonexistent batch.
    if (posts(run, '/progress').some((row) => row.body.attempts.some((item) => item.qid === target.qid))) {
      await run.page.evaluate(() => dispatchEvent(new Event('pagehide')));
    } else {
      const read = run.page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/progress') && request.postDataJSON().attempts.some((item) => item.qid === target.qid));
      await Promise.all([read, run.page.evaluate(() => dispatchEvent(new Event('pagehide')))]);
    }
    await waitForQuizTrace(run, (row) => row.method === 'POST' && row.path === `/api/quiz/sessions/${selected.start.session_id}/progress` && row.response === 'progress' && row.body.attempts.some((item) => item.qid === target.qid), 'Expected captured PastPerfect progress');
    const batches = posts(run, '/progress').map((row) => row.body);
    const batch = batches.findLast((item) => item.attempts.some((attempt) => attempt.qid === target.qid));
    const expected = engine.drainBatch(), expectedAttempt = expected.attempts.at(-1);
    const actual = batch.attempts.findLast((attempt) => attempt.qid === target.qid);
    const stats = batch.word_stats.find((item) => item.item_key === expectedAttempt.item_key);
    check(`full PastPerfect/${positive ? 'authored positive' : 'morphology negative'} actual grade/credit`, actual.is_correct === positive && actual.answer_given === expectedAttempt.answer_given && stats.credit_count === Number(positive) && stats.production_done === positive && !run.trace.some((row) => row.method === 'PATCH'));
    await closeRun(`full PastPerfect/${positive}`, run);
  }

  const ordinary = flow('test_actual_pg_end_rows_through_real_asgi_facade_keep_frozen_identity_and_explicit_null[False]');
  const run = await fixture(ordinary); await run.page.locator('.qz-prompt').waitFor();
  const summary = await complete(run, ordinary); await run.page.getByRole('heading', { name: '🎉 Hoàn tất phiên!' }).waitFor();
  const ended = run.trace.find((row) => row.method === 'PATCH');
  check('actual engine finish sends its derived totals/frozen owned end and confirms save', ended?.body.total_questions === summary.total_questions && ended.body.total_correct === summary.total_correct && !await run.page.locator('.qz-save-warning').count());
  await closeRun('ordinary completion', run);

  const exact = flow('test_real_stored_map_requires_ack_in_both_arities_before_insert[G-tenses-present-simple]');
  const unauthorized = await fixture(exact, { start: 'unauthorized' });
  await unauthorized.page.waitForURL(`${BASE}/login`);
  check('active401 retains canonical login navigation with one start/no progress/end', posts(unauthorized, '/api/quiz/sessions').length === 1 && posts(unauthorized, '/progress').length === 0 && !unauthorized.trace.some((row) => row.method === 'PATCH'));
  await closeRun('active401', unauthorized);
  for (const start of ['lost', 'missing-policy', 'wrong-bank', 'wrong-revision', 'invalid-resume']) {
    const run = await fixture(exact, { start });
    await run.page.getByRole('heading', { name: 'Không thể mở bài' }).waitFor();
    await run.page.waitForFunction(() => document.activeElement?.textContent === 'Mở lại bài');
    await run.page.evaluate(() => dispatchEvent(new Event('pagehide')));
    check(`${start}: one start action/unavailable/focused/zero later writes`, posts(run, '/api/quiz/sessions').length === 1 && posts(run, '/progress').length === 0 && !run.trace.some((row) => row.method === 'PATCH'));
    await closeRun(start, run);
  }
  const invalid = clone(exact); invalid.bank.meta = { ...invalid.bank.bank.meta, text_match_by_qid: {} };
  const bad = await fixture(invalid); await bad.page.getByRole('heading', { name: 'Không thể mở bài' }).waitFor();
  check('invalid alternate META refuses before start', !bad.trace.some((row) => row.method !== 'GET')); await closeRun('invalid META', bad);

  const stale = flow('test_reset_marks_open_lost_ack_all_admissions_and_stale_progress_zero_writes');
  const blocked = await fixture(stale, { progress: 'stale' }); await blocked.page.locator('.qz-prompt').waitFor();
  await complete(blocked, stale, { stopOnUnavailable: true }); await blocked.page.getByRole('heading', { name: 'Không thể mở bài' }).waitFor();
  const writes = blocked.trace.filter((row) => row.method !== 'GET').length;
  await blocked.page.evaluate(() => dispatchEvent(new Event('pagehide')));
  const staleBatch = posts(blocked, '/progress')[0]?.body;
  check('typed reset-stale sticky: actual correct batch/one failed progress/no retry/end/unload', staleBatch?.attempts.length === 5 && staleBatch.attempts.every((attempt) => attempt.is_correct === true) && posts(blocked, '/progress').length === 1 && !blocked.trace.some((row) => row.method === 'PATCH') && blocked.trace.filter((row) => row.method !== 'GET').length === writes);
  await closeRun('reset-stale', blocked);

  const legacy = flow('test_eligible_n_minus_one_start_and_corrected_explicit_ack', true);
  const original = await fixture(legacy); await original.page.getByRole('heading', { name: 'Bài Grammar trước khi sửa' }).waitFor();
  check('legacy gate: zero automatic start and fixed corrected link', posts(original, '/api/quiz/sessions').length === 0 && await original.page.getByRole('link', { name: 'Mở bản đã sửa' }).getAttribute('href') === `/quiz?bank=${legacy.bank.grammar.current_bank_id}`);
  await original.page.getByRole('button', { name: 'Tiếp tục bản trước' }).click(); await original.page.locator('.qz-prompt').waitFor();
  check('explicit legacy continuation stays bound to original bank/revision', posts(original, '/api/quiz/sessions')[0].body.bank_id === legacy.bank.bank.id && posts(original, '/api/quiz/sessions')[0].body.grammar_revision === legacy.bank.grammar.bank_revision);
  await closeRun('legacy continuation', original);

  for (const name of ['test_absent_empty_map_preserves_four_arg_and_redundant_ack[None]', 'test_absent_empty_map_preserves_four_arg_and_redundant_ack[policy1]']) {
    const selected = flow(name), run = await fixture(selected);
    await run.page.locator('.qz-prompt').waitFor();
    check(`${name}: canonical absence/empty needs no capability`, posts(run, '/api/quiz/sessions').length === 1 && !Object.hasOwn(posts(run, '/api/quiz/sessions')[0].body, 'text_match_policy'));
    await closeRun(name, run);
  }

  const paused = flow('test_paused_corrected_reload_derives_unmarked_run_not_newer_review[paused]');
  paused.bank = clone(paused.rows.find((row) => row.method === 'GET' && row.response.bank && row.response.grammar.new_starts_enabled === false && row.response.grammar.can_continue_current === true).response);
  paused.start = clone(paused.rows.find((row) => row.status === 201 && row.response.grammar.new_starts_enabled === false).response);
  const continuing = await fixture(paused); await continuing.page.locator('.qz-prompt').waitFor();
  check('paused new-start switch preserves canonical unfinished continuation', posts(continuing, '/api/quiz/sessions').length === 1 && posts(continuing, '/api/quiz/sessions')[0].body.bank_id === paused.bank.bank.id);
  await closeRun('paused current continuation', continuing);
  const disabled = clone(stale); disabled.bank = clone(stale.rows.findLast((row) => row.method === 'GET' && row.response.bank).response);
  const gated = await fixture(disabled, { resume: [] }); await gated.page.getByRole('heading', { name: 'Bài đang tạm dừng lượt mới' }).waitFor();
  check('actual disabled-current no predecessor: no start/reset/end', !gated.trace.some((row) => row.method !== 'GET'));
  await closeRun('disabled current', gated);

  const review = flow('test_review_records_no_graded_progress');
  const readonly = await fixture(review, { resume: masteredResume(review.bank) });
  await readonly.page.getByRole('button', { name: '🔁 Ôn tập lại' }).waitFor();
  check('all mastered preflight has zero start', posts(readonly, '/api/quiz/sessions').length === 0);
  await readonly.page.getByRole('button', { name: '🔁 Ôn tập lại' }).click(); await readonly.page.locator('.qz-prompt').waitFor();
  await complete(readonly, review, { review: true }); await readonly.page.getByRole('heading', { name: '🎉 Hoàn tất phiên!' }).waitFor();
  await readonly.page.evaluate(() => dispatchEvent(new Event('pagehide')));
  const reviewEnd = readonly.trace.find((row) => row.method === 'PATCH')?.body;
  check('explicit readonly admission: one row/no progress/zero persisted grades', posts(readonly, '/api/quiz/sessions').length === 1 && posts(readonly, '/api/quiz/sessions')[0].body.admission_kind === 'review' && posts(readonly, '/progress').length === 0 && reviewEnd?.total_questions === 0 && reviewEnd.words_mastered === 0 && reviewEnd.attempts.length === 0);
  await closeRun('readonly review', readonly);

  for (const reset of ['lost', 'success']) {
    const resetRun = await fixture(stale, { resume: masteredResume(stale.bank), reset });
    await resetRun.page.getByRole('button', { name: '♻️ Làm lại từ đầu' }).click();
    if (reset === 'lost') {
      await resetRun.page.getByText(/Không xác nhận được việc xoá tiến độ/).waitFor();
      check('lost reset ACK: no inferred empty-resume/no new start', posts(resetRun, '/reset').length === 1 && resetRun.bankReads === 1 && resetRun.resumeReads === 1 && posts(resetRun, '/api/quiz/sessions').length === 0);
    } else {
      await resetRun.page.locator('.qz-prompt').waitFor();
      const order = resetRun.trace.map((row) => `${row.method}:${row.response}`);
      check('successful reset: ACK→fresh bank→fresh resume→one start', resetRun.bankReads === 2 && resetRun.resumeReads === 2 && posts(resetRun, '/api/quiz/sessions').length === 1 && order.join('|') === 'GET:bank|GET:resume|POST:reset|GET:bank|GET:resume|POST:start');
    }
    await closeRun(`reset/${reset}`, resetRun);
  }

  // The width/theme matrix uses the complete captured bank and actual engine.
  // No shortened question bank, optimistic mastery or hand-authored grade totals.
  for (const width of [360, 390, 768, 1440]) for (const theme of ['light', 'dark']) {
    const tag = `${width}/${theme}`;
    const matrix = await fixture(review, { width, theme, reducedMotion: 'reduce', resume: masteredResume(review.bank), holdStart: true });
    const reviewButton = matrix.page.getByRole('button', { name: '🔁 Ôn tập lại' });
    await reviewButton.waitFor(); await uiState(matrix, `${tag}/gate`);
    await reviewButton.focus();
    const startSeen = matrix.page.waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/quiz/sessions');
    await Promise.all([startSeen, matrix.page.keyboard.press('Enter')]);
    await waitForQuizTrace(matrix, (row) => row.method === 'POST' && row.path === '/api/quiz/sessions' && row.body.bank_id === review.bank.bank.id && row.response === 'held-start', 'Expected held review start');
    await matrix.page.waitForFunction(() => Boolean(document.querySelector('.qz-gate button:disabled')));
    await matrix.page.getByRole('button', { name: 'Đang tạo phiên…', exact: true }).evaluate((node) => {
      node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    check(`${tag}/rapid review: pending admission locked/no progress/end`, posts(matrix, '/api/quiz/sessions').length === 1 && posts(matrix, '/progress').length === 0 && !matrix.trace.some((r) => r.method === 'PATCH') && !await matrix.page.locator('.qz-prompt').count());
    matrix.releaseStart(); await matrix.page.locator('.qz-prompt').waitFor();
    check(`${tag}/validated current: ordinary correction label`, await matrix.page.getByText('Bản đã sửa', { exact: true }).count() === 1);
    await uiState(matrix, `${tag}/readonly play`);
    await complete(matrix, review, { review: true, firstWrong: true, onFirstFeedback: async () => {
      await matrix.page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Tiếp →');
      await uiState(matrix, `${tag}/feedback`);
    } });
    await matrix.page.getByRole('heading', { name: '🎉 Hoàn tất phiên!' }).waitFor();
    await matrix.page.waitForFunction(() => document.activeElement?.id === 'qz-summary-title');
    await uiState(matrix, `${tag}/summary`);
    const filter = matrix.page.getByRole('button', { name: /Hiện tất cả/ });
    await filter.focus(); await matrix.page.keyboard.press('Enter');
    await uiState(matrix, `${tag}/session review`);
    check(`${tag}/readonly complete retains actual prompts and zero graded writes`, await matrix.page.locator('.qz-review-item').count() > 0 && posts(matrix, '/progress').length === 0 && matrix.trace.find((r) => r.method === 'PATCH')?.body.total_questions === 0);
    await matrix.page.getByRole('button', { name: /Chỉ câu sai/ }).focus(); await matrix.page.keyboard.press('Space');
    check(`${tag}/review filter keyboard: only the one locally wrong source question`, await matrix.page.locator('.qz-review-item').count() === 1);
    await closeRun(`matrix/${tag}`, matrix);

    const err = await fixture(exact, { width, theme, reducedMotion: 'reduce', start: 'lost' });
    await err.page.getByRole('heading', { name: 'Không thể mở bài' }).waitFor();
    await err.page.waitForFunction(() => document.activeElement?.textContent === 'Mở lại bài');
    await uiState(err, `${tag}/error`);
    await err.page.keyboard.press('Tab');
    check(`${tag}/error: retry then keyboard Back control`, await err.page.getByRole('link', { name: 'Quay lại', exact: true }).evaluate((node) => document.activeElement === node) && posts(err, '/api/quiz/sessions').length === 1);
    await closeRun(`matrix error/${tag}`, err);

    const old = await fixture(legacy, { width, theme, reducedMotion: 'reduce' });
    await old.page.getByRole('heading', { name: 'Bài Grammar trước khi sửa' }).waitFor();
    await uiState(old, `${tag}/legacy gate`);
    await old.page.getByRole('button', { name: 'Tiếp tục bản trước' }).focus(); await old.page.keyboard.press('Enter');
    await old.page.locator('.qz-prompt').waitFor(); await uiState(old, `${tag}/legacy inline current link`);
    check(`${tag}/legacy continuation: original identity/no corrected-label or automatic grades`, posts(old, '/api/quiz/sessions').length === 1 && posts(old, '/api/quiz/sessions')[0].body.bank_id === legacy.bank.bank.id && !await old.page.getByText('Bản đã sửa', { exact: true }).count() && posts(old, '/progress').length === 0 && !old.trace.some((r) => r.method === 'PATCH'));
    await closeRun(`matrix legacy/${tag}`, old);
  }

  for (const options of [{ bankStatus: 404 }, { bankStatus: 503 }, { start: 'forbidden' }, { start: 'conflict' }]) {
    const denied = await fixture(exact, options);
    await denied.page.getByRole('heading', { name: 'Không thể mở bài' }).waitFor();
    await denied.page.waitForFunction(() => document.activeElement?.textContent === 'Mở lại bài');
    await denied.page.evaluate(() => dispatchEvent(new Event('pagehide')));
    check(`owned error/${JSON.stringify(options)}: unavailable with no answer/progress/end`, !await denied.page.locator('.qz-prompt').count() && posts(denied, '/api/quiz/sessions').length === (options.bankStatus ? 0 : 1) && posts(denied, '/progress').length === 0 && !denied.trace.some((r) => r.method === 'PATCH'));
    await closeRun(`owned error/${JSON.stringify(options)}`, denied);
  }

  const reopen = await fixture(exact, { start: 'lost-once' });
  await reopen.page.getByRole('heading', { name: 'Không thể mở bài' }).waitFor();
  const reread = reopen.page.waitForRequest((r) => r.method() === 'GET' && new URL(r.url()).pathname === `/api/quiz/banks/${exact.bank.bank.id}`);
  await Promise.all([reread, reopen.page.getByRole('button', { name: 'Mở lại bài' }).click()]);
  await reopen.page.locator('.qz-prompt').waitFor();
  check('explicit reopen after lost start ACK: fresh reads/one further action/zero automatic replay', reopen.bankReads === 2 && reopen.resumeReads === 2 && posts(reopen, '/api/quiz/sessions').length === 2 && posts(reopen, '/progress').length === 0 && !reopen.trace.some((r) => r.method === 'PATCH'));
  await closeRun('explicit reopen/lost start', reopen);

  const staleReopen = await fixture(stale, { progress: 'stale', afterBank: disabled.bank });
  await staleReopen.page.locator('.qz-prompt').waitFor();
  await complete(staleReopen, stale, { stopOnUnavailable: true });
  await staleReopen.page.getByRole('heading', { name: 'Không thể mở bài' }).waitFor();
  const progressBefore = posts(staleReopen, '/progress').length;
  await staleReopen.page.getByRole('button', { name: 'Mở lại bài' }).click();
  await staleReopen.page.getByRole('heading', { name: 'Bài đang tạm dừng lượt mới' }).waitFor();
  await staleReopen.page.evaluate(() => dispatchEvent(new Event('pagehide')));
  check('explicit reset-stale reopen: fresh canonical paused state/no old progress replay/end', staleReopen.bankReads === 2 && staleReopen.resumeReads === 2 && posts(staleReopen, '/api/quiz/sessions').length === 1 && progressBefore === 1 && posts(staleReopen, '/progress').length === progressBefore && !staleReopen.trace.some((r) => r.method === 'PATCH'));
  await closeRun('explicit reopen/reset-stale', staleReopen);

  const alternate = flow('test_actual_twelve_sources_policy_copy_readback_and_synthetic_original_history[G-tenses-past-perfect]');
  const delayed = await fixture(exact, { holdBank: true, alternate });
  await delayed.page.getByText('Đang tải bài kiểm tra…').waitFor();
  await waitForQuizTrace(delayed, (row) => row.method === 'GET' && row.path === `/api/quiz/banks/${exact.bank.bank.id}` && row.response === 'held-bank', 'Expected held bank GET');
  check('held bank GET: loading/no start/live answer', posts(delayed, '/api/quiz/sessions').length === 0 && !await delayed.page.locator('.qz-prompt').count());
  await delayed.page.evaluate((id) => history.pushState(null, '', `/quiz?bank=${id}`), alternate.bank.bank.id);
  await delayed.page.getByRole('heading', { name: alternate.bank.bank.title, exact: true }).waitFor();
  await delayed.page.evaluate((id) => history.pushState(null, '', `/quiz?bank=${id}`), exact.bank.bank.id);
  await delayed.page.getByRole('heading', { name: exact.bank.bank.title, exact: true }).waitFor();
  const currentPrompt = await delayed.page.locator('.qz-prompt').innerText(), writesBefore = delayed.trace.filter((r) => r.method !== 'GET').length;
  await delayed.releaseBank();
  await delayed.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  check('delayed bank A→B→A: captured fresh owner stays/no extra activation', await delayed.page.locator('.qz-prompt').innerText() === currentPrompt && posts(delayed, '/api/quiz/sessions').length === 2 && delayed.trace.filter((r) => r.method !== 'GET').length === writesBefore && !delayed.trace.some((r) => r.method === 'PATCH'));
  await closeRun('delayed bank A→B→A', delayed);

  const currentLegacy = flow('test_eligible_n_minus_one_start_and_corrected_explicit_ack');
  const navigating = await fixture(legacy, { alternate: currentLegacy });
  await navigating.page.getByRole('heading', { name: 'Bài Grammar trước khi sửa' }).waitFor();
  await navigating.page.getByRole('link', { name: 'Mở bản đã sửa' }).click();
  await navigating.page.locator('.qz-prompt').waitFor();
  const currentPromptBefore = await navigating.page.locator('.qz-prompt').innerText();
  await navigating.page.goBack(); await navigating.page.getByRole('heading', { name: 'Bài Grammar trước khi sửa' }).waitFor();
  check('native Back keeps original gate/no silent upgrade or old auto start', posts(navigating, '/api/quiz/sessions').every((r) => r.body.bank_id === currentLegacy.bank.bank.id) && !await navigating.page.getByText('Bản đã sửa', { exact: true }).count());
  await navigating.page.goForward(); await navigating.page.locator('.qz-prompt').waitFor();
  check('native Forward keeps corrected bank/source', new URL(navigating.page.url()).searchParams.get('bank') === currentLegacy.bank.bank.id && await navigating.page.locator('.qz-prompt').innerText() === currentPromptBefore);
  await navigating.page.reload(); await navigating.page.locator('.qz-prompt').waitFor();
  check('reload reads/admission stay bound to corrected physical bank and policy', posts(navigating, '/api/quiz/sessions').every((r) => r.body.bank_id === currentLegacy.bank.bank.id && r.body.grammar_revision === currentLegacy.bank.grammar.bank_revision && r.body.text_match_policy === 'qid-exact-v1') && posts(navigating, '/progress').length === 0 && !navigating.trace.some((r) => r.method === 'PATCH'));
  await closeRun('native Back/Forward/reload', navigating);

  const keys = await fixture(exact), keyboardEngine = engineFor(exact.bank, { resume: exact.start.resume, seed: exact.start.session_id });
  await keys.page.locator('.qz-prompt').waitFor();
  let textItem;
  for (let item = keyboardEngine.next(), count = 0; item; item = keyboardEngine.next()) {
    if (++count > exact.bank.questions.length * 12) throw new Error('Typed full-bank question not reachable');
    if (item.question.input === 'text') { textItem = item; break; }
    const q = item.question, value = rightAnswer(q), grade = keyboardEngine.submit(value);
    const button = q.input === 'boolean' ? keys.page.locator('.qz-bool').getByRole('button', { name: value ? 'Đúng' : 'Sai', exact: true }) : keys.page.locator(q.input === 'choice' ? '.qz-options' : '.qz-chips').getByRole('button', { name: renderedText((q.options || q.segments)[value]), exact: true });
    await button.focus(); await keys.page.keyboard.press('Space'); await keys.page.locator(`.qz-feedback.${grade.correct ? 'ok' : 'no'}`).waitFor();
    await keys.page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Tiếp →'); await keys.page.keyboard.press('Enter');
  }
  if (!textItem) throw new Error('No actual typed item reached');
  const input = keys.page.getByRole('textbox', { name: 'Đáp án của bạn' }); await input.fill('  ');
  const promptBefore = await keys.page.locator('.qz-prompt').innerText(), attemptsBefore = posts(keys, '/progress').flatMap((r) => r.body.attempts).length;
  await input.press('Enter');
  check('blank text Enter disabled/no feedback/no business attempt', await keys.page.getByRole('button', { name: 'Kiểm tra', exact: true }).isDisabled() && !await keys.page.locator('.qz-feedback').count() && await keys.page.locator('.qz-prompt').innerText() === promptBefore && posts(keys, '/progress').flatMap((r) => r.body.attempts).length === attemptsBefore);
  const value = rightAnswer(textItem.question), expected = keyboardEngine.submit(value);
  const expectedTypedBatch = keyboardEngine.drainBatch();
  const expectedTypedAttempt = expectedTypedBatch.attempts.findLast((r) => r.qid === textItem.question.qid);
  const expectedTypedStats = expectedTypedBatch.word_stats.find((r) => r.item_key === expectedTypedAttempt.item_key);
  await input.fill(String(value)); await keys.page.keyboard.down('Enter'); await keys.page.keyboard.down('Enter'); await keys.page.keyboard.up('Enter');
  await keys.page.locator(`.qz-feedback.${expected.correct ? 'ok' : 'no'}`).waitFor();
  await keys.page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Tiếp →');
  if (posts(keys, '/progress').some((r) => r.body.attempts.some((a) => a.qid === textItem.question.qid))) {
    // Already flushed at the ordinary threshold; the explicit unload has no duplicate batch.
    await keys.page.evaluate(() => dispatchEvent(new Event('pagehide')));
  } else {
    const batchRead = keys.page.waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname.endsWith('/progress') && r.postDataJSON().attempts.some((a) => a.qid === textItem.question.qid));
    await Promise.all([batchRead, keys.page.evaluate(() => dispatchEvent(new Event('pagehide')))]);
  }
  await waitForQuizTrace(keys, (row) => row.method === 'POST' && row.path === `/api/quiz/sessions/${exact.start.session_id}/progress` && row.response === 'progress' && row.body.attempts.some((item) => item.qid === textItem.question.qid), 'Expected captured typed progress');
  const typedAttempts = posts(keys, '/progress').flatMap((r) => r.body.attempts).filter((a) => a.qid === textItem.question.qid);
  const typedStats = posts(keys, '/progress').flatMap((r) => r.body.word_stats).findLast((r) => r.item_key === expectedTypedAttempt.item_key);
  check('repeated Enter keydown: one actual typed verdict/credit and Next focus/no skip', typedAttempts.length === 1 && typedAttempts[0].is_correct === expected.correct && typedAttempts[0].answer_given === expectedTypedAttempt.answer_given && typedStats.credit_count === expectedTypedStats.credit_count && typedStats.production_done === expectedTypedStats.production_done && await keys.page.locator('.qz-prompt').innerText() === promptBefore && !keys.trace.some((r) => r.method === 'PATCH'));
  await closeRun('keyboard text/choice', keys);

  // Only-typo nonempty metadata is covered by pure/model controls. All11 nonempty
  // approved maps contain exact entries, so no approved-bank browser claim is made.
} finally {
  await browser.close();
  const output = { boundary: 'actual Next component; synthetic auth/HTTP, corrected source-bound producer capture; producer approval/PG release is a separate receipt, no live/publication claim', fixture_sha256: createHash('sha256').update(wireBytes).digest('hex'), provenance: wire.provenance, results, scenarios };
  if (process.env.GRAMMAR_NATIVE_OUTPUT) writeFileSync(process.env.GRAMMAR_NATIVE_OUTPUT, JSON.stringify(output, null, 2) + '\n');
}
console.log(`${results.filter((row) => row.ok).length}/${results.length} checks passed across ${scenarios.length} scenarios`);
if (results.some((row) => !row.ok)) process.exitCode = 1;
