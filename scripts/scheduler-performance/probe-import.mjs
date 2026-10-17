import {createRequire} from 'node:module';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {chromium,webkit}=createRequire(import.meta.url)('/workspace/cloud-tools/node_modules/playwright');
const engine=process.env.BROWSER||'chromium',out=process.env.EVIDENCE_DIR||'/tmp/import-browser';mkdirSync(out,{recursive:true});
const browser=await {chromium,webkit}[engine].launch(engine==='chromium'?{executablePath:'/usr/bin/chromium',args:['--no-sandbox']}:{}),results=[];
const file=text=>({name:'synthetic.csv',mimeType:'text/csv',buffer:Buffer.from(text)});
const csv='Name,Date,Start,End,Status\nUnmatched <img src=x>,2026-11-04,09:15,16:45,work\nBlair 1,2026-11-04,09:15,16:45,work\nEllis 1,2026-11-04,,,off';
try{for(const width of [1440,390,320])for(const scale of [1,2]){
 const p=await browser.newPage({viewport:{width,height:900},hasTouch:width<700,reducedMotion:'reduce'});p.setDefaultTimeout(12000);
 const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.clock.install({time:new Date('2026-10-14T16:00:00Z')});
 await p.route('**/__axe.js',r=>r.fulfill({contentType:'application/javascript',body:readFileSync('/workspace/qa-tools/node_modules/axe-core/axe.min.js','utf8')}));
 await p.goto('http://127.0.0.1:5190/planner/');await p.locator('.day-heading').waitFor();await p.evaluate(()=>document.fonts.ready);await p.evaluate(s=>document.documentElement.style.fontSize=`${s*100}%`,scale);
 await p.locator('#next').click();await p.locator('#day-2026-11-04').click();await p.locator('#edit-day').click();await p.locator('[name=assigned][value=p4]').check();await p.getByRole('button',{name:'Apply day override',exact:true}).click();await p.locator('#workspace').click();
 await p.evaluate(()=>{window.importWrites=[];for(const name of ['setItem','removeItem','clear']){const original=Storage.prototype[name];Storage.prototype[name]=function(...args){window.importWrites.push('storage:'+name);return original.apply(this,args);};}const original=indexedDB.open.bind(indexedDB);indexedDB.open=(...args)=>{window.importWrites.push('indexedDB:open');return original(...args);};const beacon=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=(...args)=>{window.importWrites.push('beacon');return beacon(...args);};});
 const requests=[];p.on('request',r=>{if(!r.url().endsWith('/__axe.js'))requests.push({url:r.url(),method:r.method()});});
 const storage=()=>p.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]));const originalStorage=await storage();
 const open=async()=>{await p.locator('#import-schedule').click();await p.locator('#schedule-file').waitFor();};
 await open();await p.locator('#schedule-file').setInputFiles(file(csv));await p.locator('.import-row').first().waitFor();assert.ok(await p.locator('#apply-import').isDisabled());assert.equal(await p.locator('#import-review img').count(),0);
 await p.locator('#cancel-import').click();assert.equal(await p.evaluate(()=>document.activeElement.id),'import-schedule');assert.equal(await p.locator('.imported-shifts').count(),0);
 await open();await p.locator('#schedule-file').setInputFiles({name:'unsupported.xlsx',mimeType:'application/octet-stream',buffer:Buffer.from('synthetic')});await p.waitForFunction(()=>document.querySelector('#import-status').textContent.includes('CSV rows only'));assert.ok(await p.locator('#apply-import').isDisabled());
 await p.locator('#schedule-file').setInputFiles(file(csv));await p.locator('.import-row').first().waitFor();await p.locator('[data-person="0"]').selectOption('p0');assert.ok(await p.locator('#apply-import').isDisabled());assert.match(await p.locator('.import-row').nth(2).innerText(),/Existing work conflicts/);await p.locator('[data-skip="2"]').check();assert.equal(await p.locator('#apply-import').isDisabled(),false);
 assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await p.locator('#apply-import').focus();await p.keyboard.press('Shift+Tab');await p.keyboard.press('Tab');assert.ok(await p.locator('#apply-import').evaluate(e=>getComputedStyle(e).outlineStyle!=='none'));
 const key=`${engine}-${width}-text${scale*100}`;await p.locator('#import-sheet').screenshot({path:`${out}/${key}-review.png`});
 await p.addScriptTag({url:'http://127.0.0.1:5190/__axe.js'});const scan=async()=>assert.deepEqual(await p.evaluate(async()=>{const r=await axe.run(document,{runOnly:['button-name','label','color-contrast','aria-valid-attr-value']});return r.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}));}),[]);await scan();
 // Two immediate handlers use the same review but can only apply it once.
 await p.locator('#apply-import').evaluate(button=>{button.onclick();button.onclick();});assert.equal(await p.locator('#import-sheet').isVisible(),false);
 assert.match(await p.locator('.imported-shifts').innerText(),/09:15 to 16:45/);assert.equal(await p.locator('.imported-shifts li').count(),2);assert.ok(await p.locator('[name=assigned][value=p4]').isChecked());assert.match(await p.locator('.coverage-gaps').innerText(),/09:00 to 09:15: 1\/2/);assert.match(await p.locator('.coverage-gaps').innerText(),/16:45 to 17:00: 1\/2/);
 await p.locator('.imported-shifts').screenshot({path:`${out}/${key}-applied.png`});await scan();
 // Manual day apply preserves the imported intervals and provenance.
 await p.getByRole('button',{name:'Apply day override',exact:true}).click();assert.equal(await p.locator('.imported-shifts li').count(),2);
 await open();await p.locator('#schedule-file').setInputFiles(file(csv.replace('Unmatched <img src=x>','Alex 1').split('\n').slice(0,3).join('\n')));await p.waitForFunction(()=>document.querySelector('#import-status').textContent.includes('2 already present'));await p.locator('#apply-import').click();assert.equal(await p.locator('.imported-shifts li').count(),2);
 // A late read is discarded after cancellation, even if it finishes later.
 await p.evaluate(()=>{window.originalFileText=File.prototype.text;File.prototype.text=function(){return new Promise(resolve=>window.finishRead=()=>resolve('Name,Date,Start,End\nAlex 1,2026-11-05,09:15,16:45'));};});
 await open();await p.locator('#schedule-file').setInputFiles(file('delayed'));await p.locator('#cancel-import').click();await p.evaluate(()=>{window.finishRead();File.prototype.text=window.originalFileText;});await p.evaluate(()=>Promise.resolve());assert.equal(await p.locator('#import-sheet').isVisible(),false);assert.equal(await p.locator('.imported-shifts li').count(),2);
 // A newer file wins over a late earlier read.
 await p.evaluate(()=>{window.originalFileText=File.prototype.text;File.prototype.text=function(){return this.name==='late.csv'?new Promise(resolve=>window.finishOld=()=>resolve('Name,Date,Start,End\nWrong,2026-11-06,09:00,17:00')):window.originalFileText.call(this);};});
 await open();await p.locator('#schedule-file').setInputFiles({...file('late'),name:'late.csv'});await p.locator('#schedule-file').setInputFiles(file('Name,Date,Start,End\nAlex 1,2026-11-05,09:15,16:45'));await p.locator('.import-row').waitFor();await p.evaluate(()=>{window.finishOld();File.prototype.text=window.originalFileText;});assert.match(await p.locator('.import-row').innerText(),/2026-11-05/);await p.locator('#cancel-import').click();
 // Store navigation closes a review and cannot transfer equal person IDs.
 await open();await p.locator('#schedule-file').setInputFiles(file('Name,Date,Start,End\nAlex 1,2026-11-05,09:15,16:45'));await p.locator('.import-row').waitFor();await p.evaluate(()=>dispatchEvent(new CustomEvent('scheduler-view',{detail:{day:'2026-11-04',store:'fictional-1'}})));assert.equal(await p.locator('#import-sheet').isVisible(),false);assert.equal(await p.locator('.imported-shifts').count(),0);await p.evaluate(()=>dispatchEvent(new CustomEvent('scheduler-view',{detail:{day:'2026-11-04',store:'fictional-0'}})));assert.equal(await p.locator('.imported-shifts li').count(),2);
 assert.equal(await storage(),originalStorage);assert.deepEqual(await p.evaluate(()=>window.importWrites),[]);assert.deepEqual(requests,[],'no network requests during file/read/review/apply');assert.deepEqual(errors,[]);
 results.push({engine,width,scale,axeScans:2,networkRequests:requests.length,storageUnchanged:true,databaseOrStorageCalls:0,status:'passed'});console.log(key,'passed');await p.close();
}}finally{await browser.close();}writeFileSync(out+'/results.json',JSON.stringify(results,null,2));
