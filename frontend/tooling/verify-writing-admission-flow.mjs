// Local rendered-browser contract, NOT staging E2E or Gate E evidence.
// Real Next page, API helper, storage, modal and autosave. Supabase SDK/auth and
// backend are fixtures; CDN libraries are inert (Markdown's safe fallback).
// No credentials, remote writes, live provider requests or production flags.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const base = new URL(process.argv[2] || 'http://127.0.0.1:3017');
const caseFilter = process.argv.find(arg => arg.startsWith('--case='))?.slice(7) || '';
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)
    || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
  throw new Error('Use an explicit local Next server origin only');
}
const API = 'https://api.writing-admission.invalid';
const USER = '11111111-1111-4111-8111-111111111111';
const ASSIGNMENT = '22222222-2222-4222-8222-222222222222';
const SECOND = '66666666-6666-4666-8666-666666666666';
const COMMAND = '33333333-3333-4333-8333-333333333333';
const EPISODE = '44444444-4444-4444-8444-444444444444';
const EPOCH = '55555555-5555-4555-8555-555555555555';
const TOKEN = 'local-writing-fixture-not-a-real-token';
const PATH = '/api/writing/my-assignments/' + ASSIGNMENT;
const KEY = 'aver:writing-admission:v1:' + USER + ':' + ASSIGNMENT;
const SUBMIT_KEY = 'writing-submit:v1:' + USER + ':' + ASSIGNMENT;
const DRAFT = 'This is a saved learner draft. '.repeat(12);
const button = '.assignment-card[data-assignment-id="' + ASSIGNMENT + '"] .btn-start-assignment';
const cors = { 'access-control-allow-origin': base.origin,
  'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,x-request-id,x-core-operation-id' };
const json = (value, status = 200) => ({ status, headers: cors,
  contentType: 'application/json', body: JSON.stringify(value) });
const session = { access_token: TOKEN, user: { id: USER, email: 'learner@fixture.invalid' } };
const sdk = `window.supabase={createClient:()=>({auth:{
  getSession:async()=>({data:{session:${JSON.stringify(session)}}}),
  onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})
}})};`;
const cdns = new Map([
  ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.107.0/dist/umd/supabase.min.js', sdk],
  ['https://unpkg.com/lucide@1.17.0', 'window.lucide={createIcons(){}};'],
  ['https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js', '/* fixture: safe plaintext fallback */'],
  ['https://cdn.jsdelivr.net/npm/dompurify@3.4.8/dist/purify.min.js', '/* fixture: safe plaintext fallback */'],
]);

async function launch() {
  try { return await chromium.launch(); } catch (error) {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome });
    throw error;
  }
}

async function fixture(browser, options = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 900 } });
  const state = { enabled: options.enabled !== false, phase: 'accepted', startedAt: options.startedAt || null,
    executeBefore: new Date(Date.now() + 120000).toISOString(), draft: options.initialDraft || '', prepares: [],
    executes: [], reconciles: [], baselineEntries: [], nonceReads: [], acceptedNonce: null, classifications: 0, reads: 0, legacy: 0, saves: 0, calls: [], unexpected: [], errors: [], secondDrafts: [], submissions: [] };
  let releaseSecond;
  const secondReady = new Promise(resolve => { state.secondRequested = resolve; });
  const secondResponse = new Promise(resolve => { releaseSecond = resolve; });
  const timer = () => ({ is_timed: true, time_limit_minutes: 40,
    time_remaining_seconds: state.startedAt ? options.expired ? 0 : 2100 : null, started_at: state.startedAt,
    expires_at: state.startedAt ? new Date(Date.parse(state.startedAt) + 2400000).toISOString() : null,
    is_expired: !!(options.expired && state.startedAt), auto_submitted: false, status: (options.terminal || options.terminalAfterA) && state.startedAt
      ? 'submitted' : state.startedAt ? 'in_progress' : 'pending' });
  const reply = () => ({ assignment_id: ASSIGNMENT, started: !!state.startedAt, timer: timer(),
    command: { command_id: COMMAND, episode_id: EPISODE, activity_epoch_id: EPOCH,
      generation: state.phase === 'unstarted_expired' ? 1 : 0,
      phase: state.phase, execute_before: state.executeBefore } });
  const entry = () => ({ assignment_id: ASSIGNMENT, started: !!state.startedAt, timer: timer(),
    kind: (options.terminal || options.terminalAfterA) && state.startedAt ? 'terminal' : options.baseline || (state.startedAt ? 'admitted' : 'eligible') });
  const assignment = () => ({ id: ASSIGNMENT, name: 'Writing admission fixture',
    status: 'pending', deadline: null, has_draft: !!state.draft, draft_word_count: 0,
    renderer_affinity: 'next', is_timed: true, time_limit_minutes: 40, allow_soft_check: false,
    instructions: '', writing_prompts: { id: 'p1', title: 'Fixture prompt', task_type: 'task2',
      prompt_text: 'Discuss the benefits of learning.', prompt_image_url: null } });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (url.origin === base.origin) {
      if (url.pathname === '/js/runtime-config.js') return route.fulfill({ contentType: 'application/javascript',
        body: 'window.__AVER_RUNTIME_CONFIG__=Object.freeze(' + JSON.stringify({ apiBase: API,
          writingAdmissionEnabled: state.enabled, coreOperationCorrelationEnabled: false,
          supabaseUrl: 'https://writingfixture.supabase.co', supabaseAnonKey: 'fixture-only' }) + ');' });
      // Only the static Writing page/assets may reach this local server. No API proxy.
      if (method === 'GET' && (url.pathname === '/writing/dashboard'
          || /^\/(?:_next\/|js\/|css\/|assets\/)/.test(url.pathname)
          || url.pathname === '/__nextjs_font/geist-latin.woff2'
          || url.pathname === '/favicon.ico')) return route.continue();
    }
    if (cdns.has(url.href)) return route.fulfill({ contentType: 'application/javascript', body: cdns.get(url.href) });
    if (url.origin === 'https://fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' });
    if (url.origin === API) {
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      state.calls.push({ method, path: url.pathname });
      if (method === 'POST' && ['/api/analytics/events', '/api/error-logs'].includes(url.pathname)) {
        return route.fulfill({ status: 204, headers: cors });
      }
      if (request.headers().authorization !== 'Bearer ' + TOKEN) state.unexpected.push('missing fixture bearer: ' + url.pathname);
      const secondPath = '/api/writing/my-assignments/' + SECOND;
      if (options.second && url.pathname === secondPath + '/entry' && method === 'GET') {
        return route.fulfill(json({ ...entry(), assignment_id: SECOND, kind: 'eligible', started: false,
          timer: { ...timer(), status: 'pending', started_at: null, expires_at: null, time_remaining_seconds: null, is_expired: false } }));
      }
      if (options.second && url.pathname === secondPath + '/renderer-affinity' && method === 'POST') {
        return route.fulfill(json({ assignment_id: SECOND, renderer_affinity: 'next' }));
      }
      if (options.second && url.pathname === secondPath + '/admissions' && method === 'POST') {
        state.secondRequested(); await secondResponse;
        return route.abort('failed').catch(() => {});
      }
      if (options.second && url.pathname === secondPath + '/draft' && method === 'PATCH') {
        state.secondDrafts.push(request.postDataJSON());
        return route.fulfill(json({ assignment_id: SECOND }));
      }
      if (method === 'GET') {
        if (url.pathname.startsWith(PATH + '/admission-intents/')) {
          const nonce = url.pathname.split('/').at(-1); state.nonceReads.push(nonce);
          if (options.lookupFailure) return route.fulfill(json({ detail: 'lookup unavailable' }, options.lookupFailure));
          const found = nonce === state.acceptedNonce;
          return route.fulfill(json({ found, admission: found ? reply() : null }));
        }
        if (url.pathname === PATH + '/entry') { state.classifications++; return route.fulfill(json(entry())); }
        if (url.pathname === '/auth/me') return route.fulfill(json({ id: USER, role: 'student' }));
        if (url.pathname === '/api/student/permissions') return route.fulfill(json({ writing: true }));
        if (url.pathname === '/api/writing/my-assignments') return route.fulfill(json({
          student: { display_name: 'Fixture learner', student_code: 'LOCAL', target_band: 6.5 },
          assignments: [assignment(), ...(options.second ? [{ ...assignment(), id: SECOND, name: 'Second assignment' }] : [])] }));
        if (url.pathname === '/api/writing/my-essays') return route.fulfill(json({ essays: [] }));
        if (url.pathname === '/api/writing/prompt-bank') return route.fulfill(json({ enabled: false, prompts: [] }));
        if (url.pathname === '/api/writing/tips') return route.fulfill(json({ tips: [] }));
        if (url.pathname === PATH + '/submission') return route.fulfill(json({ detail: 'No receipt' }, 404));
        if (url.pathname === PATH + '/admissions/' + COMMAND) {
          state.reads++; return route.fulfill(json(reply()));
        }
        if (url.pathname === PATH) return route.fulfill(json({ assignment: assignment(),
          draft: { draft_text: state.draft }, timer: timer() }));
        if (url.pathname === PATH + '/timer') return route.fulfill(json(timer()));
      }
      if (method === 'POST' && url.pathname === PATH + '/renderer-affinity') {
        assert.deepEqual(request.postDataJSON(), { renderer_affinity: 'next' });
        return route.fulfill(json({ assignment_id: ASSIGNMENT, renderer_affinity: options.affinity || 'next' }));
      }
      if (method === 'POST' && url.pathname === PATH + '/baseline-entry') {
        const body = request.postDataJSON(); state.baselineEntries.push(body);
        if (options.loseBaselineBeforeCommit && state.baselineEntries.length === 1) return route.abort('failed');
        if (options.rejectBaseline || (!state.startedAt && !body.allow_start)) {
          return route.fulfill(json({ detail: 'baseline must be revalidated or explicitly started' }, 409));
        }
        assert.ok(options.baseline, 'only a baseline fixture can accept baseline entry');
        state.startedAt ||= new Date().toISOString();
        if (options.loseBaseline && state.baselineEntries.length === 1) return route.abort('failed');
        return route.fulfill(json(entry()));
      }
      if (method === 'POST' && url.pathname === PATH + '/admissions') {
        state.prepares.push(request.postDataJSON());
        if (options.rejectPrepare) return route.fulfill(json({ detail: 'baseline_untracked' }, 409));
        state.acceptedNonce = request.postDataJSON().launch_nonce;
        if (options.terminalAfterA) { state.startedAt ||= new Date().toISOString(); state.phase = options.recoveredPhase || 'accepted'; }
        if (options.loseA && state.prepares.length === 1) return route.abort('failed');
        return route.fulfill(json(reply()));
      }
      if (method === 'POST' && url.pathname === PATH + '/admissions/' + COMMAND + '/execute') {
        state.executes.push(request.postDataJSON());
        if (options.expireCommand || options.expireLease) return route.fulfill(json({ detail: 'fixture server expiration' }, 410));
        state.startedAt ||= new Date().toISOString(); state.phase = 'bound';
        if (options.loseB && state.executes.length === 1) return route.abort('failed');
        return route.fulfill(json(reply()));
      }
      if (method === 'POST' && url.pathname === PATH + '/admissions/' + COMMAND + '/reconcile') {
        state.reconciles.push(request.postDataJSON());
        if (options.expireCommand) state.phase = 'unstarted_expired';
        if (options.loseFence && state.reconciles.length === 1) return route.abort('failed');
        return route.fulfill(json(reply()));
      }
      if (method === 'POST' && url.pathname === PATH + '/start') {
        state.legacy++; state.startedAt ||= new Date().toISOString();
        return route.fulfill(json({ started: true, timer: timer() }));
      }
      if (method === 'PATCH' && url.pathname === PATH + '/draft') {
        state.draft = request.postDataJSON().draft_text; state.saves++;
        return route.fulfill(json({ assignment_id: ASSIGNMENT }));
      }
      if (method === 'POST' && url.pathname === PATH + '/submit') {
        state.submissions.push(request.postDataJSON());
        return route.fulfill(json({ assignment_id: ASSIGNMENT, essay_id: 'fixture-essay', status: 'submitted' }));
      }
    }
    state.unexpected.push(method + ' ' + url.origin + url.pathname);
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => state.errors.push(String(error)));
  page.on('dialog', async dialog => { state.errors.push('unexpected dialog: ' + dialog.message()); await dialog.dismiss(); });
  const ready = async (query = '') => {
    await page.goto(base.origin + '/writing/dashboard' + query, { waitUntil: 'domcontentloaded' });
    await page.locator(button).waitFor();
    // End of page initialization, after receipt/permission checks and URL entry.
    await page.waitForFunction(() => window.__writingFixtureReady === true);
  };
  // Observe (not replace) the final prompt-bank request to make explicit actions
  // occur after initialization, rather than racing its URL-recovery check.
  page.on('response', async response => {
    if (new URL(response.url()).pathname === '/api/writing/prompt-bank') {
      await page.evaluate(() => { window.__writingFixtureReady = true; }).catch(() => {});
    }
  });
  const notice = async text => {
    await page.locator('#writing-submit-notice').filter({ hasText: text }).waitFor();
    await page.locator('#submit-modal').waitFor({ state: 'hidden' });
  };
  const editor = () => page.locator('#modal-essay-textarea').waitFor({ state: 'visible' });
  return { context, page, state, ready, notice, editor, secondReady, releaseSecond };
}

const browser = await launch();
let passed = 0;
async function scenario(name, options, run) {
  if (caseFilter && !name.includes(caseFilter)) return;
  const f = await fixture(browser, options);
  try {
    await run(f);
    assert.deepEqual(f.state.unexpected, [], 'unexpected network requests (all blocked)');
    assert.deepEqual(f.state.errors, [], 'browser runtime errors');
    if (options.enabled !== false) assert.equal(f.state.legacy, 0, 'strict flow must never call legacy start');
    for (const body of f.state.prepares) {
      assert.equal(body.protocol, 'admission-v1');
      assert.match(body.launch_nonce, /^[0-9a-f-]{36}$/i);
      assert.deepEqual(Object.keys(body).sort(), ['launch_nonce', 'protocol']);
    }
    for (const body of f.state.executes) assert.deepEqual(body, { protocol: 'admission-v1', generation: 0 });
    for (const body of f.state.reconciles) assert.deepEqual(body, { protocol: 'admission-v1' });
    for (const body of f.state.baselineEntries) {
      assert.equal(body.protocol, 'baseline-v1'); assert.match(body.launch_nonce, /^[0-9a-f-]{36}$/i);
      assert.equal(typeof body.allow_start, 'boolean');
      assert.deepEqual(Object.keys(body).sort(), ['allow_start', 'launch_nonce', 'protocol']);
    }
    console.log('PASS ' + name); passed++;
  } catch (error) {
    console.error('FAIL ' + name, { url: f.page.url(), unexpected: f.state.unexpected, errors: f.state.errors,
      calls: f.state.calls.slice(-12) });
    throw error;
  } finally { f.releaseSecond(); await f.context.close(); }
}
try {
  await scenario('normal start + autosave + reload restores draft without another A/B', {}, async f => {
    await f.ready(); await f.page.locator(button).click(); await f.editor();
    assert.equal(f.state.prepares.length, 1); assert.equal(f.state.executes.length, 1);
    assert.equal(new URL(f.page.url()).searchParams.get('assignment_id'), ASSIGNMENT);
    await f.page.locator('#modal-essay-textarea').fill(DRAFT);
    await f.page.locator('#modal-save-status').waitFor({ state: 'visible' });
    assert.equal(f.state.draft, DRAFT);
    const startedAt = f.state.startedAt;
    await f.page.reload(); await f.editor();
    assert.equal(await f.page.locator('#modal-essay-textarea').inputValue(), DRAFT);
    assert.equal(f.state.startedAt, startedAt);
    assert.equal(f.state.reads, 1); assert.equal(f.state.prepares.length, 1); assert.equal(f.state.executes.length, 1);
  });
  await scenario('lost A ACK reload finds original command by nonce without preparing again', { loseA: true }, async f => {
    await f.ready(); await f.page.locator(button).click(); await f.notice('Chưa xác nhận');
    await f.page.reload(); await f.editor();
    assert.equal(f.state.prepares.length, 1); assert.deepEqual(f.state.nonceReads, [f.state.prepares[0].launch_nonce]);
    assert.equal(f.state.executes.length, 1);
  });
  for (const rollback of [false, true]) {
    await scenario('lost B ACK reload reads bound command' + (rollback ? ' after flag rollback' : ''), { loseB: true }, async f => {
      await f.ready(); await f.page.locator(button).click(); await f.notice('Chưa xác nhận');
      if (rollback) f.state.enabled = false;
      await f.page.reload(); await f.editor();
      assert.equal(f.state.reads, 1); assert.equal(f.state.prepares.length, 1); assert.equal(f.state.executes.length, 1);
    });
  }
  await scenario('admission 409 preserves pending submission text and receipt', { rejectPrepare: true }, async f => {
    await f.ready();
    await f.page.evaluate(({ USER, ASSIGNMENT, DRAFT }) => window.WritingSubmitReceipt.begin(USER, ASSIGNMENT, DRAFT), { USER, ASSIGNMENT, DRAFT });
    const before = await f.page.evaluate(key => sessionStorage.getItem(key), SUBMIT_KEY);
    await f.page.locator(button).click(); await f.notice('Bản nháp và mã yêu cầu được giữ nguyên');
    assert.equal(await f.page.evaluate(key => sessionStorage.getItem(key), SUBMIT_KEY), before);
    assert.equal(f.state.executes.length, 0);
  });
  await scenario('direct URL cannot mint intent; subsequent explicit click can', {}, async f => {
    await f.ready('?assignment_id=' + ASSIGNMENT); await f.notice('Bấm Bắt đầu');
    assert.equal(f.state.prepares.length, 0);
    assert.equal(await f.page.evaluate(key => sessionStorage.getItem(key), KEY), null);
    await f.page.locator(button).click(); await f.editor();
    assert.equal(f.state.prepares.length, 1);
  });
  await scenario('legacy affinity blocks strict admission without redirect/start', { affinity: 'legacy' }, async f => {
    await f.ready(); await f.page.locator(button).click(); await f.notice('không thuộc trình soạn');
    assert.equal(f.state.prepares.length, 0);
    assert.equal(new URL(f.page.url()).pathname, '/writing/dashboard');
  });
  await scenario('default OFF retains ordinary start path', { enabled: false }, async f => {
    await f.ready(); await f.page.locator(button).click(); await f.editor();
    assert.equal(f.state.legacy, 1); assert.equal(f.state.prepares.length, 0);
  });
  await scenario('terminal canonical recovery does not reopen editor', { loseB: true, terminal: true }, async f => {
    await f.ready(); await f.page.locator(button).click(); await f.notice('Chưa xác nhận');
    await f.page.reload(); await f.notice('Bài đã được nộp');
    assert.equal(f.state.reads, 1); assert.equal(f.state.executes.length, 1);
  });
  await scenario('closing a loading second assignment cannot save the first essay into it', { second: true }, async f => {
    await f.ready(); await f.page.locator(button).click(); await f.editor();
    await f.page.locator('#modal-essay-textarea').fill(DRAFT);
    await f.page.locator('#modal-save-status').waitFor({ state: 'visible' });
    await f.page.locator('#modal-close').click();
    await f.page.locator('.assignment-card[data-assignment-id="' + SECOND + '"] .btn-start-assignment').click();
    await Promise.race([f.secondReady, new Promise((_, reject) => setTimeout(() => reject(Error('second prepare not reached')), 12000))]);
    await f.page.locator('#modal-close').click();
    f.releaseSecond();
    // Drain the already queued API-token microtasks before checking absence of a write.
    await f.page.waitForTimeout(200);
    assert.deepEqual(f.state.secondDrafts, [], 'old textarea must not become second-assignment draft');
    assert.equal(f.state.draft, DRAFT);
  });
  await scenario('expired canonical timer submits loaded draft, not the previous empty textarea', { expired: true, initialDraft: DRAFT }, async f => {
    await f.ready();
    const submitted = f.page.waitForResponse(response => new URL(response.url()).pathname === PATH + '/submit');
    await f.page.locator(button).click(); await submitted;
    await f.page.locator('#submit-modal').waitFor({ state: 'hidden' });
    assert.equal(f.state.submissions.length, 1);
    assert.equal(f.state.submissions[0].essay_text, DRAFT);
  });
  for (const loseFence of [false, true]) {
    await scenario('expired start command is fenced without a background job' + (loseFence ? ' and lost ACK recovers via GET' : ''),
      { expireCommand: true, loseFence }, async f => {
        await f.ready(); await f.page.locator(button).click();
        await f.notice(loseFence ? 'Chưa xác nhận' : 'đã hết hạn và được khóa');
        const saved = JSON.parse(await f.page.evaluate(key => sessionStorage.getItem(key), KEY));
        assert.equal(saved.state, loseFence ? 'pending' : 'fenced');
        await f.page.reload(); await f.notice('đã hết hạn và được khóa');
        assert.equal(f.state.prepares.length, 1); assert.equal(f.state.executes.length, 1);
        assert.equal(f.state.reconciles.length, 1); assert.equal(f.state.reads, 1);
        const recovered = JSON.parse(await f.page.evaluate(key => sessionStorage.getItem(key), KEY));
        assert.equal(recovered.nonce, saved.nonce); assert.equal(recovered.state, 'fenced');
        assert.equal(f.state.startedAt, null); assert.equal(f.state.saves, 0);
      });
  }
  await scenario('lease expiration with live command stays pending without a retry loop', { expireLease: true }, async f => {
    await f.ready(); await f.page.locator(button).click(); await f.notice('Bản nháp và mã yêu cầu được giữ nguyên');
    assert.equal(f.state.prepares.length, 1); assert.equal(f.state.executes.length, 1); assert.equal(f.state.reconciles.length, 1);
    const saved = JSON.parse(await f.page.evaluate(key => sessionStorage.getItem(key), KEY));
    assert.equal(saved.state, 'pending'); assert.equal(f.state.startedAt, null);
  });
  for (const baseline of ['baseline_untracked', 'baseline_unclaimed']) {
    await scenario(baseline + ' explicit start, saved draft and reload preserve first clock', { baseline, initialDraft: DRAFT }, async f => {
      await f.ready(); await f.page.locator(button).click(); await f.editor();
      assert.equal(await f.page.locator('#modal-essay-textarea').inputValue(), DRAFT);
      const clock = f.state.startedAt;
      assert.ok(clock); assert.equal(f.state.baselineEntries[0].allow_start, true);
      await f.page.reload(); await f.editor();
      assert.equal(await f.page.locator('#modal-essay-textarea').inputValue(), DRAFT);
      assert.equal(f.state.startedAt, clock); assert.equal(f.state.baselineEntries[1].allow_start, false);
      assert.equal(f.state.baselineEntries[1].launch_nonce, f.state.baselineEntries[0].launch_nonce);
      assert.equal(f.state.prepares.length, 0); assert.equal(f.state.executes.length, 0);
      const receipt = JSON.parse(await f.page.evaluate(key => sessionStorage.getItem(key), KEY));
      assert.equal(receipt.kind, 'baseline'); assert.equal(receipt.commandId, null); assert.equal(receipt.state, 'complete');
    });
  }
  await scenario('baseline lost ACK recovers original nonce resume-only', { baseline: 'baseline_unclaimed', loseBaseline: true, initialDraft: DRAFT }, async f => {
    await f.ready(); await f.page.locator(button).click(); await f.notice('Chưa xác nhận');
    const before = JSON.parse(await f.page.evaluate(key => sessionStorage.getItem(key), KEY));
    assert.equal(before.state, 'pending'); assert.equal(before.kind, undefined);
    const clock = f.state.startedAt;
    await f.page.reload(); await f.editor();
    assert.equal(f.state.startedAt, clock); assert.equal(f.state.baselineEntries[1].launch_nonce, before.nonce);
    assert.equal(f.state.baselineEntries[1].allow_start, false);
    assert.equal(await f.page.locator('#modal-essay-textarea').inputValue(), DRAFT);
    assert.equal(f.state.prepares.length, 0);
  });
  await scenario('baseline fresh URL resumes saved work with classification only', {
    baseline: 'baseline_untracked', startedAt: new Date(Date.now() - 300000).toISOString(), initialDraft: DRAFT,
  }, async f => {
    const clock = f.state.startedAt;
    await f.ready('?assignment_id=' + ASSIGNMENT); await f.editor();
    assert.equal(await f.page.locator('#modal-essay-textarea').inputValue(), DRAFT);
    assert.equal(f.state.startedAt, clock); assert.equal(f.state.baselineEntries.length, 0);
    assert.equal(f.state.prepares.length, 0); assert.equal(await f.page.evaluate(key => sessionStorage.getItem(key), KEY), null);
  });
  await scenario('baseline fresh URL cannot start an untouched clock', { baseline: 'baseline_untracked', initialDraft: DRAFT }, async f => {
    await f.ready('?assignment_id=' + ASSIGNMENT); await f.notice('Bấm Bắt đầu');
    assert.equal(f.state.startedAt, null); assert.equal(f.state.baselineEntries.length, 0);
    assert.equal(await f.page.evaluate(key => sessionStorage.getItem(key), KEY), null);
    await f.page.locator(button).click(); await f.editor();
    assert.equal(f.state.baselineEntries.length, 1); assert.equal(f.state.baselineEntries[0].allow_start, true);
    assert.equal(await f.page.locator('#modal-essay-textarea').inputValue(), DRAFT);
  });
  await scenario('baseline request lost before commit requires another explicit action, not reload', {
    baseline: 'baseline_untracked', loseBaselineBeforeCommit: true, initialDraft: DRAFT,
  }, async f => {
    await f.ready(); await f.page.locator(button).click(); await f.notice('Chưa xác nhận');
    const before = JSON.parse(await f.page.evaluate(key => sessionStorage.getItem(key), KEY));
    assert.equal(f.state.startedAt, null);
    await f.page.reload(); await f.notice('Bản nháp và mã yêu cầu được giữ nguyên');
    assert.equal(f.state.startedAt, null); assert.equal(f.state.baselineEntries[1].allow_start, false);
    await f.page.locator(button).click(); await f.editor();
    assert.equal(f.state.baselineEntries[2].allow_start, true);
    assert.equal(f.state.baselineEntries[2].launch_nonce, before.nonce);
    assert.equal(await f.page.locator('#modal-essay-textarea').inputValue(), DRAFT);
    assert.equal(f.state.prepares.length, 0);
  });
  await scenario('baseline expired URL entry submits populated draft without resetting clock', {
    baseline: 'baseline_unclaimed', expired: true, startedAt: new Date(Date.now() - 3000000).toISOString(), initialDraft: DRAFT,
  }, async f => {
    const clock = f.state.startedAt;
    const submitted = f.page.waitForResponse(response => new URL(response.url()).pathname === PATH + '/submit');
    await f.ready('?assignment_id=' + ASSIGNMENT);
    await submitted;
    assert.equal(f.state.submissions.length, 1); assert.equal(f.state.submissions[0].essay_text, DRAFT);
    assert.equal(f.state.startedAt, clock); assert.equal(f.state.baselineEntries.length, 0);
    assert.equal(f.state.prepares.length, 0);
  });
  for (const rejectBaseline of [false, true]) {
    await scenario('baseline old rejected A nonce ' + (rejectBaseline ? 'survives a stale classification conflict' : 'recovers without retrospective admission'), {
      baseline: 'baseline_untracked', rejectBaseline, startedAt: new Date(Date.now() - 300000).toISOString(), initialDraft: DRAFT,
    }, async f => {
      await f.ready();
      const old = { v: 1, accountId: USER, assignmentId: ASSIGNMENT, nonce: SECOND, commandId: null, state: 'pending' };
      await f.page.evaluate(({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)), { key: KEY, value: old });
      await f.ready('?assignment_id=' + ASSIGNMENT);
      if (rejectBaseline) await f.notice('Bản nháp và mã yêu cầu được giữ nguyên');
      else { await f.editor(); assert.equal(await f.page.locator('#modal-essay-textarea').inputValue(), DRAFT); }
      const saved = JSON.parse(await f.page.evaluate(key => sessionStorage.getItem(key), KEY));
      assert.equal(saved.nonce, old.nonce); assert.equal(f.state.baselineEntries[0].launch_nonce, old.nonce);
      assert.equal(f.state.baselineEntries[0].allow_start, false); assert.equal(f.state.prepares.length, 0);
      if (rejectBaseline) assert.deepEqual(saved, old);
      else assert.equal(saved.kind, 'baseline');
    });
  }
  for (const recoveredPhase of ['accepted', 'bound', 'unstarted_expired']) {
    await scenario('lost A nonce recovers terminal source with command still ' + recoveredPhase, {
      loseA: true, terminalAfterA: true, recoveredPhase,
    }, async f => {
      await f.ready(); await f.page.locator(button).click(); await f.notice('Chưa xác nhận');
      const pending = JSON.parse(await f.page.evaluate(key => sessionStorage.getItem(key), KEY));
      assert.equal(pending.commandId, null);
      await f.page.reload(); await f.notice('Bài đã được nộp');
      const saved = JSON.parse(await f.page.evaluate(key => sessionStorage.getItem(key), KEY));
      assert.equal(saved.nonce, pending.nonce); assert.equal(saved.commandId, COMMAND);
      assert.equal(saved.state, recoveredPhase === 'bound' ? 'complete' : recoveredPhase === 'accepted' ? 'pending' : 'fenced');
      assert.equal(f.state.prepares.length, 1); assert.deepEqual(f.state.nonceReads, [pending.nonce]);
      assert.equal(f.state.executes.length, 0); assert.equal(f.state.baselineEntries.length, 0);
      assert.equal(f.state.submissions.length, 0); assert.equal(f.state.phase, recoveredPhase);
    });
  }
  await scenario('nonce lookup failure preserves unknown command without preparing or baseline fallback', { loseA: true, lookupFailure: 503 }, async f => {
    await f.ready(); await f.page.locator(button).click(); await f.notice('Chưa xác nhận');
    const pending = await f.page.evaluate(key => sessionStorage.getItem(key), KEY);
    await f.page.reload(); await f.notice('Chưa xác nhận');
    assert.equal(await f.page.evaluate(key => sessionStorage.getItem(key), KEY), pending);
    assert.equal(f.state.prepares.length, 1); assert.equal(f.state.executes.length, 0);
    assert.equal(f.state.baselineEntries.length, 0); assert.equal(f.state.nonceReads.length, 1);
  });
  assert.ok(passed > 0, 'case filter matched no scenarios');
  console.log(`Writing admission local browser: ${passed} scenarios passed${caseFilter ? ' (filtered)' : ''}; SDK/API fixtures, no live backend evidence.`);
} finally { await browser.close(); }
