import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const {chromium, webkit} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || '/workspace/cloud-tools/node_modules/playwright');
const out = process.env.EVIDENCE_DIR || '/tmp/additional-people';
mkdirSync(out, {recursive:true});
const results = [];
for (const engine of process.env.BROWSER ? [process.env.BROWSER] : ['chromium','webkit']) {
 const browser = await {chromium,webkit}[engine].launch(engine === 'chromium' ? {executablePath:'/usr/bin/chromium',args:['--no-sandbox']} : {});
 try { for (const width of [320,390]) for (const scale of [1,2]) for (const count of [0,1,3,4]) {
  const page = await browser.newPage({viewport:{width,height:844}, reducedMotion:'reduce'});
  const errors = []; page.on('pageerror', e=>errors.push(e.message));
  await page.clock.install({time:new Date('2026-10-14T16:00:00Z')});
  await page.route('**/assignment-view.mjs', async route => {
   let source = readFileSync('scripts/scheduler-performance/assignment-view.mjs','utf8');
   source = source.replace('export function teamsFor(', 'function originalTeamsFor(').replace('export function fixtureAssignments(', 'function originalFixtureAssignments(');
   source += `\nexport function teamsFor(people) { return [{name:'Oak team',ids:people.slice(0,${6-count}).map(p=>p.id)},{name:'Overlapping team',ids:['p0']}]; }\nexport function fixtureAssignments(day) { return day==='2026-10-14' ? {on:['p0','p1','p2','p4','p4'],off:['p3']} : originalFixtureAssignments(day); }`;
   await route.fulfill({contentType:'application/javascript',body:source});
  });
  await page.route('**/model.mjs', async route => {
   const response = await route.fetch();
   const source = (await response.text()).replace('name: `${name} ${index + 1}`','name: `${name} Alexandria Montgomery-Worthington ${index + 1}`');
   await route.fulfill({response,body:source});
  });
  await page.route('**/__axe.js', route=>route.fulfill({contentType:'application/javascript',body:readFileSync('/workspace/qa-tools/node_modules/axe-core/axe.min.js','utf8')}));
  await page.goto('http://127.0.0.1:5190/planner/');
  await page.locator('#day-2026-10-14').waitFor();
  await page.evaluate(s=>document.documentElement.style.fontSize=`${s*100}%`, scale);
  await page.locator('#day-2026-10-14').click();
  const group = page.locator('#sheet .day-staffing'), rows = group.locator('.additional-person');
  assert.equal(await rows.count(), count);
  assert.equal(await group.locator('.additional-person:visible').count(), Math.min(count,3));
  assert.deepEqual(await rows.locator('strong').allTextContents(), ['Conflict','Off','On','Unknown'].slice(4-count));
  const ids = await rows.evaluateAll(es=>es.map(e=>e.dataset.person));
  assert.equal(new Set(ids).size,count); assert.ok(!ids.includes('p0'));
  assert.ok((await rows.locator('span').allTextContents()).every(name=>name.includes('Alexandria Montgomery-Worthington')));
  if (count > 3) {
   await page.addScriptTag({url:'http://127.0.0.1:5190/__axe.js'});
   assert.deepEqual(await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:['button-name','label','color-contrast','aria-valid-attr-value']});return r.violations.map(v=>v.id);}),[]);
   const summary = group.locator('.additional-more summary');
   assert.equal(await summary.getAttribute('aria-expanded'),'false');
   await summary.focus(); await summary.press('Enter');
   await page.waitForFunction(()=>document.querySelector('.additional-more summary').getAttribute('aria-expanded')==='true');
   assert.equal(await group.locator('.additional-person:visible').count(),count);
   assert.equal(await summary.evaluate(e=>getComputedStyle(e).outlineStyle),'solid');
   assert.ok(await summary.evaluate(e=>e===document.activeElement));
   await page.evaluate(()=>scrollTo(0,0));
   await page.screenshot({path:`${out}/${engine}-${width}-text${scale*100}-expanded.png`,fullPage:true});
   await summary.press('Space');
   await page.waitForFunction(()=>document.querySelector('.additional-more summary').getAttribute('aria-expanded')==='false');
   assert.equal(await group.locator('.additional-person:visible').count(),3);
   assert.ok(await summary.evaluate(e=>e===document.activeElement));
  } else assert.equal(await group.locator('.additional-more').count(),0);
  if (!count) assert.match(await group.innerText(), /No additional people/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.getByRole('button',{name:'Make Schedule',exact:true}).click();
  assert.deepEqual(await page.locator('#sheet .day-staffing .additional-person strong').allTextContents(), ['Conflict','Off','On','Unknown'].slice(4-count));
  assert.deepEqual(errors,[]);
  results.push({engine,width,scale,count,status:'passed'}); console.log(engine,width,scale,count,'passed');
  await page.close();
 }} finally {await browser.close();}
}
writeFileSync(out+'/results.json',JSON.stringify(results,null,2));
