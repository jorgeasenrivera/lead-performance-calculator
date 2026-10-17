import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('/workspace/cloud-tools/node_modules/playwright');
const out=process.env.EVIDENCE_DIR||'/tmp/sage-native-day-motion';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
try{
 await page.goto('http://127.0.0.1:5190/planner/');await page.locator('#next').click();await page.locator('#next').click();await page.locator('#day-2026-12-07').tap();
 await page.waitForFunction(()=>!document.querySelector('#sheet').getAnimations().length);
 const cdp=await page.context().newCDPSession(page),heading=await page.locator('#sheet .day-heading').boundingBox(),y=heading.y+heading.height/2;
 const send=(type,x)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,radiusX:4,radiusY:4,force:1,id:1}]});
 await page.evaluate(()=>{window.motionSamples=[];window.sampleMotion=true;function frame(){const e=document.querySelector('#sheet'),s=getComputedStyle(e),m=new DOMMatrix(s.transform==='none'?undefined:s.transform);window.motionSamples.push({x:m.m41,y:m.m42,opacity:s.opacity,day:e.querySelector('.day-heading').textContent});if(window.sampleMotion)requestAnimationFrame(frame);}requestAnimationFrame(frame);});
 await send('touchStart',280);for(const x of [260,240,210,180,150]){await send('touchMove',x);await page.waitForTimeout(16);}
 const alignment=await page.evaluate(()=>{const live=document.querySelector('#sheet .day-heading').getBoundingClientRect(),panes=[...document.querySelectorAll('.day-motion-preview .day-heading')].map(e=>e.getBoundingClientRect().top);return {live:live.top,panes};});
 assert.ok(alignment.panes.every(y=>Math.abs(y-alignment.live)<1),'incoming heading aligns with live heading');
 await page.screenshot({path:out+'/chromium-native-drag.png'});await send('touchEnd');
 await page.waitForFunction(()=>!document.querySelector('.day-motion-preview'));
 assert.match(await page.locator('#sheet .day-heading').innerText(),/Dec 8/);
 const samples=await page.evaluate(()=>{window.sampleMotion=false;return window.motionSamples;});
 assert.ok(samples.some(s=>s.x< -60));assert.ok(samples.every(s=>s.opacity==='1'&&s.y===0&&s.x<=.5&&s.x>=-390));
 await page.screenshot({path:out+'/chromium-native-settled.png'});
 writeFileSync(out+'/results.json',JSON.stringify({engine:'chromium',input:'CDP native touch dispatch, not a physical device',alignment,samples},null,2)+'\n');
 console.log('Native touch dispatch and opaque bounded frames passed');
}finally{await browser.close();}
