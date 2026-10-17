import {createRequire} from 'node:module';import {mkdirSync,writeFileSync} from 'node:fs';import assert from 'node:assert/strict';
const pw=createRequire(import.meta.url)('/workspace/cloud-tools/node_modules/playwright'),out=process.env.EVIDENCE_DIR||'/tmp/sage-haptics';mkdirSync(out,{recursive:true});const results=[];
for(const engine of (process.env.BROWSERS||'chromium,webkit').split(',')){
 const browser=await pw[engine].launch(engine==='chromium'?{executablePath:'/usr/bin/chromium',args:['--no-sandbox']}:{});
 try{for(const transport of (process.env.TRANSPORTS||'native,browser,error,absent').split(',')){
  const p=await browser.newPage({viewport:{width:390,height:900},hasTouch:true,reducedMotion:'reduce'});p.setDefaultTimeout(15000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
  try{
   await p.addInitScript(mode=>{window.hapticCalls=[];window.hapticWrites=[];Object.defineProperty(navigator,'vibrate',{configurable:true,value:mode==='absent'?undefined:pattern=>{window.hapticCalls.push({transport:'browser',pattern});return true;}});if(mode==='native'||mode==='error')window.ReactNativeWebView={postMessage:message=>{window.hapticCalls.push({transport:'native',message:JSON.parse(message)});if(mode==='error')throw Error('Unavailable native transport');}};},transport);
   await p.goto('http://127.0.0.1:5190/');await p.locator('.sect-chip').first().waitFor();await p.evaluate(()=>{for(const name of ['setItem','removeItem','clear']){const old=Storage.prototype[name];Storage.prototype[name]=function(...args){window.hapticWrites.push(name);return old.apply(this,args);};}});
   const read=async()=>p.evaluate(()=>window.hapticCalls.splice(0));
   const expect=async names=>{await p.evaluate(()=>new Promise(r=>queueMicrotask(r)));const calls=await read();if(transport==='absent'){assert.deepEqual(calls,[]);return;}assert.equal(calls.length,names.length,JSON.stringify(calls));assert.ok(calls.every(c=>c.transport===(transport==='browser'?'browser':'native')));if(transport!=='browser')assert.deepEqual(calls.map(c=>c.message.payload.name),names);return calls;};
   const coach=p.locator('.sect-chip').filter({hasText:'Coaching'}),dashboard=p.locator('.sect-chip').filter({hasText:'Dashboard'});
   await coach.tap();await expect(['tick']);await coach.tap();await expect([]);await dashboard.click();await expect([]);await coach.focus();await p.keyboard.press('Enter');await expect([]);await dashboard.tap();await expect(['tick']);
   await p.locator('.sp-about').evaluate(e=>e.open=true);const pref=p.locator('.sp-touch-preference select');await pref.selectOption('0');await coach.tap();await expect([]);await pref.selectOption('quiet');await dashboard.tap();await expect(['tick']);await pref.selectOption('full');
   // Exercise delayed feedback against cancellation and disabled/inert contacts.
   const cancellation=await p.evaluate(async()=>{
    const el=document.createElement('button');el.textContent='Test contact';document.body.append(el);
    const event=(type,detail={})=>el.dispatchEvent(new PointerEvent(type,{bubbles:true,button:0,isPrimary:true,pointerType:'touch',...detail}));
    const semantic=detail=>{document.dispatchEvent(new CustomEvent('sage-preview-haptic',{detail}));return detail;};
    const cases=[];
    for(const kind of ['pointercancel','touchcancel','scroll','drag','keyboard','superseded','disabled','inert']){
     el.disabled=kind==='disabled';el.inert=kind==='inert';const r=el.getBoundingClientRect();event('pointerdown',{clientX:r.x+2,clientY:r.y+2});const token=semantic({op:'capture'}).token;
     if(kind==='drag')event('pointermove',{clientX:r.x+20,clientY:r.y+20});else if(kind==='keyboard')document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab'}));else if(kind==='superseded')event('pointerdown',{pointerType:'mouse'});else if(!['disabled','inert'].includes(kind))document.dispatchEvent(new Event(kind));
     await Promise.resolve();cases.push({kind,delivered:semantic({op:'emit',name:'taken',token}).delivered});
    }el.remove();return cases;
   });assert.ok(cancellation.every(c=>!c.delivered),JSON.stringify(cancellation));await expect([]);
   await p.locator('.sp-calendar-toggle').click();await p.locator('[data-hero-day]').first().click();await p.waitForFunction(()=>document.querySelector('iframe')?.contentDocument?.querySelector('#workspace'));const f=p.frames().find(f=>f.url().includes('/planner/'));
   await f.locator('#sheet [data-close]').click();await f.locator('#period-heading').click();await f.locator('#month').fill('2026-11');await f.locator('#month').press('Tab');await f.locator('#workspace').tap();await expect(['tick']);
   await f.locator('#day-2026-11-04').tap();await expect(['tick']);await f.locator('#sheet [data-close]').click();await f.locator('#day-2026-11-04').tap();await expect([]);
   const status=f.locator('[data-status-person=p0]');const touchChoice=async(value)=>{await status.evaluate((el,value)=>{const r=el.getBoundingClientRect();el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,isPrimary:true,pointerType:'touch',clientX:r.x+5,clientY:r.y+5}));el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));},value);};
   await touchChoice('On');await expect(['tick']);await touchChoice('On');await expect([]);
   await f.getByRole('button',{name:'Apply day',exact:true}).tap();await expect(['taken']);
   await f.locator('#sheet [data-close]').click();await f.locator('.month-review > summary').click();await f.locator('#accept').tap();await expect(['refused']);assert.match(await f.locator('#message').innerText(),/Resolve/);
   await f.locator('#generate-month').click();await f.locator('[name=reviewed]').check();await f.locator('#generation-start').tap();await f.locator('#generation-apply').waitFor();
   const incomplete=await f.locator('#generation-ack').count();await expect(incomplete?['asked']:[]);
   if(incomplete){await f.locator('#generation-apply').tap();await expect(['refused']);assert.match(await f.locator('#generation-status').innerText(),/Acknowledge/);await f.locator('#generation-ack').check();}
   await f.locator('#generation-apply').tap();await expect(['taken']);
   // Retain an explicit touch token, then prove close invalidates its delayed result.
   await f.locator('#next').dispatchEvent('pointerdown',{button:0,isPrimary:true,pointerType:'touch',clientX:2,clientY:2});
   await f.evaluate(async()=>{const h=await import('./haptics.mjs');window.oldHaptic=h.captureHapticAction();});
   await p.getByRole('button',{name:'Return to Performance',exact:true}).click();await f.evaluate(async()=>{const h=await import('./haptics.mjs');h.feedback('taken',window.oldHaptic);});await expect([]);
   await p.evaluate(()=>dispatchEvent(new MessageEvent('message',{data:{type:'sage-preview-haptic',name:'taken'},origin:'https://other.invalid',source:window})));await expect([]);
   assert.deepEqual(await p.evaluate(()=>window.hapticWrites),[]);assert.deepEqual(errors,[]);await p.locator('.sp-about').evaluate(e=>e.open=true);await p.screenshot({path:`${out}/${engine}-${transport}.png`});results.push({engine,transport,status:'passed',mouseKeyboardQuiet:true,preferences:true,changedOnly:true,applyAfterSuccess:true,failedReviewRefused:true,noStaleReplay:true,noPersistenceWrites:true});console.log(engine,transport,'passed');
  }catch(error){await p.screenshot({path:`${out}/${engine}-${transport}-failure.png`}).catch(()=>{});throw error;}finally{await p.close();writeFileSync(out+'/results.json',JSON.stringify(results,null,2));}
 }}finally{await browser.close();}
}
