// Hosted synthetic CI only. Do not execute browsers in the affected local workspace.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {build} from 'vite';
import {createBrowserFixture} from './scheduler-manual/browser-fixture.mjs';
import {serveManualFixture} from './scheduler-manual/browser-server.mjs';
export async function buildManualBrowser(dist){
 const entry=path.resolve('scripts/scheduler-manual/browser-entry.jsx');
 await build({configFile:false,envFile:false,logLevel:'error',build:{target:'esnext',outDir:dist,emptyOutDir:true,rollupOptions:{input:entry,output:{entryFileNames:'entry.js'}}}});
 await writeFile(path.join(dist,'index.html'),'<!doctype html><meta charset="utf-8"><title>Synthetic manual acceptance</title><div id="root"></div><script type="module" src="/entry.js"></script>');
}
export async function runManualBrowser({socket,dataDirectory,evidenceDir,engine,expectedVersion}){
 assert.ok(['chromium','webkit'].includes(engine));
 const dist=await mkdtemp(path.join(tmpdir(),'sage-manual-build-'));
 const evidence={postgresVersion:expectedVersion,scope:'synthetic component + composed handler + real local PostgreSQL; no hosted auth or native proof',engine,checks:[],blocked:[],timing:null,cleanup:false};
 let fixture,server,browser;
 const check=(name)=>evidence.checks.push(name);
 try{
  fixture=await createBrowserFixture({socket,dataDirectory,expectedVersion});await buildManualBrowser(dist);
  server=await serveManualFixture({dist,handler:fixture.handler});
  const pw=await import('playwright');browser=await pw[engine].launch();
  async function page(kind){const context=await browser.newContext({serviceWorkers:'block'});await context.route('**/*',route=>{if(new URL(route.request().url()).origin===server.url)return route.continue();evidence.blocked.push(route.request().url());return route.abort();});const p=await context.newPage();p.setDefaultTimeout(10000);if(kind==='pending')p.firstOwn=p.waitForResponse(r=>r.url().endsWith('/api/scheduler-manual')&&r.request().postDataJSON().action==='own');await p.goto(server.url+'/?kind='+kind);return p;}
  const manager=await page('manager'),employee=await page('employee'),pending=await page('pending');
  await employee.getByText('No schedule published yet.',{exact:true}).waitFor();
  assert.equal((await pending.firstOwn).status(),403);await pending.getByText('Your published schedule is unavailable.',{exact:true}).waitFor();check('pending own read denied');
  await manager.getByLabel('Month',{exact:true}).fill('2026-10');await manager.getByRole('button',{name:'Load month',exact:true}).click();
  await manager.getByText('Draft loaded. Changes stay private until published.',{exact:true}).waitFor();
  await manager.getByLabel('Date',{exact:true}).fill('2026-10-05');await manager.getByLabel('Person',{exact:true}).selectOption('a');
  await manager.getByLabel('Start',{exact:true}).fill('09:00');await manager.getByLabel('End',{exact:true}).fill('16:00');
  await manager.getByLabel('Configured shift role, if required',{exact:true}).fill('sales');
  await manager.getByLabel('Replace this person’s recorded absence on this date').check();
  await manager.getByRole('button',{name:'Add shift',exact:true}).click();
  await manager.getByRole('button',{name:'Save private draft',exact:true}).click();await manager.getByText('Draft saved. Staff cannot see these changes yet.',{exact:true}).waitFor();
  async function refresh(){
   let resolve,reject;const answer=new Promise((a,b)=>{resolve=a;reject=b;});
   const intercept=async route=>{try{const response=await route.fetch();const body=await response.json();await route.fulfill({response});resolve(body);}catch(error){reject(error);}};
   await employee.route('**/api/scheduler-manual',intercept,{times:1});
   await employee.evaluate(()=>window.dispatchEvent(new Event('online')));
   let timer;try{return await Promise.race([answer,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('fresh own request missing')),10000))]);}finally{clearTimeout(timer);await employee.unroute('**/api/scheduler-manual',intercept);}
  }
  assert.equal((await refresh()).revision,0);await employee.getByText('No schedule published yet.',{exact:true}).waitFor();check('entry/save and draft invisibility');
  await manager.getByRole('button',{name:'Review for publication',exact:true}).click();await manager.getByRole('heading',{name:'Ready to publish',exact:true}).waitFor();
  let ack;const response=manager.waitForResponse(r=>r.url().endsWith('/api/scheduler-manual')&&r.request().postDataJSON().action==='publish').then(async r=>{assert.equal(r.status(),200);ack=performance.now();return r.json();});
  await manager.getByRole('button',{name:'Publish this reviewed schedule',exact:true}).click();const published=await response,revision=published.result.head.publishedRev;
  const own=employee.getByRole('region',{name:'My published schedule'});
  await own.getByText('Revision '+revision,{exact:true}).waitFor();await own.getByText('2026-10-05: working 09:00–16:00 America/New_York',{exact:true}).waitFor();
  evidence.timing={acknowledgementToDOMObservedMs:performance.now()-ack,clock:'Node performance.now; conservative controller observation',targetMs:5000};assert.ok(evidence.timing.acknowledgementToDOMObservedMs<=5000);assert.ok(!(await own.innerText()).includes('Synthetic b'));check('published revision and own content rendered');
  // A draft edit after publish must not alter the immutable employee result.
  await manager.getByRole('button',{name:'Mark off',exact:true}).click();await manager.getByRole('button',{name:'Save private draft',exact:true}).click();await manager.getByText('Draft saved. Staff cannot see these changes yet.',{exact:true}).waitFor();
  const oldOwn=await refresh();assert.equal(oldOwn.revision,revision);assert.deepEqual(oldOwn.days.find(d=>d.date==='2026-10-05').intervals,[[540,960]]);await own.getByText('2026-10-05: working 09:00–16:00 America/New_York',{exact:true}).waitFor();check('later private draft does not replace publication');
  await employee.context().setOffline(true);await employee.getByText('Your published schedule is unavailable.',{exact:true}).waitFor();await employee.context().setOffline(false);await employee.evaluate(()=>window.dispatchEvent(new Event('online')));await own.getByText('Revision '+revision,{exact:true}).waitFor();check('offline failure and reconnect');
  await fixture.setPending(true);await employee.evaluate(()=>window.dispatchEvent(new Event('online')));await employee.getByText('Your published schedule is unavailable.',{exact:true}).waitFor();assert.equal(await employee.getByRole('region',{name:'My published schedule'}).count(),0);await fixture.setPending(false);await employee.evaluate(()=>window.dispatchEvent(new Event('online')));await own.getByText('Revision '+revision,{exact:true}).waitFor();check('revocation clears and approval refetches');
  await manager.getByRole('button',{name:'Review for publication',exact:true}).click();await manager.getByRole('heading',{name:'Ready to publish',exact:true}).waitFor();
  const nextAck=manager.waitForResponse(r=>r.url().endsWith('/api/scheduler-manual')&&r.request().postDataJSON().action==='publish');
  await manager.getByRole('button',{name:'Publish this reviewed schedule',exact:true}).click();const nextResponse=await nextAck;assert.equal(nextResponse.status(),200);const nextRev=(await nextResponse.json()).result.head.publishedRev;assert.ok(nextRev>revision);
  await own.getByText('Revision '+nextRev,{exact:true}).waitFor();await own.getByText(/^2026-10-05: off\s+America\/New_York$/).waitFor();
  // Replay a genuine older successful answer AFTER the newer revision rendered.
  let replayDone;const replayed=new Promise(resolve=>replayDone=resolve);
  const replay=async route=>{await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(oldOwn)});replayDone(oldOwn.revision);};
  await employee.route('**/api/scheduler-manual',replay,{times:1});await employee.evaluate(()=>window.dispatchEvent(new Event('online')));assert.equal(await replayed,revision);
  await employee.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await own.getByText('Revision '+nextRev,{exact:true}).waitFor();assert.ok(!(await own.innerText()).includes('09:00–16:00'));check('older published response cannot regress rendered revision');
  let release,heldResolve,settledResolve;const settled=new Promise(r=>settledResolve=r);const held=new Promise(r=>heldResolve=r),gate=new Promise(r=>release=r);
  await employee.route('**/api/scheduler-manual',async route=>{const response=await route.fetch();heldResolve();await gate;try{await route.fulfill({response});}catch{/* auth invalidation can cancel the old request */}finally{settledResolve();}});
  await employee.evaluate(()=>window.dispatchEvent(new Event('online')));await held;
  await employee.getByRole('button',{name:'Fixture sign out',exact:true}).click();release();await settled;await employee.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await employee.getByText('Your published schedule is unavailable.',{exact:true}).waitFor();assert.equal(await employee.getByRole('region',{name:'My published schedule'}).count(),0);check('late old-identity response refused');
  assert.deepEqual(evidence.blocked,[]);
 }finally{
  const failures=[];
  for(const cleanup of [()=>browser?.close(),()=>server?.close(),()=>fixture?.close(),()=>rm(dist,{recursive:true,force:true})])try{await cleanup();}catch(error){failures.push(error);}
  evidence.cleanup=failures.length===0;await mkdir(evidenceDir,{recursive:true});await writeFile(path.join(evidenceDir,'manual-browser-'+engine+'.json'),JSON.stringify(evidence,null,2));
  if(failures.length)throw new AggregateError(failures,'manual browser cleanup failed');
 }
 return evidence;
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 const [socket,dataDirectory,evidenceDir,engine,version]=process.argv.slice(2);
 if(process.env.GITHUB_ACTIONS!=='true')throw Error('hosted-ci-only');
 const expectedVersion=Number(version);if(!Number.isSafeInteger(expectedVersion)||Math.floor(expectedVersion/10000)!==16)throw Error('ci-postgres-16-required');
 await runManualBrowser({socket,dataDirectory,evidenceDir,engine,expectedVersion});
}
