// Production Next browser consumers with intercepted, offline-generated grades.
// All non-local requests are intercepted; no production learner/data writes.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';
import { coreInputDigest } from '../lib/core-operation-intent.mjs';

const BASE = process.argv[2] || 'http://localhost:3131';
const SB = process.env.SUPABASE_URL || 'https://zjphffoujxkpltixsbzj.supabase.co';
const gold = JSON.parse(readFileSync(new URL('../tests/fixtures/dictation-versioned.json', import.meta.url)));
const fillerFixture = JSON.parse(readFileSync(new URL('../tests/fixtures/dictation-filler-gold.json', import.meta.url)));
const lengthFixture = JSON.parse(readFileSync(new URL('../tests/fixtures/dictation-length-actual-wire.json', import.meta.url)));
const fillerGold = fillerFixture.cases;
const g = gold[0].grade;
const user = '00000000-0000-4000-8000-000000000456';
const aid = '00000000-0000-4000-8000-000000000789';
const sid = '00000000-0000-4000-8000-000000000123';
const policy = { grading_version: 'lexical-v2', reference_sha256: g.reference_sha256 };
const legacyHash = coreInputDigest('dictation-texts-v1\n' + coreInputDigest('— Hello there.'));
const n1Receipt = { requestId: '550e8400-e29b-41d4-a716-446655440000', accountId: user, testId: 'test-1', sectionNum: 1,
  createdAt: new Date().toISOString(), localResults: [], localReport: null,
  submission: { client_request_id: '550e8400-e29b-41d4-a716-446655440000', attempt_id: aid, test_id: 'test-1', section_num: 1,
    sentences: [{ sentence_idx: 0, user_transcript: 'Hello there.', listen_count: 2, time_seconds: 8 }] } };
const session = JSON.stringify({ access_token: 'synthetic-dictation-policy', refresh_token: 'synthetic', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: user, email: 'synthetic@local' } });
const checks = []; const traces = []; const errors = [];
function check(name, ok, detail = '') { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`); if (!ok) throw new Error(name); }
let browser;
try { browser = await chromium.launch(); } catch (error) {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (!existsSync(chrome)) throw error;
  browser = await chromium.launch({ executablePath: chrome });
}

function report(requestId = null, legacy = false, submitted = null, grade = g) {
  const row = legacy ? { sentence_idx: 0, reference: '— Hello there.', user_text: 'Hello there.', score: .6667, correct_words: 2, total_words: 3,
    diff: [{ op: 'miss', expected: '—' }], listen_count: 0, time_seconds: 5, ops: { miss: 1, wrong: 0, extra: 0 } }
    : { ...grade, sentence_idx: 0, grading_evidence: grade, listen_count: 0, time_seconds: 5,
      ops: Object.fromEntries(['miss', 'wrong', 'extra'].map((op) => [op, grade.diff.filter((d) => d.op === op && !d.filler).length])) };
  if (submitted) { row.listen_count = submitted[0].listen_count; row.time_seconds = submitted[0].time_seconds; }
  return { id: sid, session_id: sid, attempt_id: aid, client_request_id: requestId, test_id: 'test-1', test_id_external: 'Synthetic', section_num: 1,
    section_title: 'Section 1', total_sentences: 1, correct_count: row.score === 1 ? 1 : 0, accuracy: row.score, total_words: row.total_words, correct_words: row.correct_words,
    grading_version: legacy ? 'legacy-whitespace-v1' : 'lexical-v2', reference_sha256: legacy ? null : grade.reference_sha256,
    results: [row], error_trends: { op_counts: row.ops, missed: legacy ? { '—': 1 } : {}, wrong: {} } };
}

async function scenario(name, options, run) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), session]);
  if (options.pendingN1) await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [`av:dictation:v1:${user}:test-1:1`, JSON.stringify(n1Receipt)]);
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  const state = { calls: [], stored: null, ...options };
  const lengthReport = state.lengthCase ? lengthFixture.cases.find((row) => row.name === state.lengthCase).admin : null;
  const scenarioGold = state.filler ? fillerGold.find((row) => row.name === state.filler)
    : state.extra ? gold.find((row) => row.name === 'extra-full-credit') : gold[0];
  const scenarioGrade = scenarioGold.grade;
  const scenarioPolicy = { grading_version: 'lexical-v2', reference_sha256: scenarioGrade.reference_sha256 };
  if (state.erasedParent) state.stored = { ...report(), attempt_id: null, test_id: null };
  if (state.ownerNullable) state.stored = { id: sid, session_id: sid, grading_version: 'legacy-whitespace-v1', reference_sha256: null,
    results: [{ sentence_idx: 0, user_text: 'hello', reference: null, score: null, correct_words: null, total_words: null }] };
  if (state.sparseHistory) state.stored = { id: sid, session_id: sid, test_id: 'original-stored-fk', test_id_external: 'display-code', section_num: 3,
    grading_version: 'legacy-whitespace-v1', reference_sha256: null,
    results: [{ sentence_idx: 4, user_text: 'saved input', reference: '\uFEFF  “Frozen—reference”  💡  ', score: null, correct_words: null, total_words: null }] };
  if (state.pendingN1) {
    state.stored = report(n1Receipt.requestId, true, n1Receipt.submission.sentences);
    state.stored.reference_sha256 = legacyHash;
    state.stored.results[0].grading_version = 'legacy-whitespace-v1'; state.stored.results[0].reference_sha256 = legacyHash;
    if (state.n1Fault === 'v2') state.stored = report(n1Receipt.requestId, false, n1Receipt.submission.sentences);
    if (state.n1Fault === 'attempt') state.stored.attempt_id = 'different-attempt';
    if (state.n1Fault === 'payload') state.stored.results[0].user_text = 'changed learner input';
    if (state.n1Fault === 'receipt') state.stored.client_request_id = 'another-UUID';
  }
  page.on('pageerror', (error) => errors.push({ scenario: name, error: String(error) }));
  await page.route('**/*', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin === BASE || ['data:', 'about:'].includes(url.protocol)) return route.continue();
    const method = request.method(); const body = request.postData() ? (() => { try { return JSON.parse(request.postData()); } catch { return null; } })() : null;
    state.calls.push({ method, path: url.pathname, body });
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (url.pathname === '/auth/me') return json({ id: user, role: state.admin ? 'admin' : 'student', email: 'synthetic@local' });
    if (lengthReport && url.pathname === '/admin/listening/dictation-reports') return json({ items: [lengthReport], total: 1, limit: 50, offset: 0, association_lookup_failed: false, association_lookup_failures: [] });
    if (lengthReport && url.pathname === `/admin/listening/dictation-reports/${lengthReport.id}`) return json(lengthReport);
    // These exact ASGI captures contain detail, not aggregate. Keep missing
    // aggregate evidence explicit instead of inventing a compatible mean.
    if (lengthReport && url.pathname.endsWith('/dictation-reports/aggregate')) return json({ detail: 'Offline length control has no aggregate capture.' }, 503);
    if (url.pathname === '/api/listening/tests/test-1/dictation') return json({ id: 'test-1', title: 'Synthetic <script>', audio_url: '/synthetic.wav', sections: [{ section_num: 1, title: 'Section 1', sentences: ['Current source has changed.'] }] });
    if (url.pathname.endsWith('/dictation/attempts/in-progress')) return json({ attempt: state.resume ? {
      attempt_id: aid, test_id: 'test-1', section_num: 1, status: 'in_progress', renderer_affinity: 'next',
      started_at: new Date().toISOString(), units: state.legacy ? [{ text: '— Hello there.' }] : scenarioGold.units,
      answers: state.saved ? report(null, state.legacy, null, scenarioGrade).results.map((row) => ({ ...row, user_transcript: row.user_text })) : [],
      ...(state.legacy ? { grading_version: 'legacy-whitespace-v1', reference_sha256: state.legacyDigest ? legacyHash : null } : scenarioPolicy),
    } : null });
    if (url.pathname.endsWith('/dictation/capabilities')) return state.n1Start ? json({ detail: 'Capabilities unavailable on N-1' }, 404)
      : json({ new_start_versions: state.flagOff ? ['legacy-whitespace-v1'] : ['legacy-whitespace-v1', 'lexical-v2'], readable_versions: ['legacy-whitespace-v1', 'lexical-v2'] });
    if (url.pathname.endsWith('/dictation/attempts') && method === 'POST') {
      const reply = { attempt_id: aid, test_id: 'test-1', section_num: 1, status: 'in_progress', renderer_affinity: null,
        created: true, started_at: new Date().toISOString(), units: gold[0].units, answers: [], ...policy };
      if (state.n1Start) { delete reply.created; reply.units = [{ text: '— Hello there.' }]; reply.grading_version = 'legacy-whitespace-v1'; reply.reference_sha256 = null; }
      if (state.createdFault === 'missing-v2') delete reply.created;
      if (state.createdFault === 'string-false') reply.created = 'false';
      return json(reply);
    }
    if (url.pathname.endsWith('/renderer-affinity')) return json({ attempt_id: aid, renderer_affinity: 'next' });
    if (url.pathname.includes('/sentences/')) {
      const value = state.legacy ? { ...report(null, true).results[0], is_correct: false, attempt_id: aid, grading_version: 'legacy-whitespace-v1', reference_sha256: state.legacyDigest ? legacyHash : null } : { ...scenarioGrade, attempt_id: aid, sentence_idx: 0 };
      if (state.badGrade === 'hash') value.reference_sha256 = 'a'.repeat(64);
      if (state.badGrade === 'version') value.grading_version = 'legacy-whitespace-v1';
      if (state.badGrade === 'identity') value.attempt_id = 'another-attempt';
      if (state.badGrade === 'score') { value.score = 0; value.is_correct = false; }
      if (state.badGrade === 'evidence') value.grading_evidence = { ...scenarioGrade, is_correct: false };
      return json(value);
    }
    if (url.pathname.includes('/session/by-request/')) return state.stored ? json(state.stored) : json({ detail: 'Not found' }, 404);
    if (url.pathname.endsWith('/dictation/session') && method === 'POST') {
      state.stored = report(body.client_request_id, state.legacy, body.sentences, scenarioGrade);
      if (state.legacyDigest) state.stored.reference_sha256 = legacyHash;
      if (state.wrongComplete === 'evidence') { state.stored = structuredClone(state.stored); state.stored.results[0].grading_evidence.is_correct = false; }
      else if (state.wrongComplete === 'mean') state.stored.accuracy = 0;
      else if (state.wrongComplete) state.stored = { ...state.stored, grading_version: 'legacy-whitespace-v1', reference_sha256: null };
      if (state.lostAck) return route.abort('connectionreset');
      return json(state.stored);
    }
    if (url.pathname === `/api/listening/tests/dictation/session/${sid}` && state.holdOwnedReport) {
      await new Promise((resolve) => { state.releaseOwnedReport = resolve; });
    }
    if (url.pathname === `/api/listening/tests/dictation/session/${sid}`) return state.ownerError ? json({ detail: state.ownerError === 403 ? 'Phiên này thuộc người dùng khác.' : 'Không tìm thấy phiên chép chính tả.' }, state.ownerError) : json(state.stored || report(null, state.legacy, null, scenarioGrade));
    if (url.pathname === '/api/listening/tests/dictation/flag' && method === 'POST') return state.flagFailure
      ? json({ detail: 'Published source permission denied' }, 403) : json({ ok: true });
    if (url.pathname.endsWith('/dictation-reports/aggregate') && state.legacyMissing) return json({ detail: 'Chưa xác minh được điểm Dictation đã lưu.' }, 503);
    if (url.pathname.endsWith('/dictation-reports/aggregate') && state.canonicalAggregate) return json(fillerFixture.canonical_admin_trends.cases.find((row) => row.name === state.canonicalAggregate).payload);
    if (url.pathname.endsWith('/dictation-reports/aggregate')) return json({ session_count: 2, mean_accuracy: .83335, mean_accuracy_basis: 'mean_of_session_sentence_scores', trend_classification: 'lexical-v1',
      trend_complete_session_count: 2, trend_unavailable_session_count: 0, top_missed: [], top_wrong: [], punctuation_missed: [{ token: '—', count: 1 }], punctuation_wrong: [],
      punctuation_missed_total: 1, punctuation_wrong_total: 0, missing_token_missed_total: 0, missing_token_wrong_total: 0,
      versions: [{ grading_version: 'legacy-whitespace-v1', session_count: 1, mean_accuracy: .6667 }, { grading_version: 'lexical-v2', session_count: 1, mean_accuracy: 1 }] });
    const adminRow = (legacy) => ({ ...report(null, legacy, null, scenarioGrade), id: legacy ? 'old-1' : sid, user: { id: user, display_name: 'Synthetic learner' }, association_lookup_failed: false, association_lookup_failures: [] });
    const optionalLegacy = { ...adminRow(true), id: sid, total_sentences: null, correct_count: null, accuracy: null, total_words: null, correct_words: null, results: [{ ...report(null, true).results[0], reference: null, ops: null, score: null, correct_words: null, total_words: null }] };
    if (url.pathname === '/admin/listening/dictation-reports' && state.legacyMissing) return json({ items: [optionalLegacy], total: 1, limit: 50, offset: 0, association_lookup_failed: false, association_lookup_failures: [] });
    if (url.pathname === `/admin/listening/dictation-reports/${sid}` && state.legacyMissing) return json(optionalLegacy);
    if (url.pathname === '/admin/listening/dictation-reports') return json({ items: [adminRow(true), adminRow(false)], total: 2, limit: 50, offset: 0, association_lookup_failed: false, association_lookup_failures: [] });
    if (url.pathname === `/admin/listening/dictation-reports/${sid}`) return json(state.badAdmin ? { ...adminRow(false), accuracy: 0 } : adminRow(false));
    return json({ detail: 'Synthetic fixture: request blocked' }, 404);
  });
  try { await run(page, state); } finally { traces.push({ name, calls: state.calls }); await context.close(); }
}

const learner = `${BASE}/listening/dictation/session?test_id=test-1&section=1`;
async function grade(page, answer = g.user_text) { await page.getByLabel('Câu trả lời câu 1').fill(answer); await page.getByRole('button', { name: 'Kiểm tra câu' }).click(); }

async function confirmedOwnedReport(page, action) {
  // A valid save ACK changes the URL, then React loads the owned report. The
  // earlier saved badge can disappear during this second read; assert only
  // after its response and final report render. Expected values stay unchanged.
  const ownedRead = page.waitForResponse((response) => response.request().method() === 'GET'
    && new URL(response.url()).pathname === `/api/listening/tests/dictation/session/${sid}` && response.status() === 200);
  await Promise.all([ownedRead, action()]);
  await page.locator('.dict-next-stats').waitFor();
  await page.getByText('✓ Đã lưu & xác nhận', { exact: true }).waitFor();
}

try {
  for (const createdFault of ['missing-v2', 'string-false']) await scenario(`admission-created-${createdFault}`, { createdFault }, async (page, state) => {
    await page.goto(learner); await page.getByRole('heading', { name: 'Không mở được bài' }).waitFor();
    const posts = state.calls.filter((c) => c.method === 'POST' && c.path.includes('dictation'));
    check(`${createdFault} admission refuses before renderer claim or learner activation`, posts.length === 1
      && posts[0].path.endsWith('/dictation/attempts') && posts[0].body.grading_version === 'lexical-v2'
      && await page.getByLabel('Câu trả lời câu 1').count() === 0);
  });
  await scenario('N-1-capabilities-missing-created-start', { n1Start: true }, async (page, state) => {
    await page.goto(learner); await page.getByLabel('Câu trả lời câu 1').waitFor();
    check('N-1 capabilities404 starts legacy with absent created evidence', state.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/dictation/attempts')).length === 1
      && state.calls.find((c) => c.method === 'POST' && c.path.endsWith('/dictation/attempts')).body.grading_version === 'legacy-whitespace-v1'
      && state.calls.filter((c) => c.path.endsWith('/renderer-affinity')).length === 1
      && await page.locator('[data-dictation-policy="legacy-whitespace-v1"]').count() === 1);
  });
  await scenario('owned-sparse-explicit-flag', { sparseHistory: true }, async (page, state) => {
    await page.goto(`${BASE}/listening/dictation/session?session_id=${sid}&test_id=conflicting-url&section=1`);
    await page.getByText('✓ Đã lưu & xác nhận', { exact: true }).waitFor();
    const before = state.calls.length;
    check('sparse historical read is GET-only with no guessed target for absent rows', state.calls.filter((c) => c.path.includes('dictation')).every((c) => c.method === 'GET')
      && await page.getByRole('button', { name: '⚑ Báo lỗi' }).nth(0).isDisabled());
    await page.getByRole('button', { name: '⚑ Báo lỗi' }).nth(4).click();
    const dialog = page.getByRole('dialog', { name: 'Báo lỗi — câu 5' });
    check('flag dialog presents exact frozen sparse reference', await dialog.locator('.dict-next-reference').textContent() === `Transcript đã lưu${state.stored.results[0].reference}`);
    await dialog.getByRole('button', { name: 'Transcript sai' }).click();
    await dialog.getByRole('button', { name: 'Gửi báo lỗi' }).click();
    await page.getByRole('button', { name: '✓ Đã báo lỗi' }).waitFor();
    // Passive page metrics remain in the trace; count business writes for this action.
    const writes = state.calls.slice(before).filter((c) => c.method === 'POST' && c.path !== '/api/analytics/events');
    check('one explicit sparse flag uses original FK, section and index without grade or completion', writes.length === 1 && writes[0].path === '/api/listening/tests/dictation/flag'
      && JSON.stringify(writes[0].body) === JSON.stringify({ test_id: 'original-stored-fk', section_num: 3, sentence_idx: 4, category: 'transcript_wrong', note: null }));
  });
  await scenario('fresh-owned-flag-refusal-keeps-draft', { flagFailure: true }, async (page, state) => {
    await page.goto(learner); await grade(page); await page.getByText('100% · 4/4 từ được chấm').waitFor();
    await confirmedOwnedReport(page, () => page.getByRole('button', { name: 'Xem tổng kết' }).click());
    const before = state.calls.length;
    await page.getByRole('button', { name: '⚑ Báo lỗi' }).click();
    const dialog = page.getByRole('dialog'); await dialog.getByLabel('Mô tả lỗi').fill('Keep this draft after refusal.');
    await dialog.getByRole('button', { name: 'Gửi báo lỗi' }).click(); await dialog.getByRole('alert').waitFor();
    check('refused flag keeps note, saved raw evidence and honest unsent state', await dialog.getByLabel('Mô tả lỗi').inputValue() === 'Keep this draft after refusal.'
      && await page.locator('[data-dictation-side="reference"]').textContent() === g.reference
      && await page.getByRole('button', { name: '✓ Đã báo lỗi' }).count() === 0);
    await dialog.getByRole('button', { name: 'Hủy' }).click();
    const writes = state.calls.slice(before).filter((c) => c.method === 'POST' && c.path !== '/api/analytics/events');
    check('cancel after refusal sends no retry or duplicate business write', writes.length === 1 && writes[0].path === '/api/listening/tests/dictation/flag'
      && writes[0].body.test_id === 'test-1' && writes[0].body.section_num === 1 && writes[0].body.sentence_idx === 0);
  });
  await scenario('fresh-v2-lost-ACK-reload', { lostAck: true }, async (page, state) => {
    await page.goto(learner); await grade(page); await page.getByText('100% · 4/4 từ được chấm').waitFor();
    check('new admission explicitly selects advertised v2', state.calls.find((c) => c.path.endsWith('/dictation/attempts'))?.body?.grading_version === 'lexical-v2');
    check('v2 grade ACK includes frozen overall hash', state.calls.find((c) => c.path.includes('/sentences/'))?.body.reference_sha256 === g.reference_sha256);
    check('raw reference and Unicode codepoint spans preserve exact source', await page.locator('[data-dictation-side="reference"]').textContent() === g.reference);
    check('unscored punctuation never rendered as missing/wrong lexical', await page.locator('[data-kind="unscored"].is-miss, [data-kind="unscored"].is-wrong').count() === 0 && await page.locator('[data-kind="unscored"]').count() >= 4);
    await confirmedOwnedReport(page, () => page.getByRole('button', { name: 'Xem tổng kết' }).click());
    check('lost completion ACK reconciles without duplicate POST', state.calls.filter((c) => c.path.endsWith('/dictation/session') && c.method === 'POST').length === 1);
    check('completion ACK contains immutable policy/hash', state.calls.find((c) => c.path.endsWith('/dictation/session') && c.method === 'POST')?.body.reference_sha256 === g.reference_sha256);
    check('completion URL retains exact report identity', new URL(page.url()).searchParams.get('session_id') === sid);
    const before = state.calls.length; await page.reload(); await page.getByText('✓ Đã lưu & xác nhận', { exact: true }).waitFor();
    check('completed reload reads only owned persisted report', state.calls.slice(before).filter((c) => c.path.includes('dictation')).every((c) => c.method === 'GET' && c.path === `/api/listening/tests/dictation/session/${sid}`));
    check('completed reload keeps raw v2 source despite current source edits', await page.locator('[data-dictation-side="reference"]').textContent() === g.reference);
    check('mobile report has no horizontal page overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  });
  for (const badGrade of ['hash', 'version', 'identity', 'score', 'evidence']) await scenario(`bad-grade-${badGrade}`, { resume: true, badGrade }, async (page) => {
    await page.goto(learner); await grade(page); await page.getByText(/^Không chấm được câu trả lời\./).waitFor();
    const preserved = await page.getByLabel('Câu trả lời câu 1').inputValue();
    const editable = await page.getByLabel('Câu trả lời câu 1').isEditable();
    check(`${badGrade} ACK rejected; raw input retained and editable`, preserved === g.user_text && editable && await page.getByRole('button', { name: 'Xem tổng kết' }).count() === 0, JSON.stringify({ preserved, editable }));
  });
  await scenario('extra-full-credit-P04', { resume: true, extra: true }, async (page) => {
    const extra = gold.find((row) => row.name === 'extra-full-credit').grade;
    await page.goto(learner); await grade(page, extra.user_text); await page.getByText('100% · 1/1 từ được chấm').waitFor();
    check('P04 extra word is error evidence without a fabricated score penalty', await page.locator('[data-dictation-side="user"] [data-op="extra"]').textContent() === 'tomorrow'
      && await page.getByText(/Từ thừa được ghi trong mẫu lỗi; điểm tính theo số từ đúng trên tổng từ được chấm của transcript/).count() === 1);
  });
  for (const filler of ['F01', 'F02', 'F05', 'F06', 'unicode15-outline-u-miss', 'unicode15-bom-wrong', 'unicode15-square-mm-miss']) await scenario(`filler-${filler}-grade-resume-owned`, { filler, resume: true, saved: filler === 'F05' }, async (page, state) => {
    const value = fillerGold.find((row) => row.name === filler).grade;
    await page.goto(learner); if (filler !== 'F05') await grade(page, value.user_text);
    await page.getByText(`${Math.round(value.score * 100)}% · ${value.correct_words}/${value.total_words} từ được chấm`).waitFor();
    const operation = value.diff.find((op) => op.op !== 'match');
    const reference = page.locator('[data-dictation-side="reference"]');
    check(`${filler} raw evidence keeps canonical filler/error classification`, await reference.textContent() === value.reference
      && (operation.filler ? await reference.locator('.is-filler[data-kind="lexical"]').textContent() === operation.expected
        && await reference.locator('.is-miss, .is-wrong').count() === 0
        : await reference.locator('.is-filler').count() === 0 && await reference.locator('.is-miss, .is-wrong').textContent() === operation.expected));
    await confirmedOwnedReport(page, () => page.getByRole('button', { name: 'Xem tổng kết' }).click());
    check(`${filler} completion verifies canonical score and denominator`, await page.locator('.dict-next-stats').getByText(`${Math.round(value.score * 100)}%`, { exact: true }).count() === 1
      && await page.locator('.dict-next-stats').getByText(`${value.correct_words}/${value.total_words}`, { exact: true }).count() >= 1
      && !await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('av:dictation:v1:'))));
    const before = state.calls.length; await page.reload(); await page.getByText('✓ Đã lưu & xác nhận', { exact: true }).waitFor();
    check(`${filler} owned reload is GET-only and keeps frozen evidence`, state.calls.slice(before).filter((c) => c.path.includes('dictation')).every((c) => c.method === 'GET' && c.path === `/api/listening/tests/dictation/session/${sid}`)
      && await page.locator('[data-dictation-side="reference"]').textContent() === value.reference
      && await page.locator('.dict-next-stats').getByText(`${Math.round(value.score * 100)}%`, { exact: true }).count() === 1);
  });
  await scenario('filler-owned-read-phase-boundary', { filler: 'unicode15-square-mm-miss', resume: true, holdOwnedReport: true }, async (page, state) => {
    const value = fillerGold.find((row) => row.name === state.filler).grade;
    await page.goto(learner); await grade(page, value.user_text);
    await page.getByText('100% · 1/1 từ được chấm').waitFor();
    const ownedReadStarted = page.waitForRequest((request) => request.method() === 'GET'
      && new URL(request.url()).pathname === `/api/listening/tests/dictation/session/${sid}`);
    const confirmation = confirmedOwnedReport(page, () => page.getByRole('button', { name: 'Xem tổng kết' }).click());
    await ownedReadStarted;
    await page.getByText('Đang tải bài chép chính tả…', { exact: true }).waitFor();
    check('owned-report response barrier exposes loading without an optimistic summary or duplicate POST', await page.locator('.dict-next-stats').count() === 0
      && state.calls.filter((c) => c.path.endsWith('/dictation/session') && c.method === 'POST').length === 1
      && !await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('av:dictation:v1:'))));
    state.holdOwnedReport = false; state.releaseOwnedReport(); await confirmation;
    const observed = { scores: await page.locator('.dict-next-stats').getByText('100%', { exact: true }).count(), words: await page.locator('.dict-next-stats').getByText('1/1', { exact: true }).count(), reference: await page.locator('[data-dictation-side="reference"]').textContent(), posts: state.calls.filter((c) => c.path.endsWith('/dictation/session') && c.method === 'POST').length };
    check('released owned report restores exact canonical filler score, denominator and raw evidence', observed.scores === 1 && observed.words >= 1 && observed.reference === value.reference && observed.posts === 1, JSON.stringify(observed));
  });
  for (const filler of ['F01', 'F02', 'F06', 'unicode15-outline-u-miss', 'unicode15-bom-wrong', 'unicode15-square-mm-miss']) await scenario(`admin-filler-${filler}`, { filler, admin: true }, async (page, state) => {
    const value = fillerGold.find((row) => row.name === filler).grade;
    await page.goto(`${BASE}/admin/listening/dictation`); await page.getByRole('region', { name: 'Bảng phiên chép chính tả' }).waitFor();
    await page.getByRole('button', { name: 'Xem từng câu' }).nth(1).click(); await page.locator('.aldict-detail [data-dictation-side="reference"]').waitFor();
    const operation = value.diff.find((op) => op.op !== 'match');
    check(`Admin ${filler} raw evidence retains canonical classification without missing evidence`, await page.locator('.aldict-detail [data-dictation-side="reference"]').textContent() === value.reference
      && await page.locator('.aldict-detail [data-dictation-side="reference"] .is-filler[data-kind="lexical"]').count() === (operation.filler ? 1 : 0)
      && await page.getByText(/Đã loại 1 câu/).count() === 0 && state.calls.filter((c) => c.path.includes('dictation')).every((c) => c.method === 'GET'));
  });
  await scenario('owned-legacy-nullable-sentence', { ownerNullable: true }, async (page, state) => {
    await page.goto(`${BASE}/listening/dictation/session?session_id=${sid}`); await page.getByText('✓ Đã lưu & xác nhận', { exact: true }).waitFor();
    check('owner legacy nullable sentence keeps unavailable values and original absence', await page.getByText('— · —/—', { exact: true }).count() === 1
      && await page.getByText('0%', { exact: true }).count() === 0 && await page.getByText('Nguyên văn transcript không có trong bản lưu.', { exact: false }).count() === 1
      && await page.getByRole('button', { name: '⚑ Báo lỗi' }).isDisabled()
      && state.calls.filter((c) => c.path.includes('dictation')).every((c) => c.method === 'GET' && c.path === `/api/listening/tests/dictation/session/${sid}`));
    const before = state.calls.length; await page.reload(); await page.getByText('— · —/—', { exact: true }).waitFor();
    check('owner nullable legacy reload stays GET-only without current-source substitution', state.calls.slice(before).filter((c) => c.path.includes('dictation')).every((c) => c.method === 'GET' && c.path === `/api/listening/tests/dictation/session/${sid}`)
      && await page.getByText('Current source has changed.', { exact: true }).count() === 0);
  });
  await scenario('v2-resume-flag-off-retry', { resume: true, flagOff: true }, async (page, state) => {
    await page.goto(learner); await grade(page); await page.getByText('100% · 4/4 từ được chấm').waitFor();
    await page.getByRole('button', { name: 'Thử lại', exact: true }).click(); await grade(page); await page.getByText('100% · 4/4 từ được chấm').waitFor();
    await confirmedOwnedReport(page, () => page.getByRole('button', { name: 'Xem tổng kết' }).click());
    check('flag-off active v2 finishes and retries without capabilities/new admission', !state.calls.some((c) => c.path.includes('capabilities') || c.path.endsWith('/dictation/attempts')) && state.calls.filter((c) => c.path.includes('/sentences/')).every((c) => c.body.grading_version === 'lexical-v2' && c.body.reference_sha256 === g.reference_sha256));
  });
  await scenario('legacy-resume', { resume: true, legacy: true, saved: true }, async (page, state) => {
    await page.goto(learner); await page.getByText('67% · 2/3 token theo cách chấm cũ').waitFor();
    check('legacy score/denominator preserved, no upgrade negotiation', await page.locator('[data-dictation-policy="legacy-whitespace-v1"]').count() === 1 && !state.calls.some((c) => c.path.includes('capabilities')));
  });
  await scenario('legacy-explicit-parent-digest', { resume: true, legacy: true, saved: true, legacyDigest: true }, async (page, state) => {
    await page.goto(learner); await page.getByText('67% · 2/3 token theo cách chấm cũ').waitFor();
    check('explicit v1 parent hash inherits legacy nullable answer header without changing saved score', !state.calls.some((c) => c.path.includes('capabilities')));
    await page.getByRole('button', { name: 'Thử lại', exact: true }).click(); await grade(page, 'Hello there.');
    await page.getByText('67% · 2/3 token theo cách chấm cũ').waitFor();
    await confirmedOwnedReport(page, () => page.getByRole('button', { name: 'Xem tổng kết' }).click());
    check('explicit v1 retry/complete acknowledge actual frozen hash; old denominator remains 3', state.calls.filter((c) => c.path.includes('/sentences/') || (c.path.endsWith('/dictation/session') && c.method === 'POST')).every((c) => c.body.grading_version === 'legacy-whitespace-v1' && c.body.reference_sha256 === legacyHash));
  });
  await scenario('wrong-completion-policy-reload', { resume: true, wrongComplete: true }, async (page, state) => {
    await page.goto(learner); await grade(page); await page.getByText('100% · 4/4 từ được chấm').waitFor();
    await page.getByRole('button', { name: 'Xem tổng kết' }).click(); await page.getByText('Kết quả chưa được xác nhận.', { exact: true }).waitFor();
    check('wrong-policy report cannot clear durable receipt/restart', await page.getByRole('button', { name: 'Làm lại section' }).isDisabled() && await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('av:dictation:v1:'))));
    const receipt = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((key) => key.startsWith('av:dictation:v1:')))));
    state.stored = report(receipt.requestId, false, receipt.submission.sentences); const before = state.calls.length;
    await confirmedOwnedReport(page, () => page.reload());
    check('pending receipt reload confirms frozen policy without creating/regrading', state.calls.slice(before).filter((c) => c.path.includes('dictation')).every((c) => c.method === 'GET'));
  });
  for (const wrongComplete of ['mean', 'evidence']) await scenario(`wrong-completion-${wrongComplete}-reload`, { resume: true, wrongComplete }, async (page, state) => {
    await page.goto(learner); await grade(page); await page.getByText('100% · 4/4 từ được chấm').waitFor();
    await page.getByRole('button', { name: 'Xem tổng kết' }).click(); await page.getByText('Kết quả chưa được xác nhận.', { exact: true }).waitFor();
    check(`contradictory v2 ${wrongComplete} cannot confirm or clear the durable receipt`, await page.getByRole('button', { name: 'Làm lại section' }).isDisabled()
      && await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('av:dictation:v1:'))));
    const receipt = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((key) => key.startsWith('av:dictation:v1:')))));
    state.stored = report(receipt.requestId, false, receipt.submission.sentences); const before = state.calls.length;
    await confirmedOwnedReport(page, () => page.reload());
    check(`corrected canonical v2 ${wrongComplete} confirms after GET-only receipt reload`, state.calls.slice(before).filter((c) => c.path.includes('dictation')).every((c) => c.method === 'GET')
      && state.calls.filter((c) => c.path.endsWith('/dictation/session') && c.method === 'POST').length === 1);
  });
  for (const [name, options, query] of [
    ['owned-legacy', { legacy: true, flagOff: true }, `session_id=${sid}`], ['owned-v2', { flagOff: true }, `session_id=${sid}`],
    ['owned-v2-erased-parent', { erasedParent: true }, `session_id=${sid}`],
    ['wrong-owner', { ownerError: 403 }, `session_id=${sid}`], ['missing-report', { ownerError: 404 }, `session_id=${sid}`],
    ['invalid-query', {}, 'session_id=bad'], ['duplicate-query', {}, `session_id=${sid}&session_id=${sid}`],
  ]) await scenario(name, options, async (page, state) => {
    await page.goto(`${BASE}/listening/dictation/session?${query}`);
    const failure = options.ownerError || name.includes('query');
    await (failure ? page.getByRole('heading', { name: 'Không mở được bài' }) : page.getByText('✓ Đã lưu & xác nhận', { exact: true })).waitFor();
    check(`${name} has no learner writes, starts or policy negotiation`, state.calls.filter((c) => c.path.includes('dictation')).every((c) => c.method === 'GET' && c.path === `/api/listening/tests/dictation/session/${sid}`));
    if (options.erasedParent) check('erased owned parent keeps frozen report but cannot guess a content-feedback FK', await page.getByRole('button', { name: '⚑ Báo lỗi' }).isDisabled());
    if (!failure) { await page.reload(); await page.getByText('✓ Đã lưu & xác nhận', { exact: true }).waitFor(); check(`${name} report reload remains policy-specific`, await page.locator(`[data-dictation-policy="${options.legacy ? 'legacy-whitespace-v1' : 'lexical-v2'}"]`).count() === 1); }
  });
  await scenario('N-1-missing-both-authoritative-v1', { pendingN1: true }, async (page, state) => {
    // Receipt confirmation updates the URL; the owned-report effect then reloads
    // canonical data. Observe that final read before asserting its rendered value.
    const ownedReport = page.waitForResponse((response) => response.request().method() === 'GET'
      && new URL(response.url()).pathname === `/api/listening/tests/dictation/session/${sid}` && response.status() === 200);
    await page.goto(learner); await ownedReport;
    await page.locator('.dict-next-stats').getByText('67%', { exact: true }).waitFor();
    await page.getByText('— Hello there.', { exact: false }).first().waitFor();
    await page.getByText('✓ Đã lưu & xác nhận', { exact: true }).waitFor();
    const observed = { scoreCount: await page.getByText('67%', { exact: true }).count(), referenceCount: await page.getByText('— Hello there.', { exact: false }).count(), posts: state.calls.filter((c) => c.method === 'POST' && c.path.includes('dictation')), url: page.url() };
    check('N-1 missing both ACK fields restores explicit v1 nonnull hash, original reference and 2/3 score', observed.scoreCount === 1 && observed.referenceCount >= 1 && observed.posts.length === 0, JSON.stringify(observed));
  });
  for (const n1Fault of ['v2', 'attempt', 'payload', 'receipt']) await scenario(`N-1-reject-${n1Fault}`, { pendingN1: true, n1Fault }, async (page) => {
    await page.goto(learner); await page.getByText('Kết quả chưa được xác nhận.', { exact: true }).waitFor();
    check(`N-1 ${n1Fault} mismatch keeps original durable receipt`, await page.getByRole('button', { name: 'Làm lại section' }).isDisabled() && await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('av:dictation:v1:'))));
  });
  await scenario('admin-coexisting-policies', { admin: true }, async (page, state) => {
    await page.goto(`${BASE}/admin/listening/dictation`); await page.getByRole('region', { name: 'Bảng phiên chép chính tả' }).waitFor();
    await page.getByText(/Tổng quan gồm cả v1 và v2/).waitFor();
    check('admin explicitly labels mixed mean and separate policy means', await page.getByText(/Tổng quan gồm cả v1 và v2/).count() === 1 && await page.locator('[aria-label="Điểm theo chính sách chấm"]').getByText('67%', { exact: true }).count() === 1 && await page.locator('[aria-label="Điểm theo chính sách chấm"]').getByText('100%', { exact: true }).count() === 1);
    await page.getByRole('button', { name: 'Xem từng câu' }).nth(1).click(); await page.locator('.aldict-detail [data-dictation-side="reference"]').waitFor();
    check('admin v2 detail renders saved raw/codepoint spans', await page.locator('.aldict-detail [data-dictation-side="reference"]').textContent() === g.reference);
    check('admin read-only reporting never mutates grades', state.calls.filter((c) => c.path.includes('dictation')).every((c) => c.method === 'GET'));
    await page.setViewportSize({ width: 1440, height: 900 }); check('admin desktop has no horizontal page overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  });
  for (const name of ['deseret5001', 'ascii10001']) await scenario(`admin-actual-long-reference-${name}`, { admin: true, lengthCase: name }, async (page, state) => {
    const raw = lengthFixture.cases.find((row) => row.name === name).admin;
    const detailPath = `/admin/listening/dictation-reports/${raw.id}`;
    await page.goto(`${BASE}/admin/listening/dictation`); await page.getByRole('region', { name: 'Bảng phiên chép chính tả' }).waitFor();
    const detailRead = page.waitForResponse((response) => new URL(response.url()).pathname === detailPath && response.status() === 200);
    await Promise.all([detailRead, page.getByRole('button', { name: 'Xem từng câu' }).click()]);
    await page.locator('.aldict-detail [data-dictation-side="reference"]').waitFor();
    const exactEvidence = async () => await page.locator('.aldict-detail [data-dictation-side="reference"]').textContent() === raw.results[0].reference
      && await page.locator('.aldict-detail [data-dictation-side="user"]').textContent() === raw.results[0].user_text
      && await page.locator('.aldict-sentence-table [data-label="Điểm"] strong').textContent() === `${Math.round(raw.results[0].score * 100)}%`
      && await page.getByText(/Đã loại 1 câu|Thiếu 1\/1 câu|Evidence chưa đầy đủ/).count() === 0;
    check(`Admin ${name} retains actual raw text, score and complete evidence`, await exactEvidence());
    check(`Admin ${name} long reference wraps within the mobile page`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.setViewportSize({ width: 1440, height: 900 });
    check(`Admin ${name} long reference wraps within the desktop page`, await exactEvidence() && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const reloaded = page.waitForResponse((response) => new URL(response.url()).pathname === detailPath && response.status() === 200);
    await Promise.all([reloaded, page.reload()]); await page.locator('.aldict-detail [data-dictation-side="reference"]').waitFor();
    check(`Admin ${name} reload keeps the same actual report with GET-only reads`, await exactEvidence()
      && state.calls.filter((call) => call.path === detailPath).length === 2
      && state.calls.filter((call) => call.path.includes('dictation')).every((call) => call.method === 'GET'));
  });
  for (const row of fillerFixture.canonical_admin_trends.cases) await scenario(`admin-canonical-keys-${row.name}`, { admin: true, canonicalAggregate: row.name }, async (page, state) => {
    await page.goto(`${BASE}/admin/listening/dictation`); await page.getByRole('region', { name: 'Bảng phiên chép chính tả' }).waitFor();
    await page.getByText(/Dấu câu trong dữ liệu chấm cũ/).click();
    const panels = page.locator('.aldict-trends article');
    for (const [index, key, label] of [[0, 'top_missed', 'word'], [1, 'top_wrong', 'expected'], [2, 'punctuation_missed', 'token'], [3, 'punctuation_wrong', 'token']]) {
      check(`Admin ${row.name} ${key} keeps exact raw keys`, JSON.stringify(await panels.nth(index).locator('li span').allTextContents()) === JSON.stringify(row.payload[key].map((entry) => entry[label])));
    }
    check(`Admin ${row.name} mobile keeps complete canonical aggregate without overflow`, await page.getByText('Không tải được tổng hợp', { exact: true }).count() === 0
      && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
      && state.calls.filter((c) => c.path.includes('dictation')).every((c) => c.method === 'GET'));
    await page.setViewportSize({ width: 1440, height: 900 });
    check(`Admin ${row.name} desktop keeps long canonical labels within page`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  });
  await scenario('admin-inconsistent-detail-summary', { admin: true, badAdmin: true }, async (page, state) => {
    await page.goto(`${BASE}/admin/listening/dictation`); await page.getByRole('region', { name: 'Bảng phiên chép chính tả' }).waitFor();
    await page.getByRole('button', { name: 'Xem từng câu' }).nth(1).click(); await page.getByText('Không tải được chi tiết', { exact: true }).waitFor();
    check('Admin contradictory complete summary fails visibly without showing a verified zero score', await page.locator('.aldict-detail [data-dictation-side="reference"]').count() === 0
      && state.calls.filter((c) => c.path.includes('dictation')).every((c) => c.method === 'GET'));
  });
  await scenario('admin-legacy-optional-data', { admin: true, legacyMissing: true }, async (page) => {
    await page.goto(`${BASE}/admin/listening/dictation`); await page.getByRole('region', { name: 'Bảng phiên chép chính tả' }).waitFor();
    check('admin retains legitimate legacy-null row and shows unavailable accuracy, never 0%', await page.getByText('Chưa có số liệu', { exact: true }).count() >= 1 && await page.getByText('0%', { exact: true }).count() === 0 && await page.getByText(/Đã loại 1 dòng/).count() === 0);
    await page.getByRole('button', { name: 'Xem từng câu' }).click(); await page.getByText('Nguyên văn không có trong bản lưu.', { exact: true }).waitFor();
    check('admin missing legacy original/ops/totals stay explicitly unavailable', await page.getByText('Không có bảng lỗi đã lưu.', { exact: true }).count() === 1 && await page.getByText(/Tổng số câu không có trong bản lưu/).count() === 1);
    check('admin nullable sentence score/counts are retained, not rejected or fabricated zero', await page.locator('.aldict-sentence-table [data-label="Điểm"]').textContent() === '——/— token cũ'
      && await page.locator('.aldict-sentence-table').getByText('0%', { exact: true }).count() === 0 && await page.getByText(/Đã loại 1 câu/).count() === 0);
    await page.getByText('Không tải được tổng hợp', { exact: true }).waitFor();
    check('admin unavailable aggregate is a visible failure, not a fabricated zero mean', await page.getByText('Không tải được tổng hợp', { exact: true }).count() === 1);
  });
  check('all browser scenarios have no JavaScript errors', errors.length === 0, JSON.stringify(errors));
} finally {
  await browser.close();
  if (process.env.DICTATION_BROWSER_EVIDENCE) writeFileSync(process.env.DICTATION_BROWSER_EVIDENCE, JSON.stringify({ base: BASE, browser: 'Chromium production Next; all external requests intercepted', checks, traces, errors }, null, 2) + '\n');
  console.log(`Versioned dictation browser: ${checks.filter((c) => c.ok).length}/${checks.length} checks passed`);
}
