import {createRequire} from 'node:module';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const pw=createRequire(import.meta.url)('/workspace/cloud-tools/node_modules/playwright');
const out=process.env.EVIDENCE_DIR||'scripts/scheduler-performance/evidence/delivery-routing';mkdirSync(out,{recursive:true});
const results=[];
const configs=[[390,1,'reduce'],[320,2,'no-preference'],[1440,1,'reduce']].filter(([w])=>!process.env.WIDTH||w===+process.env.WIDTH);
for(const engine of (process.env.BROWSER?[process.env.BROWSER]:['chromium','webkit'])){
 const browser=await pw[engine].launch(engine==='chromium'?{executablePath:'/usr/bin/chromium',args:['--no-sandbox']}:{});
 try{for(const [width,scale,motion] of configs){
  if(process.env.SKIP===engine+'-'+width)continue;
  const key=`${engine}-${width}-text${scale*100}`,p=await browser.newPage({viewport:{width,height:900},hasTouch:width<=700,reducedMotion:motion}),errors=[];
  p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(()=>{const NativeDate=Date,offset=NativeDate.parse('2026-10-14T16:00:00Z')-NativeDate.now();window.Date=new Proxy(NativeDate,{apply:()=>new NativeDate(NativeDate.now()+offset).toString(),construct:(target,args,newTarget)=>Reflect.construct(target,args.length?args:[NativeDate.now()+offset],newTarget),get:(target,key)=>key==='now'?()=>NativeDate.now()+offset:Reflect.get(target,key)});});
  await p.route('**/__axe.js',r=>r.fulfill({contentType:'application/javascript',body:readFileSync('/workspace/qa-tools/node_modules/axe-core/axe.min.js','utf8')}));
  await p.goto('http://127.0.0.1:5190/');if(width>700){await p.getByRole('button',{name:'Close the round-up'}).waitFor();await p.evaluate(()=>document.fonts.ready);await p.getByRole('button',{name:'Close the round-up'}).click();}
  await p.waitForFunction(()=>document.querySelector('iframe[title="Monthly schedule planner"]')?.contentDocument?.querySelector('#workspace'));
  const f=p.frames().find(f=>f.url().includes('/planner/'));await f.locator('#workspace').waitFor({state:'attached'});
  for(const context of [p,f])await context.evaluate(s=>{document.documentElement.style.fontSize=s*100+'%';window.routeWrites=[];for(const name of ['setItem','removeItem','clear']){const old=Storage.prototype[name];Storage.prototype[name]=function(...args){window.routeWrites.push({method:name,key:args[0],stack:new Error().stack});return old.apply(this,args);};}const old=indexedDB.open.bind(indexedDB);indexedDB.open=(...args)=>{window.routeWrites.push('idb');return old(...args);};},scale);
  await p.evaluate(()=>document.fonts.ready);const requests=[];p.on('request',r=>{if(!r.url().endsWith('/__axe.js'))requests.push({url:r.url(),method:r.method()});});
  const scan=async(context,selector)=>{await context.addScriptTag({url:'http://127.0.0.1:5190/__axe.js'});const result=await context.evaluate(async selector=>{const r=await axe.run(selector,{runOnly:['button-name','label','color-contrast','aria-valid-attr-value']});return r.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}));},selector);assert.deepEqual(result,[]);};
  const oneSurface=async()=>{assert.equal(await p.locator('.fr-pop').count(),0);assert.equal(await p.locator('dialog[open]').count(),1);assert.equal(await f.locator('dialog[open]').count(),0);};
  const fit=async()=>{for(const context of [p,f])assert.ok(await context.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'document overflow');};
  let textGrowth=[];
  if(width<=700){
   const units=p.getByRole('button',{name:/^Units, /}),pace=p.getByRole('button',{name:/^Pace, /});
   const values={units:await units.innerText(),pace:await pace.innerText()};
   await units.click();await p.getByRole('dialog',{name:'Units',exact:true}).waitFor();
   if(scale===2){textGrowth=await p.evaluate(()=>{const selectors=['.fr-nm.bp-nm','.bp-ask small','[data-delivered-route]'],read=()=>selectors.map(q=>parseFloat(getComputedStyle(document.querySelector(q)).fontSize));document.documentElement.style.fontSize='100%';const before=read();document.documentElement.style.fontSize='200%';const after=read();return selectors.map((selector,i)=>({selector,before:before[i],after:after[i],ratio:after[i]/before[i]}));});for(const row of textGrowth)assert.ok(row.ratio>=1.99&&row.ratio<=2.01,JSON.stringify(row));}
   const monthly=await p.locator('.bp-ask').innerText();assert.ok(monthly.includes('65'));assert.match(monthly,/selling days elapsed/);assert.equal(await p.locator('.bp-swg').count(),0);assert.equal(await p.getByText('Sold by day',{exact:true}).count(),0);
   assert.ok(await p.locator('.fr-sheet').evaluate(e=>e.scrollWidth<=e.clientWidth),'context overflow');await scan(p,'.fr-sheet');await p.screenshot({path:`out/${key}-units.png`.replace('out/',out+'/')});
   // Month summary remains a context sheet, not a duplicate daily grid.
   await p.getByRole('button',{name:'Month summary',exact:true}).click();await p.getByRole('dialog',{name:'Month summary',exact:true}).waitFor();assert.ok(await p.locator('.fr-sheet').evaluate(e=>e.scrollWidth<=e.clientWidth),'month context overflow');await scan(p,'.fr-sheet');await p.screenshot({path:`${out}/${key}-month-summary.png`});
   await p.getByRole('button',{name:'Back to Units',exact:true}).click();assert.equal(await p.locator('.bp-ask').innerText(),monthly);
   await p.locator('[data-delivered-route]').click();await p.locator('.sp-dialog[open]').waitFor();await oneSurface();
   assert.match(await f.locator('.recorded-day').innerText(),/Delivered\s*Unknown/);
   // Close a day, navigate a month, choose a dated value and return to the source.
   await f.locator('#sheet [data-close]').click();await f.locator('#day-2026-10-13').click();assert.match(await f.locator('.recorded-day').innerText(),/Delivered\s*6\b/);await f.locator('#sheet [data-close]').click();await f.locator('#next').click();await f.locator('#day-2026-11-04').click();
   await p.getByRole('button',{name:'Back to Units',exact:true}).click();await p.getByRole('dialog',{name:'Units',exact:true}).waitFor();
   assert.equal(await p.locator('[data-delivered-route]').evaluate(e=>e===document.activeElement),true);assert.equal(await p.locator('.bp-ask').innerText(),monthly);
   await p.locator('[data-delivered-route]').click();await oneSurface();assert.match(await f.locator('.day-heading').innerText(),/Nov 4, 2026/);assert.match(await f.locator('.recorded-day').innerText(),/Pending/);
   await fit();await scan(p,'.sp-dialog-bar');await scan(f,'#app');await p.screenshot({path:`${out}/${key}-dated-delivered.png`});
   // Interrupt an active day movement with Close; its stale frame must not return.
   await f.locator('#day-next').tap();await p.getByRole('button',{name:'Close Schedule and return to Performance',exact:true}).click();
   await p.locator('.sp-dialog').waitFor({state:'hidden'});assert.equal(await units.evaluate(e=>e===document.activeElement),true);assert.equal(await f.locator('.day-motion-preview').count(),0);assert.equal(await p.locator('.fr-pop').count(),0);
   await pace.click();await p.getByRole('dialog',{name:'Pace',exact:true}).waitFor();assert.equal(await p.locator('.bp-ask').innerText(),monthly);
   await p.getByRole('button',{name:'Month summary',exact:true}).click();await p.locator('[data-delivered-route]').click();await oneSurface();
   await p.getByRole('button',{name:'Back to Month summary',exact:true}).click();await p.getByRole('dialog',{name:'Month summary',exact:true}).waitFor();assert.equal(await p.locator('[data-delivered-route]').evaluate(e=>e===document.activeElement),true);
   await p.getByRole('button',{name:'Back to Pace',exact:true}).click();
   // Repeat with keyboard. Escape first closes day detail, then Schedule.
   await p.locator('[data-delivered-route]').focus();await p.keyboard.press('Tab');await p.keyboard.press('Shift+Tab');assert.equal(await p.locator('[data-delivered-route]').evaluate(e=>getComputedStyle(e).outlineStyle),'solid');await p.keyboard.press('Enter');await oneSurface();await f.locator('.day-heading').focus();await p.keyboard.press('Escape');await f.locator('#mobile-day-dialog').waitFor({state:'hidden'});await p.keyboard.press('Escape');await p.getByRole('dialog',{name:'Pace',exact:true}).waitFor();
   assert.equal(await p.locator('[data-delivered-route]').evaluate(e=>e===document.activeElement),true);
   await p.locator('.fr-x').click();await p.locator('.fr-pop').waitFor({state:'hidden'});assert.equal(await pace.evaluate(e=>e===document.activeElement),true);
   assert.deepEqual({units:await units.innerText(),pace:await pace.innerText()},values);
   // Capture the current editor for the separate, later simplification audit.
   if(width===390){await units.click();await p.locator('[data-delivered-route]').click();await oneSurface();await f.locator('#sheet [data-close]').click();await f.locator('#workspace').click();await f.locator('#day-2026-11-04').click();await p.screenshot({path:`${out}/${key}-make-schedule-viewport.png`});await f.locator('#app').screenshot({path:`${out}/${key}-make-schedule-full.png`});writeFileSync(`${out}/${key}-editor-contents.json`,JSON.stringify(await f.evaluate(()=>({headings:[...document.querySelectorAll('#app h2,#app h3')].filter(e=>e.getClientRects().length).map(e=>e.textContent),tools:[...document.querySelectorAll('.editor-tools button')].map(e=>e.textContent),details:[...document.querySelectorAll('#app details>summary')].filter(e=>e.getClientRects().length).map(e=>e.textContent)})),null,2));await p.getByRole('button',{name:'Close Schedule and return to Performance',exact:true}).click();}
  }else{
   const entry=p.locator('.sp-calendar-entry');await entry.click();await oneSurface();assert.equal(await p.getByText('Sold by day',{exact:true}).count(),0);assert.equal(await p.getByRole('button',{name:'Return to Performance',exact:true}).count(),1);await fit();await scan(f,'#app');await p.screenshot({path:`${out}/${key}-desktop.png`});await p.getByRole('button',{name:'Return to Performance',exact:true}).click();assert.equal(await entry.evaluate(e=>e===document.activeElement),true);
  }
  for(const context of [p,f])assert.deepEqual(await context.evaluate(()=>window.routeWrites),[]);
  assert.deepEqual(requests.filter(r=>r.method!=='GET'||!['http://127.0.0.1:5190/fonts/geist-latin.woff2','http://127.0.0.1:5190/fonts/geist-mono-latin.woff2','http://127.0.0.1:5190/fonts/space-grotesk-latin.woff2'].includes(r.url)),[],'only static font reads, no network writes or other requests');assert.deepEqual(errors,[]);
  results.push({engine,width,scale,motion,textGrowth,status:'passed',noNestedDialogs:true,staticFontReads:requests.length,networkWrites:0,persistenceWrites:0});writeFileSync(`${out}/${key}-result.json`,JSON.stringify(results.at(-1),null,2));console.log(key,'passed');await p.close();
 }}finally{await browser.close();}
}
writeFileSync(`${out}/results${process.env.BROWSER?'-'+process.env.BROWSER:''}.json`,JSON.stringify(results,null,2));
