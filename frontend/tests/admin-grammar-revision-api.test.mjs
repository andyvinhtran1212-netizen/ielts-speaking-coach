// Real shared api.js and the owned typed bridge; controlled token/fetch only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { adminGrammarRevisionApi } from '../lib/admin-grammar-revision-api.ts';
const source = readFileSync(new URL('../public/js/api.js', import.meta.url), 'utf8');
const code = 'G-tenses-present-simple';
const body = Object.freeze({ source_markdown: 'raw\r\nsource', expected_revision: 'a'.repeat(64), preview_fingerprint: 'b'.repeat(64), operation_id: '22222222-2222-4222-8222-222222222222' });
const methods = { read: (api) => api.read(code), preview: (api) => api.preview(code, { source_markdown: body.source_markdown, expected_revision: body.expected_revision }), commit: (api) => api.commit(code, body) };
const token = () => ({ data: { session: { access_token: 'fixture-token' } } });
const wait = async (predicate) => { const deadline = Date.now()+5000; while (!predicate()) { if(Date.now()>deadline) throw new Error('Controlled transport boundary not reached'); await new Promise((r)=>setImmediate(r)); } };

for (const [method, call] of Object.entries(methods)) for (const transition of ['active', 'aborted', 'code-render-before-cleanup', 'actor-render-before-cleanup', 'ABA-new-generation']) {
  test(`${method}: fulfilled401 redirects only its active ${transition} owner`, async () => {
    const oldWindow = globalThis.window, controller = new AbortController();
    const owner = { generation: 1, actor: 'a', code }; let current = owner, actor = 'a', currentCode = code, release, fetched = false, redirects = 0;
    const window = { location: { hostname: 'admin-fixture.invalid', pathname: '/admin/vocab/quiz', set href(value) { assert.equal(value, '/login'); redirects++; } }, __AVER_RUNTIME_CONFIG__: { apiBase: 'https://admin-fixture.invalid' }, __AVER_SUPABASE_CLIENT__: { auth: { getSession: async () => token() } } };
    const fetch = (_url, options) => { assert.equal(options.signal, controller.signal); fetched=true; return new Promise((resolve)=>{release=resolve;}); };
    vm.runInNewContext(source,{window,fetch,console}); globalThis.window=window;
    try {
      const api=adminGrammarRevisionApi(controller.signal,()=> current===owner && actor===owner.actor && currentCode===owner.code);
      const pending=call(api); pending.catch(()=>{}); await wait(()=>fetched);
      release(new Response('{"detail":{"message":"synthetic unauthorized"}}',{status:401,headers:{'content-type':'application/json'}}));
      if(transition==='aborted') controller.abort();
      if(transition==='code-render-before-cleanup') currentCode='G-tenses-present-continuous';
      if(transition==='actor-render-before-cleanup') actor='b';
      if(transition==='ABA-new-generation') current={...owner,generation:3};
      await assert.rejects(pending,(e)=>e.status===401); assert.equal(redirects,transition==='active'?1:0);
    } finally { if(oldWindow===undefined) delete globalThis.window; else globalThis.window=oldWindow; }
  });
}

for (const [method, call] of Object.entries(methods)) {
  test(`${method}: delayed token canceled by owner abort never dispatches native business fetch`, async () => {
    const oldWindow=globalThis.window, controller=new AbortController();let release,tokenRequested=false,dispatches=0;
    const window={location:{hostname:'admin-fixture.invalid',pathname:'/admin/vocab/quiz'},__AVER_SUPABASE_CLIENT__:{auth:{getSession:()=>{tokenRequested=true;return new Promise((resolve)=>{release=resolve;});}}}};
    // Model the native fetch AbortSignal boundary, not a fabricated business API.
    const fetch=async (_url,options)=>{assert.equal(options.signal,controller.signal);if(options.signal.aborted) throw new DOMException('Aborted','AbortError');dispatches++;return new Response('{}');};
    vm.runInNewContext(source,{window,fetch,console});globalThis.window=window;
    try {const api=adminGrammarRevisionApi(controller.signal,()=>!controller.signal.aborted);const pending=call(api);pending.catch(()=>{});await wait(()=>tokenRequested);controller.abort();release(token());await assert.rejects(pending,(e)=>e.name==='AbortError');assert.equal(dispatches,0);}
    finally {if(oldWindow===undefined) delete globalThis.window;else globalThis.window=oldWindow;}
  });
  test(`${method}: already-invalid ownership refuses before calling shared transport`, async () => {
    const oldWindow=globalThis.window;let calls=0;
    globalThis.window={api:{getWith:()=>{calls++;},postWith:()=>{calls++;}}};
    try {await assert.rejects(call(adminGrammarRevisionApi(new AbortController().signal,()=>false)),(e)=>e.name==='AbortError');assert.equal(calls,0);}
    finally {if(oldWindow===undefined) delete globalThis.window;else globalThis.window=oldWindow;}
  });
}

test('commit uses authenticated real transport with exact frozen body and unrelated default401 still redirects', async () => {
  const oldWindow=globalThis.window;let sent, redirects=0;
  const window={location:{hostname:'admin-fixture.invalid',pathname:'/admin/vocab/quiz',set href(v){assert.equal(v,'/login');redirects++;}},__AVER_SUPABASE_CLIENT__:{auth:{getSession:async()=>token()}}};
  const fetch=async (_url,options)=>{sent=options;return new Response('{}',{status:200});};
  vm.runInNewContext(source,{window,fetch,console});globalThis.window=window;
  try {await adminGrammarRevisionApi(new AbortController().signal,()=>true).commit(code,body);assert.equal(sent.method,'POST');assert.equal(sent.headers.Authorization,'Bearer fixture-token');assert.deepEqual(JSON.parse(sent.body),body);assert.equal(redirects,0);
    vm.runInNewContext(source,{window,fetch:async()=>new Response('{}',{status:401}),console});assert.equal(await window.api.get('/admin/legacy'),null);assert.equal(redirects,1);
  } finally {if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;}
});
