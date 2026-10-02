import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SpeakingBehavior } from '@/app/(authed-speaking)/speaking/speaking-behavior';
import { SpeakingShell } from '@/app/(authed-speaking)/speaking/page-shell';
import { LEARNER_DRAFT_KEY } from '@/lib/learner-tab-drafts.mjs';
vi.mock('@/lib/learner-tab-draft-support.mjs',()=>({isLearnerTabPersistenceSupported:()=>true}));
const auth=vi.hoisted(()=>({status:'signed-in',user:{id:'A'} as {id:string}|null}));
vi.mock('@/lib/auth/auth-provider',()=>({useAuth:()=>auth}));
const runtime=vi.hoisted(()=>({ready:vi.fn(async()=>true)}));
vi.mock('@/lib/when-global-ready.mjs',()=>({whenGlobalReady:runtime.ready}));
const el=(id:string)=>document.getElementById(id)!;
const input=(id:string)=>el(id) as HTMLInputElement;
const click=(id:string)=>fireEvent.click(el(id));
const mode=(name:string)=>fireEvent.click(document.querySelector(`[data-mode="${name}"]`)!);
const edit=(id:string,value:string)=>fireEvent.input(input(id),{target:{value}});
const mount=()=>render(<><SpeakingShell/><SpeakingBehavior/></>);
let get:ReturnType<typeof vi.fn>, post:ReturnType<typeof vi.fn>, topics=true;
beforeEach(()=>{
  window.sessionStorage.clear(); window.name=''; auth.status='signed-in'; auth.user={id:'A'}; topics=true;
  runtime.ready.mockReset().mockResolvedValue(true);
  get=vi.fn(async(path:string)=>path==='/auth/me'?{id:auth.user?.id,email:'a@example.com',permissions:['all']}:
    path.startsWith('/topics?')?(topics?[{title:'Approved topic',category:'Public'}]:[]):[]);
  post=vi.fn(); Object.defineProperty(window,'api',{configurable:true,value:{get,post,postWith:post}});
  Object.defineProperty(window,'getSupabase',{configurable:true,value:()=>({auth:{getSession:async()=>({data:{session:{user:auth.user}}})}})});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();window.sessionStorage.clear();window.name='';});
const ready=()=>waitFor(()=>expect(get).toHaveBeenCalledWith('/auth/me'));
it('keeps the submitted Part when a later preparation edit precedes runtime readiness',async()=>{
  let release!:(value:boolean)=>void;
  runtime.ready.mockReturnValue(new Promise<boolean>(resolve=>{release=resolve}));
  auth.status='initial-loading';auth.user=null;
  post.mockRejectedValue(new Error('fixture stops navigation'));
  const view=mount();mode('practice');click('prac-tp-part-2');edit('prac-topic-custom','Early Part2 topic');click('prac-topic-start');
  click('prac-tp-part-3');
  auth.status='signed-in';auth.user={id:'550e8400-e29b-41d4-a716-446655440000'};view.rerender(<><SpeakingShell/><SpeakingBehavior/></>);
  expect(el('prac-tp-part-3').classList.contains('selected')).toBe(true);
  await act(async()=>release(true));
  await waitFor(()=>expect(post).toHaveBeenCalled());
  expect(post.mock.calls[0][1]).toMatchObject({mode:'practice',part:2,topic:'Early Part2 topic'});
  expect(post).toHaveBeenCalledTimes(1);
});
it('keeps fresh panel, Part and raw edits at first account confirmation, then clears them at a switch',async()=>{
  auth.status='initial-loading';auth.user=null;
  const view=mount();mode('practice');click('prac-part-2');edit('prac-custom-q','  Fresh cue\nYou should say:\nwhy  ');edit('prac-topic-custom','  Fresh topic  ');
  auth.status='signed-in';auth.user={id:'A'};view.rerender(<><SpeakingShell/><SpeakingBehavior/></>);
  await ready();
  expect(el('tab-practice').classList.contains('active')).toBe(true);
  expect(el('prac-part-2').classList.contains('selected')).toBe(true);
  expect(input('prac-custom-q').value).toBe('  Fresh cue\nYou should say:\nwhy  ');
  expect(input('prac-topic-custom').value).toBe('  Fresh topic  ');
  auth.user={id:'B'};view.rerender(<><SpeakingShell/><SpeakingBehavior/></>);
  expect(input('prac-custom-q').value).toBe('');expect(input('prac-topic-custom').value).toBe('');
  expect(el('tab-dashboard').classList.contains('active')).toBe(true);expect(post).not.toHaveBeenCalled();
});
it('drops unconfirmed preparation on signed-out instead of adopting it at a later sign-in',async()=>{
  auth.status='initial-loading';auth.user=null;
  const view=mount();mode('practice');edit('prac-custom-q','unconfirmed text');
  auth.status='signed-out';view.rerender(<><SpeakingShell/><SpeakingBehavior/></>);
  expect(input('prac-custom-q').value).toBe('');
  auth.status='signed-in';auth.user={id:'B'};view.rerender(<><SpeakingShell/><SpeakingBehavior/></>);
  await ready();expect(input('prac-custom-q').value).toBe('');
  expect(el('tab-dashboard').classList.contains('active')).toBe(true);expect(post).not.toHaveBeenCalled();
});
it('rechecks permissions on persisted return before restoring a now disallowed preparation',async()=>{
  mount();await ready();mode('practice');edit('prac-custom-q','private preparation');
  const before=get.mock.calls.filter(([p])=>p==='/auth/me').length;
  get.mockImplementation(async(path:string)=>path==='/auth/me'?{id:'A',permissions:[]}:[]);
  act(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
  await waitFor(()=>expect(get.mock.calls.filter(([p])=>p==='/auth/me').length).toBeGreaterThan(before));
  expect(input('prac-custom-q').value).toBe('');expect(el('tab-dashboard').classList.contains('active')).toBe(true);expect(post).not.toHaveBeenCalled();
});
it('ignores an old same-account profile after an A to B to A transition',async()=>{
  let resolveOld!:(profile:any)=>void;let profiles=0;
  get.mockImplementation(async(path:string)=>{
    if(path!=='/auth/me')return [];
    profiles++;if(profiles===1)return new Promise(resolve=>{resolveOld=resolve});
    return {id:auth.user?.id,permissions:[]};
  });
  const view=mount();await ready();mode('practice');edit('prac-custom-q','private A');
  auth.user={id:'B'};view.rerender(<><SpeakingShell/><SpeakingBehavior/></>);
  auth.user={id:'A'};view.rerender(<><SpeakingShell/><SpeakingBehavior/></>);
  await waitFor(()=>expect(profiles).toBeGreaterThanOrEqual(3));
  await act(async()=>resolveOld({id:'A',permissions:['all']}));
  expect(input('prac-custom-q').value).toBe('');expect(el('tab-dashboard').classList.contains('active')).toBe(true);expect(post).not.toHaveBeenCalled();
});
it('restores latest raw cue, Part and panel without Start or AI, including an empty edit',async()=>{
  let view=mount();await ready();mode('practice');click('prac-part-2');edit('prac-custom-q','  Describe a place\nYou should say:\nwhere it is  ');edit('prac-topic-custom','older');edit('prac-topic-custom','');
  view.unmount();view=mount();await waitFor(()=>expect(input('prac-custom-q').value).toContain('Describe a place'));
  expect(input('prac-custom-q').value).toBe('  Describe a place\nYou should say:\nwhere it is  ');expect(input('prac-topic-custom').value).toBe('');expect(el('prac-part-2').classList.contains('selected')).toBe(true);expect(el('tab-practice').classList.contains('active')).toBe(true);expect(post).not.toHaveBeenCalled();
});
it('does not erase an existing draft when its panel is opened before returning auth is confirmed',async()=>{
  let view=mount();await ready();mode('practice');click('prac-part-2');edit('prac-custom-q','saved cue');edit('prac-topic-custom','saved topic');
  view.unmount();auth.status='initial-loading';auth.user=null;view=mount();mode('practice');
  auth.status='signed-in';auth.user={id:'A'};view.rerender(<><SpeakingShell/><SpeakingBehavior/></>);
  await waitFor(()=>expect(get.mock.calls.filter(([path])=>path==='/auth/me')).toHaveLength(2));
  expect(input('prac-custom-q').value).toBe('saved cue');expect(input('prac-topic-custom').value).toBe('saved topic');
  expect(el('prac-part-2').classList.contains('selected')).toBe(true);expect(el('tab-practice').classList.contains('active')).toBe(true);expect(post).not.toHaveBeenCalled();
});
it('keeps an explicit empty edit before profile readiness and immediate navigation, preserving untouched fields',async()=>{
  let view=mount();await ready();mode('practice');click('prac-part-2');edit('prac-custom-q','old cue');edit('prac-topic-custom','old topic');view.unmount();
  let resolveOld!:(profile:any)=>void;
  get.mockImplementation(async(path:string)=>path==='/auth/me'?new Promise(resolve=>{resolveOld=resolve}):[]);
  view=mount();await waitFor(()=>expect(get.mock.calls.filter(([path])=>path==='/auth/me')).toHaveLength(2));
  mode('practice');expect(input('prac-custom-q').value).toBe('');edit('prac-custom-q','');view.unmount();
  get.mockImplementation(async(path:string)=>path==='/auth/me'?{id:'A',permissions:['all']}:[]);
  view=mount();await waitFor(()=>expect(input('prac-topic-custom').value).toBe('old topic'));
  expect(input('prac-custom-q').value).toBe('');expect(el('prac-part-2').classList.contains('selected')).toBe(true);
  await act(async()=>resolveOld({id:'A',permissions:[]}));expect(input('prac-topic-custom').value).toBe('old topic');expect(post).not.toHaveBeenCalled();
});
it('merges early question and Part edits without erasing the untouched topic',async()=>{
  let view=mount();await ready();mode('practice');click('prac-part-2');edit('prac-custom-q','old cue');edit('prac-topic-custom','old topic');view.unmount();
  auth.status='initial-loading';auth.user=null;view=mount();mode('practice');click('prac-part-3');edit('prac-custom-q','  replacement question  ');
  auth.status='signed-in';auth.user={id:'A'};view.rerender(<><SpeakingShell/><SpeakingBehavior/></>);
  await waitFor(()=>expect(input('prac-topic-custom').value).toBe('old topic'));
  expect(input('prac-custom-q').value).toBe('  replacement question  ');expect(el('prac-part-3').classList.contains('selected')).toBe(true);expect(post).not.toHaveBeenCalled();
});
it('keeps all other Full Test topics when only one is edited before profile readiness',async()=>{
  let view=mount();await ready();mode('fulltest');const ids=['ft-p1-topic-1','ft-p1-topic-2','ft-p1-topic-3','ft-p2-topic'];
  ids.forEach((id,i)=>edit(id,`old${i}`));view.unmount();
  auth.status='initial-loading';auth.user=null;view=mount();mode('fulltest');edit(ids[1],'');
  auth.status='signed-in';auth.user={id:'A'};view.rerender(<><SpeakingShell/><SpeakingBehavior/></>);
  await waitFor(()=>expect(input(ids[0]).value).toBe('old0'));expect(ids.map(id=>input(id).value)).toEqual(['old0','','old2','old3']);expect(post).not.toHaveBeenCalled();
});
it('preserves early edits in another panel and an explicit discard while account confirmation is pending',async()=>{
  auth.status='initial-loading';auth.user=null;const view=mount();mode('practice');edit('prac-custom-q','early practice');
  mode('fulltest');edit('ft-p2-topic','discard me');click('speaking-draft-discard');
  auth.status='signed-in';auth.user={id:'A'};view.rerender(<><SpeakingShell/><SpeakingBehavior/></>);await ready();
  expect(input('ft-p2-topic').value).toBe('');mode('practice');expect(input('prac-custom-q').value).toBe('early practice');expect(post).not.toHaveBeenCalled();
});
it('shows unsaved preparation before account confirmation without assigning it to storage',()=>{
  auth.status='initial-loading';auth.user=null;mount();mode('practice');edit('prac-custom-q','unconfirmed');
  expect(el('speaking-draft-controls').hidden).toBe(false);expect(el('speaking-draft-notice').textContent).toContain('chưa được lưu');
  expect(window.sessionStorage.getItem(LEARNER_DRAFT_KEY)).toBeNull();expect(post).not.toHaveBeenCalled();
});
it('does not expose a saved modal until fresh permissions authorize that mode',async()=>{
  let view=mount();await ready();click('grammar-cta-start');click('tab-myq');edit('myq-input','private modal');view.unmount();
  let resolveProfile!:(profile:any)=>void;
  get.mockImplementation(async(path:string)=>path==='/auth/me'?new Promise(resolve=>{resolveProfile=resolve}):[]);
  view=mount();await waitFor(()=>expect(get.mock.calls.filter(([path])=>path==='/auth/me')).toHaveLength(2));click('grammar-cta-start');
  expect(input('myq-input').value).toBe('');await act(async()=>resolveProfile({id:'A',permissions:[]}));
  expect(input('myq-input').value).toBe('');expect(post).not.toHaveBeenCalled();
});
it('merges a fresh modal edit and subtab with saved fields after its permission read',async()=>{
  let view=mount();await ready();click('grammar-cta-start');click('tab-myq');edit('myq-input','old modal');click('tab-custom');edit('topic-custom-input','old custom');view.unmount();
  let resolveProfile!:(profile:any)=>void;
  get.mockImplementation(async(path:string)=>path==='/auth/me'?new Promise(resolve=>{resolveProfile=resolve}):[]);
  view=mount();await waitFor(()=>expect(get.mock.calls.filter(([path])=>path==='/auth/me')).toHaveLength(2));click('grammar-cta-start');click('tab-myq');edit('myq-input','new modal');
  await act(async()=>resolveProfile({id:'A',permissions:['all']}));
  expect(input('myq-input').value).toBe('new modal');expect(input('topic-custom-input').value).toBe('old custom');expect(el('tab-myq').classList.contains('active')).toBe(true);expect(post).not.toHaveBeenCalled();
});
it('preserves full-test and Part-by-Part drafts independently and discards only the current mode',async()=>{
  let view=mount();await ready();mode('practice');edit('prac-custom-q','practice');mode('fulltest');
  ['ft-p1-topic-1','ft-p1-topic-2','ft-p1-topic-3','ft-p2-topic'].forEach((id,i)=>edit(id,`  topic${i}  `));
  mode('partbpart');click('pbp-card-3');edit('pbp-topic-custom','  custom Part3  ');click('speaking-draft-discard');expect(input('pbp-topic-custom').value).toBe('');
  mode('fulltest');expect(input('ft-p2-topic').value).toBe('  topic3  ');view.unmount();view=mount();await waitFor(()=>expect(input('ft-p1-topic-2').value).toBe('  topic1  '));mode('practice');expect(input('prac-custom-q').value).toBe('practice');expect(post).not.toHaveBeenCalled();
});
it('restores modal subtab and custom questions and never adopts a removed public topic',async()=>{
  let view=mount();await ready();click('grammar-cta-start');click('tab-myq');edit('myq-input','  My question?\nNext?  ');
  view.unmount();view=mount();await waitFor(()=>expect(input('myq-input').value).toBe('  My question?\nNext?  '));expect(el('tab-myq').classList.contains('active')).toBe(true);click('modal-close');mode('practice');
  await waitFor(()=>expect(input('prac-topic-select').disabled).toBe(false));fireEvent.change(input('prac-topic-select'),{target:{value:'Approved topic'}});
  view.unmount();topics=false;view=mount();await waitFor(()=>expect(el('speaking-draft-notice').textContent).toContain('không có trong danh sách'));expect(input('prac-topic-select').value).toBe('');expect(post).not.toHaveBeenCalled();
});
it('conceals unconfirmed account and BFCache text then requires a current session before restore',async()=>{
  const view=mount();await ready();mode('practice');edit('prac-custom-q','private A');
  auth.status='initial-loading';auth.user=null;view.rerender(<><SpeakingShell/><SpeakingBehavior/></>);expect(input('prac-custom-q').value).toBe('');
  auth.status='signed-in';auth.user={id:'B'};view.rerender(<><SpeakingShell/><SpeakingBehavior/></>);await ready();expect(input('prac-custom-q').value).toBe('');mode('practice');edit('prac-custom-q','private B');
  let resolve!:(x:any)=>void;const pending=new Promise(r=>{resolve=r});Object.defineProperty(window,'getSupabase',{configurable:true,value:()=>({auth:{getSession:()=>pending}})});
  act(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});expect(input('prac-custom-q').value).toBe('');
  await act(async()=>resolve({data:{session:{user:{id:'B'}}}}));await waitFor(()=>expect(input('prac-custom-q').value).toBe('private B'));expect(post).not.toHaveBeenCalled();
});
it('keeps input usable and reports unsaved when persistence is unavailable; copied DOM is not a draft',async()=>{
  const set=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('quota')});let view=mount();await ready();mode('practice');edit('prac-custom-q','editable');expect(input('prac-custom-q').value).toBe('editable');expect(el('speaking-draft-notice').textContent).toContain('chưa được lưu');
  view.unmount();set.mockRestore();window.sessionStorage.clear();view=mount();await ready();input('prac-custom-q').value='browser-restored';view.unmount();mount();await ready();expect(input('prac-custom-q').value).toBe('');expect(post).not.toHaveBeenCalled();expect(window.sessionStorage.getItem(LEARNER_DRAFT_KEY)).not.toContain('browser-restored');
});
