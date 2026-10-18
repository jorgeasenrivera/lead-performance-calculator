import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {chromium,webkit} from 'playwright';
/* How the heroes count a figure the reports did not give, a real zero, and a figure that cannot be a measurement.
   Every case changes the video figures of a few salespeople in an otherwise complete fictional store, and the probe
   reads what a person is shown: the phone's dials, popups and "Who is below" list, and the desk's dial cards and weakest
   standard. A missing figure is "no data" and never a shortfall, a measured zero is below, and a negative or an
   infinite figure is no data.
   What each hero should say is worked out from the fixture rows this probe builds (the roster, the store's standards and
   the figures it puts in), never read back from a page: how many people a standard holds, how many are measured, below
   or missing. A page value is only ever compared with that. The probe changes no code and no mock. */
const engine=process.env.FEEL_BROWSER||'chromium';
const url=process.env.FEEL_URL||'http://127.0.0.1:5178/';
const dist=process.env.DIST_DIR||'dist';
const strict=process.env.REQUIRE_IDENTITY==='1';   // CI sets it: a run that cannot say what it tested has not tested it
const api='http://127.0.0.1:5433/rest/v1/';
const STORE='sage-demo';
const browser=await ({chromium,webkit}[engine]).launch({headless:true,...(engine==='webkit'&&process.env.FEEL_WEBKIT?{executablePath:process.env.FEEL_WEBKIT}:{})});
const VIDEO=['apptVideoDayPct','engagedVideoPct','bhVideoPct'];
const STANDARDS=[...VIDEO,'deliveredPct'];     // every standard the demo tiers name
const TINY={apptVideoDayPct:/appt video/i,engagedVideoPct:/engaged video/i,bhVideoPct:/bh video/i};
const LABEL={apptVideoDayPct:'Video Day of Appt %',engagedVideoPct:'Engaged Personalized Video %',bhVideoPct:'BH Lead Personalized Video %'};
const BY_LABEL=Object.fromEntries(Object.entries(LABEL).map(([m,l])=>[l,m]));
const CLEARED=0.95;                          // above every video bar of the fixture, which the fixture checks below
const INF='__INF__',NEG_INF='__NEG_INF__';   // JSON cannot carry Infinity: the body is rewritten to 1e999 and -1e999, which JSON.parse reads as Infinity
const norm=s=>(s||'').trim().toLowerCase().replace(/\s+/g,' ');
const sha=b=>createHash('sha256').update(b).digest('hex');
/* Each case changes the first few people of the Sales tab, by name order. Nothing here says what the page should show:
   that is worked out from the figures the case leaves, below. */
const CASES=[
  {name:'control',apply(){}},
  {name:'missing',apply:(s,[a,b,c])=>{for(const m of VIDEO){s[a][m]=null;delete s[b][m];}delete s[c];}},   // a null, an absent figure, an absent person
  {name:'zero',apply:(s,[a])=>{for(const m of VIDEO)s[a][m]=0;}},
  {name:'negative',apply:(s,[a])=>{for(const m of VIDEO)s[a][m]=-0.2;}},
  {name:'non-finite',apply:(s,[a,b])=>{for(const m of VIDEO){s[a][m]=INF;s[b][m]=NEG_INF;}}},
  {name:'mixed',apply:(s,[a,b,c,d])=>{for(const m of VIDEO){s[a][m]=0;s[b][m]=null;s[c][m]=-0.2;s[d][m]=INF;}}},
  /* A different treatment for each standard, so each has its own count and its own mean. Without it the three standards
     read alike and "the weakest card shows the count of the standard it names" could not fail. Here BH is the weakest. */
  {name:'per-standard',apply:(s,[a,b,c])=>{
    s[a].apptVideoDayPct=0;s[b].apptVideoDayPct=null;
    s[a].engagedVideoPct=0;
    s[a].bhVideoPct=0;s[b].bhVideoPct=null;s[c].bhVideoPct=-0.2;}},
  {name:'nobody',apply:s=>{for(const p of Object.values(s))for(const m of VIDEO)p[m]=null;}},
];
const notCovered=[
  'BH video list: a row has no BH dot, so "Who is below" on BH lists nobody while the dial counts people (a documented gap with a todo test). Only the BH dial and popup are asserted.',
  'Role tab: the dial counts every role and the list is the tab showing. Every figure outside the Sales tab is at the control value here, so the cases do not exercise the difference.',
  'Fallback tier: where a tier names no bar the dial uses the gentlest tier and the list uses the store threshold. The cases use only zero and a figure above every bar, which the two agree on.',
  'NaN: JSON cannot carry it, so it is covered by the unit tests of api/_standard-rollup.mjs and not here.',
  'Only the Performance hero is read. The roster rows, the person card and the import log are not.'
];
const errors=[],failures=[],seen=[];
const check=(where,what,got,want)=>{try{assert.deepEqual(got,want);}catch{failures.push({where,what,got,want});}};

/* ---- the fixture, read as rows from the mock and never from a page ---- */
const fixtureRow=async key=>(await (await fetch(`${api}app_data?key=eq.${encodeURIComponent(key)}`)).json())[0]?.value;
const doc=await fixtureRow(`lpc:store:${STORE}:v2`),config=await fixtureRow('lpc:config:v2');
const monthKey=Object.keys(doc?.months||{}).sort().pop(),baseStats=doc?.months?.[monthKey]?.stats||{},roster=doc?.roster||[];
const roleIds=new Set((config?.roles||[]).map(r=>r.id));
const tiersOf=roleId=>config?.standards?.[STORE]?.[roleId]?.tiers||[];
const asks=(roleId,m)=>tiersOf(roleId).flatMap(t=>t.requirements||[]).filter(q=>q.metric===m);
/* The people a standard holds: the roster members of every role the config knows whose tiers name it with a bar above zero. */
const heldTo=Object.fromEntries(STANDARDS.map(m=>[m,roster.filter(r=>roleIds.has(r.roleId)&&asks(r.roleId,m).some(q=>q.min>0)).map(r=>r.name)]));
const bars=Object.fromEntries(STANDARDS.map(m=>[m,[...new Set(roster.filter(r=>roleIds.has(r.roleId)).flatMap(r=>asks(r.roleId,m)).map(q=>q.min))].sort((x,y)=>x-y)]));
const roleOf=Object.fromEntries(roster.map(r=>[r.name,r.roleId]));
/* The default tab of the phone board is the first role that is on the board; its people with a figure to change are the group. */
const tabRole=(config?.roles||[]).filter(r=>r.onBoard!==false)[0]?.id;
const group=roster.filter(r=>r.roleId===tabRole&&baseStats[norm(r.name)]).map(r=>r.name).sort();
/* The store the cases start from: every standard cleared, then the case. Used for what the page is served and for what it should say. */
const build=c=>{
  const stats=structuredClone(baseStats);
  for(const p of Object.values(stats)){for(const m of VIDEO)p[m]=CLEARED;p.deliveredPct=0.6;}
  c.apply(stats,group.map(norm));
  return stats;
};
/* What the figures a case leaves say about one standard: who is measured, who is below, who has no data. */
const tally=(stats,m)=>{
  const out={held:heldTo[m].length,observed:0,below:0,missing:0,belowNames:[]};
  for(const name of heldTo[m]){
    const v=stats[norm(name)]?.[m];
    if(typeof v==='number'&&Number.isFinite(v)&&v>=0){out.observed++;if(v<bars[m][0]/100){out.below++;out.belowNames.push(name);}}
    else out.missing++;
  }
  out.mean=out.observed?(out.observed-out.below)/out.observed:null;
  out.pct=out.mean==null?null:Math.round(out.mean*100);
  return out;
};
const dot='·';
const countText=t=>`${t.below} of ${t.observed} below`;
for(const m of VIDEO){
  check(`fixture/${m}`,'the store holds enough people to the standard for the cases to mean something',heldTo[m].length>=6,true);
  check(`fixture/${m}`,'every bar the tiers set for it is above zero and below the control figure',bars[m].length>0&&bars[m][0]>0&&bars[m].at(-1)<CLEARED*100,true);
}
check('fixture','the first board role has at least four people with a figure to change',group.length>=4,true);

/* ---- what was tested ---- */
const walk=async(dir,base=dir)=>{
  const out={};
  for(const e of await readdir(dir,{withFileTypes:true})){
    const p=`${dir}/${e.name}`;
    if(e.isDirectory())Object.assign(out,await walk(p,base));else out[p.slice(base.length+1)]=sha(await readFile(p));
  }
  return out;
};
const digestOf=files=>sha(Object.entries(files).sort(([x],[y])=>x<y?-1:1).map(([p,h])=>`${h}  ${p}\n`).join(''));
const head=()=>{try{return execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{return null;}};
const identify=async()=>{
  const checkoutSha=process.env.TESTED_SHA||head();
  const built=await walk(dist).catch(()=>null);
  /* What the preview served, hashed as the browser received it: the entry page and every script and stylesheet it names. */
  const page=Buffer.from(await (await fetch(url)).arrayBuffer());
  const served={'index.html':sha(page)};
  for(const m of page.toString().matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css))"/g))served[m[1].slice(1)]=sha(Buffer.from(await (await fetch(new URL(m[1],url))).arrayBuffer()));
  let playwrightVersion=null;try{playwrightVersion=createRequire(import.meta.url)('playwright/package.json').version;}catch{}
  return {
    checkout:{sha:checkoutSha||null,from:process.env.TESTED_SHA?'TESTED_SHA':checkoutSha?'git rev-parse HEAD':null,githubSha:process.env.GITHUB_SHA||null,event:process.env.GITHUB_EVENT_NAME||null},
    probe:{file:'scripts/hero-observed.mjs',sha256:sha(await readFile(fileURLToPath(import.meta.url)))},
    built:built&&{dir:dist,files:built,digest:digestOf(built)},
    served:{url,files:served,matchesBuilt:!!built&&Object.entries(served).every(([p,h])=>built[p]===h)},
    engine:{name:engine,version:browser.version(),playwright:playwrightVersion},
    node:process.version,
  };
};
const identity=await identify();
/* The short form, for the log: what was tested, by what, in which engine. The whole of it is in the evidence file. */
console.log(JSON.stringify({tested:identity.checkout.sha,probe:identity.probe.sha256,built:identity.built?.digest??null,servedMatchesBuilt:identity.served.matchesBuilt,engine:identity.engine,node:identity.node}));
if(strict){
  check('identity','the exact tested checkout is recorded',/^[0-9a-f]{40}$/.test(identity.checkout.sha||''),true);
  check('identity','the built output is hashed',!!identity.built&&Object.keys(identity.built.files).length>0,true);
  check('identity','the preview served the bytes that were built',identity.served.matchesBuilt,true);
  check('identity','the browser version is recorded',!!identity.engine.version,true);
}

/* ---- the pages ---- */
let current=CASES[0];   // the case the next load shows
const route=async context=>{
  await context.route(`${api}profiles?**`,async r=>{
    const response=await r.fetch(),data=await response.json();
    const manager=p=>({...p,role:'admin',wants:'manager',onboarded:true,stores:[STORE]});
    await r.fulfill({response,json:Array.isArray(data)?data.map(manager):manager(data)});
  });
  await context.route(`${api}app_data?**`,async r=>{
    const response=await r.fetch(),data=await response.json();
    const fix=row=>{
      if(row?.key!==`lpc:store:${STORE}:v2`||!row.value?.months)return row;
      const value=structuredClone(row.value);
      value.months[Object.keys(value.months).sort().pop()].stats=build(current);
      return {...row,value};
    };
    const body=JSON.stringify(Array.isArray(data)?data.map(fix):fix(data)).replaceAll(`"${INF}"`,'1e999').replaceAll(`"${NEG_INF}"`,'-1e999');
    await r.fulfill({response,body});
  });
};
const open=async(device,c)=>{
  const phone=device==='phone';
  const context=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1440,height:1000},isMobile:phone,hasTouch:phone,reducedMotion:'reduce',serviceWorkers:'block'});
  await route(context);
  const page=await context.newPage();
  page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(30000);
  page.on('pageerror',e=>errors.push(`${c.name}/${device}: ${e.message}`));
  await page.addInitScript(()=>localStorage.setItem('lpc:last-view','sage-demo'));
  await page.goto(url);
  await page.locator('input[type="password"],.bp-dial,.s2-marks').first().waitFor();
  if(await page.locator('input[type="password"]').isVisible()){
    await page.locator('input[type="email"],input[autocomplete="username"]').first().fill('demo@sageonline.app');
    await page.locator('input[type="password"]').fill('x');
    await page.locator('input[type="password"]').press('Enter');
  }
  await page.locator(phone?'.bp-dial':'.s2-marks .s2-mark').first().waitFor();
  await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(250);
  return {context,page};
};
const phoneCase=async c=>{
  const {context,page}=await open('phone',c),got={};
  try{
    for(const m of VIDEO){
      const dial=page.locator('.bp-dial',{hasText:TINY[m]}).first();
      /* A visible dial does not make its text visible: in WebKit under reduced motion the levels inside a dial un-hide one after another (run 39101922865),
         and innerText leaves out hidden text. Wait for the ring's own span, with the page's default timeout, then read exactly as before. */
      await dial.locator('.bp-ring > span').waitFor();
      const ring=(await dial.locator('.bp-ring').innerText()).trim();
      await dial.click();await page.locator('.fr-hd').first().waitFor();
      const pop=await page.locator('.fr-hd').first().evaluate(n=>({
        title:n.querySelector('.fr-nm')?.textContent.trim(),
        st:[...n.querySelectorAll('.fr-st')].map(e=>({text:e.textContent.trim(),away:e.classList.contains('away')})),
        w:[...n.querySelectorAll('.fr-w')].map(e=>e.textContent.trim())}));
      got[m]={ring,...pop};
      if(m==='bhVideoPct')continue;   // its list is a known gap (notCovered), so the popup is the last thing read
      await page.getByRole('button',{name:'Who is below'}).click();
      await page.locator('button.on.drill').waitFor();
      got[m].listed=(await page.locator('.bp-nmx').allInnerTexts()).map(s=>s.trim()).sort();
      await page.locator('button.on.drill').click();
    }
    if(c.name==='control')got.tab=(await page.locator('.bp-filt button').first().innerText()).trim();
  }finally{await context.close();}
  seen.push({case:c.name,device:'phone',read:got});
  const stats=build(c);
  for(const m of VIDEO){
    const g=got[m],t=tally(stats,m),where=`${c.name}/phone/${m}`;
    check(where,'popup title',g.title,LABEL[m]);
    check(where,'the bar it prints is one the fixture sets for the standard',bars[m].includes(Number(/^target (\d+)%$/.exec(g.w.at(-1))?.[1])),true);
    if(t.pct==null){
      check(where,'dial ring',g.ring,'\u2013');
      check(where,'popup says there is no data and prints no percentage',[g.st.length,g.w.includes('no data yet')],[0,true]);
    }else{
      check(where,'dial ring',g.ring,`${t.pct}%`);
      check(where,'popup percentage',g.st,[{text:`${t.pct}% of target`,away:t.pct<100}]);
      check(where,'popup count',g.w.slice(0,t.missing>0?2:1),[countText(t),...(t.missing>0?[`${t.missing} no data`]:[])]);
    }
    if(m==='bhVideoPct')continue;
    /* The people below are the measured zeros, in the first tab. */
    const names=t.belowNames.filter(n=>roleOf[n]===tabRole).sort();
    check(where,'Who is below lists the measured people below the bar and nobody else',g.listed,names);
  }
  if(c.name==='control')check('control/phone','the first tab holds the people the cases change',Number(/· (\d+)$/.exec(got.tab)?.[1]),roster.filter(r=>r.roleId===tabRole).length);
};
const deskCase=async c=>{
  const {context,page}=await open('desk',c),got={};
  try{
    for(const m of VIDEO){
      const mark=page.locator('.s2-marks .s2-mark',{has:page.locator('.s2-mklbl',{hasText:TINY[m]})}).first();
      got[m]=await mark.evaluate(n=>({big:n.querySelector('.bw-big')?.textContent.replace(/\s+/g,' ').trim(),sub:n.querySelector('.bw-sub')?.textContent.replace(/\s+/g,' ').trim()}));
    }
    got.weakest=await page.locator('.s2-ansq').first().evaluate(n=>({name:n.querySelector('.s2-an-name')?.textContent.trim(),sub:n.querySelector('.s2-an-sub')?.textContent.replace(/\s+/g,' ').trim()}));
  }finally{await context.close();}
  seen.push({case:c.name,device:'desk',read:got});
  const stats=build(c),t=Object.fromEntries(STANDARDS.map(m=>[m,tally(stats,m)]));
  for(const m of VIDEO){
    const x=t[m];
    check(`${c.name}/desk/${m}`,'dial card',got[m],x.pct==null?{big:'no data yet',sub:`${x.missing} with no data`}
      :{big:`${x.pct}% of target on average`,sub:`${x.below} of ${x.observed} below target${x.missing>0?` ${dot} ${x.missing} no data`:''}`});
  }
  const where=`${c.name}/desk/weakest`,means=VIDEO.filter(m=>t[m].mean!=null),lowest=Math.min(...means.map(m=>t[m].mean));
  if(!means.length||lowest>=1){
    /* Nobody is below any standard. "Everyone" is only said when no figure is missing on any standard. */
    const anyMissing=STANDARDS.some(m=>t[m].missing>0);
    check(where,'the weakest card says everyone measured is on target, and "everyone" only when nobody is missing',got.weakest.name,anyMissing?'Everyone measured is on target':'Everyone is on target');
  }else{
    /* The weakest standard is the video standard with the lowest mean (a tie may name either), and the card counts the people of the one it names. */
    const named=BY_LABEL[got.weakest.name],tied=means.filter(m=>t[m].mean===lowest);
    check(where,'the weakest card names a video standard that has the lowest mean',tied.includes(named),true);
    if(named){
      const x=t[named];
      check(where,`and counts the people of ${named}, not of another standard`,got.weakest.sub?.startsWith(`${countText(x)}${x.missing>0?` ${dot} ${x.missing} no data`:''}`),true);
    }
  }
};
await mkdir('hero-observed',{recursive:true});
try{
  for(const device of ['phone','desk'])for(const c of CASES){
    current=c;
    await (device==='phone'?phoneCase:deskCase)(c);
  }
  console.log(`${seen.length} reads, ${failures.length} failures, ${errors.length} page errors`);
  assert.deepEqual(failures,[]);
  assert.deepEqual(errors,[]);
}finally{
  const fixture={store:STORE,month:monthKey,tabRole,group,held:Object.fromEntries(STANDARDS.map(m=>[m,heldTo[m].length])),bars,cleared:CLEARED};
  await writeFile('hero-observed/evidence.json',JSON.stringify({identity,fixture,cases:seen,failures,errors,notCovered},null,2));
  await browser.close();
}
