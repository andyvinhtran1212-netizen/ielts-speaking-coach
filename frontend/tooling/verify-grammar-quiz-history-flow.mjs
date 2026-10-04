// Existing built Next server. Public-only actual backend capture; synthetic auth
// and intercepted HTTP. History GET is distinct from an explicit review admission.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = new URL(process.argv[2] || 'http://localhost:3011').origin;
const API = 'https://grammar-history-fixture.invalid';
const bytes = readFileSync(new URL('../tests/fixtures/grammar-history-public-wire.json', import.meta.url));
const wire = JSON.parse(bytes), results = [], scenarios = [];
const progress = wire.requests[0], mistakes = wire.requests[1], unavailable = wire.requests[2];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`); };
let browser;
try { browser = await chromium.launch(); } catch (error) {
  const executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (process.platform !== 'darwin' || !existsSync(executablePath)) throw error;
  browser = await chromium.launch({ executablePath });
}

async function fixture(width, theme, missing = false) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, reducedMotion: 'reduce' });
  const page = await context.newPage(), trace = [], errors = [];
  page.setDefaultTimeout(15_000);
  let mistakeReads = 0;
  await context.addInitScript(() => {
    window.__AVER_SUPABASE_CLIENT__ = { auth: {
      getSession: async () => ({ data: { session: { access_token: 'synthetic-history-token', user: { id: 'history-fixture-user', email: 'history@example.com' } } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({ error: null }),
    } };
  });
  await context.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (url.origin === BASE) {
      if (url.pathname === '/js/runtime-config.js') return route.fulfill({ contentType: 'application/javascript', body: `window.__AVER_RUNTIME_CONFIG__=Object.freeze({apiBase:${JSON.stringify(API)}});` });
      return route.continue();
    }
    if (url.origin !== API) return route.abort();
    const headers = { 'access-control-allow-origin': BASE, 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS', 'access-control-allow-headers': 'authorization,content-type,x-request-id' };
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    const entry = { method, path: `${url.pathname}${url.search}`, body: request.postDataJSON() }; trace.push(entry);
    const json = (value, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(value) });
    // The existing student chrome resolves its profile through this shared
    // endpoint. This synthetic owned profile is not a history/API projection.
    if (method === 'GET' && url.pathname === '/auth/me') return json({ id: 'history-fixture-user', email: 'history@example.com', display_name: 'History Fixture', role: 'student', is_active: true, onboarding_completed: true });
    if (method === 'GET' && entry.path === progress.path) return json(progress.response, progress.status);
    if (method === 'GET' && entry.path === mistakes.path) {
      const row = missing && ++mistakeReads === 1 ? unavailable : mistakes;
      return json(row.response, row.status);
    }
    // Telemetry is visible in trace and is not a learner quiz mutation.
    if (url.pathname === '/api/analytics/events' || url.pathname === '/api/error-logs') return json({});
    throw new Error(`Unexpected history transport ${method} ${entry.path}`);
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${BASE}/quiz/progress?skill_area=grammar`, { waitUntil: 'domcontentloaded' });
  return { context, page, trace, errors };
}
const businessWrites = (run) => run.trace.filter((row) => row.path.startsWith('/api/quiz/') && row.method !== 'GET');
async function ownQuestions(run, name) {
  const cards = run.page.locator('.pg-mk');
  await cards.nth(mistakes.response.items.length - 1).waitFor();
  for (const [index, item] of mistakes.response.items.entries()) {
    const card = cards.nth(index), head = card.getByRole('button');
    await head.focus();
    if (await head.getAttribute('aria-expanded') === 'false') await run.page.keyboard.press('Space');
    const body = card.locator('.pg-mk__body'); await body.waitFor({ state: 'visible' });
    for (const q of item.questions) {
      const text = await body.innerText();
      check(`${name}/${index}/${q.qid}: own original stem/key/result`, text.includes(q.prompt.replaceAll('**', '')) && text.includes(q.your_answer) && text.includes(q.correct_answer) && await body.getByRole('link', { name: 'Ôn lại bài' }).getAttribute('href') === q.article_url);
    }
  }
}
async function snapshot(run, name) {
  const value = await run.page.evaluate(() => {
    const shell = document.querySelector('.pg-shell');
    const labels = [...(shell?.querySelectorAll('[aria-label]') || [])].map((node) => node.getAttribute('aria-label'));
    const controls = [...(shell?.querySelectorAll('button,a[href]') || [])].filter((el) => { const r = el.getBoundingClientRect(); return r.width && r.height && getComputedStyle(el).visibility !== 'hidden'; }).map((el) => { const r = el.getBoundingClientRect(); return { label: el.getAttribute('aria-label') || el.textContent?.trim(), width: r.width, height: r.height }; });
    const motion = [...(shell?.querySelectorAll('.pg-bar,.subpage-header__back') || [])].map((el) => ({ class: el.className, transition: getComputedStyle(el).transitionDuration }));
    return { text: shell?.textContent, labels, width: innerWidth, documentWidth: document.documentElement.scrollWidth, controls, motion };
  });
  (run.ui ||= []).push({ name, ...value });
  check(`${name}: physical code absent from visible/aria history`, progress.response.banks.every((bank) => !value.text.includes(bank.code) && value.labels.every((label) => !label?.includes(bank.code))));
  check(`${name}: layout fits`, value.documentWidth <= value.width + 1);
  check(`${name}:44px interactive targets`, value.controls.every((r) => r.width >= 43.99 && r.height >= 43.99), JSON.stringify(value.controls.filter((r) => r.width < 43.99 || r.height < 43.99)));
  check(`${name}: reduced motion`, value.motion.every((r) => r.transition.split(',').every((v) => parseFloat(v) === 0)), JSON.stringify(value.motion));
}
async function close(name, run) {
  check(`${name}: GET-only history/no admission,progress,end,reset/zero JS errors`, businessWrites(run).length === 0 && run.errors.length === 0, run.errors.join('; '));
  scenarios.push({ name, trace: run.trace, errors: run.errors, ui: run.ui || [] }); await run.context.close();
}

try {
  check('capture history contains distinct physical old/current rows and zero DB changes', progress.status === 200 && mistakes.status === 200 && progress.response.banks.length === 2 && mistakes.response.items.length === 2 && wire.provenance.history_write_calls === 0 && JSON.stringify(wire.provenance.history_before_sha256) === JSON.stringify(wire.provenance.history_after_sha256));
  for (const width of [360, 390, 768, 1440]) for (const theme of ['light', 'dark']) {
    const name = `history/${width}/${theme}`, run = await fixture(width, theme);
    await run.page.getByRole('heading', { name: 'Phiên gần đây' }).waitFor(); await ownQuestions(run, name); await snapshot(run, name);
    const bankNames = await run.page.locator('.pg-bank__name').allTextContents();
    const recentNames = await run.page.locator('td[data-label="Bộ"]').allTextContents();
    const rows = await run.page.locator('.pg-sess tbody tr').allTextContents();
    check(`${name}: frozen titles and unchanged saved session results`, bankNames.every((text, index) => text.trim() === progress.response.banks[index].title) && recentNames.every((text) => text === 'Quick Check — Present Simple') && rows.every((text, index) => text.includes(`${Math.round(progress.response.recent_sessions[index].accuracy * 100)}%`) && text.includes(progress.response.recent_sessions[index].ended_at.slice(0, 10))));
    const jump = run.page.getByRole('link', { name: 'Lịch sử', exact: true });
    await jump.focus(); await run.page.keyboard.press('Enter'); await run.page.waitForURL('**#lich-su');
    await run.page.goBack(); await run.page.waitForURL((url) => !url.hash);
    await run.page.goForward(); await run.page.waitForURL('**#lich-su');
    await ownQuestions(run, `${name}/BackForward`);
    const reread = run.page.waitForResponse((response) => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/quiz/mistakes');
    await Promise.all([reread, run.page.reload({ waitUntil: 'domcontentloaded' })]);
    await run.page.getByRole('heading', { name: 'Phiên gần đây' }).waitFor(); await ownQuestions(run, `${name}/reload`); await snapshot(run, `${name}/reload`);
    await close(name, run);
  }
  const unavailableRun = await fixture(390, 'dark', true);
  await unavailableRun.page.getByRole('heading', { name: 'Phiên gần đây' }).waitFor();
  await unavailableRun.page.getByText('Chưa tải được câu cần ôn').waitFor();
  check('managed missing-question503 is unavailable/no empty or current substitution', !await unavailableRun.page.getByText('Chưa có câu nào cần ôn').count() && !await unavailableRun.page.locator('.pg-mk').count());
  const retry = unavailableRun.page.getByRole('button', { name: 'Thử lại', exact: true }); await retry.focus(); await unavailableRun.page.keyboard.press('Enter');
  await ownQuestions(unavailableRun, 'history/503/retry');
  check('owned history retry reads mistakes alone and preserves loaded totals', unavailableRun.trace.filter((row) => row.path === progress.path).length === 1 && unavailableRun.trace.filter((row) => row.path === mistakes.path).length === 2);
  await close('history/503/retry', unavailableRun);
} finally {
  await browser.close();
  if (process.env.GRAMMAR_HISTORY_OUTPUT) writeFileSync(process.env.GRAMMAR_HISTORY_OUTPUT, JSON.stringify({ boundary: 'actual built Next progress/mistakes UI; captured owned public backend output; synthetic auth/intercepted GET; no live publication proof', fixture_sha256: createHash('sha256').update(bytes).digest('hex'), provenance: wire.provenance, results, scenarios }, null, 2) + '\n');
}
console.log(`${results.filter((row) => row.ok).length}/${results.length} history checks passed across ${scenarios.length} scenarios`);
if (results.some((row) => !row.ok)) process.exitCode = 1;
