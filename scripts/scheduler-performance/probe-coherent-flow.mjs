import {createRequire} from 'node:module';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {assertDateReadability} from './date-readability.mjs';
const {chromium,webkit}=createRequire(import.meta.url)('/workspace/cloud-tools/node_modules/playwright');
const engine=process.env.BROWSER||'chromium',out=process.env.EVIDENCE_DIR||'/tmp/coherent-flow';mkdirSync(out,{recursive:true});
const browser=await {chromium,webkit}[engine].launch(engine==='chromium'?{executablePath:'/usr/bin/chromium',args:['--no-sandbox']}:{}),results=[];
async function swipe(frame, selector, dx, dy=0, edge=false) {
 return frame.locator(selector).first().evaluate((target,{dx,dy,edge})=>{
  const rect=target.getBoundingClientRect(),x=edge?5:innerWidth/2,y=Math.max(20,rect.top+rect.height/2);
  const point=(a,b)=>({identifier:1,target,clientX:a,clientY:b,pageX:a+scrollX,pageY:b+scrollY});
  const send=(type,touches,changedTouches=touches)=>{const event=new Event(type,{bubbles:true,cancelable:true});Object.defineProperties(event,{touches:{value:touches},changedTouches:{value:changedTouches}});target.dispatchEvent(event);return event;};
  send('touchstart',[point(x,y)]);
  const move=send('touchmove',[point(x+dx,y+dy)]);
  send('touchend',[],[point(x+dx,y+dy)]);
  return move.defaultPrevented;
 },{dx,dy,edge});
}
try {for(const [width,height] of [[320,640],[390,844],[430,932]])for(const scale of [1,2]){
 const p=await browser.newPage({viewport:{width,height},hasTouch:true,reducedMotion:scale===2?'reduce':'no-preference'});p.setDefaultTimeout(12000);
 const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.clock.install({time:new Date('2026-10-14T16:00:00Z')});
 await p.route('**/__axe.js',r=>r.fulfill({contentType:'application/javascript',body:readFileSync('/workspace/qa-tools/node_modules/axe-core/axe.min.js','utf8')}));
 await p.goto('http://127.0.0.1:5190');const toggle=p.locator('.sp-calendar-toggle');await toggle.waitFor();await p.evaluate(s=>document.documentElement.style.fontSize=`${s*100}%`,scale);
 assert.equal((await toggle.innerText()).trim(),'October 2026');assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 assert.ok(await toggle.evaluate(e=>e.parentElement.parentElement.lastElementChild===e.parentElement&&e.closest('.bp-hero')!==null));
 await toggle.focus();await toggle.press('Enter');assert.equal(await toggle.getAttribute('aria-expanded'),'true');
 const date=p.locator('[data-hero-day="2026-10-14"]');assert.equal(await p.locator('[data-hero-day]').count(),31);
 assert.ok(await p.locator('[data-hero-day]').evaluateAll(es=>es.every(e=>e.scrollWidth<=e.clientWidth&&e.scrollHeight<=e.clientHeight)));
 const key=`${engine}-${width}x${height}-text${scale*100}`;await date.scrollIntoViewIfNeeded();await p.screenshot({path:`${out}/${key}-hero.png`});
 await date.click();const f=p.frames().find(f=>f.url().includes('/planner/'));await f.locator('.day-heading').waitFor();await f.evaluate(s=>document.documentElement.style.fontSize=`${s*100}%`,scale);
 assert.match(await f.locator('.day-heading').innerText(),/Oct 14, 2026/);assert.ok(await f.locator('.team-members').first().isVisible());assert.equal(await f.locator('.team-members summary').count(),0);
 assert.match(await f.locator('.team-members').first().innerText(),/Alex 1/);assert.ok(await f.locator('#edit-day').isVisible());
 await f.locator('#day-next').click();assert.match(await f.locator('.day-heading').innerText(),/Oct 15, 2026/);await f.locator('#day-previous').click();
 await swipe(f,'.day-heading',-120);assert.match(await f.locator('.day-heading').innerText(),/Oct 15, 2026/);await swipe(f,'.day-heading',120);assert.match(await f.locator('.day-heading').innerText(),/Oct 14, 2026/);
 await f.locator('.day-heading').evaluate(e=>{const r=document.createRange();r.selectNodeContents(e);getSelection().removeAllRanges();getSelection().addRange(r);});assert.equal(await swipe(f,'.day-heading',-120),false);assert.match(await f.locator('.day-heading').innerText(),/Oct 14, 2026/);await f.evaluate(()=>getSelection().removeAllRanges());
 await f.locator('#edit-day').click();const before=await f.locator('[name=assigned]:checked').evaluateAll(es=>es.map(e=>e.value));await f.locator('[name=assigned][value=p0]').uncheck();
 assert.equal(await swipe(f,'.day-heading',-120),false);assert.match(await f.locator('.day-heading').innerText(),/Oct 14, 2026/);assert.equal(await f.locator('[name=assigned][value=p0]').isChecked(),false);
 await f.locator('#cancel-day').click();assert.ok(await f.locator('#edit-day').isVisible());await f.locator('#edit-day').click();assert.deepEqual(await f.locator('[name=assigned]:checked').evaluateAll(es=>es.map(e=>e.value)),before);
 await f.locator('[name=assigned][value=p0]').uncheck();await f.getByRole('button',{name:'Apply day override',exact:true}).click();assert.match(await f.locator('.day-heading').innerText(),/Oct 14, 2026/);assert.ok(await f.locator('#edit-day').isVisible());
 await f.locator('#edit-day').click();assert.equal(await f.locator('[name=assigned][value=p0]').isChecked(),false);await f.locator('#cancel-day').click();
 await p.screenshot({path:`${out}/${key}-day.png`});await f.getByRole('button',{name:'Month calendar',exact:true}).click();assert.equal(await f.evaluate(()=>document.activeElement.id),'day-2026-10-14');
 assert.equal(await f.locator('.compact-key').count(),0);assert.equal(await f.locator('.month-glance').count(),0);
 assert.ok(await f.locator('#today').isVisible());await f.evaluate(()=>scrollTo(0,0));await assertDateReadability(f);
 assert.equal(await f.locator('.month-day > .staff-status > svg:visible').count(),31);
 assert.ok(await f.locator('.month-day > .staff-status').evaluateAll(es=>es.every(e=>['none','normal','""'].includes(getComputedStyle(e,'::after').content))));
 const layout=await f.evaluate(()=>({columns:getComputedStyle(document.querySelector('.month-days')).gridTemplateColumns.split(' ').length,overflow:document.documentElement.scrollWidth>innerWidth,last:document.querySelector('[data-day="2026-10-31"]').getBoundingClientRect().bottom,height:innerHeight}));assert.equal(layout.columns,scale===1?7:2);assert.equal(layout.overflow,false);if(scale===1)assert.ok(layout.last<=layout.height+100, "month remains compact above the connected roster");
 await p.screenshot({path:`${out}/${key}-month.png`});
 const surface=scale===1?'.weekday-heading':'.calendar-swipe-strip';if(scale===2)assert.ok(await f.locator(surface).isVisible());assert.equal(await swipe(f,surface,-100,0,true),false);assert.equal(await f.locator('#month').inputValue(),'2026-10');assert.equal(await swipe(f,surface,5,120),false);assert.equal(await f.locator('#month').inputValue(),'2026-10');
 assert.equal(await swipe(f,'#next',-100),false);assert.equal(await f.locator('#month').inputValue(),'2026-10');
 await swipe(f,surface,-100);assert.equal(await f.locator('#month').inputValue(),'2026-11');await swipe(f,surface,100);assert.equal(await f.locator('#month').inputValue(),'2026-10');
 await f.locator('#next').click();await f.locator('#day-2026-11-03').click();await f.locator('#edit-day').click();await f.getByRole('button',{name:'Apply day override',exact:true}).click();assert.match(await f.locator('.day-heading').innerText(),/Nov 3, 2026/);
 await f.getByRole('button',{name:'Month calendar',exact:true}).click();await f.locator('#today').click();assert.match(await f.locator('.day-heading').innerText(),/Oct 14, 2026/);
 await f.locator('#sales-key').click();assert.ok(await f.locator('#sales-help').evaluate(e=>e.matches(':popover-open')));assert.equal(await f.locator('.icon-key svg').count(),6);await f.getByRole('button',{name:'Close sales key',exact:true}).click();assert.equal(await f.evaluate(()=>document.activeElement.id),'sales-key');
 await f.addScriptTag({url:'http://127.0.0.1:5190/__axe.js'});assert.deepEqual(await f.evaluate(async()=>{const r=await axe.run(document,{runOnly:['button-name','label','color-contrast','aria-valid-attr-value']});return r.violations.map(v=>v.id);}),[]);
 await f.evaluate(()=>dispatchEvent(new CustomEvent('scheduler-view',{detail:{day:'2026-10-14',store:'fictional-1'}})));assert.match(await f.locator('.team-members').first().innerText(),/Alex 2/);await p.getByRole('button',{name:'Return to Performance'}).click();await date.click();assert.match(await f.locator('.team-members').first().innerText(),/Alex 1/);assert.equal(await f.locator('#store').count(),0);assert.match(await f.locator('.day-heading').innerText(),/Oct 14, 2026/);
 await p.getByRole('button',{name:'Return to Performance'}).click();assert.ok(await date.evaluate(e=>e===document.activeElement));assert.equal(await toggle.getAttribute('aria-expanded'),'true');await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 assert.deepEqual(errors,[]);results.push({engine,width,height,scale,layout,taps:{openDay:2,teamMembers:0,editDay:1,today:1},status:'passed'});console.log(key,'passed');await p.close();
}}finally{await browser.close();}
writeFileSync(out+'/results.json',JSON.stringify(results,null,2));
