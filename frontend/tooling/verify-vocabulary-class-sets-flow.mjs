// Next-native fixture journey. Unknown requests fail closed; no hosted writes.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { storageKey } from './supabase-session.mjs';
import { stubAdminMfaStatus } from './admin-mfa-stub.mjs';

const base = process.argv[2] || 'http://127.0.0.1:3017';
assert.ok(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base), 'loopback Next only');
const sb = 'https://example.supabase.co';
const actor = '10000000-0000-4000-8000-000000000020';
const course = '20000000-0000-4000-8000-000000000020';
const card = { id: '30000000-0000-4000-8000-000000000020', headword: 'acquire', slug: 'acquire', category: 'education',
  gloss_vi: 'tiếp thu', definition_en: '', pronunciation: '/əˈkwaɪə/', part_of_speech: 'v', level: 'B2',
  example: 'We acquire skills.', audio_headword: '', audio_example: '' };
let set = { id: '40000000-0000-4000-8000-000000000020', title: 'Education · C2', description: 'Bộ từ do giáo viên chuẩn bị',
  status: 'published', version: 2, published_revision: 1, library: false, course_ids: [course], cohort_ids: [], card_ids: [card.id], cards: [card],
  progress: [], mode_counts: { flashcards: 1, learn: 1, cloze: 1, test: 1 } };
const sessions = new Map();
// PC-J253: a green run takes well under a minute. Any failure (or a stall past 3 min) prints
// the last step, URL, recent API requests, unhandled requests, page errors and
// the page text before exiting 1.
const guard = createFlowWatchdog({ name: 'verify-vocabulary-class-sets-flow', totalMs: 3 * 60_000 });
const errors = []; const unhandled = []; const requests = [];
let browser;
try { browser = await chromium.launch(); } catch (e) {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (!existsSync(chrome)) throw e;
  browser = await chromium.launch({ executablePath: chrome });
}
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', bypassCSP: true });
  await context.addInitScript(([key, session]) => {
    localStorage.setItem(key, JSON.stringify(session)); localStorage.setItem('av-theme', 'light');
  }, [storageKey(sb), { access_token: 'fixture-not-a-real-token', refresh_token: 'fixture', expires_at: Math.floor(Date.now()/1000)+3600,
    token_type: 'bearer', expires_in: 3600, user: { id: actor, email: 'vocab-fixture@local.test' } }]);
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === base && url.pathname === '/js/runtime-config.js') return route.fulfill({ contentType: 'text/javascript', body:
      `window.__AVER_RUNTIME_CONFIG__=Object.freeze(${JSON.stringify({environment:'test',apiBase:'http://127.0.0.1:3999',supabaseUrl:sb,supabaseAnonKey:'test-anon-key',release:null,gitRef:null,coreOperationCorrelationEnabled:false,writingAdmissionEnabled:false})});` });
    if (url.origin === base || url.protocol === 'data:') return route.continue();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const p = url.pathname; const method = req.method(); let body = {};
    try { body = req.postDataJSON() || {}; } catch {}
    requests.push({ p, method, body });
    guard.recordRequest(req);
    if (method === 'OPTIONS') return json({});
    if (p === '/auth/me') return json({ id: actor, email: 'vocab-fixture@local.test', role: 'admin', display_name: 'Fixture', flashcard_enabled: true, d1_enabled: true, vocab_curated_enabled: false });
    if (p === '/auth/check-active') return json({ is_active: true });
    if (p === '/auth/profile' || p === '/auth/v1/user') return json({ id: actor, role: 'admin', email: 'vocab-fixture@local.test' });
    if (p === '/api/student/home-summary') return json({ skills: { vocabulary: { wallet_words: 68, quiz_words_mastered: 0, quiz_sessions: 0 } } });
    if (p === '/api/vocabulary/categories') return json([{ slug: 'education', title: 'Education', article_count: 1, topic_id: course }]);
    if (/^\/api\/(analytics\/events|error-logs)$/.test(p)) return json({ ok: true });
    const catalog = () => ({ sets: [set], courses: [{ id: course, name: 'Khóa C2' }], cohorts: [], sessions: [...sessions.values()].map(s => ({ id:s.id,set_id:s.set_id,title:s.title,mode:s.mode,completed:s.completed,answered:s.answers.length,total:1,correct:s.correct,created_at:new Date().toISOString() })) });
    if (p === '/admin/vocabulary-sets' || p === '/api/vocabulary-sets') return json(catalog());
    if (p === '/admin/vocabulary-sets/cards') return json(method === 'GET' ? { cards: [card] } : card);
    if (/^\/admin\/vocabulary-sets\/[^/]+\/outcomes$/.test(p)) return json({ learners: [] });
    if (/^\/admin\/vocabulary-sets\/[^/]+\/publication$/.test(p)) {
      assert.equal(body.expected_version, set.version);
      set = { ...set, version: set.version+1, status: body.action === 'archive' ? 'archived' : 'published', published_revision: set.published_revision+1 };
      return json(set);
    }
    if (/^\/(admin|api)\/vocabulary-sets\/[^/]+$/.test(p)) {
      if (method === 'POST') { set = { ...set, ...body, id:p.split('/').at(-1), version:set.version+1 }; }
      return json(set);
    }
    if (/^\/api\/vocabulary-sets\/[^/]+\/sessions$/.test(p)) {
      const s = { id:body.client_id,set_id:set.id,title:set.title,revision:set.published_revision,mode:body.mode,
        items:[{ card_id:card.id,prompt:body.mode==='cloze'?'We ____ skills.':body.mode==='flashcards'?'acquire':'tiếp thu',card:body.mode==='flashcards'?card:null }],
        answers:[],completed:false,correct:null };
      sessions.set(s.id,s); return json(s);
    }
    const m = p.match(/^\/api\/vocabulary-sets\/sessions\/([^/]+)(?:\/(answers|submit))?$/);
    if (m) {
      const s = sessions.get(m[1]); if (!s) return json({ detail:'missing' },404);
      if (method === 'POST') {
        const answer = m[2] === 'submit' ? body.answers[0] : body.answer;
        const correct = s.mode==='flashcards'?null:answer.trim().toLowerCase()==='acquire';
        s.answers=[{index:0,answer,expected:'acquire',correct,rating:body.rating||null}]; s.completed=true; s.correct=correct===null?null:correct?1:0; s.items[0].card=card;
      }
      return json(s);
    }
    unhandled.push(`${method} ${url.origin}${p}`); guard.recordUnhandled(`${method} ${url.origin}${p}`); return json({ detail:'unhandled fixture' },404);
  });
  await stubAdminMfaStatus(context);
  const page = await context.newPage(); page.on('pageerror', e => errors.push(String(e)));
  guard.watchPage(page);
  await page.goto(base+'/vocabulary/hub');
  await page.getByRole('heading',{name:'Học từ vựng',exact:true}).waitFor();
  assert.equal(await page.getByRole('navigation',{name:'Điều hướng từ vựng'}).getByRole('link').count(),4);
  guard.passed('hub renders four vocabulary nav links');
  await page.goto(base+'/exercises');
  await page.getByRole('heading',{name:'Đến hạn ôn',exact:true}).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('view'),'review');
  guard.passed('/exercises lands on the review view');
  await page.goto(base+'/vocabulary/hub');
  await page.getByRole('heading',{name:'Học từ vựng',exact:true}).waitFor();
  await page.getByRole('link',{name:'Bộ từ',exact:true}).click();
  await page.getByRole('link',{name:'Mở bộ từ',exact:false}).click();
  await page.getByRole('heading',{name:'Chọn cách học'}).waitFor();
  for (const [mode,label] of [['flashcards','thẻ ghi nhớ'],['learn','luyện nhớ'],['cloze','điền từ theo ngữ cảnh'],['test','kiểm tra']]) {
    await page.getByRole('button',{name:`Bắt đầu ${label}`,exact:true}).click();
    await page.getByText('Đã lưu 0/1',{exact:false}).waitFor();
    const path = page.url(); await page.reload();
    await page.getByText('Đã lưu 0/1',{exact:false}).waitFor(); assert.equal(page.url(),path);
    if (mode==='flashcards') {
      assert.equal(await page.getByRole('button',{name:'Nghe phát âm từ',exact:true}).count(),1);
      assert.equal(await page.getByRole('button',{name:'Nghe câu ví dụ',exact:true}).count(),1);
      await page.getByRole('button',{name:'Lật thẻ xem nghĩa'}).focus(); await page.keyboard.press('Enter');
      await page.getByRole('button',{name:'Nhớ',exact:true}).focus(); await page.keyboard.press('Enter');
    }
    else { await page.getByRole('textbox').fill('acquire'); await page.getByRole('button',{name:mode==='test'?'Nộp bài kiểm tra':'Kiểm tra và lưu',exact:true}).click(); if (mode!=='test') await page.getByRole('button',{name:'Xem kết quả',exact:true}).click(); }
    await page.getByRole('heading',{name:'Phiên học đã hoàn tất'}).waitFor();
    await page.reload(); await page.getByRole('heading',{name:'Phiên học đã hoàn tất'}).waitFor();
    await page.getByRole('link',{name:'Trở về bộ từ',exact:false}).click();
    guard.passed(`mode ${mode}: start, resume, result reload`);
  }
  await page.goto(base+`/admin/vocab/sets/${set.id}`);
  await page.getByRole('textbox',{name:'Tên bộ',exact:true}).fill('Education · C2 revised');
  await page.getByRole('button',{name:'Lưu và xuất bản',exact:true}).click();
  await page.getByText('Đã xuất bản.',{exact:false}).waitFor();
  await page.reload(); assert.equal(await page.getByRole('textbox',{name:'Tên bộ',exact:true}).inputValue(),'Education · C2 revised');
  guard.passed('admin publication survives reload');
  for (const width of [1280,400,320]) for (const theme of ['light','dark']) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(t => document.documentElement.setAttribute('data-theme',t),theme);
    for (const path of ['/vocabulary/hub',`/vocabulary/sets/${set.id}`,`/admin/vocab/sets/${set.id}`]) {
      await page.goto(base+path); await page.locator('h1').first().waitFor();
      await page.evaluate(t => document.documentElement.setAttribute('data-theme',t),theme);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth),`no overflow ${width}/${theme}/${path}`);
      guard.passed(`no overflow ${width}/${theme}/${path}`);
    }
  }
  await page.goto(base+'/vocabulary/hub'); await page.getByRole('heading',{name:'Học từ vựng',exact:true}).waitFor();
  await page.setViewportSize({width:1280,height:900});
  await page.screenshot({ path:join(tmpdir(),'vocabulary-class-sets-desktop.png'),fullPage:true });
  await page.setViewportSize({width:400,height:900});
  await page.screenshot({ path:join(tmpdir(),'vocabulary-class-sets-mobile.png'),fullPage:true });
  assert.deepEqual(unhandled,[], 'unhandled fixture requests'); assert.deepEqual(errors,[], 'browser runtime errors');
  assert.equal(requests.filter(r=>r.method==='POST'&&r.p.endsWith('/publication')).length,1);
  console.log('PASS: hub → set → all four modes → resume/result reload; admin publication/reload; 320/400/1280px, light/dark; no overflow or runtime errors.');
  guard.stop();
} catch (error) {
  await guard.fail(String(error?.stack || error));
} finally { await browser.close(); }

// PC-J253 — fail-fast guard. The same copy is in verify-d1-exercise-flow.mjs
// and verify-vocabulary-class-sets-flow.mjs: a new imported tooling module
// must be listed in next-native-browser.yml `paths` (workflow-path-coverage).
// It bounds every awaited fixture signal and the whole script; on failure it
// prints the last passed check, the awaited label, the URL, recent API
// requests (token class only, never the token), unhandled fixture requests,
// page/console errors and 2 kB of the page text, then exits 1.
function createFlowWatchdog({ name, totalMs, waitMs = 15_000 }) {
  const startedAt = Date.now();
  const requests = [];
  const unhandled = [];
  const pageErrors = [];
  let page = null;
  let lastCheck = '(none)';
  let waitingFor = '(none)';
  let failing = false;
  const tokenClass = (authorization) => {
    if (!authorization) return 'none';
    const known = String(authorization).replace(/^Bearer\s+/i, '').match(/^(fixture|refreshed|foreign)(?:-|$)/);
    return known ? known[1] : 'other';
  };
  const bounded = (read, fallback) => {
    let timer;
    return Promise.race([
      Promise.resolve().then(read).catch((error) => `${fallback}: ${String(error?.message || error).split('\n')[0]}`),
      new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), 5_000); }),
    ]).finally(() => clearTimeout(timer));
  };
  async function fail(reason) {
    if (failing) return new Promise(() => {});
    failing = true;
    const lines = [
      `✗ ${name}: ${reason}`,
      `  elapsed: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
      `  last passed check: ${lastCheck}`,
      `  waiting for: ${waitingFor}`,
      `  url: ${page ? await bounded(() => page.url(), '(url unavailable)') : '(no page)'}`,
      '  last 30 API requests (method path · x-request-id · token):',
      ...requests.slice(-30).map((entry) => `    ${entry}`),
      `  unhandled fixture requests: ${unhandled.length ? unhandled.join(', ') : '(none)'}`,
      `  page errors / console errors: ${pageErrors.length ? '' : '(none)'}`,
      ...pageErrors.slice(-20).map((entry) => `    ${entry}`),
    ];
    if (page) {
      const text = await bounded(() => page.evaluate(() => document.body?.innerText ?? '(no body)'), '(body unavailable)');
      lines.push('  document.body.innerText (first 2000 chars):');
      lines.push(...String(text).slice(0, 2_000).split('\n').map((line) => `    | ${line}`));
    }
    console.log(lines.join('\n'));
    process.exit(1);
    return new Promise(() => {});
  }
  const watchdog = setTimeout(() => { void fail(`watchdog: script exceeded ${Math.round(totalMs / 1000)}s`); }, totalMs);
  watchdog.unref();
  // Playwright timeouts and assertion errors surface as a rejected top-level
  // await; report them with the same diagnostics instead of a bare stack.
  const onCrash = (error) => { void fail(`uncaught error: ${error?.stack || error}`); };
  process.on('uncaughtException', onCrash);
  process.on('unhandledRejection', onCrash);
  return {
    watchPage(target) {
      page = target;
      target.on('pageerror', (error) => pageErrors.push(`pageerror: ${String(error).split('\n')[0]}`));
      target.on('console', (message) => {
        if (message.type() === 'error') pageErrors.push(`console.error: ${message.text().slice(0, 300)}`);
      });
    },
    recordRequest(request) {
      const headers = request.headers();
      requests.push(`${request.method()} ${new URL(request.url()).pathname} · ${headers['x-request-id'] ? 'xrid' : 'no-xrid'} · ${tokenClass(headers.authorization)}`);
      if (requests.length > 120) requests.splice(0, requests.length - 30);
    },
    recordUnhandled(entry) { unhandled.push(entry); },
    passed(checkName) { lastCheck = checkName; },
    /** Await a fixture signal for at most `ms`; on timeout print diagnostics and exit 1. */
    async within(promise, label, ms = waitMs) {
      waitingFor = label;
      let timer;
      try {
        return await Promise.race([
          promise,
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms); }),
        ]);
      } catch (error) {
        return fail(`${label}: ${error?.message || error}`);
      } finally {
        clearTimeout(timer);
        if (waitingFor === label) waitingFor = '(none)';
      }
    },
    fail,
    stop() {
      clearTimeout(watchdog);
      process.off('uncaughtException', onCrash);
      process.off('unhandledRejection', onCrash);
    },
  };
}
