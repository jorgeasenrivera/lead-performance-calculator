import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';

const baseline = '5bf65105003b3e01227c774ea82e08d5d595bb68';
const before = await readFile(process.env.SPACING_BEFORE_CSS || '.spacing-baseline/src/manager-signal.css', 'utf8');
assert.equal(createHash('sha256').update(before).digest('hex'),
  'e2c712c8518302b4082695230be54c629bdd53a0b5dd95d45d6be83b05eaa363', 'immutable production stylesheet');
const after = await readFile('src/manager-signal.css', 'utf8');
const engine = process.env.FEEL_BROWSER || 'chromium';
const url = 'http://127.0.0.1:5178/';
const browser = await ({ chromium, webkit }[engine]).launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 667 },
  isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
let fixtureRole='admin';
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
  await route.fulfill({response,json:Array.isArray(data)?data.map(addStore):addStore(data)});
});
const page = await context.newPage(), errors = [], results = [], pillFailures=[], keyboardFailures=[];
page.setDefaultTimeout(20000);
page.setDefaultNavigationTimeout(30000);
await page.addInitScript(() => localStorage.setItem('lpc:last-view','sage-demo'));
page.on('pageerror', e => errors.push(e.message));
await mkdir('manager-spacing', { recursive: true });
async function settleScroll(mode) {
  const settled=await page.evaluate(async mode=>{
    let stable=0, previous='', start=performance.now();
    while(performance.now()-start<5000) {
      const s=document.scrollingElement;
      let top=s.scrollHeight-s.clientHeight;
      if(mode==='filters') {
        const filter=document.querySelector('.bp-filt').getBoundingClientRect();
        const sticky=document.querySelector('.topstack')?.getBoundingClientRect().bottom || 0;
        top=Math.max(0,Math.min(top,scrollY+filter.y-sticky-12));
      }
      window.scrollTo({top,behavior:'instant'});
      await new Promise(requestAnimationFrame);
      const stamp=[s.scrollHeight,s.clientHeight,s.scrollTop,innerWidth,innerHeight].join(':');
      stable=stamp===previous && Math.abs(scrollY-top)<1 ? stable+1 : 0;
      previous=stamp;
      if(stable>=8) return true;
    }
    return false;
  },mode);
  assert.ok(settled,`${mode}: scroll and responsive geometry settle`);
}
async function pillGeometry(selector, enforce=true) {
  const evidence=await page.locator(selector).evaluate(n=>{
    const rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    const ancestors=[];
    for(let p=n;p;p=p.parentElement) {
      const initial=p.scrollLeft;
      p.scrollTo({left:10000,behavior:'instant'});const positive=p.scrollLeft;
      p.scrollTo({left:-10000,behavior:'instant'});const negative=p.scrollLeft;
      p.scrollTo({left:initial,behavior:'instant'});
      ancestors.push({className:p.className,clientWidth:p.clientWidth,scrollWidth:p.scrollWidth,overflowX:getComputedStyle(p).overflowX,positive,negative});
    }
    return {box:rect(n),ancestors,buttons:[...n.querySelectorAll('button')].map(b=>{
      const range=document.createRange();range.selectNodeContents(b);
      return {text:b.textContent,box:rect(b),fontSize:getComputedStyle(b).fontSize,
        selected:b.classList.contains('on'),background:getComputedStyle(b).backgroundColor,
        textRects:[...range.getClientRects()].filter(r=>r.width).map(r=>({x:r.x,right:r.right,y:r.y,bottom:r.bottom}))};
    })};
  });
  results.push({phase:enforce?'after':'before',pillHeader:selector,width:page.viewportSize().width,...evidence});
  if(enforce) {
    try {
    assert.ok(evidence.ancestors.every(a=>a.positive===0 && a.negative===0),`${selector}: neither container nor ancestor scrolls sideways`);
    // A visible-overflow page wrapper may include the existing card's 4px
    // negative gutter without being scrollable. Require exact fit for the
    // pill container, actual overflow containers, and document viewport.
    assert.ok(evidence.ancestors.every((a,i)=>i!==0 && a.overflowX==='visible' || a.scrollWidth<=a.clientWidth+1),`${selector}: pill and scrolling containers have no horizontal overflow`);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'document fits the viewport');
    for(const b of evidence.buttons) {
      assert.ok(b.box.x>=evidence.box.x && b.box.right<=evidence.box.right+1 && b.box.height>=44,`${selector}: every control fits and keeps a touch target`);
      assert.ok(b.textRects.every(r=>r.x>=b.box.x-1 && r.right<=b.box.right+1 && r.y>=b.box.y-1 && r.bottom<=b.box.bottom+1),`${selector}: complete label stays inside its button`);
    }
    if(selector==='.sect-strip') assert.ok(evidence.buttons.filter(b=>b.selected).every(b=>b.background==='rgb(35, 73, 57)'), 'selected fill follows the actual button');
    } catch(error) {
      const overflow=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(n=>{
        const r=n.getBoundingClientRect();return r.width && r.right>innerWidth+1 && getComputedStyle(n).position!=='fixed';
      }).slice(0,25).map(n=>({tag:n.tagName,className:n.className,width:n.getBoundingClientRect().width,right:n.getBoundingClientRect().right})));
      const baselineWidth=await page.evaluate(async css=>{
        const sheet=[...document.querySelectorAll('style')].find(s=>s.textContent.includes('.manager-signal.manager-signal-switch'));
        const original=sheet.textContent;sheet.textContent=css;
        await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
        const width=document.documentElement.scrollWidth;sheet.textContent=original;
        await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
        return width;
      },before);
      const failure={selector,message:error.message,overflow,baselineWidth};
      pillFailures.push(failure);results.push({pillFailure:failure});
    }
  }
  return evidence;
}
try {
  for(const mobile of [true,false]) {
    const control=await browser.newContext({isMobile:mobile,hasTouch:mobile,viewport:{width:320,height:667}});
    const probe=await control.newPage();
    await probe.setContent('<button id="first">First</button><button id="second">Second</button><input id="input">');
    await probe.locator('#first').focus();await probe.keyboard.press('Tab');
    const next=await probe.evaluate(()=>document.activeElement.id);
    await probe.keyboard.press('Shift+Tab');
    const previous=await probe.evaluate(()=>document.activeElement.id);
    results.push({nativeKeyboardControl:{mobile,next,previous}});
    await control.close();
  }
  await page.goto(url);
  await page.locator('input[type="email"],input[autocomplete="username"]').fill('demo@sageonline.app');
  await page.locator('input[type="password"]').fill('x');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('.bp-row').first().waitFor({ timeout: 40000 });
  assert.ok(await page.locator('.view-select').isVisible(),'multi-store selector is present');
  assert.equal(await page.locator('.sect-chip').count(),5,'all five manager section tabs are present');
  await page.evaluate(() => document.fonts.ready);
  for (const [phase, css] of [['before', before], ['after', after]]) {
    // Only replace the actual mounted manager stylesheet. All JSX, handlers,
    // data and geometry are the built application, using fictional fixtures.
    await page.evaluate(css => {
      const sheet = [...document.querySelectorAll('style')].find(s => s.textContent.includes('.manager-signal.manager-signal-switch'));
      if (!sheet) throw Error('manager stylesheet absent');
      sheet.textContent = css;
    }, css);
    const cases = [320,360,375,390,393,414,430,640,641,700,701,760,761].map(width => ({width,height:667,inset:0}));
    cases.push({width:844,height:390,inset:0}, {width:390,height:844,inset:34},
      {width:390,height:667,inset:34}, {width:700,height:667,inset:34});
    for (const c of cases) {
      await page.setViewportSize({ width:c.width, height:c.height });
      await page.locator(c.width<=700 ? '.bp-row' : '.assoc-card').first().waitFor();
      await page.evaluate(inset => document.documentElement.style.setProperty('--shell-inset-bottom',`${inset}px`),c.inset);
      if (await page.getByRole('button',{name:'Close the round-up',exact:true}).isVisible()) {
        await page.getByRole('button',{name:'Close the round-up',exact:true}).click();
      }
      if(c.width<=760) {
        await pillGeometry('.sect-strip',phase==='after');
        await page.screenshot({path:`manager-spacing/${phase}-${c.width}x${c.height}-inset${c.inset}-header.png`});
      }
      // html owns smooth scrolling even under the app's reduced-motion rule.
      // WebKit can also update its scroll extent after a responsive remount.
      await settleScroll('bottom');
      const geometry = await page.evaluate(() => {
        const box = el => { if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}; };
        const rows=[...document.querySelectorAll('.bp-row')];
        const h=document.querySelector('.bp-fivehead');
        const last=rows.at(-1);
        const units=h?.lastElementChild;
        const range=document.createRange();
        if(units) range.selectNodeContents(units);
        const visible = selector => [...document.querySelectorAll(selector)].filter(n=>n.getBoundingClientRect().width && getComputedStyle(n).display!=='none').map(box);
        const scroll=document.scrollingElement;
        return {viewport:{w:innerWidth,h:innerHeight},scrollWidth:document.documentElement.scrollWidth,
          scroll:{top:scroll.scrollTop,height:scroll.scrollHeight,clientHeight:scroll.clientHeight,
            remaining:scroll.scrollHeight-scroll.clientHeight-scroll.scrollTop},
          filter:box(document.querySelector('.bp-filt')),
          filters:[...document.querySelectorAll('.bp-filt button')].map(n=>({...box(n),text:n.textContent})),
          header:h ? [...h.children].map(box):[],
          unitsHeader:units ? {fontSize:getComputedStyle(units).fontSize,
            lines:new Set([...range.getClientRects()].filter(r=>r.width).map(r=>Math.round(r.y))).size}:null,
          row:rows[0] ? [...rows[0].children].map(box):[],last:box(last),
          headerPadding:h ? getComputedStyle(h).paddingInline:null,
          rowPadding:rows[0] ? getComputedStyle(rows[0]).paddingInline:null,
          controls:visible('.help-fab:not(.inline),.botnav,.botnav-fab,.botnav-halo'),
          names:[...document.querySelectorAll('.bp-nmx')].map(n=>({width:n.clientWidth,scroll:n.scrollWidth})),
          details:rows.map(n=>({row:box(n),line:box(n.querySelector('.bp-lim')),
            count:box(n.querySelector('.bp-lim b')),status:box(n.querySelector('.bp-stnd'))})),
          hit:last ? document.elementFromPoint(last.getBoundingClientRect().right-20,last.getBoundingClientRect().y+last.getBoundingClientRect().height/2)?.closest('.bp-row')===last :null};
      });
      const key=`${phase}-${c.width}x${c.height}-inset${c.inset}`;
      assert.ok(Math.abs(geometry.scroll.remaining)<1,`${key}: geometry sampled at actual bottom`);
      results.push({phase,...c,...geometry});
      await page.screenshot({path:`manager-spacing/${key}-bottom.png`});
      if(c.width<=700) {
        await settleScroll('filters');
        const capture=await page.evaluate(()=>({
          filterTop:document.querySelector('.bp-filt').getBoundingClientRect().y,
          headerBottom:document.querySelector('.bp-fivehead').getBoundingClientRect().bottom,
          stickyBottom:document.querySelector('.topstack')?.getBoundingClientRect().bottom || 0,
          scrollTop:scrollY,
        }));
        results.at(-1).filterCapture=capture;
        assert.ok(capture.filterTop>=capture.stickyBottom+8,`${key}: filter screenshot clears sticky header`);
        await page.screenshot({path:`manager-spacing/${key}-filters.png`});
      }
      if(phase==='after') {
        assert.ok(geometry.scrollWidth<=c.width+1,`${key}: no document overflow`);
        if(c.width<=700) {
          assert.equal(geometry.headerPadding,geometry.rowPadding,`${key}: shared header inset`);
          assert.equal(geometry.unitsHeader.lines,1,`${key}: Units remains on one line`);
          assert.ok(geometry.row[1].x>=geometry.row[0].right+4,`${key}: name clears avatar`);
          const center=r=>r.x+r.w/2;
          assert.ok(Math.abs(center(geometry.header[2])-center(geometry.row[2]))<1,`${key}: standards aligned`);
          assert.ok(Math.abs(center(geometry.header[3])-center(geometry.row[3]))<1,`${key}: units aligned`);
          assert.ok(geometry.filters.every(b=>b.h>=44),`${key}: touch height`);
          assert.ok(Math.abs(geometry.filters[0].y-geometry.filters[1].y)<1,`${key}: role filters share a row`);
          assert.ok(geometry.filters[2].w>geometry.filters[0].w*1.8,`${key}: full final filter row`);
          const ceiling=Math.min(...geometry.controls.map(r=>r.y));
          assert.ok(geometry.last.bottom<=ceiling-8,`${key}: last row clears controls, bottom=${geometry.last.bottom}, ceiling=${ceiling}`);
          assert.ok(geometry.hit,`${key}: final units cell receives taps`);
          for(const d of geometry.details) {
            assert.ok(d.row.h>=56,`${key}: minimum row height`);
            for(const child of [d.count,d.status].filter(Boolean)) {
              assert.ok(child.x>=d.line.x-1 && child.right<=d.line.right+1,`${key}: count/status remains readable`);
            }
          }
        }
      }
    }
    if(phase==='before') {
      for(const label of ['Dashboard','History','Targets','People','Dashboard']) {
        const tab=page.locator('.sect-chip').filter({hasText:new RegExp(`^${label}$`)});
        await tab.focus();await tab.evaluate(n=>window.spacingFocusNode=n);
        await page.keyboard.press('Enter');
        await page.waitForFunction(label=>[...document.querySelectorAll('.sect-chip')].some(n=>n.textContent===label && n.classList.contains('on')),label);
        results.push({baselineFocus:label,...await page.evaluate(()=>({originalConnected:window.spacingFocusNode.isConnected,activeTag:document.activeElement?.tagName}))});
      }
    }
  }
  await page.setViewportSize({width:320,height:667});
  await page.evaluate(()=>document.documentElement.style.setProperty('--shell-inset-bottom','34px'));
  await page.locator('.bp-nmx').first().evaluate(n=>{n.textContent='Alexandria Fictional Longname Example';});
  await page.locator('.bp-row').first().scrollIntoViewIfNeeded();
  await page.screenshot({path:'manager-spacing/after-long-name.png'});
  await page.locator('.bp-row').last().focus();
  await page.keyboard.press('Enter');
  await page.locator('.acard').waitFor({timeout:5000});
  await page.keyboard.press('Escape');
  await page.locator('.acard').waitFor({state:'hidden'});
  const field=page.getByPlaceholder('Search associates',{exact:true});
  await field.fill('no-such-fictional-associate');
  await page.locator('.bp-stand .fr-empty').waitFor();
  await field.fill('');
  await page.locator('.bp-row').first().waitFor();
  await page.locator('.sect-chip').filter({hasText:/^Summary$/}).click();
  await page.locator('.sm-phone').waitFor();
  await page.locator('.sect-chip').filter({hasText:/^Dashboard$/}).click();
  await page.locator('.bp-row').first().waitFor();
  const originalStore=await page.locator('.sage-bp-store').textContent();
  await page.locator('.view-select').selectOption('spacing-demo-2');
  await page.waitForFunction(()=>document.querySelector('.sage-bp-store')?.textContent==='Second Fictional Store');
  await page.locator('.bp-row').first().waitFor();
  await page.screenshot({path:'manager-spacing/after-dealer-switch.png'});
  await page.locator('.view-select').selectOption('sage-demo');
  await page.waitForFunction(name=>document.querySelector('.sage-bp-store')?.textContent===name,originalStore);
  for(const label of await page.locator('.sect-chip').allTextContents()) {
    const tab=page.locator('.sect-chip').filter({hasText:new RegExp(`^${label}$`)});
    await tab.focus();
    // Real sequential navigation establishes keyboard modality in WebKit too.
    await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');
    const focusBefore=await tab.evaluate(n=>({active:n===document.activeElement,visible:n.matches(':focus-visible'),outline:getComputedStyle(n).outlineWidth,activeTag:document.activeElement?.tagName,activeClass:document.activeElement?.className}));
    results.push({tab:label,focusBefore});
    if(!(focusBefore.active && focusBefore.visible && parseFloat(focusBefore.outline)>=2)) keyboardFailures.push({label,focusBefore});
    await tab.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(label=>[...document.querySelectorAll('.sect-chip')].some(n=>n.textContent===label && n.classList.contains('on')),label);
    await page.waitForFunction(()=>!document.documentElement.matches('.tool-move,.tab-move'));
    await pillGeometry('.sect-strip');
    results.push({tab:label,focusAfter:await tab.evaluate(n=>({active:n===document.activeElement,visible:n.matches(':focus-visible'),activeTag:document.activeElement?.tagName}))});
    await page.screenshot({path:`manager-spacing/after-tab-${label.toLowerCase()}.png`});
  }
  const people=page.locator('.sect-chip').filter({hasText:/^People$/});
  await people.scrollIntoViewIfNeeded();
  const reachable=await people.evaluate(n=>{const r=n.getBoundingClientRect(),s=n.closest('.sect-strip').getBoundingClientRect();return r.x>=s.x-1 && r.right<=s.right+1;});
  assert.ok(reachable,'People is reachable through the horizontal tab strip');
  await people.focus(); await page.keyboard.press('Enter');
  await page.locator('.pe-phone .pe-row').first().waitFor();
  await page.waitForFunction(()=>!document.documentElement.matches('.tool-move,.tab-move'));
  await page.locator('.pe-phone .pe-row').first().evaluate(n=>n.scrollIntoView({block:'center',behavior:'instant'}));
  await page.waitForFunction(()=>{
    const row=document.querySelector('.pe-phone .pe-row'); if(!row?.textContent.trim()) return false;
    const r=row.getBoundingClientRect(), sticky=document.querySelector('.topstack')?.getBoundingClientRect().bottom || 0;
    return r.width>0 && r.height>0 && r.y>=sticky && r.bottom<=innerHeight && getComputedStyle(row).opacity==='1';
  });
  results.push({phase:'after',people:{visibleRows:await page.locator('.pe-phone .pe-row').count(),firstRowVisible:true}});
  await pillGeometry('.sect-strip');
  await pillGeometry('.pe-filters');
  await page.screenshot({path:'manager-spacing/after-people-reached.png'});
  const peopleText=await page.locator('.pe-filters button').evaluateAll(async nodes=>{
    const samples=nodes.map(n=>({n,before:parseFloat(getComputedStyle(n).fontSize),style:n.getAttribute('style')}));
    samples.forEach(s=>s.n.style.setProperty('font-size',`${s.before*1.5}px`,'important'));
    await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
    return samples.map(s=>({before:s.before,after:parseFloat(getComputedStyle(s.n).fontSize)}));
  });
  results.push({peopleText});
  assert.ok(peopleText.every(s=>Math.abs(s.after-s.before*1.5)<.01),'People filter text really enlarges 150%');
  await pillGeometry('.pe-filters');
  await page.screenshot({path:'manager-spacing/after-people-text-150.png'});
  await page.locator('.sect-chip').filter({hasText:/^Dashboard$/}).click();
  await page.locator('.bp-row').first().waitFor();
  // Explicit text-only stress, not a production scaling rule or a substitute
  // for a physical phone's accessibility text setting.
  const textMeasurement=await page.evaluate(async()=>{
    const nodes=[...document.querySelectorAll('.sect-chip,.bp-nmx,.bp-lim b,.bp-stnd,.bp-filt button,.bp-fivehead .bp-lbl,.bp-un,.bp-verdict')];
    const samples=nodes.map(n=>({node:n,before:parseFloat(getComputedStyle(n).fontSize),style:n.getAttribute('style')}));
    window.spacingTextRestore=samples;
    for(const s of samples) s.node.style.setProperty('font-size',`${s.before*1.5}px`,'important');
    const measure=()=>samples.map((s,index)=>{
      const computed=getComputedStyle(s.node),rect=s.node.getBoundingClientRect();
      return {index,className:s.node.className,text:s.node.textContent,before:s.before,
        requested:s.before*1.5,after:parseFloat(computed.fontSize),connected:s.node.isConnected,
        inlineSize:s.node.style.getPropertyValue('font-size'),priority:s.node.style.getPropertyPriority('font-size'),
        textSizeAdjust:computed.getPropertyValue('-webkit-text-size-adjust'),
        transition:computed.transition,animation:computed.animation,width:rect.width,height:rect.height};
    });
    const immediate=measure(),frames=[],start=performance.now();
    // WebKit can report a transition's starting value in the mutation turn,
    // even with the existing reduced-motion duration of one microsecond.
    // Wait for rendered values, preserving every sample and the exact target.
    let settled;
    do {
      await new Promise(requestAnimationFrame);
      settled=measure();
      frames.push({elapsed:performance.now()-start,sizes:settled.map(s=>s.after),connected:settled.map(s=>s.connected)});
    } while(!settled.every(s=>s.connected && Math.abs(s.after-s.requested)<.01) && performance.now()-start<1000);
    return {immediate,frames,textSamples:settled};
  });
  const {textSamples}=textMeasurement;
  // Keep failed enlargement evidence too, before any requirement can abort.
  results.push({phase:'after',stress:'150-percent-text-measurement',...textMeasurement});
  await writeFile('manager-spacing/text-measurement.json',JSON.stringify({engine,...textMeasurement},null,2));
  await page.screenshot({path:'manager-spacing/text-measurement.png'});
  assert.ok(textSamples.every(s=>s.connected && Math.abs(s.after-s.before*1.5)<.01),'every selected text element is actually enlarged 150%');
  await pillGeometry('.sect-strip');
  const stripBox=await page.locator('.sect-strip').boundingBox();
  await page.mouse.move(stripBox.x+stripBox.width/2,stripBox.y+stripBox.height/2);
  await page.mouse.wheel(600,0);
  await pillGeometry('.sect-strip');
  await settleScroll('filters');
  const enlargedUnitsLines=await page.locator('.bp-fivehead .bp-lbl').last().evaluate(n=>{
    const range=document.createRange();range.selectNodeContents(n);
    return new Set([...range.getClientRects()].filter(r=>r.width).map(r=>Math.round(r.y))).size;
  });
  assert.equal(enlargedUnitsLines,1,'enlarged Units stays on one line');
  const enlarged=await page.locator('.bp-row').evaluateAll(rows=>rows.map(row=>{
    const line=row.querySelector('.bp-lim').getBoundingClientRect();
    return {height:row.getBoundingClientRect().height,details:[...row.querySelectorAll('.bp-lim b,.bp-stnd')].map(n=>{
      const r=n.getBoundingClientRect();return r.x>=line.x-1 && r.right<=line.right+1;
    })};
  }));
  assert.ok(enlarged.every(r=>r.height>=56 && r.details.every(Boolean)),'150% text preserves count/status and row targets');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'150% text has no document overflow');
  results.push({phase:'after',stress:'150-percent-text',rows:enlarged,textSamples,enlargedUnitsLines});
  await page.screenshot({path:'manager-spacing/after-text-150.png'});
  await page.evaluate(()=>{for(const s of window.spacingTextRestore) {if(s.style===null)s.node.removeAttribute('style');else s.node.setAttribute('style',s.style);}delete window.spacingTextRestore;});
  async function sharedHeader(name,count) {
    await page.waitForFunction(count=>document.querySelectorAll('.sect-chip').length===count,count);
    await page.waitForFunction(()=>!document.documentElement.matches('.tool-move,.tab-move'));
    for(const width of [320,390]) {
      await page.setViewportSize({width,height:667});
      await pillGeometry('.sect-strip');
    }
    const first=page.locator('.sect-chip').first(),last=page.locator('.sect-chip').last();
    await first.focus();await page.keyboard.press('Tab');
    if(!await page.locator('.sect-chip').nth(1).evaluate(n=>n===document.activeElement)) keyboardFailures.push({name,key:'Tab'});
    await page.keyboard.press('Shift+Tab');
    if(!await first.evaluate(n=>n===document.activeElement)) keyboardFailures.push({name,key:'Shift-Tab'});
    await last.focus();await page.keyboard.press('Space');
    await page.waitForFunction(()=>document.querySelector('.sect-chip:last-child')?.classList.contains('on'));
    await page.waitForFunction(()=>!document.documentElement.matches('.tool-move,.tab-move'));
    await page.setViewportSize({width:320,height:667});
    const sizes=await page.locator('.sect-chip').evaluateAll(async nodes=>{
      const before=nodes.map(n=>parseFloat(getComputedStyle(n).fontSize));
      nodes.forEach((n,i)=>n.style.setProperty('font-size',`${before[i]*1.5}px`,'important'));
      await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
      return nodes.map((n,i)=>({before:before[i],after:parseFloat(getComputedStyle(n).fontSize)}));
    });
    results.push({sharedHeader:name,count,sizes});
    assert.ok(sizes.every(s=>Math.abs(s.after-s.before*1.5)<.01),'shared header genuinely enlarged');
    await pillGeometry('.sect-strip');
    await page.screenshot({path:`manager-spacing/after-shared-${name}-text150.png`});
  }
  await page.locator('.botnav').getByRole('button',{name:'Activity',exact:true}).click();
  await sharedHeader('activity-four',4);
  await page.locator('.botnav').getByRole('button',{name:'Performance',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.sect-chip').length===5);
  await page.locator('.view-select').selectOption('admin');
  await sharedHeader('admin-seven',7);
  fixtureRole='overseer';
  await page.reload();
  await sharedHeader('overseer-three',3);
  await page.locator('.view-select').selectOption('combined');
  await sharedHeader('combined-two',2);
  results.push({keyboardFailures});
  assert.deepEqual(keyboardFailures,[],'keyboard requirements are retained, not waived');
  assert.deepEqual(pillFailures,[],'all fixed-header checks pass; retained failures are not waived');
  assert.deepEqual(errors,[]);
  console.log('Keyboard/navigation passed: last row Enter/Escape, search clear, Summary return, dealer switching, People reachability and 150% text');
} finally {
  console.log(JSON.stringify({engine,baseline,results,errors}));
  await writeFile('manager-spacing/geometry.json',JSON.stringify({engine,baseline,results,errors},null,2));
  await page.screenshot({path:'manager-spacing/final.png'}).catch(()=>{});
  await context.close(); await browser.close();
}
