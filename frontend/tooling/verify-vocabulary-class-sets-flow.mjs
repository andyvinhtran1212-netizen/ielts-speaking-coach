// Next-native fixture journey. Unknown requests fail closed; no hosted writes.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { storageKey } from './supabase-session.mjs';

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
const errors = []; const unhandled = []; const requests = [];
let browser;
try { browser = await chromium.launch(); } catch (e) {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (!existsSync(chrome)) throw e;
  browser = await chromium.launch({ executablePath: chrome });
}
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
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
    unhandled.push(`${method} ${url.origin}${p}`); return json({ detail:'unhandled fixture' },404);
  });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base+'/vocabulary/hub');
  await page.getByRole('heading',{name:'Học từ vựng',exact:true}).waitFor();
  assert.equal(await page.getByRole('navigation',{name:'Điều hướng từ vựng'}).getByRole('link').count(),4);
  await page.goto(base+'/exercises');
  await page.getByRole('heading',{name:'Đến hạn ôn',exact:true}).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('view'),'review');
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
      await page.getByRole('button',{name:'Lật thẻ xem nghĩa'}).focus(); await page.keyboard.press('Enter');
      await page.getByRole('button',{name:'Nhớ',exact:true}).focus(); await page.keyboard.press('Enter');
    }
    else { await page.getByRole('textbox').fill('acquire'); await page.getByRole('button',{name:mode==='test'?'Nộp bài kiểm tra':'Kiểm tra và lưu',exact:true}).click(); if (mode!=='test') await page.getByRole('button',{name:'Xem kết quả',exact:true}).click(); }
    await page.getByRole('heading',{name:'Phiên học đã hoàn tất'}).waitFor();
    await page.reload(); await page.getByRole('heading',{name:'Phiên học đã hoàn tất'}).waitFor();
    await page.getByRole('link',{name:'Trở về bộ từ',exact:false}).click();
  }
  await page.goto(base+`/admin/vocab/sets/${set.id}`);
  await page.getByRole('textbox',{name:'Tên bộ',exact:true}).fill('Education · C2 revised');
  await page.getByRole('button',{name:'Lưu và xuất bản',exact:true}).click();
  await page.getByText('Đã xuất bản.',{exact:false}).waitFor();
  await page.reload(); assert.equal(await page.getByRole('textbox',{name:'Tên bộ',exact:true}).inputValue(),'Education · C2 revised');
  for (const width of [1280,400,320]) for (const theme of ['light','dark']) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(t => document.documentElement.setAttribute('data-theme',t),theme);
    for (const path of ['/vocabulary/hub',`/vocabulary/sets/${set.id}`,`/admin/vocab/sets/${set.id}`]) {
      await page.goto(base+path); await page.locator('h1').first().waitFor();
      await page.evaluate(t => document.documentElement.setAttribute('data-theme',t),theme);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth),`no overflow ${width}/${theme}/${path}`);
    }
  }
  await page.goto(base+'/vocabulary/hub'); await page.getByRole('heading',{name:'Học từ vựng',exact:true}).waitFor();
  await page.setViewportSize({width:1280,height:900});
  await page.screenshot({ path:'/private/tmp/vocabulary-class-sets-desktop.png',fullPage:true });
  await page.setViewportSize({width:400,height:900});
  await page.screenshot({ path:'/private/tmp/vocabulary-class-sets-mobile.png',fullPage:true });
  assert.deepEqual(unhandled,[], 'unhandled fixture requests'); assert.deepEqual(errors,[], 'browser runtime errors');
  assert.equal(requests.filter(r=>r.method==='POST'&&r.p.endsWith('/publication')).length,1);
  console.log('PASS: hub → set → all four modes → resume/result reload; admin publication/reload; 320/400/1280px, light/dark; no overflow or runtime errors.');
} finally { await browser.close(); }
