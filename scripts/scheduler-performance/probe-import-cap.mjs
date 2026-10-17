import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {chromium,webkit}=createRequire(import.meta.url)('/workspace/cloud-tools/node_modules/playwright');
const engine=process.env.BROWSER||'chromium',out=process.env.EVIDENCE_DIR||'/tmp/import-cap';mkdirSync(out,{recursive:true});
const browser=await {chromium,webkit}[engine].launch(engine==='chromium'?{executablePath:'/usr/bin/chromium',args:['--no-sandbox']}:{});
try{
 const p=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});p.setDefaultTimeout(12000);await p.clock.install({time:new Date('2026-10-14T16:00:00Z')});
 await p.goto('http://127.0.0.1:5190/planner/');await p.locator('.day-heading').waitFor();
 await p.locator('#period-heading').click();await p.locator('#month').fill('2026-12');await p.locator('#month').dispatchEvent('change');await p.locator('#workspace').click();
 await p.locator('#people').click();await p.locator('[name=maxHours]').fill('8');await p.getByRole('button',{name:'Apply to local proposal',exact:true}).click();
 await p.locator('#day-2026-12-31').click();await p.locator('[name=assigned][value=p0]').check();await p.getByRole('button',{name:'Apply day override',exact:true}).click();await p.locator('#next').click();
 const upload=async()=>{await p.locator('#import-schedule').click();await p.locator('#schedule-file').setInputFiles({name:'cedar-cap-regression.csv',mimeType:'text/csv',buffer:Buffer.from('Name,Date,Start,End\nAlex 1,2027-01-01,09:00,09:01\nBlair 1,2027-01-01,09:00,09:01')});await p.locator('.import-row').first().waitFor();};
 await upload();assert.match(await p.locator('.import-row').first().innerText(),/Existing assignment on 2026-12-31.*weekly hours exceeded/);assert.ok(await p.locator('#apply-import').isDisabled());
 await p.locator('#import-sheet').screenshot({path:`${out}/${engine}-blocked-existing-cap.png`});await p.locator('#cancel-import').click();assert.equal(await p.locator('[name=assigned]:checked').count(),0,'blocked review and cancel applied nothing');
 await upload();await p.locator('[data-skip="0"]').check();assert.equal(await p.locator('#apply-import').isDisabled(),false);await p.locator('#apply-import').click();assert.equal(await p.locator('[name=assigned][value=p0]').isChecked(),false);assert.equal(await p.locator('[name=assigned][value=p1]').isChecked(),true);
 await p.locator('#previous').click();await p.locator('#day-2026-12-31').click();assert.equal(await p.locator('[name=assigned][value=p0]').isChecked(),true);await p.locator('#people').click();assert.equal(await p.locator('[name=maxHours]').inputValue(),'8');
 writeFileSync(out+'/results.json',JSON.stringify({engine,status:'passed',existingMonthCap:8,importMonthCap:40,blocked:true,cancelUnchanged:true,explicitSkipRecovery:true},null,2));console.log(engine,'cap regression passed');
}finally{await browser.close();}
