import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearnerTabDrafts } from '../lib/learner-tab-drafts.mjs';
import { isLearnerTabPersistenceSupported } from '../lib/learner-tab-draft-support.mjs';

test('only the directly qualified desktop engine is admitted; different engine/version/OS remains unsaved', () => {
  const qualified = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
  assert.equal(isLearnerTabPersistenceSupported({navigator:{userAgent:qualified}}),true);
  for (const ua of [qualified.replace('152.0.0.0','154.0.0.0'), qualified.replace('Macintosh; Intel Mac OS X 10_15_7','X11; Linux x86_64'), qualified+' Edg/152.0.0.0', qualified.replace('Chrome/','HeadlessChrome/'), 'Version/18.0 Safari/605.1.15']) {
    assert.equal(isLearnerTabPersistenceSupported({navigator:{userAgent:ua}}),false);
  }
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
