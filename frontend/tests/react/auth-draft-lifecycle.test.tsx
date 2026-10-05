import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/lib/auth/auth-provider';
import { createLearnerTabDrafts, LEARNER_DRAFT_KEY } from '@/lib/learner-tab-drafts.mjs';
vi.mock('@/lib/learner-tab-draft-support.mjs',()=>({isLearnerTabPersistenceSupported:()=>true}));
let notify:(event:string,session:any)=>void, getSession:ReturnType<typeof vi.fn>;
const session=(id:string)=>({user:{id,email:null}});
function View(){const a=useAuth();return <span>{a.status}:{a.user?.id||''}</span>}
const mount=()=>render(<AuthProvider><View/></AuthProvider>);
const save=()=>createLearnerTabDrafts({accountId:'A',scope:'reading:article',version:'v1',validate:v=>Boolean(v),getAccountId:()=> 'A'}).save({answers:{1:'private'}});
beforeEach(()=>{window.sessionStorage.clear();window.name='';getSession=vi.fn(async()=>({data:{session:session('A')}}));Object.defineProperty(window,'getSupabase',{configurable:true,value:()=>({auth:{getSession,onAuthStateChange:(fn:any)=>{notify=fn;return {data:{subscription:{unsubscribe:vi.fn()}}}}}})});});
afterEach(()=>{cleanup();vi.restoreAllMocks();window.sessionStorage.clear();window.name='';});
it('clears off-route drafts on signout before same-account login and leaves unrelated retry storage intact',async()=>{
  mount();await screen.findByText('signed-in:A');save();window.sessionStorage.setItem('unrelated-retry','keep');
  act(()=>notify('SIGNED_OUT',null));expect(JSON.parse(window.sessionStorage.getItem(LEARNER_DRAFT_KEY)!).drafts).toEqual([]);
  act(()=>notify('SIGNED_IN',session('A')));await screen.findByText('signed-in:A');expect(window.sessionStorage.getItem('unrelated-retry')).toBe('keep');
});
it('a newer logout signal wins over a pending initial session read',async()=>{
  let resolve!:(value:any)=>void;getSession.mockReturnValue(new Promise(r=>{resolve=r}));mount();await waitFor(()=>expect(notify).toBeTypeOf('function'));
  act(()=>notify('SIGNED_OUT',null));await act(async()=>resolve({data:{session:session('A')}}));expect(screen.getByText('signed-out:')).toBeTruthy();
});
it('BFCache reconfirmation conceals stale user and a newer account signal supersedes its delayed read',async()=>{
  mount();await screen.findByText('signed-in:A');save();let resolve!:(v:any)=>void;getSession.mockReturnValue(new Promise(r=>{resolve=r}));
  act(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));expect(screen.getByText('initial-loading:')).toBeTruthy();
  act(()=>notify('SIGNED_IN',session('B')));await act(async()=>resolve({data:{session:session('A')}}));expect(screen.getByText('signed-in:B')).toBeTruthy();expect(JSON.parse(window.sessionStorage.getItem(LEARNER_DRAFT_KEY)!).drafts).toEqual([]);
});
it('a confirmed signed-out initial read invalidates an old owner even before this provider knew its account',async()=>{
  save();const previous=window.name;getSession.mockResolvedValue({data:{session:null}});mount();await screen.findByText('signed-out:');expect(previous).not.toBe('');expect(window.name).toBe('');
});
