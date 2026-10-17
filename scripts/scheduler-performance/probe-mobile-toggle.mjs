import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {chromium,webkit}=createRequire(import.meta.url)('/workspace/cloud-tools/node_modules/playwright');
const out=process.env.EVIDENCE_DIR||'scripts/scheduler-performance/evidence/mobile-toggle';mkdirSync(out,{recursive:true});const results=[];
for(const engine of ['chromium','webkit']) {
 const browser=await {chromium,webkit}[engine].launch(engine==='chromium'?{executablePath:'/usr/bin/chromium',args:['--no-sandbox']}:{});
 try {for(const width of [1440,390,320])for(const scale of [1,2]) {
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),key=`${engine}-${width}-text${scale*100}`;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date('2026-10-14T16:00:00Z')});
  await page.route('**/__axe.js',r=>r.fulfill({contentType:'application/javascript',body:readFileSync('/workspace/qa-tools/node_modules/axe-core/axe.min.js','utf8')}));
  await page.goto('http://127.0.0.1:5190');if(width>700)await page.getByRole('button',{name:'Close the round-up'}).click();
  await page.evaluate(s=>document.documentElement.style.fontSize=`${s*100}%`,scale);
  const entry=page.locator('.sp-calendar-entry'),grid=entry.locator('.sp-mini-grid');
  if(width>700){assert.equal(await page.locator('.sp-calendar-toggle').count(),0);assert.ok(await grid.isVisible());}
  else {
   const toggle=page.locator('.sp-calendar-toggle');assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await grid.isVisible(),false);
   assert.match(await entry.innerText(),/October 2026/);assert.match(await entry.innerText(),/Month Units Delivered: 65 · Today 14: Unknown/);assert.match(await entry.innerText(),/Needs schedule: \d+/);assert.match(await entry.innerText(),/Low staff: \d+/);
   assert.ok(await entry.locator('.sp-mobile-warnings .pix').evaluateAll(es=>es.every(e=>getComputedStyle(e).fill==='rgb(35, 73, 57)')));
   const compactHeight=(await page.locator('.sp-mobile-calendar').boundingBox()).height;
   await page.screenshot({path:`${out}/${key}-compact.png`});
   await toggle.focus();assert.equal(await toggle.evaluate(e=>getComputedStyle(e).outlineStyle),'solid');await toggle.press('Enter');
   assert.equal(await toggle.getAttribute('aria-expanded'),'true');assert.ok(await grid.isVisible());assert.ok((await page.locator('.sp-mobile-calendar').boundingBox()).height>compactHeight);
   const dates=await grid.locator('i:not(.blank)').allTextContents();assert.deepEqual(dates,Array.from({length:31},(_,i)=>String(i+1)));
   assert.ok(await grid.locator('i:not(.blank)').evaluateAll(es=>es.every(e=>e.scrollWidth<=e.clientWidth&&e.scrollHeight<=e.clientHeight)));
   const today=await grid.locator('.today').innerText(),title=await entry.locator('.sp-entry-month').innerText(),warnings=await entry.locator('.sp-mobile-warnings').innerText();
   await page.screenshot({path:`${out}/${key}-expanded.png`});await toggle.press('Space');assert.equal(await toggle.getAttribute('aria-expanded'),'false');
   assert.equal(await entry.locator('.sp-entry-month').innerText(),title);assert.equal(await grid.locator('.today').textContent(),today);assert.equal(await entry.locator('.sp-mobile-warnings').innerText(),warnings);
   await entry.click();const f=page.frames().find(f=>f.url().includes('/planner/'));await f.locator('#month').fill('2026-11');await f.locator('#month').dispatchEvent('change');await f.locator('#day-2026-11-03').click();
   const selectedDay=await f.locator('#sheet h2').innerText();await page.getByRole('button',{name:'Return to Performance'}).click();
   await toggle.click();await toggle.click();assert.equal(await f.locator('#month').inputValue(),'2026-11');assert.equal(await f.locator('#sheet h2').textContent(),selectedDay);
   // Saved current-month coverage is reflected by the compact warning summary.
   await entry.click();await f.locator('#month').fill('2026-10');await f.locator('#month').dispatchEvent('change');await f.getByRole('button',{name:'Make Schedule',exact:true}).click();await f.locator('#day-2026-10-10').click();
   for(const box of await f.locator('#sheet input[type=checkbox]').all())await box.uncheck();await f.locator('[data-team="0"]').selectOption('On');await f.getByRole('button',{name:'Apply day override',exact:true}).click();
   await page.getByRole('button',{name:'Return to Performance'}).click();const after=await entry.locator('.sp-needs').innerText();assert.equal(Number(after.match(/\d+/)[0]),Number(warnings.match(/\d+/)[0])-1);
   assert.ok(await page.locator('.sp-mobile-calendar').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}));
   await page.addScriptTag({url:'http://127.0.0.1:5190/__axe.js'});assert.deepEqual(await page.evaluate(async()=>{const r=await axe.run(document.querySelector('.sp-mobile-calendar'),{runOnly:{type:'rule',values:['button-name','label-content-name-mismatch','color-contrast','aria-valid-attr-value']}});return r.violations.map(v=>v.id);}),[]);
  }
  assert.deepEqual(errors,[]);results.push({engine,width,scale,status:'passed'});console.log(key,'passed');await page.close();
 }}finally{await browser.close();}
}
writeFileSync(out+'/results.json',JSON.stringify(results,null,2));
