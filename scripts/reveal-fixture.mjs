import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
/* Observation only. How does an engine reveal nested, inherited visibility when the boot gate comes off after the content is already mounted, with
   the app's own reduced-motion rule in force? The page is a bare copy of the Performance hero's nesting (page, board-page, bp-page, bp-hero,
   bp-five, dial, ring, span). The two rules that matter are taken verbatim from the app's source at run time, so the fixture cannot drift from
   them, and nothing here edits the app. Each variant changes one thing, in its own page. The gate comes off at a recorded instant (gateOff), and
   every animation frame after it is kept as sampled: the computed visibility of each level, the span's innerText, the number of running
   animations, and the time since the gate came off. Reveal times are counted from the gate, not from the setup frames before it.
   The fixture asserts nothing about the engines. It fails only when it cannot say what it measured: a rule not found, the reduced-motion setting
   not in force as asked, a page not in the intended hidden state before the gate comes off, a variant that could not be observed. Whatever was
   observed is written after every variant and again on the way out, and the browser is closed on every path, so a failure keeps the evidence. */
const engine=process.env.FEEL_BROWSER||'chromium';
const sha=t=>createHash('sha256').update(t).digest('hex');
const BOUND={frames:400,ms:8000};   // at most 400 frames, and 8 s counted from the gate
const app=await readFile(new URL('../src/LeadPerformanceCalculator.jsx',import.meta.url),'utf8');
const GATE=/html\.jump-under \.lpc > \*:not\(\.sage-ground\) \{ visibility:hidden; \}/.exec(app)?.[0];
const REDUCED=/\.lpc \*, \.lpc \*::before, \.lpc \*::after \{\s*animation-duration: \.001ms !important;[^}]*?transition-duration: \.001ms !important;[^}]*?\}/.exec(app)?.[0];
const LEVELS=['page','board-page','bp-page','bp-hero','bp-five','bp-dial','bp-ring','span'];
/* The dial lists its own transition properties, none of them visibility; its value is the one read from the app in Chromium (run 39101922865 notes). */
const DIAL='.bp-dial{transition-property:transform, box-shadow, background, color, border-color, filter, opacity}';
const TREE='<div class="page"><div class="board-page"><div class="bp-page"><div class="bp-hero"><div class="bp-five"><button class="bp-dial"><span class="bp-ring"><span>100%</span></span><span class="bp-dl">Appt Video</span></button></div></div></div></div></div>';
const page_=(css,mount)=>`<!doctype html><html class="jump-under"><head><meta charset="utf-8"><style>${css}</style></head><body><div class="lpc">${mount==='before'?TREE:''}</div></body></html>`;
/* Built after the two rules are known to exist, so a missing rule is reported, not thrown from here. */
const variants=()=>[
  {name:'app',        about:'the app\'s two rules, reduced motion on',                                   css:`${GATE}\n@media (prefers-reduced-motion: reduce){${REDUCED}}\n${DIAL}`,                               motion:'reduce',mount:'before'},
  {name:'no-reduce',  about:'the same rules, reduced motion off (the rule does not apply)',               css:`${GATE}\n@media (prefers-reduced-motion: reduce){${REDUCED}}\n${DIAL}`,                               motion:'no-preference',mount:'before'},
  {name:'zero',       about:'reduced motion on, but a transition duration of exactly 0s',                 css:`${GATE}\n@media (prefers-reduced-motion: reduce){${REDUCED.replace('transition-duration: .001ms','transition-duration: 0s')}}\n${DIAL}`,motion:'reduce',mount:'before'},
  {name:'no-visibility',about:'reduced motion on, transitions limited to opacity so visibility cannot transition',css:`${GATE}\n@media (prefers-reduced-motion: reduce){${REDUCED}}\n.lpc *{transition-property:opacity !important}`,motion:'reduce',mount:'before'},
  {name:'mount-after',about:'the app\'s rules, but the content is mounted after the gate comes off',      css:`${GATE}\n@media (prefers-reduced-motion: reduce){${REDUCED}}\n${DIAL}`,                               motion:'reduce',mount:'after'},
  {name:'delay-control',about:'positive control: a 100 ms transition delay on visibility at every level, which must stagger the reveal in any engine',css:`${GATE}\n.lpc *{transition-property:visibility;transition-duration:0s;transition-delay:100ms}\n${DIAL}`,motion:'no-preference',mount:'before'},
  {name:'slow-frames',about:'the app\'s rules, with every frame held for 150 ms of main-thread work',    css:`${GATE}\n@media (prefers-reduced-motion: reduce){${REDUCED}}\n${DIAL}`,                               motion:'reduce',mount:'before',stall:150},
];
const out={engine,version:null,playwright:null,node:process.version,tested:process.env.TESTED_SHA||null,bounds:BOUND,
  source:{file:'src/LeadPerformanceCalculator.jsx',sha256:sha(app)},rules:{GATE:GATE??null,REDUCED:REDUCED??null,gateSha256:GATE?sha(GATE):null,reducedSha256:REDUCED?sha(REDUCED):null},
  variants:[],problems:[],error:null};
let browser=null,failure=null;
const save=()=>writeFile('reveal/results.json',JSON.stringify(out,null,1));
/* One variant, in its own context and page. It never throws: whatever went wrong is written into its entry, with the frames sampled up to that point. */
const observe=async v=>{
  const entry={name:v.name,about:v.about,motion:v.motion,mount:v.mount,stallMs:v.stall||0,css:v.css,page:page_(v.css,v.mount)};
  let context=null;
  try{
    context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:v.motion,serviceWorkers:'block'});
    const page=await context.newPage();
    await page.setContent(entry.page);
    Object.assign(entry,await page.evaluate(async ({levels,tree,mount,stall,bound})=>{
      const els=()=>levels.map(c=>c==='span'?document.querySelector('.bp-ring > span'):document.querySelector('.'+c));
      const T0=performance.now(),t=()=>Math.round((performance.now()-T0)*10)/10;
      const snap=()=>{const e=els();return {t:t(),v:e.map(x=>x?getComputedStyle(x).visibility:null),inner:e[7]?e[7].innerText:null,animations:document.getAnimations().length};};
      const frame=()=>new Promise(r=>requestAnimationFrame(()=>r()));
      const busy=ms=>{const e=performance.now()+ms;while(performance.now()<e);};
      const r={reduceMatches:matchMedia('(prefers-reduced-motion: reduce)').matches,setupFrames:[],before:null,gateOff:null,frames:[],stoppedBecause:null,error:null};
      try{
        await frame();r.setupFrames.push(t());await frame();r.setupFrames.push(t());
        if(mount==='before')r.before=snap();
        document.documentElement.classList.remove('jump-under');
        r.gateOff=t();
        if(mount==='after')document.querySelector('.lpc').innerHTML=tree;
        for(let i=0;;i++){
          if(i>=bound.frames){r.stoppedBecause='frame bound';break;}
          if(t()-r.gateOff>=bound.ms){r.stoppedBecause='time bound';break;}
          await frame();
          const f=snap();f.frame=i;f.sinceGate=Math.round((f.t-r.gateOff)*10)/10;r.frames.push(f);
          if(f.v.every(x=>x==='visible')&&f.inner==='100%'){r.stoppedBecause='revealed';break;}
          if(stall)busy(stall);
        }
      }catch(e){r.error=String(e?.message||e);}
      return r;
    },{levels:LEVELS,tree:TREE,mount:v.mount,stall:v.stall||0,bound:BOUND}));
    const fr=entry.frames||[];
    entry.levelsVisibleAt=LEVELS.map((level,i)=>{const f=fr.find(x=>x.v[i]==='visible');return {level,frame:f?f.frame:null,msSinceGate:f?f.sinceGate:null};});
    const full=fr.find(f=>f.v.every(x=>x==='visible')&&f.inner==='100%');
    entry.fullyRevealed=full?{frame:full.frame,msSinceGate:full.sinceGate}:null;
    entry.framesRecorded=fr.length;
    entry.hiddenBefore=v.mount==='before'?!!entry.before&&entry.before.v.every(x=>x==='hidden'):null;
    if(entry.error)entry.problem=`the page-side observation failed: ${entry.error}`;
    else if(entry.reduceMatches!==(v.motion==='reduce'))entry.problem=`reduced motion was asked ${v.motion==='reduce'?'on':'off'} and the page says ${entry.reduceMatches?'on':'off'}`;
    else if(entry.hiddenBefore===false)entry.problem='not every level was hidden before the gate came off';
  }catch(e){entry.problem=`could not be observed: ${String(e?.message||e).split('\n')[0]}`;}
  finally{await context?.close().catch(()=>{});}
  return entry;
};
try{
  await mkdir('reveal',{recursive:true});
  assert.ok(GATE,'the app\'s boot gate rule is in the source');
  assert.ok(REDUCED,'the app\'s reduced-motion rule is in the source');
  browser=await ({chromium,webkit}[engine]).launch({headless:true,...(engine==='webkit'&&process.env.FEEL_WEBKIT?{executablePath:process.env.FEEL_WEBKIT}:{})});
  out.version=browser.version();
  out.playwright=(await import('playwright/package.json',{with:{type:'json'}})).default.version;
  for(const v of variants()){
    const entry=await observe(v);
    out.variants.push(entry);
    if(entry.problem)out.problems.push(`${v.name}: ${entry.problem}`);
    await save();                      // incremental: a later variant cannot lose this one
  }
  assert.deepEqual(out.problems,[],'every variant was observed as intended');
}catch(e){failure=e;out.error=String(e?.message||e);}
finally{
  await mkdir('reveal',{recursive:true}).then(save).catch(()=>{});
  await browser?.close().catch(()=>{});
}
console.log(`${engine} ${out.version}, Playwright ${out.playwright}`);
for(const v of out.variants){
  const cells=(v.levelsVisibleAt||[]).map(l=>`${l.level}:${l.frame===null?'never':l.frame}`).join(' ');
  console.log(`${v.name.padEnd(14)} gate off at ${String(v.gateOff).padEnd(6)} ms | revealed ${v.fullyRevealed?`at frame ${v.fullyRevealed.frame}, ${v.fullyRevealed.msSinceGate} ms after the gate`:`never (${v.stoppedBecause})`} | first visible frame per level: ${cells}${v.problem?` | PROBLEM: ${v.problem}`:''}`);
}
if(failure){console.error(`reveal-fixture: ${out.error}`);process.exitCode=1;}
