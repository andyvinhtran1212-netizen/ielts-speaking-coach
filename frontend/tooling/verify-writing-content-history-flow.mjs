// Spec0013 rendered Next journeys. Synthetic auth/read fixtures; no live backend.
// Reuses the supplied Next server, including CI's TEST_PORT; owns no server/.next.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
const base = new URL(process.argv[2] || 'http://127.0.0.1:3113');
if (base.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
  || base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw new Error('Loopback Next origin required');
const API = 'https://api.writing-content.invalid', USER = '11111111-1111-4111-8111-111111111111';
const TIP = '22222222-2222-4222-8222-222222222222', OTHER = '33333333-3333-4333-8333-333333333333';
const PROMPT = '44444444-4444-4444-8444-444444444444';
const routePath = '/writing/dashboard';
const tips = [
  ...Array.from({ length: 24 }, (_, i) => ({ id: `library-${i}`, title: `Library tip ${i}`, body_markdown: 'Library content.', task_type: 'task_2', content_type: 'tip', type_data: {} })),
  { id: TIP, title: 'Canonical Task 2 tip', body_markdown: 'Canonical tip body with [a reference](https://example.test/reference).', task_type: 'task_2', content_type: 'tip', type_data: {} },
  { id: OTHER, title: 'Canonical Task 1 knowledge', body_markdown: 'Different canonical body.', task_type: 'task_1', content_type: 'knowledge', type_data: {} },
];
const prompts = [{ id: PROMPT, title: 'Canonical prompt', prompt_text: 'Canonical prompt body: discuss learning.', task_type: 'task2', difficulty: 'medium' }];
let total = 0;
function check(name, result = true) { assert.ok(result, name); console.log(`PASS ${++total}: ${name}`); }
async function launch() {
  try { return await chromium.launch(); } catch (error) {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome });
    throw error;
  }
}
const browser = await launch();
async function fixture(options = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
  const state = { tips: structuredClone(tips), prompts: structuredClone(prompts), enabled: true,
    status: 200, hold: null, calls: [], unexpected: [], errors: [] };
  await context.addInitScript(({ user }) => {
    let callback, account = user;
    const session = () => account ? { access_token: 'synthetic-writing-content', user: { id: account, email: 'synthetic@example.test' } } : null;
    window.__AVER_SUPABASE_CLIENT__ = { auth: { getSession: async () => ({ data: { session: session() } }),
      onAuthStateChange(fn) { callback = fn; return { data: { subscription: { unsubscribe() {} } } }; } } };
    window.__writingChangeAccount = (id) => { account = id; callback?.(id ? 'SIGNED_IN' : 'SIGNED_OUT', session()); };
    window.__writingPageShows = [];
    window.addEventListener('pageshow', event => window.__writingPageShows.push({ persisted: event.persisted, url: location.href }));
  }, { user: USER });
  const cors = { 'access-control-allow-origin': base.origin, 'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-core-operation-id' };
  const reply = (data, status = 200) => ({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(data) });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    if (url.origin === base.origin) {
      if (url.pathname === '/__writing-before') return route.fulfill({ contentType: 'text/html', body: '<title>Before</title><p>Unrelated previous document</p>' });
      if (url.pathname === '/js/runtime-config.js') return route.fulfill({ contentType: 'application/javascript',
        body: `window.__AVER_RUNTIME_CONFIG__=Object.freeze(${JSON.stringify({ environment: 'test', apiBase: API,
          writingAdmissionEnabled: false, coreOperationCorrelationEnabled: false,
          supabaseUrl: 'https://writingcontentfixture.supabase.co', supabaseAnonKey: 'fixture-only' })});` });
      if (method === 'GET' && (url.pathname === routePath || url.pathname === '/login'
        || /^\/(?:_next\/|__nextjs_font\/|js\/|css\/|assets\/|vendor\/)/.test(url.pathname) || url.pathname === '/favicon.ico')) return route.continue();
    }
    if (url.origin === 'https://fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' });
    if (url.origin === API || (url.origin === 'http://127.0.0.1:3999' && ['/api/analytics/events', '/api/error-logs'].includes(url.pathname))) {
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      state.calls.push({ method, path: url.pathname, body: req.postDataJSON() });
      if (method === 'POST' && ['/api/analytics/events', '/api/error-logs'].includes(url.pathname)) return route.fulfill({ status: 204, headers: cors });
      if (method === 'GET') {
        if (url.pathname === '/auth/me') return route.fulfill(reply({ id: USER, role: 'student', is_active: true }));
        if (url.pathname === '/api/student/permissions') return route.fulfill(reply({ writing: options.permitted !== false }));
        if (url.pathname === '/api/writing/my-assignments') return route.fulfill(reply({ assignments: [], student: {} }));
        if (url.pathname === '/api/writing/my-essays') return route.fulfill(reply({ essays: [] }));
        if (url.pathname === '/api/writing/tips') {
          if (state.hold) await state.hold;
          return route.fulfill(reply(state.status === 200 ? { tips: state.tips } : { detail: 'Synthetic unavailable' }, state.status)).catch(() => {});
        }
        if (url.pathname === '/api/writing/prompt-bank') return route.fulfill(reply({ enabled: state.enabled, prompts: state.enabled ? state.prompts : [] }));
      }
    }
    state.unexpected.push(`${method} ${url.origin}${url.pathname}`);
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.on('pageerror', err => state.errors.push(err.message));
  const go = (search = '?tab=tips') => page.goto(new URL(routePath + search, base).href);
  const modal = page.locator('#tip-modal');
  const ready = () => modal.waitFor({ state: 'visible' }).then(() => page.waitForFunction(() => document.getElementById('tip-modal')?.dataset.contentState === 'ready'));
  const closed = () => modal.waitFor({ state: 'hidden' });
  const contentEvents = () => state.calls.filter(call => ['writing_tip_view', 'prompt_bank_view'].includes(call.body?.event_name));
  const noWrites = () => check('FR006: zero submission/admission/grading/AI requests', state.calls.every(call => call.method === 'GET'
    || ['/api/analytics/events', '/api/error-logs'].includes(call.path)));
  const finish = async () => { noWrites(); assert.deepEqual(state.unexpected, []); assert.deepEqual(state.errors, []); await context.close(); };
  return { context, page, state, go, modal, ready, closed, contentEvents, finish };
}
try {
  {
    const f = await fixture({ permitted: false }); await f.page.goto(new URL('/__writing-before', base).href); await f.go();
    const card = f.page.locator(`[data-tip-id="${TIP}"]`); await card.waitFor();
    await f.page.locator('[data-tip-filter="task_2"]').click();
    const before = await f.page.evaluate(() => history.length);
    await card.focus(); const libraryScroll = await f.page.evaluate(() => scrollY);
    await f.page.keyboard.press('Enter'); await f.ready();
    check('FR001/004: canonical tip remains readable with Writing submit permission false', await f.modal.getByText('Canonical Task 2 tip').count() === 1);
    check('FR002: exactly one dialog entry', await f.page.evaluate(() => history.length) === before + 1);
    check('FR005: immediate initial focus inside shared dialog', await f.page.evaluate(() => document.activeElement?.id === 'tip-modal-close'));
    check('FR005: background inert and hidden to accessibility tree', await f.page.locator('main.shell').evaluate(el => el.inert && el.getAttribute('aria-hidden') === 'true'));
    await f.page.keyboard.press('Shift+Tab');
    check('FR005: Shift+Tab stays inside dialog', await f.page.evaluate(() => !!document.activeElement?.closest('#tip-modal')));
    await f.page.keyboard.press('Tab'); await f.page.keyboard.press('Tab');
    check('FR005: Tab wraps inside dialog', await f.page.evaluate(() => !!document.activeElement?.closest('#tip-modal')));
    await card.evaluate(el => { el.click(); el.click(); });
    check('FR002: repeated same item adds neither entry nor view analytics', await f.page.evaluate(() => history.length) === before + 1 && f.contentEvents().length === 1);
    const currentTipCard = await card.elementHandle();
    await f.page.goBack(); await f.closed();
    await f.page.waitForFunction(el => !el.isConnected, currentTipCard);
    await f.page.waitForFunction(id => document.activeElement?.getAttribute('data-tip-id') === id, TIP);
    check('FR002/007: Back restores filtered library and activating card focus', f.page.url().endsWith('?tab=tips')
      && await f.page.locator('[data-tip-filter="task_2"]').evaluate(el => el.classList.contains('is-active'))
      && await f.page.evaluate(id => document.activeElement?.getAttribute('data-tip-id') === id, TIP));
    check('FR007: owned Back retains substantial library scroll', libraryScroll > 100
      && Math.abs(await f.page.evaluate(() => scrollY) - libraryScroll) < 3);
    await f.page.goForward(); await f.ready();
    check('FR002/006: Forward restores canonical item without analytics', f.contentEvents().length === 1);
    await f.page.reload(); await f.ready();
    await f.modal.locator('#tip-modal-close').click(); await f.closed();
    check('FR003: owned marker survives actual reload and close returns parent', f.page.url().endsWith('?tab=tips'));
    await f.page.locator('#tab-prompt-bank').click();
    await f.page.locator(`[data-pb-id="${PROMPT}"]`).click(); await f.ready();
    check('FR005: prompt uses same dialog with its own canonical body and query', await f.modal.getByText(/Canonical prompt body/).count() === 1 && f.page.url().includes('&prompt='));
    const currentPromptCard = await f.page.locator(`[data-pb-id="${PROMPT}"]`).elementHandle();
    await f.page.keyboard.press('Escape'); await f.closed();
    await f.page.waitForFunction(el => !el.isConnected, currentPromptCard);
    await f.page.waitForFunction(id => document.activeElement?.getAttribute('data-pb-id') === id, PROMPT);
    check('FR003/005: shared Escape closes prompt and restores prompt trigger', await f.page.evaluate(id => document.activeElement?.getAttribute('data-pb-id') === id, PROMPT));
    await f.page.goBack(); await f.page.waitForURL('**/__writing-before');
    check('FR002: second Back follows original document history');
    await f.finish();
  }
  {
    const f = await fixture(); await f.page.goto(new URL('/__writing-before', base).href);
    await f.go(`?tab=tips&tip=${TIP}`); await f.ready(); await f.page.reload(); await f.ready();
    await f.modal.locator('#tip-modal-close').click(); await f.closed();
    check('FR003: direct-link reload close replaces instead of leaving previous document', f.page.url().endsWith('?tab=tips'));
    check('FR003/006: deep-link/reload has no explicit view analytics', f.contentEvents().length === 0);
    await f.go(`?tab=tips&tip=${TIP}`); await f.ready();
    await f.page.evaluate(() => history.replaceState({ ...history.state, averWritingContentV1: { version: 1, parent: 'https://evil.invalid/' } }, '', location.href));
    await f.modal.locator('#tip-modal-backdrop').click({ position: { x: 2, y: 2 } }); await f.closed();
    check('FR003: damaged owner + backdrop close uses fixed library replacement', f.page.url().endsWith('?tab=tips'));
    for (const damage of ['missing', 'mismatched']) {
      await f.go('?tab=tips');
      await f.page.locator(`[data-tip-id="${TIP}"]`).click(); await f.ready();
      await f.page.evaluate(damage => {
        const state = { ...history.state };
        if (damage === 'missing') delete state.averWritingLibraryV1;
        else state.averWritingLibraryV1 = { ...state.averWritingLibraryV1, id: 'another-entry' };
        history.replaceState(state, '', location.href);
      }, damage);
      await f.page.reload(); await f.ready();
      await f.page.evaluate(() => { const nativeBack = history.back.bind(history); window.__writingBackCalls = 0;
        history.back = () => { window.__writingBackCalls++; nativeBack(); }; });
      await f.modal.locator('#tip-modal-close').click(); await f.closed();
      check(`FR003: owned-open reload with ${damage} library marker replaces without Back`,
        f.page.url().endsWith('?tab=tips') && await f.page.evaluate(() => window.__writingBackCalls === 0 && !history.state.averWritingContentV1));
    }
    await f.finish();
  }
  {
    const f = await fixture();
    for (const search of [`?tab=tips&tab=tips&tip=${TIP}`, `?tab=tips&tip=${TIP}&tip=${TIP}`,
      `?tab=tips&tip=${TIP}&prompt=${PROMPT}`, `?tip=${TIP}`, '?tab=tips&tip=',
      `?tab=essays&tip=${TIP}`, `?tab=tips&tip=${TIP}&assignment_id=`,
      `?tab=tips&tip=${TIP}&assignment_id=&assignment_id=other`]) {
      await f.go(search); await f.page.waitForFunction(() => typeof window.api?.get === 'function');
      await f.page.waitForFunction(() => document.getElementById('assignments-list')?.textContent === '');
      await f.closed();
      check(`FR001: invalid/suppressed selectors stay closed ${search}`, new URL(f.page.url()).search === search);
    }
    await f.finish();
  }
  {
    const f = await fixture(); let release;
    f.state.hold = new Promise(resolve => { release = resolve; });
    await f.go(`?tab=tips&tip=${TIP}`); await f.modal.waitFor({ state: 'visible' });
    check('FR004/005: pending read has labeled focused usable close', await f.modal.getByRole('button', { name: 'Đóng', exact: true }).count() === 1);
    await f.page.keyboard.press('Escape'); await f.closed(); release();
    await f.page.locator(`[data-tip-id="${TIP}"]`).waitFor();
    check('FR004: late read after close cannot reopen', await f.modal.isHidden());
    f.state.hold = null;
    f.state.status = 500; await f.go(`?tab=tips&tip=${TIP}`);
    await f.page.waitForFunction(() => document.getElementById('tip-modal')?.dataset.contentState === 'error');
    check('FR004: failed canonical read is explicit and closable', await f.modal.getByText(/Không tải được nội dung/).count() === 1);
    f.state.status = 200; f.state.tips = []; await f.go(`?tab=tips&tip=${TIP}`);
    await f.page.waitForFunction(() => document.getElementById('tip-modal')?.dataset.contentState === 'missing');
    check('FR004: deleted/unpublished item never reuses old body', await f.modal.getByText(/không còn được cung cấp/).count() === 1);
    f.state.enabled = false; await f.go(`?tab=prompt-bank&prompt=${PROMPT}`);
    await f.page.waitForFunction(() => document.getElementById('tip-modal')?.dataset.contentState === 'unavailable');
    check('FR004: disabled prompt bank is explicit and closable', await f.modal.getByText(/chưa được bật/).count() === 1);
    f.state.tips = [{ id: TIP, title: 'Malformed no body' }]; await f.go(`?tab=tips&tip=${TIP}`);
    await f.page.waitForFunction(() => document.getElementById('tip-modal')?.dataset.contentState === 'error');
    check('FR004: malformed payload is fail closed');
    await f.finish();
  }
  {
    const f = await fixture(); await f.go();
    const card = f.page.locator(`[data-tip-id="${TIP}"]`); await card.waitFor();
    const oldCard = await card.elementHandle();
    let release;
    f.state.hold = new Promise(resolve => { release = resolve; });
    await card.click(); await f.modal.waitFor({ state: 'visible' });
    const before = await f.page.evaluate(() => ({ url: location.href, state: JSON.stringify(history.state) }));
    // Compatibility owner fixture: exercise actual native DOM visibility later,
    // without calling admission or fabricating a business submission request.
    await f.page.evaluate(() => new Promise(resolve => setTimeout(() => {
      document.getElementById('modal-essay-textarea').value = 'Existing owner workspace';
      document.getElementById('submit-modal').classList.remove('hidden');
      resolve();
    }, 0)));
    await f.closed();
    check('FR001/004/005: delayed existing submit DOM owner takes focus and releases background', await f.page.evaluate(() =>
      !document.getElementById('submit-modal').inert && !document.querySelector('main.shell').inert
      && document.activeElement?.id === 'modal-close' && document.getElementById('tip-modal-body').textContent === ''));
    check('FR001/006: content yield preserves submit workspace, URL and history owner', await f.page.evaluate(before =>
      document.getElementById('modal-essay-textarea').value === 'Existing owner workspace'
      && location.href === before.url && JSON.stringify(history.state) === before.state, before));
    release(); f.state.hold = null;
    await f.page.waitForFunction(el => !el.isConnected, oldCard);
    check('FR004: pending content response cannot reopen above delayed submit owner', await f.modal.isHidden()
      && await f.page.locator('#submit-modal').isVisible());
    await f.finish();
  }
  {
    const f = await fixture();
    f.state.tips.find(item => item.id === TIP).title = '   ';
    await f.go(`?tab=tips&tip=${TIP}`); await f.ready();
    check('FR005: canonical blank tip title keeps a nonempty accessible dialog label', await f.page.getByRole('dialog', { name: 'Mẹo viết', exact: true }).count() === 1);
    f.state.prompts[0].title = '';
    await f.go(`?tab=prompt-bank&prompt=${PROMPT}`); await f.ready();
    check('FR005: canonical blank prompt title keeps a nonempty accessible dialog label', await f.page.getByRole('dialog', { name: 'Đề bài', exact: true }).count() === 1);
    await f.finish();
  }
  {
    const f = await fixture(); await f.go(`?tab=tips&tip=${TIP}`); await f.ready();
    let release;
    f.state.hold = new Promise(resolve => { release = resolve; });
    f.state.tips = tips.map(item => ({ ...item, title: item.id === TIP ? 'New account canonical tip' : item.title }));
    await f.page.evaluate(() => window.__writingChangeAccount('77777777-7777-4777-8777-777777777777'));
    await f.page.waitForFunction(() => document.getElementById('tip-modal')?.dataset.contentState === 'loading');
    check('FR004: account switch clears previous body before pending canonical read', await f.modal.getByText('Canonical Task 2 tip').count() === 0);
    release(); f.state.hold = null;
    await f.ready();
    check('FR004: new account refetches canonical body', f.state.calls.filter(call => call.path === '/api/writing/tips').length >= 2
      && await f.modal.getByText('New account canonical tip').count() === 1);
    await f.page.evaluate(() => window.__writingChangeAccount(null));
    await f.page.waitForURL('**/login');
    check('FR004: logout removes read-only dialog and follows existing auth owner');
    await f.finish();
  }
  {
    const f = await fixture(); await f.go(`?tab=tips&tip=${TIP}`); await f.ready();
    for (const width of [360, 390, 768, 1440]) {
      await f.page.setViewportSize({ width, height: 900 });
      for (const theme of ['light', 'dark']) {
        await f.page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
        await f.page.emulateMedia({ reducedMotion: 'reduce' });
        check(`FR007: ${width}px ${theme}, reduced motion, contained and usable close`, await f.page.evaluate(() => {
          const panel = document.querySelector('.wd-tip-modal__panel').getBoundingClientRect();
          const close = document.getElementById('tip-modal-close').getBoundingClientRect();
          return document.documentElement.scrollWidth <= innerWidth && panel.left >= 0 && panel.right <= innerWidth
            && close.width >= 44 && close.height >= 44;
        }));
      }
    }
    await f.page.goto(new URL('/__writing-before', base).href); await f.page.goBack(); await f.ready();
    check('FR003/004: document Back recreates/restores canonical deep link safely', f.page.url().includes('&tip='));
    console.log('DOCUMENT_RESTORE', JSON.stringify(await f.page.evaluate(() => ({ navigation: performance.getEntriesByType('navigation')[0]?.type, pageshows: window.__writingPageShows }))));
    await f.finish();
  }
  console.log(`Writing content history: ${total}/${total} PASS. Synthetic local browser evidence; native mobile/VoiceOver and live staging remain separate gates.`);
} finally { await browser.close(); }
