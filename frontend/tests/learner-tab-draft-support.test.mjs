import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearnerTabDrafts, LEARNER_DRAFT_KEY } from '../lib/learner-tab-drafts.mjs';
import { isLearnerTabPersistenceSupported } from '../lib/learner-tab-draft-support.mjs';

test('measured Chrome152 and Chrome154 on macOS are admitted; unmeasured versions and engines remain unsaved', () => {
  for (const version of [152, 154]) {
    const qualified = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`;
    assert.equal(isLearnerTabPersistenceSupported({navigator:{userAgent:qualified}}),true);
    for (const ua of [qualified.replace(`${version}.0.0.0`,'153.0.0.0'), qualified.replace(`${version}.0.0.0`,'155.0.0.0'), qualified.replace('Macintosh; Intel Mac OS X 10_15_7','X11; Linux x86_64'), qualified+` Edg/${version}.0.0.0`, qualified+` OPR/${version}.0.0.0`, qualified.replace('Chrome/','HeadlessChrome/'), 'Version/18.0 Safari/605.1.15']) {
      assert.equal(isLearnerTabPersistenceSupported({navigator:{userAgent:ua}}),false);
    }
  }
});

test('Chrome154 admits persistence while purging a browser-cloned private namespace before restore', () => {
  const oldOwner = 'aver-learner-drafts-v1:11111111-1111-4111-8111-111111111111';
  const storage = new Map([
    [LEARNER_DRAFT_KEY, JSON.stringify({schema:1,owner:oldOwner,drafts:[
      {account:'A',scope:'speaking:practice',version:'v1',value:{text:'private source-tab preparation'}}
    ]})],
    ['pending-start-retry','keep'],
  ]);
  const browser = {name:'',navigator:{userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36'},
    crypto:{randomUUID:()=> '22222222-2222-4222-8222-222222222222'},
    sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}};
  const handle = createLearnerTabDrafts({window:browser,accountId:'A',scope:'speaking:practice',version:'v1',validate:()=>true,getAccountId:()=> 'A'});
  assert.equal(handle.read().status,'ready');
  assert.equal(handle.read().restored,false);
  assert.equal(handle.read().value,null);
  assert.notEqual(browser.name,oldOwner);
  assert.deepEqual(JSON.parse(storage.get(LEARNER_DRAFT_KEY)).drafts,[]);
  assert.equal(storage.get('pending-start-retry'),'keep');
  assert.equal(handle.save({text:'own tab preparation'}).reason,'saved');
  assert.deepEqual(handle.read().value,{text:'own tab preparation'});
});

test('API availability never admits an unqualified browser or reads its copied draft namespace', () => {
  let touches=0;
  const browser={name:'',crypto:{randomUUID:()=>{touches++;return '11111111-1111-4111-8111-111111111111'}},
    sessionStorage:{getItem:()=>{touches++;return null},setItem:()=>{touches++},removeItem:()=>{touches++}}};
  assert.equal(isLearnerTabPersistenceSupported(browser),false);
  const h=createLearnerTabDrafts({window:browser,accountId:'A',scope:'speaking:practice',version:'v1',validate:()=>true,getAccountId:()=> 'A'});
  assert.equal(h.read().status,'unavailable');assert.equal(h.save({text:'still editable in UI'}).status,'unavailable');
  assert.equal(h.read().restored,false);assert.equal(touches,0);assert.equal(browser.name,'');
});
