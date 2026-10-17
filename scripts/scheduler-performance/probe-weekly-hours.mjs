import {createRequire} from 'node:module';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {chromium,webkit}=createRequire(import.meta.url)('/workspace/cloud-tools/node_modules/playwright');
const out=process.env.EVIDENCE_DIR||'scripts/scheduler-performance/evidence/weekly-hours';mkdirSync(out,{recursive:true});
const results=[];
for(const engine of (process.env.BROWSER?[process.env.BROWSER]:['chromium','webkit'])){
 const browser=await {chromium,webkit}[engine].launch(engine==='chromium'?{executablePath:'/usr/bin/chromium',args:['--no-sandbox']}:{});
 try{for(const [width,scale] of [[1440,1],[390,1],[390,2]].filter(([w])=>!process.env.WIDTH||w===Number(process.env.WIDTH))){
  const p=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),key=`${engine}-${width}-text${scale*100}`,errors=[];
  p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(12000);
  await p.clock.install({time:new Date('2026-10-14T16:00:00Z')});
  await p.route('**/__axe.js',r=>r.fulfill({contentType:'application/javascript',body:readFileSync('/workspace/qa-tools/node_modules/axe-core/axe.min.js','utf8')}));
  await p.goto('http://127.0.0.1:5190/planner/');await p.locator('#workspace').waitFor();
  await p.evaluate(s=>document.documentElement.style.fontSize=`${s*100}%`,scale);
  await p.locator('#next').click();await p.locator('#workspace').click();await p.locator('#people').click();
  assert.match(await p.locator('#settings-sheet').innerText(),/Unconfirmed preview setting/);
  await p.locator('#settings-sheet [name=start]').fill('0');await p.locator('#settings-sheet [name=end]').fill('23');await p.locator('#settings-sheet [name=maxHours]').fill('80');await p.locator('#settings-sheet [name=confirmCap]').check();
  for(const box of await p.locator('#settings-sheet [name=off]').all())await box.uncheck();
  await p.locator('#settings-sheet').getByRole('button',{name:'Apply changes',exact:true}).click();
  await p.locator('#rules').click();await p.locator('#settings-sheet [name=open]').fill('0');await p.locator('#settings-sheet [name=close]').fill('23');
  for(const box of await p.locator('#settings-sheet [name=closedDays]').all())await box.uncheck();
  await p.locator('#settings-sheet form button[type=submit], #settings-sheet form button.primary').click();
  await p.evaluate(()=>{window.auditWrites=[];for(const k of ['setItem','removeItem','clear']){const old=Storage.prototype[k];Storage.prototype[k]=function(...args){window.auditWrites.push(k);return old.apply(this,args);};}const old=indexedDB.open.bind(indexedDB);indexedDB.open=(...args)=>{window.auditWrites.push('idb');return old(...args);};});
  const requests=[];p.on('request',r=>{if(!r.url().endsWith('/__axe.js'))requests.push(r.url());});
  await p.locator('#import-schedule').click();
  const csv='Person ID,Date,Start,End\n'+Array.from({length:6},(_,i)=>`p0,2026-11-0${i+2},00:00,${i===5?'00:01':'10:00'}`).join('\n');
  await p.locator('#schedule-file').setInputFiles({name:'weekly-synthetic.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await p.locator('.import-row').first().waitFor();assert.equal(await p.locator('#apply-import').isDisabled(),false);
  const audit=p.locator('#import-review .weekly-hours-audit');await audit.locator('summary').click();assert.match(await audit.innerText(),/At least 50:01.*00:01 above/);
  await audit.screenshot({path:`${out}/${key}-review.png`});
  await p.locator('#apply-import').click();await p.locator('#people').click();
  const applied=p.locator('#settings-sheet .weekly-hours-audit');await applied.locator('summary').click();
  // Select the week with imported work, not the previous boundary week.
  await p.locator('#settings-sheet [data-close]').click();await p.locator('#day-2026-11-02').click();assert.match(await p.locator('#selected-week-audit summary').innerText(),/2026-11-02 to 2026-11-08/);await p.locator('#people').click();
  const selected=p.locator('#settings-sheet .weekly-hours-audit');await selected.locator('summary').click();
  assert.match(await selected.innerText(),/50:01.*00:01 above/);assert.match(await selected.innerText(),/Break information unavailable/);
  assert.match(await p.locator('#settings-sheet').innerText(),/Manager-confirmed hard cap/);
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await p.addScriptTag({url:'http://127.0.0.1:5190/__axe.js'});
  assert.deepEqual(await p.evaluate(async()=>{const r=await axe.run(document,{runOnly:['button-name','label','color-contrast','aria-valid-attr-value']});return r.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}));}),[]);
  await p.locator('#settings-sheet').screenshot({path:`${out}/${key}-people.png`});
  assert.deepEqual(await p.evaluate(()=>window.auditWrites),[]);assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
  results.push({engine,width,scale,status:'passed',axeScans:1,networkRequests:0,storageWrites:0});writeFileSync(`${out}/${key}-result.json`,JSON.stringify(results.at(-1),null,2));console.log(key,'passed');await p.close();
 }}finally{await browser.close();}
}
writeFileSync(`${out}/results${process.env.BROWSER?'-'+process.env.BROWSER:''}.json`,JSON.stringify(results,null,2));
