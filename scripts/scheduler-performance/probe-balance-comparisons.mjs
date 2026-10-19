import {createRequire} from 'node:module';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {chromium,webkit}=createRequire(import.meta.url)('/workspace/cloud-tools/node_modules/playwright');
// The editor now lives in month-app-core.mjs and its planner is private to the mount. For this test response only,
// wrap the imported factory so the one real instance is exposed to the page. Never a second planner, never a production seam.
const capturePlanner=(page,name)=>page.route('**/planner/month-app-core.mjs',async route=>{const response=await route.fetch(),source=await response.text();const imp='  createPlanner,\n',anchor='import { icon } from "./sage-icons.mjs";\n';assert.equal(source.split(imp).length,2,'createPlanner import anchor must be unique');assert.equal(source.split(anchor).length,2,'icon import anchor must be unique');await route.fulfill({response,body:source.replace(imp,'  createPlanner as createPlannerFactory,\n').replace(anchor,anchor+`const createPlanner=(...args)=>{const planner=createPlannerFactory(...args);(window.__plannerCaptures=window.__plannerCaptures||[]).push(planner);window.${name}=planner;return planner;};\n`)});});
const capturedOnce=async(page,name)=>{assert.equal(await page.evaluate(()=>window.__plannerCaptures?.length),1,'exactly one planner instance was captured');assert.ok(await page.evaluate(n=>window[n]===window.__plannerCaptures[0],name),'the exposed planner is the captured instance');console.log('planner captured: '+name);};
const engine=process.env.BROWSER||'chromium',out=process.env.EVIDENCE_DIR||'/tmp/balance-comparisons';mkdirSync(out,{recursive:true});
const browser=await {chromium,webkit}[engine].launch(engine==='chromium'?{executablePath:'/usr/bin/chromium',args:['--no-sandbox']}:{}),results=[];
try{for(const width of [1440,390,320])for(const scale of [1,2]){
 const p=await browser.newPage({viewport:{width,height:900},hasTouch:width<700,reducedMotion:'reduce'});p.setDefaultTimeout(15000);const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.clock.install({time:new Date('2026-10-14T16:00:00Z')});
 await capturePlanner(p,'auditFixture');
 await p.route('**/__axe.js',r=>r.fulfill({contentType:'application/javascript',body:readFileSync('/workspace/qa-tools/node_modules/axe-core/axe.min.js','utf8')}));
 await p.goto('http://127.0.0.1:5190/planner/');await p.locator('.day-heading').waitFor();await capturedOnce(p,'auditFixture');await p.evaluate(()=>document.fonts.ready);await p.evaluate(s=>document.documentElement.style.fontSize=`${s*100}%`,scale);
 const populate=async incomplete=>p.evaluate(async incomplete=>{
  const {monthDays}=await import('/planner/month-model.mjs'),{teamSnapshot}=await import('/planner/team-model.mjs'),s=auditFixture.get(0,'2026-11').store;
  s.rules=[{...s.rules[0],effective:'2014-01-01',closedDays:[],holidays:{},open:9,close:17}];for(const person of s.people){person.off=[];person.start=9;person.end=17;person.maxHours=168;}
  for(const [i,day] of monthDays('2026-11').entries()){
   const oak=incomplete||i<21,pine=i<(incomplete?10:15),on=[...(oak?['p0','p1']:[]),...(pine?['p2','p3']:[]),'p4','p5'],off=[...(!oak?['p0','p1']:[]),...(!pine&&!incomplete?['p2','p3']:[])];
   auditFixture.setAssignment(0,day,{on,off,teamSnapshot:teamSnapshot(s,day,[...on,...off])});
  }
  dispatchEvent(new CustomEvent('scheduler-view',{detail:{day:'2026-11-04',store:'fictional-0'}}));
 },incomplete);
 const open=async()=>{if(await p.locator('#workspace').innerText()==='Make Schedule')await p.locator('#workspace').click();await p.locator('#balance').click();};
 await populate(false);await open();assert.match(await p.locator('.difference-prompts').innerText(),/Oak team is 20 percentage points above Pine team/);assert.doesNotMatch(await p.locator('.difference-prompts').innerText(),/No team/);assert.match(await p.locator('#team-balance').innerText(),/No team remains context/);
 await p.addScriptTag({url:'http://127.0.0.1:5190/__axe.js'});const scan=async()=>assert.deepEqual(await p.evaluate(async()=>{const r=await axe.run(document,{runOnly:['button-name','label','color-contrast','aria-valid-attr-value']});return r.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}));}),[]);await scan();const key=`${engine}-${width}-text${scale*100}`;await p.locator('#team-balance').screenshot({path:`${out}/${key}-completed.png`});
 await populate(true);await open();assert.equal(await p.locator('.difference-prompts').count(),0);assert.match(await p.locator('.comparison-status').innerText(),/Comparison unavailable: complete/);assert.doesNotMatch(await p.locator('#team-balance').innerText(),/33%|No supported named-team rate gap/);assert.match(await p.locator('#team-balance').innerText(),/unknown assignment person-days/);await scan();await p.locator('#team-balance').screenshot({path:`${out}/${key}-incomplete.png`});
 await populate(false);await p.evaluate(async()=>{
  const {monthDays}=await import('/planner/month-model.mjs'),{teamSnapshot}=await import('/planner/team-model.mjs'),s=auditFixture.get(0,'2026-11').store;
  auditFixture.setMembership(0,{storeId:s.id,personId:'p4',teamIds:['oak','pine'],from:'2026-11-01',to:'2026-11-30',source:{kind:'fictional shared member'}});
  for(const day of monthDays('2026-11')){const r=auditFixture.record(0,day);auditFixture.setAssignment(0,day,{...r,on:r.on.filter(id=>id!=='p4'),off:[...r.off,'p4'],teamSnapshot:{...r.teamSnapshot,...teamSnapshot(s,day,['p4'])}});}
  s.history=[];s.people[0].maxHours=null;dispatchEvent(new CustomEvent('scheduler-view',{detail:{day:'2026-11-04',store:s.id}}));
 });await open();const balance=await p.locator('#team-balance').innerText();assert.match(balance,/shared-membership person-days; 240h 0m available time and 0h 0m eligible scheduled time/);assert.match(balance,/Unavailable: no comparable history/);await p.locator('#team-balance details').filter({has:p.locator('summary').filter({hasText:'People and denominators'})}).evaluate(e=>e.open=true);assert.match(await p.locator('#team-balance').innerText(),/Weekly cap: Unavailable: weekly limit unknown/);assert.equal(await p.locator('.difference-prompts').count(),0);
 await p.evaluate(()=>{const s=auditFixture.get(0,'2026-11').store;auditFixture.setMembership(0,{storeId:s.id,personId:'p0',teamIds:['pine'],from:'2026-11-04',to:'2026-11-04',source:{kind:'fictional dated change'}});dispatchEvent(new CustomEvent('scheduler-view',{detail:{day:'2026-11-04',store:s.id}}));});await open();await p.locator('#people').click();assert.match(await p.locator('.people-team-groups').innerText(),/retained assignment memberships differ/);assert.match(await p.locator('.people-team-groups').innerText(),/assignment uses Oak team; current teams are Pine team/);await scan();assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.locator('#settings-sheet').screenshot({path:`${out}/${key}-attribution.png`});
 assert.deepEqual(errors,[]);results.push({engine,width,scale,status:'passed',axeScans:3,populatedTwentyPointPrompt:true,incompleteSuppressed:true,noTeamContext:true,sharedDenominatorDisclosed:true,missingHistoryAndCap:true,peopleMismatchCue:true});console.log(key,'passed');await p.close();
}}finally{await browser.close();}writeFileSync(out+'/results.json',JSON.stringify(results,null,2));
