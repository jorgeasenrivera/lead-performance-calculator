import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';

const baseline = '5bf65105003b3e01227c774ea82e08d5d595bb68';
const before = execFileSync('git', ['show', `${baseline}:src/manager-signal.css`], { encoding: 'utf8' });
const after = await readFile('src/manager-signal.css', 'utf8');
const engine = process.env.FEEL_BROWSER || 'chromium';
const url = 'http://127.0.0.1:5178/';
const browser = await ({ chromium, webkit }[engine]).launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 667 },
  isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
await context.route('http://127.0.0.1:5433/rest/v1/profiles?**', async route => {
  const response = await route.fetch(); const data = await response.json();
  const manager = p => ({ ...p, role: 'manager', wants: 'manager', onboarded: true,
    stores:['sage-demo','spacing-demo-2'] });
  await route.fulfill({ response, json: Array.isArray(data) ? data.map(manager) : manager(data) });
});
await context.route('http://127.0.0.1:5433/rest/v1/app_data?**', async route => {
  const response=await route.fetch(); const data=await response.json();
  const addStore=row=>row?.value?.stores ? {...row,value:{...row.value,
    stores:[...row.value.stores,{...row.value.stores[0],id:'spacing-demo-2',name:'Second Fictional Store'}]}}:row;
  await route.fulfill({response,json:Array.isArray(data)?data.map(addStore):addStore(data)});
});
const page = await context.newPage(), errors = [], results = [];
page.on('pageerror', e => errors.push(e.message));
await mkdir('manager-spacing', { recursive: true });
try {
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
      await page.evaluate(() => window.scrollTo(0,document.documentElement.scrollHeight));
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const geometry = await page.evaluate(() => {
        const box = el => { if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}; };
        const rows=[...document.querySelectorAll('.bp-row')];
        const h=document.querySelector('.bp-fivehead');
        const last=rows.at(-1);
        const visible = selector => [...document.querySelectorAll(selector)].filter(n=>n.getBoundingClientRect().width && getComputedStyle(n).display!=='none').map(box);
        return {viewport:{w:innerWidth,h:innerHeight},scrollWidth:document.documentElement.scrollWidth,
          filter:box(document.querySelector('.bp-filt')),
          filters:[...document.querySelectorAll('.bp-filt button')].map(n=>({...box(n),text:n.textContent})),
          header:h ? [...h.children].map(box):[],
          row:rows[0] ? [...rows[0].children].map(box):[],last:box(last),
          headerPadding:h ? getComputedStyle(h).paddingInline:null,
          rowPadding:rows[0] ? getComputedStyle(rows[0]).paddingInline:null,
          controls:visible('.help-fab:not(.inline),.botnav,.botnav-fab,.botnav-halo'),
          names:[...document.querySelectorAll('.bp-nmx')].map(n=>({width:n.clientWidth,scroll:n.scrollWidth})),
          hit:last ? document.elementFromPoint(last.getBoundingClientRect().right-20,last.getBoundingClientRect().y+last.getBoundingClientRect().height/2)?.closest('.bp-row')===last :null};
      });
      const key=`${phase}-${c.width}x${c.height}-inset${c.inset}`;
      results.push({phase,...c,...geometry});
      await page.screenshot({path:`manager-spacing/${key}-bottom.png`});
      if(c.width<=700) {
        await page.locator('.bp-filt').scrollIntoViewIfNeeded();
        await page.screenshot({path:`manager-spacing/${key}-filters.png`});
      }
      if(phase==='after') {
        assert.ok(geometry.scrollWidth<=c.width+1,`${key}: no document overflow`);
        if(c.width<=700) {
          assert.equal(geometry.headerPadding,geometry.rowPadding,`${key}: shared header inset`);
          const center=r=>r.x+r.w/2;
          assert.ok(Math.abs(center(geometry.header[2])-center(geometry.row[2]))<1,`${key}: standards aligned`);
          assert.ok(Math.abs(center(geometry.header[3])-center(geometry.row[3]))<1,`${key}: units aligned`);
          assert.ok(geometry.filters.every(b=>b.h>=44),`${key}: touch height`);
          assert.ok(Math.abs(geometry.filters[0].y-geometry.filters[1].y)<1,`${key}: role filters share a row`);
          assert.ok(geometry.filters[2].w>geometry.filters[0].w*1.8,`${key}: full final filter row`);
          const ceiling=Math.min(...geometry.controls.map(r=>r.y));
          assert.ok(geometry.last.bottom<=ceiling-8,`${key}: last row clears controls, bottom=${geometry.last.bottom}, ceiling=${ceiling}`);
          assert.ok(geometry.hit,`${key}: final units cell receives taps`);
        }
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
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({engine,baseline,results,keyboard:'last row Enter/Escape, search clear and Summary return passed'}));
} finally {
  await writeFile('manager-spacing/geometry.json',JSON.stringify({engine,baseline,results,errors},null,2));
  await page.screenshot({path:'manager-spacing/final.png'}).catch(()=>{});
  await context.close(); await browser.close();
}
