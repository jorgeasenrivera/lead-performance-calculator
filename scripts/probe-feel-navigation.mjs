import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import http from 'node:http';
import {watchFeelReloads} from './feel-navigation.mjs';
const {chromium,webkit}=createRequire(import.meta.url)(process.env.FEEL_PLAYWRIGHT||'/workspace/cloud-tools/node_modules/playwright');
const engine=process.env.FEEL_BROWSER||'chromium';
const browser=await {chromium,webkit}[engine].launch(engine==='chromium'?{executablePath:process.env.FEEL_CHROME||'/usr/bin/chromium',args:['--no-sandbox']}:{});
const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><title>Fictional navigation check</title>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
try {
 const context=await browser.newContext(),page=await context.newPage(),errors=[];
 const settleBeforeReload=watchFeelReloads(page);
 page.on('pageerror',e=>errors.push(e.message));
 await context.route(/127\.0\.0\.1:5433/,async r=>{await new Promise(resolve=>setTimeout(resolve,400));await r.continue();});
 await page.goto(origin);
 for(const table of ['floor_public','queue_public']){
  await page.evaluate(table=>{window.pendingFixture=fetch(`http://127.0.0.1:5433/rest/v1/${table}?select=updated_at`,{headers:{authorization:'Bearer fictional',apikey:'mock-anon-key','x-client-info':'fixture','accept-profile':'public'}}).then(async r=>{if(!r.ok)throw Error('Mock request failed');await r.json();window.completedFixture=true;});},table);
  await settleBeforeReload();assert.equal(await page.evaluate(()=>window.completedFixture),true,'request completed before reload');
  await page.reload({waitUntil:'domcontentloaded'});
 }
 assert.deepEqual(errors,[]);
 // Draining requests must not swallow a genuine disallowed-header failure.
 await context.unrouteAll({behavior:'wait'});
 const rejected=await page.evaluate(async()=>{try{await fetch('http://127.0.0.1:5433/rest/v1/floor_public',{headers:{'x-unlisted-fixture-header':'negative-control'}});return false;}catch{return true;}});
 assert.equal(rejected,true,'invalid preflight still rejects');console.log(`${engine}: both delayed mock reads finish before reload; invalid preflight still rejects; zero page errors`);
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
