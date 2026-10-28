import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
import {installRpcAdapter} from './rpc-fixture-adapter.mjs';
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
const appDataRoute = async route => {
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
};
await context.route('http://127.0.0.1:5433/rest/v1/app_data?**', appDataRoute);
const rpcFx = await installRpcAdapter(context, { appDataRoute });
const page = await context.newPage(), errors = [];
page.setDefaultTimeout(20000);
page.setDefaultNavigationTimeout(30000);
await page.addInitScript(() => localStorage.setItem('lpc:last-view','sage-demo'));
page.on('pageerror', e => errors.push(e.message));

const out=process.env.VIEWPORT_OUT || 'manager-viewports';
await mkdir(out,{recursive:true});const results=[],failures=[],searchChecks=[],settling=[];
let expectedViewport;
// A viewport switch can precede React's responsive render and WebKit's style
// update. Observe the requested state and stable geometry, not elapsed time.
async function renderedState(){
 return page.evaluate(()=>{
  const rect=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
  const root=getComputedStyle(document.documentElement),stack=getComputedStyle(document.querySelector('.topstack'));
  const update=document.querySelector('.bp-upd.sg-updated');
  return {width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,
   rootFont:parseFloat(root.fontSize),insets:Object.fromEntries(['top','bottom','left','right'].map(side=>[side,parseFloat(root.getPropertyValue(`--shell-inset-${side}`))])),
   consumedTop:parseFloat(stack.paddingTop)+parseFloat(stack.borderTopWidth),
   phone:!!document.querySelector('.bp-page'),desktop:!!document.querySelector('.s2-hero.s2-hasrail'),
   updateFont:update?parseFloat(getComputedStyle(update).fontSize):null,
   header:rect(document.querySelector('.topbar')),
   controls:[...document.querySelectorAll('.topbar button,.topbar select,.sect-chip,.botnav>button,.search-input,.search-clear,.assoc-search-done')].filter(n=>n.getBoundingClientRect().width).map(n=>({text:n.textContent,font:getComputedStyle(n).fontSize,...rect(n)})),
   nav:[...document.querySelectorAll('.botnav>button')].filter(n=>n.getBoundingClientRect().width).map(rect)};
 });
}
async function settleViewport(name,stage){
 const {width,height,scale,insets}=expectedViewport;
 let previous='',stable=0,last;const samples=[];
 for(let attempt=0;attempt<50;attempt++){
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.evaluate(()=>document.fonts.ready);
  last=await renderedState();
  const ready=last.width===width&&last.height===height&&last.rootFont===16*scale
   &&Object.keys(insets).every(side=>last.insets[side]===insets[side])
   &&last.consumedTop===insets.top
   &&(width<=760?last.phone&&!last.desktop&&last.updateFont===12*scale:last.desktop&&!last.phone);
  const current=JSON.stringify(last);stable=ready&&current===previous?stable+1:0;previous=current;
  samples.push({attempt,ready,stable,...last});
  if(stable>=4){settling.push({name,stage,samples});return last;}
  await page.waitForTimeout(100);
 }
 settling.push({name,stage,samples});
 assert.fail(`${name}/${stage}: requested viewport, text scale and insets did not settle: ${JSON.stringify(last)}`);
}
async function checkSearch(name,stage,insets){
 await settleViewport(name,stage);
 const check=await page.evaluate(()=>{
  const rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
  const nav=rect(document.querySelector('.botnav'));
  const controls=['.search-input','.search-clear','.assoc-search-done'].map(selector=>{
   const n=document.querySelector(selector),box=rect(n),visible=getComputedStyle(n).visibility!=='hidden';
   // Input's right edge contains its separate Clear button; sample its editable area.
   const right=selector==='.search-input'?box.right-48:box.right-6;
   const cx=(box.x+right)/2,cy=(box.y+box.bottom)/2;
   const points=[[cx,box.y+6],[cx,box.bottom-6],[box.x+6,cy],[right,cy],[cx,cy]];
   return {selector,...box,visible,disabled:n.disabled,overlap:box.x<nav.right&&box.right>nav.x&&box.y<nav.bottom&&box.bottom>nav.y,
    hits:points.map(([x,y])=>{const hit=document.elementFromPoint(x,y);return{x,y,ok:hit===n||n.contains(hit),hit:hit?.className||hit?.tagName}})};
  });return {nav,controls};
 });
 searchChecks.push({name,stage,...check});
 for(const c of check.controls){
  if(!c.visible){assert.equal(c.selector,'.search-clear');assert.equal(c.disabled,true);continue;}
  assert.ok(c.y>=insets.top&&c.bottom<=420-insets.bottom,`${name}/${stage}/${c.selector}: viewport bounds`);
  assert.ok(!c.overlap,`${name}/${stage}/${c.selector}: intersects fixed navigation`);
  assert.ok(c.hits.every(p=>p.ok),`${name}/${stage}/${c.selector}: hit targets unobscured`);
 }
}

const nativeSource=await readFile('native/App.js','utf8');
const insetTemplate=nativeSource.match(/const insetJs = useMemo\(\(\) => `([\s\S]*?)`, \[insets.top/)[1];
const insetScript=new Function('insets','return `'+insetTemplate+'`;');
await page.goto(url);await page.locator('input[type="password"]').waitFor();await page.locator('input[type="email"],input[autocomplete="username"]').fill('demo@sageonline.app');await page.locator('input[type="password"]').fill('x');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.locator('.bp-row').first().waitFor();
try{
 for(const mode of ['web','android-inset-contract'])for(const [width,height] of [[320,844],[360,800],[390,844],[393,851],[412,915],[844,393],[768,1024],[1024,768],[1280,800]])for(const scale of [1,2]){
  const name=`${mode}-${width}x${height}-text${scale*100}`;
  try{
   await page.setViewportSize({width,height});
   const insets=mode==='web'?{top:0,bottom:0,left:0,right:0}:width>height?{top:0,bottom:24,left:24,right:24}:{top:24,bottom:24,left:0,right:0};
   await page.evaluate(insetScript(insets));
   await page.evaluate(scale=>{document.documentElement.style.fontSize=`${16*scale}px`;document.querySelectorAll('.sect-chip').forEach(n=>{n.style.removeProperty('font-size');if(scale===2)n.style.fontSize=`${parseFloat(getComputedStyle(n).fontSize)*2}px`});scrollTo(0,0)},scale);
   expectedViewport={width,height,scale,insets};
   const settled=await settleViewport(name,'initial');
   const g=await page.evaluate(()=>{
    const rect=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
    return{width:innerWidth,scroll:document.documentElement.scrollWidth,header:rect(document.querySelector('.topbar')),controls:[...document.querySelectorAll('.topbar button,.topbar select,.sect-chip,.botnav>button')].filter(n=>n.getBoundingClientRect().width).map(n=>({text:n.textContent,...rect(n)})),nav:[...document.querySelectorAll('.botnav>button')].filter(n=>n.getBoundingClientRect().width).map(rect)};
   });results.push({name,insets,...g});await page.screenshot({path:`${out}/${name}.png`});
   assert.deepEqual(await renderedState(),settled,`${name}: screenshot and measured layout agree`);
   assert.ok(g.scroll<=width+1,`${name}: page fits`);
   for(const c of g.controls){assert.ok(c.x>=insets.left-1&&c.right<=width-insets.right+1,`${name}: ${c.text} clear of side insets`);assert.ok(c.y>=insets.top-1,`${name}: ${c.text} clear of top inset`);}
   if(width<=760){assert.equal(g.nav.length,4);assert.ok(g.nav.every(n=>n.bottom<=height-insets.bottom+1),'navigation clear of bottom inset');
    const trigger=page.locator('.assoc-search-trigger'),field=page.getByPlaceholder('Search associates',{exact:true});await trigger.click();await field.pressSequentially('Alex');await page.getByRole('button',{name:'Clear search',exact:true}).click();assert.equal(await field.inputValue(),'');assert.ok(await field.evaluate(n=>n===document.activeElement));await field.pressSequentially('Sam');await page.setViewportSize({width,height:420});expectedViewport={width,height:420,scale,insets};
    await checkSearch(name,'typed-resized',insets);await page.screenshot({path:`${out}/${name}-keyboard-resize.png`});
    const clear=page.getByRole('button',{name:'Clear search',exact:true}),done=page.getByRole('button',{name:'Done',exact:true});
    for(let cycle=0;cycle<2;cycle++){
     await field.click();await checkSearch(name,`refocus-${cycle}`,insets);
     await clear.click();assert.equal(await field.inputValue(),'');assert.ok(await field.evaluate(n=>n===document.activeElement));await checkSearch(name,`cleared-${cycle}`,insets);
     await field.pressSequentially('Sam');await checkSearch(name,`retyped-${cycle}`,insets);
     await done.click();assert.equal(await field.inputValue(),'Sam');assert.ok(await trigger.evaluate(n=>n===document.activeElement));
     await trigger.click();await checkSearch(name,`reopened-${cycle}`,insets);
    }
    await clear.click();await done.click();await page.setViewportSize({width,height});

   }
  }catch(e){failures.push({name,error:e.message});console.error(name,e.message);await page.evaluate(()=>document.querySelector('.search-top:not(.search-collapsed) .assoc-search-done')?.click());}
 }
 assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
}finally{await writeFile(`${out}/evidence.json`,JSON.stringify({engine,scope:'Browser rendering with actual wrapper inset injection; no Android emulator, WebView or native keyboard claim',identity:{testHead:process.env.SEARCH_TEST_SHA||null,runtimeCommit:process.env.SEARCH_RUNTIME_SHA||null},results,searchChecks,settling,failures,errors},null,2));await browser.close();}
rpcFx.assertNoRefusals();
