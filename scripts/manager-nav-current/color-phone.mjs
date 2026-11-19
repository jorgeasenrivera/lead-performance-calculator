import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
import * as pagesNav from './pages-nav.mjs';
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

await mkdir('color-phone',{recursive:true});
const results=[];
const NAV_DELTA=new Set(['.sect-strip','.sect-chip','.sage-pages-nav','.sage-pages-rail > button','.sage-pages-panel > button','.manager-context-action']);
async function capture(phase,width,scale,view){
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 await page.screenshot({path:`color-phone/${phase}-${width}-${scale*100}-${view}.png`});
 const data=await page.evaluate(()=>{
  const sels=['.topbar','.sect-strip','.sect-chip','.sage-pages-nav','.sage-pages-rail > button','.sage-pages-panel > button','.botnav','.botnav-btn','.bp-hero','.manager-context-action','.qpick','.drawer'];
  const boxes=sels.flatMap(sel=>[...document.querySelectorAll(sel)].filter(n=>n.getBoundingClientRect().width).map(n=>{const r=n.getBoundingClientRect();return{sel,text:n.className,x:r.x,y:r.y,w:r.width,h:r.height}}));
  const rgb=s=>s.match(/[\d.]+/g)?.slice(0,3).map(Number);
  const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  const contrast=(a,b)=>{const l=[lum(rgb(a)),lum(rgb(b))].sort((a,b)=>b-a);return(l[0]+.05)/(l[1]+.05)};
  const bg=n=>{for(;n;n=n.parentElement){const c=getComputedStyle(n).backgroundColor;if(c!=='rgba(0, 0, 0, 0)'&&c!=='transparent')return c;}return 'rgb(255, 255, 255)'};
  const colors=['.sect-chip','.sage-pages-rail > button','.sage-pages-panel > button','.botnav-btn','.manager-context-action','.manager-context-action small','.drawer-item','.drawer-tick','.qpick-btn'].flatMap(sel=>[...document.querySelectorAll(sel)].filter(n=>n.getBoundingClientRect().width).map(n=>({sel,text:n.textContent,fg:getComputedStyle(n).color,bg:bg(n),ratio:contrast(getComputedStyle(n).color,bg(n))})));
  const borders=['.sect-strip','.assoc-search-trigger','.view-select','.manager-context-action'].flatMap(sel=>[...document.querySelectorAll(sel)].filter(n=>n.getBoundingClientRect().width).map(n=>({sel,ratio:contrast(getComputedStyle(n).borderTopColor,bg(n))})));
  const hero=document.querySelector('.bp-hero'),upper=hero?.querySelector('.bp-h5'),update=hero?.querySelector('.bp-upd');
  const heroUpperHeight=(upper?.getBoundingClientRect().height||0)+(update?update.getBoundingClientRect().height+parseFloat(getComputedStyle(update).marginBottom||0):0);
  // #542 (Jorge, 19 November): the on/off chip left the upper panel for one
  // Today's schedule control of its own under the channel row. Its height and
  // margins are the one approved addition to the hero outside the panel.
  const sched=hero?[...hero.children].filter(n=>n.classList.contains('bp-sched')):[];
  const heroScheduleHeight=sched.reduce((s,n)=>{const c=getComputedStyle(n);return s+n.getBoundingClientRect().height+parseFloat(c.marginTop||0)+parseFloat(c.marginBottom||0)},0);
  const heroScheduleText=sched.map(n=>n.textContent.trim());
  return{boxes,colors,borders,heroUpperHeight,heroScheduleHeight,heroScheduleText,stickyHeight:document.querySelector('.topstack').getBoundingClientRect().height,scroll:document.documentElement.scrollWidth,width:innerWidth};
 });
 results.push({phase,width,scale,view,...data});
 assert.ok(data.scroll<=width+1,'no horizontal overflow');
 if(phase==='after'){
  const before=results.find(x=>x.phase==='before'&&x.width===width&&x.scale===scale&&x.view===view);
  // The approved upper-panel compaction has its own before/after assertions.
  // Keep every other bound exact, including the remaining hero height.
  if(before){
  const unchanged=sample=>sample.boxes.filter(b=>!NAV_DELTA.has(b.sel)).map(b=>b.sel==='.bp-hero'?{...b,h:0,y:b.y-sample.stickyHeight}:b);
  assert.deepEqual(unchanged(data),unchanged(before),'unrelated controls retain exact geometry and the hero moves only with the approved sticky stack');
  assert.ok(data.colors.filter(c=>c.sel.startsWith('.sage-pages-rail')).length>=3,'assess new rail contrast rather than vacuous pass');
  const hero=data.boxes.find(b=>b.sel==='.bp-hero'),oldHero=before.boxes.find(b=>b.sel==='.bp-hero');
  // Only where the swap happened: a build that already had the control, or
  // still has the chip, is held to the hero height exactly as before.
  const added=before.heroScheduleText.length===0&&data.heroScheduleText.length===1?data.heroScheduleHeight:0;
  if(added){
   assert.match(data.heroScheduleText[0],/^Today\u2019s schedule/,'the one control added to the hero is today\'s schedule');
   assert.ok(added>0,'the schedule control takes its own room in the hero');
  }
  assert.ok(Math.abs((hero.h-data.heroUpperHeight-added)-(oldHero.h-before.heroUpperHeight))<.05,'hero height outside the approved upper panel is unchanged');
  }else assert.equal(view,'pages-disclosure','only the approved new disclosure lacks a historical equivalent');
  for(const c of data.colors)assert.ok(c.ratio>=4.5,`${c.sel} text contrast ${c.ratio}`);
  for(const c of data.borders)assert.ok(c.ratio>=3,`${c.sel} UI contrast ${c.ratio}`);
 }
}
try{
 for(const phase of ['before','after']){
  await page.goto(phase==='before'?'http://127.0.0.1:5180/':url);
  await page.locator('input[type="email"],input[autocomplete="username"]').fill('demo@sageonline.app');await page.locator('input[type="password"]').fill('x');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.locator('.bp-row').first().waitFor();await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(1000);
  if(phase==='after')assert.ok(await pagesNav.hasPages(page),'new nav present on candidate only');
  for(const width of [320,390])for(const scale of [1,2]){
   await page.setViewportSize({width,height:844});
   await page.evaluate(scale=>{document.documentElement.style.fontSize=`${16*scale}px`;document.querySelectorAll('.sect-chip').forEach(n=>{n.style.removeProperty('font-size');if(scale===2)n.style.fontSize=`${parseFloat(getComputedStyle(n).fontSize)*2}px`})},scale);
   await page.evaluate(()=>scrollTo(0,0));await capture(phase,width,scale,'performance');
   if(phase==='after'){
    await pagesNav.openPages(page);await pagesNav.geometry(page,{drawer:true});
    await capture(phase,width,scale,'pages-disclosure');await pagesNav.closePages(page);
   }

   for(const view of ['Rooms','More']){await page.locator('.botnav').getByRole('button',{name:view,exact:true}).click();await page.waitForTimeout(250);await capture(phase,width,scale,view.toLowerCase());await page.keyboard.press('Escape');}
  }
 }
 assert.deepEqual(errors,[]);
}finally{await writeFile('color-phone/evidence.json',JSON.stringify({engine,results,errors},null,2));await browser.close();}
