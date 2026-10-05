import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
registerHooks({ load(url,context,next) { return url.endsWith('/learner-tab-draft-support.mjs') ? {format:'module',shortCircuit:true,source:'export const isLearnerTabPersistenceSupported = () => true;'} : next(url,context); } });
const { createLearnerTabDrafts, clearLearnerTabDraftAccount, LEARNER_DRAFT_KEY } = await import('../lib/learner-tab-drafts.mjs');

function browser() {
  const data = new Map();
  return { name: '', crypto: { randomUUID },
    sessionStorage: { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) }, data };
}
const valid = v => v && Object.keys(v).length === 1 && typeof v.text === 'string';
const handle = (b, scope = 'speaking:practice', getAccountId = () => 'A', version = 'v1') => createLearnerTabDrafts({
  window: b, accountId: 'A', scope, version, validate: valid, getAccountId,
});

test('latest synchronous raw/empty edits survive disposal and returned values have no shared mutation', () => {
  const b = browser(); let h = handle(b);
  h.save({ text: '  câu hỏi\nraw  ' }); h.dispose(); h = handle(b);
  const restored = h.read(); assert.equal(restored.value.text, '  câu hỏi\nraw  ');
  restored.value.text = 'changed'; assert.equal(h.read().value.text, '  câu hỏi\nraw  ');
  h.save({ text: '' }); assert.deepEqual(handle(b).read().value, { text: '' });
  assert.ok(!b.name.includes('câu hỏi'));
});
test('a copied namespace with a fresh tab owner is purged before any domain restore', () => {
  const a = browser(); handle(a).save({ text: 'private' });
  const b = browser(); b.crypto.randomUUID = () => '22222222-2222-4222-8222-222222222222';
  b.sessionStorage.setItem(LEARNER_DRAFT_KEY, a.sessionStorage.getItem(LEARNER_DRAFT_KEY));
  assert.equal(handle(b).read().restored, false); assert.deepEqual(JSON.parse(b.data.get(LEARNER_DRAFT_KEY)).drafts, []);
});
test('unrelated window names remain unchanged and persistence fails explicitly', () => {
  const b = browser(); b.name = 'other application'; const h = handle(b);
  assert.equal(h.save({ text: 'editable' }).status, 'unavailable'); assert.equal(b.name, 'other application'); assert.equal(b.data.size, 0);
});
test('discard and account clearing affect only draft scopes, never retry receipts', () => {
  const b = browser(); b.data.set('speaking-start-receipt', 'keep');
  handle(b).save({ text: 'practice' }); handle(b, 'reading:A').save({ text: 'answer' });
  handle(b).discard(); assert.equal(handle(b, 'reading:A').read().value.text, 'answer');
  clearLearnerTabDraftAccount('A', b); assert.equal(handle(b, 'reading:A').read().value, null); assert.equal(b.data.get('speaking-start-receipt'), 'keep');
});
test('late old-account handles cannot write or discard a new account scope', () => {
  const b = browser(); let current = 'A'; const old = handle(b, 'reading:A', () => current); old.save({ text: 'A' });
  current = 'B'; const next = createLearnerTabDrafts({ window:b, accountId:'B', scope:'reading:A', version:'v1', validate:valid, getAccountId:()=>current });
  next.save({ text:'B' }); assert.equal(old.discard().status,'unavailable'); assert.equal(old.save({ text:'late A' }).status,'unavailable'); assert.equal(next.read().value.text,'B');
});
test('revision and malformed payload refusal clear only the affected scope', () => {
  const b = browser(); handle(b).save({ text:'old' }); handle(b,'reading:A').save({ text:'keep' });
  assert.equal(handle(b, undefined, undefined, 'new').read().reason,'incompatible-cleared');
  assert.equal(handle(b,'reading:A').read().value.text,'keep');
  const v=JSON.parse(b.data.get(LEARNER_DRAFT_KEY)); v.drafts[0].value={text:42}; b.data.set(LEARNER_DRAFT_KEY, JSON.stringify(v));
  assert.equal(handle(b,'reading:A').read().restored,false);
});
test('malformed, denied and quota storage report unsaved while preserving unrelated storage', () => {
  const b=browser(); b.data.set(LEARNER_DRAFT_KEY,'{bad'); b.data.set('other','keep');
  assert.equal(handle(b).read().status,'unavailable'); assert.equal(b.data.get('other'),'keep');
  const denied=browser(); denied.sessionStorage.getItem=()=>{throw Error('denied')}; assert.equal(handle(denied).read().status,'unavailable');
  const quota=browser(); const h=handle(quota); quota.sessionStorage.setItem=()=>{throw Error('quota')}; assert.equal(h.save({text:'editable'}).status,'unavailable');
});
test('full hydrated public revision fingerprints are accepted without a tiny identity cap', () => {
  const b=browser(), version=JSON.stringify({ questions:Array.from({length:100},()=>({prompt:'x'.repeat(100)})) });
  const h=handle(b,'reading:A',()=> 'A',version); assert.equal(h.save({text:'raw'}).status,'ready'); assert.equal(handle(b,'reading:A',()=> 'A',version).read().value.text,'raw');
});

test('logout invalidates old owner even when storage clearing fails, preventing old-handle reads and same-account revival',()=>{const b=browser();const h=handle(b);h.save({text:'private'});const set=b.sessionStorage.setItem;b.sessionStorage.setItem=()=>{throw Error('denied')};assert.equal(clearLearnerTabDraftAccount('A',b).status,'unavailable');assert.equal(b.name,'');assert.equal(h.read().restored,false);b.sessionStorage.setItem=set;assert.equal(handle(b).read().restored,false);});

test('a later same-account document refuses an old owner when logout lost both name and storage writes', () => {
  for (const throws of [true, false]) {
    const b = browser(); handle(b).save({text:'private before logout'});
    const owner = b.name, raw = b.data.get(LEARNER_DRAFT_KEY);
    Object.defineProperty(b,'name',{get:()=>owner,set:()=>{if(throws)throw Error('name denied');},configurable:true});
    b.sessionStorage.setItem=()=>{throw Error('storage denied');};
    b.sessionStorage.removeItem=()=>{throw Error('storage denied');};
    assert.equal(clearLearnerTabDraftAccount('A',b).status,'unavailable');
    const later=handle(b);
    assert.equal(later.read().restored,false); assert.equal(later.read().status,'unavailable');
    assert.equal(later.save({text:'still editable'}).status,'unavailable');
    assert.equal(b.data.get(LEARNER_DRAFT_KEY),raw);
  }
});
