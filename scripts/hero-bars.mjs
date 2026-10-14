import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
const engine = process.env.FEEL_BROWSER || 'chromium';
const url = process.env.FEEL_URL || 'http://127.0.0.1:5178/';
const browser = await ({ chromium, webkit }[engine]).launch({ headless: true, ...(engine === "webkit" && process.env.FEEL_WEBKIT ? { executablePath: process.env.FEEL_WEBKIT } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 667 },
  isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
let fixtureRole='admin', dockFixture=null;
const thresholds={internet:{green:20,yellow:10},phone:{green:25,yellow:12},showroom:{green:30,yellow:15}};
let rates={internet:7,phone:18,showroom:35};
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
    if(row?.value?.stores)row={...row,value:{...row.value,stores:row.value.stores.map(st=>({...st,thresholds}))}};
    if(row?.value?.months)row={...row,value:{...row.value,months:Object.fromEntries(Object.entries(row.value.months).map(([key,m])=>[key,{...m,stats:Object.fromEntries(Object.entries(m.stats||{}).map(([name,st])=>[name,{...st,...Object.fromEntries(Object.entries(rates).flatMap(([id,pct])=>[[id+'Units',pct==null?null:Math.round(pct*1000)],[id+'Leads',pct==null?null:100000],[id+'Pct',pct==null?null:pct/100]]))}]))}]))}};
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

await mkdir('hero-bars',{recursive:true});const results=[];
const scenarios=[['mixed',[7,18,35],['bad','warn','ok']],['zero',[0,0,0],['bad','bad','bad']],['low',[.1,.1,.1],['bad','bad','bad']],['below-yellow',[9.949,11.949,14.949],['bad','bad','bad']],['round-yellow-edge',[9.95,11.95,14.95],['warn','warn','warn']],['above-round-yellow',[9.951,11.951,14.951],['warn','warn','warn']],['at-yellow',[10,12,15],['warn','warn','warn']],['below-green',[19.949,24.949,29.949],['warn','warn','warn']],['round-green-edge',[19.95,24.95,29.95],['ok','ok','ok']],['above-round-green',[19.951,24.951,29.951],['ok','ok','ok']],['rounded-up',[19.96,24.96,29.96],['ok','ok','ok']],['at-green',[20,25,30],['ok','ok','ok']],['full',[24,30,36],['ok','ok','ok']],['missing',[null,null,null],['na','na','na']]];
const colors={bad:'rgb(240, 138, 128)',warn:'rgb(228, 201, 141)',ok:'rgb(143, 216, 175)',na:'rgb(255, 255, 255)'};
try{
 for(const phase of ['before','after'])for(const width of [320,360,390,393,412]){
  await page.setViewportSize({width,height:844});
  for(const [name,values,states] of scenarios){
   rates=Object.fromEntries(Object.keys(thresholds).map((id,i)=>[id,values[i]]));
   await page.goto(phase==='before'?(process.env.HERO_BASELINE_URL||'http://127.0.0.1:5180/'):url);
   await page.locator('input[type="password"],.bp-t5').first().waitFor();
   if(await page.locator('input[type="password"]').isVisible()){await page.locator('input[type="email"],input[autocomplete="username"]').fill('demo@sageonline.app');await page.locator('input[type="password"]').fill('x');await page.getByRole('button',{name:'Sign in',exact:true}).click();}
   await page.locator('.bp-row').first().waitFor();await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(150);
   const bars=await page.locator('.bp-t5').evaluateAll(ns=>ns.map(n=>{
    const t=n.querySelector('.bp-tb'),f=t.querySelector('i'),p=n.querySelector('.bp-pct'),l=n.querySelector('.bp-tl');const tr=t.getBoundingClientRect(),fr=f.getBoundingClientRect();return {pct:p.textContent,label:l.textContent,percentColor:getComputedStyle(p).color,labelColor:getComputedStyle(l).color,fillColor:getComputedStyle(f).backgroundColor,fillHeight:f.style.height,height:fr.height,trackHeight:tr.height,bottomGap:tr.bottom-parseFloat(getComputedStyle(t).borderBottomWidth)-fr.bottom,fillRadius:getComputedStyle(f).borderBottomLeftRadius,trackRadius:getComputedStyle(t).borderBottomLeftRadius,overflow:getComputedStyle(t).overflow};
   }));results.push({phase,width,name,bars});
   if(phase==='after')for(let i=0;i<3;i++){
    const b=bars[i];assert.equal(b.fillColor,colors[states[i]],`${name}/${i} fill`);assert.equal(b.percentColor,b.fillColor);assert.equal(b.labelColor,b.fillColor);assert.equal(b.fillRadius,'0px');assert.equal(b.trackRadius,'4px');assert.equal(b.overflow,'hidden');assert.ok(Math.abs(b.bottomGap)<.02,'fill meets track inner bottom');
    if(name==='zero'||name==='missing')assert.equal(b.height,0);
    if(name==='full')assert.equal(b.fillHeight,'100%');
   }
   if(['mixed','zero','low','at-yellow','full','rounded-up','round-green-edge','round-yellow-edge'].includes(name))await page.locator('.bp-five').screenshot({path:`hero-bars/${phase}-${width}-${name}.png`});
  }
 }
 assert.deepEqual(errors,[]);
}finally{await writeFile('hero-bars/evidence.json',JSON.stringify({engine,results,errors},null,2));await browser.close();}
