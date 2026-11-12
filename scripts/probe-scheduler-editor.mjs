// Actual dormant React host against fictional inputs only. External traffic is blocked.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,symlink,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
const repo=resolve(fileURLToPath(new URL('..',import.meta.url))),dir=await mkdtemp(join(tmpdir(),'sage-editor-host-'));
let server,browser;
try {
  await symlink(join(repo,'node_modules'),join(dir,'node_modules'),'dir');
  await writeFile(join(dir,'index.html'),'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><h1 id="host-heading">Host</h1><div id="root" style="height:80vh"></div><script type="module" src="/fixture.jsx"></script></body></html>');
  await writeFile(join(dir,'fixture.jsx'),`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import SchedulerEditor from '/@fs/${repo}/src/scheduler-editor.jsx';
import {createSchedulerDraftTransport} from '/@fs/${repo}/src/scheduler-draft-transport.mjs';import {schedulerDraftCodec} from '/@fs/${repo}/src/scheduler-draft-codec.mjs';import {manualDraftFetch} from '/@fs/${repo}/src/scheduler-manual-setup.mjs';
const root=createRoot(document.getElementById('root'));let props;window.guard=React.createRef();window.closeCount=0;window.confirmations=[];window.allowClose=false;window.errors=[];window.draftEvents=[];
const now=()=>new Date('2026-11-02T17:00:00Z'),store={id:'fictional',name:'Fictional'},data={__storeId:'fictional',roster:[{id:'a',name:'Alex',roleId:'sales'}],departed:[]};
const explicitAssignmentForDay=(day,index)=>day==='2026-11-02'&&index===0?{storeId:store.id,day,record:{on:[],off:['a'],absences:{a:{kind:'off',source:{kind:'fictional legacy input'}}}}}:null;
const original={store,data,timezone:'America/New_York',now,principalEpoch:3,dataEpoch:3,preview:false,guardRef:window.guard,explicitAssignmentForDay,onClose:()=>window.closeCount++,onError:e=>window.errors.push(e.message),onDraftChange:e=>window.draftEvents.push(e),confirm:message=>{window.confirmations.push(message);return window.allowClose;}};
window.original=original;window.update=(over={})=>{props={...(props||original),...over};flushSync(()=>root.render(<React.StrictMode><SchedulerEditor {...props}/></React.StrictMode>));};window.unmount=()=>flushSync(()=>root.unmount());
window.connect=()=>{
 const auth={getSnapshot:()=>({principalEpoch:props.principalEpoch,sessionReady:true,disposed:false}),subscribe:()=>()=>{},getAccessToken:async()=>window.draftBearer};
 window.draftBearer='fixture-first';window.draftCalls=[];window.draftRevision=1;window.draftDocument=window.guard.current.exportMonth('2026-11').projection;
 const replay=new Map();let sequence=0;
 const transport=createSchedulerDraftTransport({auth,codec:schedulerDraftCodec,requestId:()=> 'fixture-'+(++sequence),fetchImpl:manualDraftFetch(async(url,init)=>{
  const body=JSON.parse(init.body);window.draftCalls.push({url,body,bearer:init.headers.Authorization});
  if(url!=='/api/scheduler-manual')throw Error('Wrong manual route');
  const answer=(status,payload)=>({status,json:async()=>structuredClone(payload)});
  if(body.action==='load')return answer(200,{result:{kind:'draft',revision:window.draftRevision,schedule:window.draftDocument}});
  if(replay.has(body.requestId)){const prior=replay.get(body.requestId);if(prior.body!==init.body)return answer(409,{error:'idempotency-conflict'});return answer(200,{...prior.receipt,replayed:true});}
  if(body.baseRev!==window.draftRevision)return answer(409,{error:'conflict'});
  window.draftDocument=structuredClone(body.draft);window.draftRevision++;
  const receipt={result:{head:{draftRev:window.draftRevision,publishedRev:0}},replayed:false};replay.set(body.requestId,{body:init.body,receipt});
  if(window.dropNextDraftResponse){window.dropNextDraftResponse=false;throw Error('Synthetic committed response lost');}
  if(window.holdNextDraftResponse){window.holdNextDraftResponse=false;await new Promise(resolve=>window.finishDraftResponse=resolve);}
  return answer(200,receipt);
 })});
 window.draftBinding=window.guard.current.connectDraft({auth,transport});
 return window.guard.current.connectDraft({auth,transport})===window.draftBinding;
};
window.update();`);
  server=await createServer({root:dir,configFile:false,plugins:[react()],publicDir:join(repo,'public'),server:{host:'127.0.0.1',port:0,fs:{allow:[dir,repo]}}});
  await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  const pw=await import(process.env.FEEL_PLAYWRIGHT||'playwright'),engine=process.env.FEEL_BROWSER==='webkit'?pw.webkit:pw.chromium;
  browser=await engine.launch({headless:true,...(process.env.FEEL_CHROMIUM_EXECUTABLE&&engine===pw.chromium?{executablePath:process.env.FEEL_CHROMIUM_EXECUTABLE}:{})});
  for(const [width,height] of [[390,844],[1280,844]]) {
    const page=await browser.newPage({viewport:{width,height},hasTouch:width<700,isMobile:width<700});const errors=[];
    page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
    await page.goto(origin);try{await page.getByRole('status').waitFor();}catch(error){console.error('Host fixture errors:',errors,await page.locator('body').innerText());throw error;}assert.match(await page.getByRole('status').innerText(),/not available/);assert.equal(await page.locator('iframe').count(),0);
    await page.evaluate(()=>window.update({preview:true}));const frame=page.frameLocator('iframe');await frame.locator('#workspace').waitFor();await page.waitForFunction(()=>Boolean(window.guard.current));await frame.locator('#week-schedule').getByText('Hours unknown',{exact:true}).first().waitFor({state:'visible'});
    assert.equal(await page.locator('#host-heading').evaluate(e=>getComputedStyle(e).fontFamily),'"Times New Roman"');
    assert.deepEqual(await page.evaluate(()=>window.guard.current.exportMonth('2026-11')),{ok:false,reason:'source-not-materialized'});
    const review=await page.evaluate(()=>{window.seedReview=window.guard.current.reviewMaterialization('2026-11');return window.seedReview;});assert.equal(review.ok,true);assert.deepEqual(review.review.dates,['2026-11-02']);assert.equal(await page.evaluate(()=>window.guard.current.hasDraft()),false);
    assert.equal((await page.evaluate(()=>window.guard.current.applyMaterialization(window.seedReview.review))).changed,1);
    const initial=await page.evaluate(()=>window.guard.current.exportMonth('2026-11'));assert.equal(initial.ok,true);assert.deepEqual(initial.projection.overrides['2026-11-02'].off,['a']);assert.equal(initial.projection.overrides['2026-11-02'].shifts,undefined);assert.equal(initial.projection.storeId,'fictional');assert.deepEqual(initial.projection.store.teams,[]);
    assert.deepEqual(await page.evaluate(()=>window.guard.current.hydrateMonth({...window.guard.current.exportMonth('2026-11').projection,storeId:'other'})),{ok:false,reason:'codec-missing'});
    await frame.locator('#workspace').click();await frame.locator('#setup').click();await frame.locator('#people').click();await frame.locator('#settings-sheet input[name=start]').fill('9');await frame.locator('#settings-sheet input[name=end]').fill('17');await frame.locator('#settings-sheet input[name=maxHours]').fill('40');assert.deepEqual(await page.evaluate(()=>window.guard.current.reviewMaterialization('2026-11')),{ok:false,reason:'pending-choices'});await frame.locator('#settings-sheet button.primary').click();
    assert.equal(await page.evaluate(()=>window.guard.current.hasDraft()),true);assert.ok(await page.evaluate(()=>window.draftEvents.length)>0);
    assert.equal(await page.evaluate(()=>window.guard.current.requestClose()),false);assert.equal(await page.evaluate(()=>window.closeCount),0);
    // Same-scope refreshes and ref changes retain the open draft and its exact API.
    assert.equal(await page.evaluate(()=>{window.previous=window.guard.current;window.guard={current:null};window.update({data:{__storeId:'fictional',roster:[]},guardRef:window.guard});return window.guard.current===window.previous;}),true);
    assert.equal(await page.evaluate(()=>window.guard.current.hasDraft()),true);
    await page.evaluate(()=>window.allowClose=true);assert.equal(await page.evaluate(()=>window.guard.current.requestClose()),true);assert.equal(await page.evaluate(()=>window.closeCount),1);
    await page.evaluate(()=>window.saved=window.guard.current.exportMonth('2026-11').projection);const calls=await page.evaluate(()=>window.confirmations.length);
    await page.evaluate(()=>window.update({principalEpoch:4}));await page.getByRole('status').waitFor();assert.equal(await page.locator('iframe').count(),0);assert.equal(await page.evaluate(()=>window.guard.current),null);assert.equal(await page.evaluate(()=>window.confirmations.length),calls);
    assert.equal(await page.evaluate(()=>window.previous.requestClose()),false);assert.equal(await page.evaluate(()=>window.closeCount),1);
    await page.evaluate(()=>window.update({data:window.original.data,principalEpoch:4,dataEpoch:4,explicitAssignmentForDay:undefined,draftCodec:{verify:projection=>projection}}));await page.frameLocator('iframe').locator('#workspace').waitFor();await page.waitForFunction(()=>Boolean(window.guard.current));
    assert.equal((await page.evaluate(()=>window.guard.current.hydrateMonth(window.saved))).ok,true);const restored=await page.evaluate(()=>window.guard.current.exportMonth('2026-11'));assert.deepEqual(restored.projection.overrides['2026-11-02'].off,['a']);assert.equal(restored.projection.overrides['2026-11-02'].shifts,undefined);assert.equal(await page.evaluate(()=>window.guard.current.hasDraft()),false);
    assert.equal(await page.evaluate(()=>window.previous.requestClose()),false);assert.equal(await page.evaluate(()=>window.closeCount),1);
    if(width===1280){
      // Real React handle, binding, codec and manual request mapping; only auth
      // and the in-memory endpoint are synthetic doubles. No SQL is exercised.
      assert.equal(await page.evaluate(()=>window.connect()),true,'reconnecting the same private dependencies is idempotent');
      await page.evaluate(()=>window.draftBinding.load('2026-11'));
      assert.equal(await page.evaluate(()=>window.draftBinding.getSnapshot().months[0].loadAccepted),true);
      const editRule=async minimum=>{
        const frame=page.frameLocator('iframe');if(!await frame.locator('#setup').count())await frame.locator('#workspace').click();
        await frame.locator('#setup').click();await frame.locator('#rules').click();
        for(const [name,value]of [['open','9'],['close','17'],['minimum',String(minimum)],['capacity','8']])await frame.locator(`#settings-sheet [name=${name}]`).fill(value);
        await frame.locator('#settings-sheet button.primary').click();
      };
      await editRule(1);assert.equal(await page.evaluate(()=>window.guard.current.hasDraft()),true);
      await page.evaluate(()=>window.draftBinding.save('2026-11'));
      assert.equal(await page.evaluate(()=>window.guard.current.hasDraft()),false);
      assert.equal(await page.evaluate(()=>window.draftRevision),2);
      await editRule(2);await page.evaluate(()=>{window.dropNextDraftResponse=true;return window.draftBinding.save('2026-11');});
      assert.equal(await page.evaluate(()=>window.draftBinding.getSnapshot().months[0].controller.status),'uncertain');
      assert.equal(await page.evaluate(()=>window.guard.current.hasDraft()),true);
      await page.evaluate(()=>{window.draftBearer='fixture-fresh';return window.draftBinding.retry('2026-11');});
      const replay=await page.evaluate(()=>window.draftCalls.filter(call=>call.body.action==='save').slice(-2));
      assert.deepEqual(replay[0].body,replay[1].body);assert.notEqual(replay[0].bearer,replay[1].bearer);
      assert.equal(await page.evaluate(()=>window.draftRevision),3);assert.equal(await page.evaluate(()=>window.guard.current.hasDraft()),false);
      await editRule(3);await page.evaluate(()=>{window.holdNextDraftResponse=true;window.savingDraft=window.draftBinding.save('2026-11');});
      await page.waitForFunction(()=>Boolean(window.finishDraftResponse));await editRule(4);
      await page.evaluate(()=>{window.finishDraftResponse();return window.savingDraft;});
      assert.equal(await page.evaluate(()=>window.guard.current.hasDraft()),true,'edits made after submission remain dirty');
      assert.equal(await page.evaluate(()=>window.draftBinding.getSnapshot().months[0].controller.status),'dirty');
      const calls=await page.evaluate(()=>window.draftCalls);
      for(const call of calls){assert.equal(call.url,'/api/scheduler-manual');assert.deepEqual(Object.keys(call.body).sort(),(call.body.action==='load'?['action','storeId','month']:['action','storeId','month','draft','baseRev','requestId']).sort());}
      console.log('PASS actual mounted draft connection: manual envelopes, receipt tokens, fresh-bearer exact replay and edits during save (synthetic endpoint)');
    }
    if(width===1280&&process.env.SCHEDULER_EDITOR_EXPORT_DIRECTORY){
      // An explicitly authored fictional completion, not hours inferred from
      // a legacy Off list. All dates have deliberate Off or exact work choices.
      const months=['2026-10','2026-11','2026-12'],completed={};
      for(const month of months){const count=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate();const overrides={};for(let n=1;n<=count;n++){const date=month+'-'+String(n).padStart(2,'0');overrides[date]=date==='2026-11-03'?{on:['a'],off:[],shifts:[{storeId:'fictional',personId:'a',date,endDate:date,startMinute:540,endMinute:1020,timezone:'America/New_York',role:'sales'}]}:{on:[],off:['a'],absences:{a:{kind:'off',source:{kind:'explicit fictional manager choice'}}}};}
        completed[month]={storeId:'fictional',month,store:{timezone:'America/New_York',people:[{id:'a',name:'Alex',off:[],start:9,end:17,maxHours:60,maxHoursSource:'manager-confirmed'}],rules:[{effective:'2014-01-01',open:9,close:17,minimum:1,capacity:8,useCapacity:false,closedDays:[0,1,2,3,4,5,6],holidays:{'2026-11-03':'open'}}],teams:[],memberships:[{storeId:'fictional',personId:'a',teamIds:[],from:'2014-01-01',to:'2100-12-31',unknown:false}]},overrides};
      }
      const sparse=await page.evaluate(()=>window.guard.current.exportMonth('2026-11').projection);
      await page.evaluate(()=>window.update({data:window.original.data,principalEpoch:5,dataEpoch:5,explicitAssignmentForDay:undefined,draftCodec:{verify:x=>x}}));await page.frameLocator('iframe').locator('#workspace').waitFor();await page.waitForFunction(()=>Boolean(window.guard.current));
      const exports={};for(const month of months){assert.equal((await page.evaluate(p=>window.guard.current.hydrateMonth(p),completed[month])).ok,true);exports[month]=await page.evaluate(m=>window.guard.current.exportMonth(m).projection,month);}
      const knownEmployment=structuredClone(completed['2026-11']);knownEmployment.store.people[0].hiredAt='2008-05-15';
      await page.evaluate(()=>window.update({data:{...window.original.data,roster:[{...window.original.data.roster[0],hiredAt:'2008-05-15'}]},principalEpoch:6,dataEpoch:6}));await page.frameLocator('iframe').locator('#workspace').waitFor();await page.waitForFunction(()=>Boolean(window.guard.current));assert.equal((await page.evaluate(p=>window.guard.current.hydrateMonth(p),knownEmployment)).ok,true);
      const withEmployment=await page.evaluate(()=>window.guard.current.exportMonth('2026-11').projection),withEmploymentMonths={'2026-11':withEmployment};
      for(const month of ['2026-10','2026-12']){const document=structuredClone(completed[month]);document.store.people[0].hiredAt='2008-05-15';assert.equal((await page.evaluate(p=>window.guard.current.hydrateMonth(p),document)).ok,true);withEmploymentMonths[month]=await page.evaluate(m=>window.guard.current.exportMonth(m).projection,month);}
      const output=resolve(process.env.SCHEDULER_EDITOR_EXPORT_DIRECTORY);await mkdir(output,{recursive:true});await writeFile(join(output,'host-exports.json'),JSON.stringify({source:'actual local React host with fictional data',sparse,completed:exports,withEmployment,withEmploymentMonths},null,2)+'\n');
    }
    if(width===390){
      await page.evaluate(()=>{window.breakClock=false;window.update({data:window.original.data,principalEpoch:8,dataEpoch:8,now:()=>window.breakClock?null:new Date('2026-11-02T17:00:00Z'),explicitAssignmentForDay:window.original.explicitAssignmentForDay});});await page.frameLocator('iframe').locator('#workspace').waitFor();await page.waitForFunction(()=>Boolean(window.guard.current));
      const result=await page.evaluate(()=>{const reviewed=window.guard.current.reviewMaterialization('2026-11');window.breakClock=true;return window.guard.current.applyMaterialization(reviewed.review);});assert.equal(result.ok,true);assert.equal(result.rendered,false);assert.deepEqual((await page.evaluate(()=>window.guard.current.exportMonth('2026-11'))).projection.overrides['2026-11-02'].off,['a']);
      const notified=await page.evaluate(()=>{window.breakClock=false;return window.errors.splice(0);});assert.deepEqual(notified,['Scheduler input unavailable: timezone']);
    }
    await page.evaluate(()=>window.unmount());if(width===1280)assert.equal(await page.evaluate(()=>window.draftBinding.getSnapshot().active),false);assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.errors),[]);console.log(`PASS ${width}x${height}: actual React host, activation hold, scoped inputs, detached export, draft protection, same-scope refresh, StrictMode disposal and auth invalidation`);await page.close();
  }
} finally {await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true});}
