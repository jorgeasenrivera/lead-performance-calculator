import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { fixtures } from "../scheduler-proposal/model.mjs";
import { createPlanner, recordedDay, monthSales } from "./month-model.mjs";
import { assertDateReadability } from "./date-readability.mjs";
const engines = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "/workspace/cloud-tools/node_modules/playwright");
const axe = readFileSync(process.env.AXE_PATH || "/workspace/qa-tools/node_modules/axe-core/axe.min.js", "utf8");
const out = process.env.EVIDENCE_DIR || "scripts/scheduler-performance/evidence/sage-heatmap";
mkdirSync(out,{recursive:true});
const results=[];
const expectedStore=fixtures()[0],expectedRows=createPlanner([expectedStore]).rows(0,"2026-10");
const base="http://127.0.0.1:5190";
async function exceptionCase(page) {
  await page.locator('#rules').click();
  await page.locator('[name=effective]').fill('2026-10-15');
  await page.locator('[name=effective]').dispatchEvent('change');
  await page.locator('[name=minimum]').fill('3');
  await page.getByRole('button',{name:'Apply dated local rule',exact:true}).click();
  await page.locator('#rules').click();
  assert.equal(await page.locator('[name=effective]').inputValue(),'2026-10-01');
  await page.locator('[name=editHoliday]').check();
  await page.locator('[name=holiday]').fill('2026-10-23');
  await page.locator('[name=holiday]').dispatchEvent('change');
  await page.locator('[name=holidayState]').selectOption('open');
  await page.getByRole('button',{name:'Apply dated local rule',exact:true}).click();
}
async function audit(page) {
 await page.evaluate(axe);
 return page.evaluate(async()=>{
  const r=await axe.run(document,{runOnly:{type:'rule',values:['label-content-name-mismatch','color-contrast','button-name','label','select-name','aria-valid-attr-value']}});
  return r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));
 });
}
if(process.env.BASELINE==='1') {
 const b=await engines.chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 try {
  const p=await b.newPage({viewport:{width:320,height:900},reducedMotion:'reduce'});
  const old = path => execFileSync('git',['show',`c6429f66f0c90fdd21b19fb848fc2ae505582e1b:${path}`],{encoding:'utf8'});
  for(const [url,path] of [['app.mjs','scripts/scheduler-performance/month-app.mjs'],['month-model.mjs','scripts/scheduler-performance/month-model.mjs'],['store-editor.mjs','scripts/scheduler-proposal/store-editor.mjs'],['style.css','scripts/scheduler-performance/planner.css']])
   await p.route(`**/planner/${url}`,r=>r.fulfill({contentType:url.endsWith('css')?'text/css':'application/javascript',body:old(path).replace('../scheduler-proposal/model.mjs','./model.mjs')}));
  await p.clock.install({time:new Date('2026-10-14T16:00:00Z')});await p.goto(base+'/planner/index.html');
  const violations=await audit(p);await exceptionCase(p);
  const cell=await p.locator('#day-2026-10-23 .day-staffing').innerText();await p.locator('#rules').click();
  const entries=await p.locator('#sheet').innerText();
  assert.equal(cell,'Closed');assert.match(entries,/2026-10-23: open/);
  const mismatches=violations.find(v=>v.id==='label-content-name-mismatch')?.nodes.length;
  assert.equal(mismatches,31);
  writeFileSync(out+'/baseline.json',JSON.stringify({head:'c6429f66f0c90fdd21b19fb848fc2ae505582e1b',cell,entriesSaysOpen:true,labelContentNameMismatch:mismatches},null,2));
  console.log('Baseline reproduced: ignored exception and 31 label/name mismatches');
 } finally {await b.close();}
} else {
 for(const name of ['chromium','webkit']) {
  const b=await engines[name].launch(name==='chromium'?{executablePath:'/usr/bin/chromium',args:['--no-sandbox']}:{});
  try {for(const width of [1440,390,320]) for(const scale of [1,2]) {
   const p=await b.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
   await p.clock.install({time:new Date('2026-10-14T16:00:00Z')});await p.goto(base+'/planner/index.html');
   await p.evaluate(s=>document.documentElement.style.fontSize=`${s*100}%`,scale);
   await assertDateReadability(p);
   assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   for(const day of await p.locator('[data-day]').all()) {
    const visible=(await day.innerText()).replace(/\s+/g,' ').trim();
    assert.equal(await p.getByRole('button',{name:visible,exact:true}).count(),1,'accessible name retains all visible day facts');
   }
   for (const row of expectedRows) {
    const text = row.state === "open" ? `${row.ids.length} assigned / ${row.required} needed` : row.state === "closed" ? "Closed" : "Unknown hours";
    assert.equal(await p.locator(`#day-${row.day} .day-staffing`).innerText(), text);
    const sales = recordedDay(expectedStore,row.day,'2026-10-14');
    assert.ok(await p.locator(`#day-${row.day}`).evaluate((e, state)=>e.classList.contains('sales-'+state),sales.state));
   }
   const violations=await audit(p);assert.deepEqual(violations,[],`${name} ${width} ${scale} accessibility`);
   if(width===320&&scale===2) {
    await exceptionCase(p);
    assert.match(await p.locator('#day-2026-10-23 .day-staffing').innerText(),/3 needed/);
    assert.match(await p.locator('#message').innerText(),/Special day 2026-10-23: open/);
    await p.locator('#rules').click();assert.match(await p.locator('#sheet').innerText(),/2026-10-23: open/);
    await p.getByRole('button',{name:'Close sheet',exact:true}).click();
    await p.locator('#day-2026-10-23').click();assert.match(await p.locator('#sheet').innerText(),/Minimum 3/);
    assert.equal(await p.locator('#sheet').evaluate(e=>getComputedStyle(e).animationName),'none');
    await p.getByRole('button',{name:'Back to month',exact:true}).click();
   }
   if(width===1440 && scale===1) {
    await p.emulateMedia({reducedMotion:'no-preference'});
    await p.locator('#rules').click();
    assert.equal(await p.locator('#sheet').evaluate(e=>getComputedStyle(e).animationName),'sheet-arrive');
    assert.equal(await p.locator('[name=effective]').evaluate(e=>e===document.activeElement),true);
    assert.equal(await p.getByRole('button',{name:'Apply dated local rule',exact:true}).isEnabled(),true);
    await p.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await p.locator('#sheet').evaluate(e=>getComputedStyle(e).animationName),'none');
    await p.getByRole('button',{name:'Close sheet',exact:true}).click();
    await p.locator('#month').fill('2026-01');await p.locator('#month').dispatchEvent('change');
    const best=monthSales(expectedStore,'2026-01','2026-10-14').bestDays;
    assert.ok(best.length>1,'fixture includes a real best-day tie');
    assert.equal(await p.locator('.best-day').count(),best.length);
    for(const row of best) assert.match(await p.locator(`#day-${row.day} .best-day`).innerText(),/tied/);
    await p.locator('.month-days').scrollIntoViewIfNeeded();
    await p.screenshot({path:`${out}/${name}-best-day-ties.png`});
    await p.locator('#month').fill('2026-10');await p.locator('#month').dispatchEvent('change');
   }
   await p.screenshot({path:`${out}/${name}-${width}-text${scale*100}-polish.png`});
   results.push({engine:name,width,scale,accessibility:'passed',dates:'passed'});await p.close();
  }} finally {await b.close();}
 }
 const profile=mkdtempSync('/workspace/scheduler-font-');mkdirSync(profile+'/Default');
 writeFileSync(profile+'/Default/Preferences',JSON.stringify({webkit:{webprefs:{default_font_size:32,default_fixed_font_size:32}}}));
 const ctx=await engines.chromium.launchPersistentContext(profile,{executablePath:'/usr/bin/chromium',args:['--no-sandbox'],headless:true,reducedMotion:'reduce'});
 try {for(const width of [1440,390,320]) {
  const p=await ctx.newPage();await p.setViewportSize({width,height:900});await p.clock.install({time:new Date('2026-10-14T16:00:00Z')});
  if(width===1440) {
   const oldCSS=execFileSync('git',['show','c6429f66f0c90fdd21b19fb848fc2ae505582e1b:scripts/scheduler-performance/planner.css'],{encoding:'utf8'});
   await p.route('**/planner/style.css',r=>r.fulfill({contentType:'text/css',body:oldCSS}));
   await p.goto(base+'/planner/index.html');
   assert.equal(await p.evaluate(()=>getComputedStyle(document.documentElement).fontSize),'16px');
   await p.unroute('**/planner/style.css');
  }
  await p.goto(base+'/planner/index.html');
  assert.equal(await p.evaluate(()=>getComputedStyle(document.documentElement).fontSize),'32px');
  assert.equal(await p.locator('#month').evaluate(e=>getComputedStyle(e).fontSize),'32px');
  assert.equal(await p.evaluate(()=>document.documentElement.style.fontSize),'');
  await assertDateReadability(p);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(await audit(p),[]);
  await p.screenshot({path:`${out}/chromium-${width}-browser-default32.png`});
  results.push({engine:'chromium',width,browserDefaultFont:32,injectedCSSScaling:false,status:'passed'});await p.close();
 }} finally {await ctx.close();}
 writeFileSync(out+'/polish-results.json',JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),results},null,2));
 console.log('12 styling/accessibility scenarios and three real 32px browser-default cases passed');
}
