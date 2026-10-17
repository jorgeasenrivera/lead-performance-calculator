import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {assertDateReadability} from './date-readability.mjs';
const {chromium,webkit}=createRequire(import.meta.url)('/workspace/cloud-tools/node_modules/playwright');
const out=process.env.EVIDENCE_DIR||'scripts/scheduler-performance/evidence/review-corrections';mkdirSync(out,{recursive:true});const results=[];
for(const engine of (process.env.BROWSER?[process.env.BROWSER]:['chromium','webkit'])) {
 const browser=await {chromium,webkit}[engine].launch(engine==='chromium'?{executablePath:'/usr/bin/chromium',args:['--no-sandbox']}:{});
 try {for(const width of (process.env.WIDTH?[Number(process.env.WIDTH)]:[1440,390,320]))for(const scale of (process.env.SCALE?[Number(process.env.SCALE)]:[1,2])) {
  const p=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),key=`${engine}-${width}-text${scale*100}`;p.setDefaultTimeout(12000);
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.clock.install({time:new Date('2026-10-14T16:00:00Z')});
  await p.route('**/__axe.js',r=>r.fulfill({contentType:'application/javascript',body:readFileSync('/workspace/qa-tools/node_modules/axe-core/axe.min.js','utf8')}));
  await p.goto('http://127.0.0.1:5190');if(width>700)await p.getByRole('button',{name:'Close the round-up'}).click();
  await p.evaluate(s=>document.documentElement.style.fontSize=`${s*100}%`,scale);
  let entry=p.locator('.sp-calendar-entry');
  if(width<=700){
   assert.match(await entry.innerText(),/Month Units Delivered: 65 · Today 14: Unknown/);
   assert.equal(await p.locator('.sp-calendar-toggle').getAttribute('aria-expanded'),'false');
   await p.screenshot({path:`${out}/${key}-compact.png`});
   const toggle=p.locator('.sp-calendar-toggle');await toggle.focus();assert.equal(await toggle.evaluate(e=>getComputedStyle(e).outlineStyle),'solid');await toggle.press('Enter');
   assert.ok(await entry.locator('.sp-mini-grid').isVisible());
   assert.deepEqual(await entry.locator('i:not(.blank)').allTextContents(),Array.from({length:31},(_,i)=>String(i+1)));
   assert.ok(await entry.locator('i:not(.blank)').evaluateAll(es=>es.every(e=>e.scrollWidth<=e.clientWidth&&e.scrollHeight<=e.clientHeight)));
   await p.screenshot({path:`${out}/${key}-expanded.png`});
  }
  await entry.click();const f=p.frames().find(f=>f.url().includes('/planner/'));await f.locator('#month').waitFor();await f.evaluate(s=>document.documentElement.style.fontSize=`${s*100}%`,scale);
  assert.equal(await f.locator('#recorded-total').innerText(),'65');assert.equal(await f.locator('#people').count(),0);await assertDateReadability(f);
  await f.locator('#day-2026-10-14').click();const view=await f.locator('#sheet .day-staffing').innerText();assert.match(await f.locator('.recorded-day').innerText(),/Units Delivered: Unknown/);
  await f.getByRole('button',{name:'Make Schedule',exact:true}).click();assert.equal(await f.locator('#sheet h2').innerText(),'Wed, Oct 14, 2026');assert.equal(await f.locator('#sheet .day-staffing').innerText(),view);
  assert.deepEqual(await f.locator('[name=assigned]:checked').evaluateAll(es=>es.map(e=>e.value)),['p0','p1','p4']);
  await f.getByRole('button',{name:'Back to month',exact:true}).click();await f.locator('#people').click();await f.locator('[name=maxHours]').fill('0');await f.getByRole('button',{name:'Apply to local proposal',exact:true}).click();
  await f.locator('#accept').click();assert.match(await f.locator('#message').innerText(),/Resolve/);
  await f.getByRole('button',{name:'Return to manager view',exact:true}).click();await f.locator('#day-2026-10-14').click();
  assert.match(await f.locator('#sheet').innerText(),/weekly hours exceeded/);assert.match(await f.locator('#sheet').innerText(),/Schedule conflict/);assert.match(await f.locator('#sheet').innerText(),/Oak team: Conflict/);
  await p.screenshot({path:`${out}/${key}-conflict.png`});
  await f.getByRole('button',{name:'Make Schedule',exact:true}).click();assert.deepEqual(await f.locator('[name=assigned]:checked').evaluateAll(es=>es.map(e=>e.value)),['p0','p1','p4']);
  await f.getByRole('button',{name:'Back to month',exact:true}).click();await f.locator('#people').click();await f.locator('#person').selectOption('p1');await f.locator('[name=off][value="3"]').check();await f.getByRole('button',{name:'Apply to local proposal',exact:true}).click();
  await f.getByRole('button',{name:'Return to manager view',exact:true}).click();await f.locator('#day-2026-10-14').click();assert.match(await f.locator('#sheet').innerText(),/Low staff/);assert.match(await f.locator('#sheet').innerText(),/day off/);
  await f.getByRole('button',{name:'Back to month',exact:true}).click();
  await f.locator('#month').fill('2026-11');await f.locator('#month').dispatchEvent('change');await f.locator('#day-2026-11-03').click();
  assert.match(await f.locator('#sheet').innerText(),/Needs schedule/);await f.getByRole('button',{name:'Make Schedule',exact:true}).click();assert.equal(await f.locator('[name=assigned]:checked').count(),0);
  await f.getByRole('button',{name:'Use suggestion',exact:true}).click();assert.ok(await f.locator('[name=assigned]:checked').count()>0);
  await f.getByRole('button',{name:'Return to manager view',exact:true}).click();assert.match(await f.locator('#sheet').innerText(),/Needs schedule/);
  await f.getByRole('button',{name:'Make Schedule',exact:true}).click();assert.equal(await f.locator('[name=assigned]:checked').count(),0);
  await f.locator('[name=assigned][value=p2]').check();await f.getByRole('button',{name:'Apply day override',exact:true}).click();
  await f.getByRole('button',{name:'Return to manager view',exact:true}).click();assert.match(await f.locator('#sheet h2').innerText(),/Nov 3, 2026/);assert.match(await f.locator('#sheet').innerText(),/Low staff/);
  await f.addScriptTag({url:'http://127.0.0.1:5190/__axe.js'});assert.deepEqual(await f.evaluate(async()=>{const r=await axe.run(document,{runOnly:['label-content-name-mismatch','button-name','label','color-contrast']});return r.violations.map(v=>v.id);}),[]);
  await p.setViewportSize({width:width>700?390:1440,height:900});
  await p.locator('.sp-mobile-calendar').waitFor({state:width>700?'visible':'hidden'});
  await p.getByRole('button',{name:'Return to Performance'}).click();
  assert.equal(await p.evaluate(()=>document.activeElement.classList.contains('sp-calendar-entry')),true);
  await p.setViewportSize({width,height:900});
  await p.locator('.sp-mobile-calendar').waitFor({state:width<=700?'visible':'hidden'});
  if(width<=700)assert.equal(await p.locator('.sp-calendar-toggle').getAttribute('aria-expanded'),'true');
  await p.clock.setSystemTime(new Date('2026-10-15T03:59:59.500Z'));await p.clock.runFor(1600);
  if(width<=700)assert.match(await p.locator('.sp-mobile-summary').innerText(),/Month Units Delivered: 65 · Today 15: Unknown/);
  await p.clock.setSystemTime(new Date('2026-11-01T03:59:59.500Z'));await p.clock.runFor(1600);
  assert.equal(await p.locator('.sp-entry-month').innerText(),'November 2026');
  if(width<=700)assert.match(await p.locator('.sp-mobile-summary').innerText(),/Month Units Delivered: Unknown · Today 1: Unknown/);
  await p.locator('.sp-calendar-entry').click();assert.equal(await f.locator('#month').inputValue(),'2026-11');assert.match(await f.locator('#sheet h2').innerText(),/Nov 3, 2026/);assert.equal(await f.locator('#people').count(),0);
  await f.getByRole('button',{name:'Make Schedule',exact:true}).click();assert.deepEqual(await f.locator('[name=assigned]:checked').evaluateAll(es=>es.map(e=>e.value)),['p2']);
  await p.screenshot({path:`${out}/${key}-restored.png`});const overflow=await f.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,items:[...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent.slice(0,60),right:e.getBoundingClientRect().right})).slice(0,10)}));if(overflow.scroll>overflow.width)console.log(JSON.stringify(overflow));assert.ok(overflow.scroll<=overflow.width);assert.deepEqual(errors,[]);
  results.push({engine,width,scale,status:'passed'});console.log(key,'passed');await p.close();
 }}finally{await browser.close();}
}
writeFileSync(out+'/results.json',JSON.stringify(results,null,2));
