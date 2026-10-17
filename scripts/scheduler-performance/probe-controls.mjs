import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const pw=createRequire(import.meta.url)('/workspace/cloud-tools/node_modules/playwright');
const out=process.env.EVIDENCE_DIR||'scripts/scheduler-performance/evidence/shared-controls/controls';mkdirSync(out,{recursive:true});
const results=[];
for(const engine of (process.env.BROWSERS||'chromium,webkit').split(',')){
 const b=await pw[engine].launch(engine==='chromium'?{executablePath:'/usr/bin/chromium',args:['--no-sandbox']}:{});
 try{for(const [width,scale]of [[320,1],[390,1],[768,1],[1440,1],[320,2],[1024,2]]){
  const key=`${engine}-${width}-text${scale*100}`,p=await b.newPage({viewport:{width,height:900},hasTouch:width<=700,reducedMotion:'reduce'}),errors=[];p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));
  try{
   await p.goto('http://127.0.0.1:5190/');await p.locator('.sp-performance').waitFor();
   const recap=p.getByRole('button',{name:'Close the round-up'});if(await recap.isVisible())await recap.click();
   await p.evaluate(async s=>{await document.fonts.ready;document.documentElement.style.fontSize=s*100+'%';await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},scale);
   await p.route('**/__axe.js',r=>r.fulfill({contentType:'application/javascript',body:readFileSync('/workspace/qa-tools/node_modules/axe-core/axe.min.js','utf8')}));await p.addScriptTag({url:'http://127.0.0.1:5190/__axe.js'});
   const scan=async selector=>{const violations=await p.evaluate(async selector=>(await axe.run(selector,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),selector);assert.deepEqual(violations,[]);};
   const bar=width<=700?'.botnav':'.tool-switch';
   const geometry=await p.locator(bar).evaluate(e=>{const box=e.getBoundingClientRect();return {width:box.width,height:box.height,radius:getComputedStyle(e).borderRadius,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,buttons:[...e.querySelectorAll(':scope > button')].map(b=>{const r=b.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,text:b.textContent.trim(),font:getComputedStyle(b.querySelector('.botnav-lbl')||b).fontSize};})};});
   assert.equal(geometry.radius,'20px');assert.ok(geometry.scrollWidth<=geometry.clientWidth);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   if(width<=700){assert.equal(geometry.buttons.length,4);assert.ok(geometry.buttons.every(x=>Math.abs(x.y-geometry.buttons[0].y)<1&&Math.abs(x.width-geometry.buttons[0].width)<1));assert.equal(geometry.buttons[0].font,scale===2?'24px':'12px');assert.equal(await p.locator('.botnav [aria-current=page]').count(),1);
    const fits=await p.locator('.botnav-lbl').evaluateAll(es=>es.every(e=>{const r=document.createRange();r.selectNodeContents(e);const t=r.getBoundingClientRect(),b=e.getBoundingClientRect();return t.left>=b.left-1&&t.right<=b.right+1&&t.bottom<=b.bottom+1;}));assert.equal(fits,true);
   }
   await scan(bar);await p.screenshot({path:`${out}/${key}-performance.png`});
   const brand=p.locator('.brand-btn');await brand.click();await p.getByRole('dialog',{name:'Account menu',exact:true}).waitFor();assert.equal(await p.locator('.brand-menu button:not(:disabled)').first().evaluate(e=>e===document.activeElement),true);await scan('.brand-menu');assert.equal(await p.locator('.brand-menu').evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+5));}),true,'account header must paint above the section selector');assert.equal(await p.locator('.brand-menu button:not(:disabled)').first().evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'account action must be above the section selector');await p.screenshot({path:`${out}/${key}-account.png`});await p.keyboard.press('Escape');await p.locator('.brand-menu').waitFor({state:'hidden'});assert.equal(await brand.evaluate(e=>e===document.activeElement),true);
   if(width<=700){const rooms=p.locator('.botnav-btn[aria-label=Rooms]');await rooms.click();await p.locator('.qpick').waitFor();await scan('.qpick');assert.deepEqual(await p.locator('.qpick-ico').first().evaluate(e=>({width:getComputedStyle(e).width,radius:getComputedStyle(e).borderRadius})),{width:'40px',radius:'12px'});const anchor=await p.evaluate(()=>({menu:document.querySelector('.qpick').getBoundingClientRect().bottom,bar:document.querySelector('.botnav').getBoundingClientRect().top}));assert.ok(anchor.menu<=anchor.bar-5);await p.screenshot({path:`${out}/${key}-rooms.png`});await p.keyboard.press('Escape');await p.locator('.qpick').waitFor({state:'hidden'});assert.equal(await rooms.evaluate(e=>e===document.activeElement),true);
    const more=p.locator('.botnav-btn').filter({hasText:'More'});await more.click();await p.locator('.drawer-root.open').waitFor();await scan('.drawer');await p.screenshot({path:`${out}/${key}-more.png`});await p.keyboard.press('Escape');assert.equal(await more.evaluate(e=>e===document.activeElement),true);
   }
   assert.deepEqual(errors,[]);results.push({key,status:'passed',geometry,menuFocusRestored:true,scopedAxe:true});console.log(key,'passed');
  }catch(e){results.push({key,status:'failed',error:String(e),pageErrors:errors});await p.screenshot({path:`${out}/${key}-failure.png`}).catch(()=>{});console.error(key,String(e));}
  finally{await p.close();writeFileSync(out+'/results.json',JSON.stringify(results,null,2)+'\n');}
 }}finally{await b.close();}
}
assert.ok(results.every(r=>r.status==='passed'),'Controls matrix has failures; inspect retained results.');
