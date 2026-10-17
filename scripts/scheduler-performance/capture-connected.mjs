import {chromium} from '/workspace/cloud-tools/node_modules/playwright/index.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
const out=process.env.EVIDENCE_DIR||'/tmp/connected-visual';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const captures=[];
try{for(const [width,height,scale,touch] of [[1440,1000,1,false],[390,844,1,true],[320,640,1,true],[320,640,2,true],[360,225,2,false]]){
 const page=await browser.newPage({viewport:{width,height},hasTouch:touch,reducedMotion:'reduce'});await page.clock.install({time:new Date('2026-10-14T16:00:00Z')});await page.goto('http://127.0.0.1:5190/planner/');await page.locator('.day-heading').waitFor();await page.evaluate(s=>document.documentElement.style.fontSize=`${s*100}%`,scale);await page.evaluate(()=>document.fonts.ready);
 const key=`chromium-${width}x${height}-text${scale*100}`;
 for(const state of ['roster','planning']){if(state==='planning')await page.locator('#workspace').click();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${out}/${key}-${state}.png`,fullPage:true});await page.screenshot({path:`${out}/${key}-${state}-viewport.png`});captures.push({width,height,scale,touch,state,file:`${key}-${state}.png`,viewport:`${key}-${state}-viewport.png`});}
 if(width===1440){await page.locator('#rules').click();await page.locator('[name=capacity]').fill('4');await page.locator('[name=useCapacity]').check();await page.getByRole('button',{name:'Apply dated local rule',exact:true}).click();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${out}/chromium-desktop-demand-enabled.png`,fullPage:true});}
 await page.close();}}finally{await browser.close();}writeFileSync(out+'/captures.json',JSON.stringify(captures,null,2));
