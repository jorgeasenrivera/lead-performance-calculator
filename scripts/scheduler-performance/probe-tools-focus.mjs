// Schedule tools are recreated closed by every render. A tool that hands focus back must reopen its disclosure,
// so focus lands on a control the person can see, not on a hidden child of a closed <details>.
import {createRequire} from 'node:module';import {mkdirSync,writeFileSync} from 'node:fs';import assert from 'node:assert/strict';
const pw=createRequire(import.meta.url)('/workspace/cloud-tools/node_modules/playwright'),engine=process.env.BROWSER||'chromium',base=process.env.BASE_URL||'http://127.0.0.1:5190',out=process.env.EVIDENCE_DIR||'/tmp/tools-focus';mkdirSync(out,{recursive:true});
const b=await pw[engine].launch(engine==='chromium'?{executablePath:'/usr/bin/chromium',args:['--no-sandbox']}:{}),results=[];
try{for(const width of [1440,390]){
 const p=await b.newPage({viewport:{width,height:width>700?900:844},hasTouch:width<700,reducedMotion:'reduce'});p.setDefaultTimeout(12000);await p.clock.setFixedTime(new Date('2026-10-14T16:00:00Z'));const errors=[];p.on('pageerror',e=>errors.push(e.message));
 // Same modality the case claims: a tap on a phone, focus plus Enter with a keyboard.
 const activate=async selector=>{const l=p.locator(selector);if(await l.evaluate(e=>Boolean(e.closest('.schedule-tools:not([open])'))&&!e.matches('summary')))await activate('.schedule-tools > summary');if(width<700)await l.tap();else{await l.focus();await p.keyboard.press('Enter');}};
 const focused=async id=>{const r=await p.evaluate(()=>{const e=document.activeElement;return {id:e.id,visible:e.getClientRects().length>0,inClosed:Boolean(e.closest('.schedule-tools:not([open])'))};});assert.deepEqual(r,{id,visible:true,inClosed:false},'focus after '+id);};
 await p.goto(base+'/planner/');await activate('#next');await activate('#workspace');
 await activate('#off-day-tools');await activate('#off-cancel');await focused('off-day-tools');
 await activate('#generate-month');await activate('#generation-cancel');await focused('generate-month');
 await activate('#setup');await activate('#close-setup');await focused('setup');
 await activate('#import-schedule');await activate('#cancel-import');await focused('import-schedule');
 assert.deepEqual(errors,[]);results.push({engine,width,status:'passed'});console.log(engine,width,'tools focus passed');await p.close();}
}finally{await b.close();}
writeFileSync(out+'/tools-focus-results.json',JSON.stringify(results,null,2));
