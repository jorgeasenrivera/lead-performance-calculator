import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {assertDateReadability} from './date-readability.mjs';
const {chromium,webkit}=createRequire(import.meta.url)('/workspace/cloud-tools/node_modules/playwright');
const out=process.env.EVIDENCE_DIR||'scripts/scheduler-performance/evidence/simplification';mkdirSync(out,{recursive:true});const results=[];
for(const engine of (process.env.BROWSER?[process.env.BROWSER]:['chromium','webkit'])) {
 const browser=await {chromium,webkit}[engine].launch(engine==='chromium'?{executablePath:'/usr/bin/chromium',args:['--no-sandbox']}:{});
 try {for(const width of (process.env.WIDTH?[Number(process.env.WIDTH)]:[1440,390,320]))for(const scale of (process.env.SCALE?[Number(process.env.SCALE)]:[1,2])) {
  const p=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),key=`${engine}-${width}-text${scale*100}`;p.setDefaultTimeout(12000);
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.clock.install({time:new Date('2026-10-14T16:00:00Z')});
  await p.route('**/__axe.js',r=>r.fulfill({contentType:'application/javascript',body:readFileSync('/workspace/qa-tools/node_modules/axe-core/axe.min.js','utf8')}));
  await p.goto('http://127.0.0.1:5190');if(width>700)await p.getByRole('button',{name:'Close the round-up'}).click();
  let entry=p.locator('.sp-calendar-entry');
  const compactFonts=async()=>entry.evaluate(e=>[e.querySelector('.sp-entry-month'),e.lastElementChild].map(n=>parseFloat(getComputedStyle(n).fontSize)));
  const compactBefore=width<=700?await compactFonts():null;
  await p.evaluate(s=>document.documentElement.style.fontSize=`${s*100}%`,scale);
  if(width<=700)assert.deepEqual(await compactFonts(),compactBefore.map(n=>n*scale),'both visible compact labels scale');
  if(width<=700){
   assert.equal((await entry.innerText()).replace(/\s+/g,' ').trim(),'October 2026 Open calendar');
   assert.equal(await p.locator('.sp-mobile-warnings,.sp-mobile-summary,.sp-calendar-toggle').count(),0);
   await entry.focus();assert.equal(await entry.evaluate(e=>getComputedStyle(e).outlineStyle),'solid');
   await p.screenshot({path:`${out}/${key}-compact.png`});
  }
  await entry.click();const f=p.frames().find(f=>f.url().includes('/planner/'));await f.locator('#period-heading').waitFor();await f.evaluate(s=>document.documentElement.style.fontSize=`${s*100}%`,scale);
  await f.addScriptTag({url:'http://127.0.0.1:5190/__axe.js'});
  const checkAxe=async()=>assert.deepEqual(await f.evaluate(async()=>{const r=await axe.run(document,{runOnly:['label-content-name-mismatch','button-name','label','color-contrast']});return r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}));}),[]);
  await checkAxe();
  assert.equal(await p.locator('.sp-dialog h1').count(),1);assert.equal(await f.locator('h1,h2').filter({visible:true}).count(),0);
  for(const [trigger,pop] of [['period-heading','month-picker'],['sales-key','sales-help']]) {
   await f.locator('#'+trigger).focus();await f.locator('#'+trigger).press('Enter');assert.ok(await f.locator('#'+pop).isVisible());await checkAxe();if(pop==='month-picker')assert.ok(await f.locator('#month').evaluate(e=>e.scrollWidth<=e.clientWidth));await p.screenshot({path:`${out}/${key}-${pop}.png`});
   await f.locator('#'+pop+' button').last().press('Escape');assert.equal(await f.locator('#'+pop).isVisible(),false);assert.equal(await f.evaluate(()=>document.activeElement.id),trigger);assert.ok(await p.locator('.sp-dialog').isVisible());
  }
  assert.match(await f.locator('.notice').innerText(),/Saved fictional assignments.*In this page only.*Lost on refresh/);
  assert.ok(await f.locator('.staff-needs').count()>0);assert.ok(await f.locator('.staff-low').count()>0);
  assert.equal(await f.locator('.month-day.heat-0,.month-day.heat-1').count(),0);assert.ok(await f.locator('.day-sales.heat-0,.day-sales.heat-1').count()>0);
  await p.screenshot({path:`${out}/${key}-overview.png`});
  await f.locator('#next').click();assert.match(await f.locator('#period-heading').innerText(),/November/);await f.locator('#previous').click();assert.match(await f.locator('#period-heading').innerText(),/October/);
  await f.locator('#period-heading').click();await f.locator('#month').fill('2014-02');await f.locator('#month').dispatchEvent('change');await f.locator('#previous').click();assert.equal(await f.evaluate(()=>document.activeElement.id),'period-heading');await f.locator('#period-heading').click();await f.locator('#month').fill('2026-10');await f.locator('#month').dispatchEvent('change');
  await f.locator('#sales-key').click();await f.getByRole('button',{name:'Close sales key'}).click();assert.equal(await f.evaluate(()=>document.activeElement.id),'sales-key');
  await f.locator('#period-heading').click();await f.locator('#today').click();assert.match(await f.locator('#sheet h2').innerText(),/Oct 14/);await f.getByRole('button',{name:'Back to month',exact:true}).click();assert.equal(await f.evaluate(()=>document.activeElement.id),'period-heading');
  await f.locator('.demo-options summary').click();await f.locator('#mode').selectOption('individual');assert.equal(await f.locator('#mode').inputValue(),'individual');await f.locator('#mode').selectOption('mixed');await f.locator('.demo-options summary').click();
  assert.equal(await f.locator('#recorded-total').innerText(),'65');assert.equal(await f.locator('#people').count(),0);await assertDateReadability(f);
  await f.locator('#day-2026-10-14').click();const view=await f.locator('#sheet .day-staffing').innerText();assert.match(await f.locator('.recorded-day').innerText(),/Units Delivered: Unknown/);
  await f.getByRole('button',{name:'Make Schedule',exact:true}).click();assert.equal(await f.locator('#sheet h2').innerText(),'Wed, Oct 14, 2026');assert.equal(await f.locator('#sheet .day-staffing').innerText(),view);
  assert.deepEqual(await f.locator('[name=assigned]:checked').evaluateAll(es=>es.map(e=>e.value)),['p0','p1','p4']);
  await f.getByRole('button',{name:'Back to month',exact:true}).click();await f.locator('#people').click();await f.locator('[name=maxHours]').fill('0');await f.getByRole('button',{name:'Apply to local proposal',exact:true}).click();
  await f.locator('#accept').click();assert.match(await f.locator('#message').innerText(),/Resolve/);
  await f.getByRole('button',{name:'Return to manager view',exact:true}).click();await f.locator('#day-2026-10-14').click();
  assert.match(await f.locator('#sheet').innerText(),/weekly hours exceeded/);assert.match(await f.locator('#sheet').innerText(),/Schedule conflict/);assert.match(await f.locator('#sheet').innerText(),/Oak team\s*Conflict/);
  await p.screenshot({path:`${out}/${key}-conflict.png`});
  await f.getByRole('button',{name:'Make Schedule',exact:true}).click();assert.deepEqual(await f.locator('[name=assigned]:checked').evaluateAll(es=>es.map(e=>e.value)),['p0','p1','p4']);
  await f.getByRole('button',{name:'Back to month',exact:true}).click();await f.locator('#people').click();await f.locator('#person').selectOption('p1');await f.locator('[name=off][value="3"]').check();await f.getByRole('button',{name:'Apply to local proposal',exact:true}).click();
  await f.getByRole('button',{name:'Return to manager view',exact:true}).click();await f.locator('#day-2026-10-14').click();assert.match(await f.locator('#sheet').innerText(),/Low staff/);assert.match(await f.locator('#sheet').innerText(),/day off/);
  await f.getByRole('button',{name:'Back to month',exact:true}).click();
  await f.locator('#period-heading').click();await f.locator('#month').fill('2026-11');await f.locator('#month').dispatchEvent('change');await f.locator('#day-2026-11-03').click();
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

  await p.clock.setSystemTime(new Date('2026-10-15T03:59:59.500Z'));await p.clock.runFor(1600);

  await p.clock.setSystemTime(new Date('2026-11-01T03:59:59.500Z'));await p.clock.runFor(1600);
  assert.equal(await p.locator('.sp-entry-month').innerText(),'November 2026');

  await p.locator('.sp-calendar-entry').click();assert.equal(await f.locator('#month').inputValue(),'2026-11');assert.match(await f.locator('#sheet h2').innerText(),/Nov 3, 2026/);assert.equal(await f.locator('#people').count(),0);
  await f.getByRole('button',{name:'Make Schedule',exact:true}).click();assert.deepEqual(await f.locator('[name=assigned]:checked').evaluateAll(es=>es.map(e=>e.value)),['p2']);
  await p.screenshot({path:`${out}/${key}-restored.png`});const overflow=await f.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,items:[...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent.slice(0,60),right:e.getBoundingClientRect().right})).slice(0,10)}));if(overflow.scroll>overflow.width)console.log(JSON.stringify(overflow));assert.ok(overflow.scroll<=overflow.width);assert.deepEqual(errors,[]);
  results.push({engine,width,scale,status:'passed'});console.log(key,'passed');await p.close();
 }}finally{await browser.close();}
}
writeFileSync(out+'/results.json',JSON.stringify(results,null,2));
