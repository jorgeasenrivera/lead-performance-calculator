import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const pw=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const url=process.env.RACE_URL||'http://127.0.0.1:5181/';
if(process.env.RACE_FICTIONAL_FIXTURE!=='1'||!['127.0.0.1','localhost'].includes(new URL(url).hostname))throw Error('Use only the explicit fictional loopback fixture');
const out=process.env.RACE_EVIDENCE_DIR||'/tmp/sage-race-repairs';fs.mkdirSync(out,{recursive:true});
const results=[];
for(const engine of (process.env.BROWSERS||'chromium,webkit').split(',')){
 const b=await pw[engine].launch(engine==='chromium'&&process.env.FEEL_CHROME?{executablePath:process.env.FEEL_CHROME}:{});
 const c=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}),p=await c.newPage();p.setDefaultTimeout(15000);
 const errors=[],requests=new Set();let changed=Date.now();const mock=r=>new URL(r.url()).origin==='http://127.0.0.1:5433';
 p.on('pageerror',e=>errors.push(e.stack||e.message));p.on('request',r=>{if(mock(r)){requests.add(r);changed=Date.now();}});
 for(const type of ['requestfinished','requestfailed'])p.on(type,r=>{if(requests.delete(r))changed=Date.now();});
 await c.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 await c.route(/127\.0\.0\.1:5433/,async r=>{await new Promise(done=>setTimeout(done,400));await r.continue();});
 await p.addInitScript(()=>{
  localStorage.setItem('lpcf:room:sage-demo','floor');localStorage.setItem('lpcf:pref:open:sage-demo','floor');navigator.vibrate=()=>true;
  window.raceEvents=[];document.addEventListener('sage-jump-phase',e=>raceEvents.push({at:Date.now(),kind:'phase',value:e.detail}));
  document.addEventListener('click',e=>{const button=e.target.closest('.ar-tab');if(button)raceEvents.push({at:Date.now(),kind:'click',value:button.getAttribute('aria-label')});},true);
 });
 const pane=which=>p.waitForFunction(which=>!!document.querySelector(`.ar-room[data-room="floor"] .sf-pane-${which}.on`),which,{timeout:30000});
 const tab=label=>p.locator(`.ar-tab[aria-label="${label}"]`);
 const snapshot=()=>p.evaluate(()=>({at:Date.now(),selected:document.querySelector('.ar-tab[aria-selected=true]')?.getAttribute('aria-label'),left:document.querySelector('.sf-panes')?.scrollLeft,width:document.querySelector('.sf-panes')?.clientWidth,ramping:document.querySelector('.sf-panes')?.classList.contains('sf-ramp')}));
 const signIn=async full=>{
  await p.locator('input[type=email],input[autocomplete=username]').fill('demo@sageonline.app');await p.locator('input[type=password]').fill('x');
  const start=Date.now();await p.getByRole('button',{name:'Sign in',exact:true}).click();await p.locator('.ar-bar').waitFor({timeout:40000});
  await p.waitForFunction(()=>!document.getElementById('root')?.inert&&!document.documentElement.classList.contains('sage-flight-lock'),null,{timeout:10000});
  const ms=Date.now()-start;assert.equal(await p.evaluate(()=>raceEvents.some(e=>e.kind==='phase'&&e.value==='burst')),full);return ms;
 };
 const selections=[];
 try{
  await p.goto(url,{waitUntil:'domcontentloaded'});await p.waitForTimeout(2400);const fullLoginMs=await signIn(true);
  await p.waitForTimeout(1500);await p.evaluate(()=>document.querySelector('.mc-flash-b')?.click());await p.waitForTimeout(600);
  await tab('Live Floor').click({force:true});await pane('floor');await p.waitForTimeout(800);
  await tab('Home').click();await pane('home');await p.waitForTimeout(800);
  // Retain the same ground read that preceded the diagnosed transition failure.
  await p.evaluate(()=>{const c=document.querySelector('.ar-gnd'),g=c.getContext('2d'),start=performance.now();const tick=()=>{g.getImageData(Math.round(c.width*.95),Math.round(c.height*.84),1,1);if(performance.now()-start<700)requestAnimationFrame(tick);};requestAnimationFrame(tick);});
  await tab('Live Floor').click();await pane('floor');await p.waitForTimeout(900);assert.equal((await snapshot()).selected,'Live Floor');selections.push(await snapshot());
  // Idle scroller settling must still change tabs after the programmatic ramp.
  await p.waitForFunction(()=>!document.querySelector('.sf-panes').classList.contains('sf-ramp'),null,{timeout:30000});
  for(const [fraction,expected,panel] of [[0,'Home','home'],[1,'Live Floor','floor']]){
   await p.locator('.sf-panes').evaluate((el,f)=>{el.scrollLeft=f*el.clientWidth;el.dispatchEvent(new Event('scroll'));},fraction);await pane(panel);assert.equal((await snapshot()).selected,expected);selections.push(await snapshot());
  }
  // A fresh quiet window keeps old mocked responses out of the next auth epoch.
  changed=Date.now();const quietStart=Date.now();while(requests.size||Date.now()-changed<500){if(Date.now()-quietStart>10000)throw Error('Mock requests did not settle before reload');await new Promise(r=>setTimeout(r,50));}
  await p.emulateMedia({reducedMotion:'reduce'});await p.evaluate(()=>{for(const k of Object.keys(localStorage))if(k==='lpc-auth'||/^sb-.*-auth-token$/.test(k))localStorage.removeItem(k);});
  await p.reload({waitUntil:'domcontentloaded'});await p.waitForTimeout(2400);const reducedLoginMs=await signIn(false);
  // The original feel harness separately enforces its 2100 ms return bar.
  await tab('Home').click();await pane('home');await tab('Live Floor').click();await pane('floor');await p.waitForTimeout(900);assert.equal((await snapshot()).selected,'Live Floor');
  assert.deepEqual(errors,[]);await p.screenshot({path:path.join(out,engine+'-floor.png')});results.push({engine,browser:b.version(),passed:true,scope:"functional",fullLoginMs,reducedLoginMs,reducedReturnBarMs:2100,reducedReturnWithinBar:reducedLoginMs<=2100,selections,events:await p.evaluate(()=>raceEvents)});console.log(engine,'login, animated navigation, idle settling and reduced navigation passed',JSON.stringify({fullLoginMs,reducedLoginMs}));
 }catch(e){results.push({engine,passed:false,error:e.stack||String(e),errors,state:await snapshot().catch(()=>null),events:await p.evaluate(()=>raceEvents).catch(()=>[])});await p.screenshot({path:path.join(out,engine+'-failure.png')}).catch(()=>{});console.error(engine,String(e));}
 finally{await b.close();fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2)+'\n');}
}
assert.ok(results.every(r=>r.passed),'Browser regression has failures; inspect preserved evidence');
