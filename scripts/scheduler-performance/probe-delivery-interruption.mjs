import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const pw=createRequire(import.meta.url)('/workspace/cloud-tools/node_modules/playwright'),results=[];
for(const engine of (process.env.BROWSER?[process.env.BROWSER]:['chromium','webkit'])){
 const browser=await pw[engine].launch(engine==='chromium'?{executablePath:'/usr/bin/chromium',args:['--no-sandbox']}:{});
 try{
  const p=await browser.newPage({viewport:{width:320,height:900},hasTouch:true,reducedMotion:'no-preference'});p.setDefaultTimeout(15000);
  await p.addInitScript(()=>{const NativeDate=Date,offset=NativeDate.parse('2026-10-14T16:00:00Z')-NativeDate.now();window.Date=new Proxy(NativeDate,{apply:()=>new NativeDate(NativeDate.now()+offset).toString(),construct:(target,args,newTarget)=>Reflect.construct(target,args.length?args:[NativeDate.now()+offset],newTarget),get:(target,key)=>key==='now'?()=>NativeDate.now()+offset:Reflect.get(target,key)});});await p.goto('http://127.0.0.1:5190/');await p.waitForFunction(()=>document.querySelector('iframe')?.contentDocument?.querySelector('#workspace'));
  const f=p.frames().find(f=>f.url().includes('/planner/'));
  for(const context of [p,f])await context.evaluate(()=>document.documentElement.style.fontSize='200%');
  const pace=p.getByRole('button',{name:/^Pace, /});await pace.click();await p.locator('[data-delivered-route]').click();await p.locator('.sp-dialog[open]').waitFor();
  assert.equal(await f.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),false);await f.locator('#day-next').tap();await f.locator('.day-motion-preview').first().waitFor({state:'attached'});
  const moving=await f.locator('.day-motion-preview').count();assert.ok(moving>0,'must observe active day motion before interrupting');
  await p.getByRole('button',{name:'Close Schedule and return to Performance',exact:true}).click();assert.equal(await f.locator('.day-motion-preview').count(),0);writeFileSync(`scripts/scheduler-performance/evidence/delivery-routing/${engine}-interruption-close-state.json`,JSON.stringify(await p.evaluate(()=>({width:innerWidth,coarse:matchMedia('(pointer:coarse)').matches,hoverNone:matchMedia('(hover:none)').matches,dialogs:[...document.querySelectorAll('dialog')].map(e=>({open:e.open})),popups:[...document.querySelectorAll('.fr-pop')].map(e=>({presence:e.dataset.presence,inert:e.inert})),inert:[...document.querySelectorAll('[inert]')].map(e=>({id:e.id,cls:e.className})),pace:[...document.querySelectorAll('.bp-l2')].map(e=>({label:e.getAttribute('aria-label'),text:e.textContent,focus:e===document.activeElement,ancestor:e.closest('[inert]')?.className,rect:e.getBoundingClientRect().toJSON()}))})),null,2));assert.equal(await pace.evaluate(e=>e===document.activeElement),true);
  await pace.click();await p.locator('[data-delivered-route]').click();await p.getByRole('button',{name:'Back to Pace',exact:true}).click();await p.getByRole('dialog',{name:'Pace',exact:true}).waitFor();
  await p.locator('.fr-x').click();await p.locator('.fr-pop').waitFor({state:'hidden'});assert.equal(await pace.evaluate(e=>e===document.activeElement),true);
  await pace.click();await p.locator('[data-delivered-route]').click();assert.equal(await p.locator('dialog[open]').count(),1);assert.equal(await p.locator('.fr-pop').count(),0);assert.equal(await f.locator('dialog[open]').count(),0);
  await p.getByRole('button',{name:'Close Schedule and return to Performance',exact:true}).click();assert.equal(await f.locator('.day-motion-preview').count(),0);
  results.push({engine,width:320,scale:2,reducedMotion:false,observedMovingPanes:moving,status:'passed'});console.log(engine,'active-motion interruption passed');
 }finally{await browser.close();}
}
writeFileSync('scripts/scheduler-performance/evidence/delivery-routing/interruption-results.json',JSON.stringify(results,null,2));
