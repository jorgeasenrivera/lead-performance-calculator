import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('../src/LeadPerformanceCalculator.jsx',import.meta.url),'utf8');
const block=(start,end)=>{const a=src.indexOf(start),b=src.indexOf(end,a);assert.ok(a>=0&&b>a);return src.slice(a,b);};
const ctx={norm:s=>(s||'').trim().toLowerCase().replace(/\s+/g,' '),DEFAULT_THRESHOLDS:{internet:{green:20,yellow:10},phone:{green:25,yellow:12},showroom:{green:30,yellow:15},apptVideoDayPct:{green:60,yellow:45},engagedVideoPct:{green:50,yellow:35}}};
vm.createContext(ctx);vm.runInContext(block('function normThresholds(t) {','const DEFAULT_ACTIVITY_STANDARDS'),ctx);vm.runInContext(block('function workedAnyway(data, aId, d) {','/* ============================================================================\n   Dot-matrix icon system'),ctx);
test('real streak and threshold functions agree with the SQL synthetic fixture',()=>{
 const name='alex jones',activity={},qualified={};
 for(const d of ['2026-07-05','2026-07-06','2026-07-07','2026-07-08']) {activity[d]={[name]:{calls:16,video:2}};qualified[d]={[name]:true};}
 const data={roster:[{id:'a',name:'Alex Jones'}],activity,qualified,forcedOff:{a:['2026-07-08']}};
 assert.equal(ctx.currentStreak(data,data.roster[0],{minCalls:16,minVideos:2}).len,3);
 const thresholds=ctx.normThresholds({green:40,yellow:20});assert.deepEqual(JSON.parse(JSON.stringify(thresholds.internet)),{green:40,yellow:20});assert.deepEqual(JSON.parse(JSON.stringify(thresholds.apptVideoDayPct)),{green:60,yellow:45});assert.deepEqual(JSON.parse(JSON.stringify(ctx.normThresholds({green:33}).phone)),{green:33,yellow:10});
});
