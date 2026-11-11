import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BlackEyeRunner, BlackEyeReview, BlackEyeUnitList } from '@/components/listening-blackeye';
import { AdminBlackEyeHomework } from '@/components/admin-blackeye-homework';

const auth = vi.hoisted(() => ({ status: 'signed-in', user: { id: 'synthetic-learner' } }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => auth }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('blackeye=1') }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));
const binding = { programme_id: 'blackeye-v5-upper-listening', collection_id:'blackeye-v5-upper', source_contract:'blackeye_u1_v1',unit_id:'U1',activity_id:'U1-A03',content_revision:'synthetic-content',policy_revision:'synthetic-policy' };
const cell = { source_item_id:'synthetic-cell',q_num:1,source_display_number:'01',interaction:'keep_change',prompt:'Synthetic prompt',instruction:'Synthetic instruction',givens:[],group_id:'group',row_id:'row',column_id:'column' };
const activity = { binding, test_id:'synthetic-test', title:'Synthetic activity',order:3,readiness:'ready',readiness_reasons:[],selectable:true,response_cell_count:1,scoring_policy:'report_only',objective_denominator:0,dictation:{available:false,reason:'separate_release_required'},items:[cell],media_handle:null };
const attempt = { attempt_id:'synthetic-attempt', test_id:'synthetic-test',binding,context:{kind:'standalone',class_assignment_item_id:null,assignment_id:null,cohort_id:null},status:'in_progress',answers:[],submitted_at:null,result_summary:null };
const player = {activity,attempt,replay_policy:'allowed',audio:{url:null,granularity:'whole_activity',expires_in:null}};
const api = { getWith:vi.fn(),postWith:vi.fn(),patchWith:vi.fn() };
const navigate = vi.fn();
beforeEach(() => {
  api.getWith.mockReset().mockResolvedValue(player); api.postWith.mockReset().mockResolvedValue(attempt); api.patchWith.mockReset().mockResolvedValue({}); navigate.mockReset();
  Object.assign(window,{api});
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{ configurable:true,value:vi.fn(function(this: HTMLDialogElement){ this.open=true; }) });
  Object.defineProperty(HTMLDialogElement.prototype,'close',{ configurable:true,value:vi.fn(function(this: HTMLDialogElement){ this.open=false; }) });
  const actual = window;
  vi.stubGlobal('window',new Proxy(actual,{get(target,key){ if(key==='location') return {assign:navigate}; return Reflect.get(target,key,target); }}));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('shows A8/A14/A19 with disabled Start and screen-reader reasons',async()=>{
  api.getWith.mockResolvedValue({collection_id:'blackeye-v5-upper',unit_id:'U1',activities:[
    ...['audio_incomplete_download','audio_not_found','original_options_unreviewed'].map((reason,i)=>({...activity,binding:{...binding,activity_id:['U1-A08','U1-A14','U1-A19'][i]},readiness:'locked',selectable:false,readiness_reasons:[reason]})),activity]});
  render(<BlackEyeUnitList/>); await screen.findByRole('heading',{name:'Black Eye · Unit 1'});
  const disabled = screen.getAllByRole('button',{name:'Bắt đầu'});
  expect(disabled).toHaveLength(3); for(const button of disabled){ expect((button as HTMLButtonElement).disabled).toBe(true); expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBeTruthy(); }
  expect(screen.getByRole('link',{name:'Bắt đầu'}).getAttribute('href')).toContain('blackeye=1');
});

it('keeps KEEP/CHANGE bytes, context, failed saves and explicit retry',async()=>{
  api.patchWith.mockRejectedValueOnce(new Error('synthetic failure'));
  render(<BlackEyeRunner testId="synthetic-test"/>); await screen.findByRole('heading',{name:'Synthetic activity'});
  expect(screen.getByText('Câu 01 · group · row · column',{selector:'legend'})).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox'),{target:{value:'CHANGE'}});
  await screen.findByText('Chưa lưu');
  expect(screen.getByRole('button',{name:'Thử lưu lại'})).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox'),{target:{value:' 001\nTiếng Việt '}});
  await screen.findByText('Đã lưu');
  const body=api.patchWith.mock.calls.at(-1)![1]; expect(JSON.parse(body.user_answer)).toEqual({version:'blackeye_keep_change_v1',action:'CHANGE',correction_text:' 001\nTiếng Việt '});
  expect(api.getWith.mock.calls.some(([url])=>url.includes('guided-state'))).toBe(false);
  expect(document.body.textContent).not.toContain('SYNTHETIC_PRIVATE_REFERENCE');
});

it('confirms incomplete CHANGE and resolves lost submit ACK by canonical read',async()=>{
  api.postWith.mockImplementation(async(url:string)=>{if(url.endsWith('/submit')) throw new Error('lost ACK'); return attempt;});
  api.getWith.mockImplementation(async(url:string)=>url.endsWith('/synthetic-attempt')?{...attempt,status:'submitted'}:player);
  render(<BlackEyeRunner testId="synthetic-test"/>); await screen.findByRole('heading',{name:'Synthetic activity'});
  fireEvent.change(screen.getByRole('combobox'),{target:{value:'CHANGE'}}); await screen.findByText('Đã lưu');
  fireEvent.click(screen.getByRole('button',{name:'Nộp bài'})); expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(api.postWith.mock.calls.filter(([url])=>url.endsWith('/submit'))).toHaveLength(0);
  fireEvent.click(screen.getByRole('button',{name:'Nộp với ô trống'}));
  await waitFor(()=>expect(navigate).toHaveBeenCalledWith('/listening/programmes/result/synthetic-attempt?blackeye=1'));
});

it('SSR contains no reference, transcript, answer identity, or preload',()=>{
  const html=renderToString(<BlackEyeRunner testId="synthetic-test"/>);
  for(const text of ['SYNTHETIC_PRIVATE_REFERENCE','answer_set_revision','transcript','preload']) expect(html).not.toContain(text);
  expect(api.getWith).not.toHaveBeenCalled();
});

it('review renders missing material as chưa có without wrong/score verdicts',()=>{
  render(<BlackEyeReview review={{attempt:{...attempt,status:'submitted'},items:[{source_item_id:'synthetic-cell',q_num:1,saved_response:'',blank:true,source_status:'UNRESOLVED',scoring_mode:'SELF-CHECK',academic_verdict:'UNRESOLVED',reference:null,reference_provenance:'editorial',explanation_vi:null,limitation_vi:'Synthetic limitation',evidence_pointer:null}],transcript:[{text:'SYNTHETIC_PRIVATE_TRANSCRIPT',start:null,end:null}],audio:player.audio} as never}/>);
  expect(screen.getByText('Đáp án tham chiếu: chưa có')).toBeTruthy(); expect(screen.getByText('Giải thích: chưa có giải thích')).toBeTruthy();
  expect(screen.getByText('Synthetic limitation')).toBeTruthy(); expect(document.body.textContent).not.toContain('Sai');
});

it('admin lookup error is visible and cannot create a zero-recipient assignment',async()=>{
  api.getWith.mockResolvedValue({inventory:{activities:[activity]},eligible_recipient_ids:[],lookup_errors:['recipient_lookup_failed']});
  render(<AdminBlackEyeHomework cohortId="synthetic-cohort"/>); fireEvent.click(screen.getByRole('button',{name:'Xem trước Black Eye'}));
  expect(await screen.findByRole('alert')).toBeTruthy(); expect((screen.getByRole('button',{name:'Giao cho 0 học viên'}) as HTMLButtonElement).disabled).toBe(true);
  expect(document.body.textContent).not.toContain('Lớp không có học viên'); expect(api.postWith).not.toHaveBeenCalled();
});
