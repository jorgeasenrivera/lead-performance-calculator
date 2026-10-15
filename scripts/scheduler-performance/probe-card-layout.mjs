import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {assertDateReadability} from './date-readability.mjs';
const {chromium,webkit}=createRequire(import.meta.url)('/workspace/cloud-tools/node_modules/playwright');
const root=new URL('../../dist-harness/scheduler-performance/planner/',import.meta.url);
const out=process.env.EVIDENCE_DIR||'/tmp/card-layout';mkdirSync(out,{recursive:true});const results=[];
for(const engine of process.env.BROWSER?[process.env.BROWSER]:['chromium','webkit']){
 const b=await {chromium,webkit}[engine].launch(engine==='chromium'?{executablePath:'/usr/bin/chromium',args:['--no-sandbox']}:{});
 try{for(const width of process.env.WIDTH?[Number(process.env.WIDTH)]:[320,360,390,430,768,1440])for(const scale of process.env.SCALE?[Number(process.env.SCALE)]:[1,2]){
  const p=await b.newPage({viewport:{width,height:1000},reducedMotion:'reduce'}),key=`${engine}-${width}-text${scale*100}`;p.setDefaultTimeout(12000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.clock.install({time:new Date('2026-10-14T16:00:00Z')});
  await p.route('**/assignment-view.mjs',r=>r.fulfill({contentType:'application/javascript',body:readFileSync(new URL('assignment-view.mjs',root),'utf8').replaceAll('Oak team','NorthwestCommercialFleetAndInternetSalesTeam').replaceAll('Pine team','Pine customer experience and delivery team')}));
  await p.route('**/model.mjs',r=>r.fulfill({contentType:'application/javascript',body:readFileSync(new URL('model.mjs',root),'utf8').replace('name: `${name} ${index + 1}`','name: `${name} AlexandriaMontgomeryWorthington ${index + 1}`')}));
  await p.goto('http://127.0.0.1:5190/planner/');await p.locator('#day-2026-10-14').waitFor();await p.evaluate(s=>document.documentElement.style.fontSize=`${s*100}%`,scale);
  const fit=async()=>{
   await assertDateReadability(p);
   const failures=await p.locator('.month-day').evaluateAll(cards=>cards.flatMap(card=>{
    const bad=[],bounds=card.getBoundingClientRect(),walker=document.createTreeWalker(card,NodeFilter.SHOW_TEXT),rects=[];
    while(walker.nextNode()) {const n=walker.currentNode;if(!n.textContent.trim())continue;for(const m of n.textContent.matchAll(/\S+/g)){const range=document.createRange();range.setStart(n,m.index);range.setEnd(n,m.index+m[0].length);for(const r of range.getClientRects()){if(!r.width||!r.height)continue;if(r.left<bounds.left-1||r.right>bounds.right+1||r.top<bounds.top-1||r.bottom>bounds.bottom+1)bad.push('text leaves card: '+m[0]);rects.push(r);}}}
    for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],b=rects[j];if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)bad.push('text overlap');}
    if(card.scrollWidth>card.clientWidth+1)bad.push('card horizontal overflow');return bad.map(x=>card.id+': '+x);
   }));assert.deepEqual(failures,[]);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  };
  await fit();assert.equal(await p.locator('#day-2026-10-03 .staff-team').first().getAttribute('data-state'),'Partly on');
  const mixed=await p.locator('#day-2026-10-14 .staff-count strong').allTextContents();assert.equal(mixed.map(Number).reduce((a,b)=>a+b,0),2,'additional people exclude team members');
  assert.match(await p.locator('#day-2026-10-10 .day-sales').innerText(),/Units Delivered: 0/);assert.match(await p.locator('#day-2026-10-01 .day-sales').innerText(),/unknown/);assert.match(await p.locator('#day-2026-10-04 .day-sales').innerText(),/Closed/);assert.match(await p.locator('#day-2026-10-05 .staff-status').innerText(),/Needs schedule/);
  await p.locator('#day-2026-10-02').scrollIntoViewIfNeeded();await p.screenshot({path:`${out}/${key}-mixed.png`});
  await p.locator('.demo-options summary').click();await p.locator('#mode').selectOption('individual');await fit();assert.equal(await p.locator('.staff-team').count(),0);assert.equal((await p.locator('#day-2026-10-14 .staff-count strong').allTextContents()).map(Number).reduce((a,b)=>a+b,0),6);
  await p.locator('#mode').selectOption('team');await fit();assert.equal(await p.locator('.staff-people').count(),0);await p.locator('#mode').selectOption('mixed');
  await p.locator('#day-2026-10-02').click();assert.match(await p.locator('#sheet .issues').innerText(),/AlexandriaMontgomeryWorthington/);await p.locator('.day-context summary').click();assert.match(await p.locator('.day-context').innerText(),/AlexandriaMontgomeryWorthington/);assert.match(await p.locator('.day-context').innerText(),/eligible people/);assert.ok(await p.locator('.day-context').evaluate(e=>e.scrollWidth<=e.clientWidth));await p.screenshot({path:`${out}/${key}-detail.png`});await p.locator('#workspace').click();const sheetFit=await p.locator('#sheet').evaluate(e=>({scroll:e.scrollWidth,width:e.clientWidth,doc:document.documentElement.scrollWidth,viewport:innerWidth,active:document.activeElement.outerHTML,overflow:[...e.querySelectorAll('*')].filter(n=>n.getBoundingClientRect().right>e.getBoundingClientRect().right||n.scrollWidth>n.clientWidth+1).map(n=>({tag:n.tagName,cls:n.className,text:n.textContent.slice(0,80),width:n.getBoundingClientRect().width,right:n.getBoundingClientRect().right,scroll:n.scrollWidth,client:n.clientWidth}))}));if(sheetFit.scroll>sheetFit.width){console.log(JSON.stringify(sheetFit));await p.screenshot({path:`${out}/${key}-overflow.png`});}assert.ok(sheetFit.scroll<=sheetFit.width);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await p.screenshot({path:`${out}/${key}-editor.png`});assert.deepEqual(errors,[]);results.push({engine,width,scale,status:'passed',fixture:'long team/person names; mixed, individual and team modes'});console.log(key,'passed');await p.close();
 }}finally{await b.close();}
}
writeFileSync(out+'/results.json',JSON.stringify(results,null,2));
