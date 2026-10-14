import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
const engine = process.env.FEEL_BROWSER || 'chromium';
const url = process.env.FEEL_URL || 'http://127.0.0.1:5178/';
const browser = await ({ chromium, webkit }[engine]).launch({ headless: true, ...(engine === "webkit" && process.env.FEEL_WEBKIT ? { executablePath: process.env.FEEL_WEBKIT } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 667 },
  isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
let fixtureRole='admin', dockFixture=null, singleStore=false;
await context.route('http://127.0.0.1:5433/rest/v1/profiles?**', async route => {
  const response = await route.fetch(); const data = await response.json();
  const manager = p => ({ ...p, role: fixtureRole, wants: 'manager', onboarded: true,
    stores:singleStore?['sage-demo']:['sage-demo','spacing-demo-2'] });
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
await mkdir('search-keyboard', { recursive: true });
const evidence=[];
async function measure(state){return page.evaluate(state=>{
 const rect=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}};
 const input=document.querySelector('.search-input'),style=getComputedStyle(input),vv=visualViewport;
 return{state,input:rect(input),header:rect(document.querySelector('.topbar')),tabs:rect(document.querySelector('.sect-strip')),hero:rect(document.querySelector('.bp-hero')),focused:document.activeElement===input,query:input.value,textAlign:style.textAlign,placeholderAlign:getComputedStyle(input,'::placeholder').textAlign,boxShadow:style.boxShadow,outline:style.outlineStyle,viewport:{width:vv.width,height:vv.height,offsetTop:vv.offsetTop,scale:vv.scale,innerHeight,scrollY}};
},state)}
try{
 for(const phase of ['baseline','corrected']){
  const target=phase==='baseline'?'http://127.0.0.1:5179/':url;
  await page.setViewportSize({width:390,height:844});await page.goto(target);
  await page.locator('input[type="email"],input[autocomplete="username"]').fill('demo@sageonline.app');await page.locator('input[type="password"]').fill('x');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.locator('.bp-row').first().waitFor({timeout:40000});await page.evaluate(()=>document.fonts.ready);
  for(const width of [320,390]){
   await page.setViewportSize({width,height:844});await page.evaluate(()=>scrollTo(0,0));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const trigger=page.locator('.assoc-search-trigger'),field=page.getByPlaceholder('Search associates',{exact:true});
   await page.screenshot({path:`search-keyboard/${phase}-${width}-closed.png`});
   if(!await field.isVisible())await trigger.click();
   await page.setViewportSize({width,height:420});await field.focus();
   await field.fill('');const states=[await measure('empty')];await page.screenshot({path:`search-keyboard/${phase}-${width}-keyboard-sized-empty.png`});
   for(const [name,query] of [['first','A'],['long','no-such-fictional-associate-long-query']]){
    await field.fill(query);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));states.push(await measure(name));await page.screenshot({path:`search-keyboard/${phase}-${width}-keyboard-sized-${name}.png`});
   }
   await page.locator('.search-top .search-clear').click();states.push(await measure('clear'));await page.screenshot({path:`search-keyboard/${phase}-${width}-keyboard-sized-clear.png`});
   evidence.push({phase,width,simulation:'Mobile WebKit viewport reduced to 420 CSS px with focused input; no native iOS keyboard or accessory emulation',states});
   if(phase==='corrected'){
    for(const state of states){assert.ok(state.focused);assert.equal(state.textAlign,'left');assert.equal(state.placeholderAlign,'left');assert.equal(state.boxShadow,'none');assert.equal(state.outline,'none');assert.ok(state.input.bottom<=state.viewport.height+state.viewport.offsetTop,'input visible above simulated keyboard');for(const key of ['x','y','width','height'])assert.ok(Math.abs(state.input[key]-states[0].input[key])<1,`input ${key} stable across query edits`);assert.equal(state.tabs.y,states[0].tabs.y);}
    assert.equal(await page.locator('.sage-bp-store').count(),0);assert.match(await page.locator('.bp-hero').first().getAttribute('aria-label'),/^Performance for /);
   }
   if(phase==='corrected'){await field.fill('Alex');await page.locator('.search-top .search-clear').focus();await page.keyboard.press('Enter');assert.equal(await field.inputValue(),'');assert.ok(await field.evaluate(n=>n===document.activeElement));}
   await field.fill('Alex');await page.getByRole('button',{name:'Done',exact:true}).click();assert.equal(await field.inputValue(),'Alex');assert.ok(await trigger.evaluate(n=>n===document.activeElement));assert.match(await trigger.innerText(),/Alex/);
   await page.setViewportSize({width,height:844});await trigger.click();await page.keyboard.press('Escape');assert.equal(await field.inputValue(),'Alex');
   await trigger.click();await field.fill('');if(phase==='corrected'){await page.keyboard.press('Enter');assert.equal(await field.isVisible(),false);}else await page.getByRole('button',{name:'Done',exact:true}).click();
   await page.evaluate(()=>scrollTo(0,500));await trigger.click();const scrolled=await measure('opened-after-scroll');evidence.push({phase,width,scrolled});if(phase==='corrected')assert.ok(scrolled.input.y>=scrolled.tabs.bottom-1&&scrolled.input.bottom<844,'search remains attached below sticky tabs after scrolling');await page.getByRole('button',{name:'Done',exact:true}).click();await page.evaluate(()=>scrollTo(0,0));
  }
 }
 fixtureRole='manager';singleStore=true;await page.setViewportSize({width:390,height:844});await page.reload();await page.locator('.bp-row').first().waitFor();assert.equal(await page.locator('.view-select').count(),0);assert.ok(await page.locator('.manager-store-name').isVisible());assert.equal(await page.locator('.manager-store-name').innerText(),'Sage Demo Motors');await page.screenshot({path:'search-keyboard/corrected-single-store-identity.png'});evidence.push({singleStoreIdentity:true});
 assert.deepEqual(errors,[]);
}finally{await writeFile('search-keyboard/evidence.json',JSON.stringify({engine,evidence,errors},null,2));console.log(JSON.stringify({engine,evidence,errors}));await browser.close();}
