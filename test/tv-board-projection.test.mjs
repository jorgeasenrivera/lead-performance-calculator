import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectBoard } from '../api/_board-projection.mjs';
const config={stores:[{id:'demo',name:'Demo'}],roles:[{id:'sales'},{id:'bdc',onBoard:false}]};
const month='2026-07', today='2026-07-08';
const data={roster:[{id:'a',name:'Alex Jones',roleId:'sales',private:'hidden'},{id:'b',name:'Bill Green',roleId:'bdc'},{id:'c',name:'Gone Person',roleId:'sales'}],departed:[{name:'Gone Person'}],goals:{a:{monthly:10}},daysOff:{a:['2026-07-10','2026-09-01']},months:{[month]:{stats:{'alex jones':{internetUnits:0.5,phoneUnits:2,prevPct:{internet:0.2,private:'hidden'},prevUnits:{phone:1.5,private:'hidden'},private:'hidden'}},boardCountEvidence:{status:'verified',source:'store-rollup',storeId:'demo',periodStart:'2026-07-01',periodEnd:today,deliveries:4}}},secret:'hidden'};
const args={config,storeId:'demo',data,month,today,updatedAt:'synthetic',defaults:{brand:{primary:'blue'},activityStandards:{}},normalizeThresholds:()=>({}),streak:()=>({dir:'up',len:3})};
test('projection carries approved board fields and whole store count without changing split credits',()=>{
 const row=projectBoard(args); assert.equal(row.months[month].storeTotal,4); assert.equal(row.months[month].stats['alex jones'].internetUnits,0.5); assert.deepEqual(row.months[month].stats['alex jones'].prevPct,{internet:0.2}); assert.deepEqual(row.months[month].stats['alex jones'].prevUnits,{phone:1.5});
 assert.deepEqual(row.roster.map(x=>x.id),['a']); assert.deepEqual(row.people.map(x=>x.id),['a','b']); assert.deepEqual(row.goals,{'alex jones':10}); assert.deepEqual(row.off,{'alex jones':['2026-07-10']}); assert.match(row.ticker[0],/3-day streak/); assert.doesNotMatch(JSON.stringify(row),/hidden/);
});
test('unverified legacy count is omitted, and wrong store fails closed',()=>{
 const legacy=structuredClone(data); delete legacy.months[month].boardCountEvidence; legacy.months[month].stated={deliveries:4};
 assert.equal(projectBoard({...args,data:legacy}).months[month].storeTotal,undefined);
 assert.throws(()=>projectBoard({...args,storeId:'elsewhere'}),/store not found/);
});

test('malformed public values cannot carry nested private data',()=>{
 const bad=structuredClone(data),badConfig=structuredClone(config);
 badConfig.stores[0].icon={private:'hidden'};
 badConfig.stores[0].brand={primary:['#123456'],deep:'#112233',accent:'url(private)'};
 bad.roster.push({id:{private:'hidden'},name:'Bad',roleId:'sales'},{id:'x',name:{private:'hidden'},roleId:'sales'},{id:'z',name:'<img src=x>',roleId:'sales'});
 bad.goals.a={monthly:{private:'hidden'}};
 bad.daysOff.a=['2026-07-03',{private:'hidden'},'2026-07-99'];
 bad.boardDisplay={style:'private',bg:{private:'hidden'},rotate:['ok',{private:'hidden'}],pad:{private:'hidden'}};
 bad.months[month].stats['alex jones'].internetPct={private:'hidden'};
 bad.months[month].stats['alex jones'].prevPct={internet:{private:'hidden'},phone:0.25};
 const row=projectBoard({...args,config:badConfig,data:bad,updatedAt:{private:'hidden'}});
 assert.equal(row.icon,null);assert.equal(row.updatedAt,null);assert.equal(row.brand.primary,'#2A5E9B');assert.equal(row.brand.deep,'#112233');assert.deepEqual(row.goals,{});assert.deepEqual(row.off,{'alex jones':['2026-07-03']});
 assert.deepEqual(row.months[month].stats['alex jones'].prevPct,{phone:0.25});assert.equal(row.months[month].stats['alex jones'].internetPct,undefined);
 assert.deepEqual(row.boardDisplay,{});assert.deepEqual(row.roster.map(x=>x.id),['a']);assert.doesNotMatch(JSON.stringify(row),/hidden|private/);
});
test('cropped PNG logo remains available but unsafe icon schemes and objects do not',()=>{
 for(const icon of ['https://example.test/logo.png','javascript:alert(1)',{private:'x'}]) assert.equal(projectBoard({...args,config:{...config,stores:[{id:'demo',name:'Demo',icon}]}}).icon,null);
 assert.equal(projectBoard({...args,config:{...config,stores:[{id:'demo',name:'Demo',icon:'data:image/png;base64,aGVsbG8='}]}}).icon,'data:image/png;base64,aGVsbG8=');
});
