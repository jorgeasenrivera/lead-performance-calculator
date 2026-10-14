import {readFile} from 'node:fs/promises';
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

const out=process.env.ROOM_OUT || 'room-hero-colors';
await mkdir(out,{recursive:true});const results=[],failures=[];
const nativeSource=await readFile('native/App.js','utf8');
const insetTemplate=nativeSource.match(/const insetJs = useMemo\(\(\) => `([\s\S]*?)`, \[insets.top/)[1];
const insetScript=new Function('insets','return `'+insetTemplate+'`;');
try{
 await page.clock.setFixedTime(new Date('2026-10-14T14:00:00Z'));
 await page.goto(url);await page.locator('input[type="password"]').waitFor();await page.locator('input[type="email"],input[autocomplete="username"]').fill('demo@sageonline.app');await page.locator('input[type="password"]').fill('x');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.locator('.bp-row').first().waitFor();
 for(const room of ['Live Floor','Phone Line']){
  await page.setViewportSize({width:393,height:851});
  await page.locator('.botnav').getByRole('button',{name:'Rooms',exact:true}).click();
  await page.locator('.qpick').getByRole('button',{name:room,exact:true}).click();
  await page.locator('.fr-hero,.sd-hero').waitFor();await page.waitForFunction(()=>!document.querySelector('.floor-load'));
  for(const mode of ['web','android-inset-contract'])for(const width of [320,360,393,412,1280])for(const scale of [1,2]){
   const name=`${room.replaceAll(' ','-')}-${mode}-${width}-text${scale*100}`;
   try{
    await page.setViewportSize({width,height:900});
    const insets=mode==='web'?{top:0,bottom:0,left:0,right:0}:{top:24,bottom:24,left:0,right:0};await page.evaluate(insetScript(insets));
    await page.evaluate(scale=>{document.documentElement.style.fontSize=`${16*scale}px`;scrollTo(0,0)},scale);
    await page.evaluate(()=>document.fonts.ready);
    // Wait through responsive component replacement and the map's measured fit.
    await page.waitForTimeout(200);
    await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))});
    let previous='',stable=0;
    for(let attempt=0;attempt<30&&stable<5;attempt++){
     const current=await page.locator('.fr-hero,.sd-hero').evaluate(n=>JSON.stringify([n.getBoundingClientRect().toJSON(),...[...n.querySelectorAll('.fr-planvp,.sd-body')].map(x=>x.getBoundingClientRect().toJSON())]));
     stable=current===previous?stable+1:0;previous=current;await page.waitForTimeout(100);
    }
    assert.ok(stable>=5,`${name}: responsive geometry settled`);
    const g=await page.locator('.fr-hero,.sd-hero').evaluate(n=>{
     const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {width:innerWidth,scroll:document.documentElement.scrollWidth,hero:{x:r.x,width:r.width,height:r.height},background:s.background,color:s.color,overlay:getComputedStyle(n,'::after').background,
      text:n.innerText,children:[...n.querySelectorAll('.sg-room-head,.sd-next,.sd-who,.sd-panel,.sg-signal-detail,.sd-inwarn,.fh-up')].map(c=>{const r=c.getBoundingClientRect(),s=getComputedStyle(c);return{class:c.className,x:r.x,y:r.y,width:r.width,height:r.height,background:s.background,color:s.color}})};
    });results.push({name,...g});
    await page.locator('.fr-hero,.sd-hero').screenshot({path:`${out}/${name}.png`});
    assert.ok(g.scroll<=width+1,`${name}: page fits`);assert.ok(g.hero.x>=-1&&g.hero.x+g.hero.width<=width+1,`${name}: hero fits`);
   }catch(e){failures.push({name,error:e.message});console.error(name,e.message);}
  }
  await page.setViewportSize({width:393,height:851});await page.evaluate(()=>{document.documentElement.style.fontSize='16px'});
  await page.locator('.botnav').getByRole('button',{name:'Performance',exact:true}).click();await page.locator('.bp-row').first().waitFor();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
}finally{await writeFile(`${out}/evidence.json`,JSON.stringify({engine,results,failures,errors},null,2));await browser.close();}
