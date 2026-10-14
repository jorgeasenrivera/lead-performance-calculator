import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
const engine = process.env.FEEL_BROWSER || 'chromium';
const url = process.env.FEEL_URL || 'http://127.0.0.1:5178/';
const browser = await ({ chromium, webkit }[engine]).launch({ headless: true, ...(engine === "webkit" && process.env.FEEL_WEBKIT ? { executablePath: process.env.FEEL_WEBKIT } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 667 },
  isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
let fixtureRole='admin', dockFixture=null, stamp='2026-10-14T09:35:00Z', importStamp=null;
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
    if(row?.value?.months){const v=row.value;row={...row,value:{...v,importLog:stamp?[{t:importStamp||stamp}]:[],activity:Object.fromEntries(Object.entries(v.activity||{}).map(([d,rows])=>[d,Object.fromEntries(Object.entries(rows).map(([name,r])=>[name,{...r,uploadedAt:stamp}]))]))}};}

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
// Keep the fictional session valid while testing the after-cutoff clock.
await context.route('http://127.0.0.1:5433/auth/v1/token**',async route=>{
 const response=await route.fetch();const data=await response.json();await route.fulfill({response,json:{...data,expires_at:4102444800,expires_in:315360000}});
});
const page = await context.newPage(), errors = [];
page.setDefaultTimeout(20000);
page.setDefaultNavigationTimeout(30000);
await page.addInitScript(() => localStorage.setItem('lpc:last-view','sage-demo'));
page.on('pageerror', e => errors.push(e.message));

const out=process.env.FRESH_OUT||'hero-freshness';await mkdir(out,{recursive:true});const results=[],failures=[];
const nativeSource=await readFile('native/App.js','utf8');
const template=nativeSource.match(/const insetJs = useMemo\(\(\) => `([\s\S]*?)`, \[insets.top/)[1];
const insetScript=new Function('insets','return `'+template+'`;');
async function settle(){await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(200);await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))});}
async function capture(name,surface){
 await settle();const hero=page.locator(surface==='performance'?'.bp-hero:not(.co-hero),.s2-hero.s2-hasrail':'.co-hero,.da-hero').first();
 const g=await hero.evaluate(n=>{
  const box=x=>{const r=x.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
  const update=n.querySelector('.bp-upd,.co-upd');const s=update&&getComputedStyle(update),dot=update?.querySelector('i'),ds=dot&&getComputedStyle(dot);
  return{hero:box(n),width:innerWidth,scroll:document.documentElement.scrollWidth,update:update?{text:update.textContent,title:update.title,box:box(update),font:s.fontSize,weight:s.fontWeight,tracking:s.letterSpacing,lineHeight:s.lineHeight,dot:dot?{box:box(dot),color:ds.backgroundColor,shadow:ds.boxShadow,animation:ds.animationName}:null}:null,upper:n.querySelector('.bp-h5')?box(n.querySelector('.bp-h5')):null,controls:[...n.querySelectorAll('.bp-h5>button')].map(c=>({class:c.className,text:c.textContent,...box(c)}))};
 });results.push({name,surface,...g});await hero.screenshot({path:`${out}/${name}-${surface}.png`});assert.ok(g.scroll<=g.width+1,`${name}/${surface}: fits page`);
 if(g.update)assert.ok(g.update.box.x>=g.hero.x&&g.update.box.right<=g.hero.right+1,`${name}: timestamp contained`);
 for(const c of g.controls)assert.ok(c.x>=g.hero.x&&c.right<=g.hero.right+1,`${name}: ${c.class} contained`);
 return g;
}
try{
 await page.clock.setFixedTime(new Date('2026-10-14T14:00:00Z'));
 await page.goto(url);await page.locator('input[type="password"]').waitFor();await page.locator('input[type="email"],input[autocomplete="username"]').fill('demo@sageonline.app');await page.locator('input[type="password"]').fill('x');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.locator('.bp-row').first().waitFor();
 for(const mode of (process.env.FRESH_STATES_ONLY?[]:['web','android-inset-contract']))for(const width of [320,360,393,412,1280])for(const scale of [1,2]){
  const name=`${mode}-${width}-text${scale*100}`;
  try{
   await page.setViewportSize({width,height:900});await page.evaluate(insetScript(mode==='web'?{top:0,bottom:0,left:0,right:0}:{top:24,bottom:24,left:0,right:0}));await page.evaluate(scale=>{document.documentElement.style.fontSize=`${16*scale}px`;scrollTo(0,0)},scale);
   const p=await capture(name,'performance');
   await page.setViewportSize({width:Math.min(width,700),height:900});await page.locator('.botnav').getByRole('button',{name:'Activity',exact:true}).click();await page.locator('.co-hero').waitFor();await page.setViewportSize({width,height:900});const a=await capture(name,'activity');
   if(process.env.FRESH_ASSERT==='1'&&width<=700){
    assert.equal(p.update.text.trim(),'Updated 9:35 AM');assert.equal(a.update.text.trim(),p.update.text.trim());
    for(const k of ['font','weight','tracking','lineHeight'])assert.equal(a.update[k],p.update[k]);
    assert.equal(a.update.dot.color,p.update.dot.color);assert.equal(a.update.dot.box.width,p.update.dot.box.width);assert.equal(a.update.dot.shadow,'none');assert.equal(p.update.dot.shadow,'none');
   }
   await page.setViewportSize({width:Math.min(width,700),height:900});await page.locator('.botnav').getByRole('button',{name:'Performance',exact:true}).click();await page.locator('.bp-row').first().waitFor();
  }catch(e){failures.push({name,error:e.message});console.error(name,e.message);}
 }
 if(process.env.FRESH_ASSERT==='1'){
  await page.setViewportSize({width:393,height:900});await page.evaluate(()=>document.documentElement.style.fontSize='16px');await settle();
  for(const selector of ['.bp-l1','.bp-r1','.bp-l2']){
   await page.locator(selector).click();await page.locator('.fr-sheet').waitFor();await page.keyboard.press('Escape');await page.locator('.fr-sheet').waitFor({state:'hidden'});
  }
 }
 for(const state of ['different-sources','stale','missing','missed']){
  const name=`state-${state}`;stamp=state==='different-sources'?'2026-10-14T09:35:00Z':state==='stale'?'2026-10-13T17:05:00Z':null;importStamp=state==='different-sources'?'2026-10-14T10:15:00Z':null;
  await page.clock.setFixedTime(new Date(state==='missed'?'2026-10-14T22:00:00Z':'2026-10-14T14:00:00Z'));
  await page.setViewportSize({width:393,height:900});await page.evaluate(()=>document.documentElement.style.fontSize='16px');await page.reload();await page.locator('.bp-row').first().waitFor();
  const p=await capture(name,'performance');await page.locator('.botnav').getByRole('button',{name:'Activity',exact:true}).click();await page.locator('.co-hero').waitFor();const a=await capture(name,'activity');
  if(process.env.FRESH_ASSERT==='1'){
   if(importStamp){assert.equal(p.update.text.trim(),'Updated 10:15 AM');assert.equal(a.update.text.trim(),'Updated 9:35 AM');}
   else if(stamp){assert.equal(p.update.text.trim(),'Updated 5:05 PM');assert.equal(a.update.text.trim(),p.update.text.trim());assert.match(p.update.title,/Oct 13/);}
   else {assert.equal(p.update,null);assert.equal(a.update.dot,null);assert.match(a.update.text,state==='missed'?/nothing past/:/no report yet/);}
  }
  await page.locator('.botnav').getByRole('button',{name:'Performance',exact:true}).click();await page.locator('.bp-row').first().waitFor();
 }
 if(process.env.FRESH_BASELINE_FILE){
  const baseline=JSON.parse(await readFile(process.env.FRESH_BASELINE_FILE,'utf8'));
  for(const current of results.filter(x=>x.upper&&!x.name.startsWith('state-'))){
   const before=baseline.results.find(x=>x.name===current.name&&x.surface===current.surface);
   assert.ok(current.upper.height<before.upper.height,`${current.name}: Performance upper panel is shorter`);
   assert.deepEqual(current.controls.map(x=>x.text),before.controls.map(x=>x.text),`${current.name}: facts and affordances preserved`);
  }
 }
 assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
}finally{await writeFile(`${out}/evidence.json`,JSON.stringify({engine,results,failures,errors},null,2));await browser.close();}
