import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
const engine = process.env.FEEL_BROWSER || 'chromium';
const url = process.env.FEEL_URL || 'http://127.0.0.1:5178/';
const browser = await ({ chromium, webkit }[engine]).launch({ headless: true, ...(engine === "webkit" && process.env.FEEL_WEBKIT ? { executablePath: process.env.FEEL_WEBKIT } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 667 },
  isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
let fixtureRole='admin', dockFixture=null;
await context.route('http://127.0.0.1:5433/rest/v1/profiles?**', async route => {
  const response = await route.fetch(); const data = await response.json();
  const manager = p => ({ ...p, role: fixtureRole, wants: 'manager', onboarded: true,
    stores:['sage-demo','spacing-demo-2'] });
  await route.fulfill({ response, json: Array.isArray(data) ? data.map(manager) : manager(data) });
});
await context.route('http://127.0.0.1:5433/rest/v1/app_data?**', async route => {
  const requestUrl=route.request().url(), second=requestUrl.includes('spacing-demo-2');
  const response=await route.fetch({url:second ? requestUrl.replaceAll('spacing-demo-2','sage-demo') : requestUrl});
  const data=await response.json();
  const addStore=row=>row?.value?.stores ? {...row,value:{...row.value,
    stores:[...row.value.stores,{...row.value.stores[0],id:'spacing-demo-2',name:'Second Fictional Store'}],
    standards:{...row.value.standards,'spacing-demo-2':row.value.standards?.['sage-demo']}}}
    :second && row?.value ? {...row,key:row.key?.replace('sage-demo','spacing-demo-2'),value:{...row.value,__storeId:'spacing-demo-2'}}:row;
  const fixture=row=>{
    row=addStore(row);
    if(!dockFixture || !row?.value)return row;
    if(row.value.stores)return {...row,value:{...row.value,stores:row.value.stores.map(st=>({...st,rooms:{floor:true,line:dockFixture.rooms===2}}))}};
    if(row.value.months){
      const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date()), month=day.slice(0,7);
      const m=row.value.months[month]||{};
      return {...row,value:{...row.value,months:{...row.value.months,[month]:{...m,imports:{...m.imports,[day]:dockFixture.done===2?{appointment:true,video:true,activity:true}:dockFixture.done===1?{appointment:true}:{}}}}}};
    }
    return row;
  };
  await route.fulfill({response,json:Array.isArray(data)?data.map(fixture):fixture(data)});
});
const page = await context.newPage(), errors = [];
page.setDefaultTimeout(20000);
page.setDefaultNavigationTimeout(30000);
await page.addInitScript(() => localStorage.setItem('lpc:last-view','sage-demo'));
page.on('pageerror', e => errors.push(e.message));
await mkdir('manager-selector', { recursive: true });
const evidence=[], failures=[];
async function shot(name, log=false) {
  await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.target?.matches?.('.qpick,.drawer,.drawer-scrim,.help-sheet,.help-back') && a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
  const png=await page.screenshot({path:`manager-selector/${name}.png`});
  if(log)console.log('SELECTOR_IMAGE '+JSON.stringify({name,png:png.toString('base64')}));
}
async function check(name, fn){try{await fn();evidence.push({name,pass:true});}catch(e){failures.push({name,error:e.message});await shot('failure-'+name.replace(/[^a-z0-9]/gi,'-'));}}
async function geometry(name){
  const g=await page.evaluate(()=>{
    const rect=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}};
    const nav=document.querySelector('.botnav');
    return{width:innerWidth,scroll:document.documentElement.scrollWidth,nav:rect(nav),buttons:[...nav.querySelectorAll(':scope > button')].map(n=>({text:n.textContent,box:rect(n),font:getComputedStyle(n).fontSize,range:(()=>{const r=document.createRange();r.selectNodeContents(n);return [...r.getClientRects()].filter(r=>r.width).map(r=>({x:r.x,right:r.right,y:r.y,bottom:r.bottom}));})()})),header:rect(document.querySelector('.topbar'))};
  });evidence.push({name,...g});
  assert.ok(g.scroll<=g.width+1,'page fits');assert.equal(g.buttons.length,4);
  for(const b of g.buttons){assert.ok(b.box.w>=48 && b.box.h>=48,'comfortable full cell');assert.ok(b.range.every(r=>r.x>=b.box.x-1&&r.right<=b.box.right+1&&r.y>=b.box.y-1&&r.bottom<=b.box.bottom+1),'label fits');}
  assert.ok(g.buttons.every(b=>Math.abs(b.box.w-g.buttons[0].box.w)<1),'equal columns');
  if(name.includes('text200'))assert.equal(parseFloat(g.buttons[0].font),24,'nav labels genuinely doubled');
  const top=await page.locator('.sect-chip').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect(),r=document.createRange();r.selectNodeContents(n);return {y:b.y,bottom:b.bottom,fits:[...r.getClientRects()].every(t=>t.x>=b.x-1&&t.right<=b.right+1&&t.y>=b.y-1&&t.bottom<=b.bottom+1)};}));
  assert.ok(top.every(t=>t.y===top[0].y&&t.bottom===top[0].bottom&&t.fits),'top tabs stay one row with complete labels');
}
try{
 await page.goto(url);await page.locator('input[type="email"],input[autocomplete="username"]').fill('demo@sageonline.app');await page.locator('input[type="password"]').fill('x');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.locator('.bp-row').first().waitFor({timeout:40000});await page.evaluate(()=>document.fonts.ready);
 for(const width of [320,360,375,390,414,430,667]){
  await page.setViewportSize({width,height:width===667?320:667});
  for(const scale of [1,2])for(const inset of [0,34]){
   await page.evaluate(({scale,inset})=>{document.documentElement.style.fontSize=`${scale*16}px`;document.documentElement.style.setProperty('--sab',`${inset}px`);document.querySelectorAll('.sect-chip').forEach(n=>{n.style.removeProperty('font-size');if(scale===2)n.style.fontSize=`${parseFloat(getComputedStyle(n).fontSize)*2}px`;});},{scale,inset});
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const name=`performance-${width}-text${scale*100}-safe${inset}`;
   await shot(name,[320,390].includes(width)&&inset===0);
   await check(name,()=>geometry(name));
  }
 }
 await page.evaluate(()=>{document.documentElement.style.fontSize='16px';document.documentElement.style.setProperty('--sab','0px');document.querySelectorAll('.sect-chip').forEach(n=>n.style.removeProperty('font-size'))});await page.setViewportSize({width:320,height:667});
 await check('search',async()=>{
  const trigger=page.locator('.assoc-search-trigger'),field=page.getByPlaceholder('Search associates',{exact:true});
  assert.equal(await field.isVisible(),false);await trigger.click();assert.ok(await field.evaluate(n=>n===document.activeElement));await field.fill('no-such-fictional-associate');await page.locator('.bp-stand .fr-empty').waitFor();await page.keyboard.press('Escape');assert.ok(await trigger.evaluate(n=>n===document.activeElement));assert.match(await trigger.innerText(),/no-such/);await shot('active-query',true);await page.evaluate(()=>document.documentElement.style.fontSize='32px');await shot('active-query-text200',true);await geometry('active-query-text200');await page.evaluate(()=>document.documentElement.style.fontSize='16px');
  await trigger.click();assert.equal(await field.inputValue(),'no-such-fictional-associate');await page.getByRole('button',{name:'Clear search',exact:true}).click();assert.ok(await field.evaluate(n=>n===document.activeElement));await page.locator('.bp-row').first().waitFor();await page.getByRole('button',{name:'Done',exact:true}).click();assert.ok(await trigger.evaluate(n=>n===document.activeElement));
 });
 for(const reduced of [false,true]){
  await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});
  for(const kind of ['Rooms','More'])await check(`${kind}-${reduced}`,async()=>{
   const trigger=page.locator('.botnav').getByRole('button',{name:kind,exact:true});await trigger.focus();await page.keyboard.press('Enter');const dialog=page.locator(kind==='Rooms'?'.qpick':'.drawer');await dialog.waitFor({state:'visible'});await shot(kind.toLowerCase()+(reduced?'-reduce':''),!reduced);if(kind==='Rooms')assert.ok(await page.locator('.qpick-btn').evaluateAll(ns=>ns.every(n=>getComputedStyle(n).color==='rgb(35, 73, 57)')),'room labels retain readable foreground');if(reduced){await page.evaluate(()=>document.documentElement.style.fontSize='32px');await shot(kind.toLowerCase()+'-text200',true);assert.ok(await dialog.evaluate(n=>n.getBoundingClientRect().right<=innerWidth+1));await page.evaluate(()=>document.documentElement.style.fontSize='16px');}
   assert.ok(await dialog.evaluate(n=>n.contains(document.activeElement)));await page.keyboard.press('Shift+Tab');assert.ok(await dialog.evaluate(n=>n.contains(document.activeElement)));await page.keyboard.press('Escape');assert.ok(await trigger.evaluate(n=>n===document.activeElement));
   for(let i=0;i<3;i++){await trigger.dispatchEvent('click');await page.keyboard.press('Escape');}assert.equal(await trigger.getAttribute('aria-expanded'),'false');
  });
 }
 await check('rooms-to-more-interruption',async()=>{
  const rooms=page.locator('.botnav').getByRole('button',{name:'Rooms',exact:true}),more=page.locator('.botnav').getByRole('button',{name:'More',exact:true});
  await rooms.click();await more.click();await page.locator('.drawer-root.open').waitFor();
  assert.equal(await page.locator('.qpick').count(),0);await page.keyboard.press('Escape');assert.ok(await more.evaluate(n=>n===document.activeElement));
 });
 for(const label of ['Live Floor','Phone Line','Online'])await check(`room-${label}`,async()=>{
  await page.locator('.botnav').getByRole('button',{name:'Rooms',exact:true}).click();
  await page.locator('.qpick').getByRole('button',{name:label,exact:true}).click();
  await page.locator('.qpick').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('.botnav-btn[aria-label="Rooms"]')?.classList.contains('on'));
  await page.waitForFunction(()=>!document.querySelector('.floor-load'));await shot(`room-${label.replaceAll(' ','-')}`,label==='Phone Line');
  await page.locator('.botnav').getByRole('button',{name:'Performance',exact:true}).click();await page.locator('.bp-row').first().waitFor();
 });
 await page.emulateMedia({reducedMotion:'no-preference'});
 for(const width of [320,390])for(const scale of [1,2])await check(`help-settled-${width}-text${scale*100}`,async()=>{
  await page.setViewportSize({width,height:667});
  const more=page.locator('.botnav').getByRole('button',{name:'More',exact:true});
  await more.click();await page.locator('.drawer').getByRole('button',{name:'Help',exact:true}).click();
  const panel=page.getByRole('dialog',{name:'Help',exact:true});await panel.waitFor();
  assert.ok(await panel.evaluate(n=>n.contains(document.activeElement)),'Help takes focus');
  const textSizes=await panel.evaluate((node,scale)=>{
   const samples=[...node.querySelectorAll('h3,p,span,a,button,label,input,textarea,select')].map(n=>({n,before:parseFloat(getComputedStyle(n).fontSize)}));
   if(scale===2)samples.forEach(({n,before})=>n.style.setProperty('font-size',`${before*scale}px`,'important'));
   return samples.map(({n,before})=>({text:n.textContent.slice(0,60),before,after:parseFloat(getComputedStyle(n).fontSize)}));
  },scale);
  assert.ok(textSizes.every(s=>Math.abs(s.after-s.before*scale)<.01),'Help text enlargement is measured');
  const helpGeometry=()=>panel.evaluate(n=>{
   const tabs=[...n.querySelectorAll('.help-tab')];
   return{scrollWidth:n.scrollWidth,clientWidth:n.clientWidth,tabs:tabs.map(b=>{const r=b.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(b);return{text:b.textContent,x:r.x,right:r.right,width:r.width,height:r.height,font:getComputedStyle(b).fontSize,fits:[...range.getClientRects()].every(t=>t.x>=r.x-1&&t.right<=r.right+1&&t.y>=r.y-1&&t.bottom<=r.bottom+1)};})};
  });
  const candidateCSS=await page.evaluate(()=>{
   const sheet=[...document.querySelectorAll('style')].find(s=>s.textContent.includes('.manager-signal.manager-signal-switch'));
   const rules=[...sheet.sheet.cssRules];
   const correction=rules.find(r=>r.cssRules?.length===2&&r.cssRules[0].selectorText==='html.manager-signal .help-sheet .help-tabs');
   if(!correction)throw Error('built Help candidate rules missing');
   const css=sheet.textContent;sheet.textContent=rules.filter(r=>r!==correction).map(r=>r.cssText).join('\n');return css;
  });
  const baseline=await helpGeometry();
  await shot(`help-baseline-${width}-text${scale*100}`,true);
  await page.evaluate(css=>{const sheet=[...document.querySelectorAll('style')].find(s=>s.textContent.includes('.manager-signal.manager-signal-switch'));sheet.textContent=css;},candidateCSS);
  await shot(`help-corrected-${width}-text${scale*100}`,true);
  const corrected=await helpGeometry();evidence.push({helpComparison:{width,scale,baseline,corrected}});
  assert.ok(corrected.scrollWidth<=corrected.clientWidth,'Help no longer clips horizontally');
  assert.equal(corrected.tabs.length,3);
  assert.ok(corrected.tabs.every(t=>t.fits&&t.height>=44&&t.x>=0&&t.right<=width),'every complete category fits a reachable target');
  assert.deepEqual(corrected.tabs.map(t=>t.font),baseline.tabs.map(t=>t.font),'text is not shrunk');

  const settled=await panel.evaluate(n=>{const r=n.getBoundingClientRect(),style=getComputedStyle(n);return{opacity:style.opacity,transform:style.transform,x:r.x,y:r.y,width:r.width,height:r.height,scrollWidth:n.scrollWidth,clientWidth:n.clientWidth,scrollHeight:n.scrollHeight,clientHeight:n.clientHeight,active:document.activeElement?.getAttribute('aria-label'),running:n.getAnimations().filter(a=>a.playState==='running').length};});
  evidence.push({helpSettled:{width,scale,textSizes,...settled}});
  assert.equal(settled.opacity,'1');assert.equal(settled.running,0,'Help entrance completed naturally');
  for(const tab of await panel.locator('.help-tab').all()){
   await tab.click();assert.ok(await tab.evaluate(n=>n.classList.contains('on')),'each category remains operable');
  }
  await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
  assert.ok(await more.evaluate(n=>n===document.activeElement),'Escape returns focus to More');
 });
 await page.setViewportSize({width:320,height:667});
 await page.emulateMedia({reducedMotion:'reduce'});
 await check('activity-report',async()=>{await page.locator('.botnav').getByRole('button',{name:'Activity',exact:true}).click();await page.locator('.co-hero').waitFor();await shot('activity-320',true);await page.getByRole('button',{name:'Open the daily report',exact:true}).click();await page.locator('.dayreport-modal').waitFor();await page.locator('.dayreport-modal').getByRole('button',{name:'Close',exact:true}).click();await page.locator('.sect-chip').filter({hasText:/^Coaching$/}).click();assert.equal(await page.getByRole('button',{name:'Open the daily report',exact:true}).count(),0);});
 await page.locator('.botnav').getByRole('button',{name:'Performance',exact:true}).click();await page.locator('.bp-row').first().waitFor();
 for(const mode of [{rooms:1,done:0},{rooms:2,done:1},{rooms:2,done:2}])await check(`import-${mode.done}`,async()=>{dockFixture=mode;await page.reload();await page.locator('.bp-row').first().waitFor();const action=page.locator('.manager-context-action');assert.match(await action.getAttribute('aria-label'),new RegExp(`${mode.done} of 2`));await shot(`import-${mode.done}`);await action.click();await page.waitForFunction(()=>!document.querySelector('.bp-row'));});
 assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
}finally{await writeFile('manager-selector/evidence.json',JSON.stringify({engine,evidence,failures,errors},null,2));console.log('SELECTOR_RESULT '+JSON.stringify({engine,evidence,failures,errors}));await browser.close();}
