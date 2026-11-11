// Loopback Next UI only, synthetic API state. No live Supabase or database calls.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const base = new URL(process.argv[2] || 'http://127.0.0.1:31352');
assert.ok(base.protocol === 'http:' && ['127.0.0.1','localhost'].includes(base.hostname), 'Loopback Next required');
const testId='00000000-0000-4000-8000-000000000052', attemptId='00000000-0000-4000-8000-000000000053';
const userId='00000000-0000-4000-8000-000000000054';
const answerIdentity='00000000-0000-4000-8000-000000000055';
const sentinel='SYNTHETIC_PROTECTED_BLACKEYE_MATERIAL';
const binding={programme_id:'blackeye-v5-upper-listening',collection_id:'blackeye-v5-upper',source_contract:'blackeye_u1_v1',unit_id:'U1',activity_id:'U1-A03',content_revision:'synthetic-content',policy_revision:'synthetic-policy'};
const activity={binding,test_id:testId,title:'Synthetic activity',order:3,readiness:'ready',readiness_reasons:[],selectable:true,response_cell_count:1,scoring_policy:'report_only',objective_denominator:0,dictation:{available:false,reason:'separate_release_required'},items:[{source_item_id:'synthetic-cell',q_num:1,source_display_number:'01',interaction:'keep_change',prompt:'Synthetic prompt',instruction:'Synthetic instruction',givens:[],group_id:'group',row_id:'row',column_id:'column'}],media_handle:null};
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/opt/google/chrome/chrome'});
let checks=0;
try {
  for(const theme of ['light','dark']) for(const viewport of [{width:1440,height:900},{width:390,height:844}]) {
    const context=await browser.newContext({viewport,colorScheme:theme});
    const session={access_token:'synthetic-local-only',refresh_token:'synthetic',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:userId,email:'synthetic@example.invalid'}};
    await context.addInitScript(([key,value,selectedTheme])=>{localStorage.setItem(key,value);localStorage.setItem('av-theme',selectedTheme);},[storageKey('https://example.supabase.co'),JSON.stringify(session),theme]);
    let submitted=false, saved='', submits=0, prematureReview=false; const leaks=[], errors=[], responses=[];
    const state=()=>({attempt_id:attemptId,test_id:testId,binding,context:{kind:'standalone',class_assignment_item_id:null,assignment_id:null,cohort_id:null},status:submitted?'submitted':'in_progress',answers:saved?[{q_num:1,source_item_id:'synthetic-cell',user_answer:saved}]:[],submitted_at:submitted?'2030-01-01T12:00:00Z':null,result_summary:submitted?{submitted:true,item_count:1,blank_count:1,unscored_count:1,objective_denominator:0,score:null,band_estimate:null}:null});
    await context.route('**/*',async route=>{
      const request=route.request(), url=new URL(request.url()), path=url.pathname, method=request.method();
      const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Cache-Control':'private, no-store'},body:JSON.stringify(body)});
      if(url.origin===base.origin && path==='/js/runtime-config.js') return route.fulfill({contentType:'application/javascript',body:`window.__AVER_RUNTIME_CONFIG__=Object.freeze(${JSON.stringify({environment:'test',apiBase:base.origin,supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'synthetic-public-key'})});`});
      if(path==='/auth/me') return json({id:userId,role:'student',email:'synthetic@example.invalid'});
      if(path==='/api/listening/source-collections/blackeye-v5-upper/units/U1') return json({collection_id:'blackeye-v5-upper',unit_id:'U1',activities:[activity,...['audio_incomplete_download','audio_not_found','original_options_unreviewed'].map((reason,i)=>({...activity,binding:{...binding,activity_id:['U1-A08','U1-A14','U1-A19'][i]},readiness:'locked',readiness_reasons:[reason],selectable:false}))]});
      if(path===`/api/listening/tests/${testId}`) return json({activity,attempt:url.searchParams.has('attempt_id')?state():null,replay_policy:'allowed',audio:{url:null,granularity:'whole_activity',expires_in:null}});
      if(path===`/api/listening/tests/${testId}/attempts`) {assert.deepEqual(request.postDataJSON(),{blackeye_binding:binding});return json(state());}
      if(path===`/api/listening/tests/attempts/${attemptId}/answers`) {saved=request.postDataJSON().user_answer;return json({attempt_id:attemptId,answer_count:1,performance_event_recorded:false});}
      if(path===`/api/listening/tests/attempts/${attemptId}/submit`) {submits++;submitted=true;return route.abort('failed');} // lost ACK
      if(path===`/api/listening/tests/attempts/${attemptId}`) return json(state());
      if(path===`/api/listening/tests/attempts/${attemptId}/review`) {
        if(!submitted) {prematureReview=true;return json({detail:'requires submission'},409);}
        return json({attempt:state(),items:[{source_item_id:'synthetic-cell',q_num:1,saved_response:saved,blank:true,source_status:'UNRESOLVED',scoring_mode:'SELF-CHECK',academic_verdict:'UNRESOLVED',reference:null,reference_provenance:'editorial',explanation_vi:null,limitation_vi:'Synthetic limitation',evidence_pointer:null}],transcript:[{text:sentinel,start:null,end:null}],audio:{url:null,granularity:'whole_activity',expires_in:null}});
      }
      if(url.origin===base.origin || ['data:','about:'].includes(url.protocol)) return route.continue();
      if(['GET','HEAD','OPTIONS'].includes(method) || ['/api/analytics/events','/api/error-logs'].includes(path)) return json({});
      throw new Error(`Unexpected synthetic write ${method} ${path}`);
    });
    const page=await context.newPage(); page.on('pageerror',e=>errors.push(String(e)));
    page.on('response',response=>{const before=!submitted;responses.push((async()=>{if(before){const text=await response.text().catch(()=> '');if(text.includes(sentinel)||text.includes(answerIdentity))leaks.push(response.url());}})());});
    await page.goto(new URL('/listening/blackeye',base).href); await page.getByRole('heading',{name:'Black Eye · Unit 1'}).waitFor().catch(async e=>{console.error('Local fixture diagnostic',page.url(),await page.locator('body').innerText(),errors);throw e;});
    const disabled=page.getByRole('button',{name:'Bắt đầu',exact:true});assert.equal(await disabled.count(),3);
    for(let i=0;i<3;i++){assert.ok(await disabled.nth(i).isDisabled());assert.ok(await disabled.nth(i).getAttribute('aria-describedby'));}
    checks+=4;
    await page.getByRole('link',{name:'Bắt đầu',exact:true}).click();await page.getByRole('heading',{name:'Synthetic activity'}).waitFor();
    assert.equal(await page.locator('fieldset legend').textContent(),'Câu 01 · group · row · column');
    await page.getByRole('combobox').focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.getByText('Đã lưu',{exact:true}).waitFor();
    assert.deepEqual(JSON.parse(saved),{version:'blackeye_keep_change_v1',action:'CHANGE',correction_text:''});
    assert.ok(!await page.content().then(t=>t.includes(sentinel)||t.includes(answerIdentity)));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));checks+=4;
    await page.getByRole('button',{name:'Nộp bài',exact:true}).click();await page.getByRole('dialog').waitFor();assert.equal(submits,0);
    await page.getByRole('button',{name:'Nộp với ô trống'}).click();await page.getByRole('heading',{name:'Tự đối chiếu · U1-A03'}).waitFor();
    assert.equal(submits,1);await page.getByText('Đáp án tham chiếu: chưa có').waitFor();await page.getByText('Giải thích: chưa có giải thích').waitFor();
    await page.reload();await page.getByRole('heading',{name:'Tự đối chiếu · U1-A03'}).waitFor();assert.equal(submits,1);checks+=4;
    await Promise.all(responses);assert.deepEqual(leaks,[]);assert.equal(prematureReview,false);assert.deepEqual(errors,[]);checks+=3;
    console.log(`PASS Black Eye ${theme} ${viewport.width}×${viewport.height}: locks, keyboard controls, exact save, blank confirmation, lost ACK, review reload, payload/SSR/RSC/preload sentinel checks`);
    await context.close();
  }
} finally {await browser.close();}
console.log(`PASS ${checks} local synthetic Black Eye browser checks. Assignment creation/admission and live staging QA remain pending.`);
